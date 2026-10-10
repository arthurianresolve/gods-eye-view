import assert from 'node:assert/strict';
import test from 'node:test';
import { previewCSV, previewGeoJSON } from './geojsonCsv.js';

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
