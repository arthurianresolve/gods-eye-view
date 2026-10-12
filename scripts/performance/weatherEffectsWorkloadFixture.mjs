import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as Cesium from 'cesium';
import { validateWeatherSnapshot } from '../../src/layers/weather/source.js';

export const WEATHER_EFFECTS_WORKLOAD_ID = 'austin-weather-effects-v1';
export const WEATHER_EFFECTS_FIXED_TIME = '2026-10-08T12:00:00.000Z';
export const WEATHER_EFFECTS_LAYER_COUNTS = Object.freeze({
  'weather-radar': 1,
  'weather-satellite': 1,
  'weather-lightning': 1,
  wind: 65_160,
});
export const WEATHER_EFFECTS_CAMERA = Object.freeze({
  id: 'austin-weather-oblique-v1',
  longitudeDeg: -97.7431,
  latitudeDeg: 30.2672,
  altitudeM: 12_000,
  headingDeg: 20,
  pitchDeg: -45,
});

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../..',
);
const FIXTURE_BYTES = new WeakMap();
const ASSETS = Object.freeze({
  'radar-manifest': {
    path: 'src/data/fixtures/weather-effects-v1/radar.manifest.json',
    sha256: '8947f95a5af16eb36326f9f915f843abc6718277f5a31cc9c90052d9a59f7846',
    byteLength: 277,
    contentType: 'application/json',
  },
  'radar-tile-0': {
    path: 'src/data/fixtures/weather-effects-v1/radar-0.tile.png',
    sha256: '9de68abd15af96fd6a1b46f887dc67a2546ea683511ad66f2fdc01d17c1f048c',
    byteLength: 96_080,
    contentType: 'image/png',
  },
  'radar-tile-1': {
    path: 'src/data/fixtures/weather-effects-v1/radar-1.tile.png',
    sha256: '7d11316ca1dc0b1e83bc45cde2bbb7991fecbd4d895e267937d8f060656f4c31',
    byteLength: 82_173,
    contentType: 'image/png',
  },
  'radar-tile-2': {
    path: 'src/data/fixtures/weather-effects-v1/radar-2.tile.png',
    sha256: '479daa7cb5f8fd5ea49f387eca20ad0fd4acde76d3bd5eaea7646e81e4f5cd5f',
    byteLength: 78_229,
    contentType: 'image/png',
  },
  'clouds-regional-manifest': {
    path: 'src/data/fixtures/weather-effects-v1/clouds-regional.manifest.json',
    sha256: 'c2e4a5d77a54d7c4f93ef6d15d014d8adce5afd39e88cd052109d9fa3ddb4c2a',
    byteLength: 286,
    contentType: 'application/json',
  },
  'clouds-regional-tile-0': {
    path: 'src/data/fixtures/weather-effects-v1/clouds-regional-0.tile.png',
    sha256: '1829581e3f75db298905492a656b9c0a014627a251561ce8eaaaded82cc11109',
    byteLength: 85_934,
    contentType: 'image/png',
  },
  'clouds-regional-tile-1': {
    path: 'src/data/fixtures/weather-effects-v1/clouds-regional-1.tile.png',
    sha256: '1b1f2c9d688303230254e343a54b0fcd85a37e0d65a2fe944867bbdc6efff3d8',
    byteLength: 90_656,
    contentType: 'image/png',
  },
  'clouds-regional-tile-2': {
    path: 'src/data/fixtures/weather-effects-v1/clouds-regional-2.tile.png',
    sha256: 'c68b5c3bbb546325a787d89c5b648fb3411646ac7f18763b280f7da8bc8177e5',
    byteLength: 90_938,
    contentType: 'image/png',
  },
  'lightning-manifest': {
    path: 'src/data/fixtures/weather-effects-v1/lightning.manifest.json',
    sha256: 'b1043b299f56caba1d1308f4eab770ccc2eb58ca4f6815c86f282eb5cb8a62a8',
    byteLength: 282,
    contentType: 'application/json',
  },
  'lightning-tile-0': {
    path: 'src/data/fixtures/weather-effects-v1/lightning-0.tile.png',
    sha256: '8da506489e8da77480da3ea57e7ebdbe46afbeb1821f13bf4c0e2c8e2afd73d1',
    byteLength: 93_276,
    contentType: 'image/png',
  },
  'lightning-tile-1': {
    path: 'src/data/fixtures/weather-effects-v1/lightning-1.tile.png',
    sha256: 'cd3a6095d51907c544b447f711d95131d4c30a962aff3075a6262e374124a629',
    byteLength: 97_435,
    contentType: 'image/png',
  },
  'lightning-tile-2': {
    path: 'src/data/fixtures/weather-effects-v1/lightning-2.tile.png',
    sha256: 'a484d8e4f850638ac193d91f757e284272cbba1227fce73cd0a7609c281c10fd',
    byteLength: 97_969,
    contentType: 'image/png',
  },
  'wind-manifest': {
    path: null,
    sha256: null,
    byteLength: null,
    contentType: 'application/json',
  },
  'wind-grid': {
    path: 'src/data/fixtures/weather-effects-v1/gfs-weather-grid.bin',
    sha256: 'ab5108331d44d555d002c7f637682d1105762c291186b192e7cde78b9f51a9e3',
    byteLength: 521_280,
    contentType: 'application/octet-stream',
  },
});

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const assetBytes = (asset) => {
  const bytes = asset.path
    ? readFileSync(path.join(ROOT, ...asset.path.split('/')))
    : Buffer.alloc(0);
  if (
    (asset.byteLength !== null && bytes.length !== asset.byteLength) ||
    (asset.sha256 !== null && sha256(bytes) !== asset.sha256)
  )
    throw new Error(`Weather fixture asset changed: ${asset.path}`);
  return bytes;
};

