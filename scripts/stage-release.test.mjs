import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  stageRelease,
  verifyReleaseDirectory,
  parseReleaseArgs,
} from './stage-release.mjs';
import {
  requestCandidateArtifactMetadata,
  validateCandidateArchiveEntries,
  validateCandidateArtifactMetadata,
  validateCandidateArtifactZip,
} from './download-candidate-artifact.mjs';

test('release verification downloads by REST artifact ID and keeps inner verification', async () => {
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
  assert.match(workflow, /^      actions: read$/m);
  assert.match(
    download,
    /ARTIFACT_ID: \$\{\{ steps\.upload_candidate\.outputs\.artifact-id \}\}/,
  );
  assert.match(
    download,
    /UPLOAD_ARTIFACT_DIGEST: \$\{\{ steps\.upload_candidate\.outputs\.artifact-digest \}\}/,
  );
  assert.match(
    download,
    /EXPECTED_SOURCE_COMMIT: \$\{\{ github\.event\.pull_request\.head\.sha \|\| github\.sha \}\}/,
  );
  assert.match(
    download,
    /node scripts\/download-candidate-artifact\.mjs --out downloaded-release/,
  );
  assert.doesNotMatch(download, /actions\/download-artifact|artifact-ids:/);
  assert.match(workflow, /downloaded-release\/artifact-rest-metadata\.json/);
  assert.match(workflow, /scripts\/download-candidate-artifact\.mjs/);
  assert.match(workflow, /sha256sum -c "\$\{ARCHIVE_NAME\}\.sha256"/);
  assert.match(workflow, /gh attestation verify "\$ARCHIVE_NAME"/);
  assert.match(workflow, /test "\$\(jq -r \.commit .*\)" = "\$GITHUB_SHA"/);
});

const sourceCommit = 'a'.repeat(40);
const candidateCommit = 'b'.repeat(40);
const zipBytes = Buffer.from('exact uploaded artifact ZIP bytes');
const artifactDigest = `sha256:${createHash('sha256').update(zipBytes).digest('hex')}`;
const uploadArtifactDigest = createHash('sha256')
  .update(zipBytes)
  .digest('hex');
const expectedArtifact = {
  artifactId: '11837328637',
  runId: '38444888716',
  repositoryId: '1362432886',
  sourceCommit,
  candidateCommit,
  artifactName: `gev-candidate-${candidateCommit}`,
  uploadDigest: uploadArtifactDigest,
};

function candidateMetadata(overrides = {}) {
  return {
    id: Number(expectedArtifact.artifactId),
    name: expectedArtifact.artifactName,
    size_in_bytes: zipBytes.length,
    expired: false,
    digest: artifactDigest,
    workflow_run: {
      id: Number(expectedArtifact.runId),
      repository_id: Number(expectedArtifact.repositoryId),
      head_repository_id: Number(expectedArtifact.repositoryId),
      head_sha: sourceCommit,
    },
    ...overrides,
  };
}

test('artifact metadata transport and malformed bodies fail distinctly without disclosing stderr', () => {
  let calls = 0;
  const expected = candidateMetadata();
  const actual = requestCandidateArtifactMetadata('owner/repository', 123, {
    run(binary, args, options) {
      calls += 1;
      assert.equal(binary, 'gh');
      assert.deepEqual(args, [
        'api',
        'repos/owner/repository/actions/artifacts/123',
      ]);
      assert.deepEqual(options.stdio, ['ignore', 'pipe', 'pipe']);
      assert.equal(options.maxBuffer, 1024 * 1024);
      return JSON.stringify(expected);
    },
  });
  assert.deepEqual(actual, expected);
  assert.equal(calls, 1);

  for (const stderr of [
    'gh: private body token-secret (HTTP 404) https://private.example/?secret=x',
    Buffer.from('gh: private body token-secret (HTTP 404)'),
  ]) {
    calls = 0;
    assert.throws(
      () =>
        requestCandidateArtifactMetadata('owner/repository', 123, {
          run() {
            calls += 1;
            throw Object.assign(new Error('secret process command'), {
              status: 1,
              stderr,
            });
          },
        }),
      (error) => {
        assert.equal(
          error.message,
          'GitHub artifact metadata request failed (HTTP 404; exit 1; process unknown).',
        );
        assert.doesNotMatch(JSON.stringify(error), /secret|private/);
        return true;
      },
    );
    assert.equal(calls, 1, 'diagnostics must not silently retry requests');
  }
  assert.throws(
    () =>
      requestCandidateArtifactMetadata('owner/repository', 123, {
        run() {
          throw Object.assign(new Error('private executable path'), {
            code: 'ENOENT',
            stderr: 'secret',
          });
        },
      }),
    /HTTP unknown; exit unknown; process ENOENT/,
  );
  assert.throws(
    () =>
      requestCandidateArtifactMetadata('owner/repository', 123, {
        run() {
          return '<html>private response token-secret</html>';
        },
      }),
    (error) => {
      assert.equal(
        error.message,
        'GitHub artifact metadata response is not valid JSON.',
      );
      return true;
    },
  );
});

