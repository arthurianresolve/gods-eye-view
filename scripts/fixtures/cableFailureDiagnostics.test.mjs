import assert from 'node:assert/strict';
import test from 'node:test';
import { createSubmarineCableLayer } from '../../src/layers/submarineCables/index.js';
import { appendCableFailureDiagnostics } from './cableFailureDiagnostics.mjs';

function makeLayer() {
  return createSubmarineCableLayer({
    source: { label: 'diagnostics-test', fetch: async () => ({}) },
    overlayHost: {
      setVisible() {},
      setEntries() {},
      clearSource() {},
    },
    screenSpaceEventHandlerFactory: () => ({ destroy() {} }),
  });
}

test('failure diagnostics use the actual cable layer public API shape', () => {
  const layer = makeLayer();
  const failure = {
    caseId: 'camera-change',
    error: 'native pick did not resolve',
    search: { pointProbeCount: 3, stemProbeCount: 5 },
    pointPick: { entityId: 'point-owner' },
    stemPick: null,
  };
  const published = { nativePickFailure: failure };
  const viewer = {
    dataSourceDisplay: { ready: true },
    scene: { globe: { tilesLoaded: true }, frameState: { frameNumber: 18 } },
  };

  assert.equal(layer.getLodDiagnostics, undefined);
  appendCableFailureDiagnostics(published.nativePickFailure, viewer, layer);

  assert.equal(published.nativePickFailure, failure);
  assert.equal(failure.error, 'native pick did not resolve');
  assert.deepEqual(failure.pointPick, { entityId: 'point-owner' });
  assert.equal(failure.stemPick, null);
  assert.deepEqual(failure.scene, {
    dataSourceDisplayReady: { available: true, value: true },
    globeTilesLoaded: { available: true, value: true },
    frameNumber: { available: true, value: 18 },
  });
  assert.deepEqual(failure.layer.performance, {
    available: true,
    value: layer.getPerformanceDiagnostics(),
  });
  assert.deepEqual(failure.layer.stats, {
    available: true,
    value: layer.getStats(),
  });
});

test('throwing optional diagnostics stay isolated and keep partial pick failure', () => {
  const failure = {
    caseId: 'camera-change',
    error: 'missing stem pick',
    pointPick: { entityId: 'surviving-point' },
    stemPick: null,
  };
  const viewer = {
    get dataSourceDisplay() {
      throw new Error('display getter failed');
    },
    scene: {
      globe: {
        get tilesLoaded() {
          throw new Error('globe getter failed');
        },
      },
      get frameState() {
        throw new Error('frame getter failed');
      },
    },
  };
  const layer = Object.defineProperties(
    {},
    {
      getPerformanceDiagnostics: {
        get() {
          throw new Error('performance getter failed');
        },
      },
      getStats: {
        value() {
          throw new Error('stats method failed');
        },
      },
    },
  );

  appendCableFailureDiagnostics(failure, viewer, layer);

  assert.equal(failure.error, 'missing stem pick');
  assert.deepEqual(failure.pointPick, { entityId: 'surviving-point' });
  assert.equal(failure.stemPick, null);
  assert.deepEqual(failure.scene.dataSourceDisplayReady, {
    available: false,
    error: 'display getter failed',
  });
  assert.deepEqual(failure.scene.globeTilesLoaded, {
    available: false,
    error: 'globe getter failed',
  });
  assert.deepEqual(failure.scene.frameNumber, {
    available: false,
    error: 'frame getter failed',
  });
  assert.deepEqual(failure.layer.performance, {
    available: false,
    error: 'performance getter failed',
  });
  assert.deepEqual(failure.layer.stats, {
    available: false,
    error: 'stats method failed',
  });
});
