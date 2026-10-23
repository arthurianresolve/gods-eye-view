import assert from 'node:assert/strict';
import * as Cesium from 'cesium';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  assertInfrastructureClockObservation,
  createInfrastructureFixtureDeliveryObserver,
  createInfrastructureWorkloadFixture,
  resolveInfrastructureFixtureAssetRoutes,
} from './infrastructureWorkloadFixture.mjs';

const FIXED_TIME = '2026-10-08T12:00:00.000Z';

test('registered infrastructure workloads bind exact bundled bytes and populations', () => {
  const cases = [
    ['infrastructure-datacenters', ['local-datacenters'], 4_362, 1],
    ['infrastructure-dams', ['local-dams'], 716, 1],
    ['infrastructure-cables', ['telegeography-submarine-cables'], 2_629, 2],
    [
      'infrastructure',
      ['local-datacenters', 'local-dams', 'telegeography-submarine-cables'],
      7_707,
      4,
    ],
  ];
  for (const [workloadId, layerIds, population, assetCount] of cases) {
    const fixture = createInfrastructureWorkloadFixture(workloadId, FIXED_TIME);
    assert.equal(fixture.workloadId, workloadId);
    assert.equal(fixture.fixedTime, FIXED_TIME);
    assert.deepEqual(fixture.selectedLayerIds, layerIds);
    assert.equal(
      Object.values(fixture.expectedLayerCounts).reduce(
        (sum, count) => sum + count,
        0,
      ),
      population,
    );
    assert.equal(fixture.assets.length, assetCount);
    assert.ok(
      fixture.assets.every((asset) => /^[a-f0-9]{64}$/.test(asset.sha256)),
    );
  }
});

test('fixed fixture clock uses Cesium JulianDate UTC-to-TAI conversion', () => {
  const fixture = createInfrastructureWorkloadFixture(
    'infrastructure-dams',
    FIXED_TIME,
  );
  const observed = new Cesium.JulianDate(
    fixture.clock.dayNumber,
    fixture.clock.secondsOfDay,
    Cesium.TimeStandard.TAI,
  );
  assert.equal(Cesium.JulianDate.toIso8601(observed, 3), FIXED_TIME);
});

test('fixture rejects unknown workloads and noncanonical timestamps', () => {
  assert.throws(
    () => createInfrastructureWorkloadFixture('__proto__', FIXED_TIME),
    /Unsupported infrastructure workload/,
  );
  assert.throws(
    () =>
      createInfrastructureWorkloadFixture(
        'infrastructure',
        '2026-10-08T12:00:00Z',
      ),
    /canonical UTC ISO-8601/,
  );
});

test('receipt asset routing resolves hashed build names and rejects ambiguity', () => {
  const fixture = createInfrastructureWorkloadFixture(
    'infrastructure-cables',
    FIXED_TIME,
  );
  const receiptAssets = fixture.assets.map((asset) => {
    const extension = asset.id.slice(asset.id.lastIndexOf('.'));
    const stem = asset.id.slice(0, -extension.length);
    return {
      path: `assets/${stem}-verified123${extension}`,
      sha256: asset.sha256,
      bytes: asset.byteLength,
    };
  });
  const routes = resolveInfrastructureFixtureAssetRoutes(
    fixture,
    receiptAssets,
    'http://127.0.0.1:4173/',
  );
  assert.deepEqual(
    routes.map(({ id }) => id),
    fixture.assets.map(({ id }) => id),
  );
  assert.ok(
    routes.every(({ url }) => new URL(url).origin === 'http://127.0.0.1:4173'),
  );
  assert.throws(
    () =>
      resolveInfrastructureFixtureAssetRoutes(
        fixture,
        [...receiptAssets, receiptAssets[0]],
        'http://127.0.0.1:4173/',
      ),
    /uniquely map/,
  );
  assert.throws(
    () =>
      resolveInfrastructureFixtureAssetRoutes(
        fixture,
        receiptAssets.map((asset, index) =>
          index === 0 ? { ...asset, sha256: '0'.repeat(64) } : asset,
        ),
        'http://127.0.0.1:4173/',
      ),
    /uniquely map/,
  );
});

