import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import * as Cesium from 'cesium';
import {
  createWeatherSource,
  weatherTileUrl,
} from '../../src/layers/weather/source.js';
import { createWindSource } from '../../src/layers/wind/source.js';
import { createWindLayer } from '../../src/layers/wind/index.js';
import { createWeatherClock } from '../../src/layers/weather/clock.js';
import { createInvestigationWeatherAdapter } from '../../src/time/weatherAdapter.js';
import {
  assertWeatherEffectsClock,
  createWeatherEffectsFixtureDelivery,
  createWeatherEffectsWorkloadFixture,
  WEATHER_EFFECTS_FIXED_TIME,
  WEATHER_EFFECTS_LAYER_COUNTS,
  assertWeatherEffectsWindState,
} from './weatherEffectsWorkloadFixture.mjs';

const BASE = 'http://127.0.0.1:4173/';
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');

test('weather-effects descriptor pins source assets, populations, route and epoch', () => {
  const fixture = createWeatherEffectsWorkloadFixture();
  assert.equal(fixture.schema, 'gev-weather-effects-fixture/v1');
  assert.equal(fixture.workloadId, 'austin-weather-effects-v1');
  assert.equal(fixture.fixedTime, WEATHER_EFFECTS_FIXED_TIME);
  assert.deepEqual(fixture.expectedLayerCounts, WEATHER_EFFECTS_LAYER_COUNTS);
  assert.deepEqual(fixture.camera, {
    id: 'austin-weather-oblique-v1',
    longitudeDeg: -97.7431,
    latitudeDeg: 30.2672,
    altitudeM: 12_000,
    headingDeg: 20,
    pitchDeg: -45,
  });
  assert.equal(fixture.visualState.qualityMode, 'manual');
  assert.equal(fixture.visualState.detectionMode, 'DENSE');
  assert.equal(fixture.visualState.densityPct, 75);
  assert.match(fixture.manifestSha256, /^[a-f0-9]{64}$/);
  for (const product of ['radar', 'clouds-regional', 'lightning']) {
    const frameHashes = fixture.assets
      .filter((asset) => asset.id.startsWith(`${product}-tile-`))
      .map((asset) => asset.sha256);
    assert.equal(frameHashes.length, 3);
    assert.equal(
      new Set(frameHashes).size,
      3,
      `${product} history frames must have distinct bytes`,
    );
  }
  for (const asset of fixture.assets) {
    const bytes = asset.path
      ? readFileSync(new URL(`../../${asset.path}`, import.meta.url))
      : Buffer.from(`${JSON.stringify(fixture.windManifest)}\n`);
    assert.equal(bytes.length, asset.byteLength, asset.id);
    assert.equal(hash(bytes), asset.sha256, asset.id);
  }
  const julian = new Cesium.JulianDate(
    fixture.clock.dayNumber,
    fixture.clock.secondsOfDay,
    Cesium.TimeStandard.TAI,
  );
  assert.equal(Cesium.JulianDate.toIso8601(julian, 3), fixture.fixedTime);
  assert.throws(
    () => createWeatherEffectsWorkloadFixture('2026-10-08T12:00:00Z'),
    /must be 2026-10-08T12:00:00\.000Z/,
  );
});

