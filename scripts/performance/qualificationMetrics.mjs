import assert from 'node:assert/strict';

const METRIC_SCHEMA = 'gev-qualification-metrics/v1';
const INTERACTION_SCHEMA = 'gev-interaction-latency-evidence/v1';
const SAMPLED_HEAP_SCHEMA = 'gev-sampled-heap-evidence/v1';
const INTERACTION_SAMPLE_COUNT = 20;
const LOCAL_CONTROL_LIMIT_MS = 100;
const REPLAY_SEEK_LIMIT_MS = 250;
const STARTUP_REGRESSION_LIMIT_PCT = 10;
const REPLAY_COORDINATE_EPSILON_DEG = 1e-9;
const CAMERA_POSITION_TOLERANCE_DEG = 1e-6;
const CAMERA_ALTITUDE_TOLERANCE_M = 1;
const CAMERA_ANGLE_TOLERANCE_RAD = 1e-6;
const QUALIFICATION_VIEWPORT = Object.freeze({ width: 1440, height: 1000 });
const LOCAL_CONTROL_CAMERA_ROUTE_ID =
  'rendered-soak-driver-default-location-v1';
const LOCAL_CONTROL_CAMERA_LOCATION = Object.freeze({
  latitude: 40.7,
  longitude: -73.9,
  altitude: 1000,
});
const REPLAY_CAMERA_ROUTE_ID = 'rendered-soak-recording-region-v1';
const REPLAY_CAMERA_LOCATION = Object.freeze({
  latitude: 0,
  longitude: 179.7,
  altitude: 500_000,
});

function circularAngleDifference(left, right) {
  return Math.atan2(Math.sin(left - right), Math.cos(left - right));
}

function assertCameraPosesClose(left, right, message) {
  assert.ok(
    Math.abs(left.latitude - right.latitude) <= CAMERA_POSITION_TOLERANCE_DEG,
    `${message}: latitude differs`,
  );
  assert.ok(
    Math.abs(left.longitude - right.longitude) <= CAMERA_POSITION_TOLERANCE_DEG,
    `${message}: longitude differs`,
  );
  assert.ok(
    Math.abs(left.altitude - right.altitude) <= CAMERA_ALTITUDE_TOLERANCE_M,
    `${message}: altitude differs`,
  );
  for (const axis of ['heading', 'pitch', 'roll'])
    assert.ok(
      Math.abs(circularAngleDifference(left[axis], right[axis])) <=
        CAMERA_ANGLE_TOLERANCE_RAD,
      `${message}: ${axis} differs`,
    );
}

function assertRawCaptureIdentity(report, label) {
  const capture = report?.captures?.[0];
  const before = capture?.conditions?.before?.environment;
  const after = capture?.conditions?.after?.environment;
  const settingsBefore = capture?.settings?.before;
  const settingsAfter = capture?.settings?.after;
  const conditionSettingsBefore = capture?.conditions?.before?.settings;
  const conditionSettingsAfter = capture?.conditions?.after?.settings;
  assert.match(report?.source?.appCommit || '', /^[a-f0-9]{40}$/);
  assert.match(
    report?.graphics?.browserVersion || '',
    /^Chrome\/\d+\.\d+\.\d+\.\d+$/,
  );
  const browserMajor =
    report.graphics.browserVersion.match(/^Chrome\/(\d+)/)?.[1];
  assert.match(
    report?.environment?.userAgent || '',
    new RegExp(`Chrome/${browserMajor}\\.`),
  );
  assert.ok(report?.environment?.renderer, `${label} renderer is missing`);
  assert.ok(report?.environment?.userAgent, `${label} user agent is missing`);
  assert.ok(report?.environment?.platform, `${label} platform is missing`);
  assert.deepEqual(
    before?.nativeSharpnessProfile,
    settingsBefore?.nativeSharpnessProfile,
  );
  assert.deepEqual(
    after?.nativeSharpnessProfile,
    settingsAfter?.nativeSharpnessProfile,
  );
  assert.deepEqual(
    before?.nativeSharpnessProfile,
    conditionSettingsBefore?.nativeSharpnessProfile,
  );
  assert.deepEqual(
    after?.nativeSharpnessProfile,
    conditionSettingsAfter?.nativeSharpnessProfile,
  );
  assert.deepEqual(
    before?.nativeSharpnessProfile,
    after?.nativeSharpnessProfile,
  );
  assert.equal(settingsBefore?.resolutionScale, 1);
  assert.equal(settingsAfter?.resolutionScale, 1);
  assert.equal(conditionSettingsBefore?.resolutionScale, 1);
  assert.equal(conditionSettingsAfter?.resolutionScale, 1);
  const profile = before?.nativeSharpnessProfile;
  assert.equal(profile?.id, 'native-sharpness-v1');
  assert.equal(profile?.useBrowserRecommendedResolution, false);
  assert.equal(profile?.resolutionScale, 1);
  assert.equal(profile?.maximumScreenSpaceError, 1);
  assert.ok(profile.viewport?.width > 0 && profile.viewport?.height > 0);
  assert.ok(
    profile.drawingBuffer?.width > 0 && profile.drawingBuffer?.height > 0,
  );
  assert.deepEqual(profile.viewport, report.environment.viewport);
  assert.deepEqual(profile.drawingBuffer, report.environment.drawingBuffer);
  for (const [key, expected] of Object.entries({
    renderer: report.environment.renderer,
    userAgent: report.environment.userAgent,
    platform: report.environment.platform,
  })) {
    assert.equal(before?.[key], expected, `${label} before ${key} differs`);
    assert.equal(after?.[key], expected, `${label} after ${key} differs`);
  }
  assert.ok(
    settingsBefore && settingsAfter,
    `${label} raw settings are missing`,
  );
  return {
    applicationCommit: report.source.appCommit,
    browserVersion: report.graphics.browserVersion,
    renderer: report.environment.renderer,
    userAgent: report.environment.userAgent,
    platform: report.environment.platform,
    sourceProfile: profile,
  };
}

