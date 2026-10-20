import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, webcrypto } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { createWorkspaceStorage } from '../../src/storage/index.js';
import {
  createAircraftRecordingService,
  createRecordedAircraftSource,
  createSyntheticAircraftFrames,
} from '../../src/recording/index.js';
import {
  evaluateQualificationMetrics,
  QUALIFICATION_METRIC_THRESHOLDS,
  QUALIFICATION_NATIVE_WINDOW_ENVIRONMENT_SCHEMA,
  QUALIFICATION_NATIVE_WINDOW_MODE,
  QUALIFICATION_NATIVE_WINDOW_HELPER_SHA256,
  assertQualificationNativeWindowIdentity,
  readStartupObservation,
} from './qualificationMetrics.mjs';
import {
  buildQualificationIdentity,
  assertQualificationReplayFixtureState,
  disposeQualificationObserver,
  installInteractionObserverInPage,
  QUALIFICATION_REPLAY_FIXTURE_CONTRACT,
  applyUnmeasuredCameraPoseInPage,
  readEffectiveMeasurementStateInPage,
  readAndAssertPageForeground,
  collectQualificationMetricsForBuild,
} from '../qa-qualification-metrics-capture.mjs';
import { INTERACTION_EVENT_TIMING_PLAN } from './interactionEventTiming.mjs';
import {
  createQualificationBuildIdentityPlan,
  inspectQualificationBuildIdentityPlan,
  assertQualificationLiveBuildIdentity,
  createQualificationBuildIdentityEvidence,
  qualificationBuildExpectedIdentity,
  qualificationBuildIdentityEvidenceReference,
} from './qualificationBuildIdentity.mjs';

test('heap sampler keeps the final measured cycle while awaiting end-state verification', async () => {
  const source = readFileSync(
    new URL('../qa-qualification-metrics-capture.mjs', import.meta.url),
    'utf8',
  );
  const start = source.indexOf('      let measuredCycle = 0;');
  const endMarker = '      samplerPromise = null;';
  const end = source.indexOf(endMarker, start);
  assert.ok(start > 0 && end > start);
  const producerBlock = source.slice(start, end + endMarker.length);

  let releaseMetrics;
  const metricsPending = new Promise((resolve) => {
    releaseMetrics = resolve;
  });
  let sampleRecorded;
  const finalSamplePending = new Promise((resolve) => {
    sampleRecorded = resolve;
  });
  let samplerWake;
  const heapSamples = [];
  heapSamples.push = (...samples) => {
    const length = Array.prototype.push.apply(heapSamples, samples);
    sampleRecorded();
    return length;
  };
  const completedCycleOperations = [];
  const identity = { settings: {}, nativeSharpnessProfile: {} };
  const readEndState = () => {};
  const driver = {
    nativeResolution: {},
    metrics: () => metricsPending,
    runCycle: async () => ({}),
  };
  const page = {
    evaluate: async (reader) => {
      if (reader === readEndState) {
        // Resolve an already in-flight sample only after all six cycles end.
        releaseMetrics({
          JSHeapUsedSize: 123456,
          consoleHandleOwnership: {},
        });
        await finalSamplePending;
        return { settings: {}, nativeSharpnessProfile: {} };
      }
      return { visibilityState: 'visible', focused: true };
    },
  };
  const result = await runInNewContext(
    `(async () => {
      let sampling, samplerPromise;
      ${producerBlock}
      return { sampleErrors };
    })()`,
    {
      assert,
      driver,
      page,
      heapSamples,
      completedCycleOperations,
      identity,
      role: 'baseline',
      readEffectiveMeasurementStateInPage: readEndState,
      assertCycleOperations: () => {},
      foregroundObservations: [],
      consoleHandleOwnership: [],
      SAMPLE_MAX_GAP_MS: 5000,
      SAMPLE_CADENCE_MS: 1000,
      nativeWindowViewport: false,
      buildIdentityContext: null,
      performance: { now: () => 1 },
      setTimeout(callback, delay) {
        if (delay === 1000) {
          samplerWake = callback;
          return;
        }
        assert.equal(delay, 25);
        queueMicrotask(() => {
          callback();
          queueMicrotask(() => samplerWake());
        });
      },
    },
  );
  assert.deepEqual(Array.from(result.sampleErrors), []);
  assert.deepEqual(
    completedCycleOperations.map(({ cycle }) => cycle),
    [1, 2, 3, 4, 5, 6],
  );
  assert.deepEqual(
    Array.from(heapSamples, ({ cycle }) => cycle),
    [6],
    'A late sample belongs to the last completed cycle, never loop sentinel 7',
  );
});

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

function nativeWindowIdentity(commit) {
  const actual = identity(commit);
  actual.viewport = { width: 1280, height: 537, dpr: 2 };
  actual.drawingBuffer = { width: 2560, height: 1074 };
  actual.nativeSharpnessProfile = {
    ...actual.nativeSharpnessProfile,
    viewport: actual.viewport,
    drawingBuffer: actual.drawingBuffer,
  };
  actual.nativeSharpnessProfileAfter = structuredClone(
    actual.nativeSharpnessProfile,
  );
  actual.measurementEnvironment = QUALIFICATION_NATIVE_WINDOW_MODE;
  const rect = (left, top, width, height) => ({
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
  });
  const browserPid = Number(commit) * 100 + 42;
  let ordinal = 0;
  const boundary = () => ({
    schema: 'gev-native-window-viewport/v1',
    browserPid,
    ordinal: ++ordinal,
    observedAtUtc: new Date(Date.UTC(2026, 9, 20, 0, 0, ordinal)).toISOString(),
    observedDprBeforeConfiguration: 2,
    metricsEmulation: 'cleared-before-navigation',
    puppeteerViewport: null,
    cdpBoundsMapping: 'native-DIPs:windowRect',
    page: {
      devicePixelRatio: 2,
      inner: { width: 1280, height: 537 },
      outer: { width: 1280, height: 680 },
      screenPosition: { x: 0, y: 0 },
      screen: {
        width: 1280,
        height: 720,
        availLeft: 0,
        availTop: 0,
        availWidth: 1280,
        availHeight: 680,
        colorDepth: 24,
        pixelDepth: 24,
      },
      visualViewport: {
        width: 1280,
        height: 537,
        scale: 1,
        offsetLeft: 0,
        offsetTop: 0,
        pageLeft: 0,
        pageTop: 0,
      },
      documentClient: { width: 1280, height: 537 },
      scroll: { x: 0, y: 0 },
      visibilityState: 'visible',
      focused: true,
      nativeResolution: {
        devicePixelRatio: 2,
        canvas: {
          clientWidth: 1280,
          clientHeight: 537,
          width: 2560,
          height: 1074,
        },
        sceneDrawingBuffer: { width: 2560, height: 1074 },
        resolutionScale: 1,
        useBrowserRecommendedResolution: false,
        maximumScreenSpaceError: 1,
      },
      canvasRect: rect(0, 0, 1280, 537),
    },
    host: {
      schema: 'gev-owned-windows-window-geometry/v1',
      browserPid,
      ownerPid: browserPid,
      windowHandle: String(browserPid),
      ownedWindowCount: 1,
      physicalPixelReadContext: 'per-monitor-aware-v2',
      targetDpiAwareness: 2,
      dpi: 192,
      visible: true,
      minimized: false,
      maximized: true,
      foreground: true,
      windowRect: rect(-13, -13, 2586, 1386),
      clientRect: rect(0, 0, 2560, 1360),
      visibleFrameRect: rect(0, 0, 2560, 1360),
      monitor: {
        device: 'fixture-display',
        bounds: rect(0, 0, 2560, 1440),
        workArea: rect(0, 0, 2560, 1360),
        displayMode: {
          width: 2560,
          height: 1440,
          refreshHz: 60,
          bitsPerPixel: 32,
          orientation: 0,
          positionX: 0,
          positionY: 0,
          adapter: 'Fixture GPU',
        },
      },
    },
    cdp: {
      windowId: browserPid,
      windowBounds: {
        left: -7,
        top: -7,
        width: 1294,
        height: 694,
        windowState: 'maximized',
      },
      layoutMetrics: {
        cssLayoutViewport: {
          pageX: 0,
          pageY: 0,
          clientWidth: 1280,
          clientHeight: 537,
        },
        cssVisualViewport: {
          offsetX: 0,
          offsetY: 0,
          pageX: 0,
          pageY: 0,
          clientWidth: 1280,
          clientHeight: 537,
          scale: 1,
          zoom: 1,
        },
        cssContentSize: { x: 0, y: 0, width: 1280, height: 537 },
      },
    },
  });
  const configurationAttempts = [boundary(), boundary()];
  for (const evidence of configurationAttempts) {
    evidence.page.nativeResolution = null;
    evidence.page.canvasRect = null;
  }
  const configured = structuredClone(configurationAttempts[1]);
  configured.preparation = {
    schema: 'gev-native-window-preparation/v1',
    status: 'passed',
    maximumAttempts: 40,
    timeoutMs: 15_000,
    cleanupTimeoutMs: 1000,
    deadlineScope: 'after-owned-CDP-session-ready-before-navigation',
    intervalMs: 50,
    requiredConsecutiveCoherentProofs: 2,
    elapsedMs: 1,
    acceptedAttempt: 2,
    attempts: configurationAttempts.map((evidence, index) => ({
      attempt: index + 1,
      status: 'coherent',
      matchesPrevious: index === 1,
      evidence,
    })),
  };
  actual.nativeWindowViewport = {
    configured,
    startup: boundary(),
    freshDocumentRestore: boundary(),
    before: boundary(),
    restores: Array.from({ length: 8 }, (_, index) => ({
      phase: index < 2 ? 'warmup' : 'measured',
      cycle: index < 2 ? index + 1 : index - 1,
      latestWorkspaceRestore: boundary(),
    })),
    after: boundary(),
  };
  return actual;
}

