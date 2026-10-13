import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ArcGisMapServerImageryProvider,
  Ellipsoid,
  GeographicTilingScheme,
  ImageryLayer,
  ImageryLayerCollection,
  OpenStreetMapImageryProvider,
  QuadtreeTile,
  TerrainProvider,
} from '@cesium/engine';
import Resource from '@cesium/engine/Source/Core/Resource.js';
import { createDeterministicMapStreamingFixture } from '../../../../scripts/performance/mapStreamingFixture.mjs';

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../..',
);
const rawReportPath = process.argv[2];
const outputPath = process.argv[3];
if (!rawReportPath || !outputPath) {
  throw new Error(
    'Usage: node docs/performance-evidence/s47-map-streaming/native-imagery-dependencies-v3/replay.mjs <raw-report.json> <output.json>',
  );
}

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const rawReportBytes = await readFile(rawReportPath);
const rawReport = JSON.parse(rawReportBytes.toString('utf8'));
const baseline = rawReport.variants?.find(
  (variant) => variant.label === 'baseline',
);
const rawDelivery =
  baseline?.failureDetails?.mapStreamingNativeJourney?.delivery;
if (!rawDelivery?.missingAssetPathEvidence) {
  throw new Error('The baseline report has no bounded missing-asset evidence.');
}
const rawMissing = rawDelivery.missingAssetPathEvidence;
const rawKnownMissingPaths = rawMissing.paths.map(({ path: value }) => value);

const fixture = await createDeterministicMapStreamingFixture();
const assetPaths = new Set(
  fixture.manifest.assets.map(({ path: assetPath }) => assetPath),
);
const terrainTiles = fixture.manifest.coverage.terrain.flatMap(
  ({ tiles }) => tiles,
);
const terrainTilingScheme = new GeographicTilingScheme({
  ellipsoid: Ellipsoid.WGS84,
});
const levelZeroError =
  TerrainProvider.getEstimatedLevelZeroGeometricErrorForAHeightmap(
    terrainTilingScheme.ellipsoid,
    65,
    terrainTilingScheme.getNumberOfXTilesAtLevel(0),
  );
const terrainProvider = {
  getLevelMaximumGeometricError(level) {
    return levelZeroError / (1 << level);
  },
};

function enumerateSkeletons(provider) {
  const layer = new ImageryLayer(provider);
  const layers = new ImageryLayerCollection();
  layers.add(layer);
  const targets = [];
  const ancestry = new Map();
  const isBaseLayer = layer.isBaseLayer();
  for (const sourceTile of terrainTiles) {
    const tile = new QuadtreeTile({
      x: sourceTile.x,
      y: sourceTile.y,
      level: sourceTile.level,
      tilingScheme: terrainTilingScheme,
    });
    tile.data = { imagery: [] };
    layer._createTileImagerySkeletons(tile, terrainProvider);
    for (const tileImagery of tile.data.imagery) {
      const chain = [];
      for (
        let imagery = tileImagery.loadingImagery;
        imagery;
        imagery = imagery.parent
      ) {
        const key = `${imagery.level}/${imagery.x}/${imagery.y}`;
        chain.push(key);
        ancestry.set(key, (ancestry.get(key) ?? 0) + 1);
      }
      const target = chain[0];
      targets.push({
        terrain: `${sourceTile.level}/${sourceTile.x}/${sourceTile.y}`,
        target,
        ancestry: chain,
      });
    }
  }
  layers.destroy();
  const allReferences = new Set(ancestry.keys());
  const missingPaths = [...allReferences]
    .map((identity) => `imagery/${identity}.png`)
    .filter((assetPath) => !assetPaths.has(assetPath))
    .sort();
  const missingTargetPaths = [...new Set(targets.map(({ target }) => target))]
    .map((identity) => `imagery/${identity}.png`)
    .filter((assetPath) => !assetPaths.has(assetPath))
    .sort();
  const missingParentPaths = missingPaths.filter(
    (assetPath) => !missingTargetPaths.includes(assetPath),
  );
  return {
    imageryRectangleRadians: {
      west: provider.rectangle.west,
      south: provider.rectangle.south,
      east: provider.rectangle.east,
      north: provider.rectangle.north,
    },
    baseLayer: isBaseLayer,
    targetSkeletonCount: targets.length,
    uniqueTargetCount: new Set(targets.map(({ target }) => target)).size,
    uniqueAncestryReferenceCount: allReferences.size,
    missingTargetPaths,
    missingParentPaths,
    missingAllReferencedPaths: missingPaths,
    knownRawPathsPresent: rawKnownMissingPaths.filter((value) =>
      missingPaths.includes(value),
    ),
    knownRawPathsCount: rawKnownMissingPaths.length,
    reportedUniquePathCount: rawMissing.uniquePathCount,
    reportedOmittedPathCount: rawMissing.omittedPathCount,
    targetExamples: targets.slice(0, 16),
  };
}

