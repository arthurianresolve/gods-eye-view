import test from 'node:test';
import assert from 'node:assert/strict';
import { createFirmsSource } from './source.js';

test('a malformed successful response is never accepted as an empty fire snapshot', async () => {
  for (const payload of [{}, { fires: null }, { fires: {} }]) {
    const source = createFirmsSource({
      fetchImpl: async () => ({ ok: true, json: async () => payload }),
    });
    await assert.rejects(source.getSnapshot(), /Malformed fire snapshot/);
  }
});
test('optional-key guidance is distinct from denial or upstream failure', async () => {
  for (const status of [401, 403, 429, 500, 503]) {
    const source = createFirmsSource({
      fetchImpl: async () => ({
        ok: false,
        status,
        json: async () => ({ error: 'no_key' }),
      }),
    });
    if (status === 503)
      assert.deepEqual(await source.getSnapshot(), { keyRequired: true });
    else
      await assert.rejects(
        source.getSnapshot(),
        new RegExp(`FIRMS HTTP ${status}`),
      );
  }
});
test('response-body completion honors cancellation without replacing records', async () => {
  const abort = new AbortController();
  const source = createFirmsSource({
    fetchImpl: async () => ({
      ok: true,
      json: async () => {
        abort.abort();
        return { fires: [] };
      },
    }),
  });
  await assert.rejects(source.getSnapshot({ signal: abort.signal }), {
    name: 'AbortError',
  });
});

test('historical fire snapshots validate the requested time and filter future/out-of-window detections', async () => {
  const target = Date.now() - 30_000;
  let requestedUrl = null;
  const source = createFirmsSource({
    fetchImpl: async (url) => {
      requestedUrl = url;
      return {
        ok: true,
        json: async () => ({
          historical: true,
          targetTime: new Date(target).toISOString(),
          fires: [
            {
              acqDate: new Date(target - 60 * 60_000)
                .toISOString()
                .slice(0, 10),
              acqTime: '00',
            },
            {
              acqDate: new Date(target + 60 * 60_000)
                .toISOString()
                .slice(0, 10),
              acqTime: '2300',
            },
            { acqDate: '2000-01-01', acqTime: '0' },
          ],
        }),
      };
    },
  });
  const snapshot = await source.getSnapshotAt(target);
  assert.match(requestedUrl, /^\/api\/firms\/history\?target=/);
  assert.equal(
    new URL(requestedUrl, 'https://local.test').searchParams.get('target'),
    new Date(target).toISOString(),
  );
  assert.equal(snapshot.fires.length, 1);
  assert.equal(snapshot.count, 1);
  assert.deepEqual(snapshot.window, {
    from: target - 24 * 60 * 60_000,
    to: target,
  });
});

test('historical fire selection never falls back to latest for an unsupported target or malformed window', async (t) => {
  const now = Date.parse('2026-10-08T12:00:00Z');
  t.mock.method(Date, 'now', () => now);
  let calls = 0;
  const source = createFirmsSource({
    fetchImpl: async () => {
      calls++;
      return {
        ok: true,
        json: async () => ({ fires: [], historical: false }),
      };
    },
  });
  await assert.rejects(source.getSnapshotAt(Date.now() + 1), /120-day window/);
  await assert.rejects(
    source.getSnapshotAt(Date.now() - 121 * 24 * 60 * 60_000),
    /120-day window/,
  );
  await assert.rejects(
    source.getSnapshotAt(Date.now() - 1),
    /Malformed FIRMS history window/,
  );
  assert.equal(calls, 1);
});
