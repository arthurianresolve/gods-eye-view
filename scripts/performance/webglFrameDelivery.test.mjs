import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import {
  createStartDelay,
  readPreparationState,
} from '../fixtures/webglStartDelay.mjs';
import {
  pixelUniformValue,
  webglReportFilename,
} from '../fixtures/webglPixelMode.mjs';

const fixturePath = new URL(
  '../fixtures/webgl-frame-delivery.js',
  import.meta.url,
);

async function runFixture({
  preserveDrawingBuffer = 'true',
  pixelMode = 'static',
  modeName = 'webgl2',
  startDelayMs = '0',
  cancelPreparation = false,
  frameOffsetsMs = [16],
} = {}) {
  const source = (await readFile(fixturePath, 'utf8')).replace(
    /^import \{[\s\S]*?\} from '\.\/webgl(?:StartDelay|PixelMode)\.mjs';\r?\n/gm,
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
  const shaderSources = [];
  const uniformValues = [];
  let drawCalls = 0;
  let downloadedFilename = null;
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
  mode.value = modeName;
  const pixels = element();
  pixels.value = pixelMode;
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
    shaderSource(_shader, sourceText) {
      shaderSources.push(sourceText);
    },
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
    getUniformLocation(_program, name) {
      return { name };
    },
    uniform1f(location, value) {
      uniformValues.push({ name: location.name, value });
    },
    drawArrays() {
      drawCalls++;
    },
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
  const makeAnchor = () => ({
    href: '',
    download: '',
    click() {
      downloadedFilename = this.download;
    },
  });
  currentCanvas = makeCanvas();
  const selectors = new Map([
    ['#run', run],
    ['#download', download],
    ['#mode', mode],
    ['#pixel-mode', pixels],
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
    createElement: (tag) => (tag === 'a' ? makeAnchor() : makeCanvas()),
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
    URL: {
      createObjectURL: () => 'blob:fixture',
      revokeObjectURL() {},
    },
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
    pixelUniformValue,
    webglReportFilename,
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
  for (const offsetMs of frameOffsetsMs) {
    now = Number(startDelayMs) + offsetMs;
    const callback = rafCallback;
    assert.equal(typeof callback, 'function');
    callback();
  }
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
    uniformValues,
    drawCalls,
    shaderSources,
    downloadReport() {
      download.click();
      return downloadedFilename;
    },
  };
}

test('WebGL frame fixture preserves true by default and reports actual context/layout at both ends', async () => {
  const { report, requestedAttributes, downloadReport } = await runFixture();
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
  assert.match(
    downloadReport(),
    /webgl2-pixels-static-preserve-true-delay-0\.json$/,
  );
  assert.equal(downloadReport(), webglReportFilename(report));
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

test('static and animated pixels share the shader, uniform, and draw path', async () => {
  const frameOffsetsMs = [16, 266, 766];
  const staticRun = await runFixture({ pixelMode: 'static', frameOffsetsMs });
  const animatedRun = await runFixture({
    pixelMode: 'animated',
    frameOffsetsMs,
  });

  assert.deepEqual(staticRun.shaderSources, animatedRun.shaderSources);
  assert.equal(staticRun.drawCalls, 3);
  assert.equal(animatedRun.drawCalls, 3);
  assert.deepEqual(
    staticRun.uniformValues.map(({ name }) => name),
    ['cyanLevel', 'cyanLevel', 'cyanLevel'],
  );
  assert.deepEqual(
    animatedRun.uniformValues.map(({ name }) => name),
    ['cyanLevel', 'cyanLevel', 'cyanLevel'],
  );
  assert.ok(staticRun.uniformValues.every(({ value }) => value === 1));
  assert.ok(
    animatedRun.uniformValues.every(({ value }) => value >= 0 && value <= 1),
  );
  assert.notEqual(
    animatedRun.uniformValues[0].value,
    animatedRun.uniformValues.at(-1).value,
  );
  assert.equal(staticRun.report.pixelMode, 'static');
  assert.equal(animatedRun.report.pixelMode, 'animated');
  assert.deepEqual(staticRun.report.pixelUniform, {
    name: 'cyanLevel',
    first: { elapsedMs: 16, value: 1 },
    last: { elapsedMs: 766, value: 1 },
  });
  assert.deepEqual(animatedRun.report.pixelUniform.first, {
    elapsedMs: 16,
    value: animatedRun.uniformValues[0].value,
  });
  assert.deepEqual(animatedRun.report.pixelUniform.last, {
    elapsedMs: 766,
    value: animatedRun.uniformValues.at(-1).value,
  });
});

test('pixel uniform helper rejects unsupported modes and invalid time', () => {
  assert.equal(pixelUniformValue('static', 123), 1);
  assert.ok(pixelUniformValue('animated', 0) >= 0);
  assert.ok(pixelUniformValue('animated', 0) <= 1);
  assert.throws(() => pixelUniformValue('unknown', 0), RangeError);
  assert.throws(() => pixelUniformValue('animated', Number.NaN), RangeError);
  assert.throws(() => pixelUniformValue('animated', -1), RangeError);
});

test('plain RAF reports pixel mode as unavailable and creates no WebGL context', async () => {
  const run = await runFixture({
    modeName: 'plain-raf',
    pixelMode: 'animated',
  });
  assert.equal(run.report.mode, 'plain-raf');
  assert.equal(run.report.pixelMode, 'not-applicable');
  assert.equal(run.report.pixelUniform, null);
  assert.equal(run.report.pointCount, null);
  assert.equal(run.requestedAttributes, null);
  assert.equal(run.contextCreatedAt, null);
  assert.deepEqual(run.uniformValues, []);
  assert.equal(run.drawCalls, 0);
  assert.match(run.downloadReport(), /plain-raf-pixels-not-applicable/);
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
