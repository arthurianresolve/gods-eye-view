import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { applyCesiumPatches } from './apply-cesium-patches.mjs';

const digest = (value) => createHash('sha256').update(value).digest('hex');

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'gev-cesium-patch-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const [name, version] of [
    ['cesium', '1.138.0'],
    ['@cesium/engine', '22.3.0'],
  ]) {
    const directory = path.join(root, 'node_modules', name);
    await mkdir(directory, { recursive: true });
    await writeFile(
      path.join(directory, 'package.json'),
      JSON.stringify({ version }),
    );
  }
  const manifest = {
    schemaVersion: 1,
    cesiumVersion: '1.138.0',
    engineVersion: '22.3.0',
    license: 'Apache-2.0',
    files: Array.from({ length: 5 }, (_, index) => {
      const oldText = `stale-${index}`;
      const newText = `corrected-${index}`;
      return {
        relativePath: `cesium/fixture-${index}.js`,
        oldText,
        newText,
        sourceSha256: digest(oldText),
        patchedSha256: digest(newText),
      };
    }),
  };
  const manifestPath = path.join(root, 'patch.json');
  const saveManifest = () => writeFile(manifestPath, JSON.stringify(manifest));
  const target = (entry) => path.join(root, 'node_modules', entry.relativePath);
  for (const entry of manifest.files)
    await writeFile(target(entry), entry.oldText);
  await saveManifest();
  return { root, manifest, manifestPath, saveManifest, target };
}

async function assertContents(f, field = 'oldText') {
  for (const entry of f.manifest.files) {
    assert.equal(await readFile(f.target(entry), 'utf8'), entry[field]);
  }
}

test('patches all validated files and is idempotent without leftover temporary files', async (t) => {
  const f = await fixture(t);
  assert.deepEqual(applyCesiumPatches(f), {
    changed: f.manifest.files.map((entry) => entry.relativePath),
    alreadyPatched: false,
  });
  await assertContents(f, 'newText');
  assert.deepEqual(applyCesiumPatches(f), {
    changed: [],
    alreadyPatched: true,
  });
  await assertContents(f, 'newText');
  assert.equal(
    (await readdir(path.join(f.root, 'node_modules', 'cesium'))).some((name) =>
      name.includes('.gev-patch-'),
    ),
    false,
  );
});

test('recovers a mixed pristine and already-patched installation', async (t) => {
  const f = await fixture(t);
  await writeFile(f.target(f.manifest.files[0]), f.manifest.files[0].newText);
  const result = applyCesiumPatches(f);
  assert.deepEqual(
    result.changed,
    f.manifest.files.slice(1).map((entry) => entry.relativePath),
  );
  await assertContents(f, 'newText');
});

test('an unexpected final file prevents writes to every earlier file', async (t) => {
  const f = await fixture(t);
  const last = f.manifest.files.at(-1);
  await writeFile(f.target(last), 'unexpected upstream update');
  assert.throws(() => applyCesiumPatches(f), /Unexpected Cesium bytes/);
  for (const entry of f.manifest.files.slice(0, -1)) {
    assert.equal(await readFile(f.target(entry), 'utf8'), entry.oldText);
  }
  assert.equal(
    await readFile(f.target(last), 'utf8'),
    'unexpected upstream update',
  );
});

test('a dependency version mismatch prevents all writes', async (t) => {
  const f = await fixture(t);
  await writeFile(
    path.join(f.root, 'node_modules', '@cesium', 'engine', 'package.json'),
    JSON.stringify({ version: '23.0.0' }),
  );
  assert.throws(() => applyCesiumPatches(f), /requires.*22\.3\.0.*23\.0\.0/);
  await assertContents(f);
});

test('a wrong expected output hash prevents all writes', async (t) => {
  const f = await fixture(t);
  f.manifest.files.at(-1).patchedSha256 = '0'.repeat(64);
  await f.saveManifest();
  assert.throws(() => applyCesiumPatches(f), /Patch output hash mismatch/);
  await assertContents(f);
});

test('missing or duplicate replacement anchors are rejected even with a matching input hash', async (t) => {
  for (const text of ['no matching anchor', 'stale-4 stale-4']) {
    const f = await fixture(t);
    const last = f.manifest.files.at(-1);
    last.sourceSha256 = digest(text);
    await writeFile(f.target(last), text);
    await f.saveManifest();
    assert.throws(() => applyCesiumPatches(f), /Expected one patch anchor/);
    for (const entry of f.manifest.files.slice(0, -1)) {
      assert.equal(await readFile(f.target(entry), 'utf8'), entry.oldText);
    }
  }
});

test('manifest rejects incomplete, duplicate, and traversal paths', async (t) => {
  for (const mutate of [
    (manifest) => manifest.files.pop(),
    (manifest) => {
      manifest.files[1].relativePath = manifest.files[0].relativePath;
    },
    (manifest) => {
      manifest.files[0].relativePath = '../outside.js';
    },
  ]) {
    const f = await fixture(t);
    mutate(f.manifest);
    await f.saveManifest();
    assert.throws(
      () => applyCesiumPatches(f),
      /Unsupported or incomplete|Duplicate|Unsafe/,
    );
  }
});
