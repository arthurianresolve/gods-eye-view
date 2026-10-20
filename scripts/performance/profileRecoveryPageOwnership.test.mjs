import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { performance } from 'node:perf_hooks';
import { PassThrough } from 'node:stream';
import { Connection } from 'puppeteer-core/internal/cdp/Connection.js';
import {
  applyRecoveryCleanupFailure,
  assertInitialRecoveryPage,
  assertOwnedRecoveryPage,
  captureOwnedBrowserProcessTree,
  closeOwnedRecoveryPage,
  closeRecoveryBrowser,
  createOwnedProcessTreePowerShellCommand,
  createRecoveryBrowserCloseTrace,
  createRecoveryPageTargetGuard,
  countRecoveryApplicationPages,
  observeOwnedBrowserPidPresence,
  readRecoveryBrowserProcessInfo,
  recoveryPageCleanupError,
  summarizeBrowserProcessInfo,
  summarizeOwnedProcessTree,
  stopOwnedRecoveryProcessTree,
} from './profileRecoveryPageOwnership.mjs';

const BASE = 'http://127.0.0.1:4173';
const POWERSHELL_READY_MARKER = '__GEV_POWERSHELL_TEST_READY__';
// Hosted Windows can spend more than five seconds starting a clean PowerShell
// process while concurrent CI jobs scan and install dependencies. This bounds
// that prerequisite separately from the script execution budget.
const POWERSHELL_INTEGRATION_STARTUP_TIMEOUT_MS = 15_000;
// Keep live hosted-runner integration probes bounded without forcing their
// execution through the deliberately tight synthetic timeout used below.
// Hosted Windows can pause an otherwise trivial PowerShell script for several
// seconds under concurrent runner activity after the ready marker is flushed.
const POWERSHELL_INTEGRATION_EXECUTION_TIMEOUT_MS = 15_000;
const POWERSHELL_TEST_SCRIPT_TIMEOUT_MS = 5_000;
const POWERSHELL_TEST_CLEANUP_TIMEOUT_MS = 1_000;
const POWERSHELL_TEST_OUTPUT_LIMIT_BYTES = 64 * 1024;
const KEEP_LATE_PROCESS_ERROR = () => {};
const page = (url) => ({ url: () => url });

function runBoundedPowerShellTestScript(
  script,
  {
    spawnProcess = spawn,
    startupTimeoutMs = 5_000,
    executionTimeoutMs = POWERSHELL_TEST_SCRIPT_TIMEOUT_MS,
    cleanupTimeoutMs = POWERSHELL_TEST_CLEANUP_TIMEOUT_MS,
    outputLimitBytes = POWERSHELL_TEST_OUTPUT_LIMIT_BYTES,
    setTimerImpl = setTimeout,
    clearTimerImpl = clearTimeout,
    nowImpl = () => performance.now(),
  } = {},
) {
  return new Promise((resolve, reject) => {
    const startedAt = nowImpl();
    let child;
    let spawned = false;
    let spawnFailed = false;
    let ready = false;
    let closed = false;
    let settled = false;
    let primaryError = null;
    let readyAt = null;
    let spawnCallStartedAt = null;
    let spawnCallElapsedMs = null;
    let spawnReturnedAt = null;
    let spawnEventAt = null;
    let failureAt = null;
    let readinessDeadlineAt = null;
    let readinessTimerLatenessMs = null;
    let executionDeadlineAt = null;
    let executionTimerLatenessMs = null;
    let stdout = '';
    let stderrBytes = 0;
    let stdoutBytes = 0;
    let startupTimer;
    let executionTimer;
    let cleanupTimer;

    const clearTimers = () => {
      clearTimerImpl(startupTimer);
      clearTimerImpl(executionTimer);
      clearTimerImpl(cleanupTimer);
    };
    const detach = () => {
      child?.off('spawn', onSpawn);
      child?.off('error', onError);
      child?.off('close', onClose);
      child?.stdout?.off('data', onStdout);
      child?.stdout?.off('error', onStreamError);
      child?.stderr?.off('data', onStderr);
      child?.stderr?.off('error', onStreamError);
      child?.stdin?.off('error', onStreamError);
    };
    const guardLateErrors = () => {
      child?.on('error', KEEP_LATE_PROCESS_ERROR);
      for (const stream of [child?.stdin, child?.stdout, child?.stderr])
        stream?.on('error', KEEP_LATE_PROCESS_ERROR);
    };
    const finish = (error, output) => {
      if (settled) return;
      settled = true;
      clearTimers();
      if (error && !closed && !spawnFailed) retireUnconfirmedChild();
      if (error) guardLateErrors();
      detach();
      if (error) {
        const endedAt = nowImpl();
        const observedFailureAt =
          failureAt ?? error.observedFailureAtMs ?? endedAt;
        error.processStatus = spawnFailed
          ? 'not-started'
          : closed
            ? 'closed'
            : 'unconfirmed';
        error.cleanupConfirmed = error.processStatus !== 'unconfirmed';
        error.exitCode = Number.isInteger(child?.exitCode)
          ? child.exitCode
          : null;
        error.startupElapsedMs = Math.max(
          0,
          (readyAt ?? observedFailureAt) - startedAt,
        );
        error.executionElapsedMs =
          readyAt === null ? null : Math.max(0, observedFailureAt - readyAt);
        error.cleanupElapsedMs = Math.max(0, endedAt - observedFailureAt);
        Object.assign(error, phaseTimings());
        reject(error);
      } else {
        const endedAt = nowImpl();
        resolve({
          output,
          startupElapsedMs: Math.max(0, (readyAt ?? endedAt) - startedAt),
          executionElapsedMs:
            readyAt === null ? null : Math.max(0, endedAt - readyAt),
          totalElapsedMs: Math.max(0, endedAt - startedAt),
          ...phaseTimings(),
        });
      }
    };
    const phaseTimings = () => ({
      spawnCallElapsedMs,
      spawnEventDelayMs:
        spawnReturnedAt !== null && spawnEventAt !== null
          ? Math.max(0, spawnEventAt - spawnReturnedAt)
          : null,
      readyMarkerDelayMs:
        spawnEventAt !== null && readyAt !== null
          ? Math.max(0, readyAt - spawnEventAt)
          : null,
      readinessTimerLatenessMs,
      executionTimerLatenessMs,
    });
    const retireUnconfirmedChild = () => {
      if (!child) return;
      try {
        child.kill();
      } catch {
        // Preserve the unconfirmed outcome while retiring owned handles.
      }
      try {
        child.unref?.();
      } catch {
        // Unref is best-effort; process status remains unconfirmed.
      }
      for (const stream of [child.stdin, child.stdout, child.stderr]) {
        if (!stream) continue;
        stream.destroy?.();
      }
    };
    const makeError = (code, stage) => {
      const error = new Error(`PowerShell test command failed at ${stage}.`);
      error.code = code;
      error.stage = stage;
      error.observedFailureAtMs = nowImpl();
      return error;
    };
    const stop = (error) => {
      if (settled || primaryError) return;
      primaryError = error;
      failureAt = Number.isFinite(error.observedFailureAtMs)
        ? error.observedFailureAtMs
        : nowImpl();
      clearTimerImpl(startupTimer);
      clearTimerImpl(executionTimer);
      if (!child || closed) {
        finish(error);
        return;
      }
      cleanupTimer = setTimerImpl(() => finish(error), cleanupTimeoutMs);
      try {
        child.kill();
      } catch {
        // The bounded close wait below reports whether termination was observed.
      }
    };
    const onSpawn = () => {
      spawned = true;
      spawnEventAt = nowImpl();
      if (primaryError) {
        try {
          child.kill();
        } catch {
          // The bounded close wait below reports whether termination was observed.
        }
      }
    };
    const onError = () => {
      const error = makeError('POWERSHELL_SPAWN_FAILED', 'process-start');
      if (!spawned) {
        spawnFailed = true;
        finish(error);
      } else {
        stop(error);
      }
    };
    const onClose = (code) => {
      closed = true;
      if (primaryError) {
        finish(primaryError);
      } else if (!ready) {
        finish(makeError('POWERSHELL_EXIT_BEFORE_READY', 'readiness'));
      } else if (code !== 0) {
        finish(makeError('POWERSHELL_EXIT_NONZERO', 'script-execution'));
      } else {
        const readyLine = new RegExp(
          `(?:^|\\r?\\n)${POWERSHELL_READY_MARKER}\\r?\\n`,
        );
        resolveOutput(finish, readyLine, stdout);
      }
    };
    const onStdout = (chunk) => {
      if (settled || primaryError) return;
      const text = Buffer.isBuffer(chunk)
        ? chunk.toString('utf8')
        : String(chunk);
      stdoutBytes += Buffer.byteLength(text, 'utf8');
      if (stdoutBytes > outputLimitBytes) {
        stop(
          makeError(
            'POWERSHELL_OUTPUT_LIMIT',
            ready ? 'script-execution' : 'readiness',
          ),
        );
        return;
      }
      stdout += text;
      if (
        !ready &&
        (stdout.includes(`${POWERSHELL_READY_MARKER}\r\n`) ||
          stdout.includes(`${POWERSHELL_READY_MARKER}\n`))
      ) {
        ready = true;
        readyAt = nowImpl();
        clearTimerImpl(startupTimer);
        executionDeadlineAt = readyAt + executionTimeoutMs;
        executionTimer = setTimerImpl(() => {
          executionTimerLatenessMs = Math.max(
            0,
            nowImpl() - executionDeadlineAt,
          );
          stop(makeError('POWERSHELL_EXECUTION_TIMEOUT', 'script-execution'));
        }, executionTimeoutMs);
        try {
          if (!child.stdin || typeof child.stdin.write !== 'function')
            throw new Error('stdin unavailable');
          child.stdin.write(script);
          child.stdin.end();
        } catch {
          stop(makeError('POWERSHELL_SCRIPT_SEND_FAILED', 'script-execution'));
        }
      }
    };
    const onStderr = (chunk) => {
      if (settled || primaryError) return;
      const text = Buffer.isBuffer(chunk)
        ? chunk.toString('utf8')
        : String(chunk);
      stderrBytes += Buffer.byteLength(text, 'utf8');
      if (stderrBytes > outputLimitBytes)
        stop(
          makeError(
            'POWERSHELL_OUTPUT_LIMIT',
            ready ? 'script-execution' : 'readiness',
          ),
        );
    };
    const onStreamError = () => {
      stop(
        makeError(
          ready
            ? 'POWERSHELL_SCRIPT_IO_FAILED'
            : 'POWERSHELL_READINESS_IO_FAILED',
          ready ? 'script-execution' : 'readiness',
        ),
      );
    };
    const resolveOutput = (complete, readyLine, raw) => {
      const output = raw.replace(readyLine, '').trim();
      complete(null, output);
    };

    readinessDeadlineAt = nowImpl() + startupTimeoutMs;
    startupTimer = setTimerImpl(() => {
      readinessTimerLatenessMs = Math.max(0, nowImpl() - readinessDeadlineAt);
      stop(makeError('POWERSHELL_READINESS_TIMEOUT', 'readiness'));
    }, startupTimeoutMs);
    spawnCallStartedAt = nowImpl();
    try {
      child = spawnProcess(
        'powershell.exe',
        [
          '-NoLogo',
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          `[Console]::Out.WriteLine('${POWERSHELL_READY_MARKER}'); [Console]::Out.Flush(); $gevTestScript = [Console]::In.ReadToEnd(); Invoke-Expression $gevTestScript`,
        ],
        { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] },
      );
      spawnReturnedAt = nowImpl();
      spawnCallElapsedMs = Math.max(0, spawnReturnedAt - spawnCallStartedAt);
    } catch {
      spawnReturnedAt = nowImpl();
      spawnCallElapsedMs = Math.max(0, spawnReturnedAt - spawnCallStartedAt);
      spawnFailed = true;
      finish(makeError('POWERSHELL_SPAWN_FAILED', 'process-start'));
      return;
    }
    child.on('spawn', onSpawn);
    child.on('error', onError);
    child.on('close', onClose);
    child.stdout?.on('data', onStdout);
    child.stdout?.on('error', onStreamError);
    child.stderr?.on('data', onStderr);
    child.stderr?.on('error', onStreamError);
    child.stdin?.on('error', onStreamError);
  });
}