function canonicalTime(value) {
  const epoch = Date.parse(value);
  if (
    !Number.isSafeInteger(epoch) ||
    new Date(epoch).toISOString() !== WEATHER_EFFECTS_FIXED_TIME ||
    value !== WEATHER_EFFECTS_FIXED_TIME
  )
    throw new TypeError(
      `Weather fixture time must be ${WEATHER_EFFECTS_FIXED_TIME}.`,
    );
  return epoch;
}

function loadManifest(product) {
  const id = `${product}-manifest`;
  const bytes = assetBytes(ASSETS[id]);
  const manifest = JSON.parse(bytes.toString('utf8'));
  validateWeatherSnapshot(manifest, product);
  if (
    manifest.latest !== WEATHER_EFFECTS_FIXED_TIME ||
    manifest.times.length !== 3 ||
    manifest.times.at(-1) !== WEATHER_EFFECTS_FIXED_TIME
  )
    throw new Error(`Weather fixture manifest changed: ${product}`);
  return manifest;
}

export function createWeatherEffectsWorkloadFixture(
  fixedTime = WEATHER_EFFECTS_FIXED_TIME,
) {
  const fixedTimeMs = canonicalTime(fixedTime);
  const manifests = Object.fromEntries(
    ['radar', 'clouds-regional', 'lightning'].map((product) => [
      product,
      loadManifest(product),
    ]),
  );
  const windGrid = assetBytes(ASSETS['wind-grid']);
  const windManifest = {
    model: 'gfs',
    overlay: 'none',
    cycle: {
      runIso: '2026-10-08T00:00:00.000Z',
      validIso: fixedTime,
      forecastHour: 12,
    },
    level: 'surface',
    units: 'm/s',
    grid: { nx: 360, ny: 181, lo1: 0, la1: 90, dx: 1, dy: 1 },
    gridUrl: '/api/wind/grid/gfs-weather-effects-v1.bin?model=gfs',
  };
  const serializable = {
    schema: 'gev-weather-effects-fixture/v1',
    id: 'weather-effects-austin-v1',
    workloadId: WEATHER_EFFECTS_WORKLOAD_ID,
    fixedTime,
    timeline: [...manifests.radar.times],
    expectedLayerCounts: { ...WEATHER_EFFECTS_LAYER_COUNTS },
    selectedLayerIds: Object.keys(WEATHER_EFFECTS_LAYER_COUNTS),
    camera: { ...WEATHER_EFFECTS_CAMERA },
    visualState: {
      qualityMode: 'manual',
      detectionMode: 'DENSE',
      densityPct: 75,
      weather: ['weather-radar', 'weather-satellite', 'weather-lightning'],
      wind: { model: 'gfs', overlay: 'speed', paused: false },
      weatherClock: { mode: 'latest', selectedTime: fixedTime },
    },
    manifests: Object.fromEntries(
      Object.entries(manifests).map(([product, manifest]) => [
        product,
        manifest,
      ]),
    ),
    windManifest,
    assets: Object.entries(ASSETS).map(([id, asset]) => {
      const bytes =
        id === 'wind-manifest'
          ? Buffer.from(`${JSON.stringify(windManifest)}\n`)
          : assetBytes(asset);
      return {
        id,
        path: asset.path,
        sha256: sha256(bytes),
        byteLength: bytes.length,
        contentType: asset.contentType,
      };
    }),
  };
  const manifestSha256 = sha256(Buffer.from(JSON.stringify(serializable)));
  const fixture = Object.freeze({
    ...serializable,
    fixedTimeMs,
    manifestSha256,
    sha256: manifestSha256,
    assets: Object.freeze(serializable.assets.map(Object.freeze)),
    expectedLayerCounts: Object.freeze(serializable.expectedLayerCounts),
    selectedLayerIds: Object.freeze(serializable.selectedLayerIds),
    camera: Object.freeze(serializable.camera),
    visualState: Object.freeze(serializable.visualState),
    manifests: Object.freeze(serializable.manifests),
    windManifest: Object.freeze(serializable.windManifest),
    clock: (() => {
      const julian = Cesium.JulianDate.fromDate(new Date(fixedTimeMs));
      return Object.freeze({
        dayNumber: julian.dayNumber,
        secondsOfDay: julian.secondsOfDay,
      });
    })(),
  });
  FIXTURE_BYTES.set(
    fixture,
    new Map(
      Object.entries(ASSETS).map(([id, asset]) => [
        id,
        id === 'wind-manifest'
          ? Buffer.from(`${JSON.stringify(windManifest)}\n`)
          : assetBytes(asset),
      ]),
    ),
  );
  return fixture;
}

