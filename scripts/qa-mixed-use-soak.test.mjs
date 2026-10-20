import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import test from 'node:test';
import * as Cesium from 'cesium';
import {
  resolveExpectedApplicationCommit,
  resolveNativeResolutionFlag,
  runMixedUseSoak,
} from './qa-mixed-use-soak.mjs';
import {
  isRecoverableApplicationPrewarmFailure,
  resolveRenderedSoakLocation,
  assertNativeResolutionEvidence,
  readNativeResolutionEvidenceInPage,
  resolveNativeSoakViewport,
  createSoakDatacenterFixture,
  createSoakDatacenterFixtureReceipt,
  createSoakFixtureShareHash,
  bootSoakFixtureFromFreshDocument,
  hasSoakRecordingOptionInPage,
  isSoakDatacenterAssetRequest,
  prepareSoakDatacenterFixtureViewInPage,
  readSoakDatacenterCameraPoseInPage,
  evaluateSoakDatacenterEnabledState,
  installSoakDatacenterPostRenderWitnessInPage,
  startSoakDatacenterPreflightWitnessInPage,
  stopSoakDatacenterPreflightWitness,
  readSoakReplayDiagnosticInPage,
  seekRenderedSoakRecordingInPage,
  SOAK_DATACENTER_FEATURE_COUNT,
} from './qa-rendered-soak-driver.mjs';
import { createSoakSetupFailureReport } from './qa-mixed-use-soak.mjs';
import { flyToAustin } from '../src/camera.js';
import { ShareLinkManager } from '../src/sharelink.js';
import { probeWorkerCompletion } from './performance/workerProbe.mjs';
import { runCesiumWorkerProbeInPage } from './performance/cesiumWorkerProbeInPage.mjs';
import {
  bootFixturePage,
  collectWorkspaceImportDiagnostics,
  runWorkspaceFixturePhase,
} from './qa-application-fixtures.mjs';
import { createFixtureNetworkProbe } from './performance/fixtureNetworkProbe.mjs';
import { clickAndWaitForWorkspaceOpen } from './performance/workspaceOpenProbe.mjs';
import { installWorkerDiagnostics } from './performance/workerDiagnostics.mjs';
import {
  fixtureRequestCommand,
  interceptFixtureSession,
} from './performance/fixtureInterception.mjs';
import {
  evaluateSoakStability,
  FULL_SOAK_MS,
} from './performance/soakStability.mjs';

const metrics = (heap = 100, listeners = 20, pendingJobs = 0) => ({
  JSHeapUsedSize: heap,
  JSEventListeners: listeners,
  application: {
    workers: { instrumented: true, overflow: false, pending: 0, workers: [] },
    resources: {
      primitives: 3,
      entities: 0,
      ownerResources: {
        fixture: {
          pendingJobs,
          pointPrimitiveCount: 0,
          pointPrimitiveCountUnit: 'instances',
          pointPrimitiveCoverage: 'owned-import-point-collection',
        },
      },
    },
  },
});

const testDatacenterFixtureReceipt = () => ({
  schema: 'gev-soak-datacenter-fixture/v2',
  fulfillmentProtocol: 'cdp-fetch-fulfilled-hash-count-v1',
  status: 'validated',
  requestCount: 1,
  preparedRequestCount: 1,
  fulfilledRequestCount: 1,
  applicationOrigin: 'http://127.0.0.1:4174',
  assetOrigin: 'http://127.0.0.1:4174',
  assetPath: '/assets/datacenters-CtzejECr.geojsonl',
  responseStatus: 200,
  expectedBodySha256: 'a'.repeat(64),
  bodySha256: 'a'.repeat(64),
  expectedFeatureCount: 8,
  deliveredFeatureCount: 8,
  materializedFeatureCount: 8,
  disabledMaterializedFeatureCount: 0,
  disabledRenderableCount: 0,
  setupTiming: 'unmeasured-before-interaction-samples',
  preloadEnabledObserved: true,
  preloadDisabledObserved: true,
  requests: [
    {
      origin: 'http://127.0.0.1:4174',
      pathname: '/assets/datacenters-CtzejECr.geojsonl',
      prepared: true,
      fulfilled: true,
      responseStatus: 200,
      bodySha256: 'a'.repeat(64),
      deliveredFeatureCount: 8,
    },
  ],
});

test('driver success receipt retains a bounded cloned fulfilled-request history', () => {
  const validation = { ...testDatacenterFixtureReceipt() };
  delete validation.requests;
  const sourceRequest = {
    origin: validation.assetOrigin,
    pathname: validation.assetPath,
    prepared: true,
    fulfilled: true,
    responseStatus: 200,
    bodySha256: validation.bodySha256,
    deliveredFeatureCount: 8,
  };
  const receipt = createSoakDatacenterFixtureReceipt(validation, [
    sourceRequest,
    ...Array.from({ length: 5 }, () => sourceRequest),
  ]);
  assert.equal(receipt.status, 'validated');
  assert.equal(receipt.requests.length, 4);
  assert.deepEqual(receipt.requests[0], sourceRequest);
  assert.notEqual(receipt.requests[0], sourceRequest);
  receipt.requests[0].fulfilled = false;
  assert.equal(sourceRequest.fulfilled, true);
  assert.equal(
    createSoakDatacenterFixtureReceipt(validation, [sourceRequest]).requests[0]
      .fulfilled,
    true,
    'a later consumer receives a fresh copy after another consumer mutates its snapshot',
  );
  let now = 0;
  const acceptedReceipt = createSoakDatacenterFixtureReceipt(validation, [
    sourceRequest,
  ]);
  return runMixedUseSoak({
    durationMs: 100,
    intervalMs: 0,
    now: () => now,
    driver: {
      validateDatacenterSoakFixture: async () => acceptedReceipt,
      runCycle: async () => {
        now += 100;
        return {
          sourceToggles: 2,
          replaySeeks: 1,
          imports: 1,
          workspaceReloads: 1,
          archiveFailures: 1,
          cameraRecoveries: 1,
        };
      },
    },
  }).then((report) => {
    assert.equal(report.datacenterFixtureReceipt.requests[0].fulfilled, true);
    assert.equal(
      report.datacenterFixtureReceipt.requests[0].deliveredFeatureCount,
      8,
    );
  });
});

test('rendered soak intercepts only the same-origin bundled datacenter asset with eight features', () => {
  const base = 'http://127.0.0.1:4184/';
  assert.equal(
    isSoakDatacenterAssetRequest(
      'http://127.0.0.1:4184/assets/datacenters-CtzejECr.geojsonl',
      base,
    ),
    true,
  );
  assert.equal(
    isSoakDatacenterAssetRequest(
      'http://127.0.0.1:4184/src/data/local_data/datacenters/datacenters.geojsonl',
      base,
    ),
    true,
  );
  for (const url of [
    'http://other.test/assets/datacenters-CtzejECr.geojsonl',
    'http://127.0.0.1:4184/assets/dams-CtzejECr.geojsonl',
    'http://127.0.0.1:4184/assets/datacenters-not-a-vite-hash.geojsonl',
  ])
    assert.equal(isSoakDatacenterAssetRequest(url, base), false, url);
  const fixture = createSoakDatacenterFixture({
    latitude: 40.7,
    longitude: -73.9,
  });
  const features = fixture.body.split('\n').map((line) => JSON.parse(line));
  assert.equal(SOAK_DATACENTER_FEATURE_COUNT, 8);
  assert.equal(fixture.featureCount, 8);
  assert.equal(features.length, 8);
  assert.equal(features[0].id, 'way/1');
  assert.match(fixture.bodySha256, /^[a-f0-9]{64}$/);
});

test('rendered soak location accepts Ampfing coordinates and rejects invalid views', () => {
  assert.deepEqual(
    resolveRenderedSoakLocation({
      latitude: 48.2582,
      longitude: 12.421,
      altitude: 731,
    }),
    { latitude: 48.2582, longitude: 12.421, altitude: 731 },
  );
  assert.throws(
    () => resolveRenderedSoakLocation({ latitude: 91 }),
    /location is invalid/,
  );
  assert.throws(
    () => resolveRenderedSoakLocation({ altitude: 0 }),
    /location is invalid/,
  );
});

function parseInitialShareHash(hash) {
  const hadWindow = Object.hasOwn(globalThis, 'window');
  const previousWindow = globalThis.window;
  globalThis.window = { location: { hash } };
  const manager = new ShareLinkManager({
    camera: { changed: { addEventListener: () => () => {} } },
  });
  try {
    return manager.parseInitialHash();
  } finally {
    manager.destroy();
    if (hadWindow) globalThis.window = previousWindow;
    else delete globalThis.window;
  }
}

