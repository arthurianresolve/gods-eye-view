import assert from 'node:assert/strict';
import test from 'node:test';
import {
  compareCableClassificationRows,
  summarizeCableClassificationTrace,
  summarizeCablePrimitiveReadiness,
} from './cableClassificationAttribution.mjs';

test('classification control reports unchanged same-classification notifications', () => {
  const rows = [
    { id: 'cable-a', classification: 'TERRAIN' },
    { id: 'cable-b', classification: 'TERRAIN' },
  ];
  assert.deepEqual(compareCableClassificationRows(rows, rows), {
    beforeCount: 2,
    afterCount: 2,
    identityOrderStable: true,
    changedEntityCount: 0,
    addedEntityCount: 0,
    removedEntityCount: 0,
    before: { TERRAIN: 2, CESIUM_3D_TILE: 0, BOTH: 0 },
    after: { TERRAIN: 2, CESIUM_3D_TILE: 0, BOTH: 0 },
  });
});

test('classification transition counts changed rows and detects identity/order drift', () => {
  const before = [
    { id: 'a', classification: 'TERRAIN' },
    { id: 'b', classification: 'TERRAIN' },
  ];
  const after = [
    { id: 'a', classification: 'CESIUM_3D_TILE' },
    { id: 'b', classification: 'TERRAIN' },
  ];
  const changed = compareCableClassificationRows(before, after);
  assert.equal(changed.identityOrderStable, true);
  assert.equal(changed.changedEntityCount, 1);
  assert.deepEqual(changed.before, { TERRAIN: 2, CESIUM_3D_TILE: 0, BOTH: 0 });
  assert.deepEqual(changed.after, { TERRAIN: 1, CESIUM_3D_TILE: 1, BOTH: 0 });

  const reordered = compareCableClassificationRows(
    before,
    [...after].reverse(),
  );
  assert.equal(reordered.identityOrderStable, false);
  assert.equal(reordered.changedEntityCount, 1);
  assert.equal(reordered.addedEntityCount, 0);
  assert.equal(reordered.removedEntityCount, 0);
});

test('classification changes compare stable IDs when identities are added or removed', () => {
  const changed = compareCableClassificationRows(
    [
      { id: 'kept', classification: 'TERRAIN' },
      { id: 'removed', classification: 'CESIUM_3D_TILE' },
    ],
    [
      { id: 'added', classification: 'BOTH' },
      { id: 'kept', classification: 'CESIUM_3D_TILE' },
    ],
  );
  assert.equal(changed.identityOrderStable, false);
  assert.equal(changed.changedEntityCount, 1);
  assert.equal(changed.addedEntityCount, 1);
  assert.equal(changed.removedEntityCount, 1);
});

test('classification rows reject duplicate identities, unknown kinds, and oversized input', () => {
  assert.throws(
    () =>
      compareCableClassificationRows(
        [{ id: 'same', classification: 'TERRAIN' }],
        [
          { id: 'same', classification: 'TERRAIN' },
          { id: 'same', classification: 'BOTH' },
        ],
      ),
    /malformed/,
  );
  assert.throws(
    () =>
      compareCableClassificationRows(
        [{ id: 'a', classification: 'UNKNOWN' }],
        [],
      ),
    /malformed/,
  );
  assert.throws(
    () =>
      compareCableClassificationRows(
        Array.from({ length: 3001 }, (_, index) => ({
          id: `id-${index}`,
          classification: 'TERRAIN',
        })),
        [],
      ),
    /oversized/,
  );
});

test('ground readiness projection retains bounded build-state observations', () => {
  const readiness = summarizeCablePrimitiveReadiness({
    ready: false,
    observedOwners: 9,
    pending: [{ path: 'groundPrimitives/0' }],
    unsupportedOwners: [],
    owners: Array.from({ length: 5 }, (_, index) => ({
      path: `groundPrimitives/${index}`,
      fixtureOwnerId: `ground-polyline-${index}`,
      type: 'GroundPolylinePrimitive',
      ready: index !== 0,
      show: index !== 0,
      ...(index === 0
        ? {
            buildState: {
              status: 'observed',
              primitivePresent: true,
              primitiveReady: false,
              primitiveShow: false,
              state: { name: 'COMBINING' },
              instanceCount: 1913,
              createGeometryResultsCount: 0,
              geometriesCount: 0,
              vertexArraysCount: 0,
              error: { name: 'WorkerError', message: 'hidden from projection' },
            },
          }
        : {}),
    })),
  });
  assert.equal(readiness.available, true);
  assert.equal(readiness.groundPolylineCount, 5);
  assert.equal(readiness.groundPolylines.length, 4);
  assert.equal(readiness.groundPolylinesTruncated, true);
  assert.equal(
    readiness.groundPolylines[0].fixtureOwnerId,
    'ground-polyline-0',
  );
  assert.equal(readiness.groundPolylines[0].build.state, 'COMBINING');
  assert.equal(readiness.groundPolylines[0].build.instanceCount, 1913);
  assert.equal('message' in readiness.groundPolylines[0].build, false);
  assert.deepEqual(
    summarizeCablePrimitiveReadiness({ owners: Array(65).fill({}) }),
    { available: false, reason: 'owner-list-out-of-bounds' },
  );
});

test('classification readiness trace rejects missing and oversized observations', () => {
  assert.deepEqual(summarizeCableClassificationTrace(null), {
    available: false,
    reason: 'missing-trace',
  });
  const trace = {
    stage: 'map-stack-photoreal',
    observationCount: 9,
    truncated: true,
    observations: Array.from({ length: 9 }, () => ({})),
  };
  assert.deepEqual(summarizeCableClassificationTrace(trace), {
    available: false,
    reason: 'trace-observations-out-of-bounds',
  });
});
