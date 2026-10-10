import test from 'node:test';
import assert from 'node:assert/strict';
import * as Cesium from 'cesium';
import { createCctvSource, createCctvLayer } from './index.js';
import { raceWithFallbackTimeout } from './lifecycle.js';
import { createHealth } from './health.js';

const camera = {
  id: 'pack/camera ?x',
  name: 'Camera & road',
  city: 'Austin',
  lat: 30.267,
  lon: -97.744,
  headingDeg: 45,
  fovDeg: 60,
  pitchDeg: -12,
};

function createEmptyCctvLayerWithFocusListeners(source = createCctvSource()) {
  const focusListeners = new Set();
  const spriteUnregistrations = [];
  let spriteRestoreCount = 0;
  const noop = () => {};
  const services = {
    overlays: {
      clearOverlaySource: noop,
      hitTestWorldOverlay: () => null,
      setOverlayEntries: noop,
      setOverlaySourceVisible: noop,
    },
    sprites: {
      registerSpriteCollection: noop,
      restoreSpriteOrder() {
        spriteRestoreCount++;
      },
      unregisterSpriteCollection(owner, collection) {
        spriteUnregistrations.push({ owner, collection });
      },
    },
    activation: {},
    locations: { CITY_POIS: {} },
    picking: {
      resolvePickId: () => null,
      registerPickOwner: noop,
      unregisterPickOwner: noop,
    },
    terrain: { resolveEllipsoidalGround: async () => [] },
    ground: {},
    mesh: {},
    focus: {
      focusPassIsNeeded: () => false,
      getFocusTarget: () => null,
      onFocusTargetAppear(listener) {
        focusListeners.add(listener);
        return () => focusListeners.delete(listener);
      },
    },
    render: { holdContinuousRender: noop, releaseContinuousRender: noop },
  };
  return {
    layer: createCctvLayer({ services, source }),
    focusListeners,
    getSpriteRestoreCount: () => spriteRestoreCount,
    spriteUnregistrations,
  };
}

