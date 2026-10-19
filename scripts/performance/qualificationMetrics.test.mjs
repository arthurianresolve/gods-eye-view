import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { createWorkspaceStorage } from '../../src/storage/index.js';
import {
  createAircraftRecordingService,
  createRecordedAircraftSource,
  createSyntheticAircraftFrames,
} from '../../src/recording/index.js';
import {
  evaluateQualificationMetrics,
  QUALIFICATION_METRIC_THRESHOLDS,
  readStartupObservation,
} from './qualificationMetrics.mjs';
import {
  buildQualificationIdentity,
  assertQualificationReplayFixtureState,
  disposeQualificationObserver,
  installInteractionObserverInPage,
  QUALIFICATION_REPLAY_FIXTURE_CONTRACT,
  readEffectiveMeasurementStateInPage,
  readAndAssertPageForeground,
} from '../qa-qualification-metrics-capture.mjs';

const ID = Object.freeze({
  fixtureId: 'fixture-123',
  fixtureSha256: 'a'.repeat(64),
  browserVersion: 'Chrome/155.0.8059.84',
  renderer: 'ANGLE D3D11',
  routeId: 'route-local-controls-v1',
  sourceProfile: {
    id: 'native-sharpness-v1',
    useBrowserRecommendedResolution: false,
    resolutionScale: 1,
    maximumScreenSpaceError: 1,
    viewport: { width: 1440, height: 900, dpr: 2 },
    drawingBuffer: { width: 2880, height: 1800 },
  },
});

const nativeResolutionEvidence = Object.freeze({
  observedDpr: 2,
  initial: {
    devicePixelRatio: 2,
    canvas: {
      clientWidth: 1440,
      clientHeight: 1000,
      width: 2880,
      height: 2000,
    },
    sceneDrawingBuffer: { width: 2880, height: 2000 },
    useBrowserRecommendedResolution: false,
    resolutionScale: 1,
    maximumScreenSpaceError: 1,
  },
});

function capture(appReadyMs = [1000, 1100, 1200, 1300, 1400], commit = '1') {
  return {
    source: { appCommit: commit.repeat(40) },
    integrity: { status: 'passed' },
    comparisonEligible: true,
    comparisonContract: {
      workloadId: 'fixture-workload-v1',
      fixture: {
        id: ID.fixtureId,
        sha256: ID.fixtureSha256,
        routeId: ID.routeId,
      },
      rendering: {
        viewport: { width: 1440, height: 900, dpr: 2 },
        drawingBuffer: { width: 2880, height: 1800 },
      },
    },
    workload: { fixtureId: ID.fixtureId },
    graphics: {
      renderer: ID.renderer,
      browserVersion: ID.browserVersion,
      featureStatus: { webgl: 'enabled' },
    },
    environment: {
      renderer: ID.renderer,
      platform: 'Win32',
      userAgent: 'Mozilla/5.0 Chrome/155.0.0.0 Safari/537.36',
      viewport: { width: 1440, height: 900, dpr: 2 },
      drawingBuffer: { width: 2880, height: 1800 },
      startup: {
        measurement: 'cache-disabled fresh browser contexts',
        runCount: 5,
        runs: appReadyMs.map((appReadyMs, index) => ({
          run: index + 1,
          cacheDisabled: true,
          focused: true,
          visible: true,
          userAgent: 'Mozilla/5.0 Chrome/155.0.0.0 Safari/537.36',
          platform: 'Win32',
          renderer: ID.renderer,
          viewport: { width: 1440, height: 900, dpr: 2 },
          drawingBuffer: { width: 2880, height: 1800 },
          foregroundActivation: {
            visible: true,
            focused: true,
            visibilityState: 'visible',
            hostWindowActivation: {
              browserPid: 42,
              foregroundPid: 42,
              foregroundConfirmed: true,
              status: 'foreground-confirmed',
            },
          },
          appReadyMs,
          initialSettleMs: appReadyMs + 50,
        })),
      },
    },
    captures: [
      {
        settings: {
          before: {
            resolutionScale: 1,
            nativeSharpnessProfile: structuredClone(ID.sourceProfile),
          },
          after: {
            resolutionScale: 1,
            nativeSharpnessProfile: structuredClone(ID.sourceProfile),
          },
        },
        conditions: {
          before: {
            settings: {
              resolutionScale: 1,
              nativeSharpnessProfile: structuredClone(ID.sourceProfile),
            },
            environment: {
              renderer: ID.renderer,
              userAgent: 'Mozilla/5.0 Chrome/155.0.0.0 Safari/537.36',
              platform: 'Win32',
              viewport: { width: 1440, height: 900, dpr: 2 },
              drawingBuffer: { width: 2880, height: 1800 },
              nativeSharpnessProfile: structuredClone(ID.sourceProfile),
            },
          },
          after: {
            settings: {
              resolutionScale: 1,
              nativeSharpnessProfile: structuredClone(ID.sourceProfile),
            },
            environment: {
              renderer: ID.renderer,
              userAgent: 'Mozilla/5.0 Chrome/155.0.0.0 Safari/537.36',
              platform: 'Win32',
              viewport: { width: 1440, height: 900, dpr: 2 },
              drawingBuffer: { width: 2880, height: 1800 },
              nativeSharpnessProfile: structuredClone(ID.sourceProfile),
            },
          },
        },
      },
    ],
  };
}

function identity(commit) {
  const viewport = { width: 1440, height: 1000, dpr: 2 };
  const drawingBuffer = { width: 2880, height: 2000 };
  return {
    applicationCommit: commit.repeat(40),
    browserVersion: ID.browserVersion,
    renderer: ID.renderer,
    userAgent: 'Mozilla/5.0 Chrome/155.0.0.0 Safari/537.36',
    platform: 'Win32',
    viewport,
    drawingBuffer,
    nativeSharpnessProfile: {
      ...structuredClone(ID.sourceProfile),
      viewport,
      drawingBuffer,
    },
    settings: {
      qualityMode: 'manual',
      densityPct: 75,
      detectionMode: 'DENSE',
      resolutionScale: 1,
      antialias: true,
      msaaSamples: 4,
      fxaa: false,
      visual: {
        style: 'normal',
        bloomEnabled: false,
        bloomIntensity: 0,
        sharpenEnabled: true,
        sharpenIntensity: 49,
        detectionMode: 'DENSE',
        detectionDensityPct: 75,
        detectionAllocation: 'ELASTIC',
        detectionFadePct: 7,
        detectionOutsideOpacityPct: 1,
        scopeEnabled: true,
        scopeFeatherPct: 11,
        mapStack: 'photoreal',
      },
    },
    settingsAfter: {
      qualityMode: 'manual',
      densityPct: 75,
      detectionMode: 'DENSE',
      resolutionScale: 1,
      antialias: true,
      msaaSamples: 4,
      fxaa: false,
      visual: {
        style: 'normal',
        bloomEnabled: false,
        bloomIntensity: 0,
        sharpenEnabled: true,
        sharpenIntensity: 49,
        detectionMode: 'DENSE',
        detectionDensityPct: 75,
        detectionAllocation: 'ELASTIC',
        detectionFadePct: 7,
        detectionOutsideOpacityPct: 1,
        scopeEnabled: true,
        scopeFeatherPct: 11,
        mapStack: 'photoreal',
      },
    },
    nativeSharpnessProfileAfter: {
      ...structuredClone(ID.sourceProfile),
      viewport,
      drawingBuffer,
    },
    fixtureId: ID.fixtureId,
    fixtureSha256: ID.fixtureSha256,
    routeId: ID.routeId,
  };
}

function cameraSetup(routeId, location, frameNumber) {
  return {
    routeId,
    requestedLocation: location,
    frameNumberBefore: frameNumber,
    frameNumberAfter: frameNumber + 1,
    observedPose: {
      frameNumber: frameNumber + 1,
      ...location,
      heading: 0,
      pitch: -Math.PI / 2,
      roll: 0,
    },
  };
}

const samples = (stateMs, frameMs, prefix) =>
  Array.from({ length: 20 }, (_, index) => ({
    sampleId: `${prefix}-${index + 1}`,
    inputAtMs: index * 1000,
    armedAtMs: index * 1000,
    inputEventAtMs: index * 1000,
    handlerReceivedAtMs: index * 1000 + 1,
    inputDeliveryDelayMs: 1,
    inputEventType: prefix.includes('local') ? 'pointerdown' : 'input',
    inputTrusted: true,
    inputTargetMatched: true,
    inputClockSource: 'trusted-event-timeStamp',
    generation: index + 1 + (prefix.includes('replay') ? 20 : 0),
    stateAtMs: index * 1000 + stateMs,
    renderedFrameAtMs: index * 1000 + frameMs,
    stateObserved: true,
    renderedFrameObserved: true,
    renderWitnessType: 'natural-replay-prerender-postrender-v1',
    preRenderFrameNumber: index * 2 + 2,
    visibilityState: 'visible',
    focused: true,
    frameNumberAtState: index * 2 + 1,
    frameNumberAtRendered: index * 2 + 1,
    preRenderFrameNumber: index * 2 + 1,
  }));
