import assert from 'node:assert/strict';
import test from 'node:test';
import {
  cleanupImportStatusDiagnosticsInPage,
  installImportStatusDiagnosticsInPage,
  markImportStatusWaitReferenceInPage,
  withImportStatusDiagnostics,
  withImportStatusWaitRoot,
} from './importStatusDiagnostics.mjs';

class FakeMutationObserver {
  constructor(callback) {
    this.callback = callback;
    this.disconnected = false;
    this.observed = null;
  }

  observe(target, options) {
    this.observed = { target, options };
  }

  disconnect() {
    this.disconnected = true;
  }

  notify() {
    if (!this.disconnected) this.callback();
  }
}

function fixtureScope(initialText = 'Review counts, then choose Apply.') {
  let status = { textContent: initialText };
  let root = { querySelector: () => status };
  const document = { querySelector: () => root };
  let now = 10;
  const scope = {
    document,
    MutationObserver: FakeMutationObserver,
    performance: {
      timeOrigin: 1_700_000_000_000,
      now: () => now,
    },
  };
  return {
    scope,
    document,
    get root() {
      return root;
    },
    get status() {
      return status;
    },
    replaceStatus(text) {
      status = { textContent: text };
    },
    replaceWorkspace(text) {
      status = { textContent: text };
      root = { querySelector: () => status };
    },
    setNow(value) {
      now = value;
    },
  };
}

test('status diagnostics retain initial and terminal text with conservative browser time', () => {
  const fixture = fixtureScope();
  const installation = installImportStatusDiagnosticsInPage(fixture.scope);
  assert.equal(installation.installed, true);
  const { ownerToken } = installation;
  const state = fixture.scope.__gevImportStatusDiagnostics;
  const observer = state.observer;
  assert.deepEqual(observer.observed, {
    target: fixture.document,
    options: { childList: true, subtree: true, characterData: true },
  });

  fixture.setNow(12.5);
  assert.equal(
    markImportStatusWaitReferenceInPage(ownerToken, 30_000, fixture.scope),
    true,
  );
  fixture.setNow(42.5);
  fixture.replaceStatus('Imported 1 features in workspace revision 2.');
  observer.notify();
  const snapshot = state.snapshot();
  assert.equal(snapshot.timeOriginMs, 1_700_000_000_000);
  assert.equal(snapshot.initialStatus, 'Review counts, then choose Apply.');
  assert.equal(
    snapshot.terminalStatus,
    'Imported 1 features in workspace revision 2.',
  );
  assert.equal(snapshot.terminalPerformanceNowMs, 42.5);
  assert.equal(snapshot.snapshots[1].epochTimeMs, 1_700_000_000_042.5);
  assert.deepEqual(snapshot.statusWait, {
    clockDomain: 'browser-performance-epoch-estimate',
    referenceKind: 'pre-wait-conservative',
    performanceNowMs: 12.5,
    epochTimeMs: 1_700_000_000_012.5,
    timeoutMs: 30_000,
  });
  assert.equal(
    snapshot.conservativeReferenceDeadlineEpochTimeMs,
    1_700_000_030_012.5,
  );
  assert.equal(snapshot.terminalBeforeConservativeReferenceDeadline, true);
  assert.equal('terminalBeforeWaitDeadline' in snapshot, false);
});

test('status diagnostics follow replacement status and workspace nodes under document observation', () => {
  const fixture = fixtureScope();
  const { ownerToken } = installImportStatusDiagnosticsInPage(fixture.scope);
  const state = fixture.scope.__gevImportStatusDiagnostics;
  const observer = state.observer;
  fixture.replaceStatus('Imported 1 features after replacing the status node.');
  observer.notify();
  fixture.replaceWorkspace(
    'Imported 2 features after replacing the workspace root.',
  );
  observer.notify();
  assert.equal(
    state.snapshot().terminalStatus,
    'Imported 2 features after replacing the workspace root.',
  );
  assert.equal(observer.observed.target, fixture.document);
  assert.equal(
    cleanupImportStatusDiagnosticsInPage(ownerToken, fixture.scope),
    true,
  );
});

test('status observer ownership rejects overlap and cleanup cannot remove another owner', () => {
  const fixture = fixtureScope();
  const first = installImportStatusDiagnosticsInPage(fixture.scope);
  const firstState = fixture.scope.__gevImportStatusDiagnostics;
  assert.throws(
    () => installImportStatusDiagnosticsInPage(fixture.scope),
    /already has an owner/,
  );
  assert.equal(firstState.observer.disconnected, false);
  assert.equal(
    cleanupImportStatusDiagnosticsInPage('wrong-owner', fixture.scope),
    false,
  );
  assert.equal(fixture.scope.__gevImportStatusDiagnostics, firstState);
  assert.equal(firstState.observer.disconnected, false);
  assert.equal(
    cleanupImportStatusDiagnosticsInPage(first.ownerToken, fixture.scope),
    true,
  );
});

