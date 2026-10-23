import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import vm from 'node:vm';
import test from 'node:test';
import {
  disposeWeatherGovernorModeTraceInPage,
  installWeatherGovernorModeTraceInPage,
  WEATHER_GOVERNOR_MODE_TRACE_SCHEMA,
} from './weatherIdleDiagnostic.mjs';
import {
  validateWeatherIdleCadenceDisposition,
  WEATHER_IDLE_CADENCE_DISPOSITION_SCHEMA,
  WEATHER_IDLE_CADENCE_METRIC,
} from './weatherIdleCadenceDisposition.mjs';
import {
  baselineCommit,
  candidateCommit,
  makeWeatherReport,
} from './pairedReportTestFixtures.mjs';
import { createWeatherEffectsWorkloadFixture } from './weatherEffectsWorkloadFixture.mjs';

const HASH = (bytes) => createHash('sha256').update(bytes).digest('hex');
const profile = {
  id: 'native-sharpness-v1',
  useBrowserRecommendedResolution: false,
  resolutionScale: 1,
  maximumScreenSpaceError: 1,
  viewport: { width: 1440, height: 900, dpr: 2 },
  drawingBuffer: { width: 2880, height: 1800 },
};
const fixture = createWeatherEffectsWorkloadFixture();
const captureHarnessCommit = 'a'.repeat(40);
const buildHarnessCommit = 'b'.repeat(40);
const receiptSha = 'c'.repeat(64);

function createPageInstaller(scene, clock) {
  const context = vm.createContext({
    window: { __godsEyeView: { viewer: { scene } } },
    performance: { now: () => clock.value },
  });
  return {
    context,
    result: vm.runInContext(
      `(${installWeatherGovernorModeTraceInPage.toString()})()`,
      context,
    ),
  };
}

test('governor-mode trace records rapid hold/release writes and restores the descriptor', () => {
  const clock = { value: 100 };
  const scene = { requestRenderMode: true };
  const original = Object.getOwnPropertyDescriptor(scene, 'requestRenderMode');
  const { context, result } = createPageInstaller(scene, clock);
  assert.equal(result.installed, true);
  const controller = context.window.__gevWeatherGovernorModeWriteTraceV1;
  assert.equal(controller.start(100), true);
  clock.value = 110;
  scene.requestRenderMode = false;
  clock.value = 111;
  scene.requestRenderMode = true;
  assert.equal(controller.check(), true);
  assert.equal(controller.stop(60_100), true);
  const trace = controller.dispose();
  assert.equal(trace.status, 'completed');
  assert.deepEqual(JSON.parse(JSON.stringify(trace.events)), [
    { atMs: 10, value: false },
    { atMs: 11, value: true },
  ]);
  assert.equal(trace.eventsObserved, 2);
  assert.equal(trace.ownershipReplaced, false);
  assert.deepEqual(
    Object.getOwnPropertyDescriptor(scene, 'requestRenderMode'),
    { ...original, value: true },
  );
  assert.equal(trace.cleanup.descriptorVerified, true);
  assert.equal(trace.cleanup.windowBindingRestored, true);
  assert.equal(
    Object.hasOwn(context.window, '__gevWeatherGovernorModeWriteTraceV1'),
    false,
  );
});

test('mode trace rejects unsupported descriptors without changing them', () => {
  for (const scene of [
    Object.defineProperty({}, 'requestRenderMode', {
      configurable: false,
      enumerable: true,
      writable: true,
      value: true,
    }),
    Object.defineProperty({}, 'requestRenderMode', {
      configurable: true,
      enumerable: true,
      get() {
        return true;
      },
    }),
  ]) {
    const original = Object.getOwnPropertyDescriptor(
      scene,
      'requestRenderMode',
    );
    const { context, result } = createPageInstaller(scene, { value: 1 });
    assert.equal(result.installed, false);
    assert.match(result.status, /unsupported-descriptor/);
    assert.deepEqual(
      Object.getOwnPropertyDescriptor(scene, 'requestRenderMode'),
      original,
    );
    assert.equal(
      Object.hasOwn(context.window, '__gevWeatherGovernorModeWriteTraceV1'),
      false,
    );
  }
});

