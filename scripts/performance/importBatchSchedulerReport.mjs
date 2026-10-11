const BACKENDS = new Set(['scheduler.postTask', 'MessageChannel']);
const BATCH_BACKENDS = new Set([...BACKENDS, 'synchronous-start']);

function finite(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function sha256(value) {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
}

function add(errors, valid, message) {
  if (!valid) errors.push(message);
}

function validateBatchMetrics(metrics, errors, name, { requireWake }) {
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
  for (const [index, sample] of (metrics.samples || []).entries()) {
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
}

export function validateImportBatchSchedulerReport(report, expectedCommit) {
  const errors = [];
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
    const line = result?.rows?.find(
      (row) => row?.geometryType === 'LineString',
    );
    const polygon = result?.rows?.find(
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
    { requireWake: true },
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
      report?.checks?.some((check) => check.id === expected),
      `required check missing: ${expected}`,
    );
  return { valid: errors.length === 0, errors };
}
