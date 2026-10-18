import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { brotliDecompressSync, gunzipSync } from 'node:zlib';
import {
  classifyAsset,
  computeContentDigest,
  createAssetManifest,
  createAssetArtifacts,
  computeCesiumDistributionDigest,
  computeCesiumDistributionDigestSync,
  writeAssetArtifacts,
  isCompressibleAsset,
  listAssetFiles,
} from './assetDistribution.js';

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'gev-assets-'));
  await mkdir(path.join(root, 'assets'), { recursive: true });
  await mkdir(path.join(root, 'cesium', '0123456789abcdef'), { recursive: true });
  await writeFile(path.join(root, 'index.html'), '<html></html>');
  await writeFile(path.join(root, 'assets', 'app-deadbeef.js'), 'console.log(1);');
  await writeFile(path.join(root, 'cesium', '0123456789abcdef', 'Cesium.js'), 'patched');
  await writeFile(path.join(root, 'photo.png'), Buffer.from([1, 2, 3]));
  return root;
}

test('asset digest is deterministic and changes when bytes change', async () => {
  const root = await fixture();
  const files = await listAssetFiles(root);
  const first = await computeContentDigest(root, files);
  const second = await computeContentDigest(root, [...files].reverse());
  assert.equal(first, second);
  await writeFile(path.join(root, 'index.html'), '<html>changed</html>');
  assert.notEqual(first, await computeContentDigest(root, files));
});

test('manifest emits deterministic compression metadata and cache classes', async () => {
  const root = await fixture();
  const first = await createAssetManifest(root, { cesiumDigest: '0123456789abcdef' });
  const second = await createAssetManifest(root, { cesiumDigest: '0123456789abcdef' });
  assert.deepEqual(first, second);
  assert.equal(first.assets.find((entry) => entry.path === 'index.html').cache, 'revalidate');
  assert.equal(first.assets.find((entry) => entry.path.startsWith('cesium/')).cache, 'immutable');
  assert.ok(first.assets.find((entry) => entry.path.endsWith('.js')).brotli > 0);
  assert.deepEqual(first.assets.find((entry) => entry.path === 'photo.png').contentEncoding, []);
  assert.equal(isCompressibleAsset('photo.png'), false);
  assert.equal(
    first.assets.find((entry) => entry.path === 'photo.png').contentType,
    'image/png',
  );
  assert.equal(
    classifyAsset('assets/app-deadbeef.js', {
      immutablePaths: new Set(['assets/app-deadbeef.js']),
    }),
    'immutable',
  );
});

test('asset paths reject traversal and absolute names', async () => {
  const root = await fixture();
  await assert.rejects(() => computeContentDigest(root, ['../secret']), /Unsafe asset path/);
  await assert.rejects(() => computeContentDigest(root, ['/secret']), /Unsafe asset path/);
});

test('artifact output includes compressed bytes only for eligible types', async () => {
  const root = await fixture();
  const { artifacts } = await createAssetArtifacts(root);
  assert.ok(Buffer.isBuffer(artifacts.get('index.html').gzip));
  assert.ok(Buffer.isBuffer(artifacts.get('index.html').brotli));
  assert.equal(artifacts.get('photo.png').gzip, null);
  assert.equal(artifacts.get('photo.png').brotli, null);
});

test('sync and async Cesium digests agree and emitted sidecars round-trip', async () => {
  const root = await fixture();
  const sync = computeCesiumDistributionDigestSync({
    root,
    distributionRoot: path.join('cesium', '0123456789abcdef'),
  });
  const asyncDigest = await computeCesiumDistributionDigest({
    root,
    distributionRoot: path.join('cesium', '0123456789abcdef'),
  });
  assert.deepEqual(sync, asyncDigest);
  const output = await writeAssetArtifacts(root, {
    cesiumDigest: '0123456789abcdef',
    immutablePaths: new Set(['assets/app-deadbeef.js']),
    brotliQuality: 4,
  });
  const manifest = JSON.parse(await readFile(path.join(root, 'asset-manifest.json'), 'utf8'));
  assert.deepEqual(manifest.sidecars, output.sidecars);
  const raw = await readFile(path.join(root, 'index.html'));
  assert.deepEqual(gunzipSync(await readFile(path.join(root, 'index.html.gz'))), raw);
  assert.deepEqual(brotliDecompressSync(await readFile(path.join(root, 'index.html.br'))), raw);
  assert.ok(output.sidecars.includes('index.html.br'));
  await rm(root, { recursive: true, force: true });
});

test('missing Cesium distribution and symlinked assets fail clearly', async () => {
  const root = await fixture();
  await assert.rejects(
    () => computeCesiumDistributionDigest({ root, distributionRoot: 'missing' }),
  );
  const link = path.join(root, 'link.js');
  try {
    const { symlink } = await import('node:fs/promises');
    await symlink(path.join(root, 'index.html'), link);
    await assert.rejects(() => listAssetFiles(root), /Symlinked asset/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
