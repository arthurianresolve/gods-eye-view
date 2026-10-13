import assert from 'node:assert/strict';
import { MAP_STREAMING_DELIVERY_SCHEMA } from './mapStreamingFixtureDelivery.mjs';
import {
  MAP_STREAMING_CAPTURE_SCHEMA,
  MAP_STREAMING_WORKLOAD_ID,
} from './mapStreamingWorkloadContract.mjs';
import {
  MAP_STREAMING_FIXTURE_ID,
  validateDeterministicMapStreamingFixture,
} from './mapStreamingFixture.mjs';
import { MAP_FIXTURE_BUILD_PROFILE_ID } from './buildProvenance.mjs';

const SHA256 = /^[a-f0-9]{64}$/;

export const MAP_STREAMING_STACK_SEQUENCE = Object.freeze([
  'photoreal',
  'esri-imagery',
  'osm',
  'photoreal',
]);

// Chosen to keep the actual 1440x900 camera footprint inside the M1 corpus.
// The route geometry test uses pinned Cesium.Camera, not endpoint-only checks.
export const MAP_STREAMING_ROUTE = Object.freeze({
  id: 'austin-map-rightward-v1',
  start: Object.freeze({
    longitude: -97.72,
    latitude: 30.27,
    heightM: 6_000,
  }),
  headingRadians: 0,
  pitchRadians: -Math.PI / 2,
  moveRightMetersPerSecond: 120,
  durationLimitMs: 60_000,
  declaredBounds: Object.freeze({
    west: -97.82,
    south: 30.2,
    east: -97.58,
    north: 30.34,
  }),
  stackSchedule: Object.freeze([
    Object.freeze({ atMs: 0, stackId: 'photoreal' }),
    Object.freeze({ atMs: 15_000, stackId: 'esri-imagery' }),
    Object.freeze({ atMs: 30_000, stackId: 'osm' }),
    Object.freeze({ atMs: 45_000, stackId: 'photoreal' }),
  ]),
});

const EXPECTED_IMAGERY_CLASS = Object.freeze({
  'esri-imagery': 'ArcGisMapServerImageryProvider',
  osm: 'OpenStreetMapImageryProvider',
});
const MAP_JOURNEY_POLL_INTERVAL_MS = 250;
const MAP_JOURNEY_MAX_POLL_COUNT = 720;
const MAP_JOURNEY_HOST_DEADLINE_MS = 150_000;
const MAP_GLOBE_QUEUE_SAMPLE_LIMIT = 8;
const MAP_GLOBE_IMAGERY_SAMPLE_LIMIT = 32;
export const MAP_GLOBE_TERRAIN_ANCESTRY_LIMIT = 24;
let nextMapJourneyOperationId = 0;

const MAP_TERRAIN_ANCESTRY_FIELDS = Object.freeze([
  'x',
  'y',
  'level',
  'tileState',
  'parent',
  'data',
  'terrainState',
  'dataMesh',
  'terrainData',
  'terrainMesh',
  'canUpsample',
]);

function projectMapTerrainQueueAncestry(value, firstSample) {
  assert.ok(value && typeof value === 'object' && !Array.isArray(value));
  assert.equal(typeof value.available, 'boolean');
  assert.equal(typeof value.cycleDetected, 'boolean');
  assert.equal(typeof value.truncated, 'boolean');
  assert.ok(Array.isArray(value.unsupportedFields));
  assert.ok(
    value.unsupportedFields.length <= MAP_TERRAIN_ANCESTRY_FIELDS.length,
  );
  const unsupportedFields = [...value.unsupportedFields];
  assert.equal(new Set(unsupportedFields).size, unsupportedFields.length);
  for (const field of unsupportedFields)
    assert.ok(MAP_TERRAIN_ANCESTRY_FIELDS.includes(field));

  assert.ok(Array.isArray(value.rows));
  assert.ok(value.rows.length <= MAP_GLOBE_TERRAIN_ANCESTRY_LIMIT);
  if (!value.available) {
    assert.ok(
      ['no-queued-sample', 'sample-identity-unavailable'].includes(
        value.unavailableReason,
      ),
    );
    assert.equal(value.sample, null);
    assert.equal(value.rows.length, 0);
    assert.equal(value.truncated, false);
    assert.equal(value.cycleDetected, false);
    return {
      available: false,
      unavailableReason: value.unavailableReason,
      sample: null,
      rows: [],
      truncated: false,
      cycleDetected: false,
      unsupportedFields,
    };
  }

  assert.equal(value.unavailableReason, null);
  assert.ok(firstSample && typeof firstSample === 'object');
  assert.ok(value.sample && typeof value.sample === 'object');
  assert.ok(['high', 'medium', 'low'].includes(value.sample.queue));
  for (const name of ['queue', 'x', 'y', 'level'])
    assert.equal(value.sample[name], firstSample[name]);
  assert.ok(value.rows.length >= 1);
  const rows = value.rows.map((row) => {
    assert.ok(row && typeof row === 'object' && !Array.isArray(row));
    for (const name of ['x', 'y', 'level'])
      assert.ok(Number.isSafeInteger(row[name]) && row[name] >= 0);
    assert.ok(
      row.tileState === null ||
        (Number.isSafeInteger(row.tileState) &&
          row.tileState >= 0 &&
          row.tileState <= 3),
    );
    assert.ok(
      row.terrainState === null ||
        (Number.isSafeInteger(row.terrainState) &&
          row.terrainState >= 0 &&
          row.terrainState <= 6),
    );
    for (const name of [
      'parentPresent',
      'dataPresent',
      'dataMeshPresent',
      'terrainDataPresent',
      'terrainMeshPresent',
      'canUpsample',
    ])
      assert.ok(row[name] === null || typeof row[name] === 'boolean');
    return {
      x: row.x,
      y: row.y,
      level: row.level,
      tileState: row.tileState,
      parentPresent: row.parentPresent,
      dataPresent: row.dataPresent,
      terrainState: row.terrainState,
      dataMeshPresent: row.dataMeshPresent,
      terrainDataPresent: row.terrainDataPresent,
      terrainMeshPresent: row.terrainMeshPresent,
      canUpsample: row.canUpsample,
    };
  });
  assert.deepEqual(
    { x: rows[0].x, y: rows[0].y, level: rows[0].level },
    { x: firstSample.x, y: firstSample.y, level: firstSample.level },
    'Ancestry root must match the first queued sample identity.',
  );
  for (let index = 0; index + 1 < rows.length; index += 1) {
    const child = rows[index];
    const parent = rows[index + 1];
    assert.equal(child.parentPresent, true);
    assert.equal(parent.level, child.level - 1);
    assert.equal(parent.x, Math.floor(child.x / 2));
    assert.equal(parent.y, Math.floor(child.y / 2));
  }
  const last = rows.at(-1);
  assert.ok(
    last.parentPresent === false ||
      last.parentPresent === true ||
      last.parentPresent === null,
  );
  if (value.truncated) {
    assert.equal(rows.length, MAP_GLOBE_TERRAIN_ANCESTRY_LIMIT);
    assert.equal(last.parentPresent, true);
  } else if (last.parentPresent === true && !value.cycleDetected) {
    assert.ok(unsupportedFields.length > 0);
  }
  if (value.cycleDetected) assert.equal(last.parentPresent, true);
  if (last.parentPresent === false && last.level !== 0)
    assert.ok(unsupportedFields.includes('parent'));
  if (last.parentPresent === null && !unsupportedFields.includes('parent')) {
    throw new Error('Ancestry ended before a root or declared truncation.');
  }

  return {
    available: true,
    unavailableReason: null,
    sample: {
      queue: value.sample.queue,
      x: value.sample.x,
      y: value.sample.y,
      level: value.sample.level,
    },
    rows,
    truncated: value.truncated,
    cycleDetected: value.cycleDetected,
    unsupportedFields,
  };
}

const MAP_JOURNEY_PHASES = new Set([
  'starting',
  'initial-readiness',
  'transition',
  'transition-readiness',
  'route',
  'final-readiness',
  'completed',
]);
const MAP_JOURNEY_FAILURE_CODES = new Set([
  'page-operation-failed',
  'host-deadline',
  'poll-count-limit',
  'protocol-call-failed',
  'operation-disposal-failed',
  'operation-start-failed',
  'unexpected-operation-state',
]);
const MAP_TERRAIN_HISTORY_SAMPLE_LIMIT = 8;
const MAP_TERRAIN_HISTORY_ANCESTRY_LIMIT = 24;

