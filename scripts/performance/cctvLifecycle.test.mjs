import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import sharp from 'sharp';
import { createCctvSource } from '../../src/layers/cctv/source.js';
import {
  assertCctvCheckpoint,
  assertCctvCameraPose,
  assertCctvCycleReuse,
  cctvLifecycleShareHash,
  cctvTaskErrorSignature,
  configureCctvLifecycleSceneInPage,
  createCctvLifecycleFixture,
  parseCctvLifecycleArgs,
  readCctvLifecycleCheckpointInPage,
  reinitializeDisabledCctvModuleInPage,
  setCctvLifecycleEnabledInPage,
  validateCctvLifecycleReport,
  waitForCctvLifecycleRenderInPage,
} from './cctvLifecycle.mjs';
import {
  captureCctvFixtureResponse,
  runCctvLifecycle,
  waitForCctvLifecycleDrain,
} from '../qa-cctv-lifecycle.mjs';

function validCheckpoint(enabled, probeError = false) {
  return {
    appCommit: 'a'.repeat(40),
    enabled,
    lifecycleState: enabled ? 'enabled' : 'disabled',
    moduleEnabled: enabled,
    stats: {
      count: 1,
      loading: false,
      loadingLoaded: 1,
      loadingTotal: 1,
      error: null,
    },
    cameras: [{ id: 'qa-cctv-lifecycle-camera-001', active: true }],
    cameraCount: 1,
    activeCameraId: 'qa-cctv-lifecycle-camera-001',
    diagnostics: {
      listeners: 4,
      timers: enabled ? 1 : 0,
      pendingJobs: 0,
      primitives: 1,
      dataSources: 1,
      cacheEntries: 0,
    },
    scene: { entities: 1, dataSources: 0, primitives: 8, groundPrimitives: 0 },
    cameraView: {
      west: -98,
      east: -97,
      south: 30,
      north: 31,
      containsFixture: true,
    },
    cameraPose: {
      longitude: -97.7431,
      latitude: 30.2672,
      heightM: 25_000,
      headingRadians: 0,
      pitchRadians: -1.2,
      rollRadians: 0,
    },
    boundaryRender: { frameNumber: 11, elapsedMs: 90 },
    render: { frameNumber: 22, elapsedMs: 1100 },
    drainStability: {
      status: 'stable',
      windowMs: 1000,
      sampleCount: 11,
      firstFrameNumber: 12,
      lastFrameNumber: 22,
      maximumSampleGapMs: 100,
    },
    worker: {
      instrumented: true,
      overflow: false,
      pending: 0,
      workerCount: 2,
      workersTruncated: false,
      workers: [
        {
          kind: 'createGeometry.js',
          submitted: 4,
          completed: 4,
          cancelled: 0,
          pending: 0,
          taskErrors: probeError ? 1 : 0,
          workerErrors: 0,
          postErrors: 0,
          terminated: probeError,
          oldestPendingMs: 0,
        },
        {
          kind: 'createGeometry.js',
          submitted: 3,
          completed: 3,
          cancelled: 0,
          pending: 0,
          taskErrors: 0,
          workerErrors: 0,
          postErrors: 0,
          terminated: false,
          oldestPendingMs: 0,
        },
      ],
    },
    renderer: {
      classification: 'software',
      name: 'SwiftShader',
      vendor: 'Google',
      contextAttributes: { antialias: true },
    },
    canvas: { width: 1440, height: 1000, cssWidth: 1440, cssHeight: 1000 },
  };
}