test('real weather and wind source adapters consume the pinned manifests and grid', async () => {
  const fixture = createWeatherEffectsWorkloadFixture();
  const delivery = createWeatherEffectsFixtureDelivery(fixture, BASE);
  const fulfilled = [];
  const fetchImpl = async (input, init = {}) => {
    const url = new URL(input, BASE);
    const routed = await delivery.respond(url, {
      method: init.method || 'GET',
    });
    if (!routed) throw new Error(`No weather fixture route: ${url.pathname}`);
    const bytes = Buffer.from(routed.body);
    delivery.onFulfilled({
      url: url.href,
      method: init.method || 'GET',
      status: routed.status,
      bodyBase64: bytes.toString('base64'),
    });
    fulfilled.push(url.pathname);
    return new Response(bytes, {
      status: routed.status,
      headers: { 'content-type': routed.contentType },
    });
  };
  const weather = createWeatherSource({ fetchImpl });
  const snapshots = await Promise.all(
    ['radar', 'clouds-regional', 'lightning'].map((product) =>
      weather.getSnapshot({ product }),
    ),
  );
  assert.deepEqual(
    snapshots.map((snapshot) => snapshot.latest),
    [fixture.fixedTime, fixture.fixedTime, fixture.fixedTime],
  );
  const tileUrl = weatherTileUrl('radar', fixture.fixedTime, { size: 256 })
    .replace('{z}', '2')
    .replace('{x}', '3')
    .replace('{y}', '1');
  // Cesium's tile provider consumes this same source URL constructor; route an
  // exact rendered-tile request through the fixture delivery boundary.
  const routedTile = await delivery.respond(new URL(tileUrl, BASE), {
    method: 'GET',
  });
  assert.equal(routedTile.contentType, 'image/png');
  delivery.onFulfilled({
    url: new URL(tileUrl, BASE).href,
    method: 'GET',
    status: 200,
    bodyBase64: Buffer.from(routedTile.body).toString('base64'),
  });
  const wind = await createWindSource({ fetchImpl }).getSnapshot({
    model: 'gfs',
    overlay: 'none',
  });
  assert.equal(wind.grid.nx, 360);
  assert.equal(wind.grid.ny, 181);
  assert.equal(wind.u.length, 65_160);
  assert.equal(wind.v.length, 65_160);
  assert.ok([...wind.u, ...wind.v].every(Number.isFinite));
  assert.deepEqual(fulfilled, [
    '/api/weather/manifest',
    '/api/weather/manifest',
    '/api/weather/manifest',
    '/api/wind/manifest',
    '/api/wind/grid/gfs-weather-effects-v1.bin',
  ]);
});

test('wind preflight reads the actual layer parameter and loading APIs', async (t) => {
  const fixture = createWeatherEffectsWorkloadFixture();
  const layer = createWindLayer({
    feed: {
      async getSnapshot() {
        return {
          ...fixture.windManifest,
          grid: fixture.windManifest.grid,
          u: new Float32Array(360 * 181),
          v: new Float32Array(360 * 181),
        };
      },
    },
  });
  t.after(() => layer.destroy());
  layer.setParams({ model: 'gfs', overlay: 'speed', paused: false });
  layer.enable();
  await layer.update();
  const params = layer.getParams();
  const stats = layer.getStats();
  assert.deepEqual(params, {
    model: 'gfs',
    overlay: 'speed',
    paused: false,
    units: 'km/h',
  });
  assert.equal('loading' in params, false);
  assert.equal(stats.loading, false);
  assertWeatherEffectsWindState(params, stats);
  assert.throws(
    () => assertWeatherEffectsWindState({ ...params, model: 'GFS' }, stats),
    /GFS model/,
  );
  assert.throws(
    () => assertWeatherEffectsWindState(params, { ...stats, loading: true }),
    /must be ready/,
  );
});

test('real investigation weather adapter preserves observed frame time apart from harness time', async (t) => {
  const fixture = createWeatherEffectsWorkloadFixture();
  const harnessEpoch = fixture.fixedTimeMs;
  let shownTime = null;
  const weatherClock = createWeatherClock({ now: () => harnessEpoch });
  weatherClock.register({
    id: 'weather-radar',
    maxGapMs: 30 * 60_000,
    getTimes: () => fixture.timeline,
    getShownTime: () => shownTime,
    isSuspended: () => false,
    async apply(time) {
      shownTime = time;
      return true;
    },
  });
  const listeners = new Set();
  let state = { mode: 'live', timeMs: null };
  const investigationTime = {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    seek(timeMs) {
      state = { mode: 'paused', timeMs };
      for (const listener of [...listeners]) listener(state);
    },
  };
  const adapter = createInvestigationWeatherAdapter({
    weatherClock,
    investigationTime,
  });
  t.after(() => {
    adapter.destroy();
    weatherClock.destroy();
  });
  investigationTime.seek(Date.parse(fixture.timeline[0]));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(weatherClock.getState().mode, 'history');
  assert.equal(weatherClock.getState().target, fixture.timeline[0]);
  assert.equal(shownTime, fixture.timeline[0]);
  assert.notEqual(shownTime, new Date(harnessEpoch).toISOString());
  assert.equal(harnessEpoch, Date.parse(WEATHER_EFFECTS_FIXED_TIME));
});