function projectMapTerrainHistory(value) {
  assert.ok(value && typeof value === 'object' && !Array.isArray(value));
  assert.equal(value.schema, 'gev-map-terrain-history/v1');
  assert.equal(typeof value.finalized, 'boolean');
  assert.ok(Array.isArray(value.samples));
  assert.ok(Array.isArray(value.ancestryRows));
  assert.ok(
    ['photoreal', ...Object.keys(EXPECTED_IMAGERY_CLASS)].includes(
      value.stackId,
    ),
  );
  assert.ok(
    ['initial-readiness', 'transition-readiness', 'final-readiness'].includes(
      value.phase,
    ),
  );
  for (const name of [
    'completedObservationCount',
    'recordedObservationCount',
    'omittedObservationCount',
  ])
    assert.ok(Number.isSafeInteger(value[name]) && value[name] >= 0);
  assert.ok(value.completedObservationCount >= value.recordedObservationCount);
  assert.ok(value.recordedObservationCount <= value.completedObservationCount);
  assert.equal(
    value.omittedObservationCount,
    value.recordedObservationCount - value.samples.length,
  );
  assert.ok(value.recordedObservationCount >= value.samples.length);
  assert.ok(value.samples.length <= MAP_TERRAIN_HISTORY_SAMPLE_LIMIT);
  assert.ok(
    value.ancestryRows.length <=
      MAP_TERRAIN_HISTORY_SAMPLE_LIMIT * MAP_TERRAIN_HISTORY_ANCESTRY_LIMIT,
  );
  assert.ok(
    Number.isSafeInteger(value.omittedAncestryRowCount) &&
      value.omittedAncestryRowCount >= 0,
  );
  assert.ok(
    value.omittedAncestryRowCount <=
      value.omittedObservationCount * MAP_TERRAIN_HISTORY_ANCESTRY_LIMIT,
  );
  assert.ok(
    value.finalSequence === null || Number.isSafeInteger(value.finalSequence),
  );
  assert.ok(
    value.finalized
      ? value.samples.length === 0
        ? value.finalSequence === null
        : value.finalSequence === value.samples.at(-1).sequence
      : value.finalSequence === null,
  );
  const sampleSequences = new Set();
  const sampleBySequence = new Map();
  const sampleKeys = [
    'sequence',
    'observedElapsedMs',
    'routeElapsedMs',
    'stackId',
    'queueAvailable',
    'queueHigh',
    'queueMedium',
    'queueLow',
    'queueTotal',
    'identityAvailable',
    'identityQueue',
    'identityX',
    'identityY',
    'identityLevel',
    'identityStatus',
    'ancestryStatus',
    'ancestryRowCount',
    'ancestryTruncated',
    'ancestryCycleDetected',
    'ancestryUnsupportedFields',
    'final',
  ];
  let priorObservedElapsedMs = -1;
  let priorRouteElapsedMs = -1;
  let priorSequence = 0;
  let priorSample = null;
  let finalCount = 0;
  const samples = value.samples.map((sample, index) => {
    assert.ok(sample && typeof sample === 'object' && !Array.isArray(sample));
    assert.deepEqual(Object.keys(sample).sort(), [...sampleKeys].sort());
    assert.ok(
      Number.isSafeInteger(sample.sequence) && sample.sequence > priorSequence,
    );
    assert.ok(sample.sequence <= value.completedObservationCount);
    if (index === 0) assert.equal(sample.sequence, 1);
    assert.ok(
      Number.isFinite(sample.observedElapsedMs) &&
        sample.observedElapsedMs >= 0 &&
        sample.observedElapsedMs <= 240_000 &&
        sample.observedElapsedMs >= priorObservedElapsedMs,
    );
    if (index > 0 && sample.final !== true)
      assert.ok(sample.observedElapsedMs - priorObservedElapsedMs >= 2_000);
    assert.ok(
      Number.isFinite(sample.routeElapsedMs) &&
        sample.routeElapsedMs >= 0 &&
        sample.routeElapsedMs <= 240_000 &&
        sample.routeElapsedMs >= priorRouteElapsedMs,
    );
    assert.equal(sample.stackId, value.stackId);
    assert.ok(
      sample.queueAvailable === null ||
        typeof sample.queueAvailable === 'boolean',
    );
    const queueCounts = {
      high: sample.queueHigh,
      medium: sample.queueMedium,
      low: sample.queueLow,
      total: sample.queueTotal,
    };
    for (const count of Object.values(queueCounts))
      assert.ok(count === null || (Number.isSafeInteger(count) && count >= 0));
    if (sample.queueAvailable === true) {
      for (const count of Object.values(queueCounts))
        assert.ok(Number.isSafeInteger(count));
      assert.equal(
        queueCounts.total,
        queueCounts.high + queueCounts.medium + queueCounts.low,
      );
    } else
      assert.ok(Object.values(queueCounts).every((entry) => entry === null));
    assert.equal(sample.identityAvailable, sample.identityQueue !== null);
    if (sample.identityAvailable) {
      assert.ok(['high', 'medium', 'low'].includes(sample.identityQueue));
      for (const indexValue of [
        sample.identityX,
        sample.identityY,
        sample.identityLevel,
      ])
        assert.ok(Number.isSafeInteger(indexValue) && indexValue >= 0);
      if (sample.identityAvailable) {
        assert.ok(sample.queueAvailable === true);
        assert.ok(queueCounts[sample.identityQueue] > 0);
      }
    } else
      assert.ok(
        sample.identityX === null &&
          sample.identityY === null &&
          sample.identityLevel === null,
      );
    assert.ok(
      ['first', 'same', 'changed', 'unavailable'].includes(
        sample.identityStatus,
      ),
    );
    if (index === 0)
      assert.equal(
        sample.identityStatus,
        sample.identityAvailable ? 'first' : 'unavailable',
      );
    else if (!priorSample.identityAvailable || !sample.identityAvailable)
      assert.equal(sample.identityStatus, 'unavailable');
    else {
      const changed =
        priorSample.identityQueue !== sample.identityQueue ||
        priorSample.identityX !== sample.identityX ||
        priorSample.identityY !== sample.identityY ||
        priorSample.identityLevel !== sample.identityLevel;
      assert.equal(sample.identityStatus, changed ? 'changed' : 'same');
    }
    assert.ok(
      [
        'available',
        'no-queued-sample',
        'sample-identity-unavailable',
        'queue-unavailable',
        'not-observed',
      ].includes(sample.ancestryStatus),
    );
    assert.ok(
      Number.isSafeInteger(sample.ancestryRowCount) &&
        sample.ancestryRowCount >= 0 &&
        sample.ancestryRowCount <= MAP_TERRAIN_HISTORY_ANCESTRY_LIMIT,
    );
    assert.ok(
      typeof sample.ancestryTruncated === 'boolean' &&
        typeof sample.ancestryCycleDetected === 'boolean',
    );
    assert.ok(
      typeof sample.ancestryUnsupportedFields === 'string' &&
        sample.ancestryUnsupportedFields.length <= 128,
    );
    const ancestryUnsupportedFields = sample.ancestryUnsupportedFields
      ? sample.ancestryUnsupportedFields.split(',')
      : [];
    assert.ok(
      ancestryUnsupportedFields.length <= MAP_TERRAIN_ANCESTRY_FIELDS.length,
    );
    assert.equal(
      new Set(ancestryUnsupportedFields).size,
      ancestryUnsupportedFields.length,
    );
    for (const field of ancestryUnsupportedFields)
      assert.ok(MAP_TERRAIN_ANCESTRY_FIELDS.includes(field));
    assert.equal(
      sample.ancestryStatus === 'available',
      sample.ancestryRowCount > 0,
    );
    if (sample.ancestryStatus !== 'available') {
      assert.equal(sample.ancestryRowCount, 0);
      assert.equal(sample.ancestryTruncated, false);
      assert.equal(sample.ancestryCycleDetected, false);
    }
    assert.equal(typeof sample.final, 'boolean');
    if (sample.final) finalCount += 1;
    sampleSequences.add(sample.sequence);
    sampleBySequence.set(sample.sequence, sample);
    priorSequence = sample.sequence;
    priorObservedElapsedMs = sample.observedElapsedMs;
    priorRouteElapsedMs = sample.routeElapsedMs;
    priorSample = sample;
    return {
      sequence: sample.sequence,
      observedElapsedMs: sample.observedElapsedMs,
      routeElapsedMs: sample.routeElapsedMs,
      stackId: sample.stackId,
      queueAvailable: sample.queueAvailable,
      queueHigh: sample.queueHigh,
      queueMedium: sample.queueMedium,
      queueLow: sample.queueLow,
      queueTotal: sample.queueTotal,
      identityAvailable: sample.identityAvailable,
      identityQueue: sample.identityQueue,
      identityX: sample.identityX,
      identityY: sample.identityY,
      identityLevel: sample.identityLevel,
      identityStatus: sample.identityStatus,
      ancestryStatus: sample.ancestryStatus,
      ancestryRowCount: sample.ancestryRowCount,
      ancestryTruncated: sample.ancestryTruncated,
      ancestryCycleDetected: sample.ancestryCycleDetected,
      ancestryUnsupportedFields: sample.ancestryUnsupportedFields,
      final: sample.final,
    };
  });
  assert.equal(finalCount, value.finalized && samples.length > 0 ? 1 : 0);
  if (value.completedObservationCount > 0) assert.ok(samples.length > 0);
  if (value.finalized && samples.length > 0) {
    assert.equal(samples.at(-1).sequence, value.completedObservationCount);
    assert.equal(
      samples.filter((sample) => sample.final).at(-1),
      samples.at(-1),
    );
  }
  const ancestryRows = value.ancestryRows.map((row) => {
    assert.ok(row && typeof row === 'object' && !Array.isArray(row));
    assert.ok(sampleSequences.has(row.sampleSequence));
    const sample = sampleBySequence.get(row.sampleSequence);
    assert.ok(
      Number.isSafeInteger(row.rowIndex) &&
        row.rowIndex >= 0 &&
        row.rowIndex < sample.ancestryRowCount,
    );
    assert.deepEqual(
      Object.keys(row).sort(),
      [
        'sampleSequence',
        'rowIndex',
        'x',
        'y',
        'level',
        'tileState',
        'parentPresent',
        'dataPresent',
        'terrainState',
        'dataMeshPresent',
        'terrainDataPresent',
        'terrainMeshPresent',
        'canUpsample',
      ].sort(),
    );
    for (const name of ['x', 'y', 'level'])
      assert.ok(Number.isSafeInteger(row[name]) && row[name] >= 0);
    assert.ok(
      row.tileState === null ||
        (Number.isSafeInteger(row.tileState) &&
          row.tileState >= 0 &&
          row.tileState <= 3),
    );
    assert.ok(
      row.terrainState === null ||
        (Number.isSafeInteger(row.terrainState) &&
          row.terrainState >= 0 &&
          row.terrainState <= 6),
    );
    for (const name of [
      'parentPresent',
      'dataPresent',
      'dataMeshPresent',
      'terrainDataPresent',
      'terrainMeshPresent',
      'canUpsample',
    ])
      assert.ok(typeof row[name] === 'boolean' || row[name] === null);
    return { ...row };
  });
  for (const sample of samples) {
    const rows = ancestryRows
      .filter((row) => row.sampleSequence === sample.sequence)
      .sort((a, b) => a.rowIndex - b.rowIndex);
    assert.equal(rows.length, sample.ancestryRowCount);
    assert.deepEqual(
      rows.map((row) => row.rowIndex),
      rows.map((_, index) => index),
    );
    if (rows.length > 0 && sample.identityAvailable)
      assert.deepEqual(
        {
          queue: sample.identityQueue,
          x: rows[0].x,
          y: rows[0].y,
          level: rows[0].level,
        },
        {
          queue: sample.identityQueue,
          x: sample.identityX,
          y: sample.identityY,
          level: sample.identityLevel,
        },
      );
    for (let index = 0; index + 1 < rows.length; index += 1) {
      assert.equal(rows[index].parentPresent, true);
      assert.equal(rows[index + 1].level, rows[index].level - 1);
      assert.equal(rows[index + 1].x, Math.floor(rows[index].x / 2));
      assert.equal(rows[index + 1].y, Math.floor(rows[index].y / 2));
    }
    if (sample.ancestryStatus === 'available') {
      const projected = projectMapTerrainQueueAncestry(
        {
          available: true,
          unavailableReason: null,
          sample: {
            queue: sample.identityQueue,
            x: sample.identityX,
            y: sample.identityY,
            level: sample.identityLevel,
          },
          rows: rows.map(
            ({
              rowIndex: _rowIndex,
              sampleSequence: _sampleSequence,
              ...row
            }) => row,
          ),
          truncated: sample.ancestryTruncated,
          cycleDetected: sample.ancestryCycleDetected,
          unsupportedFields: sample.ancestryUnsupportedFields
            ? sample.ancestryUnsupportedFields.split(',')
            : [],
        },
        {
          queue: sample.identityQueue,
          x: sample.identityX,
          y: sample.identityY,
          level: sample.identityLevel,
        },
      );
      assert.equal(projected.rows.length, sample.ancestryRowCount);
    }
  }
  return {
    schema: value.schema,
    phase: value.phase,
    stackId: value.stackId,
    completedObservationCount: value.completedObservationCount,
    recordedObservationCount: value.recordedObservationCount,
    omittedObservationCount: value.omittedObservationCount,
    omittedAncestryRowCount: value.omittedAncestryRowCount,
    finalized: value.finalized,
    finalSequence: value.finalSequence,
    samples,
    ancestryRows,
  };
}

function projectMapJourneyCheckpoint(value) {
  if (value === null) return null;
  assert.ok(value && typeof value === 'object' && !Array.isArray(value));
  assert.ok(MAP_JOURNEY_PHASES.has(value.phase));
  assert.equal(typeof value.initialReadinessComplete, 'boolean');
  assert.ok(
    Number.isSafeInteger(value.transitionCount) &&
      value.transitionCount >= 0 &&
      value.transitionCount <= 3,
  );
  assert.ok(
    value.targetStack === null ||
      EXPECTED_IMAGERY_CLASS[value.targetStack] !== undefined ||
      value.targetStack === 'photoreal',
  );
  assert.ok(
    Number.isFinite(value.routeElapsedMs) &&
      value.routeElapsedMs >= 0 &&
      value.routeElapsedMs <= 240_000,
  );
  const historyCandidates = [];
  if (value.terrainHistory !== undefined && value.terrainHistory !== null)
    historyCandidates.push(projectMapTerrainHistory(value.terrainHistory));
  let latestObservation = null;
  if (value.latestObservation !== null) {
    const observation = value.latestObservation;
    assert.ok(
      observation &&
        typeof observation === 'object' &&
        !Array.isArray(observation),
    );
    for (const name of [
      'activeStack',
      'controllerStatus',
      'switchOrigin',
      'terrainProviderClass',
      'imageryProviderClass',
    ])
      assert.ok(
        observation[name] === null ||
          (typeof observation[name] === 'string' &&
            observation[name].length <= 96),
      );
    for (const name of [
      'hasError',
      'stackAvailable',
      'globeTilesLoaded',
      'photorealTilesLoaded',
    ])
      assert.ok(
        observation[name] === null || typeof observation[name] === 'boolean',
      );
    for (const name of [
      'imageryLayerCount',
      'photorealReadyContentTiles',
      'photorealSelectedTiles',
    ])
      assert.ok(
        observation[name] === null ||
          (Number.isSafeInteger(observation[name]) && observation[name] >= 0),
      );
    let globeQueueDiagnostics = null;
    if (
      observation.globeQueueDiagnostics !== null &&
      observation.globeQueueDiagnostics !== undefined
    ) {
      const queue = observation.globeQueueDiagnostics;
      assert.ok(queue && typeof queue === 'object' && !Array.isArray(queue));
      assert.equal(typeof queue.available, 'boolean');
      if (queue.available) {
        assert.equal(queue.unavailableReason, null);
        assert.ok(queue.queueCounts && typeof queue.queueCounts === 'object');
        for (const name of ['high', 'medium', 'low', 'total'])
          assert.ok(
            Number.isSafeInteger(queue.queueCounts[name]) &&
              queue.queueCounts[name] >= 0,
          );
        assert.equal(
          queue.queueCounts.total,
          queue.queueCounts.high +
            queue.queueCounts.medium +
            queue.queueCounts.low,
        );
        assert.ok(
          queue.renderedTileCount === null ||
            (Number.isSafeInteger(queue.renderedTileCount) &&
              queue.renderedTileCount >= 0),
        );
        assert.ok(Array.isArray(queue.sampledTiles));
        assert.ok(queue.sampledTiles.length <= MAP_GLOBE_QUEUE_SAMPLE_LIMIT);
        const sampledTiles = queue.sampledTiles.map((tile) => {
          assert.ok(tile && typeof tile === 'object' && !Array.isArray(tile));
          assert.ok(['high', 'medium', 'low'].includes(tile.queue));
          for (const name of ['x', 'y', 'level'])
            assert.ok(
              tile[name] === null ||
                (Number.isSafeInteger(tile[name]) && tile[name] >= 0),
            );
          assert.ok(
            tile.tileState === null ||
              (Number.isSafeInteger(tile.tileState) &&
                tile.tileState >= 0 &&
                tile.tileState <= 3),
          );
          assert.ok(
            tile.terrainState === null ||
              (Number.isSafeInteger(tile.terrainState) &&
                tile.terrainState >= 0 &&
                tile.terrainState <= 6),
          );
          assert.ok(
            tile.meshPresent === null || typeof tile.meshPresent === 'boolean',
          );
          assert.ok(
            tile.imageryEntryCount === null ||
              (Number.isSafeInteger(tile.imageryEntryCount) &&
                tile.imageryEntryCount >= 0),
          );
          assert.ok(
            Number.isSafeInteger(tile.imageryEntriesSampled) &&
              tile.imageryEntriesSampled >= 0 &&
              tile.imageryEntriesSampled <= MAP_GLOBE_IMAGERY_SAMPLE_LIMIT,
          );
          assert.ok(
            tile.omittedImageryEntryCount === null ||
              (Number.isSafeInteger(tile.omittedImageryEntryCount) &&
                tile.omittedImageryEntryCount >= 0),
          );
          assert.ok(
            Number.isSafeInteger(tile.loadingImagerySampledCount) &&
              tile.loadingImagerySampledCount >= 0 &&
              tile.loadingImagerySampledCount <= tile.imageryEntriesSampled,
          );
          assert.ok(Array.isArray(tile.loadingImageryStateCounts));
          assert.equal(tile.loadingImageryStateCounts.length, 8);
          for (const count of tile.loadingImageryStateCounts)
            assert.ok(Number.isSafeInteger(count) && count >= 0);
          assert.ok(
            Number.isSafeInteger(tile.unknownLoadingImageryStateCount) &&
              tile.unknownLoadingImageryStateCount >= 0,
          );
          if (tile.imageryEntryCount === null) {
            assert.equal(tile.imageryEntriesSampled, 0);
            assert.equal(tile.omittedImageryEntryCount, null);
            assert.equal(tile.loadingImagerySampledCount, 0);
          } else {
            assert.equal(
              tile.imageryEntriesSampled,
              Math.min(tile.imageryEntryCount, MAP_GLOBE_IMAGERY_SAMPLE_LIMIT),
            );
            assert.equal(
              tile.omittedImageryEntryCount,
              tile.imageryEntryCount - tile.imageryEntriesSampled,
            );
          }
          assert.equal(
            tile.loadingImagerySampledCount,
            tile.loadingImageryStateCounts.reduce(
              (sum, count) => sum + count,
              tile.unknownLoadingImageryStateCount,
            ),
          );
          return {
            queue: tile.queue,
            x: tile.x,
            y: tile.y,
            level: tile.level,
            tileState: tile.tileState,
            terrainState: tile.terrainState,
            meshPresent: tile.meshPresent,
            imageryEntryCount: tile.imageryEntryCount,
            imageryEntriesSampled: tile.imageryEntriesSampled,
            omittedImageryEntryCount: tile.omittedImageryEntryCount,
            loadingImagerySampledCount: tile.loadingImagerySampledCount,
            loadingImageryStateCounts: [...tile.loadingImageryStateCounts],
            unknownLoadingImageryStateCount:
              tile.unknownLoadingImageryStateCount,
          };
        });
        for (const queueName of ['high', 'medium', 'low'])
          assert.ok(
            sampledTiles.filter((tile) => tile.queue === queueName).length <=
              queue.queueCounts[queueName],
          );
        const queueHistory =
          queue.terrainHistory === undefined || queue.terrainHistory === null
            ? null
            : projectMapTerrainHistory(queue.terrainHistory);
        if (queueHistory) historyCandidates.push(queueHistory);
        globeQueueDiagnostics = {
          available: true,
          unavailableReason: null,
          queueCounts: {
            high: queue.queueCounts.high,
            medium: queue.queueCounts.medium,
            low: queue.queueCounts.low,
            total: queue.queueCounts.total,
          },
          renderedTileCount: queue.renderedTileCount,
          sampledTiles,
          omittedSampledTileCount: queue.omittedSampledTileCount,
          ...(queueHistory ? { terrainHistory: queueHistory } : {}),
        };
        assert.ok(
          Number.isSafeInteger(globeQueueDiagnostics.omittedSampledTileCount) &&
            globeQueueDiagnostics.omittedSampledTileCount >= 0,
        );
        assert.equal(
          globeQueueDiagnostics.sampledTiles.length,
          Math.min(
            MAP_GLOBE_QUEUE_SAMPLE_LIMIT,
            globeQueueDiagnostics.queueCounts.total,
          ),
        );
        assert.equal(
          globeQueueDiagnostics.omittedSampledTileCount,
          globeQueueDiagnostics.queueCounts.total -
            globeQueueDiagnostics.sampledTiles.length,
        );
      } else {
        assert.ok(
          ['surface-unavailable', 'private-queue-fields-unavailable'].includes(
            queue.unavailableReason,
          ),
        );
        assert.equal(queue.queueCounts, null);
        assert.ok(
          queue.renderedTileCount === null ||
            (Number.isSafeInteger(queue.renderedTileCount) &&
              queue.renderedTileCount >= 0),
        );
        assert.ok(Array.isArray(queue.sampledTiles));
        assert.equal(queue.sampledTiles.length, 0);
        assert.equal(queue.omittedSampledTileCount, null);
        const queueHistory =
          queue.terrainHistory === undefined || queue.terrainHistory === null
            ? null
            : projectMapTerrainHistory(queue.terrainHistory);
        if (queueHistory) historyCandidates.push(queueHistory);
        globeQueueDiagnostics = {
          available: false,
          unavailableReason: queue.unavailableReason,
          queueCounts: null,
          renderedTileCount: queue.renderedTileCount,
          sampledTiles: [],
          omittedSampledTileCount: null,
          ...(queueHistory ? { terrainHistory: queueHistory } : {}),
        };
      }
    }
    latestObservation = {
      activeStack: observation.activeStack,
      controllerStatus: observation.controllerStatus,
      switchOrigin: observation.switchOrigin,
      hasError: observation.hasError,
      stackAvailable: observation.stackAvailable,
      globeTilesLoaded: observation.globeTilesLoaded,
      terrainProviderClass: observation.terrainProviderClass,
      imageryLayerCount: observation.imageryLayerCount,
      imageryProviderClass: observation.imageryProviderClass,
      photorealTilesLoaded: observation.photorealTilesLoaded,
      photorealReadyContentTiles: observation.photorealReadyContentTiles,
      photorealSelectedTiles: observation.photorealSelectedTiles,
      globeQueueDiagnostics,
    };
  }
  assert.ok(historyCandidates.length <= 2);
  if (historyCandidates.length === 2)
    assert.deepEqual(
      historyCandidates[0],
      historyCandidates[1],
      'Duplicate terrain history projections must agree.',
    );
  const terrainHistory = historyCandidates[0] ?? null;
  if (terrainHistory && latestObservation?.globeQueueDiagnostics) {
    latestObservation.globeQueueDiagnostics.terrainHistory = terrainHistory;
  }
  return {
    phase: value.phase,
    initialReadinessComplete: value.initialReadinessComplete,
    transitionCount: value.transitionCount,
    targetStack: value.targetStack,
    routeElapsedMs: value.routeElapsedMs,
    latestObservation,
  };
}