test('mode trace detects and preserves a replacement data descriptor', () => {
  const scene = { requestRenderMode: true };
  const { context } = createPageInstaller(scene, { value: 5 });
  const controller = context.window.__gevWeatherGovernorModeWriteTraceV1;
  assert.equal(controller.start(5), true);
  Object.defineProperty(scene, 'requestRenderMode', {
    configurable: true,
    enumerable: true,
    writable: true,
    value: false,
  });
  assert.equal(controller.check(), false);
  controller.stop(60_005);
  const trace = controller.dispose();
  assert.equal(trace.ownershipReplaced, true);
  assert.equal(trace.finalValue, false);
  assert.equal(trace.cleanup.replacementOwnerPreserved, true);
  assert.equal(trace.cleanup.descriptorRestored, false);
  assert.deepEqual(
    Object.getOwnPropertyDescriptor(scene, 'requestRenderMode'),
    {
      configurable: true,
      enumerable: true,
      writable: true,
      value: false,
    },
  );
});

test('mode trace preserves a replacement accessor and does not invoke its owner during cleanup', () => {
  const scene = { requestRenderMode: true };
  const { context } = createPageInstaller(scene, { value: 10 });
  const controller = context.window.__gevWeatherGovernorModeWriteTraceV1;
  assert.equal(controller.start(10), true);
  let ownerWrites = 0;
  const replacementGetter = () => false;
  const replacementSetter = () => {
    ownerWrites += 1;
  };
  Object.defineProperty(scene, 'requestRenderMode', {
    configurable: true,
    enumerable: false,
    get: replacementGetter,
    set: replacementSetter,
  });
  const before = Object.getOwnPropertyDescriptor(scene, 'requestRenderMode');
  const trace = controller.dispose();
  const after = Object.getOwnPropertyDescriptor(scene, 'requestRenderMode');

  assert.equal(after.get, before.get);
  assert.equal(after.set, before.set);
  assert.equal(after.enumerable, before.enumerable);
  assert.equal(after.configurable, before.configurable);
  assert.equal(ownerWrites, 0);
  assert.equal(trace.ownershipReplaced, true);
  assert.equal(trace.cleanup.replacementOwnerPreserved, true);
  assert.equal(trace.cleanup.descriptorVerified, false);
  assert.equal(trace.cleanup.windowBindingRestored, true);
});

test('mode trace finalizes after an interrupted sample and marks unclosed intervals incomplete', () => {
  const scene = { requestRenderMode: true };
  const { context } = createPageInstaller(scene, { value: 20 });
  const controller = context.window.__gevWeatherGovernorModeWriteTraceV1;
  assert.equal(controller.start(20), true);
  scene.requestRenderMode = false;
  assert.equal(controller.stop(25), true);
  const completed = controller.dispose();
  assert.equal(completed.status, 'completed');
  assert.equal(completed.finalValue, false);
  assert.equal(completed.cleanup.descriptorVerified, true);

  const second = createPageInstaller(
    { requestRenderMode: true },
    { value: 30 },
  );
  const incompleteController =
    second.context.window.__gevWeatherGovernorModeWriteTraceV1;
  assert.equal(incompleteController.start(30), true);
  const incomplete = incompleteController.dispose();
  assert.equal(incomplete.status, 'incomplete');
  assert.equal(incomplete.cleanup.descriptorVerified, true);
  assert.equal(incomplete.cleanup.windowBindingRestored, true);
});

test('failed trace installation restores a partial scene hook and leaves no binding', () => {
  const scene = { requestRenderMode: true };
  const original = Object.getOwnPropertyDescriptor(scene, 'requestRenderMode');
  const rawWindow = { __godsEyeView: { viewer: { scene } } };
  const window = new Proxy(rawWindow, {
    defineProperty(target, key, descriptor) {
      if (key === '__gevWeatherGovernorModeWriteTraceV1')
        throw new Error('mock binding failure');
      return Reflect.defineProperty(target, key, descriptor);
    },
  });
  const context = vm.createContext({ window, performance: { now: () => 50 } });
  const result = vm.runInContext(
    `(${installWeatherGovernorModeTraceInPage.toString()})()`,
    context,
  );

  assert.equal(result.installed, false);
  assert.equal(result.status, 'install-failed');
  assert.deepEqual(
    Object.getOwnPropertyDescriptor(scene, 'requestRenderMode'),
    original,
  );
  assert.equal(result.cleanup.descriptorVerified, true);
  assert.equal(result.cleanup.windowBindingRestored, true);
});

