import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { clickAndWaitForWorkspaceOpen } from './workspaceOpenProbe.mjs';
import {
  createLifecycleImportFixture,
  createLifecycleReport,
  finalizeLifecycleReportStatus,
  readWorkerPreflight,
  observeWorkerQuiescenceInPage,
  runImportWorkspaceLifecycle,
  validateLifecycleCandidate,
  WORKSPACE_IMPORT_FIXTURE_SHA256,
} from '../qa-import-workspace-lifecycle.mjs';
import {
  assertOwnedLifecycleCheckpoint,
  createLifecycleFailureEvidence,
  installLifecycleRenderWaiter,
  installLifecycleDrainObserver,
  parseImportWorkspaceLifecycleArgs,
  readLifecycleDrainObservation,
  runCooperativeImportLifecycleCase,
  runWorkspaceReplacementLifecycleCase,
  validateImportWorkspaceLifecycleReport,
} from './importWorkspaceLifecycle.mjs';

const appSha = 'a'.repeat(40);
const harnessSha = 'b'.repeat(40);
const importSha = 'c'.repeat(64);
const workspaceSha = 'd'.repeat(64);

function createDrainState({
  imports = { featureCount: 0, pendingJobs: 0, cacheEntries: 0 },
  pending = 0,
  workerPending = pending,
  overflow = false,
  instrumented = true,
  workers = [
    {
      kind: 'terrain/heightmap.js',
      submitted: 2,
      completed: 2 - workerPending,
      taskErrors: 0,
      workerErrors: 0,
      postErrors: 0,
      cancelled: 0,
      pending: workerPending,
      oldestPendingMs: workerPending ? 40 : 0,
      terminated: false,
    },
  ],
  tilesLoaded = true,
  frameNumber = 1,
  position = [1, 2, 3],
  direction = [0, 0, -1],
} = {}) {
  return {
    __godsEyeView: {
      importedGeometryLayer: {
        getState: () => imports,
        getPerformanceDiagnostics: () => ({
          cacheEntries: imports.cacheEntries,
        }),
      },
      viewer: {
        scene: {
          frameState: { frameNumber },
          requestRenderMode: true,
          _renderRequested: false,
          globe: { tilesLoaded },
        },
        camera: {
          positionWC: { x: position[0], y: position[1], z: position[2] },
          directionWC: { x: direction[0], y: direction[1], z: direction[2] },
          upWC: { x: 0, y: 1, z: 0 },
        },
      },
    },
    __gevSoakWorkers: {
      snapshot: () => ({ instrumented, overflow, pending, workers }),
    },
  };
}

function createDrainObserverContext() {
  let now = 0;
  let timerId = 0;
  const context = vm.createContext({
    performance: { now: () => now },
    window: createDrainState(),
    setTimeout: () => ++timerId,
    clearTimeout: () => {},
  });
  const install = vm.runInContext(
    `(${installLifecycleDrainObserver.toString()})`,
    context,
  );
  install(context.window);
  return {
    context,
    setTime(value) {
      now = value;
    },
    setState(state) {
      Object.assign(context.window, state);
    },
  };
}

test('serialized drain-observation reader receives timeout state as data', () => {
  let received;
  const context = vm.createContext({
    window: {
      __qaLifecycleDrainObservationSnapshot: (options) => {
        received = options;
        return { status: 'timed-out', options };
      },
    },
  });
  const read = vm.runInContext(
    `(${readLifecycleDrainObservation.toString()})`,
    context,
  );
  const result = read({
    sampleAfterDeadline: true,
    timedOut: true,
    includeHistory: true,
  });

  assert.deepEqual(JSON.parse(JSON.stringify(received)), {
    sampleAfterDeadline: true,
    timedOut: true,
    includeHistory: true,
  });
  assert.equal(result.status, 'timed-out');
});

async function runQuiescencePageFunction(
  snapshots,
  {
    timeoutMs = 1_200,
    pollMs = 50,
    maxSamples = 202,
    lateByMs = 0,
    cancelAfterFirstWait = false,
  } = {},
) {
  let now = 0;
  let snapshotIndex = 0;
  let timerId = 0;
  const clearedTimers = [];
  const context = vm.createContext({
    performance: { now: () => now },
    window: {
      __gevSoakWorkers: {
        snapshot: () =>
          snapshots[Math.min(snapshotIndex++, snapshots.length - 1)],
      },
    },
    setTimeout(callback, delay) {
      const id = ++timerId;
      now += delay + lateByMs;
      if (cancelAfterFirstWait && id === 1)
        queueMicrotask(() => context.window.__qaWorkerQuiescenceCancel?.());
      else queueMicrotask(callback);
      return id;
    },
    clearTimeout(id) {
      clearedTimers.push(id);
    },
  });
  const serialized = vm.runInContext(
    `(${observeWorkerQuiescenceInPage.toString()})`,
    context,
  );
  const result = await serialized({ timeoutMs, pollMs, maxSamples });
  return { result, context, clearedTimers };
}

function workerCounters() {
  return {
    scope: 'cumulative-per-document',
    instrumented: true,
    overflow: false,
    pending: 0,
    workers: [
      {
        kind: 'createGeometry.js',
        submitted: 4,
        completed: 4,
        taskErrors: 0,
        workerErrors: 0,
        postErrors: 0,
        cancelled: 0,
        pending: 0,
        terminated: false,
      },
    ],
  };
}

function snapshot({
  count = 0,
  ids,
  workspaceId,
  restoreWorkspaceId,
  scene = [4, 0, 2, 0],
} = {}) {
  const importEntityIds =
    ids ??
    Array.from(
      { length: count },
      (_, index) =>
        `gev-import:${workspaceId || 'test'}:lifecycle-fixture:${index}`,
    );
  return {
    imports: { featureCount: count, pendingJobs: 0, cacheEntries: count },
    importEntityIds,
    importEntityRecords: importEntityIds.map((id, index) => ({
      id,
      name: `Feature ${index}`,
      position: [1, 2, 3],
    })),
    scene: {
      entities: scene[0],
      dataSources: scene[1],
      primitives: scene[2],
      groundPrimitives: scene[3],
    },
    restore: restoreWorkspaceId
      ? { status: 'applied', workspaceId: restoreWorkspaceId, error: null }
      : null,
    workerCounters: workerCounters(),
    diagnostics: { jsHeapUsedBytes: null },
    ...(workspaceId
      ? {
          renderedPopulation: {
            frameNumber: 10,
            importedEntityCount: count,
            workspaceId,
          },
        }
      : {}),
    ...(restoreWorkspaceId
      ? {
          renderedPopulation: {
            frameNumber: 10,
            importedEntityCount: count,
            workspaceId: restoreWorkspaceId,
          },
        }
      : {}),
  };
}

function loadResult(workspaceId, count) {
  return {
    drawn: count,
    renderedPopulation: {
      frameNumber: 10,
      importedEntityCount: count,
      workspaceId,
    },
    importEntityIds: Array.from(
      { length: count },
      (_, index) => `gev-import:${workspaceId}:fixture:${index}`,
    ),
  };
}

