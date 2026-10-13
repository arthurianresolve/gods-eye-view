import assert from 'node:assert/strict';
import test from 'node:test';
import * as Cesium from 'cesium';
import { fixtureRequestCommand } from './fixtureInterception.mjs';
import {
  getMapFixtureBuildProfileGoogleApiKey,
  MAP_FIXTURE_BUILD_PROFILE_ID,
} from './buildProvenance.mjs';
import { createDeterministicMapStreamingFixture } from './mapStreamingFixture.mjs';
import {
  createMapStreamingFixtureDelivery,
  MAP_STREAMING_MAX_REQUESTS_PER_DOCUMENT,
} from './mapStreamingFixtureDelivery.mjs';

const APP_ORIGIN = 'http://127.0.0.1:4173';
const ARCGIS =
  'https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer';
const TERRAIN = 'https://terrain.reearth.land/cesium-mesh/ellipsoid';
const GOOGLE = 'https://tile.googleapis.com';
const GOOGLE_CREDIT = 'https://assets.ion.cesium.com/google-credit.png';
const GOOGLE_KEY = getMapFixtureBuildProfileGoogleApiKey(
  MAP_FIXTURE_BUILD_PROFILE_ID,
);
const CONTENT_TYPES = Object.freeze({
  'arcgis-mapserver-metadata-json': 'application/json',
  'quantized-mesh-layer-metadata': 'application/json',
  '3d-tiles-1.1': 'application/json',
  'quantized-mesh-1.0': 'application/vnd.quantized-mesh',
  'textured-glb': 'model/gltf-binary',
  'arcgis-missing-tile-probe-png': 'image/png',
  'synthetic-google-credit-placeholder-png': 'image/png',
  'webmercator-imagery-png': 'image/png',
});

let fixturePromise;
const fixture = () =>
  (fixturePromise ??= createDeterministicMapStreamingFixture());

function nativeUrl(row) {
  if (row.kind === 'arcgis-mapserver-metadata-json') return `${ARCGIS}?f=json`;
  if (row.kind === 'arcgis-missing-tile-probe-png')
    return `${ARCGIS}/tile/${row.identity.level}/${row.identity.row}/${row.identity.column}`;
  if (row.kind === 'webmercator-imagery-png') {
    const [, level, column, rowNumber] = row.path.match(
      /^imagery\/(\d+)\/(\d+)\/(\d+)\.png$/,
    );
    return `${ARCGIS}/tile/${level}/${rowNumber}/${column}`;
  }
  if (row.kind === 'quantized-mesh-layer-metadata')
    return `${TERRAIN}/layer.json`;
  if (row.kind === 'quantized-mesh-1.0')
    return `${TERRAIN}/${row.path.slice('terrain/'.length)}`;
  if (row.kind === '3d-tiles-1.1')
    return new Cesium.Resource({
      url: `${GOOGLE}/v1/3dtiles/root.json`,
      queryParameters: { key: GOOGLE_KEY },
    }).url;
  if (row.kind === 'textured-glb') {
    const root = new Cesium.Resource({
      url: `${GOOGLE}/v1/3dtiles/root.json`,
      queryParameters: { key: GOOGLE_KEY },
    });
    return root.getDerivedResource({ url: `../${row.path}` }).url;
  }
  if (row.kind === 'synthetic-google-credit-placeholder-png')
    return GOOGLE_CREDIT;
  throw new Error(`No native route for ${row.kind}`);
}

async function issueRequest(delivery, url, method = 'GET') {
  const [command, params] = await fixtureRequestCommand(
    {
      requestId: 'request-for-test',
      request: { url, method, postData: null },
    },
    APP_ORIGIN,
    delivery.respond,
  );
  if (command !== 'Fetch.fulfillRequest') return { command, params };
  const acknowledged = delivery.onFulfilled({
    url,
    method,
    status: params.responseCode,
    bodyBase64: params.body,
  });
  return { command, params, acknowledged };
}