function deterministicPowerShellTimers() {
  let nextId = 0;
  let nowMs = 0;
  const timers = new Map();
  return {
    setTimeout(callback, delayMs) {
      const id = ++nextId;
      timers.set(id, { callback, dueAt: nowMs + delayMs });
      return id;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
    advance(delayMs) {
      nowMs += delayMs;
      while (true) {
        const entry = [...timers.entries()]
          .filter(([, timer]) => timer.dueAt <= nowMs)
          .sort((left, right) => left[1].dueAt - right[1].dueAt)[0];
        if (!entry) break;
        timers.delete(entry[0]);
        entry[1].callback();
      }
    },
    now: () => nowMs,
    get size() {
      return timers.size;
    },
  };
}

function flushProcessEvents() {
  return new Promise((resolve) => setImmediate(resolve));
}

async function runPowerShellIntegrationScript(script, t) {
  try {
    const result = await runBoundedPowerShellTestScript(script, {
      startupTimeoutMs: POWERSHELL_INTEGRATION_STARTUP_TIMEOUT_MS,
      executionTimeoutMs: POWERSHELL_INTEGRATION_EXECUTION_TIMEOUT_MS,
    });
    t.diagnostic(
      JSON.stringify({
        startupElapsedMs: result.startupElapsedMs,
        executionElapsedMs: result.executionElapsedMs,
        totalElapsedMs: result.totalElapsedMs,
        spawnCallElapsedMs: result.spawnCallElapsedMs,
        spawnEventDelayMs: result.spawnEventDelayMs,
        readyMarkerDelayMs: result.readyMarkerDelayMs,
        readinessTimerLatenessMs: result.readinessTimerLatenessMs,
        executionTimerLatenessMs: result.executionTimerLatenessMs,
      }),
    );
    return result;
  } catch (error) {
    t.diagnostic(
      JSON.stringify({
        stage: error.stage,
        processStatus: error.processStatus,
        cleanupConfirmed: error.cleanupConfirmed,
        startupElapsedMs: error.startupElapsedMs,
        executionElapsedMs: error.executionElapsedMs,
        cleanupElapsedMs: error.cleanupElapsedMs,
        spawnCallElapsedMs: error.spawnCallElapsedMs,
        spawnEventDelayMs: error.spawnEventDelayMs,
        readyMarkerDelayMs: error.readyMarkerDelayMs,
        readinessTimerLatenessMs: error.readinessTimerLatenessMs,
        executionTimerLatenessMs: error.executionTimerLatenessMs,
      }),
    );
    throw error;
  }
}

function fakePowerShellChild({ killCloses = true, syncKillClose = true } = {}) {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.stdin = new PassThrough();
  child.exitCode = null;
  child.killCalls = 0;
  child.unrefCalls = 0;
  child.unref = () => {
    child.unrefCalls += 1;
  };
  child.kill = () => {
    child.killCalls += 1;
    if (killCloses) {
      if (syncKillClose) child.emit('close', null, 'SIGTERM');
      else queueMicrotask(() => child.emit('close', null, 'SIGTERM'));
    }
    return true;
  };
  return child;
}

function fakePowerShellSpawner(
  child,
  { closeOnInputEnd = true, exitCode = 0, output = 'ok\r\n' } = {},
) {
  let scriptInput = '';
  let launchArguments;
  const complete = () => {
    child.stdout.write(output);
    queueMicrotask(() => {
      child.exitCode = exitCode;
      child.emit('close', exitCode, null);
    });
  };
  child.stdin.on('data', (chunk) => {
    scriptInput += chunk.toString('utf8');
  });
  child.stdin.on('finish', () => {
    if (!closeOnInputEnd) return;
    complete();
  });
  const spawnProcess = (executable, args, options) => {
    assert.equal(executable, 'powershell.exe');
    assert.equal(args.at(-2), '-Command');
    assert.match(args.at(-1), /ReadToEnd\(\)/);
    launchArguments = args;
    assert.equal(options.windowsHide, true);
    return child;
  };
  return {
    spawnProcess,
    start: () => child.emit('spawn'),
    ready: () => child.stdout.write(`${POWERSHELL_READY_MARKER}\r\n`),
    complete,
    getScriptInput: () => scriptInput,
    getLaunchArguments: () => launchArguments,
  };
}

test('PowerShell test harness waits for a flushed readiness marker before sending script', async () => {
  const timers = deterministicPowerShellTimers();
  const child = fakePowerShellChild();
  const fake = fakePowerShellSpawner(child, {
    closeOnInputEnd: false,
    output: 'NO_COMMAND_LINE_QUERY\r\n',
  });
  const pending = runBoundedPowerShellTestScript(
    'Write-Output "NO_COMMAND_LINE_QUERY"',
    {
      spawnProcess: fake.spawnProcess,
      startupTimeoutMs: 5_000,
      executionTimeoutMs: 5_000,
      setTimerImpl: timers.setTimeout,
      clearTimerImpl: timers.clearTimeout,
      nowImpl: timers.now,
    },
  );
  fake.start();
  timers.advance(4_000);
  await flushProcessEvents();
  assert.equal(fake.getScriptInput(), '');
  fake.ready();
  await flushProcessEvents();
  timers.advance(2_000);
  fake.complete();
  await flushProcessEvents();
  const result = await pending;
  assert.equal(fake.getScriptInput(), 'Write-Output "NO_COMMAND_LINE_QUERY"');
  assert.equal(
    fake.getLaunchArguments().includes('Write-Output "NO_COMMAND_LINE_QUERY"'),
    false,
  );
  assert.equal(result.output, 'NO_COMMAND_LINE_QUERY');
  assert.equal(result.startupElapsedMs, 4_000);
  assert.equal(result.executionElapsedMs, 2_000);
  assert.equal(result.totalElapsedMs, 6_000);
  assert.equal(timers.size, 0);
  assert.equal(child.listenerCount('spawn'), 0);
  assert.equal(child.listenerCount('close'), 0);
  assert.equal(child.stdout.listenerCount('data'), 0);
  assert.equal(child.stderr.listenerCount('data'), 0);
});

test('PowerShell prerequisite timing separates spawn call, spawn event and readiness marker', async () => {
  const timers = deterministicPowerShellTimers();
  const child = fakePowerShellChild();
  const fake = fakePowerShellSpawner(child, { closeOnInputEnd: false });
  const spawnProcess = (...args) => {
    const spawnedChild = fake.spawnProcess(...args);
    timers.advance(125);
    return spawnedChild;
  };
  const pending = runBoundedPowerShellTestScript('Write-Output "bounded"', {
    spawnProcess,
    startupTimeoutMs: 5_000,
    executionTimeoutMs: 5_000,
    setTimerImpl: timers.setTimeout,
    clearTimerImpl: timers.clearTimeout,
    nowImpl: timers.now,
  });
  timers.advance(200);
  fake.start();
  timers.advance(300);
  fake.ready();
  await flushProcessEvents();
  timers.advance(25);
  fake.complete();
  await flushProcessEvents();

  const result = await pending;
  assert.equal(result.spawnCallElapsedMs, 125);
  assert.equal(result.spawnEventDelayMs, 200);
  assert.equal(result.readyMarkerDelayMs, 300);
  assert.equal(result.startupElapsedMs, 625);
  assert.equal(result.executionElapsedMs, 25);
  assert.equal(result.readinessTimerLatenessMs, null);
  assert.equal(result.executionTimerLatenessMs, null);
  assert.equal(timers.size, 0);
});

test('PowerShell readiness timeout records host timer lateness without sending the script', async () => {
  const timers = deterministicPowerShellTimers();
  const child = fakePowerShellChild({ killCloses: false });
  const fake = fakePowerShellSpawner(child, { closeOnInputEnd: false });
  const pending = runBoundedPowerShellTestScript('Write-Output "never sent"', {
    spawnProcess: fake.spawnProcess,
    startupTimeoutMs: 5_000,
    cleanupTimeoutMs: 1_000,
    setTimerImpl: timers.setTimeout,
    clearTimerImpl: timers.clearTimeout,
    nowImpl: timers.now,
  });
  fake.start();
  timers.advance(6_250);
  timers.advance(1_000);

  await assert.rejects(pending, (error) => {
    assert.equal(error.code, 'POWERSHELL_READINESS_TIMEOUT');
    assert.equal(error.startupElapsedMs, 6_250);
    assert.equal(error.executionElapsedMs, null);
    assert.equal(error.readinessTimerLatenessMs, 1_250);
    assert.equal(error.executionTimerLatenessMs, null);
    assert.equal(error.cleanupElapsedMs, 1_000);
    assert.equal(error.cleanupConfirmed, false);
    assert.equal(fake.getScriptInput(), '');
    assert.equal(JSON.stringify(error).includes('never sent'), false);
    return true;
  });
  assert.equal(timers.size, 0);
});

test('PowerShell execution timeout records host timer lateness separately from cleanup', async () => {
  const timers = deterministicPowerShellTimers();
  const child = fakePowerShellChild({ killCloses: false });
  const fake = fakePowerShellSpawner(child, { closeOnInputEnd: false });
  const pending = runBoundedPowerShellTestScript('Write-Output "hang"', {
    spawnProcess: fake.spawnProcess,
    startupTimeoutMs: 5_000,
    executionTimeoutMs: 5_000,
    cleanupTimeoutMs: 1_000,
    setTimerImpl: timers.setTimeout,
    clearTimerImpl: timers.clearTimeout,
    nowImpl: timers.now,
  });
  fake.start();
  fake.ready();
  await flushProcessEvents();
  timers.advance(6_250);
  timers.advance(1_000);

  await assert.rejects(pending, (error) => {
    assert.equal(error.code, 'POWERSHELL_EXECUTION_TIMEOUT');
    assert.equal(error.startupElapsedMs, 0);
    assert.equal(error.executionElapsedMs, 6_250);
    assert.equal(error.executionTimerLatenessMs, 1_250);
    assert.equal(error.readinessTimerLatenessMs, null);
    assert.equal(error.cleanupElapsedMs, 1_000);
    assert.equal(error.cleanupConfirmed, false);
    assert.equal(JSON.stringify(error).includes('Write-Output'), false);
    return true;
  });
  assert.equal(timers.size, 0);
});

test('PowerShell startup and hung execution have distinct bounded failures and cleanup', async () => {
  const startupTimers = deterministicPowerShellTimers();
  const startupChild = fakePowerShellChild();
  const startup = fakePowerShellSpawner(startupChild);
  const startupPending = runBoundedPowerShellTestScript(
    'Write-Output "never sent"',
    {
      spawnProcess: startup.spawnProcess,
      startupTimeoutMs: 5_000,
      cleanupTimeoutMs: 1_000,
      setTimerImpl: startupTimers.setTimeout,
      clearTimerImpl: startupTimers.clearTimeout,
      nowImpl: startupTimers.now,
    },
  );
  startup.start();
  startupTimers.advance(5_000);
  await assert.rejects(startupPending, (error) => {
    assert.equal(error.code, 'POWERSHELL_READINESS_TIMEOUT');
    assert.equal(error.stage, 'readiness');
    assert.equal(error.cleanupConfirmed, true);
    assert.equal(error.startupElapsedMs, 5_000);
    assert.equal(error.executionElapsedMs, null);
    assert.equal(error.cleanupElapsedMs, 0);
    return true;
  });
  assert.equal(startupChild.killCalls, 1);
  assert.equal(startupTimers.size, 0);

  const executionTimers = deterministicPowerShellTimers();
  const hungChild = fakePowerShellChild();
  const hung = fakePowerShellSpawner(hungChild, { closeOnInputEnd: false });
  const executionPending = runBoundedPowerShellTestScript(
    'Write-Output "hang"',
    {
      spawnProcess: hung.spawnProcess,
      startupTimeoutMs: 5_000,
      executionTimeoutMs: 5_000,
      cleanupTimeoutMs: 1_000,
      setTimerImpl: executionTimers.setTimeout,
      clearTimerImpl: executionTimers.clearTimeout,
      nowImpl: executionTimers.now,
    },
  );
  hung.start();
  await flushProcessEvents();
  hung.ready();
  await flushProcessEvents();
  executionTimers.advance(5_000);
  await assert.rejects(executionPending, (error) => {
    assert.equal(error.code, 'POWERSHELL_EXECUTION_TIMEOUT');
    assert.equal(error.stage, 'script-execution');
    assert.equal(error.cleanupConfirmed, true);
    assert.equal(error.startupElapsedMs, 0);
    assert.equal(error.executionElapsedMs, 5_000);
    assert.equal(error.cleanupElapsedMs, 0);
    return true;
  });
  assert.equal(hungChild.killCalls, 1);
  assert.equal(executionTimers.size, 0);
  assert.equal(hungChild.listenerCount('close'), 0);
});

test('PowerShell late readiness after startup timeout never sends the script', async () => {
  const timers = deterministicPowerShellTimers();
  const child = fakePowerShellChild({ killCloses: false });
  const ownedErrorObserver = () => {};
  const ownedStreamErrorObserver = () => {};
  child.on('error', ownedErrorObserver);
  child.stdout.on('error', ownedStreamErrorObserver);
  const fake = fakePowerShellSpawner(child, { closeOnInputEnd: false });
  const pending = runBoundedPowerShellTestScript(
    'Write-Output "must not run"',
    {
      spawnProcess: fake.spawnProcess,
      startupTimeoutMs: 5_000,
      cleanupTimeoutMs: 1_000,
      setTimerImpl: timers.setTimeout,
      clearTimerImpl: timers.clearTimeout,
      nowImpl: timers.now,
    },
  );
  fake.start();
  timers.advance(5_000);
  fake.ready();
  await flushProcessEvents();
  assert.equal(fake.getScriptInput(), '');
  timers.advance(1_000);
  await assert.rejects(pending, (error) => {
    assert.equal(error.code, 'POWERSHELL_READINESS_TIMEOUT');
    assert.equal(error.readyMarkerDelayMs, null);
    assert.equal(error.cleanupConfirmed, false);
    assert.equal(error.processStatus, 'unconfirmed');
    return true;
  });
  assert.equal(fake.getScriptInput(), '');
  assert.equal(child.killCalls, 2);
  assert.equal(child.unrefCalls, 1);
  assert.equal(child.stdout.listenerCount('data'), 0);
  assert.equal(child.stderr.listenerCount('data'), 0);
  assert.equal(child.stdout.listenerCount('error'), 2);
  assert.equal(child.listenerCount('error'), 2);
  assert.equal(child.listeners('error').includes(ownedErrorObserver), true);
  assert.equal(child.stdout.listenerCount('error'), 2);
  assert.equal(
    child.stdout.listeners('error').includes(ownedStreamErrorObserver),
    true,
  );
  fake.ready();
  await flushProcessEvents();
  assert.equal(fake.getScriptInput(), '');
  assert.doesNotThrow(() => child.emit('error', new Error('late child error')));
  assert.doesNotThrow(() =>
    child.stdout.emit('error', new Error('late pipe error')),
  );
  assert.equal(timers.size, 0);
});

test('PowerShell spawn failure, synchronous close and output overflow are bounded', async () => {
  await assert.rejects(
    runBoundedPowerShellTestScript('Write-Output "never launched"', {
      spawnProcess() {
        throw new Error('private spawn detail');
      },
    }),
    (error) => {
      assert.equal(error.code, 'POWERSHELL_SPAWN_FAILED');
      assert.equal(error.processStatus, 'not-started');
      assert.equal(error.cleanupConfirmed, true);
      assert.doesNotMatch(error.message, /private spawn detail/);
      return true;
    },
  );

  const errorChild = fakePowerShellChild();
  await assert.rejects(
    runBoundedPowerShellTestScript('Write-Output "spawn error"', {
      spawnProcess: () => {
        queueMicrotask(() =>
          errorChild.emit('error', new Error('spawn failed')),
        );
        return errorChild;
      },
    }),
    (error) => {
      assert.equal(error.processStatus, 'not-started');
      assert.equal(error.cleanupConfirmed, true);
      return true;
    },
  );
  assert.equal(errorChild.killCalls, 0);

  const syncTimers = deterministicPowerShellTimers();
  const syncChild = fakePowerShellChild({ syncKillClose: true });
  const syncPending = runBoundedPowerShellTestScript(
    'Write-Output "sync close"',
    {
      spawnProcess: () => syncChild,
      startupTimeoutMs: 5_000,
      cleanupTimeoutMs: 1_000,
      setTimerImpl: syncTimers.setTimeout,
      clearTimerImpl: syncTimers.clearTimeout,
      nowImpl: syncTimers.now,
    },
  );
  syncTimers.advance(5_000);
  await assert.rejects(syncPending, (error) => {
    assert.equal(error.code, 'POWERSHELL_READINESS_TIMEOUT');
    assert.equal(error.processStatus, 'closed');
    assert.equal(error.cleanupConfirmed, true);
    return true;
  });
  assert.equal(syncTimers.size, 0);
  assert.equal(syncChild.listenerCount('close'), 0);

  const overflowTimers = deterministicPowerShellTimers();
  const overflowChild = fakePowerShellChild();
  const overflowFake = fakePowerShellSpawner(overflowChild);
  const overflowPending = runBoundedPowerShellTestScript(
    'Write-Output "overflow"',
    {
      spawnProcess: overflowFake.spawnProcess,
      outputLimitBytes: 4,
      setTimerImpl: overflowTimers.setTimeout,
      clearTimerImpl: overflowTimers.clearTimeout,
      nowImpl: overflowTimers.now,
    },
  );
  overflowFake.start();
  overflowChild.stdout.write('012345');
  await assert.rejects(overflowPending, (error) => {
    assert.equal(error.code, 'POWERSHELL_OUTPUT_LIMIT');
    assert.equal(error.processStatus, 'closed');
    assert.equal(error.cleanupConfirmed, true);
    return true;
  });
  assert.equal(overflowTimers.size, 0);
});

test('PowerShell early exit, nonzero exit and unconfirmed kill remain failed', async () => {
  const earlyTimers = deterministicPowerShellTimers();
  const earlyChild = fakePowerShellChild();
  const early = fakePowerShellSpawner(earlyChild, { closeOnInputEnd: false });
  const earlyPending = runBoundedPowerShellTestScript(
    'Write-Output "not reached"',
    {
      spawnProcess: early.spawnProcess,
      startupTimeoutMs: 5_000,
      setTimerImpl: earlyTimers.setTimeout,
      clearTimerImpl: earlyTimers.clearTimeout,
      nowImpl: earlyTimers.now,
    },
  );
  early.start();
  earlyChild.exitCode = 0;
  earlyChild.emit('close', 0, null);
  await assert.rejects(earlyPending, (error) => {
    assert.equal(error.code, 'POWERSHELL_EXIT_BEFORE_READY');
    assert.equal(error.cleanupConfirmed, true);
    return true;
  });
  assert.equal(earlyTimers.size, 0);

  const nonzeroTimers = deterministicPowerShellTimers();
  const nonzeroChild = fakePowerShellChild();
  const nonzero = fakePowerShellSpawner(nonzeroChild, { exitCode: 7 });
  const nonzeroPending = runBoundedPowerShellTestScript(
    'Write-Output "then fail"',
    {
      spawnProcess: nonzero.spawnProcess,
      startupTimeoutMs: 5_000,
      executionTimeoutMs: 5_000,
      setTimerImpl: nonzeroTimers.setTimeout,
      clearTimerImpl: nonzeroTimers.clearTimeout,
      nowImpl: nonzeroTimers.now,
    },
  );
  const nonzeroRejected = assert.rejects(nonzeroPending, (error) => {
    assert.equal(error.code, 'POWERSHELL_EXIT_NONZERO');
    assert.equal(error.exitCode, 7);
    assert.equal(error.cleanupConfirmed, true);
    return true;
  });
  nonzero.start();
  await flushProcessEvents();
  nonzero.ready();
  await flushProcessEvents();
  await nonzeroRejected;

  const stuckTimers = deterministicPowerShellTimers();
  const stuckChild = fakePowerShellChild({ killCloses: false });
  const stuck = fakePowerShellSpawner(stuckChild, { closeOnInputEnd: false });
  const stuckPending = runBoundedPowerShellTestScript(
    'Write-Output "hung child"',
    {
      spawnProcess: stuck.spawnProcess,
      startupTimeoutMs: 5_000,
      executionTimeoutMs: 5_000,
      cleanupTimeoutMs: 1_000,
      setTimerImpl: stuckTimers.setTimeout,
      clearTimerImpl: stuckTimers.clearTimeout,
      nowImpl: stuckTimers.now,
    },
  );
  stuck.start();
  await flushProcessEvents();
  stuck.ready();
  await flushProcessEvents();
  stuckTimers.advance(5_000);
  stuckTimers.advance(1_000);
  await assert.rejects(stuckPending, (error) => {
    assert.equal(error.code, 'POWERSHELL_EXECUTION_TIMEOUT');
    assert.equal(error.cleanupConfirmed, false);
    assert.equal(error.processStatus, 'unconfirmed');
    assert.equal(error.executionElapsedMs, 5_000);
    assert.equal(error.cleanupElapsedMs, 1_000);
    return true;
  });
  assert.equal(stuckChild.killCalls, 2);
  assert.equal(stuckTimers.size, 0);
  assert.equal(stuckChild.listenerCount('close'), 0);
  assert.equal(stuckChild.stdout.listenerCount('data'), 0);
  assert.equal(stuckChild.stderr.listenerCount('data'), 0);
});

test('each recovery launch requires exactly one initial blank page', () => {
  const blank = page('about:blank');
  assert.equal(assertInitialRecoveryPage([blank], BASE), blank);
  assert.throws(() => assertInitialRecoveryPage([], BASE), /exactly one/);
  assert.throws(
    () => assertInitialRecoveryPage([blank, page('about:blank')], BASE),
    /exactly one/,
  );
  assert.throws(
    () =>
      assertInitialRecoveryPage(
        [blank, page('https://unrelated.example/')],
        BASE,
      ),
    /exactly one/,
  );
  const restoredApp = page(BASE + '/');
  assert.equal(countRecoveryApplicationPages([restoredApp], BASE), 1);
  assert.throws(
    () => assertInitialRecoveryPage([blank, restoredApp], BASE),
    /1 app pages/,
  );
});

test('post-navigation invariant requires the sole app page to be owned', () => {
  const owned = page(BASE + '/?welcome=0');
  assert.equal(assertOwnedRecoveryPage([owned], owned, BASE), 1);
  assert.throws(
    () => assertOwnedRecoveryPage([owned, page(BASE + '/')], owned, BASE),
    /found 2 pages \(2 app pages\)/,
  );
  assert.throws(
    () => assertOwnedRecoveryPage([page(BASE + '/')], owned, BASE),
    /owned by this recovery stage/,
  );
});

test('target guard rejects even a transient extra page target', () => {
  const listeners = new Map();
  const browser = {
    on: (event, listener) => listeners.set(event, listener),
    off: (event) => listeners.delete(event),
  };
  const target = () => ({ type: () => 'page' });
  const ownedTarget = target();
  const ownedPage = { target: () => ownedTarget };
  const guard = createRecoveryPageTargetGuard(browser);
  listeners.get('targetcreated')(ownedTarget);
  assert.equal(guard.assertOnlyOwnedPageTarget(ownedPage), 1);
  const transient = target();
  listeners.get('targetcreated')(transient);
  assert.equal(guard.unexpectedPageTargetCount(ownedPage), 1);
  assert.throws(
    () => guard.assertOnlyOwnedPageTarget(ownedPage),
    /Unexpected page targets/,
  );
  guard.dispose();
  assert.equal(listeners.has('targetcreated'), false);
});

test('owned page closes before browser close and leaves zero open pages', async () => {
  const order = [];
  let remaining = [page(BASE + '/')];
  const owned = {
    url: () => BASE + '/',
    isClosed: () => false,
    close: async () => {
      order.push('page-close');
      remaining = [];
    },
  };
  const browser = {
    pages: async () => remaining,
    close: async () => order.push('browser-close'),
  };
  const outcome = await closeOwnedRecoveryPage(owned, browser);
  assert.equal(outcome.closeCompleted, true);
  assert.equal(outcome.openPageCount, 0);
  assert.equal(outcome.closeObservation.status, 'completed');
  assert.equal(outcome.closeObservation.errorName, null);
  assert.equal(
    outcome.closeObservation.lateSettlement.status,
    'not-applicable',
  );
  assert.equal(outcome.closeObservation.pageInventory.status, 'completed');
  assert.equal(outcome.closeObservation.pageInventory.errorName, null);
  assert.equal(
    Number.isFinite(outcome.closeObservation.pageInventory.elapsedMs),
    true,
  );
  await browser.close();
  assert.deepEqual(order, ['page-close', 'browser-close']);
});

test('owned-page close rejection is distinguished without retaining its message', async () => {
  const owned = {
    isClosed: () => false,
    close: async () => {
      throw Object.assign(new Error('sensitive close details'), {
        name: 'ProtocolError',
      });
    },
  };
  let pageInventoryCalls = 0;
  const outcome = await closeOwnedRecoveryPage(owned, {
    pages: async () => {
      pageInventoryCalls += 1;
      return [];
    },
  });
  assert.equal(outcome.closeCompleted, false);
  assert.equal(outcome.openPageCount, null);
  assert.equal(outcome.closeObservation.status, 'rejected');
  assert.equal(outcome.closeObservation.errorName, 'ProtocolError');
  assert.equal(
    outcome.closeObservation.lateSettlement.status,
    'not-applicable',
  );
  assert.equal(pageInventoryCalls, 0);
  assert.equal(JSON.stringify(outcome).includes('sensitive'), false);
});

test('wedged owned-page close is bounded and reported as incomplete', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const owned = {
    isClosed: () => false,
    close: () => new Promise(() => {}),
  };
  const browser = { pages: async () => [owned] };
  let settled = false;
  const pending = closeOwnedRecoveryPage(owned, browser, 20).then((result) => {
    settled = true;
    return result;
  });
  t.mock.timers.tick(19);
  await new Promise(setImmediate);
  assert.equal(settled, false);
  t.mock.timers.tick(1);
  await new Promise(setImmediate);
  assert.equal(
    settled,
    true,
    'the declared deadline must settle the operation',
  );
  const outcome = await pending;
  assert.equal(outcome.closeCompleted, false);
  assert.equal(outcome.openPageCount, null);
  assert.equal(outcome.closeObservation.status, 'timed-out');
  assert.equal(outcome.closeObservation.lateSettlement.status, 'pending');
});

