import assert from 'node:assert/strict';
import test from 'node:test';
import {
  compareCableReferenceGeometry,
  recordCableReferenceGeometryAttribution,
} from './cableGeometryAttribution.mjs';

function rows() {
  return Array.from({ length: 2629 }, (_, sourceOrdinal) => ({
    sourceOrdinal,
    sourceKind: sourceOrdinal < 712 ? 'cable' : 'landing-point',
    sourceRecordId: `source-${sourceOrdinal}`,
    entityId: `reference-${sourceOrdinal}`,
    pointPosition: [sourceOrdinal, 1, 2],
    stemPositions: [
      [sourceOrdinal, 1, 2],
      [sourceOrdinal, 1, 3],
    ],
    effectiveVisible: sourceOrdinal % 2 === 0,
  }));
}

test('reference geometry comparison attributes exact changes by stable ID and visibility', () => {
  const before = rows();
  const after = structuredClone(before);
  after[2].pointPosition[2] = 2.01;
  after[2].stemPositions[1][2] = 3.01;
  after[3].stemPositions[0][0] = 3.25;
  after[4].effectiveVisible = false;

  const comparison = compareCableReferenceGeometry(before, after);
  assert.equal(comparison.beforeCount, 2629);
  assert.equal(comparison.afterCount, 2629);
  assert.equal(comparison.beforeVisible, 1315);
  assert.equal(comparison.beforeHidden, 1314);
  assert.equal(comparison.visibilityChangedCount, 1);
  assert.equal(comparison.pointChangedCount, 1);
  assert.equal(comparison.stemChangedCount, 2);
  assert.equal(comparison.visibleChangedCount, 2);
  assert.equal(comparison.hiddenChangedCount, 1);
  assert.deepEqual(comparison.examples.visible[0], {
    entityId: 'reference-2',
    sourceOrdinal: 2,
    sourceKind: 'cable',
    sourceRecordId: 'source-2',
    sourceIdentityAfter: {
      sourceOrdinal: 2,
      sourceKind: 'cable',
      sourceRecordId: 'source-2',
    },
    visibility: { before: true, after: true },
    pointPosition: { before: [2, 1, 2], after: [2, 1, 2.01] },
    stemPositions: {
      before: [
        [2, 1, 2],
        [2, 1, 3],
      ],
      after: [
        [2, 1, 2],
        [2, 1, 3.01],
      ],
    },
  });
  assert.equal(comparison.examples.hidden[0].entityId, 'reference-3');
  assert.equal(comparison.examples.visible[1].entityId, 'reference-4');
});

test('reference geometry comparison caps examples while counting the full population', () => {
  const before = rows();
  const after = structuredClone(before);
  for (let index = 0; index < after.length; index += 2)
    after[index].pointPosition[0] += 0.5;

  const comparison = compareCableReferenceGeometry(before, after);
  assert.equal(comparison.pointChangedCount, 1315);
  assert.equal(comparison.visibleChangedCount, 1315);
  assert.equal(comparison.hiddenChangedCount, 0);
  assert.equal(comparison.examples.visible.length, 12);
});

test('stable Entity IDs expose source metadata drift independently of coordinates', () => {
  const before = rows();
  const after = structuredClone(before);
  after[18].sourceRecordId = 'unexpected-record';
  after[18].sourceOrdinal = 19;
  const comparison = compareCableReferenceGeometry(before, after);
  assert.equal(comparison.addedIdentityCount, 0);
  assert.equal(comparison.removedIdentityCount, 0);
  assert.equal(comparison.sourceIdentityChangedCount, 1);
  assert.equal(comparison.visibleChangedCount, 1);
  assert.equal(comparison.examples.visible[0].entityId, 'reference-18');
  assert.deepEqual(comparison.examples.visible[0].sourceIdentityAfter, {
    sourceOrdinal: 19,
    sourceKind: 'cable',
    sourceRecordId: 'unexpected-record',
  });
});

