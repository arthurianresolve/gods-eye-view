#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  assertOwnedLifecycleCheckpoint,
  closeControlledOwnerAndContext,
  createLifecycleFailureEvidence,
  installLifecycleRenderWaiter,
  installLifecycleDrainObserver,
  parseImportWorkspaceLifecycleArgs,
  readLifecycleDrainObservation,
  runCooperativeImportLifecycleCase,
  runControlledImportSupersessionLifecycleCase,
  runWorkspaceReplacementLifecycleCase,
  validateImportWorkspaceLifecycleReport,
} from './performance/importWorkspaceLifecycle.mjs';
import {
  bootFixturePage,
  cleanupFixturePageDiagnostics,
  clickControl,
  launchFixtureBrowser,
  openWorkspace,
  readFixturePageDiagnostics,
  prepareFixturePage,
  seedPersistentWorkspace,
} from './qa-application-fixtures.mjs';
import { installWorkerDiagnostics } from './performance/workerDiagnostics.mjs';
import {
  closeRecoveryBrowser,
  stopOwnedRecoveryProcessTree,
} from './performance/profileRecoveryPageOwnership.mjs';

const DEFAULT_CYCLES = 5;
const FEATURE_COUNT = 512;
const SHA1 = /^[a-f0-9]{40}$/i;
const HOST_PROTOCOL_TIMEOUT_MS = 15_000;
const PAGE_CONTEXT_CLEANUP_TIMEOUT_MS = 2_000;
const FAILURE_OBSERVATION_TIMEOUT_MS = 1_500;
const BROWSER_CLOSE_TIMEOUT_MS = 5_000;
const PROGRESS_EVENT_CAP = 64;
const WORKER_QUIESCENCE_POLL_MS = 50;
const WORKER_QUIESCENCE_SAMPLE_CAP = 202;
const SCENE_READINESS_TIMEOUT_MS = 30_000;
const SCENE_READINESS_POLL_MS = 100;
const SCENE_READINESS_STABLE_MS = 1_000;

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

export function createLifecycleImportFixture(count = FEATURE_COUNT) {
  if (!Number.isSafeInteger(count) || count < 1 || count > 5000)
    throw new RangeError('Import fixture count must be between 1 and 5000.');
  const records = Array.from({ length: count }, (_, index) => ({
    id: `lifecycle-${String(index + 1).padStart(5, '0')}`,
    properties: { name: `Lifecycle fixture ${index + 1}` },
    geometry: {
      type: 'Point',
      coordinates: [
        -73.9 + (index % 32) * 0.001,
        40.7 + Math.floor(index / 32) * 0.001,
      ],
    },
  }));
  const imports = [
    {
      id: 'lifecycle-fixture',
      kind: 'geojson',
      attribution: 'Synthetic lifecycle fixture',
      records,
    },
  ];
  return Object.freeze({
    id: 'cooperative-import-v1',
    count,
    sha256: sha256(JSON.stringify(imports)),
    imports,
  });
}

export const WORKSPACE_IMPORT_FIXTURE_SHA256 = sha256(
  JSON.stringify({
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        id: 'fixture-point',
        properties: { name: 'Persistent fixture' },
        geometry: { type: 'Point', coordinates: [-73.9, 40.7] },
      },
    ],
  }),
);

