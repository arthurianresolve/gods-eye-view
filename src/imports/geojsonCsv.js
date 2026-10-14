import { consumeInBatches } from './cooperative.js';
import { validatePackGeoJSONFeature } from '../director/packs/geojson.js';
import { PACK_LIMITS } from '../director/packs/manifest.js';

export const IMPORT_LIMITS = Object.freeze({
  bytes: 8 * 1024 * 1024,
  decodeChunkBytes: 64 * 1024,
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

/**
 * Decode a file in bounded event-loop batches before parsing its document.
 *
 * The synchronous decoder remains available for small, already-buffered
 * callers. Preview paths use this adapter so a large UTF-8 file can be
 * cancelled or superseded while it is being decoded. Parsing/normalization
 * still owns the same limits and output contract as the synchronous path.
 */
export async function decodeImportTextAsync(
  input,
  { signal, chunkBytes = IMPORT_LIMITS.decodeChunkBytes } = {},
) {
  signal?.throwIfAborted();
  const size =
    Number.isSafeInteger(chunkBytes) && chunkBytes > 0
      ? chunkBytes
      : IMPORT_LIMITS.decodeChunkBytes;
  if (typeof input === 'string') {
    if (new TextEncoder().encode(input).byteLength > IMPORT_LIMITS.bytes)
      fail('file-too-large', 'Import files are limited to 8 MiB.');
    await consumeInBatches(
      (function* () {
        signal?.throwIfAborted();
        yield;
      })(),
      { signal, deferStart: true },
    );
    return input;
  }
  const bytes =
    input instanceof Uint8Array ? input : new Uint8Array(input || []);
  if (bytes.byteLength > IMPORT_LIMITS.bytes)
    fail('file-too-large', 'Import files are limited to 8 MiB.');
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const chunks = [];
  await consumeInBatches(
    (function* () {
      for (let offset = 0; offset < bytes.byteLength; offset += size) {
        signal?.throwIfAborted();
        const end = Math.min(bytes.byteLength, offset + size);
        try {
          chunks.push(
            decoder.decode(bytes.subarray(offset, end), { stream: true }),
          );
        } catch {
          fail('invalid-encoding', 'Import file must be valid UTF-8.');
        }
        yield;
      }
    })(),
    { signal, deferStart: true },
  );
  signal?.throwIfAborted();
  try {
    chunks.push(decoder.decode());
  } catch {
    fail('invalid-encoding', 'Import file must be valid UTF-8.');
  }
  return chunks.join('');
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

function buildImportPreview(
  { kind, records, rejected, attribution, timeField = null, warnings = [] },
  summary = null,
) {
  const bounds = [Infinity, Infinity, -Infinity, -Infinity];
  let minTime = Infinity;
  let maxTime = -Infinity;
  if (summary) {
    if (summary.bounds) bounds.splice(0, bounds.length, ...summary.bounds);
    minTime = summary.minTime;
    maxTime = summary.maxTime;
  } else {
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
        minTime = Math.min(minTime, feature.timeMs);
        maxTime = Math.max(maxTime, feature.timeMs);
      }
    }
  }
  const previewBounds =
    records.length && (summary ? summary.bounds : bounds)
      ? Object.freeze([...bounds])
      : null;
  const timeRange =
    minTime !== Infinity ? Object.freeze([minTime, maxTime]) : null;
  return Object.freeze({
    kind,
    accepted: records.length,
    rejected: rejected.length,
    rejectedRows: Object.freeze(
      rejected.slice(0, IMPORT_LIMITS.rejectedPreview),
    ),
    bounds: previewBounds,
    timeRange,
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

function invalidJson() {
  fail('invalid-json', 'GeoJSON is not valid JSON.');
}

function jsonWhitespace(source, index) {
  while (index < source.length && /[\s]/.test(source[index])) index++;
  return index;
}

/**
 * Find one JSON value without parsing the complete document in one task.
 * The returned cursor is validated by JSON.parse at the value boundary;
 * this scanner only owns nesting and string boundaries so the event loop can
 * yield while a large feature or metadata object is being located.
 */
async function scanJsonValueEnd(source, start, { signal } = {}) {
  return consumeInBatches(scanJsonValueEndIterator(source, start, { signal }), {
    signal,
    deferStart: true,
  });
}

function* scanJsonValueEndIterator(source, start, { signal } = {}) {
  let index = jsonWhitespace(source, start);
  if (index >= source.length) invalidJson();
  const first = source[index];
  if (first === '"') {
    index++;
    while (index < source.length) {
      signal?.throwIfAborted();
      const character = source[index++];
      if (character === '\\') {
        if (index >= source.length) invalidJson();
        index++;
      } else if (character === '"') {
        return index;
      }
      yield;
    }
    invalidJson();
  }
  if (first === '{' || first === '[') {
    const stack = [first === '{' ? '}' : ']'];
    index++;
    let inString = false;
    while (index < source.length && stack.length) {
      signal?.throwIfAborted();
      const character = source[index++];
      if (inString) {
        if (character === '\\') {
          if (index >= source.length) invalidJson();
          index++;
        } else if (character === '"') inString = false;
      } else if (character === '"') inString = true;
      else if (character === '{') stack.push('}');
      else if (character === '[') stack.push(']');
      else if (character === '}' || character === ']') {
        if (stack.at(-1) !== character) invalidJson();
        stack.pop();
      }
      yield;
    }
    if (inString || stack.length) invalidJson();
    return index;
  }
  const primitiveStart = index;
  while (index < source.length && !',]}'.includes(source[index])) {
    signal?.throwIfAborted();
    index++;
    yield;
  }
  const token = source.slice(primitiveStart, index).trim();
  if (!token) invalidJson();
  try {
    JSON.parse(token);
  } catch {
    invalidJson();
  }
  return index;
}

async function parseJsonStringEnd(source, start, { signal } = {}) {
  const end = await scanJsonValueEnd(source, start, { signal });
  if (source[jsonWhitespace(source, start)] !== '"') invalidJson();
  return end;
}

async function parseGeoJSONFeatureArray(source, start, { signal } = {}) {
  let index = jsonWhitespace(source, start);
  if (source[index] !== '[') invalidJson();
  index = jsonWhitespace(source, index + 1);
  const features = [];
  if (source[index] === ']') return { features, next: index + 1 };
  let next = null;
  await consumeInBatches(
    (function* () {
      let cursor = index;
      while (cursor < source.length) {
        signal?.throwIfAborted();
        const end = yield* scanJsonValueEndIterator(source, cursor, {
          signal,
        });
        let feature;
        try {
          feature = JSON.parse(source.slice(cursor, end));
        } catch {
          invalidJson();
        }
        features.push(feature);
        if (features.length > IMPORT_LIMITS.rows)
          fail(
            'too-many-rows',
            `GeoJSON is limited to ${IMPORT_LIMITS.rows} features.`,
          );
        cursor = jsonWhitespace(source, end);
        if (source[cursor] === ']') {
          next = cursor + 1;
          return;
        }
        if (source[cursor] !== ',') invalidJson();
        cursor = jsonWhitespace(source, cursor + 1);
        if (source[cursor] === ']') invalidJson();
        yield;
      }
      invalidJson();
    })(),
    { signal, deferStart: true },
  );
  if (next == null) invalidJson();
  return { features, next };
}

/** Parse a GeoJSON FeatureCollection incrementally at top-level feature boundaries. */
async function parseGeoJSONFeatureCollection(source, { signal } = {}) {
  let index = jsonWhitespace(source, 0);
  if (source[index] !== '{') invalidJson();
  index = jsonWhitespace(source, index + 1);
  let type = null;
  let features = null;
  let closed = false;
  if (source[index] === '}') {
    index++;
    closed = true;
  }
  while (index < source.length) {
    signal?.throwIfAborted();
    const keyStart = index;
    const keyEnd = await parseJsonStringEnd(source, keyStart, { signal });
    let key;
    try {
      key = JSON.parse(source.slice(keyStart, keyEnd));
    } catch {
      invalidJson();
    }
    index = jsonWhitespace(source, keyEnd);
    if (source[index] !== ':') invalidJson();
    index = jsonWhitespace(source, index + 1);
    if (key === 'features' && source[index] === '[') {
      const parsed = await parseGeoJSONFeatureArray(source, index, { signal });
      features = parsed.features;
      index = parsed.next;
    } else {
      const end = await scanJsonValueEnd(source, index, { signal });
      let value;
      try {
        value = JSON.parse(source.slice(index, end));
      } catch {
        invalidJson();
      }
      if (key === 'type') type = value;
      if (key === 'features') features = value;
      index = end;
    }
    index = jsonWhitespace(source, index);
    if (source[index] === '}') {
      index++;
      closed = true;
      break;
    }
    if (source[index] !== ',') invalidJson();
    index = jsonWhitespace(source, index + 1);
    if (source[index] === '}') invalidJson();
  }
  if (!closed) invalidJson();
  if (jsonWhitespace(source, index) !== source.length) invalidJson();
  return { type, features };
}

export function createImportPreview(options) {
  return buildImportPreview(options);
}

/** Stage validated GeoJSON geometry while leaving all mutations to Apply. */
export async function previewGeoJSON(
  input,
  { signal, attribution = '', timeField = null } = {},
) {
  signal?.throwIfAborted();
  const text = await decodeImportTextAsync(input, { signal });
  signal?.throwIfAborted();
  const value = await parseGeoJSONFeatureCollection(text, { signal });
  if (value?.type !== 'FeatureCollection' || !Array.isArray(value.features))
    fail('invalid-geojson', 'Expected a GeoJSON FeatureCollection.');
  const records = [];
  const rejected = [];
  const seen = new Set();
  let positions = 0;
  const summaryBounds = [Infinity, Infinity, -Infinity, -Infinity];
  let minTime = Infinity;
  let maxTime = -Infinity;
  await consumeInBatches(
    (function* () {
      for (let index = 0; index < value.features.length; index++) {
        yield;
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
          const validator = validatePackGeoJSONFeature(
            { ...feature, id },
            { maximumPositions: PACK_LIMITS.positions },
          );
          let step = validator.next();
          while (!step.done) {
            yield;
            signal?.throwIfAborted();
            step = validator.next();
          }
          const validated = step.value;
          positions += validated.positionCount;
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
            geometry: {
              type: validated.type,
              coordinates: validated.coordinates,
            },
            properties,
            timeMs,
          });
          seen.add(id);
          if (validated.bounds)
            for (let index = 0; index < 4; index++)
              summaryBounds[index] =
                index < 2
                  ? Math.min(summaryBounds[index], validated.bounds[index])
                  : Math.max(summaryBounds[index], validated.bounds[index]);
          if (Number.isSafeInteger(timeMs)) {
            minTime = Math.min(minTime, timeMs);
            maxTime = Math.max(maxTime, timeMs);
          }
        } catch (error) {
          if (signal?.aborted || error?.name === 'AbortError') throw error;
          if (error.code === 'too-many-positions') throw error;
          rejected.push({
            row: index + 1,
            reason: String(error.message || 'Invalid feature.').slice(0, 180),
          });
        }
      }
    })(),
    { signal, deferStart: true },
  );
  return buildImportPreview(
    { kind: 'geojson', records, rejected, attribution, timeField },
    {
      bounds: records.length ? summaryBounds : null,
      minTime,
      maxTime,
    },
  );
}

/** RFC 4180-style bounded CSV decoder supporting quoted commas and newlines. */
function scanCsv(text, headersOnly = false) {
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
    if (headersOnly && rows.length === 1) {
      const headers = validateCsvHeaders(rows[0]);
      return headers;
    }
    return null;
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
    else if (char === '\n') {
      const headers = pushRow();
      if (headers) return headers;
    } else if (char === '\r') {
      if (source[i + 1] === '\n') i++;
      const headers = pushRow();
      if (headers) return headers;
    } else cell += char;
    if (cell.length > IMPORT_LIMITS.cellChars)
      fail('cell-too-large', 'A CSV cell exceeds 4,096 characters.');
  }
  if (quoted) fail('invalid-csv', 'CSV ends inside a quoted cell.');
  if (cell || row.length) {
    const headers = pushRow();
    if (headers) return headers;
  }
  if (!rows.length) fail('invalid-csv', 'CSV needs a header row.');
  const headers = validateCsvHeaders(rows[0]);
  return headersOnly ? headers : { headers, rows: rows.slice(1) };
}