test('validated share boot suppresses the actual startup flight and preserves soak map/density', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const location = {
    latitude: 40.71234567,
    longitude: -73.91234567,
    altitude: 1000.5,
  };
  const hash = createSoakFixtureShareHash(location);
  const runStartupCameraCondition = (value) => {
    const calls = { setView: [], flyTo: [] };
    const viewer = {
      isDestroyed: () => false,
      camera: {
        setView: (pose) => calls.setView.push(pose),
        flyTo: (pose) => calls.flyTo.push(pose),
        cancelFlight() {},
      },
    };
    if (!parseInitialShareHash(value)) flyToAustin(viewer);
    return calls;
  };

  const emptyHashBoot = runStartupCameraCondition('');
  assert.equal(emptyHashBoot.setView.length, 1);
  assert.equal(emptyHashBoot.flyTo.length, 0);
  t.mock.timers.tick(500);
  assert.equal(
    emptyHashBoot.flyTo.length,
    1,
    'empty hash schedules the Austin takeover',
  );
  assert.ok(
    Cesium.Cartesian3.distance(
      emptyHashBoot.flyTo[0].destination,
      Cesium.Cartesian3.fromDegrees(-97.7431, 30.2672, 600),
    ) < 1e-6,
    'the pending startup flight targets Austin',
  );
  const shareState = parseInitialShareHash(hash);
  const pinnedBoot = runStartupCameraCondition(hash);
  assert.ok(shareState, 'the production share decoder must accept this hash');
  assert.equal(pinnedBoot.setView.length, 0);
  assert.equal(pinnedBoot.flyTo.length, 0);
  assert.equal(shareState.lat, location.latitude);
  assert.equal(shareState.lon, location.longitude);
  assert.equal(shareState.alt, location.altitude);
  assert.equal(shareState.mapStack, 'osm');
  assert.equal(shareState.detectionMode, 'DENSE');
  assert.equal(shareState.detectionDensity, 75);
  assert.equal(shareState.bloomIntensity, 0);
  assert.equal(shareState.bloomVersion, 2);
  assert.equal(shareState.detectionFadePct, 7);
  assert.equal(shareState.detectionOutsideOpacityPct, 1);
  assert.equal(shareState.scopeFeatherPct, 11);
  const params = new URLSearchParams(hash.slice(1));
  assert.equal(params.get('v'), '2');
  assert.equal(params.get('lat'), String(location.latitude));
  assert.equal(params.get('lon'), String(location.longitude));
  assert.equal(params.get('alt'), String(location.altitude));
  assert.equal(params.get('map'), 'osm');
  assert.equal(params.get('dm'), 'DENSE');
  assert.equal(params.get('dd'), '75');
  assert.equal(params.has('l'), false);
});

test('seeded soak recording boots in a new document with the same controlled share hash', async () => {
  const calls = [];
  const page = {
    async goto(url, options) {
      calls.push(['navigate', url, options.waitUntil]);
    },
  };
  const options = {
    hash: createSoakFixtureShareHash({
      latitude: 40.7,
      longitude: -73.9,
      altitude: 1000,
    }),
  };
  const boot = async (bootPage, base, bootOptions) => {
    calls.push(['boot', bootPage === page, base, bootOptions.hash]);
    return 'ready';
  };
  const result = await bootSoakFixtureFromFreshDocument(
    page,
    'http://127.0.0.1:4291',
    options,
    boot,
  );
  assert.equal(result, 'ready');
  assert.deepEqual(calls, [
    ['navigate', 'about:blank', 'load'],
    ['boot', true, 'http://127.0.0.1:4291', options.hash],
  ]);
});

test('soak replay selection requires the seeded recording option', () => {
  const evaluate = (options) =>
    vm.runInNewContext(`(${hasSoakRecordingOptionInPage.toString()})()`, {
      document: {
        querySelector: () => (options ? { options } : null),
      },
      Array,
    });
  assert.equal(evaluate([{ value: 'other' }]), false);
  assert.equal(evaluate([{ value: 'recording-rendered-soak' }]), true);
});

test('failure-time camera pose reader returns finite evidence or unavailable', () => {
  const scope = {
    window: {
      __godsEyeView: {
        viewer: {
          camera: {
            positionCartographic: {
              latitude: (40.7 * Math.PI) / 180,
              longitude: (-73.9 * Math.PI) / 180,
              height: 1000,
            },
            heading: 0,
            pitch: -Math.PI / 2,
            roll: 0,
          },
          scene: { frameState: { frameNumber: 42 } },
        },
      },
    },
    Math,
    Number,
    Object,
  };
  const observed = vm.runInNewContext(
    `(${readSoakDatacenterCameraPoseInPage.toString()})()`,
    scope,
  );
  assert.ok(Math.abs(observed.latitude - 40.7) < 1e-12);
  assert.ok(Math.abs(observed.longitude + 73.9) < 1e-12);
  assert.equal(observed.altitude, 1000);
  assert.equal(observed.frameNumber, 42);
  scope.window.__godsEyeView.viewer.camera.positionCartographic.height = NaN;
  assert.equal(
    vm.runInNewContext(
      `(${readSoakDatacenterCameraPoseInPage.toString()})()`,
      scope,
    ),
    null,
  );
});

function createDatacenterCameraPageHarness({ onRequestRender } = {}) {
  const calls = [];
  const renderListeners = new Set();
  let frameNumber = 10;
  class Cartesian3 {
    static fromDegrees(longitude, latitude, altitude) {
      calls.push(['fromDegrees', longitude, latitude, altitude]);
      return { latitude, longitude, altitude };
    }
  }
  const camera = {
    position: new Cartesian3(),
    positionCartographic: {
      latitude: (40.7 * Math.PI) / 180,
      longitude: (-73.9 * Math.PI) / 180,
      height: 1000,
    },
    heading: 0,
    pitch: -Math.PI / 2,
    roll: 0,
    setView(view) {
      calls.push(['setView', view]);
      camera.positionCartographic = {
        latitude: (view.destination.latitude * Math.PI) / 180,
        longitude: (view.destination.longitude * Math.PI) / 180,
        height: view.destination.altitude,
      };
      Object.assign(camera, view.orientation);
    },
    flyTo(view) {
      calls.push(['startup-flyTo', view]);
      camera.positionCartographic = {
        latitude: (view.destination.latitude * Math.PI) / 180,
        longitude: (view.destination.longitude * Math.PI) / 180,
        height: view.destination.altitude,
      };
      Object.assign(camera, view.orientation);
    },
    cancelFlight() {
      calls.push(['cancelFlight']);
    },
  };
  const scene = {
    frameState: {
      get frameNumber() {
        return frameNumber;
      },
    },
    postRender: {
      addEventListener(listener) {
        renderListeners.add(listener);
        return () => renderListeners.delete(listener);
      },
    },
    requestRender() {
      calls.push(['requestRender']);
      onRequestRender?.({ frameNumber, renderListeners });
    },
  };
  const window = {
    __godsEyeView: {
      viewer: { camera, scene },
      styleManager: {
        runImmediateLocationNavigation(navigate) {
          calls.push(['runImmediateLocationNavigation']);
          camera.cancelFlight();
          return navigate();
        },
      },
    },
  };
  return {
    calls,
    camera,
    renderListeners,
    setFrameNumber(value) {
      frameNumber = value;
    },
    emitPostRender() {
      for (const listener of [...renderListeners]) listener();
    },
    window,
  };
}

test('datacenter camera preflight requires two fresh distinct matching frames', async () => {
  const harness = createDatacenterCameraPageHarness();
  const location = { latitude: 40.7, longitude: -73.9, altitude: 1000 };
  let timerCallback;
  const timerIds = new Set();
  let nextTimerId = 0;
  const context = {
    window: harness.window,
    location,
    Math,
    Promise,
    JSON,
    Number,
    Error,
    setTimeout(callback) {
      timerCallback = callback;
      const id = ++nextTimerId;
      timerIds.add(id);
      return id;
    },
    clearTimeout(id) {
      timerIds.delete(id);
    },
  };
  const resultPromise = vm.runInNewContext(
    `(${prepareSoakDatacenterFixtureViewInPage.toString()})(location)`,
    context,
  );
  assert.equal(harness.renderListeners.size, 1);
  harness.setFrameNumber(11);
  harness.emitPostRender();
  harness.emitPostRender();
  let settled = false;
  resultPromise.then(() => (settled = true));
  await Promise.resolve();
  assert.equal(settled, false, 'duplicate callbacks in one frame count once');
  harness.setFrameNumber(12);
  harness.emitPostRender();
  const result = await resultPromise;
  assert.equal(result.frameNumber, 12);
  assert.ok(Math.abs(result.observed.latitude - location.latitude) < 1e-12);
  assert.ok(Math.abs(result.observed.longitude - location.longitude) < 1e-12);
  assert.equal(result.observed.altitude, location.altitude);
  assert.deepEqual(
    harness.calls.filter(([name]) => name === 'runImmediateLocationNavigation')
      .length,
    1,
  );
  assert.equal(harness.renderListeners.size, 0);
  assert.equal(timerIds.size, 0);
  assert.equal(typeof timerCallback, 'function');
});

test('datacenter camera preflight cleans its observer and reports pose on render errors', async () => {
  let renderRequests = 0;
  const harness = createDatacenterCameraPageHarness({
    onRequestRender() {
      if (++renderRequests > 1) throw new Error('render request failed');
    },
  });
  const location = { latitude: 40.7, longitude: -73.9, altitude: 1000 };
  const context = {
    window: harness.window,
    location,
    Math,
    Promise,
    JSON,
    Number,
    Error,
    setTimeout: () => 1,
    clearTimeout() {},
  };
  const resultPromise = vm.runInNewContext(
    `(${prepareSoakDatacenterFixtureViewInPage.toString()})(location)`,
    context,
  );
  harness.setFrameNumber(11);
  harness.emitPostRender();
  await assert.rejects(
    resultPromise,
    (error) =>
      error.message.includes('render request failed') &&
      Math.abs(error.cameraPose?.latitude - location.latitude) < 1e-12,
  );
  assert.equal(harness.renderListeners.size, 0);
});

test('datacenter camera preflight timeout retains final pose and cleans listener', async () => {
  const harness = createDatacenterCameraPageHarness();
  const location = { latitude: 40.7, longitude: -73.9, altitude: 1000 };
  const context = {
    window: harness.window,
    location,
    Math,
    Promise,
    JSON,
    Number,
    Error,
    setTimeout(callback) {
      context.timeoutCallback = callback;
      return 1;
    },
    clearTimeout() {},
  };
  const resultPromise = vm.runInNewContext(
    `(${prepareSoakDatacenterFixtureViewInPage.toString()})(location)`,
    context,
  );
  harness.camera.flyTo({
    destination: { latitude: 30.2672, longitude: -97.7431, altitude: 600 },
    orientation: { heading: 0.26, pitch: -0.52, roll: 0 },
  });
  context.timeoutCallback();
  await assert.rejects(
    resultPromise,
    (error) =>
      Math.abs(error.cameraPose?.latitude - 30.2672) < 1e-12 &&
      Math.abs(error.cameraPose?.longitude + 97.7431) < 1e-12,
  );
  assert.equal(harness.renderListeners.size, 0);
});

