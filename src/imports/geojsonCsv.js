import { decodePackGeoJSON } from '../director/packs/geojson.js';
import { PACK_LIMITS } from '../director/packs/manifest.js';

export const IMPORT_LIMITS = Object.freeze({
  bytes: 8 * 1024 * 1024,
  rows: 50_000,
  columns: 64,
  positions: Math.min(PACK_LIMITS.positions, 250_000),
  cellChars: 4_096,
  rejectedPreview: 100,
});

function fail(code, message) {
  throw Object.assign(new Error(message), { code });
}

export function decodeImportText(input) {
  if (typeof input === 'string') {
    if (new TextEncoder().encode(input).byteLength > IMPORT_LIMITS.bytes)
      fail('file-too-large', 'Import files are limited to 8 MiB.');
    return input;
  }
  const bytes =
    input instanceof Uint8Array ? input : new Uint8Array(input || []);
  if (bytes.byteLength > IMPORT_LIMITS.bytes)
    fail('file-too-large', 'Import files are limited to 8 MiB.');
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    fail('invalid-encoding', 'Import file must be valid UTF-8.');
  }
}

export function parseImportInstant(value) {
  const text = String(value ?? '').trim();
  if (!text) return null;
  // Explicit timezone is required; locale dates and DST-ambiguous local times
  // remain unknown until the user chooses a mapping with a timezone.
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/i.test(
      text,
    )
  )
    return 'ambiguous';
  const valueMs = Date.parse(text);
  return Number.isFinite(valueMs) ? valueMs : 'ambiguous';
}

function propertyBag(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const output = {};
  for (const [key, item] of Object.entries(value).slice(0, 64)) {
    if (!/^[\w .:/()-]{1,100}$/.test(key)) continue;
    if (
      item == null ||
      typeof item === 'boolean' ||
      (typeof item === 'number' && Number.isFinite(item))
    )
      output[key] = item;
    else if (typeof item === 'string') output[key] = item.slice(0, 500);
  }
  return output;
}

export function createImportPreview({
  kind,
  records,
  rejected,
  attribution,
  timeField = null,
  warnings = [],
}) {
  const bounds = [Infinity, Infinity, -Infinity, -Infinity];
  const times = [];
  let minTime = Infinity;
  let maxTime = -Infinity;
  for (const feature of records) {
    const visit = (point) => {
      if (!Array.isArray(point)) return;
      bounds[0] = Math.min(bounds[0], point[0]);
      bounds[1] = Math.min(bounds[1], point[1]);
      bounds[2] = Math.max(bounds[2], point[0]);
      bounds[3] = Math.max(bounds[3], point[1]);
    };
    const walk = (value) =>
      Array.isArray(value) && typeof value[0] === 'number'
        ? visit(value)
        : Array.isArray(value) && value.forEach(walk);
    walk(feature.geometry.coordinates);
    if (Number.isSafeInteger(feature.timeMs)) {
      times.push(feature.timeMs);
      minTime = Math.min(minTime, feature.timeMs);
      maxTime = Math.max(maxTime, feature.timeMs);
    }
  }
  return Object.freeze({
    kind,
    accepted: records.length,
    rejected: rejected.length,
    rejectedRows: Object.freeze(
      rejected.slice(0, IMPORT_LIMITS.rejectedPreview),
    ),
    bounds: records.length ? Object.freeze(bounds) : null,
    timeRange: times.length ? Object.freeze([minTime, maxTime]) : null,
    timeField,
    timeInterpretation: timeField
      ? 'ISO 8601 timestamps with explicit UTC offset; missing timestamps stay unknown.'
      : 'Observation time is unknown unless a time column is mapped.',
    warnings: Object.freeze(
      warnings.map((warning) => String(warning).slice(0, 240)),
    ),
    coordinateReference: 'WGS84 longitude, latitude',
    attribution: String(attribution || '')
      .trim()
      .slice(0, 500),
    records: Object.freeze(records),
  });
}

/** Stage validated GeoJSON geometry while leaving all mutations to Apply. */
export async function previewGeoJSON(
  input,
  { signal, attribution = '', timeField = null } = {},
) {
  const text = decodeImportText(input);
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    fail('invalid-json', 'GeoJSON is not valid JSON.');
  }
  if (value?.type !== 'FeatureCollection' || !Array.isArray(value.features))
    fail('invalid-geojson', 'Expected a GeoJSON FeatureCollection.');
  if (value.features.length > IMPORT_LIMITS.rows)
    fail(
      'too-many-rows',
      `GeoJSON is limited to ${IMPORT_LIMITS.rows} features.`,
    );
  const records = [];
  const rejected = [];
  const seen = new Set();
  let positions = 0;
  for (let index = 0; index < value.features.length; index++) {
    signal?.throwIfAborted();
    const feature = value.features[index];
    let id = String(
      feature?.id ?? feature?.properties?.id ?? `feature-${index + 1}`,
    ).trim();
    if (!id || id.length > 256 || seen.has(id)) {
      rejected.push({
        row: index + 1,
        reason: 'Missing, duplicate or oversized feature ID.',
      });
      continue;
    }
    try {
      const validated = decodePackGeoJSON(
        new TextEncoder().encode(
          JSON.stringify({
            type: 'FeatureCollection',
            features: [{ ...feature, id }],
          }),
        ),
      )[0];
      const count = (coordinates) =>
        Array.isArray(coordinates) && typeof coordinates[0] === 'number'
          ? 1
          : Array.isArray(coordinates)
            ? coordinates.reduce((sum, part) => sum + count(part), 0)
            : 0;
      positions += count(validated.coordinates);
      if (positions > IMPORT_LIMITS.positions)
        fail(
          'too-many-positions',
          'GeoJSON exceeds the coordinate vertex limit.',
        );
      const properties = propertyBag(feature.properties);
      let timeMs = null;
      if (timeField && properties[timeField] != null) {
        const parsed = parseImportInstant(properties[timeField]);
        if (parsed === 'ambiguous')
          throw new Error(`Ambiguous timestamp in ${timeField}.`);
        timeMs = parsed;
      }
      records.push({
        id,
        geometry: { type: validated.type, coordinates: validated.coordinates },
        properties,
        timeMs,
      });
      seen.add(id);
    } catch (error) {
      if (error.code === 'too-many-positions') throw error;
      rejected.push({
        row: index + 1,
        reason: String(error.message || 'Invalid feature.').slice(0, 180),
      });
    }
    if (index % 256 === 255) await Promise.resolve();
  }
  return createImportPreview({
    kind: 'geojson',
    records,
    rejected,
    attribution,
    timeField,
  });
}

