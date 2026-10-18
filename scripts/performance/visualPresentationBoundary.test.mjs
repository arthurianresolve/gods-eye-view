import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import {
  installVisualPresentationBoundaryInPage,
  presentationStayedSettled,
} from './visualPresentationBoundary.mjs';

test('presentation observer counts real changes, retains cycles and releases its listener', () => {
  let notify;
  let disconnected = false;
  const root = { textContent: 'Synthetic camera' };
  const dot = { style: { visibility: 'visible' } };
  const summary = { textContent: 'Fixed fixture summary' };
  const scope = {
    window: {
      __godsEyeView: {
        styleManager: { hud: { _summaryTypingInterval: null, visible: true } },
      },
    },
    document: {
      visibilityState: 'visible',
      hasFocus: () => true,
      getElementById: (id) =>
        ({ 'intel-hud': root, 'hud-rec-dot': dot, 'hud-summary': summary })[id],
    },
    getComputedStyle: () => ({
      display: 'block',
      visibility: 'visible',
      opacity: '1',
    }),
    MutationObserver: class {
      constructor(callback) {
        notify = callback;
      }
      observe() {}
      disconnect() {
        disconnected = true;
      }
    },
  };
  vm.runInNewContext(
    '(' + installVisualPresentationBoundaryInPage.toString() + ')()',
    scope,
  );
  const boundary = scope.window.__gevVisualPresentationBoundary;
  const before = boundary.read();
  notify();
  assert.equal(
    boundary.read().revision,
    before.revision,
    'unchanged writes do not invalidate',
  );
  assert.equal(presentationStayedSettled(before, boundary.read()), true);
  dot.style.visibility = 'hidden';
  notify();
  dot.style.visibility = 'visible';
  notify();
  assert.equal(
    presentationStayedSettled(before, boundary.read()),
    false,
    'a full REC phase cycle is not an unchanged capture',
  );
  boundary.dispose();
  assert.equal(disconnected, true);
  assert.equal(scope.window.__gevVisualPresentationBoundary, undefined);
});

test('capture eligibility rejects focus loss and a still-typing summary', () => {
  const proof = {
    revision: 1,
    recordingVisible: true,
    summaryTypingComplete: true,
    summary: 'fixture',
    documentVisible: true,
    documentFocused: true,
    hudVisible: true,
    hudDisplay: 'block',
    hudVisibility: 'visible',
    hudOpacity: 1,
  };
  assert.equal(presentationStayedSettled(proof, proof), true);
  assert.equal(
    presentationStayedSettled(proof, { ...proof, documentFocused: false }),
    false,
  );
  assert.equal(
    presentationStayedSettled(proof, {
      ...proof,
      summaryTypingComplete: false,
    }),
    false,
  );
});

test('presentation must reach the requested rendered HUD state', () => {
  const visible = {
    revision: 1,
    recordingVisible: true,
    summaryTypingComplete: true,
    summary: 'fixture',
    documentVisible: true,
    documentFocused: true,
    hudVisible: true,
    hudDisplay: 'block',
    hudVisibility: 'visible',
    hudOpacity: 1,
  };
  assert.equal(
    presentationStayedSettled(visible, { ...visible, hudOpacity: 0.5 }),
    false,
  );
  const hidden = {
    ...visible,
    hudVisible: false,
    hudVisibility: 'hidden',
    hudOpacity: 0,
  };
  assert.equal(presentationStayedSettled(hidden, hidden, false), true);
  assert.equal(presentationStayedSettled(hidden, hidden, true), false);
  assert.equal(
    presentationStayedSettled(
      hidden,
      { ...hidden, hudVisibility: 'visible' },
      false,
    ),
    false,
  );
});