test('late owned-page close completion remains a failed pre-browser-close stage', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let finishClose;
  let now = 0;
  const owned = {
    isClosed: () => false,
    close: () => new Promise((resolve) => (finishClose = resolve)),
  };
  let pageInventoryCalls = 0;
  const pending = closeOwnedRecoveryPage(
    owned,
    {
      pages: async () => {
        pageInventoryCalls += 1;
        return [];
      },
    },
    20,
    { now: () => now },
  );
  await new Promise(setImmediate);
  now = 20;
  t.mock.timers.tick(20);
  await new Promise(setImmediate);
  const outcome = await pending;
  assert.equal(outcome.closeCompleted, false);
  assert.equal(outcome.closeObservation.status, 'timed-out');
  assert.equal(outcome.closeObservation.elapsedMs, 20);
  assert.equal(outcome.closeObservation.lateSettlement.status, 'pending');
  finishClose();
  await new Promise(setImmediate);
  assert.equal(outcome.closeObservation.lateSettlement.status, 'completed');
  assert.equal(pageInventoryCalls, 0);
});

test('a passed workspace check still fails when cleanup leaves a page open', () => {
  assert.equal(
    recoveryPageCleanupError({
      closeCompleted: true,
      openPageCount: 0,
      unexpectedCreatedPageTargets: 0,
    }),
    null,
  );
  assert.match(
    recoveryPageCleanupError({
      closeCompleted: false,
      openPageCount: null,
      unexpectedCreatedPageTargets: 0,
    }).message,
    /cleanup failed/,
  );
  assert.match(
    recoveryPageCleanupError({
      closeCompleted: true,
      openPageCount: 0,
      unexpectedCreatedPageTargets: 1,
    }).message,
    /Unexpected page targets/,
  );
  assert.match(
    recoveryPageCleanupError({
      closeCompleted: true,
      openPageCount: 0,
      unexpectedCreatedPageTargets: 0,
      browserCloseCompleted: false,
    }).message,
    /Graceful browser close/,
  );
});

