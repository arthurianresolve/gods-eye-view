import assert from 'node:assert/strict';
import { consumeInBatches } from '../../src/imports/cooperative.js';

export const COORDINATE_TRANSFER_LIMITS = Object.freeze({
  records: 50_000,
  coordinates: 50_000,
  numericValues: 150_000,
  shapeInstructions: 200_000,
});

/** Pack only geometry coordinate arrays; all record metadata remains cloned. */
export function packPreviewCoordinates(preview) {
  assert.ok(
    preview && Array.isArray(preview.records),
    'Preview records are required.',
  );
  assert.ok(
    preview.records.length <= COORDINATE_TRANSFER_LIMITS.records,
    'Transfer packet exceeds the 50,000-record limit.',
  );
  const coordinateValues = [];
  const shapeInstructions = [];
  let coordinateCount = 0;
  const packedRecords = new Uint8Array(preview.records.length);
  const records = preview.records.map((record, recordIndex) => {
    const geometry = record?.geometry;
    if (!geometry || !Array.isArray(geometry.coordinates)) return record;
    const beforeShape = shapeInstructions.length;
    const beforeValues = coordinateValues.length;
    const beforeCoordinates = coordinateCount;
    try {
      const appended = appendShape(
        geometry.coordinates,
        shapeInstructions,
        coordinateValues,
        { coordinateCount },
        0,
      );
      coordinateCount = appended.coordinateCount;
    } catch (error) {
      if (error?.code !== 'unsupported-coordinate-shape') throw error;
      shapeInstructions.length = beforeShape;
      coordinateValues.length = beforeValues;
      coordinateCount = beforeCoordinates;
      return record;
    }
    packedRecords[recordIndex] = 1;
    const metadataGeometry = { ...geometry };
    // Keep the original key position so JSON/output hashes match exactly.
    metadataGeometry.coordinates = null;
    return { ...record, geometry: metadataGeometry };
  });
  assert.ok(
    coordinateValues.length <= COORDINATE_TRANSFER_LIMITS.numericValues,
    'Transfer packet exceeds the coordinate-value limit.',
  );
  assert.ok(
    shapeInstructions.length <= COORDINATE_TRANSFER_LIMITS.shapeInstructions,
    'Transfer packet exceeds the shape-instruction limit.',
  );
  return {
    metadata: { ...preview, records },
    packedRecords,
    shapeBuffer: Int32Array.from(shapeInstructions),
    coordinateBuffer: Float64Array.from(coordinateValues),
  };
}

function appendShape(value, shape, coordinates, state, depth) {
  assert.ok(depth <= 12, 'Transfer geometry nesting exceeds its limit.');
  if (
    Array.isArray(value) &&
    (value.length === 2 || value.length === 3) &&
    value.every((part) => typeof part === 'number')
  ) {
    assert.ok(
      value.every(Number.isFinite),
      'Coordinates must be finite numbers.',
    );
    assert.ok(
      state.coordinateCount < COORDINATE_TRANSFER_LIMITS.coordinates,
      'Transfer packet exceeds the 50,000-coordinate limit.',
    );
    assert.ok(
      coordinates.length + value.length <=
        COORDINATE_TRANSFER_LIMITS.numericValues,
      'Transfer packet exceeds the coordinate-value limit.',
    );
    assert.ok(
      shape.length < COORDINATE_TRANSFER_LIMITS.shapeInstructions,
      'Transfer packet exceeds the shape-instruction limit.',
    );
    shape.push(-value.length);
    coordinates.push(...value);
    return { coordinateCount: state.coordinateCount + 1 };
  }
  if (!Array.isArray(value))
    throw Object.assign(new Error('Unsupported geometry coordinate shape.'), {
      code: 'unsupported-coordinate-shape',
    });
  assert.ok(
    shape.length < COORDINATE_TRANSFER_LIMITS.shapeInstructions,
    'Transfer packet exceeds the shape-instruction limit.',
  );
  shape.push(value.length);
  let coordinateCount = state.coordinateCount;
  for (const child of value) {
    const appended = appendShape(
      child,
      shape,
      coordinates,
      { coordinateCount },
      depth + 1,
    );
    coordinateCount = appended.coordinateCount;
  }
  return { coordinateCount };
}

