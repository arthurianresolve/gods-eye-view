import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import * as Cesium from 'cesium';
import {
  createAustinOperatingWorkloadFixture,
  createAustinOperatingFixtureDelivery,
} from './austinOperatingWorkloadFixture.mjs';
import { fixtureRequestCommand } from './fixtureInterception.mjs';
import {
  AUSTIN_OPERATING_FIXED_TIME,
  AUSTIN_OPERATING_LAYER_COUNTS,
  AUSTIN_OPERATING_ROUTE,
  AUSTIN_OPERATING_WIND_VALID_TIME,
} from './austinOperatingWorkloadContract.mjs';
import { createSatelliteSource } from '../../src/layers/satellites/source.js';
import { createCctvSource } from '../../src/layers/cctv/source.js';
import {
  createAlprTileSource,
  alprDetailZoom,
} from '../../src/layers/alpr/source.js';
import { createAlprPresentation } from '../../src/layers/alpr/presentation.js';
import { snapAlprBox } from '../../src/layers/alpr/records.js';
import { tilesForBounds } from '../../src/data/tomtomTiles.js';
import { createInstallationSource } from '../../src/layers/installations/source.js';
import { createRadioSource } from '../../src/layers/radio/source.js';
import { createWindSource } from '../../src/layers/wind/source.js';
import { createCatalogModel } from '../../src/layers/radio/catalogModel.js';

const baseUrl = 'https://fixture.example.test/';
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
function generatedFrame(cameraId) {
  const value = [...String(cameraId)].reduce(
    (sum, char) => sum + char.charCodeAt(0),
    0,
  );
  const hue = value % 360;
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360" viewBox="0 0 640 360"><rect width="640" height="360" fill="hsl(${hue} 30% 22%)"/><path d="M0 250L640 150M0 190L640 220" stroke="#b8c6c9" stroke-width="18"/><rect x="270" y="80" width="100" height="48" rx="5" fill="#20353c"/><text x="320" y="108" text-anchor="middle" font-family="sans-serif" font-size="16" fill="#d6efef">FIXTURE ONLY</text><text x="20" y="340" font-family="monospace" font-size="16" fill="#fff">synthetic:${cameraId}</text></svg>`,
  );
}
const responseFor = (result) =>
  new Response(result.body, {
    status: result.status,
    headers: { 'content-type': result.contentType },
  });

test('composed fixture pins full declared populations and preserves source epochs', () => {
  const fixture = createAustinOperatingWorkloadFixture();
  assert.equal(fixture.workloadId, 'austin-operating-v1');
  assert.equal(fixture.fixedTime, AUSTIN_OPERATING_FIXED_TIME);
  assert.equal(fixture.windSourceTime, AUSTIN_OPERATING_WIND_VALID_TIME);
  assert.equal(
    fixture.windSourceAgeMs,
    4 * 24 * 60 * 60 * 1000 + 6 * 60 * 60 * 1000,
  );
  assert.deepEqual(fixture.expectedLayerCounts, AUSTIN_OPERATING_LAYER_COUNTS);
  assert.deepEqual(fixture.route, AUSTIN_OPERATING_ROUTE);
  assert.match(
    fixture.provenance.benchmarkEligibility,
    /complete matched five-run/,
  );
  assert.equal(
    fixture.acquisition.alpr.sourceProvenance.upstreamRepository,
    'https://github.com/flockhopper3/deflock-data',
  );
  assert.equal(
    fixture.acquisition.alpr.sourceProvenance.checkedDate,
    '2026-10-12',
  );
  assert.equal(
    fixture.acquisition.alpr.sourceProvenance.attribution,
    '© OpenStreetMap contributors',
  );
  assert.equal(
    fixture.acquisition.alpr.sourceProvenance.license.url,
    'https://opendatacommons.org/licenses/odbl/1-0/',
  );
  assert.equal(
    fixture.acquisition.cctv.source.fetchedAt,
    '2026-10-12T18:56:12.035Z',
  );
  assert.match(fixture.provenance.radio, /synthetic/);
  assert.match(fixture.provenance.installations, /synthetic/);
  assert.ok(
    fixture.assets.every((asset) => /^[a-f0-9]{64}$/.test(asset.sha256)),
  );
  assert.throws(
    () => createAustinOperatingWorkloadFixture('2026-10-08T12:00:00.000Z'),
    /must be 2026-10-12/,
  );
});