const imageryRows = fixture.manifest.assets.filter(({ path: assetPath }) =>
  assetPath.startsWith('imagery/'),
);
const levelByteLengths = Object.fromEntries(
  Array.from({ length: 16 }, (_, level) => {
    const sizes = [
      ...new Set(
        imageryRows
          .filter(({ path: assetPath }) =>
            assetPath.startsWith(`imagery/${level}/`),
          )
          .map(({ byteLength }) => byteLength),
      ),
    ];
    return [level, sizes];
  }),
);
const metadataBytes = fixture.assets.get(
  'arcgis/rest/services/World_Imagery/MapServer/metadata.json',
);
const metadataPath = '/arcgis/rest/services/World_Imagery/MapServer/';
const metadataRequests = [];
const server = createServer((request, response) => {
  const url = new URL(request.url, 'http://127.0.0.1');
  metadataRequests.push({
    method: request.method,
    path: url.pathname,
    query: url.search,
  });
  if (
    request.method === 'GET' &&
    url.pathname === metadataPath &&
    url.searchParams.size === 1 &&
    url.searchParams.get('f') === 'json'
  ) {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(metadataBytes);
    return;
  }
  response.writeHead(404);
  response.end();
});
server.listen(0, '127.0.0.1');
await new Promise((resolve, reject) => {
  server.once('listening', resolve);
  server.once('error', reject);
});
let arcgis;
const originalCreateImage = Resource._Implementations.createImage;
const previousDocument = globalThis.document;
const previousWindow = globalThis.window;
try {
  // ArcGIS metadata construction installs a missing-tile image probe. The probe
  // is irrelevant to skeleton geometry; fail only that image decode in this
  // Node-only replay, where browser image APIs are intentionally unavailable.
  Resource._Implementations.createImage = (
    _request,
    _crossOrigin,
    deferred,
  ) => {
    deferred.reject(new Error('CPU replay does not decode browser images'));
  };
  const { port } = server.address();
  globalThis.window = { location: { href: `http://127.0.0.1:${port}/` } };
  globalThis.document = {
    location: { href: globalThis.window.location.href },
    baseURI: globalThis.window.location.href,
    createElement(name) {
      if (name !== 'a')
        throw new Error(`Unsupported DOM element in CPU replay: ${name}`);
      let href = '';
      const anchor = {};
      Object.defineProperty(anchor, 'href', {
        get() {
          return new URL(href, globalThis.window.location.href).href;
        },
        set(value) {
          href = value;
        },
      });
      Object.defineProperty(anchor, 'host', {
        get() {
          return new URL(anchor.href).host;
        },
      });
      Object.defineProperty(anchor, 'protocol', {
        get() {
          return new URL(anchor.href).protocol;
        },
      });
      return anchor;
    },
  };
  arcgis = await ArcGisMapServerImageryProvider.fromUrl(
    `http://127.0.0.1:${port}/arcgis/rest/services/World_Imagery/MapServer`,
  );
} finally {
  Resource._Implementations.createImage = originalCreateImage;
  if (previousDocument === undefined) delete globalThis.document;
  else globalThis.document = previousDocument;
  if (previousWindow === undefined) delete globalThis.window;
  else globalThis.window = previousWindow;
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
}
const osm = new OpenStreetMapImageryProvider({
  url: 'http://127.0.0.1/imagery/',
});

const cesiumPackage = JSON.parse(
  await readFile(
    path.join(root, 'node_modules/@cesium/engine/package.json'),
    'utf8',
  ),
);
const fileHashes = {};
for (const relativePath of [
  'node_modules/@cesium/engine/Source/Scene/ImageryLayer.js',
  'node_modules/@cesium/engine/Source/Scene/ImageryLayerCollection.js',
  'node_modules/@cesium/engine/Source/Scene/QuadtreeTile.js',
  'node_modules/@cesium/engine/Source/Scene/ArcGisMapServerImageryProvider.js',
  'node_modules/@cesium/engine/Source/Scene/OpenStreetMapImageryProvider.js',
  'node_modules/@cesium/engine/Source/Core/CesiumTerrainProvider.js',
]) {
  fileHashes[relativePath] = sha256(
    await readFile(path.join(root, relativePath)),
  );
}