function assertStartupRunIdentity(report, label, expectedRunCount) {
  const startup = report?.environment?.startup;
  const runs = startup?.runs;
  assert.ok(
    Number.isSafeInteger(expectedRunCount) && expectedRunCount > 0,
    'Expected startup run count must be a positive integer',
  );
  assert.equal(
    startup?.runCount,
    expectedRunCount,
    `${label} startup run count must be ${expectedRunCount}`,
  );
  assert.equal(
    runs?.length,
    expectedRunCount,
    `${label} needs exactly ${expectedRunCount} startup records`,
  );
  assert.ok(startup?.measurement, `${label} startup measurement is missing`);
  for (let index = 0; index < runs.length; index++) {
    const run = runs[index];
    assert.equal(
      run.run,
      index + 1,
      `${label} startup run IDs must be ordered`,
    );
    assert.equal(run.cacheDisabled, true);
    assert.equal(run.focused, true);
    assert.equal(run.visible, true);
    assert.equal(run.foregroundActivation?.visible, true);
    assert.equal(run.foregroundActivation?.focused, true);
    assert.equal(run.foregroundActivation?.visibilityState, 'visible');
    const host = run.foregroundActivation?.hostWindowActivation;
    assert.equal(host?.status, 'foreground-confirmed');
    assert.equal(host?.foregroundConfirmed, true);
    assert.ok(Number.isSafeInteger(host?.browserPid) && host.browserPid > 0);
    assert.equal(host?.foregroundPid, host?.browserPid);
    assert.equal(run.userAgent, report.environment.userAgent);
    assert.equal(run.platform, report.environment.platform);
    assert.equal(run.renderer, report.environment.renderer);
    assert.deepEqual(run.viewport, report.environment.viewport);
    assert.deepEqual(run.drawingBuffer, report.environment.drawingBuffer);
    assert.ok(Number.isFinite(run.appReadyMs) && run.appReadyMs > 0);
    assert.ok(Number.isFinite(run.initialSettleMs) && run.initialSettleMs > 0);
  }
}

/**
 * Read one already-captured startup report without granting it comparison
 * eligibility. Balanced weather shards use this only after their parent
 * envelope and file hashes have been validated independently.
 */
export function readStartupObservation(report, { expectedRunCount } = {}) {
  assert.equal(
    report?.integrity?.status,
    'passed',
    'Startup raw capture integrity must be passed',
  );
  const identity = assertRawCaptureIdentity(report, 'Startup capture');
  assertStartupRunIdentity(report, 'Startup capture', expectedRunCount);
  const startup = report.environment.startup;
  return {
    applicationCommit: identity.applicationCommit,
    browserVersion: identity.browserVersion,
    renderer: identity.renderer,
    userAgent: identity.userAgent,
    platform: identity.platform,
    viewport: report.environment.viewport,
    drawingBuffer: report.environment.drawingBuffer,
    nativeSharpnessProfile: identity.sourceProfile,
    measurement: startup.measurement,
    runCount: startup.runCount,
    observations: startup.runs.map((run) => ({
      run: run.run,
      appReadyMs: run.appReadyMs,
      initialSettleMs: run.initialSettleMs,
      cacheDisabled: run.cacheDisabled,
      foregroundActivation: run.foregroundActivation,
    })),
  };
}

function assertBrowserClose(side, label) {
  assert.equal(
    side?.browserClose?.closeCompleted,
    true,
    `${label} browser did not close normally`,
  );
  assert.equal(
    side?.browserClose?.forcedProcessTermination,
    false,
    `${label} browser required forced termination`,
  );
}

function assertForegroundHostActivation(side, label) {
  const foreground = side?.foregroundIntegrity;
  assert.equal(
    foreground?.status,
    'completed',
    `${label} foreground evidence is incomplete`,
  );
  assert.equal(foreground?.hostActivation?.status, 'foreground-confirmed');
  assert.equal(foreground?.hostActivation?.foregroundConfirmed, true);
  assert.equal(
    foreground?.hostActivation?.foregroundPid,
    foreground?.browserPid,
  );
  assert.ok(
    Number.isSafeInteger(foreground?.browserPid) && foreground.browserPid > 0,
  );
  assert.ok(
    Array.isArray(foreground.observations) &&
      foreground.observations.length > 0,
  );
}

function assertForegroundIntegrity(side, label) {
  assertForegroundHostActivation(side, label);
  for (const observation of side.foregroundIntegrity.observations) {
    assert.equal(observation.visibilityState, 'visible');
    assert.equal(observation.focused, true);
  }
}

function median(values) {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

function p95(values) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(sorted.length * 0.95) - 1)];
}

function unavailable(reason) {
  return { status: 'unavailable', reason };
}

