import assert from 'node:assert/strict';
import test from 'node:test';
import {
  decodeImportTextAsync,
  parseCsv,
  parseCsvHeaders,
  parseCsvHeadersAsync,
  previewCSV,
  previewGeoJSON,
} from './geojsonCsv.js';

test('bounded import decoding preserves UTF-8 across chunks and can be cancelled', async () => {
  const text = 'αβγ\n' + 'route,1,2\n'.repeat(128);
  const bytes = new TextEncoder().encode(text);
  assert.equal(await decodeImportTextAsync(bytes, { chunkBytes: 3 }), text);
  await assert.rejects(
    decodeImportTextAsync(new Uint8Array([0xff]), { chunkBytes: 1 }),
    { code: 'invalid-encoding' },
  );

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 0);
  try {
    await assert.rejects(
      decodeImportTextAsync(new Uint8Array(512 * 1024), {
        signal: controller.signal,
        chunkBytes: 1024,
      }),
      { name: 'AbortError' },
    );
  } finally {
    clearTimeout(timer);
  }
});

test('CSV preview keeps quoted records equivalent while scanning cooperatively', async () => {
  const csv = [
    'id,latitude,longitude,note',
    'one,30,-97,"line one"',
    'two,31,-98,"line two, with comma"',
    'three,32,-99,"line three\ncontinued"',
  ].join('\n');
  const preview = await previewCSV(csv, {
    mapping: { id: 'id', latitude: 'latitude', longitude: 'longitude' },
  });
  assert.equal(preview.accepted, 3);
  assert.equal(preview.rejected, 0);
  assert.equal(preview.records[1].properties.note, 'line two, with comma');
  assert.equal(preview.records[2].properties.note, 'line three\ncontinued');
  assert.deepEqual(preview.bounds, [-99, 30, -97, 32]);
});

test('large CSV scanning can be cancelled before normalization completes', async () => {
  const csv =
    'id,latitude,longitude\n' +
    Array.from({ length: 50_000 }, (_, index) => `${index},30,-97`).join('\n');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 2);
  try {
    await assert.rejects(
      previewCSV(csv, {
        signal: controller.signal,
        mapping: { id: 'id', latitude: 'latitude', longitude: 'longitude' },
      }),
      { name: 'AbortError' },
    );
  } finally {
    clearTimeout(timer);
  }
});

test('GeoJSON feature arrays parse incrementally and preserve feature order', async () => {
  const features = Array.from({ length: 256 }, (_, index) => ({
    type: 'Feature',
    id: `feature-${index}`,
    properties: { label: `item-${index}` },
    geometry: { type: 'Point', coordinates: [-97 + index / 1000, 30] },
  }));
  const preview = await previewGeoJSON(
    JSON.stringify({
      metadata: { source: 'fixture' },
      features,
      type: 'FeatureCollection',
    }),
  );
  assert.equal(preview.accepted, features.length);
  assert.equal(preview.records[0].id, 'feature-0');
  assert.equal(preview.records.at(-1).id, 'feature-255');
});

test('incremental GeoJSON parsing can be cancelled before feature normalization completes', async () => {
  const input = JSON.stringify({
    type: 'FeatureCollection',
    features: Array.from({ length: 50_000 }, (_, index) => ({
      type: 'Feature',
      id: `feature-${index}`,
      geometry: { type: 'Point', coordinates: [-97, 30] },
    })),
  });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 0);
  try {
    await assert.rejects(previewGeoJSON(input, { signal: controller.signal }), {
      name: 'AbortError',
    });
  } finally {
    clearTimeout(timer);
  }
});

test('incremental GeoJSON parsing preserves JSON and collection errors', async () => {
  await assert.rejects(previewGeoJSON('{}'), { code: 'invalid-geojson' });
  await assert.rejects(previewGeoJSON('[]'), { code: 'invalid-geojson' });
  await assert.rejects(previewGeoJSON('null'), { code: 'invalid-geojson' });
  await assert.rejects(previewGeoJSON('{"type":"FeatureCollection"}'), {
    code: 'invalid-geojson',
  });
  await assert.rejects(
    previewGeoJSON('{"type":"FeatureCollection","features":[}'),
    {
      code: 'invalid-json',
    },
  );
  await assert.rejects(
    previewGeoJSON('{"type":"FeatureCollection","features":['),
    {
      code: 'invalid-json',
    },
  );
  await assert.rejects(
    previewGeoJSON('{"type":"FeatureCollection","features":[]} trailing'),
    {
      code: 'invalid-json',
    },
  );
});

