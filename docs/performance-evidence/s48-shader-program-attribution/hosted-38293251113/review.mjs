import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const folder = path.dirname(fileURLToPath(import.meta.url));
// Short storage aliases preserve artifact bytes on Windows without long paths.
const storedNames = {
  'performance-build-smoke.json': 'smoke.json',
  'performance-build-smoke.json.capture-cli-report-candidate.json':
    'capture.json',
  'performance-build-smoke.json.capture-cli-report-candidate.json.shader-program-attribution.json':
    'shader.json',
  'performance-build-smoke.json.capture-cli-report-candidate.json.shader-program-attribution.json.ref.json':
    'shader.ref.json',
};
const storedName = (name) => storedNames[name] ?? name;
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const read = (name) =>
  JSON.parse(readFileSync(path.join(folder, storedName(name)), 'utf8'));
const identity = (name) => {
  const bytes = readFileSync(path.join(folder, storedName(name)));
  return {
    name,
    storedAs: storedName(name),
    byteLength: bytes.length,
    sha256: hash(bytes),
  };
};
const verify = (name, expected) => {
  const actual = identity(name);
  assert.equal(actual.byteLength, expected.byteLength);
  assert.equal(actual.sha256, expected.sha256);
  return actual;
};
const near = (actual, expected) =>
  assert.ok(Math.abs(actual - expected) < 1e-6);