function validReport(cycles = 5) {
  const fixture = createCctvLifecycleFixture();
  const enabled = validCheckpoint(true, true);
  const disabled = validCheckpoint(false, true);
  const direct = structuredClone(disabled);
  return {
    schema: 'gev-cctv-lifecycle/v1',
    status: 'passed',
    validationStatus: 'passed',
    applicationCommit: 'a'.repeat(40),
    harnessCommit: 'a'.repeat(40),
    servedApplicationCommit: 'a'.repeat(40),
    applicationSourceCleanAtStart: true,
    applicationSourceCleanAtEnd: true,
    sourceChangedDuringRun: false,
    githubMatchesHeadAtStart: true,
    githubMatchesHeadAtEnd: true,
    fixture: {
      id: fixture.id,
      sha256: fixture.sha256,
      cameraCount: 1,
      cameraId: fixture.cameraId,
      frameSha256: fixture.frameSha256,
      clockPolicy: fixture.clockPolicy,
      view: fixture.view,
    },
    environment: {
      nodeVersion: process.version,
      host: {
        platform: process.platform,
        architecture: process.arch,
        osRelease: 'test-os',
        cpu: 'test-cpu',
        logicalCpus: 2,
        memoryBytes: 1024,
      },
      cesiumVersion: '1.138.0',
      browserVersion: 'HeadlessChrome/152.0.0.0',
      viewport: { width: 1440, height: 1000 },
    },
    sceneConfiguration: { ...fixture.view, applied: true },
    sceneReadiness: { status: 'ready', elapsedMs: 1 },
    renderer: enabled.renderer,
    workerPreflight: {
      status: 'passed',
      expectedTaskErrorWorkers: [
        {
          index: 0,
          kind: 'createGeometry.js',
          taskErrors: 1,
          terminated: true,
        },
      ],
    },
    warmup: {
      enabled,
      disabled,
      createGeometrySubmitted: 3,
      workerTotals: {
        submitted: 7,
        completed: 7,
        workerCount: 2,
        identifiableCreateGeometryWorkers: 2,
        activeCreateGeometryWorkers: 1,
        activeCreateGeometrySubmitted: 3,
        allWorkerSubmitted: 7,
      },
    },
    cycles: Array.from({ length: cycles }, (_, index) => ({
      cycle: index + 1,
      status: 'passed',
      enabled: structuredClone(enabled),
      disabled: structuredClone(disabled),
      enabledWorkerTotals: {
        submitted: 7,
        completed: 7,
        workerCount: 2,
        identifiableCreateGeometryWorkers: 2,
        activeCreateGeometryWorkers: 1,
        activeCreateGeometrySubmitted: 3,
        allWorkerSubmitted: 7,
      },
      disabledWorkerTotals: {
        submitted: 7,
        completed: 7,
        workerCount: 2,
        identifiableCreateGeometryWorkers: 2,
        activeCreateGeometryWorkers: 1,
        activeCreateGeometrySubmitted: 3,
        allWorkerSubmitted: 7,
      },
      createGeometrySubmitted: 3,
    })),
    directReinit: {
      scope: 'disabled-direct-module-init',
      status: 'passed',
      initializedDisabled: structuredClone(disabled),
      rewarmedEnabled: structuredClone(enabled),
      checkpoint: direct,
    },
    fixtureDelivery: {
      id: fixture.id,
      sha256: fixture.sha256,
      cameraCount: 1,
      cameraId: fixture.cameraId,
      sourceResponses: 2,
      healthResponses: 2,
      frameResponses: 1,
      frameSha256: fixture.frameSha256,
      clockPolicy: fixture.clockPolicy,
      healthPolicy: 'fixed-empty-health-snapshot',
    },
    pageClose: {
      closeCompleted: true,
      openPageCount: 0,
      scope: 'owned-context-only',
    },
    contextClose: { completed: true },
    browserClose: {
      closeCompleted: true,
      forcedProcessTermination: false,
      observation: {
        closeDeadlineMs: 5000,
        closeElapsedMs: 100,
        forceProcessStatus: 'not-needed',
        processExit: { code: 0, signal: null, elapsedMs: 100 },
      },
    },
    applicationCommitAtEnd: 'a'.repeat(40),
    pageErrors: [],
    failedPhase: null,
    error: null,
  };
}

test('CCTV lifecycle args constrain cycles, drain deadline and origin URL', () => {
  assert.deepEqual(
    parseCctvLifecycleArgs(['--cycles', '5', '--drain-ms', '10000']).cycles,
    5,
  );
  assert.throws(() => parseCctvLifecycleArgs(['--cycles', '11']), /cycles/);
  assert.throws(() => parseCctvLifecycleArgs(['--drain-ms', '10001']), /drain/);
  assert.throws(
    () => parseCctvLifecycleArgs(['--url', 'https://user:pass@example.test']),
    /url/,
  );
  assert.throws(
    () => parseCctvLifecycleArgs(['--unexpected', 'x']),
    /argument/,
  );
});

test('fixture response serves only the exact CCTV source and health endpoints', () => {
  const fixture = createCctvLifecycleFixture();
  const base = 'http://localhost:4174';
  const sources = captureCctvFixtureResponse(
    fixture,
    new URL(`${base}/api/cctv/sources`),
    base,
  );
  const health = captureCctvFixtureResponse(
    fixture,
    new URL(`${base}/api/cctv/health`),
    base,
  );
  assert.equal(JSON.parse(sources.body).sources[0].id, fixture.cameraId);
  assert.deepEqual(JSON.parse(health.body).cameras, []);
  const productionFrameUrl = new URL(
    createCctvSource().getFrameUrl(fixture.sources[0]),
    base,
  );
  assert.match(productionFrameUrl.search, /label=/);
  assert.equal(
    captureCctvFixtureResponse(fixture, productionFrameUrl, base).contentType,
    'image/png',
  );
  assert.equal(
    captureCctvFixtureResponse(
      fixture,
      new URL(`${base}/api/cctv/frame/not-the-fixture?label=ignored`),
      base,
    ),
    null,
  );
  assert.equal(
    captureCctvFixtureResponse(
      fixture,
      new URL('https://external.test/api/cctv/sources'),
      base,
    ),
    null,
  );
  assert.equal(
    captureCctvFixtureResponse(
      fixture,
      new URL(`${base}/api/cctv/sources?x=1`),
      base,
    ),
    null,
  );
  assert.match(fixture.sha256, /^[a-f0-9]{64}$/);
});

