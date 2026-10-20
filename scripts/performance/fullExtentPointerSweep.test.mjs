import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import {
  createFullExtentPointerSweepContract,
  installFullExtentPointerSweepInPage,
  assertFullExtentPointerSweep,
  createFullExtentPointerSweepSnapshotReader,
  readFullExtentPointerSweepMutationSequence,
  acquireFullExtentPointerSweep,
  assertFullExtentCanonicalContinuity,
  disposeFullExtentPointerSweepInPage,
  createFullExtentPointerSweepPlan,
} from './fullExtentPointerSweep.mjs';
import { assertFullExtentVisualStateHistory } from './finalVisualQualification.mjs';
import {
  acquireCanonicalPointerHistory,
  disposeCanonicalPointerHistoryInPage,
} from './canonicalPointerHistory.mjs';
import { calculateLogoGaze } from '../../src/logoGaze.js';
import {
  createRepeatedVisualPlan,
  validateRepeatedVisualQualification,
} from './repeatedVisualQualification.mjs';

const rect = { left: 36, top: 32, width: 52, height: 34.8828125 };
const contract = (options = {}) =>
  createFullExtentPointerSweepContract({
    logos: [{ id: '', key: 'logo-0', rect }],
    titleRect: rect,
    viewport: { width: 1440, height: 900 },
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
    }
    addEventListener(type, callback) {
      if (!this.listeners.has(type)) this.listeners.set(type, new Set());
      this.listeners.get(type).add(callback);
    }
    removeEventListener(type, callback) {
      this.listeners.get(type)?.delete(callback);
    }
    emit(type, detail = {}) {
      for (const callback of [...(this.listeners.get(type) || [])])
        callback({ type, timeStamp: now, ...detail });
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
    innerWidth: 1440,
    innerHeight: 900,
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
      `(${installFullExtentPointerSweepInPage.toString()})(${JSON.stringify(config)})`,
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
    const observer = win.__gevFullExtentPointerSweep;
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
    read: () => clone(win.__gevFullExtentPointerSweep.read()),
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
      win.__gevFullExtentPointerSweep?.dispose();
      vm.runInContext('stopGaze()', context);
    },
  };
}

function fakePage(h) {
  return {
    mouse: { move: async (x, y) => h.pointer({ x, y }) },
    async evaluate(callback, argument) {
      const value = vm.runInContext(
        `(${callback.toString()})(${JSON.stringify(argument)})`,
        h.context,
      );
      if (!value?.then) return value === undefined ? undefined : clone(value);
      let done = false;
      value.then(() => {
        done = true;
      });
      for (let at = 0; at < 150 && !done; at++) {
        h.frame();
        await Promise.resolve();
      }
      assert.ok(done, 'Owned observer wait must complete');
      return clone(await value);
    },
  };
}

test('predeclared source equation covers every integer viewport gaze with four legal extrema', () => {
  const plan = createFullExtentPointerSweepPlan();
  assert.deepEqual(
    plan.stages.map((stage) => stage.pointer),
    [
      { x: 0, y: 49 },
      { x: 62, y: 0 },
      { x: 1439, y: 49 },
      { x: 62, y: 899 },
    ],
  );
  assert.deepEqual(plan.sourceBounds.paintedBounds, {
    minX: -6.59,
    maxX: 34,
    minY: -5.25,
    maxY: 34,
  });
  for (let y = 0; y < 900; y++)
    for (let x = 0; x < 1440; x++) {
      const gaze = calculateLogoGaze(x, y, rect);
      const px = Number(gaze.x.toFixed(2)),
        py = Number(gaze.y.toFixed(2));
      assert.ok(px >= -6.59 && px <= 34 && py >= -5.25 && py <= 34);
    }
  assert.throws(() => contract({ viewport: { width: 800, height: 600 } }));
  assert.throws(() => contract({ titleRect: { ...rect, left: 35 } }));
});

