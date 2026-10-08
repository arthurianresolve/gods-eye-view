#!/usr/bin/env node
import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  writeFile,
  copyFile,
} from 'node:fs/promises';
import os from 'node:os';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { stageRelease, verifyReleaseDirectory } from './stage-release.mjs';
import {
  exportWorkspaceBundle,
  parseWorkspaceBundle,
} from '../src/workspaces/portable.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createWorkspaceDocument,
  parseWorkspaceDocument,
} from '../src/workspaces/document.js';

/**
 * Verify staged releases, interrupted copies and failed-checksum recovery against
 * an actual version-1 portable workspace bundle. Platform install and updater
 * execution are separate CI steps; browser-profile persistence has its own gate.
 */
export async function runInstallRecoveryFixture({
  platform = process.platform,
  root = null,
} = {}) {
  const profile =
    root || (await mkdtemp(path.join(os.tmpdir(), 'gev-recovery-')));
  const workspacePath = path.join(profile, 'workspace.json');
  const settingsPath = path.join(profile, 'settings.json');
  const assetsPath = path.join(profile, 'assets', 'brief.txt');
  await mkdir(path.dirname(assetsPath), { recursive: true });
  const workspace = createWorkspaceDocument({
    id: 'recovery-fixture',
    title: 'Recovery fixture',
    createdAt: 1_000,
    updatedAt: 2_000,
    view: { camera: { lat: 25, lon: 121, altitude_m: 100_000 }, layers: [] },
    filters: {},
    pinnedEvidence: [
      {
        id: 'reference',
        sourceId: 'fixture',
        capturedAt: 1_500,
        record: {
          evidence: {
            references: [
              {
                kind: 'archive',
                url: 'https://web.archive.org/web/20260101000000/https://example.test',
                originalUrl: 'https://example.test',
                archiveAt: 1_767_225_600_000,
                lookedUpAt: 1_767_225_601_000,
              },
            ],
          },
        },
      },
    ],
    annotations: [],
    assetRefs: [
      {
        id: 'brief.txt',
        sha256: createHash('sha256')
          .update('persisted investigation note\n')
          .digest('hex'),
        byteLength: Buffer.byteLength('persisted investigation note\n'),
      },
    ],
  });
  await writeFile(workspacePath, JSON.stringify(workspace));
  await writeFile(
    settingsPath,
    JSON.stringify({ theme: 'cyber', quality: 'auto' }),
  );
  await writeFile(assetsPath, 'persisted investigation note\n');

  const assertPreserved = async (label) => {
    const parsed = parseWorkspaceDocument(
      await readFile(workspacePath, 'utf8'),
    );
    if (
      parsed.pinnedEvidence[0].record.evidence.references[0].kind !== 'archive'
    )
      throw new Error(`${label}: archived reference was not preserved`);
    if ((await readFile(settingsPath, 'utf8')).includes('cyber') === false)
      throw new Error(`${label}: settings were not preserved`);
    if (
      (await readFile(assetsPath, 'utf8')).trim() !==
      'persisted investigation note'
    )
      throw new Error(`${label}: workspace asset was not preserved`);
  };

  const bundle = await exportWorkspaceBundle({
    document: workspace,
    chunks: {},
    assets: {
      'brief.txt': new TextEncoder().encode('persisted investigation note\n'),
    },
  });
  const bundlePath = path.join(
    profile,
    'previous-workspace.gev-workspace.json',
  );
  await writeFile(bundlePath, bundle);
  // A small fixture build exercises the real staging and checksum code, without
  // pretending to install a package manager or storing browser data in app files.
  const source = path.join(profile, 'application');
  await mkdir(path.join(source, 'dist'), { recursive: true });
  const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  for (const file of [
    'package.json',
    'package-lock.json',
    'README.md',
    'CHANGELOG.md',
    'DATA_SOURCES.md',
    'docs/UPDATE-RECOVERY.md',
    'scripts/verify-release.mjs',
  ]) {
    const target = path.join(source, file);
    await mkdir(path.dirname(target), { recursive: true });
    await copyFile(path.join(repo, file), target);
  }
  await writeFile(
    path.join(source, 'dist', 'index.html'),
    '<p>Prior supported application fixture</p>',
  );
  await stageRelease({ root: source, out: 'prior', commit: 'a'.repeat(40) });
  const previous = path.join(source, 'prior');
  assert.equal((await verifyReleaseDirectory(previous)).commit, 'a'.repeat(40));
  await assertPreserved('verified prior artifact');

  const interrupted = path.join(source, 'interrupted');
  await mkdir(interrupted);
  await copyFile(
    path.join(previous, 'gev-release-manifest.json'),
    path.join(interrupted, 'gev-release-manifest.json'),
  );
  await assert.rejects(verifyReleaseDirectory(interrupted), /file list/);
  await assertPreserved('interrupted artifact copy');

  await writeFile(
    path.join(source, 'dist', 'index.html'),
    '<p>Candidate application fixture</p>',
  );
  await stageRelease({
    root: source,
    out: 'candidate',
    commit: 'b'.repeat(40),
  });
  const candidate = path.join(source, 'candidate');
  await writeFile(
    path.join(candidate, 'dist', 'index.html'),
    'corrupted download',
  );
  await assert.rejects(verifyReleaseDirectory(candidate), /checksum/);
  // Recovery is the documented switch to the retained verified artifact; the
  // updater does not claim an automatic schema rollback.
  assert.equal((await verifyReleaseDirectory(previous)).commit, 'a'.repeat(40));
  await assertPreserved('verified prior artifact recovery');
  const reopened = await parseWorkspaceBundle(
    await readFile(bundlePath, 'utf8'),
  );
  assert.equal(
    reopened.document.pinnedEvidence[0].record.evidence.references[0].kind,
    'archive',
  );
  assert.equal(
    new TextDecoder().decode(reopened.assets['brief.txt']),
    'persisted investigation note\n',
  );
  await assertPreserved('portable workspace and asset reopen');

  if (!root) await rm(profile, { recursive: true, force: true });
  return Object.freeze({
    platform,
    scope: 'portable-artifact-recovery',
    browserProfileValidated: false,
    checks: [
      'verified-prior-artifact',
      'interrupted-copy-rejected',
      'checksum-failure-recovery',
      'bundle-asset-reopen',
    ],
  });
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  console.log(JSON.stringify(await runInstallRecoveryFixture(), null, 2));