test('fixture responder enforces exact query and method, then audits tile bytes', async () => {
  const fixture = createWeatherEffectsWorkloadFixture();
  const delivery = createWeatherEffectsFixtureDelivery(fixture, BASE);
  const route = (path, method = 'GET') =>
    delivery.respond(new URL(path, BASE), { method });
  const tilePath = `/api/weather/tile?product=radar&time=${encodeURIComponent(fixture.fixedTime)}&z=2&x=3&y=1`;
  const tile = await route(tilePath);
  assert.equal(tile.contentType, 'image/png');
  delivery.onFulfilled({
    url: new URL(tilePath, BASE).href,
    method: 'GET',
    status: 200,
    bodyBase64: Buffer.from(tile.body).toString('base64'),
  });
  for (const [path, method] of [
    [tilePath + '&host=https://bad.invalid', 'GET'],
    [tilePath.replace('y=1', 'y=4'), 'GET'],
    [tilePath, 'POST'],
    ['/api/wind/manifest?model=ifs&overlay=none', 'GET'],
    ['/api/weather/manifest?product=radar&extra=1', 'GET'],
  ])
    await assert.rejects(route(path, method), /Unexpected or malformed/);
  await assert.rejects(
    route('/api/weather/unknown'),
    /Unexpected or malformed/,
  );
});

test('weather delivery fails closed on missing source, wrong bytes or population drift', async () => {
  const fixture = createWeatherEffectsWorkloadFixture();
  const delivery = createWeatherEffectsFixtureDelivery(fixture, BASE);
  const layers = Object.entries(fixture.expectedLayerCounts).map(
    ([id, count]) => ({ id, enabled: true, count }),
  );
  const radarManifest = await delivery.respond(
    new URL('/api/weather/manifest?product=radar', BASE),
    { method: 'GET' },
  );
  delivery.onFulfilled({
    url: new URL('/api/weather/manifest?product=radar', BASE).href,
    method: 'GET',
    status: 200,
    bodyBase64: Buffer.from(radarManifest.body).toString('base64'),
  });
  assert.throws(
    () => delivery.summarize(layers, layers),
    /tile|expected|missing/i,
  );

  const changed = createWeatherEffectsFixtureDelivery(fixture, BASE);
  await assert.rejects(
    changed.respond(
      new URL('/api/weather/manifest?product=radar&unexpected=true', BASE),
      { method: 'GET' },
    ),
    /Unexpected or malformed/,
  );
  await assert.rejects(
    changed.respond(new URL('/api/weather/unknown', BASE), {
      method: 'GET',
    }),
    /Unexpected or malformed/,
  );
  await assert.rejects(
    createWeatherSource({
      fetchImpl: async () => new Response('not a manifest'),
    }).getSnapshot({ product: 'radar' }),
    /Malformed weather manifest|JSON/i,
  );
  const wrongGrid = createWindSource({
    fetchImpl: async (url) =>
      url.includes('/manifest')
        ? Response.json({
            ...fixture.windManifest,
            gridUrl: 'https://outside.invalid/grid',
          })
        : new Response(Buffer.alloc(0)),
  });
  await assert.rejects(wrongGrid.getSnapshot(), /Malformed wind manifest/);
  assert.throws(
    () =>
      delivery.summarize(
        layers,
        layers.map((row) => ({ ...row, count: row.count + 1 })),
      ),
    /deeply|expected|populations/i,
  );
});

