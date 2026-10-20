import test from 'node:test';
import assert from 'node:assert/strict';
import { UiLifetime } from './uiLifetime.js';
import { PanelChrome } from './panelChrome.js';
import { PanelLayoutController } from './panelLayoutController.js';
import { PanelPositionControls } from './panelPositionControls.js';
import { ShellFeedback } from './shellFeedback.js';
import { RecordingControls } from './recordingControls.js';

function fixture() {
  const saved = Object.fromEntries(
    [
      'document',
      'window',
      'localStorage',
      'requestAnimationFrame',
      'cancelAnimationFrame',
      'setTimeout',
      'clearTimeout',
      'setInterval',
      'clearInterval',
    ].map((key) => [key, globalThis[key]]),
  );
  const frames = new Map(),
    timers = new Map();
  let next = 0;
  const element = () => {
    const classes = new Set();
    return Object.assign(new EventTarget(), {
      style: {},
      dataset: {},
      hidden: false,
      textContent: '',
      classList: {
        add: (...names) => names.forEach((name) => classes.add(name)),
        remove: (...names) => names.forEach((name) => classes.delete(name)),
        contains: (name) => classes.has(name),
        toggle: (name, active) =>
          active ? classes.add(name) : classes.delete(name),
      },
      querySelector: () => null,
      querySelectorAll: () => [],
      closest: () => null,
      getBoundingClientRect: () => ({
        left: 20,
        top: 30,
        width: 100,
        height: 80,
      }),
    });
  };
  const nodes = new Map(
    [
      'left-panel-stack',
      'right-context-rail',
      'pp-toggles',
      'toast',
      'global-loading-status',
      'global-loading-detail',
      'safe-frame-overlay',
      'safe-frame-box',
      'hud-toggle',
      'hud-layout-select',
    ].map((id) => [id, element()]),
  );
  globalThis.document = Object.assign(new EventTarget(), {
    hidden: false,
    getElementById: (id) => nodes.get(id) || null,
    querySelectorAll: () => [],
    body: element(),
  });
  globalThis.window = Object.assign(new EventTarget(), {
    innerWidth: 600,
    innerHeight: 400,
  });
  const writes = [];
  globalThis.localStorage = {
    setItem: (...args) => writes.push(args),
    getItem: () => null,
  };
  globalThis.requestAnimationFrame = (callback) => {
    frames.set(++next, callback);
    return next;
  };
  globalThis.cancelAnimationFrame = (id) => frames.delete(id);
  globalThis.setTimeout = globalThis.setInterval = (callback) => {
    timers.set(++next, callback);
    return next;
  };
  globalThis.clearTimeout = globalThis.clearInterval = (id) =>
    timers.delete(id);
  return {
    frames,
    timers,
    nodes,
    element,
    writes,
    restore() {
      Object.assign(globalThis, saved);
    },
  };
}

test('UI lifetime revokes listeners and nested presentation work synchronously', () => {
  const f = fixture();
  try {
    const owner = new UiLifetime(),
      target = new EventTarget();
    let calls = 0;
    owner.listen(target, 'change', () => calls++);
    owner.frame(() => {
      calls++;
      owner.frame(() => calls++);
    });
    owner.timeout(() => calls++, 100);
    const retainedFrame = [...f.frames.values()][0];
    owner.destroy();
    owner.destroy();
    target.dispatchEvent(new Event('change'));
    retainedFrame();
    owner.frame(() => calls++);
    owner.timeout(() => calls++, 1);
    assert.equal(calls, 0);
    assert.equal(f.frames.size + f.timers.size + owner.removers.size, 0);
  } finally {
    f.restore();
  }
});

test('one-time UI listeners and cancelled notice timers release their registrations', () => {
  const f = fixture();
  try {
    const owner = new UiLifetime(),
      target = new EventTarget();
    let calls = 0;
    owner.listen(target, 'change', () => calls++, { once: true });
    target.dispatchEvent(new Event('change'));
    target.dispatchEvent(new Event('change'));
    owner.cancelTimeout(owner.timeout(() => calls++, 100));
    assert.equal(calls, 1);
    assert.equal(owner.removers.size + owner.timers.size + f.timers.size, 0);
    owner.destroy();
  } finally {
    f.restore();
  }
});

test('panel layout coalesces each rail and cannot rearm after destruction', () => {
  const f = fixture();
  try {
    let layouts = 0;
    const owner = new PanelLayoutController({
      readHud: () => ({}),
      scheduleCockpitLayout() {},
      syncPanelCollapseButton() {},
      readDisplayScrollTop: () => 0,
    });
    owner._syncLeftPanelAdaptiveLayout = () => layouts++;
    owner._scheduleLeftPanelLayout();
    owner._scheduleLeftPanelLayout();
    assert.equal(f.frames.size, 1);
    owner._scheduleAdaptivePanelLayout({ settle: true });
    assert.equal(f.frames.size, 2);
    assert.equal(f.timers.size, 1);
    const late = [...f.frames.values(), ...f.timers.values()];
    owner.destroy();
    owner.destroy();
    late.forEach((callback) => callback());
    owner._scheduleAdaptivePanelLayout({ settle: true });
    assert.equal(layouts, 0);
    assert.equal(f.frames.size + f.timers.size, 0);
  } finally {
    f.restore();
  }
});