test('datacenter postRender witness inspects LOD only during bounded preflight and stops in cleanup', async () => {
  let lodReads = 0;
  let enabled = true;
  const listeners = [];
  const scene = {
    frameState: { frameNumber: 10 },
    postRender: {
      addEventListener(listener) {
        listeners.push(listener);
      },
    },
  };
  const window = {
    __godsEyeView: {
      viewer: { scene },
      dataManager: {
        isEnabled: () => enabled,
        layers: {
          get: () => ({
            module: {
              getLodDiagnostics() {
                lodReads++;
                return { computed: true, total: 8, active: 2 };
              },
            },
          }),
        },
      },
    },
  };
  vm.runInNewContext(
    `(${installSoakDatacenterPostRenderWitnessInPage.toString()})()`,
    { window, Number },
  );
  assert.equal(listeners.length, 1);

  listeners[0]();
  assert.equal(window.__soakRenderedFrames, 1);
  assert.equal(lodReads, 0, 'ordinary soak frames must not inspect LOD');
  assert.equal(window.__soakDatacenterRenderWitness, null);

  const frameStart = vm.runInNewContext(
    `(${startSoakDatacenterPreflightWitnessInPage.toString()})()`,
    { window },
  );
  assert.equal(frameStart, 1);
  scene.frameState.frameNumber = 11;
  listeners[0]();
  assert.equal(lodReads, 1);
  assert.deepEqual(
    JSON.parse(JSON.stringify(window.__soakDatacenterRenderWitness)),
    {
      renderedFrames: 2,
      frameNumber: 11,
      enabled: true,
      computed: true,
      total: 8,
      active: 2,
    },
  );

  const validation = {
    status: 'validated',
    failureReason: null,
    preloadWitnessCollectionStopped: false,
  };
  await stopSoakDatacenterPreflightWitness(
    {
      evaluate: (fn) => vm.runInNewContext(`(${fn.toString()})()`, { window }),
    },
    validation,
  );
  enabled = false;
  listeners[0]();
  assert.equal(window.__soakRenderedFrames, 3);
  assert.equal(lodReads, 1, 'cleanup must stop per-frame LOD inspection');
  assert.equal(window.__soakDatacenterPreflightActive, false);
  assert.equal(validation.preloadWitnessCollectionStopped, true);

  const cleanupFailure = {
    status: 'validated',
    failureReason: null,
    preloadWitnessCollectionStopped: false,
  };
  await assert.rejects(
    stopSoakDatacenterPreflightWitness(
      { evaluate: async () => Promise.reject(new Error('page closed')) },
      cleanupFailure,
    ),
    /page closed/,
  );
  assert.equal(cleanupFailure.status, 'failed');
  assert.equal(cleanupFailure.preloadWitnessCollectionStopped, false);

  const existingFailure = {
    status: 'failed',
    failureReason: 'preflight timeout',
    preloadWitnessCollectionStopped: false,
  };
  await stopSoakDatacenterPreflightWitness(
    { evaluate: async () => Promise.reject(new Error('page closed')) },
    existingFailure,
  );
  assert.match(existingFailure.failureReason, /preflight timeout.*page closed/);
});

test('soak replay commits the selected endpoint before enabling and refreshing Flights', async () => {
  const ticks = [1000, 2000, 3000];
  const state = {
    mode: 'recorded',
    recordingId: 'recording-rendered-soak',
    targetMs: ticks[0],
  };
  const calls = [];
  const slider = {
    min: '0',
    max: '2',
    value: '0',
    disabled: false,
    dispatchEvent(event) {
      calls.push(event.type);
      if (event.type === 'change') state.targetMs = ticks[Number(this.value)];
      return true;
    },
  };
  const source = {
    getState: () => state,
    getTimeline: () => ({ ticks }),
    getSnapshot: async () => ({
      selectedTimeMs: state.targetMs,
      records: [{ id: 'SYNTH-001' }],
    }),
  };
  const app = {
    aircraftSource: source,
    dataManager: {
      async setEnabled(id, enabled) {
        assert.equal(id, 'flights');
        assert.equal(enabled, true);
        assert.equal(state.targetMs, ticks[2]);
        calls.push('enable');
      },
      async refreshLayer(id) {
        assert.equal(id, 'flights');
        assert.equal(state.targetMs, ticks[2]);
        calls.push('refresh');
      },
    },
  };
  const context = {
    window: { __godsEyeView: app },
    document: {
      querySelector: () => slider,
    },
    Event: class {
      constructor(type, options) {
        this.type = type;
        this.bubbles = options?.bubbles;
      }
    },
    Number,
    Array,
    Error,
  };
  const result = await vm.runInNewContext(
    `(${seekRenderedSoakRecordingInPage.toString()})(0)`,
    context,
  );
  assert.deepEqual(calls, ['input', 'change', 'enable', 'refresh']);
  assert.equal(result.recordingId, 'recording-rendered-soak');
  assert.equal(result.selectedTimeMs, 3000);
  assert.equal(result.targetIndex, 2);
  assert.equal(result.recordCount, 1);
});

test('soak replay rejects a noncommitted endpoint or empty recorded sample', async () => {
  for (const mode of ['no-commit', 'empty-sample']) {
    const state = {
      mode: 'recorded',
      recordingId: 'recording-rendered-soak',
      targetMs: 1000,
    };
    const slider = {
      min: '0',
      max: '1',
      value: '0',
      disabled: false,
      dispatchEvent(event) {
        if (mode !== 'no-commit' && event.type === 'change')
          state.targetMs = 2000;
      },
    };
    const app = {
      aircraftSource: {
        getState: () => state,
        getTimeline: () => ({ ticks: [1000, 2000] }),
        getSnapshot: async () => ({
          selectedTimeMs: state.targetMs,
          records: mode === 'empty-sample' ? [] : [{ id: 'SYNTH-001' }],
        }),
      },
      dataManager: {
        setEnabled: async () => assert.fail('must fail before layer enable'),
        refreshLayer: async () => assert.fail('must fail before layer refresh'),
      },
    };
    const context = {
      window: { __godsEyeView: app },
      document: { querySelector: () => slider },
      Event: class {
        constructor(type) {
          this.type = type;
        }
      },
      Number,
      Array,
      Error,
    };
    await assert.rejects(
      vm.runInNewContext(
        `(${seekRenderedSoakRecordingInPage.toString()})(0)`,
        context,
      ),
      mode === 'no-commit'
        ? /endpoint was not committed/
        : /endpoint has no recorded observations/,
    );
  }
});

test('replay failure diagnostics preserve bounded source, selection, and layer state', () => {
  const app = {
    aircraftSource: {
      getState: () => ({
        mode: 'recorded-mode-value-is-truncated',
        recordingId: 'r'.repeat(120),
        targetMs: 2000,
        recordCount: 5,
        truncated: false,
        coverage: { from: 1000, to: 3000 },
        rows: Array.from({ length: 500 }, () => ({ sensitive: 'omitted' })),
      }),
      getTimeline: () => ({ ticks: [1000, 2000, 3000] }),
    },
    dataManager: {
      isEnabled: () => false,
      layers: new Map([
        [
          'flights',
          { module: { getStats: () => ({ count: 0, rows: ['omitted'] }) } },
        ],
      ]),
    },
  };
  const context = {
    window: { __godsEyeView: app },
    document: {
      querySelector(selector) {
        if (selector.includes('aircraft-select'))
          return {
            value: 'recording-rendered-soak',
            options: [{ value: 'recording-rendered-soak' }],
          };
        if (selector.includes('slider-control'))
          return { disabled: false, min: '0', max: '2', value: '1' };
        return null;
      },
    },
    Number,
    Array,
    String,
  };
  const result = vm.runInNewContext(
    `(${readSoakReplayDiagnosticInPage.toString()})(phaseName)`,
    { ...context, phaseName: 'recording-load' },
  );
  assert.equal(result.phase, 'recording-load');
  assert.equal(result.source.mode, 'recorded-mode-va');
  assert.equal(result.source.recordingId.length, 80);
  assert.equal(result.source.targetMs, 2000);
  assert.equal(result.source.recordCount, 5);
  assert.equal(result.source.coverage.from, 1000);
  assert.equal(result.source.coverage.to, 3000);
  assert.equal(result.timeline.tickCount, 3);
  assert.equal(result.timeline.firstTickMs, 1000);
  assert.equal(result.timeline.lastTickMs, 3000);
  assert.equal(result.selection.value, 'recording-rendered-soak');
  assert.equal(result.selection.targetOptionPresent, true);
  assert.equal(result.flights.enabled, false);
  assert.equal(result.flights.stats.count, 0);
  assert.equal(JSON.stringify(result).includes('omitted'), false);
});

