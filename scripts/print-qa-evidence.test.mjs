import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import {
  mkdtempSync,
  writeFileSync,
  readFileSync,
  rmSync,
  rmdirSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const cli = fileURLToPath(new URL('./print-qa-evidence.mjs', import.meta.url));
test('artifact identity logging retains the full report and existing payload log limit', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'gev-evidence-log-'));
  try {
    const file = path.join(directory, 'large.json');
    const raw = Buffer.from(
      JSON.stringify({
        status: 'failed',
        payload: 'private-body'.repeat(200_000),
      }),
    );
    writeFileSync(file, raw);
    const rejected = spawnSync(process.execPath, [cli, file], {
      encoding: 'utf8',
    });
    assert.equal(rejected.status, 1);
    assert.match(rejected.stderr, /QA report exceeds log limit/);
    const output = execFileSync(
      process.execPath,
      [cli, '--artifact-only', file],
      { encoding: 'utf8' },
    );
    const identity = JSON.parse(output.slice('QA_ARTIFACT '.length));
    assert.deepEqual(identity, {
      file,
      bytes: raw.length,
      sha256: createHash('sha256').update(raw).digest('hex'),
      scope: 'artifact identity only; no validation result inferred',
    });
    assert.doesNotMatch(output, /private-body|passed|failed/);
    assert.ok(output.length < 1000);
    assert.deepEqual(readFileSync(file), raw);
    const small = path.join(directory, 'small.json');
    writeFileSync(small, '{"status":"failed"}');
    const normal = execFileSync(process.execPath, [cli, small], {
      encoding: 'utf8',
    });
    assert.match(normal, /QA_EVIDENCE_BEGIN/);
    assert.match(normal, /"status":"failed"/);
    assert.match(normal, /QA_EVIDENCE_END/);
  } finally {
    rmSync(path.join(directory, 'large.json'), { force: true });
    rmSync(path.join(directory, 'small.json'), { force: true });
    rmdirSync(directory);
  }
});