const localSamples = (stateMs, frameMs, prefix) =>
  samples(stateMs, frameMs, prefix).map((sample) => ({
    ...sample,
    frameNumberAtRendered: sample.frameNumberAtState,
    preRenderFrameNumber: sample.frameNumberAtState,
    renderWitnessType: 'natural-prerender-postrender-pair-v1',
  }));

const datacenterFixtureReceipt = () => ({
  schema: 'gev-soak-datacenter-fixture/v2',
  fulfillmentProtocol: 'cdp-fetch-fulfilled-hash-count-v1',
  status: 'validated',
  requestCount: 1,
  preparedRequestCount: 1,
  fulfilledRequestCount: 1,
  applicationOrigin: 'http://127.0.0.1:4184',
  assetOrigin: 'http://127.0.0.1:4184',
  assetPath: '/assets/datacenters-CtzejECr.geojsonl',
  responseStatus: 200,
  bodySha256:
    '8556d37f8809bc6c4a3f6807b21422c974cb795e617e48884b5518be4085a8b5',
  expectedBodySha256:
    '8556d37f8809bc6c4a3f6807b21422c974cb795e617e48884b5518be4085a8b5',
  expectedFeatureCount: 8,
  deliveredFeatureCount: 8,
  materializedFeatureCount: 8,
  disabledMaterializedFeatureCount: 0,
  disabledRenderableCount: 0,
  setupTiming: 'unmeasured-before-interaction-samples',
  preloadEnabledObserved: true,
  preloadDisabledObserved: true,
  failureReason: null,
  requests: [
    {
      origin: 'http://127.0.0.1:4184',
      pathname: '/assets/datacenters-CtzejECr.geojsonl',
      prepared: true,
      fulfilled: true,
      responseStatus: 200,
      bodySha256:
        '8556d37f8809bc6c4a3f6807b21422c974cb795e617e48884b5518be4085a8b5',
      deliveredFeatureCount: 8,
    },
  ],
});

function interactionEvidence(overrides = {}) {
  const base = {
    schema: 'gev-interaction-latency-evidence/v2',
    status: 'completed',
    pairing: { fixtureSha256: ID.fixtureSha256, routeId: ID.routeId },
    builds: {
      baseline: {
        status: 'completed',
        interactionStatus: 'completed',
        interactionProtocol:
          'trusted-event-timeStamp-prerender-postrender-witness-v4',
        browserClose: { closeCompleted: true, forcedProcessTermination: false },
        foregroundIntegrity: {
          status: 'completed',
          browserPid: 42,
          hostActivation: {
            status: 'foreground-confirmed',
            foregroundConfirmed: true,
            browserPid: 42,
            foregroundPid: 42,
          },
          observations: [{ visibilityState: 'visible', focused: true }],
        },
        applicationCommit: '1'.repeat(40),
        identity: identity('1'),
        datacenterFixtureReceipt: datacenterFixtureReceipt(),
        localControlCameraSetup: cameraSetup(
          'rendered-soak-driver-default-location-v1',
          { latitude: 40.7, longitude: -73.9, altitude: 1000 },
          100,
        ),
        replayCameraSetup: cameraSetup(
          'rendered-soak-recording-region-v1',
          { latitude: 0, longitude: 179.7, altitude: 500000 },
          150,
        ),
        localControl: localSamples(10, 30, 'b-local').map((sample, index) => ({
          ...sample,
          expectedLayerEnabled: index % 2 === 0,
          layerEnabledObserved: index % 2 === 0,
          layerVisibleObserved: index % 2 === 0,
          layerRenderablesObserved: index % 2 === 0,
          materializedRecordCount: index % 2 === 0 ? 8 : 0,
          renderableCount: index % 2 === 0 ? 4 : 0,
        })),
        loadedReplaySeek: samples(20, 80, 'b-replay').map((sample, index) => ({
          ...sample,
          selectedSourceMode: 'recorded',
          recordingId: 'recording-rendered-soak',
          fixtureRecordCount: 5,
          fixtureAircraftId: 'SYNTH-001',
          coverageFromMs: 1000,
          coverageToMs: 4000,
          expectedFixtureIndex: index % 2 ? 0 : 3,
          frameSelectedTimeMs: index % 2 ? 1000 : 4000,
          framePositionTimeMs: index % 2 ? 1000 : 4000,
          previousPositionTimeMs: index % 2 ? 4000 : 1000,
          positionTimeMs: index % 2 ? 1000 : 4000,
          fixtureAircraftLatitude: Math.sin((index % 2 ? 0 : 3) / 10) * 0.02,
          fixtureAircraftLongitude:
            ((((179.7 + (index % 2 ? 0 : 3) * 0.01 + 180) % 360) + 360) % 360) -
            180,
          renderedBillboardVisible: true,
          renderedBillboardId: 'SYNTH-001',
          renderedRecordPositionTimeMs: index % 2 ? 1000 : 4000,
          renderedRecordLatitude: Math.sin((index % 2 ? 0 : 3) / 10) * 0.02,
          renderedRecordLongitude:
            ((((179.7 + (index % 2 ? 0 : 3) * 0.01 + 180) % 360) + 360) % 360) -
            180,
          renderedBillboardLatitude: Math.sin((index % 2 ? 0 : 3) / 10) * 0.02,
          renderedBillboardLongitude:
            ((((179.7 + (index % 2 ? 0 : 3) * 0.01 + 180) % 360) + 360) % 360) -
            180,
          billboardScreenPosition: { x: 100, y: 100 },
          billboardCanvas: { width: 1440, height: 1000 },
        })),
      },
      candidate: {
        status: 'completed',
        interactionStatus: 'completed',
        interactionProtocol:
          'trusted-event-timeStamp-prerender-postrender-witness-v4',
        browserClose: { closeCompleted: true, forcedProcessTermination: false },
        foregroundIntegrity: {
          status: 'completed',
          browserPid: 42,
          hostActivation: {
            status: 'foreground-confirmed',
            foregroundConfirmed: true,
            browserPid: 42,
            foregroundPid: 42,
          },
          observations: [{ visibilityState: 'visible', focused: true }],
        },
        applicationCommit: '2'.repeat(40),
        identity: identity('2'),
        datacenterFixtureReceipt: datacenterFixtureReceipt(),
        localControlCameraSetup: cameraSetup(
          'rendered-soak-driver-default-location-v1',
          { latitude: 40.7, longitude: -73.9, altitude: 1000 },
          200,
        ),
        replayCameraSetup: cameraSetup(
          'rendered-soak-recording-region-v1',
          { latitude: 0, longitude: 179.7, altitude: 500000 },
          250,
        ),
        localControl: localSamples(10, 30, 'c-local').map((sample, index) => ({
          ...sample,
          expectedLayerEnabled: index % 2 === 0,
          layerEnabledObserved: index % 2 === 0,
          layerVisibleObserved: index % 2 === 0,
          layerRenderablesObserved: index % 2 === 0,
          materializedRecordCount: index % 2 === 0 ? 8 : 0,
          renderableCount: index % 2 === 0 ? 4 : 0,
        })),
        loadedReplaySeek: samples(20, 80, 'c-replay').map((sample, index) => ({
          ...sample,
          selectedSourceMode: 'recorded',
          recordingId: 'recording-rendered-soak',
          fixtureRecordCount: 5,
          fixtureAircraftId: 'SYNTH-001',
          coverageFromMs: 1000,
          coverageToMs: 4000,
          expectedFixtureIndex: index % 2 ? 0 : 3,
          frameSelectedTimeMs: index % 2 ? 1000 : 4000,
          framePositionTimeMs: index % 2 ? 1000 : 4000,
          previousPositionTimeMs: index % 2 ? 4000 : 1000,
          positionTimeMs: index % 2 ? 1000 : 4000,
          fixtureAircraftLatitude: Math.sin((index % 2 ? 0 : 3) / 10) * 0.02,
          fixtureAircraftLongitude:
            ((((179.7 + (index % 2 ? 0 : 3) * 0.01 + 180) % 360) + 360) % 360) -
            180,
          renderedBillboardVisible: true,
          renderedBillboardId: 'SYNTH-001',
          renderedRecordPositionTimeMs: index % 2 ? 1000 : 4000,
          renderedRecordLatitude: Math.sin((index % 2 ? 0 : 3) / 10) * 0.02,
          renderedRecordLongitude:
            ((((179.7 + (index % 2 ? 0 : 3) * 0.01 + 180) % 360) + 360) % 360) -
            180,
          renderedBillboardLatitude: Math.sin((index % 2 ? 0 : 3) / 10) * 0.02,
          renderedBillboardLongitude:
            ((((179.7 + (index % 2 ? 0 : 3) * 0.01 + 180) % 360) + 360) % 360) -
            180,
          billboardScreenPosition: { x: 100, y: 100 },
          billboardCanvas: { width: 1440, height: 1000 },
        })),
      },
    },
  };
  return Object.assign(base, overrides);
}