function fakeBrowserProcess({ exitCode = null, signalCode = null } = {}) {
  const child = new EventEmitter();
  child.pid = 1234;
  child.exitCode = exitCode;
  child.signalCode = signalCode;
  return child;
}

test('owned process snapshot keeps only a bounded rooted tree and safe fields', () => {
  const snapshot = summarizeOwnedProcessTree(
    [
      {
        pid: 1234,
        ppid: 1,
        image: 'chrome.exe',
        category: 'browser',
        commandLine: 'secret',
      },
      {
        pid: 1235,
        ppid: 1234,
        image: 'chrome.exe',
        category: 'renderer',
        path: 'C:\\private',
      },
      {
        pid: 1236,
        ppid: 1235,
        image: 'chrome_crashpad_handler.exe',
        category: 'crashpad',
      },
      { pid: 9999, ppid: 1, image: 'unrelated.exe', category: 'other' },
    ],
    1234,
  );
  assert.deepEqual(snapshot, {
    status: 'available',
    rootPid: 1234,
    rows: [
      { pid: 1234, ppid: 1, image: 'chrome.exe', category: 'browser' },
      { pid: 1235, ppid: 1234, image: 'chrome.exe', category: 'renderer' },
      {
        pid: 1236,
        ppid: 1235,
        image: 'chrome_crashpad_handler.exe',
        category: 'crashpad',
      },
    ],
    processCount: 3,
    truncated: false,
  });
  assert.equal(JSON.stringify(snapshot).includes('secret'), false);
  assert.equal(JSON.stringify(snapshot).includes('private'), false);
  assert.equal(
    summarizeOwnedProcessTree(
      [
        {
          pid: 1234,
          ppid: 1,
          image: 'chrome.exe',
          category: 'some-unapproved-role',
        },
      ],
      1234,
    ).status,
    'unavailable',
  );
  assert.equal(
    summarizeOwnedProcessTree(
      [
        { pid: 1234, ppid: 1, image: 'chrome.exe', category: 'browser' },
        { pid: 1235, ppid: 1234, image: 'chrome.exe', category: 'renderer' },
      ],
      1234,
      2,
    ).truncated,
    false,
  );
  assert.equal(
    summarizeOwnedProcessTree(
      [
        { pid: 1234, ppid: 1, image: 'chrome.exe' },
        { pid: 1235, ppid: 1234, image: 'chrome.exe' },
      ],
      1234,
      1,
    ).truncated,
    true,
  );
});

test('Windows process tree capture is bounded and omits command lines', () => {
  let invocation;
  const snapshot = captureOwnedBrowserProcessTree(fakeBrowserProcess(), {
    platform: 'win32',
    timeoutMs: 321,
    maxRows: 12,
    execFile: (executable, args, options) => {
      invocation = { executable, args, options };
      return JSON.stringify({
        rows: [
          {
            pid: 1234,
            ppid: 1,
            image: 'chrome.exe',
            category: 'browser',
          },
        ],
        truncated: false,
      });
    },
  });
  assert.equal(snapshot.status, 'available');
  assert.equal(invocation.executable, 'powershell.exe');
  assert.equal(invocation.options.timeout, 321);
  assert.equal(invocation.options.maxBuffer <= 12_000, true);
  assert.match(invocation.args.join(' '), /Get-CimInstance Win32_Process/);
  assert.match(invocation.args.join(' '), /ProcessId,ParentProcessId,Name/);
  assert.match(
    invocation.args.join(' '),
    /-Filter \$commandFilter -Property ProcessId,CommandLine/,
  );
  assert.match(invocation.args.join(' '), /--type=\(\[A-Za-z0-9_-\]\+\)/);
  assert.doesNotMatch(
    invocation.args.join(' '),
    /Select-Object ProcessId,ParentProcessId,Name,CommandLine/,
  );
  assert.doesNotMatch(invocation.args.join(' '), /ExecutablePath/);
  assert.deepEqual(
    captureOwnedBrowserProcessTree(fakeBrowserProcess(), {
      platform: 'darwin',
      execFile: () => assert.fail('unsupported platform must not invoke query'),
    }),
    { status: 'unavailable', reason: 'unsupported-platform' },
  );
  assert.deepEqual(
    captureOwnedBrowserProcessTree(fakeBrowserProcess(), {
      platform: 'win32',
      timeoutMs: 10_000,
      execFile: () => assert.fail('invalid deadline must not invoke query'),
    }),
    { status: 'unavailable', reason: 'process-snapshot-limits-invalid' },
  );
  assert.deepEqual(
    captureOwnedBrowserProcessTree(fakeBrowserProcess(), {
      platform: 'win32',
      execFile: () => 'x'.repeat(12_001),
    }),
    { status: 'unavailable', reason: 'process-list-overflow' },
  );
  assert.equal(
    captureOwnedBrowserProcessTree(fakeBrowserProcess(), {
      platform: 'win32',
      execFile: () =>
        JSON.stringify({
          rows: [{ pid: 1234, ppid: 1, image: 'chrome.exe' }],
          truncated: false,
        }),
    }).rows[0].category,
    'unavailable',
  );
  assert.deepEqual(
    captureOwnedBrowserProcessTree(fakeBrowserProcess(), {
      platform: 'win32',
      execFile: () =>
        JSON.stringify({
          rows: [
            { pid: 1234, ppid: 1, image: 'chrome.exe', category: 'browser' },
          ],
        }),
    }),
    { status: 'unavailable', reason: 'process-list-invalid' },
  );
});