function pairedControllerFixture() {
  const f = fixture();
  window.matchMedia = () => ({ matches: false });
  const calls = [];
  const owner = new PanelLayoutController({
    readHud: () => ({ visible: true, variant: 'tactical' }),
    scheduleCockpitLayout() {},
    syncPanelCollapseButton() {},
    readDisplayScrollTop: () => 0,
  });
  owner._syncLeftPanelAdaptiveLayout = () => calls.push('left');
  owner._syncRightPanelAdaptiveLayout = () => calls.push('right');
  owner._syncPairedPanelAdaptiveLayout = () => calls.push('pair');
  const run = (id) => {
    const callback = f.frames.get(id);
    f.frames.delete(id);
    callback();
  };
  return { ...f, owner, calls, run };
}

for (const first of ['left', 'right']) {
  const schedulePair = (owner) => {
    if (first === 'right') owner._scheduleRightPanelLayout();
    owner._scheduleLeftPanelLayout();
    owner._scheduleRightPanelLayout();
  };
  test(`${first}-first Tactical pair consumes both callbacks without an alignment follow-up`, () => {
    const f = pairedControllerFixture();
    try {
      schedulePair(f.owner);
      const oldCallbacks = [...f.frames.values()];
      f.run(f.frames.keys().next().value);
      assert.deepEqual(f.calls, ['pair']);
      assert.equal(f.frames.size, 0);
      assert.equal(f.timers.size, 0, 'pairing adds no pause or timer');
      for (const callback of oldCallbacks) callback();
      assert.deepEqual(
        f.calls,
        ['pair'],
        'neither consumed callback may execute twice',
      );
    } finally {
      f.owner.destroy();
      f.restore();
    }
  });

  test(`${first}-first paired pass preserves newer requests against both old callbacks`, () => {
    const f = pairedControllerFixture();
    try {
      f.owner._syncPairedPanelAdaptiveLayout = () => {
        f.calls.push('pair');
        if (f.calls.length === 1) {
          f.owner._scheduleRightPanelLayout();
          f.owner._scheduleLeftPanelLayout();
        }
      };
      schedulePair(f.owner);
      const oldCallbacks = [...f.frames.values()];
      f.run(f.frames.keys().next().value);
      const nextRight = f.owner._rightStackLayoutFrame;
      const nextLeft = f.owner._leftStackLayoutFrame;
      assert.equal(f.frames.size, 2);
      oldCallbacks.forEach((callback) => callback());
      assert.equal(f.owner._rightStackLayoutFrame, nextRight);
      assert.equal(f.owner._leftStackLayoutFrame, nextLeft);
      const cancelledLeft = f.frames.get(nextLeft);
      f.run(nextRight);
      cancelledLeft();
      assert.deepEqual(f.calls, ['pair', 'pair']);
      assert.equal(f.frames.size, 0);
    } finally {
      f.owner.destroy();
      f.restore();
    }
  });

  test(`${first}-first pair uses invalidations received after scheduling`, () => {
    const f = pairedControllerFixture();
    try {
      schedulePair(f.owner);
      f.owner._scheduleLeftPanelLayout({ reconsiderAutoCollapse: true });
      const callbacks = [...f.frames.keys()];
      callbacks.forEach((id) => f.run(id));
      assert.deepEqual(
        f.calls,
        first === 'left' ? ['left', 'right'] : ['right', 'left'],
      );
      assert.equal(f.owner._leftStackReconsiderAutoCollapse, false);
      assert.equal(f.frames.size, 0);
    } finally {
      f.owner.destroy();
      f.restore();
    }
  });

  test(`${first}-first paired failure retains one right request and destruction cancels it`, () => {
    const f = pairedControllerFixture();
    try {
      f.owner._syncPairedPanelAdaptiveLayout = () => {
        f.owner._scheduleRightPanelLayout();
        throw new Error('measurement failed');
      };
      schedulePair(f.owner);
      const oldCallbacks = [...f.frames.values()];
      assert.throws(
        () => f.run(f.frames.keys().next().value),
        /measurement failed/,
      );
      assert.equal(f.frames.size, 1);
      oldCallbacks.forEach((callback) => callback());
      assert.equal(f.frames.size, 1);
      const late = [...f.frames.values()][0];
      f.owner.destroy();
      late();
      assert.deepEqual(f.calls, []);
      assert.equal(f.frames.size, 0);
    } finally {
      f.owner.destroy();
      f.restore();
    }
  });
}