function heapEvidence() {
  const workPlan = {
    warmupCycles: 2,
    measuredCycles: 6,
    operationsPerCycle: {
      sourceToggles: 8,
      replaySeeks: 1,
      imports: 1,
      workspaceReloads: 2,
      archiveFailures: 1,
      cameraRecoveries: 1,
    },
    phaseIds: ['mixed-use-cycle'],
  };
  const side = (commit, scale) => ({
    status: 'completed',
    heapStatus: 'completed',
    applicationCommit: commit.repeat(40),
    identity: identity(commit),
    browserClose: { closeCompleted: true, forcedProcessTermination: false },
    foregroundIntegrity: {
      status: 'completed',
      browserPid: 42,
      hostActivation: {
        status: 'foreground-confirmed',
        foregroundConfirmed: true,
        browserPid: 42,
        foregroundPid: 42,
      },
      observations: [{ visibilityState: 'visible', focused: true }],
    },
    completedCycles: [1, 2, 3, 4, 5, 6],
    warmupCycleOperations: Array.from({ length: 2 }, () =>
      structuredClone(workPlan.operationsPerCycle),
    ),
    completedCycleOperations: Array.from({ length: 6 }, (_, index) => ({
      cycle: index + 1,
      operations: structuredClone(workPlan.operationsPerCycle),
    })),
    phaseIds: [...workPlan.phaseIds],
    operationsPerCycle: structuredClone(workPlan.operationsPerCycle),
    actualDurationMs: 6000 + scale,
    samples: Array.from({ length: 12 }, (_, index) => ({
      sampleId: `${commit}-heap-${index}`,
      sampleOrdinal: index + 1,
      capturedAt: new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString(),
      elapsedMs: index * 500,
      heapUsedBytes: Math.round((100 + index) * scale * 1_000_000),
      phaseId: 'mixed-use-cycle',
      cycle: Math.floor(index / 2) + 1,
      visibilityState: 'visible',
      focused: true,
      visibilityState: 'visible',
      focused: true,
    })),
  });
  return {
    schema: 'gev-sampled-heap-evidence/v1',
    status: 'completed',
    workPlan,
    sampling: { cadenceMs: 1000, maxGapMs: 5000, forcedGc: false },
    builds: { baseline: side('1', 1), candidate: side('2', 1.05) },
  };
}

function replacePageGlobals(values) {
  const descriptors = new Map(
    Object.keys(values).map((key) => [
      key,
      Object.getOwnPropertyDescriptor(globalThis, key),
    ]),
  );
  Object.assign(globalThis, values);
  return () => {
    for (const [key, descriptor] of descriptors) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  };
}

function inputControl(extra = {}) {
  return {
    listeners: new Map(),
    addEventListener(name, listener) {
      this.listeners.set(name, listener);
    },
    removeEventListener(name) {
      this.listeners.delete(name);
    },
    contains(target) {
      return target === this || target?.parentNode === this;
    },
    dispatch(name, timeStamp = performance.now(), overrides = {}) {
      const listener = this.listeners.get(name);
      listener?.({
        type: name,
        currentTarget: this,
        target: this,
        timeStamp,
        isTrusted: true,
        ...overrides,
      });
    },
    ...extra,
  };
}

test('startup remains a separate five-run metric and other missing evidence is pending', () => {
  const result = evaluateQualificationMetrics({
    baseline: capture(),
    candidate: capture(undefined, '2'),
  });
  assert.equal(result.status, 'pending');
  assert.equal(result.acceptanceEligible, false);
  assert.equal(result.metrics.coldStartup.status, 'measured');
  assert.equal(result.metrics.coldStartup.baselineMedianMs, 1200);
  assert.match(
    result.metrics.coldStartup.semantic,
    /neither proves.*local UI activation/,
  );
  assert.equal(result.metrics.localControl.status, 'unavailable');
  assert.equal(result.metrics.loadedReplaySeek.status, 'unavailable');
  assert.equal(result.metrics.sampledPeakHeap.status, 'unavailable');
});

test('interaction evidence binds exact source builds, browser, renderer, fixture, settings and 20 unique samples', () => {
  assert.deepEqual(QUALIFICATION_METRIC_THRESHOLDS, {
    localControlP95Ms: 100,
    loadedReplaySeekP95Ms: 250,
    regressionOver10Pct: 10,
  });
  const pass = evaluateQualificationMetrics({
    baseline: capture(),
    candidate: capture(undefined, '2'),
    interactionEvidence: interactionEvidence(),
  });
  assert.equal(pass.metrics.localControl.candidate.inputToStateP95Ms, 10);
  assert.equal(
    pass.metrics.localControl.candidate.inputToRenderedFrameP95Ms,
    30,
  );
  assert.equal(
    pass.metrics.loadedReplaySeek.candidate.inputToRenderedFrameP95Ms,
    80,
  );

  const queuedEvents = interactionEvidence();
  for (const sample of queuedEvents.builds.candidate.localControl) {
    sample.handlerReceivedAtMs += 40;
    sample.inputDeliveryDelayMs = 41;
    sample.stateAtMs += 40;
    sample.renderedFrameAtMs += 40;
  }
  const queuedResult = evaluateQualificationMetrics({
    baseline: capture(),
    candidate: capture(undefined, '2'),
    interactionEvidence: queuedEvents,
  });
  assert.equal(
    queuedResult.metrics.localControl.candidate.inputToStateP95Ms,
    50,
  );
  assert.equal(
    queuedResult.metrics.localControl.candidate.inputToRenderedFrameP95Ms,
    70,
    'latency starts at the event timestamp, so delivery delay remains included',
  );

  const oldWitness = interactionEvidence();
  oldWitness.schema = 'gev-interaction-latency-evidence/v1';
  const oldWitnessResult = evaluateQualificationMetrics({
    baseline: capture(),
    candidate: capture(undefined, '2'),
    interactionEvidence: oldWitness,
  });
  assert.equal(oldWitnessResult.metrics.localControl.status, 'unavailable');

  const equivalentCameraAngles = interactionEvidence();
  equivalentCameraAngles.builds.baseline.localControlCameraSetup.observedPose.heading =
    2 * Math.PI;
  equivalentCameraAngles.builds.candidate.localControlCameraSetup.observedPose.roll =
    -2 * Math.PI;
  equivalentCameraAngles.builds.baseline.replayCameraSetup.observedPose.roll =
    2 * Math.PI;
  const equivalentAnglesResult = evaluateQualificationMetrics({
    baseline: capture(),
    candidate: capture(undefined, '2'),
    interactionEvidence: equivalentCameraAngles,
  });
  assert.equal(equivalentAnglesResult.metrics.localControl.status, 'measured');
  assert.equal(
    equivalentAnglesResult.metrics.loadedReplaySeek.status,
    'measured',
  );

  const wrongCommit = interactionEvidence();
  wrongCommit.builds.candidate.identity.applicationCommit = '3'.repeat(40);
  const wrongPair = evaluateQualificationMetrics({
    baseline: capture(),
    candidate: capture(undefined, '2'),
    interactionEvidence: wrongCommit,
  });
  assert.equal(wrongPair.metrics.localControl.status, 'failed');

  for (const mutate of [
    (e) => {
      delete e.builds.candidate.datacenterFixtureReceipt;
    },
    (e) => {
      e.builds.candidate.datacenterFixtureReceipt.assetOrigin =
        'http://other.test';
    },
    (e) => {
      e.builds.candidate.datacenterFixtureReceipt.materializedFeatureCount = 4362;
    },
    (e) => {
      e.builds.candidate.datacenterFixtureReceipt.bodySha256 = 'bad';
    },
    (e) => {
      e.builds.candidate.datacenterFixtureReceipt.fulfilledRequestCount = 0;
    },
    (e) => {
      e.builds.candidate.datacenterFixtureReceipt.requests[0].fulfilled = false;
    },
    (e) => {
      e.builds.candidate.datacenterFixtureReceipt.requests[0].bodySha256 =
        'bad';
    },
    (e) => {
      e.builds.candidate.datacenterFixtureReceipt.requests[0].pathname =
        '/assets/dams-CtzejECr.geojsonl';
    },
    (e) => {
      e.builds.candidate.localControl[0].materializedRecordCount = 4362;
    },
    (e) => {
      e.builds.candidate.identity.browserVersion = 'Chrome/154.0.0.0';
    },
    (e) => {
      e.builds.candidate.identity.fixtureSha256 = 'c'.repeat(64);
    },
    (e) => {
      e.builds.candidate.identity.settings.qualityMode = 'adaptive';
    },
    (e) => {
      e.builds.candidate.identity.settings.detectionMode = 'SPARSE';
    },
    (e) => {
      e.builds.candidate.identity.settings.densityPct = 50;
    },
    (e) => {
      e.builds.candidate.localControl.pop();
    },
    (e) => {
      e.builds.baseline.localControl[1].sampleId =
        e.builds.baseline.localControl[0].sampleId;
    },
    (e) => {
      e.builds.candidate.loadedReplaySeek[0].frameNumberAtRendered++;
    },
    (e) =>
      delete e.builds.candidate.loadedReplaySeek[0].renderedBillboardVisible,
    (e) => {
      e.builds.candidate.loadedReplaySeek[0].renderedBillboardVisible = false;
    },
    (e) => {
      e.builds.candidate.loadedReplaySeek[0].renderedBillboardId = 'OTHER';
    },
    (e) => {
      e.builds.candidate.loadedReplaySeek[0].renderedRecordPositionTimeMs++;
    },
    (e) => {
      e.builds.candidate.loadedReplaySeek[0].renderedRecordLongitude = 120;
    },
    (e) => {
      e.builds.candidate.loadedReplaySeek[0].fixtureRecordCount = 4;
    },
    (e) =>
      delete e.builds.candidate.loadedReplaySeek[0].renderedBillboardLatitude,
    (e) => {
      e.builds.candidate.loadedReplaySeek[0].renderedBillboardLongitude = 120;
    },
    (e) => {
      e.builds.candidate.loadedReplaySeek[0].billboardScreenPosition.x =
        e.builds.candidate.loadedReplaySeek[0].billboardCanvas.width;
    },
    (e) => {
      e.builds.candidate.localControlCameraSetup.routeId = 'wrong-route';
    },
    (e) => {
      e.builds.candidate.localControlCameraSetup.observedPose.latitude = 0;
    },
    (e) => {
      e.builds.candidate.localControlCameraSetup.observedPose.heading = 0.01;
    },
    (e) => {
      e.builds.candidate.localControl[0].inputEventAtMs = -100;
    },
    (e) => {
      e.builds.candidate.localControl[0].handlerReceivedAtMs = -1;
    },
    (e) => {
      e.builds.candidate.localControl[0].armedAtMs = 100;
    },
    (e) => {
      e.builds.candidate.localControl[0].inputTrusted = false;
    },
    (e) => {
      e.builds.candidate.localControl[0].inputEventType = 'click';
    },
    (e) => {
      e.builds.candidate.localControl[0].inputTargetMatched = false;
    },
    (e) => {
      e.builds.candidate.localControl[0].inputDeliveryDelayMs++;
    },
    (e) => {
      e.builds.candidate.localControl[1].generation =
        e.builds.candidate.localControl[0].generation;
    },
    (e) => {
      e.builds.candidate.loadedReplaySeek[0].frameSelectedTimeMs++;
    },
    (e) => {
      e.builds.candidate.loadedReplaySeek[0].framePositionTimeMs++;
    },
    (e) => {
      e.builds.candidate.loadedReplaySeek[0].renderWitnessType =
        'natural-matching-postrender-v2';
    },
    (e) => {
      e.builds.candidate.localControl[0].renderableCount = 0;
    },
    (e) => {
      e.builds.candidate.localControl[0].preRenderFrameNumber++;
    },
    (e) => {
      e.builds.candidate.localControl[0].frameNumberAtRendered++;
    },
    (e) => {
      e.builds.candidate.localControl[0].renderWitnessType =
        'natural-matching-postrender-v2';
    },
  ]) {
    const evidence = interactionEvidence();
    mutate(evidence);
    const result = evaluateQualificationMetrics({
      baseline: capture(),
      candidate: capture(undefined, '2'),
      interactionEvidence: evidence,
    });
    assert.equal(
      result.metrics.localControl.status === 'failed' ||
        result.metrics.loadedReplaySeek.status === 'failed',
      true,
    );
  }
  const missingRenderer = interactionEvidence();
  delete missingRenderer.builds.baseline.identity.renderer;
  const missingRendererResult = evaluateQualificationMetrics({
    baseline: capture(),
    candidate: capture(undefined, '2'),
    interactionEvidence: missingRenderer,
  });
  assert.equal(
    missingRendererResult.metrics.localControl.status,
    'unavailable',
  );
  assert.equal(
    missingRendererResult.metrics.loadedReplaySeek.status,
    'unavailable',
  );
});

