import assert from 'node:assert/strict';
import test from 'node:test';
import * as Cesium from 'cesium';
import { readScenePrimitiveReadiness } from './scenePrimitiveReadiness.mjs';

function fixture() {
  return {
    primitives: new Cesium.PrimitiveCollection({ destroyPrimitives: false }),
    groundPrimitives: new Cesium.PrimitiveCollection({
      destroyPrimitives: false,
    }),
  };
}

test('hidden replacement work prevents readiness even with ready siblings', () => {
  const scene = fixture();
  const owner = scene.primitives.add(
    new Cesium.PrimitiveCollection({ destroyPrimitives: false }),
  );
  owner.add({ ready: true, show: true });
  const replacement = owner.add({ ready: false, show: false });
  const before = readScenePrimitiveReadiness(scene, Cesium);
  assert.equal(before.ready, false);
  assert.deepEqual(before.pending, [
    { path: 'primitives/0/1', type: 'Object' },
  ]);
  replacement.ready = true;
  assert.equal(readScenePrimitiveReadiness(scene, Cesium).ready, true);
  assert.equal(replacement.show, false);
});

test('ground owners participate without enumerating graphics buffers', () => {
  const scene = fixture();
  const ground = scene.groundPrimitives.add({ ready: false });
  scene.primitives.add({
    ready: true,
    length: 2629,
    get() {
      assert.fail('graphics enumeration');
    },
  });
  assert.equal(readScenePrimitiveReadiness(scene, Cesium).ready, false);
  ground.ready = true;
  assert.equal(readScenePrimitiveReadiness(scene, Cesium).ready, true);
});

test('bounded or cyclic owner graphs cannot produce an incomplete pass', () => {
  const scene = fixture();
  scene.primitives.add(scene.primitives);
  assert.equal(readScenePrimitiveReadiness(scene, Cesium).ready, true);
  for (let i = 0; i < 100; i++) scene.primitives.add({ ready: true });
  const result = readScenePrimitiveReadiness(scene, Cesium);
  assert.equal(result.truncated, true);
  assert.equal(result.ready, false);
  assert.equal(result.observedOwners, 64);
});