/** Validate and project the deliberately small map-journey failure record. */
export function projectMapStreamingJourneyFailureEvidence(value) {
  assert.ok(value && typeof value === 'object' && !Array.isArray(value));
  assert.equal(value.schema, 'gev-map-streaming-journey-failure/v1');
  assert.ok(
    typeof value.operationId === 'string' &&
      /^[a-z0-9-]{1,96}$/i.test(value.operationId),
  );
  assert.ok(MAP_JOURNEY_FAILURE_CODES.has(value.failureCode));
  assert.ok(
    Number.isFinite(value.elapsedMs) &&
      value.elapsedMs >= 0 &&
      value.elapsedMs <= 240_000,
  );
  assert.ok(
    value.checkpoint === null ||
      (typeof value.checkpoint === 'object' &&
        !Array.isArray(value.checkpoint)),
  );
  let expected = null;
  if (value.expected !== null) {
    assert.ok(value.expected && typeof value.expected === 'object');
    expected = {};
    if (value.expected.operationId !== undefined) {
      assert.ok(
        typeof value.expected.operationId === 'string' &&
          /^[a-z0-9-]{1,96}$/i.test(value.expected.operationId),
      );
      expected.operationId = value.expected.operationId;
    }
    if (value.expected.status !== undefined) {
      assert.ok(value.expected.status === 'completed');
      expected.status = value.expected.status;
    }
    if (value.expected.maxElapsedMs !== undefined) {
      assert.ok(
        Number.isSafeInteger(value.expected.maxElapsedMs) &&
          value.expected.maxElapsedMs > 0 &&
          value.expected.maxElapsedMs <= MAP_JOURNEY_HOST_DEADLINE_MS,
      );
      expected.maxElapsedMs = value.expected.maxElapsedMs;
    }
    if (value.expected.maxPollCount !== undefined) {
      assert.ok(value.expected.maxPollCount === MAP_JOURNEY_MAX_POLL_COUNT);
      expected.maxPollCount = value.expected.maxPollCount;
    }
    if (value.expected.pollIntervalMs !== undefined) {
      assert.ok(value.expected.pollIntervalMs === MAP_JOURNEY_POLL_INTERVAL_MS);
      expected.pollIntervalMs = value.expected.pollIntervalMs;
    }
    assert.ok(Object.keys(expected).length > 0);
  }
  const retirement = value.retirement;
  assert.ok(retirement && typeof retirement === 'object');
  assert.ok(
    ['not-attempted', 'acknowledged', 'missing', 'failed'].includes(
      retirement.cancelStatus,
    ),
  );
  assert.ok(
    ['not-needed', 'drained', 'timed-out', 'failed', 'not-attempted'].includes(
      retirement.drainStatus,
    ),
  );
  assert.ok(
    ['unknown', 'running', 'completed', 'failed', 'missing'].includes(
      retirement.terminalStatus,
    ),
  );
  assert.ok(
    ['not-attempted', 'confirmed', 'failed', 'not-owned'].includes(
      retirement.disposeStatus,
    ),
  );
  assert.ok(
    Number.isSafeInteger(retirement.drainWaitMs) && retirement.drainWaitMs >= 0,
  );
  for (const name of ['cancelErrorKind', 'disposeErrorKind'])
    assert.ok(
      retirement[name] === null ||
        ['protocol-timeout', 'evaluation-failed'].includes(retirement[name]),
    );
  let sourceCheckpoint = value.checkpoint;
  if (
    value.checkpointGlobeQueueDiagnostics !== undefined &&
    value.checkpointGlobeQueueDiagnostics !== null
  ) {
    assert.ok(sourceCheckpoint?.latestObservation);
    if (sourceCheckpoint.latestObservation.globeQueueDiagnostics !== undefined)
      assert.deepEqual(
        sourceCheckpoint.latestObservation.globeQueueDiagnostics,
        value.checkpointGlobeQueueDiagnostics,
      );
    sourceCheckpoint = {
      ...sourceCheckpoint,
      latestObservation: {
        ...sourceCheckpoint.latestObservation,
        globeQueueDiagnostics: value.checkpointGlobeQueueDiagnostics,
      },
    };
  }
  const sourceQueueDiagnostics =
    sourceCheckpoint?.latestObservation?.globeQueueDiagnostics ?? null;
  const checkpointTerrainAncestry =
    sourceQueueDiagnostics?.terrainAncestry === undefined
      ? null
      : projectMapTerrainQueueAncestry(
          sourceQueueDiagnostics.terrainAncestry,
          sourceQueueDiagnostics.sampledTiles?.[0] ?? null,
        );
  const checkpoint = projectMapJourneyCheckpoint(sourceCheckpoint);
  const checkpointGlobeQueueDiagnostics =
    checkpoint?.latestObservation?.globeQueueDiagnostics ?? null;
  if (checkpoint?.latestObservation)
    delete checkpoint.latestObservation.globeQueueDiagnostics;
  if (checkpointGlobeQueueDiagnostics && checkpointTerrainAncestry)
    checkpointGlobeQueueDiagnostics.terrainAncestry = checkpointTerrainAncestry;
  return {
    schema: value.schema,
    operationId: value.operationId,
    failureCode: value.failureCode,
    elapsedMs: value.elapsedMs,
    checkpoint,
    ...(checkpointGlobeQueueDiagnostics
      ? { checkpointGlobeQueueDiagnostics }
      : {}),
    expected,
    retirement: {
      cancelStatus: retirement.cancelStatus,
      drainStatus: retirement.drainStatus,
      drainWaitMs: retirement.drainWaitMs,
      terminalStatus: retirement.terminalStatus,
      disposeStatus: retirement.disposeStatus,
      cancelErrorKind: retirement.cancelErrorKind,
      disposeErrorKind: retirement.disposeErrorKind,
    },
  };
}

