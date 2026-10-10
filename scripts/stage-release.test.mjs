import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  stageRelease,
  verifyReleaseDirectory,
  parseReleaseArgs,
} from './stage-release.mjs';

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'gev-release-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, 'dist'));
  await mkdir(path.join(root, 'docs'));
  await mkdir(path.join(root, 'scripts'));
  await mkdir(path.join(root, 'patches'));
  await writeFile(path.join(root, 'dist', 'index.html'), '<main>app</main>');
  await writeFile(
    path.join(root, 'package.json'),
    JSON.stringify({
      version: '1.2.3',
      engines: { node: '>=24' },
      scripts: { postinstall: 'node scripts/apply-cesium-patches.mjs' },
    }),
  );
  await writeFile(path.join(root, 'package-lock.json'), '{}');
  for (const file of ['README.md', 'CHANGELOG.md', 'DATA_SOURCES.md'])
    await writeFile(path.join(root, file), file);
  await writeFile(path.join(root, 'docs', 'UPDATE-RECOVERY.md'), '# recovery');
  await writeFile(
    path.join(root, 'scripts', 'verify-release.mjs'),
    '/* verifier */',
  );
  await writeFile(
    path.join(root, 'scripts', 'apply-cesium-patches.mjs'),
    '/* dependency patch applier */',
  );
  await writeFile(
    path.join(root, 'patches', 'cesium-1.138.0-inertia.json'),
    '{"fixture":true}',
  );
  return root;
}

test('release staging creates a verified versioned manifest and refuses replacement', async (t) => {
  const root = await fixture(t);
  const manifest = await stageRelease({
    root,
    out: 'staging',
    channel: 'stable',
    commit: 'abc123',
    env: {
      GITHUB_ACTIONS: 'true',
      GITHUB_REF_TYPE: 'tag',
      GITHUB_REF_NAME: 'v1.2.3',
    },
  });
  assert.equal(manifest.version, '1.2.3');
  assert.equal(manifest.commit, 'abc123');
  assert.equal(
    (await verifyReleaseDirectory(path.join(root, 'staging'))).artifactFiles
      .length,
    10,
  );
  await assert.rejects(
    stageRelease({ root, out: 'staging' }),
    /already exists/,
  );
});

test('release retains and checksums the dependency postinstall support files', async (t) => {
  const root = await fixture(t);
  const manifest = await stageRelease({ root, out: 'staging' });
  const staged = path.join(root, 'staging');
  const pkg = JSON.parse(await readFile(path.join(staged, 'package.json')));
  assert.equal(
    pkg.scripts.postinstall,
    'node scripts/apply-cesium-patches.mjs',
  );
  for (const file of [
    'scripts/apply-cesium-patches.mjs',
    'patches/cesium-1.138.0-inertia.json',
  ]) {
    assert.deepEqual(
      await readFile(path.join(staged, file)),
      await readFile(path.join(root, file)),
    );
    assert.ok(manifest.artifactFiles.some((entry) => entry.path === file));
  }
  await writeFile(
    path.join(staged, 'patches', 'cesium-1.138.0-inertia.json'),
    '{}',
  );
  await assert.rejects(verifyReleaseDirectory(staged), /checksum mismatch/);
});

test('stable staging requires the exact version tag in CI, independently of the host workflow', async (t) => {
  const root = await fixture(t);
  for (const [type, name] of [
    ['branch', 'v1.2.3'],
    ['tag', 'v9.9.9'],
    ['branch', '2/merge'],
  ]) {
    const env = {
      GITHUB_ACTIONS: 'true',
      GITHUB_REF_TYPE: type,
      GITHUB_REF_NAME: name,
    };
    await assert.rejects(
      stageRelease({ root, out: 'rejected', channel: 'stable', env }),
      /Stable tag/,
    );
  }
  assert.throws(
    () =>
      parseReleaseArgs(['--channel', 'stable'], {
        GITHUB_ACTIONS: 'true',
        GITHUB_REF_TYPE: 'branch',
        GITHUB_REF_NAME: 'v1.2.3',
      }),
    /semantic-version tag/,
  );
});

test('release verification catches changed bytes and invalid CLI channel', async (t) => {
  const root = await fixture(t);
  await stageRelease({ root, out: 'staging' });
  await writeFile(path.join(root, 'staging', 'dist', 'index.html'), 'tampered');
  await assert.rejects(
    verifyReleaseDirectory(path.join(root, 'staging')),
    /checksum mismatch/,
  );
  assert.throws(() => parseReleaseArgs(['--channel', 'preview']), /channel/);
});