test('actual native adapters consume the pinned/synthetic source endpoint bodies', async () => {
  const fixture = createAustinOperatingWorkloadFixture();
  const delivery = createAustinOperatingFixtureDelivery(fixture, baseUrl);
  const fetcher = async (input, options = {}) => {
    const href = new URL(String(input), baseUrl).href;
    const result = await delivery.respond(href, {
      method: options.method || 'GET',
    });
    if (!result) throw new Error(`No Austin fixture response for ${href}`);
    const response = responseFor(result);
    delivery.onFulfilled({
      url: href,
      method: options.method || 'GET',
      status: result.status,
      bodyBase64: Buffer.from(result.body).toString('base64'),
    });
    return response;
  };

  const satellites = createSatelliteSource({ fetchImpl: fetcher });
  const groups = ['stations', 'visual', 'gps-ops', 'glo-ops', 'galileo', 'geo'];
  let tleTotal = 0;
  for (const group of groups) {
    const result = await satellites.readGroup(group);
    assert.equal(result.ok, true);
    assert.equal(result.stale, false);
    assert.match(result.text, /^1 /m);
    tleTotal += result.text
      .trim()
      .split(/\r?\n/)
      .filter((line) => line.startsWith('1 ')).length;
  }
  assert.ok(tleTotal > AUSTIN_OPERATING_LAYER_COUNTS.satellites);

  const cctv = createCctvSource({ fetchImpl: fetcher });
  const catalog = await cctv.getCatalog();
  const health = await cctv.getHealth();
  assert.equal(catalog.sources.length, 250);
  assert.equal(health.cameras.length, 250);
  const frame = await cctv.getFrame(catalog.sources[0]);
  assert.equal(frame.contentType, 'image/svg+xml');
  assert.match(Buffer.from(frame.bytes).toString(), /FIXTURE ONLY/);

  const alpr = createAlprTileSource({ tileFetchImpl: fetcher });
  const scene = {
    canvas: { clientWidth: 1440, clientHeight: 900 },
    drawingBufferWidth: 1440,
    drawingBufferHeight: 900,
    ellipsoid: Cesium.Ellipsoid.WGS84,
    globe: { ellipsoid: Cesium.Ellipsoid.WGS84 },
    mapProjection: new Cesium.GeographicProjection(Cesium.Ellipsoid.WGS84),
    mode: Cesium.SceneMode.SCENE3D,
  };
  const camera = new Cesium.Camera(scene);
  const viewer = { scene, camera };
  const homePosition = Cesium.Cartesian3.fromDegrees(-97.7431, 30.2672, 12000);
  const orientation = {
    heading: Cesium.Math.toRadians(20),
    pitch: Cesium.Math.toRadians(-45),
    roll: 0,
  };
  const alprPresentation = createAlprPresentation({
    state: { viewer, enabled: false, dataSource: { entities: { values: [] } } },
    services: { render: {}, context: {}, groundFloor: {} },
    source: {},
  });
  const alprBoxes = [];
  const nativeRouteTiles = new Set();
  for (const elapsedMs of [0, 30_000, 60_000]) {
    camera.setView({ destination: homePosition, orientation });
    camera.moveRight((elapsedMs * 16) / 50);
    const viewport = alprPresentation.viewportBox(viewer);
    assert.ok(
      viewport,
      'native ALPR viewport uses a real Cesium camera and center-pixel pick',
    );
    const queryBox = snapAlprBox(viewport);
    alprBoxes.push(queryBox);
    const zoom = alprDetailZoom(queryBox);
    for (const tile of tilesForBounds(queryBox, zoom, { maxTiles: 17 }))
      nativeRouteTiles.add(`${tile.z}/${tile.x}/${tile.y}`);
  }
  assert.deepEqual(
    [...nativeRouteTiles].sort(),
    fixture.acquisition.alprNativeRoute.routeCoverage.requiredTiles
      .slice()
      .sort(),
  );
  const alprResults = [];
  for (const box of alprBoxes) {
    const result = await alpr.fetch(box);
    assert.equal(result.zoom, 10);
    assert.equal(result.saturated, false);
    alprResults.push(result);
  }
  assert.ok(alprResults.every((result) => result.records.length > 0));
  alpr.destroy();

  const installations = createInstallationSource({ fetchImpl: fetcher });
  const installationResult = await installations.getMappedSites(
    AUSTIN_OPERATING_ROUTE,
    { exact: true },
  );
  assert.equal(
    installationResult.records.length,
    AUSTIN_OPERATING_LAYER_COUNTS['military-installations'],
  );
  assert.equal(installationResult.saturated, false);
  assert.ok(
    installationResult.records[0].name.startsWith(
      'Synthetic benchmark installation',
    ),
  );

  const radio = createRadioSource({ fetchImpl: fetcher });
  const directory = await radio.getDirectory();
  assert.equal(directory.stations.length, 750);
  assert.equal(directory.fixtureOnly, true);
  assert.ok(
    directory.stations.some(
      (station) =>
        station.lat >= 30.29274386 &&
        station.lat <= 30.53260132 &&
        station.lon >= -97.80249445 &&
        station.lon <= -97.500759857,
    ),
    'the synthetic source-cap catalog includes route-visible Austin radio records',
  );
  const model = createCatalogModel({
    state: {},
    services: {},
    parts: {},
    source: radio,
  });
  assert.equal(model.isValidRadioDirectoryStation(directory.stations[0]), true);

  const wind = createWindSource({ fetchImpl: fetcher });
  const snapshot = await wind.getSnapshot({ model: 'gfs', overlay: 'none' });
  assert.equal(snapshot.cycle.validIso, AUSTIN_OPERATING_WIND_VALID_TIME);
  assert.equal(snapshot.u.length, 65160);
  assert.equal(snapshot.v.length, 65160);
  const summary = delivery.summarize({
    requiredAlprTiles:
      fixture.acquisition.alprNativeRoute.routeCoverage.requiredTiles.map(
        (tile) => {
          const [z, x, y] = tile.split('/').map(Number);
          return { z, x, y };
        },
      ),
  });
  assert.match(summary.benchmarkEligibility, /complete matched five-run/);
  assert.ok(summary.syntheticFrames.requestCount >= 1);
  const deliveredIds = summary.deliveredAssets.map((asset) => asset.id);
  assert.ok(deliveredIds.includes('tle-stations'));
  assert.ok(deliveredIds.includes('wind-grid'));
  assert.equal(
    summary.alprTileCoverage.requested.length,
    summary.alprTileCoverage.inventory.length,
  );
  assert.equal(summary.alprTileCoverage.fullRouteCoverageComplete, true);
  const installationVariant = summary.installations.responseVariants.find(
    (variant) => variant.exact,
  );
  assert.ok(installationVariant);
  assert.match(installationVariant.sha256, /^[a-f0-9]{64}$/);
  assert.equal(
    summary.installations.sourceCatalog.sha256,
    fixture.assets.find((asset) => asset.id === 'installations').sha256,
  );
});

