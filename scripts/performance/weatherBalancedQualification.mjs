import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { assertRouteDescriptorsEquivalent } from './routeEquivalence.mjs';
import { comparableCaptureConditions } from './captureIntegrity.mjs';
import { NATIVE_SHARPNESS_PROFILE_ID } from './nativeSharpnessProfile.mjs';
import { validateWeatherBalancedQualificationShard } from './pairedReport.mjs';
import { createWeatherEffectsWorkloadFixture } from './weatherEffectsWorkloadFixture.mjs';

export const WEATHER_BALANCED_PLAN_SCHEMA = 'gev-weather-balanced-plan/v1';
export const WEATHER_BALANCED_ENVELOPE_SCHEMA =
  'gev-weather-balanced-envelope/v1';
export const WEATHER_BALANCED_ORDER = Object.freeze([
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
export const WEATHER_BALANCED_FIXED_TIME = '2026-10-08T12:00:00.000Z';
const SHA1 = /^[a-f0-9]{40}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const WEATHER_FIXTURE = 'austin-weather-effects-phased-v2';
const WEATHER_WORKLOAD = 'weather-effects';
const WEATHER_FIXTURE_SHA256 = createWeatherEffectsWorkloadFixture().sha256;
const SCENARIOS = ['idle', 'scripted-motion'];
const MAX_CHILD_BYTES = 64 * 1024 * 1024;
const MIN_FULL_SHARD_MS = 2 * (30_000 + 60_000);
const isAbsoluteRecordedPath = (value) =>
  typeof value === 'string' &&
  (path.posix.isAbsolute(value) || path.win32.isAbsolute(value));
const canonical = (value) => {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, canonical(value[key])]),
  );
};

function equal(left, right, label) {
  assert.deepEqual(canonical(left), canonical(right), label);
}

function assertSha(value, pattern, label) {
  assert.match(value || '', pattern, `${label} must be a full digest`);
}

function readChild(root, child) {
  assert.ok(child && typeof child === 'object');
  assert.equal(typeof child.path, 'string');
  assert.ok(child.path && !path.isAbsolute(child.path));
  assert.ok(!child.path.split(/[\\/]/).includes('..'));
  assertSha(child.sha256, SHA256, `child ${child.path}`);
  const resolved = path.resolve(root, child.path);
  assert.ok(resolved.startsWith(`${path.resolve(root)}${path.sep}`));
  assert.equal(lstatSync(resolved).isSymbolicLink(), false);
  const size = statSync(resolved).size;
  assert.ok(size > 0 && size <= MAX_CHILD_BYTES);
  const bytes = readFileSync(resolved);
  const digest = createHash('sha256').update(bytes).digest('hex');
  assert.equal(digest, child.sha256, `${child.path}: SHA-256 mismatch`);
  const report = JSON.parse(bytes.toString('utf8'));
  return { report, digest, path: child.path };
}

function cleanComparableConditions(sample) {
  const conditions = structuredClone(sample.conditions);
  for (const boundary of ['before', 'after']) {
    conditions[boundary] = comparableCaptureConditions(
      conditions[boundary],
      'manual',
    );
    const environment = conditions[boundary]?.environment;
    if (environment) delete environment.appCommit;
  }
  return conditions;
}

function assertPairEquivalent(control, candidate, label) {
  const baseReport = control.report;
  const nextReport = candidate.report;
  assert.equal(baseReport.comparisonContract?.workloadId, WEATHER_WORKLOAD);
  assert.equal(nextReport.comparisonContract?.workloadId, WEATHER_WORKLOAD);
  const stripRoutes = (contract) => {
    const { routes: _routes, ...rest } = structuredClone(contract);
    return rest;
  };
  equal(
    stripRoutes(baseReport.comparisonContract),
    stripRoutes(nextReport.comparisonContract),
    `${label}: static weather comparison contracts differ`,
  );
  equal(
    baseReport.workload.scenarios,
    SCENARIOS,
    `${label}: control scenarios`,
  );
  equal(
    nextReport.workload.scenarios,
    SCENARIOS,
    `${label}: candidate scenarios`,
  );
  equal(
    baseReport.environment.userAgent,
    nextReport.environment.userAgent,
    `${label}: browser differs`,
  );
  equal(
    baseReport.environment.platform,
    nextReport.environment.platform,
    `${label}: platform differs`,
  );
  equal(
    baseReport.environment.renderer,
    nextReport.environment.renderer,
    `${label}: renderer differs`,
  );
  equal(
    baseReport.environment.vendor,
    nextReport.environment.vendor,
    `${label}: renderer vendor differs`,
  );
  equal(
    baseReport.environment.viewport,
    nextReport.environment.viewport,
    `${label}: viewport/DPR differs`,
  );
  equal(
    baseReport.environment.drawingBuffer,
    nextReport.environment.drawingBuffer,
    `${label}: drawing buffer differs`,
  );
  if (baseReport.comparisonProfile === NATIVE_SHARPNESS_PROFILE_ID)
    equal(
      baseReport.environment.nativeSharpnessProfile,
      nextReport.environment.nativeSharpnessProfile,
      `${label}: native sharpness differs`,
    );
  for (const scenario of SCENARIOS) {
    const base = control.validation.byScenario.get(scenario)[0];
    const next = candidate.validation.byScenario.get(scenario)[0];
    equal(
      cleanComparableConditions(base),
      cleanComparableConditions(next),
      `${label} ${scenario}: capture conditions differ`,
    );
    assertRouteDescriptorsEquivalent(
      base.cameraPath,
      next.cameraPath,
      `${label} ${scenario}: route differs`,
    );
  }
}