for (const first of ['left', 'right'])
  for (const reason of [
    'left-reconsider',
    'right-reconsider',
    'mobile',
    'cyber',
    'placement',
  ]) {
    test(`${first}-first pairing retains separate passes for ${reason}`, () => {
      const f = pairedControllerFixture();
      try {
        if (reason === 'mobile') window.matchMedia = () => ({ matches: true });
        if (reason === 'cyber')
          f.owner.readHud = () => ({ visible: true, variant: 'cyber' });
        if (reason === 'placement') {
          const panel = { parentElement: null };
          const parent = {};
          const header = {};
          f.nodes.set('radio-panel', panel);
          f.nodes.set('global-context-panel', {
            querySelector: (selector) =>
              selector === '.panel-header' ? header : parent,
          });
          f.nodes.set('context-radio-dock', { parentElement: header });
          f.nodes.set('context-radio-mini', { parentElement: null });
        }
        const left = () =>
          f.owner._scheduleLeftPanelLayout({
            reconsiderAutoCollapse: reason === 'left-reconsider',
          });
        const right = () =>
          f.owner._scheduleRightPanelLayout({
            reconsiderAutoCollapse: reason === 'right-reconsider',
          });
        (first === 'left' ? [left, right] : [right, left]).forEach((schedule) =>
          schedule(),
        );
        [...f.frames.keys()].forEach((id) => f.run(id));
        assert.deepEqual(
          f.calls,
          first === 'left' ? ['left', 'right'] : ['right', 'left'],
        );
      } finally {
        f.owner.destroy();
        f.restore();
      }
    });
  }

test('right-first pair rechecks current viewport instead of queued eligibility', () => {
  const f = pairedControllerFixture();
  try {
    f.owner._scheduleRightPanelLayout();
    f.owner._scheduleLeftPanelLayout();
    // A viewport change must retain independent solves even though both
    // requests were made while the desktop pairing contract held.
    window.matchMedia = () => ({ matches: true });
    f.run(f.owner._rightStackLayoutFrame);
    f.run(f.owner._leftStackLayoutFrame);
    assert.deepEqual(f.calls, ['right', 'left']);
  } finally {
    f.owner.destroy();
    f.restore();
  }
});

function leftRailResizeFixture(t) {
  const f = fixture();
  const savedResize = globalThis.ResizeObserver;
  const savedMutation = globalThis.MutationObserver;
  const resizeObservers = [];
  const mutationObservers = [];
  class Observer {
    constructor(callback) {
      this.callback = callback;
      this.targets = new Set();
      this.disconnected = false;
    }
    observe(target) {
      this.targets.add(target);
    }
    disconnect() {
      this.disconnected = true;
      this.targets.clear();
    }
  }
  globalThis.ResizeObserver = class extends Observer {
    constructor(callback) {
      super(callback);
      resizeObservers.push(this);
    }
  };
  globalThis.MutationObserver = class extends Observer {
    constructor(callback) {
      super(callback);
      mutationObservers.push(this);
    }
  };
  const stack = f.nodes.get('left-panel-stack');
  const panel = f.element();
  const inner = f.element();
  const obstacle = f.element();
  const hud = f.element();
  panel.children = [inner];
  stack.querySelectorAll = () => [panel];
  document.querySelectorAll = () => [obstacle];
  f.nodes.set('intel-hud', hud);
  for (const element of [stack, panel, inner, obstacle]) {
    element.getBoundingClientRect = () =>
      assert.fail('Resize delivery must not read layout');
  }
  window.getComputedStyle = () =>
    assert.fail('Resize delivery must not read computed style');
  let layouts = 0;
  const owner = new PanelLayoutController({
    readHud: () => ({}),
    scheduleCockpitLayout() {},
    syncPanelCollapseButton() {},
    readDisplayScrollTop: () => 0,
  });
  owner._syncLeftPanelAdaptiveLayout = () => layouts++;
  owner._initLeftPanelAdaptiveLayout();
  const flush = () => {
    const frames = [...f.frames.values()];
    f.frames.clear();
    for (const callback of frames) callback();
  };
  flush();
  layouts = 0;
  const entry = (width, height, target = stack) => ({
    target,
    contentRect: { width, height },
  });
  t.after(() => {
    owner.destroy();
    if (savedResize === undefined) delete globalThis.ResizeObserver;
    else globalThis.ResizeObserver = savedResize;
    if (savedMutation === undefined) delete globalThis.MutationObserver;
    else globalThis.MutationObserver = savedMutation;
    f.restore();
  });
  return {
    ...f,
    owner,
    stack,
    panel,
    inner,
    obstacle,
    hud,
    entry,
    flush,
    resize: resizeObservers[0],
    mutation: mutationObservers[0],
    layouts: () => layouts,
  };
}

