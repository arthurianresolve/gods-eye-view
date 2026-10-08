import assert from 'node:assert/strict';
import test from 'node:test';
import { createInvestigationClock } from '../../time/clock.js';
import { createEarthquakesLayer } from './index.js';

function makeLayer(source) {
  const visible = new Map();
  const overlayHost = {
    setVisible(id, value) {
      visible.set(id, value);
    },
    setEntries() {},
    clearSource(id) {
      visible.delete(id);
    },
  };
  const layer = createEarthquakesLayer({ source, overlayHost });
  const viewer = {
    dataSources: {
      add(dataSource) {
        return dataSource;
      },
      remove() {
        return true;
      },
    },
  };
  layer.init(viewer);
  layer.enable(viewer);
  return { layer, viewer, visible };
}

test('earthquakes clear live events when provider history is unavailable and restore live on return', async () => {
  let liveCalls = 0;
  let historyCalls = 0;
  const eventTime = Date.now() - 1000;
  const source = {
    async getSnapshot() {
      return [];
    },
    async getSnapshotWithMetadata() {
      liveCalls++;
      return {
        rows: [
          {
            stableId: 'event-1',
            usgsId: 'event-1',
            lon: -122,
            lat: 37,
            depthKm: 8,
            mag: 3.2,
            place: 'San Francisco Bay Area',
            time: eventTime,
          },
        ],
        receivedAt: Date.now(),
        snapshotAt: Date.now(),
      };
    },
    async getSnapshotAt() {
      historyCalls++;
      throw new Error('provider history unavailable');
    },
  };
  const { layer, viewer } = makeLayer(source);
  let wallNow = Date.now();
  const clock = createInvestigationClock({ now: () => wallNow });
  const detach = layer.attachInvestigationTime(clock);
  await layer.update(viewer);
  assert.equal(layer.getStats().count, 1);
  assert.equal(layer.getAnalystRecords().length, 1);

  wallNow -= 60 * 60_000;
  clock.seek(wallNow);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(historyCalls, 1);
  assert.equal(liveCalls, 1, 'a failed historical request must not use Latest');
  assert.equal(layer.getStats().count, 0);
  assert.equal(layer.getStats().historyStatus, 'unavailable');
  assert.deepEqual(layer.getAnalystRecords(), []);

  clock.returnLive();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(liveCalls, 2);
  assert.equal(layer.getStats().historyStatus, null);
  assert.equal(layer.getAnalystRecords().length, 1);

  detach();
  layer.destroy(viewer);
  clock.destroy();
});
