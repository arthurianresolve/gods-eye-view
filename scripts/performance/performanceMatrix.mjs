import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validatePairedPerformanceReports } from './pairedReport.mjs';
import { PERFORMANCE_ACCEPTANCE_POLICY_ID } from './candidatePerformanceEvidence.mjs';
import { AUSTIN_OPERATING_FIXED_TIME } from './austinOperatingWorkloadContract.mjs';
import { assertNativeSharpnessProfile } from './nativeSharpnessProfile.mjs';

export const PERFORMANCE_MATRIX_PLAN_SCHEMA = 'gev-performance-matrix-plan/v1';
export const PERFORMANCE_MATRIX_RESULT_SCHEMA =
  'gev-performance-matrix-result/v1';
export const PERFORMANCE_MATRIX_FIXED_TIME = '2026-10-08T12:00:00.000Z';
export const PERFORMANCE_COMPARISON_PROFILE = 'native-sharpness-v1';

export const PERFORMANCE_MATRIX_ROWS = Object.freeze([
  Object.freeze({
    id: 'operating-view',
    providerFixture: 'austin-operating-v1',
    fixedTime: AUSTIN_OPERATING_FIXED_TIME,
    order: Object.freeze(['baseline', 'candidate']),
    buildProfile: 'standard',
    workerAuditMode: 'receipt-only',
  }),
  Object.freeze({
    id: 'dense-investigation',
    providerFixture: 'dense-investigation',
    fixedTime: PERFORMANCE_MATRIX_FIXED_TIME,
    order: Object.freeze(['candidate', 'baseline']),
    buildProfile: 'standard',
    workerAuditMode: 'receipt-only',
    mixedLayers: true,
  }),
  Object.freeze({
    id: 'infrastructure-datacenters',
    providerFixture: 'infrastructure-datacenters',
    fixedTime: PERFORMANCE_MATRIX_FIXED_TIME,
    order: Object.freeze(['baseline', 'candidate']),
    buildProfile: 'standard',
    workerAuditMode: 'receipt-only',
  }),
  Object.freeze({
    id: 'infrastructure-dams',
    providerFixture: 'infrastructure-dams',
    fixedTime: PERFORMANCE_MATRIX_FIXED_TIME,
    order: Object.freeze(['candidate', 'baseline']),
    buildProfile: 'standard',
    workerAuditMode: 'receipt-only',
  }),
  Object.freeze({
    id: 'infrastructure-cables',
    providerFixture: 'infrastructure-cables',
    fixedTime: PERFORMANCE_MATRIX_FIXED_TIME,
    order: Object.freeze(['baseline', 'candidate']),
    buildProfile: 'standard',
    workerAuditMode: 'receipt-only',
  }),
  Object.freeze({
    id: 'infrastructure',
    providerFixture: 'infrastructure',
    fixedTime: PERFORMANCE_MATRIX_FIXED_TIME,
    order: Object.freeze(['candidate', 'baseline']),
    buildProfile: 'standard',
    workerAuditMode: 'receipt-only',
  }),
  Object.freeze({
    id: 'weather-effects',
    providerFixture: 'austin-weather-effects-phased-v2',
    fixedTime: PERFORMANCE_MATRIX_FIXED_TIME,
    order: Object.freeze(['baseline', 'candidate']),
    buildProfile: 'standard',
    workerAuditMode: 'receipt-only',
  }),
  Object.freeze({
    id: 'map-streaming',
    providerFixture: 'austin-map-streaming-v1',
    fixedTime: PERFORMANCE_MATRIX_FIXED_TIME,
    order: Object.freeze(['candidate', 'baseline']),
    buildProfile: 'austin-map-streaming-v1',
    workerAuditMode: 'diagnostic',
  }),
]);

const SHA1 = /^[a-f0-9]{40}$/;
const MATRIX_ROLES = new Set(['baseline', 'candidate']);

function requireObject(value, label) {
  assert.ok(value && typeof value === 'object' && !Array.isArray(value), label);
  return value;
}

function requireAbsolutePath(value, label) {
  assert.equal(typeof value, 'string', `${label} must be a string`);
  assert.ok(path.isAbsolute(value), `${label} must be absolute`);
  return path.resolve(value);
}