test('setup-failure cleanup always attempts dispose after a stop error', () => {
  const calls = [];
  const runInPage = (window) =>
    vm.runInNewContext(
      `(${disposeWeatherGovernorModeTraceInPage.toString()})()`,
      { window, performance: { now: () => 123 } },
    );
  const result = runInPage({
    __gevWeatherGovernorModeWriteTraceV1: {
      stop() {
        calls.push('stop');
        throw new Error('mock stop failure');
      },
      dispose() {
        calls.push('dispose');
        return { cleanup: { descriptorVerified: true } };
      },
    },
  });
  assert.deepEqual(calls, ['stop', 'dispose']);
  assert.equal(result.status, 'disposed');
  assert.equal(result.stopErrorName, 'Error');
  assert.equal(result.trace.cleanup.descriptorVerified, true);
  assert.equal(runInPage({}).status, 'already-disposed');
});

test('mode trace bounds event storage and reports failed descriptor cleanup', () => {
  const scene = { requestRenderMode: true };
  const { context } = createPageInstaller(scene, { value: 1 });
  const controller = context.window.__gevWeatherGovernorModeWriteTraceV1;
  controller.start(1);
  for (let index = 0; index < 257; index += 1)
    scene.requestRenderMode = index % 2 === 0;
  controller.stop(60_001);
  const trace = controller.dispose();
  assert.equal(trace.eventsObserved, 257);
  assert.equal(trace.events.length, 256);
  assert.equal(trace.eventsOmitted, 1);

  const stuckScene = { requestRenderMode: true };
  const stuck = createPageInstaller(stuckScene, { value: 1 });
  const stuckController =
    stuck.context.window.__gevWeatherGovernorModeWriteTraceV1;
  stuckController.start(1);
  Object.defineProperty(stuckScene, 'requestRenderMode', {
    configurable: false,
    enumerable: true,
    writable: true,
    value: true,
  });
  const cleanup = stuckController.dispose();
  assert.equal(cleanup.cleanup.descriptorRestored, false);
  assert.equal(cleanup.cleanup.descriptorVerified, false);
  assert.equal(cleanup.cleanup.windowBindingRestored, true);
});

function makeEnvironment(appCommit) {
  return {
    userAgent: 'Chrome/155.0.8059.84',
    platform: 'Win32',
    renderer: 'ANGLE (Intel UHD Graphics 620 Direct3D11)',
    vendor: 'Google Inc. (Intel)',
    viewport: { width: 1440, height: 900, dpr: 2 },
    drawingBuffer: { width: 2880, height: 1800 },
    nativeSharpnessProfile: structuredClone(profile),
    focused: true,
    visible: true,
    appCommit,
    layers: [],
    totalObjects: 0,
  };
}

function makePhaseEvidence() {
  const phases = fixture.phaseSchedule.phases.map((phase) => ({
    id: phase.id,
    fixtureSha256: fixture.sha256,
    expectedSourceTime: phase.sourceTime,
    scheduledAtMs: phase.offsetMs,
    observedAtElapsedMs: phase.offsetMs + 100,
    sourceObservationTimes: Array(3).fill(phase.sourceTime),
    clock: { mode: 'history', playing: false },
  }));
  const phaseSummary = phases.map((phase) => ({
    id: phase.id,
    scheduledTargetElapsedMs: phase.scheduledAtMs,
    pageObservedCompletionElapsedMs: phase.observedAtElapsedMs,
    sourceObservationTimes: phase.sourceObservationTimes,
  }));
  const requests = phases.map((phase, index) => ({
    phaseId: phase.id,
    requestHostPerformanceNowMs: index * 100,
    completionHostPerformanceNowMs: index * 100 + 10,
    status: 'fulfilled',
    pageObservedCompletionElapsedMs: phase.observedAtElapsedMs,
    errorName: null,
  }));
  return {
    observed: {
      schema: 'gev-weather-phase-observations/v1',
      durationMs: 60_000,
      fixtureSha256: fixture.sha256,
      phases,
    },
    phaseSummary,
    requests,
  };
}

