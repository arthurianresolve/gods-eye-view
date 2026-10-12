import assert from 'node:assert/strict';
import * as Cesium from 'cesium';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../..',
);
const MAX_ASSET_BYTES = 8 * 1024 * 1024;
const SHA256 = /^[a-f0-9]{64}$/;

const ASSETS = Object.freeze({
  datacenters: Object.freeze({
    id: 'datacenters.geojsonl',
    path: 'src/data/local_data/datacenters/datacenters.geojsonl',
    sha256: '089144857a5ca001b0238c8f9316a3cc229b6c79a73558ac2660e206e0e59968',
    byteLength: 2_561_978,
    sourceFeatureCount: 4_351,
  }),
  dams: Object.freeze({
    id: 'dams.geojsonl',
    path: 'src/data/local_data/dams/dams.geojsonl',
    sha256: 'f2b6f3166bee6dba4f0b569553a14c84faeb0048eb522bacd4d9c78e93d30d30',
    byteLength: 730_280,
    sourceFeatureCount: 704,
  }),
  cables: Object.freeze({
    id: 'cable-geo.json',
    path: 'src/data/local_data/telegeography_submarine_cables/cable-geo.json',
    sha256: '3d28db104e57982e7ae67fabe66f2ff8dc01e137458454e0de0032a8878c6bad',
    byteLength: null,
    sourceFeatureCount: 712,
  }),
  landings: Object.freeze({
    id: 'landing-point-geo.json',
    path: 'src/data/local_data/telegeography_submarine_cables/landing-point-geo.json',
    sha256: '11fc154189db51237099ffe1da2183984d666a906e5ed0e89b86421192eb622b',
    byteLength: null,
    sourceFeatureCount: 1_917,
  }),
});

const LAYERS = Object.freeze({
  'infrastructure-datacenters': Object.freeze({
    workloadId: 'infrastructure-datacenters',
    id: 'bundled-datacenters-static-v1',
    layerCounts: Object.freeze({ 'local-datacenters': 4_362 }),
    assets: Object.freeze(['datacenters']),
  }),
  'infrastructure-dams': Object.freeze({
    workloadId: 'infrastructure-dams',
    id: 'bundled-dams-static-v1',
    layerCounts: Object.freeze({ 'local-dams': 716 }),
    assets: Object.freeze(['dams']),
  }),
  'infrastructure-cables': Object.freeze({
    workloadId: 'infrastructure-cables',
    id: 'bundled-submarine-cables-static-v1',
    layerCounts: Object.freeze({ 'telegeography-submarine-cables': 2_629 }),
    assets: Object.freeze(['cables', 'landings']),
  }),
  infrastructure: Object.freeze({
    workloadId: 'infrastructure',
    id: 'bundled-infrastructure-static-v1',
    layerCounts: Object.freeze({
      'local-datacenters': 4_362,
      'local-dams': 716,
      'telegeography-submarine-cables': 2_629,
    }),
    assets: Object.freeze(['datacenters', 'dams', 'cables', 'landings']),
  }),
});

export const INFRASTRUCTURE_WORKLOAD_IDS = Object.freeze(Object.keys(LAYERS));