const sha = 'e54eadedbc92a55ae99c761e97aa7e1b4726bfb7';
const smoke = read('performance-build-smoke.json');
const run = read('run.json');
const candidate = smoke.variants.find((v) => v.label === 'candidate');
const rawIdentity = verify(
  candidate.captureCliReportArtifact.fileName,
  candidate.captureCliReportArtifact,
);
const raw = read(rawIdentity.name);
const artifact = candidate.shaderProgramAttributionArtifact;
const payloadIdentity = verify(artifact.fileName, artifact);
const refIdentity = verify(artifact.referenceFileName, {
  byteLength: artifact.referenceByteLength,
  sha256: artifact.referenceSha256,
});
const checkpoint = read(artifact.fileName);
const ref = read(artifact.referenceFileName);
const producerRef = raw.workload.shaderProgramAttributionArtifact;
assert.equal(
  payloadIdentity.sha256,
  '0cb949cf910c9142cfb24b6ed4bb68b1fc668a39f188e529f205ba67d87963cc',
);
assert.equal(
  refIdentity.sha256,
  '62e2ef33fe3466af043ea3461229ea45e1dd637960ef5f41fea9f0ae4ba3a679',
);
assert.equal(artifact.status, 'preserved');
assert.equal(artifact.reportBindingStatus, 'bound');
assert.equal(artifact.limitBytes, 8 * 1024 * 1024);
assert.ok(payloadIdentity.byteLength <= artifact.limitBytes);
assert.equal(ref.fileName, artifact.fileName);
assert.equal(ref.sha256, payloadIdentity.sha256);
assert.equal(ref.byteLength, payloadIdentity.byteLength);
assert.equal(artifact.sourceSha256, payloadIdentity.sha256);
assert.equal(artifact.sourceByteLength, payloadIdentity.byteLength);
assert.equal(producerRef.sha256, artifact.sourceSha256);
assert.equal(producerRef.byteLength, artifact.sourceByteLength);
assert.equal(producerRef.referenceFileName, artifact.sourceReferenceFileName);
assert.equal(producerRef.referenceSha256, artifact.sourceReferenceSha256);
assert.equal(
  producerRef.referenceByteLength,
  artifact.sourceReferenceByteLength,
);
// The uploaded reference has a different filename. Verify a reconstruction of
// the producer reference separately; this is not an uploaded original file.
const reconstructedSourceRef = Buffer.from(
  JSON.stringify({ ...ref, fileName: producerRef.fileName }) + '\n',
);
assert.equal(hash(reconstructedSourceRef), producerRef.referenceSha256);
assert.equal(reconstructedSourceRef.length, producerRef.referenceByteLength);
assert.equal(run.headSha, sha);
assert.equal(run.status, 'completed');
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
assert.equal(raw.source.appWorktreeState, 'clean');
assert.equal(raw.source.harnessDirtyWorktree, false);
assert.equal(raw.source.buildProvenance.before.status, 'served-assets-match');
assert.equal(raw.source.buildProvenance.after, null);
assert.equal(raw.status, 'failed');
assert.equal(raw.comparisonEligible, false);
assert.equal(raw.failure.phase, 'configure-scenario-route');
assert.equal(raw.failure.scenario, 'selected-aircraft-tracking');
assert.equal(raw.failure.run, 1);
assert.equal(raw.progress.completedSampleCount, 4);
assert.deepEqual(
  raw.progress.completedSamples.map((s) => [s.scenario, s.run]),
  [
    ['idle', 1],
    ['idle', 2],
    ['scripted-motion', 1],
    ['scripted-motion', 2],
  ],
);
assert.deepEqual(checkpoint.provenance, {
  appSha: sha,
  harnessSha: sha,
  receiptSha256: raw.source.buildProvenance.receiptSha256,
});
assert.deepEqual(ref.provenance, checkpoint.provenance);
assert.equal(checkpoint.status, 'partial');
assert.equal(checkpoint.performanceAcceptanceEligible, false);
assert.equal(ref.performanceAcceptanceEligible, false);
assert.equal(checkpoint.expectedDocumentCount, 8);
assert.equal(checkpoint.recordedDocumentCount, 7);
assert.equal(checkpoint.invalidDocumentCount, 1);
assert.equal(checkpoint.documents.length, 7);
const summary = raw.workload.shaderProgramAttribution;
const key = (d) => `${d.documentRole}:${d.documentId}`;
assert.deepEqual(
  checkpoint.documents.map(key).sort(),
  summary.documents.map(key).sort(),
);
const parameterTotals = new Map();
const documents = checkpoint.documents.map((d) => {
  const summarized = summary.documents.find((s) => key(s) === key(d));
  const cleanup = raw.workload.rendererProbeCleanup.find(
    (c) => key(c) === key(d),
  );
  const interception = raw.workload.fixtureInterceptionReleases.find(
    (c) => key(c) === key(d),
  );
  assert.equal(d.lateAttribution, null);
  if (d.status === 'unavailable') {
    assert.equal(d.documentId, 'provider-document-5');
    assert.equal(d.attribution, null);
    assert.equal(d.attributionByteLength, null);
    assert.equal(d.attributionSha256, null);
    assert.equal(d.cleanupConfirmed, false);
    assert.equal(d.outerCleanupConfirmed, false);
    assert.equal(cleanup.confirmed, false);
    assert.equal(interception.confirmed, false);
    return {
      documentId: d.documentId,
      documentRole: d.documentRole,
      status: d.status,
      cleanupConfirmed: false,
      programCount: null,
      queryCount: null,
      queryElapsedMs: null,
    };
  }
  assert.equal(d.status, 'complete');
  assert.equal(d.cleanupConfirmed, true);
  assert.equal(d.outerCleanupConfirmed, true);
  assert.equal(cleanup.confirmed, true);
  assert.equal(interception.confirmed, true);
  const observer = d.attribution;
  const bytes = Buffer.from(JSON.stringify(observer));
  assert.equal(bytes.length, d.attributionByteLength);
  assert.equal(hash(bytes), d.attributionSha256);
  assert.equal(observer.status, 'complete');
  assert.equal(observer.limits.truncated, false);
  assert.equal(observer.limits.untrackedProgramOperationCount, 0);
  assert.equal(observer.limits.pnameRowsOverflow, 0);
  assert.equal(observer.ownerChanged, false);
  assert.equal(observer.cleanup.confirmed, true);
  assert.equal(observer.cleanup.installedMethodCount, 4);
  assert.equal(observer.cleanup.restoredMethodCount, 4);
  assert.deepEqual(observer.totals, summarized.totals);
  assert.equal(observer.programs.length, summarized.trackedProgramCount);
  let queryCount = 0;
  let queryElapsedMs = 0;
  for (const program of observer.programs) {
    assert.equal(program.createCalls, 1);
    assert.equal(program.linkCalls, 1);
    assert.equal(program.parameterQueries, 3);
    assert.equal(program.parameterNames.length, 3);
    assert.deepEqual(
      program.parameterNames.map((p) => p.pname).sort(),
      [35714, 35718, 35721],
    );
    for (const p of program.parameterNames) {
      assert.equal(p.calls, 1);
      assert.equal(p.firstQueries, 1);
      assert.equal(p.repeatedQueries, 0);
      assert.equal(p.linkCallBeforeQuery, 1);
      assert.equal(p.linkConfirmedBeforeQuery, p.pname === 35714 ? 0 : 1);
      assert.equal(p.falseResults, 0);
      assert.equal(p.otherResults, 0);
      assert.equal(p.trueResults, p.pname === 35714 ? 1 : 0);
      assert.equal(p.numericResults, p.pname === 35714 ? 0 : 1);
      const aggregate = parameterTotals.get(p.pname) ?? {
        pname: p.pname,
        name: p.name,
        calls: 0,
        firstQueries: 0,
        repeatedQueries: 0,
        elapsedSumMs: 0,
        maxElapsedMs: 0,
      };
      for (const field of [
        'calls',
        'firstQueries',
        'repeatedQueries',
        'elapsedSumMs',
      ])
        aggregate[field] += p[field];
      aggregate.maxElapsedMs = Math.max(aggregate.maxElapsedMs, p.maxElapsedMs);
      parameterTotals.set(p.pname, aggregate);
      queryCount += p.calls;
      queryElapsedMs += p.elapsedSumMs;
    }
  }
  assert.equal(queryCount, observer.totals.getProgramParameter.calls);
  near(queryElapsedMs, observer.totals.getProgramParameter.elapsedSumMs);
  assert.equal(observer.totals.getProgramParameter.errors, 0);
  return {
    documentId: d.documentId,
    documentRole: d.documentRole,
    status: d.status,
    cleanupConfirmed: true,
    programCount: observer.programs.length,
    queryCount,
    queryElapsedMs,
  };
});
const parameters = [...parameterTotals.values()].sort(
  (a, b) => a.pname - b.pname,
);
const totalPrograms = documents.reduce((n, d) => n + (d.programCount ?? 0), 0);
const totalQueries = parameters.reduce((n, p) => n + p.calls, 0);
const totalQueryElapsedMs = parameters.reduce((n, p) => n + p.elapsedSumMs, 0);
assert.equal(totalPrograms, 143);
assert.equal(totalQueries, 429);
const report = {
  schema: 'gev-shader-attribution-checkpoint-review/v1',
  status: 'failed-capture-partial-attribution-preserved',
  commit: sha,
  run: run.url,
  artifacts: [
    identity('performance-build-smoke.json'),
    rawIdentity,
    payloadIdentity,
    refIdentity,
    identity('run.json'),
    identity('job-failure.log.gz'),
  ],
  sourceReferenceVerification:
    'Producer reference reconstructed from saved reference with original filename; reconstructed bytes match producer hash and length. Original producer-reference bytes were not uploaded separately.',
  failure: raw.failure,
  outerFailure: smoke.failure.message,
  completedSamples: 4,
  expectedSamples: 6,
  servedBytes: 'pre-capture verified; post-capture verification missing',
  renderer: raw.progress.startupSamples[0].renderer,
  checkpointStatus: checkpoint.status,
  expectedDocumentCount: checkpoint.expectedDocumentCount,
  recordedDocumentCount: checkpoint.recordedDocumentCount,
  documents,
  totalPrograms,
  totalQueries,
  totalQueryElapsedMs,
  parameters,
  linkStatusElapsedSharePct:
    (100 * parameterTotals.get(35714).elapsedSumMs) / totalQueryElapsedMs,
  findings: [
    'The bounded sidecar retains all per-parameter rows for six complete owned document contexts, with payload/reference/observer identities independently verified.',
    'Every observed program has one creation, one link and one query each for LINK_STATUS, ACTIVE_ATTRIBUTES and ACTIVE_UNIFORMS. No repeated same-parameter query is observed in these six contexts.',
    'Synchronous LINK_STATUS elapsed time dominates recorded query time. This supports first-use link synchronization in this Linux software-rendered workload; it does not prove a GPU defect or a physical Windows cause.',
  ],
  limitations: [
    'The unchanged child deadline stopped the capture after four of six samples; the capture remains failed and comparison-ineligible.',
    'The seventh reached document has unavailable observer data and unconfirmed observer/interception cleanup. The eighth expected document was never recorded.',
    'Times cover whole owned document lifetimes and synchronous native waiting, not GPU execution time or matched performance. Instrumentation overhead was not measured by this run.',
    'Linux SwiftShader evidence is not physical Windows acceptance. No default rendering, visual settings or deadlines changed.',
  ],
};
writeFileSync(
  path.join(folder, 'review.json'),
  JSON.stringify(report, null, 2) + '\n',
);
console.log(
  JSON.stringify(
    {
      status: report.status,
      totalPrograms,
      totalQueries,
      totalQueryElapsedMs,
      parameters,
      linkStatusElapsedSharePct: report.linkStatusElapsedSharePct,
    },
    null,
    2,
  ),
);