test(
  'PowerShell skips command-line queries when the owned root is absent',
  {
    skip: process.platform !== 'win32',
  },
  async (t) => {
    const prefix = [
      '$script:commandLineQueryCalled = $false',
      'function Get-CimInstance {',
      '  [CmdletBinding()]',
      '  param([Parameter(Position=0)][string]$ClassName, [string[]]$Property, [string]$Filter)',
      '  if ($Property -contains "CommandLine") { $script:commandLineQueryCalled = $true; return @() }',
      '  return @([pscustomobject]@{ ProcessId=1234; ParentProcessId=1; Name="unrelated.exe" })',
      '}',
    ].join('\n');
    const script = [
      prefix,
      createOwnedProcessTreePowerShellCommand(9999, 64),
      'if ($script:commandLineQueryCalled) { "COMMAND_LINE_QUERY_RAN" } else { "NO_COMMAND_LINE_QUERY" }',
    ].join('\n');
    const result = await runPowerShellIntegrationScript(script, t);
    const { output } = result;
    assert.match(output, /NO_COMMAND_LINE_QUERY/);
    assert.doesNotMatch(output, /COMMAND_LINE_QUERY_RAN/);
  },
);

test(
  'PowerShell derives roles only from command lines for owned process IDs',
  {
    skip: process.platform !== 'win32',
  },
  async (t) => {
    const prefix = [
      '$script:commandLineFilter = $null',
      'function Get-CimInstance {',
      '  [CmdletBinding()]',
      '  param([Parameter(Position=0)][string]$ClassName, [string[]]$Property, [string]$Filter)',
      '  if ($Property -contains "CommandLine") {',
      '    $script:commandLineFilter = $Filter',
      '    return @(',
      '      [pscustomobject]@{ ProcessId=1234; CommandLine="chrome.exe --user-data-dir=C:\\private" },',
      '      [pscustomobject]@{ ProcessId=1235; CommandLine="chrome.exe --type=renderer --user-data-dir=C:\\private" }',
      '    )',
      '  }',
      '  return @(',
      '    [pscustomobject]@{ ProcessId=1234; ParentProcessId=1; Name="chrome.exe" },',
      '    [pscustomobject]@{ ProcessId=1235; ParentProcessId=1234; Name="chrome.exe" },',
      '    [pscustomobject]@{ ProcessId=9999; ParentProcessId=1; Name="unrelated.exe" }',
      '  )',
      '}',
    ].join('\n');
    const script = [
      prefix,
      createOwnedProcessTreePowerShellCommand(1234, 64),
      'if ($script:commandLineFilter -ne "ProcessId = 1234 OR ProcessId = 1235") { throw "owned PID filter mismatch" }',
    ].join('\n');
    const result = await runPowerShellIntegrationScript(script, t);
    const { output } = result;
    assert.match(output, /"category":"browser"/);
    assert.match(output, /"category":"renderer"/);
    assert.doesNotMatch(output, /C:\\\\private|user-data-dir/);
  },
);

test('process snapshot failure remains unavailable instead of affecting cleanup', () => {
  assert.deepEqual(
    captureOwnedBrowserProcessTree(fakeBrowserProcess(), {
      platform: 'win32',
      execFile: () => {
        const error = new Error('private path');
        error.code = 'ETIMEDOUT';
        throw error;
      },
    }),
    { status: 'unavailable', reason: 'process-snapshot-timeout' },
  );
});

test('SystemInfo process inventory keeps only bounded roles and IDs', () => {
  const inventory = summarizeBrowserProcessInfo({
    processInfo: [
      {
        type: 'browser',
        id: 100,
        cpuTime: 123.4,
        commandLine: 'private browser command line',
      },
      { type: 'GPU', id: 102, cpuTime: 8 },
      { type: 'renderer', id: 101, cpuTime: 9 },
      { type: 'future process', id: 103 },
    ]
      .reverse()
      .concat(
        Array.from({ length: 65 }, (_, index) => ({
          type: 'utility',
          id: index + 200,
          commandLine: 'must not be retained',
        })),
      ),
  });
  assert.equal(inventory.status, 'available');
  assert.equal(inventory.processCount, 69);
  assert.equal(inventory.rows.length, 64);
  assert.equal(inventory.truncated, true);
  assert.deepEqual(inventory.rows.slice(0, 4), [
    { id: 100, role: 'browser' },
    { id: 101, role: 'renderer' },
    { id: 102, role: 'gpu' },
    { id: 103, role: 'other' },
  ]);
  assert.equal(inventory.retainedFields.join(','), 'id,role');
  assert.equal(JSON.stringify(inventory).includes('commandLine'), false);
  assert.equal(JSON.stringify(inventory).includes('cpuTime'), false);
  assert.equal(JSON.stringify(inventory).includes('private'), false);
  assert.equal(
    summarizeBrowserProcessInfo({ processInfo: Array(513).fill({}) }).reason,
    'process-info-overflow',
  );
  assert.equal(
    summarizeBrowserProcessInfo({
      processInfo: [
        { id: 1, type: 'renderer' },
        { id: 1, type: 'renderer' },
      ],
    }).reason,
    'process-info-list-invalid',
  );
  assert.equal(
    summarizeBrowserProcessInfo({ processInfo: [] }, 65).reason,
    'process-info-limit-invalid',
  );
});

test('browser process inventory uses only the existing owned CDP connection', async () => {
  const calls = [];
  let disposeCount = 0;
  const connection = {
    async send(method, params, options) {
      calls.push({ method, params, options });
      return { processInfo: [{ type: 'browser', id: 1234 }] };
    },
    dispose() {
      disposeCount += 1;
    },
  };
  const browser = {
    _connection: connection,
    target() {
      assert.fail('process inventory must not create a target session');
    },
  };
  assert.deepEqual(await readRecoveryBrowserProcessInfo(browser), {
    processInfo: [{ type: 'browser', id: 1234 }],
  });
  assert.deepEqual(calls, [
    {
      method: 'SystemInfo.getProcessInfo',
      params: {},
      options: { timeout: 800 },
    },
  ]);
  assert.equal(disposeCount, 0);
  assert.equal(
    calls.some(({ method }) =>
      ['Target.attachToTarget', 'Target.detachFromTarget'].includes(method),
    ),
    false,
  );
});

test('browser process inventory bounds the command and rejects when the owned connection is unavailable', async () => {
  const calls = [];
  await readRecoveryBrowserProcessInfo(
    {
      _connection: {
        async send(...args) {
          calls.push(args);
          return { processInfo: [] };
        },
      },
    },
    { timeoutMs: 37 },
  );
  assert.deepEqual(calls, [['SystemInfo.getProcessInfo', {}, { timeout: 37 }]]);
  await assert.rejects(
    readRecoveryBrowserProcessInfo(
      { target: () => ({ createCDPSession: async () => ({}) }) },
      {},
    ),
    (error) => error.code === 'GEV_CDP_CONNECTION_UNAVAILABLE',
  );
});

test('late SystemInfo reply after the owned command timeout has no session cleanup side effects', async () => {
  let resolveLateReply;
  let rejectCommand;
  let disposeCount = 0;
  const connection = {
    send(method, params, options) {
      assert.equal(method, 'SystemInfo.getProcessInfo');
      assert.deepEqual(params, {});
      assert.equal(options.timeout, 40);
      return new Promise((resolve, reject) => {
        resolveLateReply = resolve;
        rejectCommand = reject;
      });
    },
    dispose() {
      disposeCount += 1;
    },
  };
  const pending = readRecoveryBrowserProcessInfo(
    { _connection: connection },
    { timeoutMs: 40 },
  );
  const error = new Error('CDP command timeout');
  error.code = 'ETIMEDOUT';
  rejectCommand(error);
  await assert.rejects(pending, (actual) => actual === error);
  resolveLateReply({ processInfo: [{ type: 'browser', id: 1234 }] });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(disposeCount, 0);
});

test('owned process-info command timeout does not issue attach or detach protocol commands', async () => {
  const commands = [];
  const connection = {
    async send(method, params, options) {
      commands.push(method);
      assert.equal(options.timeout, 25);
      const error = new Error('command timed out');
      error.code = 'ETIMEDOUT';
      throw error;
    },
  };
  await assert.rejects(
    readRecoveryBrowserProcessInfo(
      { _connection: connection },
      { timeoutMs: 25 },
    ),
    (error) => error.code === 'ETIMEDOUT',
  );
  assert.deepEqual(commands, ['SystemInfo.getProcessInfo']);
});

test('owned browser PID presence reports only bounded read-only status and its reuse limit', () => {
  const child = fakeBrowserProcess({ pid: 1234 });
  const calls = [];
  assert.deepEqual(
    observeOwnedBrowserPidPresence(child, {
      platform: 'win32',
      killProcess: (...args) => calls.push(args),
    }),
    {
      status: 'present',
      pid: 1234,
      source: 'owned-pid-presence-only',
      identityConfirmed: false,
      pidReusePossible: true,
    },
  );
  assert.deepEqual(calls, [[1234, 0]]);
  assert.deepEqual(
    observeOwnedBrowserPidPresence(child, {
      platform: 'win32',
      killProcess: () => {
        const error = new Error('private path');
        error.code = 'ESRCH';
        throw error;
      },
    }),
    { status: 'absent', pid: 1234, source: 'owned-pid-presence-only' },
  );
  assert.equal(
    observeOwnedBrowserPidPresence(child, {
      platform: 'win32',
      killProcess: () => {
        const error = new Error('private path');
        error.code = 'EPERM';
        throw error;
      },
    }).reason,
    'owned-pid-presence-permission-denied',
  );
  assert.deepEqual(
    observeOwnedBrowserPidPresence(child, { platform: 'linux' }),
    { status: 'unavailable', reason: 'unsupported-platform' },
  );
  child.exitCode = 0;
  assert.deepEqual(
    observeOwnedBrowserPidPresence(child, {
      platform: 'win32',
      killProcess: () => assert.fail('must not probe a confirmed exited child'),
    }),
    { status: 'exited', pid: 1234, source: 'child-exit-observed' },
  );
});

