import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  MAX_SHADER_PROGRAM_ATTRIBUTION_ARTIFACT_BYTES,
  createShaderProgramAttributionCheckpoint,
  createShaderProgramAttributionCheckpointReference,
  persistShaderProgramAttributionCheckpoint,
  validateShaderProgramAttributionCheckpoint,
  verifyShaderProgramAttributionArtifactBytes,
} from './shaderProgramAttributionArtifact.mjs';
import {
  executeCaptureCliWithReportArtifact,
  preserveShaderProgramAttributionArtifact,
} from '../qa-performance-build-smoke.mjs';

const provenance = {
  appSha: 'a'.repeat(40),
  harnessSha: 'b'.repeat(40),
  receiptSha256: 'c'.repeat(64),
};

function attribution() {
  return {
    schema: 'gev-shader-program-lifecycle/v1',
    status: 'complete',
    scope:
      'owned WebGL context synchronous main-thread wrapper elapsed time; not GPU execution time or performance acceptance',
    limits: {
      maxProgramRows: 128,
      maxPnamesPerProgram: 4,
      untrackedProgramOperationCount: 0,
      pnameRowsOverflow: 0,
      truncated: false,
    },
    totals: Object.fromEntries(
      [
        'createProgram',
        'linkProgram',
        'getProgramParameter',
        'deleteProgram',
      ].map((name) => [
        name,
        {
          calls: name === 'getProgramParameter' ? 3 : 1,
          errors: 0,
          elapsedSumMs: 0.5,
          maxElapsedMs: 0.5,
        },
      ]),
    ),
    programs: [
      {
        programId: 1,
        createCalls: 1,
        linkCalls: 1,
        deleteCalls: 0,
        parameterQueries: 3,
        linkStatusKnown: true,
        parameterNames: [
          'LINK_STATUS',
          'ACTIVE_UNIFORMS',
          'ACTIVE_ATTRIBUTES',
        ].map((name, index) => ({
          pname: 0x8b81 + index,
          name,
          calls: 1,
          firstQueries: 1,
          repeatedQueries: 0,
          linkCallBeforeQuery: 1,
          linkConfirmedBeforeQuery: 1,
          trueResults: 1,
          falseResults: 0,
          numericResults: 0,
          otherResults: 0,
          elapsedSumMs: 0.1,
          maxElapsedMs: 0.1,
        })),
      },
    ],
    cleanup: {
      confirmed: true,
      requestedMethodCount: 4,
      installedMethodCount: 4,
      restoredMethodCount: 4,
      changedOwnerCount: 0,
    },
    ownerChanged: false,
  };
}

function cleanupRow(id = 'doc-1') {
  return {
    phase: 'provider-sample-cleanup',
    documentRole: 'provider-sample-idle-1',
    documentId: id,
    confirmed: true,
    document: { shaderProgramAttribution: attribution() },
  };
}

test('checkpoint is allowlisted, provenance-bound, and partial evidence is valid', () => {
  const checkpoint = createShaderProgramAttributionCheckpoint(
    [cleanupRow()],
    2,
    provenance,
  );
  assert.equal(checkpoint.status, 'partial');
  assert.equal(
    checkpoint.documents[0].attribution.programs[0].parameterNames.length,
    3,
  );
  const validated = validateShaderProgramAttributionCheckpoint(
    JSON.parse(JSON.stringify(checkpoint)),
    provenance,
  );
  assert.ok(validated);
  assert.equal(
    validateShaderProgramAttributionCheckpoint(checkpoint, {
      ...provenance,
      appSha: 'd'.repeat(40),
    }),
    null,
  );
  const forged = structuredClone(checkpoint);
  forged.documents[0].attribution.totals.createProgram.authorization = 'secret';
  const sanitized = validateShaderProgramAttributionCheckpoint(forged);
  assert.ok(sanitized);
  assert.equal(
    Object.hasOwn(
      sanitized.documents[0].attribution.totals.createProgram,
      'authorization',
    ),
    false,
  );
  assert.equal(
    createShaderProgramAttributionCheckpoint(
      [
        {
          ...cleanupRow(),
          document: { shaderProgramAttribution: { schema: 'bad' } },
        },
      ],
      2,
      provenance,
    ).invalidDocumentCount,
    1,
  );
  assert.equal(
    createShaderProgramAttributionCheckpoint(
      Array.from({ length: 41 }, (_, index) => cleanupRow(`doc-${index}`)),
      40,
      provenance,
    ),
    null,
  );
});

