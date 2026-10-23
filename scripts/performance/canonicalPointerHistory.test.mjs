import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import {
  createCanonicalPointerContract,
  installCanonicalPointerHistoryInPage,
  assertCanonicalPointerHistory,
  createCanonicalPointerSnapshotReader,
  readCanonicalPointerMutationSequence,
  acquireCanonicalPointerHistory,
} from './canonicalPointerHistory.mjs';
import { assertCanonicalVisualStateHistory } from './finalVisualQualification.mjs';

const rect = { left: 36, top: 32, width: 52, height: 34.8828125 };
const contract = (options = {}) =>
  createCanonicalPointerContract({
    logos: [{ id: '', key: 'logo-0', rect }],
    titleRect: rect,
    ...options,
  });
const clone = (value) => JSON.parse(JSON.stringify(value));

function harness(options = {}) {
  const frames = new Map(),
    timers = new Map(),
    observers = [];
  let now = 0,
    nextId = 0,
    focused = true;
  class Target {
    constructor() {
      this.listeners = new Map();
      this.captureModes = new Map();
    }
    addEventListener(type, callback, options) {
      if (!this.listeners.has(type)) this.listeners.set(type, new Set());
      this.listeners.get(type).add(callback);
      if (!this.captureModes.has(type)) this.captureModes.set(type, new Map());
      this.captureModes
        .get(type)
        .set(callback, options === true || options?.capture === true);
    }
    removeEventListener(type, callback, options) {
      if (
        this.captureModes.get(type)?.get(callback) ===
        (options === true || options?.capture === true)
      ) {
        this.listeners.get(type)?.delete(callback);
        this.captureModes.get(type)?.delete(callback);
      }
    }
    emit(type, detail = {}) {
      for (const callback of [...(this.listeners.get(type) || [])])
        if (
          !detail.target ||
          detail.target === this ||
          this.captureModes.get(type)?.get(callback)
        )
          callback({
            type,
            timeStamp: now,
            target: this,
            currentTarget: this,
            ...detail,
          });
    }
    get count() {
      return [...this.listeners.values()].reduce(
        (sum, set) => sum + set.size,
        0,
      );
    }
  }
  const part = () => ({
    attributes: new Map(),
    getAttribute(name) {
      return this.attributes.get(name) ?? null;
    },
    setAttribute(name, value) {
      const oldValue = this.getAttribute(name);
      this.attributes.set(name, value);
      for (const observer of observers)
        if (observer.targets.has(this))
          observer.records.push({
            target: this,
            attributeName: name,
            oldValue,
          });
    },
  });
  const globe = part(),
    cage = part();
  const svg = {
    removeAttribute() {},
    setAttribute() {},
    querySelector: (name) =>
      name === '#globe' ? globe : name === '#globe_cage' ? cage : null,
    cloneNode() {
      return this;
    },
  };
  const logo = {
    dataset: { logoSrc: '/logo.svg' },
    id: '',
    isConnected: true,
    style: new Proxy(
      {},
      {
        set() {
          throw new Error('The observer must not write styles');
        },
      },
    ),
    querySelector: (name) => (name === 'svg' ? svg : svg.querySelector(name)),
    replaceChildren() {},
    getBoundingClientRect: () => ({ ...rect }),
    getClientRects: () => [rect],
  };
  const doc = new Target();
  doc.documentElement = new Target();
  doc.visibilityState = 'visible';
  doc.querySelectorAll = () => [logo];
  doc.querySelector = () => logo;
  doc.hasFocus = () => focused;
  const win = new Target();
  win.matchMedia = () => ({ matches: false });
  win.fetch = async () => ({ ok: true, text: async () => '<svg/>' });
  win.requestAnimationFrame = (callback) => {
    frames.set(++nextId, callback);
    return nextId;
  };
  win.cancelAnimationFrame = (id) => frames.delete(id);
  class Observer {
    constructor(callback) {
      this.callback = callback;
      this.targets = new Set();
      this.records = [];
      observers.push(this);
    }
    observe(target) {
      this.targets.add(target);
    }
    takeRecords() {
      const records = this.records;
      this.records = [];
      return records;
    }
    disconnect() {
      this.targets.clear();
      this.records = [];
    }
  }
  const context = vm.createContext({
    window: win,
    document: doc,
    performance: { now: () => now },
    requestAnimationFrame: win.requestAnimationFrame,
    cancelAnimationFrame: win.cancelAnimationFrame,
    setTimeout: (callback) => {
      timers.set(++nextId, callback);
      return nextId;
    },
    clearTimeout: (id) => timers.delete(id),
    MutationObserver: Observer,
    DOMParser: class {
      parseFromString() {
        return { querySelector: () => null, documentElement: svg };
      }
    },
    getComputedStyle: () => ({
      display: 'inline-block',
      visibility: 'visible',
      opacity: '1',
    }),
  });
  // Run the real application animation, including easing, snap and writes.
  vm.runInContext(
    readFileSync(
      new URL('../../src/logoGaze.js', import.meta.url),
      'utf8',
    ).replaceAll('export ', '') + '\nglobalThis.stopGaze = initLogoGaze();',
    context,
  );
  const config = contract(options);
  const install = () =>
    vm.runInContext(
      `(${installCanonicalPointerHistoryInPage.toString()})(${JSON.stringify(config)})`,
      context,
    );
  const frame = (timestamp = now + 16) => {
    now = timestamp;
    for (const [id, callback] of [...frames]) {
      if (!frames.delete(id)) continue;
      callback(timestamp);
      for (const observer of observers) {
        const records = observer.takeRecords();
        if (records.length) observer.callback(records);
      }
    }
  };
  const pointer = (point, extra = {}) =>
    win.emit('pointermove', {
      clientX: point.x,
      clientY: point.y,
      isTrusted: true,
      pointerType: 'mouse',
      buttons: 0,
      ...extra,
    });
  const settle = async (index) => {
    const observer = win.__gevCanonicalPointerHistory;
    observer.begin(index);
    pointer(config.stages[index].pointer);
    const waiting = observer.wait();
    for (
      let count = 0;
      count < 100 &&
      observer.read().stages[index].status !== 'settled' &&
      !observer.read().error;
      count++
    )
      frame();
    assert.ok(
      observer.read().stages[index].status === 'settled' ||
        observer.read().error,
      JSON.stringify(observer.read()),
    );
    return clone(await waiting);
  };
  return {
    context,
    config,
    win,
    doc,
    globe,
    cage,
    frames,
    timers,
    install,
    frame,
    pointer,
    settle,
    ready: async () => {
      for (let at = 0; at < 8; at++) await Promise.resolve();
    },
    read: () => clone(win.__gevCanonicalPointerHistory.read()),
    timeout: () => {
      for (const [id, callback] of [...timers]) {
        timers.delete(id);
        callback();
      }
    },
    blur: () => {
      focused = false;
      win.emit('blur');
    },
    dispose: () => {
      win.__gevCanonicalPointerHistory?.dispose();
      vm.runInContext('stopGaze()', context);
    },
  };
}