function useNativeWindowEnvironment(evidence) {
  for (const [role, commit] of [
    ['baseline', '1'],
    ['candidate', '2'],
  ]) {
    evidence.builds[role].identity = nativeWindowIdentity(commit);
    for (const sample of evidence.builds[role].loadedReplaySeek || [])
      sample.billboardCanvas = { width: 1280, height: 537 };
  }
  evidence.measurementEnvironment = {
    schema: QUALIFICATION_NATIVE_WINDOW_ENVIRONMENT_SCHEMA,
    mode: QUALIFICATION_NATIVE_WINDOW_MODE,
    helperSha256: QUALIFICATION_NATIVE_WINDOW_HELPER_SHA256,
    viewport: { width: 1280, height: 537, dpr: 2 },
    drawingBuffer: { width: 2560, height: 1074 },
  };
  return evidence;
}

function directIdentityMetricEvidence() {
  const interactionEvidence = useNativeWindowEnvironment(
    eventTimingInteractionEvidence(),
  );
  const sampledHeapEvidence = useNativeWindowEnvironment(heapEvidence());
  const hash = (value) => createHash('sha256').update(value).digest('hex');
  const userAgent =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36';
  const renderer = 'ANGLE (Intel, Intel UHD Graphics 620, D3D11)';
  const application = { baseline: '1'.repeat(40), candidate: '2'.repeat(40) };
  const harness = '3'.repeat(40);
  const receipts = {},
    builds = {};
  for (const role of ['baseline', 'candidate']) {
    const identity = interactionEvidence.builds[role].identity;
    identity.userAgent = userAgent;
    identity.renderer = renderer;
    Object.assign(identity.settings, {
      bloom: identity.settings.visual.bloomEnabled,
      bloomIntensity: identity.settings.visual.bloomIntensity,
      sharpen: identity.settings.visual.sharpenEnabled,
      sharpenIntensity: identity.settings.visual.sharpenIntensity,
    });
    identity.settingsAfter = structuredClone(identity.settings);
    sampledHeapEvidence.builds[role].identity = structuredClone(identity);
    const receipt = {
      schema: 'gev-build-provenance/v1',
      scope:
        'unsigned local source-build receipt; not a hardware or release attestation',
      source: { commit: application[role], worktree: 'clean' },
      harness: { commit: harness, worktree: 'clean' },
      buildRecipe: {},
      assetCount: 1,
      totalAssetBytes: 13,
      assets: [
        { path: 'index.html', bytes: 13, sha256: hash('<main></main>') },
      ],
    };
    receipts[role] = {
      ...receipt,
      receiptSha256: hash(JSON.stringify(receipt)),
    };
    builds[role] = {
      checkout: `/fixture/${role}`,
      root: `/fixture/${role}-build`,
      receipt: `/fixture/${role}-receipt.json`,
      receiptFileSha256: hash(JSON.stringify(receipts[role])),
      receiptSha256: receipts[role].receiptSha256,
      baseUrl: `http://127.0.0.1:${role === 'baseline' ? 4316 : 4315}/`,
      profile: 'standard',
    };
  }
  const plan = createQualificationBuildIdentityPlan({
    createdAt: '2026-10-20T00:00:00.000Z',
    application,
    buildHarness: { commit: harness, checkout: '/fixture/harness' },
    browser: {
      executable: '/fixture/chrome.exe',
      executableSha256: 'c'.repeat(64),
      product: ID.browserVersion,
      userAgent,
      platform: 'Win32',
      renderer,
    },
    measurementEnvironment: QUALIFICATION_NATIVE_WINDOW_MODE,
    nativeDpr: 2,
    settings: interactionEvidence.builds.baseline.identity.settings,
    builds,
  });
  const planBytes = Buffer.from(JSON.stringify(plan));
  const context = inspectQualificationBuildIdentityPlan(planBytes, {
    expectedPlanSha256: hash(planBytes),
  });
  const boundaries = {},
    live = {};
  for (const role of ['baseline', 'candidate']) {
    boundaries[role] = {};
    live[role] = {};
    for (const phase of ['before', 'after']) {
      const at =
        phase === 'before'
          ? '2026-10-20T00:00:01.000Z'
          : '2026-10-20T00:00:16.000Z';
      boundaries[role][phase] = {
        schema: 'gev-qualification-build-identity-verification/v1',
        kind: plan.kind,
        scope: plan.scope,
        comparisonEligible: false,
        coldStartupEligible: false,
        performanceEligible: false,
        planSha256: context.planSha256,
        role,
        phase,
        applicationCommit: application[role],
        startedAt: at,
        completedAt: at,
        browserExecutableSha256: plan.browser.executableSha256,
        receiptFileSha256: builds[role].receiptFileSha256,
        receipt: receipts[role],
        served: {
          schema: 'gev-served-assets-verification/v1',
          status: 'served-assets-match',
          receiptSha256: receipts[role].receiptSha256,
          assetCount: 1,
          totalAssetBytes: 13,
        },
      };
      const identity = interactionEvidence.builds[role].identity;
      const actual = Object.fromEntries(
        [
          'applicationCommit',
          'browserVersion',
          'renderer',
          'userAgent',
          'platform',
          'viewport',
          'drawingBuffer',
          'nativeSharpnessProfile',
          'settings',
        ].map((key) => [key, identity[key]]),
      );
      const nativeWindowEvidence = identity.nativeWindowViewport[phase];
      live[role][phase] = assertQualificationLiveBuildIdentity(context, role, {
        actual,
        browserVersion: { product: plan.browser.product, userAgent },
        browserProcess: {
          pid: nativeWindowEvidence.browserPid,
          executable: plan.browser.executable,
        },
        nativeWindowEvidence,
      });
    }
  }
  const buildIdentityEvidence = createQualificationBuildIdentityEvidence(
    context,
    {
      boundaries,
      live,
      captureSpan: {
        startedAt: '2026-10-20T00:00:02.500Z',
        completedAt: '2026-10-20T00:00:15.000Z',
      },
    },
  );
  const reference = qualificationBuildIdentityEvidenceReference(
    buildIdentityEvidence,
  );
  interactionEvidence.sourceIdentity = reference;
  sampledHeapEvidence.sourceIdentity = structuredClone(reference);
  return {
    context,
    buildIdentityEvidence,
    interactionEvidence,
    sampledHeapEvidence,
  };
}

test('direct build identity validates native timing and heap without supplying startup or performance captures', () => {
  const fixture = directIdentityMetricEvidence();
  const args = { ...fixture };
  delete args.context;
  const result = evaluateQualificationMetrics(args);
  for (const name of ['localControl', 'loadedReplaySeek', 'sampledPeakHeap'])
    assert.equal(
      result.metrics[name].status,
      'measured',
      result.metrics[name].reason,
    );
  assert.equal(result.metrics.coldStartup.status, 'unavailable');
  assert.match(result.metrics.coldStartup.reason, /no cold-startup/);
  assert.equal(result.acceptanceEligible, false);
  assert.equal(result.status, 'pending');
  assert.equal(
    result.metrics.localControl.candidate.clickToNextRenderingP95Ms,
    64,
  );
  assert.equal(
    result.metrics.localControl.baseline.clickToNextRenderingP95Ms,
    136,
  );
  assert.equal(fixture.buildIdentityEvidence.performanceEligible, false);
  const slow = structuredClone(args);
  for (const entry of slow.interactionEvidence.builds.candidate
    .eventTimingCapture.entries)
    entry.duration = 104;
  assert.equal(
    evaluateQualificationMetrics(slow).metrics.localControl.status,
    'failed',
  );
  const missing = structuredClone(args);
  missing.interactionEvidence.builds.candidate.eventTimingCapture.entries.pop();
  assert.notEqual(
    evaluateQualificationMetrics(missing).metrics.localControl.status,
    'measured',
  );
});

