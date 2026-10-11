import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createFleetRenderDemand,
  createFleetTickCallback,
} from './fleetRenderDemand.js';
import { createLifecycle as createFlightLifecycle } from './flights/lifecycle.js';
import { createLifecycle as createMilitaryLifecycle } from './military/lifecycle.js';
import { FLEET_DR_INTERVAL_MS as FLIGHT_INTERVAL_MS } from './flights/policy.js';
import { FLEET_DR_INTERVAL_MS as MILITARY_INTERVAL_MS } from './military/policy.js';
import { createIngestion as createFlightIngestion } from './flights/ingestion.js';
import { createIngestion as createMilitaryIngestion } from './military/ingestion.js';
import { createTracking as createFlightTracking } from './flights/tracking.js';

function fixture({ withScheduler = true } = {}) {
  const held = [];
  const released = [];
  const scheduled = [];
  const requests = [];
  const render = {
    holdContinuousRender(owner) {
      held.push(owner);
    },
    releaseContinuousRender(owner) {
      released.push(owner);
    },
    governorRequestRender(reason) {
      requests.push(reason);
    },
  };
  if (withScheduler) {
    render.scheduleRenderUpdate = (owner, callback, delayMs) => {
      const update = { owner, callback, delayMs, cancelled: false };
      scheduled.push(update);
      return () => {
        update.cancelled = true;
      };
    };
  }
  let enabled = false;
  let tracked = false;
  let eligible = true;
  let remaining = null;
  const demand = createFleetRenderDemand(render, {
    owner: 'fixture-fleet',
    intervalMs: 80,
    isEnabled: () => enabled && (eligible || tracked),
    isTracked: () => tracked,
    remainingDelayMs: () => remaining,
  });
  return {
    demand,
    held,
    released,
    scheduled,
    requests,
    setEnabled(value) {
      enabled = value;
      demand.setEnabled(value);
    },
    setTracked(value) {
      tracked = value;
      demand.sync();
    },
    setEligible(value, { sync = true } = {}) {
      eligible = value;
      if (sync) demand.sync();
    },
    setRemaining(value) {
      remaining = value;
    },
  };
}

test('an enabled empty fleet gets one final frame but no periodic wakes', () => {
  const f = fixture();
  f.setEligible(false);
  f.setEnabled(true);
  assert.equal(f.held.length, 0);
  assert.equal(f.scheduled.length, 0);

  f.demand.invalidate();
  const finalWake = f.scheduled.at(-1);
  assert.equal(finalWake.delayMs, 0);
  finalWake.callback();
  assert.equal(f.scheduled.length, 1, 'empty final frame does not re-arm');

  f.setEligible(true);
  const arrivalWake = f.scheduled.at(-1);
  assert.notEqual(arrivalWake, finalWake);
  assert.equal(arrivalWake.delayMs, 0);
  arrivalWake.callback();
  assert.equal(f.scheduled.at(-1).delayMs, 80);

  const pendingPeriodicWake = f.scheduled.at(-1);
  f.setEligible(false, { sync: false });
  f.demand.noteFrame();
  assert.equal(pendingPeriodicWake.cancelled, true);
  f.demand.invalidate();
  const removalFrame = f.scheduled.at(-1);
  assert.equal(removalFrame.delayMs, 0);
  removalFrame.callback();
  assert.equal(f.scheduled.at(-1), removalFrame);

  f.setTracked(true);
  assert.equal(f.held.length, 1, 'tracking retains continuous rendering');
  const wakeCountBeforeUntrack = f.scheduled.length;
  f.setTracked(false);
  assert.equal(f.released.length, 1);
  assert.equal(
    f.scheduled.length,
    wakeCountBeforeUntrack,
    'untracking an empty fleet does not reuse an already-fired wake',
  );
  f.setEnabled(false);
});

