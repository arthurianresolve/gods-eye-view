import { safeEvidenceUrl } from './evidence.js';

const SNAPSHOT_LIMIT = 20_000;
const TEXT_LIMIT = 100_000;

function plain(value) {
  if (value == null || typeof value === 'string' || typeof value === 'boolean')
    return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (Array.isArray(value)) return value.map(plain);
  if (typeof value !== 'object') return null;
  const result = {};
  for (const [key, entry] of Object.entries(value)) {
    if (
      key.length > 120 ||
      ['__proto__', 'constructor', 'prototype'].includes(key)
    )
      continue;
    result[key] = plain(entry);
  }
  return result;
}

function instant(value, field) {
  const result = typeof value === 'number' ? value : Date.parse(value);
  if (!Number.isSafeInteger(result) || result < 0)
    throw new TypeError(`${field} must be a UTC epoch or date string.`);
  return result;
}

function entityKey(record) {
  const layer =
    record?.entityRef?.layerKey ?? record?.layerKey ?? record?.layer;
  const id = record?.entityRef?.id ?? record?.id;
  if (
    typeof layer !== 'string' ||
    !layer ||
    (typeof id !== 'string' && typeof id !== 'number')
  )
    return null;
  return `${layer}:${String(id)}`;
}

/** Freeze a bounded, serializable evidence state for later comparison/reporting. */
export function createEvidenceSnapshot(input = {}) {
  const records = Array.isArray(input.records) ? input.records : [];
  if (records.length > SNAPSHOT_LIMIT)
    throw new RangeError('Evidence snapshot exceeds 20,000 records.');
  const capturedAt = instant(input.capturedAt ?? Date.now(), 'capturedAt');
  const scope = plain(input.scope || {});
  const coverage = plain(input.coverage || {});
  const normalized = [];
  const seen = new Set();
  for (const record of records) {
    const key = entityKey(record);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    normalized.push({ key, record: plain(record) });
  }
  const snapshot = {
    schemaVersion: 1,
    id: String(input.id || `snapshot-${capturedAt}`).slice(0, 128),
    title: String(input.title || 'Evidence snapshot')
      .trim()
      .slice(0, 160),
    capturedAt,
    temporal: plain(input.temporal || null),
    scope,
    coverage,
    records: normalized,
    sourceLinks: [
      ...new Set(
        (Array.isArray(input.sourceLinks) ? input.sourceLinks : [])
          .map((link) =>
            safeEvidenceUrl(typeof link === 'string' ? link : link?.url),
          )
          .filter(Boolean),
      ),
    ].slice(0, 64),
    limitations: (Array.isArray(input.limitations) ? input.limitations : [])
      .filter((item) => typeof item === 'string')
      .slice(0, 32),
  };
  if (!snapshot.title) throw new TypeError('Evidence snapshot needs a title.');
  if (
    new TextEncoder().encode(JSON.stringify(snapshot)).byteLength > TEXT_LIMIT
  )
    throw new RangeError(
      'Evidence snapshot exceeds the 100 KiB metadata limit.',
    );
  return Object.freeze(snapshot);
}

function signature(value) {
  if (Array.isArray(value)) return `[${value.map(signature).join(',')}]`;
  if (!value || typeof value !== 'object') return JSON.stringify(value);
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${signature(value[key])}`)
    .join(',')}}`;
}

function hasCompleteCoverage(snapshot, layer) {
  const layerCoverage =
    snapshot.coverage?.layers?.[layer] ?? snapshot.coverage?.[layer];
  return (
    layerCoverage?.completeness === 'complete' ||
    layerCoverage?.complete === true
  );
}

function comparableScope(a, b) {
  return signature(a.scope || {}) === signature(b.scope || {});
}