test('fractional title bounds select predeclared integer native points with exact application transforms', () => {
  const value = contract();
  assert.deepEqual(
    value.stages.map((stage) => stage.pointer),
    [
      { x: 62, y: 49 },
      { x: 222, y: 49 },
      { x: 1, y: 1 },
    ],
  );
  assert.deepEqual(
    value.stages.map((stage) => stage.logos[0].transform),
    [
      'translate(0.00 -0.05)',
      'translate(17.00 -0.05)',
      'translate(-6.48 -5.15)',
    ],
  );
  assert.throws(() => contract({ capturePointer: { x: 1, y: 1.5 } }));
});

test('three distinct initial histories converge through identical natural off-center and capture mutations', async () => {
  const sequences = [];
  for (const initial of [
    null,
    { x: 382, y: 249.44140625 },
    { x: 62, y: 369.44140625 },
  ]) {
    const h = harness();
    await h.ready();
    if (initial) {
      h.pointer(initial);
      for (let at = 0; at < 100 && h.frames.size; at++) h.frame();
    }
    h.install();
    for (let index = 0; index < 3; index++) await h.settle(index);
    const proof = h.read();
    assertCanonicalPointerHistory(proof);
    assert.deepEqual(
      proof.stages.map((stage) => stage.stableFrames.length),
      [2, 2, 2],
    );
    sequences.push(readCanonicalPointerMutationSequence(proof));
    const before = h.win.count + h.doc.count + h.doc.documentElement.count;
    h.dispose();
    assert.equal(h.timers.size, 0);
    assert.equal(h.frames.size, 0);
    assert.equal(h.win.__gevCanonicalPointerHistory, undefined);
    assert.ok(before > h.win.count + h.doc.count + h.doc.documentElement.count);
  }
  assert.deepEqual(sequences[0], sequences[1]);
  assert.deepEqual(sequences[1], sequences[2]);
});