test('legacy continuous mode requests one final frame when the last item leaves', () => {
  const f = fixture({ withScheduler: false });
  f.setEnabled(true);
  assert.equal(f.held.length, 1);

  f.setEligible(false);
  assert.equal(f.released.length, 1);
  assert.equal(f.scheduled.length, 0);
  f.demand.invalidate();

  assert.deepEqual(f.requests, ['fleet-discrete-invalidation']);
  assert.equal(f.held.length, 1);
  assert.equal(f.released.length, 1);

  f.setEligible(true);
  assert.equal(f.held.length, 2, 'new data reacquires the compatibility hold');
  assert.equal(f.requests.length, 1);
  f.setEnabled(false);
  assert.equal(f.released.length, 2);
});

test('military suppression requests a final frame when it removes the last civil sprite', () => {
  const sprite = { id: 'military-fixture' };
  let removed = null;
  let fleetTickRequests = 0;
  const flightState = {
    _viewer: {},
    _billboardCollection: {
      show: true,
      remove(value) {
        removed = value;
      },
    },
    _billboards: new Map([['military-fixture', sprite]]),
    _trackedIcao: null,
    _cullPositions: new Map([['military-fixture', {}]]),
    _positionHistory: new Map([['military-fixture', []]]),
    _displayCourse: new Map([['military-fixture', 0]]),
    records: {
      data: new Map([['military-fixture', {}]]),
      missingPolls: new Map([['military-fixture', 0]]),
    },
    feed: { _count: 1 },
    _groundSnap: { forget() {} },
  };
  const services = {
    context: {},
    aircraftPresentation: {},
    trails: {},
    geoid: {},
    groundFloor: {},
    focus: {},
    militaryRegistry: {
      isMilitaryIcao: () => true,
    },
    readout: {},
    camera: {},
    picking: {},
  };
  const parts = {
    rendering: { _releaseModel() {} },
    lifecycle: {
      methods: {
        requestFleetTick() {
          fleetTickRequests += 1;
        },
      },
    },
  };
  const tracking = createFlightTracking({
    flightState,
    services,
    parts,
    layer: {},
    resolveAsset: (url) => url,
  });

  tracking._onMilitaryActiveChange(true);

  assert.equal(removed, sprite);
  assert.equal(flightState._billboards.size, 0);
  assert.equal(flightState.feed._count, 0);
  assert.equal(fleetTickRequests, 1);
});

test('untracked fleet schedules an immediate wake and retains the 80 ms tick deadline', () => {
  const state = { _lastFleetTickMs: 0 };
  let tickCount = 0;
  let nextTickValue = null;
  const f = fixture();
  f.setEnabled(true);
  assert.equal(f.held.length, 0);
  assert.equal(f.scheduled.length, 1);
  assert.equal(f.scheduled[0].delayMs, 0);

  f.scheduled[0].callback();
  assert.equal(f.scheduled.length, 2);
  assert.equal(f.scheduled[1].delayMs, 80);
  const scheduledBeforeThrottledFrame = f.scheduled.length;
  const tick = createFleetTickCallback({
    state,
    demand: f.demand,
    rendering: {
      _fleetTick() {
        tickCount += 1;
        if (nextTickValue !== null) state._lastFleetTickMs = nextTickValue;
      },
    },
  });
  tick();
  assert.equal(tickCount, 1);
  assert.equal(f.scheduled.length, scheduledBeforeThrottledFrame);

  nextTickValue = 80;
  tick();
  assert.equal(f.scheduled.at(-1).delayMs, 80);
  assert.equal(f.scheduled[1].cancelled, true);
});

test('tracking acquires continuous ownership and untracking returns to scheduled cadence', () => {
  const f = fixture();
  f.setEnabled(true);
  const pendingWake = f.scheduled[0];

  f.setTracked(true);
  assert.equal(pendingWake.cancelled, true);
  assert.equal(f.held.length, 1);

  f.setTracked(false);
  assert.equal(f.released.length, 1);
  assert.equal(f.scheduled.at(-1).delayMs, 0);

  f.setTracked(true);
  assert.equal(f.held.length, 2);
  assert.equal(f.held[0], f.held[1], 'the owner identity stays stable');
  f.setEnabled(false);
  assert.equal(f.released.length, 2);
  assert.equal(f.scheduled.at(-1).cancelled, true);
});