/** Browser-serialized driver. Keep all helpers inside this function. */
export async function runNativeMapStreamingJourneyInPage({
  durationMs,
  route,
  command = 'run',
  operationId = null,
}) {
  const cancelDrainTimeoutMs = 5_000;
  const terrainAncestryLimit = 24;
  const operationKey = '__gevMapStreamingJourneyV1';
  const operations = () => {
    const current = window[operationKey];
    if (current && typeof current === 'object') return current;
    const created = Object.create(null);
    Object.defineProperty(window, operationKey, {
      configurable: true,
      value: created,
    });
    return created;
  };
  if (command === 'start') {
    if (
      typeof operationId !== 'string' ||
      !/^[a-z0-9-]{1,96}$/i.test(operationId)
    )
      throw new Error('Map journey operation identity is invalid.');
    const store = operations();
    if (store[operationId])
      throw new Error('Map journey operation identity is already owned.');
    const operation = {
      status: 'running',
      checkpoint: {
        phase: 'starting',
        initialReadinessComplete: false,
        transitionCount: 0,
        targetStack: null,
        latestObservation: null,
        terrainHistory: null,
      },
      result: null,
      failure: null,
      cancel: null,
      completion: null,
    };
    store[operationId] = operation;
    operation.completion = Promise.resolve()
      .then(() =>
        runNativeMapStreamingJourneyInPage({
          durationMs,
          route,
          command: 'run',
          operationId,
        }),
      )
      .then(
        (result) => {
          operation.result = result;
          operation.status = 'completed';
          operation.checkpoint = {
            ...operation.checkpoint,
            phase: 'completed',
            routeElapsedMs: result.route.elapsedMs,
            transitionCount: Math.max(0, result.transitions.length - 1),
            targetStack: result.finalState.activeStack,
          };
        },
        (error) => {
          const message = String(error?.message || error)
            .replace(/([?&]key=)[^&\s]+/gi, '$1[redacted]')
            .slice(0, 512);
          operation.failure = {
            name:
              typeof error?.name === 'string'
                ? error.name.slice(0, 64)
                : 'Error',
            message,
          };
          operation.status = 'failed';
        },
      );
    return { operationId, status: operation.status };
  }
  if (command === 'poll' || command === 'cancel' || command === 'dispose') {
    const store = window[operationKey];
    const operation =
      typeof operationId === 'string' ? store?.[operationId] : null;
    if (!operation) return { operationId, status: 'missing' };
    if (command === 'cancel') {
      let drainStatus = 'not-needed';
      let drainWaitMs = 0;
      if (operation.status === 'running') {
        drainStatus = 'timed-out';
        const drainStartedAt = performance.now();
        operation.cancel?.();
        let drainTimer = null;
        try {
          const drained = await Promise.race([
            operation.completion.then(() => true),
            new Promise((resolve) => {
              drainTimer = setTimeout(
                () => resolve(false),
                cancelDrainTimeoutMs,
              );
            }),
          ]);
          if (drained) drainStatus = 'drained';
        } finally {
          if (drainTimer !== null) clearTimeout(drainTimer);
          drainWaitMs = Math.max(
            0,
            Math.round(performance.now() - drainStartedAt),
          );
        }
      }
      return {
        operationId,
        status: operation.status,
        drainStatus,
        drainWaitMs,
        checkpoint: operation.checkpoint,
      };
    }
    if (command === 'dispose') {
      if (operation.status === 'running')
        throw new Error('A running map journey cannot be disposed.');
      delete store[operationId];
      if (Object.keys(store).length === 0) delete window[operationKey];
      return { operationId, status: 'disposed' };
    }
    return {
      operationId,
      status: operation.status,
      checkpoint: operation.checkpoint,
      ...(operation.status === 'completed' ? { result: operation.result } : {}),
      ...(operation.status === 'failed' ? { failure: operation.failure } : {}),
    };
  }
  if (command !== 'run')
    throw new Error('Map journey operation command is invalid.');
  const operation =
    typeof operationId === 'string'
      ? window[operationKey]?.[operationId]
      : null;

  const app = window.__godsEyeView;
  const viewer = app?.viewer;
  const controller = app?.mapStackController;
  if (!viewer || !controller?.getActiveId || !controller?.setStack)
    throw new Error(
      'Native map workload requires the application map controller.',
    );
  if (
    !Number.isSafeInteger(durationMs) ||
    durationMs < 1 ||
    durationMs > route.durationLimitMs
  )
    throw new Error('Map route duration is outside the declared bound.');
  if (
    route?.id !== 'austin-map-rightward-v1' ||
    !Number.isFinite(route?.start?.longitude) ||
    !Number.isFinite(route?.start?.latitude) ||
    !Number.isFinite(route?.start?.heightM) ||
    !Array.isArray(route?.stackSchedule) ||
    route.stackSchedule.length !== 4
  )
    throw new Error('Map route contract is malformed.');

  const scene = viewer.scene;
  const camera = viewer.camera;
  const globe = scene?.globe;
  if (!scene?.postRender?.addEventListener || !camera?.setView || !globe)
    throw new Error('Native map workload requires a renderable Cesium scene.');
  const Cesium = window.Cesium;
  if (
    typeof Cesium?.CesiumTerrainProvider !== 'function' ||
    typeof Cesium?.EllipsoidTerrainProvider !== 'function' ||
    typeof Cesium?.ArcGisMapServerImageryProvider !== 'function' ||
    typeof Cesium?.OpenStreetMapImageryProvider !== 'function'
  )
    throw new Error('Native Cesium provider constructors are unavailable.');
  const canonicalProviderType = (value) => {
    if (value instanceof Cesium.CesiumTerrainProvider)
      return 'CesiumTerrainProvider';
    if (value instanceof Cesium.EllipsoidTerrainProvider)
      return 'EllipsoidTerrainProvider';
    if (value instanceof Cesium.ArcGisMapServerImageryProvider)
      return 'ArcGisMapServerImageryProvider';
    if (value instanceof Cesium.OpenStreetMapImageryProvider)
      return 'OpenStreetMapImageryProvider';
    return null;
  };
  const expectedImageryClass = {
    'esri-imagery': 'ArcGisMapServerImageryProvider',
    osm: 'OpenStreetMapImageryProvider',
  };
  const readyTimeoutMs = Math.min(30_000, route.durationLimitMs);
  const cancellationError = (message) => {
    const error = new Error(message);
    error.code = 'GEV_MAP_JOURNEY_CANCELLED';
    return error;
  };

  const projectSnapshotSettings = () => {
    const style = app.styleManager;
    const services = style?.services;
    if (
      typeof style?._adaptiveQuality?.getMode !== 'function' ||
      typeof services?.getDetectionTuning !== 'function' ||
      typeof services?.getDetectionMode !== 'function' ||
      typeof style?.getVisualState !== 'function'
    )
      throw new Error(
        'Native visual settings are unavailable from the shared app observer.',
      );
    const visual = style.getVisualState();
    if (
      !visual ||
      typeof visual !== 'object' ||
      typeof visual.style !== 'string' ||
      !visual.bloom ||
      typeof visual.bloom.enabled !== 'boolean' ||
      !Number.isFinite(visual.bloom.intensity) ||
      !visual.sharpen ||
      typeof visual.sharpen.enabled !== 'boolean' ||
      !Number.isFinite(visual.sharpen.intensity) ||
      !visual.detection ||
      typeof visual.detection.mode !== 'string' ||
      !Number.isFinite(visual.detection.density) ||
      !visual.scope ||
      typeof visual.scope.enabled !== 'boolean' ||
      typeof visual.mapStack !== 'string' ||
      !visual.styleParams ||
      typeof visual.styleParams !== 'object'
    )
      throw new Error(
        'Native visual state is unavailable from the app observer.',
      );
    const tuning = services.getDetectionTuning();
    const contextAttributes =
      window.__gevRecoveryEarlyRendererProbe?.contextAttributes;
    if (
      !contextAttributes ||
      !Number.isFinite(tuning?.densityPct) ||
      tuning.densityPct < 0 ||
      tuning.densityPct > 100 ||
      !['manual', 'auto', 'quality', 'performance'].includes(
        style._adaptiveQuality.getMode(),
      ) ||
      typeof services.getDetectionMode() !== 'string' ||
      !Number.isFinite(viewer.resolutionScale) ||
      viewer.resolutionScale <= 0 ||
      typeof contextAttributes.antialias !== 'boolean' ||
      typeof contextAttributes.preserveDrawingBuffer !== 'boolean' ||
      !Number.isSafeInteger(scene.msaaSamples) ||
      scene.msaaSamples < 0 ||
      typeof scene.postProcessStages?.fxaa?.enabled !== 'boolean' ||
      typeof visual.bloom.enabled !== 'boolean' ||
      !Number.isFinite(visual.bloom.intensity) ||
      typeof visual.sharpen.enabled !== 'boolean' ||
      !Number.isFinite(visual.sharpen.intensity) ||
      !Number.isFinite(globe.maximumScreenSpaceError) ||
      globe.maximumScreenSpaceError <= 0
    )
      throw new Error('Native common visual settings are incomplete.');
    const tileset = app.tileset;
    return {
      qualityMode: style._adaptiveQuality.getMode(),
      densityPct: tuning.densityPct,
      detectionMode: services.getDetectionMode(),
      resolutionScale: viewer.resolutionScale ?? null,
      antialias: contextAttributes.antialias,
      msaaSamples: scene.msaaSamples ?? null,
      fxaa: scene.postProcessStages?.fxaa?.enabled ?? null,
      preserveDrawingBuffer: contextAttributes.preserveDrawingBuffer ?? null,
      bloom: visual.bloom.enabled,
      bloomIntensity: visual.bloom.intensity,
      sharpen: visual.sharpen.enabled,
      sharpenIntensity: visual.sharpen.intensity,
      visualState: visual,
      globeMaximumScreenSpaceError: globe.maximumScreenSpaceError ?? null,
      tilesetMaximumScreenSpaceError: tileset?.maximumScreenSpaceError ?? null,
      tilesetCacheBytes: tileset?.cacheBytes ?? null,
      tilesetMaximumCacheOverflowBytes:
        tileset?.maximumCacheOverflowBytes ?? null,
    };
  };

  const cameraState = () => {
    const position = camera.positionCartographic;
    return {
      longitude: (position.longitude * 180) / Math.PI,
      latitude: (position.latitude * 180) / Math.PI,
      heightM: position.height,
      headingRadians: camera.heading,
      pitchRadians: camera.pitch,
    };
  };

  const viewRectangleDegrees = () => {
    const rectangle = camera.computeViewRectangle(globe.ellipsoid);
    if (!rectangle)
      throw new Error(
        'Native camera frustum does not intersect the ellipsoid.',
      );
    return {
      west: (rectangle.west * 180) / Math.PI,
      south: (rectangle.south * 180) / Math.PI,
      east: (rectangle.east * 180) / Math.PI,
      north: (rectangle.north * 180) / Math.PI,
    };
  };

  const readTerrainSamples = () => {
    const center = camera.positionCartographic;
    const samples = [-0.004, 0, 0.004].map((delta) => {
      const point = {
        longitude: center.longitude + (delta * Math.PI) / 180,
        latitude: center.latitude,
        height: 0,
      };
      return {
        longitude: (point.longitude * 180) / Math.PI,
        latitude: (point.latitude * 180) / Math.PI,
        heightM: globe.getHeight(point) ?? null,
      };
    });
    return samples;
  };

  const readGlobeQueueDiagnostics = () => {
    const surface = globe?._surface;
    const renderedTileCount = Array.isArray(surface?._tilesToRender)
      ? surface._tilesToRender.length
      : null;
    const unavailableAncestry = (unavailableReason) => ({
      available: false,
      unavailableReason,
      sample: null,
      rows: [],
      truncated: false,
      cycleDetected: false,
      unsupportedFields: [],
    });
    if (!surface)
      return {
        available: false,
        unavailableReason: 'surface-unavailable',
        queueCounts: null,
        renderedTileCount: null,
        sampledTiles: [],
        omittedSampledTileCount: null,
        terrainAncestry: unavailableAncestry('no-queued-sample'),
      };
    const queues = [
      ['high', surface._tileLoadQueueHigh],
      ['medium', surface._tileLoadQueueMedium],
      ['low', surface._tileLoadQueueLow],
    ];
    if (!queues.every(([, queue]) => Array.isArray(queue)))
      return {
        available: false,
        unavailableReason: 'private-queue-fields-unavailable',
        queueCounts: null,
        renderedTileCount,
        sampledTiles: [],
        omittedSampledTileCount: null,
        terrainAncestry: unavailableAncestry('no-queued-sample'),
      };

    const queueCounts = {
      high: queues[0][1].length,
      medium: queues[1][1].length,
      low: queues[2][1].length,
      total: queues[0][1].length + queues[1][1].length + queues[2][1].length,
    };
    const sampledTiles = [];
    let firstSampleTile = null;
    let firstSampleQueue = null;
    for (const [queueName, queue] of queues) {
      for (
        let index = 0;
        index < queue.length && sampledTiles.length < 8;
        index += 1
      ) {
        const tile = queue[index];
        const data = tile?.data;
        const imagery = Array.isArray(data?.imagery) ? data.imagery : null;
        const imageryEntriesSampled = imagery
          ? Math.min(imagery.length, 32)
          : 0;
        const loadingImageryStateCounts = Array(8).fill(0);
        let loadingImagerySampledCount = 0;
        let unknownLoadingImageryStateCount = 0;
        for (
          let imageryIndex = 0;
          imageryIndex < imageryEntriesSampled;
          imageryIndex += 1
        ) {
          const loadingImagery = imagery[imageryIndex]?.loadingImagery;
          if (!loadingImagery) continue;
          loadingImagerySampledCount += 1;
          const state = loadingImagery.state;
          if (Number.isSafeInteger(state) && state >= 0 && state < 8)
            loadingImageryStateCounts[state] += 1;
          else unknownLoadingImageryStateCount += 1;
        }
        const finiteIndex = (value) =>
          Number.isSafeInteger(value) && value >= 0 ? value : null;
        const boundedState = (value, max) =>
          Number.isSafeInteger(value) && value >= 0 && value <= max
            ? value
            : null;
        if (sampledTiles.length === 0) {
          firstSampleTile = tile;
          firstSampleQueue = queueName;
        }
        sampledTiles.push({
          queue: queueName,
          x: finiteIndex(tile?._x),
          y: finiteIndex(tile?._y),
          level: finiteIndex(tile?._level),
          tileState: boundedState(tile?.state, 3),
          terrainState: boundedState(data?.terrainState, 6),
          meshPresent:
            data && 'mesh' in data
              ? data.mesh !== null && data.mesh !== undefined
              : null,
          imageryEntryCount: imagery ? imagery.length : null,
          imageryEntriesSampled,
          omittedImageryEntryCount: imagery
            ? imagery.length - imageryEntriesSampled
            : null,
          loadingImagerySampledCount,
          loadingImageryStateCounts,
          unknownLoadingImageryStateCount,
        });
      }
    }
    const readTerrainAncestry = () => {
      if (!firstSampleTile) return unavailableAncestry('no-queued-sample');
      const finiteIndex = (value) =>
        Number.isSafeInteger(value) && value >= 0 ? value : null;
      const sample = {
        queue: firstSampleQueue,
        x: finiteIndex(firstSampleTile?._x),
        y: finiteIndex(firstSampleTile?._y),
        level: finiteIndex(firstSampleTile?._level),
      };
      if (sample.x === null || sample.y === null || sample.level === null)
        return {
          ...unavailableAncestry('sample-identity-unavailable'),
          unsupportedFields: [
            ...(sample.x === null ? ['x'] : []),
            ...(sample.y === null ? ['y'] : []),
            ...(sample.level === null ? ['level'] : []),
          ],
        };

      const unsupportedFields = new Set();
      const seen = new Set();
      const rows = [];
      let current = firstSampleTile;
      let cycleDetected = false;
      let truncated = false;
      const readProperty = (object, name, supportedField) => {
        try {
          if (
            object === null ||
            (typeof object !== 'object' && typeof object !== 'function') ||
            !(name in object)
          ) {
            unsupportedFields.add(supportedField);
            return { supported: false, value: undefined };
          }
          return { supported: true, value: object[name] };
        } catch {
          unsupportedFields.add(supportedField);
          return { supported: false, value: undefined };
        }
      };

      while (current && rows.length < terrainAncestryLimit) {
        if (seen.has(current)) {
          cycleDetected = true;
          break;
        }
        seen.add(current);
        const xRead = readProperty(current, '_x', 'x');
        const yRead = readProperty(current, '_y', 'y');
        const levelRead = readProperty(current, '_level', 'level');
        const x = finiteIndex(xRead.value);
        const y = finiteIndex(yRead.value);
        const level = finiteIndex(levelRead.value);
        if (!xRead.supported || x === null) unsupportedFields.add('x');
        if (!yRead.supported || y === null) unsupportedFields.add('y');
        if (!levelRead.supported || level === null)
          unsupportedFields.add('level');
        if (
          !xRead.supported ||
          !yRead.supported ||
          !levelRead.supported ||
          x === null ||
          y === null ||
          level === null
        )
          break;

        const tileStateRead = readProperty(current, 'state', 'tileState');
        const tileStateValue = tileStateRead.value;
        const tileState =
          tileStateRead.supported &&
          Number.isSafeInteger(tileStateValue) &&
          tileStateValue >= 0 &&
          tileStateValue <= 3
            ? tileStateValue
            : null;
        if (tileState === null) unsupportedFields.add('tileState');

        const dataRead = readProperty(current, 'data', 'data');
        const dataValue = dataRead.value;
        const dataPresent = dataRead.supported
          ? dataValue !== null && dataValue !== undefined
          : null;
        const data = dataPresent ? dataValue : null;
        let terrainState = null;
        let dataMeshPresent = null;
        let terrainDataPresent = null;
        let terrainMeshPresent = null;
        let canUpsample = null;
        if (dataPresent === true) {
          const terrainStateRead = readProperty(
            data,
            'terrainState',
            'terrainState',
          );
          const terrainStateValue = terrainStateRead.value;
          terrainState =
            terrainStateRead.supported &&
            Number.isSafeInteger(terrainStateValue) &&
            terrainStateValue >= 0 &&
            terrainStateValue <= 6
              ? terrainStateValue
              : null;
          if (terrainState === null) unsupportedFields.add('terrainState');

          const dataMeshRead = readProperty(data, 'mesh', 'dataMesh');
          dataMeshPresent = dataMeshRead.supported
            ? dataMeshRead.value !== null && dataMeshRead.value !== undefined
            : null;

          const terrainDataRead = readProperty(
            data,
            'terrainData',
            'terrainData',
          );
          terrainDataPresent = terrainDataRead.supported
            ? terrainDataRead.value !== null &&
              terrainDataRead.value !== undefined
            : null;
          if (terrainDataPresent === true) {
            const terrainMeshRead = readProperty(
              terrainDataRead.value,
              '_mesh',
              'terrainMesh',
            );
            terrainMeshPresent = terrainMeshRead.supported
              ? terrainMeshRead.value !== null &&
                terrainMeshRead.value !== undefined
              : null;
            const canUpsampleRead = readProperty(
              terrainDataRead.value,
              'canUpsample',
              'canUpsample',
            );
            canUpsample = canUpsampleRead.supported
              ? typeof canUpsampleRead.value === 'boolean'
                ? canUpsampleRead.value
                : null
              : null;
            if (canUpsampleRead.supported && canUpsample === null)
              unsupportedFields.add('canUpsample');
          }
        }

        const parentRead = readProperty(current, 'parent', 'parent');
        const parentValue = parentRead.value;
        const parentPresent = parentRead.supported
          ? parentValue !== null && parentValue !== undefined
          : null;
        rows.push({
          x,
          y,
          level,
          tileState,
          parentPresent,
          dataPresent,
          terrainState,
          dataMeshPresent,
          terrainDataPresent,
          terrainMeshPresent,
          canUpsample,
        });
        if (parentPresent === null) break;
        if (!parentPresent) {
          if (level !== 0) unsupportedFields.add('parent');
          break;
        }
        if (seen.has(parentValue)) {
          cycleDetected = true;
          break;
        }
        if (rows.length === terrainAncestryLimit) {
          truncated = true;
          break;
        }
        current = parentValue;
      }
      return {
        available: true,
        unavailableReason: null,
        sample,
        rows,
        truncated,
        cycleDetected,
        unsupportedFields: [...unsupportedFields].sort(),
      };
    };
    return {
      available: true,
      unavailableReason: null,
      queueCounts,
      renderedTileCount,
      sampledTiles,
      omittedSampledTileCount: Math.max(
        0,
        queueCounts.total - sampledTiles.length,
      ),
      terrainAncestry: readTerrainAncestry(),
    };
  };

  const captureState = (postRenderElapsedMs = null) => {
    const controllerState = controller.getState?.() || null;
    const tileset = app.tileset;
    const imageryLayer = scene.imageryLayers?.get?.(0) || null;
    const provider = imageryLayer?.imageryProvider || null;
    const viewport = {
      width: scene.canvas?.clientWidth ?? null,
      height: scene.canvas?.clientHeight ?? null,
      drawingBufferWidth: scene.context?.drawingBufferWidth ?? null,
      drawingBufferHeight: scene.context?.drawingBufferHeight ?? null,
    };
    if (
      viewport.width !== 1440 ||
      viewport.height !== 900 ||
      viewport.drawingBufferWidth !== 1440 ||
      viewport.drawingBufferHeight !== 900
    )
      throw new Error('Map workload viewport or drawing buffer changed.');
    return {
      activeStack: controller.getActiveId(),
      controllerStatus: controllerState?.status ?? null,
      switchOrigin: controllerState?.switchOrigin ?? null,
      lastError: controllerState?.lastError ?? null,
      stackAvailable:
        controller.isStackAvailable?.(controller.getActiveId()) === true,
      globeShown: globe.show === true,
      globeTilesLoaded:
        typeof globe.tilesLoaded === 'boolean' ? globe.tilesLoaded : null,
      globeQueueDiagnostics: readGlobeQueueDiagnostics(),
      terrainProviderClass: canonicalProviderType(globe.terrainProvider),
      terrainSamples: readTerrainSamples(),
      imageryLayerCount: scene.imageryLayers?.length ?? null,
      imageryProviderClass: canonicalProviderType(provider),
      imageryLayerShow: imageryLayer?.show ?? null,
      photorealShown: tileset?.show === true,
      photorealTilesLoaded:
        typeof tileset?.tilesLoaded === 'boolean' ? tileset.tilesLoaded : null,
      photorealReadyContentTiles: Number.isSafeInteger(
        tileset?.statistics?.numberOfTilesWithContentReady,
      )
        ? tileset.statistics.numberOfTilesWithContentReady
        : null,
      photorealSelectedTiles: Number.isSafeInteger(
        tileset?.statistics?.selected,
      )
        ? tileset.statistics.selected
        : null,
      camera: cameraState(),
      viewRectangle: viewRectangleDegrees(),
      viewport,
      settings: projectSnapshotSettings(),
      postRenderElapsedMs,
    };
  };

  const journeyAbort = new AbortController();
  if (operation) operation.cancel = () => journeyAbort.abort();
  const progressObservation = (state) => ({
    activeStack: state.activeStack,
    controllerStatus: state.controllerStatus,
    switchOrigin: state.switchOrigin,
    hasError: state.lastError !== null,
    stackAvailable: state.stackAvailable,
    globeTilesLoaded: state.globeTilesLoaded,
    terrainProviderClass: state.terrainProviderClass,
    imageryLayerCount: state.imageryLayerCount,
    imageryProviderClass: state.imageryProviderClass,
    photorealTilesLoaded: state.photorealTilesLoaded,
    photorealReadyContentTiles: state.photorealReadyContentTiles,
    photorealSelectedTiles: state.photorealSelectedTiles,
    globeQueueDiagnostics: state.globeQueueDiagnostics,
  });
  let currentTerrainHistory = null;
  const terrainHistoryCheckpoint = () => {
    if (!currentTerrainHistory) return null;
    return {
      schema: 'gev-map-terrain-history/v1',
      phase: currentTerrainHistory.phase,
      stackId: currentTerrainHistory.stackId,
      completedObservationCount:
        currentTerrainHistory.completedObservationCount,
      recordedObservationCount: currentTerrainHistory.recordedObservationCount,
      omittedObservationCount:
        currentTerrainHistory.recordedObservationCount -
        currentTerrainHistory.samples.length,
      omittedAncestryRowCount: currentTerrainHistory.omittedAncestryRowCount,
      finalized: currentTerrainHistory.finalized,
      finalSequence: currentTerrainHistory.finalSequence,
      samples: currentTerrainHistory.samples.map((sample) => ({ ...sample })),
      ancestryRows: currentTerrainHistory.ancestryRows.map((row) => ({
        ...row,
      })),
    };
  };
  const updateProgress = (phase, targetStack = null, state = null) => {
    if (!operation) return;
    operation.checkpoint = {
      phase,
      initialReadinessComplete,
      transitionCount: transitionsCompleted,
      targetStack,
      routeElapsedMs:
        routeStartedAt === null
          ? 0
          : Math.max(0, performance.now() - routeStartedAt),
      latestObservation: state ? progressObservation(state) : null,
      terrainHistory: terrainHistoryCheckpoint(),
    };
  };
  let initialReadinessComplete = false;
  let transitionsCompleted = 0;
  let routeStartedAt = null;
  const waitForPostRender = (timeoutMs, signal) =>
    new Promise((resolve, reject) => {
      let settled = false;
      let remove = null;
      const onAbort = () =>
        finish(cancellationError('Map journey was cancelled.'));
      const timer = setTimeout(
        () =>
          finish(
            new Error('Completed render did not arrive before its bound.'),
          ),
        timeoutMs,
      );
      const finish = (error, observedAt) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
        try {
          remove?.();
        } catch {
          // The event may be retired with the page; the owning context closes next.
        }
        if (error) reject(error);
        else resolve(observedAt);
      };
      const listener = () => finish(null, performance.now());
      try {
        if (signal?.aborted)
          return finish(cancellationError('Map journey was cancelled.'));
        signal?.addEventListener('abort', onAbort, { once: true });
        remove = scene.postRender.addEventListener(listener);
        scene.requestRender?.();
      } catch (error) {
        finish(error);
      }
    });

  const isReady = (state, stackId) => {
    if (
      state.activeStack !== stackId ||
      state.controllerStatus !== 'ready' ||
      state.switchOrigin === 'automatic' ||
      state.lastError !== null ||
      state.stackAvailable !== true
    )
      return false;
    if (stackId === 'photoreal')
      return (
        state.photorealShown &&
        state.photorealTilesLoaded === true &&
        state.photorealReadyContentTiles > 0 &&
        state.photorealSelectedTiles > 0
      );
    return (
      state.globeShown &&
      state.globeTilesLoaded === true &&
      state.terrainProviderClass === 'CesiumTerrainProvider' &&
      state.imageryLayerShow === true &&
      state.imageryLayerCount > 0 &&
      state.imageryProviderClass === expectedImageryClass[stackId]
    );
  };

  const waitForReadyStack = async (stackId, phase = 'readiness') => {
    const historyStartedAt = performance.now();
    currentTerrainHistory = {
      phase,
      stackId,
      completedObservationCount: 0,
      recordedObservationCount: 0,
      samples: [],
      ancestryRows: [],
      omittedAncestryRowCount: 0,
      finalized: false,
      finalSequence: null,
      firstSample: null,
      recentTail: [],
      lastRecordedElapsedMs: null,
      latest: null,
    };
    const compactObservation = (state, sequence, postRenderAt) => {
      const queue = state?.globeQueueDiagnostics;
      const queueAvailable =
        typeof queue?.available === 'boolean' ? queue.available : null;
      const sampled =
        queueAvailable === true ? (queue.sampledTiles?.[0] ?? null) : null;
      const identity =
        sampled &&
        ['high', 'medium', 'low'].includes(sampled.queue) &&
        Number.isSafeInteger(sampled.x) &&
        sampled.x >= 0 &&
        Number.isSafeInteger(sampled.y) &&
        sampled.y >= 0 &&
        Number.isSafeInteger(sampled.level) &&
        sampled.level >= 0
          ? {
              queue: sampled.queue,
              x: sampled.x,
              y: sampled.y,
              level: sampled.level,
            }
          : null;
      const ancestry = queue?.terrainAncestry;
      const ancestryStatus =
        queueAvailable !== true
          ? 'queue-unavailable'
          : ancestry?.available === true
            ? 'available'
            : ['no-queued-sample', 'sample-identity-unavailable'].includes(
                  ancestry?.unavailableReason,
                )
              ? ancestry.unavailableReason
              : 'not-observed';
      const ancestryRows =
        ancestryStatus === 'available' && Array.isArray(ancestry.rows)
          ? ancestry.rows.slice(0, 24).map((row) => ({ ...row }))
          : [];
      const observedElapsedMs = Math.max(0, postRenderAt - historyStartedAt);
      return {
        sequence,
        observedElapsedMs,
        routeElapsedMs:
          routeStartedAt === null
            ? 0
            : Math.max(0, postRenderAt - routeStartedAt),
        stackId,
        queueAvailable,
        queueHigh: queueAvailable === true ? queue.queueCounts.high : null,
        queueMedium: queueAvailable === true ? queue.queueCounts.medium : null,
        queueLow: queueAvailable === true ? queue.queueCounts.low : null,
        queueTotal: queueAvailable === true ? queue.queueCounts.total : null,
        identityAvailable: identity !== null,
        identityQueue: identity?.queue ?? null,
        identityX: identity?.x ?? null,
        identityY: identity?.y ?? null,
        identityLevel: identity?.level ?? null,
        ancestryStatus:
          ancestryStatus === 'available' && ancestryRows.length === 0
            ? 'not-observed'
            : ancestryStatus,
        ancestryRowCount:
          ancestryStatus === 'available' ? ancestryRows.length : 0,
        ancestryTruncated:
          ancestryStatus === 'available' ? ancestry.truncated === true : false,
        ancestryCycleDetected:
          ancestryStatus === 'available'
            ? ancestry.cycleDetected === true
            : false,
        ancestryUnsupportedFields:
          ancestryStatus === 'available' &&
          Array.isArray(ancestry.unsupportedFields)
            ? ancestry.unsupportedFields.slice(0, 12).join(',')
            : '',
        ancestryRows: ancestryRows.map((row, rowIndex) => ({
          rowIndex,
          x: row.x,
          y: row.y,
          level: row.level,
          tileState: row.tileState,
          parentPresent: row.parentPresent,
          dataPresent: row.dataPresent,
          terrainState: row.terrainState,
          dataMeshPresent: row.dataMeshPresent,
          terrainDataPresent: row.terrainDataPresent,
          terrainMeshPresent: row.terrainMeshPresent,
          canUpsample: row.canUpsample,
        })),
        final: false,
      };
    };
    const appendHistorySample = (sample) => {
      const sourceRows = sample.ancestryRows;
      delete sample.ancestryRows;
      sample.final = false;
      currentTerrainHistory.recordedObservationCount += 1;
      currentTerrainHistory.ancestryRows.push(
        ...sourceRows.map((row, rowIndex) => ({
          sampleSequence: sample.sequence,
          rowIndex,
          x: row.x,
          y: row.y,
          level: row.level,
          tileState: row.tileState,
          parentPresent: row.parentPresent,
          dataPresent: row.dataPresent,
          terrainState: row.terrainState,
          dataMeshPresent: row.dataMeshPresent,
          terrainDataPresent: row.terrainDataPresent,
          terrainMeshPresent: row.terrainMeshPresent,
          canUpsample: row.canUpsample,
        })),
      );
      currentTerrainHistory.omittedAncestryRowCount += Math.max(
        0,
        sourceRows.length - 24,
      );
      if (currentTerrainHistory.firstSample === null)
        currentTerrainHistory.firstSample = sample;
      else {
        currentTerrainHistory.recentTail.push(sample);
        if (currentTerrainHistory.recentTail.length > 7) {
          const removed = currentTerrainHistory.recentTail.shift();
          currentTerrainHistory.omittedAncestryRowCount +=
            removed.ancestryRowCount;
          currentTerrainHistory.ancestryRows =
            currentTerrainHistory.ancestryRows.filter(
              (row) => row.sampleSequence !== removed.sequence,
            );
        }
      }
      currentTerrainHistory.lastRecordedElapsedMs = sample.observedElapsedMs;
      currentTerrainHistory.samples = [
        currentTerrainHistory.firstSample,
        ...currentTerrainHistory.recentTail,
      ];
      currentTerrainHistory.samples.forEach((retained, index) => {
        const previous =
          index === 0 ? null : currentTerrainHistory.samples[index - 1];
        retained.identityStatus = !previous
          ? retained.identityAvailable
            ? 'first'
            : 'unavailable'
          : !previous.identityAvailable || !retained.identityAvailable
            ? 'unavailable'
            : previous.identityQueue === retained.identityQueue &&
                previous.identityX === retained.identityX &&
                previous.identityY === retained.identityY &&
                previous.identityLevel === retained.identityLevel
              ? 'same'
              : 'changed';
      });
    };
    const observeCompletedRender = (state, postRenderAt) => {
      const history = currentTerrainHistory;
      history.completedObservationCount += 1;
      const sequence = history.completedObservationCount;
      history.latest = compactObservation(state, sequence, postRenderAt);
      if (
        history.firstSample === null ||
        history.latest.observedElapsedMs - history.lastRecordedElapsedMs >=
          2_000
      )
        appendHistorySample({ ...history.latest });
    };
    const finalizeHistory = (lastState) => {
      if (lastState && currentTerrainHistory.latest) {
        const latest = currentTerrainHistory.latest;
        if (
          !currentTerrainHistory.samples.some(
            (sample) => sample.sequence === latest.sequence,
          )
        )
          appendHistorySample({ ...latest });
      }
      currentTerrainHistory.samples = [
        ...(currentTerrainHistory.firstSample
          ? [currentTerrainHistory.firstSample]
          : []),
        ...currentTerrainHistory.recentTail,
      ];
      for (const sample of currentTerrainHistory.samples) sample.final = false;
      const finalSample = currentTerrainHistory.samples.at(-1);
      if (finalSample) {
        finalSample.final = true;
        currentTerrainHistory.finalSequence = finalSample.sequence;
      }
      const retained = new Set(
        currentTerrainHistory.samples.map((sample) => sample.sequence),
      );
      currentTerrainHistory.ancestryRows =
        currentTerrainHistory.ancestryRows.filter((row) =>
          retained.has(row.sampleSequence),
        );
      currentTerrainHistory.samples.forEach((sample, index) => {
        const previous =
          index === 0 ? null : currentTerrainHistory.samples[index - 1];
        sample.identityStatus = !previous
          ? sample.identityAvailable
            ? 'first'
            : 'unavailable'
          : !previous.identityAvailable || !sample.identityAvailable
            ? 'unavailable'
            : previous.identityQueue === sample.identityQueue &&
                previous.identityX === sample.identityX &&
                previous.identityY === sample.identityY &&
                previous.identityLevel === sample.identityLevel
              ? 'same'
              : 'changed';
      });
      currentTerrainHistory.finalized = true;
    };
    updateProgress(phase, stackId);
    const deadline = performance.now() + readyTimeoutMs;
    let readyFrames = 0;
    let last = null;
    try {
      while (performance.now() < deadline) {
        const postRenderAt = await waitForPostRender(
          Math.max(1, deadline - performance.now()),
          journeyAbort.signal,
        );
        last = captureState(postRenderAt);
        observeCompletedRender(last, postRenderAt);
        updateProgress(phase, stackId, last);
        if (isReady(last, stackId)) readyFrames += 1;
        else readyFrames = 0;
        if (readyFrames >= 2) return last;
      }
      throw new Error(
        `Map stack ${stackId} lacked two completed ready renders: ${JSON.stringify(last)}`,
      );
    } finally {
      finalizeHistory(last);
      updateProgress(phase, stackId, last);
    }
  };

  const initialStack = controller.getActiveId();
  if (initialStack !== 'photoreal')
    throw new Error(
      `Native Google startup stack is ${initialStack}, expected photoreal.`,
    );
  const settingsBefore = projectSnapshotSettings();
  const ellipsoid = globe.ellipsoid;
  const radians = Math.PI / 180;
  const startDestination = ellipsoid.cartographicToCartesian({
    longitude: route.start.longitude * radians,
    latitude: route.start.latitude * radians,
    height: route.start.heightM,
  });
  camera.setView({
    destination: startDestination,
    orientation: {
      heading: route.headingRadians,
      pitch: route.pitchRadians,
      roll: 0,
    },
  });
  scene.requestRender?.();

  updateProgress('initial-readiness', 'photoreal');
  const initialState = await waitForReadyStack(
    'photoreal',
    'initial-readiness',
  );
  initialReadinessComplete = true;
  const transitions = [
    {
      stackId: 'photoreal',
      scheduledAtMs: 0,
      actualStartMs: 0,
      settledAtMs: 0,
      state: initialState,
    },
  ];
  routeStartedAt = performance.now();
  updateProgress('route');
  const routeOrigin = {
    position: {
      x: camera.positionWC.x,
      y: camera.positionWC.y,
      z: camera.positionWC.z,
    },
    right: { x: camera.rightWC.x, y: camera.rightWC.y, z: camera.rightWC.z },
    direction: {
      x: camera.directionWC.x,
      y: camera.directionWC.y,
      z: camera.directionWC.z,
    },
    up: { x: camera.upWC.x, y: camera.upWC.y, z: camera.upWC.z },
  };
  let coverageSamples = 0;
  let coverageError = null;
  const coverage = {
    west: Infinity,
    south: Infinity,
    east: -Infinity,
    north: -Infinity,
  };
  const includeView = () => {
    const view = viewRectangleDegrees();
    coverage.west = Math.min(coverage.west, view.west);
    coverage.south = Math.min(coverage.south, view.south);
    coverage.east = Math.max(coverage.east, view.east);
    coverage.north = Math.max(coverage.north, view.north);
    coverageSamples += 1;
  };
  includeView();
  const routeCoverageListener = () => {
    if (journeyAbort.signal.aborted) return;
    try {
      includeView();
    } catch (error) {
      coverageError = error;
    }
  };
  const removeCoverageListener = scene.postRender.addEventListener(
    routeCoverageListener,
  );
  let animationFrame = null;
  const routeTask = new Promise((resolve, reject) => {
    const onAbort = () => {
      if (animationFrame !== null) cancelAnimationFrame(animationFrame);
      animationFrame = null;
      finish(cancellationError('Map route was cancelled.'));
    };
    journeyAbort.signal.addEventListener('abort', onAbort, { once: true });
    const finish = (error) => {
      journeyAbort.signal.removeEventListener('abort', onAbort);
      if (error) reject(error);
      else resolve();
    };
    const applyAt = (elapsedMs) => {
      if (journeyAbort.signal.aborted) return;
      const distance =
        (Math.min(elapsedMs, durationMs) * route.moveRightMetersPerSecond) /
        1000;
      const destination = {
        x: routeOrigin.position.x + routeOrigin.right.x * distance,
        y: routeOrigin.position.y + routeOrigin.right.y * distance,
        z: routeOrigin.position.z + routeOrigin.right.z * distance,
      };
      camera.setView({
        destination,
        orientation: { direction: routeOrigin.direction, up: routeOrigin.up },
      });
      scene.requestRender?.();
    };
    const tick = (now) => {
      if (journeyAbort.signal.aborted) return;
      animationFrame = null;
      if (coverageError) {
        finish(coverageError);
        return;
      }
      const elapsed = Math.min(durationMs, Math.max(0, now - routeStartedAt));
      try {
        applyAt(elapsed);
      } catch (error) {
        finish(error);
        return;
      }
      if (elapsed >= durationMs) {
        finish();
        return;
      }
      animationFrame = requestAnimationFrame(tick);
    };
    if (journeyAbort.signal.aborted) onAbort();
    else animationFrame = requestAnimationFrame(tick);
  });
  const transitionTask = (async () => {
    for (const schedule of route.stackSchedule.slice(1)) {
      if (journeyAbort.signal.aborted) return;
      updateProgress('transition', schedule.stackId);
      const delay = routeStartedAt + schedule.atMs - performance.now();
      if (delay > 0)
        await new Promise((resolve, reject) => {
          let settled = false;
          let timer = null;
          const finishDelay = (error) => {
            if (settled) return;
            settled = true;
            if (timer !== null) clearTimeout(timer);
            journeyAbort.signal.removeEventListener('abort', onAbort);
            if (error) reject(error);
            else resolve();
          };
          const onAbort = () => {
            finishDelay(cancellationError('Map journey was cancelled.'));
          };
          journeyAbort.signal.addEventListener('abort', onAbort, {
            once: true,
          });
          if (journeyAbort.signal.aborted) onAbort();
          else timer = setTimeout(() => finishDelay(), delay);
        });
      if (journeyAbort.signal.aborted) return;
      const actualStartMs = performance.now() - routeStartedAt;
      const switchState = await new Promise((resolve, reject) => {
        let settled = false;
        const timer = setTimeout(
          () =>
            finish(
              new Error(
                `Map stack switch to ${schedule.stackId} exceeded its readiness bound.`,
              ),
            ),
          readyTimeoutMs,
        );
        const onAbort = () =>
          finish(cancellationError('Map journey was cancelled.'));
        const finish = (error, value) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          journeyAbort.signal.removeEventListener('abort', onAbort);
          if (error) reject(error);
          else resolve(value);
        };
        journeyAbort.signal.addEventListener('abort', onAbort, { once: true });
        Promise.resolve(controller.setStack(schedule.stackId)).then(
          (value) => finish(null, value),
          (error) => finish(error),
        );
      });
      if (
        switchState?.activeId !== schedule.stackId ||
        switchState?.lastError ||
        switchState?.switchOrigin === 'automatic'
      )
        throw new Error(
          `Native map stack switch to ${schedule.stackId} failed or fell back.`,
        );
      const state = await waitForReadyStack(
        schedule.stackId,
        'transition-readiness',
      );
      transitions.push({
        stackId: schedule.stackId,
        scheduledAtMs: schedule.atMs,
        actualStartMs,
        settledAtMs: performance.now() - routeStartedAt,
        state,
      });
      transitionsCompleted = transitions.length - 1;
      updateProgress('route', schedule.stackId, state);
    }
  })();
  try {
    const tasks = [routeTask, transitionTask];
    try {
      await Promise.all(tasks);
    } catch (primaryError) {
      journeyAbort.abort();
      const settled = await Promise.allSettled(tasks);
      const cleanupErrors = settled
        .filter((entry) => entry.status === 'rejected')
        .map((entry) => entry.reason)
        .filter(
          (error) =>
            error !== primaryError &&
            error?.code !== 'GEV_MAP_JOURNEY_CANCELLED',
        );
      if (cleanupErrors.length)
        throw new AggregateError(
          [primaryError, ...cleanupErrors],
          'Map route or transition failed and sibling cancellation also failed.',
          { cause: primaryError },
        );
      throw primaryError;
    }
    {
      const distance = (durationMs * route.moveRightMetersPerSecond) / 1000;
      camera.setView({
        destination: {
          x: routeOrigin.position.x + routeOrigin.right.x * distance,
          y: routeOrigin.position.y + routeOrigin.right.y * distance,
          z: routeOrigin.position.z + routeOrigin.right.z * distance,
        },
        orientation: { direction: routeOrigin.direction, up: routeOrigin.up },
      });
      scene.requestRender?.();
    }
    updateProgress('final-readiness', 'photoreal');
    const finalState = await waitForReadyStack('photoreal', 'final-readiness');
    includeView();
    const terrainSamples = transitions
      .filter((entry) => entry.stackId !== 'photoreal')
      .flatMap((entry) => entry.state.terrainSamples);
    const knownTerrainHeights = terrainSamples
      .map((sample) => sample.heightM)
      .filter((height) => Number.isFinite(height));
    const terrainEvidence = {
      providerClass:
        transitions.find((entry) => entry.stackId === 'esri-imagery')?.state
          .terrainProviderClass ?? null,
      sampleCount: knownTerrainHeights.length,
      minHeightM: knownTerrainHeights.length
        ? Math.min(...knownTerrainHeights)
        : null,
      maxHeightM: knownTerrainHeights.length
        ? Math.max(...knownTerrainHeights)
        : null,
    };
    const routeElapsedMs = performance.now() - routeStartedAt;
    return {
      initialStack,
      initialState,
      transitions,
      route: {
        id: route.id,
        durationMs,
        elapsedMs: routeElapsedMs,
        moveRightMetersPerSecond: route.moveRightMetersPerSecond,
        headingRadians: route.headingRadians,
        pitchRadians: route.pitchRadians,
        start: initialState.camera,
        end: finalState.camera,
        declaredBounds: route.declaredBounds,
        observedFrustumUnion: { ...coverage },
        observedFrustumSamples: coverageSamples,
        finalPostRenderObserved: true,
      },
      finalState,
      settingsBefore,
      settingsAfter: projectSnapshotSettings(),
      terrainEvidence,
    };
  } finally {
    journeyAbort.abort();
    if (animationFrame !== null) cancelAnimationFrame(animationFrame);
    try {
      removeCoverageListener?.();
    } catch {
      // The page's owning context is the fallback retirement boundary.
    }
  }
}

