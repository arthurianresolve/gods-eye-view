import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { validateWeatherBalancedEnvelopeArtifact } from './weatherBalancedQualification.mjs';
import {
  inspectQualificationBuildIdentityEvidence,
  qualificationBuildIdentityEvidenceReference,
} from './qualificationBuildIdentity.mjs';
import {
  INTERACTION_EVENT_TIMING_PLAN,
  validateInteractionEventTiming,
} from './interactionEventTiming.mjs';
import {
  assertNativeWindowViewportEvidence,
  assertNativeWindowViewportPair,
  assertNativeWindowConfigurationPair,
} from './nativeWindowViewport.mjs';

export const QUALIFICATION_NATIVE_WINDOW_MODE = 'native-window-viewport-v1';
export const QUALIFICATION_NATIVE_WINDOW_ENVIRONMENT_SCHEMA =
  'gev-qualification-native-window-environment/v1';
export const QUALIFICATION_NATIVE_WINDOW_HELPER_SHA256 = createHash('sha256')
  .update(readFileSync(new URL('./nativeWindowViewport.mjs', import.meta.url)))
  .digest('hex');

const METRIC_SCHEMA = 'gev-qualification-metrics/v1';
const INTERACTION_SCHEMA_V2 = 'gev-interaction-latency-evidence/v2';
const INTERACTION_SCHEMA_V3 = 'gev-interaction-latency-evidence/v3';
const INTERACTION_SCHEMA_V4 = 'gev-interaction-latency-evidence/v4';
const INTERACTION_PROTOCOL_V2 =
  'trusted-event-timeStamp-prerender-postrender-witness-v4';
const INTERACTION_PROTOCOL_V3 =
  'trusted-click-activation-prerender-postrender-witness-v5';
const INTERACTION_PROTOCOL_V4 =
  'trusted-click-event-timing-prerender-postrender-witness-v6';
const LOCAL_RENDER_WITNESS = 'natural-prerender-postrender-pair-v1';
const REPLAY_RENDER_WITNESS = 'natural-replay-prerender-postrender-v1';
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
const MAX_WEATHER_ARTIFACT_BYTES = 64 * 1024 * 1024;
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

/**
 * Read one exact control/candidate pair as identity evidence only, after
 * validating the complete balanced-weather envelope and all ten child hashes.
 * These one-run shards never become cold-start comparison inputs.
 */