function exactSearchParams(url, expectedKeys) {
  const entries = [...url.searchParams.entries()];
  return (
    entries.length === expectedKeys.length &&
    expectedKeys.every((key) => url.searchParams.has(key)) &&
    new Set(entries.map(([key]) => key)).size === entries.length
  );
}

function expectedWeatherTile(url, fixture) {
  if (!(
    exactSearchParams(url, ['product', 'time', 'z', 'x', 'y']) ||
    (exactSearchParams(url, ['product', 'time', 'z', 'x', 'y', 'size']) &&
      url.searchParams.get('size') === '256')
  ))
    return null;
  const product = url.searchParams.get('product');
  const manifest = fixture.manifests[product];
  const time = url.searchParams.get('time');
  const z = Number(url.searchParams.get('z'));
  const x = Number(url.searchParams.get('x'));
  const y = Number(url.searchParams.get('y'));
  if (
    !manifest ||
    !manifest.times.includes(time) ||
    !Number.isInteger(z) ||
    z < 0 ||
    z > manifest.maxLevel ||
    !Number.isInteger(x) ||
    x < 0 ||
    x >= 2 ** (z + 1) ||
    !Number.isInteger(y) ||
    y < 0 ||
    y >= 2 ** z
  )
    return null;
  return `${product}-tile-${manifest.times.indexOf(time)}`;
}