test('camera-change orchestration captures only that case and pairs both renderers', async () => {
  const report = {};
  let reads = 0;
  const before = rows();
  const after = structuredClone(before);
  after[2].stemPositions[1][2] += 0.25;
  const snapshot = (mode, referenceRows) => ({
    mode,
    sourceGeometrySha256: `source-${mode}`,
    referenceRows,
  });

  assert.equal(
    await recordCableReferenceGeometryAttribution(report, {
      caseId: 'default-style',
      mode: 'entities',
      readSnapshot: async () => {
        reads += 1;
        return snapshot('entities', before);
      },
    }),
    false,
  );
  assert.equal(reads, 0);
  await recordCableReferenceGeometryAttribution(report, {
    caseId: 'camera-change',
    mode: 'entities',
    readSnapshot: async () => {
      reads += 1;
      return snapshot('entities', before);
    },
  });
  await recordCableReferenceGeometryAttribution(report, {
    caseId: 'camera-change',
    mode: 'collections',
    readSnapshot: async () => {
      reads += 1;
      return snapshot('collections', after);
    },
  });

  assert.equal(reads, 2);
  assert.equal(
    report.geometryAttribution.schema,
    'gev-cable-reference-geometry-attribution/v1',
  );
  assert.equal(report.geometryAttribution.baseline.mode, 'entities');
  assert.equal(report.geometryAttribution.candidate.mode, 'collections');
  assert.equal(report.geometryAttribution.baseline.referenceRows, undefined);
  assert.equal(report.geometryAttribution.comparison.stemChangedCount, 1);
  assert.equal(report.geometryAttribution.comparison.visibleChangedCount, 1);
  assert.equal(
    report.geometryAttribution.comparison.examples.visible[0].entityId,
    'reference-2',
  );
});

test('opt-in camera-change witness retains bounded full reference rows by mode', async () => {
  const report = {};
  const baselineRows = rows();
  const candidateRows = structuredClone(baselineRows);
  candidateRows[34].pointPosition[2] += 0.125;
  const snapshot = (mode, referenceRows) => ({
    mode,
    sourceGeometrySha256: `source-${mode}`,
    referenceRows,
  });

  await recordCableReferenceGeometryAttribution(report, {
    caseId: 'camera-change',
    mode: 'entities',
    retainRows: true,
    readSnapshot: async () => snapshot('entities', baselineRows),
  });
  await recordCableReferenceGeometryAttribution(report, {
    caseId: 'camera-change',
    mode: 'collections',
    retainRows: true,
    readSnapshot: async () => snapshot('collections', candidateRows),
  });

  const attribution = report.geometryAttribution;
  assert.equal(attribution.baseline.referenceRows.length, 2629);
  assert.equal(attribution.candidate.referenceRows.length, 2629);
  assert.equal(
    attribution.baseline.referenceRowsBytes,
    JSON.stringify(baselineRows).length,
  );
  assert.equal(
    attribution.candidate.referenceRowsBytes,
    JSON.stringify(candidateRows).length,
  );
  assert.equal(attribution.comparison.pointChangedCount, 1);
  assert.equal(
    attribution.comparison.examples.visible[0].entityId,
    'reference-34',
  );
});

test('opt-in full reference witness rejects missing or oversized rows', async () => {
  await assert.rejects(
    recordCableReferenceGeometryAttribution(
      {},
      {
        caseId: 'camera-change',
        mode: 'entities',
        retainRows: true,
        readSnapshot: async () => ({
          mode: 'entities',
          referenceRows: rows().slice(1),
        }),
      },
    ),
    /full reference-coordinate witness is incomplete/,
  );
  const oversized = rows();
  for (const row of oversized) row.sourceRecordId = 'x'.repeat(1200);
  await assert.rejects(
    recordCableReferenceGeometryAttribution(
      {},
      {
        caseId: 'camera-change',
        mode: 'entities',
        retainRows: true,
        readSnapshot: async () => ({
          mode: 'entities',
          referenceRows: oversized,
        }),
      },
    ),
    /full reference-coordinate witness exceeds its size cap/,
  );
});

test('reference geometry comparison rejects missing, duplicate, and malformed identities or coordinates', () => {
  const baseline = rows();
  assert.throws(
    () => compareCableReferenceGeometry(baseline.slice(1), rows()),
    /baseline reference inventory is incomplete/,
  );

  const duplicate = rows();
  duplicate[1].entityId = duplicate[0].entityId;
  assert.throws(
    () => compareCableReferenceGeometry(duplicate, rows()),
    /baseline reference row is malformed or duplicated/,
  );

  const malformed = rows();
  malformed[5].stemPositions[1][1] = Number.NaN;
  assert.throws(
    () => compareCableReferenceGeometry(rows(), malformed),
    /candidate reference row is malformed or duplicated/,
  );
});
