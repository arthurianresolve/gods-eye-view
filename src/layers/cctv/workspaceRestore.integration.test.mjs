import assert from 'node:assert/strict';
import test from 'node:test';
import * as Cesium from 'cesium';
import { DataLayerManager } from '../../data/manager.js';
import {
  LAYER_STATE_REGISTRY,
  REGISTERED_LAYER_IDS,
  createDefaultLayerState,
} from '../../data/layerState.js';
import { LayerStateCoordinator } from '../../data/layerStateCoordinator.js';
import { CCTV_ACTIVATION_RESULT } from '../../cctvFocusRequest.js';
import { createCctvLayer } from './index.js';

function event() {
  const listeners = new Set();
  return {
    addEventListener(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    removeEventListener(listener) {
      return listeners.delete(listener);
    },
    get numberOfListeners() {
      return listeners.size;
    },
  };
}

function createViewer() {
  const canvasListeners = new Map();
  const canvas = {
    clientWidth: 800,
    clientHeight: 600,
    disableRootEvents: true,
    addEventListener(type, listener) {
      const listeners = canvasListeners.get(type) || new Set();
      listeners.add(listener);
      canvasListeners.set(type, listeners);
    },
    removeEventListener(type, listener) {
      canvasListeners.get(type)?.delete(listener);
    },
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }),
  };
  const primitives = new Cesium.PrimitiveCollection();
  const originalAdd = primitives.add.bind(primitives);
  const originalRemove = primitives.remove.bind(primitives);
  const viewshedAdds = [];
  const viewshedRemoves = [];
  primitives.add = (primitive) => {
    const added = originalAdd(primitive);
    if (typeof primitive?._gevViewshed === 'string')
      viewshedAdds.push(primitive);
    return added;
  };
  primitives.remove = (primitive) => {
    if (typeof primitive?._gevViewshed === 'string')
      viewshedRemoves.push(primitive);
    return originalRemove(primitive);
  };
  const viewer = {
    scene: {
      canvas,
      globe: { show: true },
      primitives,
      screenSpaceCameraController: { enableInputs: true },
      pick: () => null,
    },
    camera: {
      positionWC: Cesium.Cartesian3.fromDegrees(-97.744, 30.267, 12_000),
      moveEnd: event(),
      moveStart: event(),
    },
    entities: new Cesium.EntityCollection(),
    isDestroyed: () => false,
    canvasListeners,
    viewshedAdds,
    viewshedRemoves,
  };
  return viewer;
}

function createCctv(source) {
  const noop = () => {};
  const focusListeners = new Set();
  const layer = createCctvLayer({
    source,
    services: {
      overlays: {
        clearOverlaySource: noop,
        hitTestWorldOverlay: () => null,
        setOverlayEntries: noop,
        setOverlaySourceVisible: noop,
      },
      sprites: {
        registerSpriteCollection: noop,
        restoreSpriteOrder: noop,
        unregisterSpriteCollection: noop,
      },
      activation: { CCTV_ACTIVATION_RESULT },
      locations: { CITY_POIS: {} },
      picking: {
        resolvePickId: () => null,
        registerPickOwner: noop,
        unregisterPickOwner: noop,
      },
      terrain: {
        resolveEllipsoidalGround: async (coords) =>
          coords.map(() => ({ ellipsoid: 0, source: 'workspace-test' })),
      },
      ground: {
        resolveGroundFloorCells: async () => [],
        warmGroundFloor: noop,
        cachedGroundFloor: () => null,
      },
      mesh: {
        sampleMeshFloorCells: noop,
        reconcileMeshFloorSource: () => ({ changed: false, source: null }),
      },
      focus: {
        focusPassIsNeeded: () => false,
        getFocusTarget: () => null,
        onFocusTargetAppear(listener) {
          focusListeners.add(listener);
          return () => focusListeners.delete(listener);
        },
      },
      render: {
        holdContinuousRender: noop,
        releaseContinuousRender: noop,
        governorRequestRender: noop,
      },
    },
  });
  return { layer, focusListeners };
}

function stubLayer(id) {
  return {
    id,
    name: id,
    icon: '',
    source: 'workspace integration stub',
    init: async () => true,
    enable: async () => true,
    update: async () => true,
    disable: async () => true,
    destroy: async () => true,
  };
}