function importDriver({ failMeasured = false, cleanupFailure = false } = {}) {
  let current = snapshot();
  let closed = false;
  let closeCount = 0;
  return {
    get closed() {
      return closed;
    },
    get closeCount() {
      return closeCount;
    },
    async checkpoint() {
      return current;
    },
    async load({ kind, cycle }) {
      if (failMeasured && kind === 'measured')
        throw new Error('measured operation failed');
      const workspaceId =
        kind === 'measured'
          ? `lifecycle-measured-${cycle}`
          : 'lifecycle-warmup';
      current = snapshot({
        count: 2,
        ids: loadResult(workspaceId, 2).importEntityIds,
        workspaceId,
      });
      return loadResult(workspaceId, 2);
    },
    async clearAndDrain() {
      current = snapshot();
      current = {
        ...current,
        renderedPopulation: {
          frameNumber: 11,
          importedEntityCount: 0,
          workspaceId: '__empty__',
        },
      };
      return current;
    },
    async cancelQueued() {
      current = snapshot();
      return { status: 'cancelled', queuedObserved: true, snapshot: current };
    },
    async supersedeQueued({ cycle }) {
      const workspaceId = `lifecycle-replacement-${cycle}`;
      current = snapshot({
        count: 2,
        ids: loadResult(workspaceId, 2).importEntityIds,
        workspaceId,
      });
      return {
        oldStatus: 'cancelled',
        queuedObserved: true,
        oldIdsStillPresent: false,
        replacement: loadResult(workspaceId, 2),
        snapshot: current,
      };
    },
    async workerCounters() {
      return workerCounters();
    },
    async close() {
      closeCount++;
      closed = true;
      if (cleanupFailure) throw new Error('cleanup failed');
    },
  };
}

test('import drain sampler records the same bounded predicate and camera/tile timeline', () => {
  const { context, setTime, setState } = createDrainObserverContext();
  const page = context.window;
  page.__qaLifecycleStartDrainObservation(500);

  setState(
    createDrainState({
      imports: { featureCount: 0, pendingJobs: 1, cacheEntries: 0 },
      pending: 0,
      tilesLoaded: false,
      frameNumber: 2,
    }),
  );
  assert.equal(page.__qaLifecycleSampleDrain(), false);

  setTime(50);
  setState(
    createDrainState({
      imports: { featureCount: 0, pendingJobs: 0, cacheEntries: 0 },
      pending: 1,
      workerPending: 1,
      tilesLoaded: false,
      frameNumber: 3,
    }),
  );
  assert.equal(page.__qaLifecycleSampleDrain(), false);

  setTime(100);
  setState(
    createDrainState({
      imports: { featureCount: 0, pendingJobs: 0, cacheEntries: 0 },
      pending: 0,
      tilesLoaded: true,
      frameNumber: 4,
      position: [4, 6, 3],
      direction: [0.01, 0, -1],
      workers: [
        {
          kind: 'https://private.invalid/terrain.js?token=secret',
          submitted: 2,
          completed: 2,
          taskErrors: 0,
          workerErrors: 0,
          postErrors: 0,
          cancelled: 0,
          pending: 0,
          oldestPendingMs: 0,
          terminated: false,
          payload: 'must not serialize',
        },
      ],
    }),
  );
  assert.equal(page.__qaLifecycleSampleDrain(), true);
  const trace = page.__qaLifecycleDrainObservationSnapshot();
  assert.equal(trace.status, 'settled');
  assert.equal(trace.firstWorkerZeroMs, 0);
  assert.equal(trace.firstQualifyingZeroMs, 100);
  assert.equal(trace.pollCount, 3);
  assert.equal(trace.maxPollingGapMs, 50);
  assert.equal(trace.tilesLoadedTransitionCount, 1);
  assert.equal(trace.firstTilesLoadedTransitionMs, 100);
  assert.equal(trace.lastTilesLoadedTransitionMs, 100);
  assert.equal(trace.cameraMoved, true);
  assert.equal(trace.cameraMaxDisplacementM, 5);
  assert.equal(trace.history[1].predicateSatisfied, false);
  assert.equal(trace.history[1].workerCounters.pending, 1);
  assert.equal(trace.history[2].camera.position[0], 4);
  assert.equal(
    trace.history[2].workerCounters.workers[0].kind,
    'opaque-worker',
  );
  const summary = page.__qaLifecycleDrainObservationSnapshot({
    includeHistory: false,
  });
  assert.equal(summary.history.length, 0);
  assert.equal(summary.historyIncluded, false);
  assert.equal(summary.historySampleCount, 3);
  assert.equal(summary.firstQualifyingZeroMs, 100);
  assert.equal(summary.maxPollingGapMs, 50);
  assert.equal(JSON.stringify(trace).includes('secret'), false);
  assert.equal(JSON.stringify(trace).includes('must not serialize'), false);
  page.__qaLifecycleClearDrainObservation();
  assert.equal(page.__qaLifecycleDrainObservationSnapshot(), null);
  const unavailableCamera = createDrainState();
  unavailableCamera.__godsEyeView.viewer.camera.positionWC = null;
  setState(unavailableCamera);
  page.__qaLifecycleStartDrainObservation(500);
  assert.equal(page.__qaLifecycleSampleDrain(), true);
  const unavailableTrace = page.__qaLifecycleDrainObservationSnapshot();
  assert.equal(unavailableTrace.cameraMoved, null);
  assert.equal(unavailableTrace.cameraMaxDisplacementM, null);
});

test('import drain sampler never accepts a qualifying zero observed after deadline', () => {
  const { context, setTime, setState } = createDrainObserverContext();
  const page = context.window;
  page.__qaLifecycleStartDrainObservation(100);
  setState(createDrainState({ pending: 1, workerPending: 1 }));
  assert.equal(page.__qaLifecycleSampleDrain(), false);
  setTime(150);
  setState(createDrainState());
  assert.equal(page.__qaLifecycleSampleDrain(), false);
  const trace = page.__qaLifecycleDrainObservationSnapshot();
  assert.equal(trace.status, 'timed-out');
  assert.equal(trace.firstQualifyingZeroMs, null);
  assert.equal(trace.lateZeroElapsedMs, 150);
});

test('timeout snapshot records a late zero separately from predicate history', () => {
  const { context, setTime, setState } = createDrainObserverContext();
  const page = context.window;
  page.__qaLifecycleStartDrainObservation(100);
  setState(createDrainState({ pending: 1, workerPending: 1 }));
  assert.equal(page.__qaLifecycleSampleDrain(), false);
  setTime(150);
  setState(createDrainState());
  const trace = page.__qaLifecycleDrainObservationSnapshot({
    sampleAfterDeadline: true,
    timedOut: true,
  });
  assert.equal(trace.status, 'timed-out');
  assert.equal(trace.firstQualifyingZeroMs, null);
  assert.equal(trace.lateZeroElapsedMs, 150);
  assert.equal(trace.history.length, 1);
  assert.equal(trace.postDeadlineObservation.afterDeadline, true);
  assert.equal(trace.postDeadlineObservation.predicateSatisfied, true);
});

test('import drain sampler rejects invalid snapshots and caps history without accepting later zero', () => {
  const { context, setTime, setState } = createDrainObserverContext();
  const page = context.window;
  page.__qaLifecycleStartDrainObservation(10_000);
  setState(
    createDrainState({
      workers: [
        {
          kind: 'createGeometry.js',
          submitted: 1,
          completed: 1,
          taskErrors: 0,
          workerErrors: 0,
          postErrors: 0,
          cancelled: 0,
          pending: -1,
          oldestPendingMs: 0,
          terminated: false,
        },
      ],
    }),
  );
  assert.equal(page.__qaLifecycleSampleDrain(), false);
  assert.equal(
    page.__qaLifecycleDrainObservationSnapshot().history[0].valid,
    false,
  );
  setState(createDrainState({ overflow: true }));
  assert.equal(page.__qaLifecycleSampleDrain(), false);
  assert.equal(
    page.__qaLifecycleDrainObservationSnapshot().history[1].valid,
    false,
  );
  setState(createDrainState({ pending: 1, workerPending: 1 }));
  for (let index = 0; index < 202; index++) {
    setTime(index * 50);
    assert.equal(page.__qaLifecycleSampleDrain(), false);
  }
  setTime(10_100);
  assert.equal(page.__qaLifecycleSampleDrain(), false);
  const trace = page.__qaLifecycleDrainObservationSnapshot();
  assert.equal(trace.history.length, 202);
  assert.equal(trace.pollCount, 203);
  assert.equal(trace.historyTruncated, true);
  assert.equal(trace.status, 'history-overflow');
  assert.equal(trace.firstQualifyingZeroMs, null);
});