test('startup evidence requires real browser, renderer, profile and five foreground run identities', () => {
  for (const mutate of [
    (report) => delete report.environment.renderer,
    (report) => delete report.graphics.browserVersion,
    (report) => delete report.environment.userAgent,
    (report) => delete report.environment.platform,
    (report) => delete report.environment.startup.measurement,
    (report) => delete report.environment.startup.runs[2].renderer,
    (report) => (report.environment.startup.runs[1].focused = false),
    (report) => delete report.captures[0].conditions.before.settings,
    (report) => (report.captures[0].settings.after.resolutionScale = 2),
    (report) =>
      (report.captures[0].conditions.after.settings.resolutionScale = 2),
    (report) =>
      (report.captures[0].conditions.before.settings.nativeSharpnessProfile.viewport.width = 1441),
    (report) =>
      (report.captures[0].conditions.after.environment.nativeSharpnessProfile.viewport.height = 901),
  ]) {
    const baseline = capture();
    const candidate = capture(undefined, '2');
    mutate(candidate);
    assert.equal(
      evaluateQualificationMetrics({ baseline, candidate }).metrics.coldStartup
        .status,
      'unavailable',
    );
  }
});

test('single startup shard reader validates one foreground cache-disabled run without granting eligibility', () => {
  const report = capture();
  report.comparisonEligible = false;
  report.environment.startup.runCount = 1;
  report.environment.startup.runs = report.environment.startup.runs.slice(0, 1);
  const observation = readStartupObservation(report, { expectedRunCount: 1 });
  assert.equal(observation.runCount, 1);
  assert.equal(observation.observations[0].cacheDisabled, true);
  assert.equal(
    observation.observations[0].foregroundActivation.hostWindowActivation
      .status,
    'foreground-confirmed',
  );
  assert.equal(observation.observations[0].appReadyMs, 1000);
  assert.equal(observation.observations[0].initialSettleMs, 1050);

  assert.throws(() => readStartupObservation(report), /positive integer/);
  for (const mutate of [
    (candidate) => (candidate.integrity.status = 'failed'),
    (candidate) =>
      (candidate.environment.startup.runs[0].cacheDisabled = false),
    (candidate) => delete candidate.environment.startup.runs[0].renderer,
    (candidate) =>
      (candidate.environment.startup.runs[0].foregroundActivation.hostWindowActivation.foregroundConfirmed = false),
    (candidate) =>
      (candidate.environment.startup.runs[0].appReadyMs = Number.NaN),
  ]) {
    const candidate = structuredClone(report);
    mutate(candidate);
    assert.throws(() =>
      readStartupObservation(candidate, { expectedRunCount: 1 }),
    );
  }
});

test('capture identity carries observed 1440x1000 workload settings instead of matrix settings', () => {
  const expected = {
    ...identity('1'),
    sourceProfile: structuredClone(ID.sourceProfile),
  };
  const actual = identity('1');
  actual.settings.visualState = {
    style: 'normal',
    marker: 'measured-workload',
  };
  const built = buildQualificationIdentity(expected, actual, {
    fixtureId: ID.fixtureId,
    fixtureSha256: ID.fixtureSha256,
    routeId: ID.routeId,
  });
  assert.equal(built.viewport.height, 1000);
  assert.deepEqual(built.settings, actual.settings);
  assert.notDeepEqual(built.settings, capture().captures[0].settings.before);
  assert.throws(
    () =>
      buildQualificationIdentity(expected, {
        ...actual,
        viewport: { ...actual.viewport, height: 900 },
      }),
    /height/,
  );
});

test('live settings use relevant getVisualState fields and exclude HUD state', () => {
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const visualState = {
    style: 'normal',
    bloom: { enabled: false, intensity: 0 },
    sharpen: { enabled: true, intensity: 49 },
    hud: { visible: true, variant: 'tactical' },
    detection: {
      mode: 'DENSE',
      density: 75,
      allocation: 'ELASTIC',
      fadePct: 7,
      outsideOpacityPct: 1,
    },
    scope: { enabled: true, featherPct: 11 },
    mapStack: 'photoreal',
    styleParams: { normal: { irrelevantShaderUIState: 42 } },
  };
  globalThis.window = {
    devicePixelRatio: 2,
    navigator: { userAgent: 'Chrome/155.0.8059.84', platform: 'Win32' },
    __godsEyeView: {
      viewer: {
        __gevNativeSharpnessProfile: 'native-sharpness-v1',
        useBrowserRecommendedResolution: false,
        resolutionScale: 1,
        scene: {
          canvas: { clientWidth: 1440, clientHeight: 1000 },
          drawingBufferWidth: 2880,
          drawingBufferHeight: 2000,
          globe: { maximumScreenSpaceError: 1 },
          context: {
            _gl: { getContextAttributes: () => ({ antialias: true }) },
          },
          msaaSamples: 4,
          postProcessStages: { fxaa: { enabled: false } },
        },
      },
      styleManager: {
        _adaptiveQuality: { getMode: () => 'manual' },
        services: {
          getDetectionTuning: () => ({ densityPct: 75 }),
          getDetectionMode: () => 'DENSE',
        },
        getVisualState: () => visualState,
      },
    },
  };
  try {
    const measured = readEffectiveMeasurementStateInPage(
      nativeResolutionEvidence,
    );
    assert.equal(measured.settings.qualityMode, 'manual');
    assert.equal(measured.settings.detectionMode, 'DENSE');
    assert.equal(measured.settings.densityPct, 75);
    assert.deepEqual(measured.settings.visual, {
      style: 'normal',
      bloomEnabled: false,
      bloomIntensity: 0,
      sharpenEnabled: true,
      sharpenIntensity: 49,
      detectionMode: 'DENSE',
      detectionDensityPct: 75,
      detectionAllocation: 'ELASTIC',
      detectionFadePct: 7,
      detectionOutsideOpacityPct: 1,
      scopeEnabled: true,
      scopeFeatherPct: 11,
      mapStack: 'photoreal',
    });
    assert.equal('hud' in measured.settings.visual, false);
    assert.equal('styleParams' in measured.settings.visual, false);
    assert.equal('camera' in measured.settings, false);
  } finally {
    if (originalWindow)
      Object.defineProperty(globalThis, 'window', originalWindow);
    else delete globalThis.window;
  }
});

