#!/usr/bin/env node
import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  writeFile,
  rename,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createWorkspaceDocument,
  parseWorkspaceDocument,
} from '../src/workspaces/document.js';

/**
 * Exercise the user-data side of install and update recovery without touching
 * the checkout or invoking a platform package manager. The real installers
 * must preserve the same files while replacing application dependencies.
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
    assetRefs: [],
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

  await assertPreserved('clean install');

  // An interrupted update leaves a partial candidate beside the installed
  // data. Startup must continue reading the last complete workspace.
  const interrupted = path.join(profile, 'workspace.json.update');
  await writeFile(interrupted, '{"kind":"investigation-workspace"');
  await assertPreserved('interrupted update');
  await rm(interrupted, { force: true });

  // Verification failure rolls back by never replacing the installed file.
  const failed = path.join(profile, 'workspace.json.candidate');
  await writeFile(failed, JSON.stringify({ schemaVersion: 99 }));
  try {
    parseWorkspaceDocument(await readFile(failed, 'utf8'));
    throw new Error('failed verification unexpectedly passed');
  } catch (error) {
    if (error?.message === 'failed verification unexpectedly passed')
      throw error;
  }
  await rm(failed, { force: true });
  await assertPreserved('failed verification rollback');

  // A verified candidate can replace only the application marker; user data
  // remains in place and is reopened after the upgrade.
  const marker = path.join(profile, 'app.version');
  const nextMarker = `${marker}.next`;
  await writeFile(nextMarker, `candidate-${platform}\n`);
  await rename(nextMarker, marker);
  await assertPreserved('successful upgrade');

  if (!root) await rm(profile, { recursive: true, force: true });
  return Object.freeze({
    platform,
    checks: ['clean-install', 'interrupted-update', 'rollback', 'reopen'],
  });
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  console.log(JSON.stringify(await runInstallRecoveryFixture(), null, 2));