test('close diagnostics capture target types and process tree before forced cleanup', async () => {
  const child = fakeBrowserProcess();
  const browser = new EventEmitter();
  const order = [];
  browser.process = () => child;
  browser.isConnected = () => true;
  browser.targets = () => [
    { type: () => 'page', url: () => 'https://private.invalid/path?secret=1' },
    { type: () => 'service_worker' },
    { type: () => 'future-target-type' },
  ];
  browser.close = () => {
    browser.emit('disconnected');
    return new Promise(() => {});
  };
  const outcome = await closeRecoveryBrowser(browser, {
    timeoutMs: 15,
    shutdownDiagnostics: {
      processTreeSnapshot: (ownedChild) => {
        order.push('process-snapshot');
        assert.equal(ownedChild, child);
        return {
          status: 'available',
          rootPid: child.pid,
          rows: [
            {
              pid: child.pid,
              ppid: 1,
              image: 'chrome.exe',
              category: 'browser',
            },
          ],
          processCount: 1,
          truncated: false,
        };
      },
    },
    forceProcess: async () => {
      order.push('forced-cleanup');
      return { attempted: true, confirmed: false, reason: 'request-failed' };
    },
  });

  assert.deepEqual(order, ['process-snapshot', 'forced-cleanup']);
  assert.equal(outcome.closeCompleted, false);
  assert.equal(outcome.forcedProcessTermination, false);
  const diagnostics = outcome.observation.shutdownDiagnostics;
  assert.equal(diagnostics.targetTypeCounts.beforeClose.status, 'available');
  assert.deepEqual(diagnostics.targetTypeCounts.beforeClose.counts, {
    background_page: 0,
    browser: 0,
    page: 1,
    service_worker: 1,
    shared_worker: 0,
    webview: 0,
    worker: 0,
    other: 1,
  });
  assert.equal(
    diagnostics.targetTypeCounts.atDisconnect.reason,
    'browser-disconnected',
  );
  assert.equal(
    diagnostics.targetTypeCounts.atTimeout.reason,
    'browser-disconnected',
  );
  assert.equal(diagnostics.processTreeBeforeForce.processCount, 1);
  assert.equal(JSON.stringify(diagnostics).includes('private.invalid'), false);
  assert.equal(JSON.stringify(diagnostics).includes('secret=1'), false);
  assert.equal(browser.listenerCount('disconnected'), 0);
  assert.equal(child.listenerCount('exit'), 0);
});

test('pre-close SystemInfo observation is bounded and excluded from the close deadline', async () => {
  let clock = 100;
  const order = [];
  const browser = new EventEmitter();
  browser.process = () => fakeBrowserProcess();
  browser.isConnected = () => true;
  browser.targets = () => [];
  browser.close = async () => {
    order.push('browser-close');
    clock += 25;
  };
  const outcome = await closeRecoveryBrowser(browser, {
    timeoutMs: 50,
    now: () => clock,
    shutdownDiagnostics: {
      systemInfoSnapshot: async () => {
        order.push('system-info');
        clock += 900;
        return {
          processInfo: [
            { type: 'browser', id: 1234, cpuTime: 91, commandLine: 'secret' },
          ],
        };
      },
    },
  });

  assert.equal(outcome.closeCompleted, true);
  assert.deepEqual(order, ['system-info', 'browser-close']);
  assert.equal(outcome.observation.closeElapsedMs, 25);
  assert.equal(
    outcome.observation.shutdownDiagnostics.preCloseDiagnosticsElapsedMs,
    900,
  );
  assert.deepEqual(
    outcome.observation.shutdownDiagnostics.browserProcessInfoBeforeClose.rows,
    [{ id: 1234, role: 'browser' }],
  );
  assert.equal(
    JSON.stringify(outcome.observation.shutdownDiagnostics).includes('secret'),
    false,
  );
});

test('a timed out SystemInfo probe is marked unavailable and does not change the close gate', async () => {
  const browser = new EventEmitter();
  browser.process = () => fakeBrowserProcess();
  browser.isConnected = () => true;
  browser.targets = () => [];
  browser.close = () => new Promise(() => {});
  let forced = false;
  const outcome = await closeRecoveryBrowser(browser, {
    timeoutMs: 12,
    processInfoTimeoutMs: 5,
    platform: 'win32',
    killProcess: () => {},
    shutdownDiagnostics: { systemInfoSnapshot: () => new Promise(() => {}) },
    forceProcess: async () => {
      forced = true;
      return { attempted: true, confirmed: false, reason: 'request-failed' };
    },
  });

  assert.equal(outcome.closeCompleted, false);
  assert.equal(outcome.observation.closeDeadlineMs, 12);
  assert.equal(outcome.observation.closeStatus, 'timed-out');
  assert.equal(forced, true);
  assert.deepEqual(
    outcome.observation.shutdownDiagnostics.browserProcessInfoBeforeClose,
    { status: 'unavailable', reason: 'process-info-timeout' },
  );
  assert.equal(
    outcome.observation.shutdownDiagnostics.ownedPidPresence.atTimeout.status,
    'present',
  );
  assert.equal(
    outcome.observation.shutdownDiagnostics.ownedPidPresence
      .afterForceCheckpoint.status,
    'present',
  );
});

test('a late SystemInfo response after its diagnostic deadline cannot replace the recorded timeout', async () => {
  let resolveProcessInfo;
  const lateProcessInfo = new Promise((resolve) => {
    resolveProcessInfo = resolve;
  });
  const browser = new EventEmitter();
  browser.process = () => fakeBrowserProcess({ exitCode: 0 });
  browser.isConnected = () => true;
  browser.targets = () => [];
  browser.close = async () => {};
  const outcome = await closeRecoveryBrowser(browser, {
    timeoutMs: 20,
    processInfoTimeoutMs: 5,
    shutdownDiagnostics: { systemInfoSnapshot: () => lateProcessInfo },
  });

  assert.equal(outcome.closeCompleted, true);
  assert.deepEqual(
    outcome.observation.shutdownDiagnostics.browserProcessInfoBeforeClose,
    { status: 'unavailable', reason: 'process-info-timeout' },
  );
  resolveProcessInfo({ processInfo: [{ type: 'browser', id: 1234 }] });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(
    outcome.observation.shutdownDiagnostics.browserProcessInfoBeforeClose,
    { status: 'unavailable', reason: 'process-info-timeout' },
  );
});

test('CDP unsupported and permission failures remain diagnostic-only', async () => {
  for (const [code, expectedReason] of [
    [-32601, 'process-info-unsupported'],
    ['EPERM', 'process-info-permission-denied'],
    ['ESRCH', 'process-info-connection-lost'],
  ]) {
    const browser = new EventEmitter();
    browser.process = () => fakeBrowserProcess();
    browser.isConnected = () => true;
    browser.targets = () => [];
    browser.close = async () => {};
    const outcome = await closeRecoveryBrowser(browser, {
      shutdownDiagnostics: {
        systemInfoSnapshot: async () => {
          const error = new Error('sensitive protocol details');
          error.code = code;
          throw error;
        },
      },
    });

    assert.equal(outcome.closeCompleted, true);
    assert.deepEqual(
      outcome.observation.shutdownDiagnostics.browserProcessInfoBeforeClose,
      { status: 'unavailable', reason: expectedReason },
    );
    assert.equal(JSON.stringify(outcome).includes('sensitive'), false);
  }
});

test('pinned Puppeteer CDP errors are classified without retaining protocol text', async () => {
  const cases = [
    {
      label: 'timeout',
      expected: 'process-info-timeout',
      timeoutMs: 8,
      respond: () => {},
    },
    {
      label: 'unsupported',
      expected: 'process-info-unsupported',
      respond(request, transport) {
        setImmediate(() =>
          transport.onmessage(
            JSON.stringify({
              id: request.id,
              error: {
                code: -32601,
                message: "'SystemInfo.getProcessInfo' wasn't found",
              },
            }),
          ),
        );
      },
    },
    {
      label: 'unknown protocol failure',
      expected: 'process-info-query-failed',
      respond(request, transport) {
        setImmediate(() =>
          transport.onmessage(
            JSON.stringify({
              id: request.id,
              error: { code: -32000, message: 'sensitive transport detail' },
            }),
          ),
        );
      },
    },
    {
      label: 'connection closed',
      expected: 'process-info-connection-lost',
      closeBeforeSend: true,
    },
  ];

  for (const scenario of cases) {
    const sentMethods = [];
    let transportClosed = false;
    let connection;
    const transport = {
      send(message) {
        const request = JSON.parse(message);
        sentMethods.push(request.method);
        scenario.respond?.(request, transport);
      },
      close() {
        transportClosed = true;
      },
      onmessage: undefined,
      onclose: undefined,
    };
    connection = new Connection(
      'ws://owned-browser.test/devtools/browser',
      transport,
      0,
      undefined,
      false,
    );
    if (scenario.closeBeforeSend) transport.onclose();

    const browser = new EventEmitter();
    browser._connection = connection;
    browser.process = () => fakeBrowserProcess();
    browser.isConnected = () => true;
    browser.targets = () => [];
    browser.close = async () => {};
    const outcome = await closeRecoveryBrowser(browser, {
      processInfoTimeoutMs: 100,
      shutdownDiagnostics: {
        systemInfoSnapshot: () =>
          readRecoveryBrowserProcessInfo(browser, {
            timeoutMs: scenario.timeoutMs ?? 100,
          }),
      },
    });

    assert.equal(outcome.closeCompleted, true, scenario.label);
    assert.equal(
      outcome.observation.shutdownDiagnostics.browserProcessInfoBeforeClose
        .reason,
      scenario.expected,
      scenario.label,
    );
    assert.deepEqual(
      sentMethods,
      scenario.closeBeforeSend ? [] : ['SystemInfo.getProcessInfo'],
      scenario.label,
    );
    assert.equal(
      connection.getPendingProtocolErrors().length,
      0,
      scenario.label,
    );
    assert.equal(transportClosed, false, scenario.label);
    if (!scenario.closeBeforeSend) assert.equal(connection._closed, false);
    assert.doesNotMatch(
      JSON.stringify(outcome),
      /wasn't found|timed out|Protocol error|Connection closed|sensitive transport/,
      scenario.label,
    );
  }
});

test('shutdown diagnostic errors do not prevent forced cleanup or alter failed close', async () => {
  const child = fakeBrowserProcess();
  const browser = new EventEmitter();
  let forced = false;
  browser.process = () => child;
  browser.isConnected = () => true;
  browser.targets = () => {
    throw new Error('target query contains private data');
  };
  browser.close = () => new Promise(() => {});
  const outcome = await closeRecoveryBrowser(browser, {
    timeoutMs: 10,
    shutdownDiagnostics: {
      processTreeSnapshot: () => {
        throw new Error('process path must not be retained');
      },
    },
    forceProcess: async () => {
      forced = true;
      return { attempted: true, confirmed: true };
    },
  });
  assert.equal(outcome.closeCompleted, false);
  assert.equal(outcome.forcedProcessTermination, true);
  assert.equal(forced, true);
  assert.equal(
    outcome.observation.shutdownDiagnostics.targetTypeCounts.beforeClose.reason,
    'target-query-failed',
  );
  assert.equal(
    outcome.observation.shutdownDiagnostics.processTreeBeforeForce.reason,
    'process-snapshot-failed',
  );
  assert.equal(JSON.stringify(outcome).includes('private data'), false);
  assert.equal(JSON.stringify(outcome).includes('process path'), false);
});

test('timeout target inventory is captured when the browser has not disconnected', async () => {
  const browser = new EventEmitter();
  browser.process = () => fakeBrowserProcess();
  browser.isConnected = () => true;
  browser.targets = () => [{ type: () => 'page' }];
  browser.close = () => new Promise(() => {});
  const outcome = await closeRecoveryBrowser(browser, {
    timeoutMs: 10,
    shutdownDiagnostics: {
      processTreeSnapshot: () => ({
        status: 'unavailable',
        reason: 'not-needed',
      }),
    },
    forceProcess: async () => ({ attempted: true, confirmed: false }),
  });

  assert.equal(outcome.closeCompleted, false);
  assert.equal(
    outcome.observation.shutdownDiagnostics.targetTypeCounts.atTimeout.status,
    'available',
  );
  assert.equal(
    outcome.observation.shutdownDiagnostics.targetTypeCounts.atTimeout.counts
      .page,
    1,
  );
});

