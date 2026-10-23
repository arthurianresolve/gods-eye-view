import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildUnitTestPlan,
  discoverUnitTestFiles,
  parallelTestBatches,
} from './run-unit-tests.mjs';

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);

test('unit discovery includes each existing server test exactly once', () => {
  const discovered = discoverUnitTestFiles(repositoryRoot);
  for (const file of [
    'server/providers/evidenceArchive.test.mjs',
    'server/providers/cctv-health.test.mjs',
    'server/providers/transitHistory.test.mjs',
  ]) {
    assert.equal(discovered.filter((entry) => entry === file).length, 1, file);
  }
});

test('unit discovery recursively includes future nested server test files', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'gev-unit-discovery-'));
  try {
    mkdirSync(path.join(root, 'src', 'nested'), { recursive: true });
    mkdirSync(path.join(root, 'server', 'providers', 'future'), {
      recursive: true,
    });
    writeFileSync(path.join(root, 'src', 'nested', 'source.test.mjs'), '');
    writeFileSync(
      path.join(root, 'server', 'providers', 'future', 'fixture.test.mjs'),
      '',
    );
    assert.deepEqual(discoverUnitTestFiles(root), [
      'server/providers/future/fixture.test.mjs',
      'src/nested/source.test.mjs',
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('Windows batches cover every discovered test within the command-line budget', () => {
  const files = buildUnitTestPlan(
    discoverUnitTestFiles(repositoryRoot),
  ).parallel;
  const batches = parallelTestBatches(files, { platform: 'win32' });
  assert.ok(batches.length > 1);
  assert.deepEqual(batches.flat(), files);
  for (const batch of batches) {
    assert.ok(batch.length > 0);
    assert.ok(
      process.execPath.length +
        ' --test'.length +
        batch.reduce((chars, file) => chars + file.length + 3, 0) <=
        12_000,
    );
  }
  assert.deepEqual(parallelTestBatches(files, { platform: 'linux' }), [files]);
});

test('Windows batching rejects a single path too long for the budget', () => {
  assert.throws(
    () => parallelTestBatches(['a'.repeat(12_000)], { platform: 'win32' }),
    /exceeds command-line budget/,
  );
  assert.deepEqual(parallelTestBatches([], { platform: 'win32' }), []);
});
