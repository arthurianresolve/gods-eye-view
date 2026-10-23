import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { boundedShaderProgramAttribution } from './earlyCesiumRendererProbe.mjs';

export const MAX_SHADER_PROGRAM_ATTRIBUTION_ARTIFACT_BYTES = 8 * 1024 * 1024;
export const MAX_SHADER_PROGRAM_ATTRIBUTION_DOCUMENTS = 40;

export function createShaderProgramAttributionCheckpoint(
  cleanupRows,
  expectedDocumentCount,
  provenance,
) {
  if (
    !Number.isSafeInteger(expectedDocumentCount) ||
    expectedDocumentCount < 1 ||
    expectedDocumentCount > MAX_SHADER_PROGRAM_ATTRIBUTION_DOCUMENTS ||
    !provenance ||
    !/^[a-f0-9]{40}$/.test(provenance.appSha || '') ||
    !/^[a-f0-9]{40}$/.test(provenance.harnessSha || '') ||
    !/^[a-f0-9]{64}$/.test(provenance.receiptSha256 || '') ||
    !Array.isArray(cleanupRows) ||
    cleanupRows.length > MAX_SHADER_PROGRAM_ATTRIBUTION_DOCUMENTS
  )
    return null;
  const documents = [];
  const identities = new Set();
  let invalidDocumentCount = 0;
  for (const row of cleanupRows) {
    const documentEvidence = row?.document;
    const evidence = documentEvidence?.shaderProgramAttribution;
    const lateEvidence =
      documentEvidence?.lateOutcome?.shaderProgramAttribution;
    if (evidence == null && lateEvidence == null) continue;
    const attribution =
      evidence == null ? null : boundedShaderProgramAttribution(evidence);
    const lateAttribution =
      lateEvidence == null
        ? null
        : boundedShaderProgramAttribution(lateEvidence);
    const directInvalid = evidence != null && !attribution;
    const lateInvalid = lateEvidence != null && !lateAttribution;
    if (directInvalid || lateInvalid) invalidDocumentCount += 1;
    const documentRole = row.documentRole;
    const documentId = row.documentId;
    if (
      typeof documentRole !== 'string' ||
      documentRole.length < 1 ||
      documentRole.length > 80 ||
      typeof documentId !== 'string' ||
      documentId.length < 1 ||
      documentId.length > 100
    ) {
      invalidDocumentCount += 1;
      continue;
    }
    const identity = `${documentRole}\u0000${documentId}`;
    if (identities.has(identity)) {
      invalidDocumentCount += 1;
      continue;
    }
    identities.add(identity);
    const attributionBytes = attribution
      ? Buffer.from(JSON.stringify(attribution), 'utf8')
      : null;
    const lateAttributionBytes = lateAttribution
      ? Buffer.from(JSON.stringify(lateAttribution), 'utf8')
      : null;
    const lateOutcomeStatus = documentEvidence?.lateOutcome?.status;
    const validLateOutcomeStatus = [
      'confirmed',
      'already-confirmed',
      'unavailable',
      'error',
    ].includes(lateOutcomeStatus)
      ? lateOutcomeStatus
      : null;
    documents.push({
      documentRole,
      documentId,
      phase:
        typeof row.phase === 'string' && row.phase.length <= 80
          ? row.phase
          : null,
      status: attribution?.status || 'unavailable',
      outerCleanupConfirmed: row.confirmed === true,
      cleanupConfirmed:
        row.confirmed === true && attribution?.cleanup.confirmed === true,
      attributionByteLength: attributionBytes?.byteLength ?? null,
      attributionSha256: attributionBytes
        ? createHash('sha256').update(attributionBytes).digest('hex')
        : null,
      attribution,
      lateOutcomeStatus: validLateOutcomeStatus,
      lateAttributionByteLength: lateAttributionBytes?.byteLength ?? null,
      lateAttributionSha256: lateAttributionBytes
        ? createHash('sha256').update(lateAttributionBytes).digest('hex')
        : null,
      lateAttribution,
    });
  }
  const complete =
    documents.length === expectedDocumentCount &&
    invalidDocumentCount === 0 &&
    documents.every(
      (document) => document.status === 'complete' && document.cleanupConfirmed,
    );
  return {
    schema: 'gev-shader-program-attribution-checkpoint/v1',
    performanceAcceptanceEligible: false,
    status: complete ? 'complete' : 'partial',
    provenance: {
      appSha: provenance.appSha,
      harnessSha: provenance.harnessSha,
      receiptSha256: provenance.receiptSha256,
    },
    expectedDocumentCount,
    recordedDocumentCount: documents.length,
    invalidDocumentCount,
    documents,
  };
}

