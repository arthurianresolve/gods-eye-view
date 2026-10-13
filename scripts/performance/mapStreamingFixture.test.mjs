import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { createHash } from 'node:crypto';
import test from 'node:test';
import sharp from 'sharp';
import * as Cesium from 'cesium';
import {
  createDeterministicMapStreamingFixture,
  loadPinnedMapTilesetAssets,
  MAP_STREAMING_CANONICAL_TILE_ORIGIN,
  MAP_STREAMING_FIXTURE_ID,
  MAP_STREAMING_MAX_ASSETS,
  MAP_STREAMING_MAX_BYTES,
  validatePinnedMapTileRows,
  validatePinnedMapImageryTemplateCorpus,
  validateDeterministicMapStreamingFixture,
} from './mapStreamingFixture.mjs';

const LEGACY_IMAGERY_ROWS_SHA256 =
  '5e4d6bfc426ff87a860f6f9e3babf15c5ebc81d391da078471d2bc3a0c38d006';
const IMAGERY_TEMPLATE_INDEX_SHA256 =
  'd7c9b77091f1ac6daff16542fcd972f95cb47ab6f858e650208d0406b28fa764';
const IMAGERY_TEMPLATE_CORPUS_SHA256 =
  'f2de5cbdd02f5dfd91de10bedabf55511aceb81538aa083d9908ea3cd9271025';
const IMAGERY_PALETTE = [
  [17, 32, 57],
  [28, 55, 76],
  [42, 78, 92],
  [57, 101, 102],
  [76, 119, 96],
  [105, 135, 83],
  [143, 146, 79],
  [180, 155, 91],
  [204, 173, 119],
  [221, 198, 151],
  [232, 218, 184],
  [129, 89, 72],
  [109, 72, 65],
  [85, 68, 70],
  [57, 60, 74],
  [239, 239, 226],
];

function seedFromId(id) {
  let seed = 0x811c9dc5;
  for (const character of id) {
    seed ^= character.charCodeAt(0);
    seed = Math.imul(seed, 0x01000193) >>> 0;
  }
  return seed;
}

