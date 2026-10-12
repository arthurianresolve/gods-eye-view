import { CABLE_REFERENCE_RENDER_POPULATION } from './cable-reference-collections-contract.mjs';

const MAX_EXAMPLES_PER_VISIBILITY = 12;
const MAX_REFERENCE_WITNESS_BYTES = 3_000_000;

function fail(message) {
  throw new Error(`Cable geometry attribution ${message}.`);
}

function isPoint(value) {
  return (
    Array.isArray(value) &&
    value.length === 3 &&
    value.every((coordinate) => Number.isFinite(coordinate))
  );
}

function same(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function indexRows(rows, label) {
  if (
    !Array.isArray(rows) ||
    rows.length !== CABLE_REFERENCE_RENDER_POPULATION.referenceRecords
  )
    fail(`${label} reference inventory is incomplete`);
  const indexed = new Map();
  for (const row of rows) {
    if (
      !row ||
      typeof row.entityId !== 'string' ||
      !row.entityId ||
      !Number.isSafeInteger(row.sourceOrdinal) ||
      row.sourceOrdinal < 0 ||
      !['cable', 'landing-point'].includes(row.sourceKind) ||
      typeof row.sourceRecordId !== 'string' ||
      !row.sourceRecordId ||
      typeof row.effectiveVisible !== 'boolean' ||
      !isPoint(row.pointPosition) ||
      !Array.isArray(row.stemPositions) ||
      row.stemPositions.length !== 2 ||
      !row.stemPositions.every(isPoint) ||
      indexed.has(row.entityId)
    )
      fail(`${label} reference row is malformed or duplicated`);
    indexed.set(row.entityId, row);
  }
  return indexed;
}

/** Compare the exact public reference coordinates by stable Entity identity. */
export function compareCableReferenceGeometry(beforeRows, afterRows) {
  const before = indexRows(beforeRows, 'baseline');
  const after = indexRows(afterRows, 'candidate');
  const beforeVisible = [...before.values()].filter(
    (row) => row.effectiveVisible,
  ).length;
  const afterVisible = [...after.values()].filter(
    (row) => row.effectiveVisible,
  ).length;
  const summary = {
    beforeCount: before.size,
    afterCount: after.size,
    beforeVisible,
    beforeHidden: before.size - beforeVisible,
    afterVisible,
    afterHidden: after.size - afterVisible,
    addedIdentityCount: 0,
    removedIdentityCount: 0,
    sourceIdentityChangedCount: 0,
    visibilityChangedCount: 0,
    pointChangedCount: 0,
    stemChangedCount: 0,
    visibleChangedCount: 0,
    hiddenChangedCount: 0,
    examples: { visible: [], hidden: [] },
  };

  for (const [entityId, previous] of before) {
    const current = after.get(entityId);
    if (!current) {
      summary.removedIdentityCount += 1;
      continue;
    }
    const visibilityChanged =
      previous.effectiveVisible !== current.effectiveVisible;
    const sourceIdentityChanged =
      previous.sourceOrdinal !== current.sourceOrdinal ||
      previous.sourceKind !== current.sourceKind ||
      previous.sourceRecordId !== current.sourceRecordId;
    const pointChanged = !same(previous.pointPosition, current.pointPosition);
    const stemChanged = !same(previous.stemPositions, current.stemPositions);
    if (visibilityChanged) summary.visibilityChangedCount += 1;
    if (sourceIdentityChanged) summary.sourceIdentityChangedCount += 1;
    if (pointChanged) summary.pointChangedCount += 1;
    if (stemChanged) summary.stemChangedCount += 1;
    if (
      !visibilityChanged &&
      !sourceIdentityChanged &&
      !pointChanged &&
      !stemChanged
    )
      continue;

    const category =
      previous.effectiveVisible || current.effectiveVisible
        ? 'visible'
        : 'hidden';
    summary[`${category}ChangedCount`] += 1;
    if (summary.examples[category].length < MAX_EXAMPLES_PER_VISIBILITY) {
      summary.examples[category].push({
        entityId,
        sourceOrdinal: previous.sourceOrdinal,
        sourceKind: previous.sourceKind,
        sourceRecordId: previous.sourceRecordId,
        sourceIdentityAfter: {
          sourceOrdinal: current.sourceOrdinal,
          sourceKind: current.sourceKind,
          sourceRecordId: current.sourceRecordId,
        },
        visibility: {
          before: previous.effectiveVisible,
          after: current.effectiveVisible,
        },
        pointPosition: {
          before: previous.pointPosition,
          after: current.pointPosition,
        },
        stemPositions: {
          before: previous.stemPositions,
          after: current.stemPositions,
        },
      });
    }
  }
  for (const entityId of after.keys()) {
    if (!before.has(entityId)) summary.addedIdentityCount += 1;
  }
  return summary;
}

/** Record the camera-change snapshot only, pairing the real renderer modes. */
export async function recordCableReferenceGeometryAttribution(
  report,
  { caseId, mode, readSnapshot, retainRows = false },
) {
  if (caseId !== 'camera-change') return false;
  if (
    !['entities', 'collections'].includes(mode) ||
    typeof readSnapshot !== 'function'
  )
    fail('case orchestration is malformed');

  const snapshot = await readSnapshot();
  if (retainRows) {
    if (
      !Array.isArray(snapshot?.referenceRows) ||
      snapshot.referenceRows.length !==
        CABLE_REFERENCE_RENDER_POPULATION.referenceRecords
    )
      fail('full reference-coordinate witness is incomplete');
    const witnessBytes = new TextEncoder().encode(
      JSON.stringify(snapshot.referenceRows),
    ).byteLength;
    if (
      !Number.isSafeInteger(witnessBytes) ||
      witnessBytes > MAX_REFERENCE_WITNESS_BYTES
    )
      fail('full reference-coordinate witness exceeds its size cap');
    snapshot.referenceRowsBytes = witnessBytes;
  }
  if (mode === 'entities') {
    report.geometryAttribution = {
      schema: 'gev-cable-reference-geometry-attribution/v1',
      baseline: snapshot,
      candidate: null,
      comparison: null,
    };
    return true;
  }

  const baseline = report.geometryAttribution?.baseline;
  if (!baseline || !Array.isArray(baseline.referenceRows))
    fail('collection snapshot has no Entity baseline');
  const { referenceRows: _candidateRows, ...candidate } = snapshot;
  report.geometryAttribution.candidate = candidate;
  report.geometryAttribution.comparison = compareCableReferenceGeometry(
    baseline.referenceRows,
    snapshot.referenceRows,
  );
  if (!retainRows) delete baseline.referenceRows;
  else
    report.geometryAttribution.candidate.referenceRows = snapshot.referenceRows;
  return true;
}