function makeVisibleWindProbe() {
  const observation = (paused, phaseTime) => ({
    diagnostics: {
      renderMode: 'gpu-streamlines',
      paused,
      gpu: {
        ready: true,
        heightFade: 0.5,
        visibleCells: 2,
        visibleVertexCount: 120,
        pathCount: 8,
      },
    },
    windMaterial: { phaseTime, heightFade: 0.5, matchCount: 1 },
  });
  const phase = (
    paused,
    startTime,
    endTime,
    frameCount,
    frameAtMs,
    framePhaseTime,
  ) => ({
    durationMs: paused ? 2_000 : 3_000,
    start: observation(paused, startTime),
    end: observation(paused, endTime),
    postRenderCount: frameCount,
    frames: Array.from({ length: frameCount }, (_, index) => ({
      atMs: frameAtMs + index,
      windMaterial: {
        matchCount: 1,
        phaseTime: framePhaseTime,
        heightFade: 0.5,
      },
    })),
    framesOmitted: 0,
  });
  return {
    schema: 'gev-weather-visible-wind-probe/v1',
    diagnosticOnly: true,
    performanceAcceptanceEligible: false,
    status: 'observed',
    probeHeightMeters: 60_000,
    totalElapsedMs: 11_000,
    timing: {
      settleMs: 2_000,
      unpausedMs: 3_000,
      pausedMs: 2_000,
      resumedMs: 3_000,
      timeoutMs: 30_000,
    },
    failureReasons: [],
    camera: {
      before: {
        longitude: 0,
        latitude: 0,
        altitudeMeters: 12_000,
        heading: 0,
        pitch: -0.7,
        roll: 0,
      },
      probe: {
        longitude: 0,
        latitude: 0,
        altitudeMeters: 60_000,
        heading: 0,
        pitch: -0.7,
        roll: 0,
      },
      restored: {
        longitude: 0,
        latitude: 0,
        altitudeMeters: 12_000,
        heading: 0,
        pitch: -0.7,
        roll: 0,
      },
    },
    navigationOwnership: { moveAccepted: true, restoreAccepted: true },
    cleanup: { attempted: true, cameraRestored: true, pauseRestored: true },
    scene: {
      before: {
        settingsComplete: true,
        enabledLayerIds: [],
        populations: [],
        settings: {},
        viewport: {},
      },
      after: {
        settingsComplete: true,
        enabledLayerIds: [],
        populations: [],
        settings: {},
        viewport: {},
      },
    },
    windParams: {
      before: { model: 'gfs', overlay: 'speed', units: 'knots', paused: false },
      after: { model: 'gfs', overlay: 'speed', units: 'knots', paused: false },
    },
    invariantChecks: Array(5).fill({
      sceneUnchanged: true,
      windSettingsUnchanged: true,
    }),
    phases: {
      unpaused: phase(false, 1, 2, 1, 5_001, 1.5),
      paused: phase(true, 2, 2, 0, 7_001, null),
      resumed: phase(false, 2, 3, 1, 10_001, 2.5),
    },
  };
}

