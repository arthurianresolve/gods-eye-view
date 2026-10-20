import assert from 'node:assert/strict';
import { getEventListeners } from 'node:events';
import test from 'node:test';
import { LayerLifecycle } from './lifecycle.js';
import { waitForVisibilityPaint } from './visibilityPaint.js';

function browser() {
  const documentRef = new EventTarget();
  const frames = new Map();
  let nextFrame = 0;
  documentRef.hidden = false;
  documentRef.defaultView = {
    requestAnimationFrame(callback) {
      const id = ++nextFrame;
      frames.set(id, callback);
      return id;
    },
    cancelAnimationFrame(id) {
      frames.delete(id);
    },
  };
  return {
    documentRef,
    frames,
    frame() {
      // RAFs registered by a callback belong to the next rendering update.
      for (const [id, callback] of [...frames]) {
        if (!frames.delete(id)) continue;
        callback(nextFrame * 16);
      }
    },
    hide() {
      documentRef.hidden = true;
      documentRef.dispatchEvent(new Event('visibilitychange'));
    },
    assertReleased(signal) {
      assert.equal(frames.size, 0);
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

test('paint wait spans a rendering opportunity and releases all owned callbacks', async () => {
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
  assert.equal(page.frames.size, 1);
  page.frame();
  await waiting;
  assert.equal(complete, true);
  page.assertReleased(controller.signal);
});

test('paint wait releases hidden, aborted and unavailable browser paths without a timer', async () => {
  for (const afterFirstFrame of [false, true]) {
    const page = browser();
    const controller = new AbortController();
    const waiting = waitForVisibilityPaint({
      documentRef: page.documentRef,
      signal: controller.signal,
    });
    if (afterFirstFrame) page.frame();
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
});

test('user enable and disable preserve truthful transition presentation before work', async () => {
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
  f.frame();
  assert.equal(await enabling, true);
  assert.equal(f.manager.isEnabled(f.layer.id), true);
  assert.equal(f.calls.enable, 1);
  f.assertReleased();

  const disabling = f.manager.setEnabled(f.layer.id, false, { origin: 'user' });
  await until(() => f.frames.size === 1);
  f.frame();
  await Promise.resolve();
  assert.deepEqual(f.manager.getLayerLifecycleState(f.layer.id), {
    enabled: true,
    lifecycleState: 'disabling',
    uncertain: false,
  });
  assert.equal(f.calls.disable, 0);
  f.frame();
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
  f.frame();
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

test('an unstarted OFF superseded by ON does not disable or re-enable live resources', async () => {
  const f = fixture();
  await f.manager.setEnabled(f.layer.id, true);
  const off = f.manager.setEnabled(f.layer.id, false, { origin: 'user' });
  await until(() => f.frames.size === 1);
  const on = f.manager.setEnabled(f.layer.id, true);
  assert.equal(await off, false);
  assert.equal(await on, true);
  assert.equal(f.calls.disable, 0);
  assert.equal(f.calls.enable, 1);
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
  f.frame();
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
