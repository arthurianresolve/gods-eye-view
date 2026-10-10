import assert from 'node:assert/strict';

const SHA1 = /^[a-f0-9]{40}$/i;
const SHA256 = /^[a-f0-9]{64}$/i;
const CASES_V1 = ['cooperative-import', 'workspace-replacement'];
const CASES_V2 = [
  'cooperative-import',
  'workspace-replacement',
  'controlled-import-supersession',
];
const V1_SCHEMA = 'gev-import-workspace-lifecycle/v1';
const V2_SCHEMA = 'gev-import-workspace-lifecycle/v2';
const RESOURCE_KEYS = [
  'entities',
  'dataSources',
  'primitives',
  'groundPrimitives',
];

/** Read the page-owned observation through a function safe to serialize. */
export function readLifecycleDrainObservation(options = {}) {
  return window.__qaLifecycleDrainObservationSnapshot(options);
}

/** Install the sampler used by the existing import/worker drain predicate. */
export function installLifecycleDrainObserver(scope = window) {
  const DRAIN_HISTORY_CAP = 202;
  const DRAIN_WORKER_CAP = 64;
  let observation = null;

  const readCounter = (value) =>
    Number.isSafeInteger(value) && value >= 0 ? value : null;
  const readVector = (value, digits = 3) => {
    if (
      !value ||
      !Number.isFinite(value.x) ||
      !Number.isFinite(value.y) ||
      !Number.isFinite(value.z)
    )
      return null;
    const scale = 10 ** digits;
    return [value.x, value.y, value.z].map(
      (component) => Math.round(component * scale) / scale,
    );
  };
  const readKind = (value) => {
    const name = typeof value === 'string' ? value.split(/[\\/?#]/).at(-1) : '';
    return /^[a-zA-Z][a-zA-Z0-9_-]{0,70}\.js$/.test(name)
      ? name
      : 'opaque-worker';
  };
  const poseDistance = (left, right) => {
    if (!left || !right) return null;
    return Math.sqrt(
      left.reduce(
        (sum, component, index) => sum + (component - right[index]) ** 2,
        0,
      ),
    );
  };

  function readSample(elapsedMs) {
    const app = scope.__godsEyeView;
    const viewer = app?.viewer;
    const scene = viewer?.scene;
    const importState = app?.importedGeometryLayer?.getState?.();
    const importDiagnostics =
      app?.importedGeometryLayer?.getPerformanceDiagnostics?.();
    const rawWorkers = scope.__gevSoakWorkers?.snapshot?.() || null;
    const rawWorkerRows = Array.isArray(rawWorkers?.workers)
      ? rawWorkers.workers
      : null;
    const workersTruncated =
      rawWorkerRows === null ||
      rawWorkerRows.length > DRAIN_WORKER_CAP ||
      rawWorkers?.workersTruncated === true;
    const workers = rawWorkerRows
      ? rawWorkerRows.slice(0, DRAIN_WORKER_CAP).map((worker) => ({
          kind: readKind(worker?.kind),
          submitted: readCounter(worker?.submitted),
          completed: readCounter(worker?.completed),
          taskErrors: readCounter(worker?.taskErrors),
          workerErrors: readCounter(worker?.workerErrors),
          postErrors: readCounter(worker?.postErrors),
          cancelled: readCounter(worker?.cancelled),
          pending: readCounter(worker?.pending),
          oldestPendingMs:
            Number.isFinite(worker?.oldestPendingMs) &&
            worker.oldestPendingMs >= 0 &&
            worker.oldestPendingMs <= 86_400_000
              ? Math.round(worker.oldestPendingMs * 100) / 100
              : null,
          terminated:
            typeof worker?.terminated === 'boolean' ? worker.terminated : null,
        }))
      : [];
    const imports = {
      featureCount: readCounter(importState?.featureCount),
      pendingJobs: readCounter(importState?.pendingJobs),
      cacheEntries: readCounter(importDiagnostics?.cacheEntries),
    };
    const workerPending = readCounter(rawWorkers?.pending);
    const workerRowsValid =
      !workersTruncated &&
      workers.every((worker) =>
        [
          worker.submitted,
          worker.completed,
          worker.taskErrors,
          worker.workerErrors,
          worker.postErrors,
          worker.cancelled,
          worker.pending,
        ].every((value) => value !== null),
      );
    const workerPendingSum = workers.reduce(
      (sum, worker) => sum + (worker.pending ?? 0),
      0,
    );
    const valid =
      imports.featureCount !== null &&
      imports.pendingJobs !== null &&
      rawWorkers?.instrumented === true &&
      rawWorkers?.overflow === false &&
      workerPending !== null &&
      workerRowsValid &&
      workerPendingSum === workerPending;
    const camera = viewer?.camera;
    const position = readVector(camera?.positionWC);
    const direction = readVector(camera?.directionWC, 6);
    const up = readVector(camera?.upWC, 6);
    const cameraPose =
      position && direction && up ? { position, direction, up } : null;
    const globe = scene?.globe;
    return {
      elapsedMs: Math.round(Math.max(0, elapsedMs) * 100) / 100,
      valid,
      invalidReason: valid
        ? null
        : workersTruncated
          ? 'missing-or-truncated-worker-rows'
          : 'missing-or-invalid-drain-counters',
      imports,
      workerCounters: {
        instrumented: rawWorkers?.instrumented === true,
        overflow: rawWorkers?.overflow === true,
        pending: workerPending,
        workerCount: Number.isSafeInteger(rawWorkers?.workerCount)
          ? rawWorkers.workerCount
          : (rawWorkerRows?.length ?? null),
        workersTruncated,
        workers,
      },
      predicateSatisfied:
        valid &&
        imports.pendingJobs === 0 &&
        imports.featureCount === 0 &&
        workerPending === 0 &&
        rawWorkers.overflow === false,
      frame: {
        frameNumber: readCounter(scene?.frameState?.frameNumber),
        requestRenderMode:
          typeof scene?.requestRenderMode === 'boolean'
            ? scene.requestRenderMode
            : null,
        renderRequested:
          typeof scene?._renderRequested === 'boolean'
            ? scene._renderRequested
            : null,
      },
      globe: {
        available: Boolean(globe),
        tilesLoaded:
          typeof globe?.tilesLoaded === 'boolean' ? globe.tilesLoaded : null,
      },
      camera: cameraPose,
    };
  }

  const updateSummary = (sample) => {
    const previous = observation.history.at(-2) || null;
    observation.pollCount = observation.history.length;
    if (previous)
      observation.maxPollingGapMs = Math.max(
        observation.maxPollingGapMs,
        sample.elapsedMs - previous.elapsedMs,
      );
    if (sample.camera) {
      observation.firstCamera ??= sample.camera;
      sample.cameraDisplacementM = poseDistance(
        observation.firstCamera.position,
        sample.camera.position,
      );
      const directionDelta = poseDistance(
        observation.firstCamera.direction,
        sample.camera.direction,
      );
      const upDelta = poseDistance(
        observation.firstCamera.up,
        sample.camera.up,
      );
      sample.cameraOrientationDelta =
        directionDelta === null || upDelta === null
          ? null
          : Math.max(directionDelta, upDelta);
      sample.cameraMoved =
        sample.cameraDisplacementM === null ||
        sample.cameraOrientationDelta === null
          ? null
          : sample.cameraDisplacementM > 0.001 ||
            sample.cameraOrientationDelta > 0.000001;
      observation.cameraMaxDisplacementM =
        sample.cameraDisplacementM === null
          ? observation.cameraMaxDisplacementM
          : Math.max(
              observation.cameraMaxDisplacementM ?? 0,
              sample.cameraDisplacementM,
            );
      observation.cameraMaxOrientationDelta =
        sample.cameraOrientationDelta === null
          ? observation.cameraMaxOrientationDelta
          : Math.max(
              observation.cameraMaxOrientationDelta ?? 0,
              sample.cameraOrientationDelta,
            );
      observation.cameraMoved =
        observation.cameraMaxDisplacementM === null ||
        observation.cameraMaxOrientationDelta === null
          ? null
          : observation.cameraMaxDisplacementM > 0.001 ||
            observation.cameraMaxOrientationDelta > 0.000001;
    }
    if (
      previous &&
      sample.globe.tilesLoaded !== null &&
      previous.globe.tilesLoaded !== null &&
      sample.globe.tilesLoaded !== previous.globe.tilesLoaded
    ) {
      observation.tilesLoadedTransitionCount++;
      observation.firstTilesLoadedTransitionMs ??= sample.elapsedMs;
      observation.lastTilesLoadedTransitionMs = sample.elapsedMs;
    }
    observation.last = sample;
    return observation;
  };

  scope.__qaLifecycleStartDrainObservation = (timeoutMs) => {
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 10_000)
      throw new RangeError('Lifecycle drain observer timeout is invalid.');
    observation = {
      status: 'running',
      timeoutMs,
      startedAtPerformanceMs: performance.now(),
      elapsedMs: 0,
      firstWorkerZeroMs: null,
      firstQualifyingZeroMs: null,
      lateZeroElapsedMs: null,
      pollCount: 0,
      maxPollingGapMs: 0,
      historyTruncated: false,
      cameraMoved: null,
      cameraMaxDisplacementM: null,
      cameraMaxOrientationDelta: null,
      firstCamera: null,
      tilesLoadedTransitionCount: 0,
      firstTilesLoadedTransitionMs: null,
      lastTilesLoadedTransitionMs: null,
      history: [],
      last: null,
      postDeadlineObservation: null,
    };
    return observation.startedAtPerformanceMs;
  };

  scope.__qaLifecycleSampleDrain = () => {
    if (!observation || observation.status !== 'running') return false;
    const elapsedMs = Math.max(
      0,
      performance.now() - observation.startedAtPerformanceMs,
    );
    if (observation.history.length >= DRAIN_HISTORY_CAP) {
      observation.status = 'history-overflow';
      observation.historyTruncated = true;
      observation.pollCount = observation.history.length + 1;
      return false;
    }
    const sample = readSample(elapsedMs);
    observation.history.push(sample);
    observation.elapsedMs = sample.elapsedMs;
    if (
      sample.workerCounters.instrumented &&
      sample.workerCounters.pending === 0 &&
      observation.firstWorkerZeroMs === null
    )
      observation.firstWorkerZeroMs = sample.elapsedMs;
    if (sample.predicateSatisfied) {
      if (elapsedMs <= observation.timeoutMs) {
        observation.firstQualifyingZeroMs ??= sample.elapsedMs;
        observation.status = 'settled';
      } else {
        observation.lateZeroElapsedMs ??= sample.elapsedMs;
        observation.status = 'timed-out';
      }
    } else if (elapsedMs > observation.timeoutMs) {
      observation.status = 'timed-out';
    }
    updateSummary(sample);
    return observation.status === 'settled';
  };

  scope.__qaLifecycleDrainObservationSnapshot = ({
    sampleAfterDeadline = false,
    timedOut = false,
    includeHistory = true,
  } = {}) => {
    if (!observation) return null;
    if (sampleAfterDeadline && observation.status === 'running') {
      const elapsedMs = Math.max(
        0,
        performance.now() - observation.startedAtPerformanceMs,
      );
      const sample = readSample(elapsedMs);
      observation.elapsedMs = sample.elapsedMs;
      observation.postDeadlineObservation = {
        ...sample,
        afterDeadline: elapsedMs > observation.timeoutMs,
      };
      if (sample.predicateSatisfied && elapsedMs > observation.timeoutMs)
        observation.lateZeroElapsedMs ??= sample.elapsedMs;
      if (elapsedMs > observation.timeoutMs || timedOut)
        observation.status = 'timed-out';
      if (elapsedMs > observation.timeoutMs && sample.predicateSatisfied)
        observation.lateZeroElapsedMs ??= sample.elapsedMs;
    }
    const summary = { ...observation };
    delete summary.firstCamera;
    return {
      ...summary,
      history: includeHistory
        ? observation.history.slice(0, DRAIN_HISTORY_CAP)
        : [],
      historySampleCount: observation.history.length,
      historyIncluded: includeHistory,
    };
  };

  scope.__qaLifecycleClearDrainObservation = () => {
    observation = null;
  };
}

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

export function assertSceneReadiness(value) {
  const validVector = (vector) =>
    Array.isArray(vector) &&
    vector.length === 3 &&
    vector.every(Number.isFinite);
  const validSample = (sample) =>
    sample?.validEnvelope === true &&
    sample.instrumented === true &&
    sample.overflow === false &&
    sample.workersTruncated === false &&
    sample.pending === 0 &&
    sample.tilesLoaded === true &&
    Number.isSafeInteger(sample.frameNumber) &&
    sample.frameNumber >= 0 &&
    Number.isFinite(sample.elapsedMs) &&
    sample.elapsedMs >= 0 &&
    validVector(sample.camera?.position) &&
    validVector(sample.camera?.direction) &&
    validVector(sample.camera?.up) &&
    Array.isArray(sample.workers) &&
    sample.workers.length <= 64 &&
    sample.workers.reduce((sum, worker) => sum + worker.pending, 0) === 0 &&
    sample.workers.every(
      (worker) =>
        typeof worker.kind === 'string' &&
        worker.kind.length <= 80 &&
        [
          worker.submitted,
          worker.completed,
          worker.taskErrors,
          worker.workerErrors,
          worker.postErrors,
          worker.cancelled,
          worker.pending,
        ].every((count) => Number.isSafeInteger(count) && count >= 0) &&
        worker.taskErrors === 0 &&
        worker.workerErrors === 0 &&
        worker.postErrors === 0 &&
        Number.isSafeInteger(
          worker.completed + worker.cancelled + worker.pending,
        ) &&
        worker.submitted ===
          worker.completed + worker.cancelled + worker.pending,
    );
  if (
    value?.status !== 'ready' ||
    value.reason !== null ||
    value.timeoutMs !== 30_000 ||
    value.pollMs !== 100 ||
    value.stableWindowMs !== 1_000 ||
    value.historyTruncated !== false ||
    !Array.isArray(value.history) ||
    value.history.length < 10 ||
    value.history.length > 302 ||
    value.historySampleCount !== value.history.length ||
    value.observerDisposed !== true ||
    !Number.isFinite(value.elapsedMs) ||
    value.elapsedMs < 1_000 ||
    value.elapsedMs > value.timeoutMs ||
    !Number.isSafeInteger(value.stableSampleCount) ||
    value.stableSampleCount < 10 ||
    !Number.isFinite(value.stableElapsedMs) ||
    value.stableElapsedMs < value.stableWindowMs ||
    !Number.isSafeInteger(value.renderRequests) ||
    value.renderRequests < 1 ||
    !Number.isSafeInteger(value.completedPostRenders) ||
    value.completedPostRenders < 1 ||
    !Number.isSafeInteger(value.postRenderCountAtRequest) ||
    value.postRenderCountAtRequest < 0 ||
    !Number.isSafeInteger(value.frameNumberAtRequest) ||
    value.frameNumberAtRequest < 0 ||
    !validSample(value.final)
  )
    throw new Error('Cold scene readiness evidence is incomplete.');
  assert.deepEqual(value.final, value.history.at(-1));
  if (
    value.stableSampleCount > value.history.length ||
    value.history.at(-value.stableSampleCount)?.elapsedMs === undefined ||
    value.history.at(-1).elapsedMs -
      value.history.at(-value.stableSampleCount).elapsedMs <
      value.stableWindowMs
  )
    throw new Error('Cold scene stable window is not present in its history.');
  for (const sample of value.history.slice(-value.stableSampleCount)) {
    if (!validSample(sample))
      throw new Error('Cold scene stable sample is incomplete.');
    if (
      !Number.isSafeInteger(sample.postRenderCount) ||
      sample.postRenderCount < 0 ||
      !Number.isSafeInteger(sample.lastPostRenderFrame) ||
      sample.lastPostRenderFrame < 0 ||
      sample.elapsedMs > value.elapsedMs
    )
      throw new Error('Cold scene stable render history is incomplete.');
    assert.deepEqual(sample.camera, value.final.camera);
    assert.deepEqual(sample.workers, value.final.workers);
  }
  const stableHistory = value.history.slice(-value.stableSampleCount);
  if (
    stableHistory[0].postRenderCount <= value.postRenderCountAtRequest ||
    stableHistory[0].lastPostRenderFrame === null ||
    stableHistory[0].lastPostRenderFrame <= value.frameNumberAtRequest ||
    stableHistory[0].frameNumber <= value.frameNumberAtRequest
  )
    throw new Error(
      'Cold scene stable history does not contain the requested completed render.',
    );
  for (let index = 1; index < stableHistory.length; index++) {
    if (
      stableHistory[index].frameNumber < stableHistory[index - 1].frameNumber ||
      stableHistory[index].postRenderCount <
        stableHistory[index - 1].postRenderCount
    )
      throw new Error('Cold scene stable render history moved backward.');
  }
  return value;
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

function compactLifecycleDrainHistory(value) {
  if (!value || typeof value !== 'object') return null;
  const compactSample = (sample) => {
    const vector = (value) =>
      Array.isArray(value) && value.length === 3 && value.every(Number.isFinite)
        ? value.map(
            (component) => Math.round(component * 1_000_000) / 1_000_000,
          )
        : null;
    return {
      elapsedMs:
        Number.isFinite(sample?.elapsedMs) && sample.elapsedMs >= 0
          ? Math.round(sample.elapsedMs * 100) / 100
          : null,
      valid: sample?.valid === true,
      invalidReason: boundedToken(sample?.invalidReason, 60),
      predicateSatisfied: sample?.predicateSatisfied === true,
      imports: {
        featureCount: boundedCounter(sample?.imports?.featureCount),
        pendingJobs: boundedCounter(sample?.imports?.pendingJobs),
        cacheEntries: boundedCounter(sample?.imports?.cacheEntries),
      },
      workerCounters: compactWorkerDiagnostics({
        scope: 'cumulative-per-document',
        instrumented: sample?.workerCounters?.instrumented,
        overflow: sample?.workerCounters?.overflow,
        pending: sample?.workerCounters?.pending,
        workerCount: sample?.workerCounters?.workerCount,
        workersTruncated: sample?.workerCounters?.workersTruncated,
        workers: sample?.workerCounters?.workers,
      }),
      frame: {
        frameNumber: boundedCounter(sample?.frame?.frameNumber),
        requestRenderMode:
          typeof sample?.frame?.requestRenderMode === 'boolean'
            ? sample.frame.requestRenderMode
            : null,
        renderRequested:
          typeof sample?.frame?.renderRequested === 'boolean'
            ? sample.frame.renderRequested
            : null,
      },
      globe: {
        available:
          typeof sample?.globe?.available === 'boolean'
            ? sample.globe.available
            : null,
        tilesLoaded:
          typeof sample?.globe?.tilesLoaded === 'boolean'
            ? sample.globe.tilesLoaded
            : null,
      },
      camera: {
        position: vector(sample?.camera?.position),
        direction: vector(sample?.camera?.direction),
        up: vector(sample?.camera?.up),
      },
      cameraMoved:
        typeof sample?.cameraMoved === 'boolean' ? sample.cameraMoved : null,
      cameraDisplacementM:
        Number.isFinite(sample?.cameraDisplacementM) &&
        sample.cameraDisplacementM >= 0
          ? Math.round(sample.cameraDisplacementM * 1_000) / 1_000
          : null,
      cameraOrientationDelta:
        Number.isFinite(sample?.cameraOrientationDelta) &&
        sample.cameraOrientationDelta >= 0
          ? Math.round(sample.cameraOrientationDelta * 1_000_000) / 1_000_000
          : null,
    };
  };
  const history = Array.isArray(value.history) ? value.history : [];
  return {
    status: boundedToken(value.status, 40),
    timeoutMs: boundedCounter(value.timeoutMs),
    elapsedMs:
      Number.isFinite(value.elapsedMs) && value.elapsedMs >= 0
        ? Math.round(value.elapsedMs * 100) / 100
        : null,
    firstWorkerZeroMs:
      Number.isFinite(value.firstWorkerZeroMs) && value.firstWorkerZeroMs >= 0
        ? Math.round(value.firstWorkerZeroMs * 100) / 100
        : null,
    firstQualifyingZeroMs:
      Number.isFinite(value.firstQualifyingZeroMs) &&
      value.firstQualifyingZeroMs >= 0
        ? Math.round(value.firstQualifyingZeroMs * 100) / 100
        : null,
    lateZeroElapsedMs:
      Number.isFinite(value.lateZeroElapsedMs) && value.lateZeroElapsedMs >= 0
        ? Math.round(value.lateZeroElapsedMs * 100) / 100
        : null,
    pollCount: boundedCounter(value.pollCount),
    maxPollingGapMs:
      Number.isFinite(value.maxPollingGapMs) && value.maxPollingGapMs >= 0
        ? Math.round(value.maxPollingGapMs * 100) / 100
        : null,
    historyTruncated: value.historyTruncated === true || history.length > 202,
    historyIncluded: value.historyIncluded !== false,
    historySampleCount:
      boundedCounter(value.historySampleCount) ?? history.length,
    cameraMoved:
      typeof value.cameraMoved === 'boolean' ? value.cameraMoved : null,
    cameraMaxDisplacementM:
      Number.isFinite(value.cameraMaxDisplacementM) &&
      value.cameraMaxDisplacementM >= 0
        ? Math.round(value.cameraMaxDisplacementM * 1_000) / 1_000
        : null,
    cameraMaxOrientationDelta:
      Number.isFinite(value.cameraMaxOrientationDelta) &&
      value.cameraMaxOrientationDelta >= 0
        ? Math.round(value.cameraMaxOrientationDelta * 1_000_000) / 1_000_000
        : null,
    tilesLoadedTransitionCount: boundedCounter(
      value.tilesLoadedTransitionCount,
    ),
    firstTilesLoadedTransitionMs:
      Number.isFinite(value.firstTilesLoadedTransitionMs) &&
      value.firstTilesLoadedTransitionMs >= 0
        ? Math.round(value.firstTilesLoadedTransitionMs * 100) / 100
        : null,
    lastTilesLoadedTransitionMs:
      Number.isFinite(value.lastTilesLoadedTransitionMs) &&
      value.lastTilesLoadedTransitionMs >= 0
        ? Math.round(value.lastTilesLoadedTransitionMs * 100) / 100
        : null,
    history: history.slice(0, 202).map(compactSample),
    last: value.last ? compactSample(value.last) : null,
    postDeadlineObservation: value.postDeadlineObservation
      ? {
          ...compactSample(value.postDeadlineObservation),
          afterDeadline: value.postDeadlineObservation.afterDeadline === true,
        }
      : null,
  };
}

function compactSupersessionOutcome(value) {
  if (!value || typeof value !== 'object') return null;
  const replacement = value.replacement || {};
  const rendered = replacement.renderedPopulation;
  const entityIds = Array.isArray(replacement.importEntityIds)
    ? replacement.importEntityIds
    : [];
  const snapshot = value.snapshot || {};
  const snapshotIds = Array.isArray(snapshot.importEntityIds)
    ? snapshot.importEntityIds
    : [];
  const entityIdCount = boundedCounter(replacement.entityIdCount);
  return {
    cycle: boundedCounter(value.cycle),
    oldStatus: boundedToken(value.oldStatus, 40),
    queuedObserved:
      typeof value.queuedObserved === 'boolean' ? value.queuedObserved : null,
    oldIdsStillPresent:
      typeof value.oldIdsStillPresent === 'boolean'
        ? value.oldIdsStillPresent
        : null,
    replacement: {
      drawn: boundedCounter(replacement.drawn),
      omitted: boundedCounter(replacement.omitted),
      entityIdCount:
        entityIdCount ??
        (Array.isArray(replacement.importEntityIds)
          ? replacement.importEntityIds.length
          : null),
      entityIdsTruncated:
        replacement.entityIdsTruncated === true || entityIds.length > 16,
      entityIds: entityIds.slice(0, 16).map((id) => boundedToken(id, 200)),
      completedRenderStatus:
        Number.isSafeInteger(rendered?.frameNumber) &&
        Number.isSafeInteger(rendered?.importedEntityCount) &&
        typeof rendered?.workspaceId === 'string'
          ? 'observed'
          : rendered
            ? 'invalid'
            : 'missing',
      renderedPopulation: rendered
        ? {
            frameNumber: boundedCounter(rendered.frameNumber),
            importedEntityCount: boundedCounter(rendered.importedEntityCount),
            workspaceId: boundedToken(rendered.workspaceId, 80),
          }
        : null,
    },
    snapshot: {
      imports: {
        featureCount: boundedCounter(snapshot.imports?.featureCount),
        pendingJobs: boundedCounter(snapshot.imports?.pendingJobs),
      },
      frameNumber: boundedCounter(snapshot.frame?.frameNumber),
      importEntityIdCount:
        boundedCounter(snapshot.importEntityIdCount) ??
        (Array.isArray(snapshot.importEntityIds) ? snapshotIds.length : null),
      scene: {
        entities: boundedCounter(snapshot.scene?.entities),
        dataSources: boundedCounter(snapshot.scene?.dataSources),
        primitives: boundedCounter(snapshot.scene?.primitives),
        groundPrimitives: boundedCounter(snapshot.scene?.groundPrimitives),
      },
    },
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
  supersession = null,
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
      ...(!observation?.drainHistory
        ? {
            drainHistory: compactLifecycleDrainHistory(operation.drainHistory),
          }
        : {}),
      drainHistoryError: operation.drainHistoryError
        ? boundedError(operation.drainHistoryError)
        : null,
    };
  if (supersession !== undefined)
    evidence.supersession = compactSupersessionOutcome(supersession);
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
      drainHistory: compactLifecycleDrainHistory(observation.drainHistory),
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
        progress,
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
  includeRaceCoverage = true,
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

      if (!includeRaceCoverage) continue;

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
      progress.supersessionOutcome = null;
      const supersession = await driver.supersedeQueued({
        cycle,
        featureCount,
      });
      const replacement = supersession?.replacement;
      const replacementEntityIds = Array.isArray(replacement?.importEntityIds)
        ? replacement.importEntityIds
        : [];
      const supersessionSnapshot = supersession?.snapshot || {};
      progress.supersessionOutcome = {
        cycle,
        oldStatus: supersession?.oldStatus,
        queuedObserved: supersession?.queuedObserved,
        oldIdsStillPresent: supersession?.oldIdsStillPresent,
        replacement: replacement
          ? {
              drawn: replacement.drawn,
              omitted: replacement.omitted,
              entityIdCount: replacementEntityIds.length,
              entityIdsTruncated: replacementEntityIds.length > 16,
              importEntityIds: replacementEntityIds.slice(0, 16),
              renderedPopulation: replacement.renderedPopulation
                ? {
                    frameNumber: replacement.renderedPopulation.frameNumber,
                    importedEntityCount:
                      replacement.renderedPopulation.importedEntityCount,
                    workspaceId: replacement.renderedPopulation.workspaceId,
                  }
                : null,
            }
          : null,
        snapshot: {
          imports: {
            featureCount: supersessionSnapshot.imports?.featureCount,
            pendingJobs: supersessionSnapshot.imports?.pendingJobs,
          },
          frame: { frameNumber: supersessionSnapshot.frame?.frameNumber },
          importEntityIdCount: Array.isArray(
            supersessionSnapshot.importEntityIds,
          )
            ? supersessionSnapshot.importEntityIds.length
            : null,
          scene: supersessionSnapshot.scene,
        },
      };
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
      progress.supersessionOutcome = null;
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

/** Exercise the same import owner with an injected scheduler that proves a batch was queued. */
export async function runControlledImportSupersessionLifecycleCase({
  driver,
  cycles = 5,
  featureCount = 512,
  featureIds = Array.from({ length: featureCount }, (_, index) =>
    String(index),
  ),
  importId = 'fixture',
} = {}) {
  if (!driver || typeof driver.checkpoint !== 'function')
    throw new TypeError('A controlled import lifecycle driver is required.');
  if (!Number.isSafeInteger(cycles) || cycles < 1 || cycles > 10)
    throw new RangeError('Import lifecycle cycles must be between 1 and 10.');
  requireCount(featureCount, 'Import fixture feature count');
  if (
    !Array.isArray(featureIds) ||
    featureIds.length !== featureCount ||
    featureIds.some((id) => typeof id !== 'string' || !id || id.length > 200)
  )
    throw new TypeError('Import fixture entity identities are incomplete.');

  const progress = {
    id: 'controlled-import-supersession',
    mode: 'controlled-instance-scheduler',
    timingScope: 'correctness-only; no native timing claim',
    cycles,
    featureCount,
    operations: {
      warmupLoads: 0,
      cancellations: 0,
      supersessions: 0,
      completedReplacementLoads: 0,
      clearDrains: 0,
    },
    checkpoints: [],
  };
  const result = await withCaseCleanup(driver, progress, async () => {
    setPhase(progress, driver, 'controlled-owner-initial-empty');
    const initial = assertOwnedLifecycleCheckpoint(await driver.checkpoint(), {
      featureCount: 0,
    });
    assertControlledAppOwnerUntouched(initial);
    const warmup = await driver.warmup({ featureCount });
    assertLoadResult(
      warmup,
      featureCount,
      'controlled-warmup',
      featureIds,
      importId,
    );
    progress.operations.warmupLoads++;
    const warmed = assertOwnedLifecycleCheckpoint(
      await driver.clearAndDrain(),
      { featureCount: 0 },
    );
    assertControlledAppOwnerUntouched(warmed);
    assertRenderedPopulation(warmed.renderedPopulation, '__empty__', 0);
    progress.operations.clearDrains++;
    progress.baseline = warmed;
    progress.initialEmpty = initial;

    for (let cycle = 1; cycle <= cycles; cycle++) {
      setPhase(progress, driver, `controlled-cancellation-${cycle}`);
      const cancellation = await driver.cancelQueued({ cycle, featureCount });
      if (
        cancellation?.status !== 'cancelled' ||
        cancellation.queuedObserved !== true ||
        cancellation.oldIdsStillPresent !== false
      )
        throw new Error(
          `Controlled queued cancellation ${cycle} was not observed.`,
        );
      const cancelled = assertOwnedLifecycleCheckpoint(cancellation.snapshot, {
        featureCount: 0,
      });
      assertControlledAppOwnerUntouched(cancelled);
      if (
        cancellation.heldCallbacksAfter !== 0 ||
        cancellation.ownedTimersAfter !== 0
      )
        throw new Error(
          'Controlled cancellation retained a scheduled callback.',
        );
      assertEquivalentOwnedResources(cancelled, warmed);
      assertRenderedPopulation(cancelled.renderedPopulation, '__empty__', 0);
      progress.operations.cancellations++;

      setPhase(progress, driver, `controlled-supersession-${cycle}`);
      progress.supersessionOutcome = null;
      const result = await driver.supersedeQueued({ cycle, featureCount });
      progress.supersessionOutcome = {
        cycle,
        oldStatus: result?.oldStatus ?? null,
        queuedObserved: result?.queuedObserved === true,
        oldIdsStillPresent: result?.oldIdsStillPresent ?? null,
        replacement: result?.replacement
          ? {
              drawn: result.replacement.drawn,
              omitted: result.replacement.omitted,
              importEntityIds: Array.isArray(result.replacement.importEntityIds)
                ? result.replacement.importEntityIds.slice(0, 16)
                : null,
              importEntityIdsTruncated:
                Array.isArray(result.replacement.importEntityIds) &&
                result.replacement.importEntityIds.length > 16,
              renderedPopulation: result.replacement.renderedPopulation || null,
            }
          : null,
      };
      if (
        result?.oldStatus !== 'cancelled' ||
        result?.queuedObserved !== true ||
        result?.oldIdsStillPresent !== false
      )
        throw new Error(
          `Controlled queued supersession ${cycle} was not observed.`,
        );
      assertLoadResult(
        result.replacement,
        featureCount,
        `controlled-replacement-${cycle}`,
        featureIds,
        importId,
      );
      const replacementSnapshot = assertOwnedLifecycleCheckpoint(
        result.snapshot,
        {
          featureCount,
          importWorkspaceId: `controlled-replacement-${cycle}`,
        },
      );
      assertControlledAppOwnerUntouched(replacementSnapshot);
      if (result.heldCallbacksAfter !== 0 || result.ownedTimersAfter !== 0)
        throw new Error(
          'Controlled supersession retained a scheduled callback.',
        );
      assertRenderedPopulation(
        result.replacement.renderedPopulation,
        `controlled-replacement-${cycle}`,
        featureCount,
      );
      progress.operations.supersessions++;
      progress.operations.completedReplacementLoads++;
      progress.checkpoints.push({
        cycle,
        phase: 'controlled-replacement-loaded',
        cancellation: {
          status: cancellation.status,
          queuedObserved: cancellation.queuedObserved,
          oldIdsStillPresent: cancellation.oldIdsStillPresent,
          snapshot: cancelled,
        },
        supersession: {
          oldStatus: result.oldStatus,
          queuedObserved: result.queuedObserved,
          oldIdsStillPresent: result.oldIdsStillPresent,
          replacement: result.replacement,
          snapshot: replacementSnapshot,
        },
      });

      setPhase(progress, driver, `controlled-clear-${cycle}`);
      const cleared = assertOwnedLifecycleCheckpoint(
        await driver.clearAndDrain(),
        { featureCount: 0 },
      );
      assertControlledAppOwnerUntouched(cleared);
      assertRenderedPopulation(cleared.renderedPopulation, '__empty__', 0);
      assertEquivalentOwnedResources(cleared, warmed);
      progress.operations.clearDrains++;
      progress.checkpoints.push({
        cycle,
        phase: 'controlled-replacement-cleared',
        snapshot: cleared,
      });
      progress.supersessionOutcome = null;
    }
    return {
      ...progress,
      status: 'passed',
      final: progress.checkpoints.at(-1)?.snapshot || warmed,
      workerCounters: await driver.workerCounters?.(),
      workerPreflight: driver.workerPreflight,
    };
  });
  if (driver.cleanup) result.cleanup = driver.cleanup;
  return result;
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

function assertControlledAppOwnerUntouched(snapshot) {
  const owner = snapshot?.applicationOwner;
  if (
    owner?.featureCount !== 0 ||
    owner?.pendingJobs !== 0 ||
    !Array.isArray(owner.importedEntityIds) ||
    owner.importedEntityIds.length !== 0 ||
    owner.contextRecordCount !== 0
  )
    throw new Error('Controlled imports collided with the application owner.');
}

export async function closeControlledOwnerAndContext({
  dispose,
  validateCleanup,
  closeContext,
} = {}) {
  if (
    typeof dispose !== 'function' ||
    typeof validateCleanup !== 'function' ||
    typeof closeContext !== 'function'
  )
    throw new TypeError('Controlled owner close callbacks are required.');
  let cleanup;
  let cleanupError = null;
  let contextCloseError = null;
  try {
    cleanup = await dispose();
    await validateCleanup(cleanup);
  } catch (error) {
    cleanupError = error;
  } finally {
    try {
      await closeContext();
    } catch (error) {
      contextCloseError = error;
    }
  }
  if (cleanupError && contextCloseError)
    throw new AggregateError(
      [cleanupError, contextCloseError],
      'Controlled owner cleanup and context close both failed.',
    );
  if (cleanupError) throw cleanupError;
  if (contextCloseError) throw contextCloseError;
  return cleanup;
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

export function validateImportWorkspaceLifecycleReport(report, options = {}) {
  if (report?.schema === V2_SCHEMA)
    return validateImportWorkspaceLifecycleV2Report(report, options);
  const {
    expectedCommit,
    expectedImportFixtureSha256,
    expectedWorkspaceFixtureSha256,
  } = options;
  if (
    report?.schema !== V1_SCHEMA ||
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
    report.cases.length !== CASES_V1.length
  )
    throw new Error('Lifecycle report identity or case inventory is invalid.');
  for (const id of CASES_V1) {
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
      id === CASES_V1[0] ? report.cycles * 4 : report.cycles;
    if (row.checkpoints.length !== expectedCheckpointCount)
      throw new Error(
        `Lifecycle checkpoint count does not match completed cycles: ${id}.`,
      );
    const expectedPhases = Array.from({ length: report.cycles }, (_, index) =>
      id === CASES_V1[0]
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
    if (id === CASES_V1[0]) {
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
      if (id === CASES_V1[0] && checkpoint.phase === 'load-clear') {
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
        id === CASES_V1[0] &&
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
        id === CASES_V1[0] &&
        ['cancelled-while-queued', 'superseded-replacement-cleared'].includes(
          checkpoint.phase,
        )
      ) {
        assertOwnedLifecycleCheckpoint(checkpoint.snapshot, {
          featureCount: 0,
        });
        assertEquivalentOwnedResources(checkpoint.snapshot, row.baseline);
      }
      if (id === CASES_V1[1]) {
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
  const importCase = report.cases.find((row) => row.id === CASES_V1[0]);
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
  const workspaceCase = report.cases.find((row) => row.id === CASES_V1[1]);
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

/** Validate the new split: native lifecycle timing plus controlled race correctness. */
export function validateImportWorkspaceLifecycleV2Report(
  report,
  {
    expectedCommit,
    expectedImportFixtureSha256,
    expectedWorkspaceFixtureSha256,
  } = {},
) {
  if (
    report?.schema !== V2_SCHEMA ||
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
    !Number.isSafeInteger(report.drainLimitMs) ||
    report.drainLimitMs < 1 ||
    report.drainLimitMs > 10_000 ||
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
    report.fixtures.workspaceImportCount !== 1 ||
    !Array.isArray(report.cases) ||
    report.cases.length !== CASES_V2.length ||
    new Set(report.cases.map((row) => row?.id)).size !== CASES_V2.length ||
    CASES_V2.some((id) => !report.cases.some((row) => row?.id === id))
  )
    throw new Error(
      'Lifecycle v2 report identity or case inventory is invalid.',
    );

  const byId = new Map(report.cases.map((row) => [row.id, row]));
  for (const id of CASES_V2) {
    const row = byId.get(id);
    if (
      row.status !== 'passed' ||
      row.cycles !== report.cycles ||
      row.applicationCommit !== expectedCommit ||
      row.allLayersDisabled !== true ||
      !Array.isArray(row.disabledLayers) ||
      row.disabledLayers.length === 0 ||
      row.disabledLayers.length > 128 ||
      new Set(row.disabledLayers).size !== row.disabledLayers.length
    )
      throw new Error(`Lifecycle v2 case is incomplete: ${id}.`);
    assertWorkerCheckpoint(row.workerCounters);
    assertSceneReadiness(row.sceneReadiness);
    if (
      row.workerPreflight?.scope !== 'cumulative-per-document' ||
      row.workerPreflight.status !== 'passed' ||
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
  }

  const native = byId.get('cooperative-import');
  if (
    native.mode !== 'native-full-app' ||
    native.timingScope !== 'native-full-app-load-clear' ||
    native.featureCount !== report.fixtures.cooperativeImportCount ||
    native.operations?.warmupLoads !== 1 ||
    native.operations?.completedLoads !== report.cycles ||
    native.operations?.clearDrains !== report.cycles + 1 ||
    native.operations?.cancellations !== 0 ||
    native.operations?.supersededLoads !== 0 ||
    native.checkpoints?.length !== report.cycles ||
    native.checkpoints.some(
      (checkpoint, index) =>
        checkpoint.cycle !== index + 1 || checkpoint.phase !== 'load-clear',
    )
  )
    throw new Error('Native import lifecycle evidence is incomplete.');
  assertOwnedLifecycleCheckpoint(native.baseline, { featureCount: 0 });
  assertOwnedLifecycleCheckpoint(native.final, { featureCount: 0 });
  assertRenderedPopulation(native.baseline.renderedPopulation, '__empty__', 0);
  assertRenderedPopulation(native.final.renderedPopulation, '__empty__', 0);
  if (
    native.baseline.imports.pendingJobs !== 0 ||
    native.final.imports.pendingJobs !== 0
  )
    throw new Error('Native import baseline/final is not settled.');
  assertEquivalentOwnedResources(native.final, native.baseline);
  for (const checkpoint of native.checkpoints) {
    assertOwnedLifecycleCheckpoint(checkpoint.snapshot, { featureCount: 0 });
    assertRenderedPopulation(
      checkpoint.snapshot.renderedPopulation,
      '__empty__',
      0,
    );
    assertEquivalentOwnedResources(checkpoint.snapshot, native.baseline);
    assertRenderedPopulation(
      checkpoint.renderedPopulation,
      `lifecycle-measured-${checkpoint.cycle}`,
      report.fixtures.cooperativeImportCount,
    );
    const expectedIds = report.fixtures.cooperativeImportRecordIds.map(
      (recordId) =>
        `gev-import:lifecycle-measured-${checkpoint.cycle}:${report.fixtures.cooperativeImportSourceId}:${recordId}`,
    );
    assert.deepEqual(checkpoint.loadedEntityIds, expectedIds);
  }

  const workspace = byId.get('workspace-replacement');
  if (
    workspace.mode !== 'native-full-app' ||
    workspace.timingScope !== 'native-full-app-workspace-replacement' ||
    workspace.checkpoints?.length !== report.cycles ||
    workspace.operations?.completedWorkspaceReplacements !== report.cycles ||
    !workspace.baselineWorkspaceId ||
    !workspace.alternateWorkspaceId ||
    workspace.baselineWorkspaceId === workspace.alternateWorkspaceId
  )
    throw new Error('Native workspace lifecycle evidence is incomplete.');
  assertOwnedLifecycleCheckpoint(workspace.baseline, {
    featureCount: workspace.featureCount,
    restoreWorkspaceId: workspace.baselineWorkspaceId,
    importWorkspaceId: workspace.baselineWorkspaceId,
  });
  assertOwnedLifecycleCheckpoint(workspace.final, {
    featureCount: workspace.featureCount,
    restoreWorkspaceId: workspace.baselineWorkspaceId,
    importWorkspaceId: workspace.baselineWorkspaceId,
  });
  assertEquivalentOwnedResources(workspace.final, workspace.baseline);
  assertRenderedPopulation(
    workspace.baseline.renderedPopulation,
    workspace.baselineWorkspaceId,
    workspace.featureCount,
  );
  assertRenderedPopulation(
    workspace.final.renderedPopulation,
    workspace.baselineWorkspaceId,
    workspace.featureCount,
  );
  for (const checkpoint of workspace.checkpoints) {
    if (
      checkpoint.cycle !== workspace.checkpoints.indexOf(checkpoint) + 1 ||
      checkpoint.phase !== 'alternation'
    )
      throw new Error('Workspace checkpoint order is invalid.');
    assertOwnedLifecycleCheckpoint(checkpoint.alternate, {
      featureCount: workspace.featureCount,
      restoreWorkspaceId: workspace.alternateWorkspaceId,
      importWorkspaceId: workspace.alternateWorkspaceId,
    });
    assertOwnedLifecycleCheckpoint(checkpoint.returned, {
      featureCount: workspace.featureCount,
      restoreWorkspaceId: workspace.baselineWorkspaceId,
      importWorkspaceId: workspace.baselineWorkspaceId,
    });
    assertEquivalentOwnedResources(checkpoint.returned, workspace.baseline);
    assertRenderedPopulation(
      checkpoint.alternate.renderedPopulation,
      workspace.alternateWorkspaceId,
      workspace.featureCount,
    );
    assertRenderedPopulation(
      checkpoint.returned.renderedPopulation,
      workspace.baselineWorkspaceId,
      workspace.featureCount,
    );
    assertEquivalentImportIdentities(
      checkpoint.alternate,
      workspace.alternateWorkspaceId,
      workspace.baseline,
      workspace.baselineWorkspaceId,
    );
    assertEquivalentImportIdentities(
      checkpoint.returned,
      workspace.baselineWorkspaceId,
      workspace.baseline,
      workspace.baselineWorkspaceId,
    );
  }

  const controlled = byId.get('controlled-import-supersession');
  if (
    controlled.mode !== 'controlled-instance-scheduler' ||
    controlled.timingScope !== 'correctness-only; no native timing claim' ||
    controlled.featureCount !== report.fixtures.cooperativeImportCount ||
    controlled.cleanup?.destroyed !== true ||
    controlled.cleanup?.pendingJobs !== 0 ||
    controlled.cleanup?.ownedTimers !== 0 ||
    controlled.cleanup?.heldCallbacks !== 0 ||
    controlled.cleanup?.renderWaiters !== 0 ||
    controlled.cleanup?.overlayEntries !== 0 ||
    controlled.cleanup?.contextRecordCount !== 0 ||
    controlled.cleanup?.applicationOwnerUnchanged !== true ||
    controlled.operations?.warmupLoads !== 1 ||
    controlled.operations?.cancellations !== report.cycles ||
    controlled.operations?.supersessions !== report.cycles ||
    controlled.operations?.completedReplacementLoads !== report.cycles ||
    controlled.operations?.clearDrains !== report.cycles + 1 ||
    controlled.checkpoints?.length !== report.cycles * 2
  )
    throw new Error('Controlled scheduler lifecycle evidence is incomplete.');
  assertOwnedLifecycleCheckpoint(controlled.baseline, { featureCount: 0 });
  assertOwnedLifecycleCheckpoint(controlled.final, { featureCount: 0 });
  assertRenderedPopulation(
    controlled.baseline.renderedPopulation,
    '__empty__',
    0,
  );
  assertRenderedPopulation(controlled.final.renderedPopulation, '__empty__', 0);
  assertOwnedLifecycleCheckpoint(controlled.cleanup.snapshot, {
    featureCount: 0,
  });
  const untouchedAppOwner = (snapshot) =>
    snapshot?.applicationOwner?.featureCount === 0 &&
    snapshot.applicationOwner.pendingJobs === 0 &&
    Array.isArray(snapshot.applicationOwner.importedEntityIds) &&
    snapshot.applicationOwner.importedEntityIds.length === 0 &&
    snapshot.applicationOwner.contextRecordCount === 0;
  if (
    !untouchedAppOwner(controlled.baseline) ||
    !untouchedAppOwner(controlled.final) ||
    !untouchedAppOwner(controlled.cleanup.snapshot)
  )
    throw new Error('Controlled owner changed the full-app import owner.');
  assertEquivalentOwnedResources(controlled.final, controlled.baseline);
  for (let cycle = 1; cycle <= report.cycles; cycle++) {
    const loaded = controlled.checkpoints[(cycle - 1) * 2];
    const cleared = controlled.checkpoints[(cycle - 1) * 2 + 1];
    if (
      loaded?.cycle !== cycle ||
      loaded.phase !== 'controlled-replacement-loaded' ||
      cleared?.cycle !== cycle ||
      cleared.phase !== 'controlled-replacement-cleared'
    )
      throw new Error('Controlled scheduler checkpoint order is invalid.');
    const cancellation = loaded.cancellation;
    assertOwnedLifecycleCheckpoint(cancellation?.snapshot, {
      featureCount: 0,
    });
    assertRenderedPopulation(
      cancellation.snapshot.renderedPopulation,
      '__empty__',
      0,
    );
    if (
      cancellation?.status !== 'cancelled' ||
      cancellation.queuedObserved !== true ||
      cancellation.oldIdsStillPresent !== false
    )
      throw new Error('Controlled queued cancellation was not proven.');
    assertEquivalentOwnedResources(cancellation.snapshot, controlled.baseline);
    if (!untouchedAppOwner(cancellation.snapshot))
      throw new Error('Controlled cancellation changed the app import owner.');
    const supersession = loaded.supersession;
    const workspaceId = `controlled-replacement-${cycle}`;
    if (
      supersession?.oldStatus !== 'cancelled' ||
      supersession.queuedObserved !== true ||
      supersession.oldIdsStillPresent !== false
    )
      throw new Error('Controlled queued supersession was not proven.');
    assertLoadResult(
      supersession.replacement,
      controlled.featureCount,
      workspaceId,
      report.fixtures.cooperativeImportRecordIds,
      report.fixtures.cooperativeImportSourceId,
    );
    assertOwnedLifecycleCheckpoint(supersession.snapshot, {
      featureCount: controlled.featureCount,
      importWorkspaceId: workspaceId,
    });
    if (!untouchedAppOwner(supersession.snapshot))
      throw new Error('Controlled supersession changed the app import owner.');
    assertRenderedPopulation(
      supersession.replacement.renderedPopulation,
      workspaceId,
      controlled.featureCount,
    );
    assertOwnedLifecycleCheckpoint(cleared.snapshot, { featureCount: 0 });
    assertRenderedPopulation(
      cleared.snapshot.renderedPopulation,
      '__empty__',
      0,
    );
    assertEquivalentOwnedResources(cleared.snapshot, controlled.baseline);
    if (!untouchedAppOwner(cleared.snapshot))
      throw new Error('Controlled clear changed the app import owner.');
  }
  if (
    controlled.final.imports.featureCount !== 0 ||
    native.operations.cancellations !== 0 ||
    native.operations.supersededLoads !== 0
  )
    throw new Error(
      'Lifecycle scopes were mixed between native and control cases.',
    );
  return report;
}
