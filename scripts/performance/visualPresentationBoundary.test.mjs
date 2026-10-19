import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import {
  installVisualPresentationBoundaryInPage,
  presentationStayedSettled,
  visualReadinessInputsMatch,
} from './visualPresentationBoundary.mjs';

test('presentation observer counts real changes, retains cycles and releases its listener', () => {
  let notify;
  let disconnected = false;
  const root = { textContent: 'Synthetic camera' };
  const dot = { style: { visibility: 'visible' } };
  const summary = { textContent: 'Fixed fixture summary' };
  const activeElement = { tagName: 'BODY', id: '', className: 'app-shell' };
  const scrollElement = (top = 0) => ({
    scrollLeft: 0,
    scrollTop: top,
    scrollWidth: 400,
    scrollHeight: 1200,
    clientWidth: 360,
    clientHeight: 800,
    offsetWidth: 362,
    offsetHeight: 802,
    querySelector: () => null,
    getBoundingClientRect: () => ({
      left: 100,
      top: 20,
      right: 462,
      bottom: 822,
      width: 362,
      height: 802,
    }),
  });
  const cyberBody = scrollElement();
  const inner = {
    ...scrollElement(),
    querySelector: (selector) =>
      selector === '.cyber-panel-body' ? cyberBody : null,
  };
  const panel = {
    ...scrollElement(),
    querySelector: (selector) =>
      selector === '.cctv-panel-inner' ? inner : null,
  };
  const listeners = new Map();
  const scope = {
    window: {
      __godsEyeView: {
        styleManager: { hud: { _summaryTypingInterval: null, visible: true } },
      },
      addEventListener: (name, listener) => listeners.set(name, listener),
      removeEventListener: (name, listener) => {
        if (listeners.get(name) === listener) listeners.delete(name);
      },
    },
    document: {
      visibilityState: 'visible',
      activeElement,
      hasFocus: () => true,
      getElementById: (id) =>
        ({
          'intel-hud': root,
          'hud-rec-dot': dot,
          'hud-summary': summary,
          'cctv-panel': panel,
        })[id],
    },
    getComputedStyle: () => ({
      display: 'block',
      visibility: 'visible',
      opacity: '1',
      overflowX: 'hidden',
      overflowY: 'auto',
      scrollbarGutter: 'auto',
      scrollbarWidth: 'thin',
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
  listeners.get('pointermove')({
    clientX: 1,
    clientY: 1,
    pointerType: 'mouse',
  });
  const before = boundary.read();
  assert.equal(before.scrollContainers.length, 3);
  assert.equal(before.scrollContainers[1].scroll.height, 1200);
  assert.equal(before.scrollContainers[1].computed.overflowY, 'auto');
  assert.equal(before.scrollContainers[2].present, true);
  assert.equal(
    JSON.stringify(before.pointer),
    JSON.stringify({ x: 1, y: 1, pointerType: 'mouse' }),
  );
  assert.equal(
    JSON.stringify(before.activeElement),
    JSON.stringify({ tagName: 'BODY', id: '', className: 'app-shell' }),
  );
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
  assert.equal(listeners.has('pointermove'), false);
  assert.equal(scope.window.__gevVisualPresentationBoundary, undefined);
});

test('visual readiness comparison rejects scrollbar layout and pointer changes', () => {
  const container = (id, scrollTop = 0) => ({
    id,
    present: true,
    rect: {
      left: 100,
      top: 20,
      right: 460,
      bottom: 820,
      width: 360,
      height: 800,
    },
    scroll: {
      left: 0,
      top: scrollTop,
      width: 360,
      height: 1200,
      clientWidth: 360,
      clientHeight: 800,
      offsetWidth: 362,
      offsetHeight: 802,
    },
    computed: {
      display: 'block',
      visibility: 'visible',
      overflowX: 'hidden',
      overflowY: 'auto',
      scrollbarGutter: 'auto',
      scrollbarWidth: 'thin',
    },
  });
  const stable = {
    pointer: { x: 1, y: 1, pointerType: 'mouse' },
    activeElement: { tagName: 'BODY', id: '', className: 'app-shell' },
    scrollContainers: [
      container('cctv-panel'),
      container('cctv-panel-inner'),
      { id: 'cctv-cyber-panel-body', present: false },
    ],
  };
  assert.equal(
    visualReadinessInputsMatch(stable, structuredClone(stable)),
    true,
  );
  const scrolled = structuredClone(stable);
  scrolled.scrollContainers[1].scroll.top = 16;
  assert.equal(visualReadinessInputsMatch(stable, scrolled), false);
  const resized = structuredClone(stable);
  resized.scrollContainers[1].rect.width = 352;
  assert.equal(visualReadinessInputsMatch(stable, resized), false);
  const movedPointer = structuredClone(stable);
  movedPointer.pointer.x = 2;
  assert.equal(visualReadinessInputsMatch(stable, movedPointer), false);
  const changedFocus = structuredClone(stable);
  changedFocus.activeElement.tagName = 'BUTTON';
  assert.equal(visualReadinessInputsMatch(stable, changedFocus), false);
  const missingInner = structuredClone(stable);
  missingInner.scrollContainers[1].present = false;
  assert.equal(visualReadinessInputsMatch(missingInner, missingInner), false);
});

function stablePresentationProof() {
  const container = (id, scrollTop = 0) => ({
    id,
    present: true,
    rect: {
      left: 100,
      top: 20,
      right: 460,
      bottom: 820,
      width: 360,
      height: 800,
    },
    scroll: {
      left: 0,
      top: scrollTop,
      width: 360,
      height: 1200,
      clientWidth: 360,
      clientHeight: 800,
      offsetWidth: 362,
      offsetHeight: 802,
    },
    computed: {
      display: 'block',
      visibility: 'visible',
      overflowX: 'hidden',
      overflowY: 'auto',
      scrollbarGutter: 'auto',
      scrollbarWidth: 'thin',
    },
  });
  return {
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
    pointer: { x: 1, y: 1, pointerType: 'mouse' },
    activeElement: { tagName: 'BODY', id: '', className: 'app-shell' },
    scrollContainers: [
      container('cctv-panel'),
      container('cctv-panel-inner'),
      { id: 'cctv-cyber-panel-body', present: false },
    ],
  };
}

test('capture settlement rejects changed CCTV scroll or geometry inputs', () => {
  const before = stablePresentationProof();
  assert.equal(
    presentationStayedSettled(before, structuredClone(before)),
    true,
  );
  const scrolled = structuredClone(before);
  scrolled.scrollContainers[1].scroll.top = 1;
  assert.equal(presentationStayedSettled(before, scrolled), false);
  const resized = structuredClone(before);
  resized.scrollContainers[1].rect.width = 359;
  assert.equal(presentationStayedSettled(before, resized), false);
});

test('capture eligibility rejects focus loss and a still-typing summary', () => {
  const proof = stablePresentationProof();
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
  const visible = stablePresentationProof();
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