export function createWeatherEffectsFixtureDelivery(fixture, baseUrl) {
  if (fixture?.schema !== 'gev-weather-effects-fixture/v1')
    throw new TypeError('A registered weather-effects fixture is required.');
  const origin = new URL(baseUrl).origin;
  const assets = new Map(fixture.assets.map((asset) => [asset.id, asset]));
  const responses = new Map();
  const routeErrors = [];
  const maxRecords = 8192;
  const responseWaiters = new Set();
  let disposed = false;

  function dispose() {
    if (disposed) return false;
    disposed = true;
    for (const waiter of responseWaiters) {
      waiter.cleanup();
      waiter.reject(new Error('Weather fixture delivery was disposed.'));
    }
    responseWaiters.clear();
    return true;
  }

  function notifyResponseWaiters() {
    for (const waiter of responseWaiters) {
      responseWaiters.delete(waiter);
      waiter.cleanup();
      waiter.resolve();
    }
  }

  function route(url, request) {
    if (url.origin !== origin || request?.method !== 'GET') return null;
    if (url.pathname === '/api/weather/manifest') {
      if (!exactSearchParams(url, ['product'])) return null;
      const product = url.searchParams.get('product');
      if (!Object.hasOwn(fixture.manifests, product)) return null;
      return `${product}-manifest`;
    }
    if (url.pathname === '/api/weather/tile')
      return expectedWeatherTile(url, fixture);
    if (url.pathname === '/api/wind/manifest') {
      if (
        !exactSearchParams(url, ['model']) ||
        url.searchParams.get('model') !== 'gfs'
      )
        return null;
      return 'wind-manifest';
    }
    if (url.pathname === '/api/wind/grid/gfs-weather-effects-v1.bin') {
      if (
        !exactSearchParams(url, ['model']) ||
        url.searchParams.get('model') !== 'gfs'
      )
        return null;
      return 'wind-grid';
    }
    return null;
  }

  return {
    async respond(url, request) {
      if (disposed) throw new Error('Weather fixture delivery is disposed.');
      const id = route(url, request);
      if (!id) {
        if (
          url.origin === origin &&
          /^\/api\/(?:weather|wind)(?:\/|$)/.test(url.pathname)
        ) {
          const error = new Error(
            'Unexpected or malformed weather-effects fixture request.',
          );
          if (routeErrors.length < 32)
            routeErrors.push({ path: url.pathname, message: error.message });
          throw error;
        }
        return null;
      }
      const asset = assets.get(id);
      const bytes = FIXTURE_BYTES.get(fixture)?.get(id);
      if (!asset || !Buffer.isBuffer(bytes))
        throw new Error(`Weather fixture response asset ${id} is unavailable.`);
      return { status: 200, contentType: asset.contentType, body: bytes };
    },
    onFulfilled({ url: href, method, status, bodyBase64 }) {
      if (disposed) throw new Error('Weather fixture delivery is disposed.');
      if (responses.size >= maxRecords)
        throw new RangeError('Weather fixture response inventory overflow.');
      const url = new URL(href);
      const id = route(url, { method });
      if (!id) throw new Error('Fulfilled response has no fixture route.');
      const asset = assets.get(id);
      const bytes = Buffer.from(bodyBase64 || '', 'base64');
      if (
        status !== 200 ||
        bytes.length !== asset.byteLength ||
        sha256(bytes) !== asset.sha256
      )
        throw new Error(`Served weather fixture bytes differ from ${id}.`);
      const previous = responses.get(id) || { count: 0 };
      previous.count += 1;
      responses.set(id, previous);
      notifyResponseWaiters();
    },
    async waitForRequiredAssets(timeoutMs = 60_000, { signal } = {}) {
      if (
        !Number.isSafeInteger(timeoutMs) ||
        timeoutMs < 1 ||
        timeoutMs > 180_000
      )
        throw new RangeError('Weather fixture response wait is out of range.');
      if (disposed) throw new Error('Weather fixture delivery is disposed.');
      signal?.throwIfAborted();
      const required = fixture.assets.map((asset) => asset.id);
      const complete = () =>
        required.every((id) => (responses.get(id)?.count || 0) > 0);
      const startedAt = Date.now();
      while (!complete()) {
        if (routeErrors.length)
          throw new Error('Weather fixture observed malformed source routes.');
        const remaining = timeoutMs - (Date.now() - startedAt);
        if (remaining <= 0)
          throw new Error(
            'Weather fixture did not deliver every pinned asset.',
          );
        await new Promise((resolve, reject) => {
          let timer = null;
          const onAbort = () => {
            responseWaiters.delete(waiter);
            waiter.cleanup();
            reject(
              signal.reason || new Error('Weather fixture wait was aborted.'),
            );
          };
          const waiter = {
            resolve,
            reject,
            cleanup() {
              if (timer !== null) clearTimeout(timer);
              signal?.removeEventListener('abort', onAbort);
            },
          };
          timer = setTimeout(() => {
            responseWaiters.delete(waiter);
            waiter.cleanup();
            resolve();
          }, remaining);
          responseWaiters.add(waiter);
          signal?.addEventListener('abort', onAbort, { once: true });
        });
        signal?.throwIfAborted();
        if (disposed) throw new Error('Weather fixture delivery is disposed.');
      }
      return true;
    },
    dispose,
    summarize(populationsBefore, populationsAfter) {
      if (routeErrors.length)
        throw new Error('Weather fixture observed malformed source routes.');
      const expectedPopulations = Object.entries(fixture.expectedLayerCounts)
        .map(([id, count]) => ({ id, enabled: true, count }))
        .sort((a, b) => a.id.localeCompare(b.id));
      const enabled = (rows) =>
        (rows || [])
          .filter((row) => row.enabled === true)
          .map(({ id, enabled, count }) => ({ id, enabled, count }))
          .sort((a, b) => String(a.id).localeCompare(String(b.id)));
      assert.deepEqual(enabled(populationsBefore), expectedPopulations);
      assert.deepEqual(enabled(populationsAfter), expectedPopulations);
      for (const product of Object.keys(fixture.manifests)) {
        assert.ok(responses.get(`${product}-manifest`)?.count > 0);
        for (
          let index = 0;
          index < fixture.manifests[product].times.length;
          index++
        )
          assert.ok(responses.get(`${product}-tile-${index}`)?.count > 0);
      }
      for (const id of ['wind-manifest', 'wind-grid'])
        assert.ok(responses.get(id)?.count > 0);
      return {
        schema: 'gev-weather-effects-fixture-delivery/v1',
        status: 'observed',
        workloadId: fixture.workloadId,
        fixtureSha256: fixture.manifestSha256,
        fixedTime: fixture.fixedTime,
        assets: fixture.assets.map((asset) => ({
          id: asset.id,
          sha256: asset.sha256,
          byteLength: asset.byteLength,
          contentType: asset.contentType,
          responseCount: responses.get(asset.id)?.count || 0,
        })),
        populationsBefore: expectedPopulations,
        populationsAfter: expectedPopulations,
        routeErrors: [],
      };
    },
    snapshot() {
      return Object.fromEntries(
        [...responses].map(([id, value]) => [id, value.count]),
      );
    },
    routeErrors,
  };
}

