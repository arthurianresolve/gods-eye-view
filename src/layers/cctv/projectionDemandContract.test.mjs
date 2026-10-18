import test from 'node:test';
import assert from 'node:assert/strict';
import * as Cesium from 'cesium';
import { createModel } from './model.js';
import { createProjection } from './projection.js';
import { createFrames } from './frames.js';
import {
  PROJECTION_ACTIVE_REFRESH_MS,
  PROJECTION_TEXTURE_SWAP_MS,
} from './policy.js';

function fixture(t) {
  let now = 100_000,
    sequence = 0,
    focus = false,
    active;
  const scheduled = new Map(),
    raf = new Map(),
    holds = new Set();
  const requests = [],
    health = [],
    listeners = new Map();
  class FakeImage {
    constructor() {
      this.urls = [];
    }
    set src(url) {
      this.urls.push(url);
    }
  }
  const document = {
    hidden: false,
    addEventListener(name, callback) {
      listeners.set(name, callback);
    },
    removeEventListener(name) {
      listeners.delete(name);
    },
    createElement(type) {
      assert.equal(type, 'canvas');
      const context = {
        blits: [],
        clearRect() {},
        fillRect() {},
        fillText() {},
        strokeRect() {},
        createLinearGradient: () => ({ addColorStop() {} }),
        drawImage(image) {
          this.blits.push(image);
        },
        getImageData: () => ({ data: new Uint8ClampedArray([1, 2, 3, 255]) }),
      };
      return { getContext: () => context };
    },
  };
  const globals = [
    'document',
    'Image',
    'requestAnimationFrame',
    'cancelAnimationFrame',
  ];
  const descriptors = new Map(
    globals.map((key) => [
      key,
      Object.getOwnPropertyDescriptor(globalThis, key),
    ]),
  );
  Object.assign(globalThis, {
    document,
    Image: FakeImage,
    requestAnimationFrame(callback) {
      const id = ++sequence;
      raf.set(id, callback);
      return id;
    },
    cancelAnimationFrame(id) {
      raf.delete(id);
    },
  });
  t.mock.method(Date, 'now', () => now);
  t.after(() => {
    projection.stopProjectionLoop();
    for (const key of globals) {
      const descriptor = descriptors.get(key);
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  });
  const state = {
    _enabled: true,
    _showProjection: true,
    _activeCameraId: 'one',
    _viewer: { entities: { add: (value) => value, remove() {} } },
    _projectionEntities: [],
    _projectionRaf: 0,
    _healthById: new Map(),
    _cctvOverlayHost: { setEntries() {}, setVisible() {}, clearSource() {} },
  };
  const parts = {
    selection: { getActiveRecord: () => active },
    rendering: { refreshCctvFocusStyles() {} },
    health: {
      recordClientHealth: (id, value) => health.push({ id, ...value }),
    },
  };
  const services = {
    focus: { focusPassIsNeeded: () => focus, getFocusTarget: () => null },
    render: {
      holdContinuousRender: (id) => holds.add(id),
      releaseContinuousRender: (id) => holds.delete(id),
      governorRequestRender: (reason) => requests.push(reason),
      scheduleRenderUpdate(owner, callback, delay) {
        const item = { callback, at: now + delay };
        scheduled.set(owner, item);
        return () => {
          if (scheduled.get(owner) === item) scheduled.delete(owner);
        };
      },
    },
  };
  const context = {
    state,
    parts,
    services,
    source: { getFrameUrl: () => '/frame' },
  };
  parts.model = createModel(context);
  parts.model.planeOrientationFor = () => Cesium.Quaternion.IDENTITY;
  parts.frames = createFrames(context);
  const projection = createProjection(context);
  const makeRecord = (id) => ({
    camera: { id, feedType: 'image' },
    frustumGeometry: { halfW: 1, halfH: 1 },
    frustumPositions: {
      capCenter: new Cesium.Cartesian3(),
      label: new Cesium.Cartesian3(),
    },
  });
  const select = (record) => {
    active = record;
    state._activeCameraId = record.camera.id;
    const runtime = projection.ensureProjectionRuntime(record);
    projection.setPlaneVisible(runtime, true);
    projection.startProjectionLoop();
    return runtime;
  };
  const record = makeRecord('one'),
    runtime = select(record);
  const next = () => {
    assert.ok(scheduled.size, 'a scheduled update is required');
    const [owner, task] = [...scheduled.entries()].sort(
      (a, b) => a[1].at - b[1].at,
    )[0];
    scheduled.delete(owner);
    now = Math.max(now, task.at);
    task.callback();
  };
  return {
    record,
    runtime,
    state,
    projection,
    parts,
    holds,
    requests,
    health,
    scheduled,
    raf,
    document,
    listeners,
    select,
    makeRecord,
    next,
    advance(ms) {
      now += ms;
    },
    setFocus(value) {
      focus = value;
    },
    frame() {
      const [id, callback] = raf.entries().next().value;
      raf.delete(id);
      callback();
    },
  };
}

test('still load and refresh wait without a continuous hold; final texture upload survives throttling', (t) => {
  const f = fixture(t);
  f.next();
  assert.equal(f.runtime.imageLoading, true);
  assert.equal(f.holds.size, 0);
  assert.equal(f.raf.size, 0);
  assert.equal(f.scheduled.size, 0);
  f.runtime.image.onload();
  assert.equal(f.runtime.ctx.blits.at(-1), f.runtime.image);
  assert.ok(f.requests.includes('cctv-still-ready'));
  assert.notEqual(f.runtime.canvasStamp, f.runtime.lastSwappedCanvasStamp);
  f.next();
  assert.equal(
    f.runtime.lastTextureSwapAt - f.runtime.lastImageRefreshAt,
    PROJECTION_TEXTURE_SWAP_MS,
  );
  assert.equal(f.runtime.canvasStamp, f.runtime.lastSwappedCanvasStamp);
  f.next();
  assert.equal(f.runtime.image.urls.length, 2);
  assert.equal(f.holds.size, 0);
  assert.equal(f.scheduled.size, 0);
});

test('failed still retries at declared cadence and recovers with its final frame', (t) => {
  const f = fixture(t);
  f.next();
  f.advance(500);
  f.runtime.image.onerror();
  const retryAt = f.runtime.nextImageRetryAt;
  for (let i = 0; i < 3 && f.runtime.image.urls.length < 2; i++) f.next();
  assert.equal(f.runtime.lastImageRefreshAt, retryAt);
  assert.equal(retryAt, 100_500 + PROJECTION_ACTIVE_REFRESH_MS);
  f.runtime.image.onload();
  assert.equal(f.health.at(-1).status, 'ok');
  assert.equal(f.holds.size, 0);
});

test('late callbacks after selection, hiding, stop and disposal cannot wake old projection', (t) => {
  const f = fixture(t);
  f.next();
  const oldLoad = f.runtime.image.onload,
    oldError = f.runtime.image.onerror;
  const nextRuntime = f.select(f.makeRecord('two'));
  f.next();
  const count = f.requests.length;
  oldLoad();
  oldError();
  assert.equal(f.requests.length, count);
  assert.equal(f.scheduled.size, 0);
  f.document.hidden = true;
  f.listeners.get('visibilitychange')();
  nextRuntime.image.onload();
  assert.equal(f.scheduled.size, 0);
  f.document.hidden = false;
  f.listeners.get('visibilitychange')();
  f.next();
  f.next(); // Complete the retained 1Hz texture swap after visibility resumes.
  assert.equal(nextRuntime.canvasStamp, nextRuntime.lastSwappedCanvasStamp);
  f.projection.stopProjectionLoop();
  nextRuntime.image.onerror();
  assert.equal(f.scheduled.size, 0);
  assert.equal(f.listeners.size, 0);
  f.projection.destroyProjectionRuntime(f.runtime);
  oldLoad();
  oldError();
  assert.equal(f.scheduled.size, 0);
});

test('settled stills do not suppress focus fades; video retains continuous demand', (t) => {
  const f = fixture(t);
  f.next();
  f.setFocus(true);
  f.projection.startProjectionLoop();
  assert.equal(f.holds.size, 1);
  f.setFocus(false);
  f.frame();
  assert.equal(f.holds.size, 0);
  assert.ok(f.requests.includes('cctv-projection-settled'));
  f.runtime.video = {};
  f.runtime.mode = 'video';
  f.projection.startProjectionLoop();
  assert.equal(f.holds.size, 1);
  f.state._showProjection = false;
  f.projection.startProjectionLoop();
  assert.equal(f.holds.size, 0);
  f.next();
  assert.equal(f.scheduled.size, 0);
  f.runtime.video = null;
});

test('slow provider completion paints before the next due fetch clears readiness', (t) => {
  const f = fixture(t);
  f.next();
  f.advance(PROJECTION_ACTIVE_REFRESH_MS + 1_000);
  f.runtime.image.onload();
  assert.equal(f.runtime.imageReady, true);
  assert.equal(f.runtime.ctx.blits.at(-1), f.runtime.image);
  assert.equal(f.runtime.canvasStamp, f.runtime.lastSwappedCanvasStamp);
  f.next();
  assert.equal(f.runtime.imageLoading, true);
  assert.equal(f.runtime.image.urls.length, 2);
  assert.equal(f.holds.size, 0);
});