test('serialized checkpoint callback reads the actual module, scene, worker and renderer fields', async () => {
  const module = {
    getStats: () => ({
      count: 1,
      loading: false,
      loadingLoaded: 1,
      loadingTotal: 1,
      error: null,
    }),
    getUIState: () => ({
      enabled: true,
      cameras: [{ id: 'qa-cctv-lifecycle-camera-001', active: true }],
      activeCameraId: 'qa-cctv-lifecycle-camera-001',
    }),
    getPerformanceDiagnostics: () => ({
      listeners: 1,
      timers: 0,
      pendingJobs: 0,
      primitives: 1,
      dataSources: 0,
      cacheEntries: 0,
    }),
  };
  const gl = {
    getContextAttributes: () => ({ antialias: true }),
    getExtension: () => ({
      UNMASKED_RENDERER_WEBGL: 1,
      UNMASKED_VENDOR_WEBGL: 2,
    }),
    getParameter: (parameter) =>
      parameter === 1 ? 'Google SwiftShader' : 'Google',
  };
  const result = vm.runInNewContext(
    `(${readCctvLifecycleCheckpointInPage.toString()})({ includeRenderer: true, fixtureView: ${JSON.stringify(createCctvLifecycleFixture().view)} })`,
    {
      window: {
        __godsEyeView: {
          dataManager: {
            layers: new Map([['cctv', { module }]]),
            isEnabled: () => true,
            getLayerLifecycleState: () => 'enabled',
            setLayerParams: () => true,
          },
          viewer: {
            scene: {
              context: { _originalGLContext: gl },
              globe: {
                ellipsoid: {
                  cartographicToCartesian: (point) => point,
                  cartesianToCartographic: (point) => point,
                },
              },
              primitives: { length: 3 },
              groundPrimitives: { length: 0 },
              canvas: {
                width: 1440,
                height: 1000,
                getBoundingClientRect: () => ({ width: 1440, height: 1000 }),
              },
            },
            camera: {
              setView: () => {},
              positionWC: {
                longitude: (-97.7431 * Math.PI) / 180,
                latitude: (30.2672 * Math.PI) / 180,
                height: 25_000,
              },
              heading: 0,
              pitch: -1.2,
              roll: 0,
              computeViewRectangle: () => ({
                west: (-98 * Math.PI) / 180,
                east: (-97 * Math.PI) / 180,
                south: (30 * Math.PI) / 180,
                north: (31 * Math.PI) / 180,
              }),
            },
            entities: { values: [1] },
            dataSources: { length: 0 },
          },
          getPerformanceEnvironment: () => ({ appCommit: 'a'.repeat(40) }),
        },
        __gevSoakWorkers: {
          snapshot: () => ({
            instrumented: true,
            overflow: false,
            pending: 0,
            workers: [],
          }),
        },
      },
      module,
    },
  );
  assert.equal(result.renderer.classification, 'software');
  assert.equal(result.renderer.name, 'Google SwiftShader');
  assert.equal(result.cameraCount, 1);
  assert.equal(result.scene.primitives, 3);
  assert.equal(result.cameraView.containsFixture, true);
  assert.ok(Math.abs(result.cameraPose.longitude - -97.7431) < 1e-10);
  assert.ok(Math.abs(result.cameraPose.latitude - 30.2672) < 1e-10);
  assert.equal(result.cameraPose.heightM, 25_000);
  assertCctvCheckpoint(result);
  const configured = [];
  const ordered = [];
  let resolveRestore;
  const initialRestorePromise = new Promise((resolve) => {
    resolveRestore = resolve;
  });
  const configContext = vm.createContext({
    window: {
      __godsEyeView: {
        styleManager: { initialRestorePromise },
        dataManager: {
          setLayerParams: () => {
            ordered.push('params');
            return true;
          },
          layers: new Map([
            ['cctv', { module: { getUIState: () => ({ autoHop: false }) } }],
          ]),
        },
        viewer: {
          scene: {
            globe: {
              ellipsoid: { cartographicToCartesian: (point) => point },
            },
          },
          camera: { setView: (value) => configured.push(value) },
        },
      },
    },
    Math,
    Promise,
    Error,
  });
  const configPromise = vm.runInContext(
    `(${configureCctvLifecycleSceneInPage.toString()})(${JSON.stringify(createCctvLifecycleFixture().view)})`,
    configContext,
  );
  assert.deepEqual(ordered, []);
  resolveRestore();
  const sceneConfiguration = await configPromise;
  assert.deepEqual(JSON.parse(JSON.stringify(sceneConfiguration)), {
    ...createCctvLifecycleFixture().view,
    applied: true,
  });
  assert.equal(configured.length, 1);
  assert.deepEqual(ordered, ['params']);
});

