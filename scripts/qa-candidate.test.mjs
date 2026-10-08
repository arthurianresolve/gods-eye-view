import test from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluateCandidateReadiness,
  readValidationManifest,
} from './qa-candidate.mjs';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

test('candidate readiness distinguishes failed required gates from pending environment evidence', () => {
  assert.deepEqual(
    evaluateCandidateReadiness([{ required: true, status: 'passed' }]),
    {
      passed: true,
      releaseReady: true,
      failureCount: 0,
      pendingCount: 0,
    },
  );
  assert.deepEqual(
    evaluateCandidateReadiness([
      { required: true, status: 'passed' },
      { required: true, status: 'pending' },
    ]),
    { passed: true, releaseReady: false, failureCount: 0, pendingCount: 1 },
  );
  assert.deepEqual(
    evaluateCandidateReadiness([{ required: true, status: 'failed' }]),
    {
      passed: false,
      releaseReady: false,
      failureCount: 1,
      pendingCount: 1,
    },
  );
});

test('validation manifests require the exact candidate commit and bounded evidence', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'gev-validation-'));
  const artifact = path.join(dir, 'evidence.json');
  await writeFile(artifact, '{}');
  const manifestPath = path.join(dir, 'manifest.json');
  await writeFile(
    manifestPath,
    JSON.stringify({
      schemaVersion: 1,
      candidateCommit: 'abc123',
      checks: [
        {
          id: 'accessibility-review',
          outcome: 'passed',
          environment: 'NVDA / Windows',
          timestamp: '2026-10-08T12:00:00Z',
          artifacts: [artifact],
        },
      ],
    }),
  );
  const manifest = readValidationManifest(manifestPath, {
    candidateCommit: 'abc123',
  });
  assert.equal(manifest.checks[0].status, 'passed');
  assert.throws(
    () =>
      readValidationManifest(manifestPath, { candidateCommit: 'different' }),
    /does not match/,
  );
});

test('validation manifests reject duplicate, unknown, and missing artifact evidence', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'gev-validation-invalid-'));
  const manifestPath = path.join(dir, 'manifest.json');
  await writeFile(
    manifestPath,
    JSON.stringify({
      schemaVersion: 1,
      candidateCommit: 'abc123',
      checks: [
        {
          id: 'hardware-matrix',
          status: 'passed',
          environment: 'Windows',
          timestamp: '2026-10-08T12:00:00Z',
          artifacts: ['missing.json'],
        },
        {
          id: 'hardware-matrix',
          status: 'passed',
          environment: 'macOS',
          timestamp: '2026-10-08T12:00:00Z',
        },
      ],
    }),
  );
  assert.throws(
    () => readValidationManifest(manifestPath, { candidateCommit: 'abc123' }),
    /does not exist/,
  );
  await writeFile(
    manifestPath,
    JSON.stringify({
      schemaVersion: 1,
      candidateCommit: 'abc123',
      checks: [
        {
          id: 'hardware-matrix',
          status: 'passed',
          environment: 'Windows',
          timestamp: '2026-10-08T12:00:00Z',
        },
        {
          id: 'hardware-matrix',
          status: 'passed',
          environment: 'macOS',
          timestamp: '2026-10-08T12:00:00Z',
        },
      ],
    }),
  );
  assert.throws(
    () => readValidationManifest(manifestPath, { candidateCommit: 'abc123' }),
    /Duplicate/,
  );
});

test('publication verification stays separate from pre-release readiness', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'gev-validation-phase-'));
  const manifestPath = path.join(dir, 'manifest.json');
  await writeFile(
    manifestPath,
    JSON.stringify({
      schemaVersion: 1,
      phase: 'pre-release',
      candidateCommit: 'abc123',
      checks: [
        {
          id: 'release-tag-match',
          outcome: 'passed',
          environment: 'GitHub Actions',
          timestamp: '2026-10-08T12:00:00Z',
        },
      ],
    }),
  );
  assert.throws(
    () => readValidationManifest(manifestPath, { candidateCommit: 'abc123' }),
    /post-publication/,
  );
});