export async function runNativeMapStreamingJourney(page, options) {
  assert.ok(page && typeof page.evaluate === 'function');
  assert.ok(options && typeof options === 'object');
  const { hostDeadlineMs = MAP_JOURNEY_HOST_DEADLINE_MS, ...journeyOptions } =
    options;
  assert.ok(
    Number.isSafeInteger(hostDeadlineMs) &&
      hostDeadlineMs > 0 &&
      hostDeadlineMs <= MAP_JOURNEY_HOST_DEADLINE_MS,
    'Map journey host deadline must be a positive value within its fixed cap.',
  );
  const operationId = `map-${Date.now().toString(36)}-${(++nextMapJourneyOperationId).toString(
    36,
  )}`;
  const startedAt = performance.now();
  const deadline = startedAt + hostDeadlineMs;
  const evaluate = (command) =>
    page.evaluate(runNativeMapStreamingJourneyInPage, {
      ...journeyOptions,
      command,
      operationId,
    });
  let startAttempted = false;
  let terminal = false;
  let result = null;
  let primaryError = null;
  let failureCode = null;
  let lastCheckpoint = null;
  const retirement = {
    cancelStatus: 'not-attempted',
    drainStatus: 'not-needed',
    drainWaitMs: 0,
    terminalStatus: 'unknown',
    disposeStatus: 'not-attempted',
    cancelErrorKind: null,
    disposeErrorKind: null,
  };
  const deadlineError = () => {
    const error = new Error(
      'Native map journey exceeded its monotonic host deadline.',
    );
    error.actual = lastCheckpoint;
    error.expected = { maxElapsedMs: hostDeadlineMs };
    return error;
  };
  try {
    startAttempted = true;
    const start = await evaluate('start');
    if (start?.operationId !== operationId || start.status !== 'running')
      throw new Error('Native map journey operation did not start.');
    if (performance.now() >= deadline) throw deadlineError();
    for (
      let pollCount = 0;
      pollCount < MAP_JOURNEY_MAX_POLL_COUNT;
      pollCount += 1
    ) {
      if (performance.now() >= deadline) throw deadlineError();
      const state = await evaluate('poll');
      if (performance.now() >= deadline) {
        lastCheckpoint = state?.checkpoint || lastCheckpoint;
        throw deadlineError();
      }
      if (state?.operationId !== operationId)
        throw new Error('Native map journey poll identity changed.');
      lastCheckpoint = state.checkpoint || lastCheckpoint;
      if (state.status === 'completed') {
        terminal = true;
        retirement.terminalStatus = 'completed';
        result = state.result;
        break;
      }
      if (state.status === 'failed') {
        terminal = true;
        retirement.terminalStatus = 'failed';
        failureCode = 'page-operation-failed';
        const error = new Error(
          `Native map journey failed during ${state.checkpoint?.phase || 'unknown phase'}: ${state.failure?.message || 'page operation failed.'}`,
        );
        error.actual = state.checkpoint || null;
        error.expected = {
          operationId,
          status: 'completed',
        };
        throw error;
      }
      if (state.status !== 'running')
        throw new Error(`Native map journey operation became ${state.status}.`);
      const remainingMs = Math.max(0, deadline - performance.now());
      if (remainingMs === 0) throw deadlineError();
      await new Promise((resolve) =>
        setTimeout(
          resolve,
          Math.min(MAP_JOURNEY_POLL_INTERVAL_MS, remainingMs),
        ),
      );
    }
    if (!terminal) {
      const error = new Error(
        'Native map journey exceeded its bounded host poll-count limit.',
      );
      error.actual = lastCheckpoint;
      error.expected = {
        operationId,
        maxPollCount: MAP_JOURNEY_MAX_POLL_COUNT,
        pollIntervalMs: MAP_JOURNEY_POLL_INTERVAL_MS,
      };
      failureCode = 'poll-count-limit';
      throw error;
    }
  } catch (error) {
    primaryError = error;
    failureCode ||=
      error?.message ===
      'Native map journey exceeded its monotonic host deadline.'
        ? 'host-deadline'
        : error?.message === 'Native map journey operation did not start.'
          ? 'operation-start-failed'
          : error?.message?.startsWith(
                'Native map journey operation became ',
              ) ||
              error?.message === 'Native map journey poll identity changed.'
            ? 'unexpected-operation-state'
            : 'protocol-call-failed';
    if (startAttempted && !terminal) {
      try {
        let cancelled = await evaluate('cancel');
        if (cancelled?.operationId !== operationId)
          throw new Error('Map journey cancellation identity changed.');
        lastCheckpoint = cancelled?.checkpoint || lastCheckpoint;
        retirement.cancelStatus =
          cancelled.status === 'missing' ? 'missing' : 'acknowledged';
        retirement.drainStatus = cancelled?.drainStatus || 'not-needed';
        retirement.drainWaitMs = Number.isSafeInteger(cancelled?.drainWaitMs)
          ? cancelled.drainWaitMs
          : 0;
        retirement.terminalStatus = [
          'running',
          'completed',
          'failed',
          'missing',
        ].includes(cancelled?.status)
          ? cancelled.status
          : 'unknown';
        if (
          cancelled?.status &&
          cancelled.status !== 'running' &&
          cancelled.status !== 'missing'
        )
          terminal = true;
        else if (cancelled?.status === 'missing') terminal = false;
      } catch (cancelError) {
        retirement.cancelStatus = 'failed';
        retirement.drainStatus = 'failed';
        retirement.terminalStatus = 'unknown';
        if (primaryError && typeof primaryError === 'object')
          retirement.cancelErrorKind =
            cancelError?.name === 'TimeoutError'
              ? 'protocol-timeout'
              : 'evaluation-failed';
      }
      if (!primaryError.actual && lastCheckpoint)
        primaryError.actual = lastCheckpoint;
    }
  }
  if (startAttempted && terminal) {
    try {
      const disposed = await evaluate('dispose');
      if (
        disposed?.operationId !== operationId ||
        disposed?.status !== 'disposed'
      )
        throw new Error(
          'Native map journey operation disposal identity or status was not confirmed.',
        );
      retirement.disposeStatus = 'confirmed';
    } catch (error) {
      retirement.disposeStatus = 'failed';
      if (primaryError && typeof primaryError === 'object')
        retirement.disposeErrorKind =
          error?.name === 'TimeoutError'
            ? 'protocol-timeout'
            : 'evaluation-failed';
      else {
        primaryError = error;
        failureCode = 'operation-disposal-failed';
      }
    }
  }
  if (primaryError) {
    if (retirement.terminalStatus === 'unknown' && terminal)
      retirement.terminalStatus = 'failed';
    const failureEvidence = {
      schema: 'gev-map-streaming-journey-failure/v1',
      operationId,
      failureCode: failureCode || 'protocol-call-failed',
      elapsedMs: Math.max(0, Math.round(performance.now() - startedAt)),
      checkpoint: lastCheckpoint,
      expected: primaryError?.expected || null,
      retirement,
    };
    try {
      primaryError.mapStreamingJourneyFailure =
        projectMapStreamingJourneyFailureEvidence(failureEvidence);
    } catch {
      primaryError.mapStreamingJourneyFailure = {
        schema: 'gev-map-streaming-journey-failure/v1',
        operationId,
        failureCode: failureCode || 'protocol-call-failed',
        elapsedMs: Math.max(0, Math.round(performance.now() - startedAt)),
        checkpoint: null,
        expected: null,
        retirement: {
          cancelStatus: retirement.cancelStatus,
          drainStatus: retirement.drainStatus,
          drainWaitMs: retirement.drainWaitMs,
          terminalStatus: retirement.terminalStatus,
          disposeStatus: retirement.disposeStatus,
          cancelErrorKind: retirement.cancelErrorKind,
          disposeErrorKind: retirement.disposeErrorKind,
        },
      };
    }
  }
  if (primaryError) throw primaryError;
  return result;
}

