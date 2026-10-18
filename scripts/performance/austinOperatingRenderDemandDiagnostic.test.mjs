import assert from 'node:assert/strict';
import test from 'node:test';
import {
  installAustinDiagnosticObserver,
  readAustinDiagnosticObservation,
} from './austinOperatingRenderDemandDiagnostic.mjs';

test('Austin diagnostic page callbacks are serializable and never pump Cesium', () => {
  assert.doesNotMatch(
    installAustinDiagnosticObserver.toString(),
    /\.render\s*\(/,
  );
  assert.doesNotMatch(
    readAustinDiagnosticObservation.toString(),
    /\.render\s*\(/,
  );
  assert.doesNotMatch(
    installAustinDiagnosticObserver.toString(),
    /setInterval|setTimeout/,
  );
  assert.doesNotThrow(() =>
    new Function(`return (${installAustinDiagnosticObserver.toString()})`)(),
  );
  assert.doesNotThrow(() =>
    new Function(`return (${readAustinDiagnosticObservation.toString()})`)(),
  );
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
        scene: {
          requestRenderMode: true,
          canvas: {
            width: 2880,
            height: 1800,
            getBoundingClientRect: () => ({ width: 1440, height: 900 }),
          },
        },
        clock: { currentTime: { dayNumber: 1, secondsOfDay: 2 } },
      },
      dataManager: {
        layers: new Map([
          [
            'wind',
            {
              module: {
                getDiagnostics: () => ({
                  ready: true,
                  visibleCells: 0,
                  framePending: false,
                }),
                getParams: () => ({ paused: false }),
              },
            },
          ],
          [
            'cctv',
            {
              module: {
                getPerformanceDiagnostics: () => ({ timers: 0 }),
                getParams: () => ({ showProjection: true }),
              },
            },
          ],
          [
            'satellites',
            { module: { getDiagnostics: () => ({ count: 828 }) } },
          ],
        ]),
      },
    },
    __gevAustinDiagnosticObserver: {
      read: () => ({ intervals: [1000], longTasks: 0 }),
    },
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

test('observer finds nested wind material without traversing cyclic collections forever', () => {
  const previous = {
    window: globalThis.window,
    document: globalThis.document,
    PerformanceObserver: globalThis.PerformanceObserver,
  };
  const callbacks = new Set();
  const material = {
    appearance: { material: { uniforms: { phaseTime: 7, heightFade: 0 } } },
  };
  const nested = { length: 2, get: (index) => (index ? nested : material) };
  const primitives = { length: 1, get: () => nested };
  globalThis.window = {
    __godsEyeView: {
      viewer: {
        scene: {
          primitives,
          postRender: {
            addEventListener: (listener) => callbacks.add(listener),
            removeEventListener: (listener) => callbacks.delete(listener),
          },
        },
      },
    },
  };
  globalThis.document = { visibilityState: 'visible', hasFocus: () => true };
  let disconnected = false;
  globalThis.PerformanceObserver = class {
    observe() {}
    disconnect() {
      disconnected = true;
    }
  };
  try {
    const install = new Function(
      `return (${installAustinDiagnosticObserver.toString()})`,
    )();
    install();
    assert.equal(callbacks.size, 1);
    assert.deepEqual(window.__gevAustinDiagnosticObserver.readWindPhase(), {
      phaseTime: 7,
      heightFade: 0,
    });
    delete material.appearance;
    assert.equal(window.__gevAustinDiagnosticObserver.readWindPhase(), null);
    window.__gevAustinDiagnosticObserver.dispose();
    assert.equal(callbacks.size, 0);
    assert.equal(disconnected, true);
    assert.equal(window.__gevAustinDiagnosticObserver, undefined);
  } finally {
    globalThis.window = previous.window;
    globalThis.document = previous.document;
    globalThis.PerformanceObserver = previous.PerformanceObserver;
  }
});