export function evaluateColdStartupReadiness(baseline, candidate) {
  for (const [label, report] of [
    ['baseline', baseline],
    ['candidate', candidate],
  ]) {
    if (
      report?.integrity?.status !== 'passed' ||
      report?.comparisonEligible !== true
    )
      return unavailable(
        `${label} raw capture is not integrity-passed and comparison-eligible.`,
      );
  }
  const baselineWorkloadId = baseline?.comparisonContract?.workloadId;
  const candidateWorkloadId = candidate?.comparisonContract?.workloadId;
  if (!baselineWorkloadId || baselineWorkloadId !== candidateWorkloadId)
    return unavailable(
      'Baseline and candidate workload identities differ or are missing.',
    );
  if (
    baseline?.workload?.fixtureId !== candidate?.workload?.fixtureId ||
    !baseline?.workload?.fixtureId
  )
    return unavailable(
      'Baseline and candidate fixture identities differ or are missing.',
    );
  let baselineIdentity;
  let candidateIdentity;
  try {
    baselineIdentity = assertRawCaptureIdentity(baseline, 'Baseline');
    candidateIdentity = assertRawCaptureIdentity(candidate, 'Candidate');
    assertStartupRunIdentity(baseline, 'Baseline', 5);
    assertStartupRunIdentity(candidate, 'Candidate', 5);
  } catch (error) {
    return unavailable(error.message);
  }
  if (
    baselineIdentity.browserVersion !== candidateIdentity.browserVersion ||
    baselineIdentity.renderer !== candidateIdentity.renderer ||
    baselineIdentity.userAgent !== candidateIdentity.userAgent ||
    baselineIdentity.platform !== candidateIdentity.platform ||
    JSON.stringify(baseline.environment.viewport) !==
      JSON.stringify(candidate.environment.viewport) ||
    JSON.stringify(baseline.environment.drawingBuffer) !==
      JSON.stringify(candidate.environment.drawingBuffer) ||
    JSON.stringify(baselineIdentity.sourceProfile) !==
      JSON.stringify(candidateIdentity.sourceProfile)
  )
    return unavailable(
      'Browser, renderer, profile, or dimensions differ between startup captures.',
    );
  if (
    !/^[a-f0-9]{40}$/.test(baseline?.source?.appCommit || '') ||
    !/^[a-f0-9]{40}$/.test(candidate?.source?.appCommit || '') ||
    baseline.source.appCommit === candidate.source.appCommit
  )
    return unavailable(
      'Startup capture application revisions are missing or not a distinct pair.',
    );
  const baseRuns = baseline?.environment?.startup?.runs;
  const candidateRuns = candidate?.environment?.startup?.runs;
  const baseTimes = baseRuns.map((run) => run.appReadyMs);
  const candidateTimes = candidateRuns.map((run) => run.appReadyMs);
  const baseSettleTimes = baseRuns.map((run) => run.initialSettleMs);
  const candidateSettleTimes = candidateRuns.map((run) => run.initialSettleMs);
  if (
    [
      ...baseTimes,
      ...candidateTimes,
      ...baseSettleTimes,
      ...candidateSettleTimes,
    ].some((value) => !Number.isFinite(value) || value <= 0)
  )
    return unavailable(
      'One or more startup app-ready timings are missing or invalid.',
    );
  if (
    baseline.environment.startup.measurement !==
    candidate.environment.startup.measurement
  )
    return unavailable('Startup measurement methods differ between builds.');

  const baselineMedianMs = median(baseTimes);
  const candidateMedianMs = median(candidateTimes);
  const baselineSettleMedianMs = median(baseSettleTimes);
  const candidateSettleMedianMs = median(candidateSettleTimes);
  const changePct =
    ((candidateMedianMs - baselineMedianMs) / baselineMedianMs) * 100;
  const regressionOver10Pct = changePct > STARTUP_REGRESSION_LIMIT_PCT;
  const settleChangePct =
    ((candidateSettleMedianMs - baselineSettleMedianMs) /
      baselineSettleMedianMs) *
    100;
  const settleRegressionOver10Pct =
    settleChangePct > STARTUP_REGRESSION_LIMIT_PCT;
  const startupFailed = regressionOver10Pct || settleRegressionOver10Pct;
  return {
    status: startupFailed ? 'failed' : 'measured',
    semantic:
      'navigation-to-viewer-existence and navigation-to-loading-screen-hidden; neither proves all source tiles ready or local UI activation',
    baselineMedianMs,
    candidateMedianMs,
    baselineInitialSettleMedianMs: baselineSettleMedianMs,
    candidateInitialSettleMedianMs: candidateSettleMedianMs,
    initialSettleChangePct: settleChangePct,
    initialSettleRegressionOver10Pct: settleRegressionOver10Pct,
    baselineRunsMs: baseTimes,
    candidateRunsMs: candidateTimes,
    changePct,
    regressionOver10Pct,
    thresholdPct: STARTUP_REGRESSION_LIMIT_PCT,
  };
}

function captureIdentity(report, label) {
  return assertRawCaptureIdentity(report, label);
}

