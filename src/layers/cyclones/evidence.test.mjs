import test from 'node:test';
import assert from 'node:assert/strict';
import { createCyclonesLayer } from './index.js';

test('NHC analyst records retain advisory position, issue and receipt times', async () => {
  const positionAt = new Date(Date.now() - 2 * 60 * 60_000).toISOString();
  const issuedAt = new Date(Date.now() - 3 * 60 * 60_000).toISOString();
  const fetchedAt = Date.now() - 60_000;
  const storm = {
    id: 'ep152026',
    name: 'Fifteen-E',
    classification: 'TS',
    basin: 'EP',
    position: { longitude: -125.8, latitude: 15.5 },
    positionAt,
    issuedAt,
    advisoryUrl: 'https://www.nhc.noaa.gov/text/MIATCMEP5.shtml',
    windKt: 45,
    pressureHpa: 996,
  };
  const layer = createCyclonesLayer({
    feed: {
      getSnapshot: async () => ({
        storms: [storm],
        fetchedAt,
        stale: false,
        unavailable: false,
      }),
    },
    createRendering: () => ({
      setSnapshot: async () => true,
      setSelection() {},
      clear() {},
      destroy() {},
      getDiagnostics: () => ({}),
    }),
  });
  layer.init({});
  layer.enable();
  await layer.update();

  const [record] = layer.getAnalystRecords();
  assert.equal(record.evidence.sourceId, 'NOAA NHC / CPHC');
  assert.equal(record.evidence.sourceUrl, storm.advisoryUrl);
  assert.equal(record.evidence.licenseRef, 'NWS public-data terms');
  assert.equal(record.evidence.observedAt, Date.parse(positionAt));
  assert.equal(record.evidence.issuedAt, Date.parse(issuedAt));
  assert.equal(record.evidence.snapshotAt, fetchedAt);
  assert.ok(Number.isFinite(record.evidence.receivedAt));
  assert.equal(record.evidence.coverage.completeness, 'partial');
  assert.match(record.evidence.coverage.reason, /not worldwide/);
  layer.destroy();
});
