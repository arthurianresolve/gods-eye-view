import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../../..');
const sourceWorkerRoot = path.join(
  root,
  'node_modules/@cesium/engine/Source/Workers',
);
const bundledWorkerRoot = path.join(
  root,
  'node_modules/cesium/Build/Cesium/Workers',
);
const workerNames = [
  'createVerticesFromQuantizedTerrainMesh',
  'upsampleQuantizedTerrainMesh',
];
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

async function hashWorkers(workerRoot) {
  const hashes = {};
  for (const name of workerNames) {
    const source = await readFile(path.join(workerRoot, `${name}.js`));
    hashes[`${name}.js`] = {
      byteLength: source.byteLength,
      sha256: sha256(source),
    };
  }
  return hashes;
}

if (process.env.GEV_TERRAIN_CHAIN_MODE) {
  const mode = process.env.GEV_TERRAIN_CHAIN_MODE;
  const [{ default: Cesium }, { createDeterministicMapStreamingFixture }] =
    await Promise.all([
      import('cesium').then((module) => ({ default: module })),
      import(
        pathToFileURL(
          path.join(root, 'scripts/performance/mapStreamingFixture.mjs'),
        )
      ),
    ]);
  const fixture = await createDeterministicMapStreamingFixture();
  const workerRoot = mode === 'source' ? sourceWorkerRoot : bundledWorkerRoot;
  const handlers = new Map();
  for (const name of workerNames) {
    globalThis.self = {};
    await import(pathToFileURL(path.join(workerRoot, `${name}.js`)).href);
    handlers.set(name, globalThis.self.onmessage);
  }
  let workerReply;
  globalThis.postMessage = (reply) => {
    workerReply = structuredClone(reply);
  };
  Cesium.TaskProcessor.prototype.scheduleTask = async function (parameters) {
    const handler = handlers.get(this._workerPath);
    if (!handler)
      throw new Error(`Unexpected terrain worker ${this._workerPath}`);
    workerReply = null;
    await handler({
      data: {
        id: 1,
        parameters: structuredClone(parameters),
        canTransferArrayBuffer: false,
      },
    });
    if (workerReply?.error)
      throw new Error(workerReply.error.message || String(workerReply.error));
    if (!workerReply?.result)
      throw new Error(`Worker ${this._workerPath} returned no result`);
    return structuredClone(workerReply.result);
  };
  const assetPath = 'terrain/10/468/684.terrain';
  const asset = fixture.assets.get(assetPath);
  const metadataAsset = fixture.assets.get('terrain/layer.json');
  if (!asset || !metadataAsset)
    throw new Error(
      `Missing expected fixture asset ${assetPath} or layer.json`,
    );
  const fixtureBytes = Buffer.from(asset.bytes || asset);
  const metadataBytes = Buffer.from(metadataAsset.bytes || metadataAsset);
  const baseUrl = 'http://fixture.invalid/terrain/';
  const nativeResource = Cesium.Resource.prototype;
  const originalFetchJson = nativeResource.fetchJson;
  const originalFetchArrayBuffer = nativeResource.fetchArrayBuffer;
  const resolveBytes = (resource) => {
    const requestPath = new URL(resource.url).pathname.slice(1);
    if (requestPath === 'terrain/layer.json') return metadataBytes;
    if (requestPath !== assetPath)
      throw new Error(`Unexpected terrain fixture request ${requestPath}`);
    return fixtureBytes;
  };
  nativeResource.fetchJson = function () {
    return Promise.resolve(JSON.parse(resolveBytes(this).toString('utf8')));
  };
  nativeResource.fetchArrayBuffer = function () {
    const bytes = resolveBytes(this);
    return Promise.resolve(
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    );
  };
  try {
    const terrain = await Cesium.CesiumTerrainProvider.fromUrl(baseUrl);
    let data = await terrain.requestTileGeometry(468, 339, 10);
    const reports = [];
    const sample = { x: 59940, y: 43502, level: 17 };
    for (let level = 10; level <= sample.level; level += 1) {
      const shift = sample.level - level;
      const x = Math.floor(sample.x / 2 ** shift);
      const y = Math.floor(sample.y / 2 ** shift);
      if (level > 10) {
        const previous = reports.at(-1);
        data = await previous.data.upsample(
          terrain.tilingScheme,
          previous.x,
          previous.y,
          previous.level,
          x,
          y,
          level,
        );
      }
      const quantizedVertexCount = data._quantizedVertices?.length / 3;
      const mesh = await data.createMesh({
        tilingScheme: terrain.tilingScheme,
        x,
        y,
        level,
      });
      reports.push({
        x,
        y,
        level,
        data,
        availability: terrain.getTileDataAvailable(x, y, level),
        quantizedVertexCount,
        meshVertexCount: mesh.vertexCountWithoutSkirts,
        indexCount: mesh.indices.length,
        minHeight: data._minimumHeight,
        maxHeight: data._maximumHeight,
        horizonPointFinite: [
          data._horizonOcclusionPoint?.x,
          data._horizonOcclusionPoint?.y,
          data._horizonOcclusionPoint?.z,
        ].every(Number.isFinite),
      });
    }
    console.log(
      JSON.stringify({
        mode,
        workerArtifactPath:
          mode === 'source'
            ? 'node_modules/@cesium/engine/Source/Workers'
            : 'node_modules/cesium/Build/Cesium/Workers (copied by production vite-plugin-cesium configuration)',
        fixtureId: fixture.id,
        fixtureManifestSha256: fixture.manifestSha256,
        fixtureTerrainAsset: {
          path: assetPath,
          byteLength: fixtureBytes.byteLength,
          sha256: sha256(fixtureBytes),
        },
        fixtureTerrainMetadata: {
          path: 'terrain/layer.json',
          byteLength: metadataBytes.byteLength,
          sha256: sha256(metadataBytes),
        },
        workers: await hashWorkers(workerRoot),
        requestedSample: sample,
        rows: reports.map(({ data: _data, ...row }) => row),
        structuredClonePerTask: true,
        workerScope:
          'CPU worker handler invocation through an isolated TaskProcessor.scheduleTask seam; not browser Worker transport',
      }),
    );
  } finally {
    nativeResource.fetchJson = originalFetchJson;
    nativeResource.fetchArrayBuffer = originalFetchArrayBuffer;
  }
  process.exit(0);
}