function boundedText(value, limit = 500) {
  return String(value?.message || value || 'Unknown failure')
    .replace(/https?:\/\/[^\s"'<>]+/g, '[url]')
    .slice(0, limit);
}

async function withProtocolDeadline(
  operation,
  label,
  timeoutMs = HOST_PROTOCOL_TIMEOUT_MS,
) {
  let timer;
  const outcome = await Promise.race([
    Promise.resolve()
      .then(operation)
      .then(
        (value) => ({ status: 'completed', value }),
        (error) => ({ status: 'failed', error }),
      ),
    new Promise((resolve) => {
      timer = setTimeout(() => resolve({ status: 'timed-out' }), timeoutMs);
    }),
  ]).finally(() => clearTimeout(timer));
  if (outcome.status === 'timed-out')
    throw new Error(`Browser protocol ${label} exceeded ${timeoutMs}ms.`);
  if (outcome.status === 'failed') throw outcome.error;
  return outcome.value;
}

function evaluateWithDeadline(page, label, ...args) {
  return withProtocolDeadline(() => page.evaluate(...args), label);
}

async function closeOwnedPageAndContext(page, context) {
  const errors = [];
  const attempt = async (label, operation) => {
    let timer;
    const result = await Promise.race([
      Promise.resolve()
        .then(operation)
        .then(
          (value) => ({ status: 'completed', value }),
          (error) => ({ status: 'failed', error }),
        ),
      new Promise((resolve) => {
        timer = setTimeout(
          () => resolve({ status: 'timed-out' }),
          PAGE_CONTEXT_CLEANUP_TIMEOUT_MS,
        );
      }),
    ]).finally(() => clearTimeout(timer));
    if (result.status !== 'completed') {
      errors.push(
        new Error(
          `${label} ${result.status === 'timed-out' ? 'timed out' : boundedText(result.error)}`,
        ),
      );
    }
  };
  try {
    if (page && !page.isClosed())
      await attempt('Cancel page-owned render waiters', () =>
        page.evaluate(() => window.__qaLifecycleCancelAll?.()),
      );
  } catch (error) {
    errors.push(error);
  }
  if (page)
    await attempt('Remove page diagnostics', () =>
      cleanupFixturePageDiagnostics(page),
    );
  if (page && !page.isClosed())
    await attempt('Close owned lifecycle page', () => page.close());
  if (context)
    await attempt('Close owned lifecycle context', () => context.close());
  if (errors.length)
    throw new AggregateError(
      errors,
      'Owned lifecycle browser context cleanup failed.',
    );
}

async function startRenderedPopulationWait(
  page,
  workspaceId,
  count,
  timeoutMs,
  requireRestoreTransition = false,
) {
  return evaluateWithDeadline(
    page,
    'start-render-wait',
    (options) => window.__qaLifecycleStartRenderWait(options),
    { workspaceId, count, timeoutMs, requireRestoreTransition },
  );
}

async function finishRenderedPopulationWait(page, id) {
  try {
    return await evaluateWithDeadline(
      page,
      'finish-render-wait',
      (waitId) => window.__qaLifecycleWaitForRender(waitId),
      id,
    );
  } finally {
    await withProtocolDeadline(
      () =>
        page.evaluate(
          (waitId) => window.__qaLifecycleCancelRenderWait(waitId),
          id,
        ),
      'cancel-render-wait',
      1000,
    ).catch(() => {});
  }
}

function assertWorkerPreflight(value, { allowPending = false } = {}) {
  const expectedTasks = [
    ['geometry-cold', 'resolved'],
    ['geometry-reuse', 'resolved'],
    ['geometry-error', 'rejected-as-expected'],
    ['geometry-recovery', 'resolved'],
  ];
  if (
    value?.network?.status !== 'passed' ||
    value?.probe?.status !== 'passed' ||
    value?.probe?.tasks?.length !== expectedTasks.length ||
    expectedTasks.some(
      ([id, outcome], index) =>
        value.probe.tasks[index]?.id !== id ||
        value.probe.tasks[index]?.outcome !== outcome,
    ) ||
    value?.diagnostics?.instrumented !== true ||
    value.diagnostics.overflow !== false ||
    !Number.isSafeInteger(value.diagnostics.pending) ||
    value.diagnostics.pending < 0 ||
    (!allowPending && value.diagnostics.pending !== 0) ||
    !Array.isArray(value.diagnostics.workers) ||
    value.diagnostics.workers.length > 64 ||
    value.diagnostics.workers.reduce(
      (sum, worker) =>
        sum + (Number.isSafeInteger(worker?.pending) ? worker.pending : 0),
      0,
    ) !== value.diagnostics.pending ||
    value.diagnostics.workers.reduce(
      (sum, worker) =>
        sum +
        (Number.isSafeInteger(worker?.taskErrors) ? worker.taskErrors : 0),
      0,
    ) > 1 ||
    value.diagnostics.workers.some(
      (worker) =>
        worker?.kind !== 'createGeometry.js' && worker?.taskErrors !== 0,
    ) ||
    value.diagnostics.workers.some(
      (worker) =>
        worker?.taskErrors > 0 &&
        (worker.kind !== 'createGeometry.js' || worker.terminated !== true),
    ) ||
    value.diagnostics.workers.some(
      (worker) =>
        !Number.isSafeInteger(worker.submitted) ||
        worker.submitted < 0 ||
        !Number.isSafeInteger(worker.completed) ||
        worker.completed < 0 ||
        !Number.isSafeInteger(worker.taskErrors) ||
        worker.taskErrors < 0 ||
        !Number.isSafeInteger(worker.pending) ||
        worker.pending < 0 ||
        !Number.isSafeInteger(worker.workerErrors) ||
        worker.workerErrors < 0 ||
        !Number.isSafeInteger(worker.postErrors) ||
        worker.postErrors < 0 ||
        !Number.isSafeInteger(worker.cancelled) ||
        worker.cancelled < 0 ||
        (!allowPending && worker.pending !== 0) ||
        worker.workerErrors !== 0 ||
        worker.postErrors !== 0,
    )
  )
    throw new Error('Worker network/MIME/completion preflight did not pass.');
  return {
    scope: 'cumulative-per-document',
    status: 'passed',
    network: value.network,
    taskCount: value.probe.tasks.length,
    cumulativeSubmitted: value.diagnostics.workers.reduce(
      (sum, worker) => sum + worker.submitted,
      0,
    ),
    cumulativeCompleted: value.diagnostics.workers.reduce(
      (sum, worker) => sum + worker.completed,
      0,
    ),
    cumulativeCancelled: value.diagnostics.workers.reduce(
      (sum, worker) => sum + worker.cancelled,
      0,
    ),
    pendingAtPreflight: value.diagnostics.pending,
    overflow: value.diagnostics.overflow,
  };
}

/** Serialized into the fixture page to retain a bounded worker-pending timeline. */
export async function observeWorkerQuiescenceInPage({
  timeoutMs,
  pollMs = 50,
  maxSamples = 202,
} = {}) {
  const startedAt = performance.now();
  const history = [];
  let firstObservedZeroMs = null;
  let postZeroVerification = null;
  let status = 'running';
  let reason = null;
  let timer = null;
  let wakeDelay = null;
  let cancelled = false;

  const safeWorker = (worker) => ({
    kind:
      typeof worker?.kind === 'string' &&
      /^[a-zA-Z0-9_.-]{1,80}$/.test(worker.kind)
        ? worker.kind
        : 'opaque-worker',
    submitted: Number.isSafeInteger(worker?.submitted)
      ? worker.submitted
      : null,
    completed: Number.isSafeInteger(worker?.completed)
      ? worker.completed
      : null,
    taskErrors: Number.isSafeInteger(worker?.taskErrors)
      ? worker.taskErrors
      : null,
    workerErrors: Number.isSafeInteger(worker?.workerErrors)
      ? worker.workerErrors
      : null,
    postErrors: Number.isSafeInteger(worker?.postErrors)
      ? worker.postErrors
      : null,
    cancelled: Number.isSafeInteger(worker?.cancelled)
      ? worker.cancelled
      : null,
    pending: Number.isSafeInteger(worker?.pending) ? worker.pending : null,
    oldestPendingMs:
      Number.isFinite(worker?.oldestPendingMs) && worker.oldestPendingMs >= 0
        ? Math.round(worker.oldestPendingMs * 100) / 100
        : null,
    terminated:
      typeof worker?.terminated === 'boolean' ? worker.terminated : null,
  });
  const publish = (elapsedMs, diagnostics) => {
    const sample = {
      elapsedMs: Math.round(elapsedMs * 100) / 100,
      instrumented: diagnostics?.instrumented === true,
      overflow: diagnostics?.overflow === true,
      pending: Number.isSafeInteger(diagnostics?.pending)
        ? diagnostics.pending
        : null,
      workersTruncated:
        !Array.isArray(diagnostics?.workers) || diagnostics.workers.length > 64,
      workers: Array.isArray(diagnostics?.workers)
        ? diagnostics.workers.slice(0, 64).map(safeWorker)
        : [],
    };
    history.push(sample);
    window.__qaWorkerQuiescenceTrace = {
      status,
      reason,
      startedAtPerformanceMs: startedAt,
      elapsedMs: sample.elapsedMs,
      firstObservedZeroMs,
      maxPollingGapMs: history.reduce(
        (maximum, row, index) =>
          index === 0
            ? maximum
            : Math.max(maximum, row.elapsedMs - history[index - 1].elapsedMs),
        0,
      ),
      pollCount: history.length,
      historyTruncated: false,
      postZeroVerification,
      history: [...history],
      final: sample,
    };
    return sample;
  };

  const cancel = () => {
    cancelled = true;
    status = 'cancelled';
    reason = 'cancelled-by-host';
    if (timer !== null) clearTimeout(timer);
    timer = null;
    wakeDelay?.();
    wakeDelay = null;
    if (window.__qaWorkerQuiescenceTrace) {
      window.__qaWorkerQuiescenceTrace.status = status;
      window.__qaWorkerQuiescenceTrace.reason = reason;
    }
  };
  window.__qaWorkerQuiescenceCancel = cancel;

  try {
    while (true) {
      const diagnostics = window.__gevSoakWorkers?.snapshot?.() || null;
      const elapsedMs = Math.max(0, performance.now() - startedAt);
      if (history.length >= maxSamples) {
        status = 'history-overflow';
        reason = 'sample-cap';
        break;
      }
      const sample = publish(elapsedMs, diagnostics);
      if (
        sample.instrumented !== true ||
        sample.overflow ||
        sample.workersTruncated ||
        sample.pending === null ||
        sample.pending < 0 ||
        sample.workers.some(
          (worker) =>
            worker.pending === null ||
            worker.submitted === null ||
            worker.completed === null ||
            worker.taskErrors === null ||
            worker.workerErrors === null ||
            worker.postErrors === null ||
            worker.cancelled === null,
        )
      ) {
        status = 'invalid';
        reason = 'missing-or-overflowed-diagnostics';
        break;
      }
      if (
        sample.workers.some((worker) =>
          [
            worker.submitted,
            worker.completed,
            worker.taskErrors,
            worker.workerErrors,
            worker.postErrors,
            worker.cancelled,
            worker.pending,
          ].some((count) => count < 0),
        )
      ) {
        status = 'invalid';
        reason = 'negative-worker-counter';
        break;
      }
      if (
        sample.workers.some(
          (worker) =>
            worker.workerErrors > 0 ||
            worker.postErrors > 0 ||
            (worker.taskErrors > 0 &&
              (worker.kind !== 'createGeometry.js' ||
                worker.taskErrors !== 1 ||
                worker.terminated !== true)),
        ) ||
        sample.workers.reduce((sum, worker) => sum + worker.taskErrors, 0) > 1
      ) {
        status = 'invalid';
        reason = 'worker-error';
        break;
      }
      if (
        sample.workers.reduce((sum, worker) => sum + worker.pending, 0) !==
        sample.pending
      ) {
        status = 'invalid';
        reason = 'pending-count-mismatch';
        break;
      }
      if (elapsedMs > timeoutMs) {
        if (sample.pending === 0 && firstObservedZeroMs === null)
          firstObservedZeroMs = elapsedMs;
        status = 'timed-out';
        reason = 'quiescence-deadline';
        break;
      }
      if (sample.pending === 0) {
        if (firstObservedZeroMs === null) {
          firstObservedZeroMs = elapsedMs;
        } else {
          postZeroVerification = {
            elapsedMs: sample.elapsedMs,
            pending: sample.pending,
            overflow: sample.overflow,
            workersTruncated: sample.workersTruncated,
          };
          if (elapsedMs > timeoutMs) {
            status = 'timed-out';
            reason = 'quiescence-deadline';
          } else {
            status = 'settled';
          }
          break;
        }
      } else if (firstObservedZeroMs !== null) {
        postZeroVerification = {
          elapsedMs: sample.elapsedMs,
          pending: sample.pending,
          overflow: sample.overflow,
          workersTruncated: sample.workersTruncated,
        };
        status = 'pending-resumed';
        reason = 'pending-after-zero-observation';
        break;
      }
      if (elapsedMs >= timeoutMs) {
        status = 'timed-out';
        reason = 'quiescence-deadline';
        break;
      }
      await new Promise((resolve) => {
        wakeDelay = resolve;
        timer = setTimeout(
          () => {
            timer = null;
            wakeDelay = null;
            resolve();
          },
          Math.min(pollMs, timeoutMs - elapsedMs),
        );
      });
      if (cancelled) {
        status = 'cancelled';
        reason = 'cancelled-by-host';
        break;
      }
    }
  } finally {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    wakeDelay = null;
    window.__qaWorkerQuiescenceCancel = null;
  }

  const elapsedMs = Math.max(0, performance.now() - startedAt);
  const maxPollingGapMs = history.reduce(
    (maximum, row, index) =>
      index === 0
        ? maximum
        : Math.max(maximum, row.elapsedMs - history[index - 1].elapsedMs),
    0,
  );
  const result = {
    status,
    reason,
    startedAtPerformanceMs: startedAt,
    elapsedMs: Math.round(elapsedMs * 100) / 100,
    firstObservedZeroMs:
      firstObservedZeroMs === null
        ? null
        : Math.round(firstObservedZeroMs * 100) / 100,
    maxPollingGapMs: Math.round(maxPollingGapMs * 100) / 100,
    pollCount: history.length,
    historyTruncated: status === 'history-overflow',
    postZeroVerification,
    history,
    final: history.at(-1) || null,
  };
  window.__qaWorkerQuiescenceTrace = result;
  return result;
}

/** Install a bounded startup-only observer for an actually settled Cesium scene. */
export function installLifecycleSceneReadinessObserver() {
  if (window.__qaLifecycleSceneReadiness) return;
  const cap = 302;
  const safeWorker = (worker) => ({
    kind:
      typeof worker?.kind === 'string' &&
      /^[a-zA-Z][a-zA-Z0-9_-]{0,70}\.js$/.test(worker.kind)
        ? worker.kind
        : 'opaque-worker',
    submitted: worker?.submitted,
    completed: worker?.completed,
    taskErrors: worker?.taskErrors,
    workerErrors: worker?.workerErrors,
    postErrors: worker?.postErrors,
    cancelled: worker?.cancelled,
    pending: worker?.pending,
  });
  const finiteVector = (value) =>
    value &&
    [value.x, value.y, value.z].every((component) => Number.isFinite(component))
      ? [value.x, value.y, value.z]
      : null;
  let state = null;

  function stop() {
    if (!state || !state.active) return;
    state.finishedElapsedMs = Math.max(0, performance.now() - state.startedAt);
    state.active = false;
    if (state.timer !== null) clearInterval(state.timer);
    state.timer = null;
    if (state.listener)
      state.scene.postRender.removeEventListener(state.listener);
    state.listener = null;
  }

  function snapshot(includeHistory = true) {
    if (!state) return null;
    const elapsedMs =
      state.finishedElapsedMs ??
      Math.max(0, performance.now() - state.startedAt);
    return {
      status: state.status,
      reason: state.reason,
      timeoutMs: state.timeoutMs,
      stableWindowMs: state.stableWindowMs,
      pollMs: state.pollMs,
      elapsedMs,
      historyTruncated: state.historyTruncated,
      ...(includeHistory ? { history: state.history.slice() } : {}),
      historySampleCount: state.sampleCount,
      stableSampleCount: state.candidate?.stableSampleCount || 0,
      stableElapsedMs:
        state.candidate?.stableStartedAt === null || !state.candidate
          ? null
          : Math.max(0, elapsedMs - state.candidate.stableStartedAt),
      postRenderCountAtRequest:
        state.candidate?.requestedAtPostRenderCount ?? null,
      frameNumberAtRequest: state.candidate?.requestedAtFrameNumber ?? null,
      renderRequests: state.renderRequests,
      completedPostRenders: state.postRenderCount,
      final: state.history.at(-1) || null,
    };
  }

  function capture() {
    const app = window.__godsEyeView;
    const scene = app?.viewer?.scene;
    const diagnostics = window.__gevSoakWorkers?.snapshot?.() || null;
    const workers = Array.isArray(diagnostics?.workers)
      ? diagnostics.workers.slice(0, 64).map(safeWorker)
      : null;
    const camera = scene?.camera;
    const pose = camera
      ? {
          position: finiteVector(camera.positionWC),
          direction: finiteVector(camera.directionWC),
          up: finiteVector(camera.upWC),
        }
      : null;
    return {
      elapsedMs: Math.max(0, performance.now() - state.startedAt),
      validEnvelope:
        diagnostics?.instrumented === true &&
        diagnostics.overflow === false &&
        Number.isSafeInteger(diagnostics.pending) &&
        diagnostics.pending >= 0 &&
        Array.isArray(diagnostics.workers) &&
        diagnostics.workers.length <= 64,
      instrumented: diagnostics?.instrumented === true,
      overflow: diagnostics?.overflow === true,
      pending: Number.isSafeInteger(diagnostics?.pending)
        ? diagnostics.pending
        : null,
      workers,
      workersTruncated:
        !Array.isArray(diagnostics?.workers) || diagnostics.workers.length > 64,
      tilesLoaded:
        typeof scene?.globe?.tilesLoaded === 'boolean'
          ? scene.globe.tilesLoaded
          : null,
      frameNumber:
        Number.isSafeInteger(scene?.frameState?.frameNumber) &&
        scene.frameState.frameNumber >= 0
          ? scene.frameState.frameNumber
          : null,
      camera: pose,
      postRenderCount: state.postRenderCount,
      lastPostRenderFrame: state.lastPostRenderFrame,
    };
  }

  function validate(sample) {
    if (!sample.validEnvelope || sample.workersTruncated)
      return 'worker-diagnostics-unavailable';
    if (sample.tilesLoaded === null) return 'globe-readiness-unavailable';
    if (
      !sample.camera ||
      !sample.camera.position ||
      !sample.camera.direction ||
      !sample.camera.up
    )
      return 'camera-pose-unavailable';
    if (sample.frameNumber === null) return 'frame-counter-unavailable';
    const workers = sample.workers;
    if (
      workers.some(
        (worker) =>
          [
            worker.submitted,
            worker.completed,
            worker.taskErrors,
            worker.workerErrors,
            worker.postErrors,
            worker.cancelled,
            worker.pending,
          ].some((count) => !Number.isSafeInteger(count) || count < 0) ||
          !Number.isSafeInteger(
            worker.completed + worker.cancelled + worker.pending,
          ) ||
          worker.submitted !==
            worker.completed + worker.cancelled + worker.pending,
      )
    )
      return 'invalid-worker-counter';
    if (
      workers.some(
        (worker) =>
          worker.taskErrors !== 0 ||
          worker.workerErrors !== 0 ||
          worker.postErrors !== 0,
      )
    )
      return 'worker-error';
    if (
      workers.reduce((sum, worker) => sum + worker.pending, 0) !==
      sample.pending
    )
      return 'pending-count-mismatch';
    return null;
  }

  function signature(sample) {
    return JSON.stringify({
      camera: sample.camera,
      tilesLoaded: sample.tilesLoaded,
      workers: sample.workers.map((worker) => ({
        kind: worker.kind,
        submitted: worker.submitted,
        completed: worker.completed,
        cancelled: worker.cancelled,
        pending: worker.pending,
        taskErrors: worker.taskErrors,
        workerErrors: worker.workerErrors,
        postErrors: worker.postErrors,
      })),
    });
  }

  function tick() {
    if (!state?.active) return;
    const sample = capture();
    state.sampleCount++;
    if (state.history.length < cap) state.history.push(sample);
    else state.historyTruncated = true;
    const invalidReason = validate(sample);
    if (invalidReason) {
      state.status = 'failed';
      state.reason = invalidReason;
      stop();
      return;
    }
    if (sample.elapsedMs >= state.timeoutMs) {
      state.status = 'timed-out';
      state.reason = 'cold-scene-readiness-deadline';
      stop();
      return;
    }
    if (sample.tilesLoaded !== true || sample.pending !== 0) {
      state.candidate = null;
      return;
    }

    const currentSignature = signature(sample);
    if (!state.candidate || state.candidate.signature !== currentSignature) {
      state.candidate = {
        signature: currentSignature,
        requestedAtPostRenderCount: state.postRenderCount,
        requestedAtFrameNumber: sample.frameNumber,
        stableStartedAt: null,
        stableSampleCount: 0,
      };
      try {
        state.renderRequests++;
        state.scene.requestRender();
      } catch {
        state.status = 'failed';
        state.reason = 'readiness-render-request-failed';
        stop();
      }
      return;
    }
    if (
      state.candidate.stableStartedAt === null &&
      state.postRenderCount > state.candidate.requestedAtPostRenderCount
    ) {
      state.candidate.stableStartedAt = sample.elapsedMs;
      state.candidate.stableSampleCount = 1;
    } else if (state.candidate.stableStartedAt !== null) {
      state.candidate.stableSampleCount++;
      if (
        sample.elapsedMs - state.candidate.stableStartedAt >=
          state.stableWindowMs &&
        state.candidate.stableSampleCount >= 10
      ) {
        state.status = 'ready';
        state.reason = null;
        stop();
      }
    }
  }

  window.__qaLifecycleSceneReadiness = {
    start({ timeoutMs = 30_000, pollMs = 100, stableWindowMs = 1_000 } = {}) {
      if (state?.active)
        throw new Error('Scene readiness observation is already active.');
      if (
        !Number.isSafeInteger(timeoutMs) ||
        timeoutMs < 1 ||
        timeoutMs > 30_000 ||
        !Number.isSafeInteger(pollMs) ||
        pollMs < 50 ||
        pollMs > 500 ||
        !Number.isSafeInteger(stableWindowMs) ||
        stableWindowMs < 500 ||
        stableWindowMs > 2_000
      )
        throw new RangeError('Scene readiness bounds are invalid.');
      const scene = window.__godsEyeView?.viewer?.scene;
      if (!scene?.postRender?.addEventListener || !scene?.requestRender)
        throw new Error('Cesium scene readiness controls are unavailable.');
      state = {
        scene,
        status: 'pending',
        reason: null,
        timeoutMs,
        pollMs,
        stableWindowMs,
        startedAt: performance.now(),
        active: true,
        finishedElapsedMs: null,
        timer: null,
        listener: null,
        postRenderCount: 0,
        lastPostRenderFrame: null,
        renderRequests: 0,
        sampleCount: 0,
        historyTruncated: false,
        history: [],
        candidate: null,
      };
      state.listener = () => {
        state.postRenderCount++;
        state.lastPostRenderFrame = Number.isSafeInteger(
          scene.frameState?.frameNumber,
        )
          ? scene.frameState.frameNumber
          : null;
      };
      scene.postRender.addEventListener(state.listener);
      state.timer = setInterval(tick, pollMs);
      tick();
      return snapshot();
    },
    snapshot,
    summary() {
      return snapshot(false);
    },
    cancel(includeHistory = true) {
      if (!state) return null;
      if (state.active) {
        state.status = 'cancelled';
        state.reason = 'host-cancelled';
        stop();
      }
      return snapshot(includeHistory);
    },
    dispose() {
      if (state?.active) stop();
      state = null;
      delete window.__qaLifecycleSceneReadiness;
    },
  };
}

export function startLifecycleSceneReadinessInPage(options) {
  return window.__qaLifecycleSceneReadiness?.start(options) || null;
}

export function finishLifecycleSceneReadinessInPage() {
  const observer = window.__qaLifecycleSceneReadiness;
  if (!observer) return { snapshot: null, disposed: true };
  if (observer.summary()?.status === 'pending') observer.cancel(false);
  const snapshot = observer.snapshot();
  observer.dispose();
  return { snapshot, disposed: !window.__qaLifecycleSceneReadiness };
}

export async function waitForLifecycleSceneReadiness(
  page,
  { timeoutMs = SCENE_READINESS_TIMEOUT_MS, onProgress = () => {} } = {},
) {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30_000)
    throw new RangeError('Cold scene readiness deadline is invalid.');
  const startedAt = performance.now();
  let last = null;
  let primaryError = null;
  let lastProgressBucket = -1;
  try {
    await evaluateWithDeadline(
      page,
      'start-cold-scene-readiness',
      startLifecycleSceneReadinessInPage,
      {
        timeoutMs,
        pollMs: SCENE_READINESS_POLL_MS,
        stableWindowMs: SCENE_READINESS_STABLE_MS,
      },
    );
    while (performance.now() - startedAt <= timeoutMs + 1_000) {
      const summary = await withProtocolDeadline(
        () =>
          page.evaluate(
            () => window.__qaLifecycleSceneReadiness?.summary() || null,
          ),
        'read-cold-scene-readiness-summary',
        1_000,
      );
      last = summary;
      if (last?.status === 'ready') break;
      if (last?.status !== 'pending') {
        const error = new Error(
          `Cold scene did not become ready: ${last?.status || 'missing'}/${last?.reason || 'no-observation'}.`,
        );
        error.sceneReadiness = last;
        throw error;
      }
      const progressBucket = Math.floor(last.elapsedMs / 5_000);
      if (progressBucket !== lastProgressBucket) {
        lastProgressBucket = progressBucket;
        onProgress({
          elapsedMs: Math.round(last.elapsedMs),
          status: last.status,
          sampleCount: last.historySampleCount,
        });
      }
      await new Promise((resolve) =>
        setTimeout(resolve, Math.min(SCENE_READINESS_POLL_MS, 100)),
      );
    }
    if (last?.status !== 'ready') {
      const error = new Error('Cold scene readiness deadline elapsed.');
      error.sceneReadiness = last;
      throw error;
    }
  } catch (error) {
    primaryError = error;
    if (!error.sceneReadiness) error.sceneReadiness = last;
    throw error;
  } finally {
    try {
      const terminal = await withProtocolDeadline(
        () => page.evaluate(finishLifecycleSceneReadinessInPage),
        'cancel-cold-scene-readiness',
        1_000,
      );
      const finalSnapshot = terminal?.snapshot || null;
      if (terminal && !terminal.disposed)
        throw new Error('Cold scene readiness observer was not disposed.');
      if (finalSnapshot) {
        last = finalSnapshot;
        last.observerDisposed = terminal?.disposed === true;
        if (primaryError) primaryError.sceneReadiness = last;
      }
    } catch (cleanupError) {
      if (primaryError)
        primaryError.sceneReadinessCleanupError = boundedText(cleanupError);
      else throw cleanupError;
    }
  }
  if (last?.status !== 'ready') {
    const error = new Error(
      `Cold scene did not become ready: ${last?.status || 'missing'}/${last?.reason || 'no-observation'}.`,
    );
    error.sceneReadiness = last;
    throw error;
  }
  return last;
}

export async function readWorkerPreflight(
  page,
  verifyNetwork,
  { quiescenceTimeoutMs = 10_000 } = {},
) {
  if (
    !Number.isSafeInteger(quiescenceTimeoutMs) ||
    quiescenceTimeoutMs < 1 ||
    quiescenceTimeoutMs > 10_000
  )
    throw new RangeError('Worker preflight quiescence limit is invalid.');
  let network = null;
  let value = null;
  let diagnosticsAtProbeCompletion = null;
  let pendingAtProbeCompletion = null;
  let quiescenceWaitMs = 0;
  let quiescenceStartedAt = null;
  let phase = 'network-probe';
  let networkError = null;
  let probeError = null;
  let diagnosticSnapshotError = null;
  let quiescenceHistory = null;
  try {
    try {
      network = await verifyNetwork();
    } catch (error) {
      networkError = error;
      throw error;
    }
    phase = 'worker-probe';
    try {
      value = await evaluateWithDeadline(page, 'worker-preflight', async () => {
        const { runCesiumWorkerProbe } =
          await import('/scripts/fixtures/cesium-worker-probe.js');
        const probe = await runCesiumWorkerProbe();
        return {
          probe,
          diagnostics: window.__gevSoakWorkers?.snapshot() || null,
        };
      });
    } catch (error) {
      probeError = error;
      throw error;
    }
    phase = 'worker-preflight-validation';
    pendingAtProbeCompletion = value?.diagnostics?.pending ?? null;
    diagnosticsAtProbeCompletion = value?.diagnostics || null;
    assertWorkerPreflight({ ...value, network }, { allowPending: true });
    if (pendingAtProbeCompletion > 0) {
      phase = 'worker-quiescence';
      quiescenceStartedAt = performance.now();
      quiescenceHistory = await evaluateWithDeadline(
        page,
        'worker-quiescence-history',
        observeWorkerQuiescenceInPage,
        {
          timeoutMs: quiescenceTimeoutMs,
          pollMs: WORKER_QUIESCENCE_POLL_MS,
          maxSamples: WORKER_QUIESCENCE_SAMPLE_CAP,
        },
      );
      quiescenceWaitMs = quiescenceHistory.elapsedMs;
      quiescenceStartedAt = null;
      if (quiescenceHistory.status !== 'settled') {
        const error = new Error(
          `Worker pool did not quiesce: ${quiescenceHistory.status}/${quiescenceHistory.reason}.`,
        );
        error.workerQuiescenceHistory = quiescenceHistory;
        throw error;
      }
      for (const sample of quiescenceHistory.history)
        assertWorkerPreflight(
          {
            ...value,
            network,
            diagnostics: {
              instrumented: sample.instrumented,
              overflow: sample.overflow,
              pending: sample.pending,
              workers: sample.workers,
            },
          },
          { allowPending: true },
        );
      const diagnosticsAfterQuiescence = {
        instrumented: quiescenceHistory.final.instrumented,
        overflow: quiescenceHistory.final.overflow,
        pending: quiescenceHistory.final.pending,
        workers: quiescenceHistory.final.workers,
      };
      value = { ...value, diagnostics: diagnosticsAfterQuiescence };
      phase = 'worker-preflight-validation';
    }
    const result = assertWorkerPreflight({ ...value, network });
    return {
      ...result,
      pendingAtProbeCompletion,
      quiescenceWaitMs,
      quiescenceTimeoutMs,
      quiescenceHistory,
    };
  } catch (error) {
    let diagnostics = value?.diagnostics || null;
    if (error.workerQuiescenceHistory) {
      quiescenceHistory = error.workerQuiescenceHistory;
      diagnostics = quiescenceHistory.final
        ? {
            instrumented: quiescenceHistory.final.instrumented,
            overflow: quiescenceHistory.final.overflow,
            pending: quiescenceHistory.final.pending,
            workers: quiescenceHistory.final.workers,
          }
        : diagnostics;
    } else if (!diagnostics || phase === 'worker-quiescence') {
      try {
        const failureSnapshot = await withProtocolDeadline(
          () =>
            page.evaluate(() => {
              window.__qaWorkerQuiescenceCancel?.();
              return {
                diagnostics: window.__gevSoakWorkers?.snapshot() || null,
                quiescenceHistory: window.__qaWorkerQuiescenceTrace || null,
              };
            }),
          'read-preflight-failure-workers',
          FAILURE_OBSERVATION_TIMEOUT_MS,
        );
        diagnostics = failureSnapshot.diagnostics || diagnostics;
        quiescenceHistory = failureSnapshot.quiescenceHistory;
      } catch (snapshotError) {
        diagnosticSnapshotError = snapshotError;
      }
    }
    if (quiescenceStartedAt !== null)
      quiescenceWaitMs = Math.max(0, performance.now() - quiescenceStartedAt);
    error.lifecycleFailureEvidence = createLifecycleFailureEvidence({
      caseId: 'worker-preflight',
      phase,
      error,
      workerPreflight: {
        network,
        probe: value?.probe || null,
        diagnostics,
        diagnosticsAtProbeCompletion,
        pendingAtProbeCompletion,
        quiescenceWaitMs,
        quiescenceTimeoutMs,
        quiescenceHistory,
        networkError,
        probeError,
        diagnosticSnapshotError,
      },
    });
    throw error;
  }
}

async function setupOwnedPage(
  browser,
  base,
  { expectedCommit, role, quiescenceTimeoutMs = 10_000, onProgress = () => {} },
) {
  onProgress(`create-context:${role}`);
  let context = null;
  let page = null;
  let setupPhase = 'create-context';
  const progress = [];
  let sceneReadiness = null;
  try {
    context = await browser.createBrowserContext();
    setupPhase = 'create-page';
    onProgress(`create-page:${role}`);
    page = await context.newPage();
    await page.evaluateOnNewDocument(installWorkerDiagnostics);
    setupPhase = 'prepare-page';
    onProgress(`prepare-page:${role}`);
    const prepared = await prepareFixturePage(browser, base, { page });
    setupPhase = 'boot';
    await bootFixturePage(page, base, {
      onProgress: (phase) => {
        progress.push(phase);
        onProgress(`boot:${role}:${phase}`);
      },
      hash: `#qa-lifecycle-${role}`,
    });
    page.setDefaultTimeout(HOST_PROTOCOL_TIMEOUT_MS);
    setupPhase = 'disable-unrelated-layers';
    onProgress(`disable-unrelated-layers:${role}`);
    const disabledLayers = await evaluateWithDeadline(
      page,
      'disable-layers',
      async () => {
        const manager = window.__godsEyeView?.dataManager;
        if (!manager || typeof manager.restoreEnabledLayerIds !== 'function')
          throw new Error('Public layer lifecycle controls are unavailable.');
        await manager.restoreEnabledLayerIds([], {
          origin: 'qa-import-workspace-lifecycle',
        });
        const layers = manager.getAll?.();
        if (!Array.isArray(layers) || layers.some((layer) => layer.enabled))
          throw new Error('Unrelated application layers remain enabled.');
        return layers.map((layer) => layer.id).slice(0, 128);
      },
    );
    await evaluateWithDeadline(
      page,
      'install-render-waiter',
      installLifecycleRenderWaiter,
    );
    await evaluateWithDeadline(
      page,
      'install-drain-observer',
      installLifecycleDrainObserver,
    );
    setupPhase = 'cold-scene-readiness';
    onProgress(`cold-scene-readiness:${role}`);
    await evaluateWithDeadline(
      page,
      'install-cold-scene-readiness-observer',
      installLifecycleSceneReadinessObserver,
    );
    sceneReadiness = await waitForLifecycleSceneReadiness(page, {
      timeoutMs: SCENE_READINESS_TIMEOUT_MS,
      onProgress: () => onProgress(`cold-scene-readiness-poll:${role}`),
    });
    setupPhase = 'read-application-identity';
    const identity = await evaluateWithDeadline(
      page,
      'read-application-identity',
      () =>
        window.__godsEyeView?.getPerformanceEnvironment?.()?.appCommit || null,
    );
    if (!SHA1.test(identity || '') || identity !== expectedCommit)
      throw new Error(
        'Served application commit does not match the expected build.',
      );
    setupPhase = 'worker-preflight';
    onProgress(`worker-preflight:${role}`);
    const workerPreflight = await readWorkerPreflight(
      page,
      prepared.verifyNetwork,
      { quiescenceTimeoutMs },
    );
    onProgress(`ready:${role}`);
    return {
      context,
      page,
      errors: prepared.errors,
      progress,
      disabledLayers,
      allLayersDisabled: true,
      applicationCommit: identity,
      sceneReadiness,
      workerPreflight,
    };
  } catch (error) {
    const existingEvidence = error.lifecycleFailureEvidence;
    const failureEvidence = createLifecycleFailureEvidence({
      caseId: role,
      phase: existingEvidence?.failedPhase || setupPhase,
      error,
      workerPreflight: existingEvidence?.workerPreflight || null,
      pageDiagnostics: page ? readFixturePageDiagnostics(page) : null,
    });
    failureEvidence.setupPhase = setupPhase;
    failureEvidence.bootProgress = progress.slice(0, 16);
    failureEvidence.sceneReadiness =
      existingEvidence?.sceneReadiness ||
      error.sceneReadiness ||
      sceneReadiness;
    error.lifecycleFailureEvidence = failureEvidence;
    try {
      await closeOwnedPageAndContext(page, context);
    } catch (cleanupError) {
      failureEvidence.cleanupError = boundedText(cleanupError);
      error.message += `; cleanup failed: ${boundedText(cleanupError)}`;
    }
    throw error;
  }
}

export function createLifecycleReport({
  expectedCommit,
  actualHarnessCommit,
  harnessSourceClean,
  applicationSourceClean,
  fixture,
  cycles,
  drainMs,
  schema = 'gev-import-workspace-lifecycle/v1',
  startedAt = performance.now(),
}) {
  const report = {
    schema,
    status: 'pending',
    phase: 'initialize',
    elapsedMs: 0,
    applicationCommit: expectedCommit,
    harnessCommit: actualHarnessCommit,
    harnessSourceClean,
    applicationSourceClean,
    browserVersion: null,
    browserClose: null,
    environment: {
      platform: process.platform,
      nodeVersion: process.versions.node,
      softwareRenderingRequested: process.env.GEV_QA_SOFTWARE_RENDERING === '1',
      webglOnlyRequested: process.env.GEV_QA_SWIFTSHADER_WEBGL_ONLY === '1',
    },
    cycles,
    drainLimitMs: drainMs,
    fixtures: {
      cooperativeImportId: fixture.id,
      cooperativeImportSourceId: fixture.imports[0].id,
      cooperativeImportCount: fixture.count,
      cooperativeImportRecordIds: fixture.imports[0].records.map(
        (record) => record.id,
      ),
      cooperativeImportSha256: fixture.sha256,
      workspaceImportId: 'workspace-synthetic-point-v1',
      workspaceImportCount: 1,
      workspaceImportSha256: WORKSPACE_IMPORT_FIXTURE_SHA256,
    },
    cases: [],
    progressEvents: [],
  };
  Object.defineProperty(report, '_startedAt', { value: startedAt });
  return report;
}

export function validateLifecycleCandidate(report, expected) {
  return validateImportWorkspaceLifecycleReport(
    { ...report, status: 'passed' },
    expected,
  );
}

export function finalizeLifecycleReportStatus(report, { ownsBrowser }) {
  if (report.status === 'failed') return report.status;
  if (
    report.validationStatus === 'passed' &&
    (!ownsBrowser || report.browserClose?.closeCompleted === true)
  ) {
    report.status = 'passed';
  } else {
    report.status = 'failed';
    report.error ||= 'Lifecycle validation or owned cleanup was incomplete.';
  }
  return report.status;
}

function recordLifecycleProgress(report, phase, caseId = null) {
  report.phase = String(phase).slice(0, 120);
  report.currentCase = caseId;
  report.elapsedMs = Math.max(0, performance.now() - report._startedAt);
  const events = report.progressEvents;
  events.push({ phase: report.phase, caseId, elapsedMs: report.elapsedMs });
  if (events.length > PROGRESS_EVENT_CAP) events.shift();
}

async function pageSnapshot(page) {
  const snapshot = await evaluateWithDeadline(
    page,
    'read-page-snapshot',
    () => {
      const app = window.__godsEyeView;
      const layer = app?.importedGeometryLayer;
      const importState = layer?.getState?.();
      const importDiagnostics = layer?.getPerformanceDiagnostics?.();
      const scene = app?.viewer?.scene;
      const importEntities =
        app?.viewer?.entities?.values?.filter((entity) =>
          String(entity.id).startsWith('gev-import:'),
        ) || [];
      const worker = window.__gevSoakWorkers?.snapshot?.() || null;
      return {
        imports: {
          featureCount: importState?.featureCount ?? null,
          pendingJobs: importState?.pendingJobs ?? null,
          cacheEntries: importDiagnostics?.cacheEntries ?? null,
        },
        importEntityIds:
          app?.viewer?.entities?.values
            ?.filter((entity) => String(entity.id).startsWith('gev-import:'))
            .map((entity) => String(entity.id))
            .slice(0, 5000) ?? null,
        importEntityRecords: importEntities.slice(0, 5000).map((entity) => {
          const position = entity.position?.getValue(
            app.viewer.clock.currentTime,
          );
          return {
            id: String(entity.id),
            name: String(entity.name || ''),
            position: position ? [position.x, position.y, position.z] : null,
          };
        }),
        scene: {
          entities: app?.viewer?.entities?.values?.length ?? null,
          dataSources: app?.viewer?.dataSources?.length ?? null,
          primitives: scene?.primitives?.length ?? null,
          groundPrimitives: scene?.groundPrimitives?.length ?? null,
        },
        restore: app?.workspaceLibraryPanel?.restore?.getState?.() || null,
        workerCounters: worker
          ? {
              scope: 'cumulative-per-document',
              instrumented: worker.instrumented,
              overflow: worker.overflow,
              pending: worker.pending,
              workers: worker.workers.slice(0, 64).map((entry) => ({
                kind: entry.kind,
                submitted: entry.submitted,
                completed: entry.completed,
                taskErrors: entry.taskErrors,
                workerErrors: entry.workerErrors,
                postErrors: entry.postErrors,
                cancelled: entry.cancelled,
                pending: entry.pending,
                oldestPendingMs: entry.oldestPendingMs,
                terminated: entry.terminated,
              })),
            }
          : null,
        diagnostics: {
          scope: 'point-in-time-no-forced-gc-no-plateau-claim',
          jsHeapUsedBytes: Number.isFinite(performance.memory?.usedJSHeapSize)
            ? performance.memory.usedJSHeapSize
            : null,
          browserEventListeners: null,
        },
      };
    },
  );
  const metrics = await withProtocolDeadline(
    () => page.metrics(),
    'read-page-metrics',
  );
  snapshot.diagnostics.browserEventListeners = Number.isFinite(
    metrics.JSEventListeners,
  )
    ? metrics.JSEventListeners
    : null;
  snapshot.diagnostics.jsHeapUsedBytes = Number.isFinite(metrics.JSHeapUsedSize)
    ? metrics.JSHeapUsedSize
    : snapshot.diagnostics.jsHeapUsedBytes;
  return snapshot;
}

async function readFailureObservation(page) {
  return withProtocolDeadline(
    () =>
      page.evaluate(() => {
        const app = window.__godsEyeView;
        const layer = app?.importedGeometryLayer;
        const importState = layer?.getState?.();
        const importDiagnostics = layer?.getPerformanceDiagnostics?.();
        const scene = app?.viewer?.scene;
        const workers = window.__gevSoakWorkers?.snapshot?.() || null;
        const safeInteger = (value) =>
          Number.isSafeInteger(value) && value >= 0 ? value : null;
        return {
          imports: {
            featureCount: safeInteger(importState?.featureCount),
            pendingJobs: safeInteger(importState?.pendingJobs),
            cacheEntries: safeInteger(importDiagnostics?.cacheEntries),
          },
          workerCounters: workers
            ? {
                scope: 'cumulative-per-document',
                instrumented: workers.instrumented,
                overflow: workers.overflow,
                pending: safeInteger(workers.pending),
                workerCount: Array.isArray(workers.workers)
                  ? workers.workers.length
                  : 0,
                workers: (Array.isArray(workers.workers) ? workers.workers : [])
                  .slice(0, 64)
                  .map((worker) => ({
                    kind: worker.kind,
                    submitted: worker.submitted,
                    completed: worker.completed,
                    taskErrors: worker.taskErrors,
                    workerErrors: worker.workerErrors,
                    postErrors: worker.postErrors,
                    cancelled: worker.cancelled,
                    pending: worker.pending,
                    oldestPendingMs: Number.isFinite(worker.oldestPendingMs)
                      ? worker.oldestPendingMs
                      : null,
                    terminated: worker.terminated,
                  })),
                workersTruncated:
                  Array.isArray(workers.workers) && workers.workers.length > 64,
              }
            : null,
          frame: {
            frameNumber: safeInteger(scene?.frameState?.frameNumber),
            requestRenderMode:
              typeof scene?.requestRenderMode === 'boolean'
                ? scene.requestRenderMode
                : null,
            renderRequested:
              typeof scene?._renderRequested === 'boolean'
                ? scene._renderRequested
                : null,
            renderWaiters:
              window.__qaLifecycleRenderWaitSnapshot?.().slice(0, 8) || null,
          },
          scene: {
            entities: safeInteger(app?.viewer?.entities?.values?.length),
            dataSources: safeInteger(app?.viewer?.dataSources?.length),
            primitives: safeInteger(scene?.primitives?.length),
            groundPrimitives: safeInteger(scene?.groundPrimitives?.length),
          },
        };
      }),
    'read-lifecycle-failure-observation',
    FAILURE_OBSERVATION_TIMEOUT_MS,
  );
}

function makeImportDriver(
  page,
  fixture,
  drainMs,
  workerPreflight,
  applicationCommit,
  onPhase,
) {
  let failureOperation = null;
  let lastFailureObservation = null;
  let failureObservationAttempted = false;
  let failureObservationError = null;
  let failureDrainHistory = null;
  const captureFailureObservation = async () => {
    if (failureObservationAttempted) return;
    failureObservationAttempted = true;
    try {
      lastFailureObservation = await readFailureObservation(page);
    } catch (error) {
      failureObservationError = error;
    }
  };
  return {
    onPhase,
    async checkpoint() {
      return pageSnapshot(page);
    },
    async load({ kind, cycle }) {
      const workspaceId =
        kind === 'warmup' ? 'lifecycle-warmup' : `lifecycle-measured-${cycle}`;
      return evaluateWithDeadline(
        page,
        `load-import-${kind}-${cycle ?? 'warmup'}`,
        async ({ imports, workspaceId, timeoutMs }) => {
          const app = window.__godsEyeView;
          const waitId = window.__qaLifecycleStartRenderWait({
            workspaceId,
            count: imports[0].records.length,
            timeoutMs,
          });
          try {
            const result = await app.importedGeometryLayer.loadAsync(imports, {
              workspaceId,
            });
            const renderedPopulation =
              await window.__qaLifecycleWaitForRender(waitId);
            return {
              ...result,
              renderedPopulation,
              importEntityIds: app.viewer.entities.values
                .filter((entity) => String(entity.id).startsWith('gev-import:'))
                .map((entity) => String(entity.id))
                .slice(0, 5000),
            };
          } finally {
            window.__qaLifecycleCancelRenderWait(waitId);
          }
        },
        { imports: fixture.imports, workspaceId, timeoutMs: drainMs },
      );
    },
    async cancelQueued({ cycle }) {
      const result = await evaluateWithDeadline(
        page,
        `cancel-queued-import-${cycle}`,
        async ({ imports, cycle }) => {
          const layer = window.__godsEyeView.importedGeometryLayer;
          const controller = new AbortController();
          const pending = layer.loadAsync(imports, {
            workspaceId: `cancel-${cycle}`,
            signal: controller.signal,
          });
          const queuedObserved =
            layer.getState().pendingJobs === 1 &&
            layer.getState().featureCount < imports[0].records.length;
          if (!queuedObserved) {
            controller.abort();
            await pending.catch(() => {});
            return {
              status: 'not-queued',
              queuedObserved: false,
              snapshot: null,
            };
          }
          controller.abort('lifecycle-cancel');
          let status = 'unexpected-resolve';
          try {
            await pending;
          } catch (error) {
            status = error.name === 'AbortError' ? 'cancelled' : 'failed';
          }
          return {
            status,
            queuedObserved,
            snapshot: null,
          };
        },
        { imports: fixture.imports, cycle },
      );
      return { ...result, snapshot: await pageSnapshot(page) };
    },
    async supersedeQueued({ cycle }) {
      const result = await evaluateWithDeadline(
        page,
        `supersede-queued-import-${cycle}`,
        async ({ imports, cycle, timeoutMs }) => {
          const layer = window.__godsEyeView.importedGeometryLayer;
          const replacementWorkspaceId = `lifecycle-replacement-${cycle}`;
          const waitId = window.__qaLifecycleStartRenderWait({
            workspaceId: replacementWorkspaceId,
            count: imports[0].records.length,
            timeoutMs,
          });
          try {
            const oldPending = layer.loadAsync(imports, {
              workspaceId: `superseded-${cycle}`,
            });
            const queuedObserved =
              layer.getState().pendingJobs === 1 &&
              layer.getState().featureCount < imports[0].records.length;
            let oldStatus = 'unexpected-resolve';
            const oldSettled = oldPending.then(
              () => oldStatus,
              (error) =>
                (oldStatus =
                  error.name === 'AbortError' ? 'cancelled' : 'failed'),
            );
            const replacementPending = layer.loadAsync(imports, {
              workspaceId: replacementWorkspaceId,
            });
            const replacement = await replacementPending;
            await oldSettled;
            const renderedPopulation =
              await window.__qaLifecycleWaitForRender(waitId);
            const allIds = window.__godsEyeView.viewer.entities.values
              .filter((entity) => String(entity.id).startsWith('gev-import:'))
              .map((entity) => String(entity.id))
              .slice(0, 5000);
            return {
              oldStatus,
              queuedObserved,
              oldIdsStillPresent: allIds.some((id) =>
                id.startsWith(`gev-import:superseded-${cycle}:`),
              ),
              replacement: {
                ...replacement,
                renderedPopulation,
                importEntityIds: allIds,
              },
            };
          } finally {
            window.__qaLifecycleCancelRenderWait(waitId);
          }
        },
        { imports: fixture.imports, cycle, timeoutMs: drainMs },
      );
      return { ...result, snapshot: await pageSnapshot(page) };
    },
    async clearAndDrain() {
      const waitId = await startRenderedPopulationWait(
        page,
        '__empty__',
        0,
        drainMs,
      );
      failureOperation = {
        name: 'clear-and-drain',
        status: 'waiting-for-empty-import-and-idle-workers',
        renderWaitId: waitId,
        renderWaitStatus: 'pending',
      };
      failureDrainHistory = null;
      lastFailureObservation = null;
      failureObservationAttempted = false;
      failureObservationError = null;
      try {
        await evaluateWithDeadline(page, 'clear-import-and-drain', () => {
          const app = window.__godsEyeView;
          app.importedGeometryLayer.clear();
          app.viewer.scene.requestRender();
        });
        await evaluateWithDeadline(
          page,
          'start-import-drain-observation',
          (timeoutMs) => window.__qaLifecycleStartDrainObservation(timeoutMs),
          drainMs,
        );
        await page.waitForFunction(() => window.__qaLifecycleSampleDrain(), {
          timeout: drainMs,
          polling: WORKER_QUIESCENCE_POLL_MS,
        });
        failureOperation.drainHistory = await withProtocolDeadline(
          () =>
            page.evaluate(() =>
              window.__qaLifecycleDrainObservationSnapshot({
                includeHistory: false,
              }),
            ),
          'read-import-drain-summary',
        );
        if (failureOperation.drainHistory?.status !== 'settled')
          throw new Error(
            'Import drain predicate returned without a settled observation.',
          );
        const renderedPopulation = await finishRenderedPopulationWait(
          page,
          waitId,
        );
        const result = {
          ...(await pageSnapshot(page)),
          renderedPopulation,
          drainHistory: failureOperation.drainHistory,
        };
        failureOperation.status = 'completed';
        failureOperation.renderWaitStatus = 'completed';
        failureOperation = null;
        return result;
      } catch (error) {
        failureOperation.status = /timed out|timeout|\b\d+ms exceeded\b/i.test(
          String(error?.message || error),
        )
          ? 'timed-out'
          : 'failed';
        failureOperation.error = error;
        try {
          failureDrainHistory = await withProtocolDeadline(
            () =>
              page.evaluate(readLifecycleDrainObservation, {
                sampleAfterDeadline: true,
                timedOut: failureOperation.status === 'timed-out',
                includeHistory: true,
              }),
            'read-import-drain-history',
            FAILURE_OBSERVATION_TIMEOUT_MS,
          );
          if (failureDrainHistory)
            failureOperation.drainHistory = failureDrainHistory;
        } catch (drainHistoryError) {
          failureOperation.drainHistoryError = drainHistoryError;
        }
        await captureFailureObservation();
        if (lastFailureObservation)
          lastFailureObservation.drainHistory = failureDrainHistory;
        const waiter = lastFailureObservation?.frame?.renderWaiters?.find(
          (item) => item.id === waitId,
        );
        failureOperation.renderWaitStatus =
          waiter?.status || 'not-observed-before-cancel';
        await withProtocolDeadline(
          () =>
            page.evaluate(
              (id) => window.__qaLifecycleCancelRenderWait(id),
              waitId,
            ),
          'cancel-render-wait-after-clear-failure',
          1000,
        ).catch(() => {});
        throw error;
      } finally {
        await withProtocolDeadline(
          () =>
            page.evaluate(() => window.__qaLifecycleClearDrainObservation?.()),
          'clear-import-drain-observation',
          1000,
        ).catch(() => {});
      }
    },
    async workerCounters() {
      return evaluateWithDeadline(page, 'read-import-worker-counters', () => {
        const value = window.__gevSoakWorkers?.snapshot() || null;
        return value ? { ...value, scope: 'cumulative-per-document' } : null;
      });
    },
    async close() {
      await closeOwnedPageAndContext(page, page.browserContext());
    },
    async failureEvidence({ phase, error, progress }) {
      await captureFailureObservation();
      return createLifecycleFailureEvidence({
        caseId: 'cooperative-import',
        phase,
        error,
        operation: failureOperation,
        observation: lastFailureObservation,
        observationError: failureObservationError,
        supersession: progress?.supersessionOutcome,
      });
    },
    workerPreflight,
    applicationCommit,
  };
}

/** Install a second, instance-owned import layer without replacing the app's owner. */
export function installControlledRenderWaiterFactory() {
  window.__qaCreateControlledRenderWaiter =
    function createControlledRenderWaiter({
      scene,
      snapshot,
      renderWaits,
      ownedTimers,
      workspaceId,
      count,
      timeoutMs,
    }) {
      const startingFrame = scene.frameState.frameNumber;
      let listener;
      let timeout;
      let settled = false;
      let resolvePromise;
      let rejectPromise;
      const row = {
        promise: new Promise((resolve, reject) => {
          resolvePromise = resolve;
          rejectPromise = reject;
        }),
        cancel(reason = 'Controlled render wait cancelled.') {
          if (settled) return;
          settled = true;
          cleanup();
          rejectPromise(new DOMException(reason, 'AbortError'));
        },
        get done() {
          return settled;
        },
      };
      function cleanup() {
        if (listener) scene.postRender.removeEventListener(listener);
        if (timeout !== undefined) {
          clearTimeout(timeout);
          ownedTimers.delete(timeout);
          timeout = undefined;
        }
        renderWaits.delete(row);
      }
      try {
        row.promise.catch(() => {});
        renderWaits.add(row);
        listener = () => {
          if (scene.frameState.frameNumber <= startingFrame) return;
          const current = snapshot();
          const ids = current.importEntityIds;
          const prefix = `gev-import:${workspaceId}:`;
          if (
            current.imports.featureCount !== count ||
            ids.length !== count ||
            ids.some((id) => !id.startsWith(prefix))
          )
            return;
          settled = true;
          cleanup();
          resolvePromise({
            frameNumber: current.frame.frameNumber,
            importedEntityCount: count,
            workspaceId,
          });
        };
        timeout = setTimeout(() => {
          if (settled) return;
          settled = true;
          cleanup();
          rejectPromise(
            new Error('Controlled import render was not observed.'),
          );
        }, timeoutMs);
        ownedTimers.add(timeout);
        scene.postRender.addEventListener(listener);
        scene.requestRender();
        return row;
      } catch (error) {
        row.cancel('Controlled render waiter setup failed.');
        throw error;
      }
    };
}

async function installControlledImportOwner({ featureCount }) {
  const app = window.__godsEyeView;
  const appLayer = app?.importedGeometryLayer;
  const appState = appLayer?.getState?.();
  const appIds =
    app?.viewer?.entities?.values
      ?.filter((entity) => String(entity.id).startsWith('gev-import:'))
      .map((entity) => String(entity.id)) || [];
  if (
    !app?.viewer?.scene ||
    appState?.featureCount !== 0 ||
    appState?.pendingJobs !== 0 ||
    appIds.length !== 0 ||
    window.__qaControlledImportOwner
  )
    throw new Error(
      'Controlled import owner requires an empty app import owner.',
    );

  const [
    { createImportedGeometryLayer },
    { getContextStore },
    { getWorldOverlayDiagnostics },
  ] = await Promise.all([
    import('/src/imports/runtimeLayer.js'),
    import('/src/data/contextStore.js'),
    import('/src/overlays/worldOverlay.js'),
  ]);
  const contextStore = getContextStore();
  const initialImportContexts = [...contextStore.entities.values()].filter(
    (record) => record?.layerId === 'user-imports',
  ).length;
  const initialOverlayEntries =
    getWorldOverlayDiagnostics().entriesBySource?.['user-imports'] || 0;
  if (initialImportContexts !== 0 || initialOverlayEntries !== 0)
    throw new Error(
      'Controlled import context/overlay source is already owned.',
    );
  let logicalClock = 0;
  let nextHandle = 0;
  let holdNext = false;
  const heldCallbacks = new Map();
  const ownedTimers = new Set();
  const renderWaits = new Set();
  const tick = () => logicalClock++;
  const schedule = (callback) => {
    if (holdNext) {
      holdNext = false;
      const token = { id: ++nextHandle };
      heldCallbacks.set(token, callback);
      return token;
    }
    const timer = setTimeout(() => {
      ownedTimers.delete(timer);
      callback();
    }, 0);
    ownedTimers.add(timer);
    return timer;
  };
  const cancel = (handle) => {
    if (heldCallbacks.delete(handle)) return;
    if (ownedTimers.delete(handle)) clearTimeout(handle);
  };
  const layer = createImportedGeometryLayer({
    viewer: app.viewer,
    batchOptions: { now: tick, schedule, cancel },
  });

  function snapshot(renderedPopulation = null) {
    const state = layer.getState();
    const diagnostics = layer.getPerformanceDiagnostics();
    const viewer = app.viewer;
    const scene = viewer.scene;
    const entities = viewer.entities.values.filter((entity) =>
      String(entity.id).startsWith('gev-import:'),
    );
    const applicationOwnerIds = entities
      .map((entity) => String(entity.id))
      .filter((id) => !id.startsWith('gev-import:controlled-'));
    const applicationContextCount = [...contextStore.entities.values()].filter(
      (record) =>
        record?.layerId === 'user-imports' &&
        !String(record.entity?.id || '').startsWith('gev-import:controlled-'),
    ).length;
    const workerCounters = window.__gevSoakWorkers?.snapshot?.() || null;
    return {
      imports: {
        featureCount: state.featureCount,
        pendingJobs: diagnostics.pendingJobs,
        cacheEntries: diagnostics.cacheEntries,
      },
      importEntityIds: entities
        .map((entity) => String(entity.id))
        .slice(0, 5000),
      importEntityRecords: entities.slice(0, 5000).map((entity) => {
        const position = entity.position?.getValue(viewer.clock.currentTime);
        return {
          id: String(entity.id),
          name: String(entity.name || ''),
          position: position ? [position.x, position.y, position.z] : null,
        };
      }),
      scene: {
        entities: viewer.entities.values.length,
        dataSources: viewer.dataSources.length,
        primitives: scene.primitives.length,
        groundPrimitives: scene.groundPrimitives.length,
      },
      frame: { frameNumber: scene.frameState.frameNumber },
      overlaySourceEntries:
        getWorldOverlayDiagnostics().entriesBySource?.['user-imports'] || 0,
      workerCounters: workerCounters
        ? { ...workerCounters, scope: 'cumulative-per-document' }
        : null,
      renderedPopulation,
      applicationOwner: {
        featureCount: appLayer.getState().featureCount,
        pendingJobs: appLayer.getState().pendingJobs,
        importedEntityIds: applicationOwnerIds.slice(0, 5000),
        contextRecordCount: applicationContextCount,
      },
    };
  }

  const renderWaiterFactory = window.__qaCreateControlledRenderWaiter;
  if (typeof renderWaiterFactory !== 'function')
    throw new Error('Controlled render waiter factory is unavailable.');
  const waitForRender = (workspaceId, count, timeoutMs) =>
    renderWaiterFactory({
      scene: app.viewer.scene,
      snapshot,
      renderWaits,
      ownedTimers,
      workspaceId,
      count,
      timeoutMs,
    });

  window.__qaControlledImportOwner = {
    featureCount,
    layer,
    snapshot,
    waitForRender,
    setHoldNext(value) {
      holdNext = value === true;
    },
    get heldCallbackCount() {
      return heldCallbacks.size;
    },
    get ownedTimerCount() {
      return ownedTimers.size;
    },
    async dispose() {
      for (const wait of [...renderWaits])
        wait.cancel('Controlled import owner disposed.');
      layer.destroy();
      for (const timer of ownedTimers) clearTimeout(timer);
      ownedTimers.clear();
      heldCallbacks.clear();
      const result = snapshot();
      const overlayEntries =
        getWorldOverlayDiagnostics().entriesBySource?.['user-imports'] || 0;
      const contextRecordCount = [...contextStore.entities.values()].filter(
        (record) => record?.layerId === 'user-imports',
      ).length;
      const cleanup = {
        destroyed: layer.getState().destroyed === true,
        pendingJobs: layer.getState().pendingJobs,
        ownedTimers: ownedTimers.size,
        heldCallbacks: heldCallbacks.size,
        renderWaiters: renderWaits.size,
        overlayEntries,
        contextRecordCount,
        applicationOwnerUnchanged:
          result.applicationOwner.featureCount === 0 &&
          result.applicationOwner.pendingJobs === 0 &&
          result.applicationOwner.importedEntityIds.length === 0 &&
          result.applicationOwner.contextRecordCount === 0,
        snapshot: result,
      };
      delete window.__qaControlledImportOwner;
      delete window.__qaCreateControlledRenderWaiter;
      return cleanup;
    },
  };
  return {
    applicationOwnerBaseline: {
      featureCount: appState.featureCount,
      pendingJobs: appState.pendingJobs,
      importedEntityIds: appIds,
    },
    snapshot: snapshot(),
  };
}

/** Browser-serialized operation body shared by the controlled driver. */
export async function runControlledImportOperation({
  action,
  imports,
  featureCount,
  cycle,
  timeoutMs,
}) {
  const owner = window.__qaControlledImportOwner;
  if (!owner) throw new Error('Controlled import owner is unavailable.');
  if (action === 'warmup') {
    const workspaceId = 'controlled-warmup';
    const renderWait = owner.waitForRender(
      workspaceId,
      featureCount,
      timeoutMs,
    );
    try {
      const result = await owner.layer.loadAsync(imports, { workspaceId });
      const renderedPopulation = await renderWait.promise;
      return {
        ...result,
        renderedPopulation,
        importEntityIds: owner.snapshot().importEntityIds,
      };
    } finally {
      if (!renderWait.done) renderWait.cancel();
    }
  }
  if (action === 'cancel') {
    const workspaceId = `controlled-cancel-${cycle}`;
    owner.setHoldNext(true);
    const controller = new AbortController();
    const pending = owner.layer.loadAsync(imports, {
      workspaceId,
      signal: controller.signal,
    });
    const queuedObserved =
      owner.layer.getState().pendingJobs === 1 &&
      owner.layer.getState().featureCount < featureCount &&
      owner.heldCallbackCount === 1;
    controller.abort('controlled-lifecycle-cancel');
    let status = 'unexpected-resolve';
    try {
      await pending;
    } catch (error) {
      status = error.name === 'AbortError' ? 'cancelled' : 'failed';
    }
    const renderWait = owner.waitForRender('__empty__', 0, timeoutMs);
    try {
      const renderedPopulation = await renderWait.promise;
      const snapshot = owner.snapshot(renderedPopulation);
      return {
        status,
        queuedObserved,
        heldCallbacksAfter: owner.heldCallbackCount,
        ownedTimersAfter: owner.ownedTimerCount,
        oldIdsStillPresent: snapshot.importEntityIds.some((id) =>
          id.startsWith(`gev-import:${workspaceId}:`),
        ),
        snapshot,
      };
    } finally {
      if (!renderWait.done) renderWait.cancel();
    }
  }
  if (action === 'supersede') {
    const oldWorkspaceId = `controlled-superseded-${cycle}`;
    const workspaceId = `controlled-replacement-${cycle}`;
    owner.setHoldNext(true);
    const oldPending = owner.layer.loadAsync(imports, {
      workspaceId: oldWorkspaceId,
    });
    const queuedObserved =
      owner.layer.getState().pendingJobs === 1 &&
      owner.layer.getState().featureCount < featureCount &&
      owner.heldCallbackCount === 1;
    let oldStatus = 'unexpected-resolve';
    const oldSettled = oldPending.then(
      () => oldStatus,
      (error) =>
        (oldStatus = error.name === 'AbortError' ? 'cancelled' : 'failed'),
    );
    const renderWait = owner.waitForRender(
      workspaceId,
      featureCount,
      timeoutMs,
    );
    try {
      const replacement = await owner.layer.loadAsync(imports, { workspaceId });
      await oldSettled;
      const renderedPopulation = await renderWait.promise;
      const snapshot = owner.snapshot(renderedPopulation);
      return {
        oldStatus,
        queuedObserved,
        heldCallbacksAfter: owner.heldCallbackCount,
        ownedTimersAfter: owner.ownedTimerCount,
        oldIdsStillPresent: snapshot.importEntityIds.some((id) =>
          id.startsWith(`gev-import:${oldWorkspaceId}:`),
        ),
        replacement: {
          ...replacement,
          renderedPopulation,
          importEntityIds: snapshot.importEntityIds,
        },
        snapshot,
      };
    } finally {
      if (!renderWait.done) renderWait.cancel();
    }
  }
  if (action === 'clear') {
    owner.layer.clear();
    const renderWait = owner.waitForRender('__empty__', 0, timeoutMs);
    try {
      const renderedPopulation = await renderWait.promise;
      return owner.snapshot(renderedPopulation);
    } finally {
      if (!renderWait.done) renderWait.cancel();
    }
  }
  throw new TypeError('Unknown controlled import lifecycle operation.');
}

function makeControlledImportDriver(
  page,
  fixture,
  drainMs,
  workerPreflight,
  applicationCommit,
  onPhase,
) {
  const driver = {
    onPhase,
    cleanup: null,
    async initialize() {
      await evaluateWithDeadline(
        page,
        'install-controlled-render-waiter',
        installControlledRenderWaiterFactory,
      );
      try {
        return await evaluateWithDeadline(
          page,
          'install-controlled-import-owner',
          installControlledImportOwner,
          { featureCount: fixture.count },
        );
      } catch (error) {
        try {
          await evaluateWithDeadline(
            page,
            'remove-controlled-render-waiter',
            () => delete window.__qaCreateControlledRenderWaiter,
          );
        } catch {}
        throw error;
      }
    },
    async checkpoint() {
      return evaluateWithDeadline(
        page,
        'controlled-import-checkpoint',
        () => window.__qaControlledImportOwner?.snapshot() || null,
      );
    },
    async warmup({ featureCount }) {
      return evaluateWithDeadline(
        page,
        'controlled-import-warmup',
        runControlledImportOperation,
        {
          action: 'warmup',
          imports: fixture.imports,
          featureCount,
          timeoutMs: drainMs,
        },
      );
    },
    async cancelQueued({ cycle, featureCount }) {
      return evaluateWithDeadline(
        page,
        `controlled-import-cancel-${cycle}`,
        runControlledImportOperation,
        {
          action: 'cancel',
          imports: fixture.imports,
          featureCount,
          cycle,
          timeoutMs: drainMs,
        },
      );
    },
    async supersedeQueued({ cycle, featureCount }) {
      return evaluateWithDeadline(
        page,
        `controlled-import-supersede-${cycle}`,
        runControlledImportOperation,
        {
          action: 'supersede',
          imports: fixture.imports,
          featureCount,
          cycle,
          timeoutMs: drainMs,
        },
      );
    },
    async clearAndDrain() {
      return evaluateWithDeadline(
        page,
        'controlled-import-clear-and-render',
        runControlledImportOperation,
        { action: 'clear', timeoutMs: drainMs },
      );
    },
    async workerCounters() {
      return evaluateWithDeadline(
        page,
        'controlled-import-worker-counters',
        () => {
          const value = window.__gevSoakWorkers?.snapshot?.() || null;
          return value ? { ...value, scope: 'cumulative-per-document' } : null;
        },
      );
    },
    async failureEvidence({ phase, error, progress }) {
      let observation = null;
      try {
        observation = await this.checkpoint();
      } catch {}
      return createLifecycleFailureEvidence({
        caseId: 'controlled-import-supersession',
        phase,
        error,
        observation,
        observationError: observation
          ? null
          : 'controlled snapshot unavailable',
        supersession: progress.supersessionOutcome,
      });
    },
    async close() {
      driver.cleanup = await closeControlledOwnerAndContext({
        dispose: async () => {
          const cleanup = await evaluateWithDeadline(
            page,
            'dispose-controlled-import-owner',
            async () =>
              window.__qaControlledImportOwner
                ? await window.__qaControlledImportOwner.dispose()
                : null,
          );
          driver.cleanup = cleanup;
          return cleanup;
        },
        validateCleanup: (cleanup) => {
          if (
            cleanup?.destroyed !== true ||
            cleanup.pendingJobs !== 0 ||
            cleanup.ownedTimers !== 0 ||
            cleanup.heldCallbacks !== 0 ||
            cleanup.renderWaiters !== 0 ||
            cleanup.overlayEntries !== 0 ||
            cleanup.contextRecordCount !== 0 ||
            cleanup.applicationOwnerUnchanged !== true ||
            cleanup.snapshot?.imports?.featureCount !== 0 ||
            cleanup.snapshot?.importEntityIds?.length !== 0
          )
            throw new Error('Controlled import owner cleanup was incomplete.');
        },
        closeContext: () =>
          closeOwnedPageAndContext(page, page.browserContext()),
      });
    },
    workerPreflight,
    applicationCommit,
  };
  return driver.initialize().then(() => driver);
}

function makeWorkspaceDriver(
  page,
  drainMs,
  workerPreflight,
  applicationCommit,
  onPhase,
) {
  let failureOperation = null;
  let lastFailureObservation = null;
  let failureObservationError = null;
  return {
    onPhase,
    async seed() {
      const baseline = await seedPersistentWorkspace(page);
      const initialId = baseline.id;
      await clickControl(page, '.workspace-library [data-action="duplicate"]');
      await page.waitForFunction(
        (id) => {
          const selected = document.querySelector(
            '.workspace-library [data-workspace-select]',
          )?.value;
          return selected && selected !== id;
        },
        { timeout: 30_000, polling: 50 },
        initialId,
      );
      const alternateId = await page.$eval(
        '.workspace-library [data-workspace-select]',
        (select) => select.value,
      );
      return {
        baselineId: initialId,
        alternateId,
        featureCount: 1,
        fixtureSha256: baseline.sha256,
      };
    },
    async open(id) {
      const waitId = await startRenderedPopulationWait(
        page,
        id,
        1,
        drainMs,
        true,
      );
      failureOperation = {
        name: 'open-workspace',
        status: 'waiting-for-workspace-restore',
        renderWaitId: waitId,
        renderWaitStatus: 'pending',
        workspaceId: id,
      };
      lastFailureObservation = null;
      failureObservationError = null;
      try {
        await openWorkspace(page, id, { timeoutMs: drainMs });
        await page.waitForFunction(
          (workspaceId) => {
            const app = window.__godsEyeView;
            const state = app?.importedGeometryLayer?.getState?.();
            const restore = app?.workspaceLibraryPanel?.restore?.getState?.();
            return (
              restore?.status === 'applied' &&
              restore.workspaceId === workspaceId &&
              state?.pendingJobs === 0 &&
              state?.featureCount === 1 &&
              window.__gevSoakWorkers?.snapshot?.()?.pending === 0
            );
          },
          { timeout: drainMs, polling: 50 },
          id,
        );
        const renderedPopulation = await finishRenderedPopulationWait(
          page,
          waitId,
        );
        const result = { ...(await pageSnapshot(page)), renderedPopulation };
        failureOperation = null;
        return result;
      } catch (error) {
        failureOperation.status = /timed out|timeout|\b\d+ms exceeded\b/i.test(
          String(error?.message || error),
        )
          ? 'timed-out'
          : 'failed';
        failureOperation.error = error;
        try {
          lastFailureObservation = await readFailureObservation(page);
        } catch (snapshotError) {
          failureObservationError = snapshotError;
        }
        throw error;
      } finally {
        if (failureOperation) {
          const waitIdToCancel = failureOperation.renderWaitId;
          failureOperation.renderWaitStatus =
            'cancelled-after-operation-failure';
          await withProtocolDeadline(
            () =>
              page.evaluate(
                (id) => window.__qaLifecycleCancelRenderWait(id),
                waitIdToCancel,
              ),
            'cancel-render-wait-after-workspace-failure',
            1000,
          ).catch(() => {});
        }
      }
    },
    async workerCounters() {
      return evaluateWithDeadline(
        page,
        'read-workspace-worker-counters',
        () => {
          const value = window.__gevSoakWorkers?.snapshot() || null;
          return value ? { ...value, scope: 'cumulative-per-document' } : null;
        },
      );
    },
    async failureEvidence({ phase, error }) {
      let observation = null;
      if (lastFailureObservation) {
        observation = lastFailureObservation;
      } else if (!failureObservationError) {
        try {
          observation = await readFailureObservation(page);
        } catch (snapshotError) {
          failureObservationError = snapshotError;
        }
      }
      return createLifecycleFailureEvidence({
        caseId: 'workspace-replacement',
        phase,
        error,
        operation: failureOperation,
        observation,
        observationError: failureObservationError,
      });
    },
    async close() {
      await closeOwnedPageAndContext(page, page.browserContext());
    },
    workerPreflight,
    applicationCommit,
  };
}

function addWorkerAndHeapDiagnostics(snapshot) {
  if (!snapshot || !snapshot.workerCounters)
    throw new Error('Worker diagnostics are missing from a checkpoint.');
  if (
    snapshot.workerCounters.instrumented !== true ||
    typeof snapshot.workerCounters.overflow !== 'boolean' ||
    !Number.isSafeInteger(snapshot.workerCounters.pending) ||
    snapshot.workerCounters.pending < 0 ||
    !Array.isArray(snapshot.workerCounters.workers) ||
    snapshot.workerCounters.workers.length > 64
  )
    throw new Error('Worker counters are malformed or exceeded their bound.');
  assertOwnedLifecycleCheckpoint(snapshot, {
    featureCount: snapshot.imports.featureCount,
    pendingJobs: snapshot.imports.pendingJobs,
  });
  return {
    ...snapshot,
    workerCounters: {
      ...snapshot.workerCounters,
      workers: snapshot.workerCounters.workers.map((worker) => ({
        ...worker,
        submitted: Number.isSafeInteger(worker.submitted)
          ? worker.submitted
          : -1,
        completed: Number.isSafeInteger(worker.completed)
          ? worker.completed
          : -1,
        cancelled: Number.isSafeInteger(worker.cancelled)
          ? worker.cancelled
          : -1,
        pending: Number.isSafeInteger(worker.pending) ? worker.pending : -1,
      })),
    },
  };
}

export async function runImportWorkspaceLifecycle({
  url,
  expectedCommit,
  cycles = DEFAULT_CYCLES,
  drainMs = 10_000,
  featureCount = FEATURE_COUNT,
  harnessCommit = null,
  browser = null,
  launchBrowser = launchFixtureBrowser,
  onProgress = () => {},
} = {}) {
  if (!SHA1.test(expectedCommit || ''))
    throw new TypeError('A full expected application commit is required.');
  const fixture = createLifecycleImportFixture(featureCount);
  if (!Number.isSafeInteger(cycles) || cycles < 1 || cycles > 10)
    throw new RangeError('Lifecycle cycles must be between 1 and 10.');
  if (!Number.isSafeInteger(drainMs) || drainMs < 1 || drainMs > 10_000)
    throw new RangeError(
      'Lifecycle drain limit must be between 1 and 10000ms.',
    );
  const scriptRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '..',
  );
  const actualHarnessCommit =
    harnessCommit ||
    execFileSync('git', ['-C', scriptRoot, 'rev-parse', 'HEAD'], {
      encoding: 'utf8',
    }).trim();
  if (!SHA1.test(actualHarnessCommit))
    throw new Error('Harness checkout commit could not be verified.');
  const harnessSourceClean =
    execFileSync(
      'git',
      [
        '-C',
        scriptRoot,
        'status',
        '--porcelain',
        '--',
        'scripts/qa-import-workspace-lifecycle.mjs',
        'scripts/performance/importWorkspaceLifecycle.mjs',
      ],
      { encoding: 'utf8' },
    ).trim() === '';
  const applicationSourceClean =
    execFileSync(
      'git',
      [
        '-C',
        scriptRoot,
        'status',
        '--porcelain',
        '--',
        'src',
        'public',
        'build/vite.js',
        'index.html',
        'package.json',
        'package-lock.json',
        'vite.config.js',
      ],
      { encoding: 'utf8' },
    ).trim() === '';
  const workspaceFixtureSha256 = WORKSPACE_IMPORT_FIXTURE_SHA256;
  const ownsBrowser = !browser;
  const report = createLifecycleReport({
    expectedCommit,
    actualHarnessCommit,
    harnessSourceClean,
    applicationSourceClean,
    fixture,
    cycles,
    drainMs,
    schema: 'gev-import-workspace-lifecycle/v2',
  });
  const emitProgress = (phase, caseId = null, caseProgress = null) => {
    if (report.status === 'pending') report.status = 'running';
    recordLifecycleProgress(report, phase, caseId);
    if (caseProgress) {
      report.activeCase = {
        id: caseId,
        phase: String(caseProgress.phase || phase).slice(0, 120),
        operations: { ...caseProgress.operations },
        checkpointCount: Array.isArray(caseProgress.checkpoints)
          ? caseProgress.checkpoints.length
          : 0,
      };
    } else if (caseId === null) {
      delete report.activeCase;
    }
    try {
      onProgress(report);
    } catch (error) {
      report.progressWriteError = boundedText(error);
    }
  };
  let caseId = null;
  let browserCloseStarted = false;
  let browserLaunchAttempted = Boolean(browser);
  emitProgress('launch-browser');
  try {
    if (!browser) {
      browserLaunchAttempted = true;
      browser = await launchBrowser({
        timeout: 30_000,
        protocolTimeout: HOST_PROTOCOL_TIMEOUT_MS,
      });
    }
    emitProgress('read-browser-version');
    report.browserVersion = await withProtocolDeadline(
      () => browser.version(),
      'read-browser-version',
    );
    for (const id of [
      'cooperative-import',
      'workspace-replacement',
      'controlled-import-supersession',
    ]) {
      caseId = id;
      emitProgress(`setup:${id}`, id);
      let owned = null;
      try {
        owned = await setupOwnedPage(browser, url, {
          expectedCommit,
          role: id,
          quiescenceTimeoutMs: drainMs,
          onProgress: (phase) => emitProgress(phase, id),
        });
        const onPhase = (phase, caseProgress) =>
          emitProgress(`case:${id}:${phase}`, id, caseProgress);
        const driver =
          id === 'controlled-import-supersession'
            ? await makeControlledImportDriver(
                owned.page,
                fixture,
                drainMs,
                owned.workerPreflight,
                owned.applicationCommit,
                onPhase,
              )
            : id === 'cooperative-import'
              ? makeImportDriver(
                  owned.page,
                  fixture,
                  drainMs,
                  owned.workerPreflight,
                  owned.applicationCommit,
                  onPhase,
                )
              : makeWorkspaceDriver(
                  owned.page,
                  drainMs,
                  owned.workerPreflight,
                  owned.applicationCommit,
                  onPhase,
                );
        emitProgress(`run-case:${id}`, id);
        const result =
          id === 'controlled-import-supersession'
            ? await runControlledImportSupersessionLifecycleCase({
                driver,
                cycles,
                featureCount,
                featureIds: fixture.imports[0].records.map(
                  (record) => record.id,
                ),
                importId: fixture.imports[0].id,
              })
            : id === 'cooperative-import'
              ? await runCooperativeImportLifecycleCase({
                  driver,
                  cycles,
                  featureCount,
                  includeRaceCoverage: false,
                  featureIds: fixture.imports[0].records.map(
                    (record) => record.id,
                  ),
                  importId: fixture.imports[0].id,
                })
              : await runWorkspaceReplacementLifecycleCase({ driver, cycles });
        if (result.status === 'passed' && owned.errors.length)
          throw new Error('Application page emitted uncaught errors.');
        const snapshots = [result.baseline, result.final].filter(Boolean);
        for (const item of snapshots) addWorkerAndHeapDiagnostics(item);
        report.cases.push({
          ...result,
          mode:
            id === 'controlled-import-supersession'
              ? 'controlled-instance-scheduler'
              : 'native-full-app',
          timingScope:
            id === 'controlled-import-supersession'
              ? 'correctness-only; no native timing claim'
              : id === 'cooperative-import'
                ? 'native-full-app-load-clear'
                : 'native-full-app-workspace-replacement',
          ...(id === 'controlled-import-supersession'
            ? { cleanup: driver.cleanup }
            : {}),
          applicationCommit: owned.applicationCommit,
          disabledLayers: owned.disabledLayers,
          allLayersDisabled: owned.allLayersDisabled,
          bootProgress: owned.progress.slice(0, 16),
          sceneReadiness: owned.sceneReadiness,
          workerPreflight: owned.workerPreflight,
          pageErrors: owned.errors.slice(0, 8).map(boundedText),
        });
        emitProgress(`case-${result.status}:${id}`, id);
      } catch (error) {
        report.cases.push({
          id,
          status: 'failed',
          failedPhase: report.activeCase?.phase || report.phase,
          error: boundedText(error),
          failureEvidence: error.lifecycleFailureEvidence || null,
          bootProgress: owned?.progress?.slice(0, 16) || [],
          sceneReadiness:
            owned?.sceneReadiness ||
            error.lifecycleFailureEvidence?.sceneReadiness ||
            null,
          disabledLayers: owned?.disabledLayers || [],
          allLayersDisabled: owned?.allLayersDisabled === true,
          workerPreflight: owned?.workerPreflight || null,
          pageErrors: owned?.errors?.slice(0, 8).map(boundedText) || [],
        });
        if (owned) {
          try {
            await closeOwnedPageAndContext(owned.page, owned.context);
          } catch (cleanupError) {
            report.cases.at(-1).cleanupError = boundedText(cleanupError);
          }
        }
        emitProgress(`case-failed:${id}`, id);
      }
      caseId = null;
      delete report.activeCase;
    }
    if (
      report.cases.length !== 3 ||
      report.cases.some((row) => row.status !== 'passed')
    ) {
      report.status = 'failed';
      report.error = 'One or more isolated lifecycle cases failed.';
      const failedCase = report.cases.find((row) => row.status !== 'passed');
      report.failedPhase = failedCase?.failedPhase || failedCase?.phase || null;
    } else {
      report.applicationCommitAtEnd = execFileSync(
        'git',
        ['-C', scriptRoot, 'rev-parse', 'HEAD'],
        { encoding: 'utf8' },
      ).trim();
      report.applicationSourceCleanAtEnd =
        execFileSync(
          'git',
          [
            '-C',
            scriptRoot,
            'status',
            '--porcelain',
            '--',
            'src',
            'public',
            'build/vite.js',
            'index.html',
            'package.json',
            'package-lock.json',
            'vite.config.js',
          ],
          { encoding: 'utf8' },
        ).trim() === '';
      report.sourceChangedDuringRun =
        report.applicationCommitAtEnd !== expectedCommit ||
        report.applicationSourceCleanAtEnd !== true;
      if (report.sourceChangedDuringRun)
        throw new Error(
          'Application source identity changed during lifecycle run.',
        );
      validateLifecycleCandidate(report, {
        expectedCommit,
        expectedImportFixtureSha256: fixture.sha256,
        expectedWorkspaceFixtureSha256: workspaceFixtureSha256,
      });
      report.validationStatus = 'passed';
    }
  } catch (error) {
    report.status = 'failed';
    report.error = boundedText(error);
    report.failedPhase = report.phase;
  } finally {
    if (ownsBrowser && browser) {
      browserCloseStarted = true;
      emitProgress('close-owned-browser', caseId);
      try {
        report.browserClose = await closeRecoveryBrowser(browser, {
          timeoutMs: BROWSER_CLOSE_TIMEOUT_MS,
          forceProcess: () => stopOwnedRecoveryProcessTree(browser.process()),
        });
        if (!report.browserClose.closeCompleted) {
          report.status = 'failed';
          report.browserCloseError =
            report.browserClose.observation?.closeStatus ||
            'Owned browser did not close cleanly.';
          report.error ||= report.browserCloseError;
        }
        if (
          report.browserClose.forcedProcessTermination ||
          report.browserClose.observation?.forceProcessStatus ===
            'unconfirmed' ||
          report.browserClose.observation?.forceProcessStatus === 'timed-out'
        ) {
          report.status = 'failed';
          report.error ||= 'Owned browser required process-tree cleanup.';
        }
      } catch (error) {
        report.status = 'failed';
        report.browserCloseError = boundedText(error);
        report.error ||= report.browserCloseError;
      }
    }
    if (ownsBrowser && !browser && !browserCloseStarted)
      report.browserClose = {
        status: browserLaunchAttempted ? 'launch-failed' : 'not-launched',
        confirmed: null,
      };
    report.elapsedMs = Math.max(0, performance.now() - report._startedAt);
    finalizeLifecycleReportStatus(report, { ownsBrowser });
    emitProgress(report.status === 'passed' ? 'complete' : 'failed', caseId);
  }
  return report;
}

