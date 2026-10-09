const STAGES = [
  'prior-install-saves-browser-workspace',
  'interrupted-update-retained-application',
  'prior-install-rollback-same-profile',
  'upgraded-application-same-profile',
  'failed-verification-rolls-back-and-reopens-assets',
];
const FIXTURE_WORKSPACE_ASSET_SHA256 =
  'd41c5ba5b579e090afd39f445f3df21b3a476581996c3980627e9bbc3d403d9c';

export const RENDERER_EXPERIMENT_VARIANTS = Object.freeze({
  'driver-late': { backend: 'swiftshader-gl-driver', queryTiming: 'late' },
  'webgl-late': { backend: 'swiftshader-webgl-only', queryTiming: 'late' },
  'driver-early': { backend: 'swiftshader-gl-driver', queryTiming: 'early' },
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
  if (digest !== FIXTURE_WORKSPACE_ASSET_SHA256)
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

/** Validate one same-host ABC or CBA packet and compute per-sequence deltas. */
export function evaluatePairedRendererExperiment({
  reports,
  order,
  expectedCommit,
}) {
  if (!['ABC', 'CBA'].includes(order)) fail('sequence must be ABC or CBA');
  const variants = order === 'ABC'
    ? ['driver-late', 'webgl-late', 'driver-early']
    : ['driver-early', 'webgl-late', 'driver-late'];
  if (!Array.isArray(reports) || reports.length !== 3)
    fail('packet must contain three reports');
  if (reports.some((entry, index) => entry?.variant !== variants[index]))
    fail('reports do not follow the declared execution sequence');
  const byVariant = new Map();
  for (const entry of reports) {
    if (!variants.includes(entry?.variant) || byVariant.has(entry.variant))
      fail('packet has an unknown or duplicate variant');
    byVariant.set(entry.variant, entry.report);
  }
  if (variants.some((variant) => !byVariant.has(variant)))
    fail('packet is incomplete');
  const reference = byVariant.get(variants[0]);
  if (
    reference?.rendererExperiment?.sequenceOrder !== order ||
    !reference?.rendererExperiment?.runId
  )
    fail('reference sequence identity is missing or mismatched');
  const digest = assertReport(reference, variants[0], expectedCommit, reference);
  const reportsByVariant = {};
  for (let index = 0; index < variants.length; index++) {
    const variant = variants[index];
    const report = byVariant.get(variant);
    if (assertReport(report, variant, expectedCommit, reference) !== digest)
      fail(`${variant} persisted workspace asset digest differs`);
    if (
      report.rendererExperiment.runId !== reference.rendererExperiment.runId ||
      report.rendererExperiment.sequenceIndex !== index
    )
      fail(`${variant} sequence/run identity differs`);
    reportsByVariant[variant] = report;
  }
  const control = reportsByVariant['driver-late'];
  const comparisons = {};
  for (const variant of ['webgl-late', 'driver-early']) {
    const candidate = reportsByVariant[variant];
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
    status: 'comparable',
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
