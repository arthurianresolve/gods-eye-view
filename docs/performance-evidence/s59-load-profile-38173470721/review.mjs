import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const harnessRoot = resolve(process.argv[2]);
const expectedCommit = '552d1144c2dc24780449dabe56f9ee50f9d8c3e2';
const helperPath = resolve(harnessRoot, 'scripts/performance/importGeometryLoadProfile.mjs');
const raw = await readFile(new URL('./report.json', import.meta.url));
const report = JSON.parse(raw);
const digest = (value) => createHash('sha256').update(value).digest('hex');
assert.equal(digest(await readFile(helperPath)), report.source.hashes.profileHelperSha256);
const { validateImportGeometryLoadProfileReport } = await import(pathToFileURL(helperPath));
assert.deepEqual(validateImportGeometryLoadProfileReport(report, {
  commit: expectedCommit,
  geometrySha256: '74fccdb194475b32c4b93fead20e5cb7a92f313243a1a1bd0795c7c733de963f',
}), { valid: true, errors: [] });

// Independently walk the retained tree and verify sample ownership. Node and
// individual-sample estimates are reported separately, never forced to agree.
const nodes = new Map();
let nodeSelfSizeBytes = 0;
function visit(node) {
  assert(!nodes.has(node.id));
  nodes.set(node.id, node);
  nodeSelfSizeBytes += node.selfSize;
  node.children.forEach(visit);
}
visit(report.profile.profile.head);
let sampleSizeBytes = 0;
for (const sample of report.profile.profile.samples) {
  assert(nodes.has(sample.nodeId));
  sampleSizeBytes += sample.size;
}
assert.equal(nodes.size, report.profile.nodeCount);
assert.equal(nodeSelfSizeBytes, report.profile.sampledAllocationBytes);
assert.equal(digest(JSON.stringify(report.profile.profile)), report.profile.rawInputSha256);
assert.equal(digest(JSON.stringify(report.profile.traceInput)), report.profile.traceInputSha256);
const markers = report.profile.traceInput.events.filter(e => e.name === report.fixture.anchor.name);
assert.equal(markers.length, 1);
const marker = markers[0];
assert.equal(marker.markerType, 'performance-mark');
assert(Math.abs(marker.recordedStartTimeMs - report.fixture.anchor.pageNowMs) <= 0.001);
const offsetUs = marker.tsUs - report.fixture.anchor.pageNowMs * 1000;
const startUs = offsetUs + report.fixture.loadStartedAtMs * 1000;
const endUs = offsetUs + report.fixture.loadCompletedAtMs * 1000;
const durations = [[], []];
for (const event of report.profile.traceInput.events.filter(e => e.kind === 'gc')) {
  const start = Math.max(startUs, event.tsUs);
  const end = Math.min(endUs, event.tsUs + event.durationUs);
  if (end > start) durations[event.pid === marker.pid && event.tid === marker.tid ? 0 : 1].push([start, end]);
}
const union = (intervals) => {
  let total = 0, previousEnd = -Infinity;
  for (const [start, end] of intervals.sort((a, b) => a[0] - b[0])) {
    total += Math.max(0, end - Math.max(start, previousEnd));
    previousEnd = Math.max(previousEnd, end);
  }
  return total / 1000;
};
assert.equal(union(durations[0]), report.profile.trace.sameThreadGcOverlapMs);
assert.equal(union(durations[1]), report.profile.trace.otherThreadGcOverlapMs);
assert.equal(report.browserCleanup.observation.processExit.code, 0);
assert(report.browserCleanup.observation.closeElapsedMs < 5000);

const review = {
  status: 'passed', scope: 'independently recomputed diagnostic; not performance acceptance',
  candidateCommit: expectedCommit,
  reportSha256: digest(raw), reviewerScriptSha256: digest(await readFile(new URL(import.meta.url))),
  nodeCount: nodes.size, sampleCount: report.profile.profile.samples.length,
  nodeSelfSizeBytes, sampleSizeBytes,
  loadElapsedMs: report.fixture.loadElapsedMs,
  sameThreadGcOverlapMs: union(durations[0]), otherThreadGcOverlapMs: union(durations[1]),
  naturalBrowserCloseMs: report.browserCleanup.observation.closeElapsedMs,
  performanceAcceptanceEligible: false,
};
await writeFile(new URL('./review.json', import.meta.url), JSON.stringify(review, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify(review));