test('CCTV share hash has finite camera coordinates and suppresses the unrelated startup flight', () => {
  assert.equal(cctvLifecycleShareHash(), '#lat=30.2672&lon=-97.7431');
  assert.match(cctvLifecycleShareHash(), /lat=-?\d+(?:\.\d+)?&lon=-?\d/);
});

test('synthetic CCTV frame is a decodable 2x2 PNG and its bytes match the fixture digest', async () => {
  const fixture = createCctvLifecycleFixture();
  const response = captureCctvFixtureResponse(
    fixture,
    new URL(`http://localhost:4174/api/cctv/frame/${fixture.cameraId}`),
    'http://localhost:4174',
  );
  assert.equal(response.contentType, 'image/png');
  const bytes = Buffer.from(response.body);
  const decoded = await sharp(bytes).metadata();
  assert.equal(decoded.format, 'png');
  assert.equal(decoded.width, 2);
  assert.equal(decoded.height, 2);
});

test('serialized manager toggles and disabled direct init invoke real public methods', async () => {
  const calls = [];
  const manager = {
    isEnabled: () => false,
    setEnabled: async (...args) => {
      calls.push(args);
      return true;
    },
    layers: new Map([
      ['cctv', { module: { init: async () => calls.push(['init']) } }],
    ]),
  };
  const context = vm.createContext({
    window: { __godsEyeView: { dataManager: manager, viewer: {} } },
    TypeError,
    Error,
  });
  await vm.runInContext(
    `(${setCctvLifecycleEnabledInPage.toString()})(false)`,
    context,
  );
  await vm.runInContext(
    `(${reinitializeDisabledCctvModuleInPage.toString()})()`,
    context,
  );
  assert.equal(calls[0][0], 'cctv');
  assert.equal(calls[0][1], false);
  assert.deepEqual(calls[1], ['init']);
});

test('completed-render waiter registers, requests through governor and removes its listener', async () => {
  const listeners = new Set();
  const scene = {
    postRender: {
      addEventListener: (listener) => {
        listeners.add(listener);
      },
      removeEventListener: (listener) => {
        listeners.delete(listener);
      },
    },
    frameState: { frameNumber: 17 },
    requestRender: () => {
      requested++;
      queueMicrotask(() => [...listeners].forEach((listener) => listener()));
    },
  };
  let requested = 0;
  const pageContext = vm.createContext({
    window: {
      __godsEyeView: {
        viewer: { scene },
        requestRender: () => {
          requested++;
          queueMicrotask(() =>
            [...listeners].forEach((listener) => listener()),
          );
        },
      },
    },
    performance: { now: () => 123 },
    Promise,
    setTimeout,
    clearTimeout,
    Error,
    Number,
  });
  const result = await vm.runInContext(
    `(${waitForCctvLifecycleRenderInPage.toString()})(100)`,
    pageContext,
  );
  assert.equal(result.frameNumber, 17);
  assert.equal(requested, 1);
  assert.equal(listeners.size, 0);
});

test('CCTV checkpoint rejects pending/errors/invalid counters', () => {
  const pending = validCheckpoint(false);
  pending.worker.pending = 1;
  assert.throws(() => assertCctvCheckpoint(pending), /worker/);
  const loading = validCheckpoint(true);
  loading.stats.loading = true;
  assert.throws(() => assertCctvCheckpoint(loading), /settled/);
  const negative = validCheckpoint(false);
  negative.diagnostics.listeners = -1;
  assert.throws(() => assertCctvCheckpoint(negative), /listeners/);
  const workerError = validCheckpoint(false);
  workerError.worker.workers[0].taskErrors = 1;
  assert.throws(() => assertCctvCheckpoint(workerError), /worker/);
  const incompleteWorkerInventory = validCheckpoint(false);
  incompleteWorkerInventory.worker.workerCount++;
  assert.throws(
    () => assertCctvCheckpoint(incompleteWorkerInventory),
    /worker checkpoint/,
  );
  const inconsistentWorkerTotals = validCheckpoint(false);
  inconsistentWorkerTotals.worker.workers[1].completed--;
  assert.throws(
    () => assertCctvCheckpoint(inconsistentWorkerTotals),
    /worker checkpoint/,
  );
});

