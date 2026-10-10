import assert from 'node:assert/strict';

const SHA1 = /^[a-f0-9]{40}$/i;
const SHA256 = /^[a-f0-9]{64}$/i;
const CASES = ['cooperative-import', 'workspace-replacement'];
const RESOURCE_KEYS = [
  'entities',
  'dataSources',
  'primitives',
  'groundPrimitives',
];

/** Install a bounded observer that resolves only after Cesium actually rendered the target imports. */
export function installLifecycleRenderWaiter(scope = window) {
  let nextId = 0;
  const waits = new Map();
  function settle(id, error, value, status = null) {
    const row = waits.get(id);
    if (!row || row.settled) return;
    row.settled = true;
    row.status = status || (error ? 'failed' : 'completed');
    clearTimeout(row.timer);
    row.scene.postRender.removeEventListener(row.listener);
    if (error) row.reject(error);
    else row.resolve(value);
  }
  scope.__qaLifecycleStartRenderWait = ({
    workspaceId,
    count,
    timeoutMs,
    requireRestoreTransition = false,
  }) => {
    const app = scope.__godsEyeView;
    const scene = app?.viewer?.scene;
    if (!scene?.postRender?.addEventListener)
      throw new Error('Cesium completed-render event is unavailable.');
    const id = ++nextId;
    let resolve;
    let reject;
    const promise = new Promise((yes, no) => {
      resolve = yes;
      reject = no;
    });
    promise.catch(() => {});
    const startingFrame = scene.frameState?.frameNumber ?? null;
    const startingRestore =
      app?.workspaceLibraryPanel?.restore?.getState?.() || null;
    const prefix = `gev-import:${workspaceId}:`;
    const listener = () => {
      const current = scope.__godsEyeView;
      const state = current?.importedGeometryLayer?.getState?.();
      const restore =
        current?.workspaceLibraryPanel?.restore?.getState?.() || null;
      if (
        requireRestoreTransition &&
        (restore === startingRestore ||
          restore?.status !== 'applied' ||
          restore.workspaceId !== workspaceId)
      )
        return;
      const ids =
        current?.viewer?.entities?.values
          ?.filter((entity) => String(entity.id).startsWith(prefix))
          .map((entity) => String(entity.id)) || [];
      if (state?.featureCount !== count || ids.length !== count) return;
      const frameNumber = current.viewer.scene.frameState?.frameNumber ?? null;
      if (
        startingFrame !== null &&
        frameNumber !== null &&
        frameNumber <= startingFrame
      )
        return;
      settle(id, null, {
        frameNumber,
        importedEntityCount: ids.length,
        workspaceId,
      });
    };
    const timer = setTimeout(
      () => settle(id, new Error('Completed Cesium render was not observed.')),
      timeoutMs,
    );
    waits.set(id, {
      scene,
      listener,
      timer,
      resolve,
      reject,
      promise,
      settled: false,
      status: 'pending',
      workspaceId,
      count,
      startingFrame,
    });
    scene.postRender.addEventListener(listener);
    return id;
  };
  scope.__qaLifecycleWaitForRender = async (id) => {
    const row = waits.get(id);
    if (!row) throw new Error('Completed-render wait is unavailable.');
    try {
      return await row.promise;
    } finally {
      waits.delete(id);
    }
  };
  scope.__qaLifecycleCancelRenderWait = (id) => {
    const row = waits.get(id);
    if (!row) return;
    settle(
      id,
      new Error('Completed-render wait was cancelled.'),
      null,
      'cancelled',
    );
    waits.delete(id);
  };
  scope.__qaLifecycleRenderWaitSnapshot = () =>
    [...waits.entries()].slice(0, 8).map(([id, row]) => ({
      id,
      status: row.status,
      workspaceId: row.workspaceId,
      count: row.count,
      startingFrame: row.startingFrame,
    }));
  scope.__qaLifecycleCancelAll = () => {
    for (const id of [...waits.keys()]) {
      settle(id, new Error('Lifecycle page is closing.'), null, 'cancelled');
      waits.delete(id);
    }
  };
}

function requireCount(value, label) {
  if (!Number.isSafeInteger(value) || value < 0)
    throw new TypeError(`${label} must be a nonnegative safe integer.`);
}