test('checkpoint complete status requires exact unique documents and cleanup', () => {
  const complete = createShaderProgramAttributionCheckpoint(
    [cleanupRow('doc-1'), { ...cleanupRow('doc-2'), documentRole: 'startup' }],
    2,
    provenance,
  );
  assert.equal(complete.status, 'complete');
  assert.ok(validateShaderProgramAttributionCheckpoint(complete, provenance));
  const forged = structuredClone(complete);
  forged.documents[1].documentRole = forged.documents[0].documentRole;
  forged.documents[1].documentId = forged.documents[0].documentId;
  assert.equal(validateShaderProgramAttributionCheckpoint(forged), null);
  const badStatus = structuredClone(complete);
  badStatus.documents[0].cleanupConfirmed = false;
  assert.equal(validateShaderProgramAttributionCheckpoint(badStatus), null);
});

test('late attribution remains separate from unavailable timeout cleanup evidence', async (t) => {
  const row = cleanupRow();
  row.confirmed = false;
  row.document.shaderProgramAttribution = {
    schema: 'gev-shader-program-lifecycle/v1',
    status: 'unavailable',
    error: 'snapshot-failed',
    cleanup: {
      confirmed: false,
      requestedMethodCount: 4,
      installedMethodCount: 0,
      restoredMethodCount: 0,
      changedOwnerCount: 0,
    },
    ownerChanged: false,
  };
  row.document.lateOutcome = {
    status: 'confirmed',
    shaderProgramAttribution: attribution(),
  };
  const root = await realpath(os.tmpdir());
  const directory = await mkdtemp(path.join(root, 'gev-shader-late-row-'));
  t.after(async () => rm(directory, { recursive: true, force: true }));
  const checkpointPath = path.join(
    directory,
    'capture.shader-program-attribution.json',
  );
  const persisted = await persistShaderProgramAttributionCheckpoint({
    checkpointPath,
    cleanupRows: [row],
    expectedDocumentCount: 1,
    provenance,
  });
  assert.equal(persisted.artifact.status, 'partial');
  assert.equal(persisted.checkpoint.status, 'partial');
  const document = persisted.checkpoint.documents[0];
  assert.equal(document.status, 'unavailable');
  assert.equal(document.outerCleanupConfirmed, false);
  assert.equal(document.cleanupConfirmed, false);
  assert.equal(document.lateOutcomeStatus, 'confirmed');
  assert.equal(document.lateAttribution.status, 'complete');
  assert.ok(validateShaderProgramAttributionCheckpoint(persisted.checkpoint));
  const diskCheckpoint = JSON.parse(await readFile(checkpointPath, 'utf8'));
  assert.equal(diskCheckpoint.documents[0].lateOutcomeStatus, 'confirmed');
  assert.equal(diskCheckpoint.documents[0].cleanupConfirmed, false);
});

test('bounded checkpoint sidecar preserves timeout partials and verifies hash/bytes', async (t) => {
  const root = await realpath(os.tmpdir());
  const directory = await mkdtemp(path.join(root, 'gev-shader-sidecar-'));
  t.after(async () => rm(directory, { recursive: true, force: true }));
  const source = path.join(
    directory,
    'capture.shader-program-attribution.json',
  );
  const referencePath = `${source}.ref.json`;
  const artifactPath = path.join(
    directory,
    'smoke.shader-program-attribution.json',
  );
  const checkpoint = createShaderProgramAttributionCheckpoint(
    [cleanupRow()],
    3,
    provenance,
  );
  const bytes = Buffer.from(`${JSON.stringify(checkpoint)}\n`);
  const reference = createShaderProgramAttributionCheckpointReference(
    checkpoint,
    bytes,
    path.basename(source),
  );
  reference.untrusted = { token: 'must-not-be-copied' };
  await writeFile(source, bytes);
  await writeFile(referencePath, `${JSON.stringify(reference)}\n`);
  const result = await preserveShaderProgramAttributionArtifact(
    source,
    referencePath,
    artifactPath,
    provenance,
  );
  assert.equal(result.artifact.status, 'preserved');
  assert.equal(result.checkpoint.status, 'partial');
  assert.deepEqual(await readFile(artifactPath), bytes);
  const outputReference = JSON.parse(
    await readFile(`${artifactPath}.ref.json`, 'utf8'),
  );
  assert.equal(Object.hasOwn(outputReference, 'untrusted'), false);
  assert.equal(result.artifact.byteLength, bytes.byteLength);
  assert.equal(
    result.artifact.sha256,
    createHash('sha256').update(bytes).digest('hex'),
  );
  assert.equal(
    verifyShaderProgramAttributionArtifactBytes(result.artifact, bytes),
    true,
  );
  assert.equal(
    verifyShaderProgramAttributionArtifactBytes(
      { ...result.artifact, byteLength: bytes.byteLength + 1 },
      bytes,
    ),
    false,
  );
  const changed = Buffer.from(bytes);
  changed[0] ^= 1;
  assert.equal(
    verifyShaderProgramAttributionArtifactBytes(result.artifact, changed),
    false,
  );

  const corruptedSource = path.join(directory, 'corrupted.json');
  const corruptedBytes = Buffer.from(bytes);
  corruptedBytes[0] ^= 1;
  await writeFile(corruptedSource, corruptedBytes);
  const hashMismatch = await preserveShaderProgramAttributionArtifact(
    corruptedSource,
    referencePath,
    path.join(directory, 'corrupted.shader-program-attribution.json'),
    provenance,
  );
  assert.equal(hashMismatch.artifact.status, 'hash-or-reference-mismatch');
  assert.equal(hashMismatch.checkpoint, null);
});

