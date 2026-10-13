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

test('release verification downloads the exact uploaded artifact ID', async () => {
  const workflow = await readFile(
    new URL('../.github/workflows/release.yml', import.meta.url),
    'utf8',
  );
  const uploadStart = workflow.indexOf(
    '      - name: Upload candidate artifact for verification',
  );
  const guardStart = workflow.indexOf(
    '      - name: Require immutable candidate artifact ID',
  );
  const downloadStart = workflow.indexOf(
    '      - name: Download candidate artifact for verification',
  );
  const verifyStart = workflow.indexOf(
    '      - name: Verify downloaded archive and attestation before publication',
  );

  assert.ok(uploadStart >= 0 && guardStart > uploadStart);
  assert.ok(downloadStart > guardStart && verifyStart > downloadStart);
  const upload = workflow.slice(uploadStart, guardStart);
  const guard = workflow.slice(guardStart, downloadStart);
  const download = workflow.slice(downloadStart, verifyStart);

  assert.match(upload, /id: upload_candidate/);
  assert.match(
    upload,
    /uses: actions\/upload-artifact@[0-9a-f]{40} # v4\.6\.2/,
  );
  assert.match(
    guard,
    /ARTIFACT_ID: \$\{\{ steps\.upload_candidate\.outputs\.artifact-id \}\}/,
  );
  assert.match(guard, /test -n "\$ARTIFACT_ID"/);
  assert.match(guard, /\[\[ "\$ARTIFACT_ID" =~ \^\[1-9\]\[0-9\]\*\$ \]\]/);
  assert.match(
    download,
    /uses: actions\/download-artifact@[0-9a-f]{40} # v4\.3\.0/,
  );
  assert.match(
    download,
    /artifact-ids: \$\{\{ steps\.upload_candidate\.outputs\.artifact-id \}\}/,
  );
  assert.match(download, /merge-multiple: true/);
  assert.doesNotMatch(download, /^\s+name:/m);
  assert.match(workflow, /sha256sum -c "\$\{ARCHIVE_NAME\}\.sha256"/);
  assert.match(workflow, /gh attestation verify "\$ARCHIVE_NAME"/);
  assert.match(workflow, /test "\$\(jq -r \.commit .*\)" = "\$GITHUB_SHA"/);
});

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
    '/* dependency patch applier: cesium-1.138.0-collision-transform.json */',
  );
  await writeFile(
    path.join(root, 'patches', 'cesium-1.138.0-inertia.json'),
    '{"fixture":true}',
  );
  await writeFile(
    path.join(root, 'patches', 'cesium-1.138.0-collision-transform.json'),
    '{"collisionFixture":true}',
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
    11,
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
    'patches/cesium-1.138.0-collision-transform.json',
  ]) {
    assert.deepEqual(
      await readFile(path.join(staged, file)),
      await readFile(path.join(root, file)),
    );
    assert.ok(manifest.artifactFiles.some((entry) => entry.path === file));
  }
  await writeFile(
    path.join(staged, 'patches', 'cesium-1.138.0-collision-transform.json'),
    '{}',
  );
  await assert.rejects(verifyReleaseDirectory(staged), /checksum mismatch/);
});

test('historical packages without dependency hooks remain stageable for recovery', async (t) => {
  const root = await fixture(t);
  const pkgPath = path.join(root, 'package.json');
  const pkg = JSON.parse(await readFile(pkgPath));
  delete pkg.scripts;
  await writeFile(pkgPath, JSON.stringify(pkg));
  await rm(path.join(root, 'scripts', 'apply-cesium-patches.mjs'));
  await rm(path.join(root, 'patches', 'cesium-1.138.0-inertia.json'));
  await stageRelease({ root, out: 'historical', commit: 'prior-supported' });
  const verified = await verifyReleaseDirectory(path.join(root, 'historical'));
  assert.equal(verified.commit, 'prior-supported');
  assert.equal(verified.artifactFiles.length, 8);
});

test('a package declaring the dependency hook cannot omit its applier', async (t) => {
  const root = await fixture(t);
  await rm(path.join(root, 'scripts', 'apply-cesium-patches.mjs'));
  await assert.rejects(stageRelease({ root, out: 'incomplete' }), /ENOENT/);
});

test('a package using collision correction cannot omit its second patch manifest', async (t) => {
  const root = await fixture(t);
  await rm(
    path.join(root, 'patches', 'cesium-1.138.0-collision-transform.json'),
  );
  await assert.rejects(stageRelease({ root, out: 'incomplete' }), /ENOENT/);
});

test('historical inertia-only installers retain their original support files', async (t) => {
  const root = await fixture(t);
  await writeFile(
    path.join(root, 'scripts', 'apply-cesium-patches.mjs'),
    '/* historical inertia-only applier */',
  );
  await rm(
    path.join(root, 'patches', 'cesium-1.138.0-collision-transform.json'),
  );
  await stageRelease({ root, out: 'historical-inertia' });
  const verified = await verifyReleaseDirectory(
    path.join(root, 'historical-inertia'),
  );
  assert.equal(verified.artifactFiles.length, 10);
  assert.ok(
    verified.artifactFiles.some(
      (file) => file.path === 'patches/cesium-1.138.0-inertia.json',
    ),
  );
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