test('untrusted, misplaced, non-mouse, button and duplicate input fail without rewriting the page', async () => {
  for (const extra of [
    { isTrusted: false },
    { clientX: 63 },
    { pointerType: 'touch' },
    { buttons: 1 },
  ]) {
    const h = harness();
    await h.ready();
    h.install();
    h.win.__gevCanonicalPointerHistory.begin(0);
    h.pointer(h.config.stages[0].pointer, extra);
    assert.equal(
      (await h.win.__gevCanonicalPointerHistory.wait()).error,
      'untrusted-or-unexpected-pointer',
    );
    h.dispose();
  }
  const h = harness();
  await h.ready();
  h.install();
  await h.settle(0);
  h.pointer(h.config.stages[0].pointer);
  assert.equal(h.read().status, 'failed');
  h.dispose();
});

test('blur, focus, visibility and pointer reset events permanently invalidate a history', async () => {
  for (const type of [
    'blur',
    'focus',
    'focusin',
    'focusout',
    'visibilitychange',
    'pointerleave',
    'pointerdown',
    'pointerup',
    'pointercancel',
  ]) {
    const h = harness();
    await h.ready();
    h.install();
    h.win.__gevCanonicalPointerHistory.begin(0);
    const target =
      type === 'pointerleave'
        ? h.doc.documentElement
        : ['visibilitychange', 'focusin', 'focusout'].includes(type)
          ? h.doc
          : h.win;
    target.emit(type);
    assert.equal(
      (await h.win.__gevCanonicalPointerHistory.wait()).error,
      'unexpected-' + type,
    );
    h.dispose();
  }
});

test('descendant pointerleave and element blur do not impersonate native gaze resets', async () => {
  const h = harness();
  await h.ready();
  h.install();
  await h.settle(0);
  h.doc.documentElement.emit('pointerleave', { target: {}, isTrusted: true });
  h.win.emit('blur', { target: {}, isTrusted: true });
  h.win.emit('focus', { target: {}, isTrusted: true });
  h.frame();
  assert.equal(h.read().error, null);
  h.win.emit('blur', { isTrusted: true });
  assert.equal(h.read().error, 'unexpected-blur');
  assert.equal(h.read().rejectedEvents[0].targetKind, 'window');
  h.dispose();
  assert.equal(h.win.count + h.doc.count + h.doc.documentElement.count, 0);
});

test('same-value transform writes after settlement are rejected as new raster history', async () => {
  const h = harness();
  await h.ready();
  h.install();
  await h.settle(0);
  h.globe.setAttribute('transform', h.globe.getAttribute('transform'));
  assert.equal(h.read().error, 'transform-mutated-after-settlement');
  h.dispose();
});

test('acquisition retains the observed failure when focus changes between native pointer stages', async () => {
  const h = harness();
  await h.ready();
  const page = {
    mouse: { move: async (x, y) => h.pointer({ x, y }) },
    async evaluate(callback, argument) {
      const value = vm.runInContext(
        `(${callback.toString()})(${JSON.stringify(argument)})`,
        h.context,
      );
      if (value?.then) {
        for (
          let at = 0;
          at < 100 &&
          h.read().stages.at(-1).status !== 'settled' &&
          !h.read().error;
          at++
        )
          h.frame();
        assert.equal(h.read().stages.at(-1).status, 'settled');
        const proof = clone(await value);
        h.blur();
        return proof;
      }
      return value === undefined ? undefined : clone(value);
    },
  };
  await assert.rejects(acquireCanonicalPointerHistory(page), (error) => {
    assert.equal(error.pointerHistory.status, 'failed');
    assert.equal(error.pointerHistory.error, 'unexpected-blur');
    assert.equal(error.pointerHistory.stages.length, 1);
    return true;
  });
  h.dispose();
  assert.equal(h.frames.size, 0);
  assert.equal(h.timers.size, 0);
});