function response(url, { status = 200, body } = {}) {
  const bytes = body || Buffer.alloc(0);
  return {
    url: () => url,
    status: () => status,
    buffer: async () => bytes,
  };
}

function deliverySetup(fixture) {
  const receiptAssets = fixture.assets.map((asset) => {
    const extension = asset.id.slice(asset.id.lastIndexOf('.'));
    const stem = asset.id.slice(0, -extension.length);
    return {
      path: `assets/${stem}-receipt-hash${extension}`,
      sha256: asset.sha256,
      bytes: asset.byteLength,
    };
  });
  const baseUrl = 'http://127.0.0.1:4173/';
  const assetRoutes = resolveInfrastructureFixtureAssetRoutes(
    fixture,
    receiptAssets,
    baseUrl,
  );
  return {
    assetRoutes,
    baseUrl,
    observer: createInfrastructureFixtureDeliveryObserver(fixture, {
      assetRoutes,
      baseUrl,
    }),
  };
}

test('delivery observer binds matching served responses and before/after populations', async () => {
  const fixture = createInfrastructureWorkloadFixture(
    'infrastructure-datacenters',
    FIXED_TIME,
  );
  const { observer, assetRoutes, baseUrl } = deliverySetup(fixture);
  const asset = fixture.assets[0];
  const bytes = readFileSync(new URL(`../../${asset.path}`, import.meta.url));
  await observer.onResponse(response(assetRoutes[0].url, { body: bytes }));
  const foreignOrigin = createInfrastructureFixtureDeliveryObserver(fixture, {
    assetRoutes,
    baseUrl,
  });
  await foreignOrigin.onResponse(
    response(
      new URL(assetRoutes[0].url).href.replace('127.0.0.1', 'example.com'),
      {
        body: bytes,
      },
    ),
  );
  await assert.rejects(() => foreignOrigin.summarize([], []), /not observed/);
  const layers = [{ id: 'local-datacenters', enabled: true, count: 4_362 }];
  const result = await observer.summarize(layers, layers);
  assert.equal(result.status, 'observed');
  assert.equal(result.assets[0].sha256, asset.sha256);
  assert.deepEqual(result.populationsBefore, result.populationsAfter);
});

test('delivery observer fails for missing, changed, failed, or count-drifted observations', async () => {
  const fixture = createInfrastructureWorkloadFixture(
    'infrastructure-dams',
    FIXED_TIME,
  );
  const setup = deliverySetup(fixture);
  const goodLayers = [{ id: 'local-dams', enabled: true, count: 716 }];
  const observer = setup.observer;
  await assert.rejects(
    () => observer.summarize(goodLayers, goodLayers),
    /not observed/,
  );

  const changed = deliverySetup(fixture).observer;
  await changed.onResponse(
    response(setup.assetRoutes[0].url, {
      body: Buffer.from('wrong source bytes'),
    }),
  );
  await assert.rejects(
    () => changed.summarize(goodLayers, goodLayers),
    /not verified/,
  );

  const failed = deliverySetup(fixture).observer;
  await failed.onResponse(
    response(setup.assetRoutes[0].url, {
      status: 404,
    }),
  );
  await assert.rejects(
    () => failed.summarize(goodLayers, goodLayers),
    /not verified/,
  );

  const correct = deliverySetup(fixture).observer;
  const bytes = readFileSync(
    new URL(`../../${fixture.assets[0].path}`, import.meta.url),
  );
  await correct.onResponse(response(setup.assetRoutes[0].url, { body: bytes }));
  await assert.rejects(
    () => correct.summarize(goodLayers, [{ ...goodLayers[0], count: 715 }]),
    /population for local-dams differs/,
  );
});

test('fixed Cesium clock observation rejects animate or epoch drift', () => {
  const fixture = createInfrastructureWorkloadFixture(
    'infrastructure',
    FIXED_TIME,
  );
  const observed = {
    currentTime: fixture.clock,
    shouldAnimate: false,
    multiplier: 0,
  };
  assert.equal(
    assertInfrastructureClockObservation(observed, fixture, 'before'),
    true,
  );
  assert.throws(
    () =>
      assertInfrastructureClockObservation(
        { ...observed, shouldAnimate: true },
        fixture,
        'after',
      ),
    /clock differs/,
  );
});
