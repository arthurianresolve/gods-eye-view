import { randomUUID } from 'node:crypto';

const MAX_PROGRESS_EVENTS = 8;
const CLEANUP_TIMEOUT_MS = 250;
const VALID_STAGES = new Set([
  'page-entry',
  'listener-registered',
  'render-request-started',
  'render-request-completed',
  'post-render',
  'page-timer-fired',
  'terminal',
  'cleanup',
]);
const VALID_PROGRESS_FIELDS = new Set([
  'warmupBoundaryObservation',
  'measurementBoundaryObservation',
]);

export function createBoundaryProgressRecorder(record, field) {
  if (
    !record ||
    typeof record !== 'object' ||
    !VALID_PROGRESS_FIELDS.has(field)
  )
    throw new TypeError('Render boundary progress owner is invalid.');
  return (observation) => {
    record[field] = structuredClone(observation);
  };
}

function boundedError(error) {
  return {
    name: String(error?.name || 'Error').slice(0, 80),
    message: String(error?.message || error || 'Render boundary failed').slice(
      0,
      240,
    ),
  };
}

function boundedProgressDetails(details) {
  if (!details || typeof details !== 'object' || Array.isArray(details))
    return null;
  const bounded = {};
  for (const key of [
    'pageElapsedMs',
    'listenerRegistered',
    'renderRequestAvailable',
    'renderRequestStarted',
    'renderRequestCompleted',
    'postRenderObserved',
    'pageTimerFired',
  ]) {
    if (!Object.hasOwn(details, key)) continue;
    const value = details[key];
    if (key === 'pageElapsedMs') {
      if (
        typeof value === 'number' &&
        Number.isFinite(value) &&
        value >= 0 &&
        value <= 30_000
      )
        bounded[key] = value;
      else return null;
    } else if (typeof value === 'boolean') bounded[key] = value;
    else return null;
  }
  if (typeof details.errorName === 'string')
    bounded.errorName = details.errorName.slice(0, 80);
  return bounded;
}

function publish(onProgress, observation) {
  try {
    onProgress?.(structuredClone(observation));
  } catch {
    // Diagnostics must never replace the original render-boundary outcome.
  }
}

async function disposeBinding(binding, observation, now) {
  if (!binding || typeof binding.dispose !== 'function') {
    observation.cleanup.progressBindingRemoved = binding === null;
    return;
  }
  const cleanupStartedAt = now();
  let timer;
  try {
    const outcome = await Promise.race([
      Promise.resolve()
        .then(() => binding.dispose())
        .then(
          () => ({ kind: 'disposed' }),
          (error) => ({ kind: 'error', error }),
        ),
      new Promise((resolve) => {
        timer = setTimeout(
          () => resolve({ kind: 'timeout' }),
          CLEANUP_TIMEOUT_MS,
        );
      }),
    ]);
    observation.cleanup.progressBindingRemoved = outcome.kind === 'disposed';
    if (outcome.kind === 'error')
      observation.cleanup.progressBindingError = boundedError(outcome.error);
    if (outcome.kind === 'timeout')
      observation.cleanup.progressBindingError = {
        name: 'TimeoutError',
        message:
          'Progress binding cleanup exceeded its bounded cleanup window.',
      };
  } catch (error) {
    observation.cleanup.progressBindingRemoved = false;
    observation.cleanup.progressBindingError = boundedError(error);
  } finally {
    clearTimeout(timer);
    observation.cleanup.progressBindingCleanupElapsedMs = Math.max(
      0,
      now() - cleanupStartedAt,
    );
  }
}

/**
 * Observe one page-side completed-render probe without changing its deadline.
 * A temporary exposed binding provides host-receipt timestamps for page phases;
 * those timestamps share the host clock and are not inferred from page clocks.
 */