export function assertWeatherEffectsClock(observation, fixture, label) {
  assert.equal(
    observation?.wallClockEpochMs,
    fixture.fixedTimeMs,
    `${label}: wall clock drifted`,
  );
  assert.equal(
    observation?.cesiumClock?.currentTime?.dayNumber,
    fixture.clock.dayNumber,
    `${label}: Cesium day changed`,
  );
  assert.ok(
    Math.abs(
      observation.cesiumClock.currentTime.secondsOfDay -
        fixture.clock.secondsOfDay,
    ) < 1e-6,
    `${label}: Cesium time changed`,
  );
  assert.equal(
    observation.cesiumClock.shouldAnimate,
    false,
    `${label}: Cesium clock animation changed`,
  );
  assert.equal(
    observation.cesiumClock.multiplier,
    0,
    `${label}: Cesium clock multiplier changed`,
  );
}

export function assertWeatherEffectsWindState(params, stats) {
  assert.equal(params?.model, 'gfs', 'Weather fixture must use the GFS model.');
  assert.equal(
    params?.overlay,
    'speed',
    'Weather fixture must show wind speed.',
  );
  assert.equal(
    params?.paused,
    false,
    'Weather fixture wind animation must be active.',
  );
  assert.equal(
    stats?.loading,
    false,
    'Weather fixture wind field must be ready.',
  );
}

export function createWeatherEffectsFixtureLifecycle({
  fixture,
  cameraObservation,
  timelinePreflight,
}) {
  if (fixture?.schema !== 'gev-weather-effects-fixture/v1')
    throw new TypeError('A registered weather-effects fixture is required.');
  if (
    !Array.isArray(timelinePreflight?.selectedTimes) ||
    !Array.isArray(timelinePreflight?.sourceObservationTimes) ||
    timelinePreflight.sourceObservationTimes.length !== 3
  )
    throw new TypeError('Observed weather timeline evidence is incomplete.');
  return {
    scope:
      'one measured app document; bundled deterministic manifests, time-indexed imagery tiles and GFS grid are fulfilled only for exact same-origin GET routes; all three advertised history frames are selected through application timeline controls before timed samples',
    fixedHarnessClock:
      'Date.now and Cesium currentTime are pinned to the declared UTC fixture epoch; weather observation timestamps remain source times and wind animation remains enabled',
    camera: structuredClone(fixture.camera),
    observedCamera: structuredClone(cameraObservation),
    playback: structuredClone(timelinePreflight.playback),
    timeline: structuredClone(timelinePreflight.selectedTimes),
    sourceObservationTimes: structuredClone(
      timelinePreflight.sourceObservationTimes,
    ),
    freshBrowserContextPerSample: false,
    performanceAcceptanceEligible: false,
  };
}