function makeDiagnosticReport(appCommit, balancedReport) {
  const report = makeWeatherReport(appCommit);
  const sample = structuredClone(
    balancedReport.captures.find((capture) => capture.scenario === 'idle'),
  );
  const phase = makePhaseEvidence();
  const wind = {
    renderMode: 'gpu-streamlines',
    paused: false,
    reducedMotion: false,
    hidden: false,
    framePending: false,
    gpu: {
      ready: true,
      heightFade: 0,
      visibleCells: 0,
      visibleVertexCount: 0,
      pathCount: 7200,
      displayHeightMeters: 12_000,
    },
  };
  const frameEvents = [0, 60_000].map((atMs, index) => ({
    atMs,
    intervalMs: index ? 60_000 : null,
    governor: {
      mode: 'idle',
      holds: [],
      scheduledUpdates: [],
      recentRequests: [],
    },
    windRenderer: structuredClone(wind),
  }));
  const governorSamples = [0, 30_000, 60_000].map((atMs) => ({
    atMs,
    governor: {
      mode: 'idle',
      holds: [],
      scheduledUpdates: [],
      recentRequests: [],
    },
    windRenderer: structuredClone(wind),
  }));
  const gaps = [
    {
      startAtMs: 0,
      endAtMs: 60_000,
      intervalMs: 60_000,
      continuousDemandDuringGap: 'observed-absent',
      observedGovernorStateCount: 5,
      observedModes: ['idle'],
      observedHolds: [],
      windRenderingAssessment: 'gpu-streamlines-fully-faded',
      windRendererObservationsOmitted: 0,
    },
  ];
  const trace = {
    schema: WEATHER_GOVERNOR_MODE_TRACE_SCHEMA,
    installed: true,
    status: 'completed',
    descriptorKind: 'data',
    descriptorConfigurable: true,
    descriptorEnumerable: true,
    descriptorWritable: true,
    initialValue: true,
    finalValue: true,
    startAtMs: 100,
    endAtMs: 60_100,
    eventsObserved: 0,
    events: [],
    eventsOmitted: 0,
    nonBooleanWriteObserved: false,
    ownershipReplaced: false,
    cleanup: {
      attempted: true,
      descriptorRestored: true,
      descriptorVerified: true,
      windowBindingRestored: true,
    },
  };
  sample.durationMs = 60_000;
  sample.foregroundThroughout = true;
  sample.focusContinuity = {
    focusedAtStart: true,
    focusedAtEnd: true,
    interruptionCount: 0,
  };
  sample.visibilityContinuity = { visibleThroughout: true };
  sample.renderDemandOwnership = { restored: true };
  sample.cameraPath = { id: 'parked-v1' };
  sample.weatherPhaseObservations = phase.observed;
  sample.weatherVisibleWindProbe = makeVisibleWindProbe();
  sample.weatherIdleDiagnostic = {
    schema: 'gev-weather-idle-render-demand-diagnostic/v1',
    diagnosticOnly: true,
    performanceAcceptanceEligible: false,
    requestAttribution: { directWindSceneRequestRenderCaptured: false },
    instrumentation: {
      samplePeriodMs: 250,
      frameEventsObserved: 2,
      frameEventsRecorded: 2,
      frameEventsOmitted: 0,
      governorSamplesObserved: 3,
      governorSamplesRecorded: 3,
      governorSamplesOmitted: 0,
      samplingMaxGapMs: 30_000,
      snapshotReadFailureCount: 0,
      phaseRequestEventsOmitted: 0,
      gapsOverOneSecondOmitted: 0,
      governorModeTraceEventsObserved: 0,
      governorModeTraceEventsRecorded: 0,
      governorModeTraceEventsOmitted: 0,
      governorModeTraceCleanupVerified: true,
    },
    frameEvents,
    governorSamples,
    gapsOverOneSecond: gaps,
    phaseRequests: phase.requests,
    phases: phase.phaseSummary,
    governorModeTrace: trace,
  };
  report.source = {
    appCommit,
    appWorktreeState: 'clean',
    harnessCommit: captureHarnessCommit,
    harnessDirtyWorktree: false,
    buildHarnessCommit,
    buildProvenance: {
      status: 'verified-local-build-and-served-assets-before-and-after',
      appCommit,
      captureProducerCommit: captureHarnessCommit,
      harnessCommit: buildHarnessCommit,
      buildHarnessCommit,
      before: { status: 'served-assets-match', receiptSha256: receiptSha },
      after: { status: 'served-assets-match', receiptSha256: receiptSha },
    },
  };
  report.environment = {
    ...makeEnvironment(appCommit),
    nativeSharpnessProfile: structuredClone(profile),
  };
  report.captures = [sample];
  report.comparisonEligible = false;
  report.integrity = { status: 'passed', sampleCount: 1 };
  report.workload = {
    ...report.workload,
    warmupMs: 30_000,
    durationPerSampleMs: 60_000,
    runsPerScenario: 1,
    providerFixture: 'austin-weather-effects-phased-v2',
    fixtureId: 'weather-effects-austin-phased-v2',
    weatherEffectsCaptureMode: 'idle-render-demand-diagnostic',
    diagnosticOnly: true,
    performanceAcceptanceEligible: false,
    ineligibleReason:
      'weather-idle-render-demand-diagnostic-is-diagnostic-only',
    weatherEffectsFixtureLifecycle: {
      camera: {
        id: 'austin-weather-oblique-v1',
        longitudeDeg: -97.7431,
        latitudeDeg: 30.2672,
        altitudeM: 12_000,
        headingDeg: 20,
        pitchDeg: -45,
      },
      observedCamera: {
        longitudeDeg: -97.7431,
        latitudeDeg: 30.2672,
        altitudeM: 12_000,
        headingDeg: 20,
        pitchDeg: -45,
      },
      phaseSchedule: structuredClone(fixture.phaseSchedule),
    },
    weatherIdleDiagnosticProtocol: {
      schema: 'gev-weather-idle-render-demand-diagnostic/v1',
      fixtureSha256: fixture.sha256,
      phaseSchedule: structuredClone(fixture.phaseSchedule),
      phaseObservationsBySample: [phase.phaseSummary],
      phaseRequestsBySample: [phase.requests],
      performanceAcceptanceEligible: false,
    },
    rendererProbeCleanup: [{ confirmed: true }],
    fixtureInterceptionReleases: [
      { confirmed: true, targetClosed: true, stop: { confirmed: true } },
    ],
  };
  return report;
}

