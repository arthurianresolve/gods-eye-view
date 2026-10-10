import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {
  BROWSER_SHUTDOWN_CONTROLS,
  classifyBrowserShutdownControl,
  createBrowserShutdownReport,
  runBrowserShutdownControlMatrix,
  sanitizeShutdownError,
  validateBrowserShutdownReport,
} from './browserShutdownControls.mjs';
import {
  BLANK_DOCUMENT,
  CESIUM_DOCUMENT,
  WEBGL_DOCUMENT,
  inlineScripts,
} from './browserShutdownFixtures.mjs';
import { main, setupDocument } from '../qa-browser-shutdown.mjs';

const identity = () => ({
  sourceCommit: 'a'.repeat(40),
  sourceCommitAtEnd: 'a'.repeat(40),
  harnessCommit: 'a'.repeat(40),
  sourceCleanAtStart: true,
  sourceCleanAtEnd: true,
  nodeVersion: 'v24.14.0',
  platform: 'win32',
  osRelease: '10.0.19045',
  osVersion: 'Windows 10 Pro 10.0.19045',
  cesiumVersion: '1.138.0',
  cesiumBundleSha256: 'b'.repeat(64),
  fixtureSha256: 'c'.repeat(64),
  fixtureIdentity: 'blank-webgl2-cesium-installed-build-v1',
  fixtureBuildRecipe: 'direct-installed-cesium-static-tree-no-app-build',
  launchFlags: [
    '--no-sandbox',
    '--disable-dev-shm-usage',
    '--use-gl=angle',
    '--use-angle=swiftshader-webgl',
    '--enable-unsafe-swiftshader',
  ],
  rendererMode: { softwareRendering: true, webglOnly: true },
  browserVersion: 'Chrome/152.0.0.0',
});

function successfulResult(specification, overrides = {}) {
  const readiness =
    specification.document === 'blank'
      ? { blank: true }
      : {
          ready: true,
          ...(specification.document === 'webgl2'
            ? { webgl2: true }
            : { cesium: true, contextAvailable: true }),
          canvasWidth: 640,
          canvasHeight: 480,
          readyFrameElapsedMs: 16,
          renderingContext: {
            version: 'WebGL 2.0',
            vendor: 'WebKit',
            renderer: 'SwiftShader',
            rendererQueryDurationMs: 0.2,
            antialias: true,
            alpha: false,
          },
        };
  return {
    ...specification,
    freshProfile: true,
    setupCompleted: true,
    documentReady: true,
    browserVersion: 'Chrome/152.0.0.0',
    readiness,
    browserVersionConsistent: true,
    pageErrorCount: 0,
    pageErrors: [],
    error: null,
    pageCloseCompleted: true,
    openPageCountAfterClose: 0,
    browserCloseCompleted: true,
    forcedProcessTermination: false,
    processExitConfirmed: true,
    processExitScope: 'browser-parent-process-only; descendants-unobserved',
    elapsedMs: 200,
    closeObservation: {
      closeStatus: 'completed',
      closeDeadlineMs: 5_000,
      closeElapsedMs: 50,
      forceProcessAttempted: false,
      processExit: { code: 0, signal: null, elapsedMs: 100 },
    },
    closeTrace: {
      browserCloseRequestSeen: true,
      browserCloseRequestElapsedMs: 2,
      browserCloseAcknowledgementSeen: true,
      browserCloseAcknowledgementElapsedMs: 3,
      browserCloseAcknowledgementError: false,
      browserCloseAcknowledgementLate: false,
      browserDisconnected: true,
      browserDisconnectedElapsedMs: 5,
      malformedCloseMessage: false,
      protocolObservationComplete: true,
    },
    ...(specification.treatment === 'unload-first'
      ? { unloadNavigationCompleted: true, pageHideObserved: true }
      : {}),
    ...overrides,
  };
}

test('browser shutdown matrix runs each document/treatment sequentially and validates a complete result', async () => {
  const calls = [];
  const report = await runBrowserShutdownControlMatrix({
    identity: identity(),
    runControl: async (specification) => {
      calls.push(specification.id);
      return successfulResult(specification);
    },
  });
  assert.deepEqual(
    calls,
    BROWSER_SHUTDOWN_CONTROLS.map(({ id }) => id),
  );
  assert.equal(report.status, 'passed');
  assert.equal(report.controls.length, 6);
  assert.equal(report.identity.browserVersion, 'Chrome/152.0.0.0');
  validateBrowserShutdownReport(report);
});

