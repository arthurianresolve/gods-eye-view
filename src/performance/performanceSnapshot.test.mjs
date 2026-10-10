import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createPerformanceMonitor,
  PerformanceSnapshot,
} from './performanceSnapshot.js';

test('performance snapshot is bounded and serializable', () => {
  let now = 100;
  const snapshot = new PerformanceSnapshot({ now: () => now });
  for (let i = 0; i < 125; i++) snapshot.record('frame', i);
  snapshot.count('renders');
  now = 140;
  const report = snapshot.snapshot({ settings: { densityPct: 75 } });
  assert.equal(report.schema, 'gev-performance-snapshot/v1');
  assert.equal(report.samples.length, 120);
  assert.equal(report.samples[0].durationMs, 5);
  assert.equal(report.elapsedMs, 40);
  assert.deepEqual(report.counters, { renders: 1 });
  assert.doesNotThrow(() => JSON.stringify(report));
});

test('performance monitor records frames and releases its listener', () => {
  let now = 0;
  let listener = null;
  let removed = 0;
  const monitor = createPerformanceMonitor({
    now: () => now,
    viewer: {
      scene: {
        canvas: { width: 800, height: 600 },
        postRender: {
          addEventListener(callback) {
            listener = callback;
            return () => {
              removed += 1;
              listener = null;
            };
          },
        },
      },
      dataSources: { length: 2 },
      imageryLayers: { length: 1 },
    },
    dataManager: {
      getAll: () => [{ id: 'flights', enabled: true, stats: { count: 4 } }],
    },
    readSettings: () => ({ densityPct: 75 }),
    readTimings: () => ({ overlayProjectionMs: 2.5 }),
    readOwnership: () => ({
      cctv: { listeners: 2, pendingJobs: 3, cacheEntries: 4 },
      invalid: { listeners: -1, secretUrl: 'discarded' },
    }),
  });
  now = 10;
  listener?.();
  now = 30;
  listener?.();
  const report = monitor.getSnapshot();
  assert.equal(report.scene.renderedFrameCount, 2);
  assert.equal(report.counters.renderedFrames, 2);
  assert.equal(report.samples.length, 1);
  assert.equal(report.samples[0].durationMs, 20);
  assert.equal(report.settings.densityPct, 75);
  assert.equal(report.resources.dataSources, 2);
  assert.equal(report.timings.overlayProjectionMs, 2.5);
  assert.deepEqual(report.resources.ownerResources, {
    cctv: { listeners: 2, pendingJobs: 3, cacheEntries: 4 },
  });
  monitor.destroy();
  assert.equal(removed, 1);
});

test('performance monitor can be disabled without installing a render listener', () => {
  let listeners = 0;
  const viewer = Object.defineProperty({}, 'scene', {
    get() {
      throw new Error('disabled monitor must not read the viewer scene');
    },
  });
  const monitor = createPerformanceMonitor({
    viewer,
    dataManager: {
      get getAll() {
        throw new Error('disabled monitor must not read data layers');
      },
    },
    enabled: false,
    now: () => {
      throw new Error('disabled monitor must not read the injected clock');
    },
    readSettings: () => {
      throw new Error('disabled monitor must not read settings');
    },
    readDiagnostics: () => {
      throw new Error('disabled monitor must not read diagnostics');
    },
    readOwnership: () => {
      throw new Error('disabled monitor must not read ownership');
    },
    readTimings: () => {
      throw new Error('disabled monitor must not read timings');
    },
  });
  const report = monitor.getSnapshot();
  monitor.destroy();
  assert.equal(listeners, 0);
  assert.equal(report.available, false);
  assert.equal(report.capturedAt, null);
  assert.equal(report.elapsedMs, null);
  assert.equal(report.scene.renderedFrameCount, null);
  assert.equal(report.identity.renderer, null);
  assert.equal(report.settings, null);
  assert.equal(report.resources, null);
  assert.equal(report.timings, null);
  assert.deepEqual(report.samples, []);
});

test('demand intervals identify possible idle time and disabling releases diagnostics completely', () => {
  let clock = 0,
    listener,
    removed = 0;
  const scene = {
    requestRenderMode: true,
    postRender: {
      addEventListener(fn) {
        listener = fn;
        return () => {
          removed++;
          listener = null;
        };
      },
    },
  };
  const monitor = createPerformanceMonitor({
    viewer: { scene },
    now: () => clock,
  });
  listener();
  clock = 10000;
  listener();
  assert.equal(
    monitor.getSnapshot().samples[0].metadata.mayIncludeIntentionalIdle,
    true,
  );
  assert.equal(monitor.getSnapshot().timings.gpuExecutionMs, null);
  monitor.setEnabled(false);
  assert.equal(listener, null);
  const disabled = monitor.getSnapshot();
  assert.equal(disabled.available, false);
  assert.equal(disabled.capturedAt, null);
  assert.equal(disabled.retainedHistory, true);
  assert.equal(disabled.historyScope, 'retained-samples-only');
  assert.equal(disabled.samples.length, 1);
  assert.equal(disabled.scene.renderedFrameCount, null);
  assert.equal(disabled.retainedRenderedFrameCount, 2);
  monitor.setEnabled(true);
  clock = 20000;
  listener();
  assert.equal(
    monitor.getSnapshot().samples.length,
    1,
    'disabled interval is never added to frame samples',
  );
  monitor.destroy();
  monitor.destroy();
  assert.equal(removed, 2);
});

test('a disabled monitor can be enabled later without reading dormant state first', () => {
  let clock = 25;
  let listener = null;
  let listenerAdds = 0;
  const scene = {
    postRender: {
      addEventListener(callback) {
        listenerAdds += 1;
        listener = callback;
        return () => {
          listener = null;
        };
      },
    },
  };
  const monitor = createPerformanceMonitor({
    viewer: { scene },
    enabled: false,
    now: () => clock,
  });
  assert.equal(monitor.getSnapshot().available, false);
  assert.equal(listenerAdds, 0);
  monitor.setEnabled(true);
  assert.equal(listenerAdds, 1);
  listener();
  clock = 50;
  listener();
  const active = monitor.getSnapshot();
  assert.equal(active.available, true);
  assert.equal(active.samples.length, 1);
  monitor.destroy();
});
