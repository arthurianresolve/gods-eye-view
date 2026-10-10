import test from 'node:test';
import assert from 'node:assert/strict';
import * as Cesium from 'cesium';
import { createLaunchRenderDemand } from './renderDemand.js';
import { createOrbitRendering } from './orbitRendering.js';
import { createLifecycle } from './lifecycle.js';

function makeRenderOwner() {
  const calls = [];
  const owner = {
    setContinuous(value) {
      calls.push(['continuous', value]);
    },
    schedule(callback, delay) {
      const update = { callback, delay, cancelled: false };
      calls.push(['schedule', update]);
      return () => {
        update.cancelled = true;
      };
    },
    dispose() {
      calls.push(['dispose']);
    },
  };
  return { calls, owner };
}

test('mission camera demand owns overlapping flights and preserves callbacks', () => {
  const { calls, owner } = makeRenderOwner();
  const state = { _selectedLaunchId: null, _replayCameraLaunchId: null };
  const demand = createLaunchRenderDemand(
    { registerRenderDemand: () => owner },
    state,
  );
  demand.setActive(true);
  const callbackThis = { marker: true };
  let completed = 0;
  let cancelled = 0;
  const camera = {
    flyTo(options) {
      if (options.duration === 2) {
        options.complete.call(callbackThis, 'done');
        return 17;
      }
      return options;
    },
    flyToBoundingSphere(sphere, options) {
      assert.equal(sphere.radius, 3);
      return options;
    },
  };
  assert.equal(
    demand.wrapCameraFlight({}, camera, 'flyTo', {
      duration: 2,
      complete(value) {
        assert.equal(this, callbackThis);
        assert.equal(value, 'done');
        completed += 1;
      },
    }),
    17,
  );
  assert.equal(completed, 1);
  assert.equal(
    calls.filter(([kind, value]) => kind === 'continuous' && value).length,
    1,
  );

  const first = demand.wrapCameraFlight(
    {},
    camera,
    'flyToBoundingSphere',
    { radius: 3 },
    {
      cancel() {
        cancelled += 1;
      },
    },
  );
  const second = demand.wrapCameraFlight({}, camera, 'flyTo', { duration: 1 });
  assert.equal(
    calls.at(-1)[1],
    true,
    'overlapping flight keeps demand continuous',
  );
  first.cancel();
  assert.equal(cancelled, 1);
  assert.equal(
    calls.at(-1)[1],
    true,
    'finishing one flight does not release another',
  );
  second.cancel();
  assert.equal(calls.at(-1)[1], false);
});

test('camera-flight demand releases on throw, disable, and stale completion', () => {
  const { calls, owner } = makeRenderOwner();
  const state = { _selectedLaunchId: null, _replayCameraLaunchId: null };
  const demand = createLaunchRenderDemand(
    { registerRenderDemand: () => owner },
    state,
  );
  demand.setActive(true);
  assert.throws(
    () =>
      demand.wrapCameraFlight(
        {},
        {
          flyTo() {
            throw new Error('flight failed');
          },
        },
        'flyTo',
        {},
      ),
    /flight failed/,
  );
  assert.equal(calls.at(-1)[1], false);

  let lateComplete;
  demand.wrapCameraFlight(
    {},
    {
      flyTo(options) {
        lateComplete = options.complete;
      },
    },
    'flyTo',
    {},
  );
  demand.setActive(false);
  demand.cancelCameraFlights();
  const callsAfterDisable = calls.length;
  lateComplete();
  assert.equal(calls.at(-1)[1], false);
  assert.ok(calls.length >= callsAfterDisable);
  demand.setActive(true);
  state._selectedLaunchId = 'mission-a';
  demand.sync();
  assert.equal(
    calls.at(-1)[1],
    true,
    'selected mission restores continuous demand',
  );
  demand.dispose();
  state._selectedLaunchId = null;
  demand.reset();
  demand.setActive(true);
  assert.equal(
    calls.at(-1)[1],
    false,
    're-init starts without stale continuous ownership',
  );
});

test('camera flight no-op during scene morphing does not retain a render hold', () => {
  const { calls, owner } = makeRenderOwner();
  const demand = createLaunchRenderDemand(
    { registerRenderDemand: () => owner },
    { _selectedLaunchId: null, _replayCameraLaunchId: null },
  );
  demand.setActive(true);
  let forwarded = 0;
  const result = demand.wrapCameraFlight(
    { mode: Cesium.SceneMode.MORPHING },
    {
      flyTo(options) {
        forwarded += 1;
        assert.equal(typeof options.complete, 'undefined');
        assert.equal(typeof options.cancel, 'undefined');
        return 'morph-noop';
      },
    },
    'flyTo',
    {},
  );
  assert.equal(result, 'morph-noop');
  assert.equal(forwarded, 1);
  assert.equal(
    calls.some(([kind, value]) => kind === 'continuous' && value),
    false,
  );
});

