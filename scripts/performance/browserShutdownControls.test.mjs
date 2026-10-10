import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { createServer, get, request } from 'node:http';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
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
import {
  closeFixtureServer,
  cleanupScratchProfile,
  installPageHideBeacon,
  main,
  preserveInterruptedShutdownReport,
  recordPageHideAfterDeadline,
  setupDocument,
  startFixtureServer,
} from '../qa-browser-shutdown.mjs';

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
            debugRendererInfoAvailable: true,
            unmaskedVendor: 'Google Inc. (Intel)',
            unmaskedRenderer: 'ANGLE (Intel UHD Graphics)',
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
    pageErrorsTruncated: false,
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
    ...(specification.treatment === 'navigation-first'
      ? {
          navigationToBlankCompleted: true,
          pageHideObserved: true,
          pageHideFailureReason: null,
          pageHideObservation: {
            scope: 'fixture-server-sendBeacon',
            count: 1,
            persisted: false,
            deliveryElapsedMs: 25,
            receivedWithinDeadline: true,
            deadlineMs: 1_000,
          },
          pageHideObservedAfterDeadline: false,
        }
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

  const wrongVersion = structuredClone(report);
  wrongVersion.controls[0].browserVersion = 'Chrome/151.0.0.0';
  assert.throws(() => validateBrowserShutdownReport(wrongVersion));

  const legacySchema = structuredClone(report);
  legacySchema.schema = 'gev-browser-shutdown-controls/v1';
  assert.throws(() => validateBrowserShutdownReport(legacySchema));

  const contradictoryErrors = structuredClone(report);
  contradictoryErrors.controls[0].pageErrors = ['unreported page error'];
  assert.throws(() => validateBrowserShutdownReport(contradictoryErrors));

  assert.throws(
    () =>
      createBrowserShutdownReport({
        ...identity(),
        sourceCommit: 'f'.repeat(40),
      }),
    /identity is invalid/,
  );
});

