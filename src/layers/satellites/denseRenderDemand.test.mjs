import * as Cesium from 'cesium';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getRenderGovernorDiagnostics,
  holdContinuousRender,
  installRenderGovernor,
  releaseContinuousRender,
  scheduleRenderUpdate,
  _resetRenderGovernorForTest,
} from '../../renderGovernor.js';
import { parseTleText } from '../../sources/tle.js';
import { createCatalog } from './catalog.js';
import { createControls } from './controls.js';
import { createLifecycle } from './lifecycle.js';
import { createRendering } from './rendering.js';
import { DENSE_REFRESH_FRAMES } from './policy.js';

const TLE = [
  'ISS (ZARYA)',
  '1 25544U 98067A   08264.51782528 -.00002182  00000-0 -11606-4 0  2927',
  '2 25544  51.6416 247.4627 0006703 130.5360 325.0288 15.72125391563537',
].join('\n');

function createHarness(t, source) {
  const listeners = new Set();
  const primitives = new Set();
  const viewer = {
    scene: {
      requestRenderMode: true,
      requestRender() {},
      preRender: {
        addEventListener(listener) {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
      },
      primitives: {
        add(primitive) {
          primitives.add(primitive);
          return primitive;
        },
        remove(primitive) {
          primitives.delete(primitive);
        },
      },
    },
    camera: { positionWC: new Cesium.Cartesian3() },
  };
  installRenderGovernor(viewer);
  t.after(() => _resetRenderGovernorForTest());

  const points = new Map();
  const state = {
    _enabled: false,
    _trackedNorad: null,
    _trackedEntity: null,
    _params: { catalog: 'core', showPoints: true, showOrbits: false },
    _periodicRenderDisposer: null,
    _pointCollection: {
      show: false,
      add(attributes) {
        const point = { ...attributes };
        points.set(attributes.id, point);
        return point;
      },
      remove(point) {
        points.delete(point.id);
      },
      removeAll() {
        points.clear();
      },
    },
    _orbitPaths: new Map(),
    _preRenderListener: null,
    _clickHandler: null,
    _trackedEntityChangedRemove: null,
    _viewer: viewer,
    _overlayHost: { clearSource() {}, setVisible() {} },
    _catalog: new Map(),
    _points: points,
    _detectionObjects: new Map(),
    _denseIds: [],
    _denseCursor: 0,
    _denseLoadToken: 0,
    _denseStatus: 'idle',
    _denseError: null,
    _denseLoadController: null,
    _activeUpdateControllers: new Set(),
    _count: 0,
    _catalogRevision: 0,
    _scratchPropagationCartesian: new Cesium.Cartesian3(),
    _trackedFrameNumber: -1,
    _trackedFrameGeo: null,
    _trackedFrameTimeMs: null,
    _trackedFrameCartesian: new Cesium.Cartesian3(),
    _lastPropagation: Date.now(),
    _lastRingRotation: Date.now(),
    _lastFocusUpdate: 0,
    _activeFocusCount: 0,
    _trackingRefreshEpoch: 0,
  };
  const services = {
    focus: {
      clearFocusTarget() {},
      focusNowMs: (now) => now,
      getFocusTarget: () => null,
      focusPassIsNeeded: () => false,
      nearFarScalarValueAtDistance: () => 1,
      advanceSpriteFocus: () => ({ factor: 1, active: false }),
      focusAlphaNeedsWrite: () => false,
    },
    render: {
      holdContinuousRender,
      releaseContinuousRender,
      scheduleRenderUpdate,
    },
    picking: { registerPickOwner() {}, unregisterPickOwner() {} },
    layerState: { isExplicitLayerStateOrigin: () => false },
  };
  const parts = {
    orbits: {
      parseTLE: parseTleText,
      propagatePosition: (_satrec, date) => ({
        longitude: date.getTime() % 180,
        latitude: 30,
        altitude: 400_000,
      }),
      orbitFrameModelMatrix() {},
    },
    tracking: {
      _normalizeTrackedNorad: () => null,
      _cancelPendingTrackingRestore() {},
      _applyPendingTrackingRestore() {},
      _getTrackedFramePosition: () => null,
      _clearTracking() {
        state._trackedNorad = null;
      },
    },
    labels: { _syncIssOverlay() {} },
    interaction: { _installClickHandler() {}, _onKeyDown() {} },
  };
  parts.controls = createControls({ state, services, parts, source });
  parts.catalog = createCatalog({ state, services, parts, source });
  parts.rendering = createRendering({ state, services, parts, source });
  parts.lifecycle = createLifecycle({ state, services, parts, source });

  const previousDocument = globalThis.document;
  globalThis.document = { removeEventListener() {} };
  t.after(() => {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  });

  parts.lifecycle.methods.enable(viewer);
  return { viewer, listeners, state, services, parts };
}

test('first accepted dense chunk switches from the 1s timer to the continuous owner before yielding', async (t) => {
  const source = { readGroup: async () => ({ ok: true, text: TLE }) };
  const { parts, state } = createHarness(t, source);
  let sawChunkYield = false;
  const originalSetTimeout = globalThis.setTimeout;
  globalThis.setTimeout = (callback, delay, ...args) => {
    if (delay === 0) {
      sawChunkYield = true;
      assert.deepEqual(getRenderGovernorDiagnostics().holds, ['satellites']);
      assert.deepEqual(
        getRenderGovernorDiagnostics().scheduledUpdates,
        [],
        'visible dense membership must not wait for the periodic timer',
      );
    }
    return originalSetTimeout(callback, delay, ...args);
  };
  try {
    assert.equal(parts.controls.methods.setParams({ catalog: 'dense' }), true);
    const result = await state._denseLoadPromise;
    assert.deepEqual(result, { status: 'ready', added: 1 });
  } finally {
    globalThis.setTimeout = originalSetTimeout;
  }
  assert.equal(sawChunkYield, true);
  assert.deepEqual(state._denseIds, [25544]);
  assert.deepEqual(getRenderGovernorDiagnostics().holds, ['satellites']);
  assert.deepEqual(getRenderGovernorDiagnostics().scheduledUpdates, []);
});

test('the real preRender dense producer completes the existing 300-frame budget', (t) => {
  const source = { readGroup: async () => ({ ok: true, text: TLE }) };
  const { parts, state } = createHarness(t, source);
  const denseCount = DENSE_REFRESH_FRAMES * 3;
  let propagated = 0;
  parts.orbits.propagatePosition = () => {
    propagated++;
    return { longitude: propagated % 180, latitude: 30, altitude: 400_000 };
  };
  state._params.catalog = 'dense';
  state._denseIds = Array.from({ length: denseCount }, (_, index) => index + 1);
  for (const noradId of state._denseIds) {
    state._catalog.set(noradId, { group: 'dense', satrec: {} });
    state._points.set(noradId, {
      id: noradId,
      position: new Cesium.Cartesian3(),
    });
  }
  parts.lifecycle.methods.syncRenderDemand();
  assert.deepEqual(getRenderGovernorDiagnostics().holds, ['satellites']);

  for (let frame = 0; frame < DENSE_REFRESH_FRAMES; frame++)
    parts.rendering._preRenderTick();

  assert.equal(propagated, denseCount);
  assert.equal(
    state._denseCursor,
    denseCount,
    'one full round-robin pass visited the complete dense set',
  );

  parts.controls.methods.setParams({ showPoints: false });
  assert.deepEqual(getRenderGovernorDiagnostics().holds, []);
  assert.deepEqual(getRenderGovernorDiagnostics().scheduledUpdates, []);

  parts.controls.methods.setParams({ showPoints: true });
  assert.deepEqual(getRenderGovernorDiagnostics().holds, ['satellites']);
  parts.controls.methods.setParams({ catalog: 'core' });
  assert.deepEqual(getRenderGovernorDiagnostics().holds, []);
  assert.equal(getRenderGovernorDiagnostics().scheduledUpdates.length, 1);
  parts.lifecycle.methods.disable(state._viewer);
  assert.deepEqual(getRenderGovernorDiagnostics().holds, []);
  assert.deepEqual(getRenderGovernorDiagnostics().scheduledUpdates, []);
});

test('a dense fetch that settles after disable cannot recreate render demand', async (t) => {
  let resolveRead;
  const source = {
    readGroup: () =>
      new Promise((resolve) => {
        resolveRead = resolve;
      }),
  };
  const { parts, state } = createHarness(t, source);
  state._params.catalog = 'dense';
  const pendingLoad = parts.catalog._loadDenseCatalog();
  parts.lifecycle.methods.disable(state._viewer);
  resolveRead({ ok: true, text: TLE });

  assert.equal((await pendingLoad).status, 'cancelled');
  assert.deepEqual(state._denseIds, []);
  assert.deepEqual(getRenderGovernorDiagnostics().holds, []);
  assert.deepEqual(getRenderGovernorDiagnostics().scheduledUpdates, []);
});
