import assert from 'node:assert/strict';
import test from 'node:test';
import { reproducePointPrimitiveReuseOrder } from './importEntityClearOrder.mjs';

test('real Cesium bulk removal reverses point-index reuse while individual removal preserves it', () => {
  const bulk = reproducePointPrimitiveReuseOrder({
    count: 5000,
    clearMode: 'removeAll',
    repeats: 2,
  });
  const individual = reproducePointPrimitiveReuseOrder({
    count: 5000,
    clearMode: 'removeById',
    repeats: 2,
  });

  assert.equal(bulk.cesiumVersion, '1.138.0');
  assert.equal(bulk.passes.length, 2);
  assert.equal(individual.passes.length, 2);
  assert.deepEqual(
    bulk.passes.map((pass) => pass.sameIndexCount),
    [0, 5000],
  );
  assert.deepEqual(
    individual.passes.map((pass) => pass.sameIndexCount),
    [5000, 5000],
  );
  assert.equal(bulk.passes[0].entityOrderPrefix[0].primitiveIndex, 4999);
  assert.equal(
    bulk.passes[0].primitiveOrderPrefix[0],
    'gev-import:fixture:fixture:4999',
  );
  assert.equal(bulk.passes[1].entityOrderPrefix[0].primitiveIndex, 0);
  assert.equal(
    bulk.passes[1].primitiveOrderPrefix[0],
    'gev-import:fixture:fixture:0',
  );
  assert.equal(individual.passes[0].entityOrderPrefix[0].primitiveIndex, 0);
  assert.equal(
    individual.passes[0].primitiveOrderPrefix[0],
    'gev-import:fixture:fixture:0',
  );
});
