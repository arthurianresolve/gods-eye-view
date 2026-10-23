import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';

function eventChannel() {
  const listeners = new Set();
  return {
    addEventListener(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    removeEventListener(listener) {
      listeners.delete(listener);
    },
    raise() {
      for (const listener of [...listeners]) listener();
    },
    listenerCount() {
      return listeners.size;
    },
  };
}

const hooks = registerHooks({
  load(url, context, nextLoad) {
    const result = nextLoad(url, context);
    if (url.includes('/src/layers/traffic/policy.js'))
      return {
        ...result,
        source: String(result.source).replace('import.meta.env?.DEV', 'true'),
      };
    if (url.includes('/src/layers/traffic/factory.js'))
      return {
        ...result,
        source: String(result.source).replace(
          'return Object.assign(',
          'return Object.assign({ __trafficTimingTestHooks: { currentAnchor: () => state._trafficTimingCurrentAnchor } },',
        ),
      };
    return result;
  },
});

const originalWindow = globalThis.window;
const originalDocument = globalThis.document;
const originalSetTimeout = globalThis.setTimeout;
const originalClearTimeout = globalThis.clearTimeout;
const originalSetInterval = globalThis.setInterval;
const originalClearInterval = globalThis.clearInterval;
const originalLog = console.log;
const originalWarn = console.warn;
const timeouts = new Map();
let timerId = 0;
let trafficLayer;
let viewer;

const pendingDebounce = () => {
  const matches = [...timeouts].filter(([, timer]) => timer.delay === 320);
  assert.equal(
    matches.length,
    1,
    'exactly one traffic debounce must be pending',
  );
  return matches[0];
};

const runDebouncedLoad = async () => {
  const [id, timer] = pendingDebounce();
  timeouts.delete(id);
  await timer.callback();
};

try {
  globalThis.window = {
    location: { search: '?trafficDebug=1' },
    addEventListener() {},
  };
  const traffic = await import('../../src/layers/traffic/factory.js');
  hooks.deregister();

  const source = {
    async requestRoads() {
      return {
        ok: true,
        status: 200,
        headers: { get: () => null },
        async json() {
          return { roads: [], roadSource: 'OpenStreetMap' };
        },
      };
    },
    async getStatus() {
      return { hasKey: false };
    },
    async fetchFlowForBounds() {
      return [];
    },
    getFlowSessionStats() {
      return { tilesFetched: 0 };
    },
    resetFlowTileCache() {},
  };
  trafficLayer = traffic.createTrafficLayer({
    source,
    services: {
      credits: { showOsmCredit() {}, hideOsmCredit() {} },
      ground: { cachedGroundFloor: () => null },
      render: {
        governorRequestRender() {},
        holdContinuousRender() {},
        releaseContinuousRender() {},
      },
    },
  });

  globalThis.document = { documentElement: { dataset: {} } };
  globalThis.setTimeout = (callback, delay) => {
    const id = ++timerId;
    timeouts.set(id, { callback, delay });
    return id;
  };
  globalThis.clearTimeout = (id) => timeouts.delete(id);
  globalThis.setInterval = () => ++timerId;
  globalThis.clearInterval = () => {};
  console.log = () => {};
  console.warn = () => {};

  const preRender = eventChannel();
  const postRender = eventChannel();
  const moveEnd = eventChannel();
  const changed = eventChannel();
  let longitude = -97.74;
  const camera = {
    moveEnd,
    changed,
    percentageChanged: 0.5,
    positionCartographic: {
      latitude: Math.PI / 6,
      longitude: 0,
      height: 5000,
    },
    computeViewRectangle() {
      const west = (longitude * Math.PI) / 180;
      return {
        south: (30 * Math.PI) / 180,
        west,
        north: (30.02 * Math.PI) / 180,
        east: west + (0.02 * Math.PI) / 180,
      };
    },
  };
  const setLongitude = (next) => {
    longitude = next;
    camera.positionCartographic.longitude = (next * Math.PI) / 180;
  };
  setLongitude(longitude);
  viewer = {
    camera,
    scene: {
      canvas: { clientWidth: 0, clientHeight: 0, width: 0, height: 0 },
      preRender,
      postRender,
      primitives: { add: (primitive) => primitive, remove: () => true },
    },
  };

  performance.clearMarks();
  performance.clearMeasures();
  trafficLayer.init(viewer);
  performance.mark('traffic:stale:mark');
  performance.measure('traffic:stale:measure', {
    start: 'traffic:stale:mark',
    end: 'traffic:stale:mark',
  });
  trafficLayer.enable(viewer);
  assert.equal(trafficLayer.getTrafficTimingDiagnostics().marksInstalled, 1);
  assert.equal(moveEnd.listenerCount(), 2);
  assert.equal(performance.getEntriesByName('traffic:stale:mark').length, 0);
  assert.equal(performance.getEntriesByName('traffic:stale:measure').length, 0);

  setLongitude(-97.72);
  changed.raise();
  const anchorA = trafficLayer.__trafficTimingTestHooks.currentAnchor();
  const anchorMarkA = performance
    .getEntriesByType('mark')
    .find(
      (entry) =>
        entry.detail?.segment === 'last-camera-change' &&
        entry.detail?.interactionId === anchorA.interactionId,
    );
  assert.ok(anchorMarkA);
  assert.equal(anchorMarkA.startTime, anchorA.timestamp);
  await runDebouncedLoad();
  assert.deepEqual(trafficLayer.getTrafficTimingDiagnostics(), {
    enabled: true,
    marksInstalled: 1,
    traceObjectsCreated: 1,
    uncorrelatedTracesDropped: 0,
  });
  assert.equal(trafficLayer.__trafficTimingTestHooks.currentAnchor(), null);
  const fetchFromA = performance
    .getEntriesByType('measure')
    .find(
      (entry) =>
        entry.detail?.segment === 'last-camera-change-to-fetch-start' &&
        entry.detail?.interactionId === anchorA.interactionId,
    );
  assert.ok(fetchFromA);
  assert.equal(fetchFromA.startTime, anchorA.timestamp);

  moveEnd.raise();
  const diagnosticMoveEnd = performance
    .getEntriesByType('mark')
    .find((entry) => entry.detail?.segment === 'camera-move-end');
  assert.ok(diagnosticMoveEnd);
  assert.equal(diagnosticMoveEnd.detail.diagnosticOnly, true);
  assert.equal(diagnosticMoveEnd.detail.fetchWaitsForMoveEnd, false);
  assert.ok(
    diagnosticMoveEnd.startTime >= fetchFromA.startTime + fetchFromA.duration,
  );

  setLongitude(-97.7);
  changed.raise();
  const anchorB = trafficLayer.__trafficTimingTestHooks.currentAnchor();
  const [timerBId, timerB] = pendingDebounce();
  setLongitude(-97.68);
  changed.raise();
  const anchorC = trafficLayer.__trafficTimingTestHooks.currentAnchor();
  assert.notEqual(anchorC.interactionId, anchorB.interactionId);
  assert.equal(timeouts.has(timerBId), false);
  await timerB.callback();
  assert.equal(
    trafficLayer.__trafficTimingTestHooks.currentAnchor().interactionId,
    anchorC.interactionId,
  );
  await runDebouncedLoad();
  const diagnostics = trafficLayer.getTrafficTimingDiagnostics();
  assert.deepEqual(diagnostics, {
    enabled: true,
    marksInstalled: 1,
    traceObjectsCreated: 2,
    uncorrelatedTracesDropped: 1,
  });
  assert.ok(
    performance
      .getEntriesByType('measure')
      .some((entry) => entry.detail?.interactionId === anchorC.interactionId),
  );
  assert.ok(
    performance
      .getEntriesByType('measure')
      .every((entry) => entry.detail?.interactionId !== anchorB.interactionId),
  );

  originalLog(
    JSON.stringify({
      status: 'passed',
      diagnostics,
      staleAnchorDropped: true,
      fetchPrecededMoveEnd: true,
    }),
  );
} finally {
  hooks.deregister();
  trafficLayer?.disable(viewer);
  globalThis.window = originalWindow;
  globalThis.document = originalDocument;
  globalThis.setTimeout = originalSetTimeout;
  globalThis.clearTimeout = originalClearTimeout;
  globalThis.setInterval = originalSetInterval;
  globalThis.clearInterval = originalClearInterval;
  console.log = originalLog;
  console.warn = originalWarn;
  performance.clearMarks();
  performance.clearMeasures();
}
