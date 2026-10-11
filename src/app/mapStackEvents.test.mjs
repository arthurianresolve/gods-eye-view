import test from 'node:test';
import assert from 'node:assert/strict';
import { createMapStackEventBridge } from './mapStackEvents.js';
import { MapSourceController } from '../maps/controller.js';
import { createMeshFloorSampler } from '../services/meshFloorSampler.js';
import {
  _clearMeshFloorCellsForTest,
  cachedMeshFloor,
  reportMeshFloorCell,
  setMeshFloorPreferred,
  setMeshFloorSource,
  setMeshFloorSourcePending,
} from '../data/groundFloor.js';

function makeController(eventTarget) {
  let finishTileset;
  const suppliedTileset = { show: true };
  const slowTilesetPromise = new Promise((resolve) => {
    finishTileset = resolve;
  });
  const primitives = [];
  const imagery = [];
  const viewer = {
    scene: {
      globe: { show: false },
      requestRender() {},
      primitives: {
        add(value) {
          primitives.push(value);
        },
        remove(value) {
          const index = primitives.indexOf(value);
          if (index >= 0) primitives.splice(index, 1);
          value.destroy?.();
        },
      },
    },
    imageryLayers: {
      add(value) {
        imagery.push(value);
      },
      remove(value) {
        const index = imagery.indexOf(value);
        if (index >= 0) imagery.splice(index, 1);
      },
    },
  };
  const bridge = createMapStackEventBridge(eventTarget);
  const controller = new MapSourceController(viewer, {
    registry: {
      defaultId: 'photoreal',
      recoveryId: 'photoreal',
      sources: [
        {
          descriptor: { id: 'photoreal', label: 'Photoreal' },
          tileset: suppliedTileset,
        },
        {
          descriptor: { id: 'slow', label: 'Slow tiles' },
          createTileset: () => slowTilesetPromise,
        },
        {
          descriptor: { id: 'globe', label: 'Globe' },
          imagery: async () => ({ id: 'globe-provider' }),
        },
        {
          descriptor: { id: 'broken', label: 'Broken' },
          imagery: async () => {
            throw new Error('provider unavailable');
          },
        },
      ],
      state: {},
    },
    initialStack: 'photoreal',
    requestRender() {},
    createImageryLayer: (provider) => ({ provider }),
    onChange: bridge.onChange,
  });
  const disconnect = bridge.connect(controller);
  return {
    bridge,
    controller,
    disconnect,
    finishTileset,
    suppliedTileset,
  };
}

test('map bridge suspends mesh reads during switching and settles owner for normal, silent and error paths once', async () => {
  _clearMeshFloorCellsForTest();
  setMeshFloorPreferred(true);
  const target = new EventTarget();
  const sampler = createMeshFloorSampler({
    groundFloor: {
      setMeshFloorPreferred,
      setMeshFloorSource,
      setMeshFloorSourcePending,
    },
    eventTarget: target,
  });
  const details = [];
  target.addEventListener('gev:map-stack-changed', (event) =>
    details.push(event.detail),
  );
  const env = makeController(target);
  const cell = { lat: 41.123, lon: -72.456 };
  setMeshFloorSource(env.suppliedTileset);
  reportMeshFloorCell(cell.lat, cell.lon, 121);

  const loading = env.controller.setStack('slow');
  assert.equal(details.at(-1).status, 'switching');
  assert.equal(details.at(-1).surfaceOwnerKnown, undefined);
  assert.equal(
    cachedMeshFloor(cell.lat, cell.lon),
    null,
    "old owner's cached mesh is unavailable during an in-flight switch",
  );
  const switchingScene = {
    primitives: {
      length: 1,
      get() {
        assert.fail('polling must not inspect an unsettled scene owner');
      },
    },
  };
  assert.equal(sampler.visibleTilesetLoaded(switchingScene), false);
  assert.equal(
    sampler.reconcileMeshFloorSource(switchingScene).pending,
    true,
    'periodic polling cannot settle ownership while a controller switch is pending',
  );
  env.finishTileset({ show: false, destroy() {} });
  await loading;
  assert.equal(
    details.filter((detail) => detail.status === 'ready').length,
    1,
    'onChange and settled subscription publish one settled event',
  );
  assert.equal(
    details.at(-1).surfaceOwner,
    env.controller.getImageryHostTileset(),
  );
  assert.equal(
    cachedMeshFloor(cell.lat, cell.lon),
    null,
    'new tileset does not inherit previous owner cells',
  );

  reportMeshFloorCell(cell.lat, cell.lon, 132);
  await env.controller.setStack('broken');
  assert.equal(details.at(-1).status, 'error');
  assert.equal(details.at(-1).surfaceOwnerKnown, true);
  assert.equal(details.at(-1).activeId, 'photoreal');
  assert.equal(details.at(-1).surfaceOwner, env.suppliedTileset);
  assert.equal(
    cachedMeshFloor(cell.lat, cell.lon),
    121,
    'failed switch restores the prior photoreal owner cache, not transient null',
  );

  await env.controller.setStack('globe', { silent: true });
  assert.equal(
    details.at(-1).status,
    'ready',
    'silent activation is published',
  );
  assert.equal(details.at(-1).surfaceOwnerKnown, true);
  assert.equal(details.at(-1).surfaceOwner, null);
  assert.equal(cachedMeshFloor(cell.lat, cell.lon), null);

  const settledCount = details.length;
  env.disconnect();
  assert.equal(env.controller.getPerformanceDiagnostics().listeners, 0);
  env.controller.destroy();
  await env.controller.setStack('photoreal');
  assert.equal(
    details.length,
    settledCount,
    'destroyed bridge/controller emit no late settled event',
  );
});

test('map bridge deduplicates identical settled state but republishes same-generation owner changes', () => {
  const target = new EventTarget();
  const bridge = createMapStackEventBridge(target);
  let owner = { id: 'first' };
  let listener;
  let unsubscribed = false;
  const controller = {
    getSwitchGeneration: () => 7,
    getImageryHostTileset: () => owner,
    subscribe(callback) {
      listener = callback;
      return () => {
        unsubscribed = true;
      };
    },
  };
  const details = [];
  target.addEventListener('gev:map-stack-changed', (event) =>
    details.push(event.detail),
  );
  const disconnect = bridge.connect(controller);
  bridge.onChange({ activeId: 'photoreal', status: 'ready' });
  listener({ activeId: 'photoreal', lastError: null });
  assert.equal(
    details.length,
    1,
    'same-generation duplicate owner work is suppressed',
  );

  owner = { id: 'replacement' };
  bridge.onChange({ activeId: 'photoreal', status: 'ready' });
  assert.equal(
    details.length,
    2,
    'a changed owner is published even at the same generation',
  );
  assert.equal(details.at(-1).surfaceOwner, owner);

  disconnect();
  assert.equal(unsubscribed, true);
});