async function waitFor(predicate, message) {
  for (let attempt = 0; attempt < 50; attempt++) {
    if (predicate()) return;
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.fail(message);
}

async function waitForCctvDrain(cctv, viewer, expectedBuilds, label) {
  await waitFor(() => {
    const stats = cctv.getStats();
    const diagnostics = cctv.getPerformanceDiagnostics();
    return (
      stats.loading === false &&
      diagnostics.pendingJobs === 0 &&
      viewer.viewshedAdds.length === expectedBuilds
    );
  }, `${label}: CCTV geometry work did not drain`);
  assert.equal(cctv.getStats().loading, false, `${label}: queue settled`);
  assert.equal(
    cctv.getPerformanceDiagnostics().pendingJobs,
    0,
    `${label}: owned CCTV jobs drained`,
  );
  assert.equal(viewer.viewshedAdds.length, expectedBuilds);
}

test('persisted workspace CCTV mode restores one real viewshed and reuses it on repeat', async (t) => {
  const previousDocument = globalThis.document;
  const previousImage = globalThis.Image;
  const context = {
    clearRect() {},
    createLinearGradient() {
      return { addColorStop() {} };
    },
    fillRect() {},
    strokeRect() {},
    fillText() {},
  };
  globalThis.document = {
    hidden: false,
    addEventListener() {},
    removeEventListener() {},
    createElement: () => ({ getContext: () => context }),
  };
  globalThis.Image = class {};
  t.after(() => {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
    if (previousImage === undefined) delete globalThis.Image;
    else globalThis.Image = previousImage;
  });

  const source = {
    getCatalog: async () => ({
      sources: [
        {
          id: 'workspace-camera',
          name: 'Workspace camera',
          city: 'Austin',
          lat: 30.267,
          lon: -97.744,
          headingDeg: 45,
          pitchDeg: -12,
          fovDeg: 60,
          rangeM: 700,
          mountHeightM: 24,
        },
      ],
    }),
    getHealth: async () => ({ cameras: [] }),
    getFrameUrl: () => '',
    getMediaUrl: () => '',
    getFrame: async () => ({
      contentType: 'image/png',
      bytes: new Uint8Array(),
    }),
  };
  const viewer = createViewer();
  const { layer: cctv, focusListeners } = createCctv(source);
  const manager = new DataLayerManager(viewer);
  for (const id of REGISTERED_LAYER_IDS)
    manager.register(id === 'cctv' ? cctv : stubLayer(id));
  manager.finalizeRegistrations(LAYER_STATE_REGISTRY);
  const coordinator = new LayerStateCoordinator(manager, null, {
    storage: { getItem: () => null, setItem: () => {} },
  });
  t.after(async () => {
    coordinator.destroy();
    await manager.destroyAll();
    viewer.scene.primitives.destroy();
  });

  const workspace = createDefaultLayerState();
  workspace.enabledLayerIds = ['cctv'];
  workspace.options.cctv.coverageMode = 'viewshed';
  workspace.options.cctv.showProjection = false;
  workspace.options.cctv.autoHop = false;

  const firstRestore = await coordinator.restoreWorkspaceState(workspace);
  assert.equal(
    firstRestore.find((row) => row.layerId === 'cctv')?.succeeded,
    true,
  );
  await waitForCctvDrain(cctv, viewer, 1, 'first workspace restore');
  const firstPrimitive = viewer.viewshedAdds[0];
  assert.equal(cctv.getParams().coverageMode, 'viewshed');
  assert.equal(cctv.getParams().showProjection, false);
  assert.equal(firstPrimitive._gevViewshed, 'workspace-camera');

  const repeatedRestore = await coordinator.restoreWorkspaceState(workspace);
  assert.equal(
    repeatedRestore.find((row) => row.layerId === 'cctv')?.succeeded,
    true,
  );
  await waitForCctvDrain(cctv, viewer, 1, 'repeated workspace restore');
  assert.equal(
    viewer.viewshedAdds.length,
    1,
    'unchanged persisted mode must not rebuild the primitive',
  );
  assert.equal(viewer.viewshedRemoves.length, 0);
  assert.equal(
    viewer.scene.primitives.contains(firstPrimitive),
    true,
    'the same Cesium primitive remains owned by the scene',
  );

  const offWorkspace = structuredClone(workspace);
  offWorkspace.options.cctv.coverageMode = 'off';
  await coordinator.restoreWorkspaceState(offWorkspace);
  await waitForCctvDrain(cctv, viewer, 1, 'OFF workspace restore');
  assert.equal(cctv.getParams().coverageMode, 'off');
  assert.equal(viewer.viewshedRemoves.length, 0);
  assert.equal(viewer.scene.primitives.contains(firstPrimitive), true);
  assert.equal(
    firstPrimitive.show,
    false,
    'OFF hides but retains the bounded volume',
  );

  await coordinator.restoreWorkspaceState(workspace);
  await waitForCctvDrain(
    cctv,
    viewer,
    1,
    'viewshed re-entry workspace restore',
  );
  assert.equal(
    viewer.viewshedAdds.length,
    1,
    're-entry reuses the retained volume',
  );
  assert.equal(viewer.viewshedRemoves.length, 0);
  assert.equal(viewer.scene.primitives.contains(firstPrimitive), true);
  assert.equal(firstPrimitive.show, true);

  assert.equal(await manager.destroyLayer('cctv'), true);
  assert.equal(firstPrimitive.isDestroyed(), true);
  assert.equal(viewer.scene.primitives.contains(firstPrimitive), false);
  assert.equal(viewer.viewshedRemoves.length, 1);
  assert.equal(focusListeners.size, 0);
  assert.equal(viewer.camera.moveEnd.numberOfListeners, 0);
  assert.equal(viewer.camera.moveStart.numberOfListeners, 0);
  assert.equal(
    [...viewer.canvasListeners.values()].reduce(
      (total, listeners) => total + listeners.size,
      0,
    ),
    0,
    'CCTV teardown releases owned canvas event listeners',
  );
});
