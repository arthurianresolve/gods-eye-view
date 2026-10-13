import { createHash } from 'node:crypto';
import {
  getMapFixtureBuildProfileGoogleApiKey,
  MAP_FIXTURE_BUILD_PROFILE_ID,
} from './buildProvenance.mjs';
import { validateDeterministicMapStreamingFixture } from './mapStreamingFixture.mjs';

export const MAP_STREAMING_DELIVERY_SCHEMA =
  'gev-map-streaming-fixture-delivery/v1';
export const MAP_STREAMING_MAX_REQUESTS_PER_DOCUMENT = 512;
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

  const googleKey = getMapFixtureBuildProfileGoogleApiKey(buildProfileId);
  const assetsByPath = new Map(
    fixture.manifest.assets.map((row) => [row.path, { row }]),
  );
  const counts = new Map();
  const pendingByPath = new Map();
  const fulfilledByPath = new Map();
  const cancelledByPath = new Map();
  const pendingByUrl = new Map();
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
      const bytes = fixture.assets.get(assetPath);
      const contentType = contentTypeFor(asset.row);
      requestedCount += 1;
      counts.set(assetPath, (counts.get(assetPath) || 0) + 1);
      pendingByPath.set(assetPath, (pendingByPath.get(assetPath) || 0) + 1);
      pendingByUrl.set(rawUrl, (pendingByUrl.get(rawUrl) || 0) + 1);
      return {
        status: 200,
        contentType,
        headers: { 'access-control-allow-origin': normalizedOrigin },
        body: Buffer.from(bytes),
      };
    } catch (error) {
      recordError(error);
      throw error;
    }
  };
  const onFulfilled = (event = {}) => {
    try {
      if (typeof event.url !== 'string' || event.url.length > 2_048)
        throw deliveryError('fulfillment-url-invalid');
      const url = new URL(event.url);
      const assetPath = route(url, event.url);
      // Generic offline API responses and unrelated fulfillments belong to
      // other fixture owners; never count them as map assets.
      if (assetPath == null) return false;
      if (disposed || cancelled)
        throw deliveryError('late-fulfillment-after-cancel');
      if (event.method !== 'GET' || event.status !== 200)
        throw deliveryError('fulfillment-status-invalid');
      const asset = assetsByPath.get(assetPath);
      if (!asset) {
        recordMissingAssetPath(assetPath);
        throw deliveryError('native-asset-not-in-manifest');
      }
      const expectedPending = pendingByPath.get(assetPath) || 0;
      const pendingUrlCount = pendingByUrl.get(event.url) || 0;
      if (expectedPending < 1 || pendingUrlCount < 1) {
        unexpectedFulfillmentCount = Math.min(
          maxRequests + 1,
          unexpectedFulfillmentCount + 1,
        );
        throw deliveryError('fulfillment-without-owned-request');
      }
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
      fulfilledByPath.set(assetPath, (fulfilledByPath.get(assetPath) || 0) + 1);
      fulfilledAckCount += 1;
      return true;
    } catch (error) {
      recordError(error);
      throw error;
    }
  };
  const cancel = () => {
    if (cancelled) return;
    cancelled = true;
    for (const [path, pending] of pendingByPath) {
      cancelledCount += pending;
      cancelledByPath.set(path, (cancelledByPath.get(path) || 0) + pending);
    }
    pendingByPath.clear();
    pendingByUrl.clear();
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

  return Object.freeze({ respond, onFulfilled, cancel, summary, dispose });
}