test('direct timing and heap require the complete exact envelope and its same owned browser', () => {
  const { context, ...args } = directIdentityMetricEvidence();
  for (const mutate of [
    (x) => {
      x.interactionEvidence.sourceIdentity.evidenceSha256 = '0'.repeat(64);
    },
    (x) => {
      delete x.interactionEvidence.sourceIdentity;
    },
    (x) => {
      x.interactionEvidence.builds.baseline.identity.nativeWindowViewport.before
        .ordinal++;
    },
    (x) => {
      x.interactionEvidence.builds.candidate.identity.applicationCommit =
        '1'.repeat(40);
    },
    (x) => {
      x.buildIdentityEvidence.live.candidate.after.browserProcess.pid++;
    },
    (x) => {
      delete x.buildIdentityEvidence.boundaries.baseline.after;
    },
    (x) => {
      x.baseline = capture();
      x.candidate = capture(undefined, '2');
    },
    (x) => {
      delete x.buildIdentityEvidence;
    },
  ]) {
    const value = structuredClone(args);
    mutate(value);
    assert.notEqual(
      evaluateQualificationMetrics(value).metrics.localControl.status,
      'measured',
    );
  }
  const wrongHeap = structuredClone(args);
  wrongHeap.sampledHeapEvidence.sourceIdentity.planSha256 = '0'.repeat(64);
  assert.notEqual(
    evaluateQualificationMetrics(wrongHeap).metrics.sampledPeakHeap.status,
    'measured',
  );
  const malformed = structuredClone(args);
  malformed.buildIdentityEvidence.comparisonEligible = true;
  assert.equal(
    evaluateQualificationMetrics(malformed).metrics.sampledPeakHeap.status,
    'failed',
  );
  assert.equal(context.plan.application.baseline, '1'.repeat(40));
});

test('direct producer launches the exact declared executable before any measurements', async () => {
  const { context } = directIdentityMetricEvidence();
  let calls = 0;
  const result = await collectQualificationMetricsForBuild({
    role: 'baseline',
    url: context.plan.builds.baseline.baseUrl,
    expected: qualificationBuildExpectedIdentity(context, 'baseline'),
    fixture: {},
    nativeWindowViewport: true,
    buildIdentityContext: context,
    createDriver: async (url, options) => {
      calls++;
      assert.equal(url, context.plan.builds.baseline.baseUrl);
      assert.equal(
        options.browserOptions.executablePath,
        context.plan.browser.executable,
      );
      assert.equal(options.browserOptions.headless, false);
      throw Object.assign(new Error('bounded fixture factory failure'), {
        browserClose: { closeCompleted: true, forcedProcessTermination: false },
      });
    },
  });
  assert.equal(calls, 1);
  assert.equal(result.status, 'failed');
  assert.equal(result.failureReason, 'bounded fixture factory failure');
  assert.deepEqual(result.localControl, []);
  assert.deepEqual(result.heapSamples, []);
});

test('native-window metrics keep the actual client extent and require complete owned proofs', () => {
  const expected = {
    ...identity('1'),
    sourceProfile: structuredClone(ID.sourceProfile),
  };
  const actual = nativeWindowIdentity('1');
  const built = buildQualificationIdentity(
    expected,
    actual,
    {},
    {
      nativeWindowViewport: actual.nativeWindowViewport,
    },
  );
  assert.deepEqual(built.viewport, { width: 1280, height: 537, dpr: 2 });
  assert.deepEqual(built.nativeSharpnessProfile, actual.nativeSharpnessProfile);
  assert.equal(expected.sourceProfile.viewport.height, 900);
  assert.equal(
    assertQualificationNativeWindowIdentity(built, 2),
    built.nativeWindowViewport,
  );
  assert.throws(() => buildQualificationIdentity(expected, actual));
  const interactionEvidence = useNativeWindowEnvironment(
    eventTimingInteractionEvidence(),
  );
  const sampledHeapEvidence = useNativeWindowEnvironment(heapEvidence());
  const result = evaluateQualificationMetrics({
    baseline: capture(),
    candidate: capture(undefined, '2'),
    interactionEvidence,
    sampledHeapEvidence,
  });
  for (const name of ['localControl', 'loadedReplaySeek', 'sampledPeakHeap']) {
    assert.equal(
      result.metrics[name].status,
      'measured',
      result.metrics[name].reason,
    );
    assert.deepEqual(
      result.metrics[name].measurementEnvironment.viewport,
      built.viewport,
    );
  }
  assert.equal(
    result.metrics.localControl.candidate.clickToNextRenderingP95Ms,
    64,
  );
  assert.equal(
    result.metrics.localControl.baseline.absoluteAcknowledgementFailures.length,
    1,
  );
});

test('native-window consumer rejects relabelled, stale, clipped, emulated and mismatched proofs', () => {
  const args = { baseline: capture(), candidate: capture(undefined, '2') };
  const pristine = useNativeWindowEnvironment(eventTimingInteractionEvidence());
  const mutations = [
    (e) => {
      delete e.measurementEnvironment;
    },
    (e) => {
      e.measurementEnvironment.schema = 'old-capture-relabel';
    },
    (e) => {
      e.measurementEnvironment.helperSha256 = '';
    },
    (e) => {
      e.measurementEnvironment.helperSha256 = 'f'.repeat(64);
    },
    (e) => {
      e.measurementEnvironment.viewport.height = 1000;
    },
    (e) => {
      delete e.builds.candidate.identity.measurementEnvironment;
    },
    (e) => {
      delete e.builds.candidate.identity.nativeWindowViewport;
    },
    (e) => {
      delete e.builds.candidate.identity.nativeWindowViewport.after;
    },
    (e) => {
      e.builds.candidate.identity.nativeWindowViewport.restores.pop();
    },
    (e) => {
      e.builds.candidate.identity.nativeWindowViewport.restores[2].cycle = 2;
    },
    (e) => {
      e.builds.candidate.identity.nativeWindowViewport.after.ordinal = 2;
    },
    (e) => {
      e.builds.candidate.identity.nativeWindowViewport.after.observedAtUtc =
        'invalid';
    },
    (e) => {
      e.builds.candidate.identity.nativeWindowViewport.before.browserPid++;
    },
    (e) => {
      e.builds.candidate.identity.nativeWindowViewport.after.puppeteerViewport =
        { width: 1280, height: 537 };
    },
    (e) => {
      e.builds.candidate.identity.nativeWindowViewport.after.host
        .visibleFrameRect.right++;
    },
    (e) => {
      e.builds.candidate.identity.nativeWindowViewport.after.cdp.layoutMetrics.cssVisualViewport.zoom = 1.25;
    },
    (e) => {
      e.builds.candidate.identity.nativeWindowViewport.after.observedDprBeforeConfiguration = 1;
    },
    (e) => {
      e.builds.candidate.identity.nativeWindowViewport.after.page.nativeResolution.resolutionScale = 0.5;
    },
    (e) => {
      e.builds.candidate.identity.nativeWindowViewport.restores[0].latestWorkspaceRestore.page.nativeResolution.maximumScreenSpaceError = 2;
    },
    (e) => {
      e.builds.candidate.identity.viewport.width++;
    },
    (e) => {
      e.builds.candidate.identity.settings.densityPct = 50;
    },
    (e) => {
      e.builds.candidate.identity.settingsAfter.visual.bloomEnabled = true;
    },
    (e) => {
      e.builds.candidate.datacenterFixtureReceipt.materializedFeatureCount = 7;
    },
    (e) => {
      e.builds.candidate.localControl.pop();
    },
    (e) => {
      for (const entry of e.builds.candidate.eventTimingCapture.entries)
        entry.duration = 104;
    },
  ];
  for (const [index, mutate] of mutations.entries()) {
    const evidence = structuredClone(pristine);
    mutate(evidence);
    const metric = evaluateQualificationMetrics({
      ...args,
      interactionEvidence: evidence,
    }).metrics.localControl;
    assert.notEqual(metric.status, 'measured', `negative ${index + 1}`);
  }
  const mixed = structuredClone(pristine);
  mixed.builds.candidate.identity = identity('2');
  assert.notEqual(
    evaluateQualificationMetrics({ ...args, interactionEvidence: mixed })
      .metrics.localControl.status,
    'measured',
  );
  const mismatchedMonitor = structuredClone(pristine);
  const candidateProof =
    mismatchedMonitor.builds.candidate.identity.nativeWindowViewport;
  for (const boundary of [
    candidateProof.configured,
    ...candidateProof.configured.preparation.attempts.map((a) => a.evidence),
    candidateProof.startup,
    candidateProof.freshDocumentRestore,
    candidateProof.before,
    candidateProof.after,
    ...candidateProof.restores.flatMap((r) => [r.latestWorkspaceRestore]),
  ])
    boundary.host.monitor.displayMode.adapter = 'Different native GPU';
  assert.notEqual(
    evaluateQualificationMetrics({
      ...args,
      interactionEvidence: mismatchedMonitor,
    }).metrics.localControl.status,
    'measured',
  );
  const replay = structuredClone(pristine);
  replay.builds.candidate.loadedReplaySeek[0].billboardCanvas.height = 1000;
  assert.notEqual(
    evaluateQualificationMetrics({ ...args, interactionEvidence: replay })
      .metrics.loadedReplaySeek.status,
    'measured',
  );
  const heap = useNativeWindowEnvironment(heapEvidence());
  heap.builds.candidate.identity.nativeWindowViewport.restores[7].latestWorkspaceRestore.host.foreground = false;
  assert.notEqual(
    evaluateQualificationMetrics({ ...args, sampledHeapEvidence: heap }).metrics
      .sampledPeakHeap.status,
    'measured',
  );
  const old = eventTimingInteractionEvidence();
  old.measurementEnvironment = pristine.measurementEnvironment;
  assert.notEqual(
    evaluateQualificationMetrics({ ...args, interactionEvidence: old }).metrics
      .localControl.status,
    'measured',
  );
});

