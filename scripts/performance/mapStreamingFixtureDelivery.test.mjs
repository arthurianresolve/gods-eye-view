import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import * as Cesium from 'cesium';
import { fixtureRequestCommand } from './fixtureInterception.mjs';
import {
  getMapFixtureBuildProfileGoogleApiKey,
  MAP_FIXTURE_BUILD_PROFILE_ID,
} from './buildProvenance.mjs';
import { createDeterministicMapStreamingFixture } from './mapStreamingFixture.mjs';
import { validateMapStreamingSmokeDeliverySummary } from './mapStreamingCapture.mjs';
import {
  createMapStreamingFixtureDelivery,
  assertMapStreamingDeliveryHealthy,
  MAP_STREAMING_MAX_MISSING_ASSET_PATHS,
  MAP_STREAMING_MAX_REQUESTS_PER_DOCUMENT,
  validateMapStreamingFaultDeliverySummary,
} from './mapStreamingFixtureDelivery.mjs';

const APP_ORIGIN = 'http://127.0.0.1:4173';

test('map delivery rejects missing native tiles before cleanup and preserves pending work', async () => {
  const fixture = await createDeterministicMapStreamingFixture();
  const delivery = createMapStreamingFixtureDelivery(fixture, {
    appOrigin: APP_ORIGIN,
  });
  try {
    const request = (requestId, url) =>
      fixtureRequestCommand(
        { requestId, request: { url, method: 'GET', postData: null } },
        APP_ORIGIN,
        delivery.respond,
      );
    await request(
      'native-level16',
      'https://tile.openstreetmap.org/16/14985/26981.png',
    );
    assert.ok(delivery.summary().pendingCount > 0);
    assert.doesNotThrow(() => assertMapStreamingDeliveryHealthy(delivery));
    assert.equal(delivery.summary().status, 'active');
    await assert.rejects(
      () =>
        request(
          'undeclared-level20',
          'https://tile.openstreetmap.org/20/239760/431696.png',
        ),
      /native-asset-not-in-manifest/,
    );
    assert.throws(
      () => assertMapStreamingDeliveryHealthy(delivery),
      /Map fixture delivery failed: native-asset-not-in-manifest.*Missing assets: imagery\/20\/239760\/431696\.png\./,
    );
    assert.equal(delivery.summary().status, 'active');
  } finally {
    delivery.dispose();
  }
});
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
let requestOrdinal = 0;
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
  const requestId = `request-for-test-${++requestOrdinal}`;
  const [command, params] = await fixtureRequestCommand(
    {
      requestId,
      request: { url, method, postData: null },
    },
    APP_ORIGIN,
    delivery.respond,
  );
  if (command !== 'Fetch.fulfillRequest') return { command, params };
  const acknowledged = delivery.onFulfilled({
    requestId,
    url,
    method,
    status: params.responseCode,
    bodyBase64: params.body,
  });
  return { command, params, acknowledged, requestId };
}

