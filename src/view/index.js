/**
 * A view: what God's Eye View shows, independent of how it is shown. Camera,
 * data layers, visual style, map imagery and an entity to follow. Views are
 * written in the share-link format, so the app restores them when a link
 * opens and every surface that produces one agrees on its meaning.
 */

import {
  REGISTERED_LAYER_IDS,
  createDefaultLayerState,
  decodeLayerStateParams,
  encodeLayerStateParams,
} from '../data/layerState.js';
import {
  DENSITY_STOPS,
  migrateDetectionState,
} from '../data/detectionPolicy.js';

const DETECTION_MODES = Object.freeze(['OFF', 'SPARSE', 'BALANCED', 'DENSE']);

function detectionOf(value) {
  if (value == null) return null;
  if (
    !DETECTION_MODES.includes(value.mode) ||
    !DENSITY_STOPS.includes(value.densityPct)
  )
    throw new TypeError('Invalid view detection mode or density');
  const restored = migrateDetectionState(value.mode, value.densityPct);
  return Object.freeze({
    mode: restored.enabled ? restored.profile : 'OFF',
    densityPct: restored.densityPct,
  });
}

/** Visual styles by internal name, with the name share links use. */
export const STYLE_URL_NAMES = Object.freeze({
  normal: 'normal',
  retro: 'crt',
  surveillance: 'nvg',
  thermal: 'flir',
  anime: 'anime',
  noir: 'noir',
  snow: 'snow',
});

const STYLES_BY_URL_NAME = Object.freeze(
  Object.fromEntries(
    Object.entries(STYLE_URL_NAMES).map(([name, url]) => [url, name]),
  ),
);

export const VIEW_STYLES = Object.freeze(Object.keys(STYLE_URL_NAMES));

export const VIEW_MAPS = Object.freeze([
  'photoreal',
  'bing-aerial',
  'bing-labels',
  'esri-imagery',
  'osm',
]);

/**
 * What can be followed, the layer that shows it, and where the layer-state
 * codec keeps its identifier.
 */
const FOLLOWABLE = Object.freeze({
  aircraft: {
    layer: 'flights',
    owner: 'flights',
    key: 'selectedFlightsTrackingId',
    cockpit: true,
  },
  military_aircraft: {
    layer: 'military',
    owner: 'flights',
    key: 'selectedMilitaryTrackingId',
    cockpit: true,
  },
  satellite: {
    layer: 'satellites',
    owner: 'satellites',
    key: 'selectedSatTrackingId',
  },
});

export const VIEW_FOLLOW_KINDS = Object.freeze(Object.keys(FOLLOWABLE));
export const VIEW_TEMPORAL_SOURCES = Object.freeze([
  'live',
  'provider-history',
  'recording',
]);

/** Annotation kinds the app draws, as in its annotate_map action. */
export const VIEW_ANNOTATION_TYPES = Object.freeze([
  'pin',
  'highlight',
  'area',
  'arrow',
  'route',
  'label',
]);
const ANNOTATION_COLORS = Object.freeze([
  'primary',
  'amber',
  'cyan',
  'green',
  'red',
]);
const MAX_ANNOTATIONS = 24;
const MAX_ANNOTATION_PARAM_CHARS = 6000;
const ANNOTATION_PARAM = 'an';

const MIN_ALTITUDE_M = 50;
const MAX_ALTITUDE_M = 20_000_000;