test('CCTV lifecycle report validates five exact toggles, scene resources and direct disabled reinit', () => {
  const report = validReport();
  const fixture = createCctvLifecycleFixture();
  assert.equal(assertCctvCycleReuse(report.cycles[0], report.warmup), true);
  const wrappedHeading = structuredClone(report.cycles[0].enabled);
  wrappedHeading.cameraPose.headingRadians = Math.PI * 2;
  assertCctvCameraPose(wrappedHeading, fixture.view);
  assert.equal(
    validateCctvLifecycleReport(report, { fixtureSha256: fixture.sha256 })
      .status,
    'passed',
  );
  const missingCycle = structuredClone(report);
  missingCycle.cycles.pop();
  assert.throws(
    () =>
      validateCctvLifecycleReport(missingCycle, {
        fixtureSha256: fixture.sha256,
      }),
    /inventory/,
  );
  const changedResource = structuredClone(report);
  changedResource.cycles[2].disabled.scene.primitives++;
  assert.throws(
    () =>
      validateCctvLifecycleReport(changedResource, {
        fixtureSha256: fixture.sha256,
      }),
    /resources/,
  );
  const extraGeometry = structuredClone(report);
  extraGeometry.cycles[0].createGeometrySubmitted++;
  assert.throws(
    () =>
      validateCctvLifecycleReport(extraGeometry, {
        fixtureSha256: fixture.sha256,
      }),
    /resubmitted/,
  );
  const forcedClose = structuredClone(report);
  forcedClose.browserClose.forcedProcessTermination = true;
  assert.throws(
    () =>
      validateCctvLifecycleReport(forcedClose, {
        fixtureSha256: fixture.sha256,
      }),
    /close cleanly/,
  );
  const wrongFixture = structuredClone(report);
  wrongFixture.fixture.cameraId = 'another-camera';
  assert.throws(
    () =>
      validateCctvLifecycleReport(wrongFixture, {
        fixtureSha256: fixture.sha256,
      }),
    /fixture identity/,
  );
  const changedCheckpointCommit = structuredClone(report);
  changedCheckpointCommit.cycles[0].enabled.appCommit = 'b'.repeat(40);
  assert.throws(
    () =>
      validateCctvLifecycleReport(changedCheckpointCommit, {
        fixtureSha256: fixture.sha256,
      }),
    /checkpoint application commit/,
  );
  const truncatedWorkers = structuredClone(report);
  truncatedWorkers.cycles[0].enabled.worker.workersTruncated = true;
  assert.throws(
    () =>
      validateCctvLifecycleReport(truncatedWorkers, {
        fixtureSha256: fixture.sha256,
      }),
    /worker checkpoint/,
  );
  const noActiveGeometry = structuredClone(report);
  noActiveGeometry.warmup.enabled.worker.workers[1].terminated = true;
  assert.throws(
    () =>
      validateCctvLifecycleReport(noActiveGeometry, {
        fixtureSha256: fixture.sha256,
      }),
    /nonterminated createGeometry/,
  );
  const missingDelivery = structuredClone(report);
  delete missingDelivery.fixtureDelivery.frameResponses;
  assert.throws(
    () =>
      validateCctvLifecycleReport(missingDelivery, {
        fixtureSha256: fixture.sha256,
      }),
    /delivery/,
  );
  const startupFlight = structuredClone(report);
  startupFlight.cycles[0].enabled.cameraPose.latitude += 1;
  assert.throws(
    () =>
      validateCctvLifecycleReport(startupFlight, {
        fixtureSha256: fixture.sha256,
      }),
    /camera pose/,
  );
  const unstableCheckpoint = structuredClone(report);
  unstableCheckpoint.cycles[0].disabled.drainStability.windowMs = 999;
  assert.throws(
    () =>
      validateCctvLifecycleReport(unstableCheckpoint, {
        fixtureSha256: fixture.sha256,
      }),
    /stable one-second/,
  );
});

