import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  installRenderGovernor,
  holdContinuousRender,
  releaseContinuousRender,
  governorRequestRender,
  getRenderGovernorDiagnostics,
  _resetRenderGovernorForTest,
  scheduleRenderUpdate,
  registerRenderDemand,
  uninstallRenderGovernor,
} from './renderGovernor.js';

function makeViewer() {
  const calls = { requestRender: 0 };
  const preUpdateListeners = new Set();
  const scene = {
    requestRenderMode: false,
    maximumRenderTimeChange: 0,
    requestRender() {
      calls.requestRender += 1;
      scene.renderRequested = true;
    },
    renderRequested: false,
    preUpdate: {
      addEventListener(callback) {
        preUpdateListeners.add(callback);
        return () => preUpdateListeners.delete(callback);
      },
      raiseEvent() {
        for (const callback of [...preUpdateListeners]) callback(scene);
      },
      get numberOfListeners() {
        return preUpdateListeners.size;
      },
    },
  };
  return { viewer: { scene }, scene, calls };
}

beforeEach(() => _resetRenderGovernorForTest());

test('install with zero holds enters idle mode and pins maximumRenderTimeChange', () => {
  const { viewer, scene } = makeViewer();
  installRenderGovernor(viewer);
  assert.equal(scene.requestRenderMode, true);
  assert.equal(scene.maximumRenderTimeChange, Infinity);
  assert.equal(getRenderGovernorDiagnostics().mode, 'idle');
});

test('a hold flips to continuous; releasing the last hold returns to idle with a settling frame', () => {
  const { viewer, scene, calls } = makeViewer();
  installRenderGovernor(viewer);
  const settleBaseline = calls.requestRender;
  holdContinuousRender('flights');
  assert.equal(scene.requestRenderMode, false);
  assert.equal(getRenderGovernorDiagnostics().mode, 'continuous');
  releaseContinuousRender('flights');
  assert.equal(scene.requestRenderMode, true);
  // Entering idle renders one settling frame.
  assert.equal(calls.requestRender, settleBaseline + 1);
});

test('holds are identity-keyed: double-hold cannot leak, double-release cannot corrupt', () => {
  const { viewer, scene } = makeViewer();
  installRenderGovernor(viewer);
  holdContinuousRender('traffic');
  holdContinuousRender('traffic');
  releaseContinuousRender('traffic');
  assert.equal(
    scene.requestRenderMode,
    true,
    'single release clears an idempotent double-hold',
  );
  releaseContinuousRender('traffic');
  releaseContinuousRender('never-held');
  assert.equal(scene.requestRenderMode, true);
});

test('mode stays continuous until the LAST holder releases', () => {
  const { viewer, scene } = makeViewer();
  installRenderGovernor(viewer);
  holdContinuousRender('flights');
  holdContinuousRender('satellites');
  releaseContinuousRender('flights');
  assert.equal(scene.requestRenderMode, false);
  assert.deepEqual(getRenderGovernorDiagnostics().holds, ['satellites']);
  releaseContinuousRender('satellites');
  assert.equal(scene.requestRenderMode, true);
});

test('governorRequestRender forwards to the scene and records reasons only in idle mode', () => {
  const { viewer, calls } = makeViewer();
  installRenderGovernor(viewer);
  const baseline = calls.requestRender;
  governorRequestRender('layer-tick:earthquakes');
  assert.equal(calls.requestRender, baseline + 1);
  assert.equal(
    getRenderGovernorDiagnostics().recentRequests.at(-1).reason,
    'layer-tick:earthquakes',
  );
  holdContinuousRender('flights');
  const idleRequests = getRenderGovernorDiagnostics().recentRequests.length;
  governorRequestRender('slider');
  assert.equal(
    getRenderGovernorDiagnostics().recentRequests.length,
    idleRequests,
    'continuous-mode requests are not recorded as idle diagnostics',
  );
});

test('hold/release/request are safe no-ops before install (test environments without a viewer)', () => {
  holdContinuousRender('flights');
  releaseContinuousRender('flights');
  governorRequestRender('noop');
  assert.equal(getRenderGovernorDiagnostics().installed, false);
});

test('holds registered before install apply at install time', () => {
  holdContinuousRender('flights');
  const { viewer, scene } = makeViewer();
  installRenderGovernor(viewer);
  assert.equal(
    scene.requestRenderMode,
    false,
    'pre-install hold keeps continuous mode',
  );
  releaseContinuousRender('flights');
  assert.equal(scene.requestRenderMode, true);
});

test('scheduled updates coalesce by owner and dispose cleanly', async () => {
  const { viewer, calls } = makeViewer();
  installRenderGovernor(viewer);
  let ran = 0;
  scheduleRenderUpdate('layer', () => ran++);
  scheduleRenderUpdate('layer', () => (ran += 10));
  const dispose = scheduleRenderUpdate('cancelled', () => (ran += 100));
  dispose();
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(ran, 10);
  assert.equal(getRenderGovernorDiagnostics().scheduledUpdates.length, 0);
  assert.ok(calls.requestRender >= 2);
});

