import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const folder = path.dirname(fileURLToPath(import.meta.url));
const read = (name) =>
  JSON.parse(readFileSync(path.join(folder, name), 'utf8'));
const identity = (name) => {
  const bytes = readFileSync(path.join(folder, name));
  return {
    name,
    byteLength: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  };
};
const smoke = read('performance-build-smoke.json');
const run = read('run.json');
const candidate = smoke.variants.find((v) => v.label === 'candidate');
const reference = candidate.captureCliReportArtifact;
const rawIdentity = identity(reference.fileName);
assert.equal(rawIdentity.sha256, reference.sha256);
assert.equal(rawIdentity.byteLength, reference.byteLength);
const raw = read(reference.fileName);
const sha = '3384b8bd7b4c9f68318802bc6525dde3329ffab2';
assert.equal(run.headSha, sha);
assert.equal(run.conclusion, 'failure');
assert.equal(smoke.status, 'failed');
assert.equal(smoke.candidateSha, sha);
assert.equal(smoke.harnessSha, sha);
assert.equal(smoke.shaderProgramAttribution, true);
assert.equal(smoke.firstMotionCpuProfile, false);
assert.equal(smoke.depthPickAttribution, false);
assert.equal(smoke.sceneFrameDiagnostics, false);
assert.match(smoke.failure.message, /Child process timed out/);
assert.equal(raw.source.appCommit, sha);
assert.equal(raw.source.harnessCommit, sha);
assert.equal(raw.source.buildProvenance.after, null);
assert.equal(raw.schema, 'gev-performance-capture-failure/v1');
assert.equal(raw.status, 'failed');
assert.equal(raw.comparisonEligible, false);
assert.equal(raw.evidenceTruncated, true);
assert.equal(raw.failure.phase, 'prepare-fresh-provider-document');
assert.equal(raw.failure.scenario, 'selected-aircraft-tracking');
assert.equal(raw.failure.run, 2);
assert.equal(raw.progress.completedSampleCount, 5);
assert.deepEqual(
  raw.progress.completedSamples.map((s) => [s.scenario, s.run]),
  [
    ['idle', 1],
    ['idle', 2],
    ['scripted-motion', 1],
    ['scripted-motion', 2],
    ['selected-aircraft-tracking', 1],
  ],
);
const cleanup = raw.workload.rendererProbeCleanup;
assert.equal(cleanup.length, 7);
const summaries = raw.workload.shaderProgramAttribution;
assert.equal(summaries.expectedDocumentCount, 8);
assert.equal(summaries.status, 'incomplete');
assert.equal(summaries.documents.length, 7);
const documents = cleanup.map((entry) => {
  const observer = entry.document.shaderProgramAttribution;
  assert.equal(entry.confirmed, true);
  assert.equal(observer.cleanup.confirmed, true);
  assert.equal(observer.cleanup.installedMethodCount, 4);
  assert.equal(observer.cleanup.restoredMethodCount, 4);
  assert.equal(observer.cleanup.changedOwnerCount, 0);
  assert.equal(observer.limits.truncated, false);
  const summary = summaries.documents.find(
    (x) =>
      x.documentRole === entry.documentRole &&
      x.documentId === entry.documentId,
  );
  assert.ok(summary);
  assert.deepEqual(summary.totals, observer.totals);
  assert.equal(summary.trackedProgramCount, observer.programs.length);
  for (const p of observer.programs) {
    assert.equal(p.createCalls, 1);
    assert.equal(p.linkCalls, 1);
    assert.equal(p.parameterQueries, 3);
    assert.equal(p.parameterNames, undefined);
  }
  return {
    documentRole: entry.documentRole,
    documentId: entry.documentId,
    cleanupConfirmed: true,
    programCount: observer.programs.length,
    queryCount: observer.totals.getProgramParameter.calls,
    queryElapsedMs: observer.totals.getProgramParameter.elapsedSumMs,
    maximumQueryElapsedMs: observer.totals.getProgramParameter.maxElapsedMs,
    perParameterRowsPreserved: false,
  };
});
assert.equal(raw.workload.fixtureInterceptionReleases.length, 7);
assert.ok(raw.workload.fixtureInterceptionReleases.every((x) => x.confirmed));
const report = {
  schema: 'gev-shader-attribution-failed-run-review/v1',
  status: 'failed-capture-preserved',
  commit: sha,
  run: run.url,
  artifacts: [
    identity('performance-build-smoke.json'),
    rawIdentity,
    identity('run.json'),
    identity('job-failure.log.gz'),
  ],
  failure: raw.failure,
  outerFailure: smoke.failure.message,
  completedSamples: 5,
  expectedSamples: 6,
  servedBytes: 'pre-capture verified; post-capture verification missing',
  renderer: raw.progress.startupSamples[0].renderer,
  documents,
  totalPrograms: documents.reduce((n, d) => n + d.programCount, 0),
  totalQueries: documents.reduce((n, d) => n + d.queryCount, 0),
  totalQueryElapsedMs: documents.reduce((n, d) => n + d.queryElapsedMs, 0),
  limitations: [
    'The existing 180-second child deadline stopped the run; no deadline or fidelity reduction is justified by this evidence.',
    'Reached observer and interception cleanup is confirmed; the eighth expected document did not complete.',
    'Generic failure projection drops parameterNames at its depth limit; observer complete statuses do not make the projected records complete.',
    'Program creation/link/query counts are consistent with initialization but cannot recover per-parameter identity or first/repeated query counts.',
    'Times cover whole owned document lifetimes and synchronous native waiting, not GPU duration or matched performance.',
    'Linux SwiftShader evidence is not physical Windows acceptance.',
  ],
};
writeFileSync(
  path.join(folder, 'review.json'),
  JSON.stringify(report, null, 2) + '\n',
);
console.log(
  JSON.stringify({
    status: report.status,
    completedSamples: 5,
    documents: documents.length,
    totalPrograms: report.totalPrograms,
    totalQueries: report.totalQueries,
    totalQueryElapsedMs: report.totalQueryElapsedMs,
  }),
);