function validateIdentityAgainstCapture(side, expected, label) {
  assert.ok(
    side?.applicationCommit != null,
    `${label} evidence applicationCommit is missing`,
  );
  assert.equal(
    side?.applicationCommit,
    expected.applicationCommit,
    `${label} evidence applicationCommit must match its raw input capture`,
  );
  assert.equal(
    side?.identity?.applicationCommit,
    expected.applicationCommit,
    `${label} evidence identity applicationCommit must match its raw input capture`,
  );
  for (const key of [
    'applicationCommit',
    'browserVersion',
    'renderer',
    'userAgent',
    'platform',
  ]) {
    assert.ok(
      side?.identity?.[key] != null,
      `${label} identity is missing ${key}`,
    );
    assert.deepEqual(
      side?.identity?.[key],
      expected[key],
      `${label} identity ${key} must match its raw input capture`,
    );
  }
  const identity = side.identity;
  assert.deepEqual(identity.viewport, {
    ...QUALIFICATION_VIEWPORT,
    dpr: expected.sourceProfile.viewport.dpr,
  });
  assert.deepEqual(identity.drawingBuffer, {
    width: Math.floor(
      QUALIFICATION_VIEWPORT.width * expected.sourceProfile.viewport.dpr,
    ),
    height: Math.floor(
      QUALIFICATION_VIEWPORT.height * expected.sourceProfile.viewport.dpr,
    ),
  });
  assert.deepEqual(identity.nativeSharpnessProfile, {
    ...expected.sourceProfile,
    viewport: identity.viewport,
    drawingBuffer: identity.drawingBuffer,
  });
  assert.ok(
    identity.settings && typeof identity.settings === 'object',
    `${label} effective measurement settings are missing`,
  );
  assert.deepEqual(
    identity.settingsAfter,
    identity.settings,
    `${label} effective settings changed during the measured workload`,
  );
  assert.deepEqual(
    identity.nativeSharpnessProfileAfter,
    identity.nativeSharpnessProfile,
    `${label} native profile changed during the workload`,
  );
  assert.equal(identity.settings.qualityMode, 'manual');
  assert.equal(identity.settings.detectionMode, 'DENSE');
  assert.equal(identity.settings.densityPct, 75);
  assert.equal(identity.settings.resolutionScale, 1);
  assert.equal(typeof identity.settings.antialias, 'boolean');
  assert.ok(Number.isFinite(identity.settings.msaaSamples));
  assert.equal(typeof identity.settings.fxaa, 'boolean');
}

function assertSharedPairIdentity(baseline, candidate, label) {
  for (const key of [
    'browserVersion',
    'renderer',
    'userAgent',
    'platform',
    'fixtureId',
    'fixtureSha256',
    'routeId',
    'viewport',
    'drawingBuffer',
    'nativeSharpnessProfile',
    'settings',
  ])
    assert.deepEqual(
      baseline?.identity?.[key],
      candidate?.identity?.[key],
      `${label} ${key} differs between builds`,
    );
  assert.notEqual(
    baseline?.identity?.applicationCommit,
    candidate?.identity?.applicationCommit,
    `${label} must identify distinct application builds`,
  );
  for (const key of ['fixtureId', 'fixtureSha256', 'routeId']) {
    assert.ok(baseline?.identity?.[key], `${label} baseline ${key} missing`);
    assert.deepEqual(
      baseline.identity[key],
      candidate?.identity?.[key],
      `${label} fixture/route ${key} differs between builds`,
    );
  }
  assert.match(baseline.identity.fixtureSha256, /^[a-f0-9]{64}$/);
}