test('real unchanged application normalizes distinct earlier input through identical top/right/bottom writes', async () => {
  const normalized = [];
  for (const initial of [null, { x: 382, y: 249 }, { x: 62, y: 369 }]) {
    const h = harness();
    await h.ready();
    if (initial) {
      h.pointer(initial);
      for (let at = 0; at < 100 && h.frames.size; at++) h.frame();
    }
    const proof = await acquireFullExtentPointerSweep(fakePage(h));
    assertFullExtentPointerSweep(proof);
    normalized.push(readFullExtentPointerSweepMutationSequence(proof));
    assert.equal(h.win.__gevFullExtentPointerSweep, undefined);
    assert.ok(Object.isFrozen(h.win.__gevFullExtentPointerSweepProof));
    assert.equal(h.frames.size, 0);
    assert.equal(h.timers.size, 0);
    h.dispose();
  }
  assert.deepEqual(normalized[0], normalized[1]);
  assert.deepEqual(normalized[1], normalized[2]);
});

test('completed sweep binds to live canonical boundaries and retains an immutable snapshot after disposal', async () => {
  const h = harness();
  await h.ready();
  const page = fakePage(h);
  const sweep = await acquireFullExtentPointerSweep(page);
  const canonical = await acquireCanonicalPointerHistory(page);
  assertFullExtentCanonicalContinuity(sweep, canonical);
  const reader = createFullExtentPointerSweepSnapshotReader(() => ({
    phase: 0,
  }));
  const captured = await page.evaluate(reader);
  assert.equal(captured.phase, 0);
  assert.deepEqual(captured.fullExtentPointerSweep, sweep);
  const state = {
    id: 'still-settled',
    pointerHistory: {},
    fullExtentPointerSweep: {},
  };
  for (const side of ['baseline', 'candidate']) {
    state.pointerHistory[side] = {
      acquisition: clone(canonical),
      before: clone(canonical),
      after: clone(canonical),
    };
    state.fullExtentPointerSweep[side] = {
      acquisition: clone(sweep),
      before: clone(sweep),
      after: clone(sweep),
    };
  }
  assertFullExtentVisualStateHistory(state);
  const changed = clone(state);
  changed.fullExtentPointerSweep.candidate.after.stages[3].event.x++;
  assert.throws(() => assertFullExtentVisualStateHistory(changed));
  const disconnected = clone(canonical);
  disconnected.mutations[0].before = 'translate(0.00 0.00)';
  assert.throws(() => assertFullExtentCanonicalContinuity(sweep, disconnected));
  const future = clone(canonical);
  future.stages[0].startedAtMs = Infinity;
  assert.throws(() => assertFullExtentCanonicalContinuity(sweep, future));
  await page.evaluate(disposeCanonicalPointerHistoryInPage);
  await page.evaluate(disposeFullExtentPointerSweepInPage);
  await assert.rejects(page.evaluate(reader), /unavailable/);
  h.dispose();
  assert.equal(h.frames.size, 0);
  assert.equal(h.timers.size, 0);
  assert.equal(h.win.count + h.doc.count + h.doc.documentElement.count, 0);
});

test('consumer rejects altered source bounds, untrusted events, chronology and broken mutation chains', async () => {
  const h = harness();
  await h.ready();
  const proof = await acquireFullExtentPointerSweep(fakePage(h));
  h.dispose();
  for (const mutate of [
    (p) => {
      p.contract.viewport.width--;
    },
    (p) => {
      p.contract.sourceBounds.equation = 'different';
    },
    (p) => {
      p.stages.pop();
    },
    (p) => {
      p.pointerEvents[0].trusted = false;
    },
    (p) => {
      p.stages[0].event.atMs = NaN;
    },
    (p) => {
      p.stages[0].event.eventTimeStamp = p.stages[0].event.atMs + 1;
    },
    (p) => {
      p.stages[1].startedAtMs = -1;
    },
    (p) => {
      p.stages[1].stableFrames[1].timestamp =
        p.stages[1].stableFrames[0].timestamp;
    },
    (p) => {
      p.stages[2].stableFrames[0].atMs = -1;
    },
    (p) => {
      p.stages[3].stableFrames[1].logos[0].cageTransform = 'translate(0 0)';
    },
    (p) => {
      p.mutations[0].sequence = 2;
    },
    (p) => {
      p.mutations[0].part = 'shell';
    },
    (p) => {
      p.mutations.at(-1).before = 'translate(90 90)';
    },
    (p) => {
      p.mutations.at(-1).after = 'translate(90 90)';
    },
    (p) => {
      p.mutations.at(-1).atMs = Infinity;
    },
  ]) {
    const altered = clone(proof);
    mutate(altered);
    assert.throws(() => assertFullExtentPointerSweep(altered));
  }
});

