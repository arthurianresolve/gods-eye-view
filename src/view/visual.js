/** Portable saved visual state. It uses the existing share-link field names. */
import {
  BLOOM_INTENSITY_DEFAULT,
  BLOOM_INTENSITY_MAX,
  BLOOM_SCALE_VERSION,
  decodeBloomIntensity,
} from '../bloom.js';
import {
  ALLOCATION_STRATEGIES,
  normalizeAllocationStrategy,
} from '../data/detectionPolicy.js';
import {
  decodeStyleParamState,
  encodeStyleParamState,
  normalizeStyleParamState,
} from './styleParams.js';

const HUD_VARIANTS = ['tactical', 'operator', 'minimal', 'cyber'];
// Absent visual state keeps the historical workspace restore behavior. These
// defaults also make a partial, explicitly authored visual state deterministic.
export const VIEW_VISUAL_DEFAULTS = Object.freeze({
  bloom: false,
  sharpen: false,
  bloomIntensity: BLOOM_INTENSITY_DEFAULT,
  bloomVersion: BLOOM_SCALE_VERSION,
  sharpenIntensity: 49,
  hudVariant: 'tactical',
  hudVisible: false,
  detectionAllocation: 'ELASTIC',
  detectionFadePct: 16,
  detectionOutsideOpacityPct: 5,
  celestialRing: false,
  scopeEnabled: true,
  scopeFeatherPct: 35,
  scopeTerminusPct: null,
  styleParams: null,
});

const BOOLEANS = {
  bloom: 'bloom',
  sharpen: 'sharpen',
  hudVisible: 'hv',
  celestialRing: 'cr',
  scopeEnabled: 'sc',
};
const INTEGERS = {
  bloomIntensity: ['bi', 0, BLOOM_INTENSITY_MAX],
  bloomVersion: ['bv', BLOOM_SCALE_VERSION, BLOOM_SCALE_VERSION],
  sharpenIntensity: ['si', 0, 100],
  detectionFadePct: ['kf', 0, 40],
  detectionOutsideOpacityPct: ['ko', 0, 100],
  scopeFeatherPct: ['scf', 0, 100],
};
const VISUAL_PARAMS = [
  ...Object.values(BOOLEANS),
  ...Object.values(INTEGERS).map(([param]) => param),
  'hud',
  'da',
  'sce',
  'sp',
];

/** Strict import boundary; do not coerce malformed workspace values. */
export function normalizeViewVisual(input, style) {
  if (input == null) return null;
  if (typeof input !== 'object' || Array.isArray(input))
    throw new TypeError('Invalid view visual settings');
  for (const key of Object.keys(input))
    if (!Object.hasOwn(VIEW_VISUAL_DEFAULTS, key))
      throw new TypeError(`Unknown view visual setting: ${key}`);
  const result = { ...VIEW_VISUAL_DEFAULTS, ...input };
  for (const key of Object.keys(BOOLEANS))
    if (typeof result[key] !== 'boolean')
      throw new TypeError(`Invalid view visual setting: ${key}`);
  for (const [key, [, min, max]] of Object.entries(INTEGERS))
    if (
      !Number.isInteger(result[key]) ||
      result[key] < min ||
      result[key] > max
    )
      throw new TypeError(`Invalid view visual setting: ${key}`);
  if (!HUD_VARIANTS.includes(result.hudVariant))
    throw new TypeError('Invalid view visual setting: hudVariant');
  if (!ALLOCATION_STRATEGIES.includes(result.detectionAllocation))
    throw new TypeError('Invalid view visual setting: detectionAllocation');
  const terminus = result.scopeTerminusPct;
  if (
    terminus !== null &&
    (!Number.isInteger(terminus) || terminus < 94 || terminus > 100)
  )
    throw new TypeError('Invalid view visual setting: scopeTerminusPct');
  result.styleParams = normalizeStyleParamState(style, result.styleParams);
  return Object.freeze(result);
}

/** Share links retain their permissive legacy parsing, then become bounded. */
export function visualFromParams(params, style) {
  if (!VISUAL_PARAMS.some((key) => params.has(key))) return null;
  const result = { ...VIEW_VISUAL_DEFAULTS };
  const number = (key, fallback) => {
    const value = Number.parseFloat(params.get(key));
    return Number.isFinite(value) ? value : fallback;
  };
  for (const [key, param] of Object.entries(BOOLEANS))
    if (params.has(param)) result[key] = params.get(param) === '1';
  for (const [key, [param, min, max]] of Object.entries(INTEGERS))
    result[key] = Math.min(
      max,
      Math.max(min, Math.round(number(param, result[key]))),
    );
  // Unversioned links used the inverted 0..100 bloom scale. Store v2 once,
  // so repeated workspace exports/restores cannot migrate it a second time.
  result.bloomIntensity = decodeBloomIntensity(
    number('bi', 50),
    number('bv', 1),
  );
  result.bloomVersion = BLOOM_SCALE_VERSION;
  const hud = params.get('hud');
  result.hudVariant = HUD_VARIANTS.includes(hud) ? hud : 'tactical';
  result.detectionAllocation = normalizeAllocationStrategy(params.get('da'));
  const rawTerminus = params.get('sce')?.trim();
  const terminus = rawTerminus ? Number(rawTerminus) : NaN;
  result.scopeTerminusPct = Number.isFinite(terminus)
    ? Math.min(100, Math.max(94, Math.round(terminus)))
    : null;
  result.styleParams = decodeStyleParamState(params, style);
  return normalizeViewVisual(result, style);
}

export function encodeViewVisual(params, input, style) {
  const visual = normalizeViewVisual(input, style);
  if (!visual) return;
  for (const [key, param] of Object.entries(BOOLEANS))
    params.set(param, visual[key] ? '1' : '0');
  for (const [key, [param]] of Object.entries(INTEGERS))
    params.set(param, String(visual[key]));
  params.set('hud', visual.hudVariant);
  params.set('da', visual.detectionAllocation.toLowerCase());
  if (visual.scopeTerminusPct !== null)
    params.set('sce', String(visual.scopeTerminusPct));
  encodeStyleParamState(params, style, visual.styleParams);
}