test('native-window preparation failure retains OS/CDP evidence and factory cleanup without input', async () => {
  const failedProof = nativeWindowIdentity('1').nativeWindowViewport.before;
  const browserClose = {
    closeCompleted: true,
    forcedProcessTermination: false,
    exitCode: 0,
  };
  let calls = 0;
  const result = await collectQualificationMetricsForBuild({
    role: 'baseline',
    url: 'http://127.0.0.1:4312/',
    expected: identity('1'),
    fixture: {},
    nativeWindowViewport: true,
    createDriver: async (url, options) => {
      calls++;
      assert.equal(url, 'http://127.0.0.1:4312/');
      assert.equal(options.nativeResolution, true);
      assert.equal(options.nativeWindowViewport, true);
      assert.equal(options.prewarmApplication, false);
      assert.equal(options.browserOptions.headless, false);
      throw Object.assign(new Error('native preparation failed'), {
        nativeWindowViewport: failedProof,
        browserClose,
        cleanupError: new Error('retained cleanup diagnostic'),
      });
    },
  });
  assert.equal(calls, 1);
  assert.equal(result.status, 'failed');
  assert.equal(result.identity, null);
  assert.deepEqual(result.localControl, []);
  assert.deepEqual(result.heapSamples, []);
  assert.deepEqual(result.failedNativeWindowViewport, failedProof);
  assert.deepEqual(result.factoryBrowserClose, browserClose);
  assert.deepEqual(result.browserClose, browserClose);
  assert.equal(result.cleanupError, 'retained cleanup diagnostic');
});

test('native-window producer retains every configured preparation attempt before document and cycle restores', async () => {
  const source = readFileSync(
    new URL('../qa-qualification-metrics-capture.mjs', import.meta.url),
    'utf8',
  );
  const start = source.indexOf('function retainNativeWindowRestore(');
  const end = source.indexOf('\nfunction assertCycleOperations(', start);
  assert.ok(start > 0 && end > start);
  const retain = runInNewContext(
    `${source.slice(start, end)}; retainNativeWindowRestore`,
    { structuredClone },
  );
  const actual = nativeWindowIdentity('1');
  const original = structuredClone(actual.nativeWindowViewport);
  const driver = {
    nativeWindowViewport: {
      configured: structuredClone(original.configured),
      startup: structuredClone(original.startup),
      freshDocumentRestore: structuredClone(original.freshDocumentRestore),
      latestWorkspaceRestore: null,
    },
    captureNativeWindowEvidence: async (label) => {
      assert.equal(label, 'qualification-before');
      return structuredClone(original.before);
    },
  };
  const proofStart = source.indexOf(
    '    const nativeWindowProof = nativeWindowViewport',
  );
  const proofEnd = source.indexOf('\n    const identity =', proofStart);
  assert.ok(proofStart > 0 && proofEnd > proofStart);
  const collectProof = runInNewContext(
    `(async () => { ${source.slice(proofStart, proofEnd)}; return nativeWindowProof; })`,
    { nativeWindowViewport: true, driver, structuredClone },
  );
  actual.nativeWindowViewport = await collectProof();
  actual.nativeWindowViewport.after = structuredClone(original.after);
  assert.deepEqual(actual.nativeWindowViewport.configured, original.configured);
  driver.nativeWindowViewport.configured.preparation.attempts[0].evidence.page
    .inner.width--;
  assert.deepEqual(actual.nativeWindowViewport.configured, original.configured);
  for (const checkpoint of original.restores) {
    driver.nativeWindowViewport.latestWorkspaceRestore = structuredClone(
      checkpoint.latestWorkspaceRestore,
    );
    retain(
      driver,
      actual.nativeWindowViewport,
      checkpoint.phase,
      checkpoint.cycle,
    );
  }
  assert.deepEqual(
    JSON.parse(JSON.stringify(actual.nativeWindowViewport)),
    original,
  );
  driver.nativeWindowViewport.latestWorkspaceRestore.page.focused = false;
  assertQualificationNativeWindowIdentity(actual, 2);
  const stale = structuredClone(actual);
  stale.nativeWindowViewport.restores[1].latestWorkspaceRestore =
    structuredClone(
      stale.nativeWindowViewport.restores[0].latestWorkspaceRestore,
    );
  assert.throws(() => assertQualificationNativeWindowIdentity(stale, 2));
});

test('new native metrics require the complete accepted preparation trace without weakening legacy modes', () => {
  const mutations = [
    (p) => {
      delete p.configured;
    },
    (p) => {
      delete p.configured.preparation;
    },
    (p) => {
      p.configured.preparation.status = 'failed';
    },
    (p) => {
      p.configured.preparation.attempts.shift();
    },
    (p) => {
      p.configured.preparation.acceptedAttempt++;
    },
    (p) => {
      p.configured.preparation.attempts[0].matchesPrevious = true;
    },
    (p) => {
      p.configured.preparation.attempts[1].evidence.cdp.layoutMetrics
        .cssVisualViewport.clientWidth--;
    },
    (p) => {
      p.configured.preparation.attempts[0].evidence.browserPid++;
    },
    (p) => {
      p.configured.preparation.attempts[0].evidence.ordinal++;
    },
    (p) => {
      p.configured.preparation.attempts[0].evidence.observedAtUtc = 'invalid';
    },
    (p) => {
      p.configured.preparation.attempts[0].evidence.cdp.windowId++;
    },
    (p) => {
      p.configured.preparation.attempts[0].evidence.host.windowHandle =
        'foreign-window';
    },
    (p) => {
      p.configured.ordinal = p.startup.ordinal;
    },
    (p) => {
      p.configured.page.outer.height--;
    },
  ];
  assertQualificationNativeWindowIdentity(nativeWindowIdentity('1'), 2);
  for (const [index, mutate] of mutations.entries()) {
    const actual = nativeWindowIdentity('1');
    mutate(actual.nativeWindowViewport);
    assert.throws(
      () => assertQualificationNativeWindowIdentity(actual, 2),
      `preparation negative ${index + 1}`,
    );
  }
  assert.equal(
    evaluateQualificationMetrics({
      baseline: capture(),
      candidate: capture(undefined, '2'),
      interactionEvidence: eventTimingInteractionEvidence(),
    }).metrics.localControl.status,
    'measured',
  );
});

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