/** JSON Schema for the parts of a view a caller chooses directly. */
export const VIEW_PROPERTIES = Object.freeze({
  detection: Object.freeze({
    type: 'object',
    description: 'Saved detection display mode and label density percentage.',
    properties: {
      mode: { type: 'string', enum: [...DETECTION_MODES] },
      densityPct: { type: 'number', enum: [...DENSITY_STOPS] },
    },
    required: ['mode', 'densityPct'],
    additionalProperties: false,
  }),
  camera: Object.freeze({
    type: 'object',
    description:
      'Camera position: lat and lon it is above, altitude in meters, heading ' +
      '(0 is north) and pitch (-90 looks straight down, 0 at the horizon).',
    properties: {
      lat: { type: 'number', minimum: -90, maximum: 90 },
      lon: { type: 'number', minimum: -180, maximum: 180 },
      altitude_m: {
        type: 'number',
        minimum: MIN_ALTITUDE_M,
        maximum: MAX_ALTITUDE_M,
      },
      heading_deg: { type: 'number', minimum: 0, maximum: 360 },
      pitch_deg: { type: 'number', minimum: -90, maximum: 0 },
    },
    additionalProperties: false,
  }),
  layers: Object.freeze({
    type: 'array',
    maxItems: REGISTERED_LAYER_IDS.length,
    items: { type: 'string', enum: [...REGISTERED_LAYER_IDS] },
    description: 'Data layers to turn on, such as "flights" or "earthquakes".',
  }),
  style: Object.freeze({
    type: 'string',
    enum: [...VIEW_STYLES],
    description:
      'Visual style: retro is CRT, surveillance is night vision, thermal is FLIR.',
  }),
  map: Object.freeze({
    type: 'string',
    enum: [...VIEW_MAPS],
    description: 'Map imagery; photoreal is Google 3D tiles.',
  }),
  annotations: Object.freeze({
    type: 'array',
    maxItems: MAX_ANNOTATIONS,
    description:
      'Marks drawn on the globe: a pin, highlight, area or label at a place ' +
      'name (target) or lat/lon, an arrow between two points, or a route ' +
      'through points.',
    items: {
      type: 'object',
      properties: {
        type: { type: 'string', enum: [...VIEW_ANNOTATION_TYPES] },
        target: { type: 'string', minLength: 1, maxLength: 200 },
        latitude: { type: 'number', minimum: -90, maximum: 90 },
        longitude: { type: 'number', minimum: -180, maximum: 180 },
        toLatitude: { type: 'number', minimum: -90, maximum: 90 },
        toLongitude: { type: 'number', minimum: -180, maximum: 180 },
        points: {
          type: 'array',
          minItems: 2,
          maxItems: 12,
          items: {
            type: 'object',
            properties: {
              latitude: { type: 'number', minimum: -90, maximum: 90 },
              longitude: { type: 'number', minimum: -180, maximum: 180 },
            },
            required: ['latitude', 'longitude'],
            additionalProperties: false,
          },
        },
        label: { type: 'string', maxLength: 120 },
        color: { type: 'string', enum: [...ANNOTATION_COLORS] },
      },
      required: ['type'],
      additionalProperties: false,
    },
  }),
  follow: Object.freeze({
    type: 'object',
    description:
      'An entity the camera follows: an aircraft or military aircraft by ' +
      'ICAO 24-bit address, or a satellite by NORAD catalog number. Its layer ' +
      'is turned on.',
    properties: {
      kind: { type: 'string', enum: [...VIEW_FOLLOW_KINDS] },
      id: { type: 'string', pattern: '^[0-9A-Za-z~_-]{1,16}$' },
      cockpit: {
        type: 'boolean',
        description:
          "Show the aircraft's cockpit view instead of following it from " +
          'outside. Aircraft only; links open the app following it.',
      },
    },
    required: ['kind', 'id'],
    additionalProperties: false,
  }),
  temporal: Object.freeze({
    type: 'object',
    description:
      'An investigation time. Historical links preserve the requested time and source mode; recording links also refer to a local recording bundle.',
    properties: {
      source: { type: 'string', enum: [...VIEW_TEMPORAL_SOURCES] },
      targetMs: {
        type: 'integer',
        minimum: 0,
        description:
          'UTC epoch milliseconds for provider history or a recording.',
      },
      recordingId: {
        type: 'string',
        maxLength: 128,
        description: 'Local recording ID; required only for recording source.',
      },
    },
    required: ['source'],
    additionalProperties: false,
  }),
});

const round = (value, digits) => Number(value.toFixed(digits));
const latitude = (value) =>
  Number.isFinite(value) && Math.abs(value) <= 90 ? value : undefined;
const longitude = (value) =>
  Number.isFinite(value) && Math.abs(value) <= 180 ? value : undefined;
const text = (value, max) =>
  typeof value === 'string' && value.trim()
    ? value.trim().slice(0, max)
    : undefined;

/**
 * One annotation with only the fields the app draws, or null when it has
 * nothing to place. Unknown fields and out-of-range values are dropped.
 */
