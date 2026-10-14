import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { IMPORT_LIMITS, parseCsv } from '../../src/imports/geojsonCsv.js';
import { createImportInputComparisonFixtures } from './import-input-comparison-fixtures.mjs';

test('browser input comparison fixtures retain exact attribution inputs', () => {
  const [csv, geojson] = createImportInputComparisonFixtures();
  const rows = parseCsv(csv.text).rows;
  const collection = JSON.parse(geojson.text);
  const fixtureRows = [csv, geojson];
  const bytes = fixtureRows.map((fixture) =>
    new TextEncoder().encode(fixture.text),
  );
  const hashes = bytes.map((input) =>
    createHash('sha256').update(input).digest('hex'),
  );

  assert.deepEqual(
    fixtureRows.map(({ kind, count, firstId, lastId }) => ({
      kind,
      count,
      firstId,
      lastId,
    })),
    [
      { kind: 'csv', count: 50_000, firstId: '0', lastId: '49999' },
      { kind: 'geojson', count: 25_000, firstId: '0', lastId: '24999' },
    ],
  );
  assert.ok(bytes.every((input) => input.byteLength <= IMPORT_LIMITS.bytes));
  assert.equal(csv.text.startsWith('id,latitude,longitude,label\r\n'), true);
  assert.equal(rows.length, csv.count);
  assert.equal(rows[0][0], csv.firstId);
  assert.equal(rows.at(-1)[0], csv.lastId);
  assert.equal(collection.type, 'FeatureCollection');
  assert.equal(collection.features.length, geojson.count);
  assert.equal(collection.features[0].id, geojson.firstId);
  assert.equal(collection.features.at(-1).id, geojson.lastId);
  assert.deepEqual(hashes, [
    '08fd9f3332affc16a600018b7648b0a90c5b8dbcb29758a16e3864200b089e5d',
    '8c2077a1ab3d030c4327558cb66a2bc58bffd01e08642310a9fa480e25a1f756',
  ]);
});