export async function writeLifecycleReport(filename, report) {
  if (!filename) return;
  await mkdir(path.dirname(path.resolve(filename)), { recursive: true });
  await writeFile(filename, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
}

export function writeLifecycleReportSync(filename, report) {
  if (!filename) return;
  const absolute = path.resolve(filename);
  mkdirSync(path.dirname(absolute), { recursive: true });
  writeFileSync(absolute, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
}

const invoked = process.argv[1]
  ? pathToFileURL(path.resolve(process.argv[1])).href
  : '';
if (import.meta.url === invoked) {
  let options;
  let report;
  try {
    options = parseImportWorkspaceLifecycleArgs(process.argv.slice(2));
    const commit =
      options.expectedCommit ||
      execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    const url = new URL(options.url);
    if (url.username || url.password || url.search || url.hash)
      throw new TypeError(
        '--url cannot contain credentials, query, or fragment.',
      );
    report = await runImportWorkspaceLifecycle({
      ...options,
      url: url.origin,
      expectedCommit: commit,
      onProgress: (current) => {
        report = current;
        writeLifecycleReportSync(options?.out, current);
      },
    });
  } catch (error) {
    report = {
      schema: 'gev-import-workspace-lifecycle/v2',
      status: 'failed',
      error: boundedText(error),
      cases: [],
    };
  }
  await writeLifecycleReport(options?.out, report).catch((error) => {
    report.status = 'failed';
    report.reportWriteError = boundedText(error);
  });
  console.log(JSON.stringify(report, null, 2));
  if (report.status !== 'passed') process.exitCode = 1;
}
