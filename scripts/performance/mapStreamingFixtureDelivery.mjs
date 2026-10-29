import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  getMapFixtureBuildProfileGoogleApiKey,
  MAP_FIXTURE_BUILD_PROFILE_ID,
} from './buildProvenance.mjs';
import { validateDeterministicMapStreamingFixture } from './mapStreamingFixture.mjs';

// Check between measured phases, without cancelling active requests or claiming
// that delivery proves decoding/rendering. An invalid fixture must fail before
// further repetitions, rather than surfacing only as an aggregate cleanup error.
export function assertMapStreamingDeliveryHealthy(delivery) {
  const summary = delivery.summary();
  if (summary.errorObservationCount || summary.unexpectedFulfillmentCount) {
    const reason = summary.errors?.[0]?.code || 'unexpected-fulfillment';
    const missingPaths = summary.missingAssetPathEvidence?.paths
      ?.slice(0, 8)
      .map(({ path }) => path)
      .filter(isCanonicalMapStreamingAssetPath);
    throw new Error(
      `Map fixture delivery failed: ${reason} (${summary.errorObservationCount} errors).` +
        (missingPaths?.length
          ? ` Missing assets: ${missingPaths.join(', ')}.`
          : ''),
    );
  }
}
export const MAP_STREAMING_DELIVERY_SCHEMA =
  'gev-map-streaming-fixture-delivery/v1';
export const MAP_STREAMING_FAULT_DELIVERY_SCHEMA =
  'gev-map-streaming-fault-delivery/v1';
// One measured document traverses four native map stacks for a full minute.
// Cesium can legitimately request the same fixture tile again when an imagery
// layer is replaced, so the former 512-request ceiling could expire during
// the first transition on hardware while every delivered response was valid.
// Keep the owner bounded, but size the ceiling for the declared four-stack
// route and the pinned fixture corpus rather than for startup-only traffic.
export const MAP_STREAMING_MAX_REQUESTS_PER_DOCUMENT = 2_048;
export const MAP_STREAMING_MAX_ABORT_SIGNALS_PER_DOCUMENT = 8;
export const MAP_STREAMING_MAX_ERROR_RECORDS = 8;
export const MAP_STREAMING_MAX_ERROR_OBSERVATIONS_PER_DOCUMENT = 512;
export const MAP_STREAMING_MAX_MISSING_ASSET_PATHS = 8;

const ARCGIS_ORIGIN = 'https://services.arcgisonline.com';
const ARCGIS_SERVICE_PATH = '/ArcGIS/rest/services/World_Imagery/MapServer';
const OSM_ORIGIN = 'https://tile.openstreetmap.org';
const TERRAIN_ORIGIN = 'https://terrain.reearth.land';
const TERRAIN_PATH = '/cesium-mesh/ellipsoid';
const GOOGLE_ORIGIN = 'https://tile.googleapis.com';
const GOOGLE_CREDIT_ORIGIN = 'https://assets.ion.cesium.com';
const GOOGLE_CREDIT_PATH = '/google-credit.png';
const NATIVE_PROVIDER_ORIGINS = new Set([
  ARCGIS_ORIGIN,
  OSM_ORIGIN,
  TERRAIN_ORIGIN,
  GOOGLE_ORIGIN,
  GOOGLE_CREDIT_ORIGIN,
]);
const SHA256 = /^[a-f0-9]{64}$/;
const ESRI_METADATA_ASSET_PATH =
  'arcgis/rest/services/World_Imagery/MapServer/metadata.json';
export const MAP_STREAMING_FAULT_SCENARIOS = Object.freeze({
  'esri-metadata-missing-v1': Object.freeze({
    mode: 'missing',
    assetPath: ESRI_METADATA_ASSET_PATH,
    status: 404,
  }),
  'esri-metadata-corrupt-v1': Object.freeze({
    mode: 'corrupt-json',
    assetPath: ESRI_METADATA_ASSET_PATH,
    status: 200,
  }),
  'esri-metadata-superseded-v1': Object.freeze({
    mode: 'superseded-valid',
    assetPath: ESRI_METADATA_ASSET_PATH,
    status: 200,
  }),
});

export function isCanonicalMapStreamingAssetPath(value) {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= 256 &&
    /^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(value) &&
    !value.includes('//') &&
    value.split('/').every((segment) => segment !== '.' && segment !== '..')
  );
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function deliveryError(code) {
  const error = new Error(code);
  error.code = `GEV_MAP_DELIVERY_${code.toUpperCase().replaceAll('-', '_')}`;
  return error;
}

function exactQuery(url, entries) {
  const actual = [...url.searchParams.entries()];
  return (
    actual.length === entries.length &&
    entries.every(
      ([key, value], index) =>
        actual[index]?.[0] === key && actual[index]?.[1] === value,
    )
  );
}

