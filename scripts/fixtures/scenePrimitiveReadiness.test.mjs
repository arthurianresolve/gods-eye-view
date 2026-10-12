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

test('ordered ground geometry must be ready even when its enclosing display is ready', () => {
  const scene = fixture();
  const ordered = scene.groundPrimitives.add(
    new Cesium.OrderedGroundPrimitiveCollection(),
  );
  const ready = ordered.add({ ready: true, show: true }, -1);
  const pending = ordered.add({ ready: false, show: false }, 1);
  const before = readScenePrimitiveReadiness(scene, Cesium);
  assert.equal(before.ready, false);
  assert.equal(before.pending.length, 1);
  assert.equal(before.pending[0].path, 'groundPrimitives/0/z-group-1/0');
  pending.ready = true;
  assert.equal(readScenePrimitiveReadiness(scene, Cesium).ready, true);
  assert.equal(pending.show, false);
  assert.equal(ready.show, true);
  assert.equal(ordered.length, 2);
});

test('unknown ordered-ground shape or Cesium version cannot be reported ready', () => {
  const scene = fixture();
  const ordered = scene.groundPrimitives.add(
    new Cesium.OrderedGroundPrimitiveCollection(),
  );
  ordered.add({ ready: true, show: true });
  assert.equal(
    readScenePrimitiveReadiness(scene, { ...Cesium, VERSION: '2.0.0' }).ready,
    false,
  );
  ordered._collectionsArray = [];
  const result = readScenePrimitiveReadiness(scene, Cesium);
  assert.equal(result.ready, false);
  assert.equal(result.unsupportedOwners.length, 1);
});
