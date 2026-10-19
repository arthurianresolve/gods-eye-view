import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { comparableCaptureConditions } from './captureIntegrity.mjs';
import { createWeatherEffectsWorkloadFixture } from './weatherEffectsWorkloadFixture.mjs';
import { validateVisibleWindProbeReport } from './weatherVisibleWindProbe.mjs';

export const WEATHER_IDLE_CADENCE_DISPOSITION_SCHEMA =
  'gev-weather-idle-cadence-disposition/v1';
export const WEATHER_IDLE_CADENCE_METRIC = 'idle.frameIntervalMs.p95';
const CAPTURE_SCHEMA = 'gev-performance-capture/v1';
const IDLE_DIAGNOSTIC_SCHEMA = 'gev-weather-idle-render-demand-diagnostic/v1';
const MODE_TRACE_SCHEMA = 'gev-weather-governor-mode-write-trace/v1';
const WIND_PROBE_SCHEMA = 'gev-weather-visible-wind-probe/v1';
const FIXTURE_ID = 'austin-weather-effects-phased-v2';
const SHA1 = /^[a-f0-9]{40}$/i;
const SHA256 = /^[a-f0-9]{64}$/i;
const MAX_DIAGNOSTIC_BYTES = 64 * 1024 * 1024;
const fixture = createWeatherEffectsWorkloadFixture();
const EXPECTED_PHASE_IDS = [
  'early-history',
  'middle-history',
  'latest-history',
];

function reject(message) {
  throw new Error(`Weather idle-cadence disposition rejected: ${message}`);
}

function finite(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function sameAngle(left, right, epsilon = 1e-9) {
  return (
    finite(left) &&
    finite(right) &&
    Math.abs(Math.atan2(Math.sin(left - right), Math.cos(left - right))) <=
      epsilon
  );
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, stable(value[key])]),
  );
}

function equal(actual, expected, label) {
  assert.deepEqual(stable(actual), stable(expected), label);
}

function verifiedArtifact(input, descriptor, label) {
  const bytes = input?.bytes;
  if (!(Buffer.isBuffer(bytes) || typeof bytes === 'string'))
    reject(`${label} bytes are required for hash recomputation.`);
  const buffer = Buffer.from(bytes);
  if (buffer.length < 1 || buffer.length > MAX_DIAGNOSTIC_BYTES)
    reject(`${label} size is outside the accepted bound.`);
  const actual = createHash('sha256').update(buffer).digest('hex');
  if (!SHA256.test(descriptor?.sha256 || '') || actual !== descriptor.sha256)
    reject(`${label} SHA-256 does not match its pinned digest.`);
  let report;
  try {
    report = JSON.parse(buffer.toString('utf8'));
  } catch {
    reject(`${label} is not valid JSON.`);
  }
  if (!report || typeof report !== 'object' || Array.isArray(report))
    reject(`${label} must contain a JSON object.`);
  return { report, sha256: actual };
}

function conditionProjection(sample) {
  const result = {};
  for (const boundary of ['before', 'after']) {
    const conditions = sample?.conditions?.[boundary];
    if (!conditions) reject(`capture ${boundary} conditions are missing.`);
    const comparable = comparableCaptureConditions(conditions, 'manual');
    if (comparable?.environment) delete comparable.environment.appCommit;
    result[boundary] = comparable;
  }
  return result;
}

function environmentProjection(report) {
  const environment = report?.environment;
  const profile = environment?.nativeSharpnessProfile;
  if (
    !environment ||
    typeof environment.userAgent !== 'string' ||
    typeof environment.platform !== 'string' ||
    typeof environment.renderer !== 'string' ||
    typeof environment.vendor !== 'string' ||
    !environment.viewport ||
    !environment.drawingBuffer ||
    profile?.id !== 'native-sharpness-v1'
  )
    reject('native browser/settings identity is incomplete.');
  return {
    userAgent: environment.userAgent,
    platform: environment.platform,
    renderer: environment.renderer,
    vendor: environment.vendor,
    viewport: environment.viewport,
    drawingBuffer: environment.drawingBuffer,
    nativeSharpnessProfile: profile,
  };
}