test('disable and destroy cancel delayed callbacks without a late wake', () => {
  const f = fixture();
  f.setEnabled(true);
  f.scheduled[0].callback();
  const delayedWake = f.scheduled.at(-1);
  f.setEnabled(false);
  assert.equal(delayedWake.cancelled, true);
  const countAfterDisable = f.scheduled.length;
  delayedWake.callback();
  assert.equal(f.scheduled.length, countAfterDisable);

  f.setEnabled(true);
  const immediateWake = f.scheduled.at(-1);
  f.demand.dispose();
  assert.equal(immediateWake.cancelled, true);
  const countAfterDestroy = f.scheduled.length;
  immediateWake.callback();
  assert.equal(f.scheduled.length, countAfterDestroy);
  assert.equal(f.held.length, f.released.length);
});

test('a canceled callback cannot replace the active wake in the same lifetime', () => {
  const f = fixture();
  f.setEnabled(true);
  const canceledWake = f.scheduled[0];
  f.demand.invalidate();
  const currentWake = f.scheduled.at(-1);
  assert.notEqual(currentWake, canceledWake);
  assert.equal(canceledWake.cancelled, true);

  const countBeforeLateCallback = f.scheduled.length;
  canceledWake.callback();
  assert.equal(
    f.scheduled.length,
    countBeforeLateCallback,
    'a canceled same-owner wake must not schedule a duplicate deadline',
  );

  currentWake.callback();
  assert.equal(f.scheduled.at(-1).delayMs, 80);
});

test('without the scheduler, the compatibility path holds rendering while enabled', () => {
  const f = fixture({ withScheduler: false });
  f.setEnabled(true);
  assert.equal(f.held.length, 1);
  assert.equal(f.scheduled.length, 0);
  f.setEnabled(false);
  assert.equal(f.released.length, 1);
});

test('an early scheduled callback uses the remaining fleet deadline', () => {
  const f = fixture();
  f.setEnabled(true);
  f.setRemaining(3);
  f.scheduled[0].callback();
  assert.equal(f.scheduled[1].delayMs, 3);
});

test('a completed fleet tick schedules from its sampled start, including work time', () => {
  const f = fixture();
  let nowMs = 100;
  const state = { _lastFleetTickMs: 0 };
  f.setEnabled(true);
  f.scheduled[0].callback();
  const fallbackWake = f.scheduled.at(-1);
  const tick = createFleetTickCallback({
    state,
    demand: f.demand,
    rendering: {
      _fleetTick() {
        state._lastFleetTickMs = nowMs;
        nowMs += 12;
        f.setRemaining(80 - (nowMs - state._lastFleetTickMs));
      },
    },
  });

  tick();

  assert.equal(fallbackWake.cancelled, true);
  assert.equal(
    f.scheduled.at(-1).delayMs,
    68,
    'the 12 ms spent in the tick overlaps the 80 ms cadence',
  );
});

test('a due tick schedules immediately and invalid deadline samples fall back safely', () => {
  const f = fixture();
  f.setEnabled(true);
  for (const [remaining, expected] of [
    [0, 0],
    [-5, 0],
    [Number.NaN, 80],
    [Number.POSITIVE_INFINITY, 80],
    [1000, 80],
  ]) {
    f.setRemaining(remaining);
    f.demand.noteFrame();
    assert.equal(f.scheduled.at(-1).delayMs, expected);
  }
});