test('native profile can be derived from observed settings when driver marker is absent', () => {
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const context = {
    _gl: { getContextAttributes: () => ({ antialias: true }) },
  };
  globalThis.window = {
    devicePixelRatio: 2,
    navigator: { userAgent: 'Chrome/155.0.8059.84', platform: 'Win32' },
    __godsEyeView: {
      viewer: {
        useBrowserRecommendedResolution: false,
        resolutionScale: 1,
        scene: {
          canvas: { clientWidth: 1440, clientHeight: 1000 },
          drawingBufferWidth: 2880,
          drawingBufferHeight: 2000,
          globe: { maximumScreenSpaceError: 1 },
          context,
          msaaSamples: 4,
          postProcessStages: { fxaa: { enabled: false } },
        },
      },
      styleManager: {
        _adaptiveQuality: { getMode: () => 'manual' },
        services: {
          getDetectionTuning: () => ({ densityPct: 75 }),
          getDetectionMode: () => 'DENSE',
        },
        getVisualState: () => ({
          style: 'normal',
          bloom: { enabled: false, intensity: 0 },
          sharpen: { enabled: true, intensity: 49 },
          detection: { mode: 'DENSE', density: 75 },
          scope: { enabled: true, featherPct: 11 },
          mapStack: 'photoreal',
        }),
      },
    },
  };
  try {
    const measured = readEffectiveMeasurementStateInPage(
      nativeResolutionEvidence,
    );
    assert.equal(measured.nativeSharpnessProfile.id, 'native-sharpness-v1');
    assert.equal(measured.nativeSharpnessProfile.viewport.height, 1000);
    assert.deepEqual(measured.nativeSharpnessProfile.drawingBuffer, {
      width: 2880,
      height: 2000,
    });
    assert.throws(
      () => readEffectiveMeasurementStateInPage(),
      /native settings evidence/,
    );
    assert.throws(
      () =>
        readEffectiveMeasurementStateInPage({
          ...nativeResolutionEvidence,
          observedDpr: 1,
        }),
      /native settings evidence/,
    );
    assert.throws(
      () =>
        readEffectiveMeasurementStateInPage({
          ...nativeResolutionEvidence,
          observedDpr: Number.NaN,
        }),
      /native settings evidence/,
    );
  } finally {
    if (originalWindow)
      Object.defineProperty(globalThis, 'window', originalWindow);
    else delete globalThis.window;
  }
});

test('foreground checks fail closed and observer cleanup releases page ownership', async () => {
  await assert.rejects(
    readAndAssertPageForeground(
      { evaluate: async () => ({ visibilityState: 'hidden', focused: false }) },
      'test',
    ),
    /hidden/,
  );
  await assert.rejects(
    readAndAssertPageForeground(
      {
        evaluate: async () => ({ visibilityState: 'visible', focused: false }),
      },
      'test',
    ),
    /not focused/,
  );
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  let disposed = 0;
  globalThis.window = {
    __qualificationMetricsObserver: { dispose: () => disposed++ },
  };
  try {
    assert.equal(
      await disposeQualificationObserver({ evaluate: (fn) => fn() }),
      true,
    );
    assert.equal(disposed, 1);
    assert.equal('__qualificationMetricsObserver' in globalThis.window, false);
  } finally {
    if (originalWindow)
      Object.defineProperty(globalThis, 'window', originalWindow);
    else delete globalThis.window;
  }
});

test('observer cleanup deletes page ownership and surfaces disposal failure', async () => {
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  let disposeAttempts = 0;
  globalThis.window = {
    __qualificationMetricsObserver: {
      dispose() {
        disposeAttempts++;
        throw new Error('controlled observer teardown failure');
      },
    },
  };
  try {
    await assert.rejects(
      disposeQualificationObserver({ evaluate: (fn) => fn() }),
      /controlled observer teardown failure/,
    );
    assert.equal(disposeAttempts, 1);
    assert.equal('__qualificationMetricsObserver' in globalThis.window, false);
  } finally {
    if (originalWindow)
      Object.defineProperty(globalThis, 'window', originalWindow);
    else delete globalThis.window;
  }
});

test('interaction measures the first naturally produced matching frame without requesting one', async () => {
  let renderListener;
  let preRenderListener;
  let renderRequests = 0;
  let intervalCallback;
  let layerEnabled = false;
  let buttonActive = false;
  let lod = { computed: false, total: 0, active: 0 };
  const controls = new Map();
  controls.set(
    '[data-layer-id="local-datacenters"] .data-toggle-btn',
    inputControl({
      classList: { contains: (name) => name === 'active' && buttonActive },
    }),
  );
  controls.set('.investigation-timeline-slider-control', inputControl());
  const scene = {
    requestRenderMode: true,
    frameState: { frameNumber: 50 },
    requestRender() {
      renderRequests++;
    },
    preRender: {
      addEventListener(listener) {
        preRenderListener = listener;
        return () => {
          preRenderListener = null;
        };
      },
    },
    postRender: {
      addEventListener(listener) {
        renderListener = listener;
        return () => {
          renderListener = null;
        };
      },
    },
  };
  const globalWindow = {
    __godsEyeView: {
      viewer: { scene },
      dataManager: {
        isEnabled: () => layerEnabled,
        layers: new Map([
          [
            'local-datacenters',
            {
              module: {
                getAnalystRecords: () => {
                  throw new Error('local poll must not normalize analyst rows');
                },
                getLodDiagnostics: () => lod,
              },
            },
          ],
        ]),
      },
    },
  };
  const restoreGlobals = replacePageGlobals({
    window: globalWindow,
    document: { querySelector: (selector) => controls.get(selector) || null },
    setInterval: (callback) => {
      intervalCallback = callback;
      return 1;
    },
    clearInterval() {},
  });
  try {
    installInteractionObserverInPage(QUALIFICATION_REPLAY_FIXTURE_CONTRACT);
    const observer = globalWindow.__qualificationMetricsObserver;
    await observer.pollState();
    assert.equal(observer.pending, null);
    assert.equal(observer.records.length, 0);
    assert.equal(renderRequests, 0);
    observer.arm('localControl', true);
    const node = controls.get(
      '[data-layer-id="local-datacenters"] .data-toggle-btn',
    );
    node.dispatch('pointerdown');
    await observer.pollPromise;
    assert.equal(observer.pending.stateAtMs, null);
    for (let index = 0; index < 25; index++) await intervalCallback();
    layerEnabled = true;
    buttonActive = true;
    preRenderListener();
    lod = { computed: true, total: 8, active: 67 };
    await intervalCallback();
    assert.equal(renderRequests, 0);
    assert.equal(observer.pending.renderWitnessType, undefined);
    assert.equal(observer.pending.materializedRecordCount, 8);
    assert.equal(observer.records.length, 0);

    renderListener();
    assert.equal(
      observer.pending.stateAtMs,
      null,
      'postRender-only readiness changes must not qualify a frame',
    );
    scene.frameState.frameNumber++;
    preRenderListener();
    assert.ok(Number.isFinite(observer.pending.stateAtMs));
    renderListener();
    const record = observer.take();
    assert.equal(record.frameNumberAtRendered, 51);
    assert.equal(record.frameNumberAtState, 51);
    assert.equal(record.preRenderFrameNumber, 51);
    assert.equal(
      record.renderWitnessType,
      'natural-prerender-postrender-pair-v1',
    );
    assert.equal(record.inputEventType, 'pointerdown');
    assert.equal(record.inputTrusted, true);
    assert.equal(record.inputAtMs, record.inputEventAtMs);
    assert.ok(record.handlerReceivedAtMs >= record.inputAtMs);
    assert.equal(record.layerEnabledObserved, true);
    assert.equal(record.layerVisibleObserved, true);
    assert.equal(renderRequests, 0);

    observer.arm('localControl', false);
    node.dispatch('pointerdown');
    await observer.pollPromise;
    layerEnabled = false;
    buttonActive = false;
    lod = { computed: false, total: 0, active: 0 };
    scene.frameState.frameNumber++;
    preRenderListener();
    renderListener();
    const disabledRecord = observer.take();
    assert.equal(disabledRecord.expectedLayerEnabled, false);
    assert.equal(disabledRecord.layerEnabledObserved, false);
    assert.equal(disabledRecord.layerVisibleObserved, false);
    assert.equal(disabledRecord.layerRenderablesObserved, false);
    assert.equal(renderRequests, 0);
    observer.dispose();
    assert.equal(preRenderListener, null, 'preRender listener is disposed');
  } finally {
    globalWindow.__qualificationMetricsObserver?.dispose();
    restoreGlobals();
  }
});

