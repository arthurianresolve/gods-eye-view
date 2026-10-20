import assert from 'node:assert/strict';
import { getEventListeners } from 'node:events';
import test from 'node:test';
import { LayerPresentation } from '../app/layerPresentation.js';
import { LayerLifecycle } from './lifecycle.js';
import { waitForVisibilityPaint } from './visibilityPaint.js';

function browser() {
  const documentRef = new EventTarget();
  const frames = new Map();
  const knownFrames = new Map();
  const tasks = new Map();
  const knownTasks = new Map();
  let nextFrame = 0;
  let nextTask = 0;
  documentRef.hidden = false;
  documentRef.defaultView = {
    requestAnimationFrame(callback) {
      const id = ++nextFrame;
      frames.set(id, callback);
      knownFrames.set(id, callback);
      return id;
    },
    cancelAnimationFrame(id) {
      frames.delete(id);
    },
    setTimeout(callback, delay) {
      assert.equal(delay, 0);
      const id = ++nextTask;
      tasks.set(id, callback);
      knownTasks.set(id, callback);
      return id;
    },
    clearTimeout(id) {
      tasks.delete(id);
    },
  };
  return {
    documentRef,
    frames,
    tasks,
    frame() {
      // RAFs registered by a callback belong to the next rendering update.
      for (const [id, callback] of [...frames]) {
        if (!frames.delete(id)) continue;
        callback(nextFrame * 16);
      }
    },
    task() {
      // Tasks created from a RAF run only after that rendering update.
      for (const [id, callback] of [...tasks]) {
        if (!tasks.delete(id)) continue;
        callback();
      }
    },
    invokeStaleTask(id) {
      knownTasks.get(id)?.();
    },
    invokeStaleFrame(id) {
      knownFrames.get(id)?.(nextFrame * 16);
    },
    hide() {
      documentRef.hidden = true;
      documentRef.dispatchEvent(new Event('visibilitychange'));
    },
    assertReleased(signal) {
      assert.equal(frames.size, 0);
      assert.equal(tasks.size, 0);
      assert.equal(
        getEventListeners(documentRef, 'visibilitychange').length,
        0,
      );
      if (signal) assert.equal(getEventListeners(signal, 'abort').length, 0);
    },
  };
}

async function until(predicate) {
  for (let turn = 0; turn < 40; turn++) {
    if (predicate()) return;
    await Promise.resolve();
  }
  assert.fail('Expected lifecycle boundary was not reached');
}

function fixture() {
  const page = browser();
  const calls = { init: 0, enable: 0, update: 0, disable: 0, destroy: 0 };
  const layer = {
    id: 'local-test',
    updateInterval: -1,
    init() {
      calls.init++;
    },
    enable() {
      calls.enable++;
    },
    update() {
      calls.update++;
    },
    disable() {
      calls.disable++;
    },
    destroy() {
      calls.destroy++;
    },
  };
  const manager = new LayerLifecycle({
    container: { ownerDocument: page.documentRef },
  });
  manager.register(layer);
  const events = [];
  const presentations = [];
  manager.subscribe((event) => events.push(event));
  manager.subscribeActivity((event) => {
    if (event.type === 'status')
      presentations.push(manager.getLayerLifecycleState(layer.id));
  });
  return { ...page, calls, layer, manager, events, presentations };
}

test('layer work waits for one RAF update and the following owned task', async () => {
  const page = browser();
  const controller = new AbortController();
  let complete = false;
  const waiting = waitForVisibilityPaint({
    documentRef: page.documentRef,
    signal: controller.signal,
  }).then(() => {
    complete = true;
  });
  page.frame();
  await Promise.resolve();
  assert.equal(
    complete,
    false,
    'The first pre-paint callback must not start layer work',
  );
  assert.equal(page.frames.size, 0);
  assert.equal(page.tasks.size, 1);
  page.task();
  await waiting;
  assert.equal(complete, true);
  page.assertReleased(controller.signal);
});

