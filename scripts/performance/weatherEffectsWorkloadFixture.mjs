import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as Cesium from 'cesium';
import { validateWeatherSnapshot } from '../../src/layers/weather/source.js';

export const WEATHER_EFFECTS_WORKLOAD_ID = 'austin-weather-effects-phased-v2';
export const WEATHER_EFFECTS_FIXED_TIME = '2026-10-08T12:00:00.000Z';
export const WEATHER_EFFECTS_PHASE_POLICY = Object.freeze({
  schema: 'gev-weather-phase-schedule/v1',
  measurementMs: 60_000,
  offsetsMs: Object.freeze([0, 20_000, 40_000]),
  maximumLatenessMs: 5_000,
});
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
export const WEATHER_EFFECTS_MOTION_PREFERENCE_SCHEMA =
  'gev-weather-motion-preference/v1';
export const WEATHER_EFFECTS_MEDIA_PREFERENCES = Object.freeze({
  'prefers-reduced-motion': 'no-preference',
});

/** Pin the ephemeral benchmark document to the condition that keeps weather history advancing. */
export async function configureWeatherEffectsMotionPreference(page) {
  assert.equal(typeof page?.emulateMediaFeatures, 'function');
  await page.emulateMediaFeatures([
    { name: 'prefers-reduced-motion', value: 'no-preference' },
  ]);
}

/** Read only the media preference used by the weather clock's suspension policy. */
export function observeWeatherEffectsMotionPreference() {
  const reducedMotion =
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
      : null;
  return {
    schema: 'gev-weather-motion-preference/v1',
    reducedMotion,
  };
}

export function assertWeatherEffectsMotionPreference(observation, label) {
  assert.equal(observation?.schema, WEATHER_EFFECTS_MOTION_PREFERENCE_SCHEMA);
  assert.equal(
    observation?.reducedMotion,
    false,
    `${label}: reduced motion must be disabled`,
  );
  return observation;
}

/** Attach a preflight observation only to an already-owned failure record. */
export function recordWeatherMotionPreferencePreflight(
  failureProgress,
  observation,
) {
  if (failureProgress?.current)
    failureProgress.current.weatherMotionPreferencePreflight = observation;
}

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
    schema: 'gev-weather-effects-fixture/v2',
    id: 'weather-effects-austin-phased-v2',
    workloadId: WEATHER_EFFECTS_WORKLOAD_ID,
    mediaPreferences: { ...WEATHER_EFFECTS_MEDIA_PREFERENCES },
    fixedTime,
    timeline: [...manifests.radar.times],
    phaseSchedule: {
      ...WEATHER_EFFECTS_PHASE_POLICY,
      offsetsMs: [...WEATHER_EFFECTS_PHASE_POLICY.offsetsMs],
      phases: manifests.radar.times.map((sourceTime, index) => ({
        id: ['early-history', 'middle-history', 'latest-history'][index],
        timelineIndex: index,
        sourceTime,
        offsetMs: WEATHER_EFFECTS_PHASE_POLICY.offsetsMs[index],
      })),
    },
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

function requestMethod(request) {
  const method = request?.method;
  return typeof method === 'function' ? method.call(request) : method;
}

function safeWeatherRequestIdentity(url, request) {
  const method = requestMethod(request);
  const safeMethod =
    typeof method === 'string' && /^[A-Z]{1,12}$/.test(method)
      ? method
      : 'INVALID-METHOD';
  const knownPaths = new Map([
    ['/api/weather/manifest', 'api.weather.manifest'],
    ['/api/weather/tile', 'api.weather.tile'],
    ['/api/wind/manifest', 'api.wind.manifest'],
    ['/api/wind/grid/gfs-weather-effects-v1.bin', 'api.wind.grid'],
  ]);
  const safePath = knownPaths.get(url.pathname) || 'api.weather-or-wind.other';
  const allowedKeys = new Set([
    'product',
    'time',
    'z',
    'x',
    'y',
    'size',
    'bbox',
    'model',
  ]);
  const entries = [...url.searchParams.entries()];
  const queryKeys = [...new Set(entries.map(([key]) => key))]
    .slice(0, 8)
    .map((key) => (allowedKeys.has(key) ? key : 'other'))
    .sort();
  const safeValues = [];
  for (const key of [
    'product',
    'model',
    'time',
    'z',
    'x',
    'y',
    'size',
    'bbox',
  ]) {
    const values = url.searchParams.getAll(key);
    if (values.length !== 1) continue;
    const value = values[0];
    let safeValue = null;
    if (
      key === 'product' &&
      ['radar', 'clouds', 'clouds-regional', 'lightning'].includes(value)
    )
      safeValue = value;
    else if (key === 'model' && ['gfs', 'ifs'].includes(value))
      safeValue = value;
    else if (
      key === 'time' &&
      /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value)
    )
      safeValue = value;
    else if (['z', 'x', 'y', 'size'].includes(key) && /^\d{1,6}$/.test(value))
      safeValue = value;
    else if (
      key === 'bbox' &&
      /^-?\d{1,3}(?:\.\d{1,8})?(?:,-?\d{1,3}(?:\.\d{1,8})?){3}$/.test(value)
    )
      safeValue = value;
    if (safeValue !== null) safeValues.push(`${key}=${safeValue}`);
  }
  return `${safeMethod} ${safePath} queryKeys=${queryKeys.join(',') || 'none'} unexpectedQueryKeyCount=${entries.filter(([key]) => !allowedKeys.has(key)).length} duplicateQueryKeyCount=${entries.length - new Set(entries.map(([key]) => key)).size}${safeValues.length ? ` ${safeValues.join(' ')}` : ''}`;
}

