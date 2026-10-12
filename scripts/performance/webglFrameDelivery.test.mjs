import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import {
  createStartDelay,
  readPreparationState,
} from '../fixtures/webglStartDelay.mjs';

const fixturePath = new URL(
  '../fixtures/webgl-frame-delivery.js',
  import.meta.url,
);

async function runFixture({
  preserveDrawingBuffer = 'true',
  startDelayMs = '0',
  cancelPreparation = false,
} = {}) {
  const source = (await readFile(fixturePath, 'utf8')).replace(
    /^import \{[\s\S]*?\} from '\.\/webglStartDelay\.mjs';\r?\n/m,
    '',
  );
  let now = 0;
  let currentCanvas;
  let nextRafId = 1;
  let rafCallback;
  let endCallback;
  let delayCallback;
  let nextTimeoutId = 1;
  let scheduledTimeouts = 0;
  const timeoutCallbacks = new Map();
  let rectReads = 0;
  let requestedAttributes = null;
  let contextCreatedAt = null;
  const listeners = new Map();
  const element = () => ({
    disabled: false,
    value: '',
    textContent: '',
    addEventListener(type, callback) {
      this[type] = callback;
    },
    removeEventListener() {},
  });
  const run = element();
  const download = element();
  const mode = element();
  mode.value = 'webgl2';
  const preserve = element();
  preserve.value = preserveDrawingBuffer;
  const delay = element();
  delay.value = startDelayMs;
  const cancel = element();
  const status = element();
  const result = element();
  const webgl = {
    VERTEX_SHADER: 1,
    FRAGMENT_SHADER: 2,
    COMPILE_STATUS: 3,
    LINK_STATUS: 4,
    COLOR_BUFFER_BIT: 5,
    RENDERER: 6,
    createShader: () => ({}),
    shaderSource() {},
    compileShader() {},
    getShaderParameter: () => true,
    getShaderInfoLog: () => '',
    deleteShader() {},
    createProgram: () => ({}),
    attachShader() {},
    linkProgram() {},
    getProgramParameter: () => true,
    getProgramInfoLog: () => '',
    deleteProgram() {},
    viewport() {},
    clearColor() {},
    clear() {},
    useProgram() {},
    drawArrays() {},
    getContextAttributes() {
      return {
        alpha: requestedAttributes.alpha,
        antialias: requestedAttributes.antialias,
        depth: true,
        stencil: requestedAttributes.stencil,
        premultipliedAlpha: true,
        preserveDrawingBuffer: requestedAttributes.preserveDrawingBuffer,
      };
    },
    getExtension(name) {
      if (name === 'WEBGL_debug_renderer_info')
        return { UNMASKED_RENDERER_WEBGL: 7 };
      if (name === 'WEBGL_lose_context') return { loseContext() {} };
      return null;
    },
    getParameter: () => 'Mock WebGL',
  };
  const makeCanvas = () => ({
    id: 'surface',
    width: 640,
    height: 360,
    addEventListener() {},
    removeEventListener() {},
    replaceWith(next) {
      currentCanvas = next;
    },
    getContext(type, attributes) {
      assert.equal(type, 'webgl2');
      contextCreatedAt = now;
      requestedAttributes = { ...attributes };
      return webgl;
    },
    getBoundingClientRect() {
      rectReads += 1;
      const left = rectReads === 1 ? 10 : 20;
      return {
        left,
        top: 30,
        right: left + 640,
        bottom: 390,
        width: 640,
        height: 360,
      };
    },
  });
  currentCanvas = makeCanvas();
  const selectors = new Map([
    ['#run', run],
    ['#download', download],
    ['#mode', mode],
    ['#preserve-drawing-buffer', preserve],
    ['#start-delay', delay],
    ['#cancel', cancel],
    ['#status', status],
    ['#result', result],
    ['#surface', currentCanvas],
  ]);
  const document = {
    visibilityState: 'visible',
    hasFocus: () => true,
    querySelector: (selector) => selectors.get(selector),
    createElement: () => makeCanvas(),
    addEventListener(type, callback) {
      listeners.set(`document:${type}`, callback);
    },
    removeEventListener(type) {
      listeners.delete(`document:${type}`);
    },
  };
  const window = {
    innerWidth: 894,
    innerHeight: 585,
    addEventListener(type, callback) {
      listeners.set(`window:${type}`, callback);
    },
    removeEventListener(type) {
      listeners.delete(`window:${type}`);
    },
  };
  const scheduleTimeout = (callback, timeoutMs) => {
    const id = nextTimeoutId++;
    scheduledTimeouts++;
    timeoutCallbacks.set(id, callback);
    if (timeoutMs === 5000) endCallback = callback;
    else if (timeoutMs === Number(startDelayMs)) delayCallback = callback;
    return id;
  };
  const clearScheduledTimeout = (id) => {
    const callback = timeoutCallbacks.get(id);
    timeoutCallbacks.delete(id);
    if (callback === delayCallback) delayCallback = null;
    if (callback === endCallback) endCallback = null;
  };
  const context = vm.createContext({
    __GEV_APP_COMMIT__: 'a'.repeat(40),
    document,
    window,
    navigator: { userAgent: 'Mock browser' },
    performance: { now: () => now },
    requestAnimationFrame(callback) {
      rafCallback = callback;
      return nextRafId++;
    },
    cancelAnimationFrame() {
      rafCallback = null;
    },
    clearTimeout: clearScheduledTimeout,
    setInterval() {
      return nextTimeoutId++;
    },
    clearInterval() {},
    URL,
    Blob,
    JSON,
    Math,
    String,
    Error,
    createStartDelay: (options) =>
      createStartDelay({
        ...options,
        setTimer: scheduleTimeout,
        clearTimer: clearScheduledTimeout,
      }),
    readPreparationState,
    setTimeout: scheduleTimeout,
  });
  selectors.set('#surface', currentCanvas);
  vm.runInContext(source, context, { filename: 'webgl-frame-delivery.js' });
  run.click();
  if (Number(startDelayMs) > 0) {
    assert.equal(
      status.textContent,
      'Waiting before the five-second observation',
    );
    run.click();
    if (cancelPreparation) {
      cancel.click();
      await new Promise((resolve) => setImmediate(resolve));
      return {
        report: JSON.parse(result.textContent),
        requestedAttributes,
        contextCreatedAt,
        cancel,
        run,
        scheduledTimeouts,
      };
    }
    now = Number(startDelayMs);
    delayCallback();
    await new Promise((resolve) => setImmediate(resolve));
  }
  now = Number(startDelayMs) + 16;
  rafCallback();
  now = Number(startDelayMs) + 5001;
  endCallback();
  assert.ok(result.textContent);
  return {
    report: JSON.parse(result.textContent),
    requestedAttributes,
    contextCreatedAt,
    cancel,
    run,
    scheduledTimeouts,
  };
}