test('left rail ignores only a subsequent positive root height change', (t) => {
  const f = leftRailResizeFixture(t);
  assert.deepEqual(
    f.resize.targets,
    new Set([f.stack, f.panel, f.inner, f.obstacle]),
  );
  f.resize.callback([f.entry(360, 300)]);
  f.flush();
  assert.equal(f.layouts(), 1, 'initial observation must lay out');
  for (const height of [290, 270, 280]) {
    f.resize.callback([f.entry(360, height)]);
    assert.equal(f.frames.size, 0, 'root height alone is not a solver input');
  }
  f.resize.callback([f.entry(361, 280)]);
  f.flush();
  assert.equal(f.layouts(), 2, 'a horizontal extent change must lay out');
  f.resize.callback([f.entry(361, 280)]);
  f.flush();
  assert.equal(
    f.layouts(),
    3,
    'an unchanged box is not a proved height-only change',
  );
});

test('left rail keeps child, obstacle, mixed and ambiguous resize invalidations', (t) => {
  const f = leftRailResizeFixture(t);
  const ambiguous = [
    [],
    [f.entry(360, 280), f.entry(360, 280)],
    [f.entry(360, 280), f.entry(10, 20, f.inner)],
    [f.entry(10, 20, f.panel)],
    [f.entry(10, 20, f.obstacle)],
    [{ target: f.stack, borderBoxSize: [{ inlineSize: 360, blockSize: 280 }] }],
    [f.entry(NaN, 280)],
    [f.entry(Infinity, 280)],
    [f.entry(-1, 280)],
    [f.entry(0, 280)],
    [f.entry(360, NaN)],
    [f.entry(360, Infinity)],
    [f.entry(360, -1)],
    [f.entry(360, 0)],
  ];
  for (const records of ambiguous) {
    f.resize.callback([f.entry(360, 300)]);
    f.flush();
    const before = f.layouts();
    f.resize.callback(records);
    f.flush();
    assert.equal(f.layouts(), before + 1, 'uncertainty must retain the pass');
    f.resize.callback([f.entry(360, 250)]);
    f.flush();
    assert.equal(
      f.layouts(),
      before + 2,
      'uncertainty must reset the root baseline',
    );
  }
});

test('left rail uses physical content width and preserves independent invalidations', (t) => {
  const f = leftRailResizeFixture(t);
  f.resize.callback([f.entry(360, 300)]);
  f.flush();
  const verticalWritingEntry = f.entry(360, 280);
  verticalWritingEntry.borderBoxSize = [{ inlineSize: 280, blockSize: 360 }];
  f.resize.callback([verticalWritingEntry]);
  assert.equal(f.frames.size, 0);
  f.resize.callback([f.entry(360, 260)]);
  f.mutation.callback([{ type: 'childList', target: f.inner }]);
  f.owner._scheduleLeftPanelLayout({ reconsiderAutoCollapse: true });
  const transition = new Event('transitionend');
  Object.defineProperty(transition, 'propertyName', { value: 'visibility' });
  f.hud.dispatchEvent(transition);
  assert.equal(
    f.frames.size,
    1,
    'DOM, explicit and HUD requests still coalesce',
  );
  assert.equal(f.owner._leftStackReconsiderAutoCollapse, true);
  f.flush();
  assert.equal(f.layouts(), 2);
  f.resize.callback([f.entry(360, 240)]);
  f.owner._scheduleLeftPanelLayout();
  const retainedFrame = [...f.frames.values()][0];
  f.owner.destroy();
  assert.equal(f.resize.disconnected, true);
  assert.equal(f.mutation.disconnected, true);
  retainedFrame();
  f.resize.callback([f.entry(400, 220)]);
  f.mutation.callback([{ type: 'childList', target: f.inner }]);
  assert.equal(f.frames.size, 0);
  assert.equal(f.layouts(), 2, 'late delivery cannot rearm a destroyed owner');
});

test('left rail cockpit events and HUD theme mutations independently invalidate layout', (t) => {
  const f = leftRailResizeFixture(t);
  f.resize.callback([f.entry(360, 300)]);
  f.flush();
  f.resize.callback([f.entry(360, 280)]);
  assert.equal(f.frames.size, 0);

  window.dispatchEvent(new Event('gev:cockpit-mode-changed'));
  assert.equal(
    f.frames.size,
    2,
    'cockpit owns immediate and next-frame passes',
  );
  assert.equal(f.timers.size, 1, 'cockpit retains its settled-layout request');
  f.flush();
  assert.equal(f.layouts(), 2);
  assert.equal(f.frames.size, 1);
  f.flush();
  assert.equal(f.layouts(), 3);
  const [timerId, settle] = [...f.timers.entries()][0];
  f.timers.delete(timerId);
  settle();
  f.flush();
  assert.equal(f.layouts(), 4);

  f.resize.callback([f.entry(360, 260)]);
  assert.equal(f.frames.size, 0);
  f.mutation.callback([
    { type: 'attributes', attributeName: 'data-variant', target: f.hud },
  ]);
  f.flush();
  assert.equal(
    f.layouts(),
    5,
    'HUD theme invalidation survives root filtering',
  );
});