export function validateShaderProgramAttributionCheckpoint(
  value,
  expectedProvenance = null,
) {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    value.schema !== 'gev-shader-program-attribution-checkpoint/v1' ||
    value.performanceAcceptanceEligible !== false ||
    !['partial', 'complete'].includes(value.status) ||
    !Number.isSafeInteger(value.expectedDocumentCount) ||
    value.expectedDocumentCount < 1 ||
    value.expectedDocumentCount > MAX_SHADER_PROGRAM_ATTRIBUTION_DOCUMENTS ||
    !Number.isSafeInteger(value.recordedDocumentCount) ||
    value.recordedDocumentCount < 0 ||
    value.recordedDocumentCount > value.expectedDocumentCount ||
    !Number.isSafeInteger(value.invalidDocumentCount) ||
    value.invalidDocumentCount < 0 ||
    value.invalidDocumentCount > MAX_SHADER_PROGRAM_ATTRIBUTION_DOCUMENTS ||
    !value.provenance ||
    typeof value.provenance !== 'object' ||
    Array.isArray(value.provenance) ||
    !/^[a-f0-9]{40}$/.test(value.provenance.appSha || '') ||
    !/^[a-f0-9]{40}$/.test(value.provenance.harnessSha || '') ||
    !/^[a-f0-9]{64}$/.test(value.provenance.receiptSha256 || '') ||
    !Array.isArray(value.documents) ||
    value.documents.length !== value.recordedDocumentCount ||
    value.documents.length > MAX_SHADER_PROGRAM_ATTRIBUTION_DOCUMENTS
  )
    return null;
  if (
    expectedProvenance &&
    (value.provenance.appSha !== expectedProvenance.appSha ||
      value.provenance.harnessSha !== expectedProvenance.harnessSha ||
      value.provenance.receiptSha256 !== expectedProvenance.receiptSha256)
  )
    return null;
  const identities = new Set();
  const documents = [];
  for (const document of value.documents) {
    if (
      !document ||
      typeof document !== 'object' ||
      Array.isArray(document) ||
      typeof document.documentRole !== 'string' ||
      document.documentRole.length < 1 ||
      document.documentRole.length > 80 ||
      typeof document.documentId !== 'string' ||
      document.documentId.length < 1 ||
      document.documentId.length > 100 ||
      !(
        document.phase === null ||
        (typeof document.phase === 'string' && document.phase.length <= 80)
      ) ||
      !['complete', 'truncated', 'unavailable'].includes(document.status) ||
      typeof document.cleanupConfirmed !== 'boolean' ||
      typeof document.outerCleanupConfirmed !== 'boolean' ||
      !(
        document.lateOutcomeStatus === null ||
        ['confirmed', 'already-confirmed', 'unavailable', 'error'].includes(
          document.lateOutcomeStatus,
        )
      )
    )
      return null;
    const identity = `${document.documentRole}\u0000${document.documentId}`;
    if (identities.has(identity)) return null;
    identities.add(identity);
    const attribution =
      document.attribution === null
        ? null
        : boundedShaderProgramAttribution(document.attribution);
    const attributionBytes = attribution
      ? Buffer.from(JSON.stringify(attribution), 'utf8')
      : null;
    const lateAttribution =
      document.lateAttribution === null
        ? null
        : boundedShaderProgramAttribution(document.lateAttribution);
    const lateAttributionBytes = lateAttribution
      ? Buffer.from(JSON.stringify(lateAttribution), 'utf8')
      : null;
    if (
      (attribution
        ? !Number.isSafeInteger(document.attributionByteLength) ||
          document.attributionByteLength !== attributionBytes.byteLength ||
          typeof document.attributionSha256 !== 'string' ||
          !/^[a-f0-9]{64}$/.test(document.attributionSha256) ||
          createHash('sha256').update(attributionBytes).digest('hex') !==
            document.attributionSha256 ||
          attribution.status !== document.status
        : document.attributionByteLength !== null ||
          document.attributionSha256 !== null ||
          document.status !== 'unavailable') ||
      (lateAttribution
        ? !Number.isSafeInteger(document.lateAttributionByteLength) ||
          document.lateAttributionByteLength !==
            lateAttributionBytes.byteLength ||
          typeof document.lateAttributionSha256 !== 'string' ||
          !/^[a-f0-9]{64}$/.test(document.lateAttributionSha256) ||
          createHash('sha256').update(lateAttributionBytes).digest('hex') !==
            document.lateAttributionSha256
        : document.lateAttributionByteLength !== null ||
          document.lateAttributionSha256 !== null) ||
      (lateAttribution && document.lateOutcomeStatus === null) ||
      document.cleanupConfirmed !==
        (document.outerCleanupConfirmed &&
          attribution?.cleanup.confirmed === true)
    )
      return null;
    documents.push({
      documentRole: document.documentRole,
      documentId: document.documentId,
      phase: document.phase,
      status: document.status,
      outerCleanupConfirmed: document.outerCleanupConfirmed,
      cleanupConfirmed: document.cleanupConfirmed,
      attributionByteLength: document.attributionByteLength,
      attributionSha256: document.attributionSha256,
      attribution,
      lateOutcomeStatus: document.lateOutcomeStatus,
      lateAttributionByteLength: document.lateAttributionByteLength,
      lateAttributionSha256: document.lateAttributionSha256,
      lateAttribution,
    });
  }
  const actuallyComplete =
    documents.length === value.expectedDocumentCount &&
    value.invalidDocumentCount === 0 &&
    documents.every(
      (document) => document.status === 'complete' && document.cleanupConfirmed,
    );
  if ((value.status === 'complete') !== actuallyComplete) return null;
  return {
    schema: value.schema,
    performanceAcceptanceEligible: false,
    status: value.status,
    provenance: {
      appSha: value.provenance.appSha,
      harnessSha: value.provenance.harnessSha,
      receiptSha256: value.provenance.receiptSha256,
    },
    expectedDocumentCount: value.expectedDocumentCount,
    recordedDocumentCount: value.recordedDocumentCount,
    invalidDocumentCount: value.invalidDocumentCount,
    documents,
  };
}

