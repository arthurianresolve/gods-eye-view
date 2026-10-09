import assert from 'node:assert/strict';
import test from 'node:test';
import { runMixedUseSoak } from './qa-mixed-use-soak.mjs';
import { probeWorkerCompletion } from './performance/workerProbe.mjs';
import { bootFixturePage } from './qa-application-fixtures.mjs';
import { createFixtureNetworkProbe } from './performance/fixtureNetworkProbe.mjs';
import { installWorkerDiagnostics } from './performance/workerDiagnostics.mjs';
import {
  fixtureRequestCommand,
  interceptFixtureSession,
} from './performance/fixtureInterception.mjs';
import {
  evaluateSoakStability,
  FULL_SOAK_MS,
} from './performance/soakStability.mjs';

const metrics = (heap = 100, listeners = 20, pendingJobs = 0) => ({
  JSHeapUsedSize: heap,
  JSEventListeners: listeners,
  application: {
    workers: { instrumented: true, overflow: false, pending: 0, workers: [] },
    resources: { primitives: 3, ownerResources: { fixture: { pendingJobs } } },
  },
});

test('network preflight requires actual worker interception, not merely DNS failure', async () => {
  const probe = createFixtureNetworkProbe('http://localhost:4174');
  const result = [
    'fixture-network-intercepted',
    'fixture-network-intercepted',
    'blocked',
  ];
  await assert.rejects(probe.verify({ evaluate: async () => result }));
  const report = await probe.verify({
    evaluate: async (_operation, urls) => {
      assert.equal(probe.respond(new URL(urls[0])).body, result[0]);
      assert.equal(probe.respond(new URL(urls[1])).body, result[1]);
      assert.equal(probe.respond(new URL(urls[2])), undefined);
      return result;
    },
  });
  assert.equal(report.interceptedWorkerRequests, 3);
  assert.equal(probe.respond(new URL('https://example.test/other')), undefined);
});

test('worker instrumentation tracks settlement, failures and termination without retaining payloads', () => {
  let clock = 0;
  class Worker extends EventTarget {
    postMessage(message) {
      if (message.throw) throw new Error('clone error');
    }
    terminate() {
      this.stopped = true;
    }
  }
  const scope = { Worker, performance: { now: () => clock } };
  installWorkerDiagnostics(scope);
  const worker = new scope.Worker(
    'https://secret.test/Workers/createGeometry.js?token=secret',
  );
  worker.postMessage({ id: 1, geometry: 'sensitive payload' });
  clock = 12000;
  const pending = scope.__gevSoakWorkers.snapshot();
  assert.equal(pending.pending, 1);
  assert.equal(pending.workers[0].oldestPendingMs, 12000);
  assert.doesNotMatch(JSON.stringify(pending), /secret|sensitive|geometry:/);
  worker.dispatchEvent(new MessageEvent('message', { data: { id: 999 } }));
  assert.equal(scope.__gevSoakWorkers.snapshot().pending, 1);
  worker.dispatchEvent(
    new MessageEvent('message', { data: { id: 1, error: 'bad geometry' } }),
  );
  worker.dispatchEvent(new Event('error'));
  assert.throws(
    () => worker.postMessage({ id: 2, throw: true }),
    /clone error/,
  );
  worker.postMessage({ id: 3 });
  worker.terminate();
  const result = scope.__gevSoakWorkers.snapshot().workers[0];
  assert.equal(result.pending, 0);
  assert.equal(result.completed, 1);
  assert.equal(result.taskErrors, 1);
  assert.equal(result.workerErrors, 1);
  assert.equal(result.postErrors, 1);
  assert.equal(result.cancelled, 1);
  assert.equal(worker.stopped, true);
});

test('worker diagnostic buffers are bounded and overflow is explicit', () => {
  class Worker extends EventTarget {
    postMessage() {}
    terminate() {}
  }
  const scope = { Worker, performance: { now: () => 0 } };
  installWorkerDiagnostics(scope);
  const worker = new scope.Worker('worker.js');
  for (let id = 0; id < 1026; id++) worker.postMessage({ id });
  for (let i = 0; i < 70; i++) new scope.Worker('worker.js');
  const result = scope.__gevSoakWorkers.snapshot();
  assert.equal(result.workers.length, 64);
  assert.equal(result.pending, 1024);
  assert.equal(result.overflow, true);
});

test('unsettled workers fail retention and absent worker instrumentation stays pending', () => {
  const report = stableReport();
  report.checkpoints.at(-1).metrics.application.workers.workers = [
    { pending: 1, oldestPendingMs: 10001 },
  ];
  assert.match(
    evaluateSoakStability(report).failures.join(' '),
    /Worker tasks remained unsettled/,
  );
  delete report.checkpoints.at(-1).metrics.application.workers;
  assert.equal(evaluateSoakStability(report).status, 'pending');
});
const stableReport = () => ({
  durationMs: FULL_SOAK_MS,
  checkpoints: Array.from({ length: 13 }, (_, i) => ({
    elapsedMs: i * 300000,
    metrics: metrics(),
  })),
});

test('fixture interception settles worker imports and blocks unconfigured provider traffic', async () => {
  const event = (url) => ({
    requestId: 'worker-1',
    networkId: 'no-network-event',
    request: { url, method: 'GET' },
  });
  const base = 'http://localhost:4174';
  assert.deepEqual(
    await fixtureRequestCommand(
      event(base + '/cesium/Workers/createBoxGeometry.js'),
      base,
    ),
    ['Fetch.continueRequest', { requestId: 'worker-1' }],
  );
  assert.equal(
    (await fixtureRequestCommand(event('https://provider.test/live'), base))[0],
    'Fetch.failRequest',
  );
  const [method, params] = await fixtureRequestCommand(
    event(base + '/api/live'),
    base,
  );
  assert.equal(method, 'Fetch.fulfillRequest');
  assert.equal(params.responseCode, 503);
  const bytes = Buffer.from([0, 255, 32]);
  const [, image] = await fixtureRequestCommand(
    event(base + '/api/image'),
    base,
    () => ({ contentType: 'image/png', body: bytes }),
  );
  assert.deepEqual(Buffer.from(image.body, 'base64'), bytes);
});

test('Fetch events settle without a Network event, and throwing fixtures abort the request', async () => {
  const callbacks = {},
    sent = [],
    errors = [];
  const client = {
    on: (name, fn) => {
      callbacks[name] = fn;
    },
    send: async (...args) => {
      sent.push(args);
    },
  };
  await interceptFixtureSession(
    client,
    'http://localhost',
    () => {
      throw new Error('broken fixture');
    },
    (error) => errors.push(error.message),
  );
  await callbacks['Fetch.requestPaused']({
    requestId: '1',
    networkId: 'unpaired',
    request: { url: 'http://localhost/api/test' },
  });
  assert.equal(sent[1][0], 'Fetch.failRequest');
  assert.deepEqual(errors, ['broken fixture']);
});

test('startup failures include application readiness and renderer error diagnostics', async () => {
  await assert.rejects(
    bootFixturePage(
      {
        goto: async () => {},
        waitForFunction: async () => {
          throw new Error('startup timeout');
        },
        evaluate: async () => ({
          applicationPresent: false,
          canvasCount: 0,
          cesiumError: 'WebGL unavailable',
        }),
      },
      'http://localhost',
    ),
    /startup timeout; startup diagnostics: .*WebGL unavailable/,
  );
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