test('replay failure diagnostics survive a throwing options getter and retain the first bounded error', () => {
  const selection = { value: 'recording-rendered-soak' };
  Object.defineProperty(selection, 'options', {
    get() {
      const error = new Error('must not leak detail');
      error.name = 'OptionsGetterFailure';
      throw error;
    },
  });
  const source = {
    getState() {
      const error = new Error('second failure');
      error.name = 'StateGetterFailure';
      throw error;
    },
    getTimeline: () => ({ ticks: [] }),
  };
  const result = vm.runInNewContext(
    `(${readSoakReplayDiagnosticInPage.toString()})(phaseName)`,
    {
      phaseName: 'recording-load',
      window: {
        __godsEyeView: {
          aircraftSource: source,
          dataManager: {
            isEnabled: () => false,
            layers: new Map(),
          },
        },
      },
      document: {
        querySelector(selector) {
          return selector.includes('aircraft-select') ? selection : null;
        },
      },
      Number,
      Array,
      String,
    },
  );
  assert.equal(result.selection.targetOptionPresent, null);
  assert.equal(result.sourceReadError, 'OptionsGetterFailure');
  assert.equal(result.source, null);
  assert.equal(JSON.stringify(result).includes('must not leak detail'), false);
});

test('datacenter enabled preflight distinguishes materialized data from visible renderables', () => {
  const enabled = evaluateSoakDatacenterEnabledState(
    {
      enabled: true,
      lod: { computed: true, total: 8, active: 3 },
      renderedFrameObserved: true,
    },
    8,
  );
  assert.equal(enabled.observed, true);
  assert.equal(enabled.failureReason, null);
  assert.equal(enabled.populationObserved, true);
  assert.equal(enabled.renderableObserved, true);

  const noVisibleFeatures = evaluateSoakDatacenterEnabledState(
    {
      enabled: true,
      lod: { computed: true, total: 8, active: 0 },
      renderedFrameObserved: true,
    },
    8,
  );
  assert.equal(noVisibleFeatures.observed, false);
  assert.equal(
    noVisibleFeatures.failureReason,
    'no-renderable-feature-in-view',
  );
  assert.equal(noVisibleFeatures.populationObserved, true);

  const noCompletedVisibleFrame = evaluateSoakDatacenterEnabledState(
    {
      enabled: true,
      lod: { computed: true, total: 8, active: 3 },
      renderedFrameObserved: false,
    },
    8,
  );
  assert.equal(noCompletedVisibleFrame.observed, false);
  assert.equal(
    noCompletedVisibleFrame.failureReason,
    'no-completed-visible-frame',
  );

  const wrongPopulation = evaluateSoakDatacenterEnabledState(
    {
      enabled: true,
      lod: { computed: true, total: 4362, active: 8 },
      renderedFrameObserved: true,
    },
    8,
  );
  assert.equal(wrongPopulation.observed, false);
  assert.equal(
    wrongPopulation.failureReason,
    'materialized-population-mismatch',
  );
});

test('native soak viewport is opt-in and validates the observed DPR/buffer', () => {
  assert.equal(resolveNativeResolutionFlag(['node', 'soak']), false);
  assert.equal(
    resolveNativeResolutionFlag(['node', 'soak', '--native-resolution']),
    true,
  );
  assert.deepEqual(resolveNativeSoakViewport(2), {
    width: 1440,
    height: 1000,
    deviceScaleFactor: 2,
  });
  assert.throws(() => resolveNativeSoakViewport(0), /device pixel ratio/);
  const evidence = {
    devicePixelRatio: 2,
    canvas: {
      clientWidth: 1440,
      clientHeight: 1000,
      width: 2880,
      height: 2000,
    },
    sceneDrawingBuffer: { width: 2880, height: 2000 },
    resolutionScale: 1,
    useBrowserRecommendedResolution: false,
    maximumScreenSpaceError: 1,
  };
  assert.deepEqual(
    assertNativeResolutionEvidence(evidence, 2, 'test'),
    evidence,
  );
  assert.throws(
    () =>
      assertNativeResolutionEvidence(
        { ...evidence, canvas: { ...evidence.canvas, width: 1440 } },
        2,
        'test',
      ),
    /drawing buffer/,
  );
  assert.throws(
    () => assertNativeResolutionEvidence(evidence, 1, 'test'),
    /device pixel ratio/,
  );
  for (const value of [undefined, Number.NaN, Infinity, 0, -1, '2'])
    assert.throws(
      () =>
        assertNativeResolutionEvidence(
          { ...evidence, devicePixelRatio: value },
          2,
          'test',
        ),
      /device pixel ratio/,
    );
  assert.throws(
    () =>
      assertNativeResolutionEvidence(
        { ...evidence, resolutionScale: 0.5 },
        2,
        'test',
      ),
    /sharpness settings changed/,
  );
  assert.throws(
    () =>
      assertNativeResolutionEvidence(
        { ...evidence, canvas: { ...evidence.canvas, clientWidth: 1441 } },
        2,
        'test',
      ),
    /drawing buffer/,
  );
  for (const change of [
    { useBrowserRecommendedResolution: true },
    { maximumScreenSpaceError: 2 },
    { resolutionScale: Number.NaN },
    { sceneDrawingBuffer: undefined },
    { sceneDrawingBuffer: { width: 1440, height: 1000 } },
    {
      canvas: {
        clientWidth: 1200,
        clientHeight: 800,
        width: 2400,
        height: 1600,
      },
      sceneDrawingBuffer: { width: 2400, height: 1600 },
    },
  ]) {
    assert.throws(() =>
      assertNativeResolutionEvidence({ ...evidence, ...change }, 2, 'initial'),
    );
    assert.throws(() =>
      assertNativeResolutionEvidence(
        { ...evidence, ...change },
        2,
        'checkpoint',
        evidence,
      ),
    );
  }
});

test('native page evidence records the actual scene buffer and effective settings', () => {
  const canvas = {
    clientWidth: 1440,
    clientHeight: 1000,
    width: 2880,
    height: 2000,
  };
  const observed = vm.runInNewContext(
    `(${readNativeResolutionEvidenceInPage.toString()})()`,
    {
      window: {
        devicePixelRatio: 2,
        __godsEyeView: {
          viewer: {
            resolutionScale: 1,
            useBrowserRecommendedResolution: false,
            scene: {
              canvas,
              drawingBufferWidth: 2880,
              drawingBufferHeight: 2000,
              globe: { maximumScreenSpaceError: 1 },
            },
          },
        },
      },
    },
  );
  assert.equal(assertNativeResolutionEvidence(observed, 2, 'page'), observed);
  assert.throws(
    () =>
      vm.runInNewContext(
        `(${readNativeResolutionEvidenceInPage.toString()})()`,
        { window: {} },
      ),
    /active viewer/,
  );
});

test('workspace/import phase diagnostics serialize and omit URLs and payloads', () => {
  const scope = {
    __godsEyeView: {
      importedGeometryLayer: {
        getState: () => ({ featureCount: 1, pendingJobs: 0 }),
      },
      workspaceLibraryPanel: {
        restore: {
          getState: () => ({ status: 'applied', workspaceId: 'ws1' }),
        },
      },
      dataManager: {
        layers: {
          entries: () => [
            ['flights', { enabled: true, visibilityIntentEpoch: 2 }],
          ],
        },
      },
      viewer: { scene: { frameState: { frameNumber: 42 } } },
    },
    __gevSoakWorkers: {
      snapshot: () => ({
        instrumented: true,
        pending: 1,
        overflow: false,
        workers: [
          {
            kind: 'createGeometry',
            pending: 1,
            oldestPendingMs: 27,
            submitted: 2,
            completed: 1,
            cancelled: 0,
            taskErrors: 0,
            workerErrors: 0,
            postErrors: 0,
            url: 'https://private.test/worker?token=secret',
            payload: 'must not be retained',
          },
        ],
      }),
    },
    document: {
      readyState: 'complete',
      visibilityState: 'visible',
      hasFocus: () => true,
      querySelector: (selector) =>
        selector === '.workspace-library'
          ? {
              querySelector: (child) => ({
                textContent: child.includes('import-summary')
                  ? '1 accepted'
                  : 'Ready',
                value: 'ws1',
                disabled: false,
              }),
              querySelectorAll: () => [{ value: 'ws1' }, { value: 'ws2' }],
            }
          : null,
      querySelectorAll: () => [{}, {}],
    },
  };
  const serialized = vm.runInNewContext(
    `(${collectWorkspaceImportDiagnostics.toString()})(input)`,
    {
      ...scope,
      input: {
        phase: 'workspace-option-wait',
        targetWorkspaceId: 'ws2',
      },
    },
  );
  assert.equal(serialized.phase, 'workspace-option-wait');
  assert.equal(serialized.workspace.expectedWorkspaceId, 'ws2');
  assert.equal(serialized.workspace.requestedOptionPresent, true);
  assert.equal(serialized.importLayer.featureCount, 1);
  assert.equal(serialized.workers.workers[0].oldestPendingMs, 27);
  assert.equal(serialized.viewer.frameNumber, 42);
  assert.doesNotMatch(
    JSON.stringify(serialized),
    /private\.test|secret|payload/,
  );
});

test('named workspace phase preserves primary timeout and captures bounded state', async () => {
  const progress = [];
  const primary = new Error('Waiting failed: 30000ms exceeded');
  let evaluateCalls = 0;
  const browserGlobal = {
    document: {
      readyState: 'complete',
      visibilityState: 'visible',
      hasFocus: () => true,
      querySelector: () => ({
        querySelector: () => ({ textContent: 'Opening…', value: 'ws1' }),
        querySelectorAll: () => [{ value: 'ws1' }],
      }),
    },
    __godsEyeView: {},
  };
  const page = {
    evaluate: async (callback, context) => {
      evaluateCalls++;
      assert.equal(callback, collectWorkspaceImportDiagnostics);
      return vm.runInNewContext(`(${callback.toString()})(input)`, {
        ...browserGlobal,
        input: context,
      });
    },
  };
  await assert.rejects(
    runWorkspaceFixturePhase(
      page,
      'import-apply-status-wait',
      async () => {
        throw primary;
      },
      { onProgress: (phase) => progress.push(phase) },
    ),
    (error) => {
      assert.equal(error, primary);
      assert.match(error.message, /phase import-apply-status-wait/);
      assert.match(error.message, /Opening/);
      assert.ok(error.message.length < 8500);
      return true;
    },
  );
  assert.equal(evaluateCalls, 1);
  assert.deepEqual(progress, [
    'import-apply-status-wait:start',
    'import-apply-status-wait:failed',
  ]);
});

