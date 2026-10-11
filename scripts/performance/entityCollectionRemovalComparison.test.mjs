import test from 'node:test';
import assert from 'node:assert/strict';
import * as Cesium from 'cesium';
import {
  removeByIdsIndividually,
  removeOwnedByIdsBatched,
} from './entityCollectionRemovalComparison.mjs';

function populatedCollection({ external = false } = {}) {
  const collection = new Cesium.EntityCollection();
  const owned = new Set();
  for (let index = 0; index < 4; index += 1) {
    const id = `import:${index}`;
    owned.add(id);
    collection.add({ id, point: { pixelSize: 9 } });
  }
  if (external) collection.add({ id: 'outside:one' });
  const events = [];
  collection.collectionChanged.addEventListener(
    (_collection, added, removed, changed) => {
      events.push({
        added: added.map((entity) => entity.id),
        removed: removed.map((entity) => entity.id),
        changed: changed.map((entity) => entity.id),
      });
    },
  );
  return { collection, owned, events };
}

test('individual removal preserves the exact imported IDs and unrelated entities', () => {
  const { collection, owned, events } = populatedCollection({ external: true });
  removeByIdsIndividually(collection, owned);
  assert.deepEqual(
    collection.values.map((entity) => entity.id),
    ['outside:one'],
  );
  assert.deepEqual(
    events.flatMap((event) => event.removed).sort(),
    [...owned].sort(),
  );
  assert.equal(events.length, owned.size);
});

test('batched removal uses one collection event when all entities are owned', () => {
  const { collection, owned, events } = populatedCollection();
  removeOwnedByIdsBatched(collection, owned);
  assert.deepEqual(collection.values, []);
  assert.equal(events.length, 1);
  assert.deepEqual(events[0].removed.sort(), [...owned].sort());
});

test('mixed ownership is preserved and respects an external event suspension', () => {
  const { collection, owned, events } = populatedCollection({ external: true });
  collection.suspendEvents();
  removeOwnedByIdsBatched(collection, owned);
  assert.deepEqual(
    collection.values.map((entity) => entity.id),
    ['outside:one'],
  );
  assert.deepEqual(events, []);
  collection.resumeEvents();
  assert.equal(events.length, 1);
  assert.deepEqual(events[0].removed.sort(), [...owned].sort());
});
