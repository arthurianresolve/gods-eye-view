import assert from 'node:assert/strict';
import test from 'node:test';
import {
  installAustinDiagnosticObserver,
  readAustinDiagnosticObservation,
} from './austinOperatingRenderDemandDiagnostic.mjs';

test('Austin diagnostic page callbacks are serializable and never pump Cesium', () => {
  assert.doesNotMatch(installAustinDiagnosticObserver.toString(), /\.render\s*\(/);
  assert.doesNotMatch(readAustinDiagnosticObservation.toString(), /\.render\s*\(/);
  assert.doesNotMatch(installAustinDiagnosticObserver.toString(), /setInterval|setTimeout/);
});

test('diagnostic observation records the actual governor shape and layer diagnostics', () => {
  const previousWindow = globalThis.window;
  const previousDocument = globalThis.document;
  globalThis.window = {
    __godsEyeView: {
      getPerformanceSnapshot: () => ({
        renderGovernor: { mode: 'continuous', holds: ['wind'] },
        renderDemand: { mode: 'continuous', holds: ['wind'] },
      }),
      viewer: {
        scene: { requestRenderMode: true, canvas: { width: 2880, height: 1800, getBoundingClientRect: () => ({ width: 1440, height: 900 }) } },
        clock: { currentTime: { dayNumber: 1, secondsOfDay: 2 } },
      },
      dataManager: {
        layers: new Map([
          ['wind', { module: { getDiagnostics: () => ({ ready: true, visibleCells: 0, framePending: false }), getParams: () => ({ paused: false }) } }],
          ['cctv', { module: { getPerformanceDiagnostics: () => ({ timers: 0 }), getParams: () => ({ showProjection: true }) } }],
          ['satellites', { module: { getDiagnostics: () => ({ count: 828 }) } }],
        ]),
      },
    },
    __gevAustinDiagnosticObserver: { read: () => ({ intervals: [1000], longTasks: 0 }) },
  };
  globalThis.document = { visibilityState: 'visible', hasFocus: () => true };
  try {
    const result = readAustinDiagnosticObservation();
    assert.equal(result.renderGovernor.mode, 'continuous');
    assert.equal(result.wind.visibleCells, 0);
    assert.equal(result.cctv.timers, 0);
    assert.equal(result.satellites.count, 828);
    assert.deepEqual(result.drawingBuffer, { width: 2880, height: 1800 });
  } finally {
    globalThis.window = previousWindow;
    globalThis.document = previousDocument;
  }
});
