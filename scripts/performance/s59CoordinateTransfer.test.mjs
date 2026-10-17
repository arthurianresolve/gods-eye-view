import assert from 'node:assert/strict';
import test from 'node:test';
import {
  packPreviewCoordinates,
  rehydratePreviewCoordinates,
} from './s59CoordinateTransfer.mjs';

function samplePreview() {
  return {
    kind: 'geojson',
    accepted: 2,
    rejected: 0,
    warnings: [],
    evidence: { source: 'fixture', optional: undefined },
    records: [
      {
        id: 'line',
        properties: { name: 'preserve', rank: 4 },
        evidence: { featureId: 'feature-1' },
        geometry: {
          type: 'LineString',
          coordinates: [
            [-97, 30],
            [-96, 31, 120],
          ],
          bbox: [-97, 30, -96, 31],
          optional: null,
        },
      },
      {
        id: 'collection',
        geometry: {
          type: 'GeometryCollection',
          geometries: [
            { type: 'Point', coordinates: [1, 2] },
            {
              type: 'LineString',
              coordinates: [
                [1, 2],
                [3, 4],
              ],
            },
          ],
        },
      },
      { id: 'null-geometry', geometry: null },
    ],
  };
}

test('coordinate transfer preserves full preview values and geometry key order', async () => {
  const original = samplePreview();
  const packet = packPreviewCoordinates(original);
  const result = await rehydratePreviewCoordinates(packet, { budgetMs: 4 });
  assert.deepEqual(result.preview, original);
  assert.deepEqual(
    Object.keys(result.preview.records[0].geometry),
    Object.keys(original.records[0].geometry),
  );
  assert.equal(result.preview.records[1], original.records[1]);
  assert.equal(result.preview.records[2], original.records[2]);
  assert.ok(result.batches > 0);
  assert.ok(Number.isFinite(result.maximumBatchDurationMs));
});

test('transfer packet rejects malformed markers, shape instructions, and values', async () => {
  const original = samplePreview();
  const packed = packPreviewCoordinates(original);

  await assert.rejects(
    rehydratePreviewCoordinates({
      ...packed,
      packedRecords: Uint8Array.from([2, 0, 0]),
    }),
    /invalid record marker/,
  );
  await assert.rejects(
    rehydratePreviewCoordinates({
      ...packed,
      shapeBuffer: Int32Array.from([-1]),
    }),
    /dimension is invalid/,
  );
  const nonFinite = new Float64Array(packed.coordinateBuffer);
  nonFinite[0] = Number.NaN;
  await assert.rejects(
    rehydratePreviewCoordinates({ ...packed, coordinateBuffer: nonFinite }),
    /non-finite coordinate/,
  );
  await assert.rejects(
    rehydratePreviewCoordinates({
      ...packed,
      shapeBuffer: Int32Array.from([...packed.shapeBuffer, 0]),
    }),
    /unused shape or coordinate/,
  );
});

test('transfer packing enforces coordinate and nesting limits without fallback cloning', () => {
  const oversized = {
    records: [
      {
        geometry: {
          type: 'LineString',
          coordinates: Array.from({ length: 50_001 }, () => [1, 2, 3]),
        },
      },
    ],
  };
  assert.throws(() => packPreviewCoordinates(oversized), /50,000-coordinate/);

  let nested = [1, 2];
  for (let index = 0; index < 14; index++) nested = [nested];
  assert.throws(
    () =>
      packPreviewCoordinates({
        records: [{ geometry: { type: 'LineString', coordinates: nested } }],
      }),
    /nesting exceeds its limit/,
  );
});

test('packing accepts the shape-instruction boundary and rejects the next append', () => {
  const nested = (point, levels) => {
    let value = point;
    for (let index = 0; index < levels; index++) value = [value];
    return value;
  };
  const coordinates = Array.from({ length: 40_000 }, (_, index) =>
    nested([index, 1], index === 39_999 ? 3 : 4),
  );
  // One outer array + (39,999 * 5) + 4 instructions = exactly 200,000.
  const atLimit = packPreviewCoordinates({
    records: [{ geometry: { type: 'LineString', coordinates } }],
  });
  assert.equal(atLimit.shapeBuffer.length, 200_000);
  coordinates[39_999] = nested([39_999, 1], 4);
  assert.throws(
    () =>
      packPreviewCoordinates({
        records: [{ geometry: { type: 'LineString', coordinates } }],
      }),
    /shape-instruction limit/,
  );
});

test('aborted transfer rehydration rejects before publishing a preview', async () => {
  const packet = packPreviewCoordinates(samplePreview());
  const controller = new AbortController();
  controller.abort(new DOMException('fixture cancellation', 'AbortError'));
  await assert.rejects(
    rehydratePreviewCoordinates(packet, { signal: controller.signal }),
    { name: 'AbortError' },
  );
});

test('cancellation during cooperative rehydration releases scheduled work', async () => {
  const preview = {
    records: [
      {
        id: 'large',
        geometry: {
          type: 'LineString',
          coordinates: Array.from({ length: 10_000 }, (_, index) => [index, 1]),
        },
      },
    ],
  };
  const packet = packPreviewCoordinates(preview);
  const controller = new AbortController();
  let scheduled = 0;
  let batches = 0;
  const scheduleTimer = (callback) => {
    const timer = setTimeout(callback, 0);
    scheduled++;
    return timer;
  };
  let cancelled = 0;
  scheduleTimer.cancel = (timer) => {
    cancelled++;
    clearTimeout(timer);
  };
  const operation = rehydratePreviewCoordinates(packet, {
    signal: controller.signal,
    scheduleTimer,
    onBatchDuration() {
      batches++;
      if (batches === 1) controller.abort();
    },
  });
  await assert.rejects(operation, { name: 'AbortError' });
  assert.equal(cancelled, 1);
});