test('pre-close diagnostics do not extend close timing and timing origins stay explicit', async () => {
  let clock = 100;
  const child = fakeBrowserProcess();
  const browser = new EventEmitter();
  browser.process = () => child;
  browser.isConnected = () => true;
  browser.targets = () => {
    clock += 900;
    child.exitCode = 0;
    child.emit('exit', 0, null);
    return [];
  };
  browser.close = async () => {
    clock += 20;
  };
  const outcome = await closeRecoveryBrowser(browser, {
    timeoutMs: 50,
    now: () => clock,
    shutdownDiagnostics: true,
  });

  assert.equal(outcome.closeCompleted, true);
  assert.equal(outcome.observation.closeElapsedMs, 20);
  assert.equal(outcome.observation.processExit.elapsedMs, 900);
  assert.deepEqual(outcome.observation.timingOrigins, {
    closeElapsedMs: 'browser.close invocation',
    processExitElapsedMs: 'closeRecoveryBrowser entry',
    preCloseDiagnosticsElapsedMs:
      'bounded shutdown diagnostics before Browser.close invocation',
  });
});

test('owned process stop distinguishes pre-existing exit from confirmed taskkill', async () => {
  const exited = fakeBrowserProcess({ exitCode: 0 });
  let spawnCalls = 0;
  assert.deepEqual(
    await stopOwnedRecoveryProcessTree(exited, {
      platform: 'win32',
      spawnImpl: () => {
        spawnCalls += 1;
      },
    }),
    { attempted: false, confirmed: true, reason: 'already-exited' },
  );
  assert.equal(spawnCalls, 0);

  const child = fakeBrowserProcess();
  const killer = new EventEmitter();
  killer.kill = () => false;
  const stopped = await stopOwnedRecoveryProcessTree(child, {
    platform: 'win32',
    spawnImpl: () => {
      queueMicrotask(() => {
        child.exitCode = 0;
        child.emit('exit', 0, null);
        killer.emit('exit', 0);
      });
      return killer;
    },
  });
  assert.deepEqual(stopped, {
    attempted: true,
    confirmed: true,
    reason: 'process-exit-observed',
  });
  assert.equal(killer.listenerCount('exit'), 0);
  assert.equal(killer.listenerCount('error'), 0);
});

test('owned process stop does not claim an exit after failed taskkill and bounds a stuck helper', async () => {
  const child = fakeBrowserProcess();
  const failedKiller = new EventEmitter();
  failedKiller.kill = () => false;
  const failed = await stopOwnedRecoveryProcessTree(child, {
    platform: 'win32',
    spawnImpl: () => {
      queueMicrotask(() => {
        child.exitCode = 0;
        child.emit('exit', 0, null);
        failedKiller.emit('exit', 1);
      });
      return failedKiller;
    },
  });
  assert.deepEqual(failed, {
    attempted: true,
    confirmed: false,
    reason: 'exit-during-failed-request',
  });

  const stuckChild = fakeBrowserProcess();
  const stuckKiller = new EventEmitter();
  let killed = false;
  stuckKiller.kill = () => {
    killed = true;
    return true;
  };
  const timeout = await stopOwnedRecoveryProcessTree(stuckChild, {
    platform: 'win32',
    helperTimeoutMs: 10,
    spawnImpl: () => stuckKiller,
  });
  assert.equal(timeout.reason, 'request-failed');
  assert.equal(timeout.confirmed, false);
  assert.equal(killed, true);
  assert.equal(stuckKiller.listenerCount('exit'), 0);
  assert.equal(stuckKiller.listenerCount('error'), 0);
  assert.equal(stuckChild.listenerCount('exit'), 0);
});

test('browser close records an already-exited process and releases listeners', async () => {
  const child = fakeBrowserProcess({ exitCode: 0 });
  let forced = false;
  const outcome = await closeRecoveryBrowser(
    { process: () => child, close: async () => {} },
    { timeoutMs: 25, forceProcess: async () => (forced = true) },
  );
  assert.equal(outcome.closeCompleted, true);
  assert.equal(outcome.forcedProcessTermination, false);
  assert.equal(forced, false);
  assert.equal(outcome.observation.processExitedBeforeClose, true);
  assert.deepEqual(outcome.observation.processExit, {
    code: 0,
    signal: null,
    elapsedMs: null,
  });
  assert.equal(outcome.observation.forceProcessStatus, 'not-needed');
  assert.equal(outcome.observation.forceProcessAttempted, false);
  assert.equal(child.listenerCount('exit'), 0);
  assert.equal(outcome.observation.closeStatus, 'completed');
  assert.equal(outcome.observation.closeDeadlineMs, 25);
  assert.equal(
    Object.hasOwn(outcome.observation, 'shutdownDiagnostics'),
    false,
  );
});

for (const platform of ['darwin', 'linux']) {
  test(`${platform} fallback signals only the owned process group and waits for observed exit`, async () => {
    const child = fakeBrowserProcess();
    const calls = [];
    const result = await stopOwnedRecoveryProcessTree(child, {
      platform,
      killProcess: (pid, signal) => {
        calls.push({ pid, signal });
        queueMicrotask(() => {
          child.signalCode = signal;
          child.emit('exit', null, signal);
        });
      },
    });
    assert.deepEqual(calls, [{ pid: -child.pid, signal: 'SIGTERM' }]);
    assert.equal(result.attempted, true);
    assert.equal(result.confirmed, true);
    assert.equal(child.listenerCount('exit'), 0);
    const denied = await stopOwnedRecoveryProcessTree(fakeBrowserProcess(), {
      platform,
      killProcess: () => {
        throw new Error('denied');
      },
    });
    assert.equal(denied.confirmed, false);
    const live = fakeBrowserProcess();
    const unobserved = await stopOwnedRecoveryProcessTree(live, {
      platform,
      killProcess: () => {},
      exitTimeoutMs: 5,
    });
    assert.equal(unobserved.confirmed, false);
    assert.equal(live.listenerCount('exit'), 0);
  });
}

test('close trace ignores unrelated and pre-close protocol text without retaining it', () => {
  let now = 10;
  const trace = createRecoveryBrowserCloseTrace({ now: () => now });
  const send = trace.logger('puppeteer:protocol:SEND Ã¢â€“Â¶');
  const receive = trace.logger('puppeteer:protocol:RECV Ã¢â€”â‚¬');
  const unrelated = trace.logger('puppeteer:error');
  assert.equal(unrelated, undefined);
  send(JSON.stringify({ method: 'Browser.close', id: 4, secret: 'before' }));
  trace.begin();
  send(JSON.stringify({ method: 'Page.navigate', id: 5, url: 'secret-url' }));
  receive(JSON.stringify({ id: 5, result: { secret: 'response' } }));
  now = 15;
  send(JSON.stringify({ method: 'Browser.close', id: 6 }));
  receive(JSON.stringify({ id: 6, sessionId: 'worker-session', result: {} }));
  receive(JSON.stringify({ id: 6, method: 'Target.attachedToTarget' }));
  const active = trace.snapshot(5);
  assert.equal(active.browserCloseRequestSeen, true);
  assert.equal(active.browserCloseAcknowledgementSeen, false);
  const summary = trace.finish(5);
  assert.equal(summary.browserCloseRequestSeen, true);
  assert.equal(summary.browserCloseAcknowledgementSeen, false);
  assert.equal(summary.protocolMessageCount, 5);
  assert.equal(JSON.stringify(summary).includes('secret'), false);
  send(JSON.stringify({ method: 'Browser.close', id: 6 }));
  assert.equal(trace.finish(5), null);
});

test('close trace correlates Browser.close acknowledgement but keeps process wait separate', async () => {
  const child = fakeBrowserProcess();
  const trace = createRecoveryBrowserCloseTrace();
  const send = trace.logger('puppeteer:protocol:SEND Ã¢â€“Â¶');
  const receive = trace.logger('puppeteer:protocol:RECV Ã¢â€”â‚¬');
  const browser = new EventEmitter();
  browser.process = () => child;
  browser.close = () => {
    send(
      JSON.stringify({
        method: 'Browser.close',
        id: 42,
        params: { secretUrl: 'https://private.invalid/?token=secret' },
      }),
    );
    receive(JSON.stringify({ id: 42, result: {} }));
    browser.emit('disconnected');
    return new Promise(() => {});
  };
  const outcome = await closeRecoveryBrowser(browser, {
    timeoutMs: 20,
    postDisconnectExitTimeoutMs: 5,
    closeTrace: trace,
    forceProcess: async () => {
      child.exitCode = 0;
      child.emit('exit', 0, null);
      return { attempted: true, confirmed: true };
    },
  });
  const protocol = outcome.observation.protocolCloseTrace;
  assert.equal(outcome.closeCompleted, false);
  assert.equal(outcome.observation.closeStatus, 'timed-out');
  assert.equal(outcome.observation.postDisconnectExitWaitAttempted, true);
  assert.equal(outcome.observation.effectiveCloseDeadlineMs, 25);
  assert.equal(protocol.browserCloseRequestSeen, true);
  assert.equal(protocol.browserCloseAcknowledgementSeen, true);
  assert.equal(protocol.browserCloseAcknowledgementError, false);
  assert.equal(protocol.browserCloseAcknowledgementLate, false);
  assert.equal(protocol.protocolObservationComplete, true);
  assert.equal(protocol.browserDisconnected, true);
  assert.equal(outcome.observation.processExit.code, 0);
  assert.equal(browser.listenerCount('disconnected'), 0);
  assert.equal(child.listenerCount('exit'), 0);
  assert.equal(JSON.stringify(protocol).includes('secret'), false);
});

test('acknowledged disconnect receives a separate bounded process-drain window', async () => {
  const child = fakeBrowserProcess();
  const trace = createRecoveryBrowserCloseTrace();
  const send = trace.logger('puppeteer:protocol:SEND');
  const receive = trace.logger('puppeteer:protocol:RECV');
  const browser = new EventEmitter();
  let forced = false;
  browser.process = () => child;
  browser.close = () => {
    send(JSON.stringify({ method: 'Browser.close', id: 73 }));
    receive(JSON.stringify({ id: 73, result: {} }));
    browser.emit('disconnected');
    return new Promise((resolve) => {
      setTimeout(() => {
        child.exitCode = 0;
        child.emit('exit', 0, null);
        resolve();
      }, 25);
    });
  };
  const outcome = await closeRecoveryBrowser(browser, {
    timeoutMs: 10,
    postDisconnectExitTimeoutMs: 100,
    closeTrace: trace,
    forceProcess: async () => {
      forced = true;
      return { attempted: true, confirmed: true };
    },
  });
  assert.equal(outcome.closeCompleted, true);
  assert.equal(outcome.observation.closeStatus, 'completed');
  assert.equal(outcome.observation.closeDeadlineMs, 10);
  assert.equal(outcome.observation.effectiveCloseDeadlineMs, 110);
  assert.equal(outcome.observation.postDisconnectExitWaitAttempted, true);
  assert.equal(
    outcome.observation.protocolCloseTrace.browserDisconnected,
    true,
  );
  assert.equal(outcome.observation.processExit.code, 0);
  assert.equal(forced, false);
});

