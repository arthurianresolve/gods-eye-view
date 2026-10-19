import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import {
  cleanupFixturePageDiagnostics,
  flushFixturePageConsoleOwnership,
  importFixtureGeometry,
  prepareFixturePage,
  readFixturePageDiagnostics,
  showWorkspaceLibraryForFixtureInPage,
} from './qa-application-fixtures.mjs';

class MockPage extends EventEmitter {
  constructor(events = []) {
    super();
    this.events = events;
  }

  workers() {
    return [];
  }

  setDefaultTimeout() {}

  setDefaultNavigationTimeout() {}

  async setViewport() {}

  async createCDPSession() {
    const session = new EventEmitter();
    session.send = async () => {};
    return session;
  }

  isClosed() {
    return false;
  }

  async exposeFunction(name) {
    this.events.push(`expose:${name}`);
  }

  async evaluateOnNewDocument() {
    return { identifier: 'heartbeat-script' };
  }

  async evaluate() {
    this.events.push('heartbeat-clear');
  }

  async removeScriptToEvaluateOnNewDocument(identifier) {
    this.events.push(`remove-script:${identifier}`);
  }

  async removeExposedFunction(name) {
    this.events.push(`remove-binding:${name}`);
  }
}

function consoleMessage(type, text, handles = []) {
  return {
    type: () => type,
    text: () => text,
    args: () => handles,
  };
}

async function prepareMockFixture(options = {}) {
  const events = [];
  const page = new MockPage(events);
  const fixture = await prepareFixturePage(
    { newPage: async () => page },
    'https://fixture.test/',
    { page, ...options },
  );
  return { ...fixture, events };
}

test('import fixture releases the selector ElementHandle it does not retain', async () => {
  const events = [];
  const page = {
    async waitForSelector(selector, options) {
      events.push('selector-wait');
      assert.equal(selector, '.workspace-library [data-geo-file]');
      assert.equal(options.visible, true);
      return {
        async dispose() {
          events.push('handle-dispose');
        },
      };
    },
    async evaluate(operation) {
      events.push(
        operation === showWorkspaceLibraryForFixtureInPage
          ? 'panel-open'
          : 'import-stage',
      );
    },
    async waitForFunction() {},
  };

  await importFixtureGeometry(page, 'Persistent fixture', {
    onProgress(phase) {
      if (phase === 'import-control-wait:complete')
        events.push('selector-phase-complete');
    },
  });

  assert.deepEqual(events.slice(0, 5), [
    'panel-open',
    'selector-wait',
    'handle-dispose',
    'selector-phase-complete',
    'import-stage',
  ]);
});

function workspaceDisclosureFixture({ open = false, collapsed = true } = {}) {
  const calls = [];
  const panel = {
    classList: { contains: (name) => name === 'collapsed' && collapsed },
  };
  const root = {
    open,
    closest: (selector) => (selector === '#scene-panel' ? panel : null),
  };
  const scope = {
    document: { querySelector: () => root },
    __godsEyeView: {
      styleManager: {
        setPanelCollapsed(...args) {
          calls.push(['panel', ...args]);
          collapsed = args[1];
        },
      },
      workspaceLibraryPanel: {
        openLibrary() {
          calls.push(['library']);
          root.open = true;
        },
      },
    },
  };
  return { scope, root, calls };
}

test('import setup opens closed workspace disclosures through application controls', () => {
  const fixture = workspaceDisclosureFixture();
  showWorkspaceLibraryForFixtureInPage(fixture.scope);
  assert.deepEqual(fixture.calls, [
    ['panel', 'scene-panel', false, { skipCapture: true }],
    ['library'],
  ]);
  assert.equal(fixture.root.open, true);
  showWorkspaceLibraryForFixtureInPage(fixture.scope);
  assert.equal(
    fixture.calls.length,
    2,
    'Already open disclosures need no additional writes or focus changes',
  );
});

test('import setup reopens the panel even when the workspace disclosure stayed open', () => {
  const fixture = workspaceDisclosureFixture({ open: true });
  showWorkspaceLibraryForFixtureInPage(fixture.scope);
  assert.deepEqual(fixture.calls, [
    ['panel', 'scene-panel', false, { skipCapture: true }],
  ]);
});

test('import setup fails explicitly for missing disclosure APIs and unavailable library', () => {
  const fixture = workspaceDisclosureFixture();
  delete fixture.scope.__godsEyeView.styleManager.setPanelCollapsed;
  assert.throws(
    () => showWorkspaceLibraryForFixtureInPage(fixture.scope),
    /Scene panel disclosure API/,
  );
  assert.equal(fixture.root.open, false);
  const missingLibrary = workspaceDisclosureFixture({ collapsed: false });
  delete missingLibrary.scope.__godsEyeView.workspaceLibraryPanel.openLibrary;
  assert.throws(
    () => showWorkspaceLibraryForFixtureInPage(missingLibrary.scope),
    /Workspace library disclosure API/,
  );
  assert.throws(
    () =>
      showWorkspaceLibraryForFixtureInPage({
        document: { querySelector: () => null },
      }),
    /Workspace library is unavailable/,
  );
});