test('delivery summary requires and hashes each distinct weather history frame', async () => {
  const fixture = createWeatherEffectsWorkloadFixture();
  const delivery = createWeatherEffectsFixtureDelivery(fixture, BASE);
  const fulfill = async (assetId, url) => {
    const result = await delivery.respond(new URL(url, BASE), {
      method: 'GET',
    });
    assert.ok(result, assetId);
    delivery.onFulfilled({
      url: new URL(url, BASE).href,
      method: 'GET',
      status: result.status,
      bodyBase64: Buffer.from(result.body).toString('base64'),
    });
  };
  for (const product of ['radar', 'clouds-regional', 'lightning']) {
    await fulfill(
      `${product}-manifest`,
      `/api/weather/manifest?product=${product}`,
    );
    for (const time of fixture.manifests[product].times) {
      await fulfill(
        `${product}-tile`,
        `/api/weather/tile?product=${product}&time=${encodeURIComponent(time)}&z=2&x=3&y=1`,
      );
    }
  }
  await fulfill('wind-manifest', '/api/wind/manifest?model=gfs');
  await fulfill('wind-grid', fixture.windManifest.gridUrl);
  const layers = Object.entries(fixture.expectedLayerCounts).map(
    ([id, count]) => ({ id, enabled: true, count }),
  );
  const summary = delivery.summarize(layers, layers);
  assert.equal(summary.assets.length, fixture.assets.length);
  assert.ok(summary.assets.every((asset) => asset.responseCount > 0));
  assert.deepEqual(
    fixture.assets
      .filter((asset) => asset.id.endsWith('tile-0'))
      .map((asset) => asset.id)
      .sort(),
    ['clouds-regional-tile-0', 'lightning-tile-0', 'radar-tile-0'],
  );
  assert.throws(
    () =>
      delivery.summarize(
        [...layers, { id: 'unexpected-layer', enabled: true, count: 9 }],
        layers,
      ),
    /deeply|expected|populations/i,
  );
});

test('pending fixture delivery wait is canceled and releases its timer on disposal', async () => {
  const fixture = createWeatherEffectsWorkloadFixture();
  const delivery = createWeatherEffectsFixtureDelivery(fixture, BASE);
  const pending = delivery.waitForRequiredAssets(60_000);
  assert.equal(delivery.dispose(), true);
  await assert.rejects(pending, /disposed/);
  assert.equal(delivery.dispose(), false);
  await assert.rejects(delivery.waitForRequiredAssets(1000), /disposed/);
});

test('aborted fixture delivery wait preserves cancellation and removes its waiter', async () => {
  const fixture = createWeatherEffectsWorkloadFixture();
  const delivery = createWeatherEffectsFixtureDelivery(fixture, BASE);
  const controller = new AbortController();
  const pending = delivery.waitForRequiredAssets(60_000, {
    signal: controller.signal,
  });
  controller.abort(new Error('owned page closed'));
  await assert.rejects(pending, /owned page closed/);
  delivery.dispose();
});

test('weather clock assertion checks exact wall and Cesium epoch on both boundaries', () => {
  const fixture = createWeatherEffectsWorkloadFixture();
  const observation = {
    wallClockEpochMs: fixture.fixedTimeMs,
    cesiumClock: {
      currentTime: {
        dayNumber: fixture.clock.dayNumber,
        secondsOfDay: fixture.clock.secondsOfDay,
      },
      shouldAnimate: false,
      multiplier: 0,
    },
  };
  assertWeatherEffectsClock(observation, fixture, 'sample before');
  for (const change of [
    { wallClockEpochMs: fixture.fixedTimeMs + 1 },
    { cesiumClock: { ...observation.cesiumClock, shouldAnimate: true } },
    { cesiumClock: { ...observation.cesiumClock, multiplier: 1 } },
  ])
    assert.throws(
      () =>
        assertWeatherEffectsClock(
          { ...observation, ...change },
          fixture,
          'sample after',
        ),
      /sample after/,
    );
});