export function validateWeatherBalancedPlan(plan) {
  assert.equal(plan?.schema, WEATHER_BALANCED_PLAN_SCHEMA);
  assert.match(
    plan.planId || '',
    /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i,
  );
  assert.ok(Number.isFinite(Date.parse(plan.predeclaredAt)));
  assert.equal(plan.fixedTime, WEATHER_BALANCED_FIXED_TIME);
  assert.equal(plan.workloadId, WEATHER_FIXTURE);
  assert.equal(plan.comparisonProfile, NATIVE_SHARPNESS_PROFILE_ID);
  assert.equal(plan.warmupMs, 30_000);
  assert.equal(plan.durationPerSampleMs, 60_000);
  assert.deepEqual(plan.order, WEATHER_BALANCED_ORDER);
  assert.equal(plan.pairCount, 5);
  assert.ok(
    typeof plan.environmentId === 'string' && plan.environmentId.trim(),
  );
  assert.equal(plan.browser?.name, 'Chrome');
  assert.match(plan.browser?.version || '', /^\d+\.\d+\.\d+\.\d+$/);
  assert.ok(isAbsoluteRecordedPath(plan.browser?.executable));
  assertSha(
    plan.browser?.executableSha256,
    SHA256,
    'Chrome executable SHA-256',
  );
  assertSha(plan.captureHarness?.commit, SHA1, 'capture harness commit');
  assert.ok(isAbsoluteRecordedPath(plan.captureHarness?.checkout));
  assertSha(plan.buildHarness?.commit, SHA1, 'build harness commit');
  assert.ok(isAbsoluteRecordedPath(plan.buildHarness?.checkout));
  assertSha(plan.fixtureSha256, SHA256, 'weather fixture SHA-256');
  assert.equal(plan.fixtureSha256, WEATHER_FIXTURE_SHA256);
  assert.ok(isAbsoluteRecordedPath(plan.outputRoot));
  for (const role of ['control', 'candidate']) {
    const revision = plan[role];
    assertSha(revision?.appCommit, SHA1, `${role} app commit`);
    assert.ok(isAbsoluteRecordedPath(revision?.appCheckout));
    assert.ok(isAbsoluteRecordedPath(revision?.build?.root));
    assert.ok(isAbsoluteRecordedPath(revision?.build?.receipt));
    assertSha(
      revision?.build?.receiptSha256,
      SHA256,
      `${role} build receipt SHA-256`,
    );
    const base = new URL(revision?.build?.baseUrl);
    assert.equal(base.protocol, 'http:');
    assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname));
  }
  assert.notEqual(plan.control.appCommit, plan.candidate.appCommit);
  return plan;
}

