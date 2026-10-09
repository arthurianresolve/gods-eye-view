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
    dataManager: { getAll: () => [{ id: 'flights', enabled: true, stats: { count: 4 } }] },
    readSettings: () => ({ densityPct: 75 }),
    readTimings: () => ({ overlayProjectionMs: 2.5 }),
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
  monitor.destroy();
  assert.equal(removed, 1);
});