function exactGoogleQuery(url, googleKey) {
  return exactQuery(url, [['key', googleKey]]);
}

function contentTypeFor(row) {
  switch (row.kind) {
    case 'arcgis-mapserver-metadata-json':
    case 'quantized-mesh-layer-metadata':
    case '3d-tiles-1.1':
      return 'application/json';
    case 'quantized-mesh-1.0':
      return 'application/vnd.quantized-mesh';
    case 'textured-glb':
      return 'model/gltf-binary';
    case 'arcgis-missing-tile-probe-png':
    case 'synthetic-google-credit-placeholder-png':
    case 'webmercator-imagery-png':
      return 'image/png';
    default:
      throw deliveryError('manifest-content-kind-unsupported');
  }
}

function assertCanonicalPath(rawUrl, parsedUrl) {
  if (typeof rawUrl !== 'string' || rawUrl.length > 2_048)
    throw deliveryError('native-url-invalid');
  const authorityEnd = rawUrl.indexOf('/', rawUrl.indexOf('://') + 3);
  const rawPath =
    authorityEnd < 0
      ? '/'
      : rawUrl.slice(authorityEnd).split(/[?#]/, 1)[0] || '/';
  const queryIndex = rawUrl.indexOf('?');
  const fragmentIndex = rawUrl.indexOf('#');
  const hasExplicitEmptyQuery =
    queryIndex >= 0 &&
    (fragmentIndex < 0 || queryIndex < fragmentIndex) &&
    parsedUrl.search === '';
  if (
    rawPath !== parsedUrl.pathname ||
    rawPath.includes('%') ||
    rawPath.includes('\\') ||
    hasExplicitEmptyQuery ||
    rawPath.split('/').some((part) => part === '.' || part === '..')
  )
    throw deliveryError('native-path-noncanonical');
}

function validAppOrigin(value) {
  if (typeof value !== 'string' || value.length > 512) return null;
  let url;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  )
    return null;
  return url.origin;
}

function routeManifestAsset(url, assetsByPath, googleKey) {
  if (!NATIVE_PROVIDER_ORIGINS.has(url.origin)) return null;
  if (url.username || url.password || url.hash)
    throw deliveryError('native-url-shape-invalid');

  if (url.origin === ARCGIS_ORIGIN) {
    if (
      url.pathname === ARCGIS_SERVICE_PATH ||
      url.pathname === `${ARCGIS_SERVICE_PATH}/`
    ) {
      if (!exactQuery(url, [['f', 'json']]))
        throw deliveryError('arcgis-metadata-query-invalid');
      return 'arcgis/rest/services/World_Imagery/MapServer/metadata.json';
    }
    const tileMatch = url.pathname.match(
      /^\/ArcGIS\/rest\/services\/World_Imagery\/MapServer\/tile\/(0|[1-9]\d*)\/(0|[1-9]\d*)\/(0|[1-9]\d*)$/,
    );
    if (tileMatch) {
      if (url.search) throw deliveryError('arcgis-tile-query-invalid');
      const [, levelText, rowText, columnText] = tileMatch;
      const level = Number(levelText);
      const row = Number(rowText);
      const column = Number(columnText);
      const probe = [...assetsByPath.values()].find(
        (asset) => asset.row.kind === 'arcgis-missing-tile-probe-png',
      );
      if (
        probe &&
        level === probe.row.identity.level &&
        row === probe.row.identity.row &&
        column === probe.row.identity.column
      )
        return probe.row.path;
      return `imagery/${level}/${column}/${row}.png`;
    }
    if (
      url.pathname.startsWith(`${ARCGIS_SERVICE_PATH}/`) ||
      url.pathname === `${ARCGIS_SERVICE_PATH}/`
    )
      throw deliveryError('arcgis-route-invalid');
    return null;
  }

  if (url.origin === OSM_ORIGIN) {
    const tileMatch = url.pathname.match(
      /^\/(0|[1-9]\d*)\/(0|[1-9]\d*)\/(0|[1-9]\d*)\.png$/,
    );
    if (tileMatch) {
      if (url.search) throw deliveryError('osm-tile-query-invalid');
      const [, level, column, row] = tileMatch;
      return `imagery/${Number(level)}/${Number(column)}/${Number(row)}.png`;
    }
    if (url.pathname !== '/' || url.search)
      throw deliveryError('osm-route-invalid');
    return null;
  }

  if (url.origin === TERRAIN_ORIGIN) {
    if (url.pathname === `${TERRAIN_PATH}/layer.json`) {
      if (url.search) throw deliveryError('terrain-layer-query-invalid');
      return 'terrain/layer.json';
    }
    const terrainMatch = url.pathname.match(
      /^\/cesium-mesh\/ellipsoid\/(0|[1-9]\d*)\/(0|[1-9]\d*)\/(0|[1-9]\d*)\.terrain$/,
    );
    if (terrainMatch) {
      if (url.search) throw deliveryError('terrain-tile-query-invalid');
      const [, level, x, tmsY] = terrainMatch;
      return `terrain/${Number(level)}/${Number(x)}/${Number(tmsY)}.terrain`;
    }
    if (
      url.pathname === TERRAIN_PATH ||
      url.pathname.startsWith(`${TERRAIN_PATH}/`)
    )
      throw deliveryError('terrain-route-invalid');
    return null;
  }

  if (url.origin === GOOGLE_ORIGIN) {
    if (url.pathname === '/v1/3dtiles/root.json') {
      if (!exactGoogleQuery(url, googleKey))
        throw deliveryError('google-root-query-invalid');
      return 'tileset/tileset.json';
    }
    const tileMatch = url.pathname.match(
      /^\/v1\/tiles\/(level-(0|[1-9]\d*)\/(0|[1-9]\d*)-(0|[1-9]\d*)\.glb)$/,
    );
    if (tileMatch) {
      if (!exactGoogleQuery(url, googleKey))
        throw deliveryError('google-content-query-invalid');
      return `tiles/${tileMatch[1]}`;
    }
    if (
      url.pathname.startsWith('/v1/3dtiles/') ||
      url.pathname.startsWith('/v1/tiles/')
    )
      throw deliveryError('google-route-invalid');
    return null;
  }

  if (url.origin === GOOGLE_CREDIT_ORIGIN) {
    if (url.pathname === GOOGLE_CREDIT_PATH) {
      if (url.search) throw deliveryError('google-credit-query-invalid');
      return 'google/credit-placeholder.png';
    }
    if (url.pathname.startsWith('/google-credit'))
      throw deliveryError('google-credit-route-invalid');
    return null;
  }

  return null;
}

/**
 * Create one document-owned adapter for exact production map URLs. `respond`
 * plugs into fixtureRequestCommand; `onFulfilled` observes Fetch acknowledgments
 * only. Neither callback claims browser decode or rendered-tile readiness.
 */
export function createMapStreamingFixtureDelivery(
  fixture,
  {
    appOrigin,
    buildProfileId = MAP_FIXTURE_BUILD_PROFILE_ID,
    maxRequests = MAP_STREAMING_MAX_REQUESTS_PER_DOCUMENT,
    faultScenarioId = null,
  } = {},
) {
  validateDeterministicMapStreamingFixture(fixture);
  const normalizedOrigin = validAppOrigin(appOrigin);
  if (!normalizedOrigin)
    throw new TypeError('Map fixture delivery requires an exact app origin.');
  if (
    !Number.isSafeInteger(maxRequests) ||
    maxRequests < 1 ||
    maxRequests > MAP_STREAMING_MAX_REQUESTS_PER_DOCUMENT
  )
    throw new RangeError('Map fixture request limit is invalid.');

  const faultScenario =
    faultScenarioId === null
      ? null
      : MAP_STREAMING_FAULT_SCENARIOS[faultScenarioId];
  if (faultScenarioId !== null && !faultScenario)
    throw new TypeError('Map fault scenario is unsupported.');
  if (
    faultScenario &&
    !fixture.manifest.assets.some(
      (asset) =>
        asset.path === faultScenario.assetPath &&
        asset.kind === 'arcgis-mapserver-metadata-json',
    )
  )
    throw new TypeError('Map fault scenario asset is absent from the fixture.');

  const googleKey = getMapFixtureBuildProfileGoogleApiKey(buildProfileId);
  const assetsByPath = new Map(
    fixture.manifest.assets.map((row) => [row.path, { row }]),
  );
  const counts = new Map();
  const pendingByPath = new Map();
  const fulfilledByPath = new Map();
  const cancelledByPath = new Map();
  const pendingByUrl = new Map();
  const pendingByRequestId = new Map();
  const expectedFaultByRequestId = new Map();
  const heldFaultByRequestId = new Map();
  const signals = new Map();
  const errorCounts = new Map();
  const missingAssetPathCounts = new Map();
  let missingAssetObservationCount = 0;
  let errorObservationCount = 0;
  let omittedErrorObservationCount = 0;
  let requestedCount = 0;
  let fulfilledAckCount = 0;
  let cancelledCount = 0;
  let unexpectedFulfillmentCount = 0;
  let faultInjectedCount = 0;
  let faultAcknowledgedCount = 0;
  let faultedByPathCount = 0;
  let faultHeldRequestCount = 0;
  let faultReleasedCount = 0;
  let faultRequestId = null;
  let heldFaultRequest = null;
  let heldFaultTimer = null;
  let faultAcknowledgement = null;
  const heldFaultWaiters = new Set();
  let disposed = false;
  let cancelled = false;

  const recordError = (error) => {
    if (
      errorObservationCount >= MAP_STREAMING_MAX_ERROR_OBSERVATIONS_PER_DOCUMENT
    ) {
      omittedErrorObservationCount = Math.min(
        MAP_STREAMING_MAX_ERROR_OBSERVATIONS_PER_DOCUMENT + 1,
        omittedErrorObservationCount + 1,
      );
      return;
    }
    errorObservationCount += 1;
    const code =
      typeof error?.code === 'string' &&
      error.code.startsWith('GEV_MAP_DELIVERY_')
        ? error.code
            .slice('GEV_MAP_DELIVERY_'.length)
            .toLowerCase()
            .replaceAll('_', '-')
        : 'callback-invalid';
    errorCounts.set(code, (errorCounts.get(code) || 0) + 1);
  };
  const recordMissingAssetPath = (assetPath) => {
    if (
      errorObservationCount >=
        MAP_STREAMING_MAX_ERROR_OBSERVATIONS_PER_DOCUMENT ||
      !isCanonicalMapStreamingAssetPath(assetPath)
    )
      return;
    missingAssetObservationCount += 1;
    missingAssetPathCounts.set(
      assetPath,
      (missingAssetPathCounts.get(assetPath) || 0) + 1,
    );
  };
  const observeAbortSignal = (signal) => {
    if (signal == null) return;
    if (
      typeof signal.addEventListener !== 'function' ||
      typeof signal.removeEventListener !== 'function' ||
      typeof signal.aborted !== 'boolean'
    )
      throw deliveryError('abort-signal-invalid');
    if (signal.aborted) {
      cancel();
      throw deliveryError('request-cancelled');
    }
    if (signals.has(signal)) return;
    if (signals.size >= MAP_STREAMING_MAX_ABORT_SIGNALS_PER_DOCUMENT)
      throw deliveryError('abort-signal-limit-exceeded');
    const onAbort = () => cancel();
    signal.addEventListener('abort', onAbort, { once: true });
    signals.set(signal, onAbort);
  };
  const route = (url, rawUrl) => {
    const assetPath = routeManifestAsset(url, assetsByPath, googleKey);
    if (assetPath != null) assertCanonicalPath(rawUrl, url);
    return assetPath;
  };
  const requireGetAccessor = (context) => {
    if (typeof context?.method !== 'function')
      throw deliveryError('request-method-accessor-required');
    if (context.method() !== 'GET')
      throw deliveryError('request-method-not-allowed');
  };
  const requireUrlAccessor = (context) => {
    if (typeof context?.url !== 'function')
      throw deliveryError('request-url-accessor-required');
    return context.url();
  };
  const requestIdentity = (value) => {
    if (
      typeof value !== 'string' ||
      value.length < 1 ||
      value.length > 128 ||
      !/^[A-Za-z0-9._:-]+$/.test(value)
    )
      throw deliveryError('request-identity-invalid');
    return value;
  };
  const notifyHeldFaultWaiters = () => {
    for (const waiter of heldFaultWaiters) waiter.finish(null, true);
    heldFaultWaiters.clear();
  };
  const rejectHeldFaultWaiters = (error) => {
    for (const waiter of heldFaultWaiters) waiter.finish(error);
    heldFaultWaiters.clear();
  };
  const waitForFaultRequest = ({ timeoutMs = 30_000 } = {}) => {
    if (disposed || cancelled) throw deliveryError('fault-owner-not-active');
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30_000)
      throw new RangeError('Fault request wait is outside its fixed bound.');
    if (heldFaultRequest) return Promise.resolve(true);
    if (heldFaultWaiters.size >= 1)
      throw deliveryError('fault-waiter-limit-exceeded');
    return new Promise((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(
        () => finish(new Error('Expected fault request was not observed.')),
        timeoutMs,
      );
      const waiter = {
        finish(error, value) {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          heldFaultWaiters.delete(waiter);
          if (error) reject(error);
          else resolve(value);
        },
      };
      const finish = waiter.finish;
      heldFaultWaiters.add(waiter);
      if (heldFaultRequest) waiter.finish(null, true);
    });
  };
  const releaseFaultResponse = () => {
    if (!heldFaultRequest || disposed || cancelled) return false;
    const held = heldFaultRequest;
    heldFaultRequest = null;
    if (heldFaultTimer !== null) clearTimeout(heldFaultTimer);
    heldFaultTimer = null;
    faultReleasedCount += 1;
    heldFaultByRequestId.set(held.requestId, true);
    held.resolve(held.response);
    return true;
  };
  const respond = async (url, context = {}) => {
    try {
      const rawUrl = requireUrlAccessor(context);
      const assetPath = route(url, rawUrl);
      if (assetPath == null) return null;
      if (disposed) throw deliveryError('owner-disposed');
      if (cancelled) throw deliveryError('request-cancelled');
      requireGetAccessor(context);
      observeAbortSignal(context.signal);
      const asset = assetsByPath.get(assetPath);
      if (!asset) {
        recordMissingAssetPath(assetPath);
        throw deliveryError('native-asset-not-in-manifest');
      }
      if (requestedCount >= maxRequests)
        throw deliveryError('request-limit-exceeded');
      const requestId = requestIdentity(context.requestId);
      if (pendingByRequestId.has(requestId))
        throw deliveryError('duplicate-pending-request-identity');
      let bytes = fixture.assets.get(assetPath);
      let status = 200;
      const injectFault =
        faultScenario &&
        assetPath === faultScenario.assetPath &&
        faultInjectedCount === 0;
      if (injectFault) {
        if (faultScenario.mode === 'superseded-valid') {
          status = 200;
        } else if (faultScenario.mode === 'missing') {
          bytes = Buffer.alloc(0);
          status = faultScenario.status;
        } else {
          bytes = Buffer.from(bytes);
          // The pinned metadata is JSON and starts with `{`. This byte makes
          // the response deterministically invalid JSON without changing the
          // fixture-owned bytes.
          if (bytes[0] !== 0x7b)
            throw deliveryError('fault-source-json-shape-invalid');
          bytes[0] = 0x21;
          status = faultScenario.status;
        }
      }
      const contentType = contentTypeFor(asset.row);
      requestedCount += 1;
      counts.set(assetPath, (counts.get(assetPath) || 0) + 1);
      pendingByPath.set(assetPath, (pendingByPath.get(assetPath) || 0) + 1);
      pendingByUrl.set(rawUrl, (pendingByUrl.get(rawUrl) || 0) + 1);
      pendingByRequestId.set(requestId, assetPath);
      if (injectFault) {
        faultInjectedCount += 1;
        faultRequestId = requestId;
        if (faultScenario.mode !== 'superseded-valid')
          expectedFaultByRequestId.set(requestId, {
            scenarioId: faultScenarioId,
            assetPath,
            status,
            bodySha256: sha256(bytes),
            byteLength: bytes.length,
          });
      }
      const response = {
        status,
        contentType,
        headers: { 'access-control-allow-origin': normalizedOrigin },
        body: Buffer.from(bytes),
      };
      if (injectFault && faultScenario.mode === 'superseded-valid') {
        faultHeldRequestCount += 1;
        return await new Promise((resolve, reject) => {
          heldFaultRequest = { rawUrl, requestId, response, resolve, reject };
          heldFaultTimer = setTimeout(() => {
            if (heldFaultRequest?.requestId !== requestId) return;
            heldFaultRequest = null;
            heldFaultTimer = null;
            reject(deliveryError('held-fault-response-expired'));
          }, 30_000);
          notifyHeldFaultWaiters();
        });
      }
      return response;
    } catch (error) {
      recordError(error);
      throw error;
    }
  };
  const onFulfilled = (event = {}) => {
    try {
      if (typeof event.url !== 'string' || event.url.length > 2_048)
        throw deliveryError('fulfillment-url-invalid');
      const requestId = requestIdentity(event.requestId);
      const url = new URL(event.url);
      const assetPath = route(url, event.url);
      // Generic offline API responses and unrelated fulfillments belong to
      // other fixture owners; never count them as map assets.
      if (assetPath == null) return false;
      if (disposed || cancelled)
        throw deliveryError('late-fulfillment-after-cancel');
      const asset = assetsByPath.get(assetPath);
      if (!asset) {
        recordMissingAssetPath(assetPath);
        throw deliveryError('native-asset-not-in-manifest');
      }
      const expectedPending = pendingByPath.get(assetPath) || 0;
      const pendingUrlCount = pendingByUrl.get(event.url) || 0;
      if (
        pendingByRequestId.get(requestId) !== assetPath ||
        expectedPending < 1 ||
        pendingUrlCount < 1
      ) {
        unexpectedFulfillmentCount = Math.min(
          maxRequests + 1,
          unexpectedFulfillmentCount + 1,
        );
        throw deliveryError('fulfillment-without-owned-request');
      }
      const expectedFault = expectedFaultByRequestId.get(requestId);
      if (expectedFault) {
        if (
          event.method !== 'GET' ||
          event.status !== expectedFault.status ||
          typeof event.bodyBase64 !== 'string' ||
          event.bodyBase64.length > 16_384
        )
          throw deliveryError('fault-fulfillment-shape-invalid');
        const faultBytes = Buffer.from(event.bodyBase64, 'base64');
        if (
          faultBytes.toString('base64') !== event.bodyBase64 ||
          faultBytes.length !== expectedFault.byteLength ||
          sha256(faultBytes) !== expectedFault.bodySha256
        )
          throw deliveryError('fault-fulfillment-identity-mismatch');
        expectedFaultByRequestId.delete(requestId);
        pendingByRequestId.delete(requestId);
        pendingByPath.set(assetPath, expectedPending - 1);
        pendingByUrl.set(event.url, pendingUrlCount - 1);
        if (pendingUrlCount === 1) pendingByUrl.delete(event.url);
        faultAcknowledgedCount += 1;
        faultedByPathCount += 1;
        faultAcknowledgement = {
          requestId,
          assetPath,
          method: event.method,
          status: event.status,
          byteLength: faultBytes.length,
          sha256: sha256(faultBytes),
        };
        return true;
      }
      if (event.method !== 'GET' || event.status !== 200)
        throw deliveryError('fulfillment-status-invalid');
      if (
        typeof event.bodyBase64 !== 'string' ||
        event.bodyBase64.length > Math.ceil((asset.row.byteLength * 4) / 3) + 8
      )
        throw deliveryError('fulfillment-body-invalid');
      const bytes = Buffer.from(event.bodyBase64, 'base64');
      if (
        bytes.length !== asset.row.byteLength ||
        bytes.toString('base64') !== event.bodyBase64 ||
        !SHA256.test(asset.row.sha256) ||
        sha256(bytes) !== asset.row.sha256
      )
        throw deliveryError('fulfillment-body-identity-mismatch');
      pendingByPath.set(assetPath, expectedPending - 1);
      pendingByUrl.set(event.url, pendingUrlCount - 1);
      if (pendingUrlCount === 1) pendingByUrl.delete(event.url);
      pendingByRequestId.delete(requestId);
      fulfilledByPath.set(assetPath, (fulfilledByPath.get(assetPath) || 0) + 1);
      fulfilledAckCount += 1;
      if (heldFaultByRequestId.delete(requestId)) {
        faultAcknowledgedCount += 1;
        faultAcknowledgement = {
          requestId,
          assetPath,
          method: event.method,
          status: event.status,
          byteLength: bytes.length,
          sha256: sha256(bytes),
        };
      }
      return true;
    } catch (error) {
      recordError(error);
      throw error;
    }
  };
  const cancel = () => {
    if (cancelled) return;
    cancelled = true;
    rejectHeldFaultWaiters(deliveryError('request-cancelled'));
    if (heldFaultRequest) {
      const held = heldFaultRequest;
      heldFaultRequest = null;
      if (heldFaultTimer !== null) clearTimeout(heldFaultTimer);
      heldFaultTimer = null;
      held.reject(deliveryError('request-cancelled'));
    }
    for (const [path, pending] of pendingByPath) {
      cancelledCount += pending;
      cancelledByPath.set(path, (cancelledByPath.get(path) || 0) + pending);
    }
    pendingByPath.clear();
    pendingByUrl.clear();
    pendingByRequestId.clear();
  };
  const summary = () => {
    const pendingCount = [...pendingByPath.values()].reduce(
      (sum, count) => sum + count,
      0,
    );
    return {
      schema: MAP_STREAMING_DELIVERY_SCHEMA,
      fixtureId: fixture.id,
      manifestSha256: fixture.manifestSha256,
      appOrigin: normalizedOrigin,
      status: disposed ? 'disposed' : cancelled ? 'cancelled' : 'active',
      requestedCount,
      fulfilledAckCount,
      cancelledCount,
      pendingCount,
      unexpectedFulfillmentCount,
      errorObservationCount,
      omittedErrorObservationCount,
      omittedErrorKindCount: Math.max(
        0,
        errorCounts.size - MAP_STREAMING_MAX_ERROR_RECORDS,
      ),
      missingAssetPathEvidence: {
        observationCount: missingAssetObservationCount,
        uniquePathCount: missingAssetPathCounts.size,
        omittedPathCount: Math.max(
          0,
          missingAssetPathCounts.size - MAP_STREAMING_MAX_MISSING_ASSET_PATHS,
        ),
        paths: [...missingAssetPathCounts.entries()]
          .slice(0, MAP_STREAMING_MAX_MISSING_ASSET_PATHS)
          .map(([path, count]) => ({ path, observationCount: count })),
      },
      errors: [...errorCounts.entries()]
        .slice(0, MAP_STREAMING_MAX_ERROR_RECORDS)
        .map(([code, count]) => ({ code, count })),
      ...(faultScenario
        ? {
            faultInjection: {
              schema: MAP_STREAMING_FAULT_DELIVERY_SCHEMA,
              scenarioId: faultScenarioId,
              mode: faultScenario.mode,
              assetPath: faultScenario.assetPath,
              requestId: faultRequestId,
              declaredCount: 1,
              injectedCount: faultInjectedCount,
              heldRequestCount: faultHeldRequestCount,
              releasedCount: faultReleasedCount,
              acknowledgedCount: faultAcknowledgedCount,
              observationCount: faultAcknowledgedCount,
              acknowledgement: faultAcknowledgement,
              performanceAcceptanceEligible: false,
            },
          }
        : {}),
      assets: [...counts.entries()]
        .slice(0, fixture.manifest.assets.length)
        .map(([path, requests]) => {
          const row = assetsByPath.get(path).row;
          return {
            path,
            sha256: row.sha256,
            byteLength: row.byteLength,
            requests,
            fulfilledAckCount: fulfilledByPath.get(path) || 0,
            cancelledCount: cancelledByPath.get(path) || 0,
            ...(faultScenario && path === faultScenario.assetPath
              ? { faultedCount: faultedByPathCount }
              : {}),
          };
        }),
      limits: {
        maxRequests,
        maxAssets: fixture.manifest.assets.length,
        maxErrorRecords: MAP_STREAMING_MAX_ERROR_RECORDS,
        maxErrorObservations: MAP_STREAMING_MAX_ERROR_OBSERVATIONS_PER_DOCUMENT,
        maxMissingAssetPaths: MAP_STREAMING_MAX_MISSING_ASSET_PATHS,
        maxAbortSignals: MAP_STREAMING_MAX_ABORT_SIGNALS_PER_DOCUMENT,
      },
      cleanupConfirmed:
        disposed &&
        pendingCount === 0 &&
        expectedFaultByRequestId.size === 0 &&
        (!faultScenario ||
          (faultInjectedCount === 1 &&
            faultAcknowledgedCount === 1 &&
            (faultScenario.mode !== 'superseded-valid' ||
              (faultHeldRequestCount === 1 && faultReleasedCount === 1)))) &&
        unexpectedFulfillmentCount === 0 &&
        omittedErrorObservationCount === 0 &&
        errorCounts.size === 0,
      browserDecodeObserved: false,
      renderedReadinessObserved: false,
    };
  };
  const dispose = () => {
    if (disposed) return summary();
    cancel();
    disposed = true;
    for (const [signal, listener] of signals)
      signal.removeEventListener('abort', listener);
    signals.clear();
    return summary();
  };

  return Object.freeze({
    respond,
    onFulfilled,
    cancel,
    summary,
    dispose,
    waitForFaultRequest,
    releaseFaultResponse,
  });
}

