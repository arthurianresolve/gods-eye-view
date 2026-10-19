import assert from 'node:assert/strict';
import {
  effectiveStartupMethod,
  LEGACY_STARTUP_MEASUREMENT,
  LEGACY_STARTUP_METHOD,
  PAGE_OBSERVED_STARTUP_MEASUREMENT,
  PAGE_OBSERVED_STARTUP_METHOD,
  PAGE_OBSERVED_STARTUP_SEMANTICS,
  validatePageObservedStartupTiming,
} from './startupObservationMethod.mjs';

export const BALANCED_STARTUP_ORDER = Object.freeze([
  'control',
  'candidate',
  'candidate',
  'control',
  'control',
  'candidate',
  'candidate',
  'control',
  'control',
  'candidate',
]);

export const STARTUP_MEASUREMENT = LEGACY_STARTUP_MEASUREMENT;
export const STARTUP_REGRESSION_THRESHOLD_PCT = 10;

const SHA1 = /^[a-f0-9]{40}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const SAFE_SLOT_ID = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/;

function median(values) {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

export function assertBalancedStartupPlan(plan) {
  assert.equal(plan?.schema, 'gev-balanced-startup-plan/v1');
  assert.equal(plan?.status, 'predeclared');
  assert.equal(typeof plan?.createdAt, 'string');
  assert.ok(Number.isFinite(Date.parse(plan.createdAt)));
  assert.equal(plan?.motionEligible, false);
  assert.match(plan?.applicationCommits?.control || '', SHA1);
  assert.match(plan?.applicationCommits?.candidate || '', SHA1);
  assert.notEqual(
    plan.applicationCommits.control,
    plan.applicationCommits.candidate,
  );
  assert.match(plan?.captureProducerCommit || '', SHA1);
  assert.match(plan?.buildHarnessCommit || '', SHA1);
  assert.match(plan?.buildReceiptSha256?.control || '', SHA256);
  assert.match(plan?.buildReceiptSha256?.candidate || '', SHA256);
  assert.ok(plan?.fixture?.workloadId);
  assert.ok(plan?.fixture?.id);
  assert.match(plan?.fixture?.sha256 || '', SHA256);
  const method = effectiveStartupMethod(plan);
  assert.ok(
    [LEGACY_STARTUP_METHOD, PAGE_OBSERVED_STARTUP_METHOD].includes(method),
    'Startup method is unsupported',
  );
  assert.equal(
    plan?.measurement,
    method === PAGE_OBSERVED_STARTUP_METHOD
      ? PAGE_OBSERVED_STARTUP_MEASUREMENT
      : STARTUP_MEASUREMENT,
    'Startup method and measurement identity differ',
  );
  if (plan.startupMethod != null)
    assert.equal(
      plan.startupMethod,
      method,
      'Startup method identity is malformed',
    );
  assert.equal(plan?.thresholdPct, STARTUP_REGRESSION_THRESHOLD_PCT);
  assert.ok(plan?.expectedEnvironment);
  assert.ok(plan?.expectedSettings);
  for (const key of [
    'browserVersion',
    'renderer',
    'userAgent',
    'platform',
    'viewport',
    'drawingBuffer',
    'nativeSharpnessProfile',
  ])
    assert.ok(
      plan.expectedEnvironment[key] != null,
      `Expected ${key} pin is missing`,
    );
  assert.match(
    plan.expectedEnvironment.browserVersion,
    /^Chrome\/\d+\.\d+\.\d+\.\d+$/,
  );
  const browserMajor = plan.expectedEnvironment.browserVersion
    .split('/')[1]
    .split('.')[0];
  assert.ok(
    plan.expectedEnvironment.userAgent.includes(`Chrome/${browserMajor}.`),
    'Expected Chrome user-agent version must match the full browser version',
  );
  assert.ok(plan.expectedEnvironment.renderer.length > 0);
  assert.ok(plan.expectedEnvironment.platform.length > 0);
  assert.ok(
    Number.isInteger(plan.expectedEnvironment.viewport.width) &&
      plan.expectedEnvironment.viewport.width > 0 &&
      Number.isInteger(plan.expectedEnvironment.viewport.height) &&
      plan.expectedEnvironment.viewport.height > 0 &&
      Number.isFinite(plan.expectedEnvironment.viewport.dpr) &&
      plan.expectedEnvironment.viewport.dpr > 0,
  );
  assert.ok(
    Number.isInteger(plan.expectedEnvironment.drawingBuffer.width) &&
      plan.expectedEnvironment.drawingBuffer.width > 0 &&
      Number.isInteger(plan.expectedEnvironment.drawingBuffer.height) &&
      plan.expectedEnvironment.drawingBuffer.height > 0,
  );
  assert.equal(
    plan.expectedEnvironment.nativeSharpnessProfile?.id,
    'native-sharpness-v1',
  );
  assert.deepEqual(
    plan.expectedEnvironment.nativeSharpnessProfile.viewport,
    plan.expectedEnvironment.viewport,
  );
  assert.deepEqual(
    plan.expectedEnvironment.nativeSharpnessProfile.drawingBuffer,
    plan.expectedEnvironment.drawingBuffer,
  );
  const profile = plan.expectedEnvironment.nativeSharpnessProfile;
  assert.equal(profile.useBrowserRecommendedResolution, false);
  assert.equal(profile.resolutionScale, 1);
  assert.equal(profile.maximumScreenSpaceError, 1);
  assert.equal(
    profile.drawingBuffer.width,
    Math.floor(profile.viewport.width * profile.viewport.dpr),
  );
  assert.equal(
    profile.drawingBuffer.height,
    Math.floor(profile.viewport.height * profile.viewport.dpr),
  );
  assert.equal(plan.expectedSettings?.qualityMode, 'manual');
  assert.ok(
    ['SPARSE', 'BALANCED', 'DENSE'].includes(
      plan.expectedSettings?.detectionMode,
    ),
  );
  assert.ok(
    Number.isFinite(plan.expectedSettings?.densityPct) &&
      plan.expectedSettings.densityPct >= 0 &&
      plan.expectedSettings.densityPct <= 100,
  );
  assert.equal(plan.expectedSettings.useBrowserRecommendedResolution, false);
  assert.equal(plan.expectedSettings.resolutionScale, 1);
  assert.equal(plan.expectedSettings.maximumScreenSpaceError, 1);
  assert.equal(typeof plan.expectedSettings.antialias, 'boolean');
  assert.equal(typeof plan.expectedSettings.fxaa, 'boolean');
  assert.equal(typeof plan.expectedSettings.bloom, 'boolean');
  assert.equal(typeof plan.expectedSettings.sharpen, 'boolean');
  assert.ok(Number.isFinite(plan.expectedSettings.bloomIntensity));
  assert.ok(Number.isFinite(plan.expectedSettings.sharpenIntensity));
  assert.ok(Number.isFinite(plan.expectedSettings.msaaSamples));
  assert.equal(typeof plan.expectedSettings.style, 'string');
  assert.deepEqual(
    plan.expectedSettings.nativeSharpnessProfile,
    plan.expectedEnvironment.nativeSharpnessProfile,
  );
  assert.equal(
    plan.expectedSettings.useBrowserRecommendedResolution,
    plan.expectedEnvironment.nativeSharpnessProfile
      .useBrowserRecommendedResolution,
  );
  assert.equal(
    plan.expectedSettings.resolutionScale,
    plan.expectedEnvironment.nativeSharpnessProfile.resolutionScale,
  );
  assert.equal(
    plan.expectedSettings.maximumScreenSpaceError,
    plan.expectedEnvironment.nativeSharpnessProfile.maximumScreenSpaceError,
  );

  assert.ok(Array.isArray(plan?.slots) && plan.slots.length === 10);
  const slotIds = new Set();
  const paths = new Set();
  for (let index = 0; index < BALANCED_STARTUP_ORDER.length; index++) {
    const slot = plan.slots[index];
    assert.equal(slot?.slot, index + 1);
    assert.equal(slot?.role, BALANCED_STARTUP_ORDER[index]);
    assert.match(slot?.slotId || '', SAFE_SLOT_ID);
    assert.ok(typeof slot?.path === 'string' && slot.path.length > 0);
    assert.ok(!slot.path.startsWith('/') && !/^[A-Za-z]:/.test(slot.path));
    assert.ok(!slot.path.split(/[\\/]/).includes('..'));
    assert.ok(!slotIds.has(slot.slotId), 'Startup slot IDs must be unique');
    assert.ok(!paths.has(slot.path), 'Startup shard paths must be unique');
    slotIds.add(slot.slotId);
    paths.add(slot.path);
  }
  return true;
}

function assertShard(shard, slot, plan) {
  assert.equal(shard?.schema, 'gev-startup-observation-shard/v1');
  assert.equal(shard?.status, 'completed');
  assert.equal(shard?.integrity?.status, 'passed');
  assert.equal(shard?.comparisonEligible, false);
  assert.equal(shard?.motionEligible, false);
  assert.equal(shard?.slotId, slot.slotId);
  assert.equal(shard?.role, slot.role);
  assert.equal(shard?.source?.appCommit, plan.applicationCommits[slot.role]);
  assert.equal(
    shard?.source?.captureProducerCommit,
    plan.captureProducerCommit,
  );
  assert.equal(shard?.source?.buildHarnessCommit, plan.buildHarnessCommit);
  assert.equal(
    shard?.source?.buildProvenance?.receiptSha256,
    plan.buildReceiptSha256[slot.role],
  );
  assert.deepEqual(shard?.fixture, plan.fixture);
  assert.equal(shard?.startup?.runCount, 1);
  assert.equal(shard?.startup?.measurement, plan.measurement);
  assert.equal(
    shard?.startup?.method || LEGACY_STARTUP_METHOD,
    effectiveStartupMethod(plan),
    'Startup shard method differs from the predeclared plan',
  );
  assert.equal(shard?.startup?.observations?.length, 1);
  assert.deepEqual(shard.environment, plan.expectedEnvironment);
  assert.deepEqual(shard.settings, plan.expectedSettings);
  assert.equal(
    shard?.graphics?.browserVersion,
    plan.expectedEnvironment.browserVersion,
  );
  assert.equal(shard?.browserClose?.closeApiCompleted, true);
  assert.equal(shard?.browserClose?.normalProcessExit, true);
  assert.equal(shard?.browserClose?.processExitCode, 0);
  assert.equal(shard?.browserClose?.processExitSignal, null);
  assert.equal(shard?.browserClose?.forcedTerminationAttempted, false);

  const span = shard.processSpan;
  assert.ok(Number.isSafeInteger(span?.startedAtMs) && span.startedAtMs > 0);
  assert.ok(Number.isSafeInteger(span?.completedAtMs));
  assert.ok(span.completedAtMs >= span.startedAtMs);

  const [observation] = shard.startup.observations;
  assert.equal(observation?.run, 1);
  assert.equal(observation?.cacheDisabled, true);
  assert.equal(observation?.measurement, plan.measurement);
  assert.equal(observation?.appReadyMs > 0, true);
  assert.ok(Number.isFinite(observation.appReadyMs));
  assert.ok(
    Number.isFinite(observation.initialSettleMs) &&
      observation.initialSettleMs > 0,
  );
  assert.equal(observation?.foregroundActivation?.visible, true);
  assert.equal(observation?.foregroundActivation?.focused, true);
  assert.equal(observation?.foregroundActivation?.visibilityState, 'visible');
  const host = observation?.foregroundActivation?.hostWindowActivation;
  assert.equal(host?.status, 'foreground-confirmed');
  assert.equal(host?.foregroundConfirmed, true);
  assert.ok(Number.isSafeInteger(host?.browserPid) && host.browserPid > 0);
  assert.equal(host?.foregroundPid, host.browserPid);
  assert.equal(observation?.renderer, plan.expectedEnvironment.renderer);
  assert.deepEqual(observation?.viewport, plan.expectedEnvironment.viewport);
  assert.deepEqual(
    observation?.drawingBuffer,
    plan.expectedEnvironment.drawingBuffer,
  );
  if (effectiveStartupMethod(plan) === PAGE_OBSERVED_STARTUP_METHOD) {
    validatePageObservedStartupTiming(shard.startup, observation);
    assert.ok(
      shard.startup.timingEvidence.preNavigationForeground.startedAtMs >=
        span.startedAtMs,
      'Pre-navigation foreground preparation must be inside the startup process span',
    );
    assert.ok(
      shard.startup.timingEvidence.hostBoundaries.loaderHiddenObservedAtMs <=
        span.completedAtMs,
      'Startup page observations must finish before process cleanup completes',
    );
  }
  return observation;
}

/** Validate ten immutable, interleaved startup-only captures and apply the original 10% gates. */
export function evaluateBalancedStartupConfirmation({ plan, shards }) {
  assertBalancedStartupPlan(plan);
  assert.ok(Array.isArray(shards) && shards.length === plan.slots.length);
  const observations = { control: [], candidate: [] };
  let previousCompletedAt = -Infinity;

  for (let index = 0; index < plan.slots.length; index++) {
    const { slot, sha256, report } = shards[index] || {};
    const expectedSlot = plan.slots[index];
    assert.equal(slot?.slotId, expectedSlot.slotId);
    assert.equal(slot?.role, expectedSlot.role);
    assert.equal(slot?.path, expectedSlot.path);
    assert.match(sha256 || '', SHA256, 'Startup shard hash is missing');
    const observation = assertShard(report, expectedSlot, plan);
    if (index === 0)
      assert.ok(
        Date.parse(plan.createdAt) < report.processSpan.startedAtMs,
        'Startup plan must be timestamped before the first shard starts',
      );
    assert.ok(
      report.processSpan.startedAtMs > previousCompletedAt,
      'Startup shard process spans must be ordered and non-overlapping',
    );
    previousCompletedAt = report.processSpan.completedAtMs;
    observations[expectedSlot.role].push(observation);
  }

  assert.equal(observations.control.length, 5);
  assert.equal(observations.candidate.length, 5);
  const compare = (key) => {
    const controlMedianMs = median(
      observations.control.map((item) => item[key]),
    );
    const candidateMedianMs = median(
      observations.candidate.map((item) => item[key]),
    );
    const changePct =
      ((candidateMedianMs - controlMedianMs) / controlMedianMs) * 100;
    return {
      controlMedianMs,
      candidateMedianMs,
      changePct,
      regressionOver10Pct: changePct > STARTUP_REGRESSION_THRESHOLD_PCT,
    };
  };
  const appReady = compare('appReadyMs');
  const loadingHidden = compare('initialSettleMs');
  const failed =
    appReady.regressionOver10Pct || loadingHidden.regressionOver10Pct;
  return {
    schema: 'gev-balanced-startup-confirmation-review/v1',
    status: failed ? 'failed' : 'passed',
    confirmationOnly: true,
    motionEligible: false,
    thresholdPct: STARTUP_REGRESSION_THRESHOLD_PCT,
    order: BALANCED_STARTUP_ORDER,
    ...(effectiveStartupMethod(plan) === PAGE_OBSERVED_STARTUP_METHOD
      ? { startupMethod: effectiveStartupMethod(plan) }
      : {}),
    appReady: {
      semantic:
        effectiveStartupMethod(plan) === PAGE_OBSERVED_STARTUP_METHOD
          ? PAGE_OBSERVED_STARTUP_SEMANTICS
          : 'navigation-to-viewer-existence',
      ...appReady,
    },
    loadingHidden: {
      semantic:
        effectiveStartupMethod(plan) === PAGE_OBSERVED_STARTUP_METHOD
          ? PAGE_OBSERVED_STARTUP_SEMANTICS
          : 'navigation-to-loading-screen-hidden',
      ...loadingHidden,
    },
  };
}