function assertCleanBuild(report, expectedAppSha, disposition, label) {
  const source = report?.source;
  const provenance = source?.buildProvenance;
  if (
    report?.schema !== CAPTURE_SCHEMA ||
    source?.appCommit !== expectedAppSha ||
    source?.harnessCommit !== disposition.captureHarnessCommit ||
    source?.buildHarnessCommit !== disposition.buildHarnessCommit ||
    source?.harnessDirtyWorktree !== false ||
    source?.appWorktreeState !== 'clean' ||
    provenance?.status !==
      'verified-local-build-and-served-assets-before-and-after' ||
    provenance?.appCommit !== expectedAppSha ||
    provenance?.harnessCommit !== disposition.buildHarnessCommit ||
    provenance?.captureProducerCommit !== disposition.captureHarnessCommit ||
    provenance?.buildHarnessCommit !== disposition.buildHarnessCommit ||
    provenance?.before?.status !== 'served-assets-match' ||
    provenance?.after?.status !== 'served-assets-match' ||
    provenance?.before?.receiptSha256 !== provenance?.after?.receiptSha256
  )
    reject(`${label} source/build provenance is missing or mismatched.`);
}

function assertPhaseEvidence(report, sample, balancedReport, label) {
  const protocol = report?.workload?.weatherIdleDiagnosticProtocol;
  const expectedSchedule =
    balancedReport?.workload?.weatherEffectsFixtureLifecycle?.phaseSchedule;
  const observed = sample?.weatherPhaseObservations;
  const summary = sample?.weatherIdleDiagnostic;
  if (
    !protocol ||
    protocol.schema !== IDLE_DIAGNOSTIC_SCHEMA ||
    protocol.performanceAcceptanceEligible !== false ||
    protocol.fixtureSha256 !== createWeatherEffectsWorkloadFixture().sha256 ||
    !expectedSchedule
  )
    reject(`${label} phase protocol/fixture identity is missing.`);
  equal(
    protocol.phaseSchedule,
    expectedSchedule,
    `${label} phase schedule differs`,
  );
  if (
    observed?.schema !== 'gev-weather-phase-observations/v1' ||
    observed.durationMs !== 60_000 ||
    observed.fixtureSha256 !== protocol.fixtureSha256 ||
    !Array.isArray(observed.phases) ||
    observed.phases.length !== EXPECTED_PHASE_IDS.length ||
    !Array.isArray(summary?.phaseRequests) ||
    summary.phaseRequests.length !== EXPECTED_PHASE_IDS.length ||
    !Array.isArray(summary?.phases) ||
    summary.phases.length !== EXPECTED_PHASE_IDS.length
  )
    reject(`${label} did not record all three weather phase transitions.`);
  const maxLateness = expectedSchedule.maximumLatenessMs;
  for (let index = 0; index < EXPECTED_PHASE_IDS.length; index += 1) {
    const expected = expectedSchedule.phases[index];
    const phase = observed.phases[index];
    const request = summary.phaseRequests[index];
    const summarized = summary.phases[index];
    if (
      expected?.id !== EXPECTED_PHASE_IDS[index] ||
      phase?.id !== expected.id ||
      phase.expectedSourceTime !== expected.sourceTime ||
      phase.scheduledAtMs !== expected.offsetMs ||
      phase.fixtureSha256 !== protocol.fixtureSha256 ||
      phase.clock?.mode !== 'history' ||
      phase.clock?.playing !== false ||
      !Array.isArray(phase.sourceObservationTimes) ||
      phase.sourceObservationTimes.length !== 3 ||
      phase.sourceObservationTimes.some(
        (time) => time !== expected.sourceTime,
      ) ||
      !finite(phase.observedAtElapsedMs) ||
      phase.observedAtElapsedMs < expected.offsetMs ||
      phase.observedAtElapsedMs > expected.offsetMs + maxLateness ||
      request?.phaseId !== expected.id ||
      request.status !== 'fulfilled' ||
      !finite(request.requestHostPerformanceNowMs) ||
      !finite(request.completionHostPerformanceNowMs) ||
      request.completionHostPerformanceNowMs <
        request.requestHostPerformanceNowMs ||
      request.pageObservedCompletionElapsedMs !== phase.observedAtElapsedMs ||
      summarized?.id !== expected.id ||
      summarized.scheduledTargetElapsedMs !== expected.offsetMs ||
      summarized.pageObservedCompletionElapsedMs !== phase.observedAtElapsedMs
    )
      reject(
        `${label} ${expected.id} phase is missing, late, or inconsistent.`,
      );
  }
  if (
    protocol.phaseObservationsBySample?.length !== 1 ||
    protocol.phaseRequestsBySample?.length !== 1
  )
    reject(`${label} phase protocol contains missing/extra samples.`);
  equal(
    protocol.phaseObservationsBySample[0],
    summary.phases,
    `${label} phase summary copy differs`,
  );
  equal(
    protocol.phaseRequestsBySample[0],
    summary.phaseRequests,
    `${label} phase request copy differs`,
  );
}