function requireLoopbackUrl(value, label) {
  const parsed = new URL(value);
  assert.equal(parsed.protocol, 'http:', `${label} must use local HTTP`);
  assert.ok(
    ['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname),
    `${label} must use a loopback host`,
  );
  assert.equal(parsed.username, '', `${label} must not contain credentials`);
  assert.equal(parsed.password, '', `${label} must not contain credentials`);
  parsed.pathname = '/';
  parsed.search = '';
  parsed.hash = '';
  return parsed.href.replace(/\/$/, '');
}

function validateBuild(build, label) {
  requireObject(build, `${label} build is required`);
  return Object.freeze({
    receipt: requireAbsolutePath(build.receipt, `${label}.receipt`),
    root: requireAbsolutePath(build.root, `${label}.root`),
    baseUrl: requireLoopbackUrl(build.baseUrl, `${label}.baseUrl`),
  });
}

function validateRevision(revision, role) {
  requireObject(revision, `${role} revision is required`);
  assert.match(revision.appCommit || '', SHA1, `${role}.appCommit`);
  const builds = requireObject(revision.builds, `${role}.builds is required`);
  return Object.freeze({
    appCommit: revision.appCommit,
    appCheckout: requireAbsolutePath(
      revision.appCheckout,
      `${role}.appCheckout`,
    ),
    builds: Object.freeze({
      standard: validateBuild(builds.standard, `${role}.builds.standard`),
      'austin-map-streaming-v1': validateBuild(
        builds['austin-map-streaming-v1'],
        `${role}.builds.austin-map-streaming-v1`,
      ),
    }),
  });
}

export function validatePerformanceMatrixPlan(plan) {
  requireObject(plan, 'Matrix plan is required');
  assert.equal(plan.schema, PERFORMANCE_MATRIX_PLAN_SCHEMA);
  assert.equal(plan.acceptancePolicyId, PERFORMANCE_ACCEPTANCE_POLICY_ID);
  assert.equal(plan.fixedTime, PERFORMANCE_MATRIX_FIXED_TIME);
  assert.match(plan.harnessCommit || '', SHA1, 'harnessCommit');
  const harnessCheckout = requireAbsolutePath(
    plan.harnessCheckout,
    'harnessCheckout',
  );
  const outputRoot = requireAbsolutePath(plan.outputRoot, 'outputRoot');
  const baseline = validateRevision(plan.baseline, 'baseline');
  const candidate = validateRevision(plan.candidate, 'candidate');
  assert.notEqual(
    baseline.appCommit,
    candidate.appCommit,
    'Baseline and candidate commits must differ',
  );
  assert.ok(Array.isArray(plan.rows), 'rows must be an array');
  assert.equal(plan.rows.length, PERFORMANCE_MATRIX_ROWS.length);
  const rows = plan.rows.map((row, index) => {
    requireObject(row, `rows[${index}]`);
    const expected = PERFORMANCE_MATRIX_ROWS[index];
    assert.equal(row.id, expected.id, `rows[${index}].id`);
    assert.deepEqual(row.order, expected.order, `${row.id}.order`);
    return expected;
  });
  assert.equal(
    rows.filter((row) => row.order[0] === 'baseline').length,
    4,
    'Matrix must contain four baseline-first rows',
  );
  assert.equal(
    rows.filter((row) => row.order[0] === 'candidate').length,
    4,
    'Matrix must contain four candidate-first rows',
  );
  return Object.freeze({
    schema: PERFORMANCE_MATRIX_PLAN_SCHEMA,
    acceptancePolicyId: PERFORMANCE_ACCEPTANCE_POLICY_ID,
    fixedTime: PERFORMANCE_MATRIX_FIXED_TIME,
    harnessCommit: plan.harnessCommit,
    harnessCheckout,
    outputRoot,
    baseline,
    candidate,
    rows: Object.freeze(rows),
    comparisonProfile: plan.comparisonProfile ?? 'legacy',
    ...(plan.chromeExecutable
      ? {
          chromeExecutable: requireAbsolutePath(
            plan.chromeExecutable,
            'chromeExecutable',
          ),
        }
      : {}),
  });
}

export function matrixReportPath(plan, row, role) {
  assert.ok(MATRIX_ROLES.has(role), `Unsupported matrix role: ${role}`);
  const target = path.resolve(plan.outputRoot, `${row.id}-${role}.json`);
  assert.ok(
    target.startsWith(`${path.resolve(plan.outputRoot)}${path.sep}`),
    'Matrix report escaped the output root',
  );
  return target;
}

export function createMatrixCaptureInvocation(plan, row, role) {
  const revision = plan[role];
  const build = revision.builds[row.buildProfile];
  const reportPath = matrixReportPath(plan, row, role);
  const script = path.resolve(
    plan.harnessCheckout,
    'scripts',
    'capture-scene-performance.mjs',
  );
  const args = [
    script,
    '--url',
    build.baseUrl,
    '--out',
    reportPath,
    '--runs',
    '5',
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
    row.providerFixture,
    '--provider-fixture-time',
    row.fixedTime,
    '--worker-audit-mode',
    row.workerAuditMode,
    '--build-receipt',
    build.receipt,
    '--app-checkout',
    revision.appCheckout,
    '--harness-checkout',
    plan.harnessCheckout,
    '--build-root',
    build.root,
    '--expected-app-sha',
    revision.appCommit,
    '--expected-harness-sha',
    plan.harnessCommit,
    '--served-base-url',
    build.baseUrl,
  ];
  args.push('--comparison-profile', plan.comparisonProfile ?? 'legacy');
  if (row.mixedLayers) args.push('--mixed-layers');
  if (row.buildProfile !== 'standard')
    args.push('--build-profile', row.buildProfile);
  return Object.freeze({
    command: process.execPath,
    args: Object.freeze(args),
    reportPath,
    env: Object.freeze({
      ...(plan.chromeExecutable
        ? { PUPPETEER_EXECUTABLE_PATH: plan.chromeExecutable }
        : {}),
    }),
  });
}

export function sha256File(filePath) {
  return crypto
    .createHash('sha256')
    .update(fs.readFileSync(filePath))
    .digest('hex');
}

export function readReusableMatrixReport(plan, row, role) {
  const reportPath = matrixReportPath(plan, row, role);
  let report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
  const revision = plan[role];
  assert.equal(report.schema, 'gev-performance-capture/v1');
  const expectedProfile = plan.comparisonProfile ?? 'legacy';
  const declaredProfile = report.comparisonProfile;
  if (declaredProfile !== undefined)
    assert.equal(
      declaredProfile,
      expectedProfile,
      'Reusable report comparison profile differs from matrix plan',
    );
  else if (expectedProfile === 'legacy') {
    // Historical reports predate the field and remain intentionally readable.
    // They are legacy only when the plan explicitly requests legacy.
  } else {
    // The capture producer in the frozen 1906 evidence omitted the top-level
    // label. Accept that omission only after proving every native boundary;
    // never infer native quality from the missing field alone.
    assert.equal(
      expectedProfile,
      PERFORMANCE_COMPARISON_PROFILE,
      'Only the declared native profile has a bounded compatibility path',
    );
    assert.ok(Array.isArray(report.captures) && report.captures.length > 0);
    let derivedProfile = null;
    for (const [index, capture] of report.captures.entries()) {
      for (const phase of ['before', 'after']) {
        const boundaryProfiles = [
          capture.settings?.[phase]?.nativeSharpnessProfile,
          capture.conditions?.[phase]?.settings?.nativeSharpnessProfile,
          capture.conditions?.[phase]?.environment?.nativeSharpnessProfile,
        ];
        for (const [boundaryIndex, profile] of boundaryProfiles.entries()) {
          assertNativeSharpnessProfile(
            { environment: { nativeSharpnessProfile: profile } },
            `${role} capture ${index + 1} ${phase} boundary ${boundaryIndex + 1}`,
          );
          derivedProfile ||= profile;
          assert.deepEqual(
            profile,
            derivedProfile,
            `${role} capture ${index + 1} ${phase} native profile differs from paired boundaries`,
          );
          const boundary = capture.conditions?.[phase]?.environment;
          assert.deepEqual(
            boundary?.viewport,
            profile.viewport,
            `${role} capture ${index + 1} ${phase} boundary viewport differs`,
          );
          assert.deepEqual(
            boundary?.drawingBuffer,
            profile.drawingBuffer,
            `${role} capture ${index + 1} ${phase} boundary drawing buffer differs`,
          );
        }
      }
    }
    if (report.environment?.nativeSharpnessProfile !== undefined) {
      assertNativeSharpnessProfile(report, `${role} report environment`);
      assert.deepEqual(
        report.environment.nativeSharpnessProfile,
        derivedProfile,
        `${role} explicit environment native profile differs from boundaries`,
      );
    }
    assert.deepEqual(
      report.environment.viewport,
      derivedProfile.viewport,
      `${role} environment viewport differs from native boundaries`,
    );
    assert.deepEqual(
      report.environment.drawingBuffer,
      derivedProfile.drawingBuffer,
      `${role} environment drawing buffer differs from native boundaries`,
    );
    // Keep the raw evidence untouched on disk while giving paired validation
    // an explicit, provenance-backed effective profile in memory.
    report = {
      ...report,
      comparisonProfile: expectedProfile,
      environment: {
        ...report.environment,
        nativeSharpnessProfile: derivedProfile,
      },
      comparisonProfileEvidence: {
        status: 'derived-from-all-capture-boundaries',
        boundaryCount: report.captures.length * 2,
      },
    };
  }
  assert.equal(report.comparisonEligible, true);
  assert.equal(report.comparisonReadiness?.status, 'ready');
  assert.equal(report.source?.appCommit, revision.appCommit);
  assert.equal(report.source?.harnessCommit, plan.harnessCommit);
  assert.equal(report.workload?.providerFixture, row.providerFixture);
  assert.equal(report.workload?.warmupMs, 30_000);
  assert.equal(report.workload?.durationPerSampleMs, 60_000);
  assert.equal(report.workload?.runsPerScenario, 5);
  assert.equal(report.workload?.qualityMode, 'manual');
  if (report.workload?.detectionMode === null && row.id === 'map-streaming') {
    // The first completed map reports predate the workload-field fix. Their
    // capture envelope still records both boundary snapshots for every sample,
    // so accept the legacy null only when all effective settings prove the
    // requested mode and density. Other workloads and any non-null value stay
    // exact-match requirements.
    assert.ok(
      Array.isArray(report.captures) && report.captures.length > 0,
      'Legacy map report must retain capture settings',
    );
    for (const capture of report.captures)
      for (const phase of ['before', 'after']) {
        const settings =
          capture.settings?.[phase] ?? capture.conditions?.[phase]?.settings;
        assert.equal(settings?.qualityMode, 'manual');
        assert.equal(settings?.detectionMode, 'DENSE');
        assert.equal(settings?.densityPct, 75);
      }
  } else assert.equal(report.workload?.detectionMode, 'DENSE');
  assert.equal(report.workload?.expectedDensityPct, 75);
  assert.equal(report.environment?.hardwareEligible, true);
  return report;
}

export function validateMatrixPair(plan, row) {
  const baseline = readReusableMatrixReport(plan, row, 'baseline');
  const candidate = readReusableMatrixReport(plan, row, 'candidate');
  const result = validatePairedPerformanceReports({
    baseline,
    candidate,
    expectedAppCommits: {
      baseline: plan.baseline.appCommit,
      candidate: plan.candidate.appCommit,
    },
    expectedComparisonProfile:
      plan.comparisonProfile === 'legacy' ? null : plan.comparisonProfile,
  });
  return {
    ...result,
    comparisonProfileEvidence: {
      baseline:
        baseline.comparisonProfileEvidence || { status: 'declared-in-report' },
      candidate:
        candidate.comparisonProfileEvidence || { status: 'declared-in-report' },
    },
  };
}

export function createMatrixResult(plan, completedRows, startedAt) {
  assert.equal(completedRows.length, PERFORMANCE_MATRIX_ROWS.length);
  return {
    schema: PERFORMANCE_MATRIX_RESULT_SCHEMA,
    acceptancePolicyId: PERFORMANCE_ACCEPTANCE_POLICY_ID,
    startedAt,
    completedAt: new Date().toISOString(),
    executionOrderScope:
      'complete five-run capture blocks counterbalanced across the eight workload rows',
    source: {
      baselineAppCommit: plan.baseline.appCommit,
      candidateAppCommit: plan.candidate.appCommit,
      harnessCommit: plan.harnessCommit,
    },
    environmentId: 'windows-uhd620',
    rows: completedRows,
  };
}

export function isDirectExecution(metaUrl, argv = process.argv) {
  return argv[1] && fileURLToPath(metaUrl) === path.resolve(argv[1]);
}