for (const [name, createIngestion] of [
  ['civil', createFlightIngestion],
  ['military', createMilitaryIngestion],
]) {
  test(`${name} accepted feed refresh requests a fleet frame after publication`, async () => {
    const order = [];
    const feed = {
      _source: {
        label: 'Fixture',
        getSnapshot: async () => ({
          records: [],
          source: 'Fixture',
          coverage: 'fixture',
          observedAtMs: 1234,
          freshness: 'current',
        }),
      },
      _lastSource: 'Fixture',
      _lastCoverage: 'fixture',
      _activeUpdateControllers: new Set(),
      _trackingRefreshEpoch: 0,
      _retryAt: 0,
    };
    const ingestion = createIngestion({
      feed,
      getQuery: () => ({}),
      applySnapshot: () => {
        order.push('publish');
        return { count: 0, ids: new Set() };
      },
      setSourceLabel() {},
      applyPendingTrackingRestore: () => order.push('restore'),
      requestFleetTick: () => order.push('wake'),
    }).methods;
    await ingestion.update(null);
    assert.deepEqual(order, ['publish', 'wake', 'restore']);
    assert.equal(feed._lastTrackingRefreshOutcome.status, 'accepted');
    assert.equal(feed._activeUpdateControllers.size, 0);
  });
}

test('destroy and re-init create a fresh owner; stale callbacks stay inert', () => {
  const originalDocument = Object.getOwnPropertyDescriptor(
    globalThis,
    'document',
  );
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  globalThis.document = {
    body: { classList: { contains: () => false } },
    removeEventListener() {},
  };
  globalThis.window = {
    addEventListener() {},
    removeEventListener() {},
  };
  const scheduled = [];
  const primitiveAdds = [];
  const primitiveRemoves = [];
  const render = {
    holdContinuousRender() {},
    releaseContinuousRender() {},
    governorRequestRender() {},
    scheduleRenderUpdate(owner, callback, delayMs) {
      const item = { owner, callback, delayMs, cancelled: false };
      scheduled.push(item);
      return () => {
        item.cancelled = true;
      };
    },
  };
  const state = {
    lifetime: new AbortController(),
    feed: {
      _source: { label: 'Fixture', getSnapshot: async () => ({ records: [] }) },
      _lastSource: 'Fixture',
      _trackingRefreshEpoch: 0,
      _lastCoverage: 'fixture',
    },
    records: {
      geoidReady: true,
      data: new Map(),
      missingPolls: new Map(),
    },
    _focusEvidenceIds: new Set(),
    _cullPositions: new Map(),
    _positionHistory: new Map(),
    _displayCourse: new Map(),
    _groundSnap: new Map(),
    _displayFloorState: new Map(),
    _enrichQueue: [],
    _enrichSeen: new Set(),
    _modelPending: new Set(),
    _modelGen: new Map(),
    _billboards: new Map(),
    _detectionObjects: new Map(),
    _cockpitNearContacts: new Set(),
    _lastFleetTickMs: 0,
    _modelEpoch: 0,
  };
  let preRenderCallback = null;
  let preUpdateCallback = null;
  const viewer = {
    scene: {
      primitives: {
        add(value) {
          primitiveAdds.push(value);
          return value;
        },
        remove(value) {
          primitiveRemoves.push(value);
          return true;
        },
      },
      preRender: {
        addEventListener(callback) {
          preRenderCallback = callback;
          return () => {
            preRenderCallback = null;
          };
        },
      },
      preUpdate: {
        addEventListener(callback) {
          preUpdateCallback = callback;
          return () => {
            preUpdateCallback = null;
          };
        },
      },
    },
    camera: {
      moveEnd: { addEventListener: () => () => {} },
    },
  };
  const services = {
    focus: { clearFocusTarget() {} },
    sprites: {
      registerSpriteCollection() {},
      restoreSpriteOrder() {},
      restoreSpriteOrderOnEnable() {},
    },
    militaryRegistry: {
      onMilitaryLayerActiveChange: () => () => {},
    },
    render,
    geoid: { ensureGeoidReady: async () => {} },
    picking: {
      registerPickOwner() {},
      unregisterPickOwner() {},
    },
  };
  const parts = {
    controller: { _abortActiveUpdates() {} },
    enrichment: { _ambientBudgetKnobs: () => ({ ceil: 1 }) },
    rendering: {
      _fleetTick() {
        state._lastFleetTickMs = Date.now();
      },
      _updateTrackedModel() {},
      _releaseModels() {},
    },
    tracking: {
      _resetTrackedSelectionState() {},
      _installClickHandler() {},
      _setCockpitContactMode() {},
      _cancelPendingTrackingRestore() {},
      _clearTracking() {
        state._trackedIcao = null;
      },
      _destroyTrail() {},
      _onKeyDown() {},
      _onMilitaryActiveChange() {},
    },
  };
  try {
    const lifecycle = createFlightLifecycle({
      flightState: state,
      services,
      parts,
      layer: {},
      resolveAsset: () => 'missing-fixture-model.glb',
    }).methods;

    lifecycle.init(viewer);
    state._billboards.set('fixture', {});
    lifecycle.enable(viewer);
    const oldWake = scheduled.at(-1);
    const oldOwner = oldWake.owner;
    lifecycle.destroy(viewer);
    assert.ok(oldWake.cancelled, 'destroy cancels its scheduled callback');

    lifecycle.init(viewer);
    state._billboards.set('fixture', {});
    lifecycle.enable(viewer);
    const newWake = scheduled.at(-1);
    assert.notEqual(newWake.owner, oldOwner, 're-init receives a new owner');
    const countBeforeStaleCallback = scheduled.length;
    oldWake.callback();
    assert.equal(
      scheduled.length,
      countBeforeStaleCallback,
      'a late callback from the destroyed lifetime cannot schedule work',
    );
    newWake.callback();
    assert.equal(scheduled.at(-1).owner, newWake.owner);
    assert.equal(scheduled.at(-1).delayMs, FLIGHT_INTERVAL_MS);

    lifecycle.destroy(viewer);
    assert.doesNotThrow(
      () => lifecycle.disable(viewer),
      'disable after destroy is safe when the demand owner is already disposed',
    );
    assert.equal(preRenderCallback, null);
    assert.equal(preUpdateCallback, null);
    assert.equal(primitiveAdds.length, 4);
    assert.equal(primitiveRemoves.length, 4);
  } finally {
    if (originalDocument) {
      Object.defineProperty(globalThis, 'document', originalDocument);
    } else {
      delete globalThis.document;
    }
    if (originalWindow) {
      Object.defineProperty(globalThis, 'window', originalWindow);
    } else {
      delete globalThis.window;
    }
  }
});