export function createMapStreamingCaptureReport({
  fixture,
  fixtureDelivery,
  journey,
  profile,
  documentDeliveries,
}) {
  validateDeterministicMapStreamingFixture(fixture);
  const report = {
    schema: MAP_STREAMING_CAPTURE_SCHEMA,
    workloadId: MAP_STREAMING_WORKLOAD_ID,
    status: 'observed',
    performanceAcceptanceEligible: false,
    fixtureId: fixture.id,
    manifestSha256: fixture.manifestSha256,
    buildProfile: profile,
    route: journey.route,
    initialState: journey.initialState,
    transitions: journey.transitions,
    finalState: journey.finalState,
    settingsBefore: journey.settingsBefore,
    settingsAfter: journey.settingsAfter,
    terrainEvidence: journey.terrainEvidence,
    fixtureDelivery,
    documentDeliveries,
    scope: 'full application map-stack diagnostic; no performance acceptance',
  };
  validateMapStreamingCaptureReport(report, { fixture, profile });
  return report;
}

/** Build the final, post-cleanup map evidence consumed by both CLI and smoke reports. */
export function createFinalizedMapStreamingCaptureEvidence({
  fixture,
  journey,
  profile,
  documentDeliveries,
}) {
  const fixtureDelivery = aggregateMapStreamingDocumentDeliveries(
    fixture,
    documentDeliveries,
  );
  const mapStreamingCapture = createMapStreamingCaptureReport({
    fixture,
    fixtureDelivery,
    journey,
    profile,
    documentDeliveries,
  });
  return {
    fixtureDelivery,
    mapStreamingCapture,
    mapStreamingFixtureDocuments: documentDeliveries,
    performanceAcceptanceEligible: false,
  };
}

