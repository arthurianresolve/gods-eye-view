// src/data/aisLiveVessels.analyst.test.mjs
// Focused tests for the pure analyst-record mapper (analyst query engine seam).
// Separate file from aisLiveVessels.test.mjs (feed-status helper) by design.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import aisLiveVesselsLayer, { mapAnalystRecord } from './aisLiveVessels.js';

const FULL_RECORD = {
  mmsi: '353136000',
  name: 'EVER GIVEN',
  lat: 29.55,
  lon: -94.98,
  speed: 12.3,
  course: 214.0,
  type: 'Cargo',
  destination: 'OAKLAND',
};

test('ais analyst record: full record maps every contract field', () => {
  const r = mapAnalystRecord(FULL_RECORD);
  assert.deepEqual(r, {
    id: 'EVER GIVEN',
    mmsi: '353136000',
    name: 'EVER GIVEN',
    lat: 29.55,
    lon: -94.98,
    speedKts: 12.3,
    courseDeg: 214.0,
    shipType: 'Cargo',
    destination: 'OAKLAND',
    navStatus: null, // /api/vessels does not surface NavigationalStatus
  });
});

test('ais analyst evidence preserves MMSI, source time, receipt and sparse coverage', () => {
  const source = aisLiveVesselsLayer.source;
  let r;
  try {
    aisLiveVesselsLayer.source = 'AISStream';
    r = mapAnalystRecord({
      ...FULL_RECORD,
      reference: 'ais:353136000',
      observedAtMs: 1700000000000,
      receivedAtMs: 1700000000250,
    });
  } finally {
    aisLiveVesselsLayer.source = source;
  }
  assert.equal(r.evidence.entityRef.layerKey, 'ais-live-vessels');
  assert.equal(r.evidence.entityRef.id, '353136000');
  assert.equal(r.evidence.sourceId, 'AISStream');
  assert.equal(r.evidence.sourceUrl, 'https://aisstream.io/');
  assert.equal(r.evidence.sourceRecordId, 'ais:353136000');
  assert.equal(r.evidence.observedAt, 1700000000000);
  assert.equal(r.evidence.receivedAt, 1700000000250);
  assert.equal(r.evidence.method, 'observed');
  assert.equal(r.evidence.coverage.completeness, 'partial');
  assert.match(r.evidence.coverage.reason, /sparse/);
  assert.match(r.evidence.limitations[0], /do not prove/);
});

test('ais analyst record: nameless vessel falls back to mmsi id', () => {
  const r = mapAnalystRecord({ ...FULL_RECORD, name: '  ' });
  assert.equal(r.id, '353136000');
  assert.equal(r.name, null);
});

test('ais analyst record: empty strings and NaN become null, never undefined', () => {
  const r = mapAnalystRecord({ mmsi: '', name: 'TUG', speed: NaN, type: '', destination: '' });
  assert.equal(r.mmsi, null);
  assert.equal(r.speedKts, null);
  assert.equal(r.shipType, null);
  assert.equal(r.destination, null);
  for (const [key, value] of Object.entries(r)) {
    assert.notEqual(value, undefined, `${key} must not be undefined`);
    if (typeof value === 'number') assert.ok(Number.isFinite(value), `${key} must not be NaN`);
  }
});

test('ais analyst record: output is JSON-safe (no Cesium types leak from the record)', () => {
  // Real records carry Cesium positions/billboards — the mapper must not copy them.
  const r = mapAnalystRecord({ ...FULL_RECORD, position: { x: 1 }, billboard: {}, normal: {} });
  assert.deepEqual(JSON.parse(JSON.stringify(r)), r);
  assert.equal('position' in r, false);
});