test('mutation caps, stalled animation timeout and disposal release owned waits', async () => {
  const limited = harness({ maximumMutations: 1 });
  await limited.ready();
  limited.install();
  limited.win.__gevCanonicalPointerHistory.begin(0);
  limited.pointer(limited.config.stages[0].pointer);
  const limitedWait = limited.win.__gevCanonicalPointerHistory.wait();
  limited.frame();
  assert.equal((await limitedWait).error, 'transform-mutation-bound-exceeded');
  limited.dispose();
  const h = harness();
  await h.ready();
  h.install();
  h.win.__gevCanonicalPointerHistory.begin(0);
  const waiting = h.win.__gevCanonicalPointerHistory.wait();
  h.timeout();
  assert.equal((await waiting).error, 'canonical-stage-timeout');
  h.dispose();
  assert.equal(h.timers.size, 0);
  const disposed = harness();
  await disposed.ready();
  disposed.install();
  disposed.win.__gevCanonicalPointerHistory.begin(0);
  const disposedWait = disposed.win.__gevCanonicalPointerHistory.wait();
  disposed.dispose();
  assert.equal((await disposedWait).error, 'canonical-observer-disposed');
});

test('duplicate RAF timestamps cannot satisfy the distinct-frame settlement', async () => {
  const h = harness();
  await h.ready();
  h.install();
  const observer = h.win.__gevCanonicalPointerHistory;
  observer.begin(0);
  h.pointer(h.config.stages[0].pointer);
  const waiting = observer.wait();
  h.frame(16);
  h.frame(16);
  assert.equal(h.read().stages[0].status, 'waiting');
  h.frame(32);
  assert.equal((await waiting).stages[0].status, 'settled');
  h.dispose();
});

test('serialized screenshot reader preserves the phase and exact history; validator rejects altered proof', async () => {
  const h = harness();
  await h.ready();
  h.install();
  for (let index = 0; index < 3; index++) await h.settle(index);
  const reader = createCanonicalPointerSnapshotReader((args) => ({
    phase: args.phase,
    paint: 'unaltered',
  }));
  const proof = clone(
    vm.runInContext(`(${reader.toString()})({phase:0})`, h.context),
  );
  assert.equal(proof.phase, 0);
  assert.equal(proof.paint, 'unaltered');
  assertCanonicalPointerHistory(proof.pointerHistory);
  for (const mutate of [
    (value) => {
      value.pointerEvents[0].trusted = false;
    },
    (value) => {
      value.stages[1].stableFrames[1].timestamp =
        value.stages[1].stableFrames[0].timestamp;
    },
    (value) => {
      value.stages[2].stableFrames[1].logos[0].cageTransform =
        'translate(0.00 0.00)';
    },
    (value) => {
      value.contract.stages[1].logos[0].transform = 'translate(1.00 0.00)';
    },
    (value) => {
      value.mutations[0].sequence = 2;
    },
    (value) => {
      value.mutations[0].part = 'shell';
    },
    (value) => {
      value.mutations.at(-1).before = 'translate(90.00 90.00)';
    },
  ]) {
    const bad = clone(proof.pointerHistory);
    mutate(bad);
    assert.throws(() => assertCanonicalPointerHistory(bad));
  }
  h.dispose();
});

test('consumer rejects boundary changes and different intermediate transforms despite equal final gaze', async () => {
  const h = harness();
  await h.ready();
  h.install();
  for (let index = 0; index < 3; index++) await h.settle(index);
  const proof = h.read();
  h.dispose();
  const phases = (value) => ({
    acquisition: clone(value),
    before: clone(value),
    after: clone(value),
  });
  const state = {
    id: 'still-settled',
    pointerHistory: { baseline: phases(proof), candidate: phases(proof) },
  };
  assertCanonicalVisualStateHistory(state);
  const missing = clone(state);
  delete missing.pointerHistory.candidate.before;
  assert.throws(() => assertCanonicalVisualStateHistory(missing));
  const boundary = clone(state);
  boundary.pointerHistory.candidate.after.pointerEvents[0].trusted = false;
  assert.throws(() => assertCanonicalVisualStateHistory(boundary));
  const changed = clone(proof);
  const first = changed.mutations.find(
    (item) => item.stage === 'off-center' && item.part === 'globe',
  );
  const next = changed.mutations.find(
    (item) =>
      item.sequence > first.sequence &&
      item.key === first.key &&
      item.part === first.part,
  );
  first.after = next.before = 'translate(1.23 -0.05)';
  assertCanonicalPointerHistory(changed);
  assert.deepEqual(changed.logos, proof.logos, 'Final geometry is identical');
  const different = clone(state);
  different.pointerHistory.candidate = phases(changed);
  assert.throws(
    () => assertCanonicalVisualStateHistory(different),
    /history differs between builds/,
  );
});