test('native map URLs resolve every manifest asset through real interception callbacks', async () => {
  const pinned = await fixture();
  const delivery = createMapStreamingFixtureDelivery(pinned, {
    appOrigin: APP_ORIGIN,
  });
  for (const row of pinned.manifest.assets) {
    const url = nativeUrl(row);
    const result = await issueRequest(delivery, url);
    assert.equal(
      result.command,
      'Fetch.fulfillRequest',
      `${row.path} is fulfilled`,
    );
    assert.equal(
      result.acknowledged,
      true,
      `${row.path} has an owned acknowledgment`,
    );
    assert.equal(
      Buffer.from(result.params.body, 'base64').length,
      row.byteLength,
    );
    assert.equal(result.params.responseCode, 200);
    const headers = Object.fromEntries(
      result.params.responseHeaders.map(({ name, value }) => [
        name.toLowerCase(),
        value,
      ]),
    );
    assert.equal(headers['access-control-allow-origin'], APP_ORIGIN);
    assert.equal(headers['content-type'], CONTENT_TYPES[row.kind]);
  }
  const summary = delivery.dispose();
  assert.equal(summary.cleanupConfirmed, true);
  assert.equal(summary.requestedCount, pinned.manifest.assets.length);
  assert.equal(summary.fulfilledAckCount, pinned.manifest.assets.length);
  assert.equal(summary.pendingCount, 0);
  assert.equal(summary.browserDecodeObserved, false);
  assert.equal(summary.renderedReadinessObserved, false);
  assert.ok(
    summary.assets.every((row) => row.fulfilledAckCount === row.requests),
  );
});

test('unrelated offline API fulfillments are not counted as native map assets', async () => {
  const delivery = createMapStreamingFixtureDelivery(await fixture(), {
    appOrigin: APP_ORIGIN,
  });
  const result = await issueRequest(
    delivery,
    `${APP_ORIGIN}/api/fixture-health`,
  );
  assert.equal(result.command, 'Fetch.fulfillRequest');
  assert.equal(result.acknowledged, false);
  const unrelatedPost = await issueRequest(
    delivery,
    `${APP_ORIGIN}/api/fixture-update`,
    'POST',
  );
  assert.equal(unrelatedPost.command, 'Fetch.fulfillRequest');
  assert.equal(unrelatedPost.acknowledged, false);
  assert.equal(delivery.dispose().requestedCount, 0);
});

test('native OSM XYZ tiles map to the same hash-bound imagery corpus', async () => {
  const pinned = await fixture();
  const delivery = createMapStreamingFixtureDelivery(pinned, {
    appOrigin: APP_ORIGIN,
  });
  const originalLoadImage = Cesium.ImageryProvider.loadImage;
  const nativeUrls = [];
  Cesium.ImageryProvider.loadImage = (_provider, resource) => {
    nativeUrls.push(resource.url);
    return Promise.resolve({});
  };
  const imageryRows = pinned.manifest.assets.filter(
    (row) => row.kind === 'webmercator-imagery-png',
  );
  assert.ok(imageryRows.length > 0);
  try {
    const provider = new Cesium.OpenStreetMapImageryProvider({
      url: 'https://tile.openstreetmap.org/',
      credit: 'OSM fixture',
    });
    for (const row of imageryRows) {
      const [, level, x, y] = row.path.match(
        /^imagery\/(\d+)\/(\d+)\/(\d+)\.png$/,
      );
      await provider.requestImage(Number(x), Number(y), Number(level));
    }
  } finally {
    Cesium.ImageryProvider.loadImage = originalLoadImage;
  }
  assert.equal(nativeUrls.length, imageryRows.length);
  for (let index = 0; index < imageryRows.length; index += 1) {
    const row = imageryRows[index];
    const result = await issueRequest(delivery, nativeUrls[index]);
    assert.equal(result.command, 'Fetch.fulfillRequest');
    assert.equal(result.acknowledged, true);
    assert.deepEqual(
      Buffer.from(result.params.body, 'base64'),
      pinned.assets.get(row.path),
    );
  }
  assert.equal(delivery.dispose().cleanupConfirmed, true);
});

test('foreign lookalike hosts are blocked instead of routed as native providers', async () => {
  const delivery = createMapStreamingFixtureDelivery(await fixture(), {
    appOrigin: APP_ORIGIN,
  });
  const result = await issueRequest(
    delivery,
    'https://services.arcgisonline.com.attacker.invalid/ArcGIS/rest/services/World_Imagery/MapServer?f=json',
  );
  assert.equal(result.command, 'Fetch.failRequest');
  assert.equal(delivery.dispose().requestedCount, 0);
});

test('only the request method accessor accepted by fixtureRequestCommand is valid', async () => {
  const pinned = await fixture();
  const delivery = createMapStreamingFixtureDelivery(pinned, {
    appOrigin: APP_ORIGIN,
  });
  const url = nativeUrl(pinned.manifest.assets[0]);
  await assert.rejects(
    delivery.respond(new URL(url), { method: 'GET', url: () => url }),
    /request-method-accessor-required/,
  );
  await assert.rejects(
    delivery.respond(new URL(url), { method: () => 'GET' }),
    /request-url-accessor-required/,
  );
  await assert.rejects(
    issueRequest(delivery, url, 'POST'),
    /request-method-not-allowed/,
  );
  const summary = delivery.dispose();
  assert.equal(summary.cleanupConfirmed, false);
  assert.ok(
    summary.errors.some(
      (row) => row.code === 'request-method-accessor-required',
    ),
  );
  assert.ok(
    summary.errors.some((row) => row.code === 'request-url-accessor-required'),
  );
  assert.ok(
    summary.errors.some((row) => row.code === 'request-method-not-allowed'),
  );
});