test('sidecar ingestion reports missing, malformed, and oversized artifacts', async (t) => {
  const root = await realpath(os.tmpdir());
  const directory = await mkdtemp(
    path.join(root, 'gev-shader-sidecar-invalid-'),
  );
  t.after(async () => rm(directory, { recursive: true, force: true }));
  const artifact = path.join(
    directory,
    'smoke.shader-program-attribution.json',
  );
  const missing = await preserveShaderProgramAttributionArtifact(
    path.join(directory, 'missing.json'),
    path.join(directory, 'missing-ref.json'),
    artifact,
    provenance,
  );
  assert.equal(missing.artifact.status, 'missing-or-unreadable');
  const malformed = path.join(
    directory,
    'malformed.shader-program-attribution.json',
  );
  const malformedBytes = Buffer.from('{ nope');
  const validForReference = createShaderProgramAttributionCheckpoint(
    [cleanupRow()],
    2,
    provenance,
  );
  const malformedReference = createShaderProgramAttributionCheckpointReference(
    validForReference,
    malformedBytes,
    path.basename(malformed),
  );
  const malformedReferencePath = `${malformed}.ref.json`;
  await writeFile(malformed, malformedBytes);
  await writeFile(
    malformedReferencePath,
    `${JSON.stringify(malformedReference)}\n`,
  );
  const malformedResult = await preserveShaderProgramAttributionArtifact(
    malformed,
    malformedReferencePath,
    artifact,
    provenance,
  );
  assert.equal(malformedResult.artifact.status, 'malformed');
  assert.equal(malformedResult.checkpoint, null);
  const oversized = path.join(directory, 'oversized.json');
  await writeFile(
    oversized,
    Buffer.alloc(MAX_SHADER_PROGRAM_ATTRIBUTION_ARTIFACT_BYTES + 1, 0x20),
  );
  const oversizedResult = await preserveShaderProgramAttributionArtifact(
    oversized,
    path.join(directory, 'oversized-ref.json'),
    artifact,
    provenance,
  );
  assert.equal(oversizedResult.artifact.status, 'oversize');
  assert.equal(oversizedResult.artifact.sha256, null);
});

test('outer timeout retains last sidecar checkpoint without changing failure status', async (t) => {
  const root = await realpath(os.tmpdir());
  const directory = await mkdtemp(
    path.join(root, 'gev-shader-sidecar-timeout-'),
  );
  t.after(async () => rm(directory, { recursive: true, force: true }));
  const reportPath = path.join(directory, 'capture-report.json');
  const artifactPath = path.join(directory, 'smoke-capture-report.json');
  const sourceSidecar = `${reportPath}.shader-program-attribution.json`;
  const sourceReference = `${sourceSidecar}.ref.json`;
  const artifactSidecar = `${artifactPath}.shader-program-attribution.json`;
  const checkpoint = createShaderProgramAttributionCheckpoint(
    [cleanupRow()],
    4,
    provenance,
  );
  const checkpointBytes = Buffer.from(`${JSON.stringify(checkpoint)}\n`);
  const checkpointReference = createShaderProgramAttributionCheckpointReference(
    checkpoint,
    checkpointBytes,
    path.basename(sourceSidecar),
  );
  const reportBytes = Buffer.from(
    JSON.stringify({
      schema: 'gev-performance-capture-failure/v1',
      status: 'failed',
      failure: { phase: 'outer-timeout', message: 'child deadline' },
    }),
  );
  await assert.rejects(
    executeCaptureCliWithReportArtifact({
      runChild: async () => {
        await writeFile(reportPath, reportBytes);
        await writeFile(sourceSidecar, checkpointBytes);
        await writeFile(
          sourceReference,
          `${JSON.stringify(checkpointReference)}\n`,
        );
        throw new Error('outer child timeout');
      },
      reportPath,
      artifactPath,
      shaderAttributionArtifactPath: artifactSidecar,
      shaderAttributionArtifactSourcePath: sourceSidecar,
      shaderAttributionReferenceSourcePath: sourceReference,
      shaderAttributionExpectedProvenance: provenance,
    }),
    (error) => {
      assert.equal(error.message, 'outer child timeout');
      assert.equal(error.captureCliReport.failure.phase, 'outer-timeout');
      assert.equal(error.captureCliReportArtifact.childStatus, 'failed');
      assert.equal(error.shaderProgramAttributionArtifact.status, 'preserved');
      assert.equal(error.shaderProgramAttributionCheckpoint.status, 'partial');
      assert.equal(
        error.shaderProgramAttributionArtifact.reportBindingStatus,
        'report-binding-missing',
      );
      return true;
    },
  );
  assert.deepEqual(await readFile(artifactSidecar), checkpointBytes);
});

