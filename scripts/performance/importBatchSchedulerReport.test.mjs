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

function iteratorSteps() {
  return {
    totalSteps: 3,
    overBudgetSteps: 1,
    maxStepMs: 4.5,
    stages: {
      entity: { count: 1, overBudget: 1, maxMs: 4.5 },
      'coordinate-chunk': { count: 1, overBudget: 0, maxMs: 1 },
      'unsupported-feature': { count: 0, overBudget: 0, maxMs: 0 },
      completed: { count: 1, overBudget: 0, maxMs: 0.5 },
      other: { count: 0, overBudget: 0, maxMs: 0 },
    },
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

function traceAttributedReport() {
  const report = validReport();
  report.performanceAcceptanceEligible = false;
  report.cooperativeScheduler.stepObserver =
    'per-iterator-next timing with bounded V8 GC trace overlap; diagnostic-only';
  const anchors = [];
  const windows = [];
  const summaryRows = [];
  const cooperative = report.samples.filter(
    (sample) => sample.mode === 'cooperative',
  );
  cooperative.push({
    pair: 5,
    mode: 'geometry-cooperative',
    batchMetrics: report.largeGeometry.cooperative.batchMetrics,
  });
  cooperative.forEach((sample, index) => {
    const label =
      sample.mode === 'geometry-cooperative'
        ? 'geometry:cooperative'
        : `sample:${sample.pair}:${sample.mode}`;
    const loadMarker = `gev-import-step:${label}`;
    const stepMarker = `gev-import-step:step:${label}:entity:1`;
    anchors.push(
      { name: loadMarker, pageNowMs: 100 + index * 100, uncertaintyMs: 0.05 },
      { name: stepMarker, pageNowMs: 120 + index * 100, uncertaintyMs: 0.05 },
    );
    const steps = iteratorSteps();
    steps.slowStepWindows = [
      {
        stage: 'entity',
        startMs: 112 + index * 100,
        endMs: 120 + index * 100,
        durationMs: 8,
        markerName: stepMarker,
        anchorUncertaintyMs: 0.05,
      },
    ];
    steps.omittedSlowStepWindows = 0;
    sample.batchMetrics.iteratorSteps = steps;
    windows.push({
      pair: sample.pair,
      mode: sample.mode,
      markerName: loadMarker,
      startMs: 100 + index * 100,
      endMs: 150 + index * 100,
      overBudgetSteps: 1,
      slowSteps: steps.slowStepWindows,
      omittedSlowSteps: 0,
    });
    summaryRows.push({
      pair: sample.pair,
      mode: sample.mode,
      aligned: true,
      overBudgetSteps: 1,
      recordedSlowSteps: 1,
      omittedSlowSteps: 0,
      v8GcSlicesOverlappingLoad: 0,
      v8GcSlicesOtherThreadsOverlappingLoad: 0,
      sameThreadGcOverlapMs: 0,
      otherThreadGcOverlapMs: 0,
      v8GcSlicesOverlappingSlowSteps: 0,
      slowStepGcOverlapMs: 0,
      traceProcessId: 1,
      traceThreadId: 2,
      steps: [
        {
          stage: 'entity',
          markerName: stepMarker,
          durationMs: 8,
          aligned: true,
          otherThreadGcSlices: 0,
          otherThreadGcOverlapMs: 0,
        },
      ],
    });
  });
  report.importTraceAttribution = {
    schema: 'gev-import-trace-attribution/v2',
    performanceAcceptanceEligible: false,
    traceAnchors: anchors,
    loadingWindows: windows,
    traceSummary: {
      schema: 'gev-import-trace-attribution/v2',
      complete: true,
      performanceAcceptanceEligible: false,
      scope:
        'Chrome trace capture spans the entire diagnostic fixture, including setup and teardown; attribution is restricted to the six measured loading windows.',
      categories: 'devtools.timeline,disabled-by-default-v8.gc',
      traceEventAccounting:
        'Counts markers, complete GC X/B-E intervals, instant observations, and s/t/f GC flow edges separately. Flow phases are non-duration links; unsupported/incomplete duration records are omitted and fail completeness.',
      traceRelevantEvents: anchors.length,
      retainedTraceEvents: anchors.length,
      preparation: {
        name: 'gev-import-step:preparation',
        callDurationMs: 0.1,
        uncertaintyMs: 0.05,
      },
      flowEventCount: 0,
      flowPhaseCounts: { s: 0, t: 0, f: 0 },
      omittedTraceEvents: 0,
      bufferUsagePeak: 0.1,
      errors: [],
      observedMarkers: anchors.map((anchor) => anchor.name).sort(),
      gcSlices: [],
      gcInstantObservations: [],
      loadingWindows: summaryRows,
    },
  };
  return report;
}

test('accepts complete paired production-scheduler evidence', () => {
  assert.deepEqual(validateImportBatchSchedulerReport(validReport(), commit), {
    valid: true,
    errors: [],
  });
});

test('accepts bounded iterator-step attribution only when excluded from acceptance', () => {
  const report = validReport();
  report.performanceAcceptanceEligible = false;
  report.cooperativeScheduler.stepObserver =
    'per-iterator-next timing, grouped by existing yield stage; diagnostic overhead excluded from acceptance';
  for (const sample of report.samples)
    if (sample.mode === 'cooperative')
      sample.batchMetrics.iteratorSteps = iteratorSteps();
  report.largeGeometry.cooperative.batchMetrics.iteratorSteps = iteratorSteps();
  assert.deepEqual(validateImportBatchSchedulerReport(report, commit), {
    valid: true,
    errors: [],
  });

  for (const mutate of [
    (bad) => {
      delete bad.performanceAcceptanceEligible;
    },
    (bad) => {
      bad.performanceAcceptanceEligible = true;
    },
    (bad) => {
      bad.samples[1].batchMetrics.iteratorSteps.maxStepMs = 0;
    },
    (bad) => {
      bad.samples[1].batchMetrics.iteratorSteps.stages.entity.maxMs = 0;
    },
    (bad) => {
      bad.samples[1].batchMetrics.iteratorSteps.stages.other.maxMs = 1;
    },
  ]) {
    const bad = structuredClone(report);
    mutate(bad);
    assert.equal(validateImportBatchSchedulerReport(bad, commit).valid, false);
  }

  report.samples.find(
    (sample) => sample.mode === 'cooperative',
  ).batchMetrics.iteratorSteps.stages.entity.count = 2;
  const invalid = validateImportBatchSchedulerReport(report, commit);
  assert.equal(invalid.valid, false);
  assert.ok(
    invalid.errors.some((error) =>
      error.includes('stage totals do not reconcile'),
    ),
  );
});

test('accepts complete loading trace with per-step same-trace anchors', () => {
  const report = traceAttributedReport();
  assert.deepEqual(validateImportBatchSchedulerReport(report, commit), {
    valid: true,
    errors: [],
  });
});

test('rejects incomplete or misbound loading trace evidence', () => {
  for (const mutate of [
    (bad) => {
      bad.importTraceAttribution.traceAnchors.pop();
    },
    (bad) => {
      bad.importTraceAttribution.traceAnchors.push(
        bad.importTraceAttribution.traceAnchors[0],
      );
    },
    (bad) => {
      bad.importTraceAttribution.traceSummary.complete = false;
    },
    (bad) => {
      bad.importTraceAttribution.traceSummary.scope = 'loading only';
    },
    (bad) => {
      bad.importTraceAttribution.traceSummary.traceRelevantEvents += 1;
    },
    (bad) => {
      bad.importTraceAttribution.traceSummary.flowEventCount += 1;
    },
    (bad) => {
      bad.importTraceAttribution.traceSummary.flowPhaseCounts.s = -1;
    },
    (bad) => {
      bad.importTraceAttribution.traceSummary.preparation = null;
    },
    (bad) => {
      bad.importTraceAttribution.traceSummary.loadingWindows[0].steps[0].aligned = false;
    },
    (bad) => {
      bad.importTraceAttribution.traceSummary.loadingWindows[0].steps[0].durationMs = 9;
    },
    (bad) => {
      bad.importTraceAttribution.loadingWindows[0].slowSteps[0].durationMs = 9;
    },
    (bad) => {
      bad.importTraceAttribution.loadingWindows[0].omittedSlowSteps = 1;
    },
    (bad) => {
      bad.performanceAcceptanceEligible = true;
    },
    (bad) => {
      delete bad.samples.find((sample) => sample.mode === 'cooperative')
        .batchMetrics.iteratorSteps.slowStepWindows[0].markerName;
    },
  ]) {
    const bad = traceAttributedReport();
    mutate(bad);
    assert.equal(validateImportBatchSchedulerReport(bad, commit).valid, false);
  }
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