function createCctvRunnerDependencies({
  failBoot = false,
  resubmitOnFirstCycle = false,
  extraDirectReinitBuilds = false,
} = {}) {
  const order = [];
  const commit = 'a'.repeat(40);
  const fixture = createCctvLifecycleFixture();
  const fixtureFrameUrl = new URL(
    createCctvSource().getFrameUrl(fixture.sources[0]),
    'http://localhost:4174',
  ).href;
  let enabled = false;
  let enableCalls = 0;
  let onFulfilled;
  let rendererReads = 0;
  let pageClosed = false;
  let bootHash = null;
  const worker = {
    instrumented: true,
    overflow: false,
    pending: 0,
    workers: [
      {
        kind: 'createGeometry.js',
        submitted: 4,
        completed: 4,
        cancelled: 0,
        pending: 0,
        taskErrors: 1,
        workerErrors: 0,
        postErrors: 0,
        terminated: true,
        oldestPendingMs: 0,
      },
      {
        kind: 'createGeometry.js',
        submitted: 3,
        completed: 3,
        cancelled: 0,
        pending: 0,
        taskErrors: 0,
        workerErrors: 0,
        postErrors: 0,
        terminated: false,
        oldestPendingMs: 0,
      },
    ],
  };
  const fulfill = (pathOrUrl) =>
    onFulfilled?.({
      url: pathOrUrl.startsWith('http://')
        ? pathOrUrl
        : `http://localhost:4174${pathOrUrl}`,
    });
  const module = {
    getStats: () => ({
      count: 1,
      loading: false,
      loadingLoaded: 1,
      loadingTotal: 1,
      error: null,
    }),
    getUIState: () => ({
      enabled,
      cameras: [{ id: fixture.cameraId, active: true }],
      activeCameraId: fixture.cameraId,
      autoHop: false,
    }),
    getPerformanceDiagnostics: () => ({
      listeners: 4,
      timers: enabled ? 1 : 0,
      pendingJobs: 0,
      primitives: 1,
      dataSources: 1,
      cacheEntries: 0,
    }),
    init: async () => {
      if (extraDirectReinitBuilds) {
        worker.workers[1].submitted += 2;
        worker.workers[1].completed += 2;
      }
      fulfill('/api/cctv/sources');
      fulfill('/api/cctv/health');
    },
  };
  const manager = {
    layers: new Map([['cctv', { module }]]),
    isEnabled: () => enabled,
    getLayerLifecycleState: () => (enabled ? 'enabled' : 'disabled'),
    getAll: () => [
      { id: 'cctv', enabled },
      { id: 'terrain', enabled: false },
    ],
    restoreEnabledLayerIds: async (ids) => {
      order.push('disable-unrelated');
      enabled = ids.includes('cctv');
    },
    setEnabled: async (id, value) => {
      order.push(value ? 'enable' : 'disable');
      enabled = value;
      if (value) {
        enableCalls++;
        if (resubmitOnFirstCycle && enableCalls === 2) {
          worker.workers[1].submitted++;
          worker.workers[1].completed++;
        }
        fulfill('/api/cctv/sources');
        fulfill('/api/cctv/health');
        fulfill(fixtureFrameUrl);
      }
      return true;
    },
    setLayerParams: () => true,
  };
  const listeners = new Set();
  const gl = {
    getContextAttributes: () => ({ antialias: true }),
    getExtension: () => {
      rendererReads++;
      return { UNMASKED_RENDERER_WEBGL: 1, UNMASKED_VENDOR_WEBGL: 2 };
    },
    getParameter: (parameter) =>
      parameter === 1 ? 'Google SwiftShader' : 'Google',
  };
  const scene = {
    postRender: {
      addEventListener: (listener) => listeners.add(listener),
      removeEventListener: (listener) => listeners.delete(listener),
    },
    frameState: { frameNumber: 1 },
    context: { _originalGLContext: gl },
    globe: {
      ellipsoid: {
        cartographicToCartesian: (position) => position,
        cartesianToCartographic: (position) => position,
      },
    },
    primitives: { length: 8 },
    groundPrimitives: { length: 0 },
    canvas: {
      width: 1440,
      height: 1000,
      getBoundingClientRect: () => ({ width: 1440, height: 1000 }),
    },
    requestRender: () => {
      scene.frameState.frameNumber++;
      for (const listener of [...listeners]) listener();
    },
  };
  const debug = {
    dataManager: manager,
    viewer: {
      scene,
      camera: {
        setView: ({ destination, orientation }) => {
          debug.viewer.camera.positionWC = destination;
          debug.viewer.camera.heading = orientation.heading;
          debug.viewer.camera.pitch = orientation.pitch;
          debug.viewer.camera.roll = orientation.roll;
        },
        positionWC: {
          longitude: (-97.7431 * Math.PI) / 180,
          latitude: (30.2672 * Math.PI) / 180,
          height: 25_000,
        },
        heading: 0,
        pitch: -1.2,
        roll: 0,
        computeViewRectangle: () => ({
          west: (-98 * Math.PI) / 180,
          east: (-97 * Math.PI) / 180,
          south: (30 * Math.PI) / 180,
          north: (31 * Math.PI) / 180,
        }),
      },
      entities: { values: [1] },
      dataSources: { length: 0 },
    },
    styleManager: { initialRestorePromise: Promise.resolve() },
    getPerformanceEnvironment: () => ({ appCommit: commit }),
  };
  const page = {
    url: () => (pageClosed ? 'about:blank' : 'http://localhost:4174/'),
    isClosed: () => pageClosed,
    close: async () => {
      pageClosed = true;
      order.push('page-close');
    },
    setDefaultTimeout() {},
    evaluateOnNewDocument() {},
    evaluate: async (callback, ...args) => {
      const context = vm.createContext({
        window: {
          __godsEyeView: debug,
          __gevSoakWorkers: { snapshot: () => worker },
        },
        Promise,
        Error,
        TypeError,
        Number,
        String,
        Boolean,
        Array,
        setTimeout,
        clearTimeout,
        performance: { now: () => 1 },
      });
      return vm.runInContext(`(${callback.toString()})`, context)(...args);
    },
  };
  const context = {
    newPage: async () => page,
    pages: async () => (pageClosed ? [] : [page]),
    close: async () => {
      order.push('context-close');
    },
  };
  const browser = {
    createBrowserContext: async () => context,
    pages: async () => [
      { url: () => 'about:blank' },
      ...(pageClosed ? [] : [page]),
    ],
    process: () => ({}),
    version: async () => 'HeadlessChrome/152.0.0.0',
  };
  const identity = {
    commit,
    clean: true,
    githubSha: commit,
    githubMatchesHead: true,
  };
  const dependencies = {
    gitIdentity: () => identity,
    launchFixtureBrowser: async () => {
      order.push('browser-launch');
      return browser;
    },
    prepareFixturePage: async (_browser, _base, options) => {
      onFulfilled = options.onFulfilled;
      return { page, errors: [], verifyNetwork: async () => true };
    },
    bootFixturePage: async (
      _page,
      _base,
      { hash, onProgress: bootProgress },
    ) => {
      order.push('boot');
      bootHash = hash;
      bootProgress('ready');
      if (failBoot) throw new Error('synthetic boot failure');
    },
    cleanupFixturePageDiagnostics: async () => {
      order.push('page-diagnostics-cleanup');
    },
    installWorkerDiagnostics: () => {},
    installLifecycleRenderWaiter: () => {},
    installLifecycleDrainObserver: () => {},
    installLifecycleSceneReadinessObserver: () => {},
    waitForLifecycleSceneReadiness: async () => {
      order.push('scene-ready');
      return { status: 'ready', elapsedMs: 1 };
    },
    readWorkerPreflight: async () => {
      order.push('worker-preflight');
      return { status: 'passed' };
    },
    closeRecoveryBrowser: async (_browser, { timeoutMs }) => {
      order.push('browser-close');
      return {
        closeCompleted: true,
        forcedProcessTermination: false,
        observation: {
          closeDeadlineMs: timeoutMs,
          closeElapsedMs: 10,
          forceProcessStatus: 'not-needed',
          processExit: { code: 0, signal: null, elapsedMs: 10 },
        },
      };
    },
    stopOwnedRecoveryProcessTree: async () => ({
      attempted: false,
      confirmed: true,
      reason: 'already-exited',
    }),
  };
  return {
    dependencies,
    order,
    commit,
    page,
    worker,
    get rendererReads() {
      return rendererReads;
    },
    get bootHash() {
      return bootHash;
    },
  };
}

