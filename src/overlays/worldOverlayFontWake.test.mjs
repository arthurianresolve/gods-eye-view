import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  destroyWorldOverlayDraw,
  installWorldOverlayFontInvalidation,
} from './worldOverlayDraw.js';

function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function fontSet(ready) {
  const listeners = new Map();
  return {
    ready,
    listeners,
    addEventListener(name, listener) {
      listeners.set(name, listener);
    },
    removeEventListener(name, listener) {
      if (listeners.get(name) === listener) listeners.delete(name);
    },
    dispatch(name) {
      listeners.get(name)?.();
    },
  };
}

function installDocument(t, fonts) {
  const previous = globalThis.document;
  globalThis.document = { fonts };
  t.after(() => {
    destroyWorldOverlayDraw();
    if (previous === undefined) delete globalThis.document;
    else globalThis.document = previous;
  });
}

test('font invalidation requests a render only when font state changes', async (t) => {
  destroyWorldOverlayDraw();
  const ready = deferred();
  const fonts = fontSet(ready.promise);
  installDocument(t, fonts);
  const scene = {
    renderRequests: 0,
    requestRender() {
      this.renderRequests++;
    },
  };

  installWorldOverlayFontInvalidation(() => scene.requestRender());
  installWorldOverlayFontInvalidation();
  assert.equal(
    scene.renderRequests,
    0,
    'installation does not add a render loop',
  );
  fonts.dispatch('loadingdone');
  assert.equal(scene.renderRequests, 1, 'loadingdone wakes a parked host once');
  ready.resolve();
  await Promise.resolve();
  assert.equal(
    scene.renderRequests,
    2,
    'fonts.ready also wakes the current host',
  );
});

test('late readiness and queued events cannot wake a disposed or replacement host', async (t) => {
  destroyWorldOverlayDraw();
  const oldReady = deferred();
  const oldFonts = fontSet(oldReady.promise);
  installDocument(t, oldFonts);
  let oldRequests = 0;
  installWorldOverlayFontInvalidation(() => oldRequests++);
  const queuedOldEvent = oldFonts.listeners.get('loadingdone');

  destroyWorldOverlayDraw();
  assert.equal(
    oldFonts.listeners.size,
    0,
    'disposed host releases its listener',
  );
  const currentReady = deferred();
  const currentFonts = fontSet(currentReady.promise);
  globalThis.document = { fonts: currentFonts };
  let currentRequests = 0;
  installWorldOverlayFontInvalidation(() => currentRequests++);

  queuedOldEvent?.();
  oldReady.resolve();
  await Promise.resolve();
  assert.equal(oldRequests, 0, 'disposed host owns no late wake');
  assert.equal(
    currentRequests,
    0,
    'old font readiness cannot wake its replacement',
  );

  currentFonts.dispatch('loadingdone');
  assert.equal(
    currentRequests,
    1,
    'replacement host receives its own font event',
  );
  const queuedCurrentEvent = currentFonts.listeners.get('loadingdone');
  destroyWorldOverlayDraw();
  assert.equal(
    currentFonts.listeners.size,
    0,
    'replacement releases its listener',
  );
  queuedCurrentEvent?.();
  currentReady.resolve();
  await Promise.resolve();
  assert.equal(
    currentRequests,
    1,
    'disposed replacement cannot be woken later',
  );
});