function annotationOf(input) {
  if (!input || !VIEW_ANNOTATION_TYPES.includes(input.type)) return null;
  const points = Array.isArray(input.points)
    ? input.points
        .slice(0, 12)
        .map((point) => ({
          latitude: latitude(point?.latitude),
          longitude: longitude(point?.longitude),
        }))
        .filter(
          (point) =>
            point.latitude !== undefined && point.longitude !== undefined,
        )
    : [];
  // Coordinates are kept or dropped in pairs; half a position places nothing.
  const pair = (lat, lon) =>
    latitude(lat) !== undefined && longitude(lon) !== undefined
      ? [lat, lon]
      : [undefined, undefined];
  const [lat, lon] = pair(input.latitude, input.longitude);
  const [toLat, toLon] = pair(input.toLatitude, input.toLongitude);
  const entry = Object.fromEntries(
    Object.entries({
      type: input.type,
      target: text(input.target, 200),
      latitude: lat,
      longitude: lon,
      toLatitude: toLat,
      toLongitude: toLon,
      points: points.length >= 2 ? points : undefined,
      label: text(input.label, 120),
      color: ANNOTATION_COLORS.includes(input.color) ? input.color : undefined,
    }).filter(([, value]) => value !== undefined),
  );
  const placed =
    entry.target !== undefined ||
    entry.points !== undefined ||
    (entry.latitude !== undefined && entry.longitude !== undefined);
  return placed ? Object.freeze(entry) : null;
}
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

function temporalOf(input) {
  if (input == null) return null;
  if (!VIEW_TEMPORAL_SOURCES.includes(input.source))
    throw new TypeError('Unknown temporal source');
  if (input.source === 'live') {
    if (input.targetMs != null || input.recordingId != null)
      throw new TypeError('A live view cannot carry a historical target');
    return Object.freeze({
      source: 'live',
      targetMs: null,
      recordingId: null,
    });
  }
  if (
    !Number.isSafeInteger(input.targetMs) ||
    input.targetMs < 0 ||
    input.targetMs > Date.now()
  )
    throw new RangeError('A historical view needs a finite past target');
  const recordingId = input.recordingId ?? null;
  if (
    input.source === 'recording'
      ? typeof recordingId !== 'string' ||
        !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(recordingId)
      : recordingId !== null
  )
    throw new TypeError('Recording reference does not match temporal source');
  return Object.freeze({
    source: input.source,
    targetMs: input.targetMs,
    recordingId,
  });
}

function temporalFromParams(params) {
  const hasTemporal = ['it', 'is', 'ir'].some((key) => params.has(key));
  if (!hasTemporal) return { temporal: null, invalid: false };
  try {
    const source = params.get('is');
    const rawTarget = params.get('it');
    const targetMs = rawTarget === null ? null : Number(rawTarget);
    const temporal = temporalOf({
      source,
      targetMs,
      recordingId: params.get('ir'),
    });
    if (source === 'live' && hasTemporal && params.has('it'))
      return { temporal: null, invalid: true };
    if (source !== 'recording' && params.has('ir'))
      return { temporal: null, invalid: true };
    return { temporal, invalid: false };
  } catch {
    return { temporal: null, invalid: true };
  }
}

/**
 * A complete view from its parts. `camera` needs lat and lon; the rest has
 * defaults: 800 km up, looking straight down, no layers, the recipient's own
 * style and map.
 */
export function createView({
  camera,
  layers = [],
  style = null,
  map = null,
  follow = null,
  annotations = [],
  temporal = null,
  detection = null,
} = {}) {
  if (!Number.isFinite(camera?.lat) || !Number.isFinite(camera?.lon))
    throw new TypeError('A view needs a camera lat and lon');
  if (style !== null && !VIEW_STYLES.includes(style))
    throw new TypeError(`Unknown view style: ${style}`);
  if (map !== null && !VIEW_MAPS.includes(map))
    throw new TypeError(`Unknown view map: ${map}`);
  const followed = follow ? FOLLOWABLE[follow.kind] : null;
  if (follow && !followed)
    throw new TypeError(`Cannot follow a ${follow.kind}`);
  if (follow?.cockpit === true && !followed.cockpit)
    throw new TypeError(`A ${follow.kind} has no cockpit view`);
  const enabled = new Set(
    layers.filter((layer) => REGISTERED_LAYER_IDS.includes(layer)),
  );
  if (followed) enabled.add(followed.layer);
  return Object.freeze({
    camera: Object.freeze({
      lat: round(clamp(camera.lat, -90, 90), 4),
      lon: round(clamp(camera.lon, -180, 180), 4),
      altitude_m: Math.round(
        clamp(camera.altitude_m ?? 800_000, MIN_ALTITUDE_M, MAX_ALTITUDE_M),
      ),
      heading_deg: Math.round(camera.heading_deg ?? 0) % 360,
      pitch_deg: Math.round(clamp(camera.pitch_deg ?? -90, -90, 0)),
    }),
    layers: Object.freeze(
      REGISTERED_LAYER_IDS.filter((layer) => enabled.has(layer)),
    ),
    style,
    map,
    follow: follow
      ? Object.freeze({
          kind: follow.kind,
          id: String(follow.id).toLowerCase(),
          ...(follow.cockpit === true ? { cockpit: true } : {}),
        })
      : null,
    annotations: Object.freeze(
      (Array.isArray(annotations) ? annotations : [])
        .slice(0, MAX_ANNOTATIONS)
        .map(annotationOf)
        .filter(Boolean),
    ),
    temporal: temporalOf(temporal),
    ...(detection == null ? {} : { detection: detectionOf(detection) }),
  });
}