export function describeShaderProgramAttributionArtifact(status, bytes = null) {
  const boundedBytes =
    Buffer.isBuffer(bytes) &&
    bytes.byteLength <= MAX_SHADER_PROGRAM_ATTRIBUTION_ARTIFACT_BYTES
      ? bytes
      : null;
  return {
    schema: 'gev-shader-program-attribution-artifact/v1',
    status,
    fileName: 'shader-program-attribution.json',
    byteLength: boundedBytes?.byteLength ?? null,
    sha256: boundedBytes
      ? createHash('sha256').update(boundedBytes).digest('hex')
      : null,
    limitBytes: MAX_SHADER_PROGRAM_ATTRIBUTION_ARTIFACT_BYTES,
  };
}

export function verifyShaderProgramAttributionArtifactBytes(metadata, bytes) {
  if (
    !metadata ||
    typeof metadata !== 'object' ||
    Array.isArray(metadata) ||
    metadata.schema !== 'gev-smoke-shader-program-attribution-artifact/v1' ||
    metadata.status !== 'preserved' ||
    typeof metadata.fileName !== 'string' ||
    !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,180}\.shader-program-attribution\.json$/.test(
      metadata.fileName,
    ) ||
    !Buffer.isBuffer(bytes) ||
    bytes.byteLength > MAX_SHADER_PROGRAM_ATTRIBUTION_ARTIFACT_BYTES ||
    metadata.limitBytes !== MAX_SHADER_PROGRAM_ATTRIBUTION_ARTIFACT_BYTES ||
    metadata.byteLength !== bytes.byteLength ||
    typeof metadata.sha256 !== 'string' ||
    !/^[a-f0-9]{64}$/.test(metadata.sha256)
  )
    return false;
  return createHash('sha256').update(bytes).digest('hex') === metadata.sha256;
}

export function createShaderProgramAttributionCheckpointReference(
  checkpoint,
  bytes,
  fileName = 'capture-shader-program-attribution.json',
) {
  if (
    !validateShaderProgramAttributionCheckpoint(checkpoint) ||
    !Buffer.isBuffer(bytes) ||
    bytes.byteLength > MAX_SHADER_PROGRAM_ATTRIBUTION_ARTIFACT_BYTES ||
    typeof fileName !== 'string' ||
    !/^[A-Za-z0-9][A-Za-z0-9._-]{0,180}\.shader-program-attribution\.json$/.test(
      fileName,
    )
  )
    return null;
  return {
    schema: 'gev-shader-program-attribution-checkpoint-ref/v1',
    status: checkpoint.status,
    performanceAcceptanceEligible: false,
    fileName,
    byteLength: bytes.byteLength,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    limitBytes: MAX_SHADER_PROGRAM_ATTRIBUTION_ARTIFACT_BYTES,
    provenance: {
      appSha: checkpoint.provenance.appSha,
      harnessSha: checkpoint.provenance.harnessSha,
      receiptSha256: checkpoint.provenance.receiptSha256,
    },
  };
}