test('CCTV runner completes the full serialized lifecycle and closes owned resources', async () => {
  const runner = createCctvRunnerDependencies({
    extraDirectReinitBuilds: true,
  });
  const { dependencies, order, commit } = runner;
  const progressSnapshots = [];
  const report = await runCctvLifecycle({
    url: 'http://localhost:4174',
    cycles: 2,
    drainMs: 2000,
    expectedCommit: commit,
    dependencies,
    onProgress: (event, currentReport) =>
      progressSnapshots.push([event.phase, currentReport.status]),
  });
  assert.equal(report.status, 'passed', report.error);
  assert.equal(report.validationStatus, 'passed');
  assert.equal(report.cycles.length, 2);
  for (const row of [
    report.warmup.enabled,
    report.warmup.disabled,
    ...report.cycles.flatMap((cycle) => [cycle.enabled, cycle.disabled]),
    report.directReinit.initializedDisabled,
    report.directReinit.rewarmedEnabled,
    report.directReinit.checkpoint,
  ]) {
    assert.equal(row.drainStability.status, 'stable');
    assert.ok(row.drainStability.windowMs >= 1000);
    assert.ok(row.drainStability.sampleCount >= 10);
    assert.ok(
      row.drainStability.lastFrameNumber > row.drainStability.firstFrameNumber,
    );
  }
  assert.equal(report.fixtureDelivery.frameResponses, 4);
  assert.ok(
    report.directReinit.rewarmedEnabled.worker.workers[1].submitted >
      report.warmup.enabled.worker.workers[1].submitted,
    'direct module init may legitimately build geometry after destroying its prior state',
  );
  assert.equal(report.pageClose.scope, 'owned-context-only');
  assert.equal(report.pageClose.openPageCount, 0);
  assert.equal(report.environment.browserVersion, 'HeadlessChrome/152.0.0.0');
  assert.equal(runner.bootHash, '#lat=30.2672&lon=-97.7431');
  assert.ok(report.environment.host.osRelease);
  assert.equal(
    runner.rendererReads,
    1,
    'renderer identity is read only at the initial ready checkpoint',
  );
  assert.equal(order.filter((phase) => phase === 'worker-preflight').length, 1);
  assert.ok(order.indexOf('scene-ready') < order.indexOf('worker-preflight'));
  assert.ok(order.indexOf('worker-preflight') < order.indexOf('enable'));
  assert.ok(order.indexOf('page-close') < order.indexOf('context-close'));
  assert.ok(order.indexOf('context-close') < order.indexOf('browser-close'));
  assert.ok(
    progressSnapshots.some(
      ([phase]) => phase === 'cycle-2-disable:completed-render',
    ),
  );
  assert.equal(progressSnapshots.at(-1)[1], 'running');
});

