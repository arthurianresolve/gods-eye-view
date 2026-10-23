import test from 'node:test';
import assert from 'node:assert/strict';
import { waitForBrowserReadiness } from './browserReadinessGate.mjs';

function options(readFile, extra = {}) {
  let now = 0;
  return {
    file: 'owned.ready',
    browserPid: 42,
    timeoutMs: 1000,
    readFile,
    now: () => now,
    sleep: async (ms) => {
      now += ms;
    },
    ...extra,
  };
}
const missing = () => {
  throw Object.assign(new Error('missing'), { code: 'ENOENT' });
};

test('readiness waits for the exact owned process without claiming native focus', async () => {
  let calls = 0;
  const result = await waitForBrowserReadiness(
    options(async () => (++calls === 3 ? '42\n' : missing())),
  );
  assert.equal(result.elapsedMs, 500);
  assert.equal(result.status, 'operator-ready-native-focus-still-required');
  assert.equal('foregroundConfirmed' in result, false);
});
test('readiness rejects other processes, malformed signals and I/O failures', async () => {
  for (const value of ['41', '42extra', '', '0042'])
    await assert.rejects(
      waitForBrowserReadiness(options(async () => value)),
      /owned process/,
    );
  await assert.rejects(
    waitForBrowserReadiness(
      options(async () => {
        throw Object.assign(new Error('denied'), { code: 'EACCES' });
      }),
    ),
    /denied/,
  );
});
test('readiness has a bounded pre-navigation deadline', async () => {
  let reads = 0;
  await assert.rejects(
    waitForBrowserReadiness(
      options(async () => {
        reads++;
        missing();
      }),
    ),
    /timed out before navigation/,
  );
  assert.equal(reads, 4);
  let now = 0;
  await assert.rejects(
    waitForBrowserReadiness(
      options(
        async () => {
          now = 1001;
          return '42';
        },
        { now: () => now },
      ),
    ),
    /timed out before navigation/,
  );
});
test('readiness rejects missing identity and unbounded waits', async () => {
  for (const extra of [
    { file: '' },
    { browserPid: 0 },
    { timeoutMs: 0 },
    { timeoutMs: 120001 },
    { timeoutMs: 1.5 },
  ])
    await assert.rejects(
      waitForBrowserReadiness(options(async () => '42', extra)),
      TypeError,
    );
});