function isWeatherEffectsRoute(url, origin) {
  return (
    url.origin === origin &&
    /^\/api\/(?:weather|wind)(?:\/|$)/.test(url.pathname)
  );
}

export function createWeatherEffectsFixtureDelivery(fixture, baseUrl) {
  if (fixture?.schema !== 'gev-weather-effects-fixture/v2')
    throw new TypeError('A registered weather-effects fixture is required.');
  const origin = new URL(baseUrl).origin;
  const assets = new Map(fixture.assets.map((asset) => [asset.id, asset]));
  const responses = new Map();
  const routeErrors = [];
  const maxRecords = 8192;
  const responseWaiters = new Set();
  const routeErrorWaiters = new Set();
  let disposed = false;

  function recordRouteError(error, identity) {
    if (routeErrors.length < 32)
      routeErrors.push({ request: identity, message: error.message });
    for (const waiter of routeErrorWaiters) {
      routeErrorWaiters.delete(waiter);
      waiter.cleanup();
      waiter.resolve(error);
    }
  }

  function dispose() {
    if (disposed) return false;
    disposed = true;
    for (const waiter of responseWaiters) {
      waiter.cleanup();
      waiter.reject(new Error('Weather fixture delivery was disposed.'));
    }
    responseWaiters.clear();
    for (const waiter of routeErrorWaiters) {
      waiter.cleanup();
      waiter.reject(new Error('Weather fixture delivery was disposed.'));
    }
    routeErrorWaiters.clear();
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
    if (url.origin !== origin || requestMethod(request) !== 'GET') return null;
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
        if (isWeatherEffectsRoute(url, origin)) {
          const identity = safeWeatherRequestIdentity(url, request);
          const error = new Error(
            `Unexpected or malformed weather-effects fixture request (${identity}).`,
          );
          recordRouteError(error, identity);
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
      if (!id) {
        // Same-origin API fallback responses for unrelated layers are not part
        // of this fixture's delivery inventory. Owned weather/wind paths still
        // fail closed and retain only bounded, allowlisted request identity.
        if (!isWeatherEffectsRoute(url, origin)) return;
        const identity = safeWeatherRequestIdentity(url, { method });
        const error = new Error(
          `Fulfilled weather response has no fixture route (${identity}).`,
        );
        recordRouteError(error, identity);
        throw error;
      }
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
    waitForRouteError({ signal } = {}) {
      if (disposed)
        return Promise.reject(
          new Error('Weather fixture delivery was disposed.'),
        );
      if (routeErrors.length) return Promise.resolve(routeErrors[0]);
      signal?.throwIfAborted();
      return new Promise((resolve, reject) => {
        const onAbort = () => {
          routeErrorWaiters.delete(waiter);
          waiter.cleanup();
          reject(signal.reason || new Error('Weather route wait was aborted.'));
        };
        const waiter = {
          resolve,
          reject,
          cleanup() {
            signal?.removeEventListener('abort', onAbort);
          },
        };
        routeErrorWaiters.add(waiter);
        signal?.addEventListener('abort', onAbort, { once: true });
      });
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
        schema: 'gev-weather-effects-fixture-delivery/v2',
        status: 'observed',
        workloadId: fixture.workloadId,
        method: 'same-origin-hash-pinned-weather-phase-fixture-v2',
        fixtureId: fixture.id,
        fixtureSha256: fixture.manifestSha256,
        fixedTime: fixture.fixedTime,
        phaseSchedule: structuredClone(fixture.phaseSchedule),
        assets: fixture.assets.map((asset) => ({
          id: asset.id,
          sha256: asset.sha256,
          byteLength: asset.byteLength,
          contentType: asset.contentType,
          responseCount: responses.get(asset.id)?.count || 0,
        })),
        populationsBefore: expectedPopulations,
        populationsAfter: expectedPopulations,
        fulfilledResponseCount: [...responses.values()].reduce(
          (sum, row) => sum + row.count,
          0,
        ),
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

/** Small failure-only snapshot for the four selected weather/wind layers. */
export function observeWeatherEffectsLayerState() {
  const motionPreference = {
    schema: 'gev-weather-motion-preference/v1',
    reducedMotion:
      typeof window !== 'undefined' && typeof window.matchMedia === 'function'
        ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
        : null,
  };
  const app = window.__godsEyeView;
  const manager = app?.dataManager;
  if (!manager?.layers?.get || !manager?.getAll)
    return {
      status: 'unavailable',
      layers: [],
      clock: null,
      motionPreference,
    };
  const ids = [
    'weather-radar',
    'weather-satellite',
    'weather-lightning',
    'wind',
  ];
  const rows = new Map(manager.getAll().map((row) => [row.id, row]));
  const layers = ids.map((id) => {
    const row = rows.get(id);
    const module = manager.layers.get(id)?.module;
    const stats = module?.getStats?.();
    const params = module?.getParams?.();
    return {
      id,
      enabled: row?.enabled ?? null,
      count:
        Number.isSafeInteger(row?.stats?.count) && row.stats.count >= 0
          ? row.stats.count
          : null,
      loading: typeof stats?.loading === 'boolean' ? stats.loading : null,
      error:
        typeof stats?.error === 'string' && stats.error
          ? stats.error
              .replace(/https?:\/\/[^\s"'<>]+/gi, '[url]')
              .replace(/\b[A-Za-z]:[\\/][^\s"'<>]+/g, '[path]')
              .replace(/\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi, 'Bearer [redacted]')
              .replace(/\bBasic\s+[A-Za-z0-9+/]+=*/gi, 'Basic [redacted]')
              .replace(
                /\b(token|password|secret|authorization)\b["']?\s*[:=]\s*["']?[^"'&\s,;}\]]+/gi,
                '$1=[redacted]',
              )
              .slice(0, 120)
          : null,
      observedAt:
        typeof stats?.observedAt === 'string' &&
        /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(stats.observedAt)
          ? stats.observedAt
          : null,
      ...(id === 'weather-satellite'
        ? {
            product:
              typeof params?.product === 'string'
                ? params.product.slice(0, 32)
                : null,
            infrared:
              typeof params?.infrared === 'string'
                ? params.infrared.slice(0, 24)
                : null,
          }
        : {}),
      ...(id === 'wind'
        ? {
            model:
              typeof params?.model === 'string'
                ? params.model.slice(0, 16)
                : null,
            overlay:
              typeof params?.overlay === 'string'
                ? params.overlay.slice(0, 24)
                : null,
            paused: typeof params?.paused === 'boolean' ? params.paused : null,
          }
        : {}),
    };
  });
  const clock = manager.layers
    .get('weather-radar')
    ?.module?.getDiagnostics?.()?.clock;
  return {
    status: 'observed',
    layers,
    motionPreference,
    clock: clock
      ? {
          mode: typeof clock.mode === 'string' ? clock.mode.slice(0, 16) : null,
          target: typeof clock.target === 'string' ? clock.target : null,
          playing: typeof clock.playing === 'boolean' ? clock.playing : null,
        }
      : null,
  };
}

export async function waitForWeatherEffectsReadiness(
  page,
  { expectedLayerCounts, selectedLayerIds },
  delivery,
  timeoutMs,
) {
  const abortController = new AbortController();
  let ownedHandle = null;
  let handleDisposal = null;
  let primaryError = null;
  const disposeOwnedHandle = () => {
    if (!ownedHandle) return Promise.resolve();
    handleDisposal ||= Promise.resolve().then(() => ownedHandle.dispose());
    return handleDisposal;
  };
  try {
    const result = await Promise.race([
      page
        .waitForFunction(
          ({ expected, selectedLayerIds }) => {
            const manager = window.__godsEyeView?.dataManager;
            const rows = manager?.getAll?.() || [];
            const states = selectedLayerIds.map((id) => {
              const row = rows.find((item) => item.id === id);
              const stats = manager?.layers?.get(id)?.module?.getStats?.();
              return {
                id,
                enabled: row?.enabled ?? null,
                count:
                  Number.isSafeInteger(row?.stats?.count) &&
                  row.stats.count >= 0
                    ? row.stats.count
                    : null,
                loading:
                  typeof stats?.loading === 'boolean' ? stats.loading : null,
                error:
                  typeof stats?.error === 'string'
                    ? stats.error.slice(0, 120)
                    : null,
                observedAt:
                  typeof stats?.observedAt === 'string'
                    ? stats.observedAt.slice(0, 40)
                    : null,
              };
            });
            if (states.some((state) => state.enabled && state.error))
              return { status: 'failed', layers: states };
            const ready = Object.entries(expected).every(([id, count]) => {
              const layer = rows.find((row) => row.id === id);
              return (
                layer?.enabled === true &&
                layer?.stats?.count === count &&
                layer?.stats?.loading === false &&
                !layer?.stats?.error
              );
            });
            return ready ? { status: 'ready', layers: states } : false;
          },
          {
            timeout: timeoutMs,
            polling: 100,
            signal: abortController.signal,
          },
          { expected: expectedLayerCounts, selectedLayerIds },
        )
        .then(async (handle) => {
          ownedHandle = handle;
          if (abortController.signal.aborted) {
            await disposeOwnedHandle();
            throw new Error('Weather readiness wait was aborted.');
          }
          return { kind: 'readiness', handle };
        }),
      delivery
        .waitForRouteError({ signal: abortController.signal })
        .then((routeError) => ({ kind: 'route-error', routeError })),
    ]);
    if (result.kind === 'route-error')
      throw new Error(
        `Weather fixture interception failed: ${result.routeError.message}`,
      );
    return await result.handle.jsonValue();
  } catch (error) {
    primaryError = error;
    throw error;
  } finally {
    abortController.abort();
    try {
      await disposeOwnedHandle();
    } catch (error) {
      if (!primaryError) throw error;
    }
  }
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
  workload,
  phaseObservationsBySample,
}) {
  if (fixture?.schema !== 'gev-weather-effects-fixture/v2')
    throw new TypeError('A registered weather-effects fixture is required.');
  if (
    !Array.isArray(timelinePreflight?.selectedTimes) ||
    !Array.isArray(timelinePreflight?.sourceObservationTimes) ||
    timelinePreflight.sourceObservationTimes.length !== 3
  )
    throw new TypeError('Observed weather timeline evidence is incomplete.');
  assert.deepEqual(
    timelinePreflight.selectedTimes,
    [fixture.timeline.at(-1), ...fixture.timeline, fixture.timeline.at(-1)].map(
      (time) => Array(3).fill(time),
    ),
    'Weather startup, ordered history, and latest reset must match the fixture timeline.',
  );
  assert.ok(
    Array.isArray(phaseObservationsBySample) &&
      phaseObservationsBySample.length === workload?.runsPerScenario * 2,
    'Observed weather phase runs are incomplete.',
  );
  for (const observations of phaseObservationsBySample)
    assertWeatherPhaseRunSet(observations, fixture, {
      durationMs: workload?.durationPerSampleMs,
    });
  return {
    scope:
      'one measured app document; bundled deterministic manifests, time-indexed imagery tiles and GFS grid are fulfilled only for exact same-origin GET routes; every 60-second capture selects the three pinned source phases through application timeline controls at fixed measurement-relative offsets',
    fixedHarnessClock:
      'Date.now and Cesium currentTime are pinned to the declared UTC fixture epoch; native history playback is paused, source timestamps are selected on the declared measurement-relative schedule, and wind animation remains enabled',
    camera: structuredClone(fixture.camera),
    observedCamera: structuredClone(cameraObservation),
    playback: structuredClone(timelinePreflight.playback),
    timeline: structuredClone(timelinePreflight.selectedTimes),
    sourceObservationTimes: structuredClone(
      timelinePreflight.sourceObservationTimes,
    ),
    phaseSchedule: structuredClone(fixture.phaseSchedule),
    phaseObservationsBySample: structuredClone(phaseObservationsBySample),
    freshBrowserContextPerSample: false,
  };
}

export function assertWeatherPhaseRunSet(
  phaseObservations,
  fixture,
  options = {},
) {
  assert.equal(fixture?.schema, 'gev-weather-effects-fixture/v2');
  const schedule = fixture.phaseSchedule;
  const durationMs = options.durationMs;
  assert.equal(durationMs, WEATHER_EFFECTS_PHASE_POLICY.measurementMs);
  assert.equal(phaseObservations?.schema, 'gev-weather-phase-observations/v1');
  assert.equal(phaseObservations.durationMs, durationMs);
  assert.equal(phaseObservations.fixtureSha256, fixture.sha256);
  assert.equal(phaseObservations.phases?.length, schedule.phases.length);
  for (const [index, phase] of schedule.phases.entries()) {
    const observed = phaseObservations.phases[index];
    assert.equal(observed.id, phase.id);
    assert.equal(observed.fixtureSha256, fixture.sha256);
    assert.equal(observed.expectedSourceTime, phase.sourceTime);
    assert.equal(observed.scheduledAtMs, phase.offsetMs);
    assert.ok(Number.isFinite(observed.observedAtElapsedMs));
    assert.ok(observed.observedAtElapsedMs >= phase.offsetMs);
    assert.ok(
      observed.observedAtElapsedMs <=
        phase.offsetMs + schedule.maximumLatenessMs,
      `Weather phase ${phase.id} was late.`,
    );
    assert.deepEqual(
      observed.sourceObservationTimes,
      Array(3).fill(phase.sourceTime),
    );
    assert.deepEqual(observed.clock, { mode: 'history', playing: false });
    if (index > 0)
      assert.ok(
        observed.observedAtElapsedMs >
          phaseObservations.phases[index - 1].observedAtElapsedMs,
      );
  }
  return true;
}

/** Reset the real timeline to latest and wait for exact, paused source state. */
export async function resetWeatherEffectsToLatestInPage({
  fixtureSha256,
  expectedSourceTime,
  timeoutMs = 5_000,
} = {}) {
  const app = window.__godsEyeView;
  const root = document.querySelector('.weather-readout');
  const latest = root?.querySelector(
    'button[title="Newest frame per product"]',
  );
  if (
    !app?.dataManager?.layers?.get ||
    !latest ||
    typeof fixtureSha256 !== 'string' ||
    !/^[a-f0-9]{64}$/.test(fixtureSha256) ||
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < 1 ||
    timeoutMs > 5_000 ||
    typeof expectedSourceTime !== 'string' ||
    !Number.isFinite(Date.parse(expectedSourceTime))
  )
    throw new Error('Weather latest reset inputs are invalid.');

  const readTimes = () =>
    ['weather-radar', 'weather-satellite', 'weather-lightning'].map(
      (id) =>
        app.dataManager.layers.get(id)?.module?.getStats?.()?.observedAt ??
        null,
    );
  const readClock = () =>
    app.dataManager.layers.get('weather-radar')?.module?.getDiagnostics?.()
      ?.clock;
  const deadline = performance.now() + timeoutMs;
  latest.click();
  let sourceObservationTimes = readTimes();
  let clock = readClock();
  while (
    (clock?.mode !== 'latest' ||
      clock?.playing !== false ||
      !sourceObservationTimes.every((time) => time === expectedSourceTime)) &&
    performance.now() < deadline
  ) {
    await new Promise((resolve) => setTimeout(resolve, 25));
    sourceObservationTimes = readTimes();
    clock = readClock();
  }
  if (
    clock?.mode !== 'latest' ||
    clock?.playing !== false ||
    !sourceObservationTimes.every((time) => time === expectedSourceTime)
  )
    throw new Error(
      'Weather sample reset did not settle at the latest source.',
    );
  return {
    fixtureSha256,
    mode: clock.mode,
    playing: clock.playing,
    target: clock.target,
    sourceObservationTimes,
  };
}

export async function resetWeatherEffectsToLatest({
  page,
  fixture,
  timeoutMs = 5_000,
} = {}) {
  if (
    !page?.evaluate ||
    fixture?.schema !== 'gev-weather-effects-fixture/v2' ||
    !fixture.timeline?.length ||
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < 1 ||
    timeoutMs > 5_000
  )
    throw new TypeError('Weather sample reset inputs are invalid.');
  return page.evaluate(resetWeatherEffectsToLatestInPage, {
    fixtureSha256: fixture.sha256,
    expectedSourceTime: fixture.timeline.at(-1),
    timeoutMs,
  });
}

/** Prime all three pinned source phases through the real observed-history UI. */
export async function prepareWeatherEffectsTimeline({
  page,
  fixture,
  timeoutMs = 15_000,
} = {}) {
  if (
    !page?.evaluate ||
    fixture?.schema !== 'gev-weather-effects-fixture/v2' ||
    !/^[a-f0-9]{64}$/.test(fixture.sha256) ||
    !Array.isArray(fixture.timeline) ||
    fixture.timeline.length !== 3 ||
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < 1 ||
    timeoutMs > 15_000
  )
    throw new TypeError('Weather timeline preflight inputs are invalid.');
  return page.evaluate(prepareWeatherEffectsTimelineInPage, {
    fixtureSha256: fixture.sha256,
    timeline: fixture.timeline,
    timeoutMs,
  });
}

export async function prepareWeatherEffectsTimelineInPage({
  fixtureSha256,
  timeline,
  timeoutMs,
} = {}) {
  const app = window.__godsEyeView;
  const root = document.querySelector('.weather-readout');
  const slider = root?.querySelector('input[aria-label="Observed history"]');
  const latest = root?.querySelector(
    'button[title="Newest frame per product"]',
  );
  const play = root?.querySelector('button[title="Replay observed history"]');
  const productIds = [
    'weather-radar',
    'weather-satellite',
    'weather-lightning',
  ];
  if (
    !app?.dataManager?.layers?.get ||
    !slider ||
    !latest ||
    !play ||
    typeof fixtureSha256 !== 'string' ||
    !/^[a-f0-9]{64}$/.test(fixtureSha256) ||
    !Array.isArray(timeline) ||
    timeline.length !== 3 ||
    !timeline.every((time) => typeof time === 'string') ||
    new Set(timeline).size !== 3 ||
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < 1 ||
    timeoutMs > 15_000
  )
    throw new Error('Weather timeline preflight controls are unavailable.');
  const readTimes = () =>
    productIds.map(
      (id) =>
        app.dataManager.layers.get(id)?.module?.getStats?.()?.observedAt ??
        null,
    );
  const readClock = () =>
    app.dataManager.layers.get('weather-radar')?.module?.getDiagnostics?.()
      ?.clock;
  const readHistoryFrames = () =>
    productIds.map(
      (id) =>
        app.dataManager.layers.get(id)?.module?.getDiagnostics?.()
          ?.historyFrames ?? null,
    );
  const waitForState = async (sourceTime, mode) => {
    const deadline = performance.now() + timeoutMs;
    let times = readTimes();
    let clock = readClock();
    while (performance.now() < deadline) {
      if (
        times.every((time) => time === sourceTime) &&
        clock?.mode === mode &&
        clock?.playing === false &&
        (mode !== 'history' || clock?.target === sourceTime)
      )
        return { times, clock };
      await new Promise((resolve) => setTimeout(resolve, 25));
      times = readTimes();
      clock = readClock();
    }
    throw new Error(
      `Weather timeline preflight did not settle at ${mode}:${sourceTime}.`,
    );
  };
  const failIfTimelineIncomplete = () => {
    const sliderMaximum = Number(slider.max);
    const historyFrames = readHistoryFrames();
    if (
      sliderMaximum !== timeline.length - 1 ||
      historyFrames.some((count) => count !== timeline.length)
    ) {
      const observed = {
        sliderMaximum: Number.isSafeInteger(sliderMaximum)
          ? sliderMaximum
          : null,
        historyFrames: historyFrames.map((count) =>
          Number.isSafeInteger(count) && count >= 0 ? count : null,
        ),
        documentHidden:
          typeof document.hidden === 'boolean' ? document.hidden : null,
        reducedMotion:
          window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches ??
          null,
      };
      throw new Error(
        `Weather history ended before its pinned timeline: ${JSON.stringify(observed)}.`,
      );
    }
  };

  if (play.getAttribute('aria-pressed') === 'true') play.click();
  if (play.getAttribute('aria-pressed') !== 'false')
    throw new Error('Weather history playback must remain paused.');
  latest.click();
  const latestState = await waitForState(timeline.at(-1), 'latest');
  failIfTimelineIncomplete();
  const phases = [];
  for (const [timelineIndex, sourceTime] of timeline.entries()) {
    failIfTimelineIncomplete();
    slider.value = String(timelineIndex);
    slider.dispatchEvent(new Event('change', { bubbles: true }));
    const selected = await waitForState(sourceTime, 'history');
    phases.push({
      timelineIndex,
      sourceTime,
      sourceObservationTimes: selected.times,
      clock: { mode: selected.clock.mode, playing: selected.clock.playing },
      fixtureSha256,
    });
  }
  latest.click();
  const reset = await waitForState(timeline.at(-1), 'latest');
  if (play.getAttribute('aria-pressed') !== 'false')
    throw new Error('Weather history playback must remain paused.');
  const windLayer = app.dataManager.layers.get('wind')?.module;
  const wind = windLayer?.getParams?.();
  const windStats = windLayer?.getStats?.();
  const productLayers = productIds.map(
    (id) => app.dataManager.layers.get(id)?.module,
  );
  const productStats = productLayers.map((layer) => layer?.getStats?.());
  const satelliteParams = productLayers[1]?.getParams?.();
  const radarParams = productLayers[0]?.getParams?.();
  const lightningParams = productLayers[2]?.getParams?.();
  // This callback is serialized into the page; keep the compatibility adapter
  // self-contained, and leave the runtime parameters unchanged.
  const satelliteInfrared =
    satelliteParams?.infrared === 'filtered' ||
    satelliteParams?.infrared === 100
      ? 'filtered'
      : null;
  const productObservations = productStats.map((stats) => ({
    observedAt:
      typeof stats?.observedAt === 'string'
        ? stats.observedAt.slice(0, 64)
        : null,
  }));
  const mismatch =
    !wind ||
    typeof wind.model !== 'string' ||
    wind.model.toLowerCase() !== 'gfs' ||
    wind.overlay !== 'speed' ||
    wind.paused !== false ||
    satelliteParams?.product !== 'clouds-regional' ||
    satelliteInfrared !== 'filtered' ||
    radarParams?.opacity !== 'strong' ||
    lightningParams?.opacity !== 'strong' ||
    productStats.some((stats) => !timeline.includes(stats?.observedAt));
  if (mismatch) {
    const observed = {
      wind: {
        model: typeof wind?.model === 'string' ? wind.model.slice(0, 16) : null,
        overlay:
          typeof wind?.overlay === 'string' ? wind.overlay.slice(0, 16) : null,
        paused: typeof wind?.paused === 'boolean' ? wind.paused : null,
      },
      satellite: {
        product:
          typeof satelliteParams?.product === 'string'
            ? satelliteParams.product.slice(0, 32)
            : null,
        infrared: Number.isFinite(satelliteParams?.infrared)
          ? satelliteParams.infrared
          : typeof satelliteParams?.infrared === 'string'
            ? satelliteParams.infrared.slice(0, 32)
            : null,
      },
      radarOpacity:
        typeof radarParams?.opacity === 'string'
          ? radarParams.opacity.slice(0, 16)
          : null,
      lightningOpacity:
        typeof lightningParams?.opacity === 'string'
          ? lightningParams.opacity.slice(0, 16)
          : null,
      productObservations,
      expectedTimeline: timeline
        .slice(0, 12)
        .map((time) => String(time).slice(0, 64)),
    };
    throw new Error(
      `Weather history or wind playback state did not match the fixture: ${JSON.stringify(observed)}.`,
    );
  }
  return {
    schema: 'gev-weather-history-preflight/v1',
    fixtureSha256,
    startup: {
      sourceObservationTimes: latestState.times,
      clock: {
        mode: latestState.clock.mode,
        playing: latestState.clock.playing,
      },
    },
    phases,
    reset: {
      sourceObservationTimes: reset.times,
      clock: { mode: reset.clock.mode, playing: reset.clock.playing },
    },
    selectedTimes: [
      latestState.times,
      ...phases.map(({ sourceObservationTimes }) => sourceObservationTimes),
      reset.times,
    ],
    playback: {
      mode: reset.clock.mode,
      playing: reset.clock.playing,
      displayedAtStart: reset.times,
      visualState: {
        satelliteProduct: satelliteParams.product,
        satelliteInfrared,
        radarOpacity: radarParams.opacity,
        lightningOpacity: lightningParams.opacity,
        windModel: wind.model.toLowerCase(),
        windOverlay: wind.overlay,
        windPaused: wind.paused,
      },
    },
    sourceObservationTimes: productStats.map((stats) => stats.observedAt),
    wind: { params: wind, stats: windStats },
  };
}

/** Select one pinned weather source phase through the page's visible timeline controls. */
export async function selectWeatherEffectsPhaseInPage({
  phase,
  fixtureSha256,
  maximumLatenessMs,
  measurementStartedAt,
} = {}) {
  const startedAt = measurementStartedAt;
  const app = window.__godsEyeView;
  const root = document.querySelector('.weather-readout');
  const slider = root?.querySelector('input[aria-label="Observed history"]');
  const play = root?.querySelector('button[title="Replay observed history"]');
  if (window.__gevWeatherMeasurementStartedAt !== startedAt)
    throw new Error('Weather phase selection outlived its measurement owner.');
  if (
    !Number.isFinite(startedAt) ||
    !app?.dataManager?.layers?.get ||
    !slider ||
    !play ||
    !phase ||
    !Number.isInteger(phase.timelineIndex) ||
    phase.timelineIndex < 0 ||
    phase.timelineIndex > 2 ||
    typeof phase.sourceTime !== 'string' ||
    typeof fixtureSha256 !== 'string' ||
    !/^[a-f0-9]{64}$/.test(fixtureSha256) ||
    !Number.isFinite(maximumLatenessMs) ||
    maximumLatenessMs <= 0
  )
    throw new Error('Weather phase selection inputs are invalid.');
  const readTimes = () =>
    ['weather-radar', 'weather-satellite', 'weather-lightning'].map(
      (id) =>
        app.dataManager.layers.get(id)?.module?.getStats?.()?.observedAt ??
        null,
    );
  const readClock = () =>
    app.dataManager.layers.get('weather-radar')?.module?.getDiagnostics?.()
      ?.clock;
  const boundedWeatherPhaseContext = (observedAtElapsedMs, deadlineAtMs) => {
    const clock = readClock();
    const boundedTime = (value) =>
      typeof value === 'string' &&
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value)
        ? value
        : null;
    const boundedPhaseId = (value) =>
      typeof value === 'string' &&
      /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(value)
        ? value
        : null;
    const boundedSlider = (value) =>
      typeof value === 'string' && /^\d{1,8}$/.test(value) ? value : null;
    return JSON.stringify({
      expectedSourceTimes: Array(3).fill(boundedTime(phase.sourceTime)),
      observedSourceTimes: sourceObservationTimes.map(boundedTime),
      elapsedMs: Number.isFinite(observedAtElapsedMs)
        ? observedAtElapsedMs
        : null,
      phase: {
        id: boundedPhaseId(phase.id),
        offsetMs: Number.isFinite(phase.offsetMs) ? phase.offsetMs : null,
      },
      deadline: {
        elapsedMs: Number.isFinite(deadlineAtMs - startedAt)
          ? deadlineAtMs - startedAt
          : null,
        absoluteMs: Number.isFinite(deadlineAtMs) ? deadlineAtMs : null,
      },
      clock: {
        mode: ['history', 'latest'].includes(clock?.mode) ? clock.mode : null,
        target: boundedTime(clock?.target),
        playing: typeof clock?.playing === 'boolean' ? clock.playing : null,
      },
      slider: {
        value: boundedSlider(slider.value),
        max: boundedSlider(slider.max),
      },
      fixtureSha256:
        typeof fixtureSha256 === 'string' &&
        /^[a-f0-9]{64}$/.test(fixtureSha256)
          ? fixtureSha256
          : null,
    });
  };
  const assertMeasurementOwner = () => {
    if (window.__gevWeatherMeasurementStartedAt !== startedAt)
      throw new Error(
        'Weather phase selection outlived its measurement owner.',
      );
  };
  if (play.getAttribute('aria-pressed') === 'true')
    throw new Error('Native weather playback must remain paused.');
  const targetElapsedMs = startedAt + phase.offsetMs;
  if (performance.now() < targetElapsedMs)
    await new Promise((resolve) =>
      setTimeout(resolve, targetElapsedMs - performance.now()),
    );
  assertMeasurementOwner();
  const deadline = targetElapsedMs + maximumLatenessMs;
  let sourceObservationTimes = readTimes();
  if (Number(slider.max) !== 2)
    throw new Error(
      `Weather timeline no longer has the three pinned phases. context=${boundedWeatherPhaseContext(
        performance.now() - startedAt,
        deadline,
      )}`,
    );
  slider.value = String(phase.timelineIndex);
  slider.dispatchEvent(new Event('change', { bubbles: true }));
  sourceObservationTimes = readTimes();
  while (
    !sourceObservationTimes.every((time) => time === phase.sourceTime) &&
    performance.now() < deadline
  ) {
    assertMeasurementOwner();
    await new Promise((resolve) => setTimeout(resolve, 25));
    assertMeasurementOwner();
    sourceObservationTimes = readTimes();
  }
  assertMeasurementOwner();
  const observedAtElapsedMs = performance.now() - startedAt;
  const clock = readClock();
  if (
    !sourceObservationTimes.every((time) => time === phase.sourceTime) ||
    observedAtElapsedMs < phase.offsetMs ||
    observedAtElapsedMs > phase.offsetMs + maximumLatenessMs ||
    clock?.mode !== 'history' ||
    clock?.target !== phase.sourceTime ||
    clock?.playing !== false
  )
    throw new Error(
      `Weather phase ${phase.id} was missing, late or wrong. context=${boundedWeatherPhaseContext(
        observedAtElapsedMs,
        deadline,
      )}`,
    );
  return {
    id: phase.id,
    expectedSourceTime: phase.sourceTime,
    scheduledAtMs: phase.offsetMs,
    observedAtElapsedMs,
    sourceObservationTimes,
    clock: { mode: clock.mode, playing: clock.playing },
    fixtureSha256,
  };
}

/** Run the host-owned weather phase schedule while observing capture settlement. */
export async function runWeatherEffectsPhaseSchedule({
  page,
  fixture,
  samplePromise,
  now = () => performance.now(),
  schedule = (callback, delayMs) => setTimeout(callback, delayMs),
  cancel = (handle) => clearTimeout(handle),
} = {}) {
  if (
    !page?.waitForFunction ||
    !page?.evaluate ||
    fixture?.schema !== 'gev-weather-effects-fixture/v2' ||
    !samplePromise ||
    typeof now !== 'function' ||
    typeof schedule !== 'function' ||
    typeof cancel !== 'function'
  )
    throw new TypeError('Weather phase schedule inputs are invalid.');

  const sampleSettlement = Promise.resolve(samplePromise).then(
    (value) => ({ status: 'fulfilled', value }),
    (error) => ({ status: 'rejected', error }),
  );
  let pendingEvaluation = null;
  const beforeSampleSettles = async (operation, label) => {
    const winner = await Promise.race([
      Promise.resolve(operation).then(
        (value) => ({ source: 'operation', status: 'fulfilled', value }),
        (error) => ({ source: 'operation', status: 'rejected', error }),
      ),
      sampleSettlement.then((settlement) => ({
        source: 'sample',
        ...settlement,
      })),
    ]);
    if (winner.source === 'sample') {
      if (winner.status === 'rejected') throw winner.error;
      throw new Error(`Capture completed before ${label}.`);
    }
    if (winner.status === 'rejected') throw winner.error;
    return winner.value;
  };

  try {
    await beforeSampleSettles(
      page.waitForFunction(
        () => Number.isFinite(window.__gevWeatherMeasurementStartedAt),
        { timeout: 5_000, polling: 20 },
      ),
      'weather measurement start',
    );
    const measurementStartedAt = await beforeSampleSettles(
      page.evaluate(() => window.__gevWeatherMeasurementStartedAt),
      'weather measurement owner capture',
    );
    if (!Number.isFinite(measurementStartedAt))
      throw new Error('Weather measurement owner is unavailable.');
    const scheduleStartedAt = now();
    const phases = [];
    for (const phase of fixture.phaseSchedule.phases) {
      const delayMs = scheduleStartedAt + phase.offsetMs - now();
      if (delayMs > 0) {
        let timer = null;
        try {
          await beforeSampleSettles(
            new Promise((resolve) => {
              timer = schedule(resolve, delayMs);
            }),
            `weather phase ${phase.id}`,
          );
        } finally {
          if (timer !== null) cancel(timer);
        }
      }
      pendingEvaluation = page.evaluate(selectWeatherEffectsPhaseInPage, {
        phase,
        fixtureSha256: fixture.sha256,
        maximumLatenessMs: fixture.phaseSchedule.maximumLatenessMs,
        measurementStartedAt,
      });
      const phaseEvaluation = pendingEvaluation;
      void phaseEvaluation.then(
        () => {
          if (pendingEvaluation === phaseEvaluation) pendingEvaluation = null;
        },
        () => {
          if (pendingEvaluation === phaseEvaluation) pendingEvaluation = null;
        },
      );
      phases.push(
        await beforeSampleSettles(phaseEvaluation, `weather phase ${phase.id}`),
      );
    }
    return {
      schema: 'gev-weather-phase-observations/v1',
      durationMs: fixture.phaseSchedule.measurementMs,
      fixtureSha256: fixture.sha256,
      phases,
    };
  } catch (error) {
    await page
      .evaluate(() => window.__gevWeatherMeasurementAbort?.())
      .catch(() => {});
    await pendingEvaluation?.catch(() => {});
    throw error;
  }
}
