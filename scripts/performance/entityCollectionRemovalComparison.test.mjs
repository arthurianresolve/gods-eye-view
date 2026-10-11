import test from 'node:test';
import assert from 'node:assert/strict';
import * as Cesium from 'cesium';
import { removeOwnedEntityCollection } from '../../src/imports/entityCollectionOwnership.js';
import {
  assertInputFingerprintsUnchanged,
  removeByIdsIndividually,
} from './entityCollectionRemovalComparison.mjs';

function populatedCollection({ external = false } = {}) {
  const collection = new Cesium.EntityCollection();
  const owned = new Map();
  for (let index = 0; index < 4; index += 1) {
    const id = `import:${index}`;
    owned.set(id, collection.add({ id, point: { pixelSize: 9 } }));
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
    [...owned.keys()].sort(),
  );
  assert.equal(events.length, owned.size);
});

test('batched removal uses one collection event when all entities are owned', () => {
  const { collection, owned, events } = populatedCollection();
  removeOwnedEntityCollection(collection, owned);
  assert.deepEqual(collection.values, []);
  assert.equal(events.length, 1);
  assert.deepEqual(events[0].removed.sort(), [...owned.keys()].sort());
});

test('mixed ownership is preserved and respects an external event suspension', () => {
  const { collection, owned, events } = populatedCollection({ external: true });
  collection.suspendEvents();
  removeOwnedEntityCollection(collection, owned);
  assert.deepEqual(
    collection.values.map((entity) => entity.id),
    ['outside:one'],
  );
  assert.deepEqual(events, []);
  collection.resumeEvents();
  assert.equal(events.length, 1);
  assert.deepEqual(events[0].removed.sort(), [...owned.keys()].sort());
});

test('shared production helper preserves a replacement with an owned ID', () => {
  const { collection, owned, events } = populatedCollection();
  const original = owned.get('import:0');
  collection.remove(original);
  const replacement = collection.add({ id: 'import:0', name: 'replacement' });
  events.length = 0;

  removeOwnedEntityCollection(collection, owned);

  assert.equal(collection.getById('import:0'), replacement);
  assert.deepEqual(
    events.flatMap((event) => event.removed),
    ['import:1', 'import:2', 'import:3'],
  );
});

test('comparison input guard rejects changed hashes and path sets', () => {
  const before = { runtime: 'abc', helper: 'def' };
  assert.doesNotThrow(() =>
    assertInputFingerprintsUnchanged(before, { helper: 'def', runtime: 'abc' }),
  );
  assert.throws(
    () =>
      assertInputFingerprintsUnchanged(before, { ...before, helper: 'xyz' }),
    /input changed while the run was active: helper/,
  );
  assert.throws(
    () => assertInputFingerprintsUnchanged(before, { runtime: 'abc' }),
    /input path set changed/,
  );
});