function makeBalancedReview() {
  const controlReport = makeWeatherReport(baselineCommit);
  const candidateReport = makeWeatherReport(candidateCommit);
  for (const report of [controlReport, candidateReport]) {
    report.environment = {
      ...makeEnvironment(
        report === controlReport ? baselineCommit : candidateCommit,
      ),
      nativeSharpnessProfile: structuredClone(profile),
    };
    for (const sample of report.captures)
      for (const boundary of ['before', 'after']) {
        sample.conditions[boundary].environment = {
          ...sample.conditions[boundary].environment,
          nativeSharpnessProfile: structuredClone(profile),
        };
      }
    report.workload.weatherEffectsFixtureLifecycle = {
      camera: {
        id: 'austin-weather-oblique-v1',
        longitudeDeg: -97.7431,
        latitudeDeg: 30.2672,
        altitudeM: 12_000,
        headingDeg: 20,
        pitchDeg: -45,
      },
      phaseSchedule: structuredClone(fixture.phaseSchedule),
    };
  }
  return {
    status: 'comparable',
    evidenceScope: 'balanced-five-pair-full-weather-qualification',
    scenarios: {
      idle: { status: 'measured', regressionOver10Pct: true },
      'scripted-motion': { status: 'measured', regressionOver10Pct: false },
    },
    regressionsOver10Pct: ['idle'],
    environment: {
      userAgent: 'Chrome/155.0.8059.84',
      platform: 'Win32',
      renderer: 'ANGLE (Intel UHD Graphics 620 Direct3D11)',
      vendor: 'Google Inc. (Intel)',
      viewport: { width: 1440, height: 900, dpr: 2 },
      drawingBuffer: { width: 2880, height: 1800 },
      nativeSharpnessProfile: structuredClone(profile),
    },
    controlReport,
    candidateReport,
  };
}

function makeDisposition(controlDiagnostic, candidateDiagnostic) {
  const controlBytes = Buffer.from(JSON.stringify(controlDiagnostic));
  const candidateBytes = Buffer.from(JSON.stringify(candidateDiagnostic));
  return {
    disposition: {
      schema: WEATHER_IDLE_CADENCE_DISPOSITION_SCHEMA,
      metric: WEATHER_IDLE_CADENCE_METRIC,
      scenario: 'idle',
      workloadId: 'austin-weather-effects-phased-v2',
      baselineAppSha: baselineCommit,
      candidateAppSha: candidateCommit,
      captureHarnessCommit,
      buildHarnessCommit,
      controlDiagnostic: { path: 'control.json', sha256: HASH(controlBytes) },
      candidateDiagnostic: {
        path: 'candidate.json',
        sha256: HASH(candidateBytes),
      },
    },
    baselineDiagnostic: { bytes: controlBytes },
    candidateDiagnostic: { bytes: candidateBytes },
  };
}