test('lifecycle disposes owners before failed restore and resets them on re-init', async () => {
  const calls = [];
  const restoreError = new Error('restore failed');
  const initStop = new Error('stop after owner reset');
  const state = {
    _sourceController: new AbortController(),
    _enabled: true,
    _lifecycleToken: 0,
    _updateDirty: true,
  };
  const parts = {
    renderDemand: {
      setActive(value) {
        calls.push(['render-active', value]);
      },
      cancelCameraFlights() {
        calls.push(['camera-cancel']);
      },
      dispose() {
        calls.push(['render-dispose']);
      },
      reset() {
        calls.push(['render-reset']);
      },
    },
    orbitRendering: {
      destroyOrbitCadence() {
        calls.push(['orbit-dispose']);
      },
      resetOrbitCadence() {
        calls.push(['orbit-reset']);
      },
    },
    ingestion: {
      restoreSatelliteDependency() {
        calls.push(['restore']);
        return Promise.reject(restoreError);
      },
    },
    panel: {
      createMissionPanel() {
        throw initStop;
      },
    },
  };
  const methods = createLifecycle({
    state,
    services: {},
    parts,
    source: {},
  }).methods;
  await assert.rejects(() => methods.destroy({}), restoreError);
  assert.deepEqual(calls.slice(0, 5), [
    ['render-active', false],
    ['camera-cancel'],
    ['orbit-dispose'],
    ['render-dispose'],
    ['restore'],
  ]);
  assert.throws(() => methods.init({}), initStop);
  assert.deepEqual(calls.slice(5), [
    ['render-reset'],
    ['orbit-reset'],
    ['render-active', false],
  ]);
});

test('visible unselected orbit primitives request an owned one-second cadence', () => {
  const scheduled = [];
  const updates = [];
  const owner = {
    invalidate() {},
    schedule(callback, delay) {
      const entry = { callback, delay, cancelled: false };
      scheduled.push(entry);
      return () => {
        entry.cancelled = true;
      };
    },
    dispose() {},
  };
  const state = {
    _enabled: true,
    _selectedLaunchId: null,
    _dataSource: { show: true },
    _missionOrbitPrimitives: new Map(),
    _viewer: { scene: { primitives: { remove() {} } } },
  };
  const orbitRendering = createOrbitRendering({
    state,
    services: {
      satellites: {
        orbitFrameModelMatrix(gmst, date) {
          updates.push([gmst, date]);
        },
      },
      render: { registerRenderDemand: () => owner },
    },
    parts: {},
    source: {},
  });
  const primitive = { show: true, modelMatrix: {} };
  state._missionOrbitPrimitives.set('mission-a', {
    primitive,
    gmstAtBake: 123,
  });
  orbitRendering.syncMissionOrbitPrimitiveVisibility();
  assert.equal(scheduled[0].delay, 1000);
  scheduled[0].callback();
  assert.equal(updates.length, 1);
  assert.equal(
    scheduled[1].delay,
    1000,
    'cadence reschedules after each update',
  );
  const resumedAt = new Date(Date.now() + 2000);
  assert.equal(orbitRendering.refreshMissionOrbitFramesIfDue(resumedAt), true);
  assert.equal(
    updates.length,
    2,
    'resumed render refreshes a stale orbit immediately',
  );
  assert.equal(scheduled[1].cancelled, true, 'resume replaces the stale timer');
  assert.equal(orbitRendering.refreshMissionOrbitFramesIfDue(resumedAt), false);
  assert.equal(
    updates.length,
    2,
    'timer and resumed frame cannot double-update',
  );
  state._selectedLaunchId = 'mission-b';
  orbitRendering.syncMissionOrbitPrimitiveVisibility();
  assert.equal(primitive.show, false);
  assert.equal(
    scheduled.at(-1).cancelled,
    true,
    'hidden orbit cancels its pending wake',
  );
  state._enabled = false;
  orbitRendering.syncMissionOrbitPrimitiveVisibility();
  state._enabled = true;
  state._selectedLaunchId = null;
  orbitRendering.syncMissionOrbitPrimitiveVisibility();
  const scheduleCount = scheduled.length;
  scheduled[1].callback();
  assert.equal(
    updates.length,
    2,
    'stale wake cannot update after a new cadence begins',
  );
  assert.equal(scheduled.length, scheduleCount);
  orbitRendering.destroyOrbitCadence();
  const beforeReinit = scheduled.length;
  orbitRendering.resetOrbitCadence();
  orbitRendering.syncMissionOrbitPrimitiveVisibility();
  assert.equal(
    scheduled.length,
    beforeReinit + 1,
    're-init gets a fresh cadence owner',
  );
  scheduled[beforeReinit - 1]?.callback();
  assert.equal(
    updates.length,
    2,
    'destroyed owner wake cannot survive re-init',
  );
});