function validateInteractionSide(side, label) {
  assert.ok(Array.isArray(side), `${label} samples must be an array`);
  assert.equal(
    side.length,
    INTERACTION_SAMPLE_COUNT,
    `${label} requires exactly ${INTERACTION_SAMPLE_COUNT} recorded samples`,
  );
  const ids = new Set();
  let previousInputAtMs = -1;
  let previousRenderedFrame = -1;
  return side.map((sample, index) => {
    assert.equal(typeof sample?.sampleId, 'string');
    assert.ok(sample.sampleId.length > 0);
    assert.equal(
      ids.has(sample.sampleId),
      false,
      `${label} sample IDs must be unique`,
    );
    ids.add(sample.sampleId);
    assert.equal(
      sample?.stateObserved,
      true,
      `${label} sample ${index + 1} must observe application state`,
    );
    assert.equal(
      sample?.renderedFrameObserved,
      true,
      `${label} sample ${index + 1} must observe a completed rendered frame`,
    );
    assert.equal(
      sample?.renderWitnessType,
      'requested-post-state-render',
      `${label} sample ${index + 1} must identify its fresh-frame witness`,
    );
    const { inputAtMs, stateAtMs, renderedFrameAtMs } = sample;
    assert.ok(
      Number.isFinite(inputAtMs) &&
        Number.isFinite(stateAtMs) &&
        Number.isFinite(renderedFrameAtMs) &&
        inputAtMs >= 0 &&
        stateAtMs >= inputAtMs &&
        renderedFrameAtMs >= stateAtMs,
      `${label} sample ${index + 1} timestamps must be ordered and finite`,
    );
    assert.ok(
      inputAtMs > previousInputAtMs,
      `${label} input timestamps must advance`,
    );
    previousInputAtMs = inputAtMs;
    assert.ok(Number.isSafeInteger(sample.frameNumberAtState));
    assert.ok(Number.isSafeInteger(sample.frameNumberAtRendered));
    assert.ok(
      sample.frameNumberAtRendered > sample.frameNumberAtState,
      `${label} rendered frame must follow the state frame`,
    );
    assert.ok(
      sample.frameNumberAtRendered > previousRenderedFrame,
      `${label} frame sequence must advance`,
    );
    previousRenderedFrame = sample.frameNumberAtRendered;
    if (label.startsWith('localControl')) {
      assert.equal(typeof sample.expectedLayerEnabled, 'boolean');
      assert.equal(sample.layerEnabledObserved, sample.expectedLayerEnabled);
      assert.equal(sample.layerVisibleObserved, sample.expectedLayerEnabled);
      assert.equal(
        sample.layerRenderablesObserved,
        sample.expectedLayerEnabled,
      );
      assert.ok(
        Number.isInteger(sample.loadedRecordCount) &&
          (sample.expectedLayerEnabled
            ? sample.loadedRecordCount > 0
            : sample.loadedRecordCount === 0),
      );
      assert.ok(
        Number.isInteger(sample.renderableCount) &&
          (sample.expectedLayerEnabled
            ? sample.renderableCount > 0
            : sample.renderableCount === 0),
      );
    }
    assert.equal(sample.visibilityState, 'visible');
    assert.equal(sample.focused, true);
    if (label.startsWith('loadedReplaySeek')) {
      assert.equal(sample.selectedSourceMode, 'recorded');
      assert.equal(sample.recordingId, 'recording-rendered-soak');
      assert.equal(sample.fixtureRecordCount, 5);
      assert.equal(sample.fixtureAircraftId, 'SYNTH-001');
      assert.ok(Number.isFinite(sample.coverageFromMs));
      assert.ok(sample.coverageToMs > sample.coverageFromMs);
      assert.ok([0, 3].includes(sample.expectedFixtureIndex));
      const expectedPositionTime =
        sample.expectedFixtureIndex === 3
          ? sample.coverageToMs
          : sample.coverageFromMs;
      const expectedLatitude =
        Math.sin(sample.expectedFixtureIndex / 10) * 0.02;
      const expectedLongitude =
        ((((179.7 + sample.expectedFixtureIndex * 0.01 + 180) % 360) + 360) %
          360) -
        180;
      assert.equal(sample.positionTimeMs, expectedPositionTime);
      assert.ok(
        Math.abs(sample.fixtureAircraftLatitude - expectedLatitude) < 1e-12,
      );
      assert.ok(
        Math.abs(sample.fixtureAircraftLongitude - expectedLongitude) < 1e-12,
      );
      assert.ok(Number.isFinite(sample.positionTimeMs));
      assert.ok(Number.isFinite(sample.previousPositionTimeMs));
      assert.notEqual(sample.positionTimeMs, sample.previousPositionTimeMs);
      assert.ok(Number.isFinite(sample.fixtureAircraftLatitude));
      assert.ok(Number.isFinite(sample.fixtureAircraftLongitude));
      assert.equal(
        sample.renderedBillboardVisible,
        true,
        `${label} sample ${index + 1} must show its rendered aircraft`,
      );
      assert.equal(
        sample.renderedBillboardId,
        sample.fixtureAircraftId,
        `${label} sample ${index + 1} billboard identity must match`,
      );
      assert.equal(
        sample.renderedRecordPositionTimeMs,
        sample.positionTimeMs,
        `${label} sample ${index + 1} rendered layer time must match`,
      );
      assert.ok(
        Number.isFinite(sample.renderedRecordLatitude) &&
          Math.abs(
            sample.renderedRecordLatitude - sample.fixtureAircraftLatitude,
          ) <= REPLAY_COORDINATE_EPSILON_DEG,
        `${label} sample ${index + 1} rendered latitude must match`,
      );
      assert.ok(
        Number.isFinite(sample.renderedRecordLongitude) &&
          Math.abs(
            sample.renderedRecordLongitude - sample.fixtureAircraftLongitude,
          ) <= REPLAY_COORDINATE_EPSILON_DEG,
        `${label} sample ${index + 1} rendered longitude must match`,
      );
      assert.ok(
        Number.isFinite(sample.renderedBillboardLatitude) &&
          Math.abs(
            sample.renderedBillboardLatitude - sample.fixtureAircraftLatitude,
          ) <= REPLAY_COORDINATE_EPSILON_DEG,
        `${label} sample ${index + 1} displayed billboard latitude must match`,
      );
      assert.ok(
        Number.isFinite(sample.renderedBillboardLongitude) &&
          Math.abs(
            sample.renderedBillboardLongitude - sample.fixtureAircraftLongitude,
          ) <= REPLAY_COORDINATE_EPSILON_DEG,
        `${label} sample ${index + 1} displayed billboard longitude must match`,
      );
      assert.ok(
        Number.isFinite(sample.billboardScreenPosition?.x) &&
          Number.isFinite(sample.billboardScreenPosition?.y) &&
          Number.isFinite(sample.billboardCanvas?.width) &&
          Number.isFinite(sample.billboardCanvas?.height) &&
          sample.billboardCanvas.width > 0 &&
          sample.billboardCanvas.height > 0 &&
          sample.billboardScreenPosition.x >= 0 &&
          sample.billboardScreenPosition.y >= 0 &&
          sample.billboardScreenPosition.x < sample.billboardCanvas.width &&
          sample.billboardScreenPosition.y < sample.billboardCanvas.height,
        `${label} sample ${index + 1} billboard must be on canvas`,
      );
    }
    assert.ok(
      sample.inputEventAtMs != null &&
        Number.isFinite(sample.inputEventAtMs) &&
        Math.abs(sample.inputAtMs - sample.inputEventAtMs) <= 20,
      `${label} sample must be tied to a fresh observed input event`,
    );
    return {
      inputToStateMs: stateAtMs - inputAtMs,
      inputToRenderedFrameMs: renderedFrameAtMs - inputAtMs,
    };
  });
}