test('native routes reject extra, duplicate, escaped, and traversing URL shapes', async () => {
  const pinned = await fixture();
  const delivery = createMapStreamingFixtureDelivery(pinned, {
    appOrigin: APP_ORIGIN,
  });
  const key = getMapFixtureBuildProfileGoogleApiKey(
    MAP_FIXTURE_BUILD_PROFILE_ID,
  );
  const cases = [
    [`${ARCGIS}?f=json&f=json`, /arcgis-metadata-query-invalid/],
    [`${ARCGIS}/tile/0/0/0?cache=1`, /arcgis-tile-query-invalid/],
    [`${ARCGIS}/tile/00/0/0`, /arcgis-route-invalid/],
    [`${ARCGIS}/tile/0/0/0?`, /native-path-noncanonical/],
    [
      'https://tile.openstreetmap.org/0/0/0.png?extra=1',
      /osm-tile-query-invalid/,
    ],
    ['https://tile.openstreetmap.org/00/0/0.png', /osm-route-invalid/],
    [`${TERRAIN}/layer.json?extra=1`, /terrain-layer-query-invalid/],
    [`${TERRAIN}/00/0/0.terrain`, /terrain-route-invalid/],
    [
      `${GOOGLE}/v1/3dtiles/root.json?key=${key}&key=${key}`,
      /google-root-query-invalid/,
    ],
    [
      `${GOOGLE}/v1/tiles/level-0/0-0.glb?key=${key}&cache=1`,
      /google-content-query-invalid/,
    ],
    [
      `${ARCGIS}/tile/%30/0/0`,
      /(arcgis-route-invalid|native-path-noncanonical)/,
    ],
    [
      `${ARCGIS}/tile/0/../0/0`,
      /(arcgis-route-invalid|native-path-noncanonical)/,
    ],
    [
      `${ARCGIS}/tile/0/%2e%2e/0`,
      /(arcgis-route-invalid|native-path-noncanonical)/,
    ],
    [`${ARCGIS}/unexpected/child`, /arcgis-route-invalid/],
  ];
  for (const [url, expected] of cases)
    await assert.rejects(issueRequest(delivery, url), expected, url);
  const summary = delivery.dispose();
  assert.equal(summary.requestedCount, 0);
  assert.equal(summary.pendingCount, 0);
  assert.equal(summary.cleanupConfirmed, false);
});

test('a response is acknowledged only for an exact owned URL and matching bytes', async () => {
  const pinned = await fixture();
  const delivery = createMapStreamingFixtureDelivery(pinned, {
    appOrigin: APP_ORIGIN,
  });
  const row = pinned.manifest.assets.find(
    (asset) => asset.kind === 'textured-glb',
  );
  const url = nativeUrl(row);
  const [command, params] = await fixtureRequestCommand(
    { requestId: 'owned', request: { url, method: 'GET' } },
    APP_ORIGIN,
    delivery.respond,
  );
  assert.equal(command, 'Fetch.fulfillRequest');
  const wrongUrl = url.replace('/level-0/', '/level-1/');
  assert.throws(
    () =>
      delivery.onFulfilled({
        url: wrongUrl,
        method: 'GET',
        status: params.responseCode,
        bodyBase64: params.body,
      }),
    /fulfillment-without-owned-request|native-asset-not-in-manifest/,
  );
  assert.throws(
    () =>
      delivery.onFulfilled({
        url,
        method: 'GET',
        status: params.responseCode,
        bodyBase64: Buffer.from('wrong').toString('base64'),
      }),
    /fulfillment-body-identity-mismatch/,
  );
  assert.throws(
    () =>
      delivery.onFulfilled({
        url,
        method: 'GET',
        status: 206,
        bodyBase64: params.body,
      }),
    /fulfillment-status-invalid/,
  );
  const acknowledged = delivery.onFulfilled({
    url,
    method: 'GET',
    status: 200,
    bodyBase64: params.body,
  });
  assert.equal(acknowledged, true);
  const summary = delivery.dispose();
  assert.equal(summary.unexpectedFulfillmentCount, 1);
  assert.equal(summary.fulfilledAckCount, 1);
  assert.equal(summary.pendingCount, 0);
  assert.equal(summary.cleanupConfirmed, false);
});