function assertGovernorModeTrace(trace, durationMs, label) {
  if (
    trace?.schema !== MODE_TRACE_SCHEMA ||
    trace.installed !== true ||
    trace.status !== 'completed' ||
    trace.descriptorKind !== 'data' ||
    trace.descriptorConfigurable !== true ||
    trace.descriptorWritable !== true ||
    trace.initialValue !== true ||
    trace.finalValue !== true ||
    !finite(trace.startAtMs) ||
    !finite(trace.endAtMs) ||
    trace.endAtMs <= trace.startAtMs ||
    trace.endAtMs - trace.startAtMs < durationMs ||
    trace.eventsOmitted !== 0 ||
    trace.ownershipReplaced !== false ||
    trace.nonBooleanWriteObserved !== false ||
    trace.cleanup?.attempted !== true ||
    trace.cleanup?.descriptorRestored !== true ||
    trace.cleanup?.descriptorVerified !== true ||
    trace.cleanup?.windowBindingRestored !== true ||
    !Array.isArray(trace.events) ||
    trace.eventsObserved !== trace.events.length
  )
    reject(`${label} governor-mode write trace is incomplete or unclean.`);
  let previousAt = -1;
  for (const event of trace.events) {
    if (
      !finite(event?.atMs) ||
      event.atMs < previousAt ||
      event.atMs < 0 ||
      event.atMs > trace.endAtMs - trace.startAtMs ||
      event.value !== true
    )
      reject(`${label} observed continuous governor mode or malformed writes.`);
    previousAt = event.atMs;
  }
}