test('failure evidence serializes a bounded drain timeline without URLs or payloads', () => {
  const history = Array.from({ length: 203 }, (_, index) => ({
    elapsedMs: index * 50,
    valid: true,
    predicateSatisfied: false,
    imports: { featureCount: 0, pendingJobs: 0, cacheEntries: 0 },
    workerCounters: {
      instrumented: true,
      overflow: false,
      pending: 1,
      workers: [
        {
          kind: 'https://private.invalid/worker.js?token=secret',
          submitted: 2,
          completed: 1,
          pending: 1,
          taskErrors: 0,
          workerErrors: 0,
          postErrors: 0,
          cancelled: 0,
          oldestPendingMs: 12,
          payload: 'must not serialize',
        },
      ],
    },
    frame: {
      frameNumber: index,
      requestRenderMode: true,
      renderRequested: false,
    },
    globe: { available: true, tilesLoaded: false },
    camera: {
      position: [1, 2, 3],
      direction: [0, 0, -1],
      up: [0, 1, 0],
    },
  }));
  const evidence = createLifecycleFailureEvidence({
    phase: 'warmup-drain',
    error: 'drain timed out',
    operation: {
      name: 'clear-and-drain',
      status: 'timed-out',
      drainHistory: {
        status: 'timed-out',
        timeoutMs: 10_000,
        elapsedMs: 10_050,
        firstWorkerZeroMs: null,
        firstQualifyingZeroMs: null,
        lateZeroElapsedMs: 10_050,
        pollCount: 203,
        maxPollingGapMs: 50,
        historyTruncated: true,
        history,
      },
    },
  });
  const drainHistory = evidence.operation.drainHistory;
  assert.equal(drainHistory.history.length, 202);
  assert.equal(drainHistory.historyTruncated, true);
  assert.equal(drainHistory.lateZeroElapsedMs, 10_050);
  assert.equal(
    drainHistory.history[0].workerCounters.workers[0].kind,
    'opaque-worker',
  );
  assert.equal(JSON.stringify(evidence).includes('secret'), false);
  assert.equal(JSON.stringify(evidence).includes('must not serialize'), false);
});

test('failure evidence prefers the captured observation timeline without duplicating it', () => {
  const history = {
    status: 'timed-out',
    timeoutMs: 100,
    elapsedMs: 150,
    pollCount: 2,
    history: [],
  };
  const evidence = createLifecycleFailureEvidence({
    phase: 'warmup-drain',
    error: 'drain timed out',
    operation: { name: 'clear-and-drain', drainHistory: history },
    observation: {
      imports: { featureCount: 0, pendingJobs: 0, cacheEntries: 0 },
      drainHistory: history,
    },
  });
  assert.equal(evidence.observation.drainHistory.status, 'timed-out');
  assert.equal(evidence.operation.drainHistory, undefined);
});

test('runner options are bounded and require an HTTP(S) target and full expected SHA', () => {
  assert.deepEqual(parseImportWorkspaceLifecycleArgs([]), {
    url: 'http://localhost:4174',
    cycles: 5,
    drainMs: 10_000,
    featureCount: 512,
    out: null,
    expectedCommit: null,
  });
  assert.equal(
    parseImportWorkspaceLifecycleArgs(['--cycles', '2', '--drain-ms', '50'])
      .cycles,
    2,
  );
  for (const args of [
    ['--url', 'file:///tmp'],
    ['--cycles', '11'],
    ['--drain-ms', '10001'],
    ['--features', '5001'],
    ['--expected-commit', 'abc'],
    ['--unknown', 'x'],
    ['--cycles'],
  ])
    assert.throws(() => parseImportWorkspaceLifecycleArgs(args));
});

test('report initializer includes the actual workspace fixture digest', () => {
  const fixture = createLifecycleImportFixture(1);
  const report = createLifecycleReport({
    expectedCommit: appSha,
    actualHarnessCommit: harnessSha,
    harnessSourceClean: true,
    applicationSourceClean: true,
    fixture,
    cycles: 1,
    drainMs: 1000,
  });
  assert.equal(
    report.fixtures.workspaceImportSha256,
    WORKSPACE_IMPORT_FIXTURE_SHA256,
  );
  assert.equal(report.fixtures.cooperativeImportSha256, fixture.sha256);
  assert.equal(report.phase, 'initialize');
});

test('failure evidence keeps bounded URL-free import, worker, frame, and preflight observations', () => {
  const evidence = createLifecycleFailureEvidence({
    caseId: 'workspace-replacement',
    phase: 'worker-preflight-validation',
    error: new Error('failed at https://secret.example/path?token=abc'),
    operation: {
      name: 'open-workspace',
      status: 'timed-out',
      renderWaitStatus: 'pending',
      renderWaitId: 4,
      workspaceId: 'workspace-synthetic',
    },
    observation: {
      imports: { featureCount: 19, pendingJobs: 1, cacheEntries: 3 },
      workerCounters: {
        scope: 'cumulative-per-document',
        instrumented: true,
        overflow: true,
        pending: 2,
        workers: Array.from({ length: 70 }, (_, index) => ({
          kind:
            index === 0
              ? 'https://secret.example/worker.js'
              : 'createGeometry.js',
          submitted: 10,
          completed: 8,
          taskErrors: 0,
          workerErrors: 0,
          postErrors: 0,
          cancelled: 0,
          pending: 2,
          oldestPendingMs: 27.129,
          terminated: false,
          payload: 'must not be serialized',
        })),
      },
      frame: {
        frameNumber: 42,
        requestRenderMode: true,
        renderRequested: false,
        renderWaiters: Array.from({ length: 12 }, (_, id) => ({
          id,
          status: 'pending',
          workspaceId: 'workspace-synthetic',
          count: 512,
          startingFrame: 40,
          url: 'https://secret.example',
        })),
      },
      scene: {
        entities: 20,
        dataSources: 0,
        primitives: 4,
        groundPrimitives: 0,
      },
    },
    workerPreflight: {
      network: {
        status: 'passed',
        interceptedWorkerRequests: 3,
        url: 'https://secret.example',
      },
      probe: {
        status: 'failed',
        tasks: Array.from({ length: 8 }, (_, index) => ({
          id: `task-${index}`,
          outcome: 'rejected-as-expected',
          body: 'must not be serialized',
        })),
      },
      diagnostics: workerCounters(),
      quiescenceHistory: {
        status: 'timed-out',
        reason: 'quiescence-deadline',
        elapsedMs: 10_001,
        firstObservedZeroMs: null,
        maxPollingGapMs: 50,
        pollCount: 203,
        historyTruncated: true,
        history: Array.from({ length: 203 }, (_, index) => ({
          elapsedMs: index * 50,
          instrumented: true,
          overflow: false,
          pending: 2,
          workersTruncated: false,
          workers: [
            {
              kind: 'createVerticesFromHeightmap.js',
              submitted: 14,
              completed: 12,
              taskErrors: 0,
              workerErrors: 0,
              postErrors: 0,
              cancelled: 0,
              pending: 2,
              oldestPendingMs: index * 50,
              url: 'https://secret.example/terrain.js',
            },
          ],
        })),
        postZeroVerification: null,
        final: null,
      },
      probeError: new Error('https://secret.example/body?secret=1'),
    },
    pageDiagnostics: {
      errors: Array.from({ length: 10 }, () => 'https://secret.example/error'),
      messages: Array.from({ length: 10 }, () => 'bounded warning'),
    },
  });
  const serialized = JSON.stringify(evidence);
  assert.equal(evidence.schema, 'gev-lifecycle-failure-evidence/v1');
  assert.equal(evidence.observation.workerCounters.workers.length, 64);
  assert.equal(evidence.observation.workerCounters.workersTruncated, true);
  assert.equal(evidence.observation.frame.renderWaiters.length, 8);
  assert.equal(evidence.workerPreflight.probe.tasks.length, 4);
  assert.equal(evidence.workerPreflight.probe.tasksTruncated, true);
  assert.equal(evidence.workerPreflight.quiescenceHistory.history.length, 202);
  assert.equal(
    evidence.workerPreflight.quiescenceHistory.historyTruncated,
    true,
  );
  assert.equal(evidence.pageDiagnostics.errors.length, 4);
  assert.doesNotMatch(
    serialized,
    /secret\.example|token=abc|must not be serialized|payload/,
  );
});