test('WebGL frame fixture preserves true by default and reports actual context/layout at both ends', async () => {
  const { report, requestedAttributes } = await runFixture();
  assert.equal(requestedAttributes.preserveDrawingBuffer, true);
  assert.equal(requestedAttributes.antialias, true);
  assert.equal(report.preserveDrawingBufferRequested, true);
  assert.equal(report.contextAttributesAtStart.preserveDrawingBuffer, true);
  assert.equal(report.contextAttributesAtEnd.preserveDrawingBuffer, true);
  assert.equal(report.contextAttributesAtStart.antialias, true);
  assert.equal(report.contextAttributesAtEnd.antialias, true);
  assert.equal(report.pointCount, 5000);
  assert.equal(report.canvasBoundsAtStart.canvas.rect.left, 10);
  assert.equal(report.canvasBoundsAtEnd.canvas.rect.left, 20);
  assert.equal(report.canvasBoundsAtStart.viewport.width, 894);
  assert.equal(report.canvasBoundsAtEnd.viewport.height, 585);
});

test('WebGL frame fixture can request false without changing other context settings', async () => {
  const { report, requestedAttributes } = await runFixture({
    preserveDrawingBuffer: 'false',
  });
  assert.equal(requestedAttributes.preserveDrawingBuffer, false);
  assert.equal(requestedAttributes.antialias, true);
  assert.equal(requestedAttributes.alpha, false);
  assert.equal(requestedAttributes.powerPreference, 'high-performance');
  assert.equal(requestedAttributes.stencil, true);
  assert.equal(report.preserveDrawingBufferRequested, false);
  assert.equal(report.contextAttributesAtStart.preserveDrawingBuffer, false);
  assert.equal(report.contextAttributesAtEnd.preserveDrawingBuffer, false);
  assert.equal(report.pointCount, 5000);
});

test('delayed start precedes context setup and records delay separately from the window', async () => {
  const { report, contextCreatedAt, requestedAttributes } = await runFixture({
    startDelayMs: '10000',
  });
  assert.equal(report.preparation.requestedDelayMs, 10000);
  assert.equal(report.preparation.actualDelayMs, 10000);
  assert.equal(report.preparation.outcome, 'elapsed');
  assert.deepEqual(report.preparation.changes, {
    focus: false,
    visibility: false,
    viewport: false,
  });
  assert.equal(report.elapsedMs, 5001);
  assert.equal(contextCreatedAt, 10000);
  assert.ok(report.contextSetupElapsedMs >= 0);
  assert.equal(requestedAttributes.antialias, true);
  assert.equal(requestedAttributes.preserveDrawingBuffer, true);
  assert.equal(report.pointCount, 5000);
});

test('cancel during preparation records cancellation without starting measurement', async () => {
  const { report, cancel, run, scheduledTimeouts, requestedAttributes } =
    await runFixture({
      startDelayMs: '10000',
      cancelPreparation: true,
    });
  assert.equal(report.outcome, 'cancelled-before-start');
  assert.equal(report.preparation.outcome, 'cancelled');
  assert.equal(report.preparation.cancelReason, 'user-cancelled');
  assert.equal(report.frames, 0);
  assert.equal(cancel.disabled, true);
  assert.equal(run.disabled, false);
  assert.equal(scheduledTimeouts, 1);
  assert.equal(requestedAttributes, null);
});