test('interaction observer rejects scenes without a preRender event boundary', () => {
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  globalThis.window = {
    __godsEyeView: {
      viewer: {
        scene: { postRender: { addEventListener: () => () => {} } },
      },
    },
  };
  try {
    assert.throws(
      () =>
        installInteractionObserverInPage(QUALIFICATION_REPLAY_FIXTURE_CONTRACT),
      /needs Cesium preRender and postRender/,
    );
  } finally {
    if (originalWindow)
      Object.defineProperty(globalThis, 'window', originalWindow);
    else delete globalThis.window;
  }
});

test('interaction input rejects stale, wrong-target/type, untrusted, future and duplicate events', async () => {
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const originalDocument = Object.getOwnPropertyDescriptor(
    globalThis,
    'document',
  );
  try {
    for (const invalid of [
      { name: 'stale timestamp', type: 'pointerdown', time: -1 },
      { name: 'nonfinite timestamp', type: 'pointerdown', time: Number.NaN },
      { name: 'wrong type', type: 'click' },
      { name: 'untrusted', isTrusted: false },
      { name: 'wrong target', target: {} },
      { name: 'future timestamp', future: true },
    ]) {
      const local = inputControl();
      const slider = inputControl();
      const scene = {
        frameState: { frameNumber: 10 },
        preRender: { addEventListener: () => () => {} },
        postRender: { addEventListener: () => () => {} },
      };
      globalThis.window = { __godsEyeView: { viewer: { scene } } };
      globalThis.document = {
        querySelector: (selector) =>
          selector.includes('data-layer-id') ? local : slider,
      };
      installInteractionObserverInPage(QUALIFICATION_REPLAY_FIXTURE_CONTRACT);
      const observer = globalThis.window.__qualificationMetricsObserver;
      observer.arm('localControl', true);
      const now = performance.now();
      const options = {
        ...(invalid.time != null ? { timeStamp: invalid.time } : {}),
        ...(invalid.isTrusted != null ? { isTrusted: invalid.isTrusted } : {}),
        ...(invalid.target ? { target: invalid.target } : {}),
        ...(invalid.future ? { timeStamp: now + 60_000 } : {}),
      };
      local.dispatch('pointerdown', now, {
        ...(invalid.type ? { type: invalid.type } : {}),
        ...options,
      });
      assert.match(
        observer.error || '',
        /input event failed freshness validation/,
      );
      assert.equal(observer.pending.inputAtMs, null, invalid.name);
      observer.dispose();
    }

    const local = inputControl();
    const slider = inputControl();
    const scene = {
      frameState: { frameNumber: 10 },
      preRender: { addEventListener: () => () => {} },
      postRender: { addEventListener: () => () => {} },
    };
    globalThis.window = { __godsEyeView: { viewer: { scene } } };
    globalThis.document = {
      querySelector: (selector) =>
        selector.includes('data-layer-id') ? local : slider,
    };
    installInteractionObserverInPage(QUALIFICATION_REPLAY_FIXTURE_CONTRACT);
    const observer = globalThis.window.__qualificationMetricsObserver;
    local.dispatch('pointerdown');
    assert.equal(observer.pending, null, 'input before arm is not captured');
    observer.arm('localControl', true);
    local.dispatch('pointerdown', observer.pending.armedAtMs - 1);
    assert.match(
      observer.error || '',
      /input event failed freshness validation/,
    );
    observer.dispose();
  } finally {
    if (originalWindow)
      Object.defineProperty(globalThis, 'window', originalWindow);
    else delete globalThis.window;
    if (originalDocument)
      Object.defineProperty(globalThis, 'document', originalDocument);
    else delete globalThis.document;
  }
});

test('interaction input rejects duplicate and superseded-generation events', async () => {
  const local = inputControl({ classList: { contains: () => false } });
  const slider = inputControl();
  const scene = {
    frameState: { frameNumber: 10 },
    preRender: { addEventListener: () => () => {} },
    postRender: { addEventListener: () => () => {} },
  };
  const restoreGlobals = replacePageGlobals({
    window: {
      __godsEyeView: {
        viewer: { scene },
        dataManager: {
          isEnabled: () => false,
          layers: new Map([
            [
              'local-datacenters',
              {
                module: {
                  getLodDiagnostics: () => ({
                    computed: false,
                    total: 0,
                    active: 0,
                  }),
                },
              },
            ],
          ]),
        },
      },
    },
    document: {
      querySelector: (selector) =>
        selector.includes('data-layer-id') ? local : slider,
    },
    setInterval: () => 1,
    clearInterval() {},
  });
  try {
    installInteractionObserverInPage(QUALIFICATION_REPLAY_FIXTURE_CONTRACT);
    const observer = globalThis.window.__qualificationMetricsObserver;
    observer.arm('localControl', false);
    local.dispatch('pointerdown');
    await observer.pollPromise;
    local.dispatch('pointerdown');
    assert.match(observer.error || '', /Duplicate input event/);
    observer.pending = null;
    observer.armedTarget = null;
    observer.error = null;
    observer.arm('localControl', false);
    observer.generation++;
    local.dispatch('pointerdown');
    assert.match(observer.error || '', /Stale interaction generation/);
    observer.dispose();
  } finally {
    globalThis.window?.__qualificationMetricsObserver?.dispose();
    restoreGlobals();
  }
});

test('natural replay frame rejects changed source time and billboard, then accepts matching output', async () => {
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const originalDocument = Object.getOwnPropertyDescriptor(
    globalThis,
    'document',
  );
  const local = inputControl();
  const slider = inputControl({ value: '4000' });
  const selected = {
    id: 'SYNTH-001',
    positionTimeMs: 4000,
    latitude: Math.sin(0.3) * 0.02,
    longitude: ((((179.7 + 3 * 0.01 + 180) % 360) + 360) % 360) - 180,
  };
  const visual = {
    billboardId: selected.id,
    billboardVisible: true,
    billboardPosition: {
      latitude: selected.latitude,
      longitude: selected.longitude,
    },
    screenPosition: { x: 200, y: 300 },
    canvas: { width: 1440, height: 1000 },
  };
  let frameListener;
  let preRenderListener;
  const scene = {
    frameState: { frameNumber: 30 },
    preRender: {
      addEventListener(listener) {
        preRenderListener = listener;
        return () => {
          preRenderListener = null;
        };
      },
    },
    postRender: {
      addEventListener(listener) {
        frameListener = listener;
        return () => {
          frameListener = null;
        };
      },
    },
  };
  let analystRecordReads = 0;
  const app = {
    viewer: { scene },
    aircraftSource: {
      getState: () => ({
        mode: 'recorded',
        recordingId: 'recording-rendered-soak',
        recordCount: 5,
        targetMs: 4000,
        coverage: { from: 1000, to: 4000 },
      }),
      getSnapshot: async () => ({ records: [selected] }),
    },
    dataManager: {
      layers: new Map([
        [
          'flights',
          {
            module: {
              getAnalystRecords(limit) {
                analystRecordReads++;
                assert.equal(limit, 8, 'replay witness must stay bounded');
                return [
                  {
                    icao24: selected.id,
                    provenance: {
                      positionObservedAtMs:
                        analystRecordReads <= 4
                          ? selected.positionTimeMs - 1000
                          : selected.positionTimeMs,
                    },
                    lat: selected.latitude,
                    lon: selected.longitude,
                  },
                ];
              },
            },
          },
        ],
      ]),
    },
  };
  globalThis.window = {
    __godsEyeView: app,
    __qualificationFlightWitnessReader: () => visual,
  };
  globalThis.document = {
    querySelector: (selector) => {
      if (selector === '.investigation-timeline-times')
        return { textContent: '00:00:04' };
      return selector.includes('data-layer-id') ? local : slider;
    },
  };
  try {
    installInteractionObserverInPage(QUALIFICATION_REPLAY_FIXTURE_CONTRACT);
    const observer = globalThis.window.__qualificationMetricsObserver;
    observer.arm(
      'loadedReplaySeek',
      'end',
      '00:00:01',
      1000,
      0,
      179.7,
      1000,
      1000,
      4000,
    );
    slider.dispatch('input');
    preRenderListener();
    frameListener();
    assert.equal(observer.pending.stateAtMs, null);
    assert.equal(analystRecordReads, 1);
    scene.frameState.frameNumber = 31;
    app.aircraftSource.getState = () => ({
      mode: 'recorded',
      recordingId: 'recording-rendered-soak',
      recordCount: 5,
      targetMs: 1000,
      coverage: { from: 1000, to: 4000 },
    });
    preRenderListener();
    frameListener();
    assert.equal(observer.records.length, 0, 'wrong source time is rejected');

    app.aircraftSource.getState = () => ({
      mode: 'recorded',
      recordingId: 'recording-rendered-soak',
      recordCount: 5,
      targetMs: 4000,
      coverage: { from: 1000, to: 4000 },
    });
    visual.billboardId = 'OTHER';
    scene.frameState.frameNumber = 32;
    preRenderListener();
    frameListener();
    assert.equal(observer.records.length, 0, 'wrong aircraft is rejected');

    visual.billboardId = selected.id;
    scene.frameState.frameNumber = 33;
    preRenderListener();
    frameListener();
    assert.equal(
      observer.records.length,
      0,
      'stale preRender layer provenance is rejected',
    );
    assert.equal(analystRecordReads, 4);
    scene.frameState.frameNumber = 34;
    preRenderListener();
    assert.equal(observer.pending.frameNumberAtState, 34);
    frameListener();
    const record = observer.take();
    assert.equal(analystRecordReads, 6);
    assert.equal(record.renderedRecordPositionTimeMs, selected.positionTimeMs);
    assert.equal(record.frameSelectedTimeMs, 4000);
    assert.equal(record.framePositionTimeMs, 4000);
    assert.equal(record.renderedBillboardId, selected.id);
    assert.equal(
      record.renderWitnessType,
      'natural-replay-prerender-postrender-v1',
    );
    observer.dispose();
  } finally {
    globalThis.window?.__qualificationMetricsObserver?.dispose();
    if (originalWindow)
      Object.defineProperty(globalThis, 'window', originalWindow);
    else delete globalThis.window;
    if (originalDocument)
      Object.defineProperty(globalThis, 'document', originalDocument);
    else delete globalThis.document;
  }
});