export function readWeatherBalancedIdentityCapturePair({
  envelopePath,
  baselinePath,
  candidatePath,
} = {}) {
  assert.equal(typeof envelopePath, 'string');
  assert.equal(typeof baselinePath, 'string');
  assert.equal(typeof candidatePath, 'string');
  const envelopeFile = path.resolve(envelopePath || '');
  const root = path.dirname(envelopeFile);
  const envelopeStat = lstatSync(envelopeFile);
  assert.equal(
    envelopeStat.isSymbolicLink(),
    false,
    'Envelope cannot be a symlink',
  );
  assert.ok(envelopeStat.isFile(), 'Envelope must be a regular file');
  assert.ok(
    envelopeStat.size > 0 && envelopeStat.size <= MAX_WEATHER_ARTIFACT_BYTES,
    'Envelope size is invalid',
  );
  const envelopeBytes = readFileSync(envelopeFile);
  const envelope = JSON.parse(envelopeBytes.toString('utf8'));
  const review = validateWeatherBalancedEnvelopeArtifact(envelope, { root });
  assert.equal(review.status, 'comparable');
  assert.equal(review.pairCount, 5);

  const normalized = (value) => {
    const resolved = path.resolve(value);
    return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
  };
  const selectChild = (inputPath, role) => {
    const target = normalized(inputPath || '');
    const matches = envelope.children.filter(
      (entry) => normalized(path.resolve(root, entry.path)) === target,
    );
    assert.equal(
      matches.length,
      1,
      `${role} path must name exactly one envelope child`,
    );
    const entry = matches[0];
    assert.equal(entry.role, role, `${role} path is bound to the wrong role`);
    assert.ok(
      Number.isSafeInteger(entry.pairIndex) &&
        entry.pairIndex >= 1 &&
        entry.pairIndex <= 5,
      `${role} child pair index is invalid`,
    );
    const childPath = path.resolve(root, entry.path);
    assert.ok(
      childPath.startsWith(`${root}${path.sep}`),
      `${role} child path escapes the envelope root`,
    );
    const childStat = lstatSync(childPath);
    assert.equal(
      childStat.isSymbolicLink(),
      false,
      `${role} child cannot be a symlink`,
    );
    assert.ok(childStat.isFile(), `${role} child must be a regular file`);
    assert.ok(
      childStat.size > 0 && childStat.size <= MAX_WEATHER_ARTIFACT_BYTES,
      `${role} child size is invalid`,
    );
    const bytes = readFileSync(childPath);
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    assert.equal(
      sha256,
      entry.sha256,
      `${role} child hash changed after envelope validation`,
    );
    const report = JSON.parse(bytes.toString('utf8'));
    assert.equal(report?.integrity?.status, 'passed');
    assert.equal(
      report?.comparisonEligible,
      false,
      `${role} balanced-weather shard must remain standalone-ineligible`,
    );
    const identity = assertRawCaptureIdentity(report, `${role} identity shard`);
    const expectedCommit =
      role === 'control'
        ? review.controlReport.source.appCommit
        : review.candidateReport.source.appCommit;
    assert.equal(identity.applicationCommit, expectedCommit);
    return {
      report,
      identity,
      path: childPath,
      sha256,
      role,
      pairIndex: entry.pairIndex,
      comparisonEligible: false,
    };
  };
  const baseline = selectChild(baselinePath, 'control');
  const candidate = selectChild(candidatePath, 'candidate');
  assert.equal(
    baseline.pairIndex,
    candidate.pairIndex,
    'Identity shards must belong to the same predeclared pair',
  );
  for (const key of [
    'browserVersion',
    'renderer',
    'userAgent',
    'platform',
    'sourceProfile',
  ])
    assert.deepEqual(
      baseline.identity[key],
      candidate.identity[key],
      `Identity shards differ in ${key}`,
    );
  return {
    baseline,
    candidate,
    pairIndex: baseline.pairIndex,
    envelope: {
      path: envelopeFile,
      sha256: createHash('sha256').update(envelopeBytes).digest('hex'),
      planId: envelope.planId,
      planPath: path.resolve(root, envelope.planArtifact.path),
      planSha256: envelope.planArtifact.sha256,
      evidenceScope: review.evidenceScope,
      pairCount: review.pairCount,
      status: review.status,
    },
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

/** Actual-window proof is additive; old fixed-size captures never supply it. */
export function assertQualificationNativeWindowIdentity(
  identity,
  expectedDpr,
  { complete = true } = {},
) {
  assert.equal(
    identity?.measurementEnvironment,
    QUALIFICATION_NATIVE_WINDOW_MODE,
  );
  const proof = identity.nativeWindowViewport;
  assert.ok(proof, 'Native-window qualification proof is absent');
  let lastOrdinal = 0;
  let lastObservedAt = -Infinity;
  const validate = (evidence, requireCanvas = true) => {
    assertNativeWindowViewportEvidence(evidence, {
      expectedDpr,
      requireCanvas,
    });
    assert.equal(evidence.observedDprBeforeConfiguration, expectedDpr);
    assert.ok(
      Number.isSafeInteger(evidence.ordinal) && evidence.ordinal > lastOrdinal,
    );
    const observedAt = Date.parse(evidence.observedAtUtc);
    assert.ok(Number.isFinite(observedAt) && observedAt >= lastObservedAt);
    lastOrdinal = evidence.ordinal;
    lastObservedAt = observedAt;
    assert.equal(evidence.browserPid, proof.configured.browserPid);
    assert.equal(
      evidence.host.windowHandle,
      proof.configured.host.windowHandle,
    );
    assert.equal(evidence.cdp.windowId, proof.configured.cdp.windowId);
    if (requireCanvas) {
      assert.equal(evidence.page.focused, true);
      assert.equal(evidence.host.foreground, true);
      assertNativeWindowViewportPair(proof.before, evidence);
    } else
      assertNativeWindowConfigurationPair(evidence, proof.before, {
        requireCanvas: true,
      });
  };
  assertNativeWindowViewportEvidence(proof.before, { expectedDpr });
  assert.equal(
    proof.configured?.preparation?.schema,
    'gev-native-window-preparation/v1',
  );
  validate(proof.configured, false);
  validate(proof.startup);
  validate(proof.freshDocumentRestore);
  validate(proof.before);
  assert.deepEqual(identity.viewport, {
    ...proof.before.page.inner,
    dpr: expectedDpr,
  });
  assert.deepEqual(
    identity.drawingBuffer,
    proof.before.page.nativeResolution.sceneDrawingBuffer,
  );
  if (complete) {
    assert.ok(Array.isArray(proof.restores));
    assert.equal(proof.restores.length, 8);
    for (const [index, restore] of proof.restores.entries()) {
      assert.equal(restore.phase, index < 2 ? 'warmup' : 'measured');
      assert.equal(restore.cycle, index < 2 ? index + 1 : index - 1);
      validate(restore.latestWorkspaceRestore);
    }
    validate(proof.after);
  }
  return proof;
}

function validateMeasurementEnvironment(evidence) {
  const environment = evidence.measurementEnvironment;
  if (environment === undefined) return false;
  assert.equal(
    environment?.schema,
    QUALIFICATION_NATIVE_WINDOW_ENVIRONMENT_SCHEMA,
  );
  assert.equal(environment.mode, QUALIFICATION_NATIVE_WINDOW_MODE);
  assert.equal(
    environment.helperSha256,
    QUALIFICATION_NATIVE_WINDOW_HELPER_SHA256,
  );
  for (const role of ['baseline', 'candidate']) {
    assert.deepEqual(
      environment.viewport,
      evidence.builds?.[role]?.identity?.viewport,
    );
    assert.deepEqual(
      environment.drawingBuffer,
      evidence.builds?.[role]?.identity?.drawingBuffer,
    );
  }
  return true;
}

function validateIdentityAgainstCapture(
  side,
  expected,
  label,
  nativeWindowViewport = false,
) {
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
  if (nativeWindowViewport)
    assertQualificationNativeWindowIdentity(
      identity,
      expected.sourceProfile.viewport.dpr,
    );
  else {
    assert.equal(identity.measurementEnvironment, undefined);
    assert.equal(identity.nativeWindowViewport, undefined);
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
  }
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
    'measurementEnvironment',
  ])
    assert.deepEqual(
      baseline?.identity?.[key],
      candidate?.identity?.[key],
      `${label} ${key} differs between builds`,
    );
  if (
    baseline?.identity?.measurementEnvironment ===
    QUALIFICATION_NATIVE_WINDOW_MODE
  ) {
    for (const boundary of ['before', 'after'])
      assertNativeWindowViewportPair(
        baseline.identity.nativeWindowViewport[boundary],
        candidate.identity.nativeWindowViewport[boundary],
      );
  }
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

const DATACENTER_FIXTURE_SCHEMA = 'gev-soak-datacenter-fixture/v2';
const DATACENTER_FIXTURE_FEATURE_COUNT = 8;
const DATACENTER_FIXTURE_BODY_SHA256 =
  '8556d37f8809bc6c4a3f6807b21422c974cb795e617e48884b5518be4085a8b5';

function validateDatacenterFixtureReceipt(receipt, label) {
  assert.equal(receipt?.schema, DATACENTER_FIXTURE_SCHEMA);
  assert.equal(
    receipt?.fulfillmentProtocol,
    'cdp-fetch-fulfilled-hash-count-v1',
  );
  assert.equal(receipt?.status, 'validated');
  assert.equal(receipt?.requestCount, 1);
  assert.equal(receipt?.preparedRequestCount, 1);
  assert.equal(receipt?.fulfilledRequestCount, 1);
  assert.equal(receipt?.responseStatus, 200);
  assert.equal(
    receipt?.applicationOrigin,
    receipt?.assetOrigin,
    `${label} datacenter asset must be served from the application origin`,
  );
  assert.match(receipt?.applicationOrigin || '', /^https?:\/\//);
  assert.ok(
    receipt?.assetPath ===
      '/src/data/local_data/datacenters/datacenters.geojsonl' ||
      /(?:^|\/)assets\/datacenters-[A-Za-z0-9_-]{8}\.geojsonl$/.test(
        receipt?.assetPath || '',
      ),
    `${label} datacenter asset path must identify the bundled source asset`,
  );
  assert.match(receipt?.bodySha256 || '', /^[a-f0-9]{64}$/);
  assert.equal(receipt?.bodySha256, DATACENTER_FIXTURE_BODY_SHA256);
  assert.equal(receipt?.expectedBodySha256, receipt?.bodySha256);
  assert.equal(receipt?.expectedFeatureCount, DATACENTER_FIXTURE_FEATURE_COUNT);
  assert.equal(
    receipt?.deliveredFeatureCount,
    DATACENTER_FIXTURE_FEATURE_COUNT,
  );
  assert.equal(
    receipt?.materializedFeatureCount,
    DATACENTER_FIXTURE_FEATURE_COUNT,
  );
  assert.equal(receipt?.disabledMaterializedFeatureCount, 0);
  assert.equal(receipt?.disabledRenderableCount, 0);
  assert.equal(receipt?.preloadEnabledObserved, true);
  assert.equal(receipt?.preloadDisabledObserved, true);
  assert.equal(receipt?.setupTiming, 'unmeasured-before-interaction-samples');
  assert.equal(Array.isArray(receipt?.requests), true);
  assert.equal(receipt.requests.length, 1);
  assert.equal(receipt.requests[0]?.origin, receipt.applicationOrigin);
  assert.equal(receipt.requests[0]?.pathname, receipt.assetPath);
  assert.equal(receipt.requests[0]?.prepared, true);
  assert.equal(receipt.requests[0]?.fulfilled, true);
  assert.equal(receipt.requests[0]?.responseStatus, 200);
  assert.equal(receipt.requests[0]?.bodySha256, receipt.bodySha256);
  assert.equal(
    receipt.requests[0]?.deliveredFeatureCount,
    DATACENTER_FIXTURE_FEATURE_COUNT,
  );
  return receipt;
}

function validateInteractionSide(
  side,
  label,
  expectedMaterializedCount,
  protocolVersion,
) {
  assert.ok(Array.isArray(side), `${label} samples must be an array`);
  assert.equal(
    side.length,
    INTERACTION_SAMPLE_COUNT,
    `${label} requires exactly ${INTERACTION_SAMPLE_COUNT} recorded samples`,
  );
  const ids = new Set();
  let previousInputAtMs = -1;
  let previousRenderedFrame = -1;
  let previousGeneration = 0;
  let previousIntentEpoch = 0;
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
    const isLocalControl = label.startsWith('localControl');
    assert.equal(
      sample?.renderWitnessType,
      isLocalControl ? LOCAL_RENDER_WITNESS : REPLAY_RENDER_WITNESS,
      `${label} sample ${index + 1} must identify its matching natural frame`,
    );
    const { inputAtMs, stateAtMs, renderedFrameAtMs } = sample;
    assert.ok(
      Number.isFinite(inputAtMs) &&
        Number.isFinite(stateAtMs) &&
        Number.isFinite(renderedFrameAtMs) &&
        inputAtMs >= 0 &&
        stateAtMs >= sample.handlerReceivedAtMs &&
        renderedFrameAtMs >= stateAtMs,
      `${label} sample ${index + 1} timestamps must be ordered and finite`,
    );
    assert.ok(
      inputAtMs > previousInputAtMs,
      `${label} input timestamps must advance`,
    );
    previousInputAtMs = inputAtMs;
    assert.ok(
      Number.isSafeInteger(sample.generation) &&
        sample.generation > previousGeneration,
      `${label} interaction generation must increase without reuse`,
    );
    previousGeneration = sample.generation;
    assert.ok(Number.isFinite(sample.armedAtMs));
    assert.ok(Number.isFinite(sample.handlerReceivedAtMs));
    assert.ok(
      sample.armedAtMs <= inputAtMs &&
        inputAtMs === sample.inputEventAtMs &&
        inputAtMs <= sample.handlerReceivedAtMs,
      `${label} input timestamp must be a fresh trusted event time`,
    );
    assert.ok(
      Number.isFinite(sample.inputDeliveryDelayMs) &&
        sample.inputDeliveryDelayMs ===
          sample.handlerReceivedAtMs - sample.inputAtMs &&
        sample.inputDeliveryDelayMs >= 0,
    );
    assert.equal(
      sample.inputClockSource,
      protocolVersion >= 3 && label.startsWith('localControl')
        ? 'trusted-click-event-timeStamp'
        : 'trusted-event-timeStamp',
    );
    assert.equal(sample.inputTrusted, true);
    assert.equal(sample.inputTargetMatched, true);
    assert.equal(
      sample.inputEventType,
      protocolVersion >= 3 && label.startsWith('localControl')
        ? 'click'
        : label.startsWith('localControl')
          ? 'pointerdown'
          : 'input',
    );
    if (protocolVersion >= 3 && label.startsWith('localControl')) {
      assert.ok(
        Number.isFinite(sample.pointerDownAtMs) &&
          Number.isFinite(sample.pointerUpAtMs) &&
          Number.isFinite(sample.clickAtMs) &&
          Number.isFinite(sample.clickReceivedAtMs) &&
          Number.isFinite(sample.pointerDownReceivedAtMs) &&
          Number.isFinite(sample.pointerUpReceivedAtMs) &&
          sample.pointerDownReceivedAtMs >= sample.pointerDownAtMs &&
          sample.pointerUpReceivedAtMs >= sample.pointerUpAtMs,
        `${label} sample ${index + 1} must retain the trusted pointer sequence`,
      );
      assert.ok(
        sample.armedAtMs <= sample.pointerDownAtMs &&
          sample.pointerDownAtMs <= sample.pointerUpAtMs &&
          sample.pointerUpAtMs <= sample.clickAtMs &&
          sample.clickAtMs === sample.inputAtMs &&
          sample.inputAtMs <= sample.clickReceivedAtMs &&
          sample.clickReceivedAtMs === sample.handlerReceivedAtMs,
        `${label} sample ${index + 1} pointer/click timestamps are unordered`,
      );
      assert.ok(
        sample.pointerDownToClickMs ===
          sample.clickAtMs - sample.pointerDownAtMs &&
          sample.pointerDownToClickMs >= 0,
      );
      assert.ok(
        Number.isFinite(sample.acceptedIntentAtMs) &&
          sample.acceptedIntentAtMs >= sample.clickReceivedAtMs &&
          Number.isSafeInteger(sample.acceptedIntentEpoch) &&
          sample.acceptedIntentEpoch > previousIntentEpoch,
        `${label} sample ${index + 1} must witness accepted visibility intent`,
      );
      previousIntentEpoch = sample.acceptedIntentEpoch;
      assert.ok(
        Number.isFinite(sample.buttonFeedbackFirstFrameAtMs) &&
          Number.isFinite(sample.buttonFeedbackFirstRafTimestampMs) &&
          Number.isFinite(sample.buttonFeedbackSecondRafTimestampMs) &&
          sample.buttonFeedbackSecondRafTimestampMs >
            sample.buttonFeedbackFirstRafTimestampMs &&
          Number.isFinite(sample.buttonFeedbackAtMs) &&
          sample.buttonFeedbackAtMs >= sample.buttonFeedbackFirstFrameAtMs &&
          sample.buttonFeedbackAtMs >= sample.clickReceivedAtMs &&
          sample.buttonFeedbackAtMs >= sample.acceptedIntentAtMs &&
          ['transition', 'settled'].includes(sample.buttonFeedbackState) &&
          sample.buttonFeedbackIntentEpoch === sample.acceptedIntentEpoch &&
          (sample.buttonFeedbackState !== 'transition' ||
            (sample.transitionIntentEpoch === sample.acceptedIntentEpoch &&
              Number.isFinite(sample.transitionAtMs) &&
              sample.buttonFeedbackTransitionAtMs === sample.transitionAtMs &&
              sample.buttonFeedbackAtMs >= sample.transitionAtMs)) &&
          sample.buttonFeedbackWitnessType ===
            'visible-button-two-distinct-raf-v3' &&
          sample.buttonFeedbackConsecutiveFrames >= 2,
        `${label} sample ${index + 1} must witness visible button feedback`,
      );
    }
    assert.ok(Number.isSafeInteger(sample.frameNumberAtState));
    assert.ok(Number.isSafeInteger(sample.frameNumberAtRendered));
    assert.equal(
      sample.frameNumberAtRendered,
      sample.frameNumberAtState,
      `${label} state and output must be paired to the same natural frame`,
    );
    assert.equal(sample.preRenderFrameNumber, sample.frameNumberAtRendered);
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
        Number.isInteger(sample.materializedRecordCount) &&
          (sample.expectedLayerEnabled
            ? sample.materializedRecordCount === expectedMaterializedCount
            : sample.materializedRecordCount === 0),
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
      assert.equal(sample.frameSelectedTimeMs, expectedPositionTime);
      assert.equal(sample.framePositionTimeMs, expectedPositionTime);
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
    return {
      inputToStateMs: stateAtMs - inputAtMs,
      inputToRenderedFrameMs: renderedFrameAtMs - inputAtMs,
      clickToStateMs:
        protocolVersion >= 3 && label.startsWith('localControl')
          ? stateAtMs - sample.clickAtMs
          : null,
      clickToRenderedFrameMs:
        protocolVersion >= 3 && label.startsWith('localControl')
          ? renderedFrameAtMs - sample.clickAtMs
          : null,
      clickToAcceptedIntentMs:
        protocolVersion >= 3 && label.startsWith('localControl')
          ? sample.acceptedIntentAtMs - sample.clickAtMs
          : null,
      clickToVisibleFeedbackMs:
        protocolVersion >= 3 && label.startsWith('localControl')
          ? sample.buttonFeedbackAtMs - sample.clickAtMs
          : null,
      pointerdownToReadyMs:
        protocolVersion >= 3 && label.startsWith('localControl')
          ? renderedFrameAtMs - sample.pointerDownAtMs
          : null,
      pointerdownToStateMs:
        protocolVersion >= 3 && label.startsWith('localControl')
          ? stateAtMs - sample.pointerDownAtMs
          : null,
    };
  });
}

