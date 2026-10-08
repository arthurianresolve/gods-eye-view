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
  await writeFile(path.join(root, 'dist', 'index.html'), '<main>app</main>');
  await writeFile(
    path.join(root, 'package.json'),
    JSON.stringify({ version: '1.2.3', engines: { node: '>=24' } }),
  );
  await writeFile(path.join(root, 'package-lock.json'), '{}');
  for (const file of ['README.md', 'CHANGELOG.md', 'DATA_SOURCES.md'])
    await writeFile(path.join(root, file), file);
  await writeFile(path.join(root, 'docs', 'UPDATE-RECOVERY.md'), '# recovery');
  await writeFile(
    path.join(root, 'scripts', 'verify-release.mjs'),
    '/* verifier */',
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
  });
  assert.equal(manifest.version, '1.2.3');
  assert.equal(manifest.commit, 'abc123');
  assert.equal(
    (await verifyReleaseDirectory(path.join(root, 'staging'))).artifactFiles
      .length,
    8,
  );
  await assert.rejects(
    stageRelease({ root, out: 'staging' }),
    /already exists/,
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