export async function persistShaderProgramAttributionCheckpoint({
  checkpointPath,
  cleanupRows,
  expectedDocumentCount,
  provenance,
}) {
  const referencePath = `${checkpointPath}.ref.json`;
  const failure = {
    schema: 'gev-shader-program-attribution-artifact/v1',
    status: 'checkpoint-failed',
    fileName: path.basename(checkpointPath),
    byteLength: null,
    sha256: null,
    referenceFileName: path.basename(referencePath),
    referenceByteLength: null,
    referenceSha256: null,
    limitBytes: MAX_SHADER_PROGRAM_ATTRIBUTION_ARTIFACT_BYTES,
  };
  const checkpoint = createShaderProgramAttributionCheckpoint(
    cleanupRows,
    expectedDocumentCount,
    provenance,
  );
  if (!checkpoint) return { artifact: failure, checkpoint: null };
  const bytes = Buffer.from(`${JSON.stringify(checkpoint)}\n`, 'utf8');
  if (bytes.byteLength > MAX_SHADER_PROGRAM_ATTRIBUTION_ARTIFACT_BYTES)
    return {
      artifact: {
        ...failure,
        status: 'oversize',
        byteLength: bytes.byteLength,
      },
      checkpoint: null,
    };
  const reference = createShaderProgramAttributionCheckpointReference(
    checkpoint,
    bytes,
    path.basename(checkpointPath),
  );
  if (!reference) return { artifact: failure, checkpoint: null };
  const referenceBytes = Buffer.from(`${JSON.stringify(reference)}\n`);
  const nonce = `${process.pid}-${Date.now()}`;
  const temporaryPath = `${checkpointPath}.pending-${nonce}`;
  const temporaryReferencePath = `${referencePath}.pending-${nonce}`;
  try {
    await fs.mkdir(path.dirname(checkpointPath), { recursive: true });
    await fs.writeFile(temporaryPath, bytes, { flag: 'wx' });
    await fs.rename(temporaryPath, checkpointPath);
    await fs.writeFile(temporaryReferencePath, referenceBytes, { flag: 'wx' });
    await fs.rename(temporaryReferencePath, referencePath);
    return {
      artifact: {
        schema: failure.schema,
        status: checkpoint.status,
        fileName: path.basename(checkpointPath),
        byteLength: bytes.byteLength,
        sha256: createHash('sha256').update(bytes).digest('hex'),
        referenceFileName: path.basename(referencePath),
        referenceByteLength: referenceBytes.byteLength,
        referenceSha256: createHash('sha256')
          .update(referenceBytes)
          .digest('hex'),
        limitBytes: MAX_SHADER_PROGRAM_ATTRIBUTION_ARTIFACT_BYTES,
      },
      checkpoint,
    };
  } catch {
    await fs.rm(temporaryPath, { force: true }).catch(() => {});
    await fs.rm(temporaryReferencePath, { force: true }).catch(() => {});
    return { artifact: failure, checkpoint: null };
  }
}

export function validateShaderProgramAttributionCheckpointReference(
  reference,
  bytes,
  expectedProvenance = null,
  expectedFileName = null,
) {
  if (
    !reference ||
    typeof reference !== 'object' ||
    Array.isArray(reference) ||
    reference.schema !== 'gev-shader-program-attribution-checkpoint-ref/v1' ||
    !['partial', 'complete'].includes(reference.status) ||
    reference.performanceAcceptanceEligible !== false ||
    typeof reference.fileName !== 'string' ||
    !/^[A-Za-z0-9][A-Za-z0-9._-]{0,180}\.shader-program-attribution\.json$/.test(
      reference.fileName,
    ) ||
    (expectedFileName !== null && reference.fileName !== expectedFileName) ||
    !Buffer.isBuffer(bytes) ||
    !Number.isSafeInteger(reference.byteLength) ||
    reference.byteLength !== bytes.byteLength ||
    bytes.byteLength > MAX_SHADER_PROGRAM_ATTRIBUTION_ARTIFACT_BYTES ||
    reference.limitBytes !== MAX_SHADER_PROGRAM_ATTRIBUTION_ARTIFACT_BYTES ||
    typeof reference.sha256 !== 'string' ||
    !/^[a-f0-9]{64}$/.test(reference.sha256) ||
    createHash('sha256').update(bytes).digest('hex') !== reference.sha256 ||
    !reference.provenance ||
    typeof reference.provenance !== 'object' ||
    reference.provenance.appSha !== expectedProvenance?.appSha ||
    reference.provenance.harnessSha !== expectedProvenance?.harnessSha ||
    reference.provenance.receiptSha256 !== expectedProvenance?.receiptSha256
  )
    return false;
  return true;
}
