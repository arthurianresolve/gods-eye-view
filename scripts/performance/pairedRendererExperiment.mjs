import { PROFILE_RECOVERY_WORKSPACE_ASSET_SHA256 } from './profileRecoveryFixtureContract.mjs';

const STAGES = [
  'prior-install-saves-browser-workspace',
  'interrupted-update-retained-application',
  'prior-install-rollback-same-profile',
  'upgraded-application-same-profile',
  'failed-verification-rolls-back-and-reopens-assets',
];

export const RENDERER_EXPERIMENT_VARIANTS = Object.freeze({
  'driver-late': { backend: 'swiftshader-gl-driver', queryTiming: 'late' },
  'webgl-late': { backend: 'swiftshader-webgl-only', queryTiming: 'late' },
  'driver-early': { backend: 'swiftshader-gl-driver', queryTiming: 'early' },
});
export const RENDERER_EXPERIMENT_ORDERS = Object.freeze({
  AB: ['driver-late', 'webgl-late'],
  BA: ['webgl-late', 'driver-late'],
  ABC: ['driver-late', 'webgl-late', 'driver-early'],
  CBA: ['driver-early', 'webgl-late', 'driver-late'],
});

const sameJson = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const fail = (message) => {
  throw new Error(`Renderer experiment evidence invalid: ${message}`);
};

function assertReport(report, variant, expectedCommit, reference) {
  const condition = RENDERER_EXPERIMENT_VARIANTS[variant];
  if (!condition) fail(`unknown variant ${variant}`);
  if (report?.scope !== 'prior-install-browser-profile-recovery')
    fail(`${variant} has wrong report scope`);
  if (report.status !== 'passed') fail(`${variant} recovery did not pass`);
  if (report.candidateCommit !== expectedCommit || !/^[a-f0-9]{40}$/i.test(expectedCommit))
    fail(`${variant} commit is missing or mismatched`);
  if (report.priorCommit !== reference.priorCommit)
    fail(`${variant} prior build differs`);
  if (report.sourceDirtyAtStart !== false || report.sourceChangedDuringRun !== false)
    fail(`${variant} source checkout was dirty or changed`);
  if (report.platform !== 'win32') fail(`${variant} is not a Windows run`);
  if (
    typeof report.hostEnvironment?.cpuModel !== 'string' ||
    !report.hostEnvironment.cpuModel.trim() ||
    !Number.isFinite(report.hostEnvironment.logicalCpus) ||
    report.hostEnvironment.logicalCpus < 1 ||
    !Number.isFinite(report.hostEnvironment.totalMemoryBytes) ||
    report.hostEnvironment.totalMemoryBytes < 1
  )
    fail(`${variant} host identity is incomplete`);
  if (!sameJson(report.hostEnvironment, reference.hostEnvironment))
    fail(`${variant} host changed within the sequence`);
  for (const key of ['os', 'node', 'browserVersion']) {
    if (typeof report[key] !== 'string' || !report[key].trim())
      fail(`${variant} ${key} is missing`);
    if (report[key] !== reference[key]) fail(`${variant} ${key} differs`);
  }
  if (!/^[a-f0-9]{40}$/i.test(report.priorCommit || ''))
    fail(`${variant} prior source SHA is incomplete`);
  if (
    !Number.isInteger(report.viewport?.width) ||
    report.viewport.width < 1 ||
    !Number.isInteger(report.viewport?.height) ||
    report.viewport.height < 1
  )
    fail(`${variant} viewport is incomplete`);
  if (!sameJson(report.viewport, reference.viewport))
    fail(`${variant} viewport differs`);
  if (report.requestedRenderingBackend !== condition.backend)
    fail(`${variant} requested backend differs`);
  if (
    report.rendererExperiment?.variant !== variant ||
    report.rendererExperiment?.queryTiming !== condition.queryTiming ||
    report.rendererExperiment?.sequenceOrder !== reference.rendererExperiment?.sequenceOrder ||
    !Number.isInteger(report.rendererExperiment?.sequenceIndex) ||
    typeof report.rendererExperiment?.runId !== 'string' ||
    !report.rendererExperiment.runId
  )
    fail(`${variant} query timing metadata differs`);
  if (!Array.isArray(report.checks) || report.checks.length !== STAGES.length)
    fail(`${variant} does not contain exactly five recovery stages`);
  const digest = report.checks[0]?.assetSha256;
  if (digest !== PROFILE_RECOVERY_WORKSPACE_ASSET_SHA256)
    fail(`${variant} persisted workspace asset digest differs from the declared fixture`);
  for (let index = 0; index < STAGES.length; index++) {
    const check = report.checks[index];
    if (check.id !== STAGES[index] || check.status !== 'passed')
      fail(`${variant} stage ${STAGES[index]} missing or failed`);
    if (check.assetSha256 !== digest || check.renderedFeatures !== 1)
      fail(`${variant} persisted workspace evidence changed at ${check.id}`);
    const ownership = check.pageOwnership;
    if (
      ownership?.initialPageCount !== 1 ||
      ownership.appPagesBeforeNavigation !== 0 ||
      ownership.appPagesAfterBoot !== 1 ||
      ownership.appPagesAfterWorkspace !== 1 ||
      ownership.unexpectedCreatedPageTargets !== 0 ||
      ownership.closeCompleted !== true ||
      ownership.openPagesBeforeBrowserClose !== 0 ||
      ownership.browserCloseCompleted !== true ||
      ownership.forcedBrowserProcessTermination !== false
    )
      fail(`${variant} page ownership invariant failed at ${check.id}`);
    if (check.settingsMatch !== true || check.workspaceBundleMatches !== true)
      fail(`${variant} persisted settings/bundle invariant missing at ${check.id}`);
    const timing = check.timing;
    for (const metric of [
      'bootElapsedMs',
      'rendererQueryDurationMs',
      'bootPlusQueryCriticalPathMs',
    ])
      if (
        !Number.isFinite(timing?.[metric]) ||
        timing[metric] < 0 ||
        (metric !== 'rendererQueryDurationMs' && timing[metric] === 0)
      )
        fail(`${variant} ${metric} is unavailable at ${check.id}`);
    if (timing.rendererQueryTiming !== condition.queryTiming)
      fail(`${variant} stage timing metadata differs at ${check.id}`);
    const expectedMeasurement =
      condition.queryTiming === 'early' ? 'page-query' : 'host-round-trip';
    if (timing.rendererQueryMeasurement !== expectedMeasurement)
      fail(`${variant} renderer query measurement type differs at ${check.id}`);
    if (condition.queryTiming === 'early') {
      if (
        timing.bootPlusQueryCriticalPathMs + 25 < timing.bootElapsedMs ||
        timing.rendererQueryDurationMs > timing.bootElapsedMs + 25
      )
        fail(`${variant} early query timing is inconsistent with boot at ${check.id}`);
    } else if (
      timing.bootPlusQueryCriticalPathMs + 50 <
      timing.bootElapsedMs + timing.rendererQueryDurationMs
    ) {
      fail(`${variant} late query timing is inconsistent with boot at ${check.id}`);
    }
    if (!/swiftshader/i.test(check.renderer || ''))
      fail(`${variant} did not use the requested software renderer at ${check.id}`);
  }
  return digest;
}