test('GeoJSON preview validates WGS84 geometry and leaves invalid features staged as rejections', async () => {
  const input = JSON.stringify({
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        id: 'a',
        properties: { name: '<img src=x>', time: '2026-01-01T00:00:00Z' },
        geometry: { type: 'Point', coordinates: [179, 10] },
      },
      {
        type: 'Feature',
        id: 'b',
        properties: {},
        geometry: { type: 'Point', coordinates: [181, 10] },
      },
    ],
  });
  const preview = await previewGeoJSON(input, {
    attribution: 'Field survey',
    timeField: 'time',
  });
  assert.equal(preview.accepted, 1);
  assert.equal(preview.rejected, 1);
  assert.deepEqual(preview.bounds, [179, 10, 179, 10]);
  assert.equal(preview.records[0].timeMs, Date.parse('2026-01-01T00:00:00Z'));
  assert.deepEqual(preview.timeRange, [
    Date.parse('2026-01-01T00:00:00Z'),
    Date.parse('2026-01-01T00:00:00Z'),
  ]);
  assert.equal(preview.records[0].properties.name, '<img src=x>');
  assert.match(preview.rejectedRows[0].reason, /position/);
});

test('GeoJSON incremental feature validation preserves normalized geometry and summary parity', async () => {
  const input = JSON.stringify({
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        id: 'point',
        properties: { observed: '2026-05-01T00:00:00Z' },
        geometry: { type: 'Point', coordinates: [-97, 30] },
      },
      {
        type: 'Feature',
        properties: { id: 'route', observed: '2026-05-02T00:00:00Z' },
        geometry: {
          type: 'LineString',
          coordinates: [
            [-99, 28, 10],
            [-98, 29, 20],
            [-96, 31],
          ],
        },
      },
      {
        type: 'Feature',
        id: 'area',
        properties: {},
        geometry: {
          type: 'Polygon',
          coordinates: [
            [
              [-95, 30],
              [-94, 30],
              [-94, 31],
              [-95, 30],
            ],
            [
              [-94.8, 30.2],
              [-94.7, 30.2],
              [-94.7, 30.3],
              [-94.8, 30.2],
            ],
          ],
        },
      },
    ],
  });
  const preview = await previewGeoJSON(input, { timeField: 'observed' });
  assert.equal(preview.accepted, 3);
  assert.equal(preview.rejected, 0);
  assert.deepEqual(preview.bounds, [-99, 28, -94, 31]);
  assert.deepEqual(preview.timeRange, [
    Date.parse('2026-05-01T00:00:00Z'),
    Date.parse('2026-05-02T00:00:00Z'),
  ]);
  assert.deepEqual(preview.records[1].geometry.coordinates, [
    [-99, 28, 10],
    [-98, 29, 20],
    [-96, 31, 0],
  ]);
  assert.equal(preview.records[1].id, 'route');
  assert.equal(preview.records[2].geometry.coordinates.length, 2);
});

test('late malformed vertices reject only that feature and do not pollute accepted bounds', async () => {
  const coordinates = Array.from({ length: 12_000 }, (_, index) => [
    index / 1000,
    1,
  ]);
  coordinates.push([181, 1]);
  const preview = await previewGeoJSON(
    JSON.stringify({
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          id: 'valid',
          geometry: { type: 'Point', coordinates: [2, 3] },
        },
        {
          type: 'Feature',
          id: 'late-invalid',
          geometry: { type: 'LineString', coordinates },
        },
        {
          type: 'Feature',
          id: 'valid-again',
          geometry: { type: 'Point', coordinates: [4, 5] },
        },
      ],
    }),
  );
  assert.equal(preview.accepted, 2);
  assert.equal(preview.rejected, 1);
  assert.match(preview.rejectedRows[0].reason, /position/);
  assert.deepEqual(preview.bounds, [2, 3, 4, 5]);
});

test('aggregate coordinate limit includes geometry rejected later by timestamp validation', async () => {
  const large = Array.from({ length: 49_999 }, (_, index) => [index / 1000, 1]);
  const valid = {
    type: 'Feature',
    id: 'large',
    properties: { observed: '2026-01-01T00:00:00Z' },
    geometry: { type: 'LineString', coordinates: [[-1, 0], ...large] },
  };
  const invalidTime = {
    type: 'Feature',
    id: 'bad-time',
    properties: { observed: 'local time' },
    geometry: { type: 'Point', coordinates: [1, 1] },
  };
  await assert.rejects(
    previewGeoJSON(
      JSON.stringify({
        type: 'FeatureCollection',
        features: [valid, invalidTime],
      }),
      { timeField: 'observed' },
    ),
    { code: 'too-many-positions' },
  );
});