test('opening disclosures never bypasses the visible import-control requirement', async () => {
  const calls = [];
  const page = {
    async evaluate(operation) {
      calls.push(
        operation === showWorkspaceLibraryForFixtureInPage
          ? 'panel-open'
          : 'diagnostics',
      );
      return null;
    },
    async waitForSelector(selector, options) {
      assert.equal(options.visible, true);
      assert.equal(options.timeout, 123);
      calls.push('visible-control-wait');
      throw new Error('Control remained hidden');
    },
  };
  await assert.rejects(
    importFixtureGeometry(page, 'Fixture', { timeoutMs: 123 }),
    /Control remained hidden; workspace\/import phase import-control-wait/,
  );
  assert.deepEqual(calls.slice(0, 2), ['panel-open', 'visible-control-wait']);
});

test('fixture console ownership defaults off and diagnostics remain unavailable', async () => {
  const { page, interception } = await prepareMockFixture();
  let disposeCalls = 0;
  page.emit(
    'console',
    consoleMessage('log', 'ordinary message', [
      { dispose: () => disposeCalls++ },
    ]),
  );

  assert.equal(disposeCalls, 0);
  assert.equal(readFixturePageDiagnostics(page).consoleHandleOwnership, null);
  assert.equal(await flushFixturePageConsoleOwnership(page), null);

  await cleanupFixturePageDiagnostics(page);
  assert.equal(page.listenerCount('console'), 0);
  await interception.releaseSession({ targetClosed: true });
});

test('opt-in fixture disposes handles for console early returns and drains on cleanup', async () => {
  const { page, interception, events } = await prepareMockFixture({
    exclusiveConsoleHandleOwnership: true,
    startupDiagnostics: {
      recordRendererPhase(marker) {
        events.push(`renderer:${marker.phase}`);
      },
    },
  });
  const disposeHandle = (name) => ({
    dispose() {
      events.push(`${name}:dispose-start`);
      return new Promise((resolve) => {
        setTimeout(() => {
          events.push(`${name}:dispose-done`);
          resolve();
        }, 5);
      });
    },
  });
  page.emit(
    'console',
    consoleMessage(
      'info',
      '__GEV_RECOVERY_WEBGL__{"phase":"query-start","elapsedMs":2}',
      [disposeHandle('info')],
    ),
  );
  page.emit(
    'console',
    consoleMessage('log', 'filtered message', [disposeHandle('log')]),
  );

  assert.deepEqual(events.slice(0, 4), [
    'expose:__gevRecoveryHeartbeat',
    'renderer:query-start',
    'info:dispose-start',
    'log:dispose-start',
  ]);
  const flushed = await flushFixturePageConsoleOwnership(page);
  assert.deepEqual(flushed, {
    disposed: 2,
    skipped: 0,
    pending: 0,
    errors: 0,
  });

  page.emit(
    'console',
    consoleMessage('warn', 'warning detail', [disposeHandle('warn')]),
  );
  assert.deepEqual(readFixturePageDiagnostics(page).messages, [
    'warning detail',
  ]);

  const cleanup = cleanupFixturePageDiagnostics(page);
  assert.equal(page.listenerCount('console'), 0);
  await cleanup;
  assert.ok(events.includes('warn:dispose-done'));
  assert.ok(events.includes('heartbeat-clear'));
  assert.ok(events.includes('remove-binding:__gevRecoveryHeartbeat'));
  assert.equal(readFixturePageDiagnostics(page).consoleHandleOwnership, null);
  await interception.releaseSession({ targetClosed: true });
});

test('opt-in fixture skips console handles when another page listener shares them', async () => {
  const { page, interception } = await prepareMockFixture({
    exclusiveConsoleHandleOwnership: true,
  });
  let disposeCalls = 0;
  page.on('console', () => {});
  page.emit(
    'console',
    consoleMessage('error', 'shared message', [
      { dispose: () => disposeCalls++ },
    ]),
  );

  assert.deepEqual(await flushFixturePageConsoleOwnership(page), {
    disposed: 0,
    skipped: 1,
    pending: 0,
    errors: 0,
  });
  assert.equal(disposeCalls, 0);
  await cleanupFixturePageDiagnostics(page);
  assert.equal(page.listenerCount('console'), 1);
  await interception.releaseSession({ targetClosed: true });
});
