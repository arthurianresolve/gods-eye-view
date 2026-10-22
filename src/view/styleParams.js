/** Shared pure codec for the active visual preset's bounded parameters. */
const SHARE_STYLE_PARAMS_PARAM = 'sp';

const SHARE_STYLE_PARAM_REGISTRY = Object.freeze({
  retro: Object.freeze([
    { key: 'pixelation', token: 'p', min: 1, max: 10 },
    { key: 'distortion', token: 'd', min: 0, max: 1 },
    { key: 'instability', token: 'i', min: 0, max: 1 },
  ]),
  surveillance: Object.freeze([
    { key: 'gain', token: 'g', min: 0, max: 1 },
    { key: 'bloom', token: 'b', min: 0, max: 1 },
    { key: 'scanlineStr', token: 's', min: 0, max: 1 },
    { key: 'pixelation', token: 'p', min: 1, max: 6 },
  ]),
  thermal: Object.freeze([
    { key: 'sensitivity', token: 's', min: 0, max: 1 },
    { key: 'bloom', token: 'b', min: 0, max: 1 },
    { key: 'mode', token: 'm', min: 0, max: 1 },
    { key: 'pixelation', token: 'p', min: 1, max: 6 },
    { key: 'palette', token: 'a', min: 0, max: 1 },
  ]),
  anime: Object.freeze([
    { key: 'saturation', token: 's', min: 0, max: 2 },
    { key: 'edgeThick', token: 'e', min: 0, max: 1 },
  ]),
  noir: Object.freeze([
    { key: 'contrastAmt', token: 'c', min: 0, max: 2 },
    { key: 'grainAmt', token: 'g', min: 0, max: 1 },
    { key: 'vignetteAmt', token: 'v', min: 0, max: 1 },
  ]),
  snow: Object.freeze([
    { key: 'density', token: 'd', min: 0, max: 1 },
    { key: 'wind', token: 'w', min: 0, max: 1 },
  ]),
});

/** Encode allowlisted parameters for the active visual preset. */
export function encodeStyleParamState(params, styleName, values) {
  const registry = SHARE_STYLE_PARAM_REGISTRY[styleName];
  if (!registry || !values || typeof values !== 'object') {
    params.delete(SHARE_STYLE_PARAMS_PARAM);
    return;
  }
  const assignments = [];
  for (const spec of registry) {
    const numeric = Number(values[spec.key]);
    if (!Number.isFinite(numeric)) continue;
    const clamped = Math.max(spec.min, Math.min(spec.max, numeric));
    assignments.push(`${spec.token}.${Math.round(clamped * 100)}`);
  }
  if (assignments.length)
    params.set(SHARE_STYLE_PARAMS_PARAM, assignments.join('_'));
  else params.delete(SHARE_STYLE_PARAMS_PARAM);
}

/** Decode allowlisted parameters for the selected visual preset. */
export function decodeStyleParamState(params, styleName) {
  if (params.get('v') !== '2' || !params.has(SHARE_STYLE_PARAMS_PARAM))
    return null;
  const registry = SHARE_STYLE_PARAM_REGISTRY[styleName];
  if (!registry) return null;
  const byToken = new Map(registry.map((spec) => [spec.token, spec]));
  const decoded = {};
  for (const assignment of String(
    params.get(SHARE_STYLE_PARAMS_PARAM) || '',
  ).split('_')) {
    const [token, scaledRaw, ...extra] = assignment.split('.');
    if (extra.length || !/^-?\d+$/.test(scaledRaw || '')) continue;
    const spec = byToken.get(token);
    if (!spec) continue;
    const numeric = Number(scaledRaw) / 100;
    decoded[spec.key] = Math.max(spec.min, Math.min(spec.max, numeric));
  }
  return Object.keys(decoded).length ? decoded : null;
}

/** Validate saved values against the same allowlist used by share links. */
export function normalizeStyleParamState(styleName, values) {
  if (values == null) return null;
  const registry = SHARE_STYLE_PARAM_REGISTRY[styleName];
  if (!registry || typeof values !== 'object' || Array.isArray(values))
    throw new TypeError('Invalid view visual style parameters');
  const result = {};
  for (const [key, value] of Object.entries(values)) {
    const spec = registry.find((entry) => entry.key === key);
    if (
      !spec ||
      !Number.isFinite(value) ||
      value < spec.min ||
      value > spec.max
    )
      throw new TypeError('Invalid view visual style parameter: ' + key);
    result[key] = Math.round(value * 100) / 100;
  }
  return Object.keys(result).length ? Object.freeze(result) : null;
}