/** RFC 4180-style bounded CSV decoder supporting quoted commas and newlines. */
export function parseCsv(text) {
  const rows = [];
  let row = [],
    cell = '',
    quoted = false;
  const pushCell = () => {
    if (cell.length > IMPORT_LIMITS.cellChars)
      fail('cell-too-large', 'A CSV cell exceeds 4,096 characters.');
    row.push(cell);
    cell = '';
    if (row.length > IMPORT_LIMITS.columns)
      fail('too-many-columns', 'CSV is limited to 64 columns.');
  };
  const pushRow = () => {
    pushCell();
    if (row.some((value) => value.trim())) rows.push(row);
    row = [];
    if (rows.length > IMPORT_LIMITS.rows + 1)
      fail('too-many-rows', `CSV is limited to ${IMPORT_LIMITS.rows} records.`);
  };
  const source = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    if (quoted) {
      if (char === '"' && source[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (char === '"') quoted = false;
      else cell += char;
      continue;
    }
    if (char === '"' && cell === '') quoted = true;
    else if (char === ',') pushCell();
    else if (char === '\n') pushRow();
    else if (char === '\r') {
      if (source[i + 1] === '\n') i++;
      pushRow();
    } else cell += char;
    if (cell.length > IMPORT_LIMITS.cellChars)
      fail('cell-too-large', 'A CSV cell exceeds 4,096 characters.');
  }
  if (quoted) fail('invalid-csv', 'CSV ends inside a quoted cell.');
  if (cell || row.length) pushRow();
  if (!rows.length) fail('invalid-csv', 'CSV needs a header row.');
  const headers = rows[0].map((header) => header.trim());
  if (
    headers.some((header) => !header) ||
    new Set(headers).size !== headers.length
  )
    fail('invalid-csv', 'CSV headers must be present and unique.');
  return { headers, rows: rows.slice(1) };
}

/** Stage CSV points using explicit latitude/longitude and optional field mappings. */
export async function previewCSV(
  input,
  { signal, mapping = {}, attribution = '' } = {},
) {
  const { headers, rows } = parseCsv(decodeImportText(input));
  const column = (field) => {
    const selected = mapping[field];
    if (Number.isInteger(selected)) return selected;
    return typeof selected === 'string'
      ? headers.indexOf(selected)
      : headers.indexOf(field);
  };
  const latColumn = column('latitude');
  const lonColumn = column('longitude');
  if (latColumn < 0 || lonColumn < 0 || latColumn === lonColumn)
    fail(
      'mapping-required',
      'Choose distinct latitude and longitude columns before previewing.',
    );
  const idColumn = column('id');
  const timeColumn = column('time');
  const records = [];
  const rejected = [];
  const ids = new Set();
  for (let i = 0; i < rows.length; i++) {
    signal?.throwIfAborted();
    const cells = rows[i];
    const rowNumber = i + 2;
    const latitude = Number(cells[latColumn]);
    const longitude = Number(cells[lonColumn]);
    if (
      !Number.isFinite(latitude) ||
      Math.abs(latitude) > 90 ||
      !Number.isFinite(longitude) ||
      Math.abs(longitude) > 180
    ) {
      rejected.push({
        row: rowNumber,
        reason: 'Latitude/longitude must be valid WGS84 decimal degrees.',
      });
      continue;
    }
    const id = String(cells[idColumn] || `row-${rowNumber}`).trim();
    if (!id || id.length > 256 || ids.has(id)) {
      rejected.push({
        row: rowNumber,
        reason: 'Missing, duplicate or oversized ID.',
      });
      continue;
    }
    let timeMs = null;
    if (timeColumn >= 0 && cells[timeColumn]?.trim()) {
      timeMs = parseImportInstant(cells[timeColumn]);
      if (timeMs === 'ambiguous') {
        rejected.push({
          row: rowNumber,
          reason: 'Timestamp must be ISO 8601 and include Z or a UTC offset.',
        });
        continue;
      }
    }
    const properties = {};
    for (const [index, header] of headers.entries()) {
      if (
        index === latColumn ||
        index === lonColumn ||
        index === idColumn ||
        index === timeColumn
      )
        continue;
      if (cells[index] != null) properties[header] = cells[index].slice(0, 500);
    }
    ids.add(id);
    records.push({
      id,
      geometry: { type: 'Point', coordinates: [longitude, latitude] },
      properties,
      timeMs,
    });
    if (i % 512 === 511) await Promise.resolve();
  }
  return createImportPreview({
    kind: 'csv',
    records,
    rejected,
    attribution,
    timeField: timeColumn >= 0 ? headers[timeColumn] : null,
  });
}