/** Share-link hash parameters that restore a view. */
export function viewToParams(view) {
  const params = new URLSearchParams({
    v: '2',
    lat: view.camera.lat.toFixed(4),
    lon: view.camera.lon.toFixed(4),
    alt: String(view.camera.altitude_m),
    heading: String(view.camera.heading_deg),
    pitch: String(view.camera.pitch_deg),
    roll: '0',
  });
  if (view.style) params.set('style', STYLE_URL_NAMES[view.style]);
  if (view.map) params.set('map', view.map);
  const detection = detectionOf(view.detection);
  if (detection) {
    params.set('dm', detection.mode);
    params.set('dd', String(detection.densityPct));
  }
  if (view.layers.length) {
    const state = createDefaultLayerState();
    state.enabledLayerIds = [...view.layers];
    const followed = view.follow ? FOLLOWABLE[view.follow.kind] : null;
    if (followed)
      state.options[followed.owner] = {
        ...state.options[followed.owner],
        [followed.key]: view.follow.id,
      };
    encodeLayerStateParams(params, state);
  }
  if (view.annotations.length) {
    const encoded = JSON.stringify(view.annotations);
    if (encoded.length <= MAX_ANNOTATION_PARAM_CHARS)
      params.set(ANNOTATION_PARAM, encoded);
  }
  if (view.temporal) {
    params.set('is', view.temporal.source);
    if (view.temporal.targetMs !== null)
      params.set('it', String(view.temporal.targetMs));
    if (view.temporal.recordingId) params.set('ir', view.temporal.recordingId);
  }
  return params;
}

/** The annotations a share link carries, or an empty list. */
export function annotationsFromParams(params) {
  const raw = params.get(ANNOTATION_PARAM);
  if (!raw || raw.length > MAX_ANNOTATION_PARAM_CHARS) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.slice(0, MAX_ANNOTATIONS).map(annotationOf).filter(Boolean)
      : [];
  } catch {
    return [];
  }
}

/** The view a set of share-link hash parameters restores, or null. */
export function viewFromParams(params) {
  const lat = Number.parseFloat(params.get('lat'));
  const lon = Number.parseFloat(params.get('lon'));
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const number = (name) => {
    const value = Number.parseFloat(params.get(name));
    return Number.isFinite(value) ? value : undefined;
  };
  const state = decodeLayerStateParams(params);
  let follow = null;
  for (const [kind, followed] of Object.entries(FOLLOWABLE)) {
    const id = state?.options?.[followed.owner]?.[followed.key];
    if (id !== null && id !== undefined && !follow)
      follow = { kind, id: String(id) };
  }
  const map = params.get('map');
  const decodedTemporal = temporalFromParams(params);
  if (decodedTemporal.invalid) return null;
  const restoredDetection =
    params.has('dm') || params.has('dd')
      ? migrateDetectionState(params.get('dm') || 'OFF', number('dd'), 50)
      : null;
  return createView({
    camera: {
      lat,
      lon,
      altitude_m: number('alt'),
      heading_deg: number('heading'),
      pitch_deg: number('pitch'),
    },
    layers: state?.enabledLayerIds ?? [],
    style: STYLES_BY_URL_NAME[params.get('style')] ?? null,
    map: VIEW_MAPS.includes(map) ? map : null,
    follow,
    annotations: annotationsFromParams(params),
    temporal: decodedTemporal.temporal,
    detection: restoredDetection
      ? {
          mode: restoredDetection.enabled ? restoredDetection.profile : 'OFF',
          densityPct: restoredDetection.densityPct,
        }
      : null,
  });
}

/** Decode the optional temporal contract carried by a view or share link. */
export function temporalFromViewParams(params) {
  return temporalFromParams(params);
}

/** The address that opens the app at a view. */
export function viewUrl(baseUrl, view) {
  const url = new URL(baseUrl);
  url.hash = viewToParams(view).toString();
  return url.href;
}