test('a failed graceful close remains failed but later controls run after confirmed exit', async () => {
  let calls = 0;
  const report = await runBrowserShutdownControlMatrix({
    identity: identity(),
    runControl: async (specification) => {
      calls++;
      return successfulResult(specification, {
        ...(calls === 1
          ? {
              browserCloseCompleted: false,
              forcedProcessTermination: true,
            }
          : {}),
      });
    },
  });
  assert.equal(calls, 6);
  assert.equal(report.status, 'failed');
  assert.equal(report.controls[0].status, 'failed');
  assert.equal(report.controls[0].processExitConfirmed, true);
  validateBrowserShutdownReport(report);
});

test('an unconfirmed owned process blocks every later control', async () => {
  const calls = [];
  const report = await runBrowserShutdownControlMatrix({
    identity: identity(),
    runControl: async (specification) => {
      calls.push(specification.id);
      return successfulResult(specification, {
        processExitConfirmed: false,
      });
    },
  });
  assert.deepEqual(calls, ['blank-normal']);
  assert.equal(report.status, 'failed');
  assert.deepEqual(
    report.blockedControls,
    BROWSER_SHUTDOWN_CONTROLS.slice(1).map(({ id }) => id),
  );
  validateBrowserShutdownReport(report);
});

test('browser version mismatch is kept as a failed control', async () => {
  let calls = 0;
  const report = await runBrowserShutdownControlMatrix({
    identity: identity(),
    runControl: async (specification) => {
      calls++;
      return successfulResult(specification, {
        browserVersion: calls === 2 ? 'Chrome/151.0.0.0' : 'Chrome/152.0.0.0',
      });
    },
  });
  assert.equal(report.controls[0].status, 'passed');
  assert.equal(report.controls[1].status, 'failed');
  assert.equal(report.controls[1].browserVersionConsistent, false);
  validateBrowserShutdownReport(report);
});

test('validator rejects missing control evidence, changed identity, or false forced-cleanup pass', async () => {
  const report = await runBrowserShutdownControlMatrix({
    identity: identity(),
    runControl: async (specification) => successfulResult(specification),
  });
  const missing = structuredClone(report);
  missing.controls.pop();
  assert.throws(() => validateBrowserShutdownReport(missing));

  const dirty = structuredClone(report);
  dirty.identity.sourceCleanAtEnd = false;
  assert.throws(() => validateBrowserShutdownReport(dirty));

  const forced = structuredClone(report);
  forced.controls[0].forcedProcessTermination = true;
  assert.throws(() => validateBrowserShutdownReport(forced));

  assert.throws(
    () =>
      createBrowserShutdownReport({
        ...identity(),
        sourceCommit: 'f'.repeat(40),
      }),
    /identity is invalid/,
  );
});

test('unload-first control requires navigation completion and observed pagehide', () => {
  const control = BROWSER_SHUTDOWN_CONTROLS.find(
    ({ id }) => id === 'webgl2-unload',
  );
  assert.equal(
    classifyBrowserShutdownControl(successfulResult(control)),
    'passed',
  );
  assert.equal(
    classifyBrowserShutdownControl(
      successfulResult(control, { pageHideObserved: false }),
    ),
    'failed',
  );
  assert.equal(
    classifyBrowserShutdownControl(
      successfulResult(control, { unloadNavigationCompleted: false }),
    ),
    'failed',
  );
});

test('fixture inline scripts retain valid regex escapes and compile as browser scripts', () => {
  for (const document of [BLANK_DOCUMENT, WEBGL_DOCUMENT, CESIUM_DOCUMENT]) {
    const scripts = inlineScripts(document);
    if (document !== BLANK_DOCUMENT) assert.ok(scripts.length > 0);
    for (const source of scripts)
      assert.doesNotThrow(() => new vm.Script(source));
  }
});

test('shutdown CLI can be imported for fixture tests without launching Chrome', () => {
  assert.equal(typeof main, 'function');
  assert.equal(typeof setupDocument, 'function');
});