function assertWindProbe(probe, label) {
  const expectedTiming = {
    settleMs: 2_000,
    unpausedMs: 3_000,
    pausedMs: 2_000,
    resumedMs: 3_000,
    timeoutMs: 30_000,
  };
  const commonValidation = validateVisibleWindProbeReport(probe);
  const before = probe?.camera?.before;
  const atProbe = probe?.camera?.probe;
  const restored = probe?.camera?.restored;
  const cameraCoordinatesMatch = (left, right) =>
    Boolean(
      left &&
      right &&
      finite(left.longitude) &&
      finite(left.latitude) &&
      finite(left.heading) &&
      finite(left.pitch) &&
      finite(left.roll) &&
      Math.abs(left.latitude - right.latitude) <= 1e-9 &&
      sameAngle(left.longitude, right.longitude) &&
      sameAngle(left.heading, right.heading) &&
      Math.abs(left.pitch - right.pitch) <= 1e-9 &&
      sameAngle(left.roll, right.roll),
    );
  const cameraPoseMatches = (left, right) =>
    cameraCoordinatesMatch(left, right) &&
    finite(left.altitudeMeters) &&
    finite(right.altitudeMeters) &&
    Math.abs(left.altitudeMeters - right.altitudeMeters) <= 1;
  if (
    probe?.schema !== WIND_PROBE_SCHEMA ||
    probe.diagnosticOnly !== true ||
    probe.performanceAcceptanceEligible !== false ||
    probe.status !== 'observed' ||
    probe.probeHeightMeters !== 60_000 ||
    JSON.stringify(probe.timing) !== JSON.stringify(expectedTiming) ||
    !finite(probe.totalElapsedMs) ||
    probe.totalElapsedMs <= 0 ||
    !Array.isArray(probe.failureReasons) ||
    probe.failureReasons.length !== 0 ||
    probe.cleanup?.attempted !== true ||
    probe.cleanup?.cameraRestored !== true ||
    probe.cleanup?.pauseRestored !== true ||
    probe.navigationOwnership?.moveAccepted !== true ||
    probe.navigationOwnership?.restoreAccepted !== true ||
    !cameraPoseMatches(before, restored) ||
    !cameraCoordinatesMatch(before, atProbe) ||
    Math.abs(atProbe.altitudeMeters - 60_000) > 5 ||
    probe.scene?.before?.settingsComplete !== true ||
    probe.scene?.after?.settingsComplete !== true ||
    JSON.stringify(probe.scene.before.enabledLayerIds) !==
      JSON.stringify(probe.scene.after.enabledLayerIds) ||
    JSON.stringify(probe.scene.before.populations) !==
      JSON.stringify(probe.scene.after.populations) ||
    JSON.stringify(probe.scene.before.settings) !==
      JSON.stringify(probe.scene.after.settings) ||
    JSON.stringify(probe.scene.before.viewport) !==
      JSON.stringify(probe.scene.after.viewport) ||
    probe.windParams?.before?.model !== probe.windParams?.after?.model ||
    probe.windParams?.before?.overlay !== probe.windParams?.after?.overlay ||
    probe.windParams?.before?.units !== probe.windParams?.after?.units ||
    probe.windParams?.before?.paused !== probe.windParams?.after?.paused ||
    !Array.isArray(probe.invariantChecks) ||
    probe.invariantChecks.length < 5 ||
    probe.invariantChecks.some(
      (check) =>
        check.sceneUnchanged !== true || check.windSettingsUnchanged !== true,
    ) ||
    commonValidation.valid !== true
  )
    reject(`${label} separate visible-wind restoration probe failed.`);
  const phase = (name, expectedPaused, shouldAdvance) => {
    const record = probe.phases?.[name];
    const expectedDurationMs = expectedTiming[`${name}Ms`];
    const start = record?.start;
    const end = record?.end;
    const startGpu = start?.diagnostics?.gpu;
    const endGpu = end?.diagnostics?.gpu;
    if (
      !record ||
      record.durationMs !== expectedDurationMs ||
      !Number.isSafeInteger(record.postRenderCount) ||
      record.postRenderCount < (name === 'paused' ? 0 : 1) ||
      record.framesOmitted !== 0 ||
      !Array.isArray(record.frames) ||
      record.frames.length !== record.postRenderCount ||
      record.frames.some(
        (frame) =>
          !finite(frame?.atMs) ||
          frame.atMs < 0 ||
          frame.atMs > probe.totalElapsedMs ||
          frame.windMaterial?.matchCount !== 1 ||
          !finite(frame.windMaterial?.phaseTime) ||
          !(frame.windMaterial?.heightFade > 0),
      ) ||
      start?.diagnostics?.paused !== expectedPaused ||
      end?.diagnostics?.paused !== expectedPaused ||
      start?.diagnostics?.renderMode !== 'gpu-streamlines' ||
      end?.diagnostics?.renderMode !== 'gpu-streamlines' ||
      startGpu?.ready !== true ||
      endGpu?.ready !== true ||
      !(startGpu.pathCount > 0) ||
      !(endGpu.pathCount > 0) ||
      !(startGpu.visibleCells > 0) ||
      !(endGpu.visibleCells > 0) ||
      !(startGpu.visibleVertexCount > 0) ||
      !(endGpu.visibleVertexCount > 0) ||
      !(startGpu.heightFade > 0) ||
      !(endGpu.heightFade > 0) ||
      !finite(start?.windMaterial?.phaseTime) ||
      !finite(end?.windMaterial?.phaseTime) ||
      start.windMaterial.matchCount !== 1 ||
      end.windMaterial.matchCount !== 1 ||
      (shouldAdvance
        ? end.windMaterial.phaseTime <= start.windMaterial.phaseTime
        : end.windMaterial.phaseTime !== start.windMaterial.phaseTime)
    )
      reject(`${label} ${name} visible-wind phase witness is invalid.`);
  };
  phase('unpaused', false, true);
  phase('paused', true, false);
  phase('resumed', false, true);
  const observedFrameTimes = ['unpaused', 'paused', 'resumed'].flatMap((name) =>
    probe.phases[name].frames.map((frame) => frame.atMs),
  );
  if (
    observedFrameTimes.some(
      (time, index) => index > 0 && time <= observedFrameTimes[index - 1],
    )
  )
    reject(`${label} visible-wind frame timestamps are not monotonic.`);
}