function median(values) {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

/** Validate one same-host packet and compare each present candidate independently. */
export function evaluatePairedRendererExperiment({
  reports,
  order,
  expectedCommit,
  processResults = [],
}) {
  const variants = RENDERER_EXPERIMENT_ORDERS[order];
  if (!variants) fail('sequence must be AB, BA, ABC, or CBA');
  if (!/^[a-f0-9]{40}$/i.test(expectedCommit || ''))
    fail('expected workflow commit must be a full SHA');
  if (!Array.isArray(reports) || reports.length < 1 || reports.length > variants.length)
    fail('packet has an invalid report count');
  if (
    !Array.isArray(processResults) ||
    processResults.length > variants.length ||
    processResults.some((entry, index) => entry?.variant !== variants[index])
  )
    fail('process results do not form the declared execution-sequence prefix');
  if (reports.some((entry, index) => entry?.variant !== variants[index]))
    fail('reports do not form the declared execution-sequence prefix');
  const byVariant = new Map();
  for (const entry of reports) {
    if (!variants.includes(entry?.variant) || byVariant.has(entry.variant))
      fail('packet has an unknown or duplicate variant');
    byVariant.set(entry.variant, entry.report);
  }
  const control = byVariant.get('driver-late');
  if (!control) fail('valid driver-late control report is required');
  const reference = control;
  if (
    reference?.rendererExperiment?.sequenceOrder !== order ||
    !reference?.rendererExperiment?.runId
  )
    fail('reference sequence identity is missing or mismatched');
  const controlIndex = variants.indexOf('driver-late');
  const digest = assertReport(reference, 'driver-late', expectedCommit, reference);
  if (
    reference.rendererExperiment.runId !== control.rendererExperiment.runId ||
    reference.rendererExperiment.sequenceIndex !== controlIndex
  )
    fail('control sequence identity differs');
  if (processResults.length) {
    const controlProcess = processResults.find((entry) => entry.variant === 'driver-late');
    if (controlProcess?.status !== 0 || controlProcess?.error)
      fail('driver-late control process did not exit successfully');
  }

  const validCandidates = new Map();
  const candidateFailures = new Map();
  for (const variant of variants.filter((entry) => entry !== 'driver-late')) {
    const report = byVariant.get(variant);
    if (!report) {
      const processResult = processResults.find((entry) => entry.variant === variant);
      candidateFailures.set(
        variant,
        processResult && (processResult.status !== 0 || processResult.error)
          ? `${variant} recovery process failed or timed out before producing a valid report`
          : 'report missing because the sequence ended early',
      );
      continue;
    }
    const index = variants.indexOf(variant);
    try {
      if (assertReport(report, variant, expectedCommit, reference) !== digest)
        fail(`${variant} persisted workspace asset digest differs`);
      if (
        report.rendererExperiment.runId !== reference.rendererExperiment.runId ||
        report.rendererExperiment.sequenceIndex !== index
      )
        fail(`${variant} sequence/run identity differs`);
      if (processResults.length) {
        const processResult = processResults.find((entry) => entry.variant === variant);
        if (processResult?.status !== 0 || processResult?.error)
          fail(`${variant} recovery process did not exit successfully`);
      }
      validCandidates.set(variant, report);
    } catch (error) {
      candidateFailures.set(variant, String(error?.message || error).replace(/^Renderer experiment evidence invalid: /, ''));
    }
  }
  const comparisons = {};
  for (const variant of variants.filter((entry) => entry !== 'driver-late')) {
    const candidate = validCandidates.get(variant);
    if (!candidate) {
      comparisons[variant] = {
        status: 'incomparable',
        reason: candidateFailures.get(variant) || 'candidate report unavailable',
        objectiveMet: false,
        adoptionEligible: false,
        stageRegressionOver10Percent: [],
      };
      continue;
    }
    const baselineValues = control.checks.map(
      (check) => check.timing.bootPlusQueryCriticalPathMs,
    );
    const candidateValues = candidate.checks.map(
      (check) => check.timing.bootPlusQueryCriticalPathMs,
    );
    const baselineMedianMs = median(baselineValues);
    const candidateMedianMs = median(candidateValues);
    const improvement = 1 - candidateMedianMs / baselineMedianMs;
    const stageChanges = STAGES.map((stage, index) => ({
      stage,
      changeFraction: candidateValues[index] / baselineValues[index] - 1,
    }));
    const stageRegressionOver10Percent = stageChanges
      .filter((change) => change.changeFraction > 0.1)
      .map((change) => change.stage);
    comparisons[variant] = {
      status: 'comparable',
      baselineMedianMs,
      candidateMedianMs,
      criticalPathImprovementFraction: improvement,
      stageChanges,
      objectiveMet: improvement >= 0.2,
      stageRegressionOver10Percent,
      adoptionEligible:
        improvement >= 0.2 && stageRegressionOver10Percent.length === 0,
    };
  }
  return {
    status: Object.values(comparisons).every((comparison) => comparison.status === 'comparable')
      ? 'comparable'
      : 'partially-comparable',
    evidenceScope: 'same-host profile-recovery timing experiment; not hardware-performance acceptance',
    adoptionEligibilityScope:
      'within-sequence only; confirm the same candidate in the counterbalanced other order',
    order,
    expectedCommit,
    priorCommit: reference.priorCommit,
    hostEnvironment: reference.hostEnvironment,
    persistedWorkspaceAssetSha256: digest,
    stageIds: STAGES,
    comparisons,
    adoptionEligibleByVariant: Object.fromEntries(
      Object.entries(comparisons).map(([variant, comparison]) => [
        variant,
        comparison.adoptionEligible,
      ]),
    ),
  };
}
