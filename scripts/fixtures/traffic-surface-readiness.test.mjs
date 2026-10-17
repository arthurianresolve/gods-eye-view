import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import * as Cesium from 'cesium';

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
  const blobsByUrl = new Map();
  const revokedUrls = [];
  let capturedTilesetJson = null;
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
      tileLoadProgressEvent: new MockEvent(),
      _surface: {
        _tileLoadQueueHigh: [],
        _tileLoadQueueMedium: [],
        _tileLoadQueueLow: [],
      },
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
      Cartesian3: Cesium.Cartesian3,
      Cesium3DTileset: {
        fromUrl: async (url) => {
          const blob = blobsByUrl.get(url);
          capturedTilesetJson = JSON.parse(blob.parts.join(''));
          return tileset;
        },
      },
      Model3DTileContent: modelContent,
      Transforms: Cesium.Transforms,
    },
    URL: {
      createObjectURL(blob) {
        const url = `blob:fixture/${nextUrlId++}`;
        urls.add(url);
        blobsByUrl.set(url, blob);
        return url;
      },
      revokeObjectURL(url) {
        revokedUrls.push(url);
        urls.delete(url);
        blobsByUrl.delete(url);
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
    getCapturedTilesetJson: () => capturedTilesetJson,
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

function measureFixtureRootScreenSpaceError(tilesetJson, cameraHeightM) {
  const tileset = {
    _geometricError: tilesetJson.geometricError,
    modelMatrix: Cesium.Matrix4.IDENTITY,
    dynamicScreenSpaceError: false,
    _dynamicScreenSpaceErrorComputedDensity: 0,
    dynamicScreenSpaceErrorFactor: 0,
  };
  const rootTile = new Cesium.Cesium3DTile(
    tileset,
    Cesium.Resource.createIfNeeded('https://fixture.invalid/tileset.json'),
    tilesetJson.root,
    undefined,
  );
  const camera = {
    frustum: new Cesium.PerspectiveFrustum({
      fov: Cesium.Math.toRadians(60),
      aspectRatio: 1200 / 800,
      near: 1,
      far: 100_000,
    }),
    positionWC: Cesium.Cartesian3.fromDegrees(-97, 30, cameraHeightM),
  };
  const frameState = {
    camera,
    context: { drawingBufferWidth: 1200, drawingBufferHeight: 800 },
    mode: Cesium.SceneMode.SCENE3D,
    pixelRatio: 1,
  };
  rootTile._distanceToCamera = rootTile.distanceToTile(frameState);
  return {
    rootTraversalSse: rootTile.getScreenSpaceError(frameState, true),
    leafSse: rootTile.getScreenSpaceError(frameState, false),
    distanceToTileM: rootTile._distanceToCamera,
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
  const queuedTile = {
    level: 12,
    state: 1,
    renderable: false,
    data: { terrainState: 3 },
  };
  const queue = Array(25).fill(queuedTile);
  harness.scene.globe._surface._tileLoadQueueHigh = queue;
  for (let index = 0; index < 12; index++)
    harness.scene.globe.tileLoadProgressEvent.raise(index + 25);
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
  assert.equal(progress.globeProgressEvents, 12);
  assert.equal(progress.globeLoadProgress.length, 8);
  assert.equal(progress.globeLoadProgress[0].pendingTiles, 29);
  assert.equal(progress.globeQueues.high.count, 25);
  assert.equal(progress.globeQueues.high.sample.length, 16);
  assert.equal(progress.globeQueues.high.sample[0].terrainState, 3);
  assert.equal(harness.scene.globe._surface._tileLoadQueueHigh, queue);
  assert.equal(queue.length, 25);
  assert.equal(harness.tileset.tileVisible.listeners.size, 0);
  assert.equal(harness.tileset.loadProgress.listeners.size, 0);
  assert.equal(harness.tileset.tileFailed.listeners.size, 0);
  assert.equal(harness.scene.renderError.listeners.size, 0);
  assert.equal(harness.scene.postRender.listeners.size, 0);
  assert.equal(harness.scene.globe.tileLoadProgressEvent.listeners.size, 0);
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
  assert.equal(harness.scene.globe.tileLoadProgressEvent.listeners.size, 0);
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
  assert.equal(harness.scene.globe.tileLoadProgressEvent.listeners.size, 0);
  assert.equal(harness.frames.size, 0);
  assert.equal(harness.timers.size, 0);
  assert.equal(harness.urls.size, 0);
});

test('nonzero root geometric error enters traversal while zero-error leaf stays full detail', async () => {
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
  await promise;

  const fixtureTilesetJson = harness.getCapturedTilesetJson();
  assert.ok(fixtureTilesetJson);
  const noRootError = JSON.parse(JSON.stringify(fixtureTilesetJson));
  noRootError.geometricError = 0;

  // Cesium3DTilesetBaseTraversal.selectTiles returns before traversal when
  // root.getScreenSpaceError(frameState, true) <= memoryAdjustedScreenSpaceError.
  // This checks that gate's actual Cesium SSE input; it does not claim a render.
  for (const cameraHeightM of [12_000, 2_400]) {
    const oldRoot = measureFixtureRootScreenSpaceError(
      noRootError,
      cameraHeightM,
    );
    const correctedRoot = measureFixtureRootScreenSpaceError(
      fixtureTilesetJson,
      cameraHeightM,
    );
    assert.equal(oldRoot.rootTraversalSse, 0);
    assert.ok(oldRoot.rootTraversalSse <= 1);
    assert.ok(correctedRoot.distanceToTileM > 0);
    assert.ok(correctedRoot.rootTraversalSse > 1);
    assert.equal(correctedRoot.leafSse, 0);
    assert.equal(fixtureTilesetJson.root.geometricError, 0);
  }
});