function assertIdentitySourceReference(evidence, identitySource) {
  if (identitySource) {
    assert.deepEqual(
      evidence.sourceIdentity,
      identitySource.reference,
      'Direct identity source reference is missing or changed',
    );
    for (const role of ['baseline', 'candidate'])
      for (const phase of ['before', 'after'])
        assert.deepEqual(
          evidence.builds?.[role]?.identity?.nativeWindowViewport?.[phase],
          identitySource.live[role][phase].nativeWindowEvidence,
          'Timing/heap browser differs from the direct identity browser',
        );
  } else
    assert.equal(
      evidence.sourceIdentity,
      undefined,
      'Direct identity evidence requires its complete source envelope',
    );
}

function compareInteractionMetric(
  evidence,
  name,
  limitMs,
  captures,
  identitySource = null,
) {
  if (!evidence)
    return unavailable('No interaction timing capture was supplied.');
  const protocolVersion =
    evidence.schema === INTERACTION_SCHEMA_V2
      ? 2
      : evidence.schema === INTERACTION_SCHEMA_V3
        ? 3
        : evidence.schema === INTERACTION_SCHEMA_V4
          ? 4
          : null;
  if (!protocolVersion)
    return unavailable(
      `Interaction evidence must use ${INTERACTION_SCHEMA_V2}, ${INTERACTION_SCHEMA_V3}, or ${INTERACTION_SCHEMA_V4}.`,
    );
  if (evidence.status === 'failed')
    return {
      status: 'failed',
      reason: evidence.failureReason || 'Interaction capture failed.',
    };
  if (evidence.status !== 'completed')
    return unavailable('Interaction capture did not complete.');

  try {
    assertIdentitySourceReference(evidence, identitySource);
    const nativeWindowViewport = validateMeasurementEnvironment(evidence);
    if (identitySource) assert.equal(nativeWindowViewport, true);
    if (protocolVersion === 4) {
      assert.deepEqual(evidence.eventTimingPlan, INTERACTION_EVENT_TIMING_PLAN);
      assert.match(evidence.eventTimingProducerSha256 || '', /^[a-f0-9]{64}$/);
    }
    assert.ok(evidence.pairing && typeof evidence.pairing === 'object');
    const expected = identitySource?.identities || {
      baseline: captureIdentity(captures?.baseline, 'Baseline'),
      candidate: captureIdentity(captures?.candidate, 'Candidate'),
    };
    validateIdentityAgainstCapture(
      evidence.builds?.baseline,
      expected.baseline,
      'Baseline',
      nativeWindowViewport,
    );
    validateIdentityAgainstCapture(
      evidence.builds?.candidate,
      expected.candidate,
      'Candidate',
      nativeWindowViewport,
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
    if (nativeWindowViewport && name === 'loadedReplaySeek')
      for (const role of ['baseline', 'candidate']) {
        const side = evidence.builds[role];
        for (const sample of side.loadedReplaySeek || [])
          assert.deepEqual(sample.billboardCanvas, {
            width: side.identity.viewport.width,
            height: side.identity.viewport.height,
          });
      }
    for (const role of ['baseline', 'candidate'])
      assert.equal(
        evidence.builds[role]?.interactionProtocol,
        protocolVersion === 4
          ? INTERACTION_PROTOCOL_V4
          : protocolVersion === 3
            ? INTERACTION_PROTOCOL_V3
            : INTERACTION_PROTOCOL_V2,
        `${role} interaction protocol is missing or unsupported`,
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
    let expectedMaterializedCount = null;
    if (name === 'localControl') {
      const baselineFixture = validateDatacenterFixtureReceipt(
        evidence.builds.baseline.datacenterFixtureReceipt,
        'Baseline',
      );
      const candidateFixture = validateDatacenterFixtureReceipt(
        evidence.builds.candidate.datacenterFixtureReceipt,
        'Candidate',
      );
      for (const key of [
        'bodySha256',
        'deliveredFeatureCount',
        'materializedFeatureCount',
      ])
        assert.equal(
          baselineFixture[key],
          candidateFixture[key],
          `Datacenter fixture ${key} differs between builds`,
        );
      expectedMaterializedCount = DATACENTER_FIXTURE_FEATURE_COUNT;
    }
    const baselineSamples = validateInteractionSide(
      evidence.builds?.baseline?.[name],
      `${name} baseline`,
      expectedMaterializedCount,
      protocolVersion,
    );
    const candidateSamples = validateInteractionSide(
      evidence.builds?.candidate?.[name],
      `${name} candidate`,
      expectedMaterializedCount,
      protocolVersion,
    );
    for (const [role, localSamples, replaySamples] of [
      [
        'baseline',
        evidence.builds.baseline.localControl,
        evidence.builds.baseline.loadedReplaySeek,
      ],
      [
        'candidate',
        evidence.builds.candidate.localControl,
        evidence.builds.candidate.loadedReplaySeek,
      ],
    ]) {
      assert.ok(Array.isArray(localSamples) && Array.isArray(replaySamples));
      const generations = [...localSamples, ...replaySamples].map(
        (sample) => sample.generation,
      );
      assert.equal(
        new Set(generations).size,
        generations.length,
        `${role} interaction generation was reused across controls`,
      );
      for (let index = 1; index < generations.length; index++)
        assert.ok(
          generations[index] > generations[index - 1],
          `${role} interaction generation order is stale or duplicated`,
        );
    }
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
    if (name === 'localControl' && protocolVersion === 4) {
      const observed = {};
      for (const [role, samples] of [
        ['baseline', baselineSamples],
        ['candidate', candidateSamples],
      ]) {
        const durations = validateInteractionEventTiming(
          evidence.builds[role].eventTimingCapture,
          evidence.builds[role].localControl,
        );
        observed[role] = {
          sampleCount: samples.length,
          clickToAcceptedIntentP95Ms: p95(
            samples.map((sample) => sample.clickToAcceptedIntentMs),
          ),
          clickToNextRenderingP95Ms: p95(durations),
          diagnosticTwoRafFeedbackP95Ms: p95(
            samples.map((sample) => sample.clickToVisibleFeedbackMs),
          ),
          clickToFullReadyStateP95Ms: p95(
            samples.map((sample) => sample.inputToStateMs),
          ),
          clickToFullRenderedReadinessP95Ms: p95(
            samples.map((sample) => sample.inputToRenderedFrameMs),
          ),
        };
      }
      const absoluteFailures = (values) => [
        ...(values.clickToAcceptedIntentP95Ms > limitMs
          ? ['click-to-accepted-intent p95 exceeds the 100ms limit']
          : []),
        ...(values.clickToNextRenderingP95Ms > limitMs
          ? ['matched click-to-next-rendering p95 exceeds the 100ms limit']
          : []),
      ];
      failures.push(...absoluteFailures(observed.candidate));
      for (const [field, message] of [
        [
          'clickToFullReadyStateP95Ms',
          'click-to-full-ready state regression exceeds 10%',
        ],
        [
          'clickToFullRenderedReadinessP95Ms',
          'click-to-full-rendered readiness regression exceeds 10%',
        ],
      ]) {
        const control = observed.baseline[field];
        const candidate = observed.candidate[field];
        if (control === 0 ? candidate !== 0 : candidate / control > 1.1)
          failures.push(message);
      }
      return {
        status: failures.length ? 'failed' : 'measured',
        protocolVersion,
        semantic:
          'v4 uses matched trusted-click Event Timing duration for the next rendering update, guarded by visible same-intent feedback before the earliest quantized endpoint and continuous intent/foreground observations; candidate accepted intent and rendering p95 each <=100ms. Complete baseline samples support separate <=10% full-readiness comparisons. Two-RAF timestamps are diagnostic, and no physical presentation or asynchronous completion is inferred from Event Timing.',
        baseline: {
          ...observed.baseline,
          absoluteAcknowledgementFailures: absoluteFailures(observed.baseline),
        },
        candidate: observed.candidate,
        absoluteAcknowledgementLimitMs: limitMs,
        absoluteAcknowledgementGateAppliesTo: 'candidate',
        fullReadinessRegressionLimitPct: STARTUP_REGRESSION_LIMIT_PCT,
        failures,
      };
    }
    if (name === 'localControl' && protocolVersion === 3) {
      const baselineIntentP95Ms = p95(
        baselineSamples.map((sample) => sample.clickToAcceptedIntentMs),
      );
      const candidateIntentP95Ms = p95(
        candidateSamples.map((sample) => sample.clickToAcceptedIntentMs),
      );
      const baselineFeedbackP95Ms = p95(
        baselineSamples.map((sample) => sample.clickToVisibleFeedbackMs),
      );
      const candidateFeedbackP95Ms = p95(
        candidateSamples.map((sample) => sample.clickToVisibleFeedbackMs),
      );
      const regressionLimit = 1 + STARTUP_REGRESSION_LIMIT_PCT / 100;
      const stateRegression =
        baselineStateP95Ms === 0
          ? candidateStateP95Ms === 0
            ? 1
            : Infinity
          : candidateStateP95Ms / baselineStateP95Ms;
      const frameRegression =
        baselineFrameP95Ms === 0
          ? candidateFrameP95Ms === 0
            ? 1
            : Infinity
          : candidateFrameP95Ms / baselineFrameP95Ms;
      if (baselineIntentP95Ms > limitMs || candidateIntentP95Ms > limitMs)
        failures.push('click-to-accepted-intent p95 exceeds the 100ms limit');
      if (baselineFeedbackP95Ms > limitMs || candidateFeedbackP95Ms > limitMs)
        failures.push('click-to-visible-feedback p95 exceeds the 100ms limit');
      if (stateRegression > regressionLimit)
        failures.push('click-to-full-ready state regression exceeds 10%');
      if (frameRegression > regressionLimit)
        failures.push(
          'click-to-full-rendered readiness regression exceeds 10%',
        );
      return {
        status: failures.length ? 'failed' : 'measured',
        protocolVersion,
        semantic:
          'v3 local control separates trusted click-to-accepted-intent and click-to-visible-button feedback (each <=100ms) from full active-LOD readiness and same-frame completed output (candidate p95 <=10% slower than matched control); all durations include trusted click delivery delay and full end-to-end values remain reported',
        baseline: {
          sampleCount: baselineSamples.length,
          pointerdownToFullReadyStateP95Ms: p95(
            baselineSamples.map((sample) => sample.pointerdownToStateMs),
          ),
          pointerdownToFullReadyP95Ms: p95(
            baselineSamples.map((sample) => sample.pointerdownToReadyMs),
          ),
          clickToAcceptedIntentP95Ms: baselineIntentP95Ms,
          clickToVisibleFeedbackP95Ms: baselineFeedbackP95Ms,
          clickToFullReadyStateP95Ms: baselineStateP95Ms,
          clickToFullRenderedReadinessP95Ms: baselineFrameP95Ms,
        },
        candidate: {
          sampleCount: candidateSamples.length,
          pointerdownToFullReadyStateP95Ms: p95(
            candidateSamples.map((sample) => sample.pointerdownToStateMs),
          ),
          pointerdownToFullReadyP95Ms: p95(
            candidateSamples.map((sample) => sample.pointerdownToReadyMs),
          ),
          clickToAcceptedIntentP95Ms: candidateIntentP95Ms,
          clickToVisibleFeedbackP95Ms: candidateFeedbackP95Ms,
          clickToFullReadyStateP95Ms: candidateStateP95Ms,
          clickToFullRenderedReadinessP95Ms: candidateFrameP95Ms,
        },
        absoluteAcknowledgementLimitMs: limitMs,
        fullReadinessRegressionLimitPct: STARTUP_REGRESSION_LIMIT_PCT,
        failures,
      };
    }
    if (candidateStateP95Ms > limitMs)
      failures.push('input-to-state p95 exceeds the limit');
    if (candidateFrameP95Ms > limitMs)
      failures.push('input-to-rendered-frame p95 exceeds the limit');
    return {
      status: failures.length ? 'failed' : 'measured',
      protocolVersion,
      semantic:
        name === 'localControl'
          ? 'trusted input event timestamp to matching application state and active layer output paired within one naturally rendered frame; input delivery delay is included'
          : 'trusted input event timestamp to selected replay state and the first later naturally completed frame whose visible billboard and bounded analyst record match; input delivery delay is included',
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

function compareSampledPeakHeap(evidence, captures, identitySource = null) {
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
    assertIdentitySourceReference(evidence, identitySource);
    const nativeWindowViewport = validateMeasurementEnvironment(evidence);
    if (identitySource) assert.equal(nativeWindowViewport, true);
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
      const identity =
        identitySource?.identities[role] ||
        captureIdentity(captures?.[role], `${role} heap`);
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
      validateIdentityAgainstCapture(
        side,
        identity,
        `${role} heap`,
        nativeWindowViewport,
      );
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
  buildIdentityEvidence = null,
} = {}) {
  let identitySource = null;
  if (buildIdentityEvidence !== null) {
    try {
      assert.equal(
        baseline,
        undefined,
        'Direct identity and performance captures cannot be mixed',
      );
      assert.equal(
        candidate,
        undefined,
        'Direct identity and performance captures cannot be mixed',
      );
      const inspected = inspectQualificationBuildIdentityEvidence(
        buildIdentityEvidence,
      );
      identitySource = {
        identities: inspected.identities,
        live: buildIdentityEvidence.live,
        reference: qualificationBuildIdentityEvidenceReference(
          buildIdentityEvidence,
        ),
      };
    } catch (error) {
      return {
        schema: METRIC_SCHEMA,
        status: 'failed',
        acceptanceEligible: false,
        metrics: {
          coldStartup: unavailable(
            'Identity-only build proof supplies no cold-startup observations.',
          ),
          ...Object.fromEntries(
            ['localControl', 'loadedReplaySeek', 'sampledPeakHeap'].map(
              (name) => [name, { status: 'failed', reason: error.message }],
            ),
          ),
        },
      };
    }
  }
  const coldStartup = identitySource
    ? unavailable(
        'Identity-only build proof supplies no cold-startup observations.',
      )
    : evaluateColdStartupReadiness(baseline, candidate);
  const localControl = compareInteractionMetric(
    interactionEvidence,
    'localControl',
    LOCAL_CONTROL_LIMIT_MS,
    { baseline, candidate },
    identitySource,
  );
  const loadedReplaySeek = compareInteractionMetric(
    interactionEvidence,
    'loadedReplaySeek',
    REPLAY_SEEK_LIMIT_MS,
    { baseline, candidate },
    identitySource,
  );
  const sampledPeakHeap = compareSampledPeakHeap(
    sampledHeapEvidence,
    {
      baseline,
      candidate,
    },
    identitySource,
  );
  const metrics = {
    coldStartup,
    localControl,
    loadedReplaySeek,
    sampledPeakHeap,
  };
  for (const [metric, evidence] of [
    [localControl, interactionEvidence],
    [loadedReplaySeek, interactionEvidence],
    [sampledPeakHeap, sampledHeapEvidence],
  ])
    if (evidence?.measurementEnvironment !== undefined)
      metric.measurementEnvironment = evidence.measurementEnvironment;
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