test('independent deadlines neither wake periodic owners early nor delay urgent updates', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let clock = 0;
  t.mock.method(performance, 'now', () => clock);
  const { viewer } = makeViewer();
  installRenderGovernor(viewer);
  const seen = [];
  scheduleRenderUpdate('periodic', () => seen.push('periodic'), 1000);
  scheduleRenderUpdate('urgent', () => seen.push('urgent'), 10);
  clock = 10;
  t.mock.timers.tick(10);
  assert.deepEqual(seen, ['urgent']);
  clock = 999;
  t.mock.timers.tick(989);
  assert.deepEqual(seen, ['urgent']);
  clock = 1000;
  t.mock.timers.tick(1);
  assert.deepEqual(seen, ['urgent', 'periodic']);
});

test('disposable owners preserve independent lifetimes and reject stale callbacks', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  t.mock.method(performance, 'now', () => 0);
  const { viewer, scene } = makeViewer();
  installRenderGovernor(viewer);
  const a = registerRenderDemand('tracking'),
    b = registerRenderDemand('tracking');
  a.setContinuous(true);
  b.setContinuous(true);
  a.dispose();
  assert.equal(scene.requestRenderMode, false);
  b.dispose();
  assert.equal(scene.requestRenderMode, true);
  const owner = registerRenderDemand('periodic');
  owner.schedule(() => assert.fail('disposed owner ran'));
  uninstallRenderGovernor(viewer);
  installRenderGovernor(viewer);
  owner.setContinuous(true);
  owner.schedule(() => assert.fail('stale owner ran'));
  t.mock.timers.tick(0);
  assert.equal(scene.requestRenderMode, true);
  assert.deepEqual(getRenderGovernorDiagnostics().scheduledUpdates, []);
});

test('cancellation during a due callback prevents another due owner from running', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  t.mock.method(performance, 'now', () => 0);
  installRenderGovernor(makeViewer().viewer);
  let cancel;
  scheduleRenderUpdate('first', () => cancel());
  cancel = scheduleRenderUpdate('second', () =>
    assert.fail('cancelled update ran'),
  );
  t.mock.timers.tick(0);
  assert.deepEqual(getRenderGovernorDiagnostics().scheduledUpdates, []);
});

test('a due timer queued through clock.tick flushes in preUpdate before shouldRender', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let clock = 0;
  t.mock.method(performance, 'now', () => clock);
  const { viewer, scene, calls } = makeViewer();
  installRenderGovernor(viewer);
  t.after(() => uninstallRenderGovernor(viewer));

  // Consume the install-time settling request. In a real CesiumWidget turn,
  // initializeFrame and clock.tick run before scene.render raises preUpdate.
  scene.renderRequested = false;
  let callbackFrame = null;
  let frameNumber = 0;
  scheduleRenderUpdate(
    'fleet',
    () => {
      callbackFrame = frameNumber;
    },
    80,
  );
  // Before the deadline there is no work to flush and requestRenderMode skips.
  frameNumber = 1;
  clock = 79;
  scene.preUpdate.raiseEvent(scene, clock);
  const earlyShouldRender = !scene.requestRenderMode || scene.renderRequested;
  assert.equal(earlyShouldRender, false);
  assert.equal(callbackFrame, null);

  // Simulate the last millisecond passing during clock.tick. The setTimeout
  // callback is deliberately not run until the current JavaScript frame ends.
  // Scene.preUpdate is before Scene.render's shouldRender calculation, so the
  // deadline guard must flush now and let this same frame render.
  clock = 80;
  frameNumber = 2;
  scene.preUpdate.raiseEvent(scene, clock);
  const shouldRenderThisFrame =
    !scene.requestRenderMode || scene.renderRequested;
  assert.equal(callbackFrame, 2);
  assert.equal(shouldRenderThisFrame, true);
  assert.equal(scene.preUpdate.numberOfListeners, 0);
  assert.deepEqual(getRenderGovernorDiagnostics().scheduledUpdates, []);

  scene.renderRequested = false;
  const requestCountAfterFlush = calls.requestRender;
  t.mock.timers.tick(80);
  assert.equal(calls.requestRender, requestCountAfterFlush);
  assert.equal(
    callbackFrame,
    2,
    'the canceled wall timer cannot duplicate the callback',
  );
  assert.equal(scene.preUpdate.numberOfListeners, 0);
});

