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
import { fileURLToPath } from 'node:url';
import { applyCesiumPatches } from './apply-cesium-patches.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const INERTIA_MANIFEST = JSON.parse(
  await readFile(
    path.join(ROOT, 'patches/cesium-1.138.0-inertia.json'),
    'utf8',
  ),
);
const COLLISION_MANIFEST = JSON.parse(
  await readFile(
    path.join(ROOT, 'patches/cesium-1.138.0-collision-transform.json'),
    'utf8',
  ),
);

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

async function chainedFixture(t) {
  const f = await fixture(t);
  const second = {
    ...f.manifest,
    files: f.manifest.files.map((entry, index) => {
      const oldText = entry.newText;
      const newText = `final-${index}`;
      return {
        ...entry,
        oldText,
        newText,
        sourceSha256: entry.patchedSha256,
        patchedSha256: digest(newText),
      };
    }),
  };
  const secondPath = path.join(f.root, 'patch-second.json');
  await writeFile(secondPath, JSON.stringify(second));
  return { ...f, second, secondPath };
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

test('applies chained manifests and accepts every intermediate recovery state', async (t) => {
  const f = await chainedFixture(t);
  const options = {
    root: f.root,
    manifestPaths: [f.manifestPath, f.secondPath],
  };
  assert.deepEqual(applyCesiumPatches(options), {
    changed: f.manifest.files.map((entry) => entry.relativePath),
    alreadyPatched: false,
  });
  for (const entry of f.second.files) {
    assert.equal(await readFile(f.target(entry), 'utf8'), entry.newText);
  }
  assert.deepEqual(applyCesiumPatches(options), {
    changed: [],
    alreadyPatched: true,
  });

  const mixed = await chainedFixture(t);
  await writeFile(
    mixed.target(mixed.manifest.files[0]),
    mixed.manifest.files[0].newText,
  );
  await writeFile(
    mixed.target(mixed.manifest.files[1]),
    mixed.second.files[1].newText,
  );
  assert.deepEqual(
    applyCesiumPatches({
      root: mixed.root,
      manifestPaths: [mixed.manifestPath, mixed.secondPath],
    }).changed,
    mixed.manifest.files
      .filter((_, index) => index !== 1)
      .map((entry) => entry.relativePath),
  );
  for (const entry of mixed.second.files) {
    assert.equal(await readFile(mixed.target(entry), 'utf8'), entry.newText);
  }
});

test('a broken later patch chain is rejected before earlier files are written', async (t) => {
  const f = await chainedFixture(t);
  f.second.files.at(-1).sourceSha256 = '0'.repeat(64);
  await writeFile(f.secondPath, JSON.stringify(f.second));
  assert.throws(
    () =>
      applyCesiumPatches({
        root: f.root,
        manifestPaths: [f.manifestPath, f.secondPath],
      }),
    /Broken Cesium patch chain/,
  );
  await assertContents(f);
});

test('default two-patch chain transforms all five real Cesium distributions in an isolated tree', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'gev-cesium-real-chain-'));
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
  const collisionByPath = new Map(
    COLLISION_MANIFEST.files.map((entry) => [entry.relativePath, entry]),
  );
  for (const inertiaEntry of INERTIA_MANIFEST.files) {
    const collisionEntry = collisionByPath.get(inertiaEntry.relativePath);
    assert.ok(collisionEntry);
    let installed = await readFile(
      path.join(ROOT, 'node_modules', inertiaEntry.relativePath),
    );
    if (digest(installed) === collisionEntry.patchedSha256) {
      const text = installed.toString('utf8');
      assert.equal(text.split(collisionEntry.newText).length - 1, 1);
      installed = Buffer.from(
        text.replace(collisionEntry.newText, collisionEntry.oldText),
      );
      assert.equal(digest(installed), collisionEntry.sourceSha256);
    }
    assert.equal(digest(installed), inertiaEntry.patchedSha256);
    const inertiaText = installed.toString('utf8');
    assert.equal(inertiaText.split(inertiaEntry.newText).length - 1, 1);
    const pristine = Buffer.from(
      inertiaText.replace(inertiaEntry.newText, inertiaEntry.oldText),
    );
    assert.equal(digest(pristine), inertiaEntry.sourceSha256);
    const destination = path.join(
      root,
      'node_modules',
      inertiaEntry.relativePath,
    );
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, pristine);
  }

  const result = applyCesiumPatches({ root });
  assert.deepEqual(result, {
    changed: result.changed.sort(),
    alreadyPatched: false,
  });
  for (const entry of COLLISION_MANIFEST.files) {
    assert.equal(
      digest(
        await readFile(path.join(root, 'node_modules', entry.relativePath)),
      ),
      entry.patchedSha256,
    );
  }
  assert.deepEqual(applyCesiumPatches({ root }), {
    changed: [],
    alreadyPatched: true,
  });
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