test('interaction remains pending without a natural completed frame', async () => {
  const node = inputControl({ classList: { contains: () => true } });
  const scene = {
    frameState: { frameNumber: 12 },
    preRender: { addEventListener: () => () => {} },
    postRender: { addEventListener: () => () => {} },
  };
  const restoreGlobals = replacePageGlobals({
    window: {
      __godsEyeView: {
        viewer: { scene },
        dataManager: {
          isEnabled: () => true,
          layers: new Map([
            [
              'local-datacenters',
              {
                module: {
                  getLodDiagnostics: () => ({
                    computed: true,
                    total: 4,
                    active: 2,
                  }),
                },
              },
            ],
          ]),
        },
      },
    },
    document: {
      querySelector: (selector) =>
        selector.includes('data-layer-id') ? node : inputControl(),
    },
    setInterval: () => 1,
    clearInterval() {},
  });
  try {
    installInteractionObserverInPage(QUALIFICATION_REPLAY_FIXTURE_CONTRACT);
    const observer = globalThis.window.__qualificationMetricsObserver;
    observer.arm('localControl', true);
    node.dispatch('pointerdown');
    await observer.pollPromise;
    assert.equal(observer.pending.stateAtMs, null);
    assert.equal(observer.records.length, 0);
    assert.equal(typeof scene.requestRender, 'undefined');
    observer.dispose();
  } finally {
    globalThis.window?.__qualificationMetricsObserver?.dispose();
    restoreGlobals();
  }
});

test('replay witness rejects source-only, offscreen and mismatched displayed aircraft', () => {
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const originalDocument = Object.getOwnPropertyDescriptor(
    globalThis,
    'document',
  );
  const node = {
    addEventListener() {},
    removeEventListener() {},
    classList: { contains: () => false },
  };
  globalThis.window = {
    __godsEyeView: {
      viewer: {
        scene: {
          preRender: { addEventListener: () => () => {} },
          postRender: { addEventListener: () => () => {} },
          requestRender() {},
        },
      },
    },
  };
  globalThis.document = { querySelector: () => node };
  try {
    installInteractionObserverInPage(QUALIFICATION_REPLAY_FIXTURE_CONTRACT);
    const observer = globalThis.window.__qualificationMetricsObserver;
    const selectedRecord = {
      id: 'SYNTH-001',
      positionTimeMs: 1000,
      latitude: 0,
      longitude: 179.7,
    };
    const renderedRecord = {
      icao24: selectedRecord.id,
      provenance: { positionObservedAtMs: selectedRecord.positionTimeMs },
      lat: selectedRecord.latitude,
      lon: selectedRecord.longitude,
    };
    const visualWitness = {
      billboardId: 'SYNTH-001',
      billboardVisible: true,
      billboardPosition: { latitude: 0, longitude: 179.7 },
      screenPosition: { x: 200, y: 300 },
      canvas: { width: 1440, height: 1000 },
    };
    assert.equal(
      observer.isReplayVisualWitness({
        selectedRecord,
        renderedRecord,
        visualWitness,
      }),
      true,
    );
    assert.equal(
      observer.isReplayVisualWitness({ selectedRecord, visualWitness }),
      false,
      'source records without a visible rendered billboard are rejected',
    );
    assert.equal(
      observer.isReplayVisualWitness({
        selectedRecord,
        renderedRecord,
        visualWitness: { ...visualWitness, billboardPosition: null },
      }),
      false,
      'a visible billboard without a geographic position is rejected',
    );
    assert.equal(
      observer.isReplayVisualWitness({
        selectedRecord,
        renderedRecord,
        visualWitness: {
          ...visualWitness,
          billboardPosition: { latitude: 0.001, longitude: 179.7 },
        },
      }),
      false,
      'billboard position must match the selected source record',
    );
    assert.equal(
      observer.isReplayVisualWitness({
        selectedRecord,
        renderedRecord,
        visualWitness: {
          ...visualWitness,
          screenPosition: { x: 1500, y: 300 },
        },
      }),
      false,
      'offscreen billboards are rejected',
    );
    assert.equal(
      observer.isReplayVisualWitness({
        selectedRecord,
        renderedRecord: {
          ...renderedRecord,
          provenance: { positionObservedAtMs: 999 },
        },
        visualWitness,
      }),
      false,
      'stale layer provenance is rejected even when billboard pose matches',
    );
    observer.dispose();
  } finally {
    if (originalWindow)
      Object.defineProperty(globalThis, 'window', originalWindow);
    else delete globalThis.window;
    if (originalDocument)
      Object.defineProperty(globalThis, 'document', originalDocument);
    else delete globalThis.document;
  }
});

test('disposed replay frame observers cannot revive a sample', async () => {
  let preRenderListener;
  let renderListener;
  let analystReads = 0;
  const scene = {
    frameState: { frameNumber: 70 },
    preRender: {
      addEventListener(listener) {
        preRenderListener = listener;
        return () => {
          preRenderListener = null;
        };
      },
    },
    postRender: {
      addEventListener(listener) {
        renderListener = listener;
        return () => {
          renderListener = null;
        };
      },
    },
  };
  const controlNode = () => inputControl();
  const selected = {
    id: 'SYNTH-001',
    positionTimeMs: 4000,
    latitude: Math.sin(0.3) * 0.02,
    longitude: ((((179.7 + 3 * 0.01 + 180) % 360) + 360) % 360) - 180,
  };
  const visual = {
    billboardId: selected.id,
    billboardVisible: true,
    billboardPosition: {
      latitude: selected.latitude,
      longitude: selected.longitude,
    },
    screenPosition: { x: 200, y: 300 },
    canvas: { width: 1440, height: 1000 },
  };
  const controls = new Map([
    ['.investigation-timeline-times', { textContent: '00:00:04' }],
    [
      '.investigation-timeline-slider-control',
      { ...controlNode(), value: '4000' },
    ],
    ['[data-layer-id="local-datacenters"] .data-toggle-btn', controlNode()],
  ]);
  const globalWindow = {
    __godsEyeView: {
      viewer: { scene },
      aircraftSource: {
        getState: () => ({
          mode: 'recorded',
          recordingId: 'recording-rendered-soak',
          recordCount: 5,
          targetMs: 4000,
          coverage: { from: 1000, to: 4000 },
        }),
      },
      dataManager: {
        layers: new Map([
          [
            'flights',
            {
              module: {
                getAnalystRecords(limit) {
                  analystReads++;
                  assert.equal(limit, 8);
                  return [
                    {
                      icao24: selected.id,
                      provenance: {
                        positionObservedAtMs: selected.positionTimeMs,
                      },
                      lat: selected.latitude,
                      lon: selected.longitude,
                    },
                  ];
                },
              },
            },
          ],
        ]),
      },
    },
    __qualificationFlightWitnessReader: () => visual,
  };
  const restoreGlobals = replacePageGlobals({
    window: globalWindow,
    document: { querySelector: (selector) => controls.get(selector) || null },
  });
  try {
    installInteractionObserverInPage(QUALIFICATION_REPLAY_FIXTURE_CONTRACT);
    const observer = globalWindow.__qualificationMetricsObserver;
    observer.arm(
      'loadedReplaySeek',
      'end',
      '00:00:01',
      1000,
      Math.sin(0.1) * 0.02,
      179.71,
      1000,
      1000,
      4000,
    );
    const slider = controls.get('.investigation-timeline-slider-control');
    slider.dispatch('input');
    await disposeQualificationObserver({ evaluate: (fn) => fn() });
    preRenderListener?.();
    renderListener?.();
    assert.equal(globalWindow.__qualificationMetricsObserver, undefined);
    assert.equal(observer.pending, null);
    assert.equal(observer.records.length, 0);
    assert.equal(analystReads, 0, 'disposed observers perform no frame reads');
  } finally {
    globalWindow.__qualificationMetricsObserver?.dispose();
    restoreGlobals();
  }
});

