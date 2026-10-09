import test from 'node:test';
import assert from 'node:assert/strict';
import { previewCSV, previewGeoJSON } from './geojsonCsv.js';
import { previewKML, previewGPX } from './kmlGpx.js';

// A timer models a user cancellation task. Microtask-only yielding would finish
// all normalization before this cancellation could be delivered.
for (const kind of ['csv', 'geojson', 'kml', 'gpx']) {
  test(`${kind} normalization yields to cancellation from the event loop`, async () => {
    const count = kind === 'kml' ? 14000 : 18000;
    let input,
      preview,
      options = {};
    if (kind === 'csv') {
      input =
        'id,lat,lon\n' +
        Array.from({ length: count }, (_, i) => `${i},1,2`).join('\n');
      preview = previewCSV;
      options.mapping = { id: 'id', latitude: 'lat', longitude: 'lon' };
    } else if (kind === 'geojson') {
      input = JSON.stringify({
        type: 'FeatureCollection',
        features: Array.from({ length: count }, (_, i) => ({
          type: 'Feature',
          id: String(i),
          properties: {},
          geometry: { type: 'Point', coordinates: [2, 1] },
        })),
      });
      preview = previewGeoJSON;
    } else if (kind === 'kml') {
      input =
        '<kml><Document>' +
        '<Placemark><Point><coordinates>2,1</coordinates></Point></Placemark>'.repeat(
          count,
        ) +
        '</Document></kml>';
      preview = previewKML;
    } else {
      input =
        '<gpx>' +
        '<wpt lat="1" lon="2"><name>Point</name></wpt>'.repeat(count) +
        '</gpx>';
      preview = previewGPX;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 0);
    try {
      await assert.rejects(
        preview(input, { ...options, signal: controller.signal }),
        { name: 'AbortError' },
      );
    } finally {
      clearTimeout(timer);
    }
  });
}
