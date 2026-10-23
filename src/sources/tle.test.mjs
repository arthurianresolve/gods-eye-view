import assert from 'node:assert/strict';
import test from 'node:test';
import {
  decodeTleCatalogNumber,
  parseTleText,
  tleCatalogNumber,
} from './tle.js';

function tleSet(index) {
  const catalog = String(25_544 + index).padStart(5, ' ');
  return [
    `SAT ${index}`,
    `1 ${catalog}U 98067A   24001.50000000  .00016717  00000-0  30270-3 0  9994`,
    `2 ${catalog}  51.6416 247.4627 0006703 130.5360 325.0288 15.50377579432414`,
  ].join('\n');
}

test('a truncated TLE set does not desynchronize later records', () => {
  const records = Array.from({ length: 8 }, (_, index) => tleSet(index));
  records[1] = records[1].split('\n').slice(0, 2).join('\n');

  const parsed = parseTleText(records.join('\n'));

  assert.deepEqual(
    parsed.map(({ name }) => name),
    ['SAT 0', 'SAT 2', 'SAT 3', 'SAT 4', 'SAT 5', 'SAT 6', 'SAT 7'],
  );
  assert.ok(
    parsed.every(
      ({ line1, line2 }) => line1.startsWith('1 ') && line2.startsWith('2 '),
    ),
  );
});

test('Alpha-5 and numeric satellite catalog identifiers retain distinct IDs', () => {
  const cases = [
    ['A0000', 100_000],
    ['A5544', 105_544],
    ['H9999', 179_999],
    ['J0000', 180_000],
    ['N9999', 229_999],
    ['P0000', 230_000],
    ['Z9999', 339_999],
    ['25544', 25_544],
    [105_544, 105_544],
    ['105544', 105_544],
  ];

  for (const [field, expected] of cases)
    assert.equal(decodeTleCatalogNumber(field), expected, String(field));

  assert.equal(decodeTleCatalogNumber('I0000'), null);
  assert.equal(decodeTleCatalogNumber('O0000'), null);
  assert.equal(decodeTleCatalogNumber('A5X44'), null);
  assert.equal(
    tleCatalogNumber(
      '1 A5544U 98067A   24001.50000000  .00016717  00000-0  30270-3 0  9994',
    ),
    105_544,
  );
});