function compareInteractionMetric(evidence, name, limitMs, captures) {
  if (!evidence)
    return unavailable('No interaction timing capture was supplied.');
  if (evidence.schema !== INTERACTION_SCHEMA)
    return unavailable(`Interaction evidence must use ${INTERACTION_SCHEMA}.`);
  if (evidence.status === 'failed')
    return {
      status: 'failed',
      reason: evidence.failureReason || 'Interaction capture failed.',
    };
  if (evidence.status !== 'completed')
    return unavailable('Interaction capture did not complete.');

  try {
    assert.ok(evidence.pairing && typeof evidence.pairing === 'object');
    const expected = {
      baseline: captureIdentity(captures?.baseline, 'Baseline'),
      candidate: captureIdentity(captures?.candidate, 'Candidate'),
    };
    validateIdentityAgainstCapture(
      evidence.builds?.baseline,
      expected.baseline,
      'Baseline',
    );
    validateIdentityAgainstCapture(
      evidence.builds?.candidate,
      expected.candidate,
      'Candidate',
    );
    for (const role of ['baseline', 'candidate']) {
      assertBrowserClose(evidence.builds[role], `Interaction ${role}`);
      assert.equal(evidence.builds[role]?.interactionStatus, 'completed');
      assertForegroundHostActivation(
        evidence.builds[role],
        `Interaction ${role}`,
      );
    }
    const setupKey =
      name === 'localControl' ? 'localControlCameraSetup' : 'replayCameraSetup';
    const expectedCamera =
      name === 'localControl'
        ? {
            routeId: LOCAL_CONTROL_CAMERA_ROUTE_ID,
            location: LOCAL_CONTROL_CAMERA_LOCATION,
          }
        : { routeId: REPLAY_CAMERA_ROUTE_ID, location: REPLAY_CAMERA_LOCATION };
    const cameraSetups = ['baseline', 'candidate'].map((role) => {
      const setup = evidence.builds[role]?.[setupKey];
      assert.ok(setup, `${role} ${setupKey} is missing`);
      assert.equal(setup.routeId, expectedCamera.routeId);
      assert.deepEqual(setup.requestedLocation, expectedCamera.location);
      assert.ok(Number.isSafeInteger(setup.frameNumberBefore));
      assert.ok(
        Number.isSafeInteger(setup.frameNumberAfter) &&
          setup.frameNumberAfter > setup.frameNumberBefore,
      );
      const pose = setup.observedPose;
      assert.ok(Number.isFinite(pose?.latitude));
      assert.ok(Number.isFinite(pose?.longitude));
      assert.ok(Number.isFinite(pose?.altitude));
      assert.ok(Number.isFinite(pose?.heading));
      assert.ok(Number.isFinite(pose?.pitch));
      assert.ok(Number.isFinite(pose?.roll));
      assertCameraPosesClose(
        pose,
        {
          ...expectedCamera.location,
          heading: 0,
          pitch: -Math.PI / 2,
          roll: 0,
        },
        `${role} ${setupKey} observed pose`,
      );
      return setup;
    });
    assertCameraPosesClose(
      cameraSetups[0].observedPose,
      cameraSetups[1].observedPose,
      `${name} camera setup must match across builds`,
    );
    assertSharedPairIdentity(
      evidence.builds.baseline,
      evidence.builds.candidate,
      'Interaction',
    );
    assert.ok(
      evidence.pairing && typeof evidence.pairing === 'object',
      'Interaction pairing metadata is missing',
    );
    assert.ok(evidence.pairing.routeId, 'Interaction pairing route is missing');
    assert.ok(
      evidence.pairing.fixtureSha256,
      'Interaction pairing fixture hash is missing',
    );
    assert.equal(
      evidence.pairing?.routeId,
      evidence.builds.baseline.identity.routeId,
    );
    assert.equal(
      evidence.pairing?.fixtureSha256,
      evidence.builds.baseline.identity.fixtureSha256,
    );
    const baselineSamples = validateInteractionSide(
      evidence.builds?.baseline?.[name],
      `${name} baseline`,
    );
    const candidateSamples = validateInteractionSide(
      evidence.builds?.candidate?.[name],
      `${name} candidate`,
    );
    const baselineStateP95Ms = p95(
      baselineSamples.map((sample) => sample.inputToStateMs),
    );
    const baselineFrameP95Ms = p95(
      baselineSamples.map((sample) => sample.inputToRenderedFrameMs),
    );
    const candidateStateP95Ms = p95(
      candidateSamples.map((sample) => sample.inputToStateMs),
    );
    const candidateFrameP95Ms = p95(
      candidateSamples.map((sample) => sample.inputToRenderedFrameMs),
    );
    const failures = [];
    if (candidateStateP95Ms > limitMs)
      failures.push('input-to-state p95 exceeds the limit');
    if (candidateFrameP95Ms > limitMs)
      failures.push('input-to-rendered-frame p95 exceeds the limit');
    return {
      status: failures.length ? 'failed' : 'measured',
      semantic:
        'input event to observed state change and to first explicitly requested post-state completed rendered frame, reported separately; frame-witness request and polling overhead are included conservatively',
      baseline: {
        sampleCount: baselineSamples.length,
        inputToStateP95Ms: baselineStateP95Ms,
        inputToRenderedFrameP95Ms: baselineFrameP95Ms,
      },
      candidate: {
        sampleCount: candidateSamples.length,
        inputToStateP95Ms: candidateStateP95Ms,
        inputToRenderedFrameP95Ms: candidateFrameP95Ms,
      },
      limitMs,
      failures,
    };
  } catch (error) {
    if (/missing|absent/i.test(error.message))
      return unavailable(error.message);
    return { status: 'failed', reason: error.message };
  }
}

