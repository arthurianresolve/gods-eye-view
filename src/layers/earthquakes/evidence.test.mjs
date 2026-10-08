import assert from 'node:assert/strict';
import test from 'node:test';
import { createEarthquakesLayer } from './index.js';
import { createUsgsEarthquakeSource } from './source.js';

const eventTime = Date.UTC(2026, 9, 7, 12);

test('USGS source metadata distinguishes generated snapshot and local receipt', async () => {
  const snapshotAt = Date.now() - 10_000;
  const source = createUsgsEarthquakeSource({
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({
        metadata: { generated: snapshotAt },
        features: [
          {
            id: 'us7000test',
            geometry: { type: 'Point', coordinates: [-150, 61, 10] },
            properties: { mag: 4.2, place: 'Alaska', time: eventTime },
          },
        ],
      }),
    }),
  });

  const snapshot = await source.getSnapshotWithMetadata();
  assert.equal(snapshot.rows.length, 1);
  assert.equal(snapshot.snapshotAt, snapshotAt);
  assert.ok(snapshot.receivedAt >= snapshotAt);
  assert.deepEqual(await source.getSnapshot(), snapshot.rows);
});

test('earthquake analyst records carry source event, feed snapshot and receipt times', async () => {
  const snapshotAt = Date.now() - 10_000;
  const receivedAt = Date.now();
  const layer = createEarthquakesLayer({
    source: {
      async getSnapshot() {
        return [];
      },
      async getSnapshotWithMetadata() {
        return {
          rows: [
            {
              stableId: 'us7000test',
              usgsId: 'us7000test',
              lon: -150,
              lat: 61,
              depthKm: 10,
              mag: 4.2,
              place: 'Alaska',
              time: eventTime,
            },
          ],
          snapshotAt,
          receivedAt,
        };
      },
    },
    overlayHost: { setEntries() {}, setVisible() {}, clearSource() {} },
  });
  const dataSources = [];
  const viewer = {
    dataSources: {
      add(source) {
        dataSources.push(source);
        return source;
      },
      remove(source) {
        const index = dataSources.indexOf(source);
        if (index >= 0) dataSources.splice(index, 1);
        return index >= 0;
      },
    },
  };

  try {
    layer.init(viewer);
    layer.enable(viewer);
    assert.equal(await layer.update(viewer), true);
    const [record] = layer.getAnalystRecords();
    assert.equal(record.evidence.entityRef.layerKey, 'earthquakes');
    assert.equal(record.evidence.sourceId, 'USGS');
    assert.equal(record.evidence.sourceUrl, 'https://earthquake.usgs.gov/');
    assert.equal(record.evidence.licenseRef, 'U.S. public domain');
    assert.equal(record.evidence.observedAt, eventTime);
    assert.equal(record.evidence.snapshotAt, snapshotAt);
    assert.equal(record.evidence.receivedAt, receivedAt);
    assert.equal(record.evidence.method, 'observed');
  } finally {
    layer.destroy(viewer);
  }
});