test('owned requests are strict about method, group, viewport and tile identity', async () => {
  const fixture = createAustinOperatingWorkloadFixture();
  const delivery = createAustinOperatingFixtureDelivery(fixture, baseUrl);
  const cases = [
    ['https://fixture.example.test/api/celestrak/starlink', 'GET'],
    ['https://fixture.example.test/api/celestrak/stations?unexpected=1', 'GET'],
    ['https://fixture.example.test/api/radio/stations', 'POST'],
    [
      'https://fixture.example.test/api/military-installations?south=1&west=1&north=2&east=2',
      'GET',
    ],
    [
      'https://tiles.dontgetflocked.com/cameras-us-hourly/10/999/999.mvt',
      'GET',
    ],
    ['https://fixture.example.test/api/wind/manifest?model=ifs', 'GET'],
  ];
  for (const [url, method] of cases)
    await assert.rejects(
      delivery.respond(url, { method }),
      /Unexpected or malformed/,
    );
  assert.equal(delivery.errors.length, cases.length);
  assert.ok(
    delivery.errors.every((row) => !('query' in row) && !('body' in row)),
  );
});

test('native-style method accessors and per-view installation responses preserve endpoint ownership', async () => {
  const fixture = createAustinOperatingWorkloadFixture();
  const delivery = createAustinOperatingFixtureDelivery(fixture, baseUrl);
  const method = () => 'GET';
  const url = `${baseUrl}api/celestrak/stations`;
  const response = await delivery.respond(url, { method });
  assert.equal(response.status, 200);
  delivery.onFulfilled({
    url,
    method,
    status: 200,
    bodyBase64: response.body.toString('base64'),
  });

  const box = { south: 30.2, west: -97.8, north: 30.3, east: -97.7 };
  const query = new URLSearchParams(
    Object.entries(box).map(([key, value]) => [key, value.toFixed(5)]),
  );
  const installUrl = `${baseUrl}api/military-installations?${query}`;
  const subset = await delivery.respond(installUrl, { method });
  const payload = JSON.parse(subset.body.toString('utf8'));
  assert.ok(payload.elements.length > 0);
  assert.ok(
    payload.elements.every(
      (row) =>
        row.lat >= 30.2 &&
        row.lat <= 30.3 &&
        row.lon >= -97.8 &&
        row.lon <= -97.7,
    ),
  );
  delivery.onFulfilled({
    url: installUrl,
    method,
    status: 200,
    bodyBase64: subset.body.toString('base64'),
  });
  const summary = delivery.summarize({ requiredAssetIds: [] });
  const variant = summary.installations.responseVariants[0];
  assert.equal(variant.sha256, hash(subset.body));
  assert.equal(variant.byteLength, subset.body.length);
  assert.deepEqual(variant.bounds, box);
  assert.notEqual(variant.sha256, summary.installations.sourceCatalog.sha256);

  const foreign = await delivery.respond(
    'https://elsewhere.example.test/api/cctv/sources',
    { method },
  );
  assert.equal(foreign, null);
  assert.equal(delivery.errors.length, 0);
});