test('native map URLs resolve every manifest asset through real interception callbacks', async () => {
  const pinned = await fixture();
  const requiredKinds = [
    '3d-tiles-1.1',
    'textured-glb',
    'synthetic-google-credit-placeholder-png',
    'arcgis-mapserver-metadata-json',
    'arcgis-missing-tile-probe-png',
    'webmercator-imagery-png',
    'quantized-mesh-layer-metadata',
    'quantized-mesh-1.0',
  ];
  const requiredRows = requiredKinds.map((kind) => {
    const row = pinned.manifest.assets.find((asset) => asset.kind === kind);
    assert.ok(row, `fixture contains required kind ${kind}`);
    return row;
  });
  const requiredPaths = new Set(requiredRows.map((row) => row.path));
  const remainingRows = pinned.manifest.assets.filter(
    (row) => !requiredPaths.has(row.path),
  );
  const firstCohort = [
    ...requiredRows,
    ...remainingRows.slice(
      0,
      MAP_STREAMING_MAX_REQUESTS_PER_DOCUMENT - requiredRows.length,
    ),
  ];
  const secondCohort = [
    ...requiredRows,
    ...remainingRows.slice(firstCohort.length - requiredRows.length),
  ];
  const observedPaths = new Set();
  const summaries = [];
  for (const [cohortIndex, cohort] of [firstCohort, secondCohort].entries()) {
    const delivery = createMapStreamingFixtureDelivery(pinned, {
      appOrigin: APP_ORIGIN,
    });
    for (const row of cohort) {
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
      const deliveredBytes = Buffer.from(result.params.body, 'base64');
      assert.deepEqual(deliveredBytes, pinned.assets.get(row.path));
      assert.equal(
        createHash('sha256').update(deliveredBytes).digest('hex'),
        row.sha256,
        `${row.path} serves its pinned digest`,
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
      observedPaths.add(row.path);
    }
    assert.ok(cohort.length <= MAP_STREAMING_MAX_REQUESTS_PER_DOCUMENT);
    const summary = delivery.dispose();
    summaries.push(summary);
    assert.equal(
      validateMapStreamingSmokeDeliverySummary(summary, pinned),
      true,
    );
    assert.equal(summary.cleanupConfirmed, true);
    assert.equal(summary.requestedCount, cohort.length);
    assert.equal(summary.fulfilledAckCount, cohort.length);
    assert.equal(summary.pendingCount, 0);
    assert.equal(summary.browserDecodeObserved, false);
    assert.equal(summary.renderedReadinessObserved, false);
    assert.ok(
      summary.assets.every((row) => row.fulfilledAckCount === row.requests),
    );
    if (cohortIndex === 0) {
      const corruptedSummary = structuredClone(summary);
      corruptedSummary.assets[0].sha256 = '0'.repeat(64);
      assert.throws(
        () =>
          validateMapStreamingSmokeDeliverySummary(corruptedSummary, pinned),
        /strictly equal/,
      );
      const legacySummary = structuredClone(summary);
      delete legacySummary.missingAssetPathEvidence;
      assert.equal(
        validateMapStreamingSmokeDeliverySummary(legacySummary, pinned),
        true,
      );
      const missingPathOnSuccess = structuredClone(summary);
      missingPathOnSuccess.missingAssetPathEvidence.observationCount = 1;
      assert.throws(() =>
        validateMapStreamingSmokeDeliverySummary(missingPathOnSuccess, pinned),
      );
    }
  }
  assert.equal(observedPaths.size, pinned.manifest.assets.length);
  assert.equal(summaries.length, 2);
  assert.equal(
    summaries.reduce((sum, summary) => sum + summary.requestedCount, 0),
    pinned.manifest.assets.length + requiredRows.length,
  );
});

test('declared Esri missing and corrupt metadata responses are isolated fault observations', async () => {
  const pinned = await fixture();
  const metadata = pinned.manifest.assets.find(
    (row) => row.kind === 'arcgis-mapserver-metadata-json',
  );
  assert.ok(metadata);
  const originalBytes = Buffer.from(pinned.assets.get(metadata.path));
  for (const [scenarioId, expectedStatus, expectedBody] of [
    ['esri-metadata-missing-v1', 404, Buffer.alloc(0)],
    [
      'esri-metadata-corrupt-v1',
      200,
      Buffer.from(originalBytes).fill(0x21, 0, 1),
    ],
  ]) {
    const delivery = createMapStreamingFixtureDelivery(pinned, {
      appOrigin: APP_ORIGIN,
      faultScenarioId: scenarioId,
    });
    const result = await issueRequest(delivery, nativeUrl(metadata));
    assert.equal(result.params.responseCode, expectedStatus);
    assert.equal(
      Buffer.from(result.params.body, 'base64').equals(expectedBody),
      true,
    );
    assert.equal(result.acknowledged, true);
    const summary = delivery.dispose();
    assert.equal(
      validateMapStreamingFaultDeliverySummary(summary, pinned, scenarioId),
      true,
    );
    assert.throws(
      () => validateMapStreamingSmokeDeliverySummary(summary, pinned),
      /strictly equal/,
    );
    assert.equal(summary.requestedCount, 1);
    assert.equal(summary.fulfilledAckCount, 0);
    assert.equal(summary.cancelledCount, 0);
    assert.equal(summary.assets[0].faultedCount, 1);
    assert.equal(summary.cleanupConfirmed, true);
    assert.equal(pinned.assets.get(metadata.path).equals(originalBytes), true);

    const wrongFault = structuredClone(summary);
    wrongFault.faultInjection.acknowledgedCount = 2;
    assert.throws(
      () =>
        validateMapStreamingFaultDeliverySummary(
          wrongFault,
          pinned,
          scenarioId,
        ),
      /strictly equal/,
    );
    for (const mutate of [
      (copy) => {
        copy.faultInjection.acknowledgement.status += 1;
      },
      (copy) => {
        copy.faultInjection.acknowledgement.sha256 = '0'.repeat(64);
      },
      (copy) => {
        copy.faultInjection.acknowledgement.requestId = 'other-request';
      },
      (copy) => {
        copy.fulfilledAckCount = -1;
        copy.cancelledCount += 1;
      },
      (copy) => {
        copy.assets[0].fulfilledAckCount = -1;
        copy.assets[0].cancelledCount += 1;
      },
    ]) {
      const alteredAcknowledgement = structuredClone(summary);
      mutate(alteredAcknowledgement);
      assert.throws(() =>
        validateMapStreamingFaultDeliverySummary(
          alteredAcknowledgement,
          pinned,
          scenarioId,
        ),
      );
    }
    const unrelatedError = structuredClone(summary);
    unrelatedError.errorObservationCount = 1;
    assert.throws(
      () =>
        validateMapStreamingFaultDeliverySummary(
          unrelatedError,
          pinned,
          scenarioId,
        ),
      /strictly equal/,
    );
    for (const mutate of [
      (copy) => {
        copy.limits.maxRequests = MAP_STREAMING_MAX_REQUESTS_PER_DOCUMENT + 1;
      },
      (copy) => {
        copy.requestedCount = MAP_STREAMING_MAX_REQUESTS_PER_DOCUMENT + 1;
      },
      (copy) => {
        copy.errors.push({ code: 'unexpected', count: 1 });
      },
      (copy) => {
        delete copy.limits;
      },
    ]) {
      const overBound = structuredClone(summary);
      mutate(overBound);
      assert.throws(() =>
        validateMapStreamingFaultDeliverySummary(overBound, pinned, scenarioId),
      );
    }
  }
});

test('map fault delivery rejects unknown plans and incomplete fault scenarios', async () => {
  const pinned = await fixture();
  assert.throws(
    () =>
      createMapStreamingFixtureDelivery(pinned, {
        appOrigin: APP_ORIGIN,
        faultScenarioId: 'esri-metadata-arbitrary-response-v1',
      }),
    /fault scenario is unsupported/,
  );
  const delivery = createMapStreamingFixtureDelivery(pinned, {
    appOrigin: APP_ORIGIN,
    faultScenarioId: 'esri-metadata-missing-v1',
  });
  const summary = delivery.dispose();
  assert.equal(summary.cleanupConfirmed, false);
  assert.throws(
    () =>
      validateMapStreamingFaultDeliverySummary(
        summary,
        pinned,
        'esri-metadata-missing-v1',
      ),
    /strictly equal/,
  );
});

test('fault delivery does not accept a response that differs from its declaration', async () => {
  const pinned = await fixture();
  const metadata = pinned.manifest.assets.find(
    (row) => row.kind === 'arcgis-mapserver-metadata-json',
  );
  const url = nativeUrl(metadata);
  const delivery = createMapStreamingFixtureDelivery(pinned, {
    appOrigin: APP_ORIGIN,
    faultScenarioId: 'esri-metadata-corrupt-v1',
  });
  const response = await delivery.respond(new URL(url), {
    requestId: 'corrupt-target',
    url: () => url,
    method: () => 'GET',
  });
  assert.throws(
    () =>
      delivery.onFulfilled({
        requestId: 'corrupt-target',
        url,
        method: 'GET',
        status: response.status,
        bodyBase64: Buffer.from('forged').toString('base64'),
      }),
    /fault-fulfillment-identity-mismatch/,
  );
  const summary = delivery.dispose();
  assert.equal(summary.errorObservationCount, 1);
  assert.equal(summary.cleanupConfirmed, false);
  assert.equal(summary.pendingCount, 0);
  assert.throws(
    () =>
      validateMapStreamingFaultDeliverySummary(
        summary,
        pinned,
        'esri-metadata-corrupt-v1',
      ),
    /strictly equal/,
  );
});

test('supersession fault adapter holds one owned response and releases it only on command', async () => {
  const pinned = await fixture();
  const metadata = pinned.manifest.assets.find(
    (row) => row.kind === 'arcgis-mapserver-metadata-json',
  );
  const url = nativeUrl(metadata);
  const delivery = createMapStreamingFixtureDelivery(pinned, {
    appOrigin: APP_ORIGIN,
    faultScenarioId: 'esri-metadata-superseded-v1',
  });
  const pendingResponse = delivery.respond(new URL(url), {
    requestId: 'held-target',
    url: () => url,
    method: () => 'GET',
    signal: new AbortController().signal,
  });
  assert.equal(await delivery.waitForFaultRequest({ timeoutMs: 1_000 }), true);
  assert.equal(delivery.summary().pendingCount, 1);
  assert.equal(delivery.summary().faultInjection.heldRequestCount, 1);
  const sameUrlResponse = await issueRequest(delivery, url);
  assert.equal(sameUrlResponse.acknowledged, true);
  const otherAsset = pinned.manifest.assets.find(
    (row) => row.kind === 'synthetic-google-credit-placeholder-png',
  );
  const otherAssetResponse = await issueRequest(
    delivery,
    nativeUrl(otherAsset),
  );
  assert.equal(otherAssetResponse.acknowledged, true);
  assert.equal(delivery.releaseFaultResponse(), true);
  assert.equal(delivery.releaseFaultResponse(), false);
  const response = await pendingResponse;
  assert.equal(response.status, 200);
  assert.equal(response.body.equals(pinned.assets.get(metadata.path)), true);
  assert.equal(
    delivery.onFulfilled({
      requestId: 'held-target',
      url,
      method: 'GET',
      status: response.status,
      bodyBase64: response.body.toString('base64'),
    }),
    true,
  );
  const summary = delivery.dispose();
  assert.equal(
    validateMapStreamingFaultDeliverySummary(
      summary,
      pinned,
      'esri-metadata-superseded-v1',
    ),
    true,
  );
  assert.equal(summary.faultInjection.heldRequestCount, 1);
  assert.equal(summary.faultInjection.releasedCount, 1);
  assert.equal(summary.faultInjection.acknowledgedCount, 1);
  assert.equal(summary.faultInjection.acknowledgement.requestId, 'held-target');
  assert.equal(summary.fulfilledAckCount, 3);
  assert.equal(summary.pendingCount, 0);
});

test('disposing a held fault request fails closed and prevents further waits', async () => {
  const pinned = await fixture();
  const metadata = pinned.manifest.assets.find(
    (row) => row.kind === 'arcgis-mapserver-metadata-json',
  );
  const url = nativeUrl(metadata);
  const delivery = createMapStreamingFixtureDelivery(pinned, {
    appOrigin: APP_ORIGIN,
    faultScenarioId: 'esri-metadata-superseded-v1',
  });
  const pendingResponse = delivery.respond(new URL(url), {
    requestId: 'dispose-held-target',
    url: () => url,
    method: () => 'GET',
  });
  const observed = delivery.waitForFaultRequest({ timeoutMs: 1_000 });
  await observed;
  delivery.dispose();
  await assert.rejects(pendingResponse, /request-cancelled/);
  assert.equal(delivery.summary().pendingCount, 0);
  assert.equal(delivery.summary().cleanupConfirmed, false);
  assert.throws(
    () => delivery.waitForFaultRequest({ timeoutMs: 1_000 }),
    /fault-owner-not-active/,
  );

  const beforeRequest = createMapStreamingFixtureDelivery(pinned, {
    appOrigin: APP_ORIGIN,
    faultScenarioId: 'esri-metadata-superseded-v1',
  });
  const waiting = beforeRequest.waitForFaultRequest({ timeoutMs: 30_000 });
  assert.throws(
    () => beforeRequest.waitForFaultRequest({ timeoutMs: 30_000 }),
    /fault-waiter-limit-exceeded/,
  );
  beforeRequest.cancel();
  await assert.rejects(waiting, /request-cancelled/);
  beforeRequest.dispose();
});

test('missing native map assets retain bounded canonical paths without URLs', async () => {
  const pinned = await fixture();
  const delivery = createMapStreamingFixtureDelivery(pinned, {
    appOrigin: APP_ORIGIN,
  });
  const missingUrls = Array.from(
    { length: MAP_STREAMING_MAX_MISSING_ASSET_PATHS + 2 },
    (_, index) => `https://tile.openstreetmap.org/99/${index}/42.png`,
  );
  for (const url of missingUrls)
    await assert.rejects(
      issueRequest(delivery, url),
      /native-asset-not-in-manifest/,
    );
  await assert.rejects(
    issueRequest(
      delivery,
      'https://tile.openstreetmap.org/99/0/42.png?token=secret-value',
    ),
    /osm-tile-query-invalid/,
  );

  const summary = delivery.dispose();
  const evidence = summary.missingAssetPathEvidence;
  assert.deepEqual(evidence, {
    observationCount: missingUrls.length,
    uniquePathCount: missingUrls.length,
    omittedPathCount: 2,
    paths: missingUrls
      .slice(0, MAP_STREAMING_MAX_MISSING_ASSET_PATHS)
      .map((_, index) => ({
        path: `imagery/99/${index}/42.png`,
        observationCount: 1,
      })),
  });
  assert.equal(summary.errorObservationCount, missingUrls.length + 1);
  const serialized = JSON.stringify(summary);
  assert.equal(serialized.includes('tile.openstreetmap.org'), false);
  assert.equal(serialized.includes('token'), false);
  assert.equal(serialized.includes('secret-value'), false);
  assert.equal(summary.cleanupConfirmed, false);
});

test('missing path evidence counts repeated callbacks and saturates safely', async () => {
  const pinned = await fixture();
  const repeated = createMapStreamingFixtureDelivery(pinned, {
    appOrigin: APP_ORIGIN,
  });
  const repeatedUrl = 'https://tile.openstreetmap.org/99/10/42.png';
  const context = { url: () => repeatedUrl, method: () => 'GET' };
  for (let index = 0; index < 2; index++) {
    await assert.rejects(
      repeated.respond(new URL(repeatedUrl), context),
      /native-asset-not-in-manifest/,
    );
    assert.throws(
      () =>
        repeated.onFulfilled({
          requestId: 'repeat-missing',
          url: repeatedUrl,
          method: 'GET',
          status: 200,
        }),
      /native-asset-not-in-manifest/,
    );
  }
  const repeatedSummary = repeated.dispose();
  assert.equal(repeatedSummary.errorObservationCount, 4);
  assert.equal(repeatedSummary.missingAssetPathEvidence.observationCount, 4);
  assert.equal(repeatedSummary.missingAssetPathEvidence.uniquePathCount, 1);
  assert.deepEqual(repeatedSummary.missingAssetPathEvidence.paths, [
    { path: 'imagery/99/10/42.png', observationCount: 4 },
  ]);
  assert.equal(repeatedSummary.cleanupConfirmed, false);

  const saturated = createMapStreamingFixtureDelivery(pinned, {
    appOrigin: APP_ORIGIN,
  });
  const saturationCount = 520;
  for (let index = 0; index < saturationCount; index++) {
    const url = `https://tile.openstreetmap.org/99/${index}/42.png`;
    await assert.rejects(
      saturated.respond(new URL(url), { url: () => url, method: () => 'GET' }),
      /native-asset-not-in-manifest/,
    );
  }
  const saturatedSummary = saturated.dispose();
  assert.equal(saturatedSummary.errorObservationCount, 512);
  assert.equal(saturatedSummary.omittedErrorObservationCount, 8);
  assert.deepEqual(saturatedSummary.missingAssetPathEvidence, {
    observationCount: 512,
    uniquePathCount: 512,
    omittedPathCount: 504,
    paths: Array.from(
      { length: MAP_STREAMING_MAX_MISSING_ASSET_PATHS },
      (_, index) => ({
        path: `imagery/99/${index}/42.png`,
        observationCount: 1,
      }),
    ),
  });
  assert.equal(saturatedSummary.errors.length, 1);
  assert.deepEqual(saturatedSummary.errors[0], {
    code: 'native-asset-not-in-manifest',
    count: 512,
  });
  assert.equal(saturatedSummary.cleanupConfirmed, false);
  const serialized = JSON.stringify(saturatedSummary);
  assert.ok(Buffer.byteLength(serialized, 'utf8') < 8_192);
  assert.equal(serialized.includes('tile.openstreetmap.org'), false);
});

test('Cesium ArcGIS provider metadata URL with its native trailing slash is delivered and acknowledged', async () => {
  const pinned = await fixture();
  const delivery = createMapStreamingFixtureDelivery(pinned, {
    appOrigin: APP_ORIGIN,
  });
  const originalFetchJson = Cesium.Resource.prototype.fetchJson;
  const observedUrls = [];
  Cesium.Resource.prototype.fetchJson = async function (...args) {
    observedUrls.push(this.url);
    const response = await issueRequest(delivery, this.url);
    assert.equal(response.command, 'Fetch.fulfillRequest');
    assert.equal(response.acknowledged, true);
    return JSON.parse(
      Buffer.from(response.params.body, 'base64').toString('utf8'),
    );
  };

  try {
    await Cesium.ArcGisMapServerImageryProvider.fromUrl(ARCGIS, {
      tileDiscardPolicy: new Cesium.NeverTileDiscardPolicy(),
    });
  } finally {
    Cesium.Resource.prototype.fetchJson = originalFetchJson;
  }

  assert.deepEqual(observedUrls, [`${ARCGIS}/?f=json`]);
  const summary = delivery.dispose();
  assert.equal(summary.requestedCount, 1);
  assert.equal(summary.fulfilledAckCount, 1);
  assert.equal(summary.pendingCount, 0);
  assert.equal(summary.cleanupConfirmed, true);
  assert.equal(
    summary.assets[0].path,
    'arcgis/rest/services/World_Imagery/MapServer/metadata.json',
  );
});

test('smoke summary accepts observed cancellations but rejects unbalanced counts', async () => {
  const pinned = await fixture();
  const delivery = createMapStreamingFixtureDelivery(pinned, {
    appOrigin: APP_ORIGIN,
  });
  const requiredKinds = [
    '3d-tiles-1.1',
    'textured-glb',
    'synthetic-google-credit-placeholder-png',
    'arcgis-mapserver-metadata-json',
    'arcgis-missing-tile-probe-png',
    'webmercator-imagery-png',
    'quantized-mesh-layer-metadata',
    'quantized-mesh-1.0',
  ];
  const requiredRows = requiredKinds.map((kind) =>
    pinned.manifest.assets.find((row) => row.kind === kind),
  );
  const requiredPaths = new Set(requiredRows.map((row) => row.path));
  const repeatableRows = pinned.manifest.assets.filter(
    (row) => !requiredPaths.has(row.path),
  );
  const acknowledgedRows = [...requiredRows];
  while (acknowledgedRows.length < MAP_STREAMING_MAX_REQUESTS_PER_DOCUMENT - 1)
    acknowledgedRows.push(
      repeatableRows[
        (acknowledgedRows.length - requiredRows.length) % repeatableRows.length
      ],
    );
  for (const row of acknowledgedRows) {
    const result = await issueRequest(delivery, nativeUrl(row));
    assert.equal(result.acknowledged, true);
  }
  const cancelledAsset = pinned.manifest.assets[0];
  const cancelledUrl = nativeUrl(cancelledAsset);
  const abort = new AbortController();
  await delivery.respond(new URL(cancelledUrl), {
    requestId: 'budget-cancelled-request',
    url: () => cancelledUrl,
    method: () => 'GET',
    signal: abort.signal,
  });
  abort.abort();
  const summary = delivery.dispose();
  assert.equal(summary.requestedCount, MAP_STREAMING_MAX_REQUESTS_PER_DOCUMENT);
  assert.equal(summary.fulfilledAckCount, acknowledgedRows.length);
  assert.equal(summary.cancelledCount, 1);
  assert.equal(validateMapStreamingSmokeDeliverySummary(summary, pinned), true);

  const unbalanced = structuredClone(summary);
  unbalanced.cancelledCount -= 1;
  assert.throws(
    () => validateMapStreamingSmokeDeliverySummary(unbalanced, pinned),
    /strictly equal/,
  );
});

test('cancelled-only required map kinds do not count as delivered', async () => {
  const pinned = await fixture();
  const cancelledAsset = pinned.manifest.assets.find(
    (row) => row.kind === 'arcgis-missing-tile-probe-png',
  );
  assert.ok(cancelledAsset);
  const delivery = createMapStreamingFixtureDelivery(pinned, {
    appOrigin: APP_ORIGIN,
  });
  const requiredKinds = [
    '3d-tiles-1.1',
    'textured-glb',
    'synthetic-google-credit-placeholder-png',
    'arcgis-mapserver-metadata-json',
    'arcgis-missing-tile-probe-png',
    'webmercator-imagery-png',
    'quantized-mesh-layer-metadata',
    'quantized-mesh-1.0',
  ];
  for (const kind of requiredKinds) {
    const row = pinned.manifest.assets.find((asset) => asset.kind === kind);
    assert.ok(row);
    if (row === cancelledAsset) continue;
    const result = await issueRequest(delivery, nativeUrl(row));
    assert.equal(result.acknowledged, true);
  }
  const cancelledUrl = nativeUrl(cancelledAsset);
  const abort = new AbortController();
  await delivery.respond(new URL(cancelledUrl), {
    requestId: 'required-kind-cancelled-request',
    url: () => cancelledUrl,
    method: () => 'GET',
    signal: abort.signal,
  });
  abort.abort();
  const summary = delivery.dispose();
  assert.throws(
    () => validateMapStreamingSmokeDeliverySummary(summary, pinned),
    /acknowledged required map asset kind arcgis-missing-tile-probe-png/,
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
  let acknowledgedCount = 0;
  for (let offset = 0; offset < imageryRows.length; offset += 512) {
    const delivery = createMapStreamingFixtureDelivery(pinned, {
      appOrigin: APP_ORIGIN,
    });
    const rows = imageryRows.slice(offset, offset + 512);
    for (let index = 0; index < rows.length; index += 1) {
      const row = rows[index];
      const result = await issueRequest(delivery, nativeUrls[offset + index]);
      assert.equal(result.command, 'Fetch.fulfillRequest');
      assert.equal(result.acknowledged, true);
      assert.deepEqual(
        Buffer.from(result.params.body, 'base64'),
        pinned.assets.get(row.path),
      );
      acknowledgedCount += 1;
    }
    assert.equal(delivery.dispose().cleanupConfirmed, true);
  }
  assert.equal(acknowledgedCount, imageryRows.length);
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
    [`${ARCGIS}//?f=json`, /arcgis-route-invalid/],
    [`${ARCGIS}/%2F?f=json`, /arcgis-route-invalid/],
    [`${ARCGIS}/?f=json&f=json`, /arcgis-metadata-query-invalid/],
    [`${ARCGIS}/?f=json&extra=1`, /arcgis-metadata-query-invalid/],
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
        requestId: 'owned',
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
        requestId: 'owned',
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
        requestId: 'owned',
        url,
        method: 'GET',
        status: 206,
        bodyBase64: params.body,
      }),
    /fulfillment-status-invalid/,
  );
  const acknowledged = delivery.onFulfilled({
    requestId: 'owned',
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
      requestId: 'before-cancel',
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
    requestId: 'after-cancel',
    method: () => 'GET',
    url: () => url,
    signal: controller.signal,
  });
  assert.equal(response.status, 200);
  controller.abort();
  assert.throws(
    () =>
      after.onFulfilled({
        requestId: 'after-cancel',
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
    requestId: 'overflow-first',
    method: () => 'GET',
    url: () => first,
    signal: controller.signal,
  });
  await assert.rejects(
    delivery.respond(new URL(second), {
      requestId: 'overflow-second',
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