test('real lifecycle presentation is synchronous before the RAF and work waits for its task', async (t) => {
  const f = fixture();
  const trace = [];
  const presentation = new LayerPresentation(f.manager, {
    requestRender() {},
    invalidateDetection() {},
  });
  t.after(() => presentation.destroy());
  // Keep the real lifecycle-to-presentation subscription. The panel readback
  // observes the state delivered to its synchronous control reconciliation.
  presentation._panel = {
    _refreshTogglePanel() {
      trace.push(f.manager.getLayerLifecycleState(f.layer.id).lifecycleState);
    },
    destroy() {},
  };
  const requestFrame = f.documentRef.defaultView.requestAnimationFrame;
  f.documentRef.defaultView.requestAnimationFrame = (callback) => {
    assert.equal(trace.at(-1), 'enabling');
    trace.push('raf-scheduled');
    return requestFrame(callback);
  };
  f.layer.init = () => {
    f.calls.init++;
    trace.push('init');
  };
  const enabling = f.manager.setEnabled(f.layer.id, true, { origin: 'user' });
  await until(() => f.frames.size === 1);
  assert.ok(trace.indexOf('enabling') < trace.indexOf('raf-scheduled'));
  assert.equal(f.calls.init, 0);
  assert.equal(f.calls.enable, 0);
  f.frame();
  await Promise.resolve();
  assert.equal(f.frames.size, 0);
  assert.equal(f.tasks.size, 1);
  assert.equal(
    f.calls.init,
    0,
    'The RAF microtask cannot start initialization',
  );
  assert.equal(f.calls.enable, 0);
  trace.push('owned-task');
  f.task();
  assert.equal(await enabling, true);
  assert.ok(trace.indexOf('init') > trace.indexOf('owned-task'));
  assert.equal(f.calls.init, 1);
  assert.equal(f.calls.enable, 1);
  f.assertReleased();
});

test('paint wait releases hidden, aborted and unavailable browser paths', async () => {
  for (const completedFrames of [0, 1]) {
    const page = browser();
    const controller = new AbortController();
    const waiting = waitForVisibilityPaint({
      documentRef: page.documentRef,
      signal: controller.signal,
    });
    for (let at = 0; at < completedFrames; at++) page.frame();
    controller.abort();
    await waiting;
    page.assertReleased(controller.signal);
  }
  const page = browser();
  const waiting = waitForVisibilityPaint({ documentRef: page.documentRef });
  page.hide();
  await waiting;
  page.assertReleased();
  await waitForVisibilityPaint({ documentRef: null });
  await waitForVisibilityPaint({ documentRef: {} });
  await waitForVisibilityPaint({ documentRef: page.documentRef });
  const controller = new AbortController();
  controller.abort();
  page.documentRef.hidden = false;
  await waitForVisibilityPaint({
    documentRef: page.documentRef,
    signal: controller.signal,
  });
  page.assertReleased(controller.signal);

  const noTimer = browser();
  noTimer.documentRef.defaultView.setTimeout = undefined;
  await waitForVisibilityPaint({ documentRef: noTimer.documentRef });
  noTimer.assertReleased();
});

test('abort or hide cancels either owned RAF or task and stale callbacks finish once', async () => {
  for (const end of ['abort', 'hide']) {
    for (const completedFrames of [0, 1]) {
      const page = browser();
      const controller = new AbortController();
      let completions = 0;
      const waiting = waitForVisibilityPaint({
        documentRef: page.documentRef,
        signal: controller.signal,
      }).then(() => completions++);
      const [frameId] = page.frames.keys();
      for (let at = 0; at < completedFrames; at++) page.frame();
      const [taskId] = page.tasks.keys();
      if (end === 'abort') controller.abort();
      else page.hide();
      await waiting;
      assert.equal(completions, 1);
      page.invokeStaleTask(taskId);
      page.invokeStaleFrame(frameId);
      assert.equal(completions, 1);
      page.assertReleased(controller.signal);
    }
  }

  const page = browser();
  let completions = 0;
  const waiting = waitForVisibilityPaint({
    documentRef: page.documentRef,
  }).then(() => completions++);
  page.frame();
  const [taskId] = page.tasks.keys();
  page.task();
  await waiting;
  page.invokeStaleTask(taskId);
  assert.equal(completions, 1);
  page.assertReleased();
});

test('RAF or task scheduling errors resume lifecycle without leaking listeners', async () => {
  const rafPage = browser();
  rafPage.documentRef.defaultView.requestAnimationFrame = () => {
    throw new Error('RAF scheduler unavailable');
  };
  await waitForVisibilityPaint({ documentRef: rafPage.documentRef });
  rafPage.assertReleased();

  const taskPage = browser();
  taskPage.documentRef.defaultView.setTimeout = () => {
    throw new Error('task scheduler unavailable');
  };
  let complete = false;
  const waiting = waitForVisibilityPaint({
    documentRef: taskPage.documentRef,
  }).then(() => {
    complete = true;
  });
  taskPage.frame();
  await waiting;
  assert.equal(complete, true);
  taskPage.assertReleased();
});