/** Rebuild a transfer packet using a 4ms target for owned main-thread batches. */
export async function rehydratePreviewCoordinates(
  packet,
  { signal, budgetMs = 4, onBatchDuration = null, scheduleTimer = null } = {},
) {
  const metadata = packet?.metadata;
  const records = metadata?.records;
  const packedRecords = packet?.packedRecords;
  const shape = packet?.shapeBuffer;
  const coordinates = packet?.coordinateBuffer;
  assert.ok(Array.isArray(records), 'Transfer metadata records are missing.');
  assert.ok(records.length <= COORDINATE_TRANSFER_LIMITS.records);
  assert.ok(
    packedRecords instanceof Uint8Array &&
      packedRecords.length === records.length,
  );
  assert.ok(
    shape instanceof Int32Array &&
      shape.length <= COORDINATE_TRANSFER_LIMITS.shapeInstructions,
  );
  assert.ok(
    coordinates instanceof Float64Array &&
      coordinates.length <= COORDINATE_TRANSFER_LIMITS.numericValues,
  );
  const state = { shapeIndex: 0, coordinateIndex: 0 };
  let coordinateCount = 0;
  const restored = new Array(records.length);
  const samples = { batches: 0, maximumBatchDurationMs: 0 };
  function* readNode(depth = 0) {
    if (depth > 12 || state.shapeIndex >= shape.length)
      throw new Error('Transfer shape instructions are incomplete.');
    const instruction = shape[state.shapeIndex++];
    if (instruction < 0) {
      const dimensions = -instruction;
      if (dimensions !== 2 && dimensions !== 3)
        throw new Error('Transfer coordinate dimension is invalid.');
      if (state.coordinateIndex + dimensions > coordinates.length)
        throw new Error('Transfer coordinate values are incomplete.');
      const point = Array.from(
        coordinates.subarray(
          state.coordinateIndex,
          state.coordinateIndex + dimensions,
        ),
      );
      if (!point.every(Number.isFinite))
        throw new Error('Transfer packet contains a non-finite coordinate.');
      coordinateCount++;
      if (coordinateCount > COORDINATE_TRANSFER_LIMITS.coordinates)
        throw new Error('Transfer coordinate count exceeds its limit.');
      state.coordinateIndex += dimensions;
      yield;
      return point;
    }
    if (instruction > COORDINATE_TRANSFER_LIMITS.coordinates)
      throw new Error('Transfer array length exceeds its limit.');
    yield;
    const output = [];
    for (let index = 0; index < instruction; index++)
      output.push(yield* readNode(depth + 1));
    return output;
  }
  function* restoreRecords() {
    for (let index = 0; index < records.length; index++) {
      const record = records[index];
      if (packedRecords[index] !== 0 && packedRecords[index] !== 1)
        throw new Error('Transfer packet contains an invalid record marker.');
      if (packedRecords[index] === 1) {
        if (!record?.geometry || record.geometry.coordinates !== null)
          throw new Error(
            'Packed record metadata has an invalid geometry shape.',
          );
        const geometry = { ...record.geometry };
        geometry.coordinates = yield* readNode();
        Object.freeze(geometry);
        restored[index] = Object.freeze({ ...record, geometry });
      } else {
        restored[index] = record;
        yield;
      }
    }
  }
  const schedule = (callback) => {
    const timer = scheduleTimer
      ? scheduleTimer(() => {
          const started = performance.now();
          try {
            callback();
          } finally {
            const duration = performance.now() - started;
            samples.batches++;
            samples.maximumBatchDurationMs = Math.max(
              samples.maximumBatchDurationMs,
              duration,
            );
            onBatchDuration?.(duration);
          }
        })
      : setTimeout(() => {
          const started = performance.now();
          try {
            callback();
          } finally {
            const duration = performance.now() - started;
            samples.batches++;
            samples.maximumBatchDurationMs = Math.max(
              samples.maximumBatchDurationMs,
              duration,
            );
            onBatchDuration?.(duration);
          }
        }, 0);
    return timer;
  };
  await consumeInBatches(restoreRecords(), {
    signal,
    budgetMs,
    deferStart: true,
    schedule,
    cancel: (timer) => {
      if (scheduleTimer) scheduleTimer.cancel?.(timer);
      else clearTimeout(timer);
    },
  });
  if (
    state.shapeIndex !== shape.length ||
    state.coordinateIndex !== coordinates.length
  )
    throw new Error(
      'Transfer packet contains unused shape or coordinate data.',
    );
  const output = Object.freeze({
    ...metadata,
    records: Object.freeze(restored),
  });
  return { preview: output, ...samples };
}