test('failed worker preflight preserves available rejected inputs when extra diagnostics fail', async () => {
  let evaluateCalls = 0;
  const page = {
    async evaluate() {
      evaluateCalls++;
      if (evaluateCalls === 1) throw new Error('Fixture network worker failed');
      throw new Error('diagnostic snapshot unavailable');
    },
  };
  const network = {
    status: 'passed',
    interceptedWorkerRequests: 3,
    url: 'https://must-not-appear.example',
  };
  await assert.rejects(
    readWorkerPreflight(page, async () => network),
    (error) => {
      assert.equal(error.lifecycleFailureEvidence.failedPhase, 'worker-probe');
      assert.equal(
        error.lifecycleFailureEvidence.workerPreflight.network.status,
        'passed',
      );
      assert.equal(
        error.lifecycleFailureEvidence.workerPreflight.diagnosticSnapshotError,
        'diagnostic snapshot unavailable',
      );
      assert.doesNotMatch(
        JSON.stringify(error.lifecycleFailureEvidence),
        /must-not-appear\.example/,
      );
      return true;
    },
  );
  assert.equal(evaluateCalls, 2);
});

test('failed worker preflight retains returned probe and counters when validation rejects them', async () => {
  const value = {
    probe: {
      status: 'failed',
      tasks: [{ id: 'geometry-cold', outcome: 'timed-out' }],
    },
    diagnostics: {
      instrumented: true,
      overflow: false,
      pending: 1,
      workers: [
        {
          kind: 'createGeometry.js',
          submitted: 4,
          completed: 3,
          cancelled: 0,
          pending: 1,
          workerErrors: 0,
          postErrors: 0,
        },
      ],
    },
  };
  const page = {
    async evaluate() {
      return value;
    },
  };
  await assert.rejects(
    readWorkerPreflight(page, async () => ({
      status: 'passed',
      interceptedWorkerRequests: 3,
    })),
    (error) => {
      const evidence = error.lifecycleFailureEvidence.workerPreflight;
      assert.equal(
        error.lifecycleFailureEvidence.failedPhase,
        'worker-preflight-validation',
      );
      assert.equal(evidence.probe.status, 'failed');
      assert.equal(evidence.probe.tasks[0].outcome, 'timed-out');
      assert.equal(evidence.diagnostics.pending, 1);
      assert.equal(evidence.diagnostics.workers[0].completed, 3);
      return true;
    },
  );
});

test('zero-pending preflight still rejects negative worker counters', async () => {
  const probe = {
    status: 'passed',
    tasks: [
      { id: 'geometry-cold', outcome: 'resolved' },
      { id: 'geometry-reuse', outcome: 'resolved' },
      { id: 'geometry-error', outcome: 'rejected-as-expected' },
      { id: 'geometry-recovery', outcome: 'resolved' },
    ],
  };
  const diagnostics = {
    instrumented: true,
    overflow: false,
    pending: 0,
    workers: [
      {
        kind: 'createGeometry.js',
        submitted: 4,
        completed: 4,
        taskErrors: 1,
        workerErrors: 0,
        postErrors: 0,
        cancelled: -1,
        pending: 0,
        terminated: true,
      },
    ],
  };
  const page = { evaluate: async () => ({ probe, diagnostics }) };
  await assert.rejects(
    readWorkerPreflight(page, async () => ({
      status: 'passed',
      interceptedWorkerRequests: 3,
    })),
    (error) => {
      assert.equal(
        error.lifecycleFailureEvidence.failedPhase,
        'worker-preflight-validation',
      );
      assert.equal(
        error.lifecycleFailureEvidence.workerPreflight.diagnostics.workers[0]
          .cancelled,
        null,
      );
      return true;
    },
  );
});

test('worker preflight polls unrelated terrain to zero and verifies zero again', async () => {
  const probe = {
    status: 'passed',
    tasks: [
      { id: 'geometry-cold', outcome: 'resolved' },
      { id: 'geometry-reuse', outcome: 'resolved' },
      { id: 'geometry-error', outcome: 'rejected-as-expected' },
      { id: 'geometry-recovery', outcome: 'resolved' },
    ],
  };
  const worker = (kind, pending, submitted, completed, taskErrors = 0) => ({
    kind,
    submitted,
    completed,
    taskErrors,
    workerErrors: 0,
    postErrors: 0,
    cancelled: 0,
    terminated: kind === 'createGeometry.js',
    pending,
  });
  const initial = {
    instrumented: true,
    overflow: false,
    pending: 3,
    workers: [
      worker('createVerticesFromHeightmap.js', 2, 14, 12),
      worker('incrementallyBuildTerrainPicker.js', 1, 12, 11),
      worker('createGeometry.js', 0, 4, 4, 1),
    ],
  };
  const partlySettled = {
    ...initial,
    pending: 1,
    workers: initial.workers.map((entry, index) => ({
      ...entry,
      pending: index === 0 ? 1 : 0,
    })),
  };
  const settled = {
    ...initial,
    pending: 0,
    workers: initial.workers.map((entry) => ({ ...entry, pending: 0 })),
  };
  let evaluateCalls = 0;
  const page = {
    async evaluate(fn) {
      evaluateCalls++;
      if (evaluateCalls === 1) return { probe, diagnostics: initial };
      assert.equal(fn, observeWorkerQuiescenceInPage);
      return runQuiescencePageFunction([partlySettled, settled, settled], {
        timeoutMs: 1200,
      }).then(({ result }) => result);
    },
  };

  const result = await readWorkerPreflight(
    page,
    async () => ({ status: 'passed', interceptedWorkerRequests: 3 }),
    { quiescenceTimeoutMs: 1200 },
  );

  assert.equal(evaluateCalls, 2);
  assert.equal(result.pendingAtProbeCompletion, 3);
  assert.equal(result.pendingAtPreflight, 0);
  assert.equal(result.quiescenceTimeoutMs, 1200);
  assert.ok(result.quiescenceWaitMs >= 0);
  assert.equal(result.cumulativeSubmitted, 30);
  assert.equal(result.cumulativeCompleted, 27);
  assert.equal(result.quiescenceHistory.history.length, 3);
  assert.equal(result.quiescenceHistory.firstObservedZeroMs, 50);
  assert.equal(result.quiescenceHistory.postZeroVerification.pending, 0);
  assert.equal(result.quiescenceHistory.maxPollingGapMs, 50);
});

