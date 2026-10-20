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
  const logoRect = { left: 10, top: 10, width: 40, height: 20 };
  const logoNode = (transform) => {
    const node = { value: transform };
    node.getAttribute = () => node.value;
    return node;
  };
  const globe = logoNode('translate(-1.00 -1.00)');
  const cage = logoNode('translate(-1.00 -1.00)');
  let logoMode = 'inline-svg';
  let reducedMotion = false;
  const image = { complete: false, naturalWidth: 0, naturalHeight: 0 };
  const svg = {
    querySelector: (selector) =>
      selector === '#globe' ? globe : selector === '#globe_cage' ? cage : null,
  };
  const logo = {
    id: '',
    className: 'title-logo',
    getClientRects: () => [logoRect],
    getBoundingClientRect: () => logoRect,
    querySelector: (selector) =>
      selector === 'svg'
        ? logoMode === 'inline-svg'
          ? svg
          : null
        : selector === 'img' && logoMode === 'fallback-image'
          ? image
          : null,
    contains: (element) => element === globe || element === cage,
  };
  const sourceBadge = {
    getBoundingClientRect: () => ({
      left: 200,
      top: 300,
      right: 260,
      bottom: 320,
      width: 60,
      height: 20,
    }),
  };
  const titleBar = {};
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
  const rootListeners = new Map();
  const scope = {
    window: {
      __godsEyeView: {
        styleManager: { hud: { _summaryTypingInterval: null, visible: true } },
      },
      addEventListener: (name, listener, options) => {
        assert.equal(options.capture, name !== 'blur');
        listeners.set(name, listener);
      },
      removeEventListener: (name, listener, capture) => {
        assert.equal(capture, name !== 'blur');
        if (listeners.get(name) === listener) listeners.delete(name);
      },
      matchMedia: () => ({ matches: reducedMotion }),
    },
    document: {
      visibilityState: 'visible',
      activeElement,
      hasFocus: () => true,
      documentElement: {
        addEventListener: (name, listener, options) => {
          assert.equal(options.capture, false);
          rootListeners.set(name, listener);
        },
        removeEventListener: (name, listener, capture) => {
          assert.equal(capture, false);
          if (rootListeners.get(name) === listener) rootListeners.delete(name);
        },
      },
      querySelectorAll: (selector) =>
        selector === '[data-logo-gaze]' ? [logo] : [],
      getAnimations: () => [],
      getElementById: (id) =>
        ({
          'intel-hud': root,
          'hud-rec-dot': dot,
          'hud-summary': summary,
          'cctv-panel': panel,
          'cctv-source-badge': sourceBadge,
          'title-bar': titleBar,
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
      transform: 'none',
      filter: 'none',
      backdropFilter: 'none',
      borderRadius: '4px',
      transitionProperty: 'none',
      transitionDuration: '0s',
      transitionDelay: '0s',
      animationName: 'none',
      animationDuration: '0s',
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
  boundary.setExpectedGaze({
    pointer: { x: 1, y: 1 },
    logos: [
      {
        id: '',
        key: 'logo-0',
        rect: logoRect,
        transform: 'translate(-1.00 -1.00)',
      },
    ],
  });
  const before = boundary.read();
  assert.equal(before.gaze.status, 'ready');
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
  const unchanged = boundary.read();
  assert.deepEqual(unchanged, before);
  assert.equal(presentationStayedSettled(before, unchanged), true);
  globe.value = 'translate(-0.20 -0.20)';
  assert.equal(boundary.read().gaze.status, 'gaze-not-settled');
  globe.value = 'translate(-1.00 -1.00)';
  listeners.get('blur')({ type: 'blur', target: {} });
  rootListeners.get('pointerleave')({ type: 'pointerleave', target: {} });
  assert.equal(boundary.read().gaze.status, 'ready');
  listeners.get('blur')({ type: 'blur', target: scope.window });
  assert.equal(boundary.read().gaze.status, 'pointer-reset-after-positioning');
  listeners.get('pointermove')({
    clientX: 1,
    clientY: 1,
    pointerType: 'mouse',
  });
  rootListeners.get('pointerleave')({
    type: 'pointerleave',
    target: scope.document.documentElement,
  });
  assert.equal(boundary.read().gaze.status, 'pointer-reset-after-positioning');
  listeners.get('pointermove')({
    clientX: 1,
    clientY: 1,
    pointerType: 'mouse',
  });
  assert.equal(boundary.read().gaze.status, 'ready');
  logoMode = 'fallback-image';
  assert.equal(boundary.read().gaze.status, 'inline-logo-not-ready');
  reducedMotion = true;
  assert.equal(boundary.read().gaze.status, 'gaze-not-settled');
  image.complete = true;
  image.naturalWidth = 64;
  image.naturalHeight = 64;
  assert.equal(boundary.read().gaze.status, 'ready');
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
  assert.equal(listeners.has('blur'), false);
  assert.equal(rootListeners.has('pointerleave'), false);
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
    gaze: settledGaze(),
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

function settledGaze({ mode = 'inline-svg', reducedMotion = false } = {}) {
  const rect = { left: 10, top: 10, width: 40, height: 20 };
  const transform = 'translate(-1.00 -1.00)';
  const logo = {
    id: '',
    key: 'logo-0',
    rect,
    mode,
    globeTransform: mode === 'inline-svg' ? transform : null,
    cageTransform: mode === 'inline-svg' ? transform : null,
    image:
      mode === 'fallback-image'
        ? { complete: true, naturalWidth: 64, naturalHeight: 64 }
        : null,
  };
  return {
    status: 'ready',
    reducedMotion,
    pointerMoveSequence: 2,
    resetSequence: 1,
    expected: {
      pointer: { x: 1, y: 1 },
      logos: [{ id: '', key: 'logo-0', rect, transform }],
    },
    logos: [logo],
    activeAnimations: [],
    animationOverflow: false,
    cctvEffects: [
      ...['cctv-panel', 'cctv-panel-inner'].map((id) => ({
        id,
        present: true,
        filter: 'none',
        backdropFilter: 'none',
        transitionProperty: 'none',
        transitionDuration: '0s',
        transitionDelay: '0s',
        animationName: 'none',
        animationDuration: '0s',
      })),
      { id: 'cctv-cyber-panel-body', present: false },
    ],
    titleStyle: {
      filter: 'none',
      transitionProperty: 'none',
      transitionDuration: '0s',
      animationName: 'none',
      animationDuration: '0s',
    },
    sourceBadge: {
      rect: { left: 1, top: 2, right: 3, bottom: 4, width: 2, height: 2 },
      filter: 'none',
      backdropFilter: 'none',
      borderRadius: '4px',
      transitionProperty: 'none',
      transitionDuration: '0s',
      animationName: 'none',
    },
  };
}

test('gaze readiness checks target transforms, resets, inline loading and fallback mode', () => {
  const proof = {
    pointer: { x: 1, y: 1, pointerType: 'mouse' },
    activeElement: { tagName: 'BODY', id: '', className: 'app-shell' },
    scrollContainers: [
      {
        id: 'cctv-panel',
        present: true,
        rect: { left: 0, top: 0, right: 20, bottom: 20, width: 20, height: 20 },
        scroll: {
          left: 0,
          top: 0,
          width: 20,
          height: 20,
          clientWidth: 20,
          clientHeight: 20,
          offsetWidth: 20,
          offsetHeight: 20,
        },
        computed: {
          display: 'block',
          visibility: 'visible',
          overflowX: 'hidden',
          overflowY: 'auto',
          scrollbarGutter: 'auto',
          scrollbarWidth: 'auto',
        },
      },
      {
        id: 'cctv-panel-inner',
        present: true,
        rect: { left: 0, top: 0, right: 20, bottom: 20, width: 20, height: 20 },
        scroll: {
          left: 0,
          top: 0,
          width: 20,
          height: 20,
          clientWidth: 20,
          clientHeight: 20,
          offsetWidth: 20,
          offsetHeight: 20,
        },
        computed: {
          display: 'block',
          visibility: 'visible',
          overflowX: 'hidden',
          overflowY: 'auto',
          scrollbarGutter: 'auto',
          scrollbarWidth: 'auto',
        },
      },
      { id: 'cctv-cyber-panel-body', present: false },
    ],
  };
  const settled = { ...proof, gaze: settledGaze() };
  assert.equal(
    visualReadinessInputsMatch(settled, structuredClone(settled)),
    true,
  );

  const drifted = structuredClone(settled);
  drifted.gaze.logos[0].globeTransform = 'translate(0.00 0.00)';
  assert.equal(visualReadinessInputsMatch(settled, drifted), false);

  const reset = structuredClone(settled);
  reset.gaze.pointerMoveSequence = reset.gaze.resetSequence;
  assert.equal(visualReadinessInputsMatch(reset, reset), false);

  const loading = structuredClone(settled);
  loading.gaze.logos[0].mode = 'fallback-image';
  loading.gaze.logos[0].image = {
    complete: false,
    naturalWidth: 0,
    naturalHeight: 0,
  };
  assert.equal(visualReadinessInputsMatch(loading, loading), false);

  const fallback = {
    ...proof,
    gaze: settledGaze({ mode: 'fallback-image', reducedMotion: true }),
  };
  assert.equal(
    visualReadinessInputsMatch(fallback, structuredClone(fallback)),
    true,
  );

  const moving = structuredClone(settled);
  moving.gaze.activeAnimations = [
    { playState: 'running', target: { tagName: 'G', id: 'globe' } },
  ];
  assert.equal(visualReadinessInputsMatch(moving, moving), false);
  for (const [field, value] of [
    ['titleStyle', null],
    ['sourceBadge', null],
    ['animationOverflow', true],
    ['cctvEffects', []],
  ]) {
    const malformed = structuredClone(settled);
    malformed.gaze[field] = value;
    assert.equal(visualReadinessInputsMatch(malformed, malformed), false);
  }
  const missingExpectedLogo = structuredClone(settled);
  missingExpectedLogo.gaze.expected.logos = [];
  assert.equal(
    visualReadinessInputsMatch(missingExpectedLogo, missingExpectedLogo),
    false,
  );
  const duplicateIdentity = structuredClone(settled);
  duplicateIdentity.gaze.logos[0].key = 'duplicate';
  duplicateIdentity.gaze.expected.logos[0].key = 'duplicate';
  duplicateIdentity.gaze.logos.push(
    structuredClone(duplicateIdentity.gaze.logos[0]),
  );
  duplicateIdentity.gaze.expected.logos.push(
    structuredClone(duplicateIdentity.gaze.expected.logos[0]),
  );
  assert.equal(
    visualReadinessInputsMatch(duplicateIdentity, duplicateIdentity),
    false,
  );
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
    gaze: settledGaze(),
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