export function validateWeatherBalancedEnvelope(envelope, { root, plan } = {}) {
  validateWeatherBalancedPlan(plan);
  assert.ok(root && path.isAbsolute(root), 'Evidence root must be absolute');
  assert.equal(envelope?.schema, WEATHER_BALANCED_ENVELOPE_SCHEMA);
  assert.equal(envelope.status, 'completed');
  assert.equal(envelope.diagnosticOnly, false);
  assert.equal(envelope.acceptanceEligible, true);
  assert.equal(envelope.planId, plan.planId);
  const planArtifact = readChild(root, envelope.planArtifact);
  equal(
    planArtifact.report,
    plan,
    'predeclared plan artifact differs from supplied plan',
  );
  assert.equal(envelope.planArtifact.path, 'qualification-plan.json');
  assert.deepEqual(envelope.order, WEATHER_BALANCED_ORDER);
  assert.equal(envelope.children?.length, WEATHER_BALANCED_ORDER.length);
  assert.ok(Number.isFinite(Date.parse(envelope.startedAt)));
  assert.ok(Number.isFinite(Date.parse(envelope.completedAt)));
  assert.ok(Date.parse(envelope.startedAt) >= Date.parse(plan.predeclaredAt));
  assert.ok(Date.parse(envelope.completedAt) >= Date.parse(envelope.startedAt));

  const validated = [];
  const childPaths = new Set();
  let priorEnd = Date.parse(envelope.startedAt);
  for (let index = 0; index < envelope.children.length; index += 1) {
    const entry = envelope.children[index];
    const role = WEATHER_BALANCED_ORDER[index];
    const pairIndex = Math.floor(index / 2) + 1;
    assert.equal(entry.sequence, index + 1);
    assert.equal(entry.role, role);
    assert.equal(entry.pairIndex, pairIndex);
    assert.equal(
      entry.pairId,
      `${plan.planId}-pair-${String(pairIndex).padStart(2, '0')}`,
    );
    assert.equal(
      entry.runId,
      `${plan.planId}-${role}-${String(pairIndex).padStart(2, '0')}`,
    );
    assert.ok(
      !childPaths.has(entry.path),
      `capture ${index + 1} reuses a child path`,
    );
    childPaths.add(entry.path);
    const started = Date.parse(entry.startedAt);
    const completed = Date.parse(entry.completedAt);
    assert.ok(Number.isFinite(started) && Number.isFinite(completed));
    assert.ok(
      started >= priorEnd,
      `capture ${index + 1} overlaps or is out of order`,
    );
    assert.ok(completed > started, `capture ${index + 1} has invalid timing`);
    assert.ok(
      completed - started >= MIN_FULL_SHARD_MS,
      `capture ${index + 1} did not include two full 30s warmup + 60s measurement samples`,
    );
    priorEnd = completed;
    const child = readChild(root, entry);
    const capturedAt = Date.parse(child.report.capturedAt);
    assert.ok(
      Number.isFinite(capturedAt) &&
        capturedAt >= started &&
        capturedAt <= completed,
      `capture ${index + 1} raw report timestamp is outside its process interval`,
    );
    const revision = plan[role];
    const validation = validateWeatherBalancedQualificationShard(child.report, {
      role,
      expectedAppCommit: revision.appCommit,
      expectedHarnessCommit: plan.captureHarness.commit,
      expectedBuildHarnessCommit: plan.buildHarness.commit,
    });
    assert.equal(
      child.report.comparisonContract?.browser?.name,
      plan.browser.name,
    );
    assert.equal(
      child.report.comparisonContract?.browser?.version,
      plan.browser.version,
    );
    assert.equal(
      child.report.graphics?.browserVersion,
      `Chrome/${plan.browser.version}`,
    );
    assert.equal(
      child.report.source?.buildProvenance?.receiptSha256,
      revision.build.receiptSha256,
    );
    assert.equal(child.report.url, new URL(revision.build.baseUrl).origin);
    assert.equal(child.report.workload?.fixture?.sha256, plan.fixtureSha256);
    validated.push({ ...child, entry, role, pairIndex, validation });
  }
  assert.ok(priorEnd <= Date.parse(envelope.completedAt));
  const reference = validated[0].report;
  const referenceContract = reference.comparisonContract;
  const stripRoutes = (contract) => {
    const { routes: _routes, ...rest } = structuredClone(contract);
    return rest;
  };
  for (const child of validated.slice(1)) {
    equal(
      stripRoutes(referenceContract),
      stripRoutes(child.report.comparisonContract),
      `sequence ${child.report.source.appCommit}: static contract changed`,
    );
    for (const key of [
      'userAgent',
      'platform',
      'renderer',
      'vendor',
      'viewport',
      'drawingBuffer',
      'nativeSharpnessProfile',
    ])
      equal(
        reference.environment[key],
        child.report.environment[key],
        `sequence ${child.entry.sequence}: ${key} changed`,
      );
    equal(
      reference.hostEnvironment,
      child.report.hostEnvironment,
      `sequence ${child.entry.sequence}: host identity changed`,
    );
    equal(
      reference.graphics,
      child.report.graphics,
      `sequence ${child.entry.sequence}: browser graphics identity changed`,
    );
    for (const scenario of SCENARIOS)
      assertRouteDescriptorsEquivalent(
        referenceContract.routes[scenario],
        child.report.comparisonContract.routes[scenario],
        `sequence ${child.entry.sequence}: ${scenario} route changed`,
      );
  }
  for (let pairIndex = 1; pairIndex <= 5; pairIndex += 1) {
    const pair = validated.slice((pairIndex - 1) * 2, pairIndex * 2);
    assert.equal(pair.length, 2);
    assert.deepEqual(pair.map(({ role }) => role).sort(), [
      'candidate',
      'control',
    ]);
    const control = pair.find(({ role }) => role === 'control');
    const candidate = pair.find(({ role }) => role === 'candidate');
    assertPairEquivalent(control, candidate, `pair ${pairIndex}`);
  }
  const scenarios = {};
  for (const scenario of SCENARIOS) {
    const baseline = validated
      .filter(({ role }) => role === 'control')
      .map(
        ({ validation }) =>
          validation.byScenario.get(scenario)[0].frameIntervalMs.p95,
      );
    const candidate = validated
      .filter(({ role }) => role === 'candidate')
      .map(
        ({ validation }) =>
          validation.byScenario.get(scenario)[0].frameIntervalMs.p95,
      );
    assert.equal(baseline.length, 5);
    assert.equal(candidate.length, 5);
    const available =
      baseline.every(Number.isFinite) && candidate.every(Number.isFinite);
    if (!available) {
      scenarios[scenario] = {
        status: 'unavailable',
        baselineRuns: baseline,
        candidateRuns: candidate,
        baselineMedianP95Ms: null,
        candidateMedianP95Ms: null,
        changePct: null,
        regressionOver10Pct: false,
      };
      continue;
    }
    const baselineMedianP95Ms = median(baseline);
    const candidateMedianP95Ms = median(candidate);
    const changePct =
      ((candidateMedianP95Ms - baselineMedianP95Ms) / baselineMedianP95Ms) *
      100;
    scenarios[scenario] = {
      status: 'measured',
      baselineRuns: baseline,
      candidateRuns: candidate,
      baselineMedianP95Ms,
      candidateMedianP95Ms,
      changePct,
      regressionOver10Pct: changePct > 10,
    };
  }
  return {
    status: 'comparable',
    environmentId: plan.environmentId,
    evidenceScope: 'balanced-five-pair-full-weather-qualification',
    order: WEATHER_BALANCED_ORDER,
    pairCount: 5,
    scenarios,
    environment: {
      userAgent: reference.environment.userAgent,
      platform: reference.environment.platform,
      renderer: reference.environment.renderer,
      vendor: reference.environment.vendor,
      viewport: reference.environment.viewport,
      drawingBuffer: reference.environment.drawingBuffer,
      hardwareEligible: reference.environment.hardwareEligible,
      nativeSharpnessProfile: reference.environment.nativeSharpnessProfile,
      hostEnvironment: reference.hostEnvironment,
      graphics: reference.graphics,
    },
    controlReport: validated.find(({ role }) => role === 'control').report,
    candidateReport: validated.find(({ role }) => role === 'candidate').report,
    regressionsOver10Pct: SCENARIOS.filter(
      (scenario) => scenarios[scenario].regressionOver10Pct,
    ),
  };
}

