import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSavedQuery, parseSavedQueryList } from './savedQueries.js';

const valid = {
  version: 1,
  id: 'q-1',
  name: 'High aircraft',
  updatedAt: 10,
  query: {
    layers: ['flights'],
    scope: { kind: 'anywhere' },
    filters: [{ field: 'altitudeM', op: 'gt', value: 10_000 }],
    limit: 25,
  },
};

test('saved query documents normalize supported fields and retain explicit scope', () => {
  const parsed = parseSavedQuery(valid);
  assert.equal(parsed.query.layers[0], 'flights');
  assert.deepEqual(parsed.query.filters, [
    { field: 'altitudeM', op: 'gt', value: 10_000 },
  ]);
  assert.equal(parsed.query.scope.kind, 'anywhere');
  assert.equal(parseSavedQueryList([valid]).length, 1);
});

test('saved queries reject unsupported layers, filters, limits, duplicate ids, and future schemas', () => {
  assert.throws(() => parseSavedQuery({ ...valid, version: 2 }), /version/);
  assert.throws(
    () =>
      parseSavedQuery({
        ...valid,
        query: { ...valid.query, layers: ['datacenters'] },
      }),
    /supported/,
  );
  assert.throws(
    () => parseSavedQuery({ ...valid, query: { ...valid.query, limit: 501 } }),
    /limit/,
  );
  assert.throws(
    () =>
      parseSavedQuery({
        ...valid,
        query: {
          ...valid.query,
          filters: [{ field: 'apiKey', op: 'eq', value: 'x' }],
        },
      }),
    /invalid/,
  );
  assert.throws(() => parseSavedQueryList([valid, valid]), /unique/);
});