function hash(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function julianClockParts(epochMs) {
  const julian = Cesium.JulianDate.fromDate(new Date(epochMs));
  return { dayNumber: julian.dayNumber, secondsOfDay: julian.secondsOfDay };
}

/** Resolve one explicit static-infrastructure workload against pinned bytes. */
export function createInfrastructureWorkloadFixture(
  workloadId,
  fixedTime = '2026-10-08T12:00:00.000Z',
) {
  if (!Object.hasOwn(LAYERS, workloadId))
    throw new TypeError(`Unsupported infrastructure workload: ${workloadId}`);
  const fixedTimeMs = Date.parse(fixedTime);
  if (
    !Number.isSafeInteger(fixedTimeMs) ||
    new Date(fixedTimeMs).toISOString() !== fixedTime
  )
    throw new TypeError(
      'Infrastructure fixture time must be canonical UTC ISO-8601.',
    );

  const definition = LAYERS[workloadId];
  const assets = definition.assets.map((key) => {
    const asset = ASSETS[key];
    const bytes = readFileSync(path.join(ROOT, ...asset.path.split('/')));
    if (bytes.length > MAX_ASSET_BYTES)
      throw new RangeError(
        `Infrastructure fixture asset ${asset.id} exceeds its bound.`,
      );
    const actualSha256 = hash(bytes);
    if (actualSha256 !== asset.sha256)
      throw new Error(`Infrastructure fixture source changed: ${asset.id}`);
    if (asset.byteLength !== null && bytes.length !== asset.byteLength)
      throw new Error(
        `Infrastructure fixture byte length changed: ${asset.id}`,
      );
    let sourceFeatureCount = asset.sourceFeatureCount;
    if (asset.id.endsWith('.geojsonl'))
      sourceFeatureCount = bytes
        .toString('utf8')
        .split('\n')
        .filter((line) => line.trim()).length;
    else {
      const parsed = JSON.parse(bytes.toString('utf8'));
      sourceFeatureCount = parsed.features?.length;
    }
    if (sourceFeatureCount !== asset.sourceFeatureCount)
      throw new Error(
        `Infrastructure fixture source population changed: ${asset.id}`,
      );
    return {
      id: asset.id,
      path: asset.path,
      sha256: actualSha256,
      byteLength: bytes.length,
      sourceFeatureCount,
    };
  });
  const manifest = {
    schema: 'gev-infrastructure-fixture-manifest/v1',
    id: definition.id,
    workloadId,
    fixedTime: new Date(fixedTimeMs).toISOString(),
    assets,
    expectedLayerCounts: { ...definition.layerCounts },
    camera: {
      id: 'world-infrastructure-overview-v1',
      longitudeDeg: 0,
      latitudeDeg: 0,
      altitudeM: 15_000_000,
      headingDeg: 0,
      pitchDeg: -90,
    },
  };
  const sha256 = hash(Buffer.from(JSON.stringify(manifest)));
  return Object.freeze({
    ...manifest,
    sha256,
    fixedTimeMs,
    clock: julianClockParts(fixedTimeMs),
    selectedLayerIds: Object.keys(definition.layerCounts),
    expectedLayerCounts: Object.freeze({ ...definition.layerCounts }),
    assets: Object.freeze(assets.map((asset) => Object.freeze(asset))),
  });
}

/** Observe only the selected bundled response bodies; never retain source data. */
export function resolveInfrastructureFixtureAssetRoutes(
  fixture,
  receiptAssets,
  baseUrl,
) {
  if (fixture?.schema !== 'gev-infrastructure-fixture-manifest/v1')
    throw new TypeError('A registered infrastructure fixture is required.');
  if (!Array.isArray(receiptAssets))
    throw new TypeError('Verified build receipt assets are required.');
  const base = new URL(baseUrl);
  if (!['http:', 'https:'].includes(base.protocol))
    throw new TypeError(
      'Infrastructure fixture delivery needs an HTTP(S) base URL.',
    );
  const routes = fixture.assets.map((asset) => {
    const extension = path.posix.extname(asset.id);
    const stem = path.posix.basename(asset.id, extension);
    const candidates = receiptAssets.filter((record) => {
      const basename = path.posix.basename(record?.path || '');
      return (
        (basename === asset.id ||
          (basename.startsWith(`${stem}-`) && basename.endsWith(extension))) &&
        record?.sha256 === asset.sha256 &&
        record?.bytes === asset.byteLength
      );
    });
    if (candidates.length !== 1)
      throw new Error(`Build receipt does not uniquely map ${asset.id}.`);
    const receiptPath = candidates[0].path;
    return {
      id: asset.id,
      path: receiptPath,
      url: new URL(receiptPath, base).href,
    };
  });
  return Object.freeze(routes.map((route) => Object.freeze(route)));
}

/** Observe this app document's exact receipt-bound same-origin asset responses. */
export function createInfrastructureFixtureDeliveryObserver(
  fixture,
  { assetRoutes, baseUrl } = {},
) {
  if (fixture?.schema !== 'gev-infrastructure-fixture-manifest/v1')
    throw new TypeError('A registered infrastructure fixture is required.');
  const expectedById = new Map(
    fixture.assets.map((asset) => [asset.id, asset]),
  );
  const routes = new Map((assetRoutes || []).map((route) => [route.id, route]));
  if (routes.size !== fixture.assets.length)
    throw new TypeError(
      'Receipt-bound infrastructure asset routes are required.',
    );
  const expectedOrigin = new URL(baseUrl).origin;
  const acknowledgements = new Map();
  const errors = [];
  const pending = new Set();
  const onResponse = (response) => {
    const url = response?.url?.();
    let pathname = '';
    try {
      const observedUrl = new URL(url);
      if (observedUrl.origin !== expectedOrigin) return;
      pathname = observedUrl.pathname;
    } catch {
      return;
    }
    const id = [...routes].find(
      ([, route]) => new URL(route.url).pathname === pathname,
    )?.[0];
    if (!id) return;
    const task = (async () => {
      const expected = expectedById.get(id);
      const status = response.status?.();
      if (status !== 200)
        throw new Error(`Fixture asset ${id} returned HTTP ${status}.`);
      const bytes = await response.buffer();
      if (!Buffer.isBuffer(bytes) || bytes.length > MAX_ASSET_BYTES)
        throw new Error(
          `Fixture asset ${id} response exceeded its byte bound.`,
        );
      const sha256 = hash(bytes);
      if (bytes.length !== expected.byteLength || sha256 !== expected.sha256)
        throw new Error(`Served infrastructure bytes differ from ${id}.`);
      const prior = acknowledgements.get(id);
      if (
        prior &&
        (prior.sha256 !== sha256 || prior.byteLength !== bytes.length)
      )
        throw new Error(`Repeated fixture response changed for ${id}.`);
      acknowledgements.set(id, {
        id,
        sha256,
        byteLength: bytes.length,
        status,
        responseCount: (prior?.responseCount || 0) + 1,
      });
    })()
      .catch((error) => {
        if (errors.length < 8)
          errors.push(String(error?.message || error).slice(0, 240));
      })
      .finally(() => pending.delete(task));
    pending.add(task);
  };
  const summarize = async (beforeLayers, afterLayers) => {
    await Promise.all([...pending]);
    assert.deepEqual(
      errors,
      [],
      'Infrastructure fixture response was not verified.',
    );
    const assets = fixture.assets.map((asset) => {
      const observed = acknowledgements.get(asset.id);
      assert.ok(observed, `Served fixture asset ${asset.id} was not observed.`);
      return { ...observed };
    });
    const populations = (layers, label) => {
      const observed = Object.fromEntries(
        (layers || []).map((row) => [
          row.id,
          { enabled: row.enabled, count: row.count },
        ]),
      );
      for (const [id, count] of Object.entries(fixture.expectedLayerCounts))
        assert.deepEqual(
          observed[id],
          { enabled: true, count },
          `${label} population for ${id} differs from the fixture`,
        );
      return Object.entries(fixture.expectedLayerCounts)
        .map(([id, count]) => ({ id, enabled: true, count }))
        .sort((left, right) => left.id.localeCompare(right.id));
    };
    const before = populations(beforeLayers, 'Before');
    const after = populations(afterLayers, 'After');
    assert.deepEqual(
      after,
      before,
      'Infrastructure population changed during the capture.',
    );
    return {
      schema: 'gev-infrastructure-fixture-delivery-observation/v1',
      status: 'observed',
      method:
        'actual same-origin bundled asset response bodies SHA-256 verified',
      fixtureId: fixture.id,
      fixtureSha256: fixture.sha256,
      fixedTime: fixture.fixedTime,
      assets,
      populationsBefore: before,
      populationsAfter: after,
    };
  };
  return { onResponse, summarize, errors };
}

export function assertInfrastructureClockObservation(clock, fixture, label) {
  assert.deepEqual(
    clock,
    {
      currentTime: fixture.clock,
      shouldAnimate: false,
      multiplier: 0,
    },
    `${label} Cesium clock differs from the fixed fixture time`,
  );
  return true;
}