test('worker preflight times out with bounded last-poll evidence', async () => {
  const diagnostics = {
    instrumented: true,
    overflow: false,
    pending: 1,
    workers: [
      {
        kind: 'createVerticesFromHeightmap.js',
        submitted: 2,
        completed: 1,
        taskErrors: 0,
        workerErrors: 0,
        postErrors: 0,
        cancelled: 0,
        pending: 1,
        oldestPendingMs: 503,
      },
      {
        kind: 'createGeometry.js',
        submitted: 4,
        completed: 4,
        taskErrors: 1,
        workerErrors: 0,
        postErrors: 0,
        cancelled: 0,
        pending: 0,
        terminated: true,
      },
    ],
  };
  const probe = {
    status: 'passed',
    tasks: [
      { id: 'geometry-cold', outcome: 'resolved' },
      { id: 'geometry-reuse', outcome: 'resolved' },
      { id: 'geometry-error', outcome: 'rejected-as-expected' },
      { id: 'geometry-recovery', outcome: 'resolved' },
    ],
  };
  let evaluateCalls = 0;
  const page = {
    async evaluate(fn) {
      evaluateCalls++;
      if (evaluateCalls === 1) return { probe, diagnostics };
      assert.equal(fn, observeWorkerQuiescenceInPage);
      return runQuiescencePageFunction([diagnostics, diagnostics], {
        timeoutMs: 500,
      }).then(({ result }) => result);
    },
  };
  await assert.rejects(
    readWorkerPreflight(
      page,
      async () => ({ status: 'passed', interceptedWorkerRequests: 3 }),
      { quiescenceTimeoutMs: 500 },
    ),
    (error) => {
      const evidence = error.lifecycleFailureEvidence.workerPreflight;
      assert.equal(
        error.lifecycleFailureEvidence.failedPhase,
        'worker-quiescence',
      );
      assert.equal(evidence.pendingAtProbeCompletion, 1);
      assert.equal(evidence.diagnostics.pending, 1);
      assert.equal(evidence.diagnostics.workers[0].oldestPendingMs, 503);
      assert.equal(evidence.quiescenceTimeoutMs, 500);
      assert.ok(evidence.quiescenceWaitMs >= 0);
      assert.equal(evidence.quiescenceHistory.status, 'timed-out');
      assert.equal(evidence.quiescenceHistory.final.pending, 1);
      assert.ok(evidence.quiescenceHistory.maxPollingGapMs <= 50);
      return true;
    },
  );
  assert.equal(evaluateCalls, 2);
});

test('worker preflight rejects a transient zero followed by new terrain work', async () => {
  const probe = {
    status: 'passed',
    tasks: [
      { id: 'geometry-cold', outcome: 'resolved' },
      { id: 'geometry-reuse', outcome: 'resolved' },
      { id: 'geometry-error', outcome: 'rejected-as-expected' },
      { id: 'geometry-recovery', outcome: 'resolved' },
    ],
  };
  const worker = (kind, pending, submitted, completed, taskErrors = 0) => ({
    kind,
    submitted,
    completed,
    taskErrors,
    workerErrors: 0,
    postErrors: 0,
    cancelled: 0,
    terminated: kind === 'createGeometry.js',
    pending,
  });
  const diagnostics = (terrainPending) => ({
    instrumented: true,
    overflow: false,
    pending: terrainPending,
    workers: [
      worker(
        'createVerticesFromHeightmap.js',
        terrainPending,
        2,
        2 - terrainPending,
      ),
      worker('createGeometry.js', 0, 4, 4, 1),
    ],
  });
  let evaluateCalls = 0;
  const page = {
    async evaluate(fn) {
      evaluateCalls++;
      if (evaluateCalls === 1) return { probe, diagnostics: diagnostics(1) };
      assert.equal(fn, observeWorkerQuiescenceInPage);
      return runQuiescencePageFunction([diagnostics(0), diagnostics(1)], {
        timeoutMs: 500,
      }).then(({ result }) => result);
    },
  };
  await assert.rejects(
    readWorkerPreflight(
      page,
      async () => ({ status: 'passed', interceptedWorkerRequests: 3 }),
      { quiescenceTimeoutMs: 500 },
    ),
    (error) => {
      const evidence = error.lifecycleFailureEvidence.workerPreflight;
      assert.equal(evidence.quiescenceHistory.status, 'pending-resumed');
      assert.equal(evidence.quiescenceHistory.postZeroVerification.pending, 1);
      assert.equal(evidence.diagnostics.pending, 1);
      return true;
    },
  );
});

test('worker quiescence deadline rejects a zero snapshot delivered late', async () => {
  const pending = {
    instrumented: true,
    overflow: false,
    pending: 1,
    workers: [
      {
        kind: 'createVerticesFromHeightmap.js',
        submitted: 1,
        completed: 0,
        taskErrors: 0,
        workerErrors: 0,
        postErrors: 0,
        cancelled: 0,
        pending: 1,
      },
    ],
  };
  const zero = {
    ...pending,
    pending: 0,
    workers: pending.workers.map((worker) => ({
      ...worker,
      completed: 1,
      pending: 0,
    })),
  };
  const { result } = await runQuiescencePageFunction([pending, zero], {
    timeoutMs: 40,
    pollMs: 50,
    lateByMs: 1,
  });
  assert.equal(result.status, 'timed-out');
  assert.equal(result.firstObservedZeroMs, 41);
  assert.equal(result.final.pending, 0);
});

test('worker quiescence bounds samples, rejects invalid counters, and cancels its timer', async (t) => {
  const diagnostic = (pending, overrides = {}) => ({
    instrumented: true,
    overflow: false,
    pending,
    workers: [
      {
        kind: 'createVerticesFromHeightmap.js',
        submitted: 2,
        completed: 2 - pending,
        taskErrors: 0,
        workerErrors: 0,
        postErrors: 0,
        cancelled: 0,
        pending,
        ...overrides,
      },
    ],
  });

  await t.test('sample cap fails closed', async () => {
    const { result } = await runQuiescencePageFunction([diagnostic(1)], {
      maxSamples: 2,
      timeoutMs: 1000,
    });
    assert.equal(result.status, 'history-overflow');
    assert.equal(result.history.length, 2);
    assert.equal(result.historyTruncated, true);
  });

  await t.test('negative counters are invalid', async () => {
    const { result } = await runQuiescencePageFunction([
      diagnostic(0, { submitted: -1 }),
    ]);
    assert.equal(result.status, 'invalid');
    assert.equal(result.reason, 'negative-worker-counter');
  });

  await t.test('cancel clears the owned timer and hook', async () => {
    const { result, context, clearedTimers } = await runQuiescencePageFunction(
      [diagnostic(1)],
      { cancelAfterFirstWait: true },
    );
    assert.equal(result.status, 'cancelled');
    assert.deepEqual(clearedTimers, [1]);
    assert.equal(context.window.__qaWorkerQuiescenceCancel, null);
  });
});

test('worker preflight rejects worker errors and overflow without waiting them away', async (t) => {
  for (const diagnostics of [
    {
      instrumented: true,
      overflow: false,
      pending: 0,
      workers: [
        {
          kind: 'createGeometry.js',
          submitted: 4,
          completed: 4,
          taskErrors: 1,
          workerErrors: 1,
          postErrors: 0,
          pending: 0,
        },
      ],
    },
    {
      instrumented: true,
      overflow: true,
      pending: 0,
      workers: [],
    },
    {
      instrumented: true,
      overflow: false,
      pending: 0,
      workers: [
        {
          kind: 'createGeometry.js',
          submitted: 4,
          completed: 4,
          taskErrors: 1,
          workerErrors: 0,
          postErrors: 0,
          pending: 0,
          terminated: true,
        },
        {
          kind: 'createVerticesFromHeightmap.js',
          submitted: 1,
          completed: 1,
          taskErrors: 1,
          workerErrors: 0,
          postErrors: 0,
          pending: 0,
          terminated: false,
        },
      ],
    },
  ]) {
    await t.test(
      diagnostics.overflow
        ? 'overflow'
        : diagnostics.workers.some(
              (worker) =>
                worker.kind === 'createVerticesFromHeightmap.js' &&
                worker.taskErrors > 0,
            )
          ? 'unrelated task error'
          : 'worker error',
      async () => {
        const page = {
          async evaluate() {
            return {
              probe: {
                status: 'passed',
                tasks: [
                  { id: 'geometry-cold', outcome: 'resolved' },
                  { id: 'geometry-reuse', outcome: 'resolved' },
                  {
                    id: 'geometry-error',
                    outcome: 'rejected-as-expected',
                  },
                  { id: 'geometry-recovery', outcome: 'resolved' },
                ],
              },
              diagnostics,
            };
          },
          async waitForFunction() {
            assert.fail(
              'failed diagnostics must reject before quiescence wait',
            );
          },
        };
        await assert.rejects(
          readWorkerPreflight(page, async () => ({
            status: 'passed',
            interceptedWorkerRequests: 3,
          })),
          (error) => {
            assert.equal(
              error.lifecycleFailureEvidence.failedPhase,
              'worker-preflight-validation',
            );
            return true;
          },
        );
      },
    );
  }
});

