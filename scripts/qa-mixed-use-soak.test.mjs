import assert from 'node:assert/strict';
import test from 'node:test';
import { runMixedUseSoak } from './qa-mixed-use-soak.mjs';
import { probeWorkerCompletion } from './performance/workerProbe.mjs';
import {
  evaluateSoakStability,
  FULL_SOAK_MS,
} from './performance/soakStability.mjs';

const metrics = (heap = 100, listeners = 20, pendingJobs = 0) => ({
  JSHeapUsedSize: heap,
  JSEventListeners: listeners,
  application: {
    resources: { primitives: 3, ownerResources: { fixture: { pendingJobs } } },
  },
});
const stableReport = () => ({
  durationMs: FULL_SOAK_MS,
  checkpoints: Array.from({ length: 13 }, (_, i) => ({
    elapsedMs: i * 300000,
    metrics: metrics(),
  })),
});

test('stability accepts a complete plateau and leaves short/missing evidence pending', () => {
  assert.equal(evaluateSoakStability(stableReport()).status, 'passed');
  assert.equal(
    evaluateSoakStability({ ...stableReport(), durationMs: 60000 }).status,
    'pending',
  );
  assert.equal(
    evaluateSoakStability({ durationMs: FULL_SOAK_MS }).status,
    'pending',
  );
  const missing = stableReport();
  delete missing.checkpoints[10].metrics.application;
  assert.equal(evaluateSoakStability(missing).status, 'pending');
});

test('stability fails retained owners, excessive heap and a persistent browser listener trend', () => {
  const owned = stableReport();
  owned.checkpoints.at(-1).metrics = metrics(100, 20, 1);
  assert.match(evaluateSoakStability(owned).failures.join(' '), /pendingJobs/);
  const heap = stableReport();
  heap.checkpoints[10].metrics.JSHeapUsedSize = 106;
  assert.equal(evaluateSoakStability(heap).status, 'failed');
  const listeners = stableReport();
  listeners.checkpoints.forEach((p, i) => {
    p.metrics.JSEventListeners += i;
  });
  assert.match(evaluateSoakStability(listeners).failures.join(' '), /listener/);
});

test('missing and sparse heap checkpoints cannot pass as zero growth', () => {
  const missing = stableReport();
  delete missing.checkpoints[10].metrics.JSHeapUsedSize;
  assert.equal(evaluateSoakStability(missing).status, 'pending');
  const sparse = stableReport();
  sparse.checkpoints = [0, 6, 7, 8, 12].map((i) => sparse.checkpoints[i]);
  assert.equal(evaluateSoakStability(sparse).status, 'pending');
});

test('operation failure preserves completed counts and retained checkpoints', async () => {
  let clock = 0,
    cycles = 0;
  await assert.rejects(
    runMixedUseSoak({
      durationMs: 100,
      intervalMs: 0,
      checkpointIntervalMs: 1,
      now: () => clock,
      driver: {
        retainedMetrics: async () => metrics(),
        runCycle: async () => {
          clock += 20;
          if (++cycles === 2) throw new Error('worker stalled');
          return {
            sourceToggles: 1,
            replaySeeks: 1,
            imports: 1,
            workspaceReloads: 1,
            archiveFailures: 1,
            cameraRecoveries: 1,
          };
        },
      },
    }),
    (error) => {
      assert.equal(error.soakReport.iterations, 1);
      assert.equal(error.soakReport.checkpoints.length, 2);
      assert.equal(error.soakReport.operationStatus, 'failed');
      assert.equal(error.soakReport.error, 'worker stalled');
      return true;
    },
  );
});

test('worker preflight requires success, expected failure and recovery and disposes its own processor', async () => {
  let destroyed = 0;
  const processor = {
    _activeTasks: 0,
    scheduleTask: (parameters) =>
      parameters.fail
        ? Promise.reject(new Error('invalid geometry'))
        : Promise.resolve({}),
    destroy: () => destroyed++,
  };
  const report = await probeWorkerCompletion({
    createProcessor: () => processor,
    tasks: [
      { id: 'cold', parameters: {} },
      {
        id: 'error',
        parameters: { fail: true },
        expectError: /invalid geometry/,
      },
      { id: 'recovery', parameters: {} },
    ],
  });
  assert.equal(report.status, 'passed');
  assert.equal(report.tasks.length, 3);
  assert.equal(destroyed, 1);
});

test('worker timeout cannot count as an expected error; late completion is consumed', async () => {
  let destroyed = 0,
    finish;
  await assert.rejects(
    probeWorkerCompletion({
      createProcessor: () => ({
        _activeTasks: 1,
        scheduleTask: () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
        destroy: () => destroyed++,
      }),
      tasks: [{ id: 'stalled', parameters: {}, expectError: /.*/ }],
      timeoutMs: 5,
    }),
    /Worker completion timed out/,
  );
  finish({});
  assert.equal(destroyed, 1);
});

test('worker preflight rejects unexpected errors, missing rejection and unsettled counts', async () => {
  for (const [result, active, expected, message] of [
    [
      () => Promise.reject(new Error('wrong error')),
      0,
      /invalid/,
      /wrong error/,
    ],
    [() => Promise.resolve(), 0, /invalid/, /failed to reject/],
    [() => Promise.resolve(), 1, null, /retained active tasks/],
    [() => undefined, 0, null, /not accepted/],
  ]) {
    let destroyed = false;
    await assert.rejects(
      probeWorkerCompletion({
        createProcessor: () => ({
          _activeTasks: active,
          scheduleTask: result,
          destroy: () => {
            destroyed = true;
          },
        }),
        tasks: [{ id: 'test', parameters: {}, expectError: expected }],
      }),
      message,
    );
    assert.equal(destroyed, true);
  }
});

test('soak reports completed driver operations and labels short runs as smoke', async () => {
  let now = 0;
  const report = await runMixedUseSoak({
    durationMs: 100,
    intervalMs: 0,
    now: () => now,
    driver: {
      runCycle: async () => {
        now += 50;
        return {
          sourceToggles: 2,
          replaySeeks: 1,
          imports: 1,
          workspaceReloads: 1,
          archiveFailures: 1,
          cameraRecoveries: 1,
        };
      },
    },
  });
  assert.equal(report.iterations, 2);
  assert.equal(report.sourceToggles, 4);
  assert.equal(report.fullSoak, false);
  assert.equal(report.hardwareRenderingValidated, false);
});

test('software renderer detection rejects known fallback strings', async () => {
  const { isSoftwareRenderer } = await import('./qa-rendered-soak-driver.mjs');
  assert.equal(
    isSoftwareRenderer('ANGLE (Intel, Intel UHD Graphics 620, D3D11)'),
    false,
  );
  assert.equal(isSoftwareRenderer('ANGLE (Google, SwiftShader)'), true);
  assert.equal(isSoftwareRenderer('llvmpipe (LLVM 15.0.7, 256 bits)'), true);
});
test('soak fails when an operation is missing or fails', async () => {
  await assert.rejects(
    runMixedUseSoak({ durationMs: 1, driver: { runCycle: async () => ({}) } }),
    /did not complete/,
  );
  await assert.rejects(
    runMixedUseSoak({
      durationMs: 1,
      driver: {
        runCycle: async () => {
          throw new Error('source failed');
        },
      },
    }),
    /source failed/,
  );
});