for (const [name, createLifecycle, intervalMs] of [
  ['civil flights', createFlightLifecycle, FLIGHT_INTERVAL_MS],
  ['military flights', createMilitaryLifecycle, MILITARY_INTERVAL_MS],
]) {
  test(`${name} lifecycle wires preRender ticks to bounded demand and tracked ownership`, () => {
    const originalDocument = Object.getOwnPropertyDescriptor(
      globalThis,
      'document',
    );
    globalThis.document = {
      body: { classList: { contains: () => false } },
      removeEventListener() {},
    };
    const scheduled = [];
    const held = [];
    const released = [];
    let preRender;
    let preUpdate;
    let renderRequests = 0;
    let logicalNowMs = 100;
    const state = {
      _lastFleetTickMs: 0,
      _billboards: new Map([['fixture', {}]]),
      _trackedIcao: null,
      _billboardCollection: { show: false },
      _modelCollection: { show: false },
      _preRenderRemove: null,
      _trackedModelPreUpdateRemove: null,
      _moveEndRemove: null,
      _clickHandler: null,
      _trackedEntityChangedRemove: null,
      _cockpitContactMode: false,
      records: { geoidReady: true },
    };
    const services = {
      focus: {
        clearFocusTarget() {},
        focusNowMs(nowMs) {
          return logicalNowMs ?? nowMs;
        },
      },
      sprites: {
        restoreSpriteOrderOnEnable() {},
        restoreSpriteOrder() {},
      },
      militaryRegistry: {
        onMilitaryLayerActiveChange: () => () => {},
        setMilitaryLayerActive() {},
      },
      render: {
        holdContinuousRender(owner) {
          held.push(owner);
        },
        releaseContinuousRender(owner) {
          released.push(owner);
        },
        governorRequestRender() {
          renderRequests += 1;
        },
        scheduleRenderUpdate(owner, callback, delayMs) {
          const item = { owner, callback, delayMs, cancelled: false };
          scheduled.push(item);
          return () => {
            item.cancelled = true;
          };
        },
      },
      geoid: { ensureGeoidReady: async () => {} },
      picking: {
        registerPickOwner() {},
        unregisterPickOwner() {},
      },
    };
    const parts = {
      controller: { _abortActiveUpdates() {} },
      rendering: {
        _fleetTick() {
          state._lastFleetTickMs = logicalNowMs;
        },
        _updateTrackedModel() {},
        _releaseModels() {},
      },
      tracking: {
        _setCockpitContactMode() {},
        _installClickHandler() {},
        _cancelPendingTrackingRestore() {},
        _clearTracking() {
          state._trackedIcao = null;
        },
        _destroyTrail() {},
        _onKeyDown() {},
      },
    };
    const viewer = {
      scene: {
        preRender: {
          addEventListener(callback) {
            preRender = callback;
            return () => {
              preRender = null;
            };
          },
        },
        preUpdate: {
          addEventListener(callback) {
            preUpdate = callback;
            return () => {
              preUpdate = null;
            };
          },
        },
      },
      camera: {
        moveEnd: {
          addEventListener() {
            return () => {};
          },
        },
      },
    };
    try {
      const lifecycle = createLifecycle({
        flightState: state,
        services,
        parts,
        layer: {},
        resolveAsset: (url) => url,
      }).methods;
      lifecycle.enable(viewer);
      assert.equal(scheduled[0].delayMs, 0);
      scheduled[0].callback();
      assert.equal(scheduled[1].delayMs, intervalMs);
      logicalNowMs = 120;
      preRender();
      assert.equal(scheduled[1].cancelled, true);
      assert.equal(scheduled.at(-1).delayMs, intervalMs);
      logicalNowMs = 150;
      scheduled.at(-1).callback();
      assert.equal(
        scheduled.at(-1).delayMs,
        intervalMs - 30,
        'an early wake uses the same logical clock as the fleet tick',
      );

      const periodicWake = scheduled.at(-1);
      state._billboards.clear();
      lifecycle.requestFleetTick();
      assert.equal(periodicWake.cancelled, true);
      const removalFrame = scheduled.at(-1);
      assert.equal(removalFrame.delayMs, 0);
      removalFrame.callback();
      assert.equal(
        scheduled.at(-1),
        removalFrame,
        'removing the last item leaves one final frame and stops periodic wakes',
      );

      state._billboards.set('fixture', {});
      lifecycle.requestFleetTick();
      const arrivalFrame = scheduled.at(-1);
      assert.equal(arrivalFrame.delayMs, 0);
      arrivalFrame.callback();
      assert.equal(
        scheduled.at(-1).delayMs,
        intervalMs - 30,
        'a repopulated fleet returns to the remaining tick deadline',
      );

      state._trackedIcao = 'fixture';
      lifecycle.syncRenderDemand();
      assert.equal(held.length, 1);
      state._trackedIcao = null;
      lifecycle.syncRenderDemand();
      assert.equal(released.length, 1);
      assert.equal(scheduled.at(-1).delayMs, 0);

      lifecycle.disable(viewer);
      assert.equal(preRender, null);
      assert.equal(preUpdate, null);
      assert.ok(renderRequests > 0, 'disable publishes its final hidden frame');
      assert.equal(scheduled.at(-1).cancelled, true);
    } finally {
      if (originalDocument) {
        Object.defineProperty(globalThis, 'document', originalDocument);
      } else {
        delete globalThis.document;
      }
    }
  });
}
