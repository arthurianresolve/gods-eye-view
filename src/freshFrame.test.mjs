import test from 'node:test';
import assert from 'node:assert/strict';
import { getEventListeners } from 'node:events';
import {
  captureFreshCesiumFrame,
  cancelPendingFrameCaptures,
  renderFreshCesiumFrame,
} from './freshFrame.js';

function fixture(t, { requestError = false, drawError = false } = {}) {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const original = globalThis.document;
  const listeners = new Set(),
    copies = [],
    doc = new EventTarget();
  doc.hidden = false;
  doc.createElement = () => {
    const canvas = {
      width: 0,
      height: 0,
      getContext: () => ({
        drawImage() {
          if (drawError) throw new Error('context lost');
        },
      }),
    };
    copies.push(canvas);
    return canvas;
  };
  globalThis.document = doc;
  t.after(() => {
    globalThis.document = original;
  });
  let destroyed = false;
  const viewer = {
    isDestroyed: () => destroyed,
    scene: {
      canvas: { width: 6, height: 4 },
      postRender: {
        addEventListener(fn) {
          listeners.add(fn);
          return () => listeners.delete(fn);
        },
      },
      requestRender() {
        if (requestError) throw new Error('renderer failed');
      },
    },
  };
  return {
    viewer,
    doc,
    listeners,
    copies,
    fire: () => {
      for (const fn of [...listeners]) fn();
    },
    destroy: () => {
      cancelPendingFrameCaptures(viewer);
      destroyed = true;
    },
    assertClean(signal) {
      assert.equal(listeners.size, 0);
      assert.equal(getEventListeners(doc, 'visibilitychange').length, 0);
      if (signal) assert.equal(getEventListeners(signal, 'abort').length, 0);
    },
  };
}

test('a copied frame uses completed-render dimensions and owns no pending handlers', async (t) => {
  const env = fixture(t),
    controller = new AbortController();
  const capture = captureFreshCesiumFrame(env.viewer, {
    signal: controller.signal,
  });
  env.viewer.scene.canvas.width = 8;
  env.fire();
  const copy = await capture;
  assert.equal(copy.width, 8);
  assert.equal(copy.height, 4);
  env.assertClean(controller.signal);
  t.mock.timers.tick(1000);
  assert.equal(
    copy.width,
    8,
    'timeout cannot destroy a transferred successful copy',
  );
});

for (const mode of [
  'timeout',
  'abort',
  'hidden',
  'destroy',
  'request-error',
  'draw-error',
]) {
  test(`${mode} cancels capture and releases listeners, signal handlers and temporary pixels`, async (t) => {
    const env = fixture(t, {
      requestError: mode === 'request-error',
      drawError: mode === 'draw-error',
    });
    const controller = new AbortController();
    const capture = captureFreshCesiumFrame(env.viewer, {
      signal: controller.signal,
    });
    if (mode === 'timeout') t.mock.timers.tick(400);
    if (mode === 'abort') controller.abort();
    if (mode === 'hidden') {
      env.doc.hidden = true;
      env.doc.dispatchEvent(new Event('visibilitychange'));
    }
    if (mode === 'destroy') env.destroy();
    if (mode === 'draw-error') env.fire();
    assert.equal(await capture, null);
    env.assertClean(controller.signal);
    env.fire();
    t.mock.timers.tick(1000);
    for (const copy of env.copies) assert.equal(copy.width * copy.height, 0);
  });
}

test('viewer destruction settles concurrent copies and pixel-free waits together', async (t) => {
  const env = fixture(t);
  const first = captureFreshCesiumFrame(env.viewer);
  const second = renderFreshCesiumFrame(env.viewer);
  env.destroy();
  assert.deepEqual(await Promise.all([first, second]), [null, false]);
  env.assertClean();
  assert.equal(await captureFreshCesiumFrame(env.viewer), null);
});

test('a visibility change immediately after render invalidates and releases the copy', async (t) => {
  const env = fixture(t);
  const capture = captureFreshCesiumFrame(env.viewer);
  env.fire();
  env.doc.hidden = true;
  assert.equal(await capture, null);
  assert.equal(env.copies[0].width, 0);
  env.assertClean();
});
