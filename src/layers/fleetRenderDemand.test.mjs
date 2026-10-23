import test from 'node:test';
import assert from 'node:assert/strict';
import {
  hasFleetRenderDemand,
  syncFleetRenderDemand,
} from './fleetRenderDemand.js';
import { createLifecycle as createFlightLifecycle } from './flights/lifecycle.js';
import { createLifecycle as createMilitaryLifecycle } from './military/lifecycle.js';

function renderProbe() {
  const holds = new Set();
  return {
    holds,
    holdContinuousRender(owner) {
      holds.add(owner);
    },
    releaseContinuousRender(owner) {
      holds.delete(owner);
    },
  };
}

test('empty civil and military fleets do not retain continuous-render holds', () => {
  for (const owner of ['flights', 'military']) {
    const render = renderProbe();
    const flightState = {
      _billboards: new Map(),
      _models: new Map(),
      _trackedEntity: null,
      _trackedModel: null,
      _trailHeadEntity: null,
    };

    assert.equal(hasFleetRenderDemand(flightState), false);
    assert.equal(
      syncFleetRenderDemand({ flightState, render, owner, enabled: true }),
      false,
    );
    assert.equal(render.holds.has(owner), false);
  }
});

test('snapshot membership changes release an empty hold and retain active fleet animation', () => {
  const render = renderProbe();
  const flightState = { _billboards: new Map(), _models: new Map() };
  const sync = (enabled = true) =>
    syncFleetRenderDemand({ flightState, render, owner: 'flights', enabled });

  assert.equal(sync(), false);
  flightState._billboards.set('abc123', {});
  assert.equal(sync(), true);
  assert.equal(render.holds.has('flights'), true);

  flightState._billboards.clear();
  assert.equal(sync(), false);
  assert.equal(render.holds.has('flights'), false);

  flightState._trackedEntity = {};
  assert.equal(sync(), true, 'tracking remains animated without a billboard');
  flightState._trackedEntity = null;
  flightState._trackedModel = {};
  assert.equal(sync(), true, 'a tracked model also needs fleet frames');
  flightState._trackedModel = null;
  flightState._trailHeadEntity = {};
  assert.equal(sync(), true, 'the live trail head is per-frame driven');
});

test('disable and destroy reconciliation release active visuals; re-enable reacquires them', () => {
  const render = renderProbe();
  const flightState = { _billboards: new Map([['abc123', {}]]) };
  const sync = (enabled) =>
    syncFleetRenderDemand({ flightState, render, owner: 'military', enabled });

  assert.equal(sync(true), true);
  assert.equal(
    sync(false),
    false,
    'disable releases despite retained snapshot data',
  );
  assert.equal(render.holds.has('military'), false);
  assert.equal(sync(true), true, 're-enable resumes needed interpolation');
  flightState._billboards.clear();
  assert.equal(
    sync(true),
    false,
    'empty accepted membership releases the hold',
  );
  assert.equal(sync(false), false, 'destroy cleanup is idempotent');
  assert.equal(render.holds.size, 0);
});

function lifecycleHarness(createLifecycle, owner, military = false) {
  const events = [];
  const render = {
    holdContinuousRender(id) {
      events.push(['hold', id]);
    },
    releaseContinuousRender(id) {
      events.push(['release', id]);
    },
  };
  const collection = () => ({ show: false });
  const flightState = {
    lifetime: new AbortController(),
    records: {
      geoidReady: true,
      data: new Map(),
      missingPolls: new Map(),
    },
    feed: { _trackingRefreshEpoch: 0 },
    _billboardCollection: collection(),
    _modelCollection: collection(),
    _billboards: new Map(),
    _models: new Map(),
    _modelPending: new Set(),
    _modelGen: new Map(),
    _preloadModel: null,
    _modelEpoch: 0,
    _cullPositions: new Map(),
    _detectionObjects: new Map(),
    _positionHistory: new Map(),
    _displayCourse: new Map(),
    _groundSnap: { clear() {}, forget() {} },
    _displayFloorState: new Map(),
    _enrichQueue: [],
    _enrichSeen: new Set(),
    _focusEvidenceIds: new Set(),
    _cockpitNearContacts: new Set(),
    _preRenderRemove: null,
    _trackedModelPreUpdateRemove: null,
    _moveEndRemove: null,
    _clickHandler: null,
    _trackedEntityChangedRemove: null,
    _milActiveChangeUnsub: null,
    _cockpitModeListener: null,
    _enrichDripTimer: null,
    _trackedModel: null,
    _trackedEntity: null,
    _trailHeadEntity: null,
  };
  const noop = () => {};
  const parts = {
    controller: { _abortActiveUpdates: noop },
    rendering: { _releaseModels: noop },
    tracking: {
      _setCockpitContactMode: noop,
      _installClickHandler: noop,
      _cancelPendingTrackingRestore: noop,
      _clearTracking: noop,
      _destroyTrail: noop,
      _resetTrackedSelectionState: noop,
    },
  };
  const services = {
    focus: { clearFocusTarget: noop },
    sprites: {
      registerSpriteCollection: noop,
      restoreSpriteOrder: noop,
      restoreSpriteOrderOnEnable: noop,
    },
    militaryRegistry: {
      onMilitaryLayerActiveChange: () => noop,
      setMilitaryLayerActive: noop,
    },
    render,
    geoid: { ensureGeoidReady: () => Promise.resolve() },
    picking: { registerPickOwner: noop, unregisterPickOwner: noop },
  };
  const lifecycle = createLifecycle({
    flightState,
    services,
    parts,
    layer: {},
    resolveAsset: (url) => url,
  });
  const collectionEvents = {
    addEventListener: () => noop,
  };
  const viewer = {
    scene: {
      preRender: collectionEvents,
      preUpdate: collectionEvents,
      primitives: { remove: noop },
    },
    camera: { moveEnd: collectionEvents },
  };
  return { events, flightState, lifecycle, viewer, owner, military };
}

test('real civil and military lifecycle methods reconcile empty and active owners through destroy', () => {
  const previousDocument = globalThis.document;
  globalThis.document = {
    body: { classList: { contains: () => false } },
    removeEventListener() {},
  };
  try {
    for (const [createLifecycle, owner, military] of [
      [createFlightLifecycle, 'flights', false],
      [createMilitaryLifecycle, 'military', true],
    ]) {
      const harness = lifecycleHarness(createLifecycle, owner, military);
      harness.lifecycle.methods.enable(harness.viewer);
      assert.equal(
        harness.events.at(-1)?.[0],
        'release',
        `${owner}: enabling an empty layer leaves it idle`,
      );

      harness.flightState._billboards.set('abc123', {});
      harness.lifecycle.syncRenderDemand();
      assert.deepEqual(harness.events.at(-1), ['hold', owner]);

      harness.lifecycle.methods.disable(harness.viewer);
      assert.deepEqual(harness.events.at(-1), ['release', owner]);
      harness.lifecycle.methods.enable(harness.viewer);
      assert.deepEqual(harness.events.at(-1), ['hold', owner]);
      harness.lifecycle.methods.destroy(harness.viewer);
      assert.deepEqual(harness.events.at(-1), ['release', owner]);
    }
  } finally {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  }
});