test('capture report binding matches the actual checkpoint and reference files', async (t) => {
  const root = await realpath(os.tmpdir());
  const directory = await mkdtemp(
    path.join(root, 'gev-shader-report-binding-'),
  );
  t.after(async () => rm(directory, { recursive: true, force: true }));
  const reportPath = path.join(directory, 'capture-report.json');
  const reportArtifact = path.join(directory, 'smoke-report.json');
  const sourcePath = `${reportPath}.shader-program-attribution.json`;
  const referencePath = `${sourcePath}.ref.json`;
  const preservedPath = `${reportArtifact}.shader-program-attribution.json`;
  const secondDocument = { ...cleanupRow('doc-2'), documentRole: 'startup' };
  const persisted = await persistShaderProgramAttributionCheckpoint({
    checkpointPath: sourcePath,
    cleanupRows: [cleanupRow(), secondDocument],
    expectedDocumentCount: 2,
    provenance,
  });
  const rawReport = Buffer.from(
    JSON.stringify({
      schema: 'gev-performance-capture/v1',
      status: 'complete',
      workload: {
        shaderProgramAttributionArtifact: persisted.artifact,
        shaderProgramAttribution: {
          documents: persisted.checkpoint.documents.map((document) => ({
            documentRole: document.documentRole,
            documentId: document.documentId,
          })),
        },
      },
    }),
  );
  const result = await executeCaptureCliWithReportArtifact({
    runChild: async () => writeFile(reportPath, rawReport),
    reportPath,
    artifactPath: reportArtifact,
    shaderAttributionArtifactPath: preservedPath,
    shaderAttributionArtifactSourcePath: sourcePath,
    shaderAttributionReferenceSourcePath: referencePath,
    shaderAttributionExpectedComplete: true,
    shaderAttributionExpectedProvenance: provenance,
  });
  assert.equal(result.shaderProgramAttributionArtifact.status, 'preserved');
  assert.equal(
    result.shaderProgramAttributionArtifact.reportBindingStatus,
    'bound',
  );
  assert.equal(result.shaderProgramAttributionCheckpoint.status, 'complete');

  const mismatchPath = path.join(directory, 'mismatch-report.json');
  const mismatchArtifact = path.join(directory, 'smoke-mismatch-report.json');
  const mismatchReport = {
    schema: 'gev-performance-capture/v1',
    status: 'complete',
    workload: {
      shaderProgramAttributionArtifact: {
        ...persisted.artifact,
        referenceSha256: '0'.repeat(64),
      },
      shaderProgramAttribution: {
        documents: persisted.checkpoint.documents.map((document) => ({
          documentRole: document.documentRole,
          documentId: document.documentId,
        })),
      },
    },
  };
  await assert.rejects(
    executeCaptureCliWithReportArtifact({
      runChild: async () =>
        writeFile(mismatchPath, JSON.stringify(mismatchReport)),
      reportPath: mismatchPath,
      artifactPath: mismatchArtifact,
      shaderAttributionArtifactPath: `${mismatchArtifact}.shader-program-attribution.json`,
      shaderAttributionArtifactSourcePath: sourcePath,
      shaderAttributionReferenceSourcePath: referencePath,
      shaderAttributionExpectedComplete: true,
      shaderAttributionExpectedProvenance: provenance,
    }),
    (error) => {
      assert.match(error.message, /did not match the capture report reference/);
      assert.equal(
        error.shaderProgramAttributionArtifact.reportBindingStatus,
        'report-binding-mismatch',
      );
      return true;
    },
  );
});
