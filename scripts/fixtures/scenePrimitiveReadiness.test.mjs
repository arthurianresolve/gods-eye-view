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

function pendingGroundPolyline(inner = undefined) {
  const primitive = Object.create(Cesium.GroundPolylinePrimitive.prototype);
  primitive._primitiveOptions = { asynchronous: true };
  primitive._ready = false;
  primitive.show = false;
  primitive._primitive = inner;
  return primitive;
}

function innerPrimitive(state = 1) {
  const primitive = new Cesium.Primitive({ geometryInstances: [] });
  primitive._state = state;
  primitive.show = false;
  primitive._numberOfInstances = 3;
  primitive._createGeometryResults = [];
  primitive._geometries = [];
  primitive._va = [];
  return primitive;
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

test('pending ground-polyline observations report each pinned PrimitiveState phase', () => {
  const names = [
    'READY',
    'CREATING',
    'CREATED',
    'COMBINING',
    'COMBINED',
    'COMPLETE',
    'FAILED',
  ];
  for (const [value, name] of names.entries()) {
    const scene = fixture();
    const inner = innerPrimitive(value);
    inner._createGeometryResults = value === 2 ? [{}, {}] : undefined;
    inner._geometries = value >= 4 ? [{}, {}] : [];
    inner._va = value === 5 ? [{}, {}] : [];
    const ground = scene.groundPrimitives.add(pendingGroundPolyline(inner));
    const result = readScenePrimitiveReadiness(scene, Cesium);
    const observed = result.owners.find(
      (owner) => owner.path === 'groundPrimitives/0',
    );
    assert.equal(result.ready, false);
    assert.equal(observed.ready, false);
    assert.deepEqual(observed.buildState.state, { value, name });
    assert.equal(observed.buildState.primitivePresent, true);
    assert.equal(observed.buildState.primitiveReady, false);
    assert.equal(observed.buildState.primitiveShow, false);
    assert.equal(observed.buildState.asynchronous, true);
    assert.equal(observed.buildState.innerAsynchronous, true);
    assert.equal(observed.buildState.instanceCount, 3);
    assert.equal(
      observed.buildState.createGeometryResultsCount,
      value === 2 ? 2 : null,
    );
    assert.equal(observed.buildState.geometriesCount, value >= 4 ? 2 : 0);
    assert.equal(observed.buildState.vertexArraysCount, value === 5 ? 2 : 0);
  }
});

test('pending ground polyline distinguishes a valid not-yet-created inner primitive', () => {
  const scene = fixture();
  scene.groundPrimitives.add(pendingGroundPolyline());
  const result = readScenePrimitiveReadiness(scene, Cesium);
  const observed = result.owners.find(
    (owner) => owner.path === 'groundPrimitives/0',
  );
  assert.equal(result.ready, false);
  assert.deepEqual(observed.buildState, {
    schema: 'gev-cesium-ground-polyline-build-state/v1',
    status: 'observed',
    cesiumVersion: '1.138.0',
    primitivePresent: false,
    primitiveReady: null,
    primitiveShow: null,
    asynchronous: true,
    innerAsynchronous: null,
    state: null,
    instanceCount: null,
    createGeometryResultsCount: null,
    geometriesCount: null,
    vertexArraysCount: null,
    error: null,
  });
});

test('unknown Cesium version or changed inner primitive shape is unavailable', () => {
  const scene = fixture();
  scene.groundPrimitives.add(pendingGroundPolyline(innerPrimitive()));
  const wrongVersion = readScenePrimitiveReadiness(scene, {
    ...Cesium,
    VERSION: '1.139.0',
  });
  assert.equal(wrongVersion.ready, false);
  assert.deepEqual(
    wrongVersion.owners.find((owner) => owner.path === 'groundPrimitives/0')
      .buildState,
    {
      status: 'unavailable',
      reason: 'unsupported-cesium-version',
      cesiumVersion: '1.139.0',
    },
  );

  const changedShapeScene = fixture();
  changedShapeScene.groundPrimitives.add(pendingGroundPolyline({}));
  const changedShape = readScenePrimitiveReadiness(changedShapeScene, Cesium);
  assert.equal(changedShape.ready, false);
  const changedOwner = changedShape.owners.find(
    (owner) => owner.path === 'groundPrimitives/0',
  );
  assert.equal(changedOwner.buildState.status, 'unavailable');
  assert.equal(changedOwner.buildState.reason, 'inner-primitive-type-mismatch');
  assert.equal(changedShape.unsupportedOwners.length, 1);
});

test('inner array counts are bounded and errors are sanitized', () => {
  const scene = fixture();
  const inner = innerPrimitive(6);
  inner._va = new Array(100_001);
  inner._error = new Error(
    'worker failed https://private.example/asset C:\\Users\\secret\\file.js /home/private/file.js',
  );
  scene.groundPrimitives.add(pendingGroundPolyline(inner));
  const result = readScenePrimitiveReadiness(scene, Cesium);
  assert.equal(result.ready, false);
  const oversizedOwner = result.owners.find(
    (owner) => owner.path === 'groundPrimitives/0',
  );
  assert.equal(oversizedOwner.buildState.status, 'unavailable');
  assert.equal(oversizedOwner.buildState.reason, 'out-of-bounds');

  const errorScene = fixture();
  const failedInner = innerPrimitive(6);
  failedInner._error = new Error(
    'worker failed https://private.example/asset C:\\Users\\secret\\file.js /home/private/file.js',
  );
  errorScene.groundPrimitives.add(pendingGroundPolyline(failedInner));
  const error = readScenePrimitiveReadiness(errorScene, Cesium).owners.find(
    (owner) => owner.path === 'groundPrimitives/0',
  ).buildState.error;
  assert.equal(error.name, 'Error');
  assert.ok(error.message.length <= 160);
  assert.doesNotMatch(
    error.message,
    /https?:|private\.example|C:\\Users|\/home\/private/,
  );
});