export function validateWeatherBalancedEnvelopeArtifact(
  envelope,
  { root } = {},
) {
  assert.ok(root && path.isAbsolute(root), 'Envelope root must be absolute');
  const planArtifact = readChild(root, envelope?.planArtifact);
  return validateWeatherBalancedEnvelope(envelope, {
    root,
    plan: planArtifact.report,
  });
}

export function createWeatherBalancedCaptureInvocation(plan, role, reportPath) {
  validateWeatherBalancedPlan(plan);
  assert.ok(['control', 'candidate'].includes(role));
  const revision = plan[role];
  const args = [
    path.join(
      plan.captureHarness.checkout,
      'scripts',
      'capture-scene-performance.mjs',
    ),
    '--url',
    revision.build.baseUrl,
    '--out',
    reportPath,
    '--runs',
    '1',
    '--warmup-ms',
    '30000',
    '--seconds',
    '60',
    '--quality-mode',
    'manual',
    '--detection-mode',
    'DENSE',
    '--expected-density',
    '75',
    '--hardware-required',
    '--provider-fixture',
    WEATHER_FIXTURE,
    '--provider-fixture-time',
    plan.fixedTime,
    '--worker-audit-mode',
    'receipt-only',
    '--build-receipt',
    revision.build.receipt,
    '--app-checkout',
    revision.appCheckout,
    '--harness-checkout',
    plan.captureHarness.checkout,
    '--build-root',
    revision.build.root,
    '--expected-app-sha',
    revision.appCommit,
    '--expected-harness-sha',
    plan.captureHarness.commit,
    '--served-base-url',
    revision.build.baseUrl,
    '--build-harness-checkout',
    plan.buildHarness.checkout,
    '--expected-build-harness-sha',
    plan.buildHarness.commit,
    '--comparison-profile',
    NATIVE_SHARPNESS_PROFILE_ID,
    '--weather-balanced-qualification-shard',
  ];
  return Object.freeze({
    command: process.execPath,
    cwd: plan.captureHarness.checkout,
    args: Object.freeze(args),
    env: Object.freeze({
      PUPPETEER_EXECUTABLE_PATH: plan.browser.executable,
    }),
  });
}

const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
};