test('sampled peak derives from matched raw timestamped heap series, not old soak summaries', () => {
  const result = evaluateQualificationMetrics({
    baseline: capture(),
    candidate: capture(undefined, '2'),
    sampledHeapEvidence: heapEvidence(),
  });
  assert.equal(result.metrics.sampledPeakHeap.status, 'measured');
  assert.equal(result.metrics.sampledPeakHeap.changePct, 5);
  assert.equal(
    result.metrics.sampledPeakHeap.actualDurationMsByBuild.baseline,
    6001,
  );
  assert.equal(
    result.metrics.sampledPeakHeap.actualDurationMsByBuild.candidate,
    6001.05,
  );
  const absent = evaluateQualificationMetrics({
    sampledHeapEvidence: { peakHeapBytes: 100 },
  });
  assert.equal(absent.metrics.sampledPeakHeap.status, 'unavailable');
});

test('heap consumer rejects absent or malformed series, duplicate/dropped samples, stale timing, wrong build and wrong environment', () => {
  const cases = [
    [
      (e) => {
        e.builds.baseline.samples[1].sampleId =
          e.builds.baseline.samples[0].sampleId;
      },
      'failed',
    ],
    [
      (e) => {
        e.builds.candidate.samples[4].elapsedMs =
          e.builds.candidate.samples[3].elapsedMs;
      },
      'failed',
    ],
    [
      (e) => {
        e.builds.candidate.samples[4].elapsedMs =
          e.builds.candidate.samples[3].elapsedMs + 5001;
      },
      'failed',
    ],
    [
      (e) => {
        e.builds.candidate.samples[4].sampleOrdinal = 4;
      },
      'failed',
    ],
    [
      (e) => {
        e.builds.candidate.completedCycles.pop();
      },
      'failed',
    ],
    [
      (e) => {
        e.builds.candidate.completedCycleOperations[2].operations.imports = 0;
      },
      'failed',
    ],
    [
      (e) => {
        e.builds.candidate.identity.applicationCommit = '3'.repeat(40);
      },
      'failed',
    ],
    [
      (e) => {
        delete e.builds.candidate.identity.renderer;
      },
      'unavailable',
    ],
    [
      (e) => {
        e.builds.candidate.identity.fixtureSha256 = 'c'.repeat(64);
      },
      'failed',
    ],
    [
      (e) => {
        e.builds.candidate.identity.browserVersion = 'Chrome/154.0.0.0';
      },
      'failed',
    ],
    [
      (e) => {
        e.builds.baseline.samples = [{ elapsedMs: 0, heapUsedBytes: 1 }];
      },
      'failed',
    ],
    [
      (e) => {
        e.builds.candidate.identity.nativeSharpnessProfile.resolutionScale = 2;
      },
      'failed',
    ],
  ];
  for (const [caseIndex, [mutate, expected]] of cases.entries()) {
    const evidence = heapEvidence();
    mutate(evidence);
    const result = evaluateQualificationMetrics({
      baseline: capture(),
      candidate: capture(undefined, '2'),
      sampledHeapEvidence: evidence,
    });
    assert.equal(
      result.metrics.sampledPeakHeap.status,
      expected,
      `case ${caseIndex + 1}`,
    );
  }
  const absent = heapEvidence();
  delete absent.builds.baseline.samples;
  assert.equal(
    evaluateQualificationMetrics({
      baseline: capture(),
      candidate: capture(undefined, '2'),
      sampledHeapEvidence: absent,
    }).metrics.sampledPeakHeap.status,
    'unavailable',
  );
});

test('heap sides require equal planned work but permit unequal realized durations', () => {
  const evidence = heapEvidence();
  evidence.builds.candidate.actualDurationMs += 1500;
  const accepted = evaluateQualificationMetrics({
    baseline: capture(),
    candidate: capture(undefined, '2'),
    sampledHeapEvidence: evidence,
  });
  assert.equal(accepted.metrics.sampledPeakHeap.status, 'measured');
  evidence.builds.candidate.operationsPerCycle.replaySeeks = 2;
  const rejected = evaluateQualificationMetrics({
    baseline: capture(),
    candidate: capture(undefined, '2'),
    sampledHeapEvidence: evidence,
  });
  assert.equal(rejected.metrics.sampledPeakHeap.status, 'failed');
});

test('sampled-heap source durations may differ, but both declared series must cover the six measured cycles', () => {
  const evidence = heapEvidence();
  evidence.builds.candidate.actualDurationMs += 1500;
  const accepted = evaluateQualificationMetrics({
    baseline: capture(),
    candidate: capture(undefined, '2'),
    sampledHeapEvidence: evidence,
  });
  assert.equal(accepted.metrics.sampledPeakHeap.status, 'measured');
  evidence.builds.candidate.samples = evidence.builds.candidate.samples.filter(
    (sample) => sample.cycle !== 4,
  );
  const dropped = evaluateQualificationMetrics({
    baseline: capture(),
    candidate: capture(undefined, '2'),
    sampledHeapEvidence: evidence,
  });
  assert.equal(dropped.metrics.sampledPeakHeap.status, 'failed');
});

test('sampled peak regression fails independently of the preserved retention soak result', () => {
  const evidence = heapEvidence();
  evidence.builds.candidate.samples.forEach((sample) => {
    sample.heapUsedBytes *= 1.2;
  });
  const result = evaluateQualificationMetrics({
    baseline: capture(),
    candidate: capture(undefined, '2'),
    sampledHeapEvidence: evidence,
  });
  assert.equal(result.metrics.sampledPeakHeap.status, 'failed');
  assert.equal(result.metrics.sampledPeakHeap.regressionOver10Pct, true);
  assert.equal(result.metrics.sampledPeakHeap.sourceSoakStatus, null);
});

test('cold startup keeps app-ready and loading-hidden checks separate and fails either over-ten-percent regression', () => {
  const base = capture();
  const candidate = capture(undefined, '2');
  candidate.environment.startup.runs.forEach((run) => {
    run.initialSettleMs *= 1.11;
  });
  const result = evaluateQualificationMetrics({ baseline: base, candidate });
  assert.equal(result.metrics.coldStartup.regressionOver10Pct, false);
  assert.equal(
    result.metrics.coldStartup.initialSettleRegressionOver10Pct,
    true,
  );
  assert.equal(result.metrics.coldStartup.status, 'failed');
});

test('qualification replay fixture contract matches persisted correction rows and coverage', async (t) => {
  let now = 0;
  const baseStorage = createWorkspaceStorage({
    indexedDB: null,
    crypto: webcrypto,
  });
  const storage = { ...baseStorage };
  Object.defineProperty(storage, 'savedByBrowser', { get: () => true });
  const recording = createAircraftRecordingService({
    storage,
    now: () => now,
    setInterval: () => 1,
    clearInterval: () => {},
  });
  t.after(() => {
    recording.destroy();
    baseStorage.destroy();
  });

  await recording.start({
    id: QUALIFICATION_REPLAY_FIXTURE_CONTRACT.recordingId,
    sourceId: 'synthetic-fixture',
    region: { center: { latitude: 0, longitude: 179.7 }, radiusKm: 25 },
  });
  const frames = createSyntheticAircraftFrames({
    startAt: 0,
    sampleCount: QUALIFICATION_REPLAY_FIXTURE_CONTRACT.snapshotCount,
    intervalMs: 1000,
  });
  for (const frame of frames) {
    now = frame.receivedAt;
    await recording.ingest(frame);
  }
  await recording.stop('fixture-ready');

  const replay = createRecordedAircraftSource({ storage });
  const selected = await replay.selectRecording(
    QUALIFICATION_REPLAY_FIXTURE_CONTRACT.recordingId,
  );
  assert.equal(selected.status, 'selected');
  const state = replay.getState();
  assertQualificationReplayFixtureState(
    state,
    QUALIFICATION_REPLAY_FIXTURE_CONTRACT,
  );
  assert.equal(state.recordCount, 5);
  assert.equal(
    state.coverage.to - state.coverage.from,
    (frames.length - 1) * 1000,
  );
  const firstReplaySnapshot = await replay.getSnapshot();
  assert.equal(firstReplaySnapshot.records.length, 1);
  assert.equal(
    firstReplaySnapshot.records[0].positionTimeMs,
    state.coverage.from,
  );

  const exported = await recording.exportRecording(
    QUALIFICATION_REPLAY_FIXTURE_CONTRACT.recordingId,
  );
  const persistedRows = Object.entries(exported.chunks)
    .filter(([name]) => name.startsWith('observations-'))
    .flatMap(([, rows]) => rows);
  assert.equal(persistedRows.length, 5);
  assert.equal(persistedRows.filter((row) => row.correctionOf).length, 1);

  assert.throws(
    () =>
      assertQualificationReplayFixtureState(
        { ...state, recordCount: 4 },
        QUALIFICATION_REPLAY_FIXTURE_CONTRACT,
      ),
    { actual: 4, expected: 5 },
  );
  assert.throws(
    () =>
      assertQualificationReplayFixtureState(
        { ...state, recordingId: 'other-recording' },
        QUALIFICATION_REPLAY_FIXTURE_CONTRACT,
      ),
    { actual: 'other-recording', expected: 'recording-rendered-soak' },
  );
  assert.throws(
    () =>
      assertQualificationReplayFixtureState(
        {
          ...state,
          coverage: { ...state.coverage, to: state.coverage.to + 1000 },
        },
        QUALIFICATION_REPLAY_FIXTURE_CONTRACT,
      ),
    { actual: 4000, expected: 3000 },
  );
});
