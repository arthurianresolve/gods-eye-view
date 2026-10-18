import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import {
  createWindowsForegroundActivationSession,
  focusOwnedWindowsBrowserWindow,
  WINDOWS_FOREGROUND_SCHEMA,
} from './windowsForegroundWindow.mjs';

class FakePowerShellChild extends EventEmitter {
  constructor() {
    super();
    this.stdout = new EventEmitter();
    this.stdin = {
      writes: [],
      write: (value) => {
        this.stdin.writes.push(value);
        const requestId = Number.parseInt(value.split(':', 1)[0], 10);
        queueMicrotask(() =>
          this.stdout.emit(
            'data',
            `${JSON.stringify({
              schema: WINDOWS_FOREGROUND_SCHEMA,
              requestId,
              status: 'foreground-confirmed',
              browserPid: 42,
              foregroundConfirmed: true,
            })}\n`,
          ),
        );
      },
      end: () => {},
    };
    this.killed = false;
  }

  kill() {
    this.killed = true;
    return true;
  }
}

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

test('Windows activation session reuses one initialized helper and disposes it', async () => {
  const children = [];
  let spawnArguments;
  const session = createWindowsForegroundActivationSession({
    browserPid: 42,
    platform: 'win32',
    spawnImpl: (...args) => {
      spawnArguments = args;
      const child = new FakePowerShellChild();
      children.push(child);
      queueMicrotask(() =>
        child.stdout.emit(
          'data',
          `${JSON.stringify({
            schema: 'gev-windows-owned-browser-foreground-diagnostic/v1',
            status: 'ready',
          })}\n`,
        ),
      );
      return child;
    },
  });
  await session.start({ timeoutMs: 1000 });
  const first = await session.request(42, 1000);
  const second = await session.request(42, 1000);
  assert.match(first.stdout, /foreground-confirmed/);
  assert.match(second.stdout, /foreground-confirmed/);
  assert.equal(children.length, 1);
  assert.equal(children[0].stdin.writes.length, 2);
  assert.match(
    spawnArguments[1][3],
    /while \(\(\$request = \[Console\]::In\.ReadLine\(\)\)/,
  );
  assert.match(
    spawnArguments[1][3],
    /if \(-not \('\GevOwnedBrowserWindow' -as \[type\]\)\)/,
  );
  assert.match(spawnArguments[1][3], /Add-Type -TypeDefinition/);
  assert.match(spawnArguments[1][3], /Out\.WriteLine\(\$response\)/);
  assert.doesNotMatch(spawnArguments[1][3], /exit 2/);
  await session.dispose();
  await session.dispose();
  assert.equal(children[0].killed, true);
});

test('Windows activation session fails closed on request timeout and does not replace the helper', async () => {
  let child;
  const session = createWindowsForegroundActivationSession({
    browserPid: 42,
    platform: 'win32',
    spawnImpl: () => {
      child = new FakePowerShellChild();
      queueMicrotask(() =>
        child.stdout.emit(
          'data',
          `${JSON.stringify({
            schema: 'gev-windows-owned-browser-foreground-diagnostic/v1',
            status: 'ready',
          })}\n`,
        ),
      );
      child.stdin.write = () => {};
      return child;
    },
  });
  await session.start({ timeoutMs: 1000 });
  await assert.rejects(
    session.request(42, 1),
    (error) => error.gevTimeout === true,
  );
  assert.equal(child.killed, true);
  await assert.rejects(session.request(42, 1000), /unavailable/);
  await session.dispose();
});

test('Windows activation session rejects malformed initialization and enforces PID ownership', async () => {
  const child = new FakePowerShellChild();
  const session = createWindowsForegroundActivationSession({
    browserPid: 42,
    platform: 'win32',
    spawnImpl: () => {
      queueMicrotask(() =>
        child.stdout.emit(
          'data',
          `${JSON.stringify({ schema: 'wrong', status: 'ready' })}\n`,
        ),
      );
      return child;
    },
  });
  await assert.rejects(session.start({ timeoutMs: 1000 }), /startup failed/);
  assert.equal(child.killed, true);
  await assert.rejects(session.request(99, 1000), /PID mismatch/);
  await session.dispose();
});

test('Windows activation session rejects stale replies and bounded protocol overflow', async () => {
  let child;
  const session = createWindowsForegroundActivationSession({
    browserPid: 42,
    platform: 'win32',
    spawnImpl: () => {
      child = new FakePowerShellChild();
      queueMicrotask(() =>
        child.stdout.emit(
          'data',
          `${JSON.stringify({
            schema: 'gev-windows-owned-browser-foreground-diagnostic/v1',
            status: 'ready',
          })}\n`,
        ),
      );
      child.stdin.write = () =>
        queueMicrotask(() =>
          child.stdout.emit(
            'data',
            `${JSON.stringify({
              schema: WINDOWS_FOREGROUND_SCHEMA,
              requestId: 999,
              status: 'foreground-confirmed',
            })}\n`,
          ),
        );
      return child;
    },
  });
  await session.start({ timeoutMs: 1000 });
  await assert.rejects(session.request(42, 1000), /sequence mismatch/);
  assert.equal(child.killed, true);
  await session.dispose();

  let overflowChild;
  const overflow = createWindowsForegroundActivationSession({
    browserPid: 42,
    platform: 'win32',
    spawnImpl: () => {
      overflowChild = new FakePowerShellChild();
      queueMicrotask(() =>
        overflowChild.stdout.emit('data', 'x'.repeat(70_000)),
      );
      return overflowChild;
    },
  });
  await assert.rejects(overflow.start({ timeoutMs: 1000 }), /bounded limit/);
  assert.equal(overflowChild.killed, true);
  await overflow.dispose();
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
