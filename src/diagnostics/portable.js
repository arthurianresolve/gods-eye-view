import { VIEW_MAPS, VIEW_STYLES } from '../view/index.js';

export const SETTINGS_BACKUP_KIND = 'gev-settings';
export const SETTINGS_BACKUP_VERSION = 1;
export const SETTINGS_BACKUP_LIMIT_BYTES = 128 * 1024;

const VISUAL_KEYS = new Set([
  'style',
  'map',
  'bloom',
  'sharpen',
  'bloomIntensity',
  'sharpenIntensity',
  'hudVariant',
  'hudVisible',
  'detectionMode',
  'detectionDensity',
  'detectionAllocation',
  'detectionFadePct',
  'detectionOutsideOpacityPct',
  'celestialRing',
  'scopeEnabled',
  'scopeFeatherPct',
  'scopeTerminusPct',
  'mapStack',
]);
const TOP_KEYS = new Set([
  'kind',
  'version',
  'exportedAt',
  'units',
  'visualPreferences',
  'sourceSelections',
  'credentialsPresent',
]);

function exactKeys(value, allowed, description) {
  for (const key of Object.keys(value || {}))
    if (!allowed.has(key))
      throw new TypeError(
        `${description} contains an unsupported field: ${key}.`,
      );
}

function unitsOf(input = {}) {
  const value = {
    distance: input.distance || 'km',
    speed: input.speed || 'kph',
    temperature: input.temperature || 'c',
  };
  if (
    !['km', 'mi'].includes(value.distance) ||
    !['kph', 'mph', 'knots'].includes(value.speed) ||
    !['c', 'f'].includes(value.temperature)
  )
    throw new TypeError('Settings units are not supported.');
  return Object.freeze(value);
}

function visualOf(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw new TypeError('Visual preferences must be an object.');
  exactKeys(input, VISUAL_KEYS, 'Visual preferences');
  const output = {};
  for (const [key, value] of Object.entries(input)) {
    if (key === 'style' && !VIEW_STYLES.includes(value))
      throw new TypeError('Visual style is unsupported.');
    if (key === 'map' && !VIEW_MAPS.includes(value))
      throw new TypeError('Map preference is unsupported.');
    if (
      key === 'detectionAllocation' &&
      !['ELASTIC', 'WEIGHTED'].includes(value)
    )
      throw new TypeError('Detection allocation is unsupported.');
    if (
      key === 'mapStack' &&
      (typeof value !== 'string' ||
        !/^[a-z0-9][a-z0-9._:-]{0,95}$/i.test(value))
    )
      throw new TypeError('Map stack must be an identifier.');
    if (
      ['bloomIntensity', 'sharpenIntensity'].includes(key) &&
      (typeof value !== 'number' || value < 0 || value > 100)
    )
      throw new TypeError(`${key} must be between 0 and 100.`);
    if (
      [
        'detectionDensity',
        'detectionFadePct',
        'detectionOutsideOpacityPct',
        'scopeFeatherPct',
        'scopeTerminusPct',
      ].includes(key) &&
      value !== null &&
      (typeof value !== 'number' || value < 0 || value > 100)
    )
      throw new TypeError(`${key} must be a percentage from 0 to 100.`);
    if (typeof value === 'boolean') output[key] = value;
    else if (
      typeof value === 'number' &&
      Number.isFinite(value) &&
      Math.abs(value) <= 100_000_000
    )
      output[key] = value;
    else if (
      typeof value === 'string' &&
      value.length <= 160 &&
      !/https?:|[A-Za-z]:\\|\/(?:Users|home)\//i.test(value)
    )
      output[key] = value;
    else if (value === null && key === 'scopeTerminusPct') output[key] = null;
    else throw new TypeError(`Visual preference ${key} has an invalid value.`);
  }
  return Object.freeze(output);
}

function sourceSelectionsOf(input) {
  if (!Array.isArray(input) || input.length > 128)
    throw new RangeError(
      'Settings can include at most 128 selected source layers.',
    );
  const values = [...new Set(input.map(String))];
  if (values.some((id) => !/^[a-z0-9][a-z0-9._:-]{0,95}$/i.test(id)))
    throw new TypeError(
      'Source selections must be layer identifiers, not URLs.',
    );
  return Object.freeze(values);
}

function presenceOf(input = {}) {
  const allowed = new Set(['openAi', 'googleTiles', 'mapillary', 'aisStream']);
  exactKeys(input, allowed, 'Credential presence flags');
  return Object.freeze(
    Object.fromEntries(
      Object.entries(input).map(([key, value]) => {
        if (!allowed.has(key) || typeof value !== 'boolean')
          throw new TypeError(
            'Credential information must contain known boolean presence flags only.',
          );
        return [key, value];
      }),
    ),
  );
}