test('document delivery does not require the entire route tile inventory', async () => {
  const fixture = createAustinOperatingWorkloadFixture();
  const delivery = createAustinOperatingFixtureDelivery(fixture, baseUrl);
  const tileUrl =
    'https://tiles.dontgetflocked.com/cameras-us-hourly/10/232/420.mvt';
  const response = await delivery.respond(tileUrl, { method: 'GET' });
  delivery.onFulfilled({
    url: tileUrl,
    method: 'GET',
    status: 200,
    bodyBase64: response.body.toString('base64'),
  });
  assert.doesNotThrow(() =>
    delivery.summarize({
      requiredAssetIds: [],
      requiredAlprTiles: [{ z: 10, x: 232, y: 420 }],
    }),
  );
  assert.throws(
    () =>
      delivery.summarize({
        requiredAssetIds: [],
        requiredAlprTiles: [{ z: 10, x: 235, y: 422 }],
      }),
    /did not deliver required route tiles/,
  );
  const fullRoute =
    fixture.acquisition.alprNativeRoute.routeCoverage.requiredTiles.map(
      (tile) => {
        const [z, x, y] = tile.split('/').map(Number);
        return { z, x, y };
      },
    );
  assert.equal(
    delivery.summarize({ requiredAssetIds: [] }).alprTileCoverage
      .fullRouteCoverageComplete,
    false,
  );
  assert.throws(
    () =>
      delivery.summarize({
        requiredAssetIds: [],
        requiredAlprTiles: fullRoute,
      }),
    /did not deliver required route tiles/,
  );
});