function createCctvTestViewer() {
  const primitives = new Set();
  const entitySet = new Set();
  const event = () => {
    const listeners = new Set();
    return {
      listeners,
      addEventListener(listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      removeEventListener(listener) {
        return listeners.delete(listener);
      },
    };
  };
  const canvasListeners = new Map();
  const canvas = {
    disableRootEvents: true,
    addEventListener(type, listener) {
      const values = canvasListeners.get(type) || new Set();
      values.add(listener);
      canvasListeners.set(type, values);
    },
    removeEventListener(type, listener) {
      canvasListeners.get(type)?.delete(listener);
    },
  };
  return {
    scene: {
      canvas,
      globe: { show: false },
      primitives: {
        add(value) {
          primitives.add(value);
          return value;
        },
        remove(value) {
          return primitives.delete(value);
        },
      },
      screenSpaceCameraController: { enableInputs: true },
      pick: () => null,
    },
    camera: {
      positionWC: new Cesium.Cartesian3(6_378_137, 0, 0),
      moveEnd: event(),
      moveStart: event(),
    },
    isDestroyed: () => false,
    entities: {
      add(value) {
        const entity = { ...value };
        entitySet.add(entity);
        return entity;
      },
      remove(entity) {
        return entitySet.delete(entity);
      },
    },
    primitives,
    canvasListeners,
  };
}

test('camera catalog and health use fixed source routes and caller cancellation', async () => {
  const calls = [];
  const source = createCctvSource({
    fetchImpl: async (path, options) => {
      calls.push({ path, options });
      return new Response(
        JSON.stringify(
          path.endsWith('/sources') ? { sources: [] } : { cameras: [] },
        ),
      );
    },
  });
  const controller = new AbortController();
  await source.getCatalog({ signal: controller.signal });
  await source.getHealth({ signal: controller.signal });
  assert.deepEqual(
    calls.map((call) => call.path),
    ['/api/cctv/sources', '/api/cctv/health'],
  );
  for (const { options } of calls) {
    assert.equal(options.signal, controller.signal);
    assert.equal(options.cache, 'no-store');
  }
});

test('camera sources reject malformed snapshots and failures', async () => {
  for (const method of ['getCatalog', 'getHealth']) {
    const malformed = createCctvSource({
      fetchImpl: async () => new Response('{}'),
    });
    await assert.rejects(malformed[method](), /Malformed camera/);
    const denied = createCctvSource({
      fetchImpl: async () => new Response('', { status: 403 }),
    });
    await assert.rejects(denied[method](), /HTTP 403/);
  }
});

test('cancellation while reading a camera response body prevents publication', async () => {
  const controller = new AbortController();
  const source = createCctvSource({
    fetchImpl: async () => ({
      ok: true,
      json: async () => {
        controller.abort();
        return { sources: [] };
      },
    }),
  });
  await assert.rejects(source.getCatalog({ signal: controller.signal }), {
    name: 'AbortError',
  });
});

test('frame and media URLs preserve registered camera identity and encoded metadata', () => {
  const source = createCctvSource();
  const frame = new URL(source.getFrameUrl(camera), 'https://example.test');
  const media = new URL(source.getMediaUrl(camera), 'https://example.test');
  assert.equal(
    frame.pathname,
    '/api/cctv/frame/' + encodeURIComponent(camera.id),
  );
  assert.equal(
    media.pathname,
    '/api/cctv/media/' + encodeURIComponent(camera.id),
  );
  assert.equal(frame.searchParams.get('label'), camera.name);
  assert.equal(frame.searchParams.get('city'), camera.city);
  assert.equal(frame.searchParams.get('lat'), '30.267000');
  assert.equal(frame.searchParams.get('lon'), '-97.744000');
  assert.equal(frame.searchParams.get('heading'), '45');
  assert.equal(frame.searchParams.get('pitch'), '-12');
  assert.deepEqual([...media.searchParams.keys()], ['ts']);
});

test('camera construction is inert and destruction cancels a pending catalog and its visibility listener', async (t) => {
  const original = globalThis.document;
  const listeners = new Set();
  globalThis.document = {
    addEventListener(type, handler) {
      if (type === 'visibilitychange') listeners.add(handler);
    },
    removeEventListener(type, handler) {
      if (type === 'visibilitychange') listeners.delete(handler);
    },
  };
  t.after(() => {
    globalThis.document = original;
  });
  const noop = () => {};
  const services = {
    overlays: {
      clearOverlaySource: noop,
      hitTestWorldOverlay: noop,
      setOverlayEntries: noop,
      setOverlaySourceVisible: noop,
    },
    sprites: { registerSpriteCollection: noop },
    activation: {},
    locations: {},
    picking: { unregisterPickOwner: noop },
    terrain: {},
    ground: {},
    mesh: {},
    focus: {},
    render: { releaseContinuousRender: noop },
  };
  let resolveCatalog;
  let signal;
  const source = {
    ...createCctvSource(),
    getCatalog(options) {
      signal = options.signal;
      return new Promise((resolve) => {
        resolveCatalog = resolve;
      });
    },
  };
  const a = createCctvLayer({ services, source });
  const b = createCctvLayer({ services, source });
  assert.equal(listeners.size, 0);
  const viewer = {
    scene: { primitives: { add: (value) => value, remove: () => true } },
  };
  const initializing = a.init(viewer);
  assert.equal(listeners.size, 1);
  assert.equal(signal.aborted, false);
  a.destroy(viewer);
  assert.equal(listeners.size, 0);
  assert.equal(signal.aborted, true);
  resolveCatalog({ sources: [] });
  await assert.rejects(initializing, { name: 'AbortError' });
  assert.equal(a.getStats().count, 0);
  assert.equal(b.getStats().count, 0);
});

test('direct destroy releases the focus-appearance subscription idempotently', () => {
  const { layer, focusListeners } = createEmptyCctvLayerWithFocusListeners();
  layer.enable();
  assert.equal(focusListeners.size, 1);
  layer.destroy();
  assert.equal(focusListeners.size, 0);
  layer.destroy();
  assert.equal(focusListeners.size, 0);
});

test('disable then destroy and independent CCTV instances own separate focus listeners', (t) => {
  const first = createEmptyCctvLayerWithFocusListeners();
  const second = createEmptyCctvLayerWithFocusListeners();
  t.after(() => {
    first.layer.destroy();
    second.layer.destroy();
  });
  first.layer.enable();
  second.layer.enable();
  assert.equal(first.focusListeners.size, 1);
  assert.equal(second.focusListeners.size, 1);

  first.layer.disable();
  assert.equal(first.focusListeners.size, 0);
  first.layer.destroy();
  first.layer.destroy();
  assert.equal(first.focusListeners.size, 0);
  assert.equal(second.focusListeners.size, 1);

  second.layer.destroy();
  assert.equal(second.focusListeners.size, 0);
});

test('ground-prior fallback timeout is cleared on resolve and source abort', async () => {
  const timers = new Map();
  let nextTimerId = 0;
  const cleared = [];
  const timerApi = {
    setTimeout(callback, delay) {
      assert.equal(delay, 123);
      const id = `owned-timer-${++nextTimerId}`;
      timers.set(id, callback);
      return id;
    },
    clearTimeout(id) {
      cleared.push(id);
      timers.delete(id);
    },
  };

  assert.equal(
    await raceWithFallbackTimeout(
      Promise.resolve('ready'),
      123,
      null,
      timerApi,
    ),
    'ready',
  );
  assert.deepEqual(cleared, ['owned-timer-1']);

  const timedOut = raceWithFallbackTimeout(
    new Promise(() => {}),
    123,
    'late',
    timerApi,
  );
  timers.get('owned-timer-2')();
  assert.equal(await timedOut, 'late');
  assert.deepEqual(cleared, ['owned-timer-1', 'owned-timer-2']);

  const controller = new AbortController();
  let rejectAbort;
  const pending = raceWithFallbackTimeout(
    new Promise(() => {}),
    123,
    null,
    timerApi,
    controller.signal,
  );
  controller.abort(new Error('source replaced'));
  await assert.rejects(pending, /source replaced/);
  assert.deepEqual(cleared, [
    'owned-timer-1',
    'owned-timer-2',
    'owned-timer-3',
  ]);
});

test('an aborted health request cannot notify the successor camera', async () => {
  let resolveHealth;
  const oldAbort = new AbortController();
  const successorAbort = new AbortController();
  const notifications = [];
  const oldWindow = globalThis.window;
  class FakeCustomEvent {
    constructor(type, options) {
      this.type = type;
      this.detail = options.detail;
    }
  }
  globalThis.window = {
    CustomEvent: FakeCustomEvent,
    dispatchEvent(event) {
      notifications.push(event);
    },
  };
  try {
    const state = {
      _sourceAbort: oldAbort,
      _activeCameraId: 'successor-camera',
      _lastHealthSyncAt: 0,
      _clientHealthById: new Map(),
      _healthById: new Map(),
      _recordById: new Map([['successor-camera', { id: 'successor-camera' }]]),
    };
    const health = createHealth({
      state,
      services: {},
      parts: {
        model: { safeNumber: (value, fallback) => Number(value) || fallback },
        presentation: { getPublicCameraState: () => ({ evidence: {} }) },
      },
      source: {
        getHealth: () =>
          new Promise((resolve) => {
            resolveHealth = resolve;
          }),
      },
    });

    const pending = health.syncHealthState(true);
    state._sourceAbort = successorAbort;
    oldAbort.abort();
    resolveHealth({ cameras: [] });
    await pending;
    assert.equal(notifications.length, 0);
  } finally {
    globalThis.window = oldWindow;
  }
});

test('reinitializing a CCTV layer releases the previous viewer-owned collections and camera listeners', async (t) => {
  const oldDocument = globalThis.document;
  const oldWindow = globalThis.window;
  const documentListeners = new Map();
  const windowListeners = new Map();
  globalThis.document = {
    hidden: false,
    addEventListener(type, listener) {
      documentListeners.set(type, listener);
    },
    removeEventListener(type, listener) {
      if (documentListeners.get(type) === listener)
        documentListeners.delete(type);
    },
  };
  globalThis.window = {
    addEventListener(type, listener) {
      windowListeners.set(type, listener);
    },
    removeEventListener(type, listener) {
      if (windowListeners.get(type) === listener) windowListeners.delete(type);
    },
  };
  t.after(() => {
    globalThis.document = oldDocument;
    globalThis.window = oldWindow;
  });

  const source = createCctvSource({
    fetchImpl: async (url) =>
      new Response(
        JSON.stringify(
          url.endsWith('/sources') ? { sources: [] } : { cameras: [] },
        ),
      ),
  });
  const { layer, spriteUnregistrations } =
    createEmptyCctvLayerWithFocusListeners(source);
  t.after(() => layer.destroy());
  const firstViewer = createCctvTestViewer();
  const secondViewer = createCctvTestViewer();
  await layer.init(firstViewer);
  layer.setParams({ coverageMode: 'off', autoHop: true });
  let subscriberUpdates = 0;
  const unsubscribe = layer.subscribe(() => subscriberUpdates++);
  t.after(unsubscribe);
  assert.equal(firstViewer.primitives.size, 1);
  assert.equal(firstViewer.camera.moveEnd.listeners.size, 1);
  await layer.init(secondViewer);

  assert.equal(firstViewer.primitives.size, 0);
  assert.equal(spriteUnregistrations.length, 1);
  assert.equal(spriteUnregistrations[0].owner, 'cctv');
  assert.equal(firstViewer.camera.moveEnd.listeners.size, 0);
  assert.equal(firstViewer.camera.moveStart.listeners.size, 0);
  assert.equal(secondViewer.primitives.size, 1);
  assert.equal(secondViewer.camera.moveEnd.listeners.size, 1);
  assert.equal(secondViewer.camera.moveStart.listeners.size, 1);
  assert.equal(layer.getUIState().coverageMode, 'off');
  assert.equal(layer.getUIState().autoHop, true);
  assert.ok(subscriberUpdates > 1);
  layer.destroy(firstViewer);
  assert.equal(secondViewer.primitives.size, 0);
  assert.equal(spriteUnregistrations.length, 2);
  assert.equal(secondViewer.camera.moveEnd.listeners.size, 0);
});

test('a stale health completion after re-init cannot notify or overwrite the successor state', async (t) => {
  const oldDocument = globalThis.document;
  const oldWindow = globalThis.window;
  const notifications = [];
  class FakeCustomEvent {
    constructor(type, options) {
      this.type = type;
      this.detail = options.detail;
    }
  }
  globalThis.document = {
    hidden: false,
    addEventListener() {},
    removeEventListener() {},
  };
  globalThis.window = {
    CustomEvent: FakeCustomEvent,
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent(event) {
      notifications.push(event);
    },
  };
  t.after(() => {
    globalThis.document = oldDocument;
    globalThis.window = oldWindow;
  });

  const healthResolvers = [];
  const healthStarted = [];
  const healthStartedPromises = [0, 1].map(
    () =>
      new Promise((resolve) => {
        healthStarted.push(resolve);
      }),
  );
  const source = {
    getCatalog: async () => ({
      sources: [{ id: 'camera-a', name: 'A', lat: 30, lon: -97 }],
    }),
    getHealth: () =>
      new Promise((resolve) => {
        healthResolvers.push(resolve);
        healthStarted[healthResolvers.length - 1]?.();
      }),
    getFrameUrl: () => '/frame',
    getMediaUrl: () => '/media',
  };
  const fixture = createEmptyCctvLayerWithFocusListeners(source);
  t.after(() => fixture.layer.destroy());
  fixture.layer.setParams({ coverageMode: 'off' });
  const firstViewer = createCctvTestViewer();
  const secondViewer = createCctvTestViewer();

  const staleInit = fixture.layer.init(firstViewer);
  await healthStartedPromises[0];
  const successorInit = fixture.layer.init(secondViewer);
  await healthStartedPromises[1];
  healthResolvers[1]({
    cameras: [{ id: 'camera-a', status: 'ok', message: 'successor' }],
  });
  await successorInit;
  const notificationsAfterSuccessor = notifications.length;

  healthResolvers[0]({
    cameras: [{ id: 'camera-a', status: 'offline', message: 'stale' }],
  });
  await assert.rejects(staleInit, { name: 'AbortError' });
  assert.equal(notifications.length, notificationsAfterSuccessor);
  assert.equal(fixture.getSpriteRestoreCount(), 1);
  assert.equal(firstViewer.primitives.size, 0);
  assert.equal(secondViewer.primitives.size, 1);
  assert.equal(fixture.layer.getStats().count, 1);
});

test('a superseded init cannot publish into or release the successor viewer', async (t) => {
  const oldDocument = globalThis.document;
  const oldWindow = globalThis.window;
  globalThis.document = {
    hidden: false,
    addEventListener() {},
    removeEventListener() {},
  };
  globalThis.window = { addEventListener() {}, removeEventListener() {} };
  t.after(() => {
    globalThis.document = oldDocument;
    globalThis.window = oldWindow;
  });

  let resolveFirstCatalog;
  let catalogCalls = 0;
  const source = {
    getCatalog() {
      catalogCalls++;
      if (catalogCalls === 1)
        return new Promise((resolve) => {
          resolveFirstCatalog = resolve;
        });
      return Promise.resolve({ sources: [] });
    },
    getHealth: async () => ({ cameras: [] }),
    getFrameUrl: () => '/frame',
    getMediaUrl: () => '/media',
  };
  const fixture = createEmptyCctvLayerWithFocusListeners(source);
  t.after(() => fixture.layer.destroy());
  const oldViewer = createCctvTestViewer();
  const successorViewer = createCctvTestViewer();

  const staleInit = fixture.layer.init(oldViewer);
  const successorInit = fixture.layer.init(successorViewer);
  await successorInit;
  assert.equal(oldViewer.primitives.size, 0);
  assert.equal(successorViewer.primitives.size, 1);
  resolveFirstCatalog({ sources: [] });
  await assert.rejects(staleInit, { name: 'AbortError' });

  assert.equal(oldViewer.primitives.size, 0);
  assert.equal(successorViewer.primitives.size, 1);
  assert.equal(fixture.getSpriteRestoreCount(), 1);
});

test('frames are read through the registered frame endpoint', async () => {
  const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47]);
  const requested = [];
  const source = createCctvSource({
    fetchImpl: async (url, init) => {
      requested.push({ url, cache: init.cache });
      return new Response(png, {
        headers: { 'Content-Type': 'Image/PNG; charset=binary' },
      });
    },
  });
  const frame = await source.getFrame(camera);
  assert.equal(frame.contentType, 'image/png');
  assert.deepEqual([...frame.bytes], [...png]);
  assert.equal(
    requested[0].url.split('?')[0],
    '/api/cctv/frame/pack%2Fcamera%20%3Fx',
  );
  assert.equal(requested[0].cache, 'no-store');
  const failing = createCctvSource({
    fetchImpl: async () => new Response(null, { status: 502 }),
  });
  await assert.rejects(failing.getFrame(camera), /Camera frame HTTP 502/);
});