function clickInteractionEvidence({
  baselineStateMs = 50,
  baselineFrameMs = 80,
  candidateStateMs = 55,
  candidateFrameMs = 88,
  candidateIntentMs = 5,
  candidateFeedbackMs = 30,
} = {}) {
  const evidence = interactionEvidence();
  evidence.schema = 'gev-interaction-latency-evidence/v3';
  for (const role of ['baseline', 'candidate']) {
    const build = evidence.builds[role];
    build.interactionProtocol =
      'trusted-click-activation-prerender-postrender-witness-v5';
    build.localControl = build.localControl.map((sample, index) => {
      const clickAtMs = 1000 + index * 1000;
      const stateDuration =
        role === 'baseline' ? baselineStateMs : candidateStateMs;
      const frameDuration =
        role === 'baseline' ? baselineFrameMs : candidateFrameMs;
      const feedbackDuration = role === 'baseline' ? 25 : candidateFeedbackMs;
      return {
        ...sample,
        armedAtMs: clickAtMs - 3,
        pointerDownAtMs: clickAtMs - 3,
        pointerDownReceivedAtMs: clickAtMs - 2,
        pointerUpAtMs: clickAtMs - 1,
        pointerUpReceivedAtMs: clickAtMs,
        clickAtMs,
        clickReceivedAtMs: clickAtMs + 1,
        pointerDownToClickMs: 3,
        inputAtMs: clickAtMs,
        inputEventAtMs: clickAtMs,
        handlerReceivedAtMs: clickAtMs + 1,
        inputDeliveryDelayMs: 1,
        inputEventType: 'click',
        inputClockSource: 'trusted-click-event-timeStamp',
        acceptedIntentAtMs:
          clickAtMs + (role === 'baseline' ? 5 : candidateIntentMs),
        acceptedIntentEpoch: index + (role === 'candidate' ? 100 : 1),
        transitionAtMs:
          clickAtMs + (role === 'baseline' ? 5 : candidateIntentMs),
        transitionIntentEpoch: index + (role === 'candidate' ? 100 : 1),
        buttonFeedbackFirstFrameAtMs: clickAtMs + feedbackDuration - 16,
        buttonFeedbackFirstRafTimestampMs: clickAtMs + feedbackDuration - 16,
        buttonFeedbackSecondRafTimestampMs: clickAtMs + feedbackDuration,
        buttonFeedbackAtMs: clickAtMs + feedbackDuration,
        buttonFeedbackState: 'transition',
        buttonFeedbackIntentEpoch: index + (role === 'candidate' ? 100 : 1),
        buttonFeedbackTransitionAtMs:
          clickAtMs + (role === 'baseline' ? 5 : candidateIntentMs),
        buttonFeedbackWitnessType: 'visible-button-two-distinct-raf-v3',
        buttonFeedbackConsecutiveFrames: 2,
        stateAtMs: clickAtMs + stateDuration,
        renderedFrameAtMs: clickAtMs + frameDuration,
      };
    });
  }
  return evidence;
}

function eventTimingInteractionEvidence() {
  const evidence = clickInteractionEvidence();
  evidence.schema = 'gev-interaction-latency-evidence/v4';
  evidence.eventTimingPlan = INTERACTION_EVENT_TIMING_PLAN;
  evidence.eventTimingProducerSha256 = 'f'.repeat(64);
  for (const role of ['baseline', 'candidate']) {
    const build = evidence.builds[role];
    build.interactionProtocol =
      'trusted-click-event-timing-prerender-postrender-witness-v6';
    for (const [index, sample] of build.localControl.entries())
      for (const key of Object.keys(sample))
        if (/(AtMs|TimestampMs)$/.test(key) && typeof sample[key] === 'number')
          sample[key] += index * 2000;
    for (const sample of build.localControl)
      sample.buttonFeedbackFirstState = 'transition';
    build.eventTimingCapture = {
      ...INTERACTION_EVENT_TIMING_PLAN,
      status: 'observed',
      installedAtMs: 0,
      overflow: false,
      work: {
        mutationCallbacks: 20,
        mutationRecords: 100,
        continuityChecks: 40,
        geometryChecks: 40,
        overhead: { status: 'unavailable', reason: 'not-measured' },
      },
      actions: build.localControl.map((sample) => ({
        generation: sample.generation,
        clickAtMs: sample.clickAtMs,
        expected: sample.expectedLayerEnabled,
        targetMatched: true,
        trusted: true,
        visible: true,
        focused: true,
        witness: {
          atMs: sample.buttonFeedbackFirstFrameAtMs,
          completedAtMs: sample.buttonFeedbackFirstFrameAtMs + 1,
          rafTimestampMs: sample.buttonFeedbackFirstRafTimestampMs,
          intentEpoch: sample.acceptedIntentEpoch,
          expected: sample.expectedLayerEnabled,
          state: 'transition',
          generation: sample.generation,
          visible: true,
          focused: true,
        },
        drainStartedAtMs: sample.renderedFrameAtMs + 10,
        drainEndedAtMs: sample.renderedFrameAtMs + 1010,
      })),
      entries: build.localControl.map((sample, index) => ({
        name: 'click',
        entryType: 'event',
        startTime: sample.clickAtMs,
        duration: role === 'baseline' ? 136 : 64,
        processingStart: sample.clickAtMs + 0.5,
        processingEnd: sample.clickAtMs + 2,
        interactionId: (index + 1) * 7,
        deliveredAtMs: sample.clickAtMs + 200,
        targetMatched: true,
        generation: sample.generation,
      })),
      observations: [],
    };
    for (const [index, action] of build.eventTimingCapture.actions.entries()) {
      const sample = build.localControl[index];
      action.witnesses = [
        action.witness,
        {
          ...action.witness,
          atMs: sample.buttonFeedbackAtMs,
          completedAtMs: sample.buttonFeedbackAtMs + 1,
          rafTimestampMs: sample.buttonFeedbackSecondRafTimestampMs,
          state: sample.buttonFeedbackState,
        },
      ];
    }
  }
  return evidence;
}

test('v4 gates candidate Event Timing, preserves baseline absolute failure and v3 semantics', () => {
  const args = { baseline: capture(), candidate: capture(undefined, '2') };
  const evidence = eventTimingInteractionEvidence();
  const evaluate = (value) =>
    evaluateQualificationMetrics({
      ...args,
      interactionEvidence: value,
    }).metrics.localControl;
  const metric = evaluate(evidence);
  assert.equal(metric.status, 'measured', metric.reason);
  assert.equal(metric.candidate.clickToNextRenderingP95Ms, 64);
  assert.equal(metric.baseline.clickToNextRenderingP95Ms, 136);
  assert.equal(metric.baseline.absoluteAcknowledgementFailures.length, 1);
  assert.equal(metric.absoluteAcknowledgementGateAppliesTo, 'candidate');
  assert.equal(metric.candidate.diagnosticTwoRafFeedbackP95Ms, 30);
  const late = structuredClone(evidence);
  for (const entry of late.builds.candidate.eventTimingCapture.entries)
    entry.duration = 104;
  assert.equal(evaluate(late).status, 'failed');
  assert.match(evaluate(late).failures.join('; '), /next-rendering/);
  const missing = structuredClone(evidence);
  missing.builds.candidate.eventTimingCapture.entries.pop();
  assert.notEqual(evaluate(missing).status, 'measured');
  const slowerReady = structuredClone(evidence);
  for (const sample of slowerReady.builds.candidate.localControl)
    sample.renderedFrameAtMs += 20;
  for (const action of slowerReady.builds.candidate.eventTimingCapture
    .actions) {
    action.drainStartedAtMs += 20;
    action.drainEndedAtMs += 20;
  }
  assert.match(
    evaluate(slowerReady).failures.join('; '),
    /readiness regression/,
  );
  const legacy = clickInteractionEvidence();
  for (const sample of legacy.builds.baseline.localControl) {
    sample.buttonFeedbackFirstFrameAtMs += 100;
    sample.buttonFeedbackFirstRafTimestampMs += 100;
    sample.buttonFeedbackSecondRafTimestampMs += 100;
    sample.buttonFeedbackAtMs += 100;
  }
  assert.equal(evaluate(legacy).status, 'failed');
  assert.match(evaluate(legacy).failures.join('; '), /visible-feedback/);
  const relabelled = structuredClone(legacy);
  relabelled.schema = 'gev-interaction-latency-evidence/v4';
  assert.notEqual(evaluate(relabelled).status, 'measured');
});

