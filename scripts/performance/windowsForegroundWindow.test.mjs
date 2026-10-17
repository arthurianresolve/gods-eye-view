import assert from 'node:assert/strict';
import test from 'node:test';
import {
  focusOwnedWindowsBrowserWindow,
  WINDOWS_FOREGROUND_SCHEMA,
} from './windowsForegroundWindow.mjs';

test('headless and non-Windows captures leave host focus unchanged', async () => {
  let calls = 0;
  const runner = async () => {
    calls += 1;
    throw new Error('must not run');
  };
  assert.equal(
    (
      await focusOwnedWindowsBrowserWindow({
        browserPid: 7,
        enabled: false,
        platform: 'win32',
        runner,
      })
    ).status,
    'disabled',
  );
  assert.equal(
    (
      await focusOwnedWindowsBrowserWindow({
        browserPid: 7,
        platform: 'linux',
        runner,
      })
    ).status,
    'unsupported-platform',
  );
  assert.equal(calls, 0);
});

test('Windows activation accepts only evidence for the owned browser PID', async () => {
  const evidence = await focusOwnedWindowsBrowserWindow({
    browserPid: 42,
    platform: 'win32',
    runner: async (browserPid, timeoutMs) => {
      assert.equal(browserPid, 42);
      assert.equal(timeoutMs, 7500);
      return {
        stdout: JSON.stringify({
          schema: WINDOWS_FOREGROUND_SCHEMA,
          status: 'foreground-confirmed',
          browserPid,
          foregroundConfirmed: true,
        }),
      };
    },
  });
  assert.equal(evidence.browserPid, 42);
  assert.equal(evidence.foregroundConfirmed, true);
});

test('Windows activation retries transient focus arbitration failures within one deadline', async () => {
  let calls = 0;
  const timeouts = [];
  const evidence = await focusOwnedWindowsBrowserWindow({
    browserPid: 42,
    platform: 'win32',
    timeoutMs: 3000,
    runner: async (browserPid, timeoutMs) => {
      calls += 1;
      assert.equal(browserPid, 42);
      assert.ok(timeoutMs > 0 && timeoutMs <= 3000);
      timeouts.push(timeoutMs);
      if (calls < 2) {
        const error = new Error('focus arbitration rejected');
        error.stdout = JSON.stringify({
          schema: WINDOWS_FOREGROUND_SCHEMA,
          status: 'foreground-not-confirmed',
          browserPid,
          foregroundConfirmed: false,
          desktopState: 'interactive',
          windowHandleAvailable: true,
          foregroundPid: 99,
        });
        throw error;
      }
      return {
        stdout: JSON.stringify({
          schema: WINDOWS_FOREGROUND_SCHEMA,
          status: 'foreground-confirmed',
          browserPid,
          foregroundConfirmed: true,
        }),
      };
    },
  });
  assert.equal(calls, 2);
  assert.equal(timeouts[0], 1500);
  assert.equal(evidence.foregroundConfirmed, true);
});

test('Windows activation exposes bounded evidence after retry exhaustion', async () => {
  let calls = 0;
  await assert.rejects(
    focusOwnedWindowsBrowserWindow({
      browserPid: 42,
      platform: 'win32',
      timeoutMs: 3000,
      runner: async (browserPid) => {
        calls += 1;
        const error = new Error('focus arbitration rejected');
        error.stdout = JSON.stringify({
          schema: WINDOWS_FOREGROUND_SCHEMA,
          status: 'foreground-not-confirmed',
          browserPid,
          foregroundConfirmed: false,
          desktopState: 'interactive',
          windowHandleAvailable: true,
          foregroundPid: 99,
        });
        throw error;
      },
    }),
    (error) => {
      assert.equal(error.name, 'HostWindowActivationError');
      assert.match(error.message, /bounded retries/);
      assert.equal(error.activationAttempts.length, 2);
      assert.equal(error.evidence.status, 'foreground-not-confirmed');
      assert.equal(
        error.evidence.runnerFailure.message,
        'focus arbitration rejected',
      );
      return true;
    },
  );
  assert.equal(calls, 2);
});

test('Windows activation preserves bounded runner timeout diagnostics', async () => {
  await assert.rejects(
    focusOwnedWindowsBrowserWindow({
      browserPid: 42,
      platform: 'win32',
      timeoutMs: 3000,
      runner: async () => {
        const error = new Error('runner exceeded its deadline');
        error.code = 'ETIMEDOUT';
        error.signal = 'SIGTERM';
        error.killed = true;
        error.stderr = 'bounded helper timeout';
        throw error;
      },
    }),
    (error) => {
      assert.equal(error.activationAttempts.length, 2);
      assert.deepEqual(error.evidence.runnerFailure, {
        name: 'Error',
        code: 'ETIMEDOUT',
        signal: 'SIGTERM',
        killed: true,
        message: 'runner exceeded its deadline',
        stderr: 'bounded helper timeout',
      });
      return true;
    },
  );
});

test('Windows activation rejects invalid PID, malformed and unconfirmed evidence', async () => {
  await assert.rejects(
    focusOwnedWindowsBrowserWindow({ browserPid: 0, platform: 'win32' }),
    /positive integer/,
  );
  await assert.rejects(
    focusOwnedWindowsBrowserWindow({
      browserPid: 42,
      platform: 'win32',
      runner: async () => ({ stdout: 'not-json' }),
    }),
    /malformed evidence/,
  );
  await assert.rejects(
    focusOwnedWindowsBrowserWindow({
      browserPid: 42,
      platform: 'win32',
      runner: async () => ({
        stdout: JSON.stringify({
          schema: WINDOWS_FOREGROUND_SCHEMA,
          status: 'foreground-not-confirmed',
          browserPid: 42,
          foregroundConfirmed: false,
        }),
      }),
    }),
    /did not confirm/,
  );
});

test('Windows activation retains structured locked-desktop evidence', async () => {
  const evidence = {
    schema: WINDOWS_FOREGROUND_SCHEMA,
    status: 'foreground-not-confirmed',
    browserPid: 77,
    windowHandleAvailable: true,
    windowHandleSource: 'owned-top-level-enumeration',
    foregroundConfirmed: false,
    foregroundPid: 88,
    foregroundProcessName: 'LockApp',
    desktopState: 'locked',
  };
  await assert.rejects(
    focusOwnedWindowsBrowserWindow({
      browserPid: 77,
      platform: 'win32',
      runner: async () => {
        const error = new Error('exit 2');
        error.stdout = JSON.stringify(evidence);
        throw error;
      },
    }),
    (error) => {
      assert.equal(error.name, 'HostWindowActivationError');
      assert.match(error.message, /desktop is locked/);
      assert.deepEqual(error.evidence, evidence);
      assert.equal(error.activationAttempts.length, 1);
      return true;
    },
  );
});