function allocatedRailResizeFixture(t) {
  const f = leftRailResizeFixture(t);
  document.fonts = Object.assign(new Set([{ status: 'loaded' }]), {
    status: 'loaded',
  });
  window.innerWidth = 1280;
  window.innerHeight = 537;
  window.matchMedia = () => ({ matches: false });
  f.owner.readHud = () => ({ variant: 'tactical' });
  f.panel.id = 'data-panel';
  f.panel.parentElement = f.stack;
  f.inner.parentElement = f.panel;
  f.stack.classList.add('layout-focus');
  f.panel.classList.add('active');
  f.inner.classList.add('data-panel-inner');
  const classNames = [
    'layout-focus',
    'layout-tail',
    'active',
    'collapsed',
    'panel-floating',
    'data-panel-inner',
  ];
  for (const node of [f.stack, f.panel, f.inner]) {
    const styles = new Map();
    const attributes = new Map();
    node.style = {
      getPropertyValue: (key) => styles.get(key) || '',
      setProperty: (key, value) => styles.set(key, value),
    };
    node.getAttribute = (key) =>
      key === 'class'
        ? classNames.filter((name) => node.classList.contains(name)).join(' ')
        : key === 'style'
          ? JSON.stringify([...styles])
          : (attributes.get(key) ?? null);
    node.setAttribute = (key, value) => attributes.set(key, value);
  }
  f.panel.style.setProperty('--left-panel-allocated-height', '300px');
  const box = (
    target,
    width,
    height,
    x = 0,
    y = 0,
    borderWidth = width,
    borderHeight = height,
  ) => ({
    target,
    contentRect: { x, y, width, height },
    contentBoxSize: [{ inlineSize: width, blockSize: height }],
    borderBoxSize: [{ inlineSize: borderWidth, blockSize: borderHeight }],
  });
  const boxes = (height, { root = false, rootHeight = height } = {}) => [
    ...(root ? [box(f.stack, 360, rootHeight)] : []),
    box(f.panel, 280, height),
    box(f.inner, 246, height - 28, 16, 14, 280, height),
  ];
  f.resize.callback(boxes(300, { root: true, rootHeight: 325.75 }));
  f.flush();
  const solve = (allocation = '600px', during = () => {}) => {
    const original = f.owner._syncLeftPanelAdaptiveLayout;
    f.owner._syncLeftPanelAdaptiveLayout = () => {
      original();
      f.panel.style.setProperty('--left-panel-allocated-height', allocation);
      during();
    };
    f.owner._scheduleLeftPanelLayout();
    try {
      f.flush();
    } finally {
      f.owner._syncLeftPanelAdaptiveLayout = original;
    }
  };
  return { ...f, box, boxes, solve };
}

test('one owned allocation response avoids the measured second left pass without layout reads', (t) => {
  const f = allocatedRailResizeFixture(t);
  f.solve();
  assert.ok(f.owner._leftStackAllocationResponse);
  const before = f.layouts();
  // Exact native R2 first post-solve boxes: panel 325.75; inner 297.75.
  f.resize.callback(f.boxes(325.75));
  assert.equal(f.frames.size, 0);
  assert.equal(f.layouts(), before);
  assert.equal(f.owner._leftStackAllocationResponse, null);
  // A later root transition is not covered by the already-consumed proof.
  f.resize.callback(f.boxes(328.359375, { root: true }));
  f.flush();
  assert.equal(f.layouts(), before + 1);
});

test('a joint root/panel response can use the allocation proof exactly once', (t) => {
  const f = allocatedRailResizeFixture(t);
  f.solve();
  f.resize.callback(f.boxes(328.359375, { root: true }));
  assert.equal(f.frames.size, 0);
  f.resize.callback(f.boxes(329.5, { root: true }));
  assert.equal(f.frames.size, 1);
});

for (const first of ['left', 'right'])
  test(`${first}-first paired solve arms the same one-use allocation response`, (t) => {
    const f = allocatedRailResizeFixture(t);
    let pairs = 0;
    f.owner._syncPairedPanelAdaptiveLayout = () => {
      pairs++;
      f.panel.style.setProperty('--left-panel-allocated-height', '600px');
    };
    if (first === 'right') f.owner._scheduleRightPanelLayout();
    f.owner._scheduleLeftPanelLayout();
    f.owner._scheduleRightPanelLayout();
    f.flush();
    assert.equal(pairs, 1);
    assert.equal(f.frames.size, 0);
    assert.equal(f.owner._leftStackLayoutFrame, null);
    assert.equal(f.owner._rightStackLayoutFrame, null);
    assert.ok(f.owner._leftStackAllocationResponse);
    f.resize.callback(f.boxes(325.75));
    assert.equal(f.frames.size, 0);
  });

test('right-first pair cannot arm an allocation response over a newer content invalidation', (t) => {
  const f = allocatedRailResizeFixture(t);
  f.owner._syncPairedPanelAdaptiveLayout = () => {
    f.panel.style.setProperty('--left-panel-allocated-height', '600px');
    f.owner._scheduleLeftPanelLayout();
  };
  f.owner._scheduleRightPanelLayout();
  f.owner._scheduleLeftPanelLayout();
  const first = f.owner._rightStackLayoutFrame;
  const callback = f.frames.get(first);
  f.frames.delete(first);
  callback();
  assert.equal(f.owner._leftStackAllocationResponse, null);
  assert.notEqual(f.owner._leftStackLayoutFrame, null);
  assert.equal(f.frames.size, 1);
});