function compareSampledPeakHeap(evidence, captures) {
  if (!evidence)
    return unavailable(
      'Dedicated timestamped sampled-heap evidence is absent.',
    );
  if (evidence.schema !== SAMPLED_HEAP_SCHEMA)
    return unavailable(
      `Sampled heap evidence must use ${SAMPLED_HEAP_SCHEMA}.`,
    );
  if (evidence.status !== 'completed')
    return evidence.status === 'failed'
      ? {
          status: 'failed',
          reason: evidence.failureReason || 'Heap sampling failed.',
        }
      : unavailable('Sampled heap evidence did not complete.');
  try {
    const plan = evidence.workPlan;
    if (
      !plan ||
      !Array.isArray(plan.phaseIds) ||
      !evidence.sampling ||
      !Number.isFinite(evidence.sampling.cadenceMs) ||
      !Number.isFinite(evidence.sampling.maxGapMs)
    )
      return unavailable(
        'Sampled-heap work phases or sampling cadence metadata are absent.',
      );
    assert.equal(
      plan?.warmupCycles,
      2,
      'Heap diagnostic requires two warmup cycles',
    );
    assert.equal(
      plan?.measuredCycles,
      6,
      'Heap diagnostic requires six measured cycles',
    );
    assert.deepEqual(plan?.operationsPerCycle, {
      sourceToggles: 8,
      replaySeeks: 1,
      imports: 1,
      workspaceReloads: 2,
      archiveFailures: 1,
      cameraRecoveries: 1,
    });
    assert.deepEqual(plan?.phaseIds, ['mixed-use-cycle']);
    assert.equal(evidence.sampling?.cadenceMs, 1000);
    assert.equal(evidence.sampling?.maxGapMs, 5000);
    assert.equal(evidence.sampling?.forcedGc, false);
    const result = {};
    for (const role of ['baseline', 'candidate']) {
      const side = evidence.builds?.[role];
      const identity = captureIdentity(captures?.[role], `${role} heap`);
      if (
        !side ||
        !Array.isArray(side.samples) ||
        !side.samples.length ||
        !side.identity ||
        !Array.isArray(side.completedCycles) ||
        !Array.isArray(side.completedCycleOperations) ||
        !Array.isArray(side.phaseIds) ||
        !Array.isArray(side.warmupCycleOperations) ||
        !Number.isFinite(side.actualDurationMs) ||
        side.status == null ||
        !side.operationsPerCycle
      )
        return unavailable(
          `${role} sampled-heap series, phase, identity, or duration evidence is absent.`,
        );
      validateIdentityAgainstCapture(side, identity, `${role} heap`);
      assertBrowserClose(side, `Heap ${role}`);
      assert.equal(side?.heapStatus, 'completed');
      assertForegroundIntegrity(side, `Heap ${role}`);
      assert.deepEqual(side?.completedCycles, [1, 2, 3, 4, 5, 6]);
      assert.ok(Array.isArray(side.warmupCycleOperations));
      assert.equal(side.warmupCycleOperations.length, 2);
      for (const operations of side.warmupCycleOperations)
        assert.deepEqual(operations, plan.operationsPerCycle);
      assert.ok(Array.isArray(side.completedCycleOperations));
      assert.equal(side.completedCycleOperations.length, 6);
      for (let index = 0; index < 6; index++) {
        assert.equal(side.completedCycleOperations[index].cycle, index + 1);
        assert.deepEqual(
          side.completedCycleOperations[index].operations,
          plan.operationsPerCycle,
        );
      }
      assert.deepEqual(side?.phaseIds, plan.phaseIds);
      assert.equal(
        side?.operationsPerCycle && JSON.stringify(side.operationsPerCycle),
        JSON.stringify(plan.operationsPerCycle),
      );
      assert.ok(
        Number.isFinite(side.actualDurationMs) && side.actualDurationMs > 0,
      );
      assert.ok(
        side.actualDurationMs >= 5000,
        `${role} heap workload was shorter than the planned measured window`,
      );
      assert.ok(Array.isArray(side.samples) && side.samples.length >= 10);
      let previous = -1;
      let previousOrdinal = 0;
      const sampleIds = new Set();
      const cycleIds = new Set();
      for (const sample of side.samples) {
        assert.equal(typeof sample.sampleId, 'string');
        assert.equal(
          sampleIds.has(sample.sampleId),
          false,
          `${role} duplicate heap sample`,
        );
        sampleIds.add(sample.sampleId);
        assert.equal(
          sample.sampleOrdinal,
          previousOrdinal + 1,
          `${role} heap sample sequence has a dropped or duplicate ordinal`,
        );
        previousOrdinal = sample.sampleOrdinal;
        assert.ok(
          Number.isFinite(sample.elapsedMs) && sample.elapsedMs > previous,
        );
        assert.ok(
          Number.isSafeInteger(sample.heapUsedBytes) &&
            sample.heapUsedBytes > 0,
        );
        assert.ok(Number.isFinite(Date.parse(sample.capturedAt)));
        assert.equal(sample.visibilityState, 'visible');
        assert.equal(sample.focused, true);
        assert.ok(plan.phaseIds.includes(sample.phaseId));
        assert.ok(Number.isInteger(sample.cycle));
        assert.ok(sample.cycle >= 1 && sample.cycle <= 6);
        cycleIds.add(sample.cycle);
        if (previous >= 0)
          assert.ok(sample.elapsedMs - previous <= evidence.sampling.maxGapMs);
        previous = sample.elapsedMs;
      }
      assert.deepEqual([...cycleIds].sort(), [1, 2, 3, 4, 5, 6]);
      assert.ok(side.samples[0].elapsedMs <= evidence.sampling.cadenceMs);
      assert.ok(side.actualDurationMs >= previous);
      assert.ok(side.actualDurationMs - previous <= evidence.sampling.maxGapMs);
      result[role] = Math.max(
        ...side.samples.map((sample) => sample.heapUsedBytes),
      );
    }
    assertSharedPairIdentity(
      evidence.builds.baseline,
      evidence.builds.candidate,
      'Heap',
    );
    assert.deepEqual(
      evidence.builds.baseline.completedCycles,
      evidence.builds.candidate.completedCycles,
    );
    assert.deepEqual(
      evidence.builds.baseline.completedCycleOperations,
      evidence.builds.candidate.completedCycleOperations,
    );
    assert.deepEqual(
      evidence.builds.baseline.warmupCycleOperations,
      evidence.builds.candidate.warmupCycleOperations,
    );
    assert.deepEqual(
      evidence.builds.baseline.phaseIds,
      evidence.builds.candidate.phaseIds,
    );
    assert.equal(
      JSON.stringify(evidence.builds.baseline.operationsPerCycle),
      JSON.stringify(evidence.builds.candidate.operationsPerCycle),
    );
    const baselineBytes = result.baseline;
    const candidateBytes = result.candidate;
    const changePct = ((candidateBytes - baselineBytes) / baselineBytes) * 100;
    const regressionOver10Pct = changePct > STARTUP_REGRESSION_LIMIT_PCT;
    return {
      status: regressionOver10Pct ? 'failed' : 'measured',
      semantic:
        'maximum JSHeapUsedSize across raw 1-second samples during six matched mixed-use cycles; non-GC sampled peak, not continuous or retained heap',
      baselinePeakHeapBytes: baselineBytes,
      candidatePeakHeapBytes: candidateBytes,
      sampleCountByBuild: {
        baseline: evidence.builds.baseline.samples.length,
        candidate: evidence.builds.candidate.samples.length,
      },
      actualDurationMsByBuild: {
        baseline: evidence.builds.baseline.actualDurationMs,
        candidate: evidence.builds.candidate.actualDurationMs,
      },
      changePct,
      regressionOver10Pct,
      sourceSoakStatus: null,
      sourceSoakFailurePreserved: false,
      thresholdPct: STARTUP_REGRESSION_LIMIT_PCT,
    };
  } catch (error) {
    if (/missing|absent/i.test(error.message))
      return unavailable(error.message);
    return { status: 'failed', reason: error.message };
  }
}