const osmReplay = enumerateSkeletons(osm);
const arcgisReplay = enumerateSkeletons(arcgis);
const currentBytes = fixture.manifest.totalBytes;
const estimatedAdditionalPaths = osmReplay.missingAllReferencedPaths;
const sizeByPath = Object.fromEntries(
  estimatedAdditionalPaths.map((assetPath) => {
    const level = Number(assetPath.split('/')[1]);
    const sizes = levelByteLengths[level];
    return [assetPath, sizes.length === 1 ? sizes[0] : null];
  }),
);
const additionalBytesKnown = Object.values(sizeByPath).every(
  Number.isSafeInteger,
)
  ? Object.values(sizeByPath).reduce((sum, value) => sum + value, 0)
  : null;
const report = {
  schema: 'gev-map-native-imagery-skeleton-replay/v1',
  scope:
    'CPU-only actual pinned Cesium imagery skeleton and imagery-parent topology; no browser or tile fetches',
  rawReport: {
    sha256: sha256(rawReportBytes),
    byteLength: rawReportBytes.length,
    revision: baseline.revision,
    label: baseline.label,
    reportedErrorObservationCount: rawDelivery.errorObservationCount,
    reportedMissingPathEvidence: rawMissing,
  },
  fixture: {
    id: fixture.id,
    manifestSha256: fixture.manifestSha256,
    assetCount: fixture.manifest.assetCount,
    totalBytes: currentBytes,
    maxBytes: fixture.manifest.maxBytes,
    terrainTileCount: terrainTiles.length,
    imageryAssetCount: imageryRows.length,
    imageryByteLengthsByLevel: levelByteLengths,
  },
  cesium: {
    engineVersion: cesiumPackage.version,
    levelZeroHeightmapWidth: 65,
    terrainTilingScheme:
      'GeographicTilingScheme, WGS84, 2 x level-zero X tiles',
    imagerySkeletonAlgorithm: 'ImageryLayer._createTileImagerySkeletons',
    sourceSha256: fileHashes,
  },
  arcgisMetadataControl: {
    requests: metadataRequests,
    providerRectangleDegrees: {
      west: (arcgisReplay.imageryRectangleRadians.west * 180) / Math.PI,
      south: (arcgisReplay.imageryRectangleRadians.south * 180) / Math.PI,
      east: (arcgisReplay.imageryRectangleRadians.east * 180) / Math.PI,
      north: (arcgisReplay.imageryRectangleRadians.north * 180) / Math.PI,
    },
    ...arcgisReplay,
  },
  osmWorldRectangleReplay: {
    providerRectangleDegrees: {
      west: (osm.rectangle.west * 180) / Math.PI,
      south: (osm.rectangle.south * 180) / Math.PI,
      east: (osm.rectangle.east * 180) / Math.PI,
      north: (osm.rectangle.north * 180) / Math.PI,
    },
    ...osmReplay,
  },
  observedVsReplayed: {
    knownRawPaths: rawKnownMissingPaths,
    knownRawPathsReproducedByOsm: osmReplay.knownRawPathsPresent,
    omittedRawPathExamplesNotRecoverable: rawMissing.omittedPathCount,
  },
  boundedCoverageProjection: {
    missingReferencedPathCountAcrossEveryFixtureTerrainTile:
      estimatedAdditionalPaths.length,
    newAssetCount: estimatedAdditionalPaths.length,
    newAssetsByPath: sizeByPath,
    estimatedAdditionalBytes: additionalBytesKnown,
    projectedManifestBytes:
      additionalBytesKnown === null
        ? null
        : currentBytes + additionalBytesKnown,
    maxAssetCountTarget: 640,
    maxManifestBytes: fixture.manifest.maxBytes,
    perDocumentRequestCapUnchanged: 512,
    assumptions: [
      'The extra path set is the union of actual Cesium imagery skeleton targets and their parent references for every existing quantized-mesh terrain tile.',
      'Every added low-level image is expected to use the same indexed-PNG encoding as existing images at that level; byte projection is exact only where each level has one observed byte length.',
      'The browser report omits three unique missing paths; this replay compares only its eight retained canonical paths.',
    ],
  },
};
await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
process.stdout.write(
  JSON.stringify(
    {
      outputPath,
      rawReportSha256: report.rawReport.sha256,
      fixtureManifestSha256: fixture.manifestSha256,
      osmMissingPathCount: osmReplay.missingAllReferencedPaths.length,
      rawKnownMissingMatched: osmReplay.knownRawPathsPresent.length,
      arcgisMissingPathCount: arcgisReplay.missingAllReferencedPaths.length,
      additionalBytes: additionalBytesKnown,
      projectedManifestBytes:
        report.boundedCoverageProjection.projectedManifestBytes,
    },
    null,
    2,
  ) + '\n',
);