for (const [name, change] of [
  ['content-only height not following the root', (f) => f.boxes(310)],
  ['inner-only content resize', (f) => f.boxes(325.75).slice(1)],
  [
    'changed panel width',
    (f) => {
      const entries = f.boxes(325.75);
      entries[0] = f.box(f.panel, 281, 325.75);
      return entries;
    },
  ],
  [
    'changed inner width',
    (f) => {
      const entries = f.boxes(325.75);
      entries[1] = f.box(f.inner, 245, 297.75, 16, 14, 280, 325.75);
      return entries;
    },
  ],
  [
    'changed inner padding',
    (f) => {
      const entries = f.boxes(325.75);
      entries[1] = f.box(f.inner, 246, 296.75, 16, 15, 280, 325.75);
      return entries;
    },
  ],
  ['mixed obstacle', (f) => [...f.boxes(325.75), f.box(f.obstacle, 10, 20)]],
  ['duplicate target', (f) => [...f.boxes(325.75), f.boxes(325.75)[0]]],
  [
    'fragmented border box',
    (f) => {
      const entries = f.boxes(325.75);
      entries[1].borderBoxSize.push({ inlineSize: 10, blockSize: 10 });
      return entries;
    },
  ],
  [
    'vertical logical axes',
    (f) => {
      const entries = f.boxes(325.75);
      entries[1].contentBoxSize = [{ inlineSize: 297.75, blockSize: 246 }];
      return entries;
    },
  ],
  ['nonfinite height', (f) => f.boxes(NaN)],
  ['zero-height hiding', (f) => f.boxes(0)],
  [
    'root width change',
    (f) => [f.box(f.stack, 361, 325.75), ...f.boxes(325.75)],
  ],
]) {
  test(`allocated left rail still measures ${name}`, (t) => {
    const f = allocatedRailResizeFixture(t);
    f.solve();
    const before = f.layouts();
    f.resize.callback(change(f));
    f.flush();
    assert.equal(f.layouts(), before + 1);
  });
}

for (const [name, invalidate] of [
  [
    'DOM content',
    (f) => f.mutation.callback([{ type: 'childList', target: f.inner }]),
  ],
  ['explicit layout', (f) => f.owner._scheduleLeftPanelLayout()],
  [
    'disclosure reconsideration',
    (f) => f.owner._scheduleLeftPanelLayout({ reconsiderAutoCollapse: true }),
  ],
  [
    'HUD theme',
    (f) =>
      f.mutation.callback([
        { type: 'attributes', target: f.hud, attributeName: 'data-variant' },
      ]),
  ],
  [
    'cockpit event',
    () => window.dispatchEvent(new Event('gev:cockpit-mode-changed')),
  ],
]) {
  test(`an owned allocation cannot erase independent ${name} invalidation`, (t) => {
    const f = allocatedRailResizeFixture(t);
    f.solve();
    const before = f.layouts();
    invalidate(f);
    assert.equal(f.owner._leftStackAllocationResponse, null);
    f.resize.callback(f.boxes(325.75));
    f.flush();
    assert.equal(f.layouts(), before + 1);
  });
}

for (const [name, change] of [
  ['viewport', () => window.innerHeight++],
  ['collapsed panel', (f) => f.panel.classList.add('collapsed')],
  ['floating panel', (f) => f.panel.classList.add('panel-floating')],
  ['hidden panel', (f) => f.panel.setAttribute('hidden', '')],
  [
    'different allocation',
    (f) => f.panel.style.setProperty('--left-panel-allocated-height', '590px'),
  ],
  ['tail mode', (f) => f.stack.classList.add('layout-tail')],
  [
    'second expanded participant',
    (f) => {
      const other = f.element();
      f.stack.querySelectorAll = () => [f.panel, other];
    },
  ],
  [
    'replaced inner',
    (f) => {
      f.panel.children = [f.element()];
    },
  ],
]) {
  test(`changed ${name} invalidates a pending allocation response`, (t) => {
    const f = allocatedRailResizeFixture(t);
    f.solve();
    const before = f.layouts();
    change(f);
    f.resize.callback(f.boxes(325.75));
    f.flush();
    assert.equal(f.layouts(), before + 1);
  });
}