test('cross-origin ALPR fixture fulfillment adds only the configured CORS origin and preserves bytes', async () => {
  const fixture = createAustinOperatingWorkloadFixture();
  const delivery = createAustinOperatingFixtureDelivery(fixture, baseUrl);
  const urls = [
    'https://tiles.dontgetflocked.com/cameras-us-hourly.json',
    'https://tiles.dontgetflocked.com/cameras-us-hourly/10/232/420.mvt',
  ];
  for (const href of urls) {
    const [method, params] = await fixtureRequestCommand(
      {
        requestId: `request-${urls.indexOf(href)}`,
        request: { url: href, method: 'GET', resourceType: 'XHR' },
      },
      baseUrl,
      (requestUrl, request) => delivery.respond(requestUrl.href, request),
    );
    assert.equal(method, 'Fetch.fulfillRequest');
    const headerMap = new Map(
      params.responseHeaders.map(({ name, value }) => [
        name.toLowerCase(),
        value,
      ]),
    );
    assert.equal(
      headerMap.get('access-control-allow-origin'),
      baseUrl.slice(0, -1),
    );
    assert.equal(headerMap.get('vary'), 'Origin');
    const assetId = href.endsWith('.json')
      ? 'alpr-tilejson'
      : 'alpr-10-232-420';
    const asset = fixture.assets.find((candidate) => candidate.id === assetId);
    const bytes = Buffer.from(params.body, 'base64');
    assert.equal(bytes.length, asset.byteLength);
    assert.equal(hash(bytes), asset.sha256);
    delivery.onFulfilled({
      url: href,
      method: 'GET',
      status: params.responseCode,
      bodyBase64: params.body,
    });
  }
  assert.equal(
    delivery
      .summarize({ requiredAssetIds: [] })
      .deliveredAssets.find((asset) => asset.id === 'alpr-tilejson')
      .responseCount,
    1,
  );
});

test('fulfilled responses are hash checked and missing pinned response routes fail closed', async () => {
  const fixture = createAustinOperatingWorkloadFixture();
  const delivery = createAustinOperatingFixtureDelivery(fixture, baseUrl);
  const body = Buffer.from('forged');
  assert.throws(
    () =>
      delivery.onFulfilled({
        url: `${baseUrl}api/celestrak/stations`,
        method: 'GET',
        status: 200,
        bodyBase64: body.toString('base64'),
      }),
    /bytes differ/,
  );
  assert.notEqual(
    hash(body),
    fixture.assets.find((asset) => asset.id === 'tle-stations').sha256,
  );
  assert.throws(() => delivery.summarize(), /malformed or unexpected/);
});

test('fulfilled synthetic CCTV frames cannot claim an unknown camera ID', async () => {
  const fixture = createAustinOperatingWorkloadFixture();
  const delivery = createAustinOperatingFixtureDelivery(fixture, baseUrl);
  const unknownId = 'not-in-the-pinned-catalog';
  const url = `${baseUrl}api/cctv/frame/${encodeURIComponent(unknownId)}?label=unknown&city=Austin&lat=30.3&lon=-97.7&heading=0&fov=60&pitch=-45&ts=1`;
  const body = generatedFrame(unknownId);
  await assert.rejects(
    delivery.respond(url, { method: 'GET' }),
    /not in the pinned 250-camera catalog/,
  );
  assert.throws(
    () =>
      delivery.onFulfilled({
        url,
        method: 'GET',
        status: 200,
        bodyBase64: body.toString('base64'),
      }),
    /not in the pinned 250-camera catalog/,
  );
});

test('required asset summaries reject unknown IDs and missing installation delivery', () => {
  const fixture = createAustinOperatingWorkloadFixture();
  const delivery = createAustinOperatingFixtureDelivery(fixture, baseUrl);
  assert.throws(
    () => delivery.summarize({ requiredAssetIds: ['installation'] }),
    /unknown IDs: installation/,
  );
  assert.throws(
    () => delivery.summarize({ requiredAssetIds: ['installations'] }),
    /were not delivered: installations/,
  );
});

test('installation delivery has a hard 32-variant bound', async () => {
  const fixture = createAustinOperatingWorkloadFixture();
  const delivery = createAustinOperatingFixtureDelivery(fixture, baseUrl);
  for (let index = 0; index < 33; index += 1) {
    const south = 30.3 + index / 1000;
    const url = new URL('/api/military-installations', baseUrl);
    url.searchParams.set('south', south.toFixed(5));
    url.searchParams.set('west', '-97.75');
    url.searchParams.set('north', (south + 0.01).toFixed(5));
    url.searchParams.set('east', '-97.74');
    url.searchParams.set('exact', '1');
    const response = await delivery.respond(url.href, { method: 'GET' });
    if (index < 32) {
      delivery.onFulfilled({
        url: url.href,
        method: 'GET',
        status: response.status,
        bodyBase64: response.body.toString('base64'),
      });
    } else {
      assert.throws(
        () =>
          delivery.onFulfilled({
            url: url.href,
            method: 'GET',
            status: response.status,
            bodyBase64: response.body.toString('base64'),
          }),
        /response-variant bound exceeded/,
      );
    }
  }
});
