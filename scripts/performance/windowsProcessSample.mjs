import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const MAX_BYTES = 256 * 1024;
const STATES = new Set([
  'Initialized',
  'Ready',
  'Running',
  'Standby',
  'Terminated',
  'Wait',
  'Transition',
  'Unknown',
]);
const WAITS = new Set([
  'Executive',
  'FreePage',
  'PageIn',
  'SystemAllocation',
  'ExecutionDelay',
  'Suspended',
  'UserRequest',
  'EventPairHigh',
  'EventPairLow',
  'LpcReceive',
  'LpcReply',
  'VirtualMemory',
  'PageOut',
  'Unknown',
]);
const finite = (x) => Number.isFinite(x) && x >= 0;
function counts(value, allowed) {
  return (
    value &&
    !Array.isArray(value) &&
    typeof value === 'object' &&
    Object.entries(value).every(
      ([key, count]) =>
        allowed.has(key) &&
        Number.isSafeInteger(count) &&
        count > 0 &&
        count <= 512,
    )
  );
}

/** Strictly preserve numeric observations; never infer a CPU cause from wait labels. */
export function summarizeWindowsProcessSamples(messages) {
  if (
    !Array.isArray(messages) ||
    messages.length > 202 ||
    messages[0]?.type !== 'ready'
  )
    throw new Error('Invalid process-sample envelope');
  const end = messages.at(-1);
  if (
    end?.type !== 'end' ||
    !['process-exited', 'sample-unavailable', 'observation-limit'].includes(
      end.reason,
    ) ||
    !finite(end.elapsedMs)
  )
    throw new Error('Missing process-sample end');
  const samples = messages.slice(1, -1);
  let priorTime = -1,
    priorCpu = -1;
  for (const s of samples) {
    if (
      s.type !== 'sample' ||
      !finite(s.elapsedMs) ||
      s.elapsedMs < priorTime ||
      !finite(s.cpuMs) ||
      s.cpuMs < priorCpu ||
      !Number.isSafeInteger(s.threadCount) ||
      s.threadCount < 0 ||
      !counts(s.states, STATES) ||
      !counts(s.waits, WAITS) ||
      !Number.isSafeInteger(s.unavailableThreads) ||
      s.unavailableThreads < 0 ||
      s.unavailableThreads > 512 ||
      typeof s.truncatedThreads !== 'boolean'
    )
      throw new Error('Invalid process sample');
    if (
      Object.values(s.states).reduce((a, b) => a + b, 0) >
        Math.min(s.threadCount, 512) ||
      Object.values(s.waits).reduce((a, b) => a + b, 0) > (s.states.Wait || 0)
    )
      throw new Error('Inconsistent process thread counts');
    priorTime = s.elapsedMs;
    priorCpu = s.cpuMs;
  }
  if (end.elapsedMs < priorTime)
    throw new Error('Process-sample end predates samples');
  return {
    schema: 'gev-windows-owned-process-observation/v1',
    scope:
      'Owned browser parent only; sampled process CPU and thread states, not stacks, descendants or GPU work. Sampling may affect timing. No performance acceptance.',
    status:
      end.reason === 'process-exited' && samples.length
        ? 'observed'
        : 'incomplete',
    endReason: end.reason,
    elapsedMs: end.elapsedMs,
    sampleCount: samples.length,
    sampledCpuDeltaMs:
      samples.length > 1 ? samples.at(-1).cpuMs - samples[0].cpuMs : null,
    sampledWindowMs:
      samples.length > 1
        ? samples.at(-1).elapsedMs - samples[0].elapsedMs
        : null,
    clock:
      'helper monotonic time from start command receipt; not synchronized with host Browser.close timestamps',
    samples: samples.map((s) => ({
      elapsedMs: s.elapsedMs,
      cpuMs: s.cpuMs,
      threadCount: s.threadCount,
      states: { ...s.states },
      waits: { ...s.waits },
      unavailableThreads: s.unavailableThreads,
      truncatedThreads: s.truncatedThreads,
    })),
  };
}