test('initial boxes, unchanged allocation, failed solve and in-pass retry cannot arm a response', (t) => {
  const f = allocatedRailResizeFixture(t);
  f.solve('300px');
  assert.equal(f.owner._leftStackAllocationResponse, null);
  f.owner._leftStackResizeBoxes = new WeakMap();
  f.solve('600px');
  assert.equal(f.owner._leftStackAllocationResponse, null);
  f.resize.callback(f.boxes(325.75, { root: true }));
  f.flush();
  f.solve('610px', () => f.owner._scheduleLeftPanelLayout());
  assert.equal(f.owner._leftStackAllocationResponse, null);
  assert.equal(f.frames.size, 1, 'newer request survives the running pass');
  f.flush();
  assert.throws(
    () =>
      f.solve('620px', () => {
        throw new Error('failed solve');
      }),
    /failed solve/,
  );
  assert.equal(f.owner._leftStackAllocationResponse, null);
  f.owner.destroy();
  assert.equal(f.owner._leftStackAllocationResponse, null);
  assert.equal(f.owner._leftStackResizeBoxes.has(f.panel), false);
});

test('font loading prevents arming and a completed swap cannot consume an allocation proof', (t) => {
  const f = allocatedRailResizeFixture(t);
  document.fonts.status = 'loading';
  f.solve();
  assert.equal(f.owner._leftStackAllocationResponse, null);
  document.fonts.status = 'loaded';
  f.solve('610px');
  assert.ok(f.owner._leftStackAllocationResponse);
  document.fonts.status = 'loading';
  f.resize.callback(f.boxes(325.75));
  assert.equal(f.frames.size, 1);
  document.fonts.status = 'loaded';
  f.flush();
  const face = [...document.fonts][0];
  face.status = 'unloaded';
  f.solve('620px');
  assert.ok(f.owner._leftStackAllocationResponse);
  face.status = 'loaded';
  f.resize.callback(f.boxes(328.359375, { root: true }));
  assert.equal(
    f.frames.size,
    1,
    'a completed intervening font load retains measurement',
  );
  f.flush();
  f.solve('630px');
  document.fonts.add({ status: 'loaded' });
  f.resize.callback(f.boxes(329.5, { root: true }));
  assert.equal(
    f.frames.size,
    1,
    'new font faces also revoke the response proof',
  );
});

test('panel disposal cancels a live drag without saving or accepting later pointer movement', () => {
  const f = fixture();
  try {
    const owner = new PanelPositionControls({
      syncPanelCollapseButton() {},
      layoutRightPanels() {},
      syncCctvPanelViewport() {},
      showToast() {},
    });
    const panel = f.element(),
      handle = f.element();
    owner._makePanelDraggable('sample', panel, handle);
    handle.dispatchEvent(
      Object.assign(new Event('pointerdown', { cancelable: true }), {
        button: 0,
        clientX: 30,
        clientY: 40,
      }),
    );
    assert.equal(panel.classList.contains('panel-dragging'), true);
    owner.destroy();
    const before = { ...panel.style };
    window.dispatchEvent(
      Object.assign(new Event('pointermove'), { clientX: 500, clientY: 300 }),
    );
    window.dispatchEvent(new Event('pointerup'));
    assert.deepEqual(panel.style, before);
    assert.equal(panel.classList.contains('panel-dragging'), false);
    owner._makePanelDraggable('sample', panel, handle);
    owner._initPanelDrag();
    owner._ppToggles.style.top = '10000px';
    owner._reclampDraggablePanels();
    assert.equal(owner._ppToggles.style.top, '10000px');
    assert.equal(owner.removers.length, 0);
    assert.deepEqual(f.writes, []);
  } finally {
    f.restore();
  }
});

test('feedback disposal clears toast and polling work and rejects retained notices', () => {
  const f = fixture();
  try {
    const owner = new ShellFeedback({ readLayers: () => [] });
    owner.observeVisibility();
    owner._startTrafficChipTicker();
    owner._showToast('Saved');
    assert.equal(f.timers.size, 2);
    owner.destroy();
    owner._showToast('Late');
    owner._showGlobalStatusNotice('Late');
    owner._startTrafficChipTicker();
    document.dispatchEvent(new Event('visibilitychange'));
    assert.equal(f.timers.size, 0);
    assert.equal(f.nodes.get('toast').textContent, 'Saved');
    assert.equal(f.nodes.get('toast').classList.contains('visible'), false);
    assert.equal(f.nodes.get('global-loading-status').hidden, true);
  } finally {
    f.restore();
  }
});

test('recording restores the original HUD after repeated entry and revokes retained controls', () => {
  const f = fixture();
  try {
    let mode = 'auto',
      variant = 'tactical';
    const owner = new RecordingControls({ syncShareState() {} });
    owner.hud = {
      getMode: () => mode,
      getVariant: () => variant,
      setMode: (value) => {
        mode = value;
      },
      setVariant: (value) => {
        variant = value;
      },
      visible: true,
    };
    owner.setRecordingMode(true, { hudMode: 'minimal', safeFrame: '9:16' });
    owner.setRecordingMode(true, { hudMode: 'off' });
    owner.destroy();
    owner.setRecordingMode(true);
    assert.equal(mode, 'auto');
    assert.equal(variant, 'tactical');
    assert.equal(document.body.classList.contains('recording-mode'), false);
    assert.equal(
      f.nodes.get('safe-frame-overlay').classList.contains('active'),
      false,
    );
  } finally {
    f.restore();
  }
});