test('aborted requests are canceled before or after response preparation and late acks fail', async () => {
  const pinned = await fixture();
  const before = createMapStreamingFixtureDelivery(pinned, {
    appOrigin: APP_ORIGIN,
  });
  const beforeAbort = new AbortController();
  beforeAbort.abort();
  await assert.rejects(
    before.respond(new URL(nativeUrl(pinned.manifest.assets[0])), {
      method: () => 'GET',
      url: () => nativeUrl(pinned.manifest.assets[0]),
      signal: beforeAbort.signal,
    }),
    /request-cancelled/,
  );
  assert.equal(before.dispose().pendingCount, 0);

  const after = createMapStreamingFixtureDelivery(pinned, {
    appOrigin: APP_ORIGIN,
  });
  const controller = new AbortController();
  const row = pinned.manifest.assets.find(
    (asset) => asset.kind === 'quantized-mesh-1.0',
  );
  const url = nativeUrl(row);
  const response = await after.respond(new URL(url), {
    method: () => 'GET',
    url: () => url,
    signal: controller.signal,
  });
  assert.equal(response.status, 200);
  controller.abort();
  assert.throws(
    () =>
      after.onFulfilled({
        url,
        method: 'GET',
        status: 200,
        bodyBase64: response.body.toString('base64'),
      }),
    /late-fulfillment-after-cancel/,
  );
  const summary = after.dispose();
  assert.equal(summary.cancelledCount, 1);
  assert.equal(summary.pendingCount, 0);
  assert.equal(summary.cleanupConfirmed, false);
});

test('per-document request overflow fails closed and disposal removes abort ownership', async () => {
  const pinned = await fixture();
  const delivery = createMapStreamingFixtureDelivery(pinned, {
    appOrigin: APP_ORIGIN,
    maxRequests: 1,
  });
  const controller = new AbortController();
  const first = nativeUrl(pinned.manifest.assets[0]);
  const second = nativeUrl(pinned.manifest.assets[1]);
  await delivery.respond(new URL(first), {
    method: () => 'GET',
    url: () => first,
    signal: controller.signal,
  });
  await assert.rejects(
    delivery.respond(new URL(second), {
      method: () => 'GET',
      url: () => second,
      signal: controller.signal,
    }),
    /request-limit-exceeded/,
  );
  const summary = delivery.dispose();
  assert.equal(summary.limits.maxRequests, 1);
  assert.equal(summary.requestedCount, 1);
  assert.equal(summary.cancelledCount, 1);
  assert.equal(summary.pendingCount, 0);
  controller.abort();
  assert.equal(delivery.summary().status, 'disposed');
  assert.ok(MAP_STREAMING_MAX_REQUESTS_PER_DOCUMENT >= summary.requestedCount);
});

test('construction and diagnostic error recording stay explicitly bounded', async () => {
  const pinned = await fixture();
  assert.throws(
    () =>
      createMapStreamingFixtureDelivery(pinned, {
        appOrigin: 'http://host/path',
      }),
    /exact app origin/,
  );
  assert.throws(
    () =>
      createMapStreamingFixtureDelivery(pinned, {
        appOrigin: APP_ORIGIN,
        buildProfileId: 'unrelated-build',
      }),
    /Unsupported build profile/,
  );
  assert.throws(
    () =>
      createMapStreamingFixtureDelivery(pinned, {
        appOrigin: APP_ORIGIN,
        maxRequests: MAP_STREAMING_MAX_REQUESTS_PER_DOCUMENT + 1,
      }),
    /request limit is invalid/,
  );

  const delivery = createMapStreamingFixtureDelivery(pinned, {
    appOrigin: APP_ORIGIN,
  });
  const url = new URL(nativeUrl(pinned.manifest.assets[0]));
  for (let index = 0; index <= 512; index += 1)
    await assert.rejects(
      delivery.respond(url, { url: () => url.href, method: 'GET' }),
    );
  const summary = delivery.dispose();
  assert.equal(summary.requestedCount, 0);
  assert.equal(summary.errorObservationCount, 512);
  assert.equal(summary.omittedErrorObservationCount, 1);
  assert.equal(summary.errors.length, 1);
  assert.equal(summary.errors[0].code, 'request-method-accessor-required');
  assert.equal(summary.cleanupConfirmed, false);
  assert.equal(
    JSON.stringify(summary).includes('GEV_AUSTIN_MAP_FIXTURE_PUBLIC_INERT_V1'),
    false,
  );
});