function assertIdleSample(
  report,
  balancedReport,
  expectedAppSha,
  disposition,
  label,
) {
  assertCleanBuild(report, expectedAppSha, disposition, label);
  if (
    report.comparisonEligible !== false ||
    report.integrity?.status !== 'passed' ||
    report.integrity?.sampleCount !== 1 ||
    report.fixtureDelivery?.schema !==
      'gev-weather-effects-fixture-delivery/v2' ||
    report.fixtureDelivery?.status !== 'observed' ||
    report.fixtureDelivery?.fixtureSha256 !== fixture.sha256 ||
    report.fixtureDelivery?.fixtureId !== fixture.id ||
    report.fixtureDelivery?.fixedTime !== fixture.fixedTime ||
    !Array.isArray(report.fixtureDelivery?.routeErrors) ||
    report.fixtureDelivery.routeErrors.length !== 0 ||
    report.environment?.focused !== true ||
    report.environment?.visible !== true ||
    report.workload?.diagnosticOnly !== true ||
    report.workload?.performanceAcceptanceEligible !== false ||
    report.workload?.ineligibleReason !==
      'weather-idle-render-demand-diagnostic-is-diagnostic-only' ||
    report.workload?.weatherEffectsCaptureMode !==
      'idle-render-demand-diagnostic' ||
    report.workload?.providerFixture !== FIXTURE_ID ||
    report.workload?.fixtureId !== FIXTURE_ID ||
    report.workload?.warmupMs !== 30_000 ||
    report.workload?.durationPerSampleMs !== 60_000 ||
    report.workload?.runsPerScenario !== 1 ||
    !Array.isArray(report.captures) ||
    report.captures.length !== 1 ||
    !Array.isArray(report.workload?.rendererProbeCleanup) ||
    report.workload.rendererProbeCleanup.some(
      (cleanup) => cleanup.confirmed !== true,
    ) ||
    !Array.isArray(report.workload?.fixtureInterceptionReleases) ||
    report.workload.fixtureInterceptionReleases.length < 1 ||
    report.workload.fixtureInterceptionReleases.some(
      (release) =>
        release.confirmed !== true ||
        release.targetClosed !== true ||
        release.stop?.confirmed !== true,
    )
  )
    reject(`${label} is not one exact diagnostic-only idle capture.`);
  const sample = report.captures[0];
  if (
    sample.scenario !== 'idle' ||
    sample.run !== 1 ||
    !finite(sample.durationMs) ||
    sample.durationMs < 60_000 ||
    sample.foregroundThroughout !== true ||
    sample.focusContinuity?.focusedAtStart !== true ||
    sample.focusContinuity?.focusedAtEnd !== true ||
    sample.focusContinuity?.interruptionCount !== 0 ||
    sample.visibilityContinuity?.visibleThroughout !== true ||
    sample.renderDemandOwnership?.restored !== true ||
    sample.cameraPath?.id !== 'parked-v1'
  )
    reject(`${label} idle sample lifecycle/foreground evidence is invalid.`);
  const camera = report.workload?.weatherEffectsFixtureLifecycle?.camera;
  const observedCamera =
    report.workload?.weatherEffectsFixtureLifecycle?.observedCamera;
  const balancedCamera =
    balancedReport.workload?.weatherEffectsFixtureLifecycle?.camera;
  if (!balancedCamera) reject(`${label} full-qualification camera is missing.`);
  equal(
    camera,
    balancedCamera,
    `${label} fixture camera differs from full pair`,
  );
  if (
    camera?.id !== 'austin-weather-oblique-v1' ||
    camera.altitudeM !== 12_000 ||
    !finite(observedCamera?.altitudeM) ||
    !finite(observedCamera?.longitudeDeg) ||
    !finite(observedCamera?.latitudeDeg) ||
    !finite(observedCamera?.headingDeg) ||
    !finite(observedCamera?.pitchDeg) ||
    Math.abs(observedCamera.altitudeM - camera.altitudeM) > 1 ||
    Math.abs(observedCamera.longitudeDeg - camera.longitudeDeg) > 1e-6 ||
    Math.abs(observedCamera.latitudeDeg - camera.latitudeDeg) > 1e-6 ||
    Math.abs(observedCamera.headingDeg - camera.headingDeg) > 1e-6 ||
    Math.abs(observedCamera.pitchDeg - camera.pitchDeg) > 1e-6 ||
    report.workload?.weatherIdleDiagnosticProtocol?.fixtureSha256 !==
      fixture.sha256
  )
    reject(`${label} fixed 12km fixture camera identity is invalid.`);
  equal(
    report.fixtureDelivery.phaseSchedule,
    balancedReport.workload.weatherEffectsFixtureLifecycle.phaseSchedule,
    `${label} fulfilled fixture phase schedule differs from full pair`,
  );
  if (
    !Array.isArray(report.fixtureDelivery.assets) ||
    report.fixtureDelivery.assets.length !== fixture.assets.length
  )
    reject(`${label} fulfilled weather asset list is incomplete.`);
  for (let index = 0; index < fixture.assets.length; index += 1) {
    const expected = fixture.assets[index];
    const observed = report.fixtureDelivery.assets[index];
    if (
      observed?.id !== expected.id ||
      observed?.sha256 !== expected.sha256 ||
      observed?.byteLength !== expected.byteLength ||
      observed?.contentType !== expected.contentType ||
      !Number.isSafeInteger(observed?.responseCount) ||
      observed.responseCount < 1
    )
      reject(`${label} fulfilled weather asset receipt is invalid.`);
  }
  const balancedIdle = balancedReport.captures?.find(
    (capture) => capture.scenario === 'idle',
  );
  if (!balancedIdle)
    reject(`${label} full-qualification settings are missing.`);
  equal(
    conditionProjection(sample),
    conditionProjection(balancedIdle),
    `${label} diagnostic settings differ from its fully qualified role`,
  );
  assertPhaseEvidence(report, sample, balancedReport, label);

  const diagnostic = sample.weatherIdleDiagnostic;
  const instrumentation = diagnostic?.instrumentation;
  const frames = diagnostic?.frameEvents;
  const governorSamples = diagnostic?.governorSamples;
  if (
    diagnostic?.schema !== IDLE_DIAGNOSTIC_SCHEMA ||
    diagnostic.diagnosticOnly !== true ||
    diagnostic.performanceAcceptanceEligible !== false ||
    diagnostic.requestAttribution?.directWindSceneRequestRenderCaptured !==
      false ||
    instrumentation?.samplePeriodMs !== 250 ||
    !finite(instrumentation.samplingMaxGapMs) ||
    instrumentation.frameEventsOmitted !== 0 ||
    instrumentation.governorSamplesOmitted !== 0 ||
    instrumentation.snapshotReadFailureCount !== 0 ||
    instrumentation.phaseRequestEventsOmitted !== 0 ||
    instrumentation.gapsOverOneSecondOmitted !== 0 ||
    instrumentation.governorModeTraceEventsOmitted !== 0 ||
    instrumentation.governorModeTraceCleanupVerified !== true ||
    !Number.isSafeInteger(instrumentation.governorModeTraceEventsObserved) ||
    instrumentation.governorModeTraceEventsRecorded !==
      diagnostic?.governorModeTrace?.events?.length ||
    instrumentation.governorModeTraceEventsObserved !==
      diagnostic?.governorModeTrace?.eventsObserved ||
    !Array.isArray(frames) ||
    frames.length < 2 ||
    frames.length !== instrumentation.frameEventsRecorded ||
    frames.length !== instrumentation.frameEventsObserved ||
    !Array.isArray(governorSamples) ||
    governorSamples.length < 2 ||
    governorSamples.length !== instrumentation.governorSamplesRecorded ||
    governorSamples.length !== instrumentation.governorSamplesObserved
  )
    reject(
      `${label} idle trace has missing samples, read errors, or omissions.`,
    );
  const sampleTimes = governorSamples.map((entry) => entry.atMs);
  if (
    sampleTimes.some(
      (time, index) =>
        !finite(time) ||
        time < 0 ||
        time > sample.durationMs ||
        (index > 0 && time <= sampleTimes[index - 1]),
    ) ||
    sampleTimes[0] > instrumentation.samplePeriodMs ||
    sampleTimes.at(-1) < sample.durationMs - instrumentation.samplePeriodMs
  )
    reject(`${label} governor samples do not span the measurement window.`);
  const recomputedSampleGap = Math.max(
    ...sampleTimes.slice(1).map((time, index) => time - sampleTimes[index]),
  );
  if (Math.abs(recomputedSampleGap - instrumentation.samplingMaxGapMs) > 0.01)
    reject(`${label} samplingMaxGapMs does not match recorded samples.`);
  const frameTimes = frames.map((entry) => entry.atMs);
  if (
    frameTimes.some(
      (time, index) =>
        !finite(time) ||
        time < 0 ||
        time > sample.durationMs ||
        (index > 0 && time <= frameTimes[index - 1]),
    )
  )
    reject(`${label} frame observations do not span the measurement window.`);
  const assertFadedIdle = (entry) => {
    const governor = entry.governor;
    const wind = entry.windRenderer;
    const gpu = wind?.gpu;
    if (
      governor?.mode !== 'idle' ||
      !Array.isArray(governor.holds) ||
      governor.holds.length !== 0 ||
      wind?.renderMode !== 'gpu-streamlines' ||
      wind.paused !== false ||
      wind.reducedMotion !== false ||
      wind.hidden !== false ||
      gpu?.ready !== true ||
      gpu.heightFade !== 0 ||
      gpu.visibleCells !== 0 ||
      gpu.visibleVertexCount !== 0 ||
      !finite(gpu.displayHeightMeters) ||
      Math.abs(gpu.displayHeightMeters - 12_000) > 1
    )
      reject(
        `${label} did not show a faded wind renderer in idle governor mode.`,
      );
  };
  for (const entry of [...frames, ...governorSamples]) assertFadedIdle(entry);
  const modeTrace = diagnostic.governorModeTrace;
  assertGovernorModeTrace(modeTrace, 60_000, label);
  if (modeTrace.events.some((event) => event.value === false))
    reject(
      `${label} had a governor-managed continuous hold during measurement.`,
    );

  const gaps = diagnostic.gapsOverOneSecond;
  if (!Array.isArray(gaps))
    reject(`${label} idle frame-gap evidence is missing.`);
  const actualGaps = [];
  for (let index = 1; index < frames.length; index += 1) {
    const interval = frames[index].atMs - frames[index - 1].atMs;
    if (!finite(interval) || interval <= 0)
      reject(`${label} frame timestamps are invalid.`);
    if (interval > 1_000)
      actualGaps.push({
        startAtMs: frames[index - 1].atMs,
        endAtMs: frames[index].atMs,
        intervalMs: interval,
      });
  }
  if (gaps.length !== actualGaps.length)
    reject(`${label} >1s frame gaps are omitted or duplicated.`);
  for (let index = 0; index < gaps.length; index += 1) {
    const gap = gaps[index];
    const actual = actualGaps[index];
    if (
      gap.startAtMs !== actual.startAtMs ||
      gap.endAtMs !== actual.endAtMs ||
      Math.abs(gap.intervalMs - actual.intervalMs) > 0.01 ||
      gap.continuousDemandDuringGap !== 'observed-absent' ||
      gap.windRenderingAssessment !== 'gpu-streamlines-fully-faded' ||
      gap.windRendererObservationsOmitted !== 0 ||
      gap.observedGovernorStateCount !==
        2 +
          governorSamples.filter(
            (entry) => entry.atMs >= gap.startAtMs && entry.atMs <= gap.endAtMs,
          ).length ||
      JSON.stringify(gap.observedModes) !== '["idle"]' ||
      JSON.stringify(gap.observedHolds) !== '[]'
    )
      reject(
        `${label} long frame gap lacks complete sampled idle/fade evidence.`,
      );
  }
  assertWindProbe(sample.weatherVisibleWindProbe, label);
  return {
    report,
    sample,
    environment: environmentProjection(report),
    modeTraceEventCount: modeTrace.events.length,
    samplingMaxGapMs: instrumentation.samplingMaxGapMs,
    sampledFrameCount: frames.length,
    sampledGovernorCount: governorSamples.length,
    visibleWindProbeStatus: sample.weatherVisibleWindProbe.status,
  };
}