test('CSV preview supports quoted cells and rejects ambiguous local dates and bad coordinates', async () => {
  const csv =
    'id,lat,lon,observed_at,note\r\na,10,179,2026-01-01T00:00:00Z,"line one,\nline two"\r\nb,91,0,2026-01-01T00:00:00Z,invalid\r\nc,0,0,01/02/2026,ambiguous';
  const preview = await previewCSV(csv, {
    mapping: {
      latitude: 'lat',
      longitude: 'lon',
      id: 'id',
      time: 'observed_at',
    },
  });
  assert.equal(preview.accepted, 1);
  assert.equal(preview.rejected, 2);
  assert.match(preview.records[0].properties.note, /line two/);
  assert.match(preview.rejectedRows[0].reason, /WGS84/);
  assert.match(preview.rejectedRows[1].reason, /ISO 8601/);
  assert.equal(preview.records[0].geometry.coordinates[0], 179);
});

test('large CSV preview retains complete batch-built bounds and accepted time range', async () => {
  const rowCount = 10_000;
  const firstTime = Date.UTC(2026, 0, 1);
  const rows = Array.from({ length: rowCount }, (_, index) => {
    const latitude =
      index === 0 ? -90 : index === rowCount - 1 ? 90 : (index % 179) - 89;
    const longitude =
      index === 0 ? -180 : index === rowCount - 1 ? 180 : (index % 359) - 179;
    const time = new Date(firstTime + index * 60_000).toISOString();
    return `row-${index},${latitude},${longitude},${time}`;
  });
  rows.push('invalid,91,0,2026-12-31T00:00:00Z');
  const preview = await previewCSV(
    `id,latitude,longitude,observed_at\n${rows.join('\n')}`,
    {
      mapping: {
        id: 'id',
        latitude: 'latitude',
        longitude: 'longitude',
        time: 'observed_at',
      },
    },
  );

  assert.equal(preview.accepted, rowCount);
  assert.equal(preview.rejected, 1);
  assert.equal(preview.records.length, rowCount);
  assert.deepEqual(preview.bounds, [-180, -90, 180, 90]);
  assert.deepEqual(preview.timeRange, [
    firstTime,
    firstTime + (rowCount - 1) * 60_000,
  ]);
});

test('CSV batch summaries exclude empty, invalid and duplicate rows without inventing times', async () => {
  const mapped = {
    id: 'id',
    latitude: 'lat',
    longitude: 'lon',
    time: 'observed_at',
  };
  const empty = await previewCSV('id,lat,lon,observed_at\n', {
    mapping: mapped,
  });
  assert.equal(empty.accepted, 0);
  assert.equal(empty.rejected, 0);
  assert.equal(empty.bounds, null);
  assert.equal(empty.timeRange, null);

  const invalid = await previewCSV(
    'id,lat,lon,observed_at\na,91,0,2026-01-01T00:00:00Z\nb,0,181,2026-01-02T00:00:00Z',
    {
      mapping: mapped,
    },
  );
  assert.equal(invalid.accepted, 0);
  assert.equal(invalid.rejected, 2);
  assert.equal(invalid.bounds, null);
  assert.equal(invalid.timeRange, null);

  const missingTime = await previewCSV('id,lat,lon\na,1,2', {
    mapping: { id: 'id', latitude: 'lat', longitude: 'lon' },
  });
  assert.equal(missingTime.records[0].timeMs, null);
  assert.equal(missingTime.timeRange, null);

  const duplicate = await previewCSV(
    'id,lat,lon,observed_at\nsame,1,2,2026-01-01T00:00:00Z\nsame,90,180,2026-12-31T00:00:00Z\nother,-5,-6,',
    { mapping: mapped },
  );
  assert.equal(duplicate.accepted, 2);
  assert.equal(duplicate.rejected, 1);
  assert.deepEqual(duplicate.bounds, [-6, -5, 2, 1]);
  assert.deepEqual(duplicate.timeRange, [
    Date.UTC(2026, 0, 1),
    Date.UTC(2026, 0, 1),
  ]);
});

test('CSV parsing rejects missing mapping, malformed quoting and oversized files', async () => {
  await assert.rejects(previewCSV('a,b\n1,2'), { code: 'mapping-required' });
  await assert.rejects(
    previewCSV('lat,lon\n"unterminated,1', {
      mapping: { latitude: 'lat', longitude: 'lon' },
    }),
    { code: 'invalid-csv' },
  );
  await assert.rejects(previewGeoJSON(' '.repeat(8 * 1024 * 1024 + 1)), {
    code: 'file-too-large',
  });
});