/**
 * Cooperative counterpart used by preview paths.  CSV quoting is stateful,
 * so the scanner yields between character batches rather than splitting the
 * input into independent lines.  The synchronous parser above remains the
 * compatibility API used by mapping controls and callers with small text.
 */
async function scanCsvAsync(text, headersOnly = false, { signal } = {}) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  let earlyHeaders = null;
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
    if (headersOnly && rows.length === 1) {
      earlyHeaders = validateCsvHeaders(rows[0]);
      return true;
    }
    return false;
  };
  const source = text.replace(/^\uFEFF/, '');
  const iterator = (function* () {
    for (let i = 0; i < source.length; i++) {
      signal?.throwIfAborted();
      const char = source[i];
      if (quoted) {
        if (char === '"' && source[i + 1] === '"') {
          cell += '"';
          i++;
        } else if (char === '"') quoted = false;
        else cell += char;
      } else if (char === '"' && cell === '') quoted = true;
      else if (char === ',') pushCell();
      else if (char === '\n' || char === '\r') {
        if (char === '\r' && source[i + 1] === '\n') i++;
        if (pushRow()) return;
      } else cell += char;
      if (cell.length > IMPORT_LIMITS.cellChars)
        fail('cell-too-large', 'A CSV cell exceeds 4,096 characters.');
      yield;
    }
    if (quoted) fail('invalid-csv', 'CSV ends inside a quoted cell.');
    if (cell || row.length) pushRow();
  })();
  await consumeInBatches(iterator, { signal, deferStart: true });
  signal?.throwIfAborted();
  if (earlyHeaders) return earlyHeaders;
  if (!rows.length) fail('invalid-csv', 'CSV needs a header row.');
  const headers = validateCsvHeaders(rows[0]);
  return headersOnly ? headers : { headers, rows: rows.slice(1) };
}

