import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { createHash } from 'node:crypto';
import test from 'node:test';
import sharp from 'sharp';
import * as Cesium from 'cesium';
import {
  createDeterministicMapStreamingFixture,
  MAP_STREAMING_FIXTURE_ID,
  MAP_STREAMING_MAX_BYTES,
  validateDeterministicMapStreamingFixture,
} from './mapStreamingFixture.mjs';

function digest(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function createFixtureServer(fixture, { corruptPath = null } = {}) {
  const server = createServer((request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1');
    if (url.pathname === '/map/terrain/layer.json') {
      const terrainRows = fixture.manifest.assets.filter(
        (row) => row.kind === 'quantized-mesh-1.0',
      );
      const maxLevel = Math.max(
        ...terrainRows.map((row) => row.identity.level),
      );
      const available = Array.from({ length: maxLevel + 1 }, () => []);
      for (const row of terrainRows) {
        const { level, x, tmsY } = row.identity;
        available[level].push({
          startX: x,
          endX: x,
          startY: tmsY,
          endY: tmsY,
        });
      }
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(
        JSON.stringify({
          format: 'quantized-mesh-1.0',
          version: '1.0.0',
          scheme: 'tms',
          projection: 'EPSG:4326',
          maxzoom: 10,
          tiles: ['{z}/{x}/{y}.terrain'],
          available,
        }),
      );
      return;
    }
    const assetPath = decodeURIComponent(url.pathname.slice('/map/'.length));
    let bytes = fixture.assets.get(assetPath);
    if (!bytes) {
      response.writeHead(404);
      response.end();
      return;
    }
    if (assetPath === corruptPath) bytes = bytes.subarray(0, 64);
    const contentType = assetPath.endsWith('.json')
      ? 'application/json'
      : assetPath.endsWith('.terrain')
        ? 'application/vnd.quantized-mesh'
        : assetPath.endsWith('.glb')
          ? 'model/gltf-binary'
          : 'image/png';
    response.writeHead(200, { 'content-type': contentType });
    response.end(bytes);
  });
  return server;
}

async function withFixtureServer(fixture, options, callback) {
  const server = createFixtureServer(fixture, options);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const baseUrl = `http://127.0.0.1:${server.address().port}/map/`;
  try {
    return await callback(baseUrl);
  } finally {
    server.close();
    await once(server, 'close');
  }
}

test('map streaming fixture generation is stable, bounded, and route-indexed', async () => {
  const first = await createDeterministicMapStreamingFixture();
  const second = await createDeterministicMapStreamingFixture();
  assert.equal(first.id, MAP_STREAMING_FIXTURE_ID);
  assert.equal(first.manifestSha256, second.manifestSha256);
  assert.deepEqual(first.manifestBytes, second.manifestBytes);
  assert.equal(first.manifest.totalBytes, second.manifest.totalBytes);
  assert.ok(first.manifest.totalBytes < 2 * 1024 * 1024);
  assert.ok(first.manifest.totalBytes <= MAP_STREAMING_MAX_BYTES);
  assert.equal(first.manifest.assetCount, 49);
  assert.equal(first.manifest.geometry.tilesetNodeCount, 21);
  assert.deepEqual(
    first.manifest.coverage.imagery.map(({ level, tiles }) => [
      level,
      tiles.length,
    ]),
    [
      [10, 2],
      [11, 4],
      [12, 9],
    ],
  );
  assert.deepEqual(
    first.manifest.coverage.terrain.map(({ level, tiles }) => [
      level,
      tiles.length,
    ]),
    [
      [8, 4],
      [9, 4],
      [10, 4],
    ],
  );
  assert.ok(
    first.manifest.assets.every(
      (row) => row.sha256 === digest(first.assets.get(row.path)),
    ),
  );
  assert.equal(validateDeterministicMapStreamingFixture(first), true);
});

test('map streaming fixture rejects truncated, modified, missing, and unbounded assets', async () => {
  const fixture = await createDeterministicMapStreamingFixture();
  const assetRow = fixture.manifest.assets.find(
    (row) => row.kind === 'quantized-mesh-1.0',
  );

  const truncated = {
    ...fixture,
    assets: new Map(fixture.assets),
  };
  truncated.assets.set(
    assetRow.path,
    truncated.assets.get(assetRow.path).subarray(0, 12),
  );
  assert.throws(
    () => validateDeterministicMapStreamingFixture(truncated),
    /length mismatch/,
  );

  const modified = {
    ...fixture,
    assets: new Map(fixture.assets),
  };
  const altered = Buffer.from(modified.assets.get(assetRow.path));
  altered[altered.length - 1] ^= 0xff;
  modified.assets.set(assetRow.path, altered);
  assert.throws(
    () => validateDeterministicMapStreamingFixture(modified),
    /SHA-256 mismatch/,
  );

  const missing = { ...fixture, assets: new Map(fixture.assets) };
  missing.assets.delete(assetRow.path);
  assert.throws(
    () => validateDeterministicMapStreamingFixture(missing),
    /asset inventory/,
  );

  const oversized = {
    ...fixture,
    manifest: { ...fixture.manifest, totalBytes: MAP_STREAMING_MAX_BYTES + 1 },
  };
  assert.throws(
    () => validateDeterministicMapStreamingFixture(oversized),
    /byte and asset bounds/,
  );
});

test('Cesium terrain and tileset parsers accept the generated local route corpus', async () => {
  const fixture = await createDeterministicMapStreamingFixture();
  const originalHashes = new Map(
    fixture.manifest.assets.map((row) => [
      row.path,
      digest(fixture.assets.get(row.path)),
    ]),
  );
  await withFixtureServer(fixture, {}, async (baseUrl) => {
    const imageryProvider = new Cesium.UrlTemplateImageryProvider({
      url: `${baseUrl}imagery/{z}/{x}/{y}.png`,
      minimumLevel: 10,
      maximumLevel: 12,
      tileWidth: 256,
      tileHeight: 256,
    });
    assert.equal(imageryProvider.tileWidth, 256);
    assert.equal(imageryProvider.tileHeight, 256);
    assert.equal(imageryProvider.maximumLevel, 12);
    const imageryRows = fixture.manifest.assets.filter(
      (row) => row.kind === 'webmercator-imagery-png',
    );
    for (const row of imageryRows) {
      const image = await sharp(fixture.assets.get(row.path)).metadata();
      assert.deepEqual(
        [image.format, image.width, image.height],
        ['png', 256, 256],
      );
    }

    const terrain = await Cesium.CesiumTerrainProvider.fromUrl(
      `${baseUrl}terrain/`,
    );
    const tile = fixture.manifest.coverage.terrain[0].tiles[0];
    const data = await terrain.requestTileGeometry(tile.x, tile.y, tile.level);
    assert.ok(data instanceof Cesium.QuantizedMeshTerrainData);
    const tilingScheme = terrain.tilingScheme;
    const rectangle = tilingScheme.tileXYToRectangle(
      tile.x,
      tile.y,
      tile.level,
    );
    const sampleHeights = [
      [0.25, 0.25],
      [0.5, 0.5],
      [0.75, 0.75],
    ].map(([x, y]) =>
      data.interpolateHeight(
        rectangle,
        Cesium.Math.lerp(rectangle.west, rectangle.east, x),
        Cesium.Math.lerp(rectangle.south, rectangle.north, y),
      ),
    );
    assert.ok(sampleHeights.every(Number.isFinite));
    assert.ok(
      new Set(sampleHeights).size > 1,
      'quantized terrain heights must vary',
    );

    const tileset = await Cesium.Cesium3DTileset.fromUrl(
      `${baseUrl}tileset/tileset.json`,
    );
    assert.equal(tileset.root.children.length, 4);
    assert.equal(tileset.root.geometricError, 2_400);
    let parsedGlbs = 0;
    for (const row of fixture.manifest.assets.filter(
      (asset) => asset.kind === 'textured-glb',
    )) {
      const resource = new Cesium.Resource({ url: `${baseUrl}${row.path}` });
      const bytes = fixture.assets.get(row.path);
      const loader = new Cesium.GltfLoader({
        gltfResource: resource,
        typedArray: new Uint8Array(
          bytes.buffer,
          bytes.byteOffset,
          bytes.byteLength,
        ),
      });
      await loader.load();
      assert.equal(loader.gltfJson.asset.version, '2.0');
      assert.equal(loader.gltfJson.images.length, 1);
      assert.equal(loader.gltfJson.images[0].mimeType, 'image/png');
      assert.equal(loader.gltfJson.accessors[0].count, 25);
      assert.equal(loader.gltfJson.accessors[3].count, 96);
      assert.equal(
        loader.gltfJson.materials[0].pbrMetallicRoughness.baseColorTexture
          .index,
        0,
      );
      loader.unload();
      parsedGlbs += 1;
    }
    assert.equal(parsedGlbs, 21);
  });
  for (const row of fixture.manifest.assets)
    assert.equal(
      digest(fixture.assets.get(row.path)),
      originalHashes.get(row.path),
      `Cesium parser flow must not mutate owned fixture bytes: ${row.path}`,
    );
  assert.equal(validateDeterministicMapStreamingFixture(fixture), true);
});

test('Cesium rejects truncated quantized-mesh and GLB HTTP responses', async () => {
  const fixture = await createDeterministicMapStreamingFixture();
  const tile = fixture.manifest.coverage.terrain[0].tiles[0];
  const terrainPath = fixture.manifest.assets.find(
    (row) =>
      row.kind === 'quantized-mesh-1.0' &&
      row.identity.level === tile.level &&
      row.identity.x === tile.x &&
      row.identity.y === tile.y,
  ).path;
  const glbPath = fixture.manifest.assets.find(
    (row) => row.kind === 'textured-glb',
  ).path;
  await withFixtureServer(
    fixture,
    { corruptPath: terrainPath },
    async (baseUrl) => {
      const terrain = await Cesium.CesiumTerrainProvider.fromUrl(
        `${baseUrl}terrain/`,
      );
      await assert.rejects(
        terrain.requestTileGeometry(tile.x, tile.y, tile.level),
      );
    },
  );
  await withFixtureServer(
    fixture,
    { corruptPath: glbPath },
    async (baseUrl) => {
      const loader = new Cesium.GltfLoader({
        gltfResource: new Cesium.Resource({ url: `${baseUrl}${glbPath}` }),
      });
      await assert.rejects(loader.load());
      loader.unload();
    },
  );
});