test('user enable yields a rendering opportunity while disable starts without waiting for a frame', async () => {
  const f = fixture();
  const enabling = f.manager.setEnabled(f.layer.id, true, { origin: 'user' });
  await until(() => f.frames.size === 1);
  assert.deepEqual(f.manager.getLayerLifecycleState(f.layer.id), {
    enabled: false,
    lifecycleState: 'enabling',
    uncertain: false,
  });
  assert.deepEqual(f.calls, {
    init: 0,
    enable: 0,
    update: 0,
    disable: 0,
    destroy: 0,
  });
  f.frame();
  await Promise.resolve();
  assert.equal(f.presentations.at(-1).lifecycleState, 'enabling');
  assert.equal(f.calls.enable, 0);
  assert.equal(
    f.events.some(({ type }) => type === 'visibility'),
    false,
  );
  assert.equal(f.frames.size, 0);
  assert.equal(f.tasks.size, 1);
  assert.equal(f.calls.enable, 0, 'Layer work stays outside the RAF microtask');
  f.task();
  assert.equal(await enabling, true);
  assert.equal(f.manager.isEnabled(f.layer.id), true);
  assert.equal(f.calls.enable, 1);
  f.assertReleased();

  let finishDisable;
  f.layer.disable = () => {
    f.calls.disable++;
    return new Promise((resolve) => {
      finishDisable = resolve;
    });
  };
  const disabling = f.manager.setEnabled(f.layer.id, false, { origin: 'user' });
  await until(() => f.calls.disable === 1);
  assert.equal(
    f.frames.size,
    0,
    'Unwanted layer work is hidden before another rendering update',
  );
  assert.deepEqual(f.manager.getLayerLifecycleState(f.layer.id), {
    enabled: true,
    lifecycleState: 'disabling',
    uncertain: false,
  });
  finishDisable();
  assert.equal(await disabling, true);
  assert.equal(f.manager.isEnabled(f.layer.id), false);
  assert.equal(f.calls.disable, 1);
  f.assertReleased();
});

test('caller abort before layer work cancels once without compensating untouched resources', async () => {
  const f = fixture();
  const controller = new AbortController();
  const enabling = f.manager.setEnabled(f.layer.id, true, {
    origin: 'user',
    signal: controller.signal,
  });
  await until(() => f.frames.size === 1);
  f.frame();
  assert.equal(f.frames.size, 0);
  assert.equal(f.tasks.size, 1);
  controller.abort();
  assert.equal(await enabling, false);
  f.assertReleased(controller.signal);
  assert.deepEqual(f.calls, {
    init: 0,
    enable: 0,
    update: 0,
    disable: 0,
    destroy: 0,
  });
  assert.equal(
    f.manager.getLayerLifecycleState(f.layer.id).lifecycleState,
    'disabled',
  );
  const cancelled = f.events.filter(
    ({ type }) => type === 'visibility-cancelled',
  );
  assert.equal(cancelled.length, 1);
  assert.equal(cancelled[0].phase, 'presentation');
  assert.equal(cancelled[0].cancellationReason, 'caller-abort');
  assert.equal(
    await f.manager.setEnabled(f.layer.id, true),
    true,
    'A cancelled presentation leaves no cleanup debt',
  );
  assert.equal(f.calls.disable, 0);
});

test('a newer OFF cancels an unstarted ON and owns its exact settled result', async () => {
  const f = fixture();
  const on = f.manager._setEnabledWithIntent(f.layer.id, true, {
    origin: 'user',
  });
  await until(() => f.frames.size === 1);
  f.frame();
  const off = f.manager._setEnabledWithIntent(f.layer.id, false, {
    origin: 'user',
  });
  assert.equal(await on.promise, false);
  assert.equal(await off.promise, true);
  f.assertReleased();
  assert.deepEqual(f.calls, {
    init: 0,
    enable: 0,
    update: 0,
    disable: 0,
    destroy: 0,
  });
  const cancelled = f.events.find(
    ({ type }) => type === 'visibility-cancelled',
  );
  assert.equal(cancelled.intentEpoch, on.intentEpoch);
  assert.equal(cancelled.successorIntentEpoch, off.intentEpoch);
  assert.equal(cancelled.phase, 'presentation');
  assert.deepEqual(
    f.events
      .filter(({ type }) => type === 'visibility')
      .map(({ intentEpoch, enabled }) => ({ intentEpoch, enabled })),
    [{ intentEpoch: off.intentEpoch, enabled: false }],
  );
});

