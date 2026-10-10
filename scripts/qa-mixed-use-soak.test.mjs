import assert from 'node:assert/strict';
import vm from 'node:vm';
import test from 'node:test';
import { runMixedUseSoak } from './qa-mixed-use-soak.mjs';
import { probeWorkerCompletion } from './performance/workerProbe.mjs';
import {
  bootFixturePage,
  collectWorkspaceImportDiagnostics,
  runWorkspaceFixturePhase,
} from './qa-application-fixtures.mjs';
import { createFixtureNetworkProbe } from './performance/fixtureNetworkProbe.mjs';
import { clickAndWaitForWorkspaceOpen } from './performance/workspaceOpenProbe.mjs';
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

test('workspace/import phase diagnostics serialize and omit URLs and payloads', () => {
  const scope = {
    __godsEyeView: {
      importedGeometryLayer: {
        getState: () => ({ featureCount: 1, pendingJobs: 0 }),
      },
      workspaceLibraryPanel: {
        restore: {
          getState: () => ({ status: 'applied', workspaceId: 'ws1' }),
        },
      },
      dataManager: {
        layers: {
          entries: () => [
            ['flights', { enabled: true, visibilityIntentEpoch: 2 }],
          ],
        },
      },
      viewer: { scene: { frameState: { frameNumber: 42 } } },
    },
    __gevSoakWorkers: {
      snapshot: () => ({
        instrumented: true,
        pending: 1,
        overflow: false,
        workers: [
          {
            kind: 'createGeometry',
            pending: 1,
            oldestPendingMs: 27,
            submitted: 2,
            completed: 1,
            cancelled: 0,
            taskErrors: 0,
            workerErrors: 0,
            postErrors: 0,
            url: 'https://private.test/worker?token=secret',
            payload: 'must not be retained',
          },
        ],
      }),
    },
    document: {
      readyState: 'complete',
      visibilityState: 'visible',
      hasFocus: () => true,
      querySelector: (selector) =>
        selector === '.workspace-library'
          ? {
              querySelector: (child) => ({
                textContent: child.includes('import-summary')
                  ? '1 accepted'
                  : 'Ready',
                value: 'ws1',
                disabled: false,
              }),
              querySelectorAll: () => [{ value: 'ws1' }, { value: 'ws2' }],
            }
          : null,
      querySelectorAll: () => [{}, {}],
    },
  };
  const serialized = vm.runInNewContext(
    `(${collectWorkspaceImportDiagnostics.toString()})(input)`,
    {
      ...scope,
      input: {
        phase: 'workspace-option-wait',
        targetWorkspaceId: 'ws2',
      },
    },
  );
  assert.equal(serialized.phase, 'workspace-option-wait');
  assert.equal(serialized.workspace.expectedWorkspaceId, 'ws2');
  assert.equal(serialized.workspace.requestedOptionPresent, true);
  assert.equal(serialized.importLayer.featureCount, 1);
  assert.equal(serialized.workers.workers[0].oldestPendingMs, 27);
  assert.equal(serialized.viewer.frameNumber, 42);
  assert.doesNotMatch(
    JSON.stringify(serialized),
    /private\.test|secret|payload/,
  );
});

test('named workspace phase preserves primary timeout and captures bounded state', async () => {
  const progress = [];
  const primary = new Error('Waiting failed: 30000ms exceeded');
  let evaluateCalls = 0;
  const browserGlobal = {
    document: {
      readyState: 'complete',
      visibilityState: 'visible',
      hasFocus: () => true,
      querySelector: () => ({
        querySelector: () => ({ textContent: 'Opening…', value: 'ws1' }),
        querySelectorAll: () => [{ value: 'ws1' }],
      }),
    },
    __godsEyeView: {},
  };
  const page = {
    evaluate: async (callback, context) => {
      evaluateCalls++;
      assert.equal(callback, collectWorkspaceImportDiagnostics);
      return vm.runInNewContext(`(${callback.toString()})(input)`, {
        ...browserGlobal,
        input: context,
      });
    },
  };
  await assert.rejects(
    runWorkspaceFixturePhase(
      page,
      'import-apply-status-wait',
      async () => {
        throw primary;
      },
      { onProgress: (phase) => progress.push(phase) },
    ),
    (error) => {
      assert.equal(error, primary);
      assert.match(error.message, /phase import-apply-status-wait/);
      assert.match(error.message, /Opening/);
      assert.ok(error.message.length < 8500);
      return true;
    },
  );
  assert.equal(evaluateCalls, 1);
  assert.deepEqual(progress, [
    'import-apply-status-wait:start',
    'import-apply-status-wait:failed',
  ]);
});

