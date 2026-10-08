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