test('weather rail orders between CCTV and Context, resets positions, observes and syncs chrome', (t) => {
  const f = fixture();
  const observed = new Set();
  const previousResizeObserver = globalThis.ResizeObserver;
  globalThis.ResizeObserver = class {
    observe(node) {
      observed.add(node);
    }
    disconnect() {
      observed.clear();
    }
  };
  t.after(() => {
    if (previousResizeObserver === undefined) delete globalThis.ResizeObserver;
    else globalThis.ResizeObserver = previousResizeObserver;
  });
  try {
    const stack = f.nodes.get('right-context-rail');
    stack.children = [];
    stack.insertBefore = (panel, before) => {
      stack.children = stack.children.filter((child) => child !== panel);
      const index = before
        ? stack.children.indexOf(before)
        : stack.children.length;
      stack.children.splice(index, 0, panel);
    };
    stack.prepend = (panel) => stack.insertBefore(panel, stack.children[0]);
    for (const id of [
      'pp-toggles',
      'cctv-panel',
      'weather-panel',
      'global-context-panel',
    ]) {
      const panel = f.nodes.get(id) || f.element();
      panel.id = id;
      const positions = new Map(
        ['top', 'right', 'bottom', 'left', 'z-index'].map((key) => [
          key,
          '20px',
        ]),
      );
      panel.style = {
        removeProperty: (key) => positions.delete(key),
        positions,
      };
      panel.classList.add('panel-draggable', 'panel-dragging', 'collapsed');
      const button = f.element();
      button.closest = () => panel;
      const attributes = new Map();
      button.setAttribute = (name, value) => attributes.set(name, value);
      button.getAttribute = (name) => attributes.get(name);
      panel.button = button;
      panel.querySelectorAll = () => [button];
      panel.querySelector = (selector) =>
        selector.startsWith('.panel-title')
          ? { textContent: id === 'weather-panel' ? 'WEATHER' : id }
          : null;
      f.nodes.set(id, panel);
    }
    const weather = f.nodes.get('weather-panel');
    stack.children = [weather, f.nodes.get('global-context-panel')];
    const synced = [];
    const chrome = { _syncContextRadioLauncherState() {} };
    const owner = new PanelLayoutController({
      readHud: () => ({}),
      scheduleCockpitLayout() {},
      readDisplayScrollTop: () => 0,
      syncPanelCollapseButton(panel) {
        synced.push(panel.id);
        PanelChrome.prototype._syncPanelCollapseButton.call(chrome, panel);
      },
    });
    owner._initRightPanelAdaptiveLayout();
    assert.deepEqual(
      stack.children.map((panel) => panel.id),
      ['pp-toggles', 'cctv-panel', 'weather-panel', 'global-context-panel'],
    );
    assert.ok(synced.includes('weather-panel'));
    assert.ok(observed.has(weather));
    assert.equal(weather.style.positions.size, 0);
    assert.equal(weather.classList.contains('panel-draggable'), false);
    assert.equal(weather.classList.contains('panel-dragging'), false);
    assert.equal(weather.button.textContent, '◀');
    assert.equal(weather.button.getAttribute('aria-expanded'), 'false');
    assert.equal(weather.button.title, 'Expand WEATHER');
    weather.classList.remove('collapsed');
    PanelChrome.prototype._syncPanelCollapseButton.call(chrome, weather);
    assert.equal(weather.button.textContent, '▶');
    assert.equal(weather.button.getAttribute('aria-expanded'), 'true');
    assert.equal(weather.button.getAttribute('aria-label'), 'Collapse WEATHER');
    owner.destroy();
    assert.equal(observed.size, 0);
    assert.equal(f.frames.size, 0);
  } finally {
    f.restore();
  }
});

test('busy traffic completion is polled promptly without accelerating idle or global reads', (t) => {
  const f = fixture();
  let now = 500;
  t.mock.method(performance, 'now', () => now);
  try {
    const owner = new ShellFeedback({ readLayers: () => [] });
    let traffic = 0,
      global = 0;
    owner._updateTrafficSyncChip = () => traffic++;
    owner._updateGlobalLoadingFeedback = () => global++;
    owner._startTrafficChipTicker();
    const tick = f.timers.get(owner._trafficChipTicker);
    tick();
    assert.equal(traffic, 1);
    assert.equal(global, 1);
    now = 600;
    tick();
    assert.equal(traffic, 1, 'idle polling remains bounded');
    owner._trafficSyncFeedbackState.busy = true;
    now = 700;
    tick();
    assert.equal(traffic, 2, 'busy completion is observed on a 100 ms tick');
    assert.equal(global, 1, 'other loading feedback keeps its prior budget');
    owner._trafficSyncFeedbackState.busy = false;
    now = 800;
    tick();
    assert.equal(traffic, 2);
    document.hidden = true;
    now = 1300;
    tick();
    assert.equal(traffic, 2, 'hidden pages do no polling');
    owner.destroy();
    assert.equal(f.timers.size, 0);
  } finally {
    f.restore();
  }
});