const loader = `export async function load(url, context, nextLoad) {
  if (url.includes('/Build/Cesium/Workers/') && url.endsWith('.js')) {
    return nextLoad(url, { ...context, format: 'module' });
  }
  return nextLoad(url, context);
}`;
const loaderUrl = `data:text/javascript,${encodeURIComponent(loader)}`;
const cases = [];
for (const mode of ['source', 'bundled']) {
  const args = [
    ...(mode === 'bundled' ? ['--experimental-loader', loaderUrl] : []),
    fileURLToPath(import.meta.url),
  ];
  const result = spawnSync(process.execPath, args, {
    cwd: root,
    env: { ...process.env, GEV_TERRAIN_CHAIN_MODE: mode },
    encoding: 'utf8',
    windowsHide: true,
    timeout: 30_000,
    maxBuffer: 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error(`${mode} worker probe failed: ${result.stderr}`);
  cases.push(JSON.parse(result.stdout));
}
const [source, bundled] = cases;
if (JSON.stringify(source.rows) !== JSON.stringify(bundled.rows))
  throw new Error('Source and bundled worker chain results differ.');
for (const field of [
  'fixtureId',
  'fixtureManifestSha256',
  'fixtureTerrainAsset',
  'fixtureTerrainMetadata',
  'requestedSample',
]) {
  if (JSON.stringify(source[field]) !== JSON.stringify(bundled[field]))
    throw new Error(`Source and bundled probe ${field} differs.`);
}
const artifact = {
  schema: 'gev-map-terrain-ancestry-chain-probe/v1',
  generatedAt: new Date().toISOString(),
  cesiumVersion: '1.138.0',
  sourceWorkerArtifactPath: source.workerArtifactPath,
  bundledWorkerArtifactPath: bundled.workerArtifactPath,
  fixtureId: source.fixtureId,
  fixtureManifestSha256: source.fixtureManifestSha256,
  fixtureTerrainAsset: source.fixtureTerrainAsset,
  fixtureTerrainMetadata: source.fixtureTerrainMetadata,
  target: source.requestedSample,
  sourceWorkerHashes: source.workers,
  bundledWorkerHashes: bundled.workers,
  sourceRows: source.rows,
  bundledRows: bundled.rows,
  rowsMatch: true,
  scope:
    'Source and minified production worker handlers run as CPU functions with structuredClone inputs/outputs and a scoped TaskProcessor.scheduleTask seam. This does not exercise browser Worker transport, WebGL, or rendering.',
};
const outputPath = path.join(here, 'terrain-chain-probe.json');
await (
  await import('node:fs/promises')
).writeFile(outputPath, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8');
console.log(`Wrote ${path.relative(root, outputPath)}`);