test('weather idle disposition resolves only the named idle metric with complete paired evidence', () => {
  const balanced = makeBalancedReview();
  const artifacts = makeDisposition(
    makeDiagnosticReport(baselineCommit, balanced.controlReport),
    makeDiagnosticReport(candidateCommit, balanced.candidateReport),
  );
  const result = validateWeatherIdleCadenceDisposition({
    ...artifacts,
    balancedReview: balanced,
  });
  assert.deepEqual(result.resolvedScenarios, ['idle']);
  assert.equal(result.resolvedMetric, WEATHER_IDLE_CADENCE_METRIC);
  assert.equal(result.performanceBenefitClaim, false);
  assert.equal(result.gpuCostClaim, false);
  assert.equal(result.samplingLimitations.maximumGapAcceptanceBound, null);
  assert.equal(result.samplingLimitations.controlMaximumGapMs, 30_000);
});

test('weather idle disposition rejects swapped workload and fixture identities', () => {
  const balanced = makeBalancedReview();
  const artifacts = makeDisposition(
    makeDiagnosticReport(baselineCommit, balanced.controlReport),
    makeDiagnosticReport(candidateCommit, balanced.candidateReport),
  );
  const report = JSON.parse(artifacts.baselineDiagnostic.bytes);
  report.workload.providerFixture = fixture.id;
  report.workload.fixtureId = fixture.workloadId;
  const bytes = Buffer.from(JSON.stringify(report));
  artifacts.baselineDiagnostic.bytes = bytes;
  artifacts.disposition.controlDiagnostic.sha256 = HASH(bytes);
  assert.throws(
    () =>
      validateWeatherIdleCadenceDisposition({
        ...artifacts,
        balancedReview: balanced,
      }),
    /not one exact diagnostic-only idle capture/,
  );
});

test('weather idle disposition requires the declared visible-wind phase durations and whole-probe frame clock', () => {
  const balanced = makeBalancedReview();
  const assertRejectedMutation = (mutate) => {
    const artifacts = makeDisposition(
      makeDiagnosticReport(baselineCommit, balanced.controlReport),
      makeDiagnosticReport(candidateCommit, balanced.candidateReport),
    );
    const report = JSON.parse(artifacts.baselineDiagnostic.bytes);
    mutate(report.captures[0].weatherVisibleWindProbe);
    const bytes = Buffer.from(JSON.stringify(report));
    artifacts.baselineDiagnostic.bytes = bytes;
    artifacts.disposition.controlDiagnostic.sha256 = HASH(bytes);
    assert.throws(() =>
      validateWeatherIdleCadenceDisposition({
        ...artifacts,
        balancedReview: balanced,
      }),
    );
  };
  assertRejectedMutation((probe) => {
    probe.phases.paused.durationMs = 1_000;
  });
  assertRejectedMutation((probe) => {
    probe.timing.resumedMs = 2_000;
  });
  assertRejectedMutation((probe) => {
    probe.phases.resumed.frames[0].atMs = 5_001;
  });
});

test('weather idle disposition rejects absent or forged diagnostic hashes and source identities', () => {
  const balanced = makeBalancedReview();
  const pair = () =>
    makeDisposition(
      makeDiagnosticReport(baselineCommit, balanced.controlReport),
      makeDiagnosticReport(candidateCommit, balanced.candidateReport),
    );
  let artifacts = pair();
  delete artifacts.disposition.controlDiagnostic.sha256;
  assert.throws(
    () =>
      validateWeatherIdleCadenceDisposition({
        ...artifacts,
        balancedReview: balanced,
      }),
    /SHA-256/,
  );
  artifacts = pair();
  artifacts.disposition.candidateAppSha = baselineCommit;
  assert.throws(
    () =>
      validateWeatherIdleCadenceDisposition({
        ...artifacts,
        balancedReview: balanced,
      }),
    /identities/,
  );
  artifacts = pair();
  artifacts.candidateDiagnostic = {
    ...artifacts.candidateDiagnostic,
    bytes: Buffer.from(
      JSON.stringify({
        ...JSON.parse(artifacts.candidateDiagnostic.bytes),
        source: {
          ...JSON.parse(artifacts.candidateDiagnostic.bytes).source,
          appCommit: baselineCommit,
        },
      }),
    ),
  };
  artifacts.disposition.candidateDiagnostic.sha256 = HASH(
    artifacts.candidateDiagnostic.bytes,
  );
  assert.throws(
    () =>
      validateWeatherIdleCadenceDisposition({
        ...artifacts,
        balancedReview: balanced,
      }),
    /source\/build provenance/,
  );
  artifacts = pair();
  const wrongBuilder = JSON.parse(artifacts.baselineDiagnostic.bytes);
  wrongBuilder.source.buildProvenance.harnessCommit = captureHarnessCommit;
  const wrongBuilderBytes = Buffer.from(JSON.stringify(wrongBuilder));
  artifacts.baselineDiagnostic.bytes = wrongBuilderBytes;
  artifacts.disposition.controlDiagnostic.sha256 = HASH(wrongBuilderBytes);
  assert.throws(
    () =>
      validateWeatherIdleCadenceDisposition({
        ...artifacts,
        balancedReview: balanced,
      }),
    /source\/build provenance/,
  );
});

