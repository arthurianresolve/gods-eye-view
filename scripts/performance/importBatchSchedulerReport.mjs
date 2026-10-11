const BACKENDS = new Set(['scheduler.postTask', 'MessageChannel']);
const BATCH_BACKENDS = new Set([...BACKENDS, 'synchronous-start']);
const STEP_DIAGNOSTIC_OBSERVER =
  'per-iterator-next timing, grouped by existing yield stage; diagnostic overhead excluded from acceptance';
const STEP_TRACE_OBSERVER =
  'per-iterator-next timing with bounded V8 GC trace overlap; diagnostic-only';

const array = (value) => (Array.isArray(value) ? value : []);

function finite(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function sha256(value) {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
}

function add(errors, valid, message) {
  if (!valid) errors.push(message);
}

function validateBatchMetrics(
  metrics,
  errors,
  name,
  { requireWake, requireStepMetrics = false, requireTraceAttribution = false },
) {
  add(
    errors,
    metrics && typeof metrics === 'object',
    `${name} metrics missing`,
  );
  if (!metrics || typeof metrics !== 'object') return;
  add(errors, metrics.budgetMs === 4, `${name} budget must remain 4ms`);
  add(
    errors,
    Number.isInteger(metrics.totalBatches) && metrics.totalBatches > 0,
    `${name} must report batches`,
  );
  add(
    errors,
    Number.isInteger(metrics.yieldedBatches) && metrics.yieldedBatches >= 0,
    `${name} yielded batch count is invalid`,
  );
  add(
    errors,
    finite(metrics.maxActiveBatchMs),
    `${name} active time is invalid`,
  );
  add(
    errors,
    Number.isInteger(metrics.queuedWakeCount) && metrics.queuedWakeCount >= 0,
    `${name} queued wake count is invalid`,
  );
  if (requireWake)
    add(errors, metrics.queuedWakeCount > 0, `${name} did not yield to a wake`);
  add(
    errors,
    Array.isArray(metrics.samples) &&
      metrics.samples.length > 0 &&
      metrics.samples.length <= 64,
    `${name} bounded batch samples missing`,
  );
  add(
    errors,
    Number.isInteger(metrics.truncatedSamples) && metrics.truncatedSamples >= 0,
    `${name} truncation count is invalid`,
  );
  const backends = metrics.backends;
  add(
    errors,
    backends && typeof backends === 'object' && !Array.isArray(backends),
    `${name} scheduler backend counts missing`,
  );
  if (!backends || typeof backends !== 'object' || Array.isArray(backends))
    return;
  for (const [backend, count] of Object.entries(backends)) {
    add(
      errors,
      BATCH_BACKENDS.has(backend),
      `${name} has unknown backend ${backend}`,
    );
    add(
      errors,
      Number.isInteger(count) && count > 0,
      `${name} backend count is invalid`,
    );
  }
  if (requireWake)
    add(
      errors,
      [...BACKENDS].some((backend) => backends[backend] > 0),
      `${name} has no production macrotask backend`,
    );
  for (const [index, sample] of array(metrics.samples).entries()) {
    add(
      errors,
      sample && typeof sample === 'object',
      `${name} sample ${index} missing`,
    );
    if (!sample || typeof sample !== 'object') continue;
    add(
      errors,
      finite(sample.activeMs),
      `${name} sample ${index} active time invalid`,
    );
    add(
      errors,
      sample.enqueueToWakeMs === null || finite(sample.enqueueToWakeMs),
      `${name} sample ${index} wake time invalid`,
    );
    add(
      errors,
      BATCH_BACKENDS.has(sample.schedulerBackend) ||
        sample.schedulerBackend === 'synchronous-start',
      `${name} sample ${index} backend invalid`,
    );
    add(
      errors,
      sample.budgetMs === 4,
      `${name} sample ${index} budget changed`,
    );
    add(
      errors,
      typeof sample.yielded === 'boolean',
      `${name} sample ${index} yield state missing`,
    );
  }
  const steps = metrics.iteratorSteps;
  add(
    errors,
    requireStepMetrics
      ? steps && typeof steps === 'object'
      : steps === undefined,
    `${name} iterator-step diagnostic mode mismatch`,
  );
  if (!requireStepMetrics || !steps || typeof steps !== 'object') return;
  const stages = [
    'entity',
    'coordinate-chunk',
    'unsupported-feature',
    'completed',
    'other',
  ];
  add(
    errors,
    Number.isInteger(steps.totalSteps) && steps.totalSteps > 0,
    `${name} iterator step count is invalid`,
  );
  add(
    errors,
    Number.isInteger(steps.overBudgetSteps) &&
      steps.overBudgetSteps >= 0 &&
      steps.overBudgetSteps <= steps.totalSteps,
    `${name} iterator over-budget count is invalid`,
  );
  add(errors, finite(steps.maxStepMs), `${name} maximum step time is invalid`);
  const stageRows = steps.stages;
  add(
    errors,
    stageRows &&
      typeof stageRows === 'object' &&
      !Array.isArray(stageRows) &&
      JSON.stringify(Object.keys(stageRows).sort()) ===
        JSON.stringify([...stages].sort()),
    `${name} iterator stage counts are incomplete`,
  );
  if (!stageRows || typeof stageRows !== 'object' || Array.isArray(stageRows))
    return;
  let stageCount = 0;
  let stageOverBudget = 0;
  let maximumStageMs = 0;
  for (const stage of stages) {
    const row = stageRows[stage];
    add(
      errors,
      row &&
        Number.isInteger(row.count) &&
        row.count >= 0 &&
        Number.isInteger(row.overBudget) &&
        row.overBudget >= 0 &&
        row.overBudget <= row.count &&
        finite(row.maxMs) &&
        (row.count !== 0 || row.maxMs === 0) &&
        row.overBudget > 0 === row.maxMs > metrics.budgetMs,
      `${name} iterator stage ${stage} is invalid`,
    );
    if (row && Number.isInteger(row.count)) stageCount += row.count;
    if (row && Number.isInteger(row.overBudget))
      stageOverBudget += row.overBudget;
    if (row && finite(row.maxMs))
      maximumStageMs = Math.max(maximumStageMs, row.maxMs);
  }
  add(
    errors,
    stageCount === steps.totalSteps &&
      stageOverBudget === steps.overBudgetSteps,
    `${name} iterator stage totals do not reconcile`,
  );
  add(
    errors,
    maximumStageMs === steps.maxStepMs,
    `${name} iterator maximum does not reconcile`,
  );
  if (requireTraceAttribution) {
    const windows = steps.slowStepWindows;
    add(
      errors,
      Array.isArray(windows) && windows.length <= 128,
      `${name} bounded slow-step windows missing`,
    );
    add(
      errors,
      Number.isInteger(steps.omittedSlowStepWindows) &&
        steps.omittedSlowStepWindows >= 0 &&
        array(windows).length + steps.omittedSlowStepWindows ===
          steps.overBudgetSteps,
      `${name} slow-step windows do not reconcile`,
    );
    for (const [index, window] of array(windows).entries())
      add(
        errors,
        window &&
          stages.includes(window.stage) &&
          typeof window.markerName === 'string' &&
          finite(window.startMs) &&
          finite(window.endMs) &&
          window.endMs >= window.startMs &&
          finite(window.durationMs) &&
          window.durationMs > metrics.budgetMs,
        `${name} slow-step window ${index} is invalid`,
      );
  } else
    add(
      errors,
      steps.slowStepWindows === undefined &&
        steps.omittedSlowStepWindows === undefined,
      `${name} has unrequested trace step windows`,
    );
}

export function validateImportBatchSchedulerReport(report, expectedCommit) {
  const errors = [];
  add(
    errors,
    typeof expectedCommit === 'string' && /^[a-f0-9]{40}$/.test(expectedCommit),
    'expected commit is invalid',
  );
  add(errors, report?.schema === 'gev-import-batches/v2', 'schema must be v2');
  add(errors, report?.status === 'passed', 'fixture did not pass');
  add(
    errors,
    report?.applicationCommit === expectedCommit,
    'application commit mismatch',
  );
  add(
    errors,
    report?.harnessCommit === expectedCommit,
    'harness commit mismatch',
  );
  add(errors, report?.workload === 'paired', 'paired workload required');
  add(errors, report?.captureMode === 'pixels', 'pixel capture required');
  add(errors, report?.featureLimit === 5000, 'rendered feature limit changed');
  const scheduler = report?.cooperativeScheduler;
  add(
    errors,
    scheduler?.configuration === 'production-default',
    'production-default scheduler was not used',
  );
  add(
    errors,
    scheduler?.scheduleOverride === false &&
      scheduler?.cancelOverride === false,
    'candidate scheduler was overridden',
  );
  add(
    errors,
    scheduler?.targetBudgetMs === 4,
    'scheduler target budget changed',
  );
  add(
    errors,
    scheduler?.batchObserver ===
      'onBatch metrics only; does not replace the scheduler',
    'scheduler observer contract changed',
  );
  const stepObserver = scheduler?.stepObserver;
  const requireTraceAttribution = stepObserver === STEP_TRACE_OBSERVER;
  const requireStepMetrics =
    stepObserver === STEP_DIAGNOSTIC_OBSERVER || requireTraceAttribution;
  add(
    errors,
    stepObserver === undefined ||
      stepObserver === 'disabled' ||
      requireStepMetrics,
    'unknown per-step observer contract',
  );
  if (requireStepMetrics)
    add(
      errors,
      report?.performanceAcceptanceEligible === false,
      'per-step diagnostic must be excluded from performance acceptance',
    );
  if (requireTraceAttribution) {
    const attribution =
      report?.importTraceAttribution ||
      report?.importBatches?.importTraceAttribution;
    const summary = attribution?.traceSummary;
    add(
      errors,
      attribution?.schema === 'gev-import-trace-attribution/v1',
      'loading trace attribution schema missing',
    );
    add(
      errors,
      attribution?.performanceAcceptanceEligible === false,
      'loading trace attribution must be excluded from acceptance',
    );
    add(
      errors,
      Array.isArray(attribution?.traceAnchors) &&
        attribution.traceAnchors.length >= 6 &&
        attribution.traceAnchors.length <= 774 &&
        Array.isArray(attribution?.loadingWindows) &&
        attribution.loadingWindows.length === 6,
      'loading trace marker/window inventory incomplete',
    );
    add(
      errors,
      summary?.schema === 'gev-import-trace-attribution/v1' &&
        summary?.complete === true &&
        summary?.performanceAcceptanceEligible === false &&
        typeof summary?.scope === 'string' &&
        summary.scope.includes('entire diagnostic fixture') &&
        summary.scope.includes('six measured loading windows') &&
        summary?.categories === 'devtools.timeline,disabled-by-default-v8.gc' &&
        typeof summary?.traceEventAccounting === 'string' &&
        summary.traceEventAccounting.length <= 240 &&
        Number.isInteger(summary?.traceRelevantEvents) &&
        summary.traceRelevantEvents >= 0 &&
        Number.isInteger(summary?.retainedTraceEvents) &&
        summary.retainedTraceEvents >= 0 &&
        summary.retainedTraceEvents <= 4096 &&
        summary?.omittedTraceEvents === 0 &&
        summary.traceRelevantEvents ===
          summary.retainedTraceEvents + summary.omittedTraceEvents &&
        Number.isFinite(summary?.bufferUsagePeak) &&
        summary.bufferUsagePeak >= 0 &&
        summary.bufferUsagePeak < 0.95 &&
        Array.isArray(summary?.errors) &&
        summary.errors.length === 0 &&
        Array.isArray(summary?.observedMarkers) &&
        Array.isArray(summary?.gcSlices) &&
        summary.gcSlices.length <= 4096 &&
        summary.gcSlices.every(
          (event) =>
            typeof event?.name === 'string' &&
            finite(event.tsUs) &&
            event.tsUs >= 0 &&
            finite(event.durationUs) &&
            event.durationUs >= 0 &&
            Number.isInteger(event.pid) &&
            Number.isInteger(event.tid),
        ) &&
        Array.isArray(summary?.gcInstantObservations) &&
        summary.gcInstantObservations.length <= 4096 &&
        summary.gcInstantObservations.every(
          (event) =>
            typeof event?.name === 'string' &&
            finite(event.tsUs) &&
            Number.isInteger(event.pid) &&
            Number.isInteger(event.tid),
        ) &&
        Array.isArray(summary?.loadingWindows) &&
        summary.loadingWindows.length === 6,
      'complete bounded loading trace attribution missing',
    );
    const anchorNames = new Set(
      array(attribution?.traceAnchors).map((anchor) => anchor?.name),
    );
    add(
      errors,
      anchorNames.size === array(attribution?.traceAnchors).length &&
        JSON.stringify([...anchorNames].sort()) ===
          JSON.stringify(array(summary?.observedMarkers).sort()) &&
        array(attribution?.loadingWindows).every(
          (window) =>
            typeof window?.markerName === 'string' &&
            anchorNames.has(window.markerName),
        ),
      'loading trace marker inventory is duplicated or incomplete',
    );
    for (const row of array(summary?.loadingWindows))
      add(
        errors,
        row?.aligned === true &&
          Number.isInteger(row.overBudgetSteps) &&
          Number.isInteger(row.recordedSlowSteps) &&
          row.omittedSlowSteps === 0 &&
          Number.isInteger(row.v8GcSlicesOverlappingLoad) &&
          Number.isInteger(row.v8GcSlicesOtherThreadsOverlappingLoad) &&
          finite(row.sameThreadGcOverlapMs) &&
          finite(row.otherThreadGcOverlapMs) &&
          Number.isInteger(row.v8GcSlicesOverlappingSlowSteps) &&
          finite(row.slowStepGcOverlapMs) &&
          Number.isInteger(row.traceProcessId) &&
          Number.isInteger(row.traceThreadId) &&
          Array.isArray(row.steps) &&
          row.steps.length === row.recordedSlowSteps &&
          row.steps.every(
            (step) =>
              step.aligned === true &&
              Number.isInteger(step.otherThreadGcSlices) &&
              finite(step.otherThreadGcOverlapMs),
          ),
        'loading trace attribution row is incomplete',
      );
    const loadingWindows = array(attribution?.loadingWindows);
    const expectedWindowKeys = [
      ...Array.from({ length: 5 }, (_, pair) => `${pair}:cooperative`),
      '5:geometry-cooperative',
    ];
    add(
      errors,
      JSON.stringify(
        loadingWindows
          .map((window) => `${window?.pair}:${window?.mode}`)
          .sort(),
      ) === JSON.stringify(expectedWindowKeys.sort()),
      'loading trace windows do not match the five paired loads and geometry load',
    );
    for (const window of loadingWindows) {
      const metrics =
        window?.mode === 'geometry-cooperative'
          ? report?.largeGeometry?.cooperative?.batchMetrics?.iteratorSteps
          : report?.samples?.find(
              (sample) =>
                sample?.pair === window?.pair && sample?.mode === 'cooperative',
            )?.batchMetrics?.iteratorSteps;
      const metricSteps = array(metrics?.slowStepWindows);
      const sameSteps =
        metricSteps.length === array(window?.slowSteps).length &&
        metricSteps.every((step, index) => {
          const row = window.slowSteps[index];
          return (
            step?.markerName === row?.markerName &&
            step?.stage === row?.stage &&
            step?.startMs === row?.startMs &&
            step?.endMs === row?.endMs &&
            step?.durationMs === row?.durationMs
          );
        });
      add(
        errors,
        metrics &&
          window?.markerName &&
          anchorNames.has(window.markerName) &&
          array(window?.slowSteps).every((step) =>
            anchorNames.has(step?.markerName),
          ) &&
          metrics.omittedSlowStepWindows === window.omittedSlowSteps &&
          metrics.overBudgetSteps === window.overBudgetSteps &&
          sameSteps,
        'loading trace windows do not match iterator-step evidence',
      );
    }
  } else
    add(
      errors,
      report?.importTraceAttribution === undefined &&
        report?.importBatches?.importTraceAttribution === undefined,
      'unrequested loading trace attribution present',
    );
  const backendCounts = scheduler?.backendCounts;
  add(
    errors,
    backendCounts && typeof backendCounts === 'object',
    'observed backend counts missing',
  );
  if (backendCounts && typeof backendCounts === 'object') {
    add(
      errors,
      [...BACKENDS].some((backend) => backendCounts[backend] > 0),
      'production postTask or MessageChannel backend was not observed',
    );
    add(
      errors,
      !Object.hasOwn(backendCounts, 'setTimeout'),
      'candidate unexpectedly used a timer fallback',
    );
  }
  add(
    errors,
    Array.isArray(report?.samples) && report.samples.length === 10,
    'expected five synchronous/cooperative pairs',
  );
  const samples = Array.isArray(report?.samples) ? report.samples : [];
  const cooperative = samples.filter(
    (sample) => sample && sample.mode === 'cooperative',
  );
  const synchronous = samples.filter(
    (sample) => sample && sample.mode === 'synchronous',
  );
  add(
    errors,
    cooperative.length === 5 && synchronous.length === 5,
    'sample modes are incomplete',
  );
  for (let pair = 0; pair < 5; pair++) {
    const pairSamples = samples.filter(
      (sample) => sample && sample.pair === pair,
    );
    const sync = pairSamples.find((sample) => sample.mode === 'synchronous');
    const async = pairSamples.find((sample) => sample.mode === 'cooperative');
    add(
      errors,
      pairSamples.length === 2 && Boolean(sync && async),
      `pair-${pair} is incomplete`,
    );
    add(
      errors,
      sync?.features === 5000 && async?.features === 5000,
      `pair-${pair} population changed`,
    );
    add(
      errors,
      sync?.capture?.completed === true && async?.capture?.completed === true,
      `pair-${pair} fresh frame missing`,
    );
    add(
      errors,
      sha256(sync?.pixelSha256) && sync.pixelSha256 === async?.pixelSha256,
      `pair-${pair} rendered pixels differ`,
    );
    const expectedModes =
      pair % 2
        ? ['cooperative', 'synchronous']
        : ['synchronous', 'cooperative'];
    add(
      errors,
      pairSamples[0]?.mode === expectedModes[0] &&
        pairSamples[1]?.mode === expectedModes[1],
      `pair-${pair} did not preserve alternating execution order`,
    );
  }
  for (const sample of cooperative)
    validateBatchMetrics(
      sample.batchMetrics,
      errors,
      `pair-${sample.pair}-cooperative`,
      {
        requireWake: true,
        requireStepMetrics,
        requireTraceAttribution,
      },
    );
  for (const sample of synchronous)
    add(
      errors,
      sample.batchMetrics === null,
      `pair-${sample.pair} sync path was instrumented as async`,
    );

  const geometry = report?.largeGeometry;
  add(
    errors,
    geometry?.featureLimit === 5000 && geometry?.featureCount === 2,
    'large-geometry feature limits/population changed',
  );
  add(
    errors,
    geometry?.sourceCoordinateCounts?.LineString === 50_000 &&
      geometry?.sourceCoordinateCounts?.Polygon === 50_000,
    'large-geometry source populations changed',
  );
  add(
    errors,
    geometry?.exactOutputParity === true,
    'full geometry output parity failed',
  );
  for (const mode of ['synchronous', 'cooperative']) {
    const result = geometry?.[mode];
    add(
      errors,
      result?.drawn === 2 && result?.omitted === 0,
      `${mode} large-geometry population is incomplete`,
    );
    add(
      errors,
      Array.isArray(result?.rows) && result.rows.length === 2,
      `${mode} geometry rows missing`,
    );
    const line = array(result?.rows).find(
      (row) => row?.geometryType === 'LineString',
    );
    const polygon = array(result?.rows).find(
      (row) => row?.geometryType === 'Polygon',
    );
    add(
      errors,
      line?.coordinateCount === 50_000 &&
        JSON.stringify(line.ringCoordinateCounts) === '[50000]',
      `${mode} LineString geometry was truncated`,
    );
    add(
      errors,
      polygon?.coordinateCount === 50_000 &&
        JSON.stringify(polygon.ringCoordinateCounts) === '[25000,25000]',
      `${mode} Polygon or hole was truncated`,
    );
    add(
      errors,
      sha256(line?.geometrySha256) && sha256(polygon?.geometrySha256),
      `${mode} geometry hashes missing`,
    );
    add(
      errors,
      typeof line?.id === 'string' && typeof polygon?.id === 'string',
      `${mode} geometry identity missing`,
    );
  }
  if (geometry?.synchronous?.rows && geometry?.cooperative?.rows)
    add(
      errors,
      JSON.stringify(geometry.synchronous.rows) ===
        JSON.stringify(geometry.cooperative.rows),
      'synchronous and cooperative geometry identities/hashes differ',
    );
  validateBatchMetrics(
    geometry?.cooperative?.batchMetrics,
    errors,
    'large-geometry-cooperative',
    { requireWake: true, requireStepMetrics, requireTraceAttribution },
  );

  const cancellation = report?.cancellation;
  add(
    errors,
    cancellation?.attempted === 12 && cancellation?.abortErrors === 12,
    'queued cancellation repetitions incomplete',
  );
  add(
    errors,
    cancellation?.pendingJobsAfter === 0 &&
      cancellation?.featureCountAfter === 0 &&
      cancellation?.ownershipReleased === true,
    'cancelled import ownership was not released',
  );
  add(
    errors,
    Array.isArray(report?.checks) &&
      report.checks.every((check) => check?.status === 'passed'),
    'one or more fixture checks failed',
  );
  for (const expected of [
    'same-population-evidence-and-pixels',
    'full-linestring-and-polygon-output-and-production-scheduler',
    'twelve-cancelled-imports-release-ownership',
  ])
    add(
      errors,
      array(report?.checks).some((check) => check?.id === expected),
      `required check missing: ${expected}`,
    );
  return { valid: errors.length === 0, errors };
}