export function mapStreamingCaptureWorkloadFields(evidence) {
  assert.ok(evidence && typeof evidence === 'object');
  return {
    mapStreamingCapture: evidence.mapStreamingCapture,
    mapStreamingFixtureDocuments: evidence.mapStreamingFixtureDocuments,
    performanceAcceptanceEligible: false,
  };
}

/** Validate the single-owner delivery summary emitted by the smoke adapter. */
export function validateMapStreamingSmokeDeliverySummary(summary, fixture) {
  validateDeterministicMapStreamingFixture(fixture);
  assert.equal(summary?.schema, MAP_STREAMING_DELIVERY_SCHEMA);
  assert.equal(summary.fixtureId, fixture.id);
  assert.equal(summary.manifestSha256, fixture.manifestSha256);
  assert.equal(summary.status, 'disposed');
  assert.equal(summary.cleanupConfirmed, true);
  assert.equal(summary.pendingCount, 0);
  assert.equal(summary.unexpectedFulfillmentCount, 0);
  assert.equal(summary.errorObservationCount, 0);
  assert.equal(summary.omittedErrorObservationCount, 0);
  assert.equal(summary.omittedErrorKindCount, 0);
  assert.ok(Number.isSafeInteger(summary.requestedCount));
  assert.ok(summary.requestedCount > 0);
  assert.ok(Number.isSafeInteger(summary.fulfilledAckCount));
  assert.ok(summary.fulfilledAckCount >= 0);
  assert.ok(Number.isSafeInteger(summary.cancelledCount));
  assert.ok(summary.cancelledCount >= 0);
  assert.equal(
    summary.fulfilledAckCount + summary.cancelledCount,
    summary.requestedCount,
  );
  assert.ok(Array.isArray(summary.assets));
  const expectedAssets = new Map(
    fixture.manifest.assets.map((asset) => [asset.path, asset]),
  );
  const observedPaths = new Set();
  const observedKinds = new Set();
  let acknowledgedCount = 0;
  let cancelledCount = 0;
  for (const row of summary.assets) {
    const expected = expectedAssets.get(row.path);
    assert.ok(expected, `Smoke-delivered map asset ${row.path} is declared.`);
    assert.equal(observedPaths.has(row.path), false);
    observedPaths.add(row.path);
    assert.equal(row.sha256, expected.sha256);
    assert.equal(row.byteLength, expected.byteLength);
    assert.ok(Number.isSafeInteger(row.requests) && row.requests > 0);
    assert.ok(Number.isSafeInteger(row.fulfilledAckCount));
    assert.ok(row.fulfilledAckCount >= 0);
    assert.ok(Number.isSafeInteger(row.cancelledCount));
    assert.ok(row.cancelledCount >= 0);
    assert.equal(row.fulfilledAckCount + row.cancelledCount, row.requests);
    acknowledgedCount += row.fulfilledAckCount;
    cancelledCount += row.cancelledCount;
    if (row.fulfilledAckCount > 0) observedKinds.add(expected.kind);
  }
  assert.equal(acknowledgedCount, summary.fulfilledAckCount);
  assert.equal(cancelledCount, summary.cancelledCount);
  for (const kind of [
    '3d-tiles-1.1',
    'textured-glb',
    'synthetic-google-credit-placeholder-png',
    'arcgis-mapserver-metadata-json',
    'arcgis-missing-tile-probe-png',
    'webmercator-imagery-png',
    'quantized-mesh-layer-metadata',
    'quantized-mesh-1.0',
  ])
    assert.ok(
      observedKinds.has(kind),
      `Smoke delivery acknowledged required map asset kind ${kind}.`,
    );
  assert.equal(summary.browserDecodeObserved, false);
  assert.equal(summary.renderedReadinessObserved, false);
  return true;
}

/** Aggregate only acknowledged native requests after every owner is retired. */
export function aggregateMapStreamingDocumentDeliveries(
  fixture,
  documentDeliveries,
) {
  const counts = new Map();
  let requestedCount = 0;
  let fulfilledAckCount = 0;
  let cancelledCount = 0;
  let pendingCount = 0;
  let unexpectedFulfillmentCount = 0;
  let errorObservationCount = 0;
  for (const row of documentDeliveries) {
    const delivery = row.delivery;
    requestedCount += delivery.requestedCount;
    fulfilledAckCount += delivery.fulfilledAckCount;
    cancelledCount += delivery.cancelledCount;
    pendingCount += delivery.pendingCount;
    unexpectedFulfillmentCount += delivery.unexpectedFulfillmentCount;
    errorObservationCount += delivery.errorObservationCount;
    for (const asset of delivery.assets) {
      let total = counts.get(asset.path);
      if (!total) {
        total = {
          path: asset.path,
          sha256: asset.sha256,
          byteLength: asset.byteLength,
          requests: 0,
          fulfilledAckCount: 0,
          cancelledCount: 0,
        };
        counts.set(asset.path, total);
      }
      total.requests += asset.requests;
      total.fulfilledAckCount += asset.fulfilledAckCount;
      total.cancelledCount += asset.cancelledCount;
    }
  }
  const report = {
    schema: MAP_STREAMING_DELIVERY_SCHEMA,
    fixtureId: fixture.id,
    manifestSha256: fixture.manifestSha256,
    status: 'observed',
    requestedCount,
    fulfilledAckCount,
    cancelledCount,
    pendingCount,
    unexpectedFulfillmentCount,
    errorObservationCount,
    assets: [...counts.values()].sort((left, right) =>
      left.path.localeCompare(right.path),
    ),
    cleanupConfirmed: documentDeliveries.every(
      (row) =>
        row.delivery.cleanupConfirmed === true &&
        row.release?.confirmed === true,
    ),
    browserDecodeObserved: false,
    renderedReadinessObserved: false,
  };
  validateAggregatedMapDelivery(report, fixture, documentDeliveries);
  return report;
}

function validateAggregatedMapDelivery(report, fixture, documents) {
  const expectedAssets = new Map(
    fixture.manifest.assets.map((asset) => [asset.path, asset]),
  );
  assert.equal(report?.schema, MAP_STREAMING_DELIVERY_SCHEMA);
  assert.equal(report.fixtureId, fixture.id);
  assert.equal(report.manifestSha256, fixture.manifestSha256);
  assert.equal(report.status, 'observed');
  assert.equal(
    report.cleanupConfirmed,
    true,
    'Aggregate map delivery requires confirmed cleanup for all owner documents.',
  );
  assert.equal(report.pendingCount, 0);
  assert.equal(report.unexpectedFulfillmentCount, 0);
  assert.equal(report.errorObservationCount, 0);
  assert.ok(Number.isSafeInteger(report.requestedCount));
  assert.ok(report.requestedCount > 0);
  assert.equal(
    report.fulfilledAckCount + report.cancelledCount,
    report.requestedCount,
  );
  const seen = new Set();
  for (const asset of report.assets) {
    const expected = expectedAssets.get(asset.path);
    assert.ok(
      expected,
      `Aggregate asset ${asset.path} belongs to the manifest.`,
    );
    assert.equal(
      seen.has(asset.path),
      false,
      `Aggregate asset ${asset.path} is unique.`,
    );
    seen.add(asset.path);
    assert.equal(asset.sha256, expected.sha256);
    assert.equal(asset.byteLength, expected.byteLength);
    assert.ok(asset.requests >= 1);
    assert.equal(
      asset.requests,
      asset.fulfilledAckCount + asset.cancelledCount,
    );
  }
  const requiredKinds = [
    '3d-tiles-1.1',
    'textured-glb',
    'synthetic-google-credit-placeholder-png',
    'arcgis-mapserver-metadata-json',
    'arcgis-missing-tile-probe-png',
    'webmercator-imagery-png',
    'quantized-mesh-layer-metadata',
    'quantized-mesh-1.0',
  ];
  for (const kind of requiredKinds) {
    const delivered = report.assets.some((asset) => {
      const expected = expectedAssets.get(asset.path);
      return expected?.kind === kind && asset.fulfilledAckCount > 0;
    });
    assert.equal(
      delivered,
      true,
      `Native map asset kind ${kind} was acknowledged.`,
    );
  }
  for (const document of documents) {
    assert.equal(document.delivery.fixtureId, fixture.id);
    assert.equal(document.delivery.manifestSha256, fixture.manifestSha256);
    assert.equal(document.delivery.status, 'disposed');
    assert.equal(document.delivery.cleanupConfirmed, true);
    assert.equal(document.delivery.pendingCount, 0);
    assert.equal(document.delivery.errorObservationCount, 0);
    assert.equal(document.release.documentRole, document.documentRole);
    assert.equal(document.release.documentId, document.documentId);
    assert.equal(document.release.sessionOrdinal, document.sessionOrdinal);
    assert.equal(
      document.release.confirmed,
      true,
      `Map document ${document.documentId} release is confirmed.`,
    );
    assert.equal(
      document.release.targetClosed,
      true,
      `Map document ${document.documentId} target is closed.`,
    );
    assert.equal(
      document.release.stop?.confirmed,
      true,
      `Map document ${document.documentId} fixture stop is confirmed.`,
    );
    assert.equal(
      document.release.stop?.pendingCommandsAfterDrain,
      0,
      `Map document ${document.documentId} fixture commands drained.`,
    );
    assert.equal(
      document.release.stop?.pendingPreparationsAfterDrain,
      0,
      `Map document ${document.documentId} fixture preparations drained.`,
    );
    assert.equal(
      document.release.stop?.pendingAbortSubscriptionsAfterDrain,
      0,
      `Map document ${document.documentId} abort subscriptions drained.`,
    );
    assert.equal(
      document.release.stop?.unexpectedLateRequestCount,
      0,
      `Map document ${document.documentId} had no late fixture request.`,
    );
    assert.equal(
      document.release.interception?.confirmed,
      true,
      `Map document ${document.documentId} interception is released.`,
    );
  }
}