export function parseImportWorkspaceLifecycleArgs(args = []) {
  const options = {
    url: 'http://localhost:4174',
    cycles: 5,
    drainMs: 10_000,
    featureCount: 512,
    out: null,
    expectedCommit: null,
  };
  const values = new Map([
    ['--url', 'url'],
    ['--cycles', 'cycles'],
    ['--drain-ms', 'drainMs'],
    ['--features', 'featureCount'],
    ['--out', 'out'],
    ['--expected-commit', 'expectedCommit'],
  ]);
  for (let index = 0; index < args.length; index++) {
    const name = args[index];
    const key = values.get(name);
    if (!key || index + 1 >= args.length || args[index + 1].startsWith('--'))
      throw new TypeError(`Invalid lifecycle runner argument: ${name}`);
    const value = args[++index];
    if (key === 'cycles' || key === 'drainMs' || key === 'featureCount') {
      const parsed = Number(value);
      if (!Number.isSafeInteger(parsed))
        throw new TypeError(`${name} must be an integer.`);
      options[key] = parsed;
    } else options[key] = value;
  }
  if (!/^https?:\/\//i.test(options.url))
    throw new TypeError('--url must be an HTTP(S) URL.');
  if (options.cycles < 1 || options.cycles > 10)
    throw new RangeError('--cycles must be between 1 and 10.');
  if (options.drainMs < 1 || options.drainMs > 10_000)
    throw new RangeError('--drain-ms must be between 1 and 10000.');
  if (options.featureCount < 1 || options.featureCount > 5000)
    throw new RangeError('--features must be between 1 and 5000.');
  if (options.out !== null && (!options.out || options.out.length > 1024))
    throw new TypeError('--out must be a nonempty bounded path.');
  if (options.expectedCommit !== null && !SHA1.test(options.expectedCommit))
    throw new TypeError('--expected-commit must be a full Git SHA.');
  return Object.freeze(options);
}

export function assertOwnedLifecycleCheckpoint(
  snapshot,
  {
    featureCount,
    pendingJobs = 0,
    restoreWorkspaceId = undefined,
    importWorkspaceId = undefined,
  } = {},
) {
  requireCount(featureCount, 'Expected feature count');
  requireCount(pendingJobs, 'Expected pending job count');
  const imports = snapshot?.imports;
  if (!imports) throw new TypeError('Import owner checkpoint is missing.');
  for (const [key, value] of Object.entries({
    featureCount: imports.featureCount,
    pendingJobs: imports.pendingJobs,
    cacheEntries: imports.cacheEntries,
  }))
    requireCount(value, `Import ${key}`);
  if (
    imports.featureCount !== featureCount ||
    imports.cacheEntries !== featureCount ||
    imports.pendingJobs !== pendingJobs
  )
    throw new Error(
      'Owned import resources differ from the declared checkpoint.',
    );
  if (
    !Array.isArray(snapshot.importEntityIds) ||
    snapshot.importEntityIds.length !== featureCount ||
    snapshot.importEntityIds.length > 5000 ||
    snapshot.importEntityIds.some((id) => typeof id !== 'string')
  )
    throw new Error('Owned import entity identity checkpoint is incomplete.');
  if (
    !Array.isArray(snapshot.importEntityRecords) ||
    snapshot.importEntityRecords.length !== featureCount ||
    snapshot.importEntityRecords.length > 5000 ||
    snapshot.importEntityRecords.some(
      (entity) =>
        typeof entity?.id !== 'string' ||
        typeof entity?.name !== 'string' ||
        !Array.isArray(entity.position) ||
        entity.position.length !== 3 ||
        entity.position.some((coordinate) => !Number.isFinite(coordinate)),
    )
  )
    throw new Error('Owned import contents are missing or malformed.');
  if (
    snapshot.importEntityRecords.some(
      (entity, index) => entity.id !== snapshot.importEntityIds[index],
    )
  )
    throw new Error('Owned import content and entity identity lists differ.');
  if (importWorkspaceId !== undefined) {
    const prefix = `gev-import:${importWorkspaceId}:`;
    if (snapshot.importEntityIds.some((id) => !id.startsWith(prefix)))
      throw new Error(
        'Imported entities do not belong to the expected workspace.',
      );
  }
  const scene = snapshot.scene;
  if (!scene) throw new TypeError('Scene resource checkpoint is missing.');
  for (const key of RESOURCE_KEYS) requireCount(scene[key], `Scene ${key}`);
  const restore = snapshot.restore;
  if (restoreWorkspaceId !== undefined) {
    if (
      restore?.status !== 'applied' ||
      restore.workspaceId !== restoreWorkspaceId ||
      restore.error !== null
    )
      throw new Error(
        'Workspace restore owner is not settled on the expected ID.',
      );
  }
  assertWorkerCheckpoint(snapshot.workerCounters);
  return snapshot;
}

export function assertWorkerCheckpoint(worker) {
  if (
    worker?.scope !== 'cumulative-per-document' ||
    worker?.instrumented !== true ||
    worker.overflow !== false ||
    !Number.isSafeInteger(worker.pending) ||
    worker.pending !== 0 ||
    !Array.isArray(worker.workers) ||
    worker.workers.length > 64 ||
    worker.workers.some(
      (item) =>
        !item ||
        !Number.isSafeInteger(item.submitted) ||
        !Number.isSafeInteger(item.completed) ||
        !Number.isSafeInteger(item.taskErrors) ||
        !Number.isSafeInteger(item.cancelled) ||
        !Number.isSafeInteger(item.pending) ||
        item.pending !== 0 ||
        !Number.isSafeInteger(item.workerErrors) ||
        item.workerErrors !== 0 ||
        !Number.isSafeInteger(item.postErrors) ||
        item.postErrors !== 0,
    )
  )
    throw new Error('Worker checkpoint is missing, pending, or overflowed.');
  return worker;
}

export function assertEquivalentOwnedResources(actual, expected) {
  assert.deepEqual(
    actual.imports,
    expected.imports,
    'import feature/cache/pending owner state changed',
  );
  assert.deepEqual(
    actual.scene,
    expected.scene,
    'scene resource counts changed',
  );
}

function boundedError(error) {
  return String(error?.message || error || 'Unknown lifecycle failure')
    .replace(/https?:\/\/[^\s"'<>]+/g, '[url]')
    .slice(0, 500);
}

function boundedToken(value, limit = 120) {
  return typeof value === 'string'
    ? value.replace(/[^a-zA-Z0-9_.:-]/g, '_').slice(0, limit)
    : null;
}

function boundedCounter(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function boundedWorkerKind(value) {
  const name = typeof value === 'string' ? value.split(/[\\/?#]/).at(-1) : '';
  return /^[a-zA-Z][a-zA-Z0-9_-]{0,70}\.js$/.test(name)
    ? name
    : 'opaque-worker';
}

function compactWorkerDiagnostics(value) {
  if (!value || typeof value !== 'object') return null;
  const workers = Array.isArray(value.workers) ? value.workers : [];
  return {
    scope: value.scope === 'cumulative-per-document' ? value.scope : null,
    instrumented:
      typeof value.instrumented === 'boolean' ? value.instrumented : null,
    overflow: typeof value.overflow === 'boolean' ? value.overflow : null,
    pending: boundedCounter(value.pending),
    workerCount: Number.isSafeInteger(value.workerCount)
      ? Math.max(0, value.workerCount)
      : workers.length,
    workersTruncated: workers.length > 64 || value.workersTruncated === true,
    workers: workers.slice(0, 64).map((worker) => ({
      kind: boundedWorkerKind(worker?.kind),
      submitted: boundedCounter(worker?.submitted),
      completed: boundedCounter(worker?.completed),
      taskErrors: boundedCounter(worker?.taskErrors),
      workerErrors: boundedCounter(worker?.workerErrors),
      postErrors: boundedCounter(worker?.postErrors),
      cancelled: boundedCounter(worker?.cancelled),
      pending: boundedCounter(worker?.pending),
      oldestPendingMs:
        Number.isFinite(worker?.oldestPendingMs) &&
        worker.oldestPendingMs >= 0 &&
        worker.oldestPendingMs <= 86_400_000
          ? Math.round(worker.oldestPendingMs * 100) / 100
          : null,
      terminated:
        typeof worker?.terminated === 'boolean' ? worker.terminated : null,
    })),
  };
}

function compactWorkerQuiescenceHistory(value) {
  if (!value || typeof value !== 'object') return null;
  const history = Array.isArray(value.history) ? value.history : [];
  const compactSample = (sample) => ({
    elapsedMs:
      Number.isFinite(sample?.elapsedMs) && sample.elapsedMs >= 0
        ? Math.round(sample.elapsedMs * 100) / 100
        : null,
    instrumented:
      typeof sample?.instrumented === 'boolean' ? sample.instrumented : null,
    overflow: typeof sample?.overflow === 'boolean' ? sample.overflow : null,
    pending: boundedCounter(sample?.pending),
    workersTruncated: sample?.workersTruncated === true,
    workers:
      compactWorkerDiagnostics({
        workers: Array.isArray(sample?.workers) ? sample.workers : [],
      })?.workers || [],
  });
  return {
    status: boundedToken(value.status, 40),
    reason: boundedToken(value.reason, 80),
    elapsedMs:
      Number.isFinite(value.elapsedMs) && value.elapsedMs >= 0
        ? Math.round(value.elapsedMs * 100) / 100
        : null,
    firstObservedZeroMs:
      Number.isFinite(value.firstObservedZeroMs) &&
      value.firstObservedZeroMs >= 0
        ? Math.round(value.firstObservedZeroMs * 100) / 100
        : null,
    maxPollingGapMs:
      Number.isFinite(value.maxPollingGapMs) && value.maxPollingGapMs >= 0
        ? Math.round(value.maxPollingGapMs * 100) / 100
        : null,
    pollCount: boundedCounter(value.pollCount),
    historyTruncated: value.historyTruncated === true || history.length > 202,
    history: history.slice(0, 202).map(compactSample),
    postZeroVerification: value.postZeroVerification
      ? {
          elapsedMs:
            Number.isFinite(value.postZeroVerification.elapsedMs) &&
            value.postZeroVerification.elapsedMs >= 0
              ? Math.round(value.postZeroVerification.elapsedMs * 100) / 100
              : null,
          pending: boundedCounter(value.postZeroVerification.pending),
          overflow: value.postZeroVerification.overflow === true,
          workersTruncated:
            value.postZeroVerification.workersTruncated === true,
        }
      : null,
    final: value.final ? compactSample(value.final) : null,
  };
}

/** Keep only small lifecycle counters and known worker-probe fields on failure. */
export function createLifecycleFailureEvidence({
  caseId = null,
  phase,
  error,
  operation = null,
  observation = null,
  observationError = null,
  workerPreflight = null,
  pageDiagnostics = null,
} = {}) {
  const evidence = {
    schema: 'gev-lifecycle-failure-evidence/v1',
    caseId: boundedToken(caseId),
    failedPhase: boundedToken(phase) || 'unknown',
    error: boundedError(error),
  };
  if (operation && typeof operation === 'object')
    evidence.operation = {
      name: boundedToken(operation.name),
      status: boundedToken(operation.status),
      renderWaitStatus: boundedToken(operation.renderWaitStatus),
      renderWaitId: boundedCounter(operation.renderWaitId),
      workspaceId: boundedToken(operation.workspaceId, 80),
      error: operation.error ? boundedError(operation.error) : null,
    };
  if (observation && typeof observation === 'object') {
    const imports = observation.imports || {};
    const scene = observation.scene || {};
    evidence.observation = {
      imports: {
        featureCount: boundedCounter(imports.featureCount),
        pendingJobs: boundedCounter(imports.pendingJobs),
        cacheEntries: boundedCounter(imports.cacheEntries),
      },
      workerCounters: compactWorkerDiagnostics(observation.workerCounters),
      frame: {
        frameNumber: boundedCounter(observation.frame?.frameNumber),
        requestRenderMode:
          typeof observation.frame?.requestRenderMode === 'boolean'
            ? observation.frame.requestRenderMode
            : null,
        renderRequested:
          typeof observation.frame?.renderRequested === 'boolean'
            ? observation.frame.renderRequested
            : null,
        renderWaiters: Array.isArray(observation.frame?.renderWaiters)
          ? observation.frame.renderWaiters.slice(0, 8).map((waiter) => ({
              id: boundedCounter(waiter?.id),
              status: boundedToken(waiter?.status, 40),
              workspaceId: boundedToken(waiter?.workspaceId, 80),
              count: boundedCounter(waiter?.count),
              startingFrame: boundedCounter(waiter?.startingFrame),
            }))
          : null,
      },
      scene: {
        entities: boundedCounter(scene.entities),
        dataSources: boundedCounter(scene.dataSources),
        primitives: boundedCounter(scene.primitives),
        groundPrimitives: boundedCounter(scene.groundPrimitives),
      },
    };
  }
  if (observationError)
    evidence.observationError = boundedError(observationError);
  if (workerPreflight && typeof workerPreflight === 'object') {
    const probe = workerPreflight.probe || {};
    const tasks = Array.isArray(probe.tasks) ? probe.tasks : [];
    const diagnostics = workerPreflight.diagnostics;
    evidence.workerPreflight = {
      network: workerPreflight.network
        ? {
            status: boundedToken(workerPreflight.network.status, 40),
            interceptedWorkerRequests: boundedCounter(
              workerPreflight.network.interceptedWorkerRequests,
            ),
          }
        : null,
      probe: workerPreflight.probe
        ? {
            status: boundedToken(probe.status, 40),
            tasksTruncated: tasks.length > 4,
            tasks: tasks.slice(0, 4).map((task) => ({
              id: boundedToken(task?.id, 40),
              outcome: boundedToken(task?.outcome, 40),
            })),
          }
        : null,
      diagnostics: compactWorkerDiagnostics(diagnostics),
      diagnosticsAtProbeCompletion: compactWorkerDiagnostics(
        workerPreflight.diagnosticsAtProbeCompletion,
      ),
      pendingAtProbeCompletion: boundedCounter(
        workerPreflight.pendingAtProbeCompletion,
      ),
      quiescenceWaitMs:
        Number.isFinite(workerPreflight.quiescenceWaitMs) &&
        workerPreflight.quiescenceWaitMs >= 0 &&
        workerPreflight.quiescenceWaitMs <= 15_000
          ? Math.round(workerPreflight.quiescenceWaitMs * 100) / 100
          : null,
      quiescenceTimeoutMs: boundedCounter(workerPreflight.quiescenceTimeoutMs),
      quiescenceHistory: compactWorkerQuiescenceHistory(
        workerPreflight.quiescenceHistory,
      ),
      networkError: workerPreflight.networkError
        ? boundedError(workerPreflight.networkError)
        : null,
      probeError: workerPreflight.probeError
        ? boundedError(workerPreflight.probeError)
        : null,
      diagnosticSnapshotError: workerPreflight.diagnosticSnapshotError
        ? boundedError(workerPreflight.diagnosticSnapshotError)
        : null,
    };
  }
  if (pageDiagnostics && typeof pageDiagnostics === 'object')
    evidence.pageDiagnostics = {
      errors: Array.isArray(pageDiagnostics.errors)
        ? pageDiagnostics.errors.slice(-4).map((item) => boundedError(item))
        : [],
      messages: Array.isArray(pageDiagnostics.messages)
        ? pageDiagnostics.messages.slice(-4).map((item) => boundedError(item))
        : [],
    };
  return evidence;
}

function setPhase(progress, driver, phase) {
  progress.phase = phase;
  driver.onPhase?.(phase, progress);
}

async function withCaseCleanup(driver, progress, run) {
  let primaryError = null;
  let primaryFailurePhase = null;
  let result;
  try {
    result = await run();
  } catch (error) {
    primaryError = error;
    primaryFailurePhase = progress.phase || 'unknown';
  }
  let failureEvidence = null;
  let failureEvidenceError = null;
  if (primaryError && typeof driver.failureEvidence === 'function') {
    try {
      failureEvidence = await driver.failureEvidence({
        phase: primaryFailurePhase,
        error: primaryError,
      });
    } catch (error) {
      failureEvidenceError = boundedError(error);
    }
  }
  let cleanupError = null;
  try {
    setPhase(progress, driver, 'cleanup-owned-context');
    await driver.close?.();
  } catch (error) {
    cleanupError = error;
  }
  if (primaryError || cleanupError) {
    return {
      ...progress,
      ...(result || {}),
      status: 'failed',
      failedPhase: primaryFailurePhase || progress.phase || 'unknown',
      error: boundedError(primaryError || cleanupError),
      ...(failureEvidence ? { failureEvidence } : {}),
      ...(failureEvidenceError ? { failureEvidenceError } : {}),
      ...(cleanupError ? { cleanupError: boundedError(cleanupError) } : {}),
    };
  }
  return result;
}

export async function runCooperativeImportLifecycleCase({
  driver,
  cycles = 5,
  featureCount = 512,
  featureIds = Array.from({ length: featureCount }, (_, index) =>
    String(index),
  ),
  importId = 'fixture',
} = {}) {
  if (!driver || typeof driver.checkpoint !== 'function')
    throw new TypeError('An import lifecycle driver is required.');
  if (!Number.isSafeInteger(cycles) || cycles < 1 || cycles > 10)
    throw new RangeError('Import lifecycle cycles must be between 1 and 10.');
  requireCount(featureCount, 'Import fixture feature count');
  if (
    !Array.isArray(featureIds) ||
    featureIds.length !== featureCount ||
    featureIds.some((id) => typeof id !== 'string' || !id || id.length > 200)
  )
    throw new TypeError('Import fixture entity identities are incomplete.');
  const operations = {
    warmupLoads: 0,
    completedLoads: 0,
    cancellations: 0,
    supersededLoads: 0,
    completedReplacementLoads: 0,
    clearDrains: 0,
  };
  const checkpoints = [];
  const progress = {
    id: 'cooperative-import',
    cycles,
    featureCount,
    operations,
    checkpoints,
  };
  return withCaseCleanup(driver, progress, async () => {
    setPhase(progress, driver, 'initial-empty-checkpoint');
    const initialEmpty = assertOwnedLifecycleCheckpoint(
      await driver.checkpoint(),
      { featureCount: 0 },
    );
    progress.initialEmpty = initialEmpty;
    setPhase(progress, driver, 'warmup-load');
    const warmup = await driver.load({ featureCount, kind: 'warmup' });
    assertLoadResult(
      warmup,
      featureCount,
      'lifecycle-warmup',
      featureIds,
      importId,
    );
    operations.warmupLoads++;
    setPhase(progress, driver, 'warmup-drain');
    let drained = assertOwnedLifecycleCheckpoint(await driver.clearAndDrain(), {
      featureCount: 0,
    });
    assertRenderedPopulation(drained.renderedPopulation, '__empty__', 0);
    operations.clearDrains++;
    // Establish the comparison baseline after caches and Cesium resources warm.
    const warmedBaseline = drained;
    progress.warmedBaseline = warmedBaseline;

    for (let cycle = 1; cycle <= cycles; cycle++) {
      setPhase(progress, driver, `measured-load-${cycle}`);
      const loaded = await driver.load({
        featureCount,
        kind: 'measured',
        cycle,
      });
      assertLoadResult(
        loaded,
        featureCount,
        `lifecycle-measured-${cycle}`,
        featureIds,
        importId,
      );
      operations.completedLoads++;
      const loadedEntityIds = [...loaded.importEntityIds];
      setPhase(progress, driver, `measured-drain-${cycle}`);
      drained = assertOwnedLifecycleCheckpoint(await driver.clearAndDrain(), {
        featureCount: 0,
      });
      assertRenderedPopulation(drained.renderedPopulation, '__empty__', 0);
      operations.clearDrains++;
      assertEquivalentOwnedResources(drained, warmedBaseline);
      checkpoints.push({
        cycle,
        phase: 'load-clear',
        loadedEntityIds,
        renderedPopulation: loaded.renderedPopulation,
        snapshot: drained,
      });

      setPhase(progress, driver, `queued-cancellation-${cycle}`);
      const cancellation = await driver.cancelQueued({ cycle, featureCount });
      if (
        cancellation?.status !== 'cancelled' ||
        cancellation.queuedObserved !== true
      )
        throw new Error(
          `Queued import cancellation ${cycle} was not observed.`,
        );
      const cancellationDrain = await driver.clearAndDrain();
      const cancellationSnapshot = assertOwnedLifecycleCheckpoint(
        cancellationDrain,
        { featureCount: 0 },
      );
      assertRenderedPopulation(
        cancellationSnapshot.renderedPopulation,
        '__empty__',
        0,
      );
      assertEquivalentOwnedResources(cancellationSnapshot, warmedBaseline);
      operations.cancellations++;
      operations.clearDrains++;
      checkpoints.push({
        cycle,
        phase: 'cancelled-while-queued',
        snapshot: cancellationSnapshot,
      });

      setPhase(progress, driver, `queued-supersession-${cycle}`);
      const supersession = await driver.supersedeQueued({
        cycle,
        featureCount,
      });
      if (
        supersession?.oldStatus !== 'cancelled' ||
        supersession?.queuedObserved !== true ||
        supersession?.oldIdsStillPresent !== false
      )
        throw new Error(`Queued import supersession ${cycle} did not settle.`);
      assertLoadResult(
        supersession.replacement,
        featureCount,
        `lifecycle-replacement-${cycle}`,
        featureIds,
        importId,
      );
      operations.supersededLoads++;
      operations.completedReplacementLoads++;
      const replacementSnapshot = assertOwnedLifecycleCheckpoint(
        supersession.snapshot,
        { featureCount, importWorkspaceId: `lifecycle-replacement-${cycle}` },
      );
      replacementSnapshot.renderedPopulation =
        supersession.replacement.renderedPopulation;
      const oldPrefix = `gev-import:lifecycle-superseded-${cycle}:`;
      if (
        replacementSnapshot.importEntityIds.some((id) =>
          id.startsWith(oldPrefix),
        )
      )
        throw new Error('Superseded import entities remained in the scene.');
      checkpoints.push({
        cycle,
        phase: 'superseded-replacement-loaded',
        snapshot: replacementSnapshot,
      });
      setPhase(progress, driver, `replacement-drain-${cycle}`);
      const afterSupersession = await driver.clearAndDrain();
      assertOwnedLifecycleCheckpoint(afterSupersession, { featureCount: 0 });
      assertRenderedPopulation(
        afterSupersession.renderedPopulation,
        '__empty__',
        0,
      );
      assertEquivalentOwnedResources(afterSupersession, warmedBaseline);
      operations.clearDrains++;
      checkpoints.push({
        cycle,
        phase: 'superseded-replacement-cleared',
        snapshot: afterSupersession,
      });
      drained = afterSupersession;
    }
    return {
      id: 'cooperative-import',
      status: 'passed',
      cycles,
      featureCount,
      operations,
      checkpoints,
      baseline: warmedBaseline,
      final: drained,
      workerCounters: await driver.workerCounters?.(),
      workerPreflight: driver.workerPreflight,
    };
  });
}

function assertLoadResult(
  result,
  featureCount,
  workspaceId,
  featureIds,
  importId,
) {
  const expectedIds = featureIds.map(
    (id) => `gev-import:${workspaceId}:${importId}:${id}`,
  );
  if (
    result?.drawn !== featureCount ||
    !Array.isArray(result.importEntityIds) ||
    result.importEntityIds.length !== featureCount ||
    result.importEntityIds.some((id, index) => id !== expectedIds[index])
  )
    throw new Error(
      `Import did not complete with the expected entity IDs: ${workspaceId}.`,
    );
  assertRenderedPopulation(
    result.renderedPopulation,
    workspaceId,
    featureCount,
  );
}

function assertRenderedPopulation(observation, workspaceId, featureCount) {
  if (
    !Number.isSafeInteger(observation?.frameNumber) ||
    !Number.isSafeInteger(observation?.importedEntityCount) ||
    observation.importedEntityCount !== featureCount ||
    observation.workspaceId !== workspaceId
  )
    throw new Error(
      `A completed render of the expected import population was not observed: ${workspaceId}.`,
    );
  return observation;
}

export async function runWorkspaceReplacementLifecycleCase({
  driver,
  cycles = 5,
} = {}) {
  if (!driver || typeof driver.open !== 'function')
    throw new TypeError('A workspace lifecycle driver is required.');
  if (!Number.isSafeInteger(cycles) || cycles < 1 || cycles > 10)
    throw new RangeError(
      'Workspace lifecycle cycles must be between 1 and 10.',
    );
  const operations = { completedWorkspaceReplacements: 0 };
  const checkpoints = [];
  const progress = {
    id: 'workspace-replacement',
    cycles,
    operations,
    checkpoints,
  };
  return withCaseCleanup(driver, progress, async () => {
    setPhase(progress, driver, 'seed-workspaces');
    const identity = await driver.seed();
    if (
      typeof identity?.baselineId !== 'string' ||
      !identity.baselineId ||
      typeof identity?.alternateId !== 'string' ||
      !identity.alternateId ||
      identity.baselineId === identity.alternateId ||
      !Number.isSafeInteger(identity.featureCount) ||
      identity.featureCount < 1
    )
      throw new Error('Equivalent stored workspace identities are incomplete.');
    const initialBaseline = await driver.open(identity.baselineId);
    assertRenderedPopulation(
      initialBaseline.renderedPopulation,
      identity.baselineId,
      identity.featureCount,
    );
    const baseline = assertOwnedLifecycleCheckpoint(initialBaseline, {
      featureCount: identity.featureCount,
      restoreWorkspaceId: identity.baselineId,
      importWorkspaceId: identity.baselineId,
    });
    assertEquivalentImportIdentities(baseline, identity.baselineId, null, null);
    progress.baseline = baseline;
    progress.workspaceIdentity = identity;
    setPhase(progress, driver, 'initial-alternate-open');
    const initialAlternate = await driver.open(identity.alternateId);
    assertRenderedPopulation(
      initialAlternate.renderedPopulation,
      identity.alternateId,
      identity.featureCount,
    );
    const alternate = assertOwnedLifecycleCheckpoint(initialAlternate, {
      featureCount: identity.featureCount,
      restoreWorkspaceId: identity.alternateId,
      importWorkspaceId: identity.alternateId,
    });
    assertEquivalentImportIdentities(
      alternate,
      identity.alternateId,
      baseline,
      identity.baselineId,
    );
    const warmedBaselineObservation = await driver.open(identity.baselineId);
    assertRenderedPopulation(
      warmedBaselineObservation.renderedPopulation,
      identity.baselineId,
      identity.featureCount,
    );
    const warmedBaseline = assertOwnedLifecycleCheckpoint(
      warmedBaselineObservation,
      {
        featureCount: identity.featureCount,
        restoreWorkspaceId: identity.baselineId,
        importWorkspaceId: identity.baselineId,
      },
    );
    progress.warmedBaseline = warmedBaseline;

    for (let cycle = 1; cycle <= cycles; cycle++) {
      setPhase(progress, driver, `open-alternate-${cycle}`);
      const alternateObservation = await driver.open(identity.alternateId);
      assertRenderedPopulation(
        alternateObservation.renderedPopulation,
        identity.alternateId,
        identity.featureCount,
      );
      const alternateSnapshot = assertOwnedLifecycleCheckpoint(
        alternateObservation,
        {
          featureCount: identity.featureCount,
          restoreWorkspaceId: identity.alternateId,
          importWorkspaceId: identity.alternateId,
        },
      );
      assertEquivalentOwnedResources(alternateSnapshot, warmedBaseline);
      assertEquivalentImportIdentities(
        alternateSnapshot,
        identity.alternateId,
        baseline,
        identity.baselineId,
      );
      setPhase(progress, driver, `return-baseline-${cycle}`);
      const returnedObservation = await driver.open(identity.baselineId);
      assertRenderedPopulation(
        returnedObservation.renderedPopulation,
        identity.baselineId,
        identity.featureCount,
      );
      const returned = assertOwnedLifecycleCheckpoint(returnedObservation, {
        featureCount: identity.featureCount,
        restoreWorkspaceId: identity.baselineId,
        importWorkspaceId: identity.baselineId,
      });
      assertEquivalentOwnedResources(returned, warmedBaseline);
      assertEquivalentImportIdentities(
        returned,
        identity.baselineId,
        baseline,
        identity.baselineId,
      );
      operations.completedWorkspaceReplacements++;
      checkpoints.push({
        cycle,
        phase: 'alternation',
        alternatedIds: [identity.alternateId, identity.baselineId],
        alternate: alternateSnapshot,
        returned,
      });
    }
    return {
      id: 'workspace-replacement',
      status: 'passed',
      cycles,
      operations,
      baselineWorkspaceId: identity.baselineId,
      alternateWorkspaceId: identity.alternateId,
      featureCount: identity.featureCount,
      checkpoints,
      baseline: warmedBaseline,
      final: checkpoints.at(-1)?.returned || warmedBaseline,
      workerCounters: await driver.workerCounters?.(),
      workerPreflight: driver.workerPreflight,
    };
  });
}

function assertEquivalentImportIdentities(
  snapshot,
  workspaceId,
  baseline,
  baselineWorkspaceId,
) {
  const prefix = `gev-import:${workspaceId}:`;
  const ids = snapshot.importEntityIds
    .map((id) => id.slice(prefix.length))
    .sort();
  if (baseline) {
    const basePrefix = `gev-import:${baselineWorkspaceId}:`;
    const baseIds = baseline.importEntityIds
      .map((id) => id.slice(basePrefix.length))
      .sort();
    assert.deepEqual(
      ids,
      baseIds,
      'workspace replacement imported different feature IDs',
    );
    const records = snapshot.importEntityRecords
      .map(({ id, name, position }) => ({
        id: id.slice(prefix.length),
        name,
        position,
      }))
      .sort((left, right) => left.id.localeCompare(right.id));
    const baseRecords = baseline.importEntityRecords
      .map(({ id, name, position }) => ({
        id: id.slice(basePrefix.length),
        name,
        position,
      }))
      .sort((left, right) => left.id.localeCompare(right.id));
    assert.deepEqual(
      records,
      baseRecords,
      'workspace replacement imported different content',
    );
  }
}

export function validateImportWorkspaceLifecycleReport(
  report,
  {
    expectedCommit,
    expectedImportFixtureSha256,
    expectedWorkspaceFixtureSha256,
  } = {},
) {
  if (
    report?.schema !== 'gev-import-workspace-lifecycle/v1' ||
    report.status !== 'passed' ||
    !SHA1.test(expectedCommit || '') ||
    report.applicationCommit !== expectedCommit ||
    report.applicationCommitAtEnd !== expectedCommit ||
    report.applicationSourceCleanAtEnd !== true ||
    report.sourceChangedDuringRun !== false ||
    !SHA1.test(report.harnessCommit || '') ||
    report.harnessSourceClean !== true ||
    report.applicationSourceClean !== true ||
    !Number.isSafeInteger(report.cycles) ||
    report.cycles < 1 ||
    report.cycles > 10 ||
    !SHA256.test(expectedImportFixtureSha256 || '') ||
    !SHA256.test(expectedWorkspaceFixtureSha256 || '') ||
    report.fixtures?.cooperativeImportSha256 !== expectedImportFixtureSha256 ||
    report.fixtures?.cooperativeImportSourceId !== 'lifecycle-fixture' ||
    report.fixtures?.workspaceImportSha256 !== expectedWorkspaceFixtureSha256 ||
    !Number.isSafeInteger(report.fixtures?.cooperativeImportCount) ||
    report.fixtures.cooperativeImportCount < 1 ||
    report.fixtures.cooperativeImportCount > 5000 ||
    !Array.isArray(report.fixtures.cooperativeImportRecordIds) ||
    report.fixtures.cooperativeImportRecordIds.length !==
      report.fixtures.cooperativeImportCount ||
    new Set(report.fixtures.cooperativeImportRecordIds).size !==
      report.fixtures.cooperativeImportCount ||
    report.fixtures?.workspaceImportCount !== 1 ||
    !Array.isArray(report.cases) ||
    report.cases.length !== CASES.length
  )
    throw new Error('Lifecycle report identity or case inventory is invalid.');
  for (const id of CASES) {
    const row = report.cases.find((candidate) => candidate.id === id);
    if (
      !row ||
      row.status !== 'passed' ||
      row.cycles !== report.cycles ||
      row.applicationCommit !== expectedCommit ||
      row.allLayersDisabled !== true ||
      !Array.isArray(row.disabledLayers) ||
      row.disabledLayers.length === 0 ||
      row.disabledLayers.length > 128 ||
      new Set(row.disabledLayers).size !== row.disabledLayers.length
    )
      throw new Error(`Lifecycle case is incomplete: ${id}.`);
    assertWorkerCheckpoint(row.workerCounters);
    if (
      row.workerPreflight?.scope !== 'cumulative-per-document' ||
      row.workerPreflight?.status !== 'passed' ||
      !Number.isSafeInteger(row.workerPreflight.taskCount) ||
      row.workerPreflight.taskCount !== 4 ||
      !Number.isSafeInteger(row.workerPreflight.cumulativeSubmitted) ||
      row.workerPreflight.cumulativeSubmitted < 4 ||
      !Number.isSafeInteger(row.workerPreflight.cumulativeCompleted) ||
      row.workerPreflight.cumulativeCompleted >
        row.workerPreflight.cumulativeSubmitted ||
      !Number.isSafeInteger(row.workerPreflight.cumulativeCancelled) ||
      row.workerPreflight.cumulativeCancelled >
        row.workerPreflight.cumulativeSubmitted ||
      !Number.isSafeInteger(row.workerPreflight.pendingAtProbeCompletion) ||
      row.workerPreflight.pendingAtProbeCompletion < 0 ||
      !Number.isSafeInteger(row.workerPreflight.quiescenceTimeoutMs) ||
      row.workerPreflight.quiescenceTimeoutMs < 1 ||
      row.workerPreflight.quiescenceTimeoutMs > report.drainLimitMs ||
      !Number.isFinite(row.workerPreflight.quiescenceWaitMs) ||
      row.workerPreflight.quiescenceWaitMs < 0 ||
      row.workerPreflight.quiescenceWaitMs >
        row.workerPreflight.quiescenceTimeoutMs ||
      !Number.isSafeInteger(row.workerPreflight.pendingAtPreflight) ||
      row.workerPreflight.pendingAtPreflight !== 0 ||
      row.workerPreflight.overflow !== false
    )
      throw new Error(`Worker preflight evidence is incomplete: ${id}.`);
    if (
      row.workerPreflight.pendingAtProbeCompletion > 0 &&
      (row.workerPreflight.quiescenceHistory?.status !== 'settled' ||
        row.workerPreflight.quiescenceHistory?.historyTruncated !== false ||
        !Array.isArray(row.workerPreflight.quiescenceHistory?.history) ||
        row.workerPreflight.quiescenceHistory.history.length < 2 ||
        row.workerPreflight.quiescenceHistory.history.length > 202 ||
        row.workerPreflight.quiescenceHistory.pollCount !==
          row.workerPreflight.quiescenceHistory.history.length ||
        !Number.isFinite(
          row.workerPreflight.quiescenceHistory?.firstObservedZeroMs,
        ) ||
        row.workerPreflight.quiescenceHistory.firstObservedZeroMs < 0 ||
        row.workerPreflight.quiescenceHistory.firstObservedZeroMs >
          row.workerPreflight.quiescenceHistory.elapsedMs ||
        !Number.isFinite(
          row.workerPreflight.quiescenceHistory?.maxPollingGapMs,
        ) ||
        row.workerPreflight.quiescenceHistory.maxPollingGapMs < 0 ||
        !Number.isFinite(row.workerPreflight.quiescenceHistory?.elapsedMs) ||
        row.workerPreflight.quiescenceHistory.elapsedMs < 0 ||
        row.workerPreflight.quiescenceHistory.elapsedMs >
          row.workerPreflight.quiescenceTimeoutMs ||
        !Number.isFinite(
          row.workerPreflight.quiescenceHistory?.postZeroVerification
            ?.elapsedMs,
        ) ||
        row.workerPreflight.quiescenceHistory.postZeroVerification.elapsedMs <
          row.workerPreflight.quiescenceHistory.firstObservedZeroMs ||
        row.workerPreflight.quiescenceHistory.postZeroVerification.elapsedMs >
          row.workerPreflight.quiescenceTimeoutMs ||
        row.workerPreflight.quiescenceHistory?.postZeroVerification?.pending !==
          0 ||
        row.workerPreflight.quiescenceHistory?.postZeroVerification
          ?.overflow !== false ||
        row.workerPreflight.quiescenceHistory?.postZeroVerification
          ?.workersTruncated !== false)
    )
      throw new Error(`Worker quiescence history is incomplete: ${id}.`);
    if (
      !Array.isArray(row.checkpoints) ||
      row.checkpoints.length === 0 ||
      row.checkpoints.length > report.cycles * 4 + 4
    )
      throw new Error(`Lifecycle checkpoints are incomplete: ${id}.`);
    const expectedCheckpointCount =
      id === CASES[0] ? report.cycles * 4 : report.cycles;
    if (row.checkpoints.length !== expectedCheckpointCount)
      throw new Error(
        `Lifecycle checkpoint count does not match completed cycles: ${id}.`,
      );
    const expectedPhases = Array.from({ length: report.cycles }, (_, index) =>
      id === CASES[0]
        ? [
            { cycle: index + 1, phase: 'load-clear' },
            { cycle: index + 1, phase: 'cancelled-while-queued' },
            { cycle: index + 1, phase: 'superseded-replacement-loaded' },
            { cycle: index + 1, phase: 'superseded-replacement-cleared' },
          ]
        : [{ cycle: index + 1, phase: 'alternation' }],
    ).flat();
    if (
      row.checkpoints.some(
        (checkpoint, index) =>
          checkpoint.cycle !== expectedPhases[index].cycle ||
          checkpoint.phase !== expectedPhases[index].phase,
      )
    )
      throw new Error(
        `Lifecycle checkpoint phases or cycles are invalid: ${id}.`,
      );
    if (!row.baseline || !row.final)
      throw new Error(
        `Lifecycle baseline/final observations are missing: ${id}.`,
      );
    if (id === CASES[0]) {
      if (row.featureCount !== report.fixtures.cooperativeImportCount)
        throw new Error('Cooperative import fixture population changed.');
      assertOwnedLifecycleCheckpoint(row.baseline, { featureCount: 0 });
      assertOwnedLifecycleCheckpoint(row.final, { featureCount: 0 });
      assertEquivalentOwnedResources(row.final, row.baseline);
    } else {
      if (
        typeof row.baselineWorkspaceId !== 'string' ||
        !row.baselineWorkspaceId ||
        typeof row.alternateWorkspaceId !== 'string' ||
        !row.alternateWorkspaceId ||
        row.baselineWorkspaceId === row.alternateWorkspaceId ||
        row.featureCount !== report.fixtures.workspaceImportCount
      )
        throw new Error(
          'Workspace report identities or population are incomplete.',
        );
      assertOwnedLifecycleCheckpoint(row.baseline, {
        featureCount: row.featureCount,
        restoreWorkspaceId: row.baselineWorkspaceId,
        importWorkspaceId: row.baselineWorkspaceId,
      });
      assertOwnedLifecycleCheckpoint(row.final, {
        featureCount: row.featureCount,
        restoreWorkspaceId: row.baselineWorkspaceId,
        importWorkspaceId: row.baselineWorkspaceId,
      });
      assertEquivalentOwnedResources(row.final, row.baseline);
      assertRenderedPopulation(
        row.baseline.renderedPopulation,
        row.baselineWorkspaceId,
        row.featureCount,
      );
      assertRenderedPopulation(
        row.final.renderedPopulation,
        row.baselineWorkspaceId,
        row.featureCount,
      );
      assertEquivalentImportIdentities(
        row.final,
        row.baselineWorkspaceId,
        row.baseline,
        row.baselineWorkspaceId,
      );
    }
    for (const checkpoint of row.checkpoints) {
      const snapshots = [
        checkpoint.snapshot,
        checkpoint.alternate,
        checkpoint.returned,
      ].filter(Boolean);
      if (snapshots.length === 0)
        throw new Error(`Lifecycle checkpoint is missing observations: ${id}.`);
      for (const snapshot of snapshots) {
        if (
          !Number.isSafeInteger(snapshot.imports?.pendingJobs) ||
          snapshot.imports.pendingJobs !== 0
        )
          throw new Error(
            `Lifecycle checkpoint has pending import work: ${id}.`,
          );
        for (const key of RESOURCE_KEYS)
          requireCount(snapshot.scene?.[key], `Checkpoint scene ${key}`);
        assertWorkerCheckpoint(snapshot.workerCounters);
      }
      if (id === CASES[0] && checkpoint.phase === 'load-clear') {
        assertOwnedLifecycleCheckpoint(checkpoint.snapshot, {
          featureCount: 0,
        });
        assertEquivalentOwnedResources(checkpoint.snapshot, row.baseline);
        assertRenderedPopulation(
          checkpoint.renderedPopulation,
          `lifecycle-measured-${checkpoint.cycle}`,
          report.fixtures.cooperativeImportCount,
        );
        const expectedIds = report.fixtures.cooperativeImportRecordIds.map(
          (recordId) =>
            `gev-import:lifecycle-measured-${checkpoint.cycle}:${report.fixtures.cooperativeImportSourceId}:${recordId}`,
        );
        assert.deepEqual(
          checkpoint.loadedEntityIds,
          expectedIds,
          'measured import did not load the declared fixture IDs',
        );
      }
      if (
        id === CASES[0] &&
        checkpoint.phase === 'superseded-replacement-loaded'
      ) {
        assertRenderedPopulation(
          checkpoint.snapshot.renderedPopulation,
          `lifecycle-replacement-${checkpoint.cycle}`,
          report.fixtures.cooperativeImportCount,
        );
        assertOwnedLifecycleCheckpoint(checkpoint.snapshot, {
          featureCount: report.fixtures.cooperativeImportCount,
          importWorkspaceId: `lifecycle-replacement-${checkpoint.cycle}`,
        });
        const expectedIds = report.fixtures.cooperativeImportRecordIds.map(
          (recordId) =>
            `gev-import:lifecycle-replacement-${checkpoint.cycle}:${report.fixtures.cooperativeImportSourceId}:${recordId}`,
        );
        assert.deepEqual(checkpoint.snapshot.importEntityIds, expectedIds);
      }
      if (
        id === CASES[0] &&
        ['cancelled-while-queued', 'superseded-replacement-cleared'].includes(
          checkpoint.phase,
        )
      ) {
        assertOwnedLifecycleCheckpoint(checkpoint.snapshot, {
          featureCount: 0,
        });
        assertEquivalentOwnedResources(checkpoint.snapshot, row.baseline);
      }
      if (id === CASES[1]) {
        assertOwnedLifecycleCheckpoint(checkpoint.alternate, {
          featureCount: row.featureCount,
          restoreWorkspaceId: row.alternateWorkspaceId,
          importWorkspaceId: row.alternateWorkspaceId,
        });
        assertOwnedLifecycleCheckpoint(checkpoint.returned, {
          featureCount: row.featureCount,
          restoreWorkspaceId: row.baselineWorkspaceId,
          importWorkspaceId: row.baselineWorkspaceId,
        });
        assertRenderedPopulation(
          checkpoint.alternate.renderedPopulation,
          row.alternateWorkspaceId,
          row.featureCount,
        );
        assertRenderedPopulation(
          checkpoint.returned.renderedPopulation,
          row.baselineWorkspaceId,
          row.featureCount,
        );
        assertEquivalentOwnedResources(checkpoint.alternate, row.baseline);
        assertEquivalentOwnedResources(checkpoint.returned, row.baseline);
        assertEquivalentImportIdentities(
          checkpoint.alternate,
          row.alternateWorkspaceId,
          row.baseline,
          row.baselineWorkspaceId,
        );
        assertEquivalentImportIdentities(
          checkpoint.returned,
          row.baselineWorkspaceId,
          row.baseline,
          row.baselineWorkspaceId,
        );
      }
    }
  }
  const importCase = report.cases.find((row) => row.id === CASES[0]);
  if (
    importCase.operations.completedLoads !== report.cycles ||
    importCase.operations.warmupLoads !== 1 ||
    importCase.operations.clearDrains !== report.cycles * 3 + 1 ||
    importCase.operations.cancellations !== report.cycles ||
    importCase.operations.supersededLoads !== report.cycles ||
    importCase.operations.completedReplacementLoads !== report.cycles
  )
    throw new Error(
      'Import lifecycle operation counts do not match completions.',
    );
  const workspaceCase = report.cases.find((row) => row.id === CASES[1]);
  if (
    workspaceCase.operations.completedWorkspaceReplacements !== report.cycles ||
    workspaceCase.baselineWorkspaceId !==
      workspaceCase.final?.restore?.workspaceId
  )
    throw new Error(
      'Workspace lifecycle did not return to its baseline owner.',
    );
  return report;
}