test('blank-page unload observer is installed in the already-open document', async () => {
  const listeners = [];
  const observedTokens = [];
  const browserContext = vm.createContext({
    window: {
      addEventListener(name, callback) {
        if (name === 'pagehide')
          listeners.push(() => {
            const token =
              browserContext.window.__qaBrowserShutdownDocumentToken;
            observedTokens.push(token);
            callback.call(browserContext.window, token);
          });
      },
    },
  });
  const runSerialized = (callback) =>
    vm.runInContext(`(${callback.toString()})()`, browserContext);
  let pageHideCallback = null;
  let newDocumentObserver = null;
  const events = {};
  let currentUrl = 'about:blank';
  const page = {
    async exposeFunction(_name, callback) {
      pageHideCallback = callback;
      browserContext.window.qaObservePageHide = callback;
    },
    async evaluateOnNewDocument(callback) {
      newDocumentObserver = callback;
      runSerialized(callback);
    },
    async evaluate(callback) {
      return runSerialized(callback);
    },
    async setRequestInterception() {},
    async goto(url) {
      const oldDocumentListeners = listeners.slice();
      for (const listener of oldDocumentListeners) listener();
      currentUrl = url;
      browserContext.window = {
        qaObservePageHide: pageHideCallback,
        addEventListener(name, callback) {
          if (name === 'pagehide')
            listeners.push(() => {
              const token =
                browserContext.window.__qaBrowserShutdownDocumentToken;
              observedTokens.push(token);
              callback.call(browserContext.window, token);
            });
        },
      };
      runSerialized(newDocumentObserver);
    },
    on(name, callback) {
      events[name] = callback;
    },
    url: () => currentUrl,
  };
  const origin = 'http://127.0.0.1';
  const prepared = await setupDocument(page, 'blank', origin);
  assert.equal(prepared.documentReady, true);
  assert.equal(listeners.length, 2);
  const currentToken = prepared.getPageHideToken();
  const initialToken = observedTokens[0];
  assert.notEqual(currentToken, initialToken);
  assert.equal(prepared.getPageHideCount(initialToken), 1);
  assert.equal(prepared.getPageHideCount(currentToken), 0);
  listeners.at(-1)();
  await Promise.resolve();
  assert.equal(prepared.getPageHideCount(currentToken), 1);
  assert.equal(typeof pageHideCallback, 'function');
  assert.equal(typeof events.request, 'function');
});

test('an emitted page error invalidates an otherwise healthy shutdown control', () => {
  const control = BROWSER_SHUTDOWN_CONTROLS[0];
  assert.equal(
    classifyBrowserShutdownControl(
      successfulResult(control, { pageErrorCount: 1 }),
    ),
    'failed',
  );
  assert.equal(
    classifyBrowserShutdownControl(
      successfulResult(control, { error: 'setup failed' }),
    ),
    'failed',
  );
});

test('WebGL and Cesium controls require observed live context and renderer data', () => {
  const webgl = BROWSER_SHUTDOWN_CONTROLS.find(
    ({ id }) => id === 'webgl2-normal',
  );
  const cesium = BROWSER_SHUTDOWN_CONTROLS.find(
    ({ id }) => id === 'cesium-normal',
  );
  assert.equal(
    classifyBrowserShutdownControl(
      successfulResult(webgl, {
        readiness: { ready: true, webgl2: false },
      }),
    ),
    'failed',
  );
  assert.equal(
    classifyBrowserShutdownControl(
      successfulResult(cesium, {
        readiness: { ready: true, cesium: true, contextAvailable: false },
      }),
    ),
    'failed',
  );
  const missingRenderer = successfulResult(webgl);
  missingRenderer.readiness.renderingContext.renderer = null;
  assert.equal(classifyBrowserShutdownControl(missingRenderer), 'failed');
});

test('shutdown fixture identity requires the declared WebGL-only SwiftShader launch', () => {
  assert.throws(() =>
    createBrowserShutdownReport({
      ...identity(),
      rendererMode: { softwareRendering: true, webglOnly: false },
    }),
  );
  assert.throws(() =>
    createBrowserShutdownReport({
      ...identity(),
      launchFlags: identity().launchFlags.filter(
        (flag) => flag !== '--use-angle=swiftshader-webgl',
      ),
    }),
  );
});

test('shutdown errors remove URL and path details before report storage', () => {
  const message = sanitizeShutdownError(
    new Error(
      'failed at https://user:pass@example.test/path C:\\Users\\secret\\profile',
    ),
  );
  assert.doesNotMatch(message, /https?:\/\/|example\.test|Users\\secret/);
  assert.match(message, /\[url\]/);
  assert.match(message, /\[path\]/);
});