function digest(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function createFixtureServer(fixture, { corruptPath = null } = {}) {
  const observedRequests = [];
  const missingTileProbe = fixture.manifest.assets.find(
    (row) => row.kind === 'arcgis-missing-tile-probe-png',
  )?.identity;
  const server = createServer((request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1');
    const requestPath = decodeURIComponent(url.pathname.slice('/map/'.length));
    observedRequests.push({ path: requestPath, query: url.search });
    const servicePath = 'arcgis/rest/services/World_Imagery/MapServer';
    let assetPath = requestPath;
    if (requestPath === servicePath || requestPath === `${servicePath}/`) {
      const queryEntries = [...url.searchParams.entries()];
      assetPath =
        queryEntries.length === 1 &&
        queryEntries[0][0] === 'f' &&
        queryEntries[0][1] === 'json'
          ? `${servicePath}/metadata.json`
          : null;
    } else if (requestPath.startsWith(`${servicePath}/`)) {
      const tileRequest = requestPath.match(
        /^arcgis\/rest\/services\/World_Imagery\/MapServer\/tile\/(\d+)\/(\d+)\/(\d+)$/,
      );
      if (tileRequest && url.search === '') {
        const [, level, row, column] = tileRequest;
        assetPath =
          missingTileProbe &&
          Number(level) === missingTileProbe.level &&
          Number(row) === missingTileProbe.row &&
          Number(column) === missingTileProbe.column
            ? `${servicePath}/missing-tile-probe/${level}/${row}/${column}.png`
            : `imagery/${level}/${column}/${row}.png`;
      } else assetPath = null;
    }
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
  server.observedRequests = observedRequests;
  return server;
}

async function withFixtureServer(fixture, options, callback) {
  const server = createFixtureServer(fixture, options);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const baseUrl = `http://127.0.0.1:${server.address().port}/map/`;
  try {
    return await callback(baseUrl, server);
  } finally {
    server.close();
    await once(server, 'close');
  }
}

function assertSuccessfulProbeDecode(observation, probeRow) {
  if (observation?.decoded !== true)
    throw new Error('ArcGIS probe image did not decode successfully.');
  assert.equal(observation?.httpStatus, 200);
  assert.equal(observation?.responseBytes, probeRow.byteLength);
  assert.equal(observation?.responseSha256, probeRow.sha256);
  assert.equal(observation?.decoded, true);
  assert.deepEqual(
    [observation?.width, observation?.height, observation?.channels],
    [probeRow.identity.width, probeRow.identity.height, 4],
  );
  assert.equal(observation?.transparentPixelCount, 256 * 256);
  assert.equal(observation?.firstPixel?.[3], 0);
}

function installCesiumNodeImageDecodeSeam(
  baseUrl,
  { failDecode = false } = {},
) {
  // Decode actual fixture responses with sharp in Node, then expose those RGBA
  // bytes through the minimum canvas surface Cesium's discard policy reads.
  // This tests the production policy input, not browser image-decoder behavior.
  const previousDocument = globalThis.document;
  const previousWindow = globalThis.window;
  const previousCreateImage = Cesium.Resource._Implementations.createImage;
  const imageRequests = [];
  const pendingDecodes = [];
  const decodeObservations = [];
  let drawnImage = null;
  globalThis.document = {
    location: { href: baseUrl },
    createElement(name) {
      if (name === 'a') {
        let href = baseUrl;
        return {
          get href() {
            return href;
          },
          set href(value) {
            href = new URL(value, baseUrl).href;
          },
          get host() {
            return new URL(href).host;
          },
          get protocol() {
            return new URL(href).protocol;
          },
        };
      }
      assert.equal(name, 'canvas');
      return {
        width: 0,
        height: 0,
        getContext(type) {
          assert.equal(type, '2d');
          return {
            globalCompositeOperation: 'source-over',
            drawImage(image) {
              drawnImage = image;
            },
            getImageData() {
              return { data: drawnImage.data };
            },
          };
        },
      };
    },
  };
  globalThis.window = { location: { href: baseUrl } };
  Cesium.Resource._Implementations.createImage = (
    request,
    _crossOrigin,
    deferred,
  ) => {
    imageRequests.push(request.url);
    const decode = fetch(request.url)
      .then(async (response) => {
        if (!response.ok)
          throw new Error(`Fixture image request failed: ${response.status}`);
        const bytes = Buffer.from(await response.arrayBuffer());
        const observation = {
          httpStatus: response.status,
          responseBytes: bytes.byteLength,
          responseSha256: digest(bytes),
          decoded: false,
        };
        decodeObservations.push(observation);
        if (failDecode) throw new Error('Injected image decode failure.');
        const decoded = await sharp(bytes)
          .ensureAlpha()
          .raw()
          .toBuffer({ resolveWithObject: true });
        let transparentPixelCount = 0;
        for (let offset = 3; offset < decoded.data.length; offset += 4)
          if (decoded.data[offset] === 0) transparentPixelCount += 1;
        Object.assign(observation, {
          decoded: true,
          width: decoded.info.width,
          height: decoded.info.height,
          channels: decoded.info.channels,
          firstPixel: [...decoded.data.subarray(0, 4)],
          transparentPixelCount,
        });
        return {
          width: decoded.info.width,
          height: decoded.info.height,
          data: new Uint8ClampedArray(decoded.data),
        };
      })
      .then(
        (image) => deferred.resolve(image),
        (error) => deferred.reject(error),
      );
    pendingDecodes.push(decode);
  };
  return {
    imageRequests,
    pendingDecodes,
    decodeObservations,
    restore() {
      Cesium.Resource._Implementations.createImage = previousCreateImage;
      if (previousDocument === undefined) delete globalThis.document;
      else globalThis.document = previousDocument;
      if (previousWindow === undefined) delete globalThis.window;
      else globalThis.window = previousWindow;
    },
  };
}

test('map streaming fixture generation is stable, bounded, and route-indexed', async () => {
  const first = await createDeterministicMapStreamingFixture();
  const second = await createDeterministicMapStreamingFixture();
  assert.equal(first.id, MAP_STREAMING_FIXTURE_ID);
  assert.equal(first.manifestSha256, second.manifestSha256);
  assert.equal(
    first.manifestSha256,
    '0d739d9e4830faff2751d40945870eb7b56b9b76dc65e8cd64cb7deb5cb9b033',
  );
  assert.deepEqual(first.manifestBytes, second.manifestBytes);
  assert.equal(first.manifest.totalBytes, second.manifest.totalBytes);
  assert.equal(first.manifest.totalBytes, 4_013_691);
  assert.ok(first.manifest.totalBytes <= MAP_STREAMING_MAX_BYTES);
  assert.equal(first.manifest.assetCount, 599);
  assert.ok(first.manifest.assetCount <= MAP_STREAMING_MAX_ASSETS);
  const legacyImageryRows = first.manifest.assets
    .filter(
      (row) =>
        row.kind === 'webmercator-imagery-png' &&
        row.identity.level <= 12 &&
        first.manifest.coverage.imagery.some(
          ({ level, tiles }) =>
            level === row.identity.level &&
            tiles.some(
              ({ x, y }) => x === row.identity.x && y === row.identity.y,
            ),
        ),
    )
    .map(({ path, sha256, byteLength }) => ({ path, sha256, byteLength }));
  assert.equal(legacyImageryRows.length, 26);
  assert.equal(
    digest(Buffer.from(`${JSON.stringify(legacyImageryRows)}\n`)),
    LEGACY_IMAGERY_ROWS_SHA256,
    'Existing level 0–12 imagery bytes remain identical to the v2 fixture.',
  );
  assert.equal(first.manifest.geometry.tilesetNodeCount, 21);
  const terrainBounds = first.manifest.geometry.terrainMeshBoundsDegrees;
  assert.ok(terrainBounds.west <= first.manifest.routeBoundsDegrees.west);
  assert.ok(terrainBounds.south <= first.manifest.routeBoundsDegrees.south);
  assert.ok(terrainBounds.east >= first.manifest.routeBoundsDegrees.east);
  assert.ok(terrainBounds.north >= first.manifest.routeBoundsDegrees.north);
  assert.deepEqual(
    first.manifest.coverage.imagery.map(({ level, tiles }) => [
      level,
      tiles.length,
    ]),
    [1, 1, 1, 1, 1, 1, 1, 1, 1, 2, 2, 4, 9, 30, 108, 368].map(
      (count, level) => [level, count],
    ),
  );
  assert.deepEqual(
    first.manifest.coverage.terrain.map(({ level, tiles }) => [
      level,
      tiles.length,
    ]),
    Array.from({ length: 11 }, (_, level) => [level, level < 8 ? 1 : 4]),
  );
  assert.equal(
    first.manifest.geometry.imageryRouteCoverageKind,
    'route-bbox tiles only',
  );
  assert.equal(
    first.manifest.geometry.imageryDependencyCoverage.provider,
    'OpenStreetMapImageryProvider',
  );
  assert.equal(
    first.manifest.geometry.imageryDependencyCoverage
      .routeCoverageRemainsSeparate,
    true,
  );
  assert.equal(first.manifest.coverage.imagerySkeletonDependencies.length, 21);
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

test('v4 adds only actual Cesium OSM skeleton and imagery-parent dependencies', async () => {
  const fixture = await createDeterministicMapStreamingFixture();
  const terrainScheme = new Cesium.GeographicTilingScheme({
    ellipsoid: Cesium.Ellipsoid.WGS84,
  });
  const provider = new Cesium.OpenStreetMapImageryProvider({
    url: 'https://tile.openstreetmap.org/',
  });
  const layer = new Cesium.ImageryLayer(provider);
  const layers = new Cesium.ImageryLayerCollection();
  layers.add(layer);
  const levelZeroError =
    Cesium.TerrainProvider.getEstimatedLevelZeroGeometricErrorForAHeightmap(
      terrainScheme.ellipsoid,
      65,
      terrainScheme.getNumberOfXTilesAtLevel(0),
    );
  const terrainProvider = {
    getLevelMaximumGeometricError(level) {
      return levelZeroError / 2 ** level;
    },
  };
  const dependencies = new Map();
  try {
    for (const { level, tiles: terrainTiles } of fixture.manifest.coverage
      .terrain)
      for (const { x, y } of terrainTiles) {
        const tile = new Cesium.QuadtreeTile({
          x,
          y,
          level,
          tilingScheme: terrainScheme,
        });
        tile.data = { imagery: [] };
        layer._createTileImagerySkeletons(tile, terrainProvider);
        for (const tileImagery of tile.data.imagery)
          for (
            let imagery = tileImagery.loadingImagery;
            imagery;
            imagery = imagery.parent
          ) {
            const identity = {
              level: imagery.level,
              x: imagery.x,
              y: imagery.y,
            };
            dependencies.set(
              `${identity.level}/${identity.x}/${identity.y}`,
              identity,
            );
          }
      }
  } finally {
    layers.destroy();
  }
  const recomputed = [...dependencies.values()].sort(
    (left, right) =>
      left.level - right.level || left.x - right.x || left.y - right.y,
  );
  const routeBboxPaths = new Set(
    fixture.manifest.coverage.imagery.flatMap(({ level, tiles }) =>
      tiles.map(({ x, y }) => `imagery/${level}/${x}/${y}.png`),
    ),
  );
  const expectedSupplementalDependencies = recomputed.filter(
    ({ level, x, y }) => !routeBboxPaths.has(`imagery/${level}/${x}/${y}.png`),
  );
  assert.deepEqual(
    fixture.manifest.coverage.imagerySkeletonDependencies,
    expectedSupplementalDependencies,
  );
  assert.equal(recomputed.length, 38);
  const v3MissingDependencies = expectedSupplementalDependencies.map(
    ({ level, x, y }) => `imagery/${level}/${x}/${y}.png`,
  );
  assert.equal(v3MissingDependencies.length, 21);
  assert.deepEqual(
    v3MissingDependencies
      .map((path) => Number(path.split('/')[1]))
      .reduce(
        (counts, level) => counts.set(level, (counts.get(level) ?? 0) + 1),
        new Map(),
      ),
    new Map([
      [1, 1],
      [2, 1],
      [3, 1],
      [4, 1],
      [5, 1],
      [6, 1],
      [7, 1],
      [8, 2],
      [9, 6],
      [10, 4],
      [11, 2],
    ]),
  );
  for (const path of v3MissingDependencies) {
    assert.ok(
      !routeBboxPaths.has(path),
      `v3 route-only coverage omitted ${path}`,
    );
    assert.ok(fixture.assets.has(path), `v4 materializes ${path}`);
  }

  const routeOnlyV3 = {
    ...fixture,
    id: 'austin-map-streaming-synthetic-v3',
    manifest: {
      ...fixture.manifest,
      schema: 'gev-map-streaming-fixture/v3',
      generatorVersion: '3.0.0',
      assets: fixture.manifest.assets.filter(
        (row) =>
          row.kind !== 'webmercator-imagery-png' ||
          routeBboxPaths.has(row.path),
      ),
    },
  };
  assert.ok(
    v3MissingDependencies.some(
      (path) => !routeOnlyV3.manifest.assets.some((row) => row.path === path),
    ),
    'The v3 route-bbox inventory is missing the actual Cesium dependencies.',
  );
  assert.throws(
    () => validateDeterministicMapStreamingFixture(routeOnlyV3),
    /fixture manifest or asset inventory is invalid/,
    'The live validator does not accept the v3 fixture identity.',
  );

  const invalidMetadata = {
    ...fixture,
    manifest: structuredClone(fixture.manifest),
  };
  invalidMetadata.manifest.coverage.imagerySkeletonDependencies.pop();
  assert.throws(
    () => validateDeterministicMapStreamingFixture(invalidMetadata),
    /native imagery skeleton dependencies are invalid/,
  );

  const unexpectedMetadata = {
    ...fixture,
    manifest: structuredClone(fixture.manifest),
  };
  unexpectedMetadata.manifest.coverage.imagerySkeletonDependencies.push({
    level: 1,
    x: 999,
    y: 999,
  });
  assert.throws(
    () => validateDeterministicMapStreamingFixture(unexpectedMetadata),
    /native imagery skeleton dependencies are invalid/,
  );

  const resealManifest = (subject) => {
    subject.manifest.assetCount = subject.manifest.assets.length;
    subject.manifest.totalBytes = subject.manifest.assets.reduce(
      (sum, row) => sum + subject.assets.get(row.path).length,
      0,
    );
    subject.manifestBytes = Buffer.from(
      `${JSON.stringify(subject.manifest)}\n`,
      'utf8',
    );
    subject.manifestSha256 = digest(subject.manifestBytes);
  };
  const missingDependency = {
    ...fixture,
    assets: new Map(fixture.assets),
    manifest: structuredClone(fixture.manifest),
  };
  const missingPath = v3MissingDependencies[0];
  missingDependency.assets.delete(missingPath);
  missingDependency.manifest.assets = missingDependency.manifest.assets.filter(
    (row) => row.path !== missingPath,
  );
  resealManifest(missingDependency);
  assert.throws(
    () => validateDeterministicMapStreamingFixture(missingDependency),
    /route and dependency imagery inventory is invalid/,
    'Removing a required OSM skeleton image fails even with synchronized counts and manifest digest.',
  );

  const resealedCorruptDependency = {
    ...fixture,
    assets: new Map(fixture.assets),
    manifest: structuredClone(fixture.manifest),
  };
  const corruptRow = resealedCorruptDependency.manifest.assets.find(
    (row) => row.path === missingPath,
  );
  const corruptBytes = Buffer.from(
    resealedCorruptDependency.assets.get(missingPath),
  );
  corruptBytes[corruptBytes.length - 1] ^= 0x01;
  resealedCorruptDependency.assets.set(missingPath, corruptBytes);
  corruptRow.sha256 = digest(corruptBytes);
  resealManifest(resealedCorruptDependency);
  assert.throws(
    () => validateDeterministicMapStreamingFixture(resealedCorruptDependency),
    /route and dependency imagery inventory is invalid/,
    'Rehashing a corrupted dependency image cannot establish authority.',
  );
});

test('canonical 3D Tiles corpus is immutable, bounded, and fail-closed', async () => {
  const fixture = await createDeterministicMapStreamingFixture();
  const rows = fixture.manifest.assets.filter((row) =>
    ['textured-glb', '3d-tiles-1.1'].includes(row.kind),
  );
  assert.equal(fixture.id, 'austin-map-streaming-synthetic-v4');
  assert.equal(fixture.manifest.schema, 'gev-map-streaming-fixture/v4');
  assert.equal(fixture.manifest.generatorVersion, '4.0.0');
  assert.equal(
    MAP_STREAMING_CANONICAL_TILE_ORIGIN.sourceManifestSha256,
    '36eb2997bb092b029a541b810f92d7c19d982010e763129948acb438c18a277f',
  );
  assert.equal(MAP_STREAMING_CANONICAL_TILE_ORIGIN.assetBytes, 66_887);
  assert.equal(rows.length, 22);
  assert.equal(
    rows.reduce((sum, row) => sum + row.byteLength, 0),
    MAP_STREAMING_CANONICAL_TILE_ORIGIN.assetBytes,
  );
  assert.equal(
    fixture.manifestSha256,
    '0d739d9e4830faff2751d40945870eb7b56b9b76dc65e8cd64cb7deb5cb9b033',
  );
  assert.equal(validatePinnedMapTileRows(rows), true);

  const loaded = await loadPinnedMapTilesetAssets();
  assert.equal(loaded.size, rows.length);
  for (const row of rows) {
    const bytes = loaded.get(row.path);
    assert.ok(Buffer.isBuffer(bytes), `${row.path} is loaded as owned bytes`);
    assert.equal(bytes.length, row.byteLength, `${row.path} length is pinned`);
    assert.equal(digest(bytes), row.sha256, `${row.path} digest is pinned`);
    assert.deepEqual(bytes, fixture.assets.get(row.path));
  }

  await assert.rejects(
    loadPinnedMapTilesetAssets({
      readAsset(path) {
        if (path === rows[0].path)
          throw new Error('fixture intentionally absent');
        return fixture.assets.get(path);
      },
    }),
    /Pinned map tile is missing/,
  );
  await assert.rejects(
    loadPinnedMapTilesetAssets({
      readAsset(path) {
        const bytes = Buffer.from(fixture.assets.get(path));
        if (path === rows[0].path) bytes[0] ^= 0xff;
        return bytes;
      },
    }),
    /length\/SHA validation/,
  );
  await assert.rejects(
    loadPinnedMapTilesetAssets({
      readAsset(path) {
        if (path === 'tileset/tileset.json') return Buffer.from('{broken');
        return fixture.assets.get(path);
      },
    }),
    /length\/SHA validation/,
  );

  const recomputedHashIsNotAuthority = {
    ...fixture,
    assets: new Map(fixture.assets),
    manifest: structuredClone(fixture.manifest),
  };
  const canonicalGlb = recomputedHashIsNotAuthority.manifest.assets.find(
    (row) => row.kind === 'textured-glb',
  );
  const alteredGlb = Buffer.from(
    recomputedHashIsNotAuthority.assets.get(canonicalGlb.path),
  );
  alteredGlb[alteredGlb.length - 1] ^= 0xff;
  recomputedHashIsNotAuthority.assets.set(canonicalGlb.path, alteredGlb);
  canonicalGlb.sha256 = digest(alteredGlb);
  assert.throws(
    () =>
      validateDeterministicMapStreamingFixture(recomputedHashIsNotAuthority),
    /identity or metadata mismatch/,
  );

  const wrongIdentity = structuredClone(rows);
  wrongIdentity[0].identity.x += 1;
  assert.throws(
    () => validatePinnedMapTileRows(wrongIdentity),
    /identity or metadata mismatch/,
  );
  const duplicate = [...rows.slice(0, -1), rows[0]];
  assert.throws(
    () => validatePinnedMapTileRows(duplicate),
    /duplicate or invalid identity/,
  );
  const unexpected = rows.map((row) => ({ ...row }));
  unexpected[0].path = 'tiles/level-9/999-999.glb';
  assert.throws(
    () => validatePinnedMapTileRows(unexpected),
    /identity or metadata mismatch/,
  );
  assert.throws(
    () => validatePinnedMapTileRows(rows.slice(1)),
    /row count or inventory/,
  );
  assert.equal(validateDeterministicMapStreamingFixture(fixture), true);
});

test('pinned high-LOD PNG templates preserve every route pixel and identity', async () => {
  const fixture = await createDeterministicMapStreamingFixture();
  const templateRoot = new URL(
    './fixtures/austin-map-streaming-v3/',
    import.meta.url,
  );
  const [indexBytes, corpusBytes] = await Promise.all([
    readFile(new URL('imagery-png-templates.json', templateRoot)),
    readFile(new URL('imagery-png-templates.bin', templateRoot)),
  ]);
  assert.equal(digest(indexBytes), IMAGERY_TEMPLATE_INDEX_SHA256);
  assert.equal(digest(corpusBytes), IMAGERY_TEMPLATE_CORPUS_SHA256);
  const index = JSON.parse(indexBytes.toString('utf8'));
  const templatesBySeed = validatePinnedMapImageryTemplateCorpus(
    indexBytes,
    corpusBytes,
  );
  assert.equal(index.seedCount, 232);
  assert.equal(index.patternCount, 168);
  assert.equal(templatesBySeed.size, 232);
  assert.equal(new Set([...templatesBySeed.values()].map(digest)).size, 168);
  assert.deepEqual(fixture.manifest.imageryTemplateCorpus, {
    schema: index.schema,
    version: index.version,
    indexSha256: IMAGERY_TEMPLATE_INDEX_SHA256,
    corpusSha256: IMAGERY_TEMPLATE_CORPUS_SHA256,
    corpusByteLength: corpusBytes.length,
    seedCount: 232,
    patternCount: 168,
    levels: [13, 14, 15],
    pixelPatternVersion: index.pixelPatternVersion,
  });
  const highRows = fixture.manifest.assets.filter(
    (row) => row.kind === 'webmercator-imagery-png' && row.identity.level >= 13,
  );
  assert.deepEqual(
    [13, 14, 15].map(
      (level) => highRows.filter((row) => row.identity.level === level).length,
    ),
    [30, 108, 368],
  );
  assert.equal(highRows.length, 506);
  for (const row of highRows) {
    const seed =
      seedFromId(
        `imagery/${row.identity.level}/${row.identity.x}/${row.identity.y}`,
      ) & 0xff;
    const bytes = templatesBySeed.get(seed);
    assert.ok(bytes, `${row.path} maps to a pinned seed template`);
    assert.deepEqual(fixture.assets.get(row.path), bytes);
    assert.equal(row.byteLength, bytes.length);
    assert.equal(row.sha256, digest(bytes));
  }

  for (const template of index.templates) {
    const pngBytes = corpusBytes.subarray(
      template.offset,
      template.offset + template.byteLength,
    );
    const { data: decoded, info } = await sharp(pngBytes)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    assert.deepEqual([info.width, info.height, info.channels], [256, 256, 4]);
    const expected = Buffer.alloc(256 * 256 * 4);
    for (let y = 0; y < 256; y += 1)
      for (let x = 0; x < 256; x += 1) {
        const paletteIndex =
          (Math.floor((x + y + template.patternId) / 11) +
            Math.floor(x / 32) * 3 +
            Math.floor(y / 32) * 5) &
          0x0f;
        const color = IMAGERY_PALETTE[paletteIndex];
        const offset = (y * 256 + x) * 4;
        expected[offset] = color[0];
        expected[offset + 1] = color[1];
        expected[offset + 2] = color[2];
        expected[offset + 3] = 255;
      }
    assert.deepEqual(
      decoded,
      expected,
      `template ${template.patternId} pixels`,
    );
  }
  const patternIdsBySeed = new Map(
    index.seedMappings.map(({ seed, patternId }) => [seed, patternId]),
  );
  assert.equal(patternIdsBySeed.size, 232);
  for (const [seed, patternId] of patternIdsBySeed) {
    assert.equal(patternId, seed % 176);
    assert.equal((seed - patternId) % 176, 0);
    assert.ok(
      templatesBySeed.get(seed),
      `Every original low-byte seed ${seed} maps to its decoded pinned pattern.`,
    );
    for (const [x, y] of [
      [0, 0],
      [31, 63],
      [127, 128],
      [255, 255],
    ])
      assert.equal(
        (Math.floor((x + y + seed) / 11) +
          Math.floor(x / 32) * 3 +
          Math.floor(y / 32) * 5) &
          0x0f,
        (Math.floor((x + y + patternId) / 11) +
          Math.floor(x / 32) * 3 +
          Math.floor(y / 32) * 5) &
          0x0f,
        `Seed ${seed} retains its original pixel formula.`,
      );
  }

  assert.ok(
    fixture.manifest.totalBytes +
      fixture.manifestBytes.length +
      indexBytes.length +
      corpusBytes.length <=
      MAP_STREAMING_MAX_BYTES,
    'served assets, manifest, and pinned source templates fit within 5 MiB',
  );
  assert.throws(
    () =>
      validatePinnedMapImageryTemplateCorpus(
        indexBytes,
        corpusBytes.subarray(1),
      ),
    /identity mismatch/,
    'truncated template corpus fails closed',
  );
  const modifiedCorpus = Buffer.from(corpusBytes);
  modifiedCorpus[modifiedCorpus.length - 1] ^= 0x01;
  assert.throws(
    () => validatePinnedMapImageryTemplateCorpus(indexBytes, modifiedCorpus),
    /identity mismatch/,
    'modified template corpus fails closed',
  );
  assert.throws(
    () =>
      validatePinnedMapImageryTemplateCorpus(
        Buffer.concat([indexBytes, Buffer.from([0x20])]),
        corpusBytes,
      ),
    /identity mismatch/,
    'extra index bytes fail closed',
  );

  const sharedPatternRows = highRows.filter(
    (row) => row.sha256 === highRows[0].sha256,
  );
  assert.ok(sharedPatternRows.length > 1);
  const firstTileBytes = fixture.assets.get(sharedPatternRows[0].path);
  const siblingTileBytes = fixture.assets.get(sharedPatternRows[1].path);
  assert.notStrictEqual(firstTileBytes, siblingTileBytes);
  firstTileBytes[firstTileBytes.length - 1] ^= 0x01;
  assert.deepEqual(
    siblingTileBytes,
    templatesBySeed.get(
      seedFromId(
        `imagery/${sharedPatternRows[1].identity.level}/${sharedPatternRows[1].identity.x}/${sharedPatternRows[1].identity.y}`,
      ) & 0xff,
    ),
    'Mutating one served tile cannot alter a sibling or the cached template authority.',
  );
  assert.throws(
    () => validateDeterministicMapStreamingFixture(fixture),
    /SHA-256 mismatch/,
    'The validator checks tile bytes against its independent pinned template inventory.',
  );
  const subsequentFixture = await createDeterministicMapStreamingFixture();
  assert.deepEqual(
    subsequentFixture.assets.get(sharedPatternRows[0].path),
    templatesBySeed.get(
      seedFromId(
        `imagery/${sharedPatternRows[0].identity.level}/${sharedPatternRows[0].identity.x}/${sharedPatternRows[0].identity.y}`,
      ) & 0xff,
    ),
    'A mutable returned fixture cannot poison subsequent materializations.',
  );
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
  const overAssetLimitRows = Array.from({ length: 641 }, (_, index) => ({
    path: `overflow/${index}.bin`,
    kind: 'test-only-overflow',
    identity: { index },
    byteLength: 1,
    sha256: 'a'.repeat(64),
  }));
  assert.throws(
    () =>
      validateDeterministicMapStreamingFixture({
        ...fixture,
        manifest: { ...fixture.manifest, assets: overAssetLimitRows },
        assets: new Map(
          overAssetLimitRows.map((row) => [row.path, Buffer.from([0])]),
        ),
      }),
    /asset inventory is invalid/,
    'The v4 manifest inventory stays within its explicit 640-row cap.',
  );

  const forgedImagery = {
    ...fixture,
    assets: new Map(fixture.assets),
    manifest: structuredClone(fixture.manifest),
  };
  const highRow = forgedImagery.manifest.assets.find(
    (row) =>
      row.kind === 'webmercator-imagery-png' && row.identity.level === 15,
  );
  const forgedBytes = Buffer.from(forgedImagery.assets.get(highRow.path));
  forgedBytes[forgedBytes.length - 1] ^= 0x01;
  forgedImagery.assets.set(highRow.path, forgedBytes);
  highRow.sha256 = digest(forgedBytes);
  forgedImagery.manifestBytes = Buffer.from(
    `${JSON.stringify(forgedImagery.manifest)}\n`,
  );
  forgedImagery.manifestSha256 = digest(forgedImagery.manifestBytes);
  assert.throws(
    () => validateDeterministicMapStreamingFixture(forgedImagery),
    /route and dependency imagery inventory/,
    'A changed high-LOD tile cannot become authoritative by resealing the manifest.',
  );

  const wrongTemplateDescriptor = {
    ...fixture,
    manifest: {
      ...fixture.manifest,
      imageryTemplateCorpus: {
        ...fixture.manifest.imageryTemplateCorpus,
        corpusSha256: 'f'.repeat(64),
      },
    },
  };
  assert.throws(
    () => validateDeterministicMapStreamingFixture(wrongTemplateDescriptor),
    /imagery template descriptor/,
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
  await withFixtureServer(fixture, {}, async (baseUrl, server) => {
    const imageryProvider = new Cesium.UrlTemplateImageryProvider({
      url: `${baseUrl}imagery/{z}/{x}/{y}.png`,
      maximumLevel: 15,
      tileWidth: 256,
      tileHeight: 256,
    });
    assert.equal(imageryProvider.tileWidth, 256);
    assert.equal(imageryProvider.tileHeight, 256);
    assert.equal(imageryProvider.minimumLevel, 0);
    assert.equal(imageryProvider.maximumLevel, 15);
    const arcgisMetadataRow = fixture.manifest.assets.find(
      (row) => row.kind === 'arcgis-mapserver-metadata-json',
    );
    assert.ok(arcgisMetadataRow, 'ArcGIS service metadata must be hash-bound');
    const arcgisServicePath = arcgisMetadataRow.identity.servicePath;
    const nodeImageSeam = installCesiumNodeImageDecodeSeam(baseUrl);
    let arcgisProvider;
    try {
      arcgisProvider = await Cesium.ArcGisMapServerImageryProvider.fromUrl(
        `${baseUrl}${arcgisServicePath}`,
        {
          credit: 'Powered by Esri',
          enablePickFeatures: false,
        },
      );
      await Promise.all(nodeImageSeam.pendingDecodes);
      assert.ok(
        server.observedRequests.some(
          (request) =>
            request.path.replace(/\/$/, '') === arcgisServicePath &&
            request.query === '?f=json',
        ),
        'native ArcGIS provider must retrieve the fixture metadata through its f=json endpoint',
      );
      assert.equal(arcgisProvider.usingPrecachedTiles, true);
      assert.equal(arcgisProvider.tileWidth, 256);
      assert.equal(arcgisProvider.tileHeight, 256);
      assert.equal(arcgisProvider.maximumLevel, 15);
      assert.ok(
        arcgisProvider.tilingScheme instanceof Cesium.WebMercatorTilingScheme,
      );
      assert.equal(arcgisProvider.enablePickFeatures, false);
      const route = fixture.manifest.routeBoundsDegrees;
      assert.deepEqual(
        [
          Cesium.Math.toDegrees(arcgisProvider.rectangle.west),
          Cesium.Math.toDegrees(arcgisProvider.rectangle.south),
          Cesium.Math.toDegrees(arcgisProvider.rectangle.east),
          Cesium.Math.toDegrees(arcgisProvider.rectangle.north),
        ].map((value) => Number(value.toFixed(8))),
        [route.west, route.south, route.east, route.north],
        'native Esri metadata parser must retain the route extent',
      );
      const probeRow = fixture.manifest.assets.find(
        (row) => row.kind === 'arcgis-missing-tile-probe-png',
      );
      assert.ok(
        probeRow,
        'default ArcGIS missing-tile probe must be hash-bound',
      );
      assert.equal(probeRow.identity.intendedAlpha, 0);
      assert.equal(
        probeRow.byteLength,
        fixture.assets.get(probeRow.path).byteLength,
      );
      assert.match(probeRow.sha256, /^[a-f0-9]{64}$/);
      assert.equal(nodeImageSeam.imageRequests.length, 1);
      const probeRequest = new URL(nodeImageSeam.imageRequests[0]);
      const probePath = `${arcgisServicePath}/tile/${probeRow.identity.level}/${probeRow.identity.row}/${probeRow.identity.column}`;
      assert.equal(
        probeRequest.pathname.endsWith(probePath),
        true,
        'default native discard policy must request the declared out-of-route calibration tile',
      );
      assert.equal(probeRequest.search, '');
      assertSuccessfulProbeDecode(
        nodeImageSeam.decodeObservations[0],
        probeRow,
      );
      assert.ok(
        server.observedRequests.some(
          (request) => request.path === probePath && request.query === '',
        ),
        'strict fixture resolver must serve exactly the declared probe path',
      );
      const probePixels = await sharp(fixture.assets.get(probeRow.path))
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      assert.deepEqual(
        [
          probePixels.info.width,
          probePixels.info.height,
          probePixels.info.channels,
        ],
        [256, 256, 4],
      );
      for (let offset = 3; offset < probePixels.data.length; offset += 4)
        assert.equal(
          probePixels.data[offset],
          0,
          'probe PNG must be fully transparent',
        );
      assert.equal(arcgisProvider.tileDiscardPolicy.isReady(), true);
      assert.equal(
        arcgisProvider.tileDiscardPolicy.shouldDiscardImage({
          width: probePixels.info.width,
          height: probePixels.info.height,
          data: new Uint8ClampedArray(probePixels.data),
        }),
        false,
        'transparent default probe must disable missing-tile equality checks',
      );
      const arcgisTile = fixture.manifest.coverage.imagery.at(-1).tiles[0];
      const arcgisTileRow = fixture.manifest.assets.find(
        (row) =>
          row.kind === 'webmercator-imagery-png' &&
          row.identity.level === arcgisTile.level &&
          row.identity.x === arcgisTile.x &&
          row.identity.y === arcgisTile.y,
      );
      const routeImage = await sharp(fixture.assets.get(arcgisTileRow.path))
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      assert.equal(
        arcgisProvider.tileDiscardPolicy.shouldDiscardImage({
          width: routeImage.info.width,
          height: routeImage.info.height,
          data: new Uint8ClampedArray(routeImage.data),
        }),
        false,
        'transparent probe disables tile rejection for native fixture imagery',
      );
    } finally {
      await Promise.allSettled(nodeImageSeam.pendingDecodes);
      nodeImageSeam.restore();
    }
    const arcgisTile = fixture.manifest.coverage.imagery.at(-1).tiles[0];
    const arcgisTileRow = fixture.manifest.assets.find(
      (row) =>
        row.kind === 'webmercator-imagery-png' &&
        row.identity.level === arcgisTile.level &&
        row.identity.x === arcgisTile.x &&
        row.identity.y === arcgisTile.y,
    );
    const originalLoadImage = Cesium.ImageryProvider.loadImage;
    const fetchedArcgisImages = [];
    Cesium.ImageryProvider.loadImage = async (_provider, resource) => {
      const bytes = Buffer.from(await resource.fetchArrayBuffer());
      fetchedArcgisImages.push({ url: resource.url, bytes });
      return bytes;
    };
    let arcgisTileBytes;
    try {
      arcgisTileBytes = await arcgisProvider.requestImage(
        arcgisTile.x,
        arcgisTile.y,
        arcgisTile.level,
      );
    } finally {
      Cesium.ImageryProvider.loadImage = originalLoadImage;
    }
    assert.equal(fetchedArcgisImages.length, 1);
    assert.match(
      fetchedArcgisImages[0].url,
      new RegExp(
        `/MapServer/tile/${arcgisTile.level}/${arcgisTile.y}/${arcgisTile.x}$`,
      ),
      'native ArcGIS requestImage must use the service tile level/row/column path',
    );
    assert.equal(digest(arcgisTileBytes), arcgisTileRow.sha256);
    assert.deepEqual(
      await sharp(arcgisTileBytes)
        .metadata()
        .then(({ width, height }) => [width, height]),
      [256, 256],
    );
    const arcgisBaseUrl = `${baseUrl}${arcgisServicePath}`;
    await assert.rejects(
      new Cesium.Resource({
        url: `${arcgisBaseUrl}?f=json&unexpected=1`,
      }).fetchJson(),
      'ArcGIS resolver must reject extra service query parameters',
    );
    await assert.rejects(
      new Cesium.Resource({
        url: `${baseUrl}arcgis/rest/services/Other/MapServer?f=json`,
      }).fetchJson(),
      'ArcGIS resolver must reject an undeclared MapServer path',
    );
    await assert.rejects(
      new Cesium.Resource({
        url: `${arcgisBaseUrl}/tile/${arcgisTile.level}/${arcgisTile.y}/${arcgisTile.x}?f=json`,
      }).fetchArrayBuffer(),
      'ArcGIS resolver must reject query parameters on tile requests',
    );
    await assert.rejects(
      new Cesium.Resource({
        url: `${arcgisBaseUrl}/tile/${arcgisTile.level}/999999/999999`,
      }).fetchArrayBuffer(),
      'ArcGIS resolver must reject undeclared out-of-corpus tile coordinates',
    );
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
    for (const { level, x, y } of fixture.manifest.coverage
      .imagerySkeletonDependencies)
      imageryAncestors.add(`${level}/${x}/${y}`);
    assert.equal(imageryAncestors.size, imageryRows.length);

    const terrain = await Cesium.CesiumTerrainProvider.fromUrl(
      `${baseUrl}terrain/`,
    );
    const terrainRows = fixture.manifest.assets.filter(
      (row) => row.kind === 'quantized-mesh-1.0',
    );
    const requestedTerrain = new Set();
    const terrainDataByTile = new Map();
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
        terrainDataByTile.set(key, ancestorData);
      }
    assert.equal(requestedTerrain.size, terrainRows.length);

    const routeCameraPositions = [
      [-97.7, 30.27, 25_000],
      [-97.82, 30.2, 25_000],
      [-97.58, 30.34, 25_000],
      [-97.7, 30.27, 12_000],
    ].map((degrees) => Cesium.Cartesian3.fromDegrees(...degrees));
    let sameLevelSeams = 0;
    let commonLodVertices = 0;
    for (const row of terrainRows) {
      const { level, x, y } = row.identity;
      const key = `${level}/${x}/${y}`;
      const data = terrainDataByTile.get(key);
      assert.ok(data, `parsed terrain data must exist for ${key}`);
      const rectangle = terrain.tilingScheme.tileXYToRectangle(x, y, level);
      const sphere = data._boundingSphere;
      const quantized = {
        u: data._uValues,
        v: data._vValues,
        height: data._heightValues,
      };
      assert.equal(quantized.u.length, quantized.v.length);
      assert.equal(quantized.u.length, quantized.height.length);
      const cartesianForVertex = (
        index,
        { skirtDepth = 0, longitudeOffset = 0, latitudeOffset = 0 } = {},
      ) =>
        Cesium.Cartesian3.fromRadians(
          Cesium.Math.lerp(
            rectangle.west,
            rectangle.east,
            quantized.u[index] / 32767,
          ) + longitudeOffset,
          Cesium.Math.lerp(
            rectangle.south,
            rectangle.north,
            quantized.v[index] / 32767,
          ) + latitudeOffset,
          data._minimumHeight +
            (quantized.height[index] / 32767) *
              (data._maximumHeight - data._minimumHeight) -
            skirtDepth,
          Cesium.Ellipsoid.WGS84,
        );
      for (let index = 0; index < quantized.u.length; index += 1) {
        const distance = Cesium.Cartesian3.distance(
          sphere.center,
          cartesianForVertex(index),
        );
        assert.ok(
          distance <= sphere.radius + 0.05,
          `${key} bounding sphere must include quantized vertex ${index}: excess=${distance - sphere.radius}`,
        );
      }
      if (level === 0) {
        const legacyCornerPositions = [];
        for (const longitude of [rectangle.west, rectangle.east])
          for (const latitude of [rectangle.south, rectangle.north])
            for (const height of [data._minimumHeight, data._maximumHeight])
              legacyCornerPositions.push(
                Cesium.Cartesian3.fromRadians(longitude, latitude, height),
              );
        const legacySphere = Cesium.BoundingSphere.fromPoints(
          legacyCornerPositions,
        );
        const legacyOverflow = quantized.u.reduce((count, _, index) => {
          const point = cartesianForVertex(index);
          return (
            count +
            Number(
              Cesium.Cartesian3.distance(legacySphere.center, point) >
                legacySphere.radius + 0.05,
            )
          );
        }, 0);
        assert.ok(
          legacyOverflow > 0,
          'legacy eight-corner terrain sphere must fail the root-vertex negative control',
        );
      }
      const quantizedLongitudes = Array.from(quantized.u, (value) =>
        Cesium.Math.lerp(rectangle.west, rectangle.east, value / 32767),
      );
      const quantizedLatitudes = Array.from(quantized.v, (value) =>
        Cesium.Math.lerp(rectangle.south, rectangle.north, value / 32767),
      );
      assert.ok(
        quantizedLongitudes.every(Number.isFinite) &&
          quantizedLatitudes.every(Number.isFinite),
        `${row.path} decoded UV coordinates must remain floating-point radians`,
      );
      const longitudeOffset =
        (Math.max(...quantizedLongitudes) - Math.min(...quantizedLongitudes)) *
        0.0001;
      const latitudeOffset =
        (Math.max(...quantizedLatitudes) - Math.min(...quantizedLatitudes)) *
        0.0001;
      for (const [
        indices,
        skirtHeight,
        longitudeOffsetForEdge,
        latitudeOffsetForEdge,
      ] of [
        [data._westIndices, data._westSkirtHeight, -longitudeOffset, 0],
        [data._southIndices, data._southSkirtHeight, 0, -latitudeOffset],
        [data._eastIndices, data._eastSkirtHeight, longitudeOffset, 0],
        [data._northIndices, data._northSkirtHeight, 0, latitudeOffset],
      ])
        for (const index of indices) {
          const distance = Cesium.Cartesian3.distance(
            sphere.center,
            cartesianForVertex(index, {
              skirtDepth: skirtHeight,
              longitudeOffset: longitudeOffsetForEdge,
              latitudeOffset: latitudeOffsetForEdge,
            }),
          );
          assert.ok(
            distance <= sphere.radius + 0.05,
            `${key} bounding sphere must include skirt vertex ${index}: excess=${distance - sphere.radius}`,
          );
        }

      const horizon = data._horizonOcclusionPoint;
      assert.ok(
        Cesium.Cartesian3.magnitude(horizon) > 0.5,
        `${key} must have a finite Cesium horizon point rather than the zero sentinel`,
      );
      for (const cameraPosition of routeCameraPositions) {
        const occluder = new Cesium.EllipsoidalOccluder(
          Cesium.Ellipsoid.WGS84,
          cameraPosition,
        );
        assert.equal(
          occluder.isScaledSpacePointVisiblePossiblyUnderEllipsoid(
            horizon,
            data._minimumHeight,
          ),
          true,
          `${key} horizon point must keep Austin route camera from culling the available terrain tile`,
        );
      }
      if (level === 0) {
        const routeCamera = new Cesium.EllipsoidalOccluder(
          Cesium.Ellipsoid.WGS84,
          Cesium.Cartesian3.fromDegrees(-97.7, 30.27, 25_000),
        );
        assert.equal(
          routeCamera.isScaledSpacePointVisiblePossiblyUnderEllipsoid(
            Cesium.Cartesian3.ZERO,
            data._minimumHeight,
          ),
          false,
          'zero horizon fallback must fail the root-tile culling negative control',
        );
      }
    }

    const getTerrainData = (row) =>
      terrainDataByTile.get(
        `${row.identity.level}/${row.identity.x}/${row.identity.y}`,
      );
    const actualTerrainBoundsByLevel = new Map();
    for (const row of terrainRows) {
      const { level, x, y } = row.identity;
      const data = getTerrainData(row);
      const rect = terrain.tilingScheme.tileXYToRectangle(x, y, level);
      const coordinateForVertex = (terrainData, rectangle, index) => ({
        longitude: Cesium.Math.lerp(
          rectangle.west,
          rectangle.east,
          terrainData._uValues[index] / 32767,
        ),
        latitude: Cesium.Math.lerp(
          rectangle.south,
          rectangle.north,
          terrainData._vValues[index] / 32767,
        ),
        quantizedHeight: terrainData._heightValues[index],
      });
      const actualVertexBounds = {
        west: Cesium.Math.toDegrees(
          rect.west +
            (Math.min(...data._uValues) / 32767) * (rect.east - rect.west),
        ),
        east: Cesium.Math.toDegrees(
          rect.west +
            (Math.max(...data._uValues) / 32767) * (rect.east - rect.west),
        ),
        south: Cesium.Math.toDegrees(
          rect.south +
            (Math.min(...data._vValues) / 32767) * (rect.north - rect.south),
        ),
        north: Cesium.Math.toDegrees(
          rect.south +
            (Math.max(...data._vValues) / 32767) * (rect.north - rect.south),
        ),
      };
      const levelBounds = actualTerrainBoundsByLevel.get(level) ?? {
        west: Number.POSITIVE_INFINITY,
        south: Number.POSITIVE_INFINITY,
        east: Number.NEGATIVE_INFINITY,
        north: Number.NEGATIVE_INFINITY,
      };
      levelBounds.west = Math.min(levelBounds.west, actualVertexBounds.west);
      levelBounds.south = Math.min(levelBounds.south, actualVertexBounds.south);
      levelBounds.east = Math.max(levelBounds.east, actualVertexBounds.east);
      levelBounds.north = Math.max(levelBounds.north, actualVertexBounds.north);
      actualTerrainBoundsByLevel.set(level, levelBounds);
      for (const side of ['west', 'south', 'east', 'north'])
        assert.ok(
          Math.abs(
            actualVertexBounds[side] - row.identity.meshBoundsDegrees[side],
          ) < 1e-9,
          `${row.path} manifest must bind actual quantized mesh ${side} bound`,
        );
      const eastNeighbor = terrainRows.find(
        (candidate) =>
          candidate.identity.level === level &&
          candidate.identity.x === x + 1 &&
          candidate.identity.y === y,
      );
      const southNeighbor = terrainRows.find(
        (candidate) =>
          candidate.identity.level === level &&
          candidate.identity.x === x &&
          candidate.identity.y === y + 1,
      );
      for (const [neighbor, direction] of [
        [eastNeighbor, 'east'],
        [southNeighbor, 'south'],
      ]) {
        if (!neighbor) continue;
        const neighborData = getTerrainData(neighbor);
        const [edgeA, edgeB] =
          direction === 'east'
            ? [data._eastIndices, neighborData._westIndices]
            : [data._southIndices, neighborData._northIndices];
        if (edgeA.length === 0 && edgeB.length === 0) continue;
        assert.equal(
          edgeA.length,
          edgeB.length,
          `same-level terrain seam edge inventory must match for ${row.path} and ${neighbor.path}`,
        );
        assert.ok(edgeA.length > 0, 'shared route edge must contain samples');
        sameLevelSeams += 1;
        for (let index = 0; index < edgeA.length; index += 1)
          assert.equal(
            data._heightValues[edgeA[index]],
            neighborData._heightValues[edgeB[index]],
            `same-level terrain seam quantized heights must match for ${row.path} and ${neighbor.path}`,
          );
      }

      if (level === 0) continue;
      const parent = terrainRows.find(
        (candidate) =>
          candidate.identity.level === level - 1 &&
          candidate.identity.x === Math.floor(x / 2) &&
          candidate.identity.y === Math.floor(y / 2),
      );
      assert.ok(parent, `terrain ancestor must exist for ${row.path}`);
      const parentData = getTerrainData(parent);
      const parentRect = terrain.tilingScheme.tileXYToRectangle(
        parent.identity.x,
        parent.identity.y,
        parent.identity.level,
      );
      for (let index = 0; index < data._uValues.length; index += 1) {
        const childPoint = coordinateForVertex(data, rect, index);
        const parentPointIndex = parentData._uValues.findIndex(
          (parentU, parentIndex) => {
            const parentLongitude = Cesium.Math.lerp(
              parentRect.west,
              parentRect.east,
              parentU / 32767,
            );
            const parentLatitude = Cesium.Math.lerp(
              parentRect.south,
              parentRect.north,
              parentData._vValues[parentIndex] / 32767,
            );
            return (
              Math.abs(parentLongitude - childPoint.longitude) < 1e-12 &&
              Math.abs(parentLatitude - childPoint.latitude) < 1e-12
            );
          },
        );
        if (parentPointIndex < 0) continue;
        assert.equal(
          childPoint.quantizedHeight,
          parentData._heightValues[parentPointIndex],
          `coarse/fine identical geographic vertex must agree for ${row.path}`,
        );
        commonLodVertices += 1;
      }
    }
    for (const [level, bounds] of actualTerrainBoundsByLevel) {
      assert.ok(
        bounds.west <= fixture.manifest.routeBoundsDegrees.west &&
          bounds.south <= fixture.manifest.routeBoundsDegrees.south &&
          bounds.east >= fixture.manifest.routeBoundsDegrees.east &&
          bounds.north >= fixture.manifest.routeBoundsDegrees.north,
        `decoded terrain vertices at level ${level} must cover the full declared route: ${JSON.stringify(bounds)}`,
      );
    }
    assert.ok(sameLevelSeams > 0, 'all route levels must check sibling seams');
    assert.ok(
      commonLodVertices > 0,
      'coarse/fine encoded shared vertices must be checked',
    );
    const tile = fixture.manifest.coverage.terrain[8].tiles[0];
    const data = await terrain.requestTileGeometry(tile.x, tile.y, tile.level);
    const sampleHeights = data._heightValues;
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

test('ArcGIS probe proof rejects successful HTTP bytes when image decoding fails', async (t) => {
  const fixture = await createDeterministicMapStreamingFixture();
  const metadataRow = fixture.manifest.assets.find(
    (row) => row.kind === 'arcgis-mapserver-metadata-json',
  );
  const probeRow = fixture.manifest.assets.find(
    (row) => row.kind === 'arcgis-missing-tile-probe-png',
  );
  await withFixtureServer(fixture, {}, async (baseUrl) => {
    const imageSeam = installCesiumNodeImageDecodeSeam(baseUrl, {
      failDecode: true,
    });
    try {
      await Cesium.ArcGisMapServerImageryProvider.fromUrl(
        `${baseUrl}${metadataRow.identity.servicePath}`,
        { enablePickFeatures: false },
      );
      await Promise.allSettled(imageSeam.pendingDecodes);
      assert.equal(imageSeam.decodeObservations.length, 1);
      assert.equal(imageSeam.decodeObservations[0].httpStatus, 200);
      assert.equal(
        imageSeam.decodeObservations[0].responseSha256,
        probeRow.sha256,
      );
      assert.throws(
        () =>
          assertSuccessfulProbeDecode(
            imageSeam.decodeObservations[0],
            probeRow,
          ),
        /did not decode successfully/,
      );
    } finally {
      await Promise.allSettled(imageSeam.pendingDecodes);
      imageSeam.restore();
    }
  });
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