test('navigation-first control requires a delivered outgoing-pagehide observation', () => {
  const control = BROWSER_SHUTDOWN_CONTROLS.find(
    ({ id }) => id === 'webgl2-unload',
  );
  assert.equal(
    classifyBrowserShutdownControl(successfulResult(control)),
    'passed',
  );
  assert.equal(
    classifyBrowserShutdownControl(
      successfulResult(control, {
        pageHideObserved: false,
        pageHideFailureReason: 'outgoing-pagehide-beacon-not-observed',
      }),
    ),
    'failed',
  );
  assert.equal(
    classifyBrowserShutdownControl(
      successfulResult(control, {
        navigationToBlankCompleted: false,
        pageHideFailureReason: 'navigation-to-blank-not-completed',
      }),
    ),
    'failed',
  );
  assert.equal(
    classifyBrowserShutdownControl(
      successfulResult(control, { pageHideObservation: null }),
    ),
    'failed',
  );
  assert.equal(
    classifyBrowserShutdownControl(
      successfulResult(control, {
        pageHideObservation: {
          scope: 'fixture-server-sendBeacon',
          count: 1,
          persisted: true,
          deliveryElapsedMs: 25,
          receivedWithinDeadline: true,
          deadlineMs: 1_000,
        },
      }),
    ),
    'passed',
    'pagehide persisted state is diagnostic and does not imply resource destruction',
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

test('WebGL fixture performs one ready-frame renderer query and records unmasked identity', () => {
  const source = inlineScripts(WEBGL_DOCUMENT)[0];
  const calls = { extensions: 0, parameters: 0, frames: 0 };
  let frameCallback;
  const extension = {
    UNMASKED_VENDOR_WEBGL: 10,
    UNMASKED_RENDERER_WEBGL: 11,
  };
  const gl = {
    VERSION: 1,
    VENDOR: 2,
    RENDERER: 3,
    COLOR_BUFFER_BIT: 4,
    getExtension(name) {
      calls.extensions++;
      assert.equal(name, 'WEBGL_debug_renderer_info');
      return extension;
    },
    getParameter(parameter) {
      calls.parameters++;
      return new Map([
        [1, 'WebGL 2.0'],
        [2, 'WebKit'],
        [3, 'WebKit Renderer'],
        [10, 'Actual Vendor'],
        [11, 'Actual Renderer'],
      ]).get(parameter);
    },
    getContextAttributes: () => ({ antialias: true, alpha: false }),
    viewport() {},
    clearColor() {},
    clear() {},
  };
  const canvas = {
    width: 640,
    height: 480,
    getContext: () => gl,
  };
  const context = {
    document: { getElementById: () => canvas },
    window: {},
    performance: { now: () => 10 },
    requestAnimationFrame(callback) {
      calls.frames++;
      frameCallback = callback;
    },
  };
  vm.runInNewContext(source, context);
  assert.equal(calls.frames, 1);
  frameCallback();
  assert.equal(calls.extensions, 1);
  assert.equal(calls.parameters, 5);
  assert.equal(
    context.window.__shutdownReady.renderingContext.vendor,
    'WebKit',
  );
  assert.equal(
    context.window.__shutdownReady.renderingContext.unmaskedVendor,
    'Actual Vendor',
  );
  assert.equal(
    context.window.__shutdownReady.renderingContext.unmaskedRenderer,
    'Actual Renderer',
  );
});

test('Cesium fixture samples renderer once from one completed postRender and removes its listener', () => {
  const source = inlineScripts(CESIUM_DOCUMENT).at(-1);
  const calls = { extensions: 0, parameters: 0, listeners: 0, removed: 0 };
  let postRenderCallback;
  const extension = {
    UNMASKED_VENDOR_WEBGL: 10,
    UNMASKED_RENDERER_WEBGL: 11,
  };
  const gl = {
    VERSION: 1,
    VENDOR: 2,
    RENDERER: 3,
    getExtension(name) {
      calls.extensions++;
      assert.equal(name, 'WEBGL_debug_renderer_info');
      return extension;
    },
    getParameter(parameter) {
      calls.parameters++;
      return new Map([
        [1, 'WebGL 2.0'],
        [2, 'WebKit'],
        [3, 'WebKit Renderer'],
        [10, 'Actual Vendor'],
        [11, 'Actual Renderer'],
      ]).get(parameter);
    },
    getContextAttributes: () => ({ antialias: true, alpha: false }),
  };
  const viewer = {
    canvas: { width: 640, height: 480 },
    scene: {
      globe: {},
      context: { _originalGLContext: gl },
      postRender: {
        addEventListener(callback) {
          calls.listeners++;
          postRenderCallback = callback;
          return () => calls.removed++;
        },
      },
      requestRender() {},
    },
  };
  const context = {
    window: {},
    performance: { now: () => 25 },
    Cesium: {
      Viewer: function Viewer() {
        return viewer;
      },
      EllipsoidTerrainProvider: function EllipsoidTerrainProvider() {},
    },
  };
  vm.runInNewContext(source, context);
  assert.equal(calls.listeners, 1);
  assert.equal(typeof postRenderCallback, 'function');
  postRenderCallback();
  postRenderCallback();
  assert.equal(calls.removed, 1);
  assert.equal(calls.extensions, 1);
  assert.equal(calls.parameters, 5);
  assert.equal(
    context.window.__shutdownReady.renderingContext.unmaskedRenderer,
    'Actual Renderer',
  );
});

test('report finalization retains interrupted matrix rows and the primary error', () => {
  const initial = createBrowserShutdownReport(identity());
  const latest = createBrowserShutdownReport(identity());
  latest.controls.push(successfulResult(BROWSER_SHUTDOWN_CONTROLS[0]));
  const preserved = preserveInterruptedShutdownReport(
    initial,
    latest,
    new Error('matrix callback failed'),
  );
  assert.equal(preserved, latest);
  assert.equal(preserved.controls.length, 1);
  assert.equal(preserved.status, 'failed');
  assert.match(preserved.failure, /matrix callback failed/);
  assert.equal(
    preserveInterruptedShutdownReport(initial, latest, new Error('later'))
      .failure,
    preserved.failure,
  );
});

test('owned fixture server closes active connections within its bounded cleanup', async () => {
  const server = createServer((_request, _response) => {});
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const request = get(`http://127.0.0.1:${server.address().port}`);
  await new Promise((resolve, reject) => {
    server.once('request', resolve);
    request.once('error', reject);
  });
  const closed = await closeFixtureServer(server);
  assert.deepEqual(closed, {
    completed: true,
    closeAllConnectionsUsed: true,
  });
  assert.equal(server.listening, false);
  request.destroy();
});

test('scratch profile cleanup reports removal only after successful deletion', async () => {
  const scratch = await mkdtemp(
    path.join(os.tmpdir(), 'gev-shutdown-cleanup-'),
  );
  const removed = await cleanupScratchProfile(scratch);
  assert.deepEqual(removed, { status: 'removed' });
  await assert.rejects(stat(scratch));

  const failedRemoval = await cleanupScratchProfile(scratch, {
    resolvePath: async (value) => value,
    removeOwned: async () => {
      throw new Error('denied');
    },
    tempDirectory: path.dirname(scratch),
  });
  assert.deepEqual(failedRemoval, {
    status: 'retained-cleanup-failed',
    failure: 'temporary-profile-cleanup-failed',
  });
  await rm(scratch, { recursive: true, force: true });

  const rejectedPath = await cleanupScratchProfile('elsewhere', {
    resolvePath: async (value) =>
      value === os.tmpdir() ? value : path.join(value, 'canonical'),
    removeOwned: async () => assert.fail('unsafe path must not be removed'),
  });
  assert.equal(rejectedPath.status, 'retained-path-validation-failed');
});

test('shutdown CLI can be imported for fixture tests without launching Chrome', () => {
  assert.equal(typeof main, 'function');
  assert.equal(typeof setupDocument, 'function');
});

test('serialized pagehide handler reaches the bounded owned fixture server', async (t) => {
  const fixture = await startFixtureServer();
  t.after(async () => {
    const closed = await closeFixtureServer(fixture.server);
    assert.equal(closed.completed, true);
  });
  const listeners = [];
  const sentBeacons = [];
  const browserContext = vm.createContext({
    Date,
    Math,
    encodeURIComponent,
    window: {
      addEventListener(name, callback) {
        if (name === 'pagehide') listeners.push(callback);
      },
    },
    navigator: {
      sendBeacon(url, body) {
        sentBeacons.push({ url, body });
        void fetch(new URL(url, fixture.origin), {
          method: 'POST',
          body,
        });
        return true;
      },
    },
  });
  const callOrder = [];
  const runSerialized = (callback) =>
    vm.runInContext(`(${callback.toString()})()`, browserContext);
  const page = {
    async evaluate(callback) {
      callOrder.push('evaluate');
      return runSerialized(callback);
    },
    async setRequestInterception() {},
    async goto(url) {
      callOrder.push('goto');
      this.currentUrl = url;
      browserContext.window = {
        addEventListener(name, callback) {
          if (name === 'pagehide') listeners.push(callback);
        },
      };
    },
    on() {},
    url() {
      return this.currentUrl;
    },
  };
  const prepared = await setupDocument(
    page,
    'blank',
    fixture.origin,
    fixture.pageHideTracker,
  );
  assert.equal(prepared.documentReady, true);
  assert.deepEqual(callOrder.slice(0, 2), ['goto', 'evaluate']);
  assert.equal(listeners.length, 1);
  assert.equal(prepared.getPageHideCount(), 0);
  assert.equal(
    fixture.pageHideTracker.arm(prepared.getPageHideToken(), performance.now()),
    true,
  );
  listeners[0]({ persisted: false });
  for (
    let attempt = 0;
    attempt < 20 && prepared.getPageHideCount() === 0;
    attempt++
  )
    await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(prepared.getPageHideCount(), 1);
  const observation = prepared.getPageHideObservation();
  assert.equal(observation.scope, 'fixture-server-sendBeacon');
  assert.equal(observation.count, 1);
  assert.equal(observation.persisted, false);
  assert.ok(Number.isFinite(observation.deliveryElapsedMs));
  assert.ok(observation.deliveryElapsedMs >= 0);
  assert.equal(sentBeacons.length, 1);
  assert.match(sentBeacons[0].url, /^\/__qa\/pagehide\?token=/);
  assert.equal(sentBeacons[0].body, '');
  assert.equal(typeof installPageHideBeacon, 'function');
});

test('pagehide endpoint rejects unknown tokens, malformed events, and oversized bodies', async (t) => {
  const fixture = await startFixtureServer();
  t.after(async () => {
    const closed = await closeFixtureServer(fixture.server);
    assert.equal(closed.completed, true);
  });
  const token = 'fixture-token-1';
  assert.equal(fixture.pageHideTracker.register(token), true);

  const post = (url, body = '') =>
    fetch(`${fixture.origin}${url}`, { method: 'POST', body });
  const unknown = await post('/__qa/pagehide?token=unknown-token&persisted=0');
  assert.equal(unknown.status, 404);
  const malformed = await post(`/__qa/pagehide?token=${token}&persisted=yes`);
  assert.equal(malformed.status, 400);
  const oversized = await post(
    `/__qa/pagehide?token=${token}&persisted=1`,
    'x'.repeat(64),
  );
  assert.equal(oversized.status, 413);
  const nonempty = await post(`/__qa/pagehide?token=${token}&persisted=1`, 'x');
  assert.equal(nonempty.status, 400);
  const chunkedOversize = await new Promise((resolve, reject) => {
    const target = new URL(
      `${fixture.origin}/__qa/pagehide?token=${token}&persisted=1`,
    );
    const outgoing = request(
      {
        hostname: target.hostname,
        port: target.port,
        path: target.pathname + target.search,
        method: 'POST',
        headers: { 'Transfer-Encoding': 'chunked' },
      },
      (incoming) => {
        incoming.resume();
        incoming.once('end', () => resolve(incoming.statusCode));
      },
    );
    outgoing.once('error', reject);
    outgoing.end('x'.repeat(64));
  });
  assert.equal(chunkedOversize, 413);
  const bodyTimeout = await new Promise((resolve, reject) => {
    const target = new URL(
      `${fixture.origin}/__qa/pagehide?token=${token}&persisted=1`,
    );
    const outgoing = request(
      {
        hostname: target.hostname,
        port: target.port,
        path: target.pathname + target.search,
        method: 'POST',
        headers: { 'Transfer-Encoding': 'chunked' },
      },
      (incoming) => {
        incoming.resume();
        incoming.once('end', () => resolve(incoming.statusCode));
      },
    );
    outgoing.once('error', reject);
    outgoing.flushHeaders();
  });
  assert.equal(bodyTimeout, 408);
  assert.equal(fixture.pageHideTracker.read(token).count, 0);
  assert.equal(fixture.pageHideTracker.size, 1);
});

test('pagehide tracker bounds registered control tokens and ignores delayed or absent delivery', async (t) => {
  const fixture = await startFixtureServer();
  t.after(async () => {
    const closed = await closeFixtureServer(fixture.server);
    assert.equal(closed.completed, true);
  });
  for (let index = 0; index < 6; index++)
    assert.equal(fixture.pageHideTracker.register(`token-${index}`), true);
  assert.equal(fixture.pageHideTracker.size, 6);
  assert.equal(fixture.pageHideTracker.register('overflow'), false);
  assert.equal(fixture.pageHideTracker.read('token-0').count, 0);
  assert.equal(fixture.pageHideTracker.observe('not-registered', false), false);
  assert.equal(fixture.pageHideTracker.arm('token-0', performance.now()), true);
  assert.equal(fixture.pageHideTracker.observe('token-0', true), true);
  const observed = fixture.pageHideTracker.read('token-0');
  assert.equal(observed.count, 1);
  assert.equal(observed.persisted, true);
  assert.ok(Number.isFinite(observed.deliveryElapsedMs));
  assert.equal(observed.receivedWithinDeadline, true);
  assert.equal(observed.deadlineMs, 1_000);
  assert.equal(fixture.pageHideTracker.observe('token-0', false), true);
  assert.equal(fixture.pageHideTracker.observe('token-0', false), false);
  assert.equal(fixture.pageHideTracker.read('token-0').count, 2);
});

test('pagehide timing uses server receipt time and late evidence remains a failure', async (t) => {
  const fixture = await startFixtureServer();
  t.after(async () => {
    const closed = await closeFixtureServer(fixture.server);
    assert.equal(closed.completed, true);
  });
  assert.equal(fixture.pageHideTracker.register('late-token'), true);
  assert.equal(
    fixture.pageHideTracker.arm('late-token', performance.now() - 1_100),
    true,
  );
  assert.equal(fixture.pageHideTracker.observe('late-token', false), true);
  const late = fixture.pageHideTracker.read('late-token');
  assert.ok(late.deliveryElapsedMs > late.deadlineMs);
  assert.equal(late.receivedWithinDeadline, false);
  const failedDeadline = {
    pageHideObserved: false,
    pageHideFailureReason: 'outgoing-pagehide-beacon-not-observed',
  };
  recordPageHideAfterDeadline(failedDeadline, late, 0, true);
  assert.equal(failedDeadline.pageHideObserved, false);
  assert.equal(
    failedDeadline.pageHideFailureReason,
    'outgoing-pagehide-beacon-not-observed',
  );
  assert.equal(failedDeadline.pageHideObservedAfterDeadline, true);
  const control = BROWSER_SHUTDOWN_CONTROLS.find(
    ({ id }) => id === 'blank-unload',
  );
  assert.equal(
    classifyBrowserShutdownControl(
      successfulResult(control, {
        pageHideObserved: false,
        pageHideObservedAfterDeadline: true,
        pageHideFailureReason: 'outgoing-pagehide-beacon-not-observed',
        pageHideObservation: late,
      }),
    ),
    'failed',
  );
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
  const unavailableDebugExtension = successfulResult(webgl);
  unavailableDebugExtension.readiness.renderingContext.debugRendererInfoAvailable = false;
  unavailableDebugExtension.readiness.renderingContext.unmaskedVendor = null;
  unavailableDebugExtension.readiness.renderingContext.unmaskedRenderer = null;
  assert.equal(
    classifyBrowserShutdownControl(unavailableDebugExtension),
    'passed',
  );
  unavailableDebugExtension.readiness.renderingContext.unmaskedRenderer =
    'inferred from launch flags';
  assert.equal(
    classifyBrowserShutdownControl(unavailableDebugExtension),
    'failed',
  );
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