/** Diagnostic only. Caller owns the supplied process; this observer never signals it. */
export async function observeWindowsOwnedProcess(
  ownedProcess,
  {
    launch = spawn,
    platform = process.platform,
    now = () => performance.now(),
  } = {},
) {
  if (
    platform !== 'win32' ||
    !Number.isSafeInteger(ownedProcess?.pid) ||
    ownedProcess.pid <= 0 ||
    ownedProcess.exitCode !== null
  )
    throw new Error('A live owned Windows process is required');
  const began = now();
  const child = launch(
    'powershell.exe',
    [
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-File',
      fileURLToPath(
        new URL('./windowsOwnedProcessSample.ps1', import.meta.url),
      ),
      '-OwnedProcessId',
      String(ownedProcess.pid),
    ],
    { windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] },
  );
  const messages = [];
  let pending = '',
    bytes = 0,
    failure = null,
    signaledAt = null,
    firstSampleReceiptMs = null,
    ended = false,
    helperExitCode = null;
  let resolveReady, resolveDone;
  const ready = new Promise((r) => {
    resolveReady = r;
  });
  const done = new Promise((r) => {
    resolveDone = r;
  });
  const fail = (reason) => {
    failure ||= reason;
    resolveReady(false);
  };
  child.stdin.on('error', () => fail('observer-input-failed'));
  child.stdout.on('data', (chunk) => {
    if (failure) return;
    bytes += chunk.length;
    if (bytes > MAX_BYTES) {
      fail('observer-output-limit');
      return;
    }
    pending += chunk.toString('utf8');
    for (;;) {
      const index = pending.indexOf('\n');
      if (index < 0) break;
      const line = pending.slice(0, index).trim();
      pending = pending.slice(index + 1);
      if (!line) continue;
      try {
        const message = JSON.parse(line);
        if (messages.length >= 202) throw new Error();
        messages.push(message);
        if (message.type === 'ready' && messages.length === 1)
          resolveReady(true);
        else if (
          message.type === 'sample' &&
          firstSampleReceiptMs === null &&
          signaledAt !== null
        )
          firstSampleReceiptMs = now() - signaledAt;
        else if (message.type === 'error') fail('observer-unavailable');
      } catch {
        fail('observer-malformed-output');
      }
    }
  });
  child.once('error', () => {
    fail('observer-launch-failed');
    ended = true;
    resolveDone();
  });
  child.once('close', (code) => {
    helperExitCode = code;
    ended = true;
    resolveReady(false);
    resolveDone();
  });
  async function bounded(promise, ms) {
    let timer;
    try {
      return await Promise.race([
        promise,
        new Promise((r) => {
          timer = setTimeout(() => r(false), ms);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }
  async function stopHelper() {
    child.stdin.end();
    if (!ended) child.kill(); // Only this observer, never the observed browser.
    await bounded(done, 2000);
  }
  if (!(await bounded(ready, 5000))) {
    await stopHelper();
    throw new Error(failure || 'observer-startup-timeout');
  }
  const setupElapsedMs = now() - began;
  let finished = false;
  return {
    start() {
      if (signaledAt !== null || finished)
        throw new Error('Process observer is not reusable');
      signaledAt = now();
      child.stdin.write('start\n');
    },
    async finish() {
      if (finished) throw new Error('Process observer is already finished');
      finished = true;
      if (signaledAt === null) failure ||= 'observer-not-started';
      if (
        !(await bounded(
          done.then(() => true),
          2000,
        ))
      )
        failure ||= 'observer-finish-timeout';
      await stopHelper();
      if (!ended || helperExitCode !== 0)
        failure ||= 'observer-exit-unconfirmed';
      try {
        if (failure || pending.trim())
          throw new Error(failure || 'observer-incomplete-output');
        return {
          ...summarizeWindowsProcessSamples(messages),
          setupElapsedMs,
          startSignalToFirstSampleReceiptMs: firstSampleReceiptMs,
        };
      } catch (error) {
        return {
          schema: 'gev-windows-owned-process-observation/v1',
          status: 'unavailable',
          reason: error.message,
          setupElapsedMs,
        };
      }
    },
  };
}