test('a same-target successor gets its own paint wait and sole settled publication', async () => {
  const f = fixture();
  const first = f.manager._setEnabledWithIntent(f.layer.id, true, {
    origin: 'user',
  });
  await until(() => f.frames.size === 1);
  f.frame();
  const second = f.manager._setEnabledWithIntent(f.layer.id, true, {
    origin: 'user',
  });
  assert.equal(await first.promise, false);
  await until(() => f.frames.size === 1);
  f.frame();
  await Promise.resolve();
  assert.equal(f.calls.enable, 0);
  f.task();
  assert.equal(await second.promise, true);
  assert.equal(f.calls.enable, 1);
  assert.deepEqual(
    f.events
      .filter(({ type }) => type === 'visibility')
      .map(({ intentEpoch }) => intentEpoch),
    [second.intentEpoch],
  );
  f.assertReleased();
});

test('a prompt OFF superseded during teardown compensates before the newer ON settles', async () => {
  const f = fixture();
  let visible = false;
  let finishDisable;
  f.layer.enable = () => {
    f.calls.enable++;
    visible = true;
  };
  f.layer.disable = () => {
    f.calls.disable++;
    visible = false;
    return new Promise((resolve) => {
      finishDisable = resolve;
    });
  };
  await f.manager.setEnabled(f.layer.id, true);
  const off = f.manager.setEnabled(f.layer.id, false, { origin: 'user' });
  await until(() => f.calls.disable === 1);
  assert.equal(
    visible,
    false,
    'Disable hides resources without waiting for paint',
  );
  assert.equal(f.frames.size, 0);
  const on = f.manager.setEnabled(f.layer.id, true);
  finishDisable();
  assert.equal(await off, false);
  assert.equal(await on, true);
  assert.equal(visible, true);
  assert.equal(f.calls.disable, 1);
  assert.equal(
    f.calls.enable,
    2,
    'The cancelled disable compensates exactly once',
  );
  assert.equal(
    f.manager.getLayerLifecycleState(f.layer.id).lifecycleState,
    'enabled',
  );
  f.assertReleased();
});

test('teardown cancels the paint wait before draining the visibility queue', async () => {
  const f = fixture();
  const on = f.manager.setEnabled(f.layer.id, true, { origin: 'user' });
  await until(() => f.frames.size === 1);
  f.frame();
  const teardown = f.manager.destroyLayer(f.layer.id);
  assert.equal(await on, false);
  assert.equal(await teardown, true);
  assert.equal(f.manager.layers.size, 0);
  assert.deepEqual(f.calls, {
    init: 0,
    enable: 0,
    update: 0,
    disable: 0,
    destroy: 1,
  });
  assert.equal(
    f.events.find(({ type }) => type === 'visibility-cancelled')
      .successorOrigin,
    'teardown',
  );
  f.assertReleased();
});

test('hidden documents and non-user origins do not wait for suspended presentation', async () => {
  for (const origin of ['programmatic', 'voice', 'tool']) {
    const f = fixture();
    assert.equal(
      await f.manager.setEnabled(f.layer.id, true, { origin }),
      true,
    );
    f.assertReleased();
  }
  const f = fixture();
  const on = f.manager.setEnabled(f.layer.id, true, { origin: 'user' });
  await until(() => f.frames.size === 1);
  f.hide();
  assert.equal(await on, true);
  assert.equal(f.calls.enable, 1);
  f.assertReleased();
});

test('a blocked request schedules no paint and errors after presentation retain lifecycle cleanup', async () => {
  const f = fixture();
  const removeGuard = f.manager.addVisibilityGuard(() => 'blocked');
  assert.equal(
    await f.manager.setEnabled(f.layer.id, true, { origin: 'user' }),
    false,
  );
  assert.equal(f.calls.init, 0);
  f.assertReleased();
  removeGuard();
  f.layer.enable = () => {
    f.calls.enable++;
    return false;
  };
  const on = f.manager.setEnabled(f.layer.id, true, { origin: 'user' });
  await until(() => f.frames.size === 1);
  f.frame();
  f.task();
  assert.equal(await on, false);
  assert.equal(f.calls.disable, 1);
  assert.equal(
    f.manager.getLayerLifecycleState(f.layer.id).lifecycleState,
    'disabled',
  );
  assert.equal(
    f.events.find(({ type }) => type === 'visibility-failed').phase,
    'enable',
  );
  f.assertReleased();
});
