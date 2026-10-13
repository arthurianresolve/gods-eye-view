import test from 'node:test';
import assert from 'node:assert/strict';
import {
  holdContinuousRender,
  _resetRenderGovernorForTest,
  getRenderGovernorDiagnostics,
  installRenderGovernor,
  releaseContinuousRender,
  scheduleRenderUpdate,
} from '../../renderGovernor.js';
import { createLifecycle } from './lifecycle.js';
import { POSITION_UPDATE_MS } from './policy.js';

test('satellite periodic wake, tracking handoff and teardown use one owned schedule', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let clock = 0;
  t.mock.method(performance, 'now', () => clock);
  t.after(() => _resetRenderGovernorForTest());

  const preRenderListeners = new Set();
  let frameCount = 0;
  const viewer = {
    scene: {
      requestRenderMode: false,
      requestRender() {
        frameCount++;
        for (const listener of preRenderListeners) listener(this, clock);
      },
      preRender: {
        addEventListener(listener) {
          preRenderListeners.add(listener);
          return () => preRenderListeners.delete(listener);
        },
      },
      primitives: { remove() {} },
    },
  };
  installRenderGovernor(viewer);

  const scheduledCallbacks = [];
  const state = {
    _enabled: false,
    _trackedNorad: null,
    _trackedEntity: null,
    _params: { showPoints: true, showOrbits: true },
    _periodicRenderDisposer: null,
    _pointCollection: { show: false },
    _orbitPaths: new Map(),
    _preRenderListener: null,
    _clickHandler: null,
    _trackedEntityChangedRemove: null,
    _viewer: viewer,
    _overlayHost: {
      clearSource() {},
      setVisible() {},
    },
    _catalog: new Map(),
    _points: new Map(),
    _detectionObjects: new Map(),
    _denseIds: [],
    _denseLoadToken: 0,
    _trackingRefreshEpoch: 0,
    _activeUpdateControllers: new Set(),
  };
  const services = {
    focus: { clearFocusTarget() {} },
    render: {
      holdContinuousRender,
      releaseContinuousRender,
      scheduleRenderUpdate(owner, callback, delayMs) {
        scheduledCallbacks.push({ owner, callback, delayMs });
        return scheduleRenderUpdate(owner, callback, delayMs);
      },
    },
    picking: { registerPickOwner() {}, unregisterPickOwner() {} },
  };
  let preRenderTicks = 0;
  const parts = {
    controls: {
      satelliteVisualsVisible: (enabled, show) => enabled && show,
    },
    catalog: { _abortActiveUpdates() {} },
    interaction: {
      _installClickHandler() {},
      _onKeyDown() {},
    },
    labels: { _syncIssOverlay() {} },
    tracking: {
      _cancelPendingTrackingRestore() {},
      _applyPendingTrackingRestore() {},
      _clearTracking() {
        state._trackedNorad = null;
      },
    },
    rendering: {
      _preRenderTick() {
        preRenderTicks++;
      },
    },
  };
  const lifecycle = createLifecycle({
    state,
    services,
    parts,
    source: {},
  });

  const originalDocument = globalThis.document;
  globalThis.document = { removeEventListener() {} };
  t.after(() => {
    if (originalDocument === undefined) delete globalThis.document;
    else globalThis.document = originalDocument;
  });

  lifecycle.methods.enable(viewer);
  assert.equal(getRenderGovernorDiagnostics().scheduledUpdates.length, 1);
  assert.equal(scheduledCallbacks.at(-1).owner, 'satellites-periodic');
  assert.equal(scheduledCallbacks.at(-1).delayMs, POSITION_UPDATE_MS);
  assert.equal(preRenderListeners.size, 1);

  clock = POSITION_UPDATE_MS;
  t.mock.timers.tick(POSITION_UPDATE_MS);
  assert.equal(
    preRenderTicks,
    1,
    'the governor wake reaches the layer pre-render producer',
  );
  assert.equal(
    frameCount,
    2,
    'install settling frame plus the periodic wake frame',
  );
  assert.equal(getRenderGovernorDiagnostics().scheduledUpdates.length, 1);
  assert.equal(scheduledCallbacks.at(-1).delayMs, POSITION_UPDATE_MS);

  state._trackedNorad = 25544;
  lifecycle.methods.syncRenderDemand();
  assert.deepEqual(getRenderGovernorDiagnostics().scheduledUpdates, []);
  assert.deepEqual(getRenderGovernorDiagnostics().holds, ['satellites']);

  state._trackedNorad = null;
  lifecycle.methods.syncRenderDemand();
  assert.deepEqual(getRenderGovernorDiagnostics().holds, []);
  assert.equal(getRenderGovernorDiagnostics().scheduledUpdates.length, 1);
  const staleAfterDisable = scheduledCallbacks.at(-1).callback;

  lifecycle.methods.enable(viewer);
  assert.equal(
    preRenderListeners.size,
    1,
    'repeated enable keeps one frame listener',
  );
  assert.equal(getRenderGovernorDiagnostics().scheduledUpdates.length, 1);

  lifecycle.methods.disable(viewer);
  assert.deepEqual(getRenderGovernorDiagnostics().scheduledUpdates, []);
  assert.deepEqual(getRenderGovernorDiagnostics().holds, []);
  assert.equal(preRenderListeners.size, 0);
  staleAfterDisable();
  assert.deepEqual(
    getRenderGovernorDiagnostics().scheduledUpdates,
    [],
    'a stale due callback cannot re-arm after disable',
  );

  lifecycle.methods.enable(viewer);
  const staleAfterDestroy = scheduledCallbacks.at(-1).callback;
  lifecycle.methods.destroy(viewer);
  assert.deepEqual(getRenderGovernorDiagnostics().scheduledUpdates, []);
  assert.deepEqual(getRenderGovernorDiagnostics().holds, []);
  assert.equal(preRenderListeners.size, 0);
  staleAfterDestroy();
  assert.deepEqual(
    getRenderGovernorDiagnostics().scheduledUpdates,
    [],
    'a stale due callback cannot re-arm after destroy',
  );
});