test('close trace distinguishes missing and late acknowledgements and bounds messages', () => {
  let now = 0;
  const trace = createRecoveryBrowserCloseTrace({ now: () => now });
  const send = trace.logger('puppeteer:protocol:SEND Ã¢â€“Â¶');
  const receive = trace.logger('puppeteer:protocol:RECV Ã¢â€”â‚¬');
  trace.begin();
  send(JSON.stringify({ method: 'Browser.close', id: 12 }));
  now = 25;
  receive(JSON.stringify({ id: 12, result: {} }));
  const late = trace.finish(20);
  assert.equal(late.browserCloseAcknowledgementSeen, true);
  assert.equal(late.browserCloseAcknowledgementLate, true);

  const errorTrace = createRecoveryBrowserCloseTrace({ now: () => now });
  const errorSend = errorTrace.logger('puppeteer:protocol:SEND Ã¢â€“Â¶');
  const errorReceive = errorTrace.logger('puppeteer:protocol:RECV Ã¢â€”â‚¬');
  errorTrace.begin();
  errorSend(JSON.stringify({ method: 'Browser.close', id: 13 }));
  errorReceive(
    JSON.stringify({ id: 13, error: { message: 'sensitive protocol error' } }),
  );
  const rejectedAck = errorTrace.finish(100);
  assert.equal(rejectedAck.browserCloseAcknowledgementSeen, true);
  assert.equal(rejectedAck.browserCloseAcknowledgementError, true);
  assert.equal(JSON.stringify(rejectedAck).includes('sensitive'), false);

  const missingTrace = createRecoveryBrowserCloseTrace({ now: () => now });
  const missingSend = missingTrace.logger('puppeteer:protocol:SEND Ã¢â€“Â¶');
  missingTrace.begin();
  missingSend('{ malformed Browser.close');
  const missing = missingTrace.finish(20);
  assert.equal(missing.browserCloseRequestSeen, false);
  assert.equal(missing.browserCloseAcknowledgementSeen, false);
  assert.equal(missing.malformedCloseMessage, true);
  assert.equal(missing.protocolObservationComplete, true);

  const boundedTrace = createRecoveryBrowserCloseTrace({ now: () => now });
  const boundedSend = boundedTrace.logger('puppeteer:protocol:SEND Ã¢â€“Â¶');
  boundedTrace.begin();
  for (let index = 0; index < 65; index++)
    boundedSend(JSON.stringify({ method: 'Page.reload', id: index }));
  const bounded = boundedTrace.finish(20);
  assert.equal(bounded.protocolMessageCount, 64);
  assert.equal(bounded.protocolMessageOverflow, true);
  assert.equal(bounded.protocolObservationComplete, false);
});

test('an exited process with an unresolved close acknowledgement remains a failure', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const child = fakeBrowserProcess();
  let elapsedMs = 0;
  let forced = false;
  let settled = false;
  const pending = closeRecoveryBrowser(
    {
      process: () => child,
      close: () => {
        child.exitCode = 0;
        child.emit('exit', 0, null);
        return new Promise(() => {});
      },
    },
    {
      timeoutMs: 20,
      now: () => elapsedMs,
      forceProcess: async () => {
        forced = true;
        return { attempted: true, confirmed: true };
      },
    },
  ).then((result) => {
    settled = true;
    return result;
  });
  await new Promise(setImmediate);
  elapsedMs = 19;
  t.mock.timers.tick(19);
  await new Promise(setImmediate);
  assert.equal(settled, false);
  assert.equal(forced, false);
  elapsedMs = 20;
  t.mock.timers.tick(1);
  await new Promise(setImmediate);
  assert.equal(
    settled,
    true,
    'the declared deadline must settle the operation',
  );
  const outcome = await pending;
  assert.equal(outcome.observation.closeDeadlineMs, 20);
  assert.equal(outcome.observation.closeElapsedMs, 20);
  assert.equal(outcome.closeCompleted, false);
  assert.equal(outcome.forcedProcessTermination, false);
  assert.equal(forced, false);
  assert.equal(outcome.observation.closeStatus, 'timed-out');
  assert.equal(outcome.observation.processExitedBeforeClose, false);
  assert.equal(outcome.observation.processExit.code, 0);
  assert.equal(outcome.observation.forceProcessStatus, 'already-exited');
  assert.equal(outcome.observation.forceProcessAttempted, false);
  assert.equal(child.listenerCount('exit'), 0);
});

test('a live process timeout invokes bounded owned-process cleanup and stays failed', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const child = fakeBrowserProcess();
  let forced = 0;
  let elapsedMs = 0;
  let settled = false;
  const pending = closeRecoveryBrowser(
    { process: () => child, close: () => new Promise(() => {}) },
    {
      timeoutMs: 20,
      now: () => elapsedMs,
      forceProcess: async () => {
        forced += 1;
        return { attempted: true, confirmed: true };
      },
    },
  ).then((result) => {
    settled = true;
    return result;
  });
  await new Promise(setImmediate);
  elapsedMs = 19;
  t.mock.timers.tick(19);
  await new Promise(setImmediate);
  assert.equal(settled, false);
  assert.equal(forced, 0);
  elapsedMs = 20;
  t.mock.timers.tick(1);
  await new Promise(setImmediate);
  assert.equal(
    settled,
    true,
    'the declared deadline must settle the operation',
  );
  const outcome = await pending;
  assert.equal(outcome.observation.closeDeadlineMs, 20);
  assert.equal(outcome.observation.closeElapsedMs, 20);
  assert.equal(forced, 1);
  assert.equal(outcome.closeCompleted, false);
  assert.equal(outcome.forcedProcessTermination, true);
  assert.equal(outcome.observation.processExit, null);
  assert.equal(outcome.observation.forceProcessStatus, 'confirmed');
  assert.equal(outcome.observation.forceProcessAttempted, true);
  assert.equal(child.listenerCount('exit'), 0);
  t.mock.timers.tick(100);
  await new Promise(setImmediate);
  assert.equal(forced, 1);
});

test('a hung force callback receives its own bounded deadline after close times out', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const child = fakeBrowserProcess();
  let forced = 0;
  let elapsedMs = 0;
  let settled = false;
  const pending = closeRecoveryBrowser(
    { process: () => child, close: () => new Promise(() => {}) },
    {
      timeoutMs: 20,
      now: () => elapsedMs,
      forceProcess: () => {
        forced += 1;
        return new Promise(() => {});
      },
    },
  ).then((result) => {
    settled = true;
    return result;
  });
  await new Promise(setImmediate);
  elapsedMs = 20;
  t.mock.timers.tick(20);
  await new Promise(setImmediate);
  assert.equal(forced, 1);
  assert.equal(settled, false);
  elapsedMs = 39;
  t.mock.timers.tick(19);
  await new Promise(setImmediate);
  assert.equal(settled, false);
  elapsedMs = 40;
  t.mock.timers.tick(1);
  await new Promise(setImmediate);
  assert.equal(
    settled,
    true,
    'the declared deadline must settle the operation',
  );
  const outcome = await pending;
  assert.equal(outcome.closeCompleted, false);
  assert.equal(outcome.forcedProcessTermination, false);
  assert.equal(outcome.observation.closeElapsedMs, 20);
  assert.equal(outcome.observation.forceProcessElapsedMs, 20);
  assert.equal(outcome.observation.forceProcessStatus, 'timed-out');
  assert.equal(child.listenerCount('exit'), 0);
});

test('a resolved but unconfirmed process stop is not reported as termination', async () => {
  const child = fakeBrowserProcess();
  const outcome = await closeRecoveryBrowser(
    { process: () => child, close: () => new Promise(() => {}) },
    { timeoutMs: 20, forceProcess: async () => ({ attempted: true }) },
  );
  assert.equal(outcome.closeCompleted, false);
  assert.equal(outcome.forcedProcessTermination, false);
  assert.equal(outcome.observation.forceProcessStatus, 'unconfirmed');
  assert.equal(outcome.observation.forceProcessAttempted, true);
});

test('an exit racing with the force callback is not reported as forced termination', async () => {
  const child = fakeBrowserProcess();
  const outcome = await closeRecoveryBrowser(
    { process: () => child, close: () => new Promise(() => {}) },
    {
      timeoutMs: 20,
      forceProcess: async () => {
        child.exitCode = 0;
        child.emit('exit', 0, null);
        return { attempted: false, confirmed: true, reason: 'already-exited' };
      },
    },
  );
  assert.equal(outcome.closeCompleted, false);
  assert.equal(outcome.forcedProcessTermination, false);
  assert.equal(outcome.observation.forceProcessStatus, 'already-exited');
  assert.equal(outcome.observation.forceProcessAttempted, false);
  assert.equal(outcome.observation.forceProcessCallbackInvoked, true);
  assert.equal(outcome.observation.processExit.code, 0);
});

test('close rejection is distinguished and failed forced cleanup is reported', async () => {
  const child = fakeBrowserProcess();
  const failure = Object.assign(new Error('message intentionally omitted'), {
    name: 'ProtocolError',
  });
  const outcome = await closeRecoveryBrowser(
    { process: () => child, close: async () => Promise.reject(failure) },
    {
      timeoutMs: 20,
      forceProcess: async () => {
        throw new Error('force failure');
      },
    },
  );
  assert.equal(outcome.closeCompleted, false);
  assert.equal(outcome.forcedProcessTermination, false);
  assert.equal(outcome.observation.closeStatus, 'rejected');
  assert.equal(outcome.observation.closeRejectionName, 'ProtocolError');
  assert.equal(outcome.observation.forceProcessStatus, 'rejected');
  assert.equal(child.listenerCount('exit'), 0);
  assert.equal(
    JSON.stringify(outcome).includes('message intentionally'),
    false,
  );
  assert.equal(JSON.stringify(outcome).includes('force failure'), false);
});

test('successful close clears the deadline and does not invoke fallback', async () => {
  const child = fakeBrowserProcess();
  let forced = false;
  const outcome = await closeRecoveryBrowser(
    { process: () => child, close: async () => {} },
    {
      timeoutMs: 20,
      forceProcess: async () => {
        forced = true;
      },
    },
  );
  await new Promise((resolve) => setTimeout(resolve, 35));
  assert.equal(outcome.closeCompleted, true);
  assert.equal(outcome.forcedProcessTermination, false);
  assert.equal(outcome.observation.closeStatus, 'completed');
  assert.equal(outcome.observation.forceProcessStatus, 'not-needed');
  assert.equal(forced, false);
  assert.equal(child.listenerCount('exit'), 0);
});

test('cleanup failure becomes primary only after an otherwise-passed check', () => {
  const cleanupError = new Error('Graceful browser close did not complete.');
  const passed = { status: 'passed', pageOwnership: {} };
  assert.deepEqual(applyRecoveryCleanupFailure(passed, cleanupError), {
    becamePrimaryFailure: true,
    shouldThrow: true,
  });
  assert.equal(passed.step, 'owned-page-cleanup');
  assert.equal(passed.error, cleanupError.message);

  const earlierFailure = {
    status: 'failed',
    step: 'application-ready',
    error: 'startup failed',
    pageOwnership: {},
  };
  assert.deepEqual(applyRecoveryCleanupFailure(earlierFailure, cleanupError), {
    becamePrimaryFailure: false,
    shouldThrow: false,
  });
  assert.equal(earlierFailure.step, 'application-ready');
  assert.equal(earlierFailure.error, 'startup failed');
  assert.equal(earlierFailure.pageOwnership.cleanupError, cleanupError.message);
});
