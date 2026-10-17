import assert from 'node:assert/strict';
import test from 'node:test';
import { observeTerminalViewerState } from './terminalViewerObservation.mjs';

function installPage({
  refuseRetirement = false,
  throwOnRetirement = false,
  loop = true,
} = {}) {
  const names = [
    'window',
    'navigator',
    'document',
    'innerWidth',
    'innerHeight',
    'devicePixelRatio',
  ];
  const original = new Map(
    names.map((name) => [
      name,
      Object.getOwnPropertyDescriptor(globalThis, name),
    ]),
  );
  const viewer = { scene: { canvas: { width: 800, height: 600 } } };
  let currentLoop = loop;
  Object.defineProperty(viewer, 'useDefaultRenderLoop', {
    configurable: true,
    get: () => currentLoop,
    set: (value) => {
      if (throwOnRetirement && value === false)
        throw new Error('setter refused');
      if (!(refuseRetirement && value === false)) currentLoop = value;
    },
  });
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      __godsEyeView: {
        viewer,
        dataManager: {
          getAll: () => [
            { id: 'flights', enabled: true, stats: { count: 2500 } },
            { id: 'local-datacenters', enabled: true, stats: { count: 4362 } },
            { id: 'local-dams', enabled: true, stats: { count: 716 } },
          ],
        },
      },
    },
  });
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: { userAgent: 'test-agent', platform: 'test-platform' },
  });
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: { hasFocus: () => true, hidden: false },
  });
  for (const [name, value] of Object.entries({
    innerWidth: 800,
    innerHeight: 600,
    devicePixelRatio: 1,
  }))
    Object.defineProperty(globalThis, name, { configurable: true, value });
  return {
    viewer,
    restore() {
      for (const [key, descriptor] of original) {
        if (descriptor === undefined) delete globalThis[key];
        else Object.defineProperty(globalThis, key, descriptor);
      }
    },
  };
}

test('terminal population read is returned with confirmed retirement in the same callback', () => {
  const page = installPage();
  try {
    const result = observeTerminalViewerState('layer-population', [
      'flights',
      'local-datacenters',
      'local-dams',
    ]);
    assert.deepEqual(result.observation, {
      flights: { enabled: true, count: 2500 },
      'local-datacenters': { enabled: true, count: 4362 },
      'local-dams': { enabled: true, count: 716 },
    });
    assert.equal(result.renderLoopRetirement.before, true);
    assert.equal(result.renderLoopRetirement.after, false);
    assert.equal(result.renderLoopRetirement.confirmed, true);
    assert.equal(
      result.renderLoopRetirement.status,
      'retired-with-final-observation',
    );
    assert.equal(page.viewer.useDefaultRenderLoop, false);
  } finally {
    page.restore();
  }
});

test('terminal observer receives the same serialized evaluate arguments as the hosted page', async () => {
  const page = installPage();
  try {
    const calls = [];
    const targetPage = {
      evaluate: (fn, ...args) => {
        calls.push({ fn, args });
        return fn(...args);
      },
    };
    const result = await targetPage.evaluate(
      observeTerminalViewerState,
      'layer-population',
      ['flights'],
    );
    assert.equal(calls.length, 1);
    assert.equal(calls[0].fn, observeTerminalViewerState);
    assert.deepEqual(calls[0].args, ['layer-population', ['flights']]);
    assert.deepEqual(result.observation.flights, {
      enabled: true,
      count: 2500,
    });
    assert.equal(result.renderLoopRetirement.confirmed, true);
  } finally {
    page.restore();
  }
});

test('terminal read fails closed when public render-loop state is unavailable or refuses retirement', () => {
  const missing = installPage();
  try {
    delete missing.viewer.useDefaultRenderLoop;
    const result = observeTerminalViewerState('layer-population', ['flights']);
    assert.equal(result.observation.flights.count, 2500);
    assert.equal(result.renderLoopRetirement.confirmed, false);
    assert.equal(
      result.renderLoopRetirement.status,
      'viewer-render-loop-unavailable',
    );
  } finally {
    missing.restore();
  }

  const refused = installPage({ refuseRetirement: true });
  try {
    const result = observeTerminalViewerState('layer-population', ['flights']);
    assert.equal(result.observation.flights.enabled, true);
    assert.equal(result.renderLoopRetirement.before, true);
    assert.equal(result.renderLoopRetirement.after, true);
    assert.equal(result.renderLoopRetirement.confirmed, false);
    assert.equal(
      result.renderLoopRetirement.status,
      'viewer-render-loop-not-disabled',
    );
  } finally {
    refused.restore();
  }

  const alreadyDisabled = installPage({ loop: false });
  try {
    const result = observeTerminalViewerState('layer-population', ['flights']);
    assert.equal(result.renderLoopRetirement.before, false);
    assert.equal(result.renderLoopRetirement.after, false);
    assert.equal(result.renderLoopRetirement.confirmed, false);
    assert.equal(
      result.renderLoopRetirement.status,
      'already-disabled-before-final-observation',
    );
  } finally {
    alreadyDisabled.restore();
  }
});

test('terminal read retains a setter exception and does not claim retirement', () => {
  const page = installPage({ throwOnRetirement: true });
  try {
    const result = observeTerminalViewerState('layer-population', ['flights']);
    assert.equal(result.observation.flights.count, 2500);
    assert.equal(result.renderLoopRetirement.before, true);
    assert.equal(result.renderLoopRetirement.after, null);
    assert.equal(result.renderLoopRetirement.confirmed, false);
    assert.equal(
      result.renderLoopRetirement.status,
      'viewer-render-loop-set-failed',
    );
  } finally {
    page.restore();
  }
});

test('new sample setup remains renderable until its final measurement boundary', async () => {
  const page = installPage();
  const { settleCompletedRenderDiagnostic } =
    await import('./settleCompletedRenderDiagnostic.mjs');
  try {
    // The setup observation is intentionally not run for a fresh sample. Its
    // loop remains enabled through warmup and is retired only by the terminal
    // measurement postRender callback.
    assert.equal(page.viewer.useDefaultRenderLoop, true);
    const postRender = {
      handler: null,
      addEventListener(handler) {
        this.handler = handler;
        return () => {
          this.handler = null;
        };
      },
    };
    page.viewer.scene.postRender = postRender;
    page.viewer.scene.requestRender = () =>
      queueMicrotask(() => postRender.handler?.());
    const warmupBoundary = await settleCompletedRenderDiagnostic(
      page.viewer,
      100,
    );
    assert.equal(warmupBoundary.status, 'settled');
    assert.equal(page.viewer.useDefaultRenderLoop, true);
    const measurementBoundary = await settleCompletedRenderDiagnostic(
      page.viewer,
      100,
      null,
      null,
      true,
    );
    assert.equal(measurementBoundary.status, 'settled');
    assert.equal(
      measurementBoundary.diagnostics.renderLoopRetirement.confirmed,
      true,
    );
    assert.equal(page.viewer.useDefaultRenderLoop, false);
  } finally {
    page.restore();
  }
});