function validateCsvHeaders(row) {
  const headers = row.map((header) => header.trim());
  if (
    headers.some((header) => !header) ||
    new Set(headers).size !== headers.length
  )
    fail('invalid-csv', 'CSV headers must be present and unique.');
  return headers;
}

export function parseCsv(text) {
  return scanCsv(text);
}

/** Read only the validated header record for the column-mapping controls. */
export function parseCsvHeaders(text) {
  return scanCsv(text, true);
}

/**
 * Read the CSV header for the browser mapping controls without making a
 * large byte-backed file block the main thread.  Unlike the synchronous
 * compatibility helper, this path decodes and scans cooperatively and keeps
 * the same header-only grammar (the body is intentionally not validated).
 */
export async function parseCsvHeadersAsync(
  input,
  { signal, chunkBytes = IMPORT_LIMITS.decodeChunkBytes } = {},
) {
  signal?.throwIfAborted();
  const text = await decodeImportTextAsync(input, { signal, chunkBytes });
  signal?.throwIfAborted();
  return scanCsvAsync(text, true, { signal });
}

/** Stage CSV points using explicit latitude/longitude and optional field mappings. */
export async function previewCSV(
  input,
  { signal, mapping = {}, attribution = '' } = {},
) {
  signal?.throwIfAborted();
  const text = await decodeImportTextAsync(input, { signal });
  signal?.throwIfAborted();
  const { headers, rows } = await scanCsvAsync(text, false, { signal });
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
  await consumeInBatches(
    (function* () {
      for (let i = 0; i < rows.length; i++) {
        yield;
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
              reason:
                'Timestamp must be ISO 8601 and include Z or a UTC offset.',
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
          if (cells[index] != null)
            properties[header] = cells[index].slice(0, 500);
        }
        ids.add(id);
        records.push({
          id,
          geometry: { type: 'Point', coordinates: [longitude, latitude] },
          properties,
          timeMs,
        });
      }
    })(),
    { signal },
  );
  return createImportPreview({
    kind: 'csv',
    records,
    rejected,
    attribution,
    timeField: timeColumn >= 0 ? headers[timeColumn] : null,
  });
}
