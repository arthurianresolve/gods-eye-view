// Lightweight identifiers: importing this file must remain safe before CLI
// validation (the full fixture module imports Cesium and data decoders).
export const AUSTIN_OPERATING_WORKLOAD_ID = 'austin-operating-v1';
export const AUSTIN_OPERATING_FIXED_TIME = '2026-10-12T18:00:00.000Z';
export const AUSTIN_OPERATING_WIND_VALID_TIME = '2026-10-08T12:00:00.000Z';
export const AUSTIN_OPERATING_ROUTE = Object.freeze({
  id: 'austin-operating-city-route-v1',
  south: 30.2333509546811,
  west: -97.80249445084847,
  north: 30.53260132239697,
  east: -97.3116604733377,
  center: Object.freeze({ latitude: 30.2672, longitude: -97.7431 }),
  altitudeM: 12000,
  headingDeg: 20,
  pitchDeg: -45,
});
export const AUSTIN_OPERATING_LAYER_COUNTS = Object.freeze({
  satellites: 828,
  cctv: 250,
  'alpr-cameras': 952,
  'military-installations': 699,
  radio: 750,
  wind: 65160,
});
export const AUSTIN_OPERATING_REQUIRED_ALPR_TILES = Object.freeze(
  [
    [10, 232, 420],
    [10, 232, 421],
    [10, 232, 422],
    [10, 233, 420],
    [10, 233, 421],
    [10, 233, 422],
    [10, 234, 420],
    [10, 234, 421],
    [10, 234, 422],
    [10, 235, 420],
    [10, 235, 421],
    [10, 235, 422],
  ].map((tile) => Object.freeze(tile)),
);
export const AUSTIN_OPERATING_SELECTED_LAYER_IDS = Object.freeze(
  Object.keys(AUSTIN_OPERATING_LAYER_COUNTS),
);
export const AUSTIN_OPERATING_REQUIRED_RESPONSE_IDS = Object.freeze([
  'tle-stations',
  'tle-visual',
  'tle-gps-ops',
  'tle-glo-ops',
  'tle-galileo',
  'tle-geo',
  'cctv-catalog-response',
  'cctv-health',
  'alpr-tilejson',
  'radio-directory',
  'wind-manifest',
  'wind-grid',
]);
export const AUSTIN_OPERATING_VISUAL_STATE = Object.freeze({
  qualityMode: 'manual',
  detectionMode: 'DENSE',
  densityPct: 75,
  wind: Object.freeze({
    model: 'gfs',
    overlay: 'speed',
    paused: false,
    units: 'km/h',
  }),
  selectedLayerIds: AUSTIN_OPERATING_SELECTED_LAYER_IDS,
  aircraftCount: 0,
  optionalStarlinkCatalog: false,
});

// Read-only settings observed on the matched application build: WebGL reports
// antialiasing enabled, the viewer uses 4x MSAA, and Cesium's FXAA post-process
// stage remains disabled by default.
export const AUSTIN_OPERATING_RENDERING_STATE = Object.freeze({
  resolutionScale: 1,
  msaaSamples: 4,
  antialias: true,
  fxaa: false,
});
