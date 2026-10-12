import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = path.join(ROOT, 'scripts', 'capture-scene-performance.mjs');

function invoke(args) {
  return spawnSync(process.execPath, [SCRIPT, ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: 15_000,
    windowsHide: true,
  });
}

test('capture CLI recognizes an infrastructure workload before browser startup', () => {
  const result = invoke([
    '--provider-fixture',
    'infrastructure-datacenters',
    '--provider-fixture-time',
    '2026-10-08T12:00:00.000Z',
  ]);
  assert.notEqual(result.status, 0);
  assert.match(
    result.stderr,
    /Comparison fixtures require verified build provenance/,
  );
  assert.doesNotMatch(result.stderr, /Unsupported infrastructure workload/);
  assert.doesNotMatch(
    result.stderr,
    /Browser was not found|Could not find Chrome/,
  );
});

test('capture CLI rejects unsupported infrastructure names and mixed populations', () => {
  const unsupported = invoke(['--provider-fixture', 'infrastructure-unknown']);
  assert.notEqual(unsupported.status, 0);
  assert.match(unsupported.stderr, /Unsupported infrastructure workload/);

  const mixed = invoke([
    '--provider-fixture',
    'infrastructure-dams',
    '--mixed-layers',
  ]);
  assert.notEqual(mixed.status, 0);
  assert.match(mixed.stderr, /cannot use aircraft or --mixed-layers/);
});
