import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { firmsProxy } from '../../server/providers/firms.js';

const HEADER =
  'latitude,longitude,bright_ti4,scan,track,acq_date,acq_time,satellite,instrument,confidence,version,bright_ti5,frp,daynight\n';

function csvRow(time, satellite, instrument) {
  const date = new Date(time).toISOString();
  const acqDate = date.slice(0, 10);
  const acqTime = `${date.slice(11, 13)}${date.slice(14, 16)}`;
  return `38.9,-121.6,303,0.39,0.36,${acqDate},${acqTime},${satellite},${instrument},n,2.0NRT,290,1.2,N\n`;
}

function mountProxy(plugin) {
  let handler = null;
  plugin.configureServer({
    middlewares: {
      use(route, next) {
        assert.equal(route, '/api/firms');
        handler = next;
      },
    },
  });
  assert.equal(typeof handler, 'function');
  return handler;
}

async function callRoute(handler, url) {
  const response = {
    status: null,
    headers: null,
    body: '',
    writeHead(status, headers) {
      this.status = status;
      this.headers = headers;
    },
    end(body) {
      this.body = body;
    },
  };
  await handler({ url }, response, () => {});
  return { ...response, payload: JSON.parse(response.body) };
}

test('the dated FIRMS route queries an exact UTC window and filters to target time', async (t) => {
  const previousKey = process.env.FIRMS_MAP_KEY;
  process.env.FIRMS_MAP_KEY = 'test-map-key';
  const workingDirectory = await mkdtemp(
    path.join(os.tmpdir(), 'gev-firms-history-'),
  );
  t.after(async () => {
    if (previousKey === undefined) delete process.env.FIRMS_MAP_KEY;
    else process.env.FIRMS_MAP_KEY = previousKey;
    await rm(workingDirectory, { recursive: true, force: true });
  });

  const targetMs = Date.now() - 15 * 60_000;
  const target = new Date(targetMs).toISOString();
  const rows = [
    ['N20', 'VIIRS'],
    ['N21', 'VIIRS'],
    ['SNPP', 'VIIRS'],
    ['TERRA', 'MODIS'],
  ];
  const calls = [];
  const plugin = firmsProxy({
    workingDirectory,
    fetchImpl: async (url) => {
      calls.push(url);
      const index = calls.length - 1;
      return {
        ok: true,
        text: async () =>
          HEADER +
          csvRow(targetMs - 60 * 60_000, ...rows[index]) +
          csvRow(targetMs + 60 * 60_000, ...rows[index]) +
          csvRow(targetMs - 26 * 60 * 60_000, ...rows[index]),
      };
    },
  });

  const result = await callRoute(
    mountProxy(plugin),
    `/history?target=${encodeURIComponent(target)}`,
  );
  assert.equal(result.status, 200);
  assert.equal(result.payload.historical, true);
  assert.equal(result.payload.targetTime, target);
  assert.equal(result.payload.fires.length, 4);
  assert.deepEqual(
    result.payload.sources.map(({ count, ok }) => ({ count, ok })),
    rows.map(() => ({ count: 1, ok: true })),
  );
  assert.equal(calls.length, 4);
  const requested = new URL(calls[0]);
  assert.match(
    requested.pathname,
    /\/VIIRS_NOAA20_NRT\/world\/2\/\d{4}-\d{2}-\d{2}$/,
  );
  assert.ok(!JSON.stringify(result.payload).includes('test-map-key'));
});

test('the dated FIRMS route refuses invalid and future targets before upstream requests', async (t) => {
  const previousKey = process.env.FIRMS_MAP_KEY;
  process.env.FIRMS_MAP_KEY = 'test-map-key';
  const workingDirectory = await mkdtemp(
    path.join(os.tmpdir(), 'gev-firms-history-'),
  );
  t.after(async () => {
    if (previousKey === undefined) delete process.env.FIRMS_MAP_KEY;
    else process.env.FIRMS_MAP_KEY = previousKey;
    await rm(workingDirectory, { recursive: true, force: true });
  });

  let calls = 0;
  const handler = mountProxy(
    firmsProxy({
      workingDirectory,
      fetchImpl: async () => {
        calls++;
        throw new Error('must not fetch');
      },
    }),
  );
  const invalid = await callRoute(handler, '/history?target=not-a-date');
  const future = await callRoute(
    handler,
    `/history?target=${encodeURIComponent(new Date(Date.now() + 1000).toISOString())}`,
  );
  const tooOld = await callRoute(
    handler,
    `/history?target=${encodeURIComponent(new Date(Date.now() - 121 * 24 * 60 * 60_000).toISOString())}`,
  );
  assert.equal(invalid.status, 400);
  assert.equal(future.status, 400);
  assert.equal(tooOld.status, 400);
  assert.deepEqual(invalid.payload, { error: 'invalid_history_target' });
  assert.equal(calls, 0);
});
