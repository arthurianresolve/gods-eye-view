import test from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluateQualificationMetrics,
  QUALIFICATION_METRIC_THRESHOLDS,
  readStartupObservation,
} from './qualificationMetrics.mjs';
import {
  buildQualificationIdentity,
  disposeQualificationObserver,
  installInteractionObserverInPage,
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

const samples = (stateMs, frameMs, prefix) =>
  Array.from({ length: 20 }, (_, index) => ({
    sampleId: `${prefix}-${index + 1}`,
    inputAtMs: index * 1000,
    inputEventAtMs: index * 1000,
    stateAtMs: index * 1000 + stateMs,
    renderedFrameAtMs: index * 1000 + frameMs,
    stateObserved: true,
    renderedFrameObserved: true,
    renderWitnessType: 'requested-post-state-render',
    visibilityState: 'visible',
    focused: true,
    frameNumberAtState: index * 2 + 1,
    frameNumberAtRendered: index * 2 + 2,
  }));

function interactionEvidence(overrides = {}) {
  const base = {
    schema: 'gev-interaction-latency-evidence/v1',
    status: 'completed',
    pairing: { fixtureSha256: ID.fixtureSha256, routeId: ID.routeId },
    builds: {
      baseline: {
        status: 'completed',
        interactionStatus: 'completed',
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
        localControl: samples(10, 30, 'b-local').map((sample, index) => ({
          ...sample,
          expectedLayerEnabled: index % 2 === 0,
          layerEnabledObserved: index % 2 === 0,
          layerVisibleObserved: index % 2 === 0,
          layerRenderablesObserved: index % 2 === 0,
          loadedRecordCount: index % 2 === 0 ? 4 : 0,
          renderableCount: index % 2 === 0 ? 4 : 0,
        })),
        loadedReplaySeek: samples(20, 80, 'b-replay').map((sample, index) => ({
          ...sample,
          selectedSourceMode: 'recorded',
          recordingId: 'recording-rendered-soak',
          fixtureRecordCount: 4,
          fixtureAircraftId: 'SYNTH-001',
          coverageFromMs: 1000,
          coverageToMs: 4000,
          expectedFixtureIndex: index % 2 ? 0 : 3,
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
          billboardScreenPosition: { x: 100, y: 100 },
          billboardCanvas: { width: 1440, height: 1000 },
        })),
      },
      candidate: {
        status: 'completed',
        interactionStatus: 'completed',
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
        localControl: samples(10, 30, 'c-local').map((sample, index) => ({
          ...sample,
          expectedLayerEnabled: index % 2 === 0,
          layerEnabledObserved: index % 2 === 0,
          layerVisibleObserved: index % 2 === 0,
          layerRenderablesObserved: index % 2 === 0,
          loadedRecordCount: index % 2 === 0 ? 4 : 0,
          renderableCount: index % 2 === 0 ? 4 : 0,
        })),
        loadedReplaySeek: samples(20, 80, 'c-replay').map((sample, index) => ({
          ...sample,
          selectedSourceMode: 'recorded',
          recordingId: 'recording-rendered-soak',
          fixtureRecordCount: 4,
          fixtureAircraftId: 'SYNTH-001',
          coverageFromMs: 1000,
          coverageToMs: 4000,
          expectedFixtureIndex: index % 2 ? 0 : 3,
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
      e.builds.candidate.loadedReplaySeek[0].frameNumberAtRendered =
        e.builds.candidate.loadedReplaySeek[0].frameNumberAtState;
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
      e.builds.candidate.loadedReplaySeek[0].billboardScreenPosition.x =
        e.builds.candidate.loadedReplaySeek[0].billboardCanvas.width;
    },
    (e) => {
      e.builds.candidate.localControl[0].inputEventAtMs = -100;
    },
    (e) => {
      e.builds.candidate.localControl[0].renderableCount = 0;
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

test('settled interaction requests and measures a fresh post-state render', async () => {
  let renderListener;
  let renderRequests = 0;
  const controls = new Map();
  const control = () => ({
    listeners: new Map(),
    addEventListener(name, listener) {
      this.listeners.set(name, listener);
    },
    removeEventListener(name) {
      this.listeners.delete(name);
    },
  });
  controls.set('[data-layer-id="local-datacenters"] .data-toggle-btn', {
    ...control(),
    classList: { contains: (name) => name === 'active' },
  });
  controls.set('.investigation-timeline-slider-control', control());
  const scene = {
    requestRenderMode: true,
    frameState: { frameNumber: 50 },
    requestRender() {
      renderRequests++;
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
        isEnabled: () => true,
        layers: new Map([
          [
            'local-datacenters',
            {
              module: {
                getAnalystRecords: () => [{ id: 'dc-1' }],
                getLodDiagnostics: () => ({ computed: true, active: 1 }),
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
    setInterval: () => 1,
    clearInterval() {},
  });
  try {
    installInteractionObserverInPage();
    const observer = globalWindow.__qualificationMetricsObserver;
    await observer.pollState();
    assert.equal(observer.pending, null);
    assert.equal(observer.records.length, 0);
    assert.equal(renderRequests, 0);
    observer.arm('localControl', true);
    observer.pending.inputAtMs = performance.now();
    await observer.pollState();

    assert.equal(renderRequests, 1);
    assert.equal(
      observer.pending.renderWitnessType,
      'requested-post-state-render',
    );
    assert.equal(observer.pending.frameNumberAtState, 50);
    assert.equal(observer.records.length, 0);

    scene.frameState.frameNumber = 51;
    renderListener();
    const record = observer.take();
    assert.equal(record.frameNumberAtRendered, 51);
    assert.equal(
      record.frameNumberAtRendered > record.frameNumberAtState,
      true,
    );
    assert.equal(record.renderWitnessType, 'requested-post-state-render');
    observer.dispose();
  } finally {
    globalWindow.__qualificationMetricsObserver?.dispose();
    restoreGlobals();
  }
});

test('replay witness rejects source-only, offscreen and mismatched rendered aircraft', () => {
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
          postRender: { addEventListener: () => () => {} },
          requestRender() {},
        },
      },
    },
  };
  globalThis.document = { querySelector: () => node };
  try {
    installInteractionObserverInPage();
    const observer = globalThis.window.__qualificationMetricsObserver;
    const selectedRecord = {
      id: 'SYNTH-001',
      positionTimeMs: 1000,
      latitude: 0,
      longitude: 179.7,
    };
    const renderedRecord = {
      icao24: 'SYNTH-001',
      provenance: { positionObservedAtMs: 1000 },
      lat: 0,
      lon: 179.7,
    };
    const visualWitness = {
      billboardId: 'SYNTH-001',
      billboardVisible: true,
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
      observer.isReplayVisualWitness({ selectedRecord, renderedRecord }),
      false,
      'source records without a visible rendered billboard are rejected',
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
        renderedRecord: { ...renderedRecord, lon: 178 },
        visualWitness,
      }),
      false,
      'rendered layer coordinates must match the selected source time',
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

test('a replay snapshot resolving after observer disposal cannot revive a sample', async () => {
  let resolveSnapshot;
  let markSnapshotStarted;
  let renderRequests = 0;
  const snapshotStarted = new Promise((resolve) => {
    markSnapshotStarted = resolve;
  });
  const snapshot = new Promise((resolve) => {
    resolveSnapshot = resolve;
  });
  const scene = {
    frameState: { frameNumber: 70 },
    requestRender() {
      renderRequests++;
    },
    postRender: { addEventListener: () => () => {} },
  };
  const controlNode = () => ({
    addEventListener() {},
    removeEventListener() {},
  });
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
          recordCount: 4,
          targetMs: 4000,
          coverage: { from: 1000, to: 4000 },
        }),
        getSnapshot() {
          markSnapshotStarted();
          return snapshot;
        },
      },
    },
  };
  const restoreGlobals = replacePageGlobals({
    window: globalWindow,
    document: { querySelector: (selector) => controls.get(selector) || null },
    setInterval: () => 2,
    clearInterval() {},
  });
  try {
    installInteractionObserverInPage();
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
    const inFlightPoll = observer.pollState();
    await snapshotStarted;
    await disposeQualificationObserver({ evaluate: (fn) => fn() });
    resolveSnapshot({
      records: [
        {
          id: 'SYNTH-001',
          latitude: Math.sin(0.3) * 0.02,
          longitude: 179.73,
          positionTimeMs: 4000,
        },
      ],
    });
    await inFlightPoll;
    assert.equal(globalWindow.__qualificationMetricsObserver, undefined);
    assert.equal(observer.pending, null);
    assert.equal(observer.records.length, 0);
    assert.equal(renderRequests, 0);
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