test('a hung diagnostics evaluation cannot replace the primary phase failure', async () => {
  const primary = new Error('workspace option wait failed');
  await assert.rejects(
    runWorkspaceFixturePhase(
      { evaluate: () => new Promise(() => {}) },
      'workspace-option-wait',
      async () => {
        throw primary;
      },
      { diagnosticTimeoutMs: 5 },
    ),
    (error) => {
      assert.equal(error, primary);
      assert.match(error.message, /workspace option wait failed/);
      assert.match(error.message, /deadline-exceeded/);
      return true;
    },
  );
});

test('successful named workspace phase reports completion without diagnostics', async () => {
  const progress = [];
  const page = {
    evaluate: async () =>
      assert.fail('success path must not query diagnostics'),
  };
  assert.equal(
    await runWorkspaceFixturePhase(page, 'workspace-restore', async () => 17, {
      onProgress: (phase) => progress.push(phase),
    }),
    17,
  );
  assert.deepEqual(progress, [
    'workspace-restore:start',
    'workspace-restore:complete',
  ]);
});

test('workspace completion is latched even when autosave replaces it before polling', async () => {
  let callback,
    disconnected = 0,
    cleared = 0;
  const status = { textContent: 'Old status' };
  const button = {
    click() {
      status.textContent = 'Autosaved revision 32.';
      callback([
        {
          addedNodes: [
            { textContent: 'Opened investigation.' },
            { textContent: status.textContent },
          ],
        },
      ]);
    },
  };
  const scope = {
    document: {
      querySelector: () => ({
        querySelector: (selector) =>
          selector === '[data-status]' ? status : button,
      }),
    },
    MutationObserver: class {
      constructor(fn) {
        callback = fn;
      }
      observe() {}
      disconnect() {
        disconnected++;
      }
    },
    setTimeout: () => 1,
    clearTimeout: () => cleared++,
  };
  await clickAndWaitForWorkspaceOpen(scope);
  assert.equal(disconnected, 1);
  assert.equal(cleared, 1);
  button.click = () => {
    throw new Error('click failed');
  };
  await assert.rejects(clickAndWaitForWorkspaceOpen(scope), /click failed/);
  assert.equal(disconnected, 2);
  assert.equal(cleared, 2);
});

test('a missing workspace completion times out and removes its observer', async () => {
  let disconnected = false;
  const scope = {
    document: {
      querySelector: () => ({
        querySelector: () => ({
          click() {},
          textContent: 'Opening investigation',
        }),
      }),
    },
    MutationObserver: class {
      observe() {}
      disconnect() {
        disconnected = true;
      }
    },
    setTimeout,
    clearTimeout,
  };
  await assert.rejects(
    clickAndWaitForWorkspaceOpen(scope, 1),
    /completion timed out/,
  );
  assert.equal(disconnected, true);
});

test('workspace completion accepts a new latched restore when the status mutation is missed', async () => {
  const previous = { status: 'applied', workspaceId: 'workspace-a' };
  let current = previous;
  let poll;
  let intervalCleared = false;
  const status = { textContent: 'Opened “Investigation”.' };
  const select = { value: 'workspace-a' };
  const button = {
    disabled: false,
    click() {
      current = { status: 'applied', workspaceId: 'workspace-a' };
      poll();
    },
  };
  const scope = {
    __godsEyeView: {
      workspaceLibraryPanel: { restore: { getState: () => current } },
    },
    document: {
      querySelector: () => ({
        querySelector: (selector) =>
          selector === '[data-status]'
            ? status
            : selector === '[data-workspace-select]'
              ? select
              : button,
      }),
    },
    MutationObserver: class {
      observe() {}
      disconnect() {}
    },
    setInterval(callback) {
      poll = callback;
      return 1;
    },
    clearInterval() {
      intervalCleared = true;
    },
    setTimeout,
    clearTimeout,
  };
  await clickAndWaitForWorkspaceOpen(scope, 100);
  assert.equal(intervalCleared, true);
  assert.notEqual(current, previous);
});

test('network preflight requires actual worker interception, not merely DNS failure', async () => {
  const probe = createFixtureNetworkProbe('http://localhost:4174');
  const result = [
    'fixture-network-intercepted',
    'fixture-network-intercepted',
    'blocked',
  ];
  await assert.rejects(probe.verify({ evaluate: async () => result }));
  const report = await probe.verify({
    evaluate: async (_operation, urls) => {
      assert.equal(probe.respond(new URL(urls[0])).body, result[0]);
      assert.equal(probe.respond(new URL(urls[1])).body, result[1]);
      assert.equal(probe.respond(new URL(urls[2])), undefined);
      return result;
    },
  });
  assert.equal(report.interceptedWorkerRequests, 3);
  assert.equal(probe.respond(new URL('https://example.test/other')), undefined);
});

test('worker instrumentation tracks settlement, failures and termination without retaining payloads', () => {
  let clock = 0;
  class Worker extends EventTarget {
    postMessage(message) {
      if (message.throw) throw new Error('clone error');
    }
    terminate() {
      this.stopped = true;
    }
  }
  const scope = { Worker, performance: { now: () => clock } };
  installWorkerDiagnostics(scope);
  const worker = new scope.Worker(
    'https://secret.test/Workers/createGeometry.js?token=secret',
  );
  worker.postMessage({ id: 1, geometry: 'sensitive payload' });
  clock = 12000;
  const pending = scope.__gevSoakWorkers.snapshot();
  assert.equal(pending.pending, 1);
  assert.equal(pending.workers[0].oldestPendingMs, 12000);
  assert.doesNotMatch(JSON.stringify(pending), /secret|sensitive|geometry:/);
  worker.dispatchEvent(new MessageEvent('message', { data: { id: 999 } }));
  assert.equal(scope.__gevSoakWorkers.snapshot().pending, 1);
  worker.dispatchEvent(
    new MessageEvent('message', { data: { id: 1, error: 'bad geometry' } }),
  );
  worker.dispatchEvent(new Event('error'));
  assert.throws(
    () => worker.postMessage({ id: 2, throw: true }),
    /clone error/,
  );
  worker.postMessage({ id: 3 });
  worker.terminate();
  const result = scope.__gevSoakWorkers.snapshot().workers[0];
  assert.equal(result.pending, 0);
  assert.equal(result.completed, 1);
  assert.equal(result.taskErrors, 1);
  assert.equal(result.workerErrors, 1);
  assert.equal(result.postErrors, 1);
  assert.equal(result.cancelled, 1);
  assert.equal(worker.stopped, true);
});

test('worker diagnostic buffers are bounded and overflow is explicit', () => {
  class Worker extends EventTarget {
    postMessage() {}
    terminate() {}
  }
  const scope = { Worker, performance: { now: () => 0 } };
  installWorkerDiagnostics(scope);
  const worker = new scope.Worker('worker.js');
  for (let id = 0; id < 1026; id++) worker.postMessage({ id });
  for (let i = 0; i < 70; i++) new scope.Worker('worker.js');
  const result = scope.__gevSoakWorkers.snapshot();
  assert.equal(result.workers.length, 64);
  assert.equal(result.pending, 1024);
  assert.equal(result.overflow, true);
});

test('unsettled workers fail retention and absent worker instrumentation stays pending', () => {
  const report = stableReport();
  report.checkpoints.at(-1).metrics.application.workers.workers = [
    { pending: 1, oldestPendingMs: 10001 },
  ];
  assert.match(
    evaluateSoakStability(report).failures.join(' '),
    /Worker tasks remained unsettled/,
  );
  delete report.checkpoints.at(-1).metrics.application.workers;
  assert.equal(evaluateSoakStability(report).status, 'pending');
});
const stableReport = () => ({
  durationMs: FULL_SOAK_MS,
  checkpoints: Array.from({ length: 13 }, (_, i) => ({
    elapsedMs: i * 300000,
    metrics: metrics(),
  })),
});

test('fixture interception settles worker imports and blocks unconfigured provider traffic', async () => {
  const event = (url) => ({
    requestId: 'worker-1',
    networkId: 'no-network-event',
    request: { url, method: 'GET' },
  });
  const base = 'http://localhost:4174';
  assert.deepEqual(
    await fixtureRequestCommand(
      event(base + '/cesium/Workers/createBoxGeometry.js'),
      base,
    ),
    ['Fetch.continueRequest', { requestId: 'worker-1' }],
  );
  assert.equal(
    (await fixtureRequestCommand(event('https://provider.test/live'), base))[0],
    'Fetch.failRequest',
  );
  const [method, params] = await fixtureRequestCommand(
    event(base + '/api/live'),
    base,
  );
  assert.equal(method, 'Fetch.fulfillRequest');
  assert.equal(params.responseCode, 503);
  const bytes = Buffer.from([0, 255, 32]);
  const [, image] = await fixtureRequestCommand(
    event(base + '/api/image'),
    base,
    () => ({ contentType: 'image/png', body: bytes }),
  );
  assert.deepEqual(Buffer.from(image.body, 'base64'), bytes);
});

test('Fetch events settle without a Network event, and throwing fixtures abort the request', async () => {
  const callbacks = {},
    sent = [],
    errors = [];
  const client = {
    on: (name, fn) => {
      callbacks[name] = fn;
    },
    send: async (...args) => {
      sent.push(args);
    },
  };
  await interceptFixtureSession(
    client,
    'http://localhost',
    () => {
      throw new Error('broken fixture');
    },
    (error) => errors.push(error.message),
  );
  await callbacks['Fetch.requestPaused']({
    requestId: '1',
    networkId: 'unpaired',
    request: { url: 'http://localhost/api/test' },
  });
  assert.equal(sent[1][0], 'Fetch.failRequest');
  assert.deepEqual(errors, ['broken fixture']);
});