test('unexpected input, focus loss and same-value writes after settlement permanently invalidate acquisition', async () => {
  for (const detail of [
    { isTrusted: false },
    { clientX: 1 },
    { pointerType: 'touch' },
    { buttons: 1 },
  ]) {
    const h = harness();
    await h.ready();
    h.install();
    h.win.__gevFullExtentPointerSweep.begin(0);
    h.pointer(h.config.stages[0].pointer, detail);
    assert.equal(
      (await h.win.__gevFullExtentPointerSweep.wait()).status,
      'failed',
    );
    h.dispose();
  }
  const h = harness();
  await h.ready();
  h.install();
  await h.settle(0);
  h.globe.setAttribute('transform', h.globe.getAttribute('transform'));
  assert.equal(h.read().error, 'transform-mutated-after-settlement');
  h.dispose();
  const blur = harness();
  await blur.ready();
  blur.install();
  blur.win.__gevFullExtentPointerSweep.begin(0);
  blur.blur();
  assert.equal(
    (await blur.win.__gevFullExtentPointerSweep.wait()).error,
    'unexpected-blur',
  );
  blur.dispose();
});

test('timeout, bounded mutation overflow and disposal release every owned callback', async () => {
  for (const options of [{}, { maximumMutations: 1 }]) {
    const h = harness(options);
    await h.ready();
    h.install();
    h.win.__gevFullExtentPointerSweep.begin(0);
    h.pointer(h.config.stages[0].pointer);
    const waiting = h.win.__gevFullExtentPointerSweep.wait();
    if (options.maximumMutations) h.frame();
    else h.timeout();
    assert.equal((await waiting).status, 'failed');
    h.dispose();
    assert.equal(h.frames.size, 0);
    assert.equal(h.timers.size, 0);
  }
  const h = harness();
  await h.ready();
  h.install();
  h.win.__gevFullExtentPointerSweep.begin(0);
  const waiting = h.win.__gevFullExtentPointerSweep.wait();
  h.dispose();
  assert.equal((await waiting).status, 'failed');
});

test('new repeated plans require the sweep while historical plans remain explicit legacy evidence', () => {
  const options = {
    'baseline-app-sha': 'a'.repeat(40),
    'candidate-app-sha': 'b'.repeat(40),
    'visual-harness-sha': 'c'.repeat(40),
  };
  assert.deepEqual(
    createRepeatedVisualPlan(options).fullExtentPointerSweep,
    createFullExtentPointerSweepPlan(),
  );
  assert.equal(
    createRepeatedVisualPlan(options, { legacyAcquisition: true })
      .fullExtentPointerSweep,
    undefined,
  );
});

test('a predeclared sweep batch cannot consume a historical acquisition without its proof', async () => {
  const options = {
    'baseline-app-sha': 'a'.repeat(40),
    'candidate-app-sha': 'b'.repeat(40),
    'visual-harness-sha': 'c'.repeat(40),
  };
  const planBytes = Buffer.from(
    JSON.stringify(createRepeatedVisualPlan(options)),
  );
  const pairs = Array.from({ length: 3 }, () => ({
    bytes: Buffer.from(
      JSON.stringify({ rasterPolicy: 'repeated-full-image-controls-v1' }),
    ),
  }));
  await assert.rejects(
    validateRepeatedVisualQualification({ planBytes, pairs }),
    /Pair pointer acquisition differs from the predeclared plan/,
  );
});
