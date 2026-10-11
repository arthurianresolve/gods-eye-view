import assert from 'node:assert/strict';
import test from 'node:test';
import * as Cesium from 'cesium';
import { reproducePointPrimitiveReuseOrder } from './importEntityClearOrder.mjs';
import { removeOwnedEntityCollection } from '../../src/imports/entityCollectionOwnership.js';

function runProductionClear({ useHelper, externallySuspended, cycles = 3 }) {
  const collection = new Cesium.EntityCollection();
  const cluster = new Cesium.EntityCluster();
  const visualizer = new Cesium.PointVisualizer(cluster, collection);
  const time = new Cesium.JulianDate();
  const results = [];
  let removedEvents = [];
  const onChanged = (_collection, _added, removed) => {
    if (removed.length > 0)
      removedEvents.push(removed.map((entity) => entity.id));
  };
  collection.collectionChanged.addEventListener(onChanged);

  const addPopulation = () => {
    const owned = new Map();
    for (let index = 0; index < 6; index += 1) {
      const id = `production-clear:${index}`;
      owned.set(
        id,
        collection.add({
          id,
          position: Cesium.Cartesian3.fromDegrees(index, 0),
          point: { pixelSize: 5, color: Cesium.Color.CYAN },
        }),
      );
    }
    visualizer.update(time);
    return owned;
  };

  try {
    let owned = addPopulation();
    for (let cycle = 0; cycle < cycles; cycle += 1) {
      removedEvents = [];
      if (externallySuspended) collection.suspendEvents();
      if (useHelper) removeOwnedEntityCollection(collection, owned);
      else for (const id of owned.keys()) collection.removeById(id);
      if (externallySuspended) collection.resumeEvents();

      const currentRemovedEvents = structuredClone(removedEvents);
      owned = addPopulation();
      results.push({
        removedEvents: currentRemovedEvents,
        primitiveIndices: Array.from(
          owned.keys(),
          (id) => cluster._collectionIndicesByEntity[id]?.pointIndex ?? null,
        ),
      });
    }
    return results;
  } finally {
    collection.collectionChanged.removeEventListener(onChanged);
    visualizer.destroy();
    cluster.destroy();
    collection.removeAll();
  }
}

function runExternallySuspendedRemoval(order) {
  const count = 6;
  const collection = new Cesium.EntityCollection();
  const cluster = new Cesium.EntityCluster();
  const visualizer = new Cesium.PointVisualizer(cluster, collection);
  const time = new Cesium.JulianDate();
  const addPopulation = () => {
    for (let index = 0; index < count; index++)
      collection.add({
        id: `external-suspend:${index}`,
        position: Cesium.Cartesian3.fromDegrees(index, 0),
        point: { pixelSize: 5, color: Cesium.Color.CYAN },
      });
  };
  const removedEvents = [];
  const onChanged = (_collection, _added, removed) => {
    if (removed.length > 0)
      removedEvents.push(removed.map((entity) => entity.id));
  };
  collection.collectionChanged.addEventListener(onChanged);

  try {
    addPopulation();
    visualizer.update(time);
    collection.suspendEvents();
    if (order === 'reverse-batched') collection.suspendEvents();
    const ids = Array.from({ length: count }, (_, index) => index);
    if (order === 'reverse-batched') ids.reverse();
    for (const index of ids) collection.removeById(`external-suspend:${index}`);
    if (order === 'reverse-batched') collection.resumeEvents();
    collection.resumeEvents();
    collection.collectionChanged.removeEventListener(onChanged);
    addPopulation();
    visualizer.update(time);

    return {
      removedEvents,
      indices: collection.values.map(
        (entity) => cluster._collectionIndicesByEntity[entity.id].pointIndex,
      ),
    };
  } finally {
    visualizer.destroy();
    cluster.destroy();
    collection.removeAll();
  }
}

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

test('rejected reverse-batching changes removed order under external suspension', () => {
  const legacy = runExternallySuspendedRemoval('individual');
  const reverseBatched = runExternallySuspendedRemoval('reverse-batched');

  assert.deepEqual(legacy.removedEvents, [
    Array.from({ length: 6 }, (_, index) => `external-suspend:${index}`),
  ]);
  assert.deepEqual(reverseBatched.removedEvents, [
    Array.from({ length: 6 }, (_, index) => `external-suspend:${5 - index}`),
  ]);
  assert.notDeepEqual(legacy.removedEvents, reverseBatched.removedEvents);
  assert.deepEqual(legacy.indices, [5, 4, 3, 2, 1, 0]);
  assert.deepEqual(reverseBatched.indices, [0, 1, 2, 3, 4, 5]);
});

test('production clear matches legacy point-index and removed-event ordering across cycles', () => {
  assert.equal(Cesium.VERSION, '1.138.0');
  for (const externallySuspended of [false, true]) {
    assert.deepEqual(
      runProductionClear({ useHelper: true, externallySuspended }),
      runProductionClear({ useHelper: false, externallySuspended }),
    );
  }
});
