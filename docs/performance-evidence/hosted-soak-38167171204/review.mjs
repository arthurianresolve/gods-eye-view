import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { evaluateManifestPerformanceEvidence } from '../../../scripts/performance/candidatePerformanceEvidence.mjs';

const directory = resolve(
  process.argv[2] || 'docs/performance-evidence/hosted-soak-38167171204',
);
const bytes = readFileSync(resolve(directory, 'report.json'));
const sourceSha256 = createHash('sha256').update(bytes).digest('hex');
assert.equal(
  sourceSha256,
  '592f840d6dfeb8c649b692363a4df3b97018b260b1b9c0ccb30172780f51489d',
);
const raw = JSON.parse(bytes),
  report = raw.soak;
const candidate = '7cea7aac9891d165a3c59bc09281bba735b71224';
assert.equal(raw.commit, candidate);
assert.equal(raw.harnessCommit, candidate);
assert.equal(report.applicationCommit, candidate);
assert.equal(report.harnessCommit, candidate);
assert.equal(raw.status, 'passed');
assert.equal(report.operationStatus, 'passed');
assert.equal(report.candidateCommit, candidate);
for (const body of [raw, report]) {
  for (const field of [
    'sourceDirtyAtStart',
    'harnessDirtyAtStart',
    'sourceChangedDuringRun',
    'harnessChangedDuringRun',
  ])
    assert.equal(body[field], false);
}
for (const field of ['probeBrowserClose', 'browserClose']) {
  assert.equal(raw[field]?.closeCompleted, true);
  assert.equal(raw[field]?.forcedProcessTermination, false);
}
assert.equal(raw.cleanupError, undefined);
assert.ok(report.durationMs >= 3600000);
const gauges = new Set([
  'listeners',
  'timers',
  'pendingJobs',
  'primitives',
  'groundPrimitives',
  'dataSources',
  'dataLayers',
  'cacheEntries',
  'imageryLayers',
  'renderHolds',
  'scheduledUpdates',
  'estimatedTileBytes',
]);
function counts(resources, prefix = '', output = {}) {
  for (const [key, value] of Object.entries(resources)) {
    if (typeof value === 'number' && gauges.has(key))
      output[prefix + key] = value;
    else if (value && typeof value === 'object')
      counts(value, prefix + key + '.', output);
  }
  return output;
}
const checkpoints = report.checkpoints;
assert.equal(checkpoints.length, 13);
const baseline = counts(checkpoints[0].metrics.application.resources);
assert.equal(Object.keys(baseline).length, 40);
for (const [i, checkpoint] of checkpoints.entries()) {
  if (i) assert.ok(checkpoint.elapsedMs > checkpoints[i - 1].elapsedMs);
  assert.ok(checkpoint.elapsedMs <= report.durationMs);
  assert.deepEqual(checkpoint.metrics.garbageCollection, {
    status: 'completed',
    method: 'HeapProfiler.collectGarbage',
  });
  assert.deepEqual(counts(checkpoint.metrics.application.resources), baseline);
  const workers = checkpoint.metrics.application.workers;
  assert.equal(workers.instrumented, true);
  assert.equal(workers.overflow, false);
  assert.equal(workers.pending, 0);
  for (const worker of workers.workers) {
    assert.equal(worker.pending, 0);
    assert.equal(worker.oldestPendingMs, 0);
  }
}
const last = checkpoints.at(-1);
const windowStart = checkpoints.findLastIndex(
  (c) => c.elapsedMs <= last.elapsedMs - 1800000,
);
assert.ok(windowStart >= 0);
const window = checkpoints.slice(windowStart),
  startHeap = window[0].metrics.JSHeapUsedSize;
const maxHeapGrowthRatio = Math.max(
  ...window.map((c) => c.metrics.JSHeapUsedSize / startHeap - 1),
);
assert.ok(maxHeapGrowthRatio <= 0.05);
const manifestResult = evaluateManifestPerformanceEvidence(
  {
    retention: [
      {
        environmentId: 'github-macos-paravirtual',
        report: { path: 'report.json', sha256: sourceSha256 },
      },
    ],
  },
  {
    manifestPath: resolve(directory, 'manifest.json'),
    candidateCommit: candidate,
  },
);
assert.equal(manifestResult.retention[0].status, 'passed');
assert.equal(manifestResult.retention[0].stability.status, 'passed');
assert.equal(manifestResult.retention[0].primaryEligible, false);
assert.deepEqual(manifestResult.retention[0].pending, []);
assert.equal(manifestResult.retentionOutcome.status, 'pending');
assert.equal(
  manifestResult.retentionOutcome.environments[0].status,
  'supplemental',
);
const review = {
  schema: 'gev-independent-retention-review/v1',
  sourceSha256,
  candidateCommit: candidate,
  reviewerCommit: execFileSync('git', ['rev-parse', 'HEAD'], {
    encoding: 'utf8',
  }).trim(),
  checkpointCount: checkpoints.length,
  durationMs: report.durationMs,
  resourceGaugeCount: Object.keys(baseline).length,
  resourceGaugesUnchangedAtEveryCheckpoint: true,
  pendingWorkerTasksAtEveryCheckpoint: 0,
  browserListenerRange: [
    Math.min(...checkpoints.map((c) => c.metrics.JSEventListeners)),
    Math.max(...checkpoints.map((c) => c.metrics.JSEventListeners)),
  ],
  initialFinalListeners: [
    checkpoints[0].metrics.JSEventListeners,
    last.metrics.JSEventListeners,
  ],
  initialFinalHeapBytes: [
    checkpoints[0].metrics.JSHeapUsedSize,
    last.metrics.JSHeapUsedSize,
  ],
  finalWindowStartMs: window[0].elapsedMs,
  finalWindowMaxHeapGrowthRatio: maxHeapGrowthRatio,
  finalWindowEndHeapGrowthRatio: last.metrics.JSHeapUsedSize / startHeap - 1,
  browserClose: raw.browserClose,
  probeBrowserClose: raw.probeBrowserClose,
  manifestResult,
};
writeFileSync(
  resolve(directory, 'review.json'),
  JSON.stringify(review, null, 2) + '\n',
  { flag: 'wx' },
);
console.log(
  JSON.stringify(
    { ...review, manifestResult: review.manifestResult.retention[0] },
    null,
    2,
  ),
);
