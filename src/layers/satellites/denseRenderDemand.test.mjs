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
import { advanceSpriteFocus } from '../../data/focusDeemphasis.js';
import { DENSE_REFRESH_FRAMES, FOCUS_UPDATE_MS } from './policy.js';

const TLE = [
  'ISS (ZARYA)',
  '1 25544U 98067A   08264.51782528 -.00002182  00000-0 -11606-4 0  2927',
  '2 25544  51.6416 247.4627 0006703 130.5360 325.0288 15.72125391563537',
].join('\n');

function createHarness(t, source) {
  const listeners = new Set();
  const primitives = new Set();
  const focusTargetListeners = new Set();
  const scheduledDelays = [];
  const executedScheduledOwners = [];
  let focusTarget = null;
  let focusFrameActive = false;
  let focusFrameTransitioning = false;
  let focusNowMs = Date.now();
  const viewer = {
    scene: {
      requestRenderMode: true,
      requestRender() {
        for (const listener of [...listeners]) listener(this);
      },
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
    _focusRenderDisposer: null,
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
    _focusTransitioning: false,
    _focusPassPending: false,
    _trackingRefreshEpoch: 0,
  };
  const services = {
    focus: {
      clearFocusTarget() {},
      focusNowMs: () => focusNowMs,
      getFocusTarget: () => focusTarget,
      onFocusTargetChange(listener) {
        focusTargetListeners.add(listener);
        return () => focusTargetListeners.delete(listener);
      },
      focusPassIsNeeded: (target, activeCount) =>
        target !== null || activeCount > 0,
      nearFarScalarValueAtDistance: () => 1,
      advanceSpriteFocus: () => ({
        factor: 1,
        active: focusFrameActive,
        transitioning: focusFrameTransitioning,
        endpointCompleted: !focusFrameTransitioning,
      }),
      focusAlphaNeedsWrite: () => false,
    },
    render: {
      holdContinuousRender,
      releaseContinuousRender,
      scheduleRenderUpdate(owner, callback, delayMs) {
        const ownerLabel =
          typeof owner === 'symbol' ? owner.description : owner;
        scheduledDelays.push({ owner: ownerLabel, delayMs });
        return scheduleRenderUpdate(
          owner,
          () => {
            executedScheduledOwners.push(ownerLabel);
            callback();
          },
          delayMs,
        );
      },
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
  return {
    viewer,
    listeners,
    state,
    services,
    parts,
    scheduledDelays,
    executedScheduledOwners,
    setFocusFrameActive(value) {
      focusFrameActive = value;
    },
    setFocusFrameTransitioning(value) {
      focusFrameTransitioning = value;
    },
    setFocusNowMs(value) {
      focusNowMs = value;
    },
    setFocusTarget(next) {
      const previous = focusTarget;
      focusTarget = next;
      for (const listener of focusTargetListeners) listener(next, previous);
    },
    focusTargetListeners,
  };
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

test('shared focus fading wakes at 80ms and returns to the static cadence when settled', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let performanceNow = 1_000;
  t.mock.method(performance, 'now', () => performanceNow);
  const source = { readGroup: async () => ({ ok: true, text: TLE }) };
  const harness = createHarness(t, source);
  const { parts, state } = harness;
  harness.setFocusNowMs(performanceNow);
  const advance = (milliseconds) => {
    performanceNow += milliseconds;
    harness.setFocusNowMs(performanceNow);
    t.mock.timers.tick(milliseconds);
  };
  const lastDelayFor = (owner) =>
    [...harness.scheduledDelays]
      .reverse()
      .find((scheduled) => scheduled.owner === owner)?.delayMs;
  state._points.set(25544, {
    id: 25544,
    position: new Cesium.Cartesian3(1, 2, 3),
    show: false,
    pixelSize: 5,
  });
  state._catalog.set(25544, { group: 'visual' });

  const focusSprite = {};
  const initialDim = advanceSpriteFocus(focusSprite, {
    screenPosition: { x: 0, y: 0 },
    cameraDistance: 2_000,
    target: {
      screenRect: { left: -10, right: 10, top: -10, bottom: 10 },
      cameraDistance: 1_000,
    },
    nowMs: 1_000,
    params: { nearerBehavior: 'dim', attackMs: 300 },
  });
  assert.equal(initialDim.active, true);
  assert.equal(initialDim.transitioning, true);
  const settledDim = advanceSpriteFocus(focusSprite, {
    screenPosition: { x: 0, y: 0 },
    cameraDistance: 2_000,
    target: {
      screenRect: { left: -10, right: 10, top: -10, bottom: 10 },
      cameraDistance: 1_000,
    },
    nowMs: 1_300,
    params: { nearerBehavior: 'dim', attackMs: 300 },
  });
  assert.equal(settledDim.active, true);
  assert.equal(settledDim.transitioning, false);
  state._activeFocusCount = 1;
  state._focusTransitioning = false;
  parts.lifecycle.methods.syncRenderDemand();
  assert.deepEqual(getRenderGovernorDiagnostics().scheduledUpdates, [
    'satellites-periodic',
  ]);
  state._activeFocusCount = 0;

  advance(950);
  state._lastFocusUpdate = performanceNow - 50;

  harness.setFocusFrameActive(true);
  harness.setFocusFrameTransitioning(true);
  harness.setFocusTarget({ ownerLayer: 'flights', id: 'fixture-aircraft' });
  assert.equal(lastDelayFor('satellites-focus'), 0);
  assert.equal(
    parts.lifecycle.methods.getPerformanceDiagnostics().listeners,
    2,
  );
  advance(0);
  assert.equal(
    state._activeFocusCount,
    0,
    'the existing 80ms focus gate can defer the immediate wake',
  );
  assert.equal(lastDelayFor('satellites-focus'), FOCUS_UPDATE_MS);
  assert.deepEqual(getRenderGovernorDiagnostics().scheduledUpdates, [
    'satellites-focus',
    'satellites-periodic',
  ]);
  for (let index = 0; index < 5; index += 1)
    parts.lifecycle.methods.syncRenderDemand();
  assert.deepEqual(
    getRenderGovernorDiagnostics().scheduledUpdates,
    ['satellites-focus', 'satellites-periodic'],
    'repeated sync preserves both independent due times and the pending focus pass',
  );
  advance(50);
  assert.ok(
    harness.executedScheduledOwners.includes('satellites-periodic'),
    'the original core deadline fires despite the earlier focus wake',
  );
  assert.equal(state._activeFocusCount, 1);
  assert.equal(lastDelayFor('satellites-focus'), FOCUS_UPDATE_MS);
  assert.deepEqual(getRenderGovernorDiagnostics().holds, []);

  state._denseIds = [100];
  parts.lifecycle.methods.syncRenderDemand();
  assert.deepEqual(getRenderGovernorDiagnostics().holds, ['satellites']);
  assert.deepEqual(getRenderGovernorDiagnostics().scheduledUpdates, []);
  state._denseIds = [];
  parts.lifecycle.methods.syncRenderDemand();
  assert.deepEqual(getRenderGovernorDiagnostics().holds, []);
  assert.deepEqual(getRenderGovernorDiagnostics().scheduledUpdates, [
    'satellites-focus',
    'satellites-periodic',
  ]);

  state._trackedNorad = 25544;
  parts.lifecycle.methods.syncRenderDemand();
  assert.deepEqual(getRenderGovernorDiagnostics().holds, ['satellites']);
  assert.deepEqual(getRenderGovernorDiagnostics().scheduledUpdates, []);
  state._trackedNorad = null;
  parts.lifecycle.methods.syncRenderDemand();
  assert.deepEqual(getRenderGovernorDiagnostics().holds, []);
  assert.deepEqual(getRenderGovernorDiagnostics().scheduledUpdates, [
    'satellites-focus',
    'satellites-periodic',
  ]);

  advance(30);
  harness.setFocusTarget(null);
  assert.equal(lastDelayFor('satellites-focus'), 0);
  advance(0);
  assert.equal(state._activeFocusCount, 1, 'the fade tail remains owned');

  harness.setFocusFrameActive(false);
  harness.setFocusFrameTransitioning(false);
  advance(FOCUS_UPDATE_MS);
  assert.equal(state._activeFocusCount, 0);
  assert.deepEqual(getRenderGovernorDiagnostics().scheduledUpdates, [
    'satellites-periodic',
  ]);
  assert.deepEqual(getRenderGovernorDiagnostics().holds, []);

  parts.lifecycle.methods.disable(state._viewer);
  assert.equal(harness.focusTargetListeners.size, 0);
  assert.equal(
    parts.lifecycle.methods.getPerformanceDiagnostics().listeners,
    0,
  );
  assert.deepEqual(getRenderGovernorDiagnostics().scheduledUpdates, []);
  const schedulesAfterDisable = harness.scheduledDelays.length;
  harness.setFocusTarget({ ownerLayer: 'flights', id: 'late-target' });
  assert.equal(
    harness.scheduledDelays.length,
    schedulesAfterDisable,
    'a late shared focus notification cannot schedule after disable',
  );

  parts.lifecycle.methods.enable(state._viewer);
  assert.equal(harness.focusTargetListeners.size, 1);
  harness.setFocusTarget({ ownerLayer: 'flights', id: 'destroy-target' });
  assert.equal(lastDelayFor('satellites-focus'), 0);
  parts.lifecycle.methods.destroy(state._viewer);
  assert.equal(harness.focusTargetListeners.size, 0);
  assert.equal(
    parts.lifecycle.methods.getPerformanceDiagnostics().listeners,
    0,
  );
  assert.deepEqual(getRenderGovernorDiagnostics().scheduledUpdates, []);
  const schedulesAfterDestroy = harness.scheduledDelays.length;
  harness.setFocusTarget(null);
  assert.equal(
    harness.scheduledDelays.length,
    schedulesAfterDestroy,
    'a late shared focus notification cannot schedule after destroy',
  );
});

test('a throttled focus pass retires when its points disappear before the target clears', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let performanceNow = 1_000;
  t.mock.method(performance, 'now', () => performanceNow);
  const harness = createHarness(t, {
    readGroup: async () => ({ ok: true, text: TLE }),
  });
  const { parts, state } = harness;
  harness.setFocusNowMs(performanceNow);
  state._points.set(25544, {
    id: 25544,
    position: new Cesium.Cartesian3(1, 2, 3),
  });
  state._catalog.set(25544, { group: 'visual' });
  state._lastFocusUpdate = performanceNow - 50;

  harness.setFocusTarget({ ownerLayer: 'flights', id: 'temporary-target' });
  t.mock.timers.tick(0);
  assert.equal(
    state._focusPassPending,
    true,
    'the 80ms throttle keeps the requested pass pending',
  );
  assert.deepEqual(getRenderGovernorDiagnostics().scheduledUpdates, [
    'satellites-focus',
    'satellites-periodic',
  ]);

  state._points.clear();
  state._catalog.clear();
  parts.lifecycle.methods.syncRenderDemand();
  assert.equal(state._focusPassPending, false);
  assert.equal(state._focusTransitioning, false);
  assert.deepEqual(getRenderGovernorDiagnostics().scheduledUpdates, [
    'satellites-periodic',
  ]);

  harness.setFocusTarget(null);
  state._points.set(25544, {
    id: 25544,
    position: new Cesium.Cartesian3(1, 2, 3),
  });
  state._catalog.set(25544, { group: 'visual' });
  parts.lifecycle.methods.syncRenderDemand();
  assert.equal(state._focusPassPending, false);
  assert.equal(state._focusTransitioning, false);
  assert.deepEqual(
    getRenderGovernorDiagnostics().scheduledUpdates,
    ['satellites-periodic'],
    'restored points do not inherit a stale 80ms retry',
  );

  parts.lifecycle.methods.disable(state._viewer);
  assert.deepEqual(getRenderGovernorDiagnostics().scheduledUpdates, []);
});
