import assert from 'node:assert/strict';
import test from 'node:test';
import { archiveTimestamp, createArchiveLookup } from './archiveLookup.js';

test('archive dates reject epochs and impossible calendar dates', () => {
  assert.equal(archiveTimestamp('20200229'), '20200229');
  for (const value of [
    1700000000000,
    '20200230',
    '202013',
    'x2020',
    '1700000000000',
  ])
    assert.throws(() => archiveTimestamp(value), /date/i);
});

test('cancellation does not cancel a coalesced caller without a signal', async () => {
  let release;
  let upstreamSignal;
  const lookup = createArchiveLookup({
    requestImpl: ({ signal }) => {
      upstreamSignal = signal;
      return new Promise((resolve) => {
        release = resolve;
      });
    },
  });
  const controller = new AbortController();
  const first = lookup.lookup({
    url: 'https://example.test/a',
    signal: controller.signal,
  });
  const second = lookup.lookup({ url: 'https://example.test/a' });
  await Promise.resolve();
  controller.abort();
  await assert.rejects(first, /abort/i);
  assert.equal(upstreamSignal.aborted, false);
  release({ state: 'unavailable' });
  assert.equal((await second).state, 'unavailable');
});

test('pre-cancelled lookups do not fetch and response-body stalls time out', async () => {
  let calls = 0;
  const controller = new AbortController();
  controller.abort();
  const lookup = createArchiveLookup({
    timeoutMs: 10,
    fetchImpl: async () => {
      calls++;
      return { ok: true, json: () => new Promise(() => {}) };
    },
  });
  await assert.rejects(
    lookup.lookup({ url: 'https://example.test/a', signal: controller.signal }),
  );
  assert.equal(calls, 0);
  await assert.rejects(
    lookup.lookup({ url: 'https://example.test/a' }),
    /timed out/,
  );
});

test('pool caps concurrency and evicts oldest cached lookups', async () => {
  let inFlight = 0,
    peak = 0,
    calls = 0;
  const lookup = createArchiveLookup({
    cacheLimit: 2,
    requestImpl: async () => {
      calls++;
      peak = Math.max(peak, ++inFlight);
      await new Promise((resolve) => setTimeout(resolve, 2));
      inFlight--;
      return { state: 'unavailable' };
    },
  });
  await Promise.all(
    [1, 2, 3].map((id) => lookup.lookup({ url: 'https://example.test/' + id })),
  );
  assert.equal(peak, 2);
  await lookup.lookup({ url: 'https://example.test/1' });
  assert.equal(calls, 4);
});

test('late responses from cancelled work cannot repopulate the cache', async () => {
  let finish,
    calls = 0;
  const lookup = createArchiveLookup({
    requestImpl: async () => {
      calls++;
      if (calls === 1)
        return new Promise((resolve) => {
          finish = resolve;
        });
      return { state: 'unavailable' };
    },
  });
  const controller = new AbortController();
  const request = lookup.lookup({
    url: 'https://example.test/a',
    signal: controller.signal,
  });
  await Promise.resolve();
  controller.abort();
  await assert.rejects(request);
  finish({ state: 'available' });
  assert.equal(
    (await lookup.lookup({ url: 'https://example.test/a' })).state,
    'unavailable',
  );
  assert.equal(calls, 2);
});

test('archive lookups coalesce and cache normalized requests', async () => {
  let calls = 0;
  let now = 1_700_000_000_000;
  const lookup = createArchiveLookup({
    now: () => now,
    fetchImpl: async (_url, options) => {
      calls++;
      await new Promise((resolve) => setTimeout(resolve, 2));
      assert.deepEqual(JSON.parse(options.body), {
        url: 'https://example.test/page',
        timestamp: '20200101',
      });
      return { ok: true, json: async () => ({ state: 'available' }) };
    },
  });
  const [first, second] = await Promise.all([
    lookup.lookup({
      url: 'https://example.test/page#section',
      timestamp: '20200101',
    }),
    lookup.lookup({ url: 'https://example.test/page', timestamp: '20200101' }),
  ]);
  assert.deepEqual(first, second);
  assert.equal(calls, 1);
  await lookup.lookup({
    url: 'https://example.test/page',
    timestamp: '20200101',
  });
  assert.equal(calls, 1);
  now += 10 * 60_000;
  await lookup.lookup({
    url: 'https://example.test/page',
    timestamp: '20200101',
  });
  assert.equal(calls, 2);
});

test('archive lookup rejects private and non-HTTPS targets before fetching', async () => {
  let calls = 0;
  const lookup = createArchiveLookup({
    fetchImpl: async () => {
      calls++;
    },
  });
  await assert.rejects(
    lookup.lookup({ url: 'http://127.0.0.1:4173/' }),
    /public HTTPS/,
  );
  assert.equal(calls, 0);
});

test('archive lookup aborts a stalled request at the bounded timeout', async () => {
  const lookup = createArchiveLookup({
    timeoutMs: 5,
    fetchImpl: (_url, { signal }) =>
      new Promise((resolve, reject) => {
        signal.addEventListener(
          'abort',
          () => reject(signal.reason || new Error('aborted')),
          { once: true },
        );
      }),
  });
  await assert.rejects(
    lookup.lookup({ url: 'https://example.test/stalled' }),
    /timed out|aborted/i,
  );
});

test('archive lookup responds to caller cancellation even if fetch ignores abort', async () => {
  const controller = new AbortController();
  const lookup = createArchiveLookup({
    timeoutMs: 50,
    fetchImpl: async () => new Promise(() => {}),
  });
  const pending = lookup.lookup({
    url: 'https://example.test/cancelled',
    signal: controller.signal,
  });
  controller.abort();
  await assert.rejects(pending, /cancel|abort/i);
});

test('coalesced callers can cancel independently', async () => {
  const firstController = new AbortController();
  const secondController = new AbortController();
  const lookup = createArchiveLookup({
    timeoutMs: 50,
    fetchImpl: async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      return new Response(JSON.stringify({ state: 'unavailable' }), {
        headers: { 'Content-Type': 'application/json' },
      });
    },
  });
  const first = lookup.lookup({
    url: 'https://example.test/coalesced',
    signal: firstController.signal,
  });
  const second = lookup.lookup({
    url: 'https://example.test/coalesced',
    signal: secondController.signal,
  });
  firstController.abort();
  await assert.rejects(first, /cancel|abort/i);
  assert.deepEqual(await second, { state: 'unavailable' });
});