/**
 * Consume raw paired captures and optional interaction/soak evidence. This
 * reports metric availability and failures; it never qualifies an entire build.
 */
export function evaluateQualificationMetrics({
  baseline,
  candidate,
  interactionEvidence = null,
  sampledHeapEvidence = null,
} = {}) {
  const coldStartup = evaluateColdStartupReadiness(baseline, candidate);
  const localControl = compareInteractionMetric(
    interactionEvidence,
    'localControl',
    LOCAL_CONTROL_LIMIT_MS,
    { baseline, candidate },
  );
  const loadedReplaySeek = compareInteractionMetric(
    interactionEvidence,
    'loadedReplaySeek',
    REPLAY_SEEK_LIMIT_MS,
    { baseline, candidate },
  );
  const sampledPeakHeap = compareSampledPeakHeap(sampledHeapEvidence, {
    baseline,
    candidate,
  });
  const metrics = {
    coldStartup,
    localControl,
    loadedReplaySeek,
    sampledPeakHeap,
  };
  const failed = Object.values(metrics).some(
    (metric) => metric.status === 'failed',
  );
  const pending = Object.values(metrics).some(
    (metric) => metric.status === 'unavailable',
  );
  return {
    schema: METRIC_SCHEMA,
    status: failed ? 'failed' : pending ? 'pending' : 'measured',
    acceptanceEligible: false,
    metrics,
  };
}

export const QUALIFICATION_METRIC_THRESHOLDS = Object.freeze({
  localControlP95Ms: LOCAL_CONTROL_LIMIT_MS,
  loadedReplaySeekP95Ms: REPLAY_SEEK_LIMIT_MS,
  regressionOver10Pct: STARTUP_REGRESSION_LIMIT_PCT,
});
