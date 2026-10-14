import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as Cesium from 'cesium';
import { decodeAlprTile } from '../../src/layers/alpr/tileRecords.js';
import { parseTleText, tleCatalogNumber } from '../../src/sources/tle.js';
import {
  AUSTIN_OPERATING_FIXED_TIME,
  AUSTIN_OPERATING_LAYER_COUNTS,
  AUSTIN_OPERATING_ROUTE,
  AUSTIN_OPERATING_REQUIRED_ALPR_TILES,
  AUSTIN_OPERATING_REQUIRED_RESPONSE_IDS,
  AUSTIN_OPERATING_SELECTED_LAYER_IDS,
  AUSTIN_OPERATING_VISUAL_STATE,
  AUSTIN_OPERATING_WIND_VALID_TIME,
  AUSTIN_OPERATING_WORKLOAD_ID,
} from './austinOperatingWorkloadContract.mjs';

export * from './austinOperatingWorkloadContract.mjs';

/** Bounded native layer state for an already-failed Austin readiness wait. */
export function observeAustinOperatingReadinessFailure(selectedLayerIds) {
  const app = window.__godsEyeView;
  const manager = app?.dataManager;
  const ids = Array.isArray(selectedLayerIds)
    ? selectedLayerIds.slice(0, 8)
    : [];
  const safeError = (value) =>
    String(value?.message ?? value)
      .replace(/https?:\/\/[^\s"'<>]+/gi, '[url]')
      .replace(
        /\b(authorization|bearer|token|api[_-]?key)\b\s*[:=]?\s*[^\s,;]+/gi,
        '$1=[redacted]',
      )
      .slice(0, 160);
  return {
    schema: 'gev-austin-readiness-failure/v1',
    selectedLayerCount: ids.length,
    layers: ids.map((id) => {
      let layer = {
        id: String(id).slice(0, 80),
        enabled: false,
        count: null,
        loading: null,
        loadingLoaded: null,
        loadingTotal: null,
        ownership: null,
        status: null,
        error: null,
      };
      try {
        const entry = manager?.layers?.get?.(id);
        const stats = entry?.module?.getStats?.() ?? entry?.stats ?? null;
        let counts = null;
        try {
          if (id === 'cctv')
            counts = entry?.module?.getPerformanceDiagnostics?.() ?? null;
        } catch {
          // Optional ownership diagnostics must not erase native loading state.
        }
        const boundedCount = (value) =>
          Number.isSafeInteger(value) && value >= 0 && value <= 1000000
            ? value
            : null;
        const error = stats?.error ?? entry?.error ?? null;
        layer = {
          id: String(id).slice(0, 80),
          enabled: manager?.isEnabled?.(id) === true,
          count: Number.isSafeInteger(stats?.count) ? stats.count : null,
          loading: typeof stats?.loading === 'boolean' ? stats.loading : null,
          loadingLoaded: boundedCount(stats?.loadingLoaded),
          loadingTotal: boundedCount(stats?.loadingTotal),
          ownership: counts
            ? {
                timers: boundedCount(counts.timers),
                pendingJobs: boundedCount(counts.pendingJobs),
                primitives: boundedCount(counts.primitives),
                dataSources: boundedCount(counts.dataSources),
              }
            : null,
          status:
            typeof stats?.status === 'string'
              ? stats.status.slice(0, 80)
              : null,
          error: error == null ? null : safeError(error),
        };
      } catch (error) {
        layer.error = safeError(error);
      }
      return layer;
    }),
  };
}

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../..',
);
const MAX_ASSET_BYTES = 8 * 1024 * 1024;
const SHA256 = /^[a-f0-9]{64}$/;
const TLE_GROUPS = [
  'stations',
  'visual',
  'gps-ops',
  'glo-ops',
  'galileo',
  'geo',
];
const ALPR_TILES = AUSTIN_OPERATING_REQUIRED_ALPR_TILES;
const RETAINED_ORIGINAL_ALPR_TILES = [
  [466, 842],
  [466, 843],
  [468, 844],
  [467, 844],
  [466, 844],
];
const REQUIRED_RESPONSE_IDS = AUSTIN_OPERATING_REQUIRED_RESPONSE_IDS;
const FIXTURE_BYTES = new WeakMap();
const BASE_ASSETS = Object.freeze({
  'cctv-catalog': [
    'src/data/fixtures/austin-operating-v1/cctv/normalized-250.json',
    'application/json',
  ],
  'cctv-raw-catalog': [
    'src/data/fixtures/austin-operating-v1/cctv/rows.json',
    'application/json',
  ],
  'alpr-tilejson': [
    'src/data/fixtures/austin-operating-v1/alpr/tilejson.json',
    'application/json',
  ],
  'wind-grid': [
    'src/data/fixtures/austin-operating-v1/wind/gfs-weather-grid.bin',
    'application/octet-stream',
  ],
  ...Object.fromEntries(
    TLE_GROUPS.map((group) => [
      `tle-${group}`,
      [`src/data/fixtures/austin-operating-v1/tle/${group}.tle`, 'text/plain'],
    ]),
  ),
  ...Object.fromEntries(
    ALPR_TILES.map(([z, x, y]) => [
      `alpr-${z}-${x}-${y}`,
      [
        `src/data/fixtures/austin-operating-v1/alpr/z10-native/${x}-${y}.pbf`,
        'application/x-protobuf',
      ],
    ]),
  ),
});

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const canonicalTime = (value) => {
  const ms = Date.parse(value);
  if (!Number.isSafeInteger(ms) || new Date(ms).toISOString() !== value)
    throw new TypeError('Austin fixture time must be canonical UTC ISO-8601.');
  return ms;
};

function uuid(index) {
  const suffix = index.toString(16).padStart(12, '0');
  return `a5700000-0000-4000-8000-${suffix}`;
}

function makeSyntheticRadioStations() {
  return Array.from({ length: 750 }, (_, index) => {
    const local = index < 180;
    const localRow = Math.floor(index / 18);
    const localColumn = index % 18;
    const latitude = local
      ? AUSTIN_OPERATING_ROUTE.south +
        ((localRow + 0.5) / 10) *
          (AUSTIN_OPERATING_ROUTE.north - AUSTIN_OPERATING_ROUTE.south)
      : -55 + ((index * 37) % 11000) / 100;
    const longitude = local
      ? AUSTIN_OPERATING_ROUTE.west +
        ((localColumn + 0.5) / 18) *
          (AUSTIN_OPERATING_ROUTE.east - AUSTIN_OPERATING_ROUTE.west)
      : -170 + ((index * 73) % 34000) / 100;
    const category = ['news', 'talk', 'weather', 'public-safety', 'music'][
      index % 5
    ];
    return {
      id: uuid(index + 1),
      name: `Synthetic Austin operating radio ${String(index + 1).padStart(3, '0')}`,
      lat: latitude,
      lon: longitude,
      streamUrl: `https://stream-${String(index + 1).padStart(3, '0')}.example/audio`,
      homepage: null,
      tags: [category, 'benchmark fixture'],
      languages: ['English'],
      state: local ? 'Texas' : '',
      country: local ? 'United States' : 'Synthetic benchmark region',
      countryCode: local ? 'US' : '',
      metadataTrust: 'untrusted-community',
      codec: 'MP3',
      bitrate: 128,
    };
  });
}

function makeSyntheticInstallations() {
  return Array.from({ length: 699 }, (_, index) => {
    const row = Math.floor(index / 27);
    const column = index % 27;
    const lat =
      AUSTIN_OPERATING_ROUTE.south +
      ((row + 0.5) / 26) *
        (AUSTIN_OPERATING_ROUTE.north - AUSTIN_OPERATING_ROUTE.south);
    const lon =
      AUSTIN_OPERATING_ROUTE.west +
      ((column + 0.5) / 27) *
        (AUSTIN_OPERATING_ROUTE.east - AUSTIN_OPERATING_ROUTE.west);
    const tag = ['airfield', 'range', 'barracks', 'base'][index % 4];
    return {
      type: 'node',
      id: 9000000000 + index,
      lat,
      lon,
      tags: {
        military: tag,
        name: `Synthetic benchmark installation ${String(index + 1).padStart(3, '0')}`,
      },
    };
  });
}

function makeCctvHealth(cameras, updatedAt) {
  return cameras.map((camera) => ({
    id: camera.id,
    status: 'unknown',
    sourceKind: 'synthetic-fixture',
    label: 'Generated benchmark frame; no live camera request',
    message: '',
    reasonCode: 'synthetic-placeholder',
    upstreamReasonCode: 'unknown',
    transportStatus: 'unknown',
    attemptedAt: Date.parse(updatedAt),
    lastSuccessAt: null,
    sourceObservedAt: null,
    refreshIntervalMs: null,
    updatedAt: Date.parse(updatedAt),
  }));
}

function syntheticFrame(cameraId) {
  const value = [...String(cameraId)].reduce(
    (sum, char) => sum + char.charCodeAt(0),
    0,
  );
  const hue = value % 360;
  const body = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360" viewBox="0 0 640 360"><rect width="640" height="360" fill="hsl(${hue} 30% 22%)"/><path d="M0 250L640 150M0 190L640 220" stroke="#b8c6c9" stroke-width="18"/><rect x="270" y="80" width="100" height="48" rx="5" fill="#20353c"/><text x="320" y="108" text-anchor="middle" font-family="sans-serif" font-size="16" fill="#d6efef">FIXTURE ONLY</text><text x="20" y="340" font-family="monospace" font-size="16" fill="#fff">synthetic:${cameraId}</text></svg>`;
  return Buffer.from(body);
}

function hasCctvCameraId(fixture, cameraId) {
  const catalog = JSON.parse(
    FIXTURE_BYTES.get(fixture).get('cctv-catalog').toString('utf8'),
  );
  return catalog.some((row) => row.id === cameraId);
}

function assetManifest(id, bytes, contentType, provenance) {
  return Object.freeze({
    id,
    sha256: sha256(bytes),
    byteLength: bytes.length,
    contentType,
    provenance,
  });
}

export function createAustinOperatingWorkloadFixture(
  fixedTime = AUSTIN_OPERATING_FIXED_TIME,
) {
  const fixedTimeMs = canonicalTime(fixedTime);
  if (fixedTime !== AUSTIN_OPERATING_FIXED_TIME)
    throw new TypeError(
      `Austin operating fixture time must be ${AUSTIN_OPERATING_FIXED_TIME}.`,
    );
  const byteMap = new Map();
  const assets = [];
  for (const [id, [relativePath, contentType]] of Object.entries(BASE_ASSETS)) {
    const bytes = readFileSync(path.join(ROOT, ...relativePath.split('/')));
    if (bytes.length > MAX_ASSET_BYTES)
      throw new RangeError(`Austin asset ${id} exceeds its bound.`);
    byteMap.set(id, bytes);
    assets.push(
      assetManifest(
        id,
        bytes,
        contentType,
        'pinned local snapshot; acquisition provenance recorded separately',
      ),
    );
  }

  const alprAcquisition = JSON.parse(
    readFileSync(
      path.join(
        ROOT,
        'src/data/fixtures/austin-operating-v1/alpr/acquisition.json',
      ),
      'utf8',
    ),
  );
  const alprNativeRouteAcquisition = JSON.parse(
    readFileSync(
      path.join(
        ROOT,
        'src/data/fixtures/austin-operating-v1/alpr/z10-native/acquisition.json',
      ),
      'utf8',
    ),
  );
  const tleAcquisition = JSON.parse(
    readFileSync(
      path.join(
        ROOT,
        'src/data/fixtures/austin-operating-v1/tle/acquisition.json',
      ),
      'utf8',
    ),
  );
  const cctvAcquisition = JSON.parse(
    readFileSync(
      path.join(
        ROOT,
        'src/data/fixtures/austin-operating-v1/cctv/normalized-acquisition.json',
      ),
      'utf8',
    ),
  );
  const cctvSourceAcquisition = JSON.parse(
    readFileSync(
      path.join(
        ROOT,
        'src/data/fixtures/austin-operating-v1/cctv/source-acquisition.json',
      ),
      'utf8',
    ),
  );
  const alprManifestBytes = byteMap.get('alpr-tilejson');
  if (
    alprAcquisition?.schema !== 'austin-operating-alpr-acquisition/v1' ||
    alprAcquisition.manifest?.sha256 !== sha256(alprManifestBytes) ||
    alprAcquisition.manifest?.byteLength !== alprManifestBytes.length ||
    alprAcquisition.sourceProvenance?.checkedDate !== '2026-10-12' ||
    alprAcquisition.sourceProvenance?.underlyingData !==
      'OpenStreetMap contributors'
  )
    throw new Error(
      'ALPR acquisition provenance does not match its pinned manifest.',
    );
  const historicalAlprTileKeys = new Set();
  for (const tile of alprAcquisition.tiles || []) {
    const key = `${tile.z}/${tile.x}/${tile.y}`;
    if (
      tile.z !== 11 ||
      !Number.isSafeInteger(tile.x) ||
      !Number.isSafeInteger(tile.y) ||
      tile.status !== 200 ||
      tile.contentType !== 'application/x-protobuf' ||
      tile.filename !== `${tile.x}-${tile.y}.pbf` ||
      !Number.isSafeInteger(Date.parse(tile.fetchedAt)) ||
      new Date(Date.parse(tile.fetchedAt)).toISOString() !== tile.fetchedAt ||
      historicalAlprTileKeys.has(key)
    )
      throw new Error(
        `ALPR acquisition row identity is invalid or duplicated for ${key}.`,
      );
    historicalAlprTileKeys.add(key);
    const bytes = readFileSync(
      path.join(
        ROOT,
        'src/data/fixtures/austin-operating-v1/alpr',
        tile.filename,
      ),
    );
    if (bytes.length !== tile.byteLength || sha256(bytes) !== tile.sha256)
      throw new Error(
        `ALPR acquired tile metadata does not match ${tile.filename}.`,
      );
  }
  for (const [x, y] of RETAINED_ORIGINAL_ALPR_TILES) {
    if (!historicalAlprTileKeys.has(`11/${x}/${y}`))
      throw new Error(
        `Retained original ALPR acquisition row is missing for ${x}/${y}.`,
      );
  }
  const routeTileKeys = new Set(
    alprNativeRouteAcquisition.routeCoverage?.requiredTiles || [],
  );
  if (
    alprNativeRouteAcquisition.schema !==
      'austin-operating-alpr-native-route-acquisition/v1' ||
    routeTileKeys.size !== ALPR_TILES.length ||
    ALPR_TILES.some(([z, x, y]) => !routeTileKeys.has(`${z}/${x}/${y}`))
  )
    throw new Error(
      'ALPR native route tile union differs from its pinned source audit.',
    );
  const nativeTileKeys = new Set();
  for (const tile of alprNativeRouteAcquisition.tiles || []) {
    const key = `${tile.z}/${tile.x}/${tile.y}`;
    if (
      tile.z !== 10 ||
      !Number.isSafeInteger(tile.x) ||
      !Number.isSafeInteger(tile.y) ||
      tile.status !== 200 ||
      tile.contentType !== 'application/x-protobuf' ||
      tile.filename !== `${tile.x}-${tile.y}.pbf` ||
      !Number.isSafeInteger(Date.parse(tile.fetchedAt)) ||
      new Date(Date.parse(tile.fetchedAt)).toISOString() !== tile.fetchedAt ||
      nativeTileKeys.has(key)
    )
      throw new Error(
        `ALPR native route acquisition row identity is invalid or duplicated for ${key}.`,
      );
    nativeTileKeys.add(key);
    const bytes = readFileSync(
      path.join(
        ROOT,
        'src/data/fixtures/austin-operating-v1/alpr/z10-native',
        tile.filename,
      ),
    );
    if (bytes.length !== tile.byteLength || sha256(bytes) !== tile.sha256)
      throw new Error(
        `ALPR native route metadata does not match ${tile.filename}.`,
      );
  }
  if (
    nativeTileKeys.size !== routeTileKeys.size ||
    [...routeTileKeys].some((key) => !nativeTileKeys.has(key))
  )
    throw new Error(
      'ALPR native route rows do not exactly match the required tile inventory.',
    );
  if (
    tleAcquisition?.schema !== 'gev-austin-tle-acquisition/v1' ||
    !Array.isArray(tleAcquisition.rows) ||
    cctvAcquisition?.schema !== 'austin-operating-cctv-normalized/v1' ||
    cctvSourceAcquisition?.schema !== 'gev-austin-cctv-acquisition/v1'
  )
    throw new Error(
      'Austin source acquisition records are missing or malformed.',
    );
  const tleRowsByGroup = new Map(
    tleAcquisition.rows.map((row) => [row.group, row]),
  );
  if (
    tleAcquisition.rows.length !== TLE_GROUPS.length ||
    tleRowsByGroup.size !== TLE_GROUPS.length ||
    TLE_GROUPS.some((group) => {
      const row = tleRowsByGroup.get(group);
      return (
        !row ||
        row.filename !== `${group}.tle` ||
        row.status !== 200 ||
        row.accepted !== true ||
        !Number.isSafeInteger(Date.parse(row.fetchedAt)) ||
        new Date(Date.parse(row.fetchedAt)).toISOString() !== row.fetchedAt ||
        row.url !==
          `https://celestrak.org/NORAD/elements/gp.php?GROUP=${group}&FORMAT=tle`
      );
    })
  )
    throw new Error(
      'TLE acquisition rows do not exactly identify the six accepted group snapshots.',
    );
  for (const row of tleAcquisition.rows) {
    const bytes = byteMap.get(`tle-${row.group}`);
    if (
      !bytes ||
      bytes.length !== row.byteLength ||
      sha256(bytes) !== row.sha256
    )
      throw new Error(
        `TLE acquired snapshot metadata does not match ${row.group}.`,
      );
  }
  const rawCctv = byteMap.get('cctv-raw-catalog');
  const normalizedCctv = byteMap.get('cctv-catalog');
  if (
    cctvSourceAcquisition.sha256 !== sha256(rawCctv) ||
    cctvSourceAcquisition.byteLength !== rawCctv.length ||
    cctvAcquisition.rawSha256 !== sha256(rawCctv) ||
    cctvAcquisition.rawByteLength !== rawCctv.length ||
    cctvAcquisition.normalizedSha256 !== sha256(normalizedCctv) ||
    cctvAcquisition.normalizedByteLength !== normalizedCctv.length
  )
    throw new Error(
      'CCTV source and normalized acquisition records do not match their pinned bytes.',
    );

  const radioPayload = {
    stations: makeSyntheticRadioStations(),
    updatedAt: '2026-10-12T18:00:00.000Z',
    stale: false,
    degraded: false,
    degradedReason: null,
    coverage: {
      successfulQueries: 9,
      totalQueries: 9,
      stationCount: 750,
      synthetic: true,
    },
    acceptedGeneration: 1,
    catalogInstance: 'austin-operating-synthetic-radio-v1',
    fixtureOnly: true,
  };
  const radioBytes = Buffer.from(JSON.stringify(radioPayload));
  byteMap.set('radio-directory', radioBytes);
  assets.push(
    assetManifest(
      'radio-directory',
      radioBytes,
      'application/json',
      'synthetic deterministic 750-station cap stress; not an observed Radio Browser catalog',
    ),
  );

  const installationsPayload = {
    elements: makeSyntheticInstallations(),
    status: 'ready',
    saturated: false,
    elementCap: 700,
    retrievedAt: '2026-10-12T18:00:00.000Z',
    fixtureOnly: true,
  };
  const installationsBytes = Buffer.from(JSON.stringify(installationsPayload));
  byteMap.set('installations', installationsBytes);
  assets.push(
    assetManifest(
      'installations',
      installationsBytes,
      'application/json',
      'synthetic deterministic 699-feature cap stress; not an observed Overpass response',
    ),
  );

  const cameras = JSON.parse(byteMap.get('cctv-catalog').toString('utf8'));
  if (
    !Array.isArray(cameras) ||
    cameras.length !== AUSTIN_OPERATING_LAYER_COUNTS.cctv
  )
    throw new Error('Pinned Austin camera catalog population changed.');
  const sourceEnvelopeBytes = Buffer.from(JSON.stringify({ sources: cameras }));
  byteMap.set('cctv-catalog-response', sourceEnvelopeBytes);
  assets.push(
    assetManifest(
      'cctv-catalog-response',
      sourceEnvelopeBytes,
      'application/json',
      'production source endpoint envelope over pinned camera metadata',
    ),
  );
  const healthBytes = Buffer.from(
    JSON.stringify({
      cameras: makeCctvHealth(cameras, AUSTIN_OPERATING_FIXED_TIME),
    }),
  );
  byteMap.set('cctv-health', healthBytes);
  assets.push(
    assetManifest(
      'cctv-health',
      healthBytes,
      'application/json',
      'synthetic health metadata; no camera health query',
    ),
  );

  const windGrid = byteMap.get('wind-grid');
  const windManifest = {
    model: 'gfs',
    overlay: 'none',
    cycle: {
      runIso: '2026-10-08T00:00:00.000Z',
      validIso: AUSTIN_OPERATING_WIND_VALID_TIME,
      forecastHour: 12,
    },
    level: 'surface',
    units: 'm/s',
    grid: { nx: 360, ny: 181, lo1: 0, la1: 90, dx: 1, dy: 1 },
    gridUrl: '/api/wind/grid/gfs-austin-operating-v1.bin?model=gfs',
  };
  const windManifestBytes = Buffer.from(JSON.stringify(windManifest));
  byteMap.set('wind-manifest', windManifestBytes);
  assets.push(
    assetManifest(
      'wind-manifest',
      windManifestBytes,
      'application/json',
      'pinned GFS fixture metadata; valid time remains Oct 8, not harness time',
    ),
  );

  const tleBytes = TLE_GROUPS.map((group) =>
    byteMap.get(`tle-${group}`).toString('utf8'),
  );
  const catalogIds = new Set();
  for (const text of tleBytes) {
    for (const record of parseTleText(text)) {
      const catalogNumber = tleCatalogNumber(record.line1);
      if (catalogNumber !== null) catalogIds.add(catalogNumber);
    }
  }
  if (catalogIds.size !== AUSTIN_OPERATING_LAYER_COUNTS.satellites)
    throw new Error(`Pinned TLE catalog parsed ${catalogIds.size} unique IDs.`);

  const alprRecords = [];
  for (const [z, x, y] of ALPR_TILES) {
    const decoded = decodeAlprTile(byteMap.get(`alpr-${z}-${x}-${y}`), z, x, y);
    for (const record of decoded) alprRecords.push(record);
  }
  const uniqueAlpr = new Map(alprRecords.map((record) => [record.id, record]));
  if (uniqueAlpr.size !== AUSTIN_OPERATING_LAYER_COUNTS['alpr-cameras'])
    throw new Error(
      `Pinned ALPR route tiles decoded ${uniqueAlpr.size} unique cameras.`,
    );
  const canonicalIdHash = (rows, project = (row) => row) =>
    sha256(
      Buffer.from(
        rows
          .map((row) => String(project(row)))
          .sort()
          .join('\n'),
        'utf8',
      ),
    );
  const installationsCatalog = JSON.parse(installationsBytes).elements;
  const sourcePopulationHashes = {
    satellites: canonicalIdHash([...catalogIds]),
    cctv: canonicalIdHash(cameras, (row) => row.id ?? row.sourceId),
    'alpr-cameras': canonicalIdHash([...uniqueAlpr.keys()]),
    'military-installations': canonicalIdHash(
      installationsCatalog,
      (row) => row.tags.name,
    ),
    radio: canonicalIdHash(radioPayload.stations, (row) => row.id),
  };
  const sourcePopulationIds = {
    'military-installations': installationsCatalog
      .map((row) => row.tags.name)
      .sort(),
  };

  const julian = Cesium.JulianDate.fromDate(new Date(fixedTimeMs));
  const serializable = {
    schema: 'gev-austin-operating-fixture/v1',
    id: 'austin-operating-composed-v1',
    workloadId: AUSTIN_OPERATING_WORKLOAD_ID,
    fixedTime,
    fixedTimeMs,
    windSourceTime: AUSTIN_OPERATING_WIND_VALID_TIME,
    windSourceAgeMs: fixedTimeMs - Date.parse(AUSTIN_OPERATING_WIND_VALID_TIME),
    route: { ...AUSTIN_OPERATING_ROUTE },
    clock: { dayNumber: julian.dayNumber, secondsOfDay: julian.secondsOfDay },
    selectedLayerIds: [...AUSTIN_OPERATING_SELECTED_LAYER_IDS],
    expectedLayerCounts: { ...AUSTIN_OPERATING_LAYER_COUNTS },
    sourcePopulationHashes,
    sourcePopulationIds,
    visualState: { ...AUSTIN_OPERATING_VISUAL_STATE },
    provenance: {
      cctvCatalog:
        'official Austin Open Data metadata normalized by the production loader; generated frame bytes only',
      alpr: 'actual bounded public hourly-vector tiles and TileJSON from https://github.com/flockhopper3/deflock-data (checked 2026-10-12); underlying OSM data: © OpenStreetMap contributors, ODbL 1.0 (https://www.openstreetmap.org/copyright; https://opendatacommons.org/licenses/odbl/1-0/)',
      tle: 'actual six CelesTrak group snapshots; newer element epochs retained; math-valid propagation is not a currentness claim',
      radio:
        'synthetic native response schema, 750 source-cap stress records; no live directory coverage claim',
      installations:
        'synthetic native endpoint schema, 699 records below the 700 cap; no observed facility/coverage claim',
      wind: 'pinned GFS grid with unchanged source valid time Oct 8 12Z; age at Austin harness clock is 4d6h',
      benchmarkEligibility:
        'eligible only after a complete matched five-run capture passes the shared acceptance contract',
    },
    acquisition: {
      alpr: alprAcquisition,
      alprNativeRoute: alprNativeRouteAcquisition,
      cctv: { source: cctvSourceAcquisition, normalization: cctvAcquisition },
      tle: tleAcquisition,
    },
    assets,
  };
  const manifestSha256 = sha256(Buffer.from(JSON.stringify(serializable)));
  const fixture = Object.freeze({
    ...serializable,
    manifestSha256,
    sha256: manifestSha256,
    assets: Object.freeze(assets),
    selectedLayerIds: Object.freeze(serializable.selectedLayerIds),
    expectedLayerCounts: Object.freeze(serializable.expectedLayerCounts),
    route: Object.freeze(serializable.route),
    clock: Object.freeze(serializable.clock),
    visualState: Object.freeze(serializable.visualState),
  });
  FIXTURE_BYTES.set(fixture, byteMap);
  return fixture;
}

const exactParams = (url, names) => {
  const entries = [...url.searchParams.entries()];
  return (
    entries.length === names.length &&
    names.every((name) => url.searchParams.has(name)) &&
    new Set(entries.map(([name]) => name)).size === entries.length
  );
};
const methodOf = (request) =>
  typeof request?.method === 'function' ? request.method() : request?.method;

function routeAsset(url, method, fixture, appOrigin) {
  if (method !== 'GET') return null;
  if (
    url.origin === appOrigin &&
    /^\/api\/celestrak\/[a-z0-9-]+$/i.test(url.pathname) &&
    !url.search
  ) {
    const id = `tle-${url.pathname.split('/').at(-1)}`;
    return REQUIRED_RESPONSE_IDS.includes(id) ? id : null;
  }
  if (
    url.origin === appOrigin &&
    url.pathname === '/api/cctv/sources' &&
    exactParams(url, [])
  )
    return 'cctv-catalog-response';
  if (
    url.origin === appOrigin &&
    url.pathname === '/api/cctv/health' &&
    exactParams(url, [])
  )
    return 'cctv-health';
  const frame = url.pathname.match(/^\/api\/cctv\/frame\/([^/]+)$/);
  if (url.origin === appOrigin && frame) {
    const required = [
      'label',
      'city',
      'lat',
      'lon',
      'heading',
      'fov',
      'pitch',
      'ts',
    ];
    const keys = [...url.searchParams.keys()];
    if (
      (keys.length !== 8 && keys.length !== 9) ||
      required.some((key) => !url.searchParams.has(key)) ||
      (keys.length === 9 && !url.searchParams.has('projTs')) ||
      new Set(keys).size !== keys.length
    )
      return null;
    return `cctv-frame:${decodeURIComponent(frame[1])}`;
  }
  if (
    url.origin === appOrigin &&
    url.pathname === '/api/radio/stations' &&
    exactParams(url, [])
  )
    return 'radio-directory';
  if (
    url.origin === appOrigin &&
    url.pathname === '/api/military-installations'
  ) {
    const names = [...url.searchParams.keys()];
    const required = ['south', 'west', 'north', 'east'];
    if (
      !required.every((key) => url.searchParams.has(key)) ||
      !names.every((key) => [...required, 'exact'].includes(key)) ||
      new Set(names).size !== names.length
    )
      return null;
    const [south, west, north, east] = required.map((key) =>
      Number(url.searchParams.get(key)),
    );
    if (
      ![south, west, north, east].every(Number.isFinite) ||
      south < -90 ||
      west < -180 ||
      north > 90 ||
      east > 180 ||
      south >= north ||
      west >= east ||
      north - south > 10 ||
      east - west > 10
    )
      return null;
    if (
      north < fixture.route.south ||
      south > fixture.route.north ||
      east < fixture.route.west ||
      west > fixture.route.east
    )
      return null;
    if (url.searchParams.has('exact') && url.searchParams.get('exact') !== '1')
      return null;
    return 'installations';
  }
  if (url.origin === 'https://tiles.dontgetflocked.com') {
    if (url.pathname === '/cameras-us-hourly.json' && exactParams(url, []))
      return 'alpr-tilejson';
    const match = url.pathname.match(
      /^\/cameras-us-hourly\/(\d+)\/(\d+)\/(\d+)\.mvt$/,
    );
    if (match && exactParams(url, [])) {
      const [, z, x, y] = match;
      if (
        ALPR_TILES.some(
          ([tz, tx, ty]) =>
            tz === Number(z) && tx === Number(x) && ty === Number(y),
        )
      )
        return `alpr-${z}-${x}-${y}`;
    }
  }
  if (
    url.origin === appOrigin &&
    url.pathname === '/api/wind/manifest' &&
    exactParams(url, ['model']) &&
    url.searchParams.get('model') === 'gfs'
  )
    return 'wind-manifest';
  if (
    url.origin === appOrigin &&
    url.pathname === '/api/wind/grid/gfs-austin-operating-v1.bin' &&
    exactParams(url, ['model']) &&
    url.searchParams.get('model') === 'gfs'
  )
    return 'wind-grid';
  return null;
}

function isOwnedRequest(url, origin) {
  return (
    (url.origin === origin &&
      /^\/api\/(?:celestrak|cctv|radio|military-installations|wind)(?:\/|$)/.test(
        url.pathname,
      )) ||
    url.origin === 'https://tiles.dontgetflocked.com'
  );
}

function installationResponseBytes(fixture, url) {
  const requested = Object.fromEntries(
    ['south', 'west', 'north', 'east'].map((key) => [
      key,
      Number(url.searchParams.get(key)),
    ]),
  );
  let box = requested;
  if (url.searchParams.get('exact') !== '1') {
    const snap = (value, grow) => {
      const cells = Number((value / 0.05).toFixed(9));
      return Number(
        ((grow > 0 ? Math.ceil(cells) : Math.floor(cells)) * 0.05).toFixed(6),
      );
    };
    box = {
      south: snap(requested.south, -1),
      west: snap(requested.west, -1),
      north: snap(requested.north, 1),
      east: snap(requested.east, 1),
    };
  }
  const all = JSON.parse(
    FIXTURE_BYTES.get(fixture).get('installations').toString('utf8'),
  );
  const elements = all.elements.filter(
    (element) =>
      element.lat >= box.south &&
      element.lat <= box.north &&
      element.lon >= box.west &&
      element.lon <= box.east,
  );
  return {
    bytes: Buffer.from(JSON.stringify({ ...all, elements, saturated: false })),
    requestBounds: requested,
    responseBounds: box,
    elementCount: elements.length,
    elementIds: elements.map((element) => element.tags.name).sort(),
  };
}

function installationRequestVariant(url, response) {
  const bounds = response.requestBounds;
  return {
    key: JSON.stringify({
      bounds,
      exact: url.searchParams.get('exact') === '1',
    }),
    bounds,
    exact: url.searchParams.get('exact') === '1',
    sha256: sha256(response.bytes),
    byteLength: response.bytes.length,
    responseBounds: response.responseBounds,
    elementCount: response.elementCount,
    elementIds: response.elementIds,
  };
}

export function createAustinOperatingFixtureDelivery(fixture, baseUrl) {
  if (fixture?.schema !== 'gev-austin-operating-fixture/v1')
    throw new TypeError('A registered Austin operating fixture is required.');
  const origin = new URL(baseUrl).origin;
  const responseCounts = new Map();
  const installationVariants = new Map();
  let installationVariantOverflowCount = 0;
  const MAX_INSTALLATION_VARIANTS = 32;
  const routeErrors = [];
  let disposed = false;
  function identity(url, method) {
    return {
      method: String(method || 'unknown').slice(0, 8),
      origin: url.origin,
      pathname: url.pathname.slice(0, 160),
    };
  }
  function fail(url, method, message) {
    if (routeErrors.length < 16)
      routeErrors.push({
        ...identity(url, method),
        message: message.slice(0, 180),
      });
    throw new Error(message);
  }
  return {
    errors: routeErrors,
    async respond(href, request) {
      if (disposed) throw new Error('Austin fixture delivery is disposed.');
      const url = new URL(href);
      const method = methodOf(request);
      const id = routeAsset(url, method, fixture, origin);
      if (!id) {
        const owned = isOwnedRequest(url, origin);
        if (owned)
          fail(url, method, 'Unexpected or malformed Austin workload request.');
        return null;
      }
      if (id.startsWith('cctv-frame:')) {
        const cameraId = id.slice('cctv-frame:'.length);
        if (!hasCctvCameraId(fixture, cameraId))
          fail(
            url,
            method,
            'CCTV frame ID is not in the pinned 250-camera catalog.',
          );
        const body = syntheticFrame(cameraId);
        return { status: 200, contentType: 'image/svg+xml', body };
      }
      const installation =
        id === 'installations' ? installationResponseBytes(fixture, url) : null;
      const body = installation?.bytes || FIXTURE_BYTES.get(fixture)?.get(id);
      const asset = fixture.assets.find((item) => item.id === id);
      if (!Buffer.isBuffer(body) || body.length > MAX_ASSET_BYTES || !asset)
        fail(url, method, 'Austin workload asset is missing or oversized.');
      const crossOriginAlprAsset =
        id === 'alpr-tilejson' || id.startsWith('alpr-');
      return {
        status: 200,
        contentType: asset.contentType,
        body,
        ...(crossOriginAlprAsset
          ? {
              headers: {
                'access-control-allow-origin': origin,
                vary: 'Origin',
              },
            }
          : {}),
      };
    },
    onFulfilled({ url: href, method, status, bodyBase64 }) {
      if (disposed) throw new Error('Austin fixture delivery is disposed.');
      const url = new URL(href);
      const id = routeAsset(url, methodOf({ method }), fixture, origin);
      if (!id) {
        if (isOwnedRequest(url, origin))
          fail(
            url,
            method,
            'Fulfilled response has no declared Austin workload route.',
          );
        return;
      }
      const actual = Buffer.from(bodyBase64 || '', 'base64');
      if (id.startsWith('cctv-frame:')) {
        const cameraId = id.slice('cctv-frame:'.length);
        if (!hasCctvCameraId(fixture, cameraId))
          fail(
            url,
            method,
            'CCTV frame ID is not in the pinned 250-camera catalog.',
          );
        const expectedFrame = syntheticFrame(cameraId);
        if (
          status !== 200 ||
          actual.length !== expectedFrame.length ||
          sha256(actual) !== sha256(expectedFrame)
        )
          fail(url, method, 'Served synthetic CCTV frame bytes differ.');
        responseCounts.set(
          'synthetic-cctv-frames',
          (responseCounts.get('synthetic-cctv-frames') || 0) + 1,
        );
        return;
      }
      const installation =
        id === 'installations' ? installationResponseBytes(fixture, url) : null;
      const expected =
        installation?.bytes || FIXTURE_BYTES.get(fixture).get(id);
      if (
        !expected ||
        status !== 200 ||
        actual.length !== expected.length ||
        sha256(actual) !== sha256(expected)
      )
        fail(url, method, `Served Austin fixture bytes differ for ${id}.`);
      if (id === 'installations') {
        const variant = installationRequestVariant(url, installation);
        const existing = installationVariants.get(variant.key);
        if (
          !existing &&
          installationVariants.size >= MAX_INSTALLATION_VARIANTS
        ) {
          installationVariantOverflowCount += 1;
          fail(
            url,
            method,
            'Austin installation response-variant bound exceeded.',
          );
        }
        installationVariants.set(variant.key, {
          ...variant,
          responseCount: (existing?.responseCount || 0) + 1,
        });
      }
      responseCounts.set(id, (responseCounts.get(id) || 0) + 1);
    },
    summarize({
      requiredAssetIds = REQUIRED_RESPONSE_IDS,
      requiredAlprTiles = [],
    } = {}) {
      assert.deepEqual(
        routeErrors,
        [],
        'Austin workload observed malformed or unexpected owned requests.',
      );
      const expectedIds = REQUIRED_RESPONSE_IDS;
      const delivered = expectedIds.map((id) => ({
        id,
        responseCount: responseCounts.get(id) || 0,
        sha256: fixture.assets.find((asset) => asset.id === id).sha256,
      }));
      const requiredAssetSet = new Set(requiredAssetIds);
      const declaredAssetIds = new Set([
        ...REQUIRED_RESPONSE_IDS,
        'installations',
        ...ALPR_TILES.map(([z, x, y]) => `alpr-${z}-${x}-${y}`),
      ]);
      const unknownRequiredAssets = [...requiredAssetSet].filter(
        (id) => !declaredAssetIds.has(id),
      );
      if (unknownRequiredAssets.length)
        throw new Error(
          `Austin required asset inventory has unknown IDs: ${unknownRequiredAssets.join(', ')}.`,
        );
      const missing = [...requiredAssetSet].filter((id) =>
        id === 'installations'
          ? installationVariants.size === 0
          : (responseCounts.get(id) || 0) < 1,
      );
      if (missing.length)
        throw new Error(
          `Austin fixture assets were not delivered: ${missing.join(', ')}.`,
        );
      const requestedAlprTiles = ALPR_TILES.map(([z, x, y]) => ({
        z,
        x,
        y,
        id: `alpr-${z}-${x}-${y}`,
        responseCount: responseCounts.get(`alpr-${z}-${x}-${y}`) || 0,
        sha256: fixture.assets.find(
          (asset) => asset.id === `alpr-${z}-${x}-${y}`,
        ).sha256,
      })).filter((tile) => tile.responseCount > 0);
      const requiredTileKeys = new Set(
        requiredAlprTiles.map((tile) => `${tile.z}/${tile.x}/${tile.y}`),
      );
      const declaredTileKeys = new Set(
        ALPR_TILES.map(([z, x, y]) => `${z}/${x}/${y}`),
      );
      if ([...requiredTileKeys].some((key) => !declaredTileKeys.has(key)))
        throw new Error(
          'Austin required ALPR tile set contains an unknown route tile.',
        );
      const missingRequiredTiles = [...requiredTileKeys].filter(
        (key) =>
          !requestedAlprTiles.some(
            (tile) => `${tile.z}/${tile.x}/${tile.y}` === key,
          ),
      );
      if (missingRequiredTiles.length)
        throw new Error(
          `Austin document did not deliver required route tiles: ${missingRequiredTiles.join(', ')}.`,
        );
      const fullRouteTileKeys = new Set(
        ALPR_TILES.map(([z, x, y]) => `${z}/${x}/${y}`),
      );
      const fullRouteCoverageComplete = [...fullRouteTileKeys].every(
        (key) =>
          requiredTileKeys.has(key) &&
          requestedAlprTiles.some(
            (tile) => `${tile.z}/${tile.x}/${tile.y}` === key,
          ),
      );
      return {
        schema: 'gev-austin-operating-delivery/v1',
        status: 'observed',
        fixtureId: fixture.id,
        fixtureSha256: fixture.sha256,
        fixedTime: fixture.fixedTime,
        windSourceTime: fixture.windSourceTime,
        windSourceAgeMs: fixture.windSourceAgeMs,
        deliveredAssets: delivered,
        requiredAssetIds: [...requiredAssetSet],
        missingRequiredAssets: missing,
        alprTileCoverage: {
          inventory: ALPR_TILES.map(([z, x, y]) => ({
            z,
            x,
            y,
            id: `alpr-${z}-${x}-${y}`,
          })),
          requiredForDocument: [...requiredTileKeys],
          requested: requestedAlprTiles,
          missingRequired: missingRequiredTiles,
          fullRouteCoverageComplete,
        },
        installations: {
          sourceCatalog: {
            sha256: fixture.assets.find((asset) => asset.id === 'installations')
              .sha256,
            byteLength: fixture.assets.find(
              (asset) => asset.id === 'installations',
            ).byteLength,
            sourceCount: fixture.expectedLayerCounts['military-installations'],
            synthetic: true,
          },
          responseVariants: [...installationVariants.values()].sort(
            (left, right) => left.key.localeCompare(right.key),
          ),
          responseVariantOverflowCount: installationVariantOverflowCount,
        },
        syntheticFrames: {
          generated: true,
          format: 'SVG',
          requestCount: responseCounts.get('synthetic-cctv-frames') || 0,
          sourceImagesCaptured: false,
        },
        populations: { ...fixture.expectedLayerCounts },
        benchmarkEligibility:
          'pending complete matched five-run capture and shared acceptance validation',
        disposed,
      };
    },
    dispose() {
      disposed = true;
    },
  };
}