test('owned browser closes when initialization fails after launch and emits durable phases', async () => {
  let closed = false;
  const browser = {
    async version() {
      throw new Error('version probe failed');
    },
    async close() {
      closed = true;
    },
    process() {
      return null;
    },
  };
  const phases = [];
  const report = await runImportWorkspaceLifecycle({
    url: 'http://localhost:4174',
    expectedCommit: appSha,
    harnessCommit: harnessSha,
    cycles: 1,
    drainMs: 1000,
    featureCount: 1,
    launchBrowser: async (options) => {
      assert.equal(options.protocolTimeout, 15_000);
      return browser;
    },
    onProgress: (current) => phases.push(current.phase),
  });
  assert.equal(report.status, 'failed');
  assert.match(report.error, /version probe failed/);
  assert.equal(report.failedPhase, 'read-browser-version');
  assert.equal(report.browserClose.closeCompleted, true);
  assert.equal(closed, true);
  assert.deepEqual(phases, [
    'launch-browser',
    'read-browser-version',
    'close-owned-browser',
    'failed',
  ]);
});

test('workspace open callback works after Puppeteer-style function serialization', async () => {
  let observerCallback;
  let observedTimeout = null;
  let clearedTimer = false;
  const status = { textContent: '' };
  const button = {
    disabled: false,
    click() {
      status.textContent = 'Opened workspace';
      observerCallback([{ addedNodes: [{ textContent: 'Opened workspace' }] }]);
    },
  };
  const scope = {
    document: {
      querySelector: () => ({
        querySelector(selector) {
          return selector === '[data-status]' ? status : button;
        },
      }),
    },
    MutationObserver: class {
      constructor(callback) {
        observerCallback = callback;
      }
      observe() {}
      disconnect() {}
    },
    setTimeout(callback, timeoutMs) {
      observedTimeout = timeoutMs;
      return callback;
    },
    clearTimeout() {
      clearedTimer = true;
    },
  };
  const serialized = vm.runInNewContext(
    `(${clickAndWaitForWorkspaceOpen.toString()})`,
    { window: scope },
  );
  await serialized(undefined, 1234);
  assert.equal(observedTimeout, 1234);
  assert.equal(clearedTimer, true);
});

test('completed-render waiter retains a render that fires before its consumer awaits', async () => {
  const listeners = new Set();
  const scope = {
    __godsEyeView: {
      workspaceLibraryPanel: {
        restore: { getState: () => ({ status: 'applied', workspaceId: 'ws' }) },
      },
      viewer: {
        scene: {
          frameState: { frameNumber: 10 },
          postRender: {
            addEventListener(listener) {
              listeners.add(listener);
            },
            removeEventListener(listener) {
              listeners.delete(listener);
            },
          },
        },
        entities: {
          values: [{ id: 'gev-import:ws:source:feature' }],
        },
      },
      importedGeometryLayer: { getState: () => ({ featureCount: 1 }) },
    },
  };
  installLifecycleRenderWaiter(scope);
  const id = scope.__qaLifecycleStartRenderWait({
    workspaceId: 'ws',
    count: 1,
    timeoutMs: 100,
  });
  scope.__godsEyeView.viewer.scene.frameState.frameNumber++;
  for (const listener of [...listeners]) listener();
  assert.equal(listeners.size, 0);
  assert.deepEqual(scope.__qaLifecycleRenderWaitSnapshot(), [
    {
      id,
      status: 'completed',
      workspaceId: 'ws',
      count: 1,
      startingFrame: 10,
    },
  ]);
  assert.deepEqual(await scope.__qaLifecycleWaitForRender(id), {
    frameNumber: 11,
    importedEntityCount: 1,
    workspaceId: 'ws',
  });
  assert.equal(scope.__qaLifecycleCancelRenderWait(id), undefined);
});

test('workspace render observation ignores an old matching frame until restore transitions', async () => {
  const listeners = new Set();
  const previousRestore = { status: 'applied', workspaceId: 'ws' };
  let restore = previousRestore;
  const scope = {
    __godsEyeView: {
      workspaceLibraryPanel: { restore: { getState: () => restore } },
      viewer: {
        scene: {
          frameState: { frameNumber: 20 },
          postRender: {
            addEventListener(listener) {
              listeners.add(listener);
            },
            removeEventListener(listener) {
              listeners.delete(listener);
            },
          },
        },
        entities: { values: [{ id: 'gev-import:ws:file:point' }] },
      },
      importedGeometryLayer: { getState: () => ({ featureCount: 1 }) },
    },
  };
  installLifecycleRenderWaiter(scope);
  const id = scope.__qaLifecycleStartRenderWait({
    workspaceId: 'ws',
    count: 1,
    timeoutMs: 100,
    requireRestoreTransition: true,
  });
  scope.__godsEyeView.viewer.scene.frameState.frameNumber++;
  for (const listener of [...listeners]) listener();
  assert.equal(listeners.size, 1);
  restore = { status: 'applied', workspaceId: 'ws' };
  scope.__godsEyeView.viewer.scene.frameState.frameNumber++;
  for (const listener of [...listeners]) listener();
  const observation = await scope.__qaLifecycleWaitForRender(id);
  assert.equal(observation.frameNumber, 22);
  assert.equal(restore === previousRestore, false);
  assert.equal(listeners.size, 0);
});

test('completed-render timeout remains observable when it fires before wait and releases listener', async () => {
  const listeners = new Set();
  const scope = {
    __godsEyeView: {
      viewer: {
        scene: {
          frameState: { frameNumber: 1 },
          postRender: {
            addEventListener(listener) {
              listeners.add(listener);
            },
            removeEventListener(listener) {
              listeners.delete(listener);
            },
          },
        },
        entities: { values: [] },
      },
      importedGeometryLayer: { getState: () => ({ featureCount: 0 }) },
    },
  };
  installLifecycleRenderWaiter(scope);
  const id = scope.__qaLifecycleStartRenderWait({
    workspaceId: 'ws',
    count: 1,
    timeoutMs: 5,
  });
  await new Promise((resolve) => setTimeout(resolve, 15));
  assert.equal(listeners.size, 0);
  assert.equal(scope.__qaLifecycleRenderWaitSnapshot()[0].status, 'failed');
  await assert.rejects(scope.__qaLifecycleWaitForRender(id), /not observed/);
  assert.equal(scope.__qaLifecycleCancelRenderWait(id), undefined);
  assert.equal(listeners.size, 0);
});

test('cooperative import case counts only completed operations and drains to warmed baseline', async () => {
  const driver = importDriver();
  const result = await runCooperativeImportLifecycleCase({
    driver,
    cycles: 2,
    featureCount: 2,
  });
  assert.equal(result.status, 'passed');
  assert.equal(result.operations.warmupLoads, 1);
  assert.equal(result.operations.completedLoads, 2);
  assert.equal(result.operations.cancellations, 2);
  assert.equal(result.operations.supersededLoads, 2);
  assert.equal(result.operations.completedReplacementLoads, 2);
  assert.equal(result.operations.clearDrains, 7);
  assert.equal(result.checkpoints.length, 8);
  assert.equal(driver.closed, true);
});