test('due preUpdate flush supports a callback that reschedules then cancels its next deadline', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let clock = 0;
  t.mock.method(performance, 'now', () => clock);
  const { viewer, scene } = makeViewer();
  installRenderGovernor(viewer);
  t.after(() => uninstallRenderGovernor(viewer));
  scene.renderRequested = false;
  const seen = [];
  let cancelNext;
  scheduleRenderUpdate(
    'fleet',
    () => {
      seen.push('due');
      cancelNext = scheduleRenderUpdate(
        'fleet-next',
        () => seen.push('late'),
        20,
      );
    },
    10,
  );

  clock = 10;
  scene.preUpdate.raiseEvent(scene, clock);
  assert.deepEqual(seen, ['due']);
  assert.equal(scene.preUpdate.numberOfListeners, 1);
  assert.deepEqual(getRenderGovernorDiagnostics().scheduledUpdates, [
    'fleet-next',
  ]);
  cancelNext();
  assert.equal(scene.preUpdate.numberOfListeners, 0);
  t.mock.timers.tick(30);
  assert.deepEqual(seen, ['due']);
  assert.deepEqual(getRenderGovernorDiagnostics().scheduledUpdates, []);
});

test('a queued stale timeout cannot flush a newer deadline after preUpdate reschedules', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let clock = 0;
  t.mock.method(performance, 'now', () => clock);
  const { viewer, scene, calls } = makeViewer();
  installRenderGovernor(viewer);
  t.after(() => uninstallRenderGovernor(viewer));

  const timerCallbacks = [];
  const mockTimer = globalThis.setTimeout;
  t.mock.method(globalThis, 'setTimeout', (callback, delay, ...args) => {
    timerCallbacks.push({ callback, delay });
    return mockTimer(callback, delay, ...args);
  });

  const seen = [];
  scheduleRenderUpdate(
    'first',
    () => {
      seen.push('first');
      scheduleRenderUpdate('second', () => seen.push('second'), 20);
    },
    10,
  );
  const staleCallback = timerCallbacks[0].callback;
  clock = 10;
  scene.preUpdate.raiseEvent(scene, clock);
  assert.deepEqual(seen, ['first']);
  assert.deepEqual(getRenderGovernorDiagnostics().scheduledUpdates, ['second']);
  const requestsAfterFirst = calls.requestRender;

  // This models a timeout task that was already dequeued when preUpdate
  // cleared its handle. Its callback must not flush the newly scheduled work.
  staleCallback();
  assert.deepEqual(seen, ['first']);
  assert.deepEqual(getRenderGovernorDiagnostics().scheduledUpdates, ['second']);
  assert.equal(calls.requestRender, requestsAfterFirst);

  clock = 30;
  scene.preUpdate.raiseEvent(scene, clock);
  assert.deepEqual(seen, ['first', 'second']);
  assert.deepEqual(getRenderGovernorDiagnostics().scheduledUpdates, []);
});

test('deadline observer moves with viewer replacement and detaches on uninstall', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let clock = 0;
  t.mock.method(performance, 'now', () => clock);
  const oldViewer = makeViewer();
  const newViewer = makeViewer();
  installRenderGovernor(oldViewer.viewer);
  let callbackCount = 0;
  scheduleRenderUpdate('old-viewer', () => callbackCount++, 10);
  assert.equal(oldViewer.scene.preUpdate.numberOfListeners, 1);

  installRenderGovernor(newViewer.viewer);
  assert.equal(oldViewer.scene.preUpdate.numberOfListeners, 0);
  assert.equal(newViewer.scene.preUpdate.numberOfListeners, 1);
  clock = 10;
  oldViewer.scene.preUpdate.raiseEvent(oldViewer.scene, clock);
  assert.equal(
    callbackCount,
    0,
    'the replaced viewer cannot flush its old listener',
  );
  assert.deepEqual(getRenderGovernorDiagnostics().scheduledUpdates, [
    'old-viewer',
  ]);
  newViewer.scene.preUpdate.raiseEvent(newViewer.scene, clock);
  assert.equal(
    callbackCount,
    1,
    'the active viewer flushes the due update once',
  );
  assert.deepEqual(getRenderGovernorDiagnostics().scheduledUpdates, []);
  assert.equal(newViewer.scene.preUpdate.numberOfListeners, 0);
  assert.equal(oldViewer.scene.preUpdate.numberOfListeners, 0);

  scheduleRenderUpdate(
    'uninstall-cleanup',
    () => assert.fail('uninstalled callback ran'),
    10,
  );
  assert.equal(newViewer.scene.preUpdate.numberOfListeners, 1);
  uninstallRenderGovernor(newViewer.viewer);
  assert.equal(newViewer.scene.preUpdate.numberOfListeners, 0);
  t.mock.timers.tick(20);
  assert.deepEqual(getRenderGovernorDiagnostics().scheduledUpdates, []);
});

test('scheduled updates retain their timer fallback when preUpdate is unavailable', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let clock = 0;
  t.mock.method(performance, 'now', () => clock);
  const { viewer, scene } = makeViewer();
  delete scene.preUpdate;
  installRenderGovernor(viewer);
  let ran = 0;
  scheduleRenderUpdate('fallback', () => ran++, 5);
  clock = 5;
  t.mock.timers.tick(5);
  assert.equal(ran, 1);
  assert.deepEqual(getRenderGovernorDiagnostics().scheduledUpdates, []);
});