test('shared CSV decoder preserves sync parse output and reads headers without scanning the body', async () => {
  const csv =
    '\uFEFFid,lat,lon,note\r\nalpha,10,20,"line one,\nline ""two"""\r\n\r\nbeta,11,21,last';
  const parsed = parseCsv(csv);
  assert.deepEqual(parsed.headers, ['id', 'lat', 'lon', 'note']);
  assert.deepEqual(parsed.rows, [
    ['alpha', '10', '20', 'line one,\nline "two"'],
    ['beta', '11', '21', 'last'],
  ]);
  assert.deepEqual(parseCsvHeaders(csv), parsed.headers);

  const malformedTail = 'lat,lon\n1,2\n"unterminated';
  assert.deepEqual(parseCsvHeaders(malformedTail), ['lat', 'lon']);
  assert.deepEqual(
    await parseCsvHeadersAsync(new TextEncoder().encode(csv), {
      chunkBytes: 2,
    }),
    parsed.headers,
  );
  assert.deepEqual(await parseCsvHeadersAsync(malformedTail, {}), [
    'lat',
    'lon',
  ]);
  await assert.rejects(
    previewCSV(malformedTail, {
      mapping: { latitude: 'lat', longitude: 'lon' },
    }),
    { code: 'invalid-csv' },
  );
  await assert.rejects(
    previewCSV(malformedTail),
    { code: 'invalid-csv' },
    'syntax errors in the body still take precedence over missing mapping',
  );
});

test('CSV header-only path shares grammar but stops before body validation', async () => {
  const malformedTail = 'lat,lon\n1,2\n"unterminated';
  assert.deepEqual(parseCsvHeaders(malformedTail), ['lat', 'lon']);
  assert.throws(() => parseCsv(malformedTail), {
    code: 'invalid-csv',
    message: 'CSV ends inside a quoted cell.',
  });
  await assert.rejects(
    previewCSV(malformedTail, {
      mapping: { latitude: 'lat', longitude: 'lon' },
    }),
    { code: 'invalid-csv' },
  );
});

test('CSV header mapping can be cancelled while decoding a byte-backed file', async () => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 0);
  try {
    await assert.rejects(
      parseCsvHeadersAsync(
        new TextEncoder().encode(
          'latitude,longitude\n' + '30,-97\n'.repeat(40_000),
        ),
        { signal: controller.signal, chunkBytes: 256 },
      ),
      { name: 'AbortError' },
    );
  } finally {
    clearTimeout(timer);
  }
});

test('CSV sync parser preserves late syntax and configured-limit error precedence', () => {
  assert.throws(() => parseCsv('a,a\n"unterminated'), {
    message: 'CSV ends inside a quoted cell.',
  });
  assert.throws(() => parseCsv(`a,a\n${'1,2\n'.repeat(50_001)}`), {
    code: 'too-many-rows',
  });
  assert.throws(() => parseCsv(`a,b\n"${'x'.repeat(4097)}`), {
    code: 'invalid-csv',
  });
  assert.throws(() => parseCsv(`a,b\n"${'x'.repeat(4097)}"`), {
    code: 'cell-too-large',
  });
  assert.throws(() => parseCsv(`${Array(65).fill('c').join(',')}\n`), {
    code: 'too-many-columns',
  });
  assert.deepEqual(parseCsv('\nlat,lon\r\n\r\n10,20\r\n'), {
    headers: ['lat', 'lon'],
    rows: [['10', '20']],
  });
});

test('import previews honor cancellation before applying any records', async () => {
  const controller = new AbortController();
  controller.abort(new DOMException('User cancelled', 'AbortError'));
  await assert.rejects(
    previewCSV('lat,lon\n1,2', {
      mapping: { latitude: 'lat', longitude: 'lon' },
      signal: controller.signal,
    }),
    { name: 'AbortError' },
  );
});

test('CSV preview cancellation takes precedence before decoding and scanning', async () => {
  const controller = new AbortController();
  controller.abort(new DOMException('User cancelled', 'AbortError'));
  await assert.rejects(
    previewCSV(new Uint8Array([0xff]), { signal: controller.signal }),
    { name: 'AbortError' },
  );
  await assert.rejects(
    previewCSV('lat,lon\n"unterminated', { signal: controller.signal }),
    { name: 'AbortError' },
  );
});

test('CSV preview preserves parser error precedence', async () => {
  const mapping = { latitude: 'lat', longitude: 'lon' };
  const cases = [
    ['lat,lat\n1,2', 'invalid-csv'],
    ['lat,lon\n1,2\n"unterminated', 'invalid-csv'],
    [`lat,lon\n${'1,2\n'.repeat(50_001)}`, 'too-many-rows'],
    [`lat,lon\n"${'x'.repeat(4097)}"`, 'cell-too-large'],
    [`${Array(65).fill('c').join(',')}\n`, 'too-many-columns'],
  ];
  for (const [input, code] of cases)
    await assert.rejects(previewCSV(input, { mapping }), { code });
});