test('candidate REST metadata binds artifact ID, run, repository, name, source and both upload digests', () => {
  const verified = validateCandidateArtifactMetadata(
    candidateMetadata(),
    expectedArtifact,
  );
  assert.equal(verified.artifactId, 11837328637);
  assert.equal(verified.runId, 38444888716);
  assert.equal(verified.sourceCommit, sourceCommit);
  assert.notEqual(verified.sourceCommit, candidateCommit);

  const wrongRun = candidateMetadata();
  wrongRun.workflow_run.id += 1;
  const wrongRepository = candidateMetadata();
  wrongRepository.workflow_run.repository_id += 1;
  const wrongHeadRepository = candidateMetadata();
  wrongHeadRepository.workflow_run.head_repository_id += 1;
  const wrongSource = candidateMetadata();
  wrongSource.workflow_run.head_sha = candidateCommit;
  const wrongDigest = candidateMetadata({ digest: 'sha256:' + 'c'.repeat(64) });
  const expired = candidateMetadata({ expired: true });
  const wrongName = candidateMetadata({
    name: 'gev-candidate-' + sourceCommit,
  });
  const cases = [
    [candidateMetadata({ id: 1 }), 'uploaded ID'],
    [wrongRun, 'workflow run'],
    [wrongRepository, 'repository'],
    [wrongHeadRepository, 'repository'],
    [wrongSource, 'source commit'],
    [wrongDigest, 'digests'],
    [expired, 'expired'],
    [wrongName, 'name'],
  ];
  for (const [metadata, message] of cases)
    assert.throws(
      () => validateCandidateArtifactMetadata(metadata, expectedArtifact),
      new RegExp(message, 'i'),
    );
  assert.throws(
    () =>
      validateCandidateArtifactMetadata(candidateMetadata(), {
        ...expectedArtifact,
        artifactId: '0',
      }),
    /positive integer/,
  );
  assert.throws(
    () =>
      validateCandidateArtifactMetadata(candidateMetadata(), {
        ...expectedArtifact,
        uploadDigest: 'sha256:' + uploadArtifactDigest,
      }),
    /raw SHA-256/,
  );
  assert.throws(
    () =>
      validateCandidateArtifactMetadata(candidateMetadata(), {
        ...expectedArtifact,
        artifactName: `gev-candidate-${sourceCommit}`,
      }),
    /does not match this candidate/,
  );
});

test('REST ZIP bytes must match upload and metadata digests and exact archive size', () => {
  const digest = validateCandidateArtifactZip({
    metadataSize: zipBytes.length,
    metadataDigest: artifactDigest,
    uploadDigest: uploadArtifactDigest,
    zipBytes,
  });
  assert.equal(digest, artifactDigest.slice('sha256:'.length));
  assert.throws(
    () =>
      validateCandidateArtifactZip({
        metadataSize: zipBytes.length + 1,
        metadataDigest: artifactDigest,
        uploadDigest: uploadArtifactDigest,
        zipBytes,
      }),
    /size differs/,
  );
  assert.throws(
    () =>
      validateCandidateArtifactZip({
        metadataSize: zipBytes.length,
        metadataDigest: artifactDigest,
        uploadDigest: 'd'.repeat(64),
        zipBytes,
      }),
    /digests do not match/,
  );
  assert.throws(
    () =>
      validateCandidateArtifactZip({
        metadataSize: Buffer.byteLength('mutated archive'),
        metadataDigest: artifactDigest,
        uploadDigest: uploadArtifactDigest,
        zipBytes: Buffer.from('mutated archive'),
      }),
    /digest differs/,
  );
  assert.throws(
    () =>
      validateCandidateArtifactZip({
        metadataSize: zipBytes.length,
        metadataDigest: 'sha256:invalid',
        uploadDigest: uploadArtifactDigest,
        zipBytes,
      }),
    /sha256 digest/,
  );
});

test('candidate ZIP accepts only the two exact flat filenames', () => {
  const archiveName = `gods-eye-view-${candidateCommit}.tar.gz`;
  assert.deepEqual(
    validateCandidateArchiveEntries(
      [`${archiveName}.sha256`, archiveName],
      archiveName,
    ),
    [archiveName, `${archiveName}.sha256`],
  );
  for (const entries of [
    [archiveName],
    [archiveName, `${archiveName}.sha256`, 'unexpected.txt'],
    [archiveName, `${archiveName}.sha256`, `${archiveName}.sha256`],
    [`nested/${archiveName}`, `${archiveName}.sha256`],
    [`../${archiveName}`, `${archiveName}.sha256`],
  ])
    assert.throws(
      () => validateCandidateArchiveEntries(entries, archiveName),
      /only the candidate archive and checksum/,
    );
  assert.throws(
    () => validateCandidateArchiveEntries([], 'candidate.zip'),
    /archive name is invalid/,
  );
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

test('production releases include provider support imports and omit source tests', async (t) => {
  const root = await fixture(t);
  const pkgPath = path.join(root, 'package.json');
  const pkg = JSON.parse(await readFile(pkgPath));
  pkg.scripts.start = 'node server/production/host.js';
  await writeFile(pkgPath, JSON.stringify(pkg));
  const runtimeFiles = [
    'server/production/host.js',
    'src/providerData.json',
    'build/securityHeaders.js',
    'build/allowedHosts.js',
    'build/embed-framing.js',
    'scripts/pinokio-environment.mjs',
    'scripts/google-server-key.mjs',
  ];
  for (const file of [...runtimeFiles, 'src/not-runtime.test.mjs']) {
    await mkdir(path.dirname(path.join(root, file)), { recursive: true });
    await writeFile(path.join(root, file), '{}');
  }
  const manifest = await stageRelease({ root, out: 'production' });
  for (const file of runtimeFiles)
    assert.ok(
      manifest.artifactFiles.some((entry) => entry.path === file),
      file,
    );
  assert.equal(
    manifest.artifactFiles.some((entry) => entry.path.endsWith('.test.mjs')),
    false,
  );
  await verifyReleaseDirectory(path.join(root, 'production'));
  await rm(path.join(root, 'scripts', 'google-server-key.mjs'));
  await assert.rejects(
    stageRelease({ root, out: 'incomplete-production' }),
    /ENOENT/,
  );
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