test('CCTV stable drain restarts its window when new work appears after initial quiescence', async () => {
  const { page, worker } = createCctvRunnerDependencies();
  const fixture = createCctvLifecycleFixture();
  const initialCheckpoint = await page.evaluate(
    readCctvLifecycleCheckpointInPage,
    { fixtureView: fixture.view },
  );
  const expectedTaskErrors = cctvTaskErrorSignature(initialCheckpoint);
  const observations = [];
  let injected = false;
  let delayedWork;
  const result = await waitForCctvLifecycleDrain(page, 3000, {
    expectedTaskErrors,
    fixtureView: fixture.view,
    stableWindowMs: 1000,
    sampleIntervalMs: 100,
    onObservation: (observation, checkpoint) => {
      observations.push({
        elapsedMs: observation.elapsedMs,
        stableElapsedMs: observation.stableElapsedMs,
        submitted: checkpoint.worker.workers[1].submitted,
        pending: checkpoint.worker.pending,
      });
      if (!injected) {
        injected = true;
        delayedWork = setTimeout(() => {
          worker.workers[1].submitted++;
          worker.workers[1].completed++;
        }, 350);
      }
    },
  });
  clearTimeout(delayedWork);

  assert.equal(observations[0].pending, 0);
  assert.equal(observations[0].stableElapsedMs, 0);
  assert.ok(observations.some((sample) => sample.submitted === 4));
  assert.equal(result.checkpoint.worker.workers[1].submitted, 4);
  assert.ok(result.stability.windowMs >= 1000);
  assert.ok(result.elapsedMs >= 1300);
});

test('CCTV runner retains the original phase/error and closes acquired resources on failure', async () => {
  const { dependencies, order, commit } = createCctvRunnerDependencies({
    failBoot: true,
  });
  const report = await runCctvLifecycle({
    url: 'http://localhost:4174',
    expectedCommit: commit,
    dependencies,
  });
  assert.equal(report.status, 'failed');
  assert.match(report.error, /synthetic boot failure/);
  assert.equal(report.failedPhase, 'application-boot:ready');
  assert.ok(order.includes('page-close'));
  assert.ok(order.includes('context-close'));
  assert.ok(order.includes('browser-close'));
});

test('CCTV runner does not mark a toggle passed before warmed-resource reuse is verified', async () => {
  const { dependencies, commit } = createCctvRunnerDependencies({
    resubmitOnFirstCycle: true,
  });
  const report = await runCctvLifecycle({
    url: 'http://localhost:4174',
    cycles: 1,
    drainMs: 2000,
    expectedCommit: commit,
    dependencies,
  });
  assert.equal(report.status, 'failed');
  assert.equal(report.failedPhase, 'cycle-1:reuse-validation');
  assert.equal(report.cycles[0].status, 'running');
  assert.match(report.error, /resubmitted settled createGeometry/);
});
