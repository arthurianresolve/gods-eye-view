import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

test('capture CLI rejects either half of an explicit build-harness identity before launching a browser', () => {
  for (const args of [
    ['--build-harness-checkout', 'unused-builder-root'],
    ['--expected-build-harness-sha', 'b'.repeat(40)],
  ]) {
    const result = spawnSync(
      process.execPath,
      [
        fileURLToPath(
          new URL('../capture-scene-performance.mjs', import.meta.url),
        ),
        ...args,
      ],
      { encoding: 'utf8', windowsHide: true, timeout: 30_000 },
    );
    assert.equal(result.error, undefined);
    assert.equal(result.status, 1);
    assert.match(
      result.stderr,
      /--build-harness-checkout and --expected-build-harness-sha must be supplied together/,
    );
  }
});