test('a hung diagnostics evaluation cannot replace the primary phase failure', async () => {
  const primary = new Error('workspace option wait failed');
  await assert.rejects(
    runWorkspaceFixturePhase(
      { evaluate: () => new Promise(() => {}) },
      'workspace-option-wait',
      async () => {
        throw primary;
      },
      { diagnosticTimeoutMs: 5 },
    ),
    (error) => {
      assert.equal(error, primary);
      assert.match(error.message, /workspace option wait failed/);
      assert.match(error.message, /deadline-exceeded/);
      return true;
    },
  );
});

test('successful named workspace phase reports completion without diagnostics', async () => {
  const progress = [];
  const page = {
    evaluate: async () =>
      assert.fail('success path must not query diagnostics'),
  };
  assert.equal(
    await runWorkspaceFixturePhase(page, 'workspace-restore', async () => 17, {
      onProgress: (phase) => progress.push(phase),
    }),
    17,
  );
  assert.deepEqual(progress, [
    'workspace-restore:start',
    'workspace-restore:complete',
  ]);
});

test('workspace completion is latched even when autosave replaces it before polling', async () => {
  let callback,
    disconnected = 0,
    cleared = 0;
  const status = { textContent: 'Old status' };
  const button = {
    click() {
      status.textContent = 'Autosaved revision 32.';
      callback([
        {
          addedNodes: [
            { textContent: 'Opened investigation.' },
            { textContent: status.textContent },
          ],
        },
      ]);
    },
  };
  const scope = {
    document: {
      querySelector: () => ({
        querySelector: (selector) =>
          selector === '[data-status]' ? status : button,
      }),
    },
    MutationObserver: class {
      constructor(fn) {
        callback = fn;
      }
      observe() {}
      disconnect() {
        disconnected++;
      }
    },
    setTimeout: () => 1,
    clearTimeout: () => cleared++,
  };
  await clickAndWaitForWorkspaceOpen(scope);
  assert.equal(disconnected, 1);
  assert.equal(cleared, 1);
  button.click = () => {
    throw new Error('click failed');
  };
  await assert.rejects(clickAndWaitForWorkspaceOpen(scope), /click failed/);
  assert.equal(disconnected, 2);
  assert.equal(cleared, 2);
});

test('a missing workspace completion times out and removes its observer', async () => {
  let disconnected = false;
  const scope = {
    document: {
      querySelector: () => ({
        querySelector: () => ({
          click() {},
          textContent: 'Opening investigation',
        }),
      }),
    },
    MutationObserver: class {
      observe() {}
      disconnect() {
        disconnected = true;
      }
    },
    setTimeout,
    clearTimeout,
  };
  await assert.rejects(
    clickAndWaitForWorkspaceOpen(scope, 1),
    /completion timed out/,
  );
  assert.equal(disconnected, true);
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

test('retention compares owned gauges rather than cumulative provider activity', () => {
  const report = stableReport();
  report.checkpoints.forEach((point, index) => {
    point.metrics.application.resources.ownerResources.maps = {
      cacheEntries: 3,
      listeners: 2,
      pendingJobs: 0,
      providerLoadsStarted: index + 3,
      providerCacheReuses: index * 12,
      providerLoadFailures: index,
    };
  });
  assert.equal(evaluateSoakStability(report).status, 'passed');
  report.checkpoints.at(-1).metrics.application.resources.ownerResources.maps
    .cacheEntries++;
  const result = evaluateSoakStability(report);
  assert.equal(result.status, 'failed');
  assert.match(result.failures.join(' '), /maps.cacheEntries grew/);
  assert.equal(
    result.failures.some((reason) => reason.includes('providerCacheReuses')),
    false,
  );
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
