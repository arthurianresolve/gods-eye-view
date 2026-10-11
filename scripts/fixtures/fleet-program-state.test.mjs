import assert from 'node:assert/strict';
import test from 'node:test';
import * as Cesium from 'cesium';
import {
  snapshotFleetModelReadiness,
  snapshotFleetTrackedBillboards,
  snapshotFleetEnvironmentReadiness,
} from './fleet-program-state.mjs';

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

test('environment readiness preserves incomplete and unavailable work without GL calls', () => {
  const root = new Cesium.PrimitiveCollection();
  const loading = model({ id: 'a10000', ready: false });
  loading._environmentMapManager = new Cesium.DynamicEnvironmentMapManager();
  loading._environmentMapManager._irradianceTextureDirty = true;
  root.add(loading);
  root.add(model({ id: 'a10001', ready: false }));
  const viewer = viewerWithPrimitives(root);
  Object.defineProperty(viewer.scene, 'context', {
    get() {
      throw new Error('Readiness must not read GL');
    },
  });
  const result = snapshotFleetEnvironmentReadiness(viewer);
  assert.equal(result.cesiumVersion, '1.138.0');
  assert.equal(result.truncated, false);
  assert.equal(result.items[0].enabled, true);
  assert.equal(result.items[0].dirty.irradianceTexture, true);
  assert.deepEqual(result.items[0].pending, {
    radiance: 0,
    convolution: 0,
    irradiance: 0,
  });
  assert.equal(result.items[1].pending, null);
  assert.equal(result.items[1].dirty, null);
  assert.equal(result.globalQueue.active, 0);
  assert.equal(result.globalQueue.queued, 0);
});

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

function trackedBillboardCollection({
  trackedId = 'flights:a10001',
  show = true,
  alpha = 0,
} = {}) {
  const entity = new Cesium.Entity({ id: `fixture-${trackedId}` });
  entity.gevTrackedId = trackedId;
  const billboards = new Cesium.BillboardCollection({ show });
  billboards.add({ id: entity, color: new Cesium.Color(1, 1, 1, alpha) });
  return billboards;
}

test('tracked fallback snapshot reads resolved primitive alpha and effective ancestor visibility', () => {
  const root = new Cesium.PrimitiveCollection({ show: true });
  const hiddenAncestor = new Cesium.PrimitiveCollection({ show: false });
  const billboards = trackedBillboardCollection({ alpha: 0 });
  hiddenAncestor.add(billboards);
  root.add(hiddenAncestor);

  const snapshot = snapshotFleetTrackedBillboards(viewerWithPrimitives(root));

  assert.equal(snapshot.truncated, false);
  assert.equal(snapshot.items.length, 1);
  assert.deepEqual(
    (({ id, layer, ready, show, collectionShow, effectiveShow, alpha }) => ({
      id,
      layer,
      ready,
      show,
      collectionShow,
      effectiveShow,
      alpha,
    }))(snapshot.items[0]),
    {
      id: 'a10001',
      layer: 'flights',
      ready: false,
      show: true,
      collectionShow: true,
      effectiveShow: false,
      alpha: 0,
    },
  );
});

test('tracked fallback snapshot identifies the military visual without evaluating entity properties', () => {
  const root = new Cesium.PrimitiveCollection();
  const billboards = trackedBillboardCollection({
    trackedId: 'military:a20003',
    show: false,
    alpha: 0.25,
  });
  root.add(billboards);

  const snapshot = snapshotFleetTrackedBillboards(viewerWithPrimitives(root));

  assert.deepEqual(snapshot.items[0], {
    id: 'a20003',
    layer: 'military',
    ready: false,
    collectionReady: false,
    show: true,
    collectionShow: false,
    effectiveShow: false,
    alpha: 0.25,
    collectionPath: [0],
    billboardIndex: 0,
  });
});

test('tracked fallback snapshot preserves duplicate identity evidence and military IDs', () => {
  const root = new Cesium.PrimitiveCollection();
  root.add(trackedBillboardCollection());
  root.add(trackedBillboardCollection());

  const duplicate = snapshotFleetTrackedBillboards(viewerWithPrimitives(root));
  assert.equal(duplicate.items.length, 2);
  assert.equal(new Set(duplicate.items.map((item) => item.id)).size, 1);

  const militaryRoot = new Cesium.PrimitiveCollection();
  militaryRoot.add(
    trackedBillboardCollection({ trackedId: 'military:a20001' }),
  );
  const military = snapshotFleetTrackedBillboards(
    viewerWithPrimitives(militaryRoot),
  );
  assert.deepEqual(military.items, [
    {
      id: 'a20001',
      layer: 'military',
      ready: false,
      collectionReady: false,
      show: true,
      collectionShow: true,
      effectiveShow: true,
      alpha: 0,
      collectionPath: [0],
      billboardIndex: 0,
    },
  ]);
});

test('tracked fallback snapshot reports traversal bounds instead of claiming a complete search', () => {
  const root = new Cesium.PrimitiveCollection();
  root.add(new Cesium.PrimitiveCollection());
  const bounded = snapshotFleetTrackedBillboards(viewerWithPrimitives(root), {
    maxPrimitives: 0,
  });
  assert.deepEqual(bounded, {
    items: [],
    truncated: true,
    visitedPrimitives: 0,
  });
});