test('startup failures include application readiness and renderer error diagnostics', async () => {
  let broughtToFront = 0;
  let readinessOptions = null;
  await assert.rejects(
    bootFixturePage(
      {
        bringToFront: async () => broughtToFront++,
        goto: async () => {},
        waitForFunction: async (_predicate, options) => {
          readinessOptions = options;
          throw new Error('startup timeout');
        },
        evaluate: async () => ({
          applicationPresent: false,
          canvasCount: 0,
          cesiumError: 'WebGL unavailable',
        }),
      },
      'http://localhost',
    ),
    /startup timeout; startup diagnostics: .*WebGL unavailable/,
  );
  assert.equal(broughtToFront, 1);
  assert.deepEqual(readinessOptions, { timeout: 90_000, polling: 100 });
});

test('only a bounded cold module-graph timeout is recoverable during application prewarm', () => {
  const expected = new Error('startup timeout');
  expected.name = 'TimeoutError';
  expected.fixtureStartupDiagnostics = {
    state: {
      readyState: 'interactive',
      applicationPresent: false,
      workspacePanelPresent: false,
      canvasCount: 2,
    },
    errors: [],
    messages: [],
  };
  assert.equal(isRecoverableApplicationPrewarmFailure(expected), true);

  const applicationStarted = {
    name: expected.name,
    message: expected.message,
    fixtureStartupDiagnostics: structuredClone(
      expected.fixtureStartupDiagnostics,
    ),
  };
  applicationStarted.fixtureStartupDiagnostics.state.applicationPresent = true;
  assert.equal(
    isRecoverableApplicationPrewarmFailure(applicationStarted),
    false,
  );
  assert.equal(
    isRecoverableApplicationPrewarmFailure(new Error('connection refused')),
    false,
  );
});

