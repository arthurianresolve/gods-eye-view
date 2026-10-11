import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { once } from 'node:events';
import {
  observeWindowsOwnedProcess,
  summarizeWindowsProcessSamples,
} from './windowsProcessSample.mjs';

const sample = (elapsedMs, cpuMs) => ({
  type: 'sample',
  elapsedMs,
  cpuMs,
  threadCount: 2,
  states: { Wait: 2 },
  waits: { UserRequest: 2 },
  unavailableThreads: 0,
  truncatedThreads: false,
});
const valid = () => [
  { type: 'ready' },
  sample(0, 10),
  sample(101, 25),
  { type: 'end', reason: 'process-exited', elapsedMs: 140 },
];
test('reports CPU deltas separately from helper wall time and filters unrelated fields', () => {
  const m = valid();
  m[1].commandLine = 'must not leave observer';
  const r = summarizeWindowsProcessSamples(m);
  assert.equal(r.status, 'observed');
  assert.equal(r.sampledCpuDeltaMs, 15);
  assert.equal(r.sampledWindowMs, 101);
  assert.equal(r.samples[0].commandLine, undefined);
  assert.match(r.clock, /not synchronized/);
});
test('missing samples and observation limits remain incomplete, not zero CPU', () => {
  const r = summarizeWindowsProcessSamples([
    { type: 'ready' },
    { type: 'end', reason: 'process-exited', elapsedMs: 0 },
  ]);
  assert.equal(r.status, 'incomplete');
  assert.equal(r.sampledCpuDeltaMs, null);
  const m = valid();
  m.at(-1).reason = 'observation-limit';
  assert.equal(summarizeWindowsProcessSamples(m).status, 'incomplete');
});
test('rejects malformed, nonmonotonic, oversized and contradictory observations', () => {
  for (const mutate of [
    (m) => (m[2].cpuMs = 0),
    (m) => (m[2].elapsedMs = -1),
    (m) => (m[1].cpuMs = null),
    (m) => (m[1].states.Secret = 1),
    (m) => (m[1].waits.UserRequest = 3),
    (m) => (m[1].threadCount = 1),
    (m) => (m[1].truncatedThreads = null),
    (m) => m.pop(),
    (m) => (m.at(-1).elapsedMs = 1),
    (m) => m.push(...Array(202).fill({})),
  ]) {
    const m = valid();
    mutate(m);
    assert.throws(() => summarizeWindowsProcessSamples(m));
  }
});
function fakeObserver({ bad = false, oversized = false, exitCode = 0 } = {}) {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stdin = new PassThrough();
  child.killed = false;
  child.kill = () => {
    child.killed = true;
    child.emit('close', 0);
  };
  child.stdin.once('data', () => {
    child.stdout.write(
      oversized
        ? 'x'.repeat(256 * 1024 + 1)
        : bad
          ? 'invalid-json\n'
          : valid()
              .slice(1)
              .map((x) => JSON.stringify(x))
              .join('\n') + '\n',
    );
    child.emit('close', exitCode);
  });
  setImmediate(() => child.stdout.write('{"type":"ready"}\n'));
  return child;
}
test('observer handshake starts only on request, closes its helper and never signals the target', async () => {
  const target = {
    pid: 42,
    exitCode: null,
    kill() {
      assert.fail('must never signal target');
    },
  };
  const child = fakeObserver();
  const observer = await observeWindowsOwnedProcess(target, {
    platform: 'win32',
    launch: (command, args, options) => {
      assert.equal(command, 'powershell.exe');
      assert.equal(options.windowsHide, true);
      assert.equal(args.at(-1), '42');
      return child;
    },
  });
  observer.start();
  assert.throws(() => observer.start());
  const result = await observer.finish();
  assert.equal(result.status, 'observed');
  assert.equal(child.killed, false);
  await assert.rejects(observer.finish());
});
test('invalid helper output cannot become observed evidence', async () => {
  const observer = await observeWindowsOwnedProcess(
    { pid: 42, exitCode: null },
    { platform: 'win32', launch: () => fakeObserver({ bad: true }) },
  );
  observer.start();
  const result = await observer.finish();
  assert.equal(result.status, 'unavailable');
  assert.equal(result.reason, 'observer-malformed-output');
});
test('oversized output and abnormal helper exit cannot become observed evidence', async () => {
  for (const options of [{ oversized: true }, { exitCode: 1 }]) {
    const observer = await observeWindowsOwnedProcess(
      { pid: 42, exitCode: null },
      { platform: 'win32', launch: () => fakeObserver(options) },
    );
    observer.start();
    assert.equal((await observer.finish()).status, 'unavailable');
  }
});
test('rejects unsupported platforms and dead or missing targets before spawning', async () => {
  const launch = () => assert.fail('unexpected launch');
  await assert.rejects(
    observeWindowsOwnedProcess(
      { pid: 42, exitCode: null },
      { platform: 'linux', launch },
    ),
  );
  await assert.rejects(
    observeWindowsOwnedProcess(
      { pid: 42, exitCode: 0 },
      { platform: 'win32', launch },
    ),
  );
  await assert.rejects(
    observeWindowsOwnedProcess(null, { platform: 'win32', launch }),
  );
});
test(
  'Windows native observer samples a disposable Node child through natural exit',
  { skip: process.platform !== 'win32' },
  async () => {
    const child = spawn(
      process.execPath,
      [
        '-e',
        "process.stdin.once('data',()=>setTimeout(()=>process.exit(0),600));",
      ],
      { windowsHide: true, stdio: ['pipe', 'ignore', 'ignore'] },
    );
    const exited = once(child, 'close');
    try {
      const observer = await observeWindowsOwnedProcess(child);
      observer.start();
      child.stdin.write('exit-later\n');
      await exited;
      const report = await observer.finish();
      assert.equal(report.status, 'observed', JSON.stringify(report));
      assert.ok(report.sampleCount >= 2);
      assert.ok(report.samples.every((s) => s.threadCount > 0));
    } finally {
      if (child.exitCode === null) {
        child.kill();
        await exited;
      }
    }
  },
);