export function validateMapStreamingJourneyEvidence(journey, fixture) {
  validateDeterministicMapStreamingFixture(fixture);
  const report = journey;
  assert.equal(report.initialState?.activeStack, 'photoreal');
  assert.equal(report.initialState?.photorealShown, true);
  assert.equal(report.initialState?.photorealTilesLoaded, true);
  assert.ok(report.initialState?.photorealReadyContentTiles > 0);
  assert.ok(report.initialState?.photorealSelectedTiles > 0);
  const assertSettings = (settings, label) => {
    assert.ok(
      settings && typeof settings === 'object',
      `${label} settings exist.`,
    );
    assert.ok(
      ['manual', 'auto', 'quality', 'performance'].includes(
        settings.qualityMode,
      ),
      `${label} quality mode is recognized.`,
    );
    assert.ok(
      Number.isFinite(settings.densityPct) &&
        settings.densityPct >= 0 &&
        settings.densityPct <= 100,
      `${label} density is bounded.`,
    );
    assert.ok(
      typeof settings.detectionMode === 'string' &&
        settings.detectionMode.length > 0,
      `${label} detection mode is observed.`,
    );
    assert.ok(
      Number.isFinite(settings.resolutionScale) && settings.resolutionScale > 0,
      `${label} resolution scale is observed.`,
    );
    assert.equal(
      typeof settings.antialias,
      'boolean',
      `${label} antialias state is observed.`,
    );
    assert.ok(
      Number.isSafeInteger(settings.msaaSamples) && settings.msaaSamples >= 0,
      `${label} MSAA setting is observed.`,
    );
    assert.equal(
      typeof settings.fxaa,
      'boolean',
      `${label} FXAA state is observed.`,
    );
    assert.equal(
      typeof settings.preserveDrawingBuffer,
      'boolean',
      `${label} drawing-buffer state is observed.`,
    );
    assert.equal(
      typeof settings.bloom,
      'boolean',
      `${label} bloom state is observed.`,
    );
    assert.ok(
      Number.isFinite(settings.bloomIntensity),
      `${label} bloom intensity is observed.`,
    );
    assert.equal(
      typeof settings.sharpen,
      'boolean',
      `${label} sharpen state is observed.`,
    );
    assert.ok(
      Number.isFinite(settings.sharpenIntensity),
      `${label} sharpen intensity is observed.`,
    );
    assert.ok(
      Number.isFinite(settings.globeMaximumScreenSpaceError) &&
        settings.globeMaximumScreenSpaceError > 0,
      `${label} terrain detail is observed.`,
    );
    assert.ok(
      Number.isFinite(settings.tilesetMaximumScreenSpaceError) &&
        settings.tilesetMaximumScreenSpaceError > 0,
      `${label} photoreal detail is observed.`,
    );
    assert.ok(
      Number.isFinite(settings.tilesetCacheBytes) &&
        settings.tilesetCacheBytes >= 0,
      `${label} photoreal cache byte setting is observed.`,
    );
    assert.ok(
      Number.isFinite(settings.tilesetMaximumCacheOverflowBytes) &&
        settings.tilesetMaximumCacheOverflowBytes >= 0,
      `${label} photoreal cache overflow setting is observed.`,
    );
    const visual = settings.visualState;
    assert.ok(
      visual && typeof visual === 'object',
      `${label} expanded visual state exists.`,
    );
    assert.ok(
      typeof visual.style === 'string' && visual.style.length > 0,
      `${label} style is observed.`,
    );
    assert.equal(
      typeof visual.bloom?.enabled,
      'boolean',
      `${label} expanded bloom is observed.`,
    );
    assert.ok(
      Number.isFinite(visual.bloom?.intensity),
      `${label} expanded bloom intensity is observed.`,
    );
    assert.equal(
      typeof visual.sharpen?.enabled,
      'boolean',
      `${label} expanded sharpen is observed.`,
    );
    assert.ok(
      Number.isFinite(visual.sharpen?.intensity),
      `${label} expanded sharpen intensity is observed.`,
    );
    assert.equal(
      typeof visual.detection?.mode,
      'string',
      `${label} expanded detection mode is observed.`,
    );
    assert.ok(
      Number.isFinite(visual.detection?.density),
      `${label} expanded detection density is observed.`,
    );
    assert.equal(
      typeof visual.scope?.enabled,
      'boolean',
      `${label} scope state is observed.`,
    );
    assert.equal(
      typeof visual.mapStack,
      'string',
      `${label} map stack is observed.`,
    );
    assert.ok(
      visual.styleParams && typeof visual.styleParams === 'object',
      `${label} style parameters are observed.`,
    );
  };
  assertSettings(report.settingsBefore, 'Before route');
  assertSettings(report.settingsAfter, 'After route');
  const withoutMapStack = (settings) => {
    const projected = structuredClone(settings);
    projected.visualState.mapStack = null;
    return projected;
  };
  const assertUnchangedSettings = (settings, label) =>
    assert.deepEqual(
      withoutMapStack(settings),
      withoutMapStack(report.settingsBefore),
      `${label} preserves visual, density, rendering, terrain, and tileset settings.`,
    );
  assertUnchangedSettings(report.settingsAfter, 'Final route settings');
  assertUnchangedSettings(
    report.initialState?.settings,
    'Initial render settings',
  );
  assert.equal(
    report.initialState?.settings?.visualState?.mapStack,
    'photoreal',
    'Initial visual settings record the selected photoreal stack.',
  );
  assert.equal(
    report.transitions?.length,
    MAP_STREAMING_ROUTE.stackSchedule.length,
  );
  for (
    let index = 0;
    index < MAP_STREAMING_ROUTE.stackSchedule.length;
    index += 1
  ) {
    const expected = MAP_STREAMING_ROUTE.stackSchedule[index];
    const transition = report.transitions[index];
    assert.equal(transition?.stackId, expected.stackId);
    assert.equal(transition?.scheduledAtMs, expected.atMs);
    assert.equal(transition?.state?.activeStack, expected.stackId);
    assert.equal(transition?.state?.controllerStatus, 'ready');
    assert.equal(transition?.state?.lastError, null);
    assert.equal(transition?.state?.switchOrigin, 'manual');
    assert.equal(transition?.state?.stackAvailable, true);
    assertUnchangedSettings(
      transition?.state?.settings,
      `Transition ${expected.stackId} settings`,
    );
    assert.equal(
      transition?.state?.settings?.visualState?.mapStack,
      expected.stackId,
      `Transition ${expected.stackId} visual settings record the selected stack.`,
    );
    assert.ok(Number.isFinite(transition?.state?.postRenderElapsedMs));
    if (expected.stackId === 'photoreal') {
      assert.equal(transition.state.photorealShown, true);
      assert.ok(transition.state.photorealReadyContentTiles > 0);
      assert.ok(transition.state.photorealSelectedTiles > 0);
      assert.equal(transition.state.photorealTilesLoaded, true);
    } else {
      assert.equal(transition.state.globeShown, true);
      assert.equal(transition.state.globeTilesLoaded, true);
      assert.equal(
        transition.state.terrainProviderClass,
        'CesiumTerrainProvider',
      );
      assert.equal(transition.state.imageryLayerShow, true);
      assert.ok(transition.state.imageryLayerCount > 0);
      assert.equal(
        transition.state.imageryProviderClass,
        EXPECTED_IMAGERY_CLASS[expected.stackId],
      );
      assert.ok(
        transition.state.terrainSamples.some(
          (sample) => Number.isFinite(sample.heightM) && sample.heightM > 0,
        ),
      );
    }
  }
  assert.equal(report.finalState?.activeStack, 'photoreal');
  assertUnchangedSettings(report.finalState?.settings, 'Final rendered state');
  assert.equal(
    report.finalState?.settings?.visualState?.mapStack,
    'photoreal',
    'Final visual settings record the restored photoreal stack.',
  );
  assert.ok(report.finalState?.photorealSelectedTiles > 0);
  assert.equal(report.finalState?.photorealTilesLoaded, true);
  assert.equal(report.finalState?.lastError, null);
  assert.equal(report.route?.id, MAP_STREAMING_ROUTE.id);
  assert.equal(
    report.route?.moveRightMetersPerSecond,
    MAP_STREAMING_ROUTE.moveRightMetersPerSecond,
  );
  assert.equal(
    report.route?.headingRadians,
    MAP_STREAMING_ROUTE.headingRadians,
  );
  assert.equal(report.route?.pitchRadians, MAP_STREAMING_ROUTE.pitchRadians);
  assert.ok(report.route?.elapsedMs >= report.route?.durationMs);
  assert.ok(
    report.route?.durationMs > 0 &&
      report.route.durationMs <= MAP_STREAMING_ROUTE.durationLimitMs,
  );
  assert.ok(report.route?.finalPostRenderObserved === true);
  const routeStart = report.route?.start;
  const routeEnd = report.route?.end;
  const expectedSurfaceDistanceM =
    (report.route.durationMs * MAP_STREAMING_ROUTE.moveRightMetersPerSecond) /
    1000;
  assert.ok(routeStart && routeEnd, 'Observed route endpoints are present.');
  assert.ok(
    Math.abs(routeStart.longitude - MAP_STREAMING_ROUTE.start.longitude) <
      0.0001 &&
      Math.abs(routeStart.latitude - MAP_STREAMING_ROUTE.start.latitude) <
        0.0001 &&
      Math.abs(routeStart.heightM - MAP_STREAMING_ROUTE.start.heightM) < 1,
    'Observed route starts at the declared native camera pose.',
  );
  assert.deepEqual(
    routeStart,
    report.initialState.camera,
    'Route start is the actual initial camera observation.',
  );
  assert.deepEqual(
    routeEnd,
    report.finalState.camera,
    'Route end is the actual final camera observation.',
  );
  const angularDifference = (actual, expected) =>
    Math.abs(
      Math.atan2(Math.sin(actual - expected), Math.cos(actual - expected)),
    );
  assert.ok(
    angularDifference(
      routeStart.headingRadians,
      MAP_STREAMING_ROUTE.headingRadians,
    ) < 0.001 &&
      Math.abs(routeStart.pitchRadians - MAP_STREAMING_ROUTE.pitchRadians) <
        0.001,
    'Observed route starts with the declared native camera orientation.',
  );
  assert.ok(
    Math.abs(routeEnd.latitude - routeStart.latitude) < 0.0001 &&
      Math.abs(routeEnd.heightM - routeStart.heightM) <=
        Math.max(1, expectedSurfaceDistanceM * 0.001),
    'Observed route endpoint follows the declared eastward tangent-plane route.',
  );
  assert.ok(
    angularDifference(
      routeEnd.headingRadians,
      MAP_STREAMING_ROUTE.headingRadians,
    ) < 0.003 &&
      Math.abs(routeEnd.pitchRadians - MAP_STREAMING_ROUTE.pitchRadians) <
        0.003,
    'Observed route ends with the declared native camera orientation.',
  );
  assert.ok(
    routeEnd.longitude > routeStart.longitude,
    'Observed route moves east along the declared rightward camera path.',
  );
  const radians = Math.PI / 180;
  const latitudeMidpoint =
    ((routeStart.latitude + routeEnd.latitude) / 2) * radians;
  const longitudeDelta = (routeEnd.longitude - routeStart.longitude) * radians;
  const latitudeDelta = (routeEnd.latitude - routeStart.latitude) * radians;
  const routeSurfaceDistanceM =
    6_371_008.8 *
    2 *
    Math.asin(
      Math.sqrt(
        Math.sin(latitudeDelta / 2) ** 2 +
          Math.cos(latitudeMidpoint) ** 2 * Math.sin(longitudeDelta / 2) ** 2,
      ),
    );
  assert.ok(
    Math.abs(routeSurfaceDistanceM - expectedSurfaceDistanceM) <=
      Math.max(5, expectedSurfaceDistanceM * 0.01),
    `Observed route displacement ${routeSurfaceDistanceM}m matches declared ${expectedSurfaceDistanceM}m elapsed-time movement.`,
  );
  assert.ok(report.route?.observedFrustumSamples >= 2);
  assert.deepEqual(
    report.route?.declaredBounds,
    fixture.manifest.routeBoundsDegrees,
  );
  const bounds = report.route?.declaredBounds;
  const observed = report.route?.observedFrustumUnion;
  assert.ok(observed && bounds);
  assert.ok(
    observed.west >= bounds.west &&
      observed.south >= bounds.south &&
      observed.east <= bounds.east &&
      observed.north <= bounds.north,
    'Every sampled native camera frustum remains within declared fixture coverage.',
  );
  assert.ok(
    Math.abs(report.route.end.longitude - report.route.start.longitude) > 0.01,
    'Elapsed route changes camera position.',
  );
  assert.equal(report.terrainEvidence?.providerClass, 'CesiumTerrainProvider');
  assert.ok(report.terrainEvidence.sampleCount >= 2);
  assert.ok(report.terrainEvidence.minHeightM >= 120);
  assert.ok(report.terrainEvidence.maxHeightM <= 880);
  assert.ok(
    report.terrainEvidence.maxHeightM > report.terrainEvidence.minHeightM,
    'Terrain samples prove nonflat rendered heights.',
  );
  return true;
}

export function validateMapStreamingCaptureReport(
  report,
  { fixture, profile },
) {
  validateDeterministicMapStreamingFixture(fixture);
  assert.equal(report?.schema, MAP_STREAMING_CAPTURE_SCHEMA);
  assert.equal(report.workloadId, MAP_STREAMING_WORKLOAD_ID);
  assert.equal(report.status, 'observed');
  assert.equal(report.performanceAcceptanceEligible, false);
  assert.equal(report.fixtureId, MAP_STREAMING_FIXTURE_ID);
  assert.equal(report.manifestSha256, fixture.manifestSha256);
  assert.deepEqual(report.buildProfile, profile);
  assert.equal(profile?.id, MAP_FIXTURE_BUILD_PROFILE_ID);
  assert.match(profile?.configurationSha256 || '', SHA256);
  validateMapStreamingJourneyEvidence(report, fixture);
  const manifestAssets = new Map(
    fixture.manifest.assets.map((asset) => [asset.path, asset]),
  );
  assert.equal(report.fixtureDelivery?.schema, MAP_STREAMING_DELIVERY_SCHEMA);
  assert.equal(report.fixtureDelivery?.fixtureId, fixture.id);
  assert.equal(report.fixtureDelivery?.manifestSha256, fixture.manifestSha256);
  assert.equal(report.fixtureDelivery?.cleanupConfirmed, true);
  assert.equal(report.fixtureDelivery?.pendingCount, 0);
  assert.equal(report.fixtureDelivery?.unexpectedFulfillmentCount, 0);
  assert.equal(report.fixtureDelivery?.errorObservationCount, 0);
  assert.ok(Array.isArray(report.fixtureDelivery.assets));
  const delivered = new Map();
  for (const asset of report.fixtureDelivery.assets) {
    const expected = manifestAssets.get(asset.path);
    assert.ok(
      expected,
      `Delivered map asset ${asset.path} is in fixture manifest.`,
    );
    assert.equal(asset.sha256, expected.sha256);
    assert.equal(asset.byteLength, expected.byteLength);
    assert.ok(Number.isSafeInteger(asset.requests) && asset.requests >= 1);
    assert.ok(
      Number.isSafeInteger(asset.fulfilledAckCount) &&
        asset.fulfilledAckCount >= 1,
    );
    delivered.set(
      expected.kind,
      (delivered.get(expected.kind) || 0) + asset.fulfilledAckCount,
    );
  }
  assert.ok(
    (delivered.get('3d-tiles-1.1') || 0) >= 1,
    'Native Google root tileset was acknowledged.',
  );
  assert.ok(
    (delivered.get('textured-glb') || 0) >= 1,
    'Native Google content tile was acknowledged.',
  );
  assert.ok(
    (delivered.get('arcgis-mapserver-metadata-json') || 0) >= 1,
    'Native Esri metadata was acknowledged.',
  );
  assert.ok(
    (delivered.get('webmercator-imagery-png') || 0) >= 1,
    'Native imagery tiles were acknowledged.',
  );
  assert.ok(
    (delivered.get('quantized-mesh-layer-metadata') || 0) >= 1,
    'Native terrain metadata was acknowledged.',
  );
  assert.ok(
    (delivered.get('quantized-mesh-1.0') || 0) >= 1,
    'Native terrain meshes were acknowledged.',
  );
  assert.ok(Array.isArray(report.documentDeliveries));
  assert.ok(
    report.documentDeliveries.length >= 1 &&
      report.documentDeliveries.length <= 16,
  );
  const identities = new Set();
  for (const row of report.documentDeliveries) {
    assert.match(row.documentRole || '', /^[a-z0-9-]{1,48}$/i);
    assert.match(row.documentId || '', /^[a-z0-9._:-]{1,96}$/i);
    assert.ok(
      Number.isSafeInteger(row.sessionOrdinal) && row.sessionOrdinal > 0,
    );
    const identity = `${row.documentRole}\0${row.documentId}\0${row.sessionOrdinal}`;
    assert.equal(
      identities.has(identity),
      false,
      'Map fixture document identity is unique.',
    );
    identities.add(identity);
    assert.equal(row.delivery?.cleanupConfirmed, true);
  }
  const recomputedDelivery = aggregateMapStreamingDocumentDeliveries(
    fixture,
    report.documentDeliveries,
  );
  assert.deepEqual(
    report.fixtureDelivery,
    recomputedDelivery,
    'Aggregate fixture delivery is recomputed from every acknowledged document owner.',
  );
  return true;
}