/**
 * This resolves interpretation of the idle p95 metric only. It does not claim
 * performance improvement, GPU cost, or attribution of all frame requests.
 */
export function validateWeatherIdleCadenceDisposition({
  disposition,
  baselineDiagnostic,
  candidateDiagnostic,
  balancedReview,
} = {}) {
  if (
    disposition?.schema !== WEATHER_IDLE_CADENCE_DISPOSITION_SCHEMA ||
    disposition.metric !== WEATHER_IDLE_CADENCE_METRIC ||
    disposition.scenario !== 'idle' ||
    disposition.workloadId !== FIXTURE_ID
  )
    reject('schema, scenario, workload, or metric is unsupported.');
  if (
    !SHA1.test(disposition.baselineAppSha || '') ||
    !SHA1.test(disposition.candidateAppSha || '') ||
    disposition.baselineAppSha !==
      balancedReview?.controlReport?.source?.appCommit ||
    disposition.candidateAppSha !==
      balancedReview?.candidateReport?.source?.appCommit ||
    disposition.baselineAppSha === disposition.candidateAppSha ||
    !SHA1.test(disposition.captureHarnessCommit || '') ||
    !SHA1.test(disposition.buildHarnessCommit || '')
  )
    reject(
      'application or harness identities do not match the validated full pair.',
    );
  if (
    balancedReview?.status !== 'comparable' ||
    balancedReview.evidenceScope !==
      'balanced-five-pair-full-weather-qualification' ||
    balancedReview.scenarios?.idle?.status !== 'measured' ||
    balancedReview.scenarios?.idle?.regressionOver10Pct !== true ||
    balancedReview.scenarios?.['scripted-motion']?.status !== 'measured' ||
    balancedReview.scenarios?.['scripted-motion']?.regressionOver10Pct !==
      false ||
    balancedReview.regressionsOver10Pct?.length !== 1 ||
    balancedReview.regressionsOver10Pct[0] !== 'idle'
  )
    reject(
      'full balanced comparison is missing, failed, or has other regressions.',
    );
  const controlArtifact = verifiedArtifact(
    baselineDiagnostic,
    disposition.controlDiagnostic,
    'control diagnostic',
  );
  const candidateArtifact = verifiedArtifact(
    candidateDiagnostic,
    disposition.candidateDiagnostic,
    'candidate diagnostic',
  );
  if (
    typeof disposition.controlDiagnostic?.path !== 'string' ||
    !disposition.controlDiagnostic.path.trim() ||
    typeof disposition.candidateDiagnostic?.path !== 'string' ||
    !disposition.candidateDiagnostic.path.trim()
  )
    reject('diagnostic artifact paths are missing.');
  if (
    disposition.controlDiagnostic.path === disposition.candidateDiagnostic.path
  )
    reject('control and candidate diagnostic paths must be distinct.');

  const control = assertIdleSample(
    controlArtifact.report,
    balancedReview.controlReport,
    disposition.baselineAppSha,
    disposition,
    'control',
  );
  const candidate = assertIdleSample(
    candidateArtifact.report,
    balancedReview.candidateReport,
    disposition.candidateAppSha,
    disposition,
    'candidate',
  );
  equal(
    control.environment,
    candidate.environment,
    'native comparison environment differs',
  );
  equal(
    control.environment,
    environmentProjection({ environment: balancedReview.environment }),
    'idle diagnostic environment differs from full balanced pair',
  );
  equal(
    conditionProjection(control.sample),
    conditionProjection(candidate.sample),
    'idle diagnostic pair conditions differ',
  );
  return {
    status: 'validated-interpretation-only',
    resolvedScenarios: ['idle'],
    resolvedMetric: WEATHER_IDLE_CADENCE_METRIC,
    diagnosticOnly: true,
    performanceBenefitClaim: false,
    gpuCostClaim: false,
    directSceneRequestAttribution: false,
    samplingLimitations: {
      controlMaximumGapMs: control.samplingMaxGapMs,
      candidateMaximumGapMs: candidate.samplingMaxGapMs,
      maximumGapAcceptanceBound: null,
      note: 'Wind/frame observations remain sampled; observed sampling maximum gaps are reported without an invented acceptance threshold. The event trace covers governor-mode writes, not all scene.requestRender calls or frame causes.',
    },
    control: {
      rawSha256: controlArtifact.sha256,
      modeTraceEventCount: control.modeTraceEventCount,
      sampledFrameCount: control.sampledFrameCount,
      sampledGovernorCount: control.sampledGovernorCount,
      visibleWindProbeStatus: control.visibleWindProbeStatus,
    },
    candidate: {
      rawSha256: candidateArtifact.sha256,
      modeTraceEventCount: candidate.modeTraceEventCount,
      sampledFrameCount: candidate.sampledFrameCount,
      sampledGovernorCount: candidate.sampledGovernorCount,
      visibleWindProbeStatus: candidate.visibleWindProbeStatus,
    },
  };
}
