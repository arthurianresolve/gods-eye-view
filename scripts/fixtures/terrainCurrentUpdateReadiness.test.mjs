import test from 'node:test';
import assert from 'node:assert/strict';
import { installTerrainCurrentUpdateReadinessObserver } from './terrainCurrentUpdateReadiness.mjs';

class FakeEvent {
  listeners = new Set();

  addEventListener(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  raiseEvent(...args) {
    for (const listener of [...this.listeners]) listener(...args);
  }
}

function makeScene(updates) {
  const collections = [
    { collectionChanged: new FakeEvent() },
    { collectionChanged: new FakeEvent() },
  ];
  const scene = {
    preRender: new FakeEvent(),
    postRender: new FakeEvent(),
  };
  const ownershipCollection = {
    dataSourceAdded: new FakeEvent(),
    dataSourceRemoved: new FakeEvent(),
    dataSourceMoved: new FakeEvent(),
  };
  let updateCalls = 0;
  const display = {
    ready: false,
    update(...args) {
      updateCalls += 1;
      const result = updates.shift() ?? true;
      this.ready ||= result === true;
      return result;
    },
  };
  return {
    scene,
    display,
    collections,
    ownershipCollection,
    get updateCalls() {
      return updateCalls;
    },
    frame(result, generation) {
      assert.equal(display.update({ result, generation }), result);
      scene.preRender.raiseEvent(scene);
      scene.postRender.raiseEvent(scene);
    },
  };
}

test('latched ready true cannot pass a switch after current update returns false', () => {
  const fixture = makeScene([true, false, true]);
  const originalUpdate = fixture.display.update;
  const observer = installTerrainCurrentUpdateReadinessObserver({
    dataSourceDisplay: fixture.display,
    scene: fixture.scene,
    entityCollections: fixture.collections,
    ownershipCollection: fixture.ownershipCollection,
    getCurrentEntityCollections: () => fixture.collections,
  });
  assert.equal(observer.available, true);

  const first = observer.beginGeneration();
  fixture.frame(true, first.generation);
  assert.equal(fixture.display.ready, true);
  assert.equal(
    observer.isCurrentFrameReady(observer.read(), first.generation),
    true,
  );

  const switching = observer.beginGeneration();
  fixture.frame(false, switching.generation);
  assert.equal(fixture.display.ready, true);
  assert.equal(observer.read().updateReturnedBoolean, false);
  assert.equal(
    observer.isCurrentFrameReady(observer.read(), switching.generation),
    false,
  );

  fixture.frame(true, switching.generation);
  assert.equal(
    observer.isCurrentFrameReady(observer.read(), switching.generation),
    true,
  );
  assert.equal(fixture.updateCalls, 3);
  assert.equal(observer.dispose(), true);
  assert.equal(fixture.display.update, originalUpdate);
  assert.equal(observer.snapshot().cleanupConfirmed, true);
});

test('collection changes and completed render revisions invalidate stale witnesses', () => {
  const fixture = makeScene([true, true, true]);
  const observer = installTerrainCurrentUpdateReadinessObserver({
    dataSourceDisplay: fixture.display,
    scene: fixture.scene,
    entityCollections: fixture.collections,
    ownershipCollection: fixture.ownershipCollection,
    getCurrentEntityCollections: () => fixture.collections,
  });
  const generation = observer.beginGeneration();
  fixture.frame(true, generation.generation);
  const first = observer.read();
  assert.equal(
    observer.isCurrentFrameReady(first, generation.generation),
    true,
  );

  fixture.collections[1].collectionChanged.raiseEvent('changed');
  assert.equal(
    observer.isCurrentFrameReady(first, generation.generation),
    false,
  );
  fixture.frame(true, generation.generation);
  assert.equal(
    observer.isCurrentFrameReady(observer.read(), generation.generation),
    true,
  );
  const oldFrame = observer.read();
  fixture.frame(true, generation.generation);
  assert.equal(
    observer.isCurrentFrameReady(oldFrame, generation.generation),
    false,
  );
  assert.equal(observer.dispose(), true);
  assert.equal(fixture.collections[0].collectionChanged.listeners.size, 0);
  assert.equal(fixture.collections[1].collectionChanged.listeners.size, 0);
  for (const event of Object.values(fixture.ownershipCollection))
    assert.equal(event.listeners.size, 0);
});

test('observer rejects unavailable sources and preserves later update owners on dispose', () => {
  const fixture = makeScene([]);
  const observer = installTerrainCurrentUpdateReadinessObserver({
    dataSourceDisplay: fixture.display,
    scene: fixture.scene,
    entityCollections: [],
  });
  assert.equal(observer.available, false);
  assert.equal(observer.installErrorName, 'TypeError');

  const owned = installTerrainCurrentUpdateReadinessObserver({
    dataSourceDisplay: fixture.display,
    scene: fixture.scene,
    entityCollections: fixture.collections,
    ownershipCollection: fixture.ownershipCollection,
    getCurrentEntityCollections: () => fixture.collections,
  });
  const laterOwner = () => true;
  fixture.display.update = laterOwner;
  assert.equal(owned.dispose(), false);
  assert.equal(fixture.display.update, laterOwner);
});

test('data-source collection replacement or collection-change event invalidates readiness', () => {
  const fixture = makeScene([true, true]);
  let currentCollections = fixture.collections;
  const observer = installTerrainCurrentUpdateReadinessObserver({
    dataSourceDisplay: fixture.display,
    scene: fixture.scene,
    entityCollections: fixture.collections,
    ownershipCollection: fixture.ownershipCollection,
    getCurrentEntityCollections: () => currentCollections,
  });
  const generation = observer.beginGeneration();
  fixture.frame(true, generation.generation);
  const oldWitness = observer.read();
  assert.equal(
    observer.isCurrentFrameReady(oldWitness, generation.generation),
    true,
  );

  currentCollections = [
    fixture.collections[0],
    { collectionChanged: new FakeEvent() },
  ];
  assert.equal(
    observer.isCurrentFrameReady(oldWitness, generation.generation),
    false,
  );
  assert.equal(observer.snapshot().entityCollectionsMatch, false);

  currentCollections = fixture.collections;
  fixture.ownershipCollection.dataSourceAdded.raiseEvent(
    fixture.ownershipCollection,
    [],
    [],
  );
  fixture.frame(true, generation.generation);
  assert.equal(
    observer.isCurrentFrameReady(observer.read(), generation.generation),
    false,
  );
  assert.equal(observer.snapshot().ownershipChanged, true);
  assert.equal(observer.dispose(), true);
});
