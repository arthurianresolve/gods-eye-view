import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { EventEmitter } from 'node:events';
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
const page = (url) => ({ url: () => url });

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
  assert.deepEqual(outcome, { closeCompleted: true, openPageCount: 0 });
  await browser.close();
  assert.deepEqual(order, ['page-close', 'browser-close']);
});

test('wedged owned-page close is bounded and reported as incomplete', async () => {
  const owned = {
    isClosed: () => false,
    close: () => new Promise(() => {}),
  };
  const browser = { pages: async () => [owned] };
  const started = Date.now();
  const outcome = await closeOwnedRecoveryPage(owned, browser, 20);
  assert.ok(Date.now() - started < 500);
  assert.deepEqual(outcome, { closeCompleted: false, openPageCount: null });
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
  () => {
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
    const output = execFileSync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', script],
      { encoding: 'utf8', timeout: 5000, windowsHide: true },
    );
    assert.match(output, /NO_COMMAND_LINE_QUERY/);
    assert.doesNotMatch(output, /COMMAND_LINE_QUERY_RAN/);
  },
);

test(
  'PowerShell derives roles only from command lines for owned process IDs',
  {
    skip: process.platform !== 'win32',
  },
  () => {
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
    const output = execFileSync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', script],
      { encoding: 'utf8', timeout: 5000, windowsHide: true },
    );
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
  const send = trace.logger('puppeteer:protocol:SEND ▶');
  const receive = trace.logger('puppeteer:protocol:RECV ◀');
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
  const send = trace.logger('puppeteer:protocol:SEND ▶');
  const receive = trace.logger('puppeteer:protocol:RECV ◀');
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

test('close trace distinguishes missing and late acknowledgements and bounds messages', () => {
  let now = 0;
  const trace = createRecoveryBrowserCloseTrace({ now: () => now });
  const send = trace.logger('puppeteer:protocol:SEND ▶');
  const receive = trace.logger('puppeteer:protocol:RECV ◀');
  trace.begin();
  send(JSON.stringify({ method: 'Browser.close', id: 12 }));
  now = 25;
  receive(JSON.stringify({ id: 12, result: {} }));
  const late = trace.finish(20);
  assert.equal(late.browserCloseAcknowledgementSeen, true);
  assert.equal(late.browserCloseAcknowledgementLate, true);

  const errorTrace = createRecoveryBrowserCloseTrace({ now: () => now });
  const errorSend = errorTrace.logger('puppeteer:protocol:SEND ▶');
  const errorReceive = errorTrace.logger('puppeteer:protocol:RECV ◀');
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
  const missingSend = missingTrace.logger('puppeteer:protocol:SEND ▶');
  missingTrace.begin();
  missingSend('{ malformed Browser.close');
  const missing = missingTrace.finish(20);
  assert.equal(missing.browserCloseRequestSeen, false);
  assert.equal(missing.browserCloseAcknowledgementSeen, false);
  assert.equal(missing.malformedCloseMessage, true);
  assert.equal(missing.protocolObservationComplete, true);

  const boundedTrace = createRecoveryBrowserCloseTrace({ now: () => now });
  const boundedSend = boundedTrace.logger('puppeteer:protocol:SEND ▶');
  boundedTrace.begin();
  for (let index = 0; index < 65; index++)
    boundedSend(JSON.stringify({ method: 'Page.reload', id: index }));
  const bounded = boundedTrace.finish(20);
  assert.equal(bounded.protocolMessageCount, 64);
  assert.equal(bounded.protocolMessageOverflow, true);
  assert.equal(bounded.protocolObservationComplete, false);
});

test('an exited process with an unresolved close acknowledgement remains a failure', async () => {
  const child = fakeBrowserProcess();
  const started = Date.now();
  let forced = false;
  const outcome = await closeRecoveryBrowser(
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
      forceProcess: async () => {
        forced = true;
        return { attempted: true, confirmed: true };
      },
    },
  );
  assert.ok(Date.now() - started < 500);
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

test('a live process timeout invokes bounded owned-process cleanup and stays failed', async () => {
  const child = fakeBrowserProcess();
  let forced = false;
  const started = Date.now();
  const outcome = await closeRecoveryBrowser(
    { process: () => child, close: () => new Promise(() => {}) },
    {
      timeoutMs: 20,
      forceProcess: async () => {
        forced = true;
        return { attempted: true, confirmed: true };
      },
    },
  );
  assert.ok(Date.now() - started < 500);
  assert.equal(forced, true);
  assert.equal(outcome.closeCompleted, false);
  assert.equal(outcome.forcedProcessTermination, true);
  assert.equal(outcome.observation.processExit, null);
  assert.equal(outcome.observation.forceProcessStatus, 'confirmed');
  assert.equal(outcome.observation.forceProcessAttempted, true);
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
