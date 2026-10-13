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
  const observedRequests = [];
  const server = createServer((request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1');
    const requestPath = decodeURIComponent(url.pathname.slice('/map/'.length));
    observedRequests.push({ path: requestPath, query: url.search });
    const servicePath = 'arcgis/rest/services/World_Imagery/MapServer';
    let assetPath = requestPath;
    if (
      requestPath.replace(/\/$/, '') === servicePath &&
      url.searchParams.get('f') === 'json'
    )
      assetPath = `${servicePath}/metadata.json`;
    else {
      const tileRequest = requestPath.match(
        /^arcgis\/rest\/services\/World_Imagery\/MapServer\/tile\/(\d+)\/(\d+)\/(\d+)$/,
      );
      if (tileRequest)
        assetPath = `imagery/${tileRequest[1]}/${tileRequest[3]}/${tileRequest[2]}.png`;
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

test('map streaming fixture generation is stable, bounded, and route-indexed', async () => {
  const first = await createDeterministicMapStreamingFixture();
  const second = await createDeterministicMapStreamingFixture();
  assert.equal(first.id, MAP_STREAMING_FIXTURE_ID);
  assert.equal(first.manifestSha256, second.manifestSha256);
  assert.deepEqual(first.manifestBytes, second.manifestBytes);
  assert.equal(first.manifest.totalBytes, second.manifest.totalBytes);
  assert.ok(first.manifest.totalBytes < 2 * 1024 * 1024);
  assert.ok(first.manifest.totalBytes <= MAP_STREAMING_MAX_BYTES);
  assert.equal(first.manifest.assetCount, 70);
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
  await withFixtureServer(fixture, {}, async (baseUrl, server) => {
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
    const arcgisMetadataRow = fixture.manifest.assets.find(
      (row) => row.kind === 'arcgis-mapserver-metadata-json',
    );
    assert.ok(arcgisMetadataRow, 'ArcGIS service metadata must be hash-bound');
    const arcgisServicePath = arcgisMetadataRow.identity.servicePath;
    const arcgisProvider = await Cesium.ArcGisMapServerImageryProvider.fromUrl(
      `${baseUrl}${arcgisServicePath}`,
      {
        credit: 'Powered by Esri',
        enablePickFeatures: false,
        tileDiscardPolicy: new Cesium.NeverTileDiscardPolicy(),
      },
    );
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
    assert.equal(arcgisProvider.maximumLevel, 12);
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