/** Compare by stable layer/entity identity; incomplete coverage never means disappearance. */
export function compareEvidenceSnapshots(leftInput, rightInput) {
  const left =
    leftInput?.schemaVersion === 1
      ? leftInput
      : createEvidenceSnapshot(leftInput);
  const right =
    rightInput?.schemaVersion === 1
      ? rightInput
      : createEvidenceSnapshot(rightInput);
  const before = new Map(left.records.map(({ key, record }) => [key, record]));
  const after = new Map(right.records.map(({ key, record }) => [key, record]));
  const rows = [];
  const sameScope = comparableScope(left, right);
  for (const [key, current] of after) {
    if (!before.has(key))
      rows.push({ key, status: 'added', before: null, after: current });
    else if (signature(before.get(key)) !== signature(current))
      rows.push({
        key,
        status: 'changed',
        before: before.get(key),
        after: current,
      });
  }
  for (const [key, prior] of before) {
    if (after.has(key)) continue;
    const layer = key.slice(0, key.indexOf(':'));
    const covered = sameScope && hasCompleteCoverage(right, layer);
    rows.push({
      key,
      status: covered ? 'no-longer-observed' : 'not-observed',
      before: prior,
      after: null,
      explanation: covered
        ? 'The later snapshot reports complete coverage for this layer and scope.'
        : !sameScope
          ? 'The comparison scopes differ, so absence cannot be interpreted as a disappearance.'
          : 'The later snapshot does not establish complete coverage for this layer.',
    });
  }
  const priority = {
    added: 0,
    changed: 1,
    'no-longer-observed': 2,
    'not-observed': 3,
  };
  rows.sort(
    (a, b) =>
      priority[a.status] - priority[b.status] || a.key.localeCompare(b.key),
  );
  return Object.freeze({
    schemaVersion: 1,
    left: {
      id: left.id,
      title: left.title,
      capturedAt: left.capturedAt,
      temporal: left.temporal,
      coverage: left.coverage,
      sourceLinks: left.sourceLinks,
      limitations: left.limitations,
    },
    right: {
      id: right.id,
      title: right.title,
      capturedAt: right.capturedAt,
      temporal: right.temporal,
      coverage: right.coverage,
      sourceLinks: right.sourceLinks,
      limitations: right.limitations,
    },
    scope: right.scope,
    scopeCompatible: sameScope,
    rows: Object.freeze(rows.map((row) => Object.freeze(row))),
  });
}

function csvCell(value) {
  let text = typeof value === 'string' ? value : JSON.stringify(value ?? '');
  if (/^[\s\u0000-\u001f]*[=+@-]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

function utc(value) {
  return Number.isFinite(value) ? new Date(value).toISOString() : '';
}

/** Render a stable report with provenance and coverage caveats. */
export function exportEvidenceComparison(comparison, { format = 'json' } = {}) {
  const data = plain(comparison);
  if (!data || data.schemaVersion !== 1 || !Array.isArray(data.rows))
    throw new TypeError('A version 1 evidence comparison is required.');
  if (format === 'json') return JSON.stringify(data, null, 2);
  if (format === 'csv') {
    const rows = [
      [
        'status',
        'entity',
        'left_time_utc',
        'right_time_utc',
        'before',
        'after',
        'explanation',
      ],
    ];
    for (const row of data.rows)
      rows.push([
        row.status,
        row.key,
        utc(data.left.capturedAt),
        utc(data.right.capturedAt),
        row.before,
        row.after,
        row.explanation || '',
      ]);
    return rows.map((row) => row.map(csvCell).join(',')).join('\r\n');
  }
  if (format === 'markdown') {
    const title = `# ${data.left.title} vs ${data.right.title}`;
    const context = `Captured ${utc(data.left.capturedAt)} and ${utc(data.right.capturedAt)}. Scope compatible: ${data.scopeCompatible ? 'yes' : 'no'}. Scope: ${JSON.stringify(data.scope || {})}.`;
    const sources = [
      ...new Set([
        ...(data.left.sourceLinks || []),
        ...(data.right.sourceLinks || []),
      ]),
    ];
    const rows = data.rows.map(
      (row) =>
        `| ${row.status} | ${row.key.replaceAll('|', '\\|')} | ${String(row.explanation || '').replaceAll('|', '\\|')} |`,
    );
    const sourceBlock = sources.length
      ? ['', 'Sources:', ...sources.map((url) => `- ${url}`)]
      : [];
    const limitations = [
      ...new Set([
        ...(data.left.limitations || []),
        ...(data.right.limitations || []),
      ]),
    ];
    const limitationBlock = limitations.length
      ? ['', 'Limitations:', ...limitations.map((item) => `- ${item}`)]
      : [];
    return [
      title,
      '',
      context,
      '',
      '| Change | Entity | Interpretation |',
      '| --- | --- | --- |',
      ...rows,
      ...sourceBlock,
      ...limitationBlock,
    ].join('\n');
  }
  throw new TypeError(`Unsupported comparison report format: ${format}`);
}
