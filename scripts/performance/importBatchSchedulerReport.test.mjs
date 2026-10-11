import assert from 'node:assert/strict';
import test from 'node:test';
import { validateImportBatchSchedulerReport } from './importBatchSchedulerReport.mjs';

const commit = 'a'.repeat(40);
const digest = 'b'.repeat(64);

function batchMetrics() {
  return {
    budgetMs: 4,
    totalBatches: 2,
    yieldedBatches: 1,
    queuedWakeCount: 1,
    maxActiveBatchMs: 4.1,
    maxEnqueueToWakeMs: 2,
    backends: { 'synchronous-start': 1, MessageChannel: 1 },
    samples: [
      {
        activeMs: 4.1,
        enqueueToWakeMs: null,
        schedulerBackend: 'synchronous-start',
        budgetMs: 4,
        yielded: true,
      },
      {
        activeMs: 1,
        enqueueToWakeMs: 2,
        schedulerBackend: 'MessageChannel',
        budgetMs: 4,
        yielded: false,
      },
    ],
    truncatedSamples: 0,
  };
}

function geometryRows() {
  return [
    {
      id: 'gev-import:scheduler-geometry:scheduler-probe:line',
      geometryType: 'LineString',
      coordinateCount: 50_000,
      ringCoordinateCounts: [50_000],
      geometrySha256: digest,
    },
    {
      id: 'gev-import:scheduler-geometry:scheduler-probe:polygon',
      geometryType: 'Polygon',
      coordinateCount: 50_000,
      ringCoordinateCounts: [25_000, 25_000],
      geometrySha256: digest,
    },
  ];
}

function validReport() {
  const metrics = batchMetrics();
  const rows = geometryRows();
  return {
    schema: 'gev-import-batches/v2',
    status: 'passed',
    applicationCommit: commit,
    harnessCommit: commit,
    workload: 'paired',
    captureMode: 'pixels',
    featureLimit: 5000,
    cooperativeScheduler: {
      configuration: 'production-default',
      scheduleOverride: false,
      cancelOverride: false,
      targetBudgetMs: 4,
      batchObserver: 'onBatch metrics only; does not replace the scheduler',
      backendCounts: { 'synchronous-start': 20, MessageChannel: 18 },
    },
    samples: Array.from({ length: 5 }, (_, pair) => {
      const synchronous = {
        pair,
        mode: 'synchronous',
        features: 5000,
        pixelSha256: digest,
        capture: { completed: true },
        batchMetrics: null,
      };
      const cooperative = {
        pair,
        mode: 'cooperative',
        features: 5000,
        pixelSha256: digest,
        capture: { completed: true },
        batchMetrics: structuredClone(metrics),
      };
      return pair % 2 ? [cooperative, synchronous] : [synchronous, cooperative];
    }).flat(),
    largeGeometry: {
      featureLimit: 5000,
      featureCount: 2,
      sourceCoordinateCounts: { LineString: 50_000, Polygon: 50_000 },
      synchronous: {
        drawn: 2,
        omitted: 0,
        rows: rows.map((row) => ({ ...row })),
      },
      cooperative: {
        drawn: 2,
        omitted: 0,
        rows: rows.map((row) => ({ ...row })),
        batchMetrics: structuredClone(metrics),
      },
      exactOutputParity: true,
    },
    cancellation: {
      attempted: 12,
      abortErrors: 12,
      pendingJobsAfter: 0,
      featureCountAfter: 0,
      ownershipReleased: true,
    },
    checks: [
      { id: 'same-population-evidence-and-pixels', status: 'passed' },
      {
        id: 'full-linestring-and-polygon-output-and-production-scheduler',
        status: 'passed',
      },
      { id: 'twelve-cancelled-imports-release-ownership', status: 'passed' },
    ],
  };
}

test('accepts complete paired production-scheduler evidence', () => {
  assert.deepEqual(validateImportBatchSchedulerReport(validReport(), commit), {
    valid: true,
    errors: [],
  });
});

test('rejects a timer-injected candidate even when status says passed', () => {
  const report = validReport();
  report.cooperativeScheduler.backendCounts.setTimeout = 30;
  report.samples.find(
    (sample) => sample.mode === 'cooperative',
  ).batchMetrics.backends = {
    'synchronous-start': 1,
    setTimeout: 1,
  };
  const result = validateImportBatchSchedulerReport(report, commit);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.includes('timer fallback')));
});

test('rejects scheduler overrides and mismatched source revisions', () => {
  const report = validReport();
  report.cooperativeScheduler.scheduleOverride = true;
  report.harnessCommit = 'c'.repeat(40);
  const result = validateImportBatchSchedulerReport(report, commit);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.includes('overridden')));
  assert.ok(result.errors.some((error) => error.includes('harness commit')));
});

test('rejects truncated geometry or stale output-parity flags', () => {
  const report = validReport();
  report.largeGeometry.cooperative.rows[1].ringCoordinateCounts = [25_000];
  report.largeGeometry.exactOutputParity = true;
  assert.equal(validateImportBatchSchedulerReport(report, commit).valid, false);
  const altered = validReport();
  altered.largeGeometry.cooperative.rows[0].geometrySha256 = 'c'.repeat(64);
  assert.equal(
    validateImportBatchSchedulerReport(altered, commit).valid,
    false,
  );
});

test('rejects missing wake, ownership-release and required checks', () => {
  const report = validReport();
  report.largeGeometry.cooperative.batchMetrics.queuedWakeCount = 0;
  report.cancellation.pendingJobsAfter = 1;
  report.checks.pop();
  const result = validateImportBatchSchedulerReport(report, commit);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.includes('did not yield')));
  assert.ok(result.errors.some((error) => error.includes('ownership')));
  assert.ok(
    result.errors.some((error) => error.includes('required check missing')),
  );
});

test('malformed evidence fails closed without throwing during validation', () => {
  const report = validReport();
  report.samples[0] = null;
  report.largeGeometry.cooperative.rows = [null];
  assert.equal(validateImportBatchSchedulerReport(report, commit).valid, false);
  const missing = validReport();
  missing.samples = null;
  assert.equal(
    validateImportBatchSchedulerReport(missing, commit).valid,
    false,
  );
});

test('wrong nested container types and null checks are rejected without exceptions', () => {
  for (const mutate of [
    (report) => {
      report.samples.find(
        (row) => row.mode === 'cooperative',
      ).batchMetrics.samples = {};
    },
    (report) => {
      report.largeGeometry.cooperative.rows = {};
    },
    (report) => {
      report.checks = {};
    },
    (report) => {
      report.checks[0] = null;
    },
  ]) {
    const report = validReport();
    mutate(report);
    assert.equal(
      validateImportBatchSchedulerReport(report, commit).valid,
      false,
    );
  }
  assert.equal(
    validateImportBatchSchedulerReport(validReport(), undefined).valid,
    false,
  );
});