export async function observeRenderBoundary({
  evaluate,
  prepareProgress,
  label,
  timeoutMs = 5000,
  hostGraceMs = 1000,
  now = () => globalThis.performance?.now?.() ?? Date.now(),
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  onProgress,
}) {
  if (
    typeof evaluate !== 'function' ||
    typeof label !== 'string' ||
    !label ||
    !Number.isFinite(timeoutMs) ||
    timeoutMs <= 0 ||
    !Number.isFinite(hostGraceMs) ||
    hostGraceMs < 0 ||
    (prepareProgress !== undefined && typeof prepareProgress !== 'function')
  )
    throw new TypeError('Render boundary observer arguments are invalid.');

  const startedAt = now();
  const invocationId = randomUUID();
  const observation = {
    schema: 'gev-render-boundary-observation/v1',
    invocationId,
    label: label.slice(0, 80),
    status: prepareProgress ? 'host-binding-setup' : 'host-dispatch',
    hostTimeoutMs: timeoutMs + hostGraceMs,
    hostElapsedMs: 0,
    hostDispatchElapsedMs: 0,
    hostProgressBindingSetupElapsedMs: null,
    pageEntryObserved: false,
    pageEntryHostReceiptElapsedMs: null,
    progressEvents: [],
    ignoredProgressEvents: { wrongInvocation: 0, malformed: 0, overflow: 0 },
    hostEvaluationOverheadResidualMs: null,
    page: null,
    pageError: null,
    hostError: null,
    pendingPageResultAtDeadline: false,
    latePageResultObserved: false,
    cleanup: {
      hostTimerCleared: false,
      progressBindingRemoved: prepareProgress ? null : true,
      progressBindingCleanupElapsedMs: null,
    },
  };
  publish(onProgress, observation);

  let hostTimedOut = false;
  let timer;
  let activeBinding = null;
  let preparePromise = null;
  let pageStarted = false;
  const hostTimeout = new Promise((resolve) => {
    timer = setTimer(() => {
      hostTimedOut = true;
      observation.status = 'host-observation-deadline';
      observation.hostElapsedMs = Math.max(0, now() - startedAt);
      observation.pendingPageResultAtDeadline = pageStarted;
      observation.hostError = {
        name: 'TimeoutError',
        message: `${observation.label}: host observation deadline elapsed.`,
      };
      publish(onProgress, observation);
      resolve({ kind: 'host-timeout' });
    }, timeoutMs + hostGraceMs);
  });

  const receiveProgress = (receivedInvocationId, stage, details) => {
    const hostReceiptElapsedMs = Math.max(0, now() - startedAt);
    if (receivedInvocationId !== invocationId) {
      observation.ignoredProgressEvents.wrongInvocation = Math.min(
        999,
        observation.ignoredProgressEvents.wrongInvocation + 1,
      );
      publish(onProgress, observation);
      return { accepted: false };
    }
    if (
      typeof stage !== 'string' ||
      !VALID_STAGES.has(stage) ||
      !details ||
      typeof details !== 'object' ||
      Array.isArray(details)
    ) {
      observation.ignoredProgressEvents.malformed = Math.min(
        999,
        observation.ignoredProgressEvents.malformed + 1,
      );
      publish(onProgress, observation);
      return { accepted: false };
    }
    if (observation.progressEvents.length >= MAX_PROGRESS_EVENTS) {
      observation.ignoredProgressEvents.overflow = Math.min(
        999,
        observation.ignoredProgressEvents.overflow + 1,
      );
      publish(onProgress, observation);
      return { accepted: false };
    }
    const boundedDetails = boundedProgressDetails(details);
    if (!boundedDetails) {
      observation.ignoredProgressEvents.malformed = Math.min(
        999,
        observation.ignoredProgressEvents.malformed + 1,
      );
      publish(onProgress, observation);
      return { accepted: false };
    }
    const event = {
      stage,
      hostReceiptElapsedMs,
      afterHostDeadline: hostTimedOut,
      details: boundedDetails,
    };
    observation.progressEvents.push(event);
    if (stage === 'page-entry') {
      observation.pageEntryObserved = true;
      observation.pageEntryHostReceiptElapsedMs = hostReceiptElapsedMs;
    }
    publish(onProgress, observation);
    return { accepted: true };
  };

  const startPageEvaluation = (binding) => {
    activeBinding = binding || null;
    const pageTimeoutMs = timeoutMs;
    let pageResultPromise;
    const dispatchStartedAt = now();
    try {
      pageStarted = true;
      observation.status = 'page-dispatch';
      pageResultPromise = Promise.resolve(
        evaluate(pageTimeoutMs, {
          invocationId,
          progressFunctionName: binding?.functionName ?? null,
        }),
      );
    } catch (error) {
      pageResultPromise = Promise.reject(error);
    }
    observation.hostDispatchElapsedMs = Math.max(0, now() - dispatchStartedAt);
    observation.hostElapsedMs = Math.max(0, now() - startedAt);
    if (!hostTimedOut) observation.status = 'page-pending';
    publish(onProgress, observation);

    return pageResultPromise.then(
      (pageResult) => {
        observation.page =
          pageResult && typeof pageResult === 'object'
            ? structuredClone(pageResult)
            : { status: 'malformed-page-result' };
        observation.hostElapsedMs = Math.max(0, now() - startedAt);
        const pageElapsedMs = observation.page?.diagnostics?.pageElapsedMs;
        const bindingSetupElapsedMs =
          observation.hostProgressBindingSetupElapsedMs ?? 0;
        // This residual includes host dispatch plus queue/transport/serialization;
        // it is not a one-way page-entry measurement.
        observation.hostEvaluationOverheadResidualMs = Number.isFinite(
          pageElapsedMs,
        )
          ? Math.max(
              0,
              observation.hostElapsedMs - bindingSetupElapsedMs - pageElapsedMs,
            )
          : null;
        if (pageResult?.status !== 'settled')
          observation.pageError = boundedError(pageResult?.error);
        observation.latePageResultObserved = hostTimedOut;
        if (!hostTimedOut) observation.status = 'page-result';
        publish(onProgress, observation);
        return { kind: 'page-result', pageResult };
      },
      (error) => {
        observation.pageError = boundedError(error);
        observation.hostElapsedMs = Math.max(0, now() - startedAt);
        observation.latePageResultObserved = hostTimedOut;
        if (!hostTimedOut) observation.status = 'page-evaluation-error';
        publish(onProgress, observation);
        return { kind: 'page-evaluation-error', error };
      },
    );
  };

  try {
    let pageResult;
    if (prepareProgress) {
      const bindingSetupStartedAt = now();
      preparePromise = Promise.resolve()
        .then(() => prepareProgress(receiveProgress, invocationId))
        .then(
          (binding) => ({ kind: 'binding-ready', binding }),
          (error) => ({ kind: 'binding-error', error }),
        );
      const bindingResult = await Promise.race([preparePromise, hostTimeout]);
      if (bindingResult.kind === 'host-timeout') {
        preparePromise.then((late) => {
          if (late.kind === 'binding-ready')
            void disposeBinding(late.binding, observation, now).then(() =>
              publish(onProgress, observation),
            );
        });
        throw Object.assign(new Error(observation.hostError.message), {
          name: observation.hostError.name,
          boundaryObservation: observation,
        });
      }
      if (bindingResult.kind === 'binding-error') throw bindingResult.error;
      if (
        !bindingResult.binding ||
        typeof bindingResult.binding.functionName !== 'string' ||
        !/^__[A-Za-z0-9_]{1,100}$/.test(bindingResult.binding.functionName) ||
        typeof bindingResult.binding.dispose !== 'function'
      ) {
        if (bindingResult.binding?.dispose)
          await disposeBinding(bindingResult.binding, observation, now);
        throw new TypeError('Render boundary progress binding is malformed.');
      }
      observation.hostProgressBindingSetupElapsedMs = Math.max(
        0,
        now() - bindingSetupStartedAt,
      );
      activeBinding = bindingResult.binding;
      pageResult = await Promise.race([
        startPageEvaluation(activeBinding),
        hostTimeout,
      ]);
    } else {
      pageResult = await Promise.race([startPageEvaluation(null), hostTimeout]);
    }

    if (pageResult.kind === 'host-timeout') {
      throw Object.assign(new Error(observation.hostError.message), {
        name: observation.hostError.name,
        boundaryObservation: observation,
      });
    }
    if (pageResult.kind === 'page-evaluation-error') {
      const error = new Error(
        `${observation.label}: page evaluation failed: ${observation.pageError.message}`,
      );
      error.name = observation.pageError.name;
      error.boundaryObservation = observation;
      throw error;
    }
    if (pageResult.pageResult?.status !== 'settled') {
      const pageError = pageResult.pageResult?.error;
      observation.status = 'page-error';
      observation.pageError = boundedError(pageError);
      const error = new Error(
        `${observation.label}: ${String(pageError?.message || 'page render did not settle').slice(0, 240)}`,
      );
      error.name = String(pageError?.name || 'RenderBoundaryError').slice(
        0,
        80,
      );
      error.boundaryObservation = observation;
      throw error;
    }
    observation.status = 'settled';
    observation.settleElapsedMs = Number.isFinite(
      pageResult.pageResult.settleElapsedMs,
    )
      ? pageResult.pageResult.settleElapsedMs
      : null;
    observation.hostElapsedMs = Math.max(0, now() - startedAt);
    publish(onProgress, observation);
    return observation;
  } catch (caught) {
    const error =
      caught instanceof Error
        ? caught
        : new Error(String(caught ?? 'Render boundary observer failed.'));
    observation.hostElapsedMs = Math.max(0, now() - startedAt);
    if (!error.boundaryObservation) {
      observation.status = hostTimedOut
        ? 'host-observation-deadline'
        : 'host-observation-error';
      if (!observation.hostError) observation.hostError = boundedError(error);
      error.boundaryObservation = observation;
      publish(onProgress, observation);
    }
    throw error;
  } finally {
    clearTimer(timer);
    observation.cleanup.hostTimerCleared = true;
    if (activeBinding) await disposeBinding(activeBinding, observation, now);
    publish(onProgress, observation);
  }
}
