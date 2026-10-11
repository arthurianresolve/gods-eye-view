import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const fixturePath = new URL('./traffic-render-demand.mjs', import.meta.url);
const fixtureSource = await readFile(fixturePath, 'utf8');
const functionStart = fixtureSource.indexOf('async function addFixtureTileset');
const functionEnd = fixtureSource.indexOf('\nfunction roads()', functionStart);
assert.ok(functionStart >= 0 && functionEnd > functionStart);
const addFixtureTilesetSource = fixtureSource.slice(functionStart, functionEnd);

class MockEvent {
  listeners = new Set();

  addEventListener(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  raise(...args) {
    for (const listener of [...this.listeners]) listener(...args);
  }
}

function createHarness({ tilesetLoaded = false, globeLoaded = false } = {}) {
  let nextTimerId = 1;
  let nextFrameId = 1;
  let nextUrlId = 1;
  let now = 25;
  const timers = new Map();
  const frames = new Map();
  const urls = new Set();
  const revokedUrls = [];
  const tileset = {
    tileVisible: new MockEvent(),
    loadProgress: new MockEvent(),
    tileFailed: new MockEvent(),
    get tilesLoaded() {
      return tilesetLoaded;
    },
  };
  const scene = {
    postRender: new MockEvent(),
    renderError: new MockEvent(),
    globe: {
      get tilesLoaded() {
        return globeLoaded;
      },
    },
    primitives: {
      add(value) {
        assert.equal(value, tileset);
      },
    },
  };
  const modelContent = class Model3DTileContent {};
  const context = vm.createContext({
    Blob: class Blob {
      constructor(parts, options) {
        this.parts = parts;
        this.type = options?.type || '';
      }
    },
    CENTER: { lon: -97, lat: 30 },
    Cesium: {
      Cartesian3: { fromDegrees: () => ({}) },
      Cesium3DTileset: { fromUrl: async () => tileset },
      Model3DTileContent: modelContent,
      Transforms: { eastNorthUpToFixedFrame: () => [1, 0, 0, 1] },
    },
    URL: {
      createObjectURL() {
        const url = `blob:fixture/${nextUrlId++}`;
        urls.add(url);
        return url;
      },
      revokeObjectURL(url) {
        revokedUrls.push(url);
        urls.delete(url);
      },
    },
    TextEncoder,
    bytesHash: async () => 'a'.repeat(64),
    makeGroundGlb: () => new Uint8Array([1, 2, 3]),
    performance: { now: () => now },
    report: {},
    surfacePostRenderFrame: 0,
    tileContentVisibleInFrame: [],
    tileContentVisibleOverflow: false,
    latestVisibleTileContent: [],
    latestVisibleTileContentOverflow: false,
    removeTileVisibleListener: null,
    requestAnimationFrame(callback) {
      const id = nextFrameId++;
      frames.set(id, callback);
      return id;
    },
    cancelAnimationFrame(id) {
      frames.delete(id);
    },
    setTimeout(callback, delayMs) {
      const id = nextTimerId++;
      timers.set(id, { callback, delayMs });
      return id;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
    viewerInstance: null,
  });
  context.viewerInstance = { scene };
  vm.runInContext(
    `${addFixtureTilesetSource}\nglobalThis.__addFixtureTileset = addFixtureTileset;`,
    context,
    { filename: 'traffic-render-demand.addFixtureTileset.test.mjs' },
  );
  return {
    context,
    tileset,
    scene,
    frames,
    timers,
    urls,
    revokedUrls,
    getNow: () => now,
    setNow: (value) => {
      now = value;
    },
    async settleMicrotasks() {
      await Promise.resolve();
      await Promise.resolve();
    },
    runFrame(id = frames.keys().next().value) {
      const callback = frames.get(id);
      assert.equal(typeof callback, 'function');
      frames.delete(id);
      callback(now);
    },
    fireTimer(id = timers.keys().next().value) {
      const timer = timers.get(id);
      assert.ok(timer);
      timers.delete(id);
      now += timer.delayMs;
      timer.callback();
    },
  };
}

test('local surface timeout preserves bounded Cesium readiness diagnostics and releases observers', async () => {
  const harness = createHarness();
  const promise = harness.context.__addFixtureTileset(
    harness.context.viewerInstance,
  );
  await harness.settleMicrotasks();

  for (let index = 0; index < 12; index++)
    harness.tileset.loadProgress.raise(index, index + 1);
  harness.tileset.tileFailed.raise({
    url: 'blob:private/omitted-url',
    message: 'fixture GLB decode failed at blob:private/omitted-url',
  });
  harness.scene.renderError.raise(harness.scene, new Error('render failed'));
  harness.tileset.tileVisible.raise({
    content: Object.assign(new harness.context.Cesium.Model3DTileContent(), {
      ready: false,
    }),
  });
  harness.scene.postRender.raise();
  harness.fireTimer();

  await assert.rejects(promise, /Local fixture tiles did not settle/);
  const progress = harness.context.report.fixtureSurfaceProgress;
  assert.equal(progress.phase, 'wait-rendered-content');
  assert.equal(progress.tilesetTilesLoaded, false);
  assert.equal(progress.globeTilesLoaded, false);
  assert.equal(progress.postRenderFrame, 1);
  assert.equal(progress.latestVisibleTileContent.length, 1);
  assert.equal(progress.latestVisibleTileContent[0].ready, false);
  assert.equal(
    progress.latestVisibleTileContent[0].model3DTileContentInstance,
    true,
  );
  assert.equal(progress.loadProgress.length, 8);
  assert.equal(progress.loadProgress[0].pendingRequests, 4);
  assert.equal(progress.tileFailures.length, 1);
  assert.equal(
    progress.tileFailures[0].message,
    'fixture GLB decode failed at [redacted-url]',
  );
  assert.equal(JSON.stringify(progress).includes('private'), false);
  assert.equal(progress.renderErrors.length, 1);
  assert.equal(harness.tileset.tileVisible.listeners.size, 0);
  assert.equal(harness.tileset.loadProgress.listeners.size, 0);
  assert.equal(harness.tileset.tileFailed.listeners.size, 0);
  assert.equal(harness.scene.renderError.listeners.size, 0);
  assert.equal(harness.scene.postRender.listeners.size, 0);
  assert.equal(harness.frames.size, 0);
  assert.equal(harness.timers.size, 0);
  assert.equal(harness.urls.size, 0);
  assert.equal(harness.revokedUrls.length, 2);
});

test('visible completed tile resolves readiness and removes every temporary observer', async () => {
  const harness = createHarness({ tilesetLoaded: true, globeLoaded: true });
  const promise = harness.context.__addFixtureTileset(
    harness.context.viewerInstance,
  );
  await harness.settleMicrotasks();
  harness.tileset.tileVisible.raise({
    content: Object.assign(new harness.context.Cesium.Model3DTileContent(), {
      ready: true,
    }),
  });
  harness.scene.postRender.raise();
  harness.runFrame();

  const result = await promise;
  assert.equal(result.tileset, harness.tileset);
  assert.equal(
    harness.context.report.fixtureSurface.renderedReadyContent[0].ready,
    true,
  );
  assert.equal(
    harness.context.report.fixtureSurface.renderedReadyContent[0]
      .model3DTileContentInstance,
    true,
  );
  assert.equal(harness.tileset.tileVisible.listeners.size, 0);
  assert.equal(harness.tileset.loadProgress.listeners.size, 0);
  assert.equal(harness.tileset.tileFailed.listeners.size, 0);
  assert.equal(harness.scene.renderError.listeners.size, 0);
  assert.equal(harness.scene.postRender.listeners.size, 0);
  assert.equal(harness.frames.size, 0);
  assert.equal(harness.timers.size, 0);
  assert.equal(harness.urls.size, 2);
});

test('readiness predicate exceptions preserve diagnostics and release frame resources', async () => {
  const harness = createHarness();
  Object.defineProperty(harness.tileset, 'tilesLoaded', {
    get() {
      throw new Error('tilesLoaded getter failed');
    },
  });
  const promise = harness.context.__addFixtureTileset(
    harness.context.viewerInstance,
  );
  await harness.settleMicrotasks();
  harness.runFrame();

  await assert.rejects(promise, /tilesLoaded getter failed/);
  const progress = harness.context.report.fixtureSurfaceProgress;
  assert.equal(progress.tilesetTilesLoaded, null);
  assert.equal(progress.readinessReadErrors[0].label, 'tileset.tilesLoaded');
  assert.equal(
    progress.readinessReadErrors[0].message,
    'tilesLoaded getter failed',
  );
  assert.equal(harness.tileset.tileVisible.listeners.size, 0);
  assert.equal(harness.tileset.loadProgress.listeners.size, 0);
  assert.equal(harness.tileset.tileFailed.listeners.size, 0);
  assert.equal(harness.scene.renderError.listeners.size, 0);
  assert.equal(harness.scene.postRender.listeners.size, 0);
  assert.equal(harness.frames.size, 0);
  assert.equal(harness.timers.size, 0);
  assert.equal(harness.urls.size, 0);
});
