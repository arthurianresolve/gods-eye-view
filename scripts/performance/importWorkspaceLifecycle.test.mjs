import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { clickAndWaitForWorkspaceOpen } from './workspaceOpenProbe.mjs';
import {
  createLifecycleImportFixture,
  createLifecycleReport,
  finalizeLifecycleReportStatus,
  runImportWorkspaceLifecycle,
  validateLifecycleCandidate,
  WORKSPACE_IMPORT_FIXTURE_SHA256,
} from '../qa-import-workspace-lifecycle.mjs';
import {
  assertOwnedLifecycleCheckpoint,
  installLifecycleRenderWaiter,
  parseImportWorkspaceLifecycleArgs,
  runCooperativeImportLifecycleCase,
  runWorkspaceReplacementLifecycleCase,
  validateImportWorkspaceLifecycleReport,
} from './importWorkspaceLifecycle.mjs';

const appSha = 'a'.repeat(40);
const harnessSha = 'b'.repeat(40);
const importSha = 'c'.repeat(64);
const workspaceSha = 'd'.repeat(64);

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
    replacement: loadResult(`lifecycle-replacement-${cycle}`, 2),
    snapshot: snapshot({
      count: 2,
      workspaceId: `lifecycle-replacement-${cycle}`,
    }),
  });
  const superseded = await runCooperativeImportLifecycleCase({
    driver: supersedeDriver,
    cycles: 1,
    featureCount: 2,
  });
  assert.equal(superseded.status, 'failed');
  assert.equal(superseded.operations.supersededLoads, 0);
  assert.equal(superseded.failedPhase, 'queued-supersession-1');
});

test('failed operations preserve completed counts, phase, and cleanup failures', async () => {
  const driver = importDriver({ failMeasured: true, cleanupFailure: true });
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