test('queued cancellation or supersession that was not actually observed fails closed', async () => {
  const cancelDriver = importDriver();
  cancelDriver.cancelQueued = async () => ({
    status: 'cancelled',
    queuedObserved: false,
    snapshot: snapshot(),
  });
  const cancelled = await runCooperativeImportLifecycleCase({
    driver: cancelDriver,
    cycles: 1,
    featureCount: 2,
  });
  assert.equal(cancelled.status, 'failed');
  assert.equal(cancelled.operations.completedLoads, 1);
  assert.equal(cancelled.operations.cancellations, 0);
  assert.equal(cancelled.failedPhase, 'queued-cancellation-1');

  const supersedeDriver = importDriver();
  supersedeDriver.supersedeQueued = async ({ cycle }) => ({
    oldStatus: 'cancelled',
    queuedObserved: false,
    oldIdsStillPresent: false,
    replacement: {
      ...loadResult(`lifecycle-replacement-${cycle}`, 2),
      omitted: 0,
      importEntityIds: Array.from(
        { length: 25 },
        (_, index) =>
          `gev-import:lifecycle-replacement-${cycle}:fixture:${index}`,
      ),
    },
    snapshot: snapshot({
      count: 2,
      workspaceId: `lifecycle-replacement-${cycle}`,
    }),
  });
  supersedeDriver.failureEvidence = async ({ phase, error, progress }) =>
    createLifecycleFailureEvidence({
      caseId: 'cooperative-import',
      phase,
      error,
      supersession: progress.supersessionOutcome,
    });
  const superseded = await runCooperativeImportLifecycleCase({
    driver: supersedeDriver,
    cycles: 1,
    featureCount: 2,
  });
  assert.equal(superseded.status, 'failed');
  assert.equal(superseded.operations.supersededLoads, 0);
  assert.equal(superseded.failedPhase, 'queued-supersession-1');
  assert.deepEqual(superseded.failureEvidence.supersession, {
    cycle: 1,
    oldStatus: 'cancelled',
    queuedObserved: false,
    oldIdsStillPresent: false,
    replacement: {
      drawn: 2,
      omitted: 0,
      entityIdCount: 25,
      entityIdsTruncated: true,
      entityIds: Array.from(
        { length: 16 },
        (_, index) => `gev-import:lifecycle-replacement-1:fixture:${index}`,
      ),
      completedRenderStatus: 'observed',
      renderedPopulation: {
        frameNumber: 10,
        importedEntityCount: 2,
        workspaceId: 'lifecycle-replacement-1',
      },
    },
    snapshot: {
      imports: { featureCount: 2, pendingJobs: 0 },
      frameNumber: null,
      importEntityIdCount: 2,
      scene: {
        entities: 4,
        dataSources: 0,
        primitives: 2,
        groundPrimitives: 0,
      },
    },
  });
  assert.equal(
    JSON.stringify(superseded.failureEvidence).includes('https://'),
    false,
  );
  assert.equal(
    superseded.supersessionOutcome.replacement.importEntityIds.length,
    16,
  );
  assert.equal(
    JSON.stringify(superseded).includes(
      'gev-import:lifecycle-replacement-1:fixture:24',
    ),
    false,
  );

  const throwingSupersedeDriver = importDriver();
  const normalSupersede = throwingSupersedeDriver.supersedeQueued;
  let supersessionCalls = 0;
  throwingSupersedeDriver.supersedeQueued = async (options) => {
    supersessionCalls++;
    if (supersessionCalls === 2)
      throw new Error('second supersession failed before returning');
    return normalSupersede(options);
  };
  throwingSupersedeDriver.failureEvidence = async ({
    phase,
    error,
    progress,
  }) =>
    createLifecycleFailureEvidence({
      caseId: 'cooperative-import',
      phase,
      error,
      supersession: progress.supersessionOutcome,
    });
  const secondCycleFailure = await runCooperativeImportLifecycleCase({
    driver: throwingSupersedeDriver,
    cycles: 2,
    featureCount: 2,
  });
  assert.equal(secondCycleFailure.status, 'failed');
  assert.equal(secondCycleFailure.failedPhase, 'queued-supersession-2');
  assert.equal(secondCycleFailure.supersessionOutcome, null);
  assert.equal(secondCycleFailure.failureEvidence.supersession, null);
});

test('failed operations preserve completed counts, phase, and cleanup failures', async () => {
  const driver = importDriver({ failMeasured: true, cleanupFailure: true });
  let evidenceReadBeforeCleanup = false;
  driver.failureEvidence = async ({ phase, error }) => {
    evidenceReadBeforeCleanup = !driver.closed;
    return createLifecycleFailureEvidence({
      caseId: 'cooperative-import',
      phase,
      error,
      observation: {
        imports: { featureCount: 0, pendingJobs: 0, cacheEntries: 0 },
        workerCounters: workerCounters(),
        frame: { frameNumber: 5 },
        scene: {
          entities: 4,
          dataSources: 0,
          primitives: 2,
          groundPrimitives: 0,
        },
      },
    });
  };
  const result = await runCooperativeImportLifecycleCase({
    driver,
    cycles: 1,
    featureCount: 2,
  });
  assert.equal(result.status, 'failed');
  assert.equal(result.operations.warmupLoads, 1);
  assert.equal(result.operations.completedLoads, 0);
  assert.equal(result.failedPhase, 'measured-load-1');
  assert.match(result.error, /measured operation failed/);
  assert.match(result.cleanupError, /cleanup failed/);
  assert.equal(evidenceReadBeforeCleanup, true);
  assert.equal(result.failureEvidence.failedPhase, 'measured-load-1');
  assert.equal(result.failureEvidence.observation.frame.frameNumber, 5);
  assert.equal(driver.closeCount, 1);
});

function workspaceDriver({
  wrongAlternateContent = false,
  failOpenAt = null,
} = {}) {
  let opens = 0;
  let closed = false;
  const baselineId = 'workspace-base';
  const alternateId = 'workspace-alt';
  const open = async (id) => {
    opens++;
    if (opens === failOpenAt) throw new Error('restore failed');
    const featureSuffix =
      id === alternateId && wrongAlternateContent
        ? 'different'
        : 'fixture-point';
    const ids = [`gev-import:${id}:fixture:${featureSuffix}`];
    return snapshot({
      count: 1,
      ids,
      workspaceId: id,
      restoreWorkspaceId: id,
    });
  };
  return {
    get closed() {
      return closed;
    },
    async seed() {
      return { baselineId, alternateId, featureCount: 1 };
    },
    open,
    async close() {
      closed = true;
    },
  };
}

test('workspace case uses alternating real owner IDs and returns to warmed baseline', async () => {
  const driver = workspaceDriver();
  const result = await runWorkspaceReplacementLifecycleCase({
    driver,
    cycles: 3,
  });
  assert.equal(result.status, 'passed');
  assert.equal(result.operations.completedWorkspaceReplacements, 3);
  assert.equal(result.checkpoints.length, 3);
  assert.deepEqual(result.checkpoints[0].alternatedIds, [
    'workspace-alt',
    'workspace-base',
  ]);
  assert.equal(result.final.restore.workspaceId, 'workspace-base');
  assert.equal(driver.closed, true);
});

test('workspace replacement rejects equal counts with different imported IDs and preserves failure phase', async () => {
  const driver = workspaceDriver({ wrongAlternateContent: true });
  const result = await runWorkspaceReplacementLifecycleCase({
    driver,
    cycles: 1,
  });
  assert.equal(result.status, 'failed');
  assert.equal(result.operations.completedWorkspaceReplacements, 0);
  assert.equal(result.failedPhase, 'initial-alternate-open');
  assert.match(result.error, /different feature IDs/);
  assert.equal(driver.closed, true);
});

