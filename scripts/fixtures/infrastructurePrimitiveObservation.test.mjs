import test from 'node:test';
import assert from 'node:assert/strict';
import * as Cesium from 'cesium';
import {
  observeInfrastructurePrimitives,
  observeInfrastructureFrameDelivery,
} from './infrastructurePrimitiveObservation.mjs';

function fixture() {
  const scene = {
    primitives: new Cesium.PrimitiveCollection({ destroyPrimitives: false }),
    groundPrimitives: new Cesium.PrimitiveCollection({
      destroyPrimitives: false,
    }),
  };
  const entity = new Cesium.Entity({ id: 'source-1' });
  const rows = [
    {
      entity,
      entityId: entity.id,
      sourceRecordId: 'source:1',
      entityShow: true,
      point: { show: true },
      stem: {
        show: true,
        positions: [
          [1, 2, 3],
          [1, 2, 13],
        ],
      },
    },
  ];
  return { scene, rows, entity };
}

test('observes actual show attributes and stale geometry independently of Entity positions', () => {
  const { scene, rows, entity } = fixture();
  const attributes = {
    show: new Uint8Array([0]),
    color: new Uint8Array([1, 2, 3, 4]),
    boundingSphere: new Cesium.BoundingSphere(
      new Cesium.Cartesian3(1, 2, 3),
      0,
    ),
  };
  const owner = scene.primitives.add(
    new Cesium.PrimitiveCollection({ destroyPrimitives: false }),
  );
  owner.add({
    ready: true,
    show: true,
    getGeometryInstanceAttributes(id) {
      assert.equal(id, entity);
      return attributes;
    },
  });
  const before = [...attributes.show];
  const result = observeInfrastructurePrimitives(scene, rows, Cesium);
  assert.deepEqual(result.targets[0].expectedStemSphere, {
    center: [1, 2, 8],
    radius: 5,
  });
  const observed = result.nodes.find((entry) => entry.instances.length);
  assert.deepEqual(observed.instances[0].show, [0]);
  assert.equal(observed.instances[0].boundingSphere.radius, 0);
  assert.deepEqual([...attributes.show], before);
  assert.equal(rows[0].entityShow, true);
});

test('pending primitives are reported without requesting unavailable instance attributes', () => {
  const { scene, rows } = fixture();
  scene.primitives.add({
    ready: false,
    show: false,
    getGeometryInstanceAttributes() {
      assert.fail('pending geometry must not be queried');
    },
  });
  const result = observeInfrastructurePrimitives(scene, rows, Cesium);
  assert.equal(result.nodes[1].ready, false);
  assert.deepEqual(result.nodes[1].instances, []);
});

test('bounds owner traversal and does not enumerate point collection contents', () => {
  const { scene, rows } = fixture();
  scene.primitives.add({
    length: 4362,
    get() {
      assert.fail('not an owner collection');
    },
  });
  for (let index = 0; index < 100; index++)
    scene.primitives.add({ show: true });
  const result = observeInfrastructurePrimitives(scene, rows, Cesium);
  assert.equal(result.nodes.length, 64);
  assert.equal(result.truncated, true);
});

test('frame observation distinguishes no callbacks from a completed frame and removes listeners', async () => {
  const preUpdate = new Cesium.Event();
  const postRender = new Cesium.Event();
  const viewer = {
    useDefaultRenderLoop: true,
    targetFrameRate: 60,
    scene: {
      preUpdate,
      postRender,
      requestRenderMode: true,
      canvas: { width: 960, height: 640 },
    },
  };
  const documentLike = {
    visibilityState: 'visible',
    hidden: false,
    hasFocus: () => true,
  };
  const incomplete = await observeInfrastructureFrameDelivery(
    viewer,
    async () => null,
    { documentLike },
  );
  assert.equal(incomplete.delivery.updates, 0);
  assert.equal(incomplete.delivery.renderedFrames, 0);
  assert.equal(incomplete.delivery.completed, false);
  assert.deepEqual(incomplete.delivery.before, {
    visibility: 'visible',
    hidden: false,
    focused: true,
  });
  const canvas = {};
  const completed = await observeInfrastructureFrameDelivery(
    viewer,
    async () => {
      preUpdate.raiseEvent();
      postRender.raiseEvent();
      return canvas;
    },
    { documentLike },
  );
  assert.equal(completed.canvas, canvas);
  assert.equal(completed.delivery.updates, 1);
  assert.equal(completed.delivery.renderedFrames, 1);
  assert.equal(preUpdate.numberOfListeners, 0);
  assert.equal(postRender.numberOfListeners, 0);
  await assert.rejects(
    observeInfrastructureFrameDelivery(viewer, async () => {
      throw Error('capture rejected');
    }),
    /capture rejected/,
  );
  assert.equal(preUpdate.numberOfListeners, 0);
  assert.equal(postRender.numberOfListeners, 0);
});