test('rendered soak owns a longer bounded cold-application startup allowance', async () => {
  const source = await readFile(
    new URL('./qa-rendered-soak-driver.mjs', import.meta.url),
    'utf8',
  );
  assert.match(source, /applicationReadyTimeoutMs:\s*180_000/);
  assert.match(source, /RENDERED_WORKSPACE_TIMEOUT_MS\s*=\s*120_000/);
  assert.doesNotMatch(source, /await import\(['"]\/(?:src|scripts)\//);
});

test('sealed-preview worker probe uses the application Cesium module and retains diagnostics', async () => {
  let destroyed = false;
  class TaskProcessor {
    constructor() {
      this._activeTasks = 0;
    }
    scheduleTask(parameters) {
      this._activeTasks++;
      const invalid = parameters.subTasks.some(
        (task) => task.moduleName && task.modulePath,
      );
      return Promise.resolve()
        .then(() => {
          if (invalid)
            throw new Error('Must only set moduleName or modulePath');
          return { ok: true };
        })
        .finally(() => this._activeTasks--);
    }
    destroy() {
      destroyed = true;
    }
  }
  const result = await vm.runInNewContext(
    `(${runCesiumWorkerProbeInPage.toString()})(input)`,
    {
      input: { includeDiagnostics: true },
      __CESIUM__: {
        Cartesian3: class {
          constructor(x, y, z) {
            Object.assign(this, { x, y, z });
          }
        },
        BoxGeometry: class {
          constructor(options) {
            this.options = options;
          }
        },
        TaskProcessor,
      },
      __gevSoakWorkers: {
        snapshot: () => ({ pending: 0, processorDestroyed: destroyed }),
      },
      performance: { now: () => 10 },
      setTimeout,
      clearTimeout,
    },
  );
  assert.equal(result.probe.status, 'passed');
  assert.deepEqual(
    Array.from(result.probe.tasks, (task) => task.outcome),
    ['resolved', 'resolved', 'rejected-as-expected', 'resolved'],
  );
  assert.equal(result.diagnostics.pending, 0);
  assert.equal(result.diagnostics.processorDestroyed, true);
  assert.equal(destroyed, true);
});

test('setup failure reports retain owned browser cleanup evidence', () => {
  const error = new Error('Connection closed.');
  error.browserClose = {
    closeCompleted: true,
    forcedProcessTermination: false,
  };
  const report = createSoakSetupFailureReport(error);
  assert.equal(report.operationStatus, 'failed');
  assert.equal(report.error, 'Connection closed.');
  assert.equal(report.fullSoak, false);
  assert.equal(report.stability.status, 'pending');
  assert.deepEqual(report.browserClose, error.browserClose);

  error.cleanupError = 'Application soak browser did not close normally.';
  error.browserClose.closeCompleted = false;
  const incomplete = createSoakSetupFailureReport(error);
  assert.equal(incomplete.browserClose.closeCompleted, false);
  assert.equal(incomplete.cleanupError, error.cleanupError);
});

test('stability accepts a complete plateau and leaves short/missing evidence pending', () => {
  assert.equal(evaluateSoakStability(stableReport()).status, 'passed');
  assert.equal(
    evaluateSoakStability({ ...stableReport(), durationMs: 60000 }).status,
    'pending',
  );
  assert.equal(
    evaluateSoakStability({ durationMs: FULL_SOAK_MS }).status,
    'pending',
  );
  const missing = stableReport();
  delete missing.checkpoints[10].metrics.application;
  assert.equal(evaluateSoakStability(missing).status, 'pending');
});

test('stability fails retained owners, excessive heap and a persistent browser listener trend', () => {
  const owned = stableReport();
  owned.checkpoints.at(-1).metrics = metrics(100, 20, 1);
  assert.match(evaluateSoakStability(owned).failures.join(' '), /pendingJobs/);
  const heap = stableReport();
  heap.checkpoints[10].metrics.JSHeapUsedSize = 106;
  assert.equal(evaluateSoakStability(heap).status, 'failed');
  const listeners = stableReport();
  listeners.checkpoints.forEach((p, i) => {
    p.metrics.JSEventListeners += i;
  });
  assert.match(evaluateSoakStability(listeners).failures.join(' '), /listener/);
});

test('missing and sparse heap checkpoints cannot pass as zero growth', () => {
  const missing = stableReport();
  delete missing.checkpoints[10].metrics.JSHeapUsedSize;
  assert.equal(evaluateSoakStability(missing).status, 'pending');
  const sparse = stableReport();
  sparse.checkpoints = [0, 6, 7, 8, 12].map((i) => sparse.checkpoints[i]);
  assert.equal(evaluateSoakStability(sparse).status, 'pending');
});

test('retention accepts atomic hardware cycles up to twelve minutes apart', () => {
  const report = stableReport();
  report.checkpoints = [0, 28, 34, 44.25, 52, 58, 60].map((minutes) => ({
    elapsedMs: minutes * 60_000,
    metrics: metrics(),
  }));
  assert.equal(evaluateSoakStability(report).status, 'passed');
  report.checkpoints[3].elapsedMs = 46.1 * 60_000;
  assert.equal(evaluateSoakStability(report).status, 'pending');
});

test('retention compares owned gauges rather than cumulative provider activity', () => {
  const report = stableReport();
  report.checkpoints.forEach((point, index) => {
    point.metrics.application.resources.ownerResources.maps = {
      cacheEntries: 3,
      listeners: 2,
      pendingJobs: 0,
      providerLoadsStarted: index + 3,
      providerCacheReuses: index * 12,
      providerLoadFailures: index,
    };
  });
  assert.equal(evaluateSoakStability(report).status, 'passed');
  report.checkpoints.at(-1).metrics.application.resources.ownerResources.maps
    .cacheEntries++;
  const result = evaluateSoakStability(report);
  assert.equal(result.status, 'failed');
  assert.match(result.failures.join(' '), /maps.cacheEntries grew/);
  assert.equal(
    result.failures.some((reason) => reason.includes('providerCacheReuses')),
    false,
  );
});

test('retention gates scene entities and explicitly scoped import point instances', () => {
  const entities = stableReport();
  entities.checkpoints.at(-1).metrics.application.resources.entities = 1;
  assert.match(
    evaluateSoakStability(entities).failures.join(' '),
    /Resource entities grew from 0 to 1/,
  );

  const points = stableReport();
  points.checkpoints.at(
    -1,
  ).metrics.application.resources.ownerResources.fixture.pointPrimitiveCount =
    1;
  const pointResult = evaluateSoakStability(points);
  assert.match(
    pointResult.failures.join(' '),
    /fixture\.pointPrimitiveCount grew from 0 to 1/,
  );

  const missingUnit = stableReport();
  delete missingUnit.checkpoints[4].metrics.application.resources.ownerResources
    .fixture.pointPrimitiveCountUnit;
  assert.equal(evaluateSoakStability(missingUnit).status, 'pending');

  const wrongCoverage = stableReport();
  wrongCoverage.checkpoints[4].metrics.application.resources.ownerResources.fixture.pointPrimitiveCoverage =
    'all-scene-primitives';
  assert.equal(evaluateSoakStability(wrongCoverage).status, 'pending');

  const unscoped = stableReport();
  unscoped.checkpoints.at(
    -1,
  ).metrics.application.resources.pointPrimitiveCount = 1;
  assert.equal(evaluateSoakStability(unscoped).status, 'passed');
});

test('operation failure preserves completed counts and retained checkpoints', async () => {
  let clock = 0,
    cycles = 0;
  await assert.rejects(
    runMixedUseSoak({
      durationMs: 100,
      intervalMs: 0,
      checkpointIntervalMs: 1,
      now: () => clock,
      driver: {
        validateDatacenterSoakFixture: async () =>
          testDatacenterFixtureReceipt(),
        retainedMetrics: async () => metrics(),
        runCycle: async () => {
          clock += 20;
          if (++cycles === 2) throw new Error('worker stalled');
          return {
            sourceToggles: 1,
            replaySeeks: 1,
            imports: 1,
            workspaceReloads: 1,
            archiveFailures: 1,
            cameraRecoveries: 1,
          };
        },
      },
    }),
    (error) => {
      assert.equal(error.soakReport.iterations, 1);
      assert.equal(error.soakReport.checkpoints.length, 2);
      assert.equal(error.soakReport.operationStatus, 'failed');
      assert.equal(error.soakReport.error, 'worker stalled');
      return true;
    },
  );
});

test('worker preflight requires success, expected failure and recovery and disposes its own processor', async () => {
  let destroyed = 0;
  const processor = {
    _activeTasks: 0,
    scheduleTask: (parameters) =>
      parameters.fail
        ? Promise.reject(new Error('invalid geometry'))
        : Promise.resolve({}),
    destroy: () => destroyed++,
  };
  const report = await probeWorkerCompletion({
    createProcessor: () => processor,
    tasks: [
      { id: 'cold', parameters: {} },
      {
        id: 'error',
        parameters: { fail: true },
        expectError: /invalid geometry/,
      },
      { id: 'recovery', parameters: {} },
    ],
  });
  assert.equal(report.status, 'passed');
  assert.equal(report.tasks.length, 3);
  assert.equal(destroyed, 1);
});

test('worker timeout cannot count as an expected error; late completion is consumed', async () => {
  let destroyed = 0,
    finish;
  await assert.rejects(
    probeWorkerCompletion({
      createProcessor: () => ({
        _activeTasks: 1,
        scheduleTask: () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
        destroy: () => destroyed++,
      }),
      tasks: [{ id: 'stalled', parameters: {}, expectError: /.*/ }],
      timeoutMs: 5,
    }),
    /Worker completion timed out/,
  );
  finish({});
  assert.equal(destroyed, 1);
});

test('worker preflight rejects unexpected errors, missing rejection and unsettled counts', async () => {
  for (const [result, active, expected, message] of [
    [
      () => Promise.reject(new Error('wrong error')),
      0,
      /invalid/,
      /wrong error/,
    ],
    [() => Promise.resolve(), 0, /invalid/, /failed to reject/],
    [() => Promise.resolve(), 1, null, /retained active tasks/],
    [() => undefined, 0, null, /not accepted/],
  ]) {
    let destroyed = false;
    await assert.rejects(
      probeWorkerCompletion({
        createProcessor: () => ({
          _activeTasks: active,
          scheduleTask: result,
          destroy: () => {
            destroyed = true;
          },
        }),
        tasks: [{ id: 'test', parameters: {}, expectError: expected }],
      }),
      message,
    );
    assert.equal(destroyed, true);
  }
});

test('soak reports completed driver operations and labels short runs as smoke', async () => {
  let now = 0;
  const report = await runMixedUseSoak({
    durationMs: 100,
    intervalMs: 0,
    now: () => now,
    driver: {
      validateDatacenterSoakFixture: async () => testDatacenterFixtureReceipt(),
      startupPrewarm: { status: 'passed', durationMs: 12 },
      runCycle: async () => {
        now += 50;
        return {
          sourceToggles: 2,
          replaySeeks: 1,
          imports: 1,
          workspaceReloads: 1,
          archiveFailures: 1,
          cameraRecoveries: 1,
        };
      },
    },
  });
  assert.equal(report.iterations, 2);
  assert.equal(report.sourceToggles, 4);
  assert.equal(report.fullSoak, false);
  assert.equal(report.hardwareRenderingValidated, false);
  assert.deepEqual(report.checkpointSchedule, {
    requestedDurationMs: 100,
    actualDurationMs: 100,
    anchorElapsedMs: null,
    targetDurationMs: 100,
    maxExtraRuntimeMs: 0,
    status: 'not-applicable',
  });
  assert.deepEqual(report.startupPrewarm, {
    status: 'passed',
    durationMs: 12,
  });
  assert.deepEqual(
    report.datacenterFixtureReceipt,
    testDatacenterFixtureReceipt(),
  );
});

test('mixed-use soak fails closed and preserves an unfulfilled fixture receipt', async () => {
  const failedReceipt = testDatacenterFixtureReceipt();
  failedReceipt.status = 'failed';
  failedReceipt.fulfilledRequestCount = 0;
  failedReceipt.requests[0].fulfilled = false;
  const driver = {
    validateDatacenterSoakFixture: async () => failedReceipt,
    readDatacenterSoakFixtureReceipt: () => failedReceipt,
    runCycle: async () => {
      throw new Error('cycles must not start');
    },
    close: async () => ({ closeCompleted: true }),
  };
  await assert.rejects(runMixedUseSoak({ durationMs: 1, driver }), (error) => {
    assert.match(error.message, /fulfilled, materialized eight-feature/);
    assert.equal(error.soakReport.operationStatus, 'failed');
    assert.equal(error.soakReport.datacenterFixtureReceipt.status, 'failed');
    return true;
  });
});

test('full soak anchors its end to the first retained checkpoint at or after 30 minutes', async () => {
  const run = async (heapAtCheckpoint) => {
    let now = 0;
    let reads = 0;
    const report = await runMixedUseSoak({
      durationMs: FULL_SOAK_MS,
      intervalMs: 0,
      checkpointIntervalMs: 10 * 60_000,
      now: () => now,
      driver: {
        validateDatacenterSoakFixture: async () =>
          testDatacenterFixtureReceipt(),
        retainedMetrics: async () => metrics(heapAtCheckpoint(reads++)),
        runCycle: async () => {
          now += 6 * 60_000;
          return {
            sourceToggles: 1,
            replaySeeks: 1,
            imports: 1,
            workspaceReloads: 1,
            archiveFailures: 1,
            cameraRecoveries: 1,
          };
        },
      },
    });
    return report;
  };

  const flatHeap = await run(() => 100);
  const risingHeap = await run((read) => 100 + read * 10);
  for (const report of [flatHeap, risingHeap]) {
    assert.equal(report.checkpointSchedule.anchorElapsedMs, 36 * 60_000);
    assert.equal(report.checkpointSchedule.targetDurationMs, 66 * 60_000);
    assert.equal(report.checkpointSchedule.actualDurationMs, 66 * 60_000);
    assert.equal(report.checkpointSchedule.status, 'completed');
    assert.ok(report.durationMs >= report.checkpointSchedule.targetDurationMs);
    assert.ok(report.fullSoak);
  }
  assert.equal(
    flatHeap.checkpointSchedule.targetDurationMs,
    risingHeap.checkpointSchedule.targetDurationMs,
    'heap values must not influence the predeclared runtime target',
  );
  assert.equal(flatHeap.stability.status, 'passed');
  assert.equal(risingHeap.stability.status, 'failed');
});

test('requested full-soak duration remains a floor when it exceeds the anchored target', async () => {
  let now = 0;
  const report = await runMixedUseSoak({
    durationMs: 70 * 60_000,
    intervalMs: 0,
    checkpointIntervalMs: 15 * 60_000,
    now: () => now,
    driver: {
      validateDatacenterSoakFixture: async () => testDatacenterFixtureReceipt(),
      retainedMetrics: async () => metrics(),
      runCycle: async () => {
        now += 10 * 60_000;
        return {
          sourceToggles: 1,
          replaySeeks: 1,
          imports: 1,
          workspaceReloads: 1,
          archiveFailures: 1,
          cameraRecoveries: 1,
        };
      },
    },
  });
  assert.equal(report.checkpointSchedule.anchorElapsedMs, 40 * 60_000);
  assert.equal(report.checkpointSchedule.targetDurationMs, 70 * 60_000);
  assert.equal(report.checkpointSchedule.actualDurationMs, 70 * 60_000);
  assert.ok(report.durationMs >= 70 * 60_000);
  assert.ok(report.fullSoak);
});

test('full soak fails with bounded scheduling evidence when the anchor cannot fit the extension cap', async () => {
  let now = 0;
  await assert.rejects(
    runMixedUseSoak({
      durationMs: FULL_SOAK_MS,
      intervalMs: 0,
      checkpointIntervalMs: 80 * 60_000,
      now: () => now,
      driver: {
        validateDatacenterSoakFixture: async () =>
          testDatacenterFixtureReceipt(),
        retainedMetrics: async () => metrics(),
        runCycle: async () => {
          now += 85 * 60_000;
          return {
            sourceToggles: 1,
            replaySeeks: 1,
            imports: 1,
            workspaceReloads: 1,
            archiveFailures: 1,
            cameraRecoveries: 1,
          };
        },
      },
    }),
    (error) => {
      assert.match(error.message, /bounded extension/);
      assert.equal(error.soakReport.operationStatus, 'failed');
      assert.equal(
        error.soakReport.checkpointSchedule.anchorElapsedMs,
        85 * 60_000,
      );
      assert.equal(
        error.soakReport.checkpointSchedule.targetDurationMs,
        115 * 60_000,
      );
      assert.equal(
        error.soakReport.checkpointSchedule.status,
        'bounded-failure',
      );
      assert.equal(
        error.soakReport.checkpointSchedule.maxExtraRuntimeMs,
        24 * 60_000,
      );
      return true;
    },
  );
});

test('full soak fails at the extension bound if no retention anchor was sampled', async () => {
  let now = 0;
  await assert.rejects(
    runMixedUseSoak({
      durationMs: FULL_SOAK_MS,
      intervalMs: 0,
      checkpointIntervalMs: 100 * 60_000,
      now: () => now,
      driver: {
        validateDatacenterSoakFixture: async () =>
          testDatacenterFixtureReceipt(),
        retainedMetrics: async () => metrics(),
        runCycle: async () => {
          now += 85 * 60_000;
          return {
            sourceToggles: 1,
            replaySeeks: 1,
            imports: 1,
            workspaceReloads: 1,
            archiveFailures: 1,
            cameraRecoveries: 1,
          };
        },
      },
    }),
    (error) => {
      assert.match(error.message, /No equivalent-state retention anchor/);
      assert.equal(error.soakReport.checkpointSchedule.anchorElapsedMs, null);
      assert.equal(
        error.soakReport.checkpointSchedule.status,
        'bounded-failure',
      );
      return true;
    },
  );
});

test('full soak continues past its requested duration while waiting for a retention anchor', async () => {
  let now = 0;
  let cycles = 0;
  await assert.rejects(
    runMixedUseSoak({
      durationMs: FULL_SOAK_MS,
      intervalMs: 0,
      checkpointIntervalMs: 100 * 60_000,
      now: () => now,
      driver: {
        validateDatacenterSoakFixture: async () =>
          testDatacenterFixtureReceipt(),
        retainedMetrics: async () => metrics(),
        runCycle: async () => {
          now += 5 * 60_000;
          cycles++;
          return {
            sourceToggles: 1,
            replaySeeks: 1,
            imports: 1,
            workspaceReloads: 1,
            archiveFailures: 1,
            cameraRecoveries: 1,
          };
        },
      },
    }),
    (error) => {
      assert.match(error.message, /No equivalent-state retention anchor/);
      assert.equal(error.soakReport.checkpointSchedule.anchorElapsedMs, null);
      assert.equal(
        error.soakReport.checkpointSchedule.status,
        'bounded-failure',
      );
      assert.equal(
        error.soakReport.checkpointSchedule.actualDurationMs,
        85 * 60_000,
      );
      assert.equal(error.soakReport.durationMs, 85 * 60_000);
      assert.equal(
        cycles,
        17,
        'the run must continue beyond the 60-minute floor',
      );
      return true;
    },
  );
});

test('full soak fails if the final retained read exceeds the extension bound', async () => {
  let now = 0;
  let reads = 0;
  await assert.rejects(
    runMixedUseSoak({
      durationMs: FULL_SOAK_MS,
      intervalMs: 0,
      checkpointIntervalMs: 30 * 60_000,
      now: () => now,
      driver: {
        validateDatacenterSoakFixture: async () =>
          testDatacenterFixtureReceipt(),
        retainedMetrics: async () => {
          if (++reads === 4) now += 25 * 60_000;
          return metrics();
        },
        runCycle: async () => {
          now += 30 * 60_000;
          return {
            sourceToggles: 1,
            replaySeeks: 1,
            imports: 1,
            workspaceReloads: 1,
            archiveFailures: 1,
            cameraRecoveries: 1,
          };
        },
      },
    }),
    (error) => {
      assert.match(error.message, /Final retained checkpoint exceeded/);
      assert.equal(error.soakReport.operationStatus, 'failed');
      assert.equal(
        error.soakReport.checkpointSchedule.anchorElapsedMs,
        30 * 60_000,
      );
      assert.equal(
        error.soakReport.checkpointSchedule.targetDurationMs,
        FULL_SOAK_MS,
      );
      assert.equal(
        error.soakReport.checkpointSchedule.actualDurationMs,
        85 * 60_000,
      );
      assert.equal(
        error.soakReport.checkpointSchedule.status,
        'bounded-failure',
      );
      return true;
    },
  );
});

test('soak report preserves native resolution at initial and retained checkpoints', async () => {
  let now = 0;
  let retainedCalls = 0;
  const initial = { observedDpr: 2, initial: { devicePixelRatio: 2 } };
  const report = await runMixedUseSoak({
    durationMs: 100,
    intervalMs: 0,
    checkpointIntervalMs: 50,
    now: () => now,
    driver: {
      validateDatacenterSoakFixture: async () => testDatacenterFixtureReceipt(),
      nativeResolution: initial,
      warmupIterations: 1,
      retainedMetrics: async () => ({
        nativeResolution: { devicePixelRatio: 2, checkpoint: ++retainedCalls },
      }),
      runCycle: async () => {
        now += 50;
        return {
          sourceToggles: 1,
          replaySeeks: 1,
          imports: 1,
          workspaceReloads: 1,
          archiveFailures: 1,
          cameraRecoveries: 1,
        };
      },
    },
  });
  assert.deepEqual(report.nativeResolution, initial);
  assert.equal(
    report.firstRetainedMetrics.nativeResolution.devicePixelRatio,
    2,
  );
  assert.equal(report.lastRetainedMetrics.nativeResolution.devicePixelRatio, 2);
  assert.equal(report.warmupIterations, 1);
  assert.equal(report.iterations, 2);
  assert.equal(retainedCalls, 4);
  assert.deepEqual(
    report.checkpoints.map(
      (point) => point.metrics.nativeResolution.checkpoint,
    ),
    [1, 2, 3, 4],
  );
});

test('native drawing-buffer drift fails the soak and retains its failure report', async () => {
  let now = 0;
  let reads = 0;
  const evidence = {
    devicePixelRatio: 2,
    canvas: {
      clientWidth: 1440,
      clientHeight: 1000,
      width: 2880,
      height: 2000,
    },
    sceneDrawingBuffer: { width: 2880, height: 2000 },
    resolutionScale: 1,
    useBrowserRecommendedResolution: false,
    maximumScreenSpaceError: 1,
  };
  await assert.rejects(
    runMixedUseSoak({
      durationMs: 100,
      intervalMs: 0,
      checkpointIntervalMs: 50,
      now: () => now,
      driver: {
        validateDatacenterSoakFixture: async () =>
          testDatacenterFixtureReceipt(),
        nativeResolution: { observedDpr: 2, initial: evidence },
        retainedMetrics: async () => ({
          nativeResolution: assertNativeResolutionEvidence(
            ++reads === 1
              ? evidence
              : {
                  ...evidence,
                  sceneDrawingBuffer: { width: 1440, height: 1000 },
                },
            2,
            'checkpoint',
            evidence,
          ),
        }),
        runCycle: async () => {
          now += 50;
          return {
            sourceToggles: 1,
            replaySeeks: 1,
            imports: 1,
            workspaceReloads: 1,
            archiveFailures: 1,
            cameraRecoveries: 1,
          };
        },
      },
    }),
    (error) => {
      assert.match(error.message, /drawing buffer/);
      assert.equal(error.soakReport.operationStatus, 'failed');
      assert.equal(error.soakReport.iterations, 1);
      assert.equal(error.soakReport.checkpoints.length, 1);
      return true;
    },
  );
});

test('requested soak recording output is portable and reported without embedding it in the soak report', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'gev-soak-bundle-'));
  const output = path.join(
    directory,
    'recording-rendered-soak.gev-recording-bundle.json',
  );
  let now = 0;
  const bundle = {
    format: 'gods-eye-view-recording-bundle',
    version: 1,
    document: { id: 'recording-rendered-soak', kind: 'aircraft-recording' },
    chunks: [],
    manifest: { sha256: 'a'.repeat(64) },
  };
  try {
    const report = await runMixedUseSoak({
      durationMs: 100,
      intervalMs: 0,
      now: () => now,
      recordingBundleOut: output,
      driver: {
        validateDatacenterSoakFixture: async () =>
          testDatacenterFixtureReceipt(),
        runCycle: async () => {
          now += 50;
          return {
            sourceToggles: 1,
            replaySeeks: 1,
            imports: 1,
            workspaceReloads: 1,
            archiveFailures: 1,
            cameraRecoveries: 1,
          };
        },
        exportRecordingBundle: async () => bundle,
      },
    });
    assert.deepEqual(report.recordingBundleExport, {
      path: output,
      format: bundle.format,
      version: bundle.version,
      recordingId: bundle.document.id,
      bytes: Buffer.byteLength(JSON.stringify(bundle)),
    });
    assert.deepEqual(JSON.parse(await readFile(output, 'utf8')), bundle);
    assert.equal(JSON.stringify(report).includes('manifest'), false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('software renderer detection rejects known fallback strings', async () => {
  const { isSoftwareRenderer } = await import('./qa-rendered-soak-driver.mjs');
  assert.equal(
    isSoftwareRenderer('ANGLE (Intel, Intel UHD Graphics 620, D3D11)'),
    false,
  );
  assert.equal(isSoftwareRenderer('ANGLE (Google, SwiftShader)'), true);
  assert.equal(isSoftwareRenderer('llvmpipe (LLVM 15.0.7, 256 bits)'), true);
});
test('soak fails when an operation is missing or fails', async () => {
  await assert.rejects(
    runMixedUseSoak({
      durationMs: 1,
      driver: {
        validateDatacenterSoakFixture: async () =>
          testDatacenterFixtureReceipt(),
        runCycle: async () => ({}),
      },
    }),
    /did not complete/,
  );
  await assert.rejects(
    runMixedUseSoak({
      durationMs: 1,
      driver: {
        validateDatacenterSoakFixture: async () =>
          testDatacenterFixtureReceipt(),
        runCycle: async () => {
          throw new Error('source failed');
        },
      },
    }),
    /source failed/,
  );
});

test('a committed harness may validate a separately frozen application commit', () => {
  const harness = 'a'.repeat(40);
  const application = 'b'.repeat(40);
  assert.equal(
    resolveExpectedApplicationCommit(application, harness),
    application,
  );
  assert.equal(resolveExpectedApplicationCommit(null, harness), harness);
  assert.throws(
    () => resolveExpectedApplicationCommit('dev', harness),
    /full SHA/,
  );
});
