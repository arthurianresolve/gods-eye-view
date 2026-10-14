import test from 'node:test';
import assert from 'node:assert/strict';
import { selectImportRenderRecords } from './renderRecords.js';

test('render preparation preserves cohort order, identity and attribution across imports', () => {
  const imports = [
    null,
    { id: 'bad', records: {} },
    { id: 'a', attribution: 'A', records: [{ id: 'duplicate' }, { id: 'a2' }] },
    { id: 'b', attribution: 'B', records: [{ id: 'duplicate' }, { id: 'b2' }] },
  ];
  const result = selectImportRenderRecords(imports, 3);
  assert.equal(result.total, 4);
  assert.deepEqual(
    result.selected.map(({ record, source }) => [source.id, record.id]),
    [
      ['a', 'duplicate'],
      ['a', 'a2'],
      ['b', 'duplicate'],
    ],
  );
  assert.equal(result.selected[0].record, imports[2].records[0]);
  assert.equal(result.selected[2].source, imports[3]);
  assert.equal(imports[3].records.length, 2, 'stored data is never truncated');
});

test('unrendered records are counted without reading or copying their payloads', () => {
  const records = [{ id: 'first' }];
  Object.defineProperty(records, 1, {
    get: () => assert.fail('unrendered feature visited'),
  });
  const result = selectImportRenderRecords([{ records }], 1);
  assert.equal(result.total, 2);
  assert.equal(result.selected.length, 1);
  assert.deepEqual(selectImportRenderRecords(null, 5000), {
    total: 0,
    selected: [],
  });
});