test('weather idle disposition rejects governor holds, trace replacement, omissions, and failed phases', () => {
  const balanced = makeBalancedReview();
  const attempt = (mutate) => {
    const artifacts = makeDisposition(
      makeDiagnosticReport(baselineCommit, balanced.controlReport),
      makeDiagnosticReport(candidateCommit, balanced.candidateReport),
    );
    mutate(artifacts);
    return assert.throws(() =>
      validateWeatherIdleCadenceDisposition({
        ...artifacts,
        balancedReview: balanced,
      }),
    );
  };
  attempt((artifacts) => {
    const report = JSON.parse(artifacts.baselineDiagnostic.bytes);
    report.captures[0].weatherIdleDiagnostic.governorModeTrace.events = [
      { atMs: 10, value: false },
    ];
    report.captures[0].weatherIdleDiagnostic.governorModeTrace.eventsObserved = 1;
    const bytes = Buffer.from(JSON.stringify(report));
    artifacts.baselineDiagnostic.bytes = bytes;
    artifacts.disposition.controlDiagnostic.sha256 = HASH(bytes);
  });
  attempt((artifacts) => {
    const report = JSON.parse(artifacts.candidateDiagnostic.bytes);
    report.captures[0].weatherIdleDiagnostic.governorModeTrace.ownershipReplaced = true;
    const bytes = Buffer.from(JSON.stringify(report));
    artifacts.candidateDiagnostic.bytes = bytes;
    artifacts.disposition.candidateDiagnostic.sha256 = HASH(bytes);
  });
  attempt((artifacts) => {
    const report = JSON.parse(artifacts.baselineDiagnostic.bytes);
    report.captures[0].weatherIdleDiagnostic.instrumentation.frameEventsOmitted = 1;
    const bytes = Buffer.from(JSON.stringify(report));
    artifacts.baselineDiagnostic.bytes = bytes;
    artifacts.disposition.controlDiagnostic.sha256 = HASH(bytes);
  });
  attempt((artifacts) => {
    const report = JSON.parse(artifacts.candidateDiagnostic.bytes);
    report.captures[0].weatherIdleDiagnostic.phaseRequests[1].status =
      'rejected';
    const bytes = Buffer.from(JSON.stringify(report));
    artifacts.candidateDiagnostic.bytes = bytes;
    artifacts.disposition.candidateDiagnostic.sha256 = HASH(bytes);
  });
  attempt((artifacts) => {
    const report = JSON.parse(artifacts.baselineDiagnostic.bytes);
    report.captures[0].weatherVisibleWindProbe.phases.resumed.end.diagnostics.gpu.visibleCells = 0;
    const bytes = Buffer.from(JSON.stringify(report));
    artifacts.baselineDiagnostic.bytes = bytes;
    artifacts.disposition.controlDiagnostic.sha256 = HASH(bytes);
  });
  attempt((artifacts) => {
    const report = JSON.parse(artifacts.candidateDiagnostic.bytes);
    report.captures[0].conditions.after.settings.resolutionScale = 0.5;
    const bytes = Buffer.from(JSON.stringify(report));
    artifacts.candidateDiagnostic.bytes = bytes;
    artifacts.disposition.candidateDiagnostic.sha256 = HASH(bytes);
  });
});