test('status diagnostics bound history and cleanup disconnects the observer', () => {
  const fixture = fixtureScope();
  const { ownerToken } = installImportStatusDiagnosticsInPage(fixture.scope);
  const state = fixture.scope.__gevImportStatusDiagnostics;
  const observer = state.observer;
  for (let index = 0; index < 20; index += 1) {
    fixture.replaceStatus(`Import progress ${index}`);
    observer.notify();
  }
  fixture.replaceStatus('Imported 1 features in workspace revision 2.');
  observer.notify();
  const snapshot = state.snapshot();
  assert.equal(snapshot.snapshots.length, 16);
  assert.equal(snapshot.droppedSnapshots, 6);
  assert.equal(snapshot.initialStatus, 'Review counts, then choose Apply.');
  assert.equal(
    snapshot.snapshots.at(-1).text,
    'Imported 1 features in workspace revision 2.',
  );

  assert.equal(
    cleanupImportStatusDiagnosticsInPage(ownerToken, fixture.scope),
    true,
  );
  assert.equal(observer.disconnected, true);
  assert.equal('__gevImportStatusDiagnostics' in fixture.scope, false);
  const retainedCount = state.snapshot().snapshots.length;
  observer.notify();
  assert.equal(state.snapshot().snapshots.length, retainedCount);
  assert.equal(
    cleanupImportStatusDiagnosticsInPage(ownerToken, fixture.scope),
    false,
  );
});

test('status diagnostics identify a terminal update after the conservative reference deadline', () => {
  const fixture = fixtureScope();
  const { ownerToken } = installImportStatusDiagnosticsInPage(fixture.scope);
  const state = fixture.scope.__gevImportStatusDiagnostics;
  const observer = state.observer;
  fixture.setNow(10);
  markImportStatusWaitReferenceInPage(ownerToken, 100, fixture.scope);
  fixture.setNow(111);
  fixture.replaceStatus('Imported 1 features in workspace revision 2.');
  observer.notify();
  assert.equal(
    state.snapshot().terminalBeforeConservativeReferenceDeadline,
    false,
  );
  cleanupImportStatusDiagnosticsInPage(ownerToken, fixture.scope);
});

test('status diagnostics safely decline when the import panel is absent', () => {
  const scope = {
    document: { querySelector: () => null },
    MutationObserver: FakeMutationObserver,
    performance: { timeOrigin: 1, now: () => 2 },
  };
  assert.deepEqual(installImportStatusDiagnosticsInPage(scope), {
    installed: false,
  });
  assert.equal(cleanupImportStatusDiagnosticsInPage('none', scope), false);
});

test('import journey releases its own observer and preserves primary and cleanup failures', async () => {
  for (const failure of [null, new Error('fixture failed')]) {
    const fixture = fixtureScope();
    let installedToken = null;
    const page = {
      async evaluate(fn, ...args) {
        return fn(...args, fixture.scope);
      },
    };
    const install = async () => {
      const installation = installImportStatusDiagnosticsInPage(fixture.scope);
      installedToken = installation.ownerToken;
      return installation;
    };
    const operation = async (ownerToken) => {
      assert.equal(ownerToken, installedToken);
      assert.ok(fixture.scope.__gevImportStatusDiagnostics);
      if (failure) throw failure;
      return 'complete';
    };

    if (failure) {
      await assert.rejects(
        withImportStatusDiagnostics(page, install, operation),
        (error) => error === failure,
      );
    } else {
      assert.equal(
        await withImportStatusDiagnostics(page, install, operation),
        'complete',
      );
    }
    assert.equal('__gevImportStatusDiagnostics' in fixture.scope, false);
  }
});

test('cleanup failure is surfaced after success and attached when preserving a primary error', async () => {
  const cleanupFailure = new Error('cleanup transport failed');
  const primaryFailure = new Error('apply wait failed');
  for (const primary of [null, primaryFailure]) {
    const fixture = fixtureScope();
    const install = async () =>
      installImportStatusDiagnosticsInPage(fixture.scope);
    const page = {
      async evaluate(fn, ...args) {
        fn(...args, fixture.scope);
        throw cleanupFailure;
      },
    };
    const operation = async () => {
      if (primary) throw primary;
      return 'complete';
    };
    if (primary) {
      await assert.rejects(
        withImportStatusDiagnostics(page, install, operation),
        (error) => {
          assert.equal(error, primary);
          assert.equal(
            error.importStatusDiagnosticsCleanupError,
            cleanupFailure,
          );
          return true;
        },
      );
    } else {
      await assert.rejects(
        withImportStatusDiagnostics(page, install, operation),
        (error) => error === cleanupFailure,
      );
    }
  }
});

test('wait-root disposal failure surfaces after success and never masks a wait failure', async () => {
  const disposeFailure = new Error('root disposal failed');
  const waitFailure = new Error('wait timed out');
  for (const primary of [null, waitFailure]) {
    const root = {
      async dispose() {
        throw disposeFailure;
      },
    };
    const operation = async () => {
      if (primary) throw primary;
      return 'complete';
    };
    if (primary) {
      await assert.rejects(
        withImportStatusWaitRoot(root, operation),
        (error) => {
          assert.equal(error, waitFailure);
          assert.equal(error.importStatusWaitRootDisposeError, disposeFailure);
          return true;
        },
      );
    } else {
      await assert.rejects(
        withImportStatusWaitRoot(root, operation),
        (error) => error === disposeFailure,
      );
    }
  }
});
