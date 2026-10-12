import assert from 'node:assert/strict';
import test from 'node:test';
import { runCableRendererLifetimes } from './cableLifetimeIsolation.mjs';

function report() {
  return { status: 'running', lifetimes: [], comparisons: [] };
}

function viewer({ destroyThrows = false } = {}) {
  return {
    destroyed: false,
    isDestroyed() {
      return this.destroyed;
    },
    destroy() {
      if (destroyThrows) throw new Error('viewer destroy failed');
      this.destroyed = true;
    },
  };
}

test('a failed baseline can be followed by candidate after confirmed viewer destruction', async () => {
  const result = report();
  const executed = [];
  const comparisons = [];
  await runCableRendererLifetimes({
    modes: ['entities', 'collections'],
    report: result,
    createViewer: (mode, _order, { setStage }) => {
      setStage('fresh-viewer-ready');
      return { mode, ...viewer() };
    },
    executeLifetime: async (_ownedViewer, mode, _order, { setStage }) => {
      executed.push(mode);
      result.lifetimes.push({ mode, sampleGeometry: `${mode}-geometry` });
      if (mode === 'entities') {
        setStage('reenable-scene-stability', 1);
        throw new Error('baseline readiness failed');
      }
      setStage('reenable-scene-stability', 1);
      throw new Error('candidate stability failed');
    },
    compareAvailable: () => {
      comparisons.push(
        result.lifetimes.map((lifetime) => lifetime.sampleGeometry),
      );
      result.comparisons.push({ availableGeometry: true });
    },
  });

  assert.deepEqual(executed, ['entities', 'collections']);
  assert.deepEqual(comparisons, [
    ['entities-geometry', 'collections-geometry'],
  ]);
  assert.equal(result.lifecycleCycles[0].viewerDestroyed, true);
  assert.equal(result.lifecycleCycles[1].viewerDestroyed, true);
  assert.equal(result.failures[0].stage, 'reenable-scene-stability');
  assert.equal(result.failures[0].cycle, 1);
  assert.equal(result.failedPhase, 'entities-reenable-scene-stability');
  assert.match(result.error, /baseline readiness failed/);
  assert.equal(result.failures.length, 2);
  assert.deepEqual(result.lifecycleCycles[0].stageHistory, [
    { stage: 'fresh-viewer-ready', cycleIndex: null },
    { stage: 'renderer-lifetime', cycleIndex: null },
    { stage: 'reenable-scene-stability', cycleIndex: 1 },
    { stage: 'destroy-viewer', cycleIndex: null },
  ]);
  assert.match(result.error, /baseline readiness failed/);
  assert.equal(result.status, 'failed');
});

test('first readiness failure remains attached when later lifetimes run', async () => {
  const result = report();
  await runCableRendererLifetimes({
    modes: ['entities', 'collections'],
    report: result,
    createViewer: (_mode) => ({ ...viewer() }),
    executeLifetime: async (_ownedViewer, mode, activationOrder) => {
      const lifetime = { mode, activationOrder, samples: [] };
      result.lifetimes.push(lifetime);
      if (mode === 'entities') {
        lifetime.readinessFailure = {
          mode,
          stage: 'scene-stability',
          reason: 'baseline primitive pending',
        };
        throw new Error('baseline readiness timeout');
      }
      return lifetime;
    },
    compareAvailable: () => {},
  });

  assert.deepEqual(result.readinessFailure, {
    mode: 'entities',
    stage: 'scene-stability',
    reason: 'baseline primitive pending',
  });
  assert.equal(result.failedPhase, 'entities-renderer-lifetime');
  assert.match(result.error, /baseline readiness timeout/);
});

test('candidate is skipped when baseline viewer destruction is unconfirmed', async () => {
  const result = report();
  let candidateRuns = 0;
  let comparisons = 0;
  const outcome = await runCableRendererLifetimes({
    modes: ['entities', 'collections'],
    report: result,
    createViewer: (mode) => ({ mode, ...viewer({ destroyThrows: true }) }),
    executeLifetime: async (_ownedViewer, mode) => {
      if (mode === 'collections') candidateRuns += 1;
      result.lifetimes.push({ mode, sampleGeometry: 'baseline-only' });
      throw new Error('baseline lifecycle failed');
    },
    compareAvailable: () => {
      comparisons += 1;
      assert.deepEqual(
        result.lifetimes.map((lifetime) => lifetime.sampleGeometry),
        ['baseline-only'],
      );
    },
  });

  assert.equal(candidateRuns, 0);
  assert.equal(outcome.length, 1);
  assert.equal(outcome[0].viewerDestroyed, false);
  assert.deepEqual(result.skippedLifetimes, [
    {
      mode: 'collections',
      reason: 'Prior viewer destruction was not confirmed.',
    },
  ]);
  assert.equal(comparisons, 1);
  assert.match(result.error, /baseline lifecycle failed/);
  assert.equal(result.status, 'failed');
});

test('returned layer cleanup failure is retained while candidate runs after confirmed viewer destruction', async () => {
  const result = report();
  const executed = [];
  await runCableRendererLifetimes({
    modes: ['entities', 'collections'],
    report: result,
    createViewer: (_mode) => ({ ...viewer() }),
    executeLifetime: async (_ownedViewer, mode, activationOrder) => {
      executed.push(mode);
      const lifetime = {
        mode,
        activationOrder,
        status: mode === 'entities' ? 'failed' : 'passed',
        samples: [{ geometrySha256: `${mode}-geometry` }],
      };
      if (mode === 'entities') {
        lifetime.error = 'layer cleanup verification failed';
        lifetime.cleanupError = 'collection owner remained attached';
      }
      result.lifetimes.push(lifetime);
      return lifetime;
    },
    compareAvailable: () => {
      result.comparisons.push({ captured: result.lifetimes.length });
    },
  });

  assert.deepEqual(executed, ['entities', 'collections']);
  assert.equal(result.lifecycleCycles[0].viewerDestroyed, true);
  assert.equal(result.lifecycleCycles[1].viewerDestroyed, true);
  assert.equal(result.lifecycleCycles[0].status, 'failed');
  assert.equal(
    result.lifecycleCycles[0].failureStage,
    'lifetime-reported-failure',
  );
  assert.equal(result.lifecycleCycles[0].stage, 'destroy-viewer');
  assert.match(result.error, /layer cleanup verification failed/);
  assert.match(result.error, /collection owner remained attached/);
  assert.equal(result.status, 'failed');
  assert.deepEqual(result.comparisons, [{ captured: 2 }]);
});

test('a later candidate failure does not erase captured pair comparisons or first failure', async () => {
  const result = report();
  let comparisons = 0;
  await runCableRendererLifetimes({
    modes: ['entities', 'collections'],
    report: result,
    createViewer: (mode) => ({ mode, ...viewer() }),
    executeLifetime: async (_ownedViewer, mode) => {
      result.lifetimes.push({ mode, sampleGeometry: `${mode}-captured` });
      if (mode === 'collections') throw new Error('candidate stability failed');
    },
    compareAvailable: () => {
      comparisons += 1;
      result.comparisons.push({
        geometryMatched:
          result.lifetimes[0].sampleGeometry ===
          result.lifetimes[1].sampleGeometry,
      });
    },
  });

  assert.equal(comparisons, 1);
  assert.equal(result.comparisons[0].geometryMatched, false);
  assert.equal(result.failures.length, 1);
  assert.match(result.error, /candidate stability failed/);
  assert.equal(result.status, 'failed');
});
