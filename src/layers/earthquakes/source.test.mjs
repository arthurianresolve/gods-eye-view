import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createUsgsEarthquakeSource,
  EARTHQUAKE_HISTORY_WINDOW_MS,
} from './source.js';

function feature(id, time, magnitude = 3) {
  return {
    type: 'Feature',
    id,
    geometry: { type: 'Point', coordinates: [12, 45, 8] },
    properties: { mag: magnitude, place: id, time },
  };
}

test('USGS history selects a bounded 24-hour M2.5+ window with no future events', async () => {
  const target = Math.floor((Date.now() - 10_000) / 60_000) * 60_000;
  let requestedUrl = null;
  const source = createUsgsEarthquakeSource({
    fetchImpl: async (url) => {
      requestedUrl = new URL(url);
      return {
        ok: true,
        json: async () => ({
          metadata: { generated: target - 100 },
          features: [
            feature('inside', target - 1),
            feature('before-window', target - EARTHQUAKE_HISTORY_WINDOW_MS - 1),
            feature('after-target', target + 1),
            feature('below-threshold', target - 2, 2.4),
          ],
        }),
      };
    },
  });

  const snapshot = await source.getSnapshotAt(target);
  assert.equal(requestedUrl.origin, 'https://earthquake.usgs.gov');
  assert.equal(requestedUrl.pathname, '/fdsnws/event/1/query');
  assert.equal(requestedUrl.searchParams.get('minmagnitude'), '2.5');
  assert.equal(requestedUrl.searchParams.get('limit'), '20000');
  const requestedFrom = Date.parse(requestedUrl.searchParams.get('starttime'));
  const requestedTo = Date.parse(requestedUrl.searchParams.get('endtime'));
  assert.equal(
    requestedFrom,
    Math.floor(target / 86_400_000) * 86_400_000 - 86_400_000,
  );
  assert.ok(requestedTo >= target && requestedTo <= Date.now());
  assert.deepEqual(
    snapshot.rows.map((row) => row.stableId),
    ['inside'],
  );
  assert.equal(snapshot.targetTime, new Date(target).toISOString());
  assert.deepEqual(snapshot.window, {
    from: target - EARTHQUAKE_HISTORY_WINDOW_MS,
    to: target,
  });
  assert.equal(snapshot.snapshotAt, target - 100);
});

test('USGS refuses future or invalid history targets before making a request', async (t) => {
  const now = Date.parse('2026-10-08T12:00:00Z');
  t.mock.method(Date, 'now', () => now);
  let calls = 0;
  const source = createUsgsEarthquakeSource({
    fetchImpl: async () => {
      calls++;
      throw new Error('must not fetch');
    },
  });
  await assert.rejects(source.getSnapshotAt(Date.now() + 1), /past time/);
  await assert.rejects(source.getSnapshotAt('not-a-time'), /past time/);
  assert.equal(calls, 0);
});

test('USGS history honors cancellation after body parsing', async () => {
  const controller = new AbortController();
  const source = createUsgsEarthquakeSource({
    fetchImpl: async () => ({
      ok: true,
      json: async () => {
        controller.abort();
        return { features: [] };
      },
    }),
  });
  await assert.rejects(
    source.getSnapshotAt(Date.now() - 1, { signal: controller.signal }),
    { name: 'AbortError' },
  );
});