function normalizeSettings(input, exportedAt) {
  return Object.freeze({
    kind: SETTINGS_BACKUP_KIND,
    version: SETTINGS_BACKUP_VERSION,
    exportedAt:
      Number.isSafeInteger(exportedAt) && exportedAt >= 0
        ? exportedAt
        : Date.now(),
    units: unitsOf(input.units),
    visualPreferences: visualOf(input.visualPreferences),
    sourceSelections: sourceSelectionsOf(input.sourceSelections || []),
    credentialsPresent: presenceOf(input.credentialsPresent),
  });
}

export function createSettingsBackup(input = {}) {
  const result = normalizeSettings(input, input.exportedAt);
  if (
    new TextEncoder().encode(JSON.stringify(result)).byteLength >
    SETTINGS_BACKUP_LIMIT_BYTES
  )
    throw new RangeError('Settings backup exceeds 128 KiB.');
  return result;
}

export function parseSettingsBackup(input) {
  let value = input;
  if (typeof value === 'string') {
    if (
      new TextEncoder().encode(value).byteLength > SETTINGS_BACKUP_LIMIT_BYTES
    )
      throw new RangeError('Settings backup exceeds 128 KiB.');
    value = JSON.parse(value);
  }
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new TypeError('Settings backup must be a JSON object.');
  // Version 0 is the early prototype shape; accept its named fields, then
  // normalize through the current allowlist before returning it.
  if (value.version === 0) {
    return normalizeSettings(value.settings || value, value.exportedAt);
  }
  if (
    value.kind !== SETTINGS_BACKUP_KIND ||
    value.version !== SETTINGS_BACKUP_VERSION
  )
    throw new TypeError('Settings backup kind or version is unsupported.');
  exactKeys(value, TOP_KEYS, 'Settings backup');
  return normalizeSettings(value, value.exportedAt);
}

const SECRET_VALUE =
  /(?:sk-(?:proj-)?[A-Za-z0-9_-]{16,}|Bearer\s+\S+|(?:api[_-]?key|token|secret|password)\s*[:=]\s*[^\s,;]+)/gi;
const LOCAL_PATH =
  /(?:[A-Za-z]:\\(?:Users|home|Documents)\\[^\s"']+|\/(?:Users|home)\/[^\s"']+)/g;

export function sanitizeDiagnosticText(value, maxLength = 500) {
  return String(value ?? '')
    .replace(SECRET_VALUE, '[redacted]')
    .replace(LOCAL_PATH, '[local path]')
    .replace(/[\p{Cc}\p{Cf}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, Math.max(0, maxLength));
}

/** Build a bounded, on-demand report with no credentials, transcripts or paths. */
export function createDiagnosticsReport(input = {}) {
  const rows = Array.isArray(input.feeds) ? input.feeds.slice(0, 128) : [];
  const recentErrors = Array.isArray(input.errors)
    ? input.errors.slice(-30)
    : [];
  return Object.freeze({
    schemaVersion: 1,
    generatedAt: Number.isSafeInteger(input.generatedAt)
      ? input.generatedAt
      : Date.now(),
    appVersion: sanitizeDiagnosticText(input.appVersion || 'unknown', 64),
    renderer: sanitizeDiagnosticText(input.renderer || 'unknown', 120),
    capabilities: Object.freeze(
      Object.fromEntries(
        Object.entries(input.capabilities || {})
          .slice(0, 32)
          .map(([key, value]) => [
            sanitizeDiagnosticText(key, 64),
            Boolean(value),
          ]),
      ),
    ),
    storage: Object.freeze({
      usageBytes: Number.isFinite(input.storage?.usageBytes)
        ? Math.max(0, Math.floor(input.storage.usageBytes))
        : null,
      quotaBytes: Number.isFinite(input.storage?.quotaBytes)
        ? Math.max(0, Math.floor(input.storage.quotaBytes))
        : null,
      availability: sanitizeDiagnosticText(
        input.storage?.availability || 'unknown',
        40,
      ),
    }),
    feeds: Object.freeze(
      rows.map((feed) =>
        Object.freeze({
          id: sanitizeDiagnosticText(feed.id, 96),
          enabled: Boolean(feed.enabled),
          state: sanitizeDiagnosticText(
            feed.state || feed.feedState || 'unknown',
            40,
          ),
          source: sanitizeDiagnosticText(feed.source || 'unknown', 100),
          latencyMs: Number.isFinite(feed.latencyMs)
            ? Math.max(0, Math.floor(feed.latencyMs))
            : null,
          retrying: Boolean(feed.retrying),
          error: sanitizeDiagnosticText(feed.error, 240) || null,
        }),
      ),
    ),
    recentErrors: Object.freeze(
      recentErrors.map((error) =>
        Object.freeze({
          timestamp: sanitizeDiagnosticText(error.timestamp, 40),
          source: sanitizeDiagnosticText(error.source, 80),
          message: sanitizeDiagnosticText(error.message, 240),
        }),
      ),
    ),
  });
}
