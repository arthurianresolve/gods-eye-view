import assert from 'node:assert/strict';
import test from 'node:test';
import * as Cesium from 'cesium';
import { snapshotFleetModelReadiness } from './fleet-program-state.mjs';

function model({ id, ready = true, show = true, modelMatrix } = {}) {
  const result = Object.create(Cesium.Model.prototype);
  result.id = id;
  result._ready = ready;
  result._show = show;
  result.modelMatrix =
    modelMatrix || Cesium.Matrix4.clone(Cesium.Matrix4.IDENTITY);
  return result;
}

function viewerWithPrimitives(primitives) {
  return { scene: { primitives } };
}

test('readiness snapshot traverses nested collections and preserves effective show', () => {
  const root = new Cesium.PrimitiveCollection({ show: true });
  const nested = new Cesium.PrimitiveCollection({ show: false });
  const first = model({ id: 'a10001', ready: true, show: true });
  const second = model({ id: 'a10002', ready: false, show: true });
  const third = model({ id: 'a10003', ready: true, show: false });
  root.add(first);
  nested.add(second);
  nested.add(third);
  root.add(nested);

  const snapshot = snapshotFleetModelReadiness(viewerWithPrimitives(root), {
    expectedIds: ['a10001', 'a10002', 'a10003'],
  });

  assert.equal(snapshot.truncated, false);
  assert.deepEqual(
    snapshot.items.map(({ id, ready, show, effectiveShow }) => ({
      id,
      ready,
      show,
      effectiveShow,
    })),
    [
      { id: 'a10001', ready: true, show: true, effectiveShow: true },
      { id: 'a10002', ready: false, show: true, effectiveShow: false },
      { id: 'a10003', ready: true, show: false, effectiveShow: false },
    ],
  );
  assert.deepEqual(
    snapshot.items[0].modelMatrix,
    Array.from(Cesium.Matrix4.IDENTITY),
  );
  assert.equal(snapshot.items[1].collectionPath.length, 2);
});

test('readiness snapshot normalizes Entity pick IDs only through known fixture identity', () => {
  const root = new Cesium.PrimitiveCollection();
  const entity = new Cesium.Entity({ id: 'generated-tracked-entity' });
  root.add(model({ id: entity }));
  const entityToFixtureId = new Map([[entity, 'a10007']]);

  const snapshot = snapshotFleetModelReadiness(viewerWithPrimitives(root), {
    expectedIds: ['a10007'],
    entityToFixtureId,
  });

  assert.deepEqual(
    snapshot.items.map(({ id, identityKind }) => [id, identityKind]),
    [['a10007', 'entity-map']],
  );

  const unmapped = snapshotFleetModelReadiness(viewerWithPrimitives(root), {
    expectedIds: ['a10008'],
  });
  assert.equal(unmapped.items[0].id, null);
  assert.equal(unmapped.items[0].identityKind, 'unmapped-entity');
});

test('readiness snapshot reports duplicate and missing source identities without hiding them', () => {
  const root = new Cesium.PrimitiveCollection();
  root.add(model({ id: 'a10001' }));
  root.add(model({ id: 'a10001' }));
  const snapshot = snapshotFleetModelReadiness(viewerWithPrimitives(root), {
    expectedIds: ['a10001', 'a10002'],
  });
  const ids = snapshot.items.map((item) => item.id);
  assert.equal(ids.length, 2);
  assert.equal(new Set(ids).size, 1);
  assert.deepEqual(
    [...new Set(['a10001', 'a10002'])].filter((id) => !ids.includes(id)),
    ['a10002'],
  );
});

test('readiness snapshot retains all twenty distinct source model identities', () => {
  const root = new Cesium.PrimitiveCollection();
  const expectedIds = Array.from({ length: 20 }, (_, index) =>
    (0xa10000 + index).toString(16),
  );
  for (const id of expectedIds)
    root.add(model({ id, ready: true, show: true }));

  const snapshot = snapshotFleetModelReadiness(viewerWithPrimitives(root), {
    expectedIds,
  });
  const observedIds = snapshot.items.map((item) => item.id);

  assert.equal(snapshot.truncated, false);
  assert.equal(observedIds.length, 20);
  assert.equal(new Set(observedIds).size, 20);
  assert.deepEqual([...observedIds].sort(), [...expectedIds].sort());
  assert.ok(snapshot.items.every((item) => item.ready && item.effectiveShow));
});

test('readiness snapshot bounds model count and collection depth', () => {
  const root = new Cesium.PrimitiveCollection();
  const nested = new Cesium.PrimitiveCollection();
  nested.add(model({ id: 'a10002' }));
  root.add(model({ id: 'a10001' }));
  root.add(nested);

  const modelBound = snapshotFleetModelReadiness(viewerWithPrimitives(root), {
    maxModels: 1,
  });
  assert.equal(modelBound.items.length, 1);
  assert.equal(modelBound.truncated, true);

  const depthBound = snapshotFleetModelReadiness(viewerWithPrimitives(root), {
    maxCollectionDepth: 0,
  });
  assert.equal(depthBound.items.length, 1);
  assert.equal(depthBound.truncated, true);
});

test('readiness snapshot rejects invalid scenes and limits', () => {
  assert.throws(
    () => snapshotFleetModelReadiness(null),
    /viewer scene primitives/,
  );
  assert.throws(
    () =>
      snapshotFleetModelReadiness(
        viewerWithPrimitives(new Cesium.PrimitiveCollection()),
        {
          maxModels: -1,
        },
      ),
    /maxModels/,
  );
  assert.throws(
    () =>
      snapshotFleetModelReadiness(
        viewerWithPrimitives(new Cesium.PrimitiveCollection()),
        {
          entityToFixtureId: {},
        },
      ),
    /must be a Map/,
  );
});
