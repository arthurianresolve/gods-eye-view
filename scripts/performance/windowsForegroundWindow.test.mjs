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
      assert.equal(timeoutMs, 15000);
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
      assert.equal(error.foregroundActivation.category, 'locked');
      assert.equal(error.foregroundActivation.desktopState, 'locked');
      assert.equal(error.foregroundActivation.runnerExited, true);
      assert.equal(error.foregroundActivation.runnerKilled, false);
      return true;
    },
  );
});

test('Windows activation retains bounded pre-evidence process diagnostics', async () => {
  await assert.rejects(
    focusOwnedWindowsBrowserWindow({
      browserPid: 77,
      platform: 'win32',
      runner: async () => {
        const error = new Error('timed out with private stdout');
        // This is the shape produced by Node execFile's timeout option.
        error.code = null;
        error.killed = true;
        error.signal = 'SIGTERM';
        error.gevTimeout = true;
        error.stdout = '';
        error.stderr = 'secret command output';
        throw error;
      },
    }),
    (error) => {
      assert.equal(error.foregroundActivation.category, 'timeout');
      assert.equal(error.foregroundActivation.runnerExited, false);
      assert.equal(error.foregroundActivation.runnerTimedOut, true);
      assert.equal(error.foregroundActivation.runnerKilled, true);
      assert.equal(error.foregroundActivation.runnerSignal, 'SIGTERM');
      assert.equal('runnerErrorCode' in error.foregroundActivation, false);
      assert.equal('stderr' in error.foregroundActivation, false);
      assert.equal('stdout' in error.foregroundActivation, false);
      return true;
    },
  );
  await assert.rejects(
    focusOwnedWindowsBrowserWindow({
      browserPid: 77,
      platform: 'win32',
      runner: async () => {
        const error = new Error('spawn failed');
        error.code = 'ENOENT';
        throw error;
      },
    }),
    (error) => {
      assert.equal(error.foregroundActivation.category, 'process-failure');
      assert.equal(error.foregroundActivation.runnerExited, false);
      assert.equal(error.foregroundActivation.runnerErrorCode, 'ENOENT');
      return true;
    },
  );
});

test('Windows activation marks malformed failure evidence without retaining raw output', async () => {
  await assert.rejects(
    focusOwnedWindowsBrowserWindow({
      browserPid: 77,
      platform: 'win32',
      runner: async () => {
        const error = new Error('exit 2');
        error.stdout = '{"schema":"bad","private":"secret"';
        throw error;
      },
    }),
    (error) => {
      assert.equal(error.foregroundActivation.category, 'malformed-evidence');
      assert.equal(error.foregroundActivation.runnerExited, null);
      assert.equal('stdout' in error.foregroundActivation, false);
      assert.equal('private' in error.foregroundActivation, false);
      return true;
    },
  );
});