/** Validate one intentionally faulted response without weakening healthy delivery checks. */
export function validateMapStreamingFaultDeliverySummary(
  summary,
  fixture,
  expectedScenarioId,
) {
  validateDeterministicMapStreamingFixture(fixture);
  const scenario = MAP_STREAMING_FAULT_SCENARIOS[expectedScenarioId];
  if (!scenario) throw new TypeError('Expected map fault scenario is unknown.');
  assert.equal(summary?.schema, MAP_STREAMING_DELIVERY_SCHEMA);
  assert.equal(summary.fixtureId, fixture.id);
  assert.equal(summary.manifestSha256, fixture.manifestSha256);
  assert.equal(summary.status, 'disposed');
  assert.equal(summary.cleanupConfirmed, true);
  assert.equal(summary.pendingCount, 0);
  assert.equal(summary.unexpectedFulfillmentCount, 0);
  assert.equal(summary.errorObservationCount, 0);
  assert.equal(summary.omittedErrorObservationCount, 0);
  assert.equal(summary.omittedErrorKindCount, 0);
  assert.deepEqual(summary.errors, []);
  assert.deepEqual(summary.missingAssetPathEvidence, {
    observationCount: 0,
    uniquePathCount: 0,
    omittedPathCount: 0,
    paths: [],
  });
  const faultEvidence = summary.faultInjection;
  assert.equal(faultEvidence?.schema, MAP_STREAMING_FAULT_DELIVERY_SCHEMA);
  assert.equal(faultEvidence?.scenarioId, expectedScenarioId);
  assert.equal(faultEvidence?.mode, scenario.mode);
  assert.equal(faultEvidence?.assetPath, scenario.assetPath);
  assert.match(faultEvidence?.requestId || '', /^[A-Za-z0-9._:-]{1,128}$/);
  assert.equal(faultEvidence?.declaredCount, 1);
  assert.equal(faultEvidence?.injectedCount, 1);
  assert.equal(
    faultEvidence?.heldRequestCount,
    scenario.mode === 'superseded-valid' ? 1 : 0,
  );
  assert.equal(
    faultEvidence?.releasedCount,
    scenario.mode === 'superseded-valid' ? 1 : 0,
  );
  assert.equal(faultEvidence?.acknowledgedCount, 1);
  assert.equal(faultEvidence?.observationCount, 1);
  assert.equal(faultEvidence?.performanceAcceptanceEligible, false);
  assert.deepEqual(Object.keys(faultEvidence?.acknowledgement || {}).sort(), [
    'assetPath',
    'byteLength',
    'method',
    'requestId',
    'sha256',
    'status',
  ]);
  assert.ok(Number.isSafeInteger(summary.requestedCount));
  assert.ok(summary.requestedCount > 0);
  assert.ok(
    Number.isSafeInteger(summary.limits?.maxRequests) &&
      summary.limits.maxRequests > 0 &&
      summary.limits.maxRequests <= MAP_STREAMING_MAX_REQUESTS_PER_DOCUMENT,
    'Fault delivery reports a bounded per-document request limit.',
  );
  assert.ok(
    summary.requestedCount <= summary.limits.maxRequests,
    'Fault delivery does not exceed its declared request limit.',
  );
  assert.ok(
    Number.isSafeInteger(summary.fulfilledAckCount) &&
      summary.fulfilledAckCount >= 0,
  );
  assert.ok(
    Number.isSafeInteger(summary.cancelledCount) && summary.cancelledCount >= 0,
  );
  assert.equal(
    summary.fulfilledAckCount +
      summary.cancelledCount +
      (scenario.mode === 'superseded-valid' ? 0 : 1),
    summary.requestedCount,
  );
  assert.ok(Array.isArray(summary.assets));
  let fulfilled = 0;
  let cancelled = 0;
  let faulted = 0;
  let targetRows = 0;
  const paths = new Set();
  const knownAssets = new Map(
    fixture.manifest.assets.map((row) => [row.path, row]),
  );
  for (const row of summary.assets) {
    const expected = knownAssets.get(row.path);
    assert.ok(expected, 'Fault delivery asset belongs to the fixture.');
    assert.equal(paths.has(row.path), false);
    paths.add(row.path);
    assert.equal(row.sha256, expected.sha256);
    assert.equal(row.byteLength, expected.byteLength);
    assert.ok(Number.isSafeInteger(row.requests) && row.requests > 0);
    assert.ok(
      Number.isSafeInteger(row.fulfilledAckCount) && row.fulfilledAckCount >= 0,
    );
    assert.ok(
      Number.isSafeInteger(row.cancelledCount) && row.cancelledCount >= 0,
    );
    const rowFaulted = row.faultedCount ?? 0;
    assert.ok(Number.isSafeInteger(rowFaulted) && rowFaulted >= 0);
    assert.equal(
      row.fulfilledAckCount + row.cancelledCount + rowFaulted,
      row.requests,
    );
    fulfilled += row.fulfilledAckCount;
    cancelled += row.cancelledCount;
    faulted += rowFaulted;
    if (row.path === scenario.assetPath) {
      targetRows += 1;
      assert.equal(rowFaulted, scenario.mode === 'superseded-valid' ? 0 : 1);
    } else assert.equal(rowFaulted, 0);
  }
  assert.equal(targetRows, 1);
  assert.equal(fulfilled, summary.fulfilledAckCount);
  assert.equal(cancelled, summary.cancelledCount);
  assert.equal(faulted, scenario.mode === 'superseded-valid' ? 0 : 1);
  const acknowledgement = faultEvidence.acknowledgement;
  assert.ok(acknowledgement && typeof acknowledgement === 'object');
  assert.equal(
    typeof acknowledgement.requestId,
    'string',
    'Fault acknowledgment retains the request-scoped CDP identity.',
  );
  assert.match(acknowledgement.requestId, /^[A-Za-z0-9._:-]{1,128}$/);
  assert.equal(acknowledgement.requestId, faultEvidence.requestId);
  assert.equal(acknowledgement.assetPath, scenario.assetPath);
  assert.equal(acknowledgement.method, 'GET');
  const expectedBytes = Buffer.from(fixture.assets.get(scenario.assetPath));
  let expectedStatus = scenario.status;
  if (scenario.mode === 'corrupt-json') expectedBytes[0] = 0x21;
  if (scenario.mode === 'superseded-valid') expectedStatus = 200;
  const expectedFaultBytes =
    scenario.mode === 'missing' ? Buffer.alloc(0) : expectedBytes;
  assert.equal(acknowledgement.status, expectedStatus);
  assert.equal(acknowledgement.byteLength, expectedFaultBytes.length);
  assert.equal(acknowledgement.sha256, sha256(expectedFaultBytes));
  assert.equal(summary.browserDecodeObserved, false);
  assert.equal(summary.renderedReadinessObserved, false);
  return true;
}
