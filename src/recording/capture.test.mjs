import assert from 'node:assert/strict';
import test from 'node:test';
import {
  captureAircraftSnapshot,
  captureVesselSnapshot,
  markRecordingSourceUnavailable,
} from './capture.js';

function recordingService(sourceId = 'approved-fixture') {
  const calls = [];
  return {
    calls,
    getState: () => ({ status: 'active', sourceId }),
    async ingest(value) {
      calls.push(['ingest', value]);
      return { status: 'active', accepted: value.observations.length };
    },
    async stop(reason) {
      calls.push(['stop', reason]);
      return { status: 'complete', stopReason: reason };
    },
    async noteSourceUnavailable(reason) {
      calls.push(['gap', reason]);
      return { status: 'active', gap: reason };
    },
  };
}

test('aircraft capture keeps per-position time and drops rows without fixes', async () => {
  const service = recordingService('approved-fixture');
  const result = await captureAircraftSnapshot(service, {
    source: 'approved-fixture',
    observedAtMs: 999,
    records: [
      {
        id: 'abc123',
        positionTimeMs: 123,
        latitude: 40,
        longitude: -73,
        callsign: 'TEST',
        baroAltitudeM: 1000,
        speedMps: 80,
        courseDeg: 270,
        onGround: false,
      },
      {
        id: 'no-fix-time',
        latitude: 40,
        longitude: -73,
      },
    ],
  });
  assert.equal(result.accepted, 1);
  assert.deepEqual(service.calls[0], [
    'ingest',
    {
      sourceId: 'approved-fixture',
      observations: [
        {
          id: 'abc123',
          observedAt: 123,
          latitude: 40,
          longitude: -73,
          callsign: 'TEST',
          altitudeM: 1000,
          velocityMps: 80,
          headingDeg: 270,
          onGround: false,
        },
      ],
    },
  ]);
});

test('vessel capture preserves AIS position time and sea-surface datum', async () => {
  const service = recordingService('approved-vessel-fixture');
  await captureVesselSnapshot(service, {
    source: 'approved-vessel-fixture',
    observedAtMs: 500,
    records: [
      {
        id: '123456789',
        observedAtMs: 400,
        latitude: 0.2,
        longitude: 179.9,
        name: 'Harbor Star',
        altitudeDatum: 'sea-surface',
      },
    ],
  });
  assert.deepEqual(service.calls[0][1].observations[0], {
    id: '123456789',
    observedAtMs: 400,
    latitude: 0.2,
    longitude: 179.9,
    name: 'Harbor Star',
    imo: undefined,
    type: undefined,
    destination: undefined,
    speedMps: undefined,
    courseDeg: undefined,
    headingDeg: undefined,
    altitudeDatum: 'sea-surface',
  });
});

test('capture stops when source ownership changes and records provider gaps', async () => {
  const service = recordingService('approved-fixture');
  const stopped = await captureAircraftSnapshot(service, {
    source: 'different-provider',
    records: [],
  });
  assert.equal(stopped.reason, 'source-changed');
  assert.deepEqual(service.calls[0], ['stop', 'source-changed']);
  await markRecordingSourceUnavailable(service, 'http-429');
  assert.deepEqual(service.calls[1], ['gap', 'http-429']);
});