test('v4 actual producer action awaits its owned drain after full readiness before returning', async () => {
  const source = readFileSync(
    new URL('../qa-qualification-metrics-capture.mjs', import.meta.url),
    'utf8',
  );
  const start = source.indexOf('async function collectInteraction(');
  const end = source.indexOf('\nasync function loadReplay(', start);
  assert.ok(start > 0 && end > start);
  const calls = [];
  let releaseDrain;
  const pendingDrain = new Promise((resolve) => {
    releaseDrain = resolve;
  });
  const sample = { generation: 17, renderedFrameAtMs: 80 };
  const window = {
    __qualificationMetricsObserver: {
      records: [sample],
      arm() {
        calls.push('armed');
      },
      take() {
        calls.push('full-ready');
        return sample;
      },
    },
    __qualificationEventTiming: {
      drain(generation) {
        assert.equal(generation, 17);
        calls.push('drain-start');
        return pendingDrain;
      },
    },
  };
  const page = {
    evaluate(fn, arg) {
      return runInNewContext(`(${fn.toString()})(arg)`, { window, arg });
    },
    async click() {
      calls.push('trusted-click');
    },
    async waitForFunction() {},
  };
  const collect = runInNewContext(
    `${source.slice(start, end)}; collectInteraction`,
    {
      INTERACTION_TIMEOUT_MS: 15000,
      readAndAssertPageForeground: async () => {
        calls.push('foreground-after-drain');
        return { focused: true, visibilityState: 'visible' };
      },
    },
  );
  let returned = false;
  const result = collect(page, 'localControl', true, 'one').then((value) => {
    returned = true;
    return value;
  });
  for (let i = 0; i < 12; i++) await Promise.resolve();
  assert.deepEqual(calls, [
    'armed',
    'trusted-click',
    'full-ready',
    'drain-start',
  ]);
  assert.equal(returned, false);
  releaseDrain();
  assert.equal((await result).sampleId, 'one');
  assert.equal(calls.at(-1), 'foreground-after-drain');
});

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

function dispatchLocalClick(node) {
  node.dispatch('pointerdown');
  node.dispatch('pointerup');
  node.dispatch('click');
}