test('checkpoint and final report reject missing resources, workers, build identity, or completed operations', () => {
  const empty = snapshot();
  assert.doesNotThrow(() =>
    assertOwnedLifecycleCheckpoint(empty, { featureCount: 0 }),
  );
  assert.throws(
    () =>
      assertOwnedLifecycleCheckpoint(
        { ...empty, workerCounters: null },
        { featureCount: 0 },
      ),
    /Worker checkpoint/,
  );
  assert.throws(
    () =>
      assertOwnedLifecycleCheckpoint(
        { ...empty, scene: null },
        { featureCount: 0 },
      ),
    /Scene resource/,
  );
  assert.throws(
    () =>
      assertOwnedLifecycleCheckpoint(
        { ...empty, workerCounters: { ...workerCounters(), overflow: true } },
        { featureCount: 0 },
      ),
    /Worker checkpoint/,
  );

  const importRow = {
    id: 'cooperative-import',
    status: 'passed',
    cycles: 1,
    featureCount: 2,
    applicationCommit: appSha,
    allLayersDisabled: true,
    disabledLayers: ['flights', 'traffic'],
    operations: {
      warmupLoads: 1,
      completedLoads: 1,
      cancellations: 1,
      supersededLoads: 1,
      completedReplacementLoads: 1,
      clearDrains: 4,
    },
    baseline: empty,
    final: empty,
    workerCounters: workerCounters(),
    workerPreflight: {
      scope: 'cumulative-per-document',
      status: 'passed',
      taskCount: 4,
      cumulativeSubmitted: 4,
      cumulativeCompleted: 4,
      cumulativeCancelled: 0,
      pendingAtProbeCompletion: 0,
      quiescenceWaitMs: 0,
      quiescenceTimeoutMs: 10_000,
      pendingAtPreflight: 0,
      overflow: false,
    },
    checkpoints: [
      {
        cycle: 1,
        phase: 'load-clear',
        loadedEntityIds: ['0', '1'].map(
          (id) => `gev-import:lifecycle-measured-1:lifecycle-fixture:${id}`,
        ),
        renderedPopulation: {
          frameNumber: 11,
          importedEntityCount: 2,
          workspaceId: 'lifecycle-measured-1',
        },
        snapshot: empty,
      },
      { cycle: 1, phase: 'cancelled-while-queued', snapshot: empty },
      {
        cycle: 1,
        phase: 'superseded-replacement-loaded',
        renderedPopulation: {
          frameNumber: 12,
          importedEntityCount: 2,
          workspaceId: 'lifecycle-replacement-1',
        },
        snapshot: snapshot({
          count: 2,
          workspaceId: 'lifecycle-replacement-1',
        }),
      },
      {
        cycle: 1,
        phase: 'superseded-replacement-cleared',
        snapshot: empty,
      },
    ],
  };
  const workspaceRow = {
    id: 'workspace-replacement',
    status: 'passed',
    cycles: 1,
    applicationCommit: appSha,
    allLayersDisabled: true,
    disabledLayers: ['flights', 'traffic'],
    operations: { completedWorkspaceReplacements: 1 },
    baselineWorkspaceId: 'workspace-base',
    alternateWorkspaceId: 'workspace-alt',
    featureCount: 1,
    baseline: snapshot({
      count: 1,
      workspaceId: 'workspace-base',
      restoreWorkspaceId: 'workspace-base',
    }),
    final: snapshot({
      count: 1,
      workspaceId: 'workspace-base',
      restoreWorkspaceId: 'workspace-base',
    }),
    workerCounters: workerCounters(),
    workerPreflight: importRow.workerPreflight,
    checkpoints: [
      {
        cycle: 1,
        phase: 'alternation',
        alternate: snapshot({
          count: 1,
          workspaceId: 'workspace-alt',
          restoreWorkspaceId: 'workspace-alt',
        }),
        returned: snapshot({
          count: 1,
          workspaceId: 'workspace-base',
          restoreWorkspaceId: 'workspace-base',
        }),
      },
    ],
  };
  const report = {
    schema: 'gev-import-workspace-lifecycle/v1',
    status: 'passed',
    applicationCommit: appSha,
    applicationCommitAtEnd: appSha,
    applicationSourceCleanAtEnd: true,
    sourceChangedDuringRun: false,
    harnessCommit: harnessSha,
    harnessSourceClean: true,
    applicationSourceClean: true,
    cycles: 1,
    fixtures: {
      cooperativeImportId: 'cooperative-import-v1',
      cooperativeImportSourceId: 'lifecycle-fixture',
      cooperativeImportCount: 2,
      cooperativeImportRecordIds: ['0', '1'],
      cooperativeImportSha256: importSha,
      workspaceImportId: 'workspace-synthetic-point-v1',
      workspaceImportSha256: workspaceSha,
      workspaceImportCount: 1,
    },
    cases: [importRow, workspaceRow],
  };
  const expected = {
    expectedCommit: appSha,
    expectedImportFixtureSha256: importSha,
    expectedWorkspaceFixtureSha256: workspaceSha,
  };
  assert.equal(
    validateImportWorkspaceLifecycleReport(report, expected),
    report,
  );
  const inProgressReport = { ...report, status: 'running' };
  assert.equal(
    validateLifecycleCandidate(inProgressReport, expected).status,
    'passed',
  );
  assert.equal(inProgressReport.status, 'running');
  inProgressReport.validationStatus = 'passed';
  inProgressReport.browserClose = { closeCompleted: true };
  assert.equal(
    finalizeLifecycleReportStatus(inProgressReport, { ownsBrowser: true }),
    'passed',
  );
  assert.throws(
    () =>
      validateImportWorkspaceLifecycleReport(
        { ...report, applicationCommit: harnessSha },
        expected,
      ),
    /identity/,
  );
  assert.throws(
    () =>
      validateImportWorkspaceLifecycleReport(
        {
          ...report,
          applicationSourceCleanAtEnd: false,
          sourceChangedDuringRun: true,
        },
        expected,
      ),
    /identity/,
  );
  assert.throws(
    () =>
      validateImportWorkspaceLifecycleReport(
        { ...report, harnessCommit: 'bad' },
        expected,
      ),
    /identity/,
  );
  assert.throws(
    () =>
      validateImportWorkspaceLifecycleReport(
        {
          ...report,
          cases: [importRow, { ...workspaceRow, workerPreflight: null }],
        },
        expected,
      ),
    /Worker preflight/,
  );
  assert.throws(
    () =>
      validateImportWorkspaceLifecycleReport(
        {
          ...report,
          cases: [
            importRow,
            {
              ...workspaceRow,
              checkpoints: [
                {
                  ...workspaceRow.checkpoints[0],
                  alternate: {
                    ...workspaceRow.checkpoints[0].alternate,
                    workerCounters: null,
                  },
                },
              ],
            },
          ],
        },
        expected,
      ),
    /Worker checkpoint/,
  );
  const leakedImport = {
    ...importRow,
    checkpoints: importRow.checkpoints.map((checkpoint) => ({
      ...checkpoint,
      snapshot: {
        ...checkpoint.snapshot,
        scene: { ...checkpoint.snapshot.scene, primitives: 99 },
      },
    })),
  };
  assert.throws(
    () =>
      validateImportWorkspaceLifecycleReport(
        { ...report, cases: [leakedImport, workspaceRow] },
        expected,
      ),
    /scene resource counts changed/,
  );
  const duplicateCycle = {
    ...importRow,
    checkpoints: [
      importRow.checkpoints[0],
      { ...importRow.checkpoints[0], cycle: 1 },
      ...importRow.checkpoints.slice(2),
    ],
  };
  assert.throws(
    () =>
      validateImportWorkspaceLifecycleReport(
        { ...report, cases: [duplicateCycle, workspaceRow] },
        expected,
      ),
    /phases or cycles/,
  );
  const leakedWorkspace = {
    ...workspaceRow,
    checkpoints: [
      {
        ...workspaceRow.checkpoints[0],
        alternate: {
          ...workspaceRow.checkpoints[0].alternate,
          scene: {
            ...workspaceRow.checkpoints[0].alternate.scene,
            entities: 99,
          },
        },
      },
    ],
  };
  assert.throws(
    () =>
      validateImportWorkspaceLifecycleReport(
        { ...report, cases: [importRow, leakedWorkspace] },
        expected,
      ),
    /scene resource counts changed/,
  );
});
