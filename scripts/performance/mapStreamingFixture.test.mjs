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
  assert.equal(first.manifest.assetCount, 69);
  assert.equal(first.manifest.geometry.tilesetNodeCount, 21);
  assert.deepEqual(
    first.manifest.coverage.imagery.map(({ level, tiles }) => [
      level,
      tiles.length,
    ]),
    Array.from({ length: 13 }, (_, level) => [
      level,
      level < 9 ? 1 : level === 9 || level === 10 ? 2 : level === 11 ? 4 : 9,
    ]),
  );
  assert.deepEqual(
    first.manifest.coverage.terrain.map(({ level, tiles }) => [
      level,
      tiles.length,
    ]),
    Array.from({ length: 11 }, (_, level) => [level, level < 8 ? 1 : 4]),
  );
  const layerRow = first.manifest.assets.find(
    (row) => row.kind === 'quantized-mesh-layer-metadata',
  );
  const layer = JSON.parse(first.assets.get(layerRow.path));
  assert.equal(layerRow.path, 'terrain/layer.json');
  assert.equal(layer.available.length, 11);
  for (const level of first.manifest.coverage.terrain)
    assert.equal(layer.available[level.level].length, level.tiles.length);
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
      maximumLevel: 12,
      tileWidth: 256,
      tileHeight: 256,
    });
    assert.equal(imageryProvider.tileWidth, 256);
    assert.equal(imageryProvider.tileHeight, 256);
    assert.equal(imageryProvider.minimumLevel, 0);
    assert.equal(imageryProvider.maximumLevel, 12);
    const imageryRows = fixture.manifest.assets.filter(
      (row) => row.kind === 'webmercator-imagery-png',
    );
    for (const row of imageryRows) {
      const url = `${baseUrl}imagery/${row.identity.level}/${row.identity.x}/${row.identity.y}.png`;
      const imageBytes = Buffer.from(
        await new Cesium.Resource({ url }).fetchArrayBuffer(),
      );
      assert.equal(digest(imageBytes), row.sha256);
      const image = await sharp(imageBytes)
        .raw()
        .toBuffer({ resolveWithObject: true });
      assert.deepEqual(
        [image.info.width, image.info.height, image.info.channels],
        [256, 256, 3],
      );
      const colors = new Set();
      for (let offset = 0; offset < image.data.length; offset += 3)
        colors.add(image.data.subarray(offset, offset + 3).toString('hex'));
      assert.ok(
        colors.size > 8,
        `${row.path} must decode to varied map pixels`,
      );
    }
    const imageryLevel12 = fixture.manifest.coverage.imagery.at(-1);
    const imageryAncestors = new Set();
    for (const terminal of imageryLevel12.tiles)
      for (let level = 0; level <= terminal.level; level += 1) {
        const scale = 2 ** (terminal.level - level);
        const x = Math.floor(terminal.x / scale);
        const y = Math.floor(terminal.y / scale);
        imageryAncestors.add(`${level}/${x}/${y}`);
        assert.ok(
          imageryRows.some(
            (row) =>
              row.identity.level === level &&
              row.identity.x === x &&
              row.identity.y === y,
          ),
          `imagery ancestor ${level}/${x}/${y} must be present`,
        );
      }
    assert.equal(imageryAncestors.size, imageryRows.length);

    const terrain = await Cesium.CesiumTerrainProvider.fromUrl(
      `${baseUrl}terrain/`,
    );
    const terrainRows = fixture.manifest.assets.filter(
      (row) => row.kind === 'quantized-mesh-1.0',
    );
    const requestedTerrain = new Set();
    for (const terminal of fixture.manifest.coverage.terrain.at(-1).tiles)
      for (let level = 0; level <= terminal.level; level += 1) {
        const scale = 2 ** (terminal.level - level);
        const ancestor = {
          level,
          x: Math.floor(terminal.x / scale),
          y: Math.floor(terminal.y / scale),
        };
        const key = `${level}/${ancestor.x}/${ancestor.y}`;
        if (requestedTerrain.has(key)) continue;
        requestedTerrain.add(key);
        assert.ok(
          terrainRows.some(
            (row) =>
              row.identity.level === ancestor.level &&
              row.identity.x === ancestor.x &&
              row.identity.y === ancestor.y,
          ),
          `terrain ancestor ${key} must be present`,
        );
        const ancestorData = await terrain.requestTileGeometry(
          ancestor.x,
          ancestor.y,
          ancestor.level,
        );
        assert.ok(
          ancestorData instanceof Cesium.QuantizedMeshTerrainData,
          `Cesium must parse terrain ancestor ${key}`,
        );
      }
    assert.equal(requestedTerrain.size, terrainRows.length);
    const tile = fixture.manifest.coverage.terrain[8].tiles[0];
    const data = await terrain.requestTileGeometry(tile.x, tile.y, tile.level);
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
    const tileNodes = [];
    const collectTiles = (node) => {
      tileNodes.push(node);
      for (const child of node.children ?? []) collectTiles(child);
    };
    collectTiles(tileset.root);
    assert.equal(tileNodes.length, 21);
    const parsedGlbPaths = new Set();
    for (const node of tileNodes) {
      assert.equal(
        node.refine,
        1,
        'Cesium parses REPLACE refinement as enum value 1',
      );
      const resource = node._contentResource;
      assert.ok(resource, 'every tileset node must own a content resource');
      const assetUrl = new URL(resource.url);
      const assetPath = decodeURIComponent(
        assetUrl.pathname.slice(new URL(baseUrl).pathname.length),
      );
      assert.ok(
        fixture.assets.has(assetPath),
        `Cesium-resolved content URL must map to a fixture asset: ${assetPath}`,
      );
      assert.ok(
        node._header.content.uri.startsWith('../tiles/'),
        'tileset content URI must resolve from tileset/tileset.json to /tiles/',
      );
      const arrayBuffer = await resource.fetchArrayBuffer();
      const bytes = Buffer.from(arrayBuffer);
      assert.equal(
        digest(bytes),
        fixture.manifest.assets.find((row) => row.path === assetPath).sha256,
      );
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
      const jsonChunkLength = bytes.readUInt32LE(12);
      const binaryChunkStart = 20 + jsonChunkLength;
      const binaryStart = binaryChunkStart + 8;
      const positionAccessor = loader.gltfJson.accessors[0];
      const positionView =
        loader.gltfJson.bufferViews[positionAccessor.bufferView];
      const positionStart =
        binaryStart +
        (positionView.byteOffset ?? 0) +
        (positionAccessor.byteOffset ?? 0);
      const region = node._header.boundingVolume.region;
      for (let vertex = 0; vertex < positionAccessor.count; vertex += 1) {
        const offset = positionStart + vertex * 12;
        const localPosition = new Cesium.Cartesian3(
          bytes.readFloatLE(offset),
          bytes.readFloatLE(offset + 4),
          bytes.readFloatLE(offset + 8),
        );
        const worldPosition = Cesium.Matrix4.multiplyByPoint(
          node.computedTransform,
          localPosition,
          new Cesium.Cartesian3(),
        );
        const cartographic = Cesium.Cartographic.fromCartesian(worldPosition);
        assert.ok(
          cartographic.longitude >= region[0] - 2e-6 &&
            cartographic.longitude <= region[2] + 2e-6 &&
            cartographic.latitude >= region[1] - 2e-6 &&
            cartographic.latitude <= region[3] + 2e-6 &&
            cartographic.height >= region[4] - 0.1 &&
            cartographic.height <= region[5] + 0.1,
          `transformed GLB vertex ${vertex} must lie in declared region for ${assetPath}: ${JSON.stringify({ longitude: cartographic.longitude, latitude: cartographic.latitude, height: cartographic.height, region })}`,
        );
      }
      loader.unload();
      parsedGlbPaths.add(assetPath);

      const transformedCenter = Cesium.Matrix4.getTranslation(
        node.computedTransform,
        new Cesium.Cartesian3(),
      );
      const regionCenter = Cesium.Cartesian3.fromRadians(
        (region[0] + region[2]) / 2,
        (region[1] + region[3]) / 2,
        0,
      );
      assert.ok(
        Cesium.Cartesian3.distance(transformedCenter, regionCenter) < 0.01,
        `computed tile transform must place ${assetPath} at its geographic region`,
      );
    }
    assert.equal(parsedGlbPaths.size, 21);
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