function createRafHarness(now = () => performance.now()) {
  let nextId = 1;
  const callbacks = new Map();
  return {
    requestAnimationFrame(callback) {
      const id = nextId++;
      callbacks.set(id, callback);
      return id;
    },
    cancelAnimationFrame(id) {
      callbacks.delete(id);
    },
    flush(timestamp = now() + 16) {
      const entry = callbacks.entries().next().value;
      if (!entry) throw new Error('No animation frame is queued.');
      const [id, callback] = entry;
      callbacks.delete(id);
      callback(timestamp);
    },
    get pendingCount() {
      return callbacks.size;
    },
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

test('v3 local metrics separate quick acknowledgements from full scene readiness', () => {
  const args = {
    baseline: capture(),
    candidate: capture(undefined, '2'),
  };
  const evidence = clickInteractionEvidence();
  const result = evaluateQualificationMetrics({
    ...args,
    interactionEvidence: evidence,
  });
  const metric = result.metrics.localControl;
  assert.equal(metric.status, 'measured', metric.reason);
  assert.equal(metric.baseline.clickToAcceptedIntentP95Ms, 5);
  assert.equal(metric.candidate.clickToVisibleFeedbackP95Ms, 30);
  assert.equal(metric.baseline.clickToFullReadyStateP95Ms, 50);
  assert.equal(metric.baseline.pointerdownToFullReadyStateP95Ms, 53);
  assert.equal(metric.candidate.clickToFullRenderedReadinessP95Ms, 88);
  assert.equal(metric.candidate.pointerdownToFullReadyP95Ms, 91);

  const slowFeedback = clickInteractionEvidence({ candidateFeedbackMs: 101 });
  const slowFeedbackResult = evaluateQualificationMetrics({
    ...args,
    interactionEvidence: slowFeedback,
  });
  assert.equal(slowFeedbackResult.metrics.localControl.status, 'failed');
  assert.match(
    slowFeedbackResult.metrics.localControl.failures.join('; '),
    /visible-feedback.*100ms/,
  );

  const delayedIntent = clickInteractionEvidence({
    candidateStateMs: 150,
    candidateFrameMs: 180,
    candidateIntentMs: 101,
    candidateFeedbackMs: 110,
  });
  const delayedIntentResult = evaluateQualificationMetrics({
    ...args,
    interactionEvidence: delayedIntent,
  });
  assert.equal(delayedIntentResult.metrics.localControl.status, 'failed');
  assert.match(
    delayedIntentResult.metrics.localControl.failures.join('; '),
    /accepted-intent.*100ms/,
  );

  const lateVisualFeedback = clickInteractionEvidence({
    candidateFeedbackMs: 101,
  });
  const lateVisualFeedbackResult = evaluateQualificationMetrics({
    ...args,
    interactionEvidence: lateVisualFeedback,
  });
  assert.equal(lateVisualFeedbackResult.metrics.localControl.status, 'failed');
  assert.match(
    lateVisualFeedbackResult.metrics.localControl.failures.join('; '),
    /visible-feedback.*100ms/,
  );

  const settledVisualFeedback = clickInteractionEvidence();
  for (const role of ['baseline', 'candidate']) {
    for (const sample of settledVisualFeedback.builds[role].localControl) {
      sample.buttonFeedbackState = 'settled';
      sample.buttonFeedbackTransitionAtMs = null;
    }
  }
  assert.equal(
    evaluateQualificationMetrics({
      ...args,
      interactionEvidence: settledVisualFeedback,
    }).metrics.localControl.status,
    'measured',
    'a completed matching visible state remains a valid acknowledgement',
  );

  const staleTransition = clickInteractionEvidence();
  staleTransition.builds.candidate.localControl[0].transitionIntentEpoch++;
  const staleTransitionResult = evaluateQualificationMetrics({
    ...args,
    interactionEvidence: staleTransition,
  });
  assert.notEqual(
    staleTransitionResult.metrics.localControl.status,
    'measured',
  );

  const slowFullReady = clickInteractionEvidence({ candidateFrameMs: 89 });
  const slowFullReadyResult = evaluateQualificationMetrics({
    ...args,
    interactionEvidence: slowFullReady,
  });
  assert.equal(slowFullReadyResult.metrics.localControl.status, 'failed');
  assert.match(
    slowFullReadyResult.metrics.localControl.failures.join('; '),
    /full-rendered readiness regression exceeds 10%/,
  );

  const malformed = clickInteractionEvidence();
  delete malformed.builds.candidate.localControl[0].acceptedIntentAtMs;
  const malformedResult = evaluateQualificationMetrics({
    ...args,
    interactionEvidence: malformed,
  });
  assert.equal(malformedResult.metrics.localControl.status, 'failed');

  const reorderedPointer = clickInteractionEvidence();
  reorderedPointer.builds.candidate.localControl[0].pointerUpAtMs =
    reorderedPointer.builds.candidate.localControl[0].pointerDownAtMs - 1;
  const reorderedResult = evaluateQualificationMetrics({
    ...args,
    interactionEvidence: reorderedPointer,
  });
  assert.equal(reorderedResult.metrics.localControl.status, 'failed');

  const mixedProtocol = clickInteractionEvidence();
  mixedProtocol.builds.candidate.interactionProtocol =
    'trusted-event-timeStamp-prerender-postrender-witness-v4';
  const mixedProtocolResult = evaluateQualificationMetrics({
    ...args,
    interactionEvidence: mixedProtocol,
  });
  assert.equal(mixedProtocolResult.metrics.localControl.status, 'unavailable');
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
  let intentEpoch = 0;
  let layerEnabled = false;
  let buttonActive = false;
  let buttonVisualState = 'off';
  let lifecycleListener = null;
  const layerEntry = {
    visibilityIntentEpoch: 0,
    visibilityIntentEnabled: false,
    module: {
      getAnalystRecords: () => {
        throw new Error('local poll must not normalize analyst rows');
      },
      getLodDiagnostics: () => lod,
    },
  };
  const raf = createRafHarness();
  let lod = { computed: false, total: 0, active: 0 };
  const controls = new Map();
  controls.set(
    '[data-layer-id="local-datacenters"] .data-toggle-btn',
    inputControl({
      classList: {
        contains(name) {
          if (name === 'active') return buttonActive;
          if (name === 'transitioning')
            return ['enabling', 'disabling'].includes(buttonVisualState);
          if (name === 'enabling' || name === 'disabling')
            return name === buttonVisualState;
          return false;
        },
      },
      dataset: {
        get feedState() {
          return buttonVisualState;
        },
      },
      getAttribute(name) {
        if (name === 'aria-busy')
          return ['enabling', 'disabling'].includes(buttonVisualState)
            ? 'true'
            : 'false';
        if (name === 'aria-disabled')
          return ['enabling', 'disabling'].includes(buttonVisualState)
            ? 'true'
            : 'false';
        return null;
      },
      get textContent() {
        return {
          enabling: 'ENABLING',
          disabling: 'DISABLING',
          on: 'LOADING',
          off: 'OFF',
        }[buttonVisualState];
      },
      disabled: false,
      getBoundingClientRect: () => ({
        left: 10,
        top: 10,
        right: 30,
        bottom: 30,
        width: 20,
        height: 20,
      }),
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
    innerWidth: 800,
    innerHeight: 600,
    getComputedStyle: () => ({
      display: 'block',
      visibility: 'visible',
      opacity: '1',
    }),
    __godsEyeView: {
      viewer: { scene },
      dataManager: {
        isEnabled: () => layerEnabled,
        subscribe(listener) {
          lifecycleListener = listener;
          return () => {
            lifecycleListener = null;
          };
        },
        subscribeVisibilityRequests(listener) {
          this.visibilityListener = listener;
          return () => {
            this.visibilityListener = null;
          };
        },
        layers: new Map([['local-datacenters', layerEntry]]),
      },
    },
  };
  const eventTimingCalls = [];
  globalWindow.__qualificationEventTiming = {
    registerClick(sample, event) {
      eventTimingCalls.push({
        type: 'click',
        generation: sample.generation,
        atMs: event.timeStamp,
      });
    },
    witness(sample, timestamp, state, observedAtMs) {
      eventTimingCalls.push({
        type: 'witness',
        generation: sample.generation,
        timestamp,
        state,
        observedAtMs,
      });
    },
    dispose() {
      eventTimingCalls.push({ type: 'dispose' });
    },
  };
  const restoreGlobals = replacePageGlobals({
    window: globalWindow,
    document: {
      visibilityState: 'visible',
      hasFocus: () => true,
      querySelector: (selector) => controls.get(selector) || null,
    },
    requestAnimationFrame: raf.requestAnimationFrame,
    cancelAnimationFrame: raf.cancelAnimationFrame,
    setInterval: (callback) => {
      intervalCallback = callback;
      return 1;
    },
    clearInterval() {},
  });
  try {
    installInteractionObserverInPage({
      ...QUALIFICATION_REPLAY_FIXTURE_CONTRACT,
      interactionProtocolVersion: 4,
    });
    const observer = globalWindow.__qualificationMetricsObserver;
    await observer.pollState();
    assert.equal(observer.pending, null);
    assert.equal(observer.records.length, 0);
    assert.equal(renderRequests, 0);
    observer.arm('localControl', true);
    const node = controls.get(
      '[data-layer-id="local-datacenters"] .data-toggle-btn',
    );
    dispatchLocalClick(node);
    assert.equal(eventTimingCalls[0].type, 'click');
    layerEntry.visibilityIntentEpoch = ++intentEpoch;
    layerEntry.visibilityIntentEnabled = true;
    globalWindow.__godsEyeView.dataManager.visibilityListener({
      type: 'visibility-requested',
      layerId: 'local-datacenters',
      enabled: true,
      origin: 'user',
      intentEpoch,
    });
    buttonVisualState = 'enabling';
    lifecycleListener({
      type: 'visibility-transition',
      layerId: 'local-datacenters',
      enabled: true,
      origin: 'user',
      intentEpoch,
    });
    await observer.pollPromise;
    assert.equal(observer.pending.stateAtMs, null);
    for (let index = 0; index < 25; index++) await intervalCallback();
    const firstFrameTimestamp = performance.now() + 16;
    raf.flush(firstFrameTimestamp);
    assert.equal(eventTimingCalls[1].type, 'witness');
    assert.equal(eventTimingCalls[1].timestamp, firstFrameTimestamp);
    assert.equal(eventTimingCalls[1].state, 'transition');
    assert.equal(observer.pending.buttonFeedbackAtMs, null);
    raf.flush(firstFrameTimestamp);
    assert.equal(
      observer.pending.buttonFeedbackAtMs,
      null,
      'a repeated RAF timestamp cannot count as a second frame',
    );
    raf.flush(firstFrameTimestamp + 16);
    assert.equal(observer.pending.buttonFeedbackState, 'transition');
    assert.equal(observer.pending.stateAtMs, null);
    assert.ok(
      Number.isFinite(observer.pending.buttonFeedbackAtMs),
      'visible transition can be acknowledged before full LOD readiness',
    );
    layerEnabled = true;
    buttonActive = true;
    buttonVisualState = 'on';
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
    assert.equal(record.inputEventType, 'click');
    assert.equal(record.inputTrusted, true);
    assert.equal(record.inputAtMs, record.inputEventAtMs);
    assert.ok(record.handlerReceivedAtMs >= record.inputAtMs);
    assert.equal(record.layerEnabledObserved, true);
    assert.equal(record.layerVisibleObserved, true);
    assert.equal(
      record.buttonFeedbackWitnessType,
      'visible-button-two-distinct-raf-v3',
    );
    assert.equal(record.buttonFeedbackConsecutiveFrames, 2);
    assert.equal(record.acceptedIntentEpoch, 1);
    assert.equal(renderRequests, 0);

    observer.arm('localControl', false);
    dispatchLocalClick(node);
    layerEntry.visibilityIntentEpoch = ++intentEpoch;
    layerEntry.visibilityIntentEnabled = false;
    globalWindow.__godsEyeView.dataManager.visibilityListener({
      type: 'visibility-requested',
      layerId: 'local-datacenters',
      enabled: false,
      origin: 'user',
      intentEpoch,
    });
    buttonVisualState = 'disabling';
    lifecycleListener({
      type: 'visibility-transition',
      layerId: 'local-datacenters',
      enabled: false,
      origin: 'user',
      intentEpoch,
    });
    await observer.pollPromise;
    raf.flush();
    raf.flush();
    assert.equal(observer.pending.buttonFeedbackState, 'transition');
    layerEnabled = false;
    buttonActive = false;
    buttonVisualState = 'off';
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
    observer.arm('localControl', true);
    dispatchLocalClick(node);
    layerEntry.visibilityIntentEpoch = ++intentEpoch;
    layerEntry.visibilityIntentEnabled = true;
    globalWindow.__godsEyeView.dataManager.visibilityListener({
      type: 'visibility-requested',
      layerId: 'local-datacenters',
      enabled: true,
      origin: 'user',
      intentEpoch,
    });
    assert.equal(raf.pendingCount, 1);
    observer.dispose();
    assert.equal(preRenderListener, null, 'preRender listener is disposed');
    assert.equal(renderListener, null, 'postRender listener is disposed');
    assert.equal(raf.pendingCount, 0, 'pending feedback RAF is cancelled');
    assert.equal(
      globalWindow.__godsEyeView.dataManager.visibilityListener,
      null,
      'visibility request subscription is disposed',
    );
    assert.equal(
      lifecycleListener,
      null,
      'lifecycle event subscription is disposed',
    );
    assert.equal(node.listeners.size, 0, 'input listeners are disposed');
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
        /input event failed freshness validation|requires a fresh trusted click/,
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
    dispatchLocalClick(local);
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
    dispatchLocalClick(node);
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

test('serialized interaction observer completes local and replay render witnesses without module closures', async () => {
  const listeners = new Map();
  const controls = new Map();
  const createNode = (selector, { active = false, value = '' } = {}) => {
    const handlers = new Map();
    const node = {
      value,
      classList: { contains: (name) => name === 'active' && active },
      contains: (target) => target === node,
      getBoundingClientRect: () => ({
        left: 10,
        top: 10,
        right: 30,
        bottom: 30,
        width: 20,
        height: 20,
      }),
      addEventListener: (name, listener) => handlers.set(name, listener),
      removeEventListener: (name, listener) => {
        if (handlers.get(name) === listener) handlers.delete(name);
      },
      dispatch: (name, timeStamp = now) => {
        const listener = handlers.get(name);
        listener?.({
          type: name,
          isTrusted: true,
          timeStamp,
          target: node,
          currentTarget: node,
        });
      },
    };
    controls.set(selector, node);
    return node;
  };
  let now = 100;
  const raf = createRafHarness(() => {
    now += 16;
    return now - 16;
  });
  const localSelector = '[data-layer-id="local-datacenters"] .data-toggle-btn';
  const replaySelector = '.investigation-timeline-slider-control';
  const localNode = createNode(localSelector, { active: false });
  localNode.dataset = { feedState: 'off' };
  localNode.disabled = false;
  localNode.getAttribute = (name) =>
    name === 'aria-busy' || name === 'aria-disabled' ? 'false' : null;
  Object.defineProperty(localNode, 'textContent', {
    get: () =>
      ({
        enabling: 'ENABLING',
        disabling: 'DISABLING',
        on: 'LOADING',
        off: 'OFF',
      })[localNode.dataset.feedState],
  });
  const localEntry = {
    visibilityIntentEpoch: 0,
    visibilityIntentEnabled: false,
    module: {
      getLodDiagnostics: () => ({ computed: true, total: 8, active: 8 }),
    },
  };
  let lifecycleListener = null;
  const replayNode = createNode(replaySelector, { value: '4' });
  const selectedRecord = {
    id: 'SYNTH-001',
    positionTimeMs: 4000,
    latitude: Math.sin(3 / 10) * 0.02,
    longitude: 179.73,
  };
  const scene = {
    frameState: { frameNumber: 7 },
    preRender: {
      addEventListener: (listener) => {
        listeners.set('preRender', listener);
        return () => listeners.delete('preRender');
      },
    },
    postRender: {
      addEventListener: (listener) => {
        listeners.set('postRender', listener);
        return () => listeners.delete('postRender');
      },
    },
  };
  const app = {
    viewer: { scene },
    dataManager: {
      isEnabled: () => localEntry.visibilityIntentEnabled,
      subscribe: (listener) => {
        lifecycleListener = listener;
        return () => {
          lifecycleListener = null;
        };
      },
      layers: new Map([
        ['local-datacenters', localEntry],
        [
          'flights',
          {
            module: {
              getAnalystRecords: (limit) => {
                assert.equal(limit, 8);
                return [
                  {
                    icao24: selectedRecord.id,
                    provenance: {
                      positionObservedAtMs: selectedRecord.positionTimeMs,
                    },
                    lat: selectedRecord.latitude,
                    lon: selectedRecord.longitude,
                  },
                ];
              },
            },
          },
        ],
      ]),
    },
    aircraftSource: {
      getState: () => ({
        mode: 'recorded',
        recordingId: QUALIFICATION_REPLAY_FIXTURE_CONTRACT.recordingId,
        recordCount: QUALIFICATION_REPLAY_FIXTURE_CONTRACT.expectedRecordCount,
        targetMs: 4000,
        coverage: { from: 1000, to: 4000 },
      }),
    },
  };
  const sandbox = {
    window: {
      innerWidth: 800,
      innerHeight: 600,
      getComputedStyle: () => ({
        display: 'block',
        visibility: 'visible',
        opacity: '1',
      }),
      __godsEyeView: app,
      __qualificationFlightWitnessReader: (id) => ({
        billboardId: id,
        billboardVisible: true,
        billboardPosition: {
          latitude: selectedRecord.latitude,
          longitude: selectedRecord.longitude,
        },
        screenPosition: { x: 20, y: 30 },
        canvas: { width: 800, height: 600 },
      }),
    },
    document: {
      visibilityState: 'visible',
      hasFocus: () => true,
      querySelector: (selector) => controls.get(selector) || null,
    },
    requestAnimationFrame: raf.requestAnimationFrame,
    cancelAnimationFrame: raf.cancelAnimationFrame,
    performance: { now: () => now },
    setInterval: () => 1,
    clearInterval() {},
    console,
  };
  const pageRealmFunction = runInNewContext(
    `(${installInteractionObserverInPage.toString()})`,
    sandbox,
  );
  pageRealmFunction(QUALIFICATION_REPLAY_FIXTURE_CONTRACT);
  const observer = sandbox.window.__qualificationMetricsObserver;
  try {
    observer.arm('localControl', true);
    dispatchLocalClick(localNode);
    localEntry.visibilityIntentEpoch = 1;
    localEntry.visibilityIntentEnabled = true;
    observer.onVisibilityRequest({
      type: 'visibility-requested',
      layerId: 'local-datacenters',
      enabled: true,
      origin: 'user',
      intentEpoch: 1,
    });
    localNode.dataset.feedState = 'enabling';
    localNode.classList.contains = (name) =>
      name === 'active'
        ? false
        : name === 'transitioning' || name === 'enabling';
    localNode.getAttribute = (name) =>
      name === 'aria-busy' || name === 'aria-disabled' ? 'true' : null;
    lifecycleListener({
      type: 'visibility-transition',
      layerId: 'local-datacenters',
      enabled: true,
      origin: 'user',
      intentEpoch: 1,
    });
    now += 1;
    scene.frameState.frameNumber = 8;
    raf.flush();
    raf.flush();
    assert.equal(observer.pending.buttonFeedbackState, 'transition');
    assert.equal(observer.pending.stateAtMs, null);
    localNode.dataset.feedState = 'on';
    localNode.classList.contains = (name) => name === 'active';
    localNode.getAttribute = () => 'false';
    listeners.get('preRender')();
    listeners.get('postRender')();
    const local = observer.take();
    assert.equal(
      local.renderWitnessType,
      'natural-prerender-postrender-pair-v1',
    );
    assert.equal(local.preRenderFrameNumber, 8);
    assert.equal(local.frameNumberAtRendered, 8);

    observer.arm(
      'loadedReplaySeek',
      'end',
      '',
      '1',
      0,
      179.7,
      1000,
      1000,
      4000,
    );
    replayNode.dispatch('input');
    now += 1;
    scene.frameState.frameNumber = 9;
    listeners.get('preRender')();
    listeners.get('postRender')();
    const replay = observer.take();
    assert.equal(
      replay.renderWitnessType,
      'natural-replay-prerender-postrender-v1',
    );
    assert.equal(
      replay.renderedRecordPositionTimeMs,
      selectedRecord.positionTimeMs,
    );
    assert.equal(replay.renderedBillboardVisible, true);
    assert.equal(replay.preRenderFrameNumber, 9);
    assert.equal(replay.frameNumberAtRendered, 9);
    assert.equal(lifecycleListener !== null, true);
  } finally {
    observer.dispose();
    assert.equal(lifecycleListener, null);
  }
});

test('camera setup claims app navigation ownership and waits for two matching completed renders', async () => {
  const target = { latitude: 40.7, longitude: -73.9, altitude: 1000 };
  const order = [];
  const handlers = new Set();
  const scene = {
    frameState: { frameNumber: 10 },
    postRender: {
      addEventListener(handler) {
        handlers.add(handler);
        return () => handlers.delete(handler);
      },
    },
    requestRender() {
      order.push('request-render');
    },
  };
  const camera = {
    heading: 0,
    pitch: -Math.PI / 2,
    roll: 0,
    position: {
      constructor: {
        fromDegrees(longitude, latitude, altitude) {
          return { longitude, latitude, altitude };
        },
      },
    },
    positionCartographic: {
      latitude: 0,
      longitude: 0,
      height: 0,
    },
    cancelFlight() {
      order.push('cancel-flight');
    },
    setView({ destination }) {
      order.push('set-view');
      this.positionCartographic = {
        latitude: (destination.latitude * Math.PI) / 180,
        longitude: (destination.longitude * Math.PI) / 180,
        height: destination.altitude,
      };
    },
  };
  const sandbox = {
    window: {
      __godsEyeView: {
        viewer: { camera, scene },
        styleManager: {
          runImmediateLocationNavigation(navigate) {
            order.push('claim-navigation');
            camera.cancelFlight();
            return navigate();
          },
        },
      },
    },
    setTimeout,
    clearTimeout,
  };
  const setupInPage = runInNewContext(
    `(${applyUnmeasuredCameraPoseInPage.toString()})`,
    sandbox,
  );
  const pending = setupInPage(target);
  assert.deepEqual(order.slice(0, 3), [
    'claim-navigation',
    'cancel-flight',
    'set-view',
  ]);
  assert.equal(handlers.size, 1, 'owns one completed-render listener');

  const firePostRender = () => {
    scene.frameState.frameNumber += 1;
    for (const handler of [...handlers]) handler();
  };
  // A single fresh frame is insufficient; pose must still match on the next
  // completed frame, which catches camera motion that wins after setView.
  firePostRender();
  assert.equal(handlers.size, 1);
  camera.positionCartographic.latitude += 0.001;
  firePostRender();
  assert.equal(handlers.size, 1, 'pose drift resets consecutive frame proof');
  camera.positionCartographic.latitude = (target.latitude * Math.PI) / 180;
  firePostRender();
  firePostRender();
  const result = await pending;
  assert.equal(result.frameNumberBefore, 10);
  assert.equal(result.observedPose.frameNumber, 14);
  assert.ok(Math.abs(result.observedPose.latitude - target.latitude) < 1e-12);
  assert.ok(Math.abs(result.observedPose.longitude - target.longitude) < 1e-12);
  assert.equal(result.observedPose.altitude, target.altitude);
  assert.equal(handlers.size, 0, 'completed setup releases its listener');
});

test('camera setup fails closed when app navigation ownership is unavailable', async () => {
  const setupInPage = runInNewContext(
    `(${applyUnmeasuredCameraPoseInPage.toString()})`,
    {
      window: {
        __godsEyeView: {
          viewer: {
            camera: {},
            scene: {
              frameState: { frameNumber: 1 },
              postRender: { addEventListener() {} },
            },
          },
        },
      },
    },
  );
  assert.throws(
    () => setupInPage({ latitude: 40, longitude: -70, altitude: 1000 }),
    /navigation\/render ownership is unavailable/,
  );
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
