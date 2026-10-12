import { createFixtureInterceptionErrorRecorder } from './fixtureInterception.mjs';

const STATE_KEY = '__gevRecoveryEarlyRendererProbe';
const CLEANUP_PROOF_KEY = '__gevRecoveryEarlyRendererProbeCleanupProof';

/** Install an opt-in, one-shot hook on Cesium's real widget canvas only. */
export async function installEarlyCesiumRendererProbe(page) {
  const handle = await page.evaluateOnNewDocument((proofKey) => {
    const key = '__gevRecoveryEarlyRendererProbe';
    delete window[proofKey];
    const prototype = HTMLCanvasElement.prototype;
    const descriptor = Object.getOwnPropertyDescriptor(prototype, 'getContext');
    const nativeGetContext = descriptor?.value;
    if (typeof nativeGetContext !== 'function') {
      window[key] = { error: 'native getContext unavailable' };
      return;
    }

    const state = (window[key] = {
      captured: false,
      contextLost: false,
      contextRestored: false,
      renderer: null,
      vendor: null,
      contextAttributes: null,
      parameterQueryCount: 0,
      queryDurationMs: null,
      error: null,
      nativeGetContext,
      canvas: null,
      context: null,
      listeners: [],
    });
    let active = true;
    function restore() {
      if (!active) return;
      active = false;
      Object.defineProperty(prototype, 'getContext', descriptor);
    }
    state.restore = restore;
    Object.defineProperty(prototype, 'getContext', {
      ...descriptor,
      value: function (...args) {
        const context = Reflect.apply(nativeGetContext, this, args);
        if (
          active &&
          context &&
          this instanceof HTMLCanvasElement &&
          this.closest('.cesium-widget') &&
          /^(webgl2?|experimental-webgl)$/i.test(String(args[0]))
        ) {
          restore();
          state.captured = true;
          state.canvas = this;
          state.context = context;
          const onLost = (event) => {
            state.contextLost = true;
          };
          const onRestored = () => {
            state.contextRestored = true;
          };
          try {
            state.listeners.push(['webglcontextlost', onLost]);
            this.addEventListener('webglcontextlost', onLost);
            state.listeners.push(['webglcontextrestored', onRestored]);
            this.addEventListener('webglcontextrestored', onRestored);
          } catch (error) {
            state.error = String(error?.message || error).slice(0, 240);
          }
          try {
            const started = performance.now();
            const attributes = context.getContextAttributes?.();
            if (!attributes)
              throw new Error('WebGL context attributes unavailable');
            state.contextAttributes = Object.fromEntries(
              [
                'alpha',
                'antialias',
                'depth',
                'failIfMajorPerformanceCaveat',
                'powerPreference',
                'premultipliedAlpha',
                'preserveDrawingBuffer',
                'stencil',
                'desynchronized',
              ]
                .filter((key) => key in attributes)
                .map((key) => [key, attributes[key]]),
            );
            const extension = context.getExtension('WEBGL_debug_renderer_info');
            state.renderer = context.getParameter(
              extension?.UNMASKED_RENDERER_WEBGL || context.RENDERER,
            );
            state.parameterQueryCount += 1;
            state.vendor = context.getParameter(
              extension?.UNMASKED_VENDOR_WEBGL || context.VENDOR,
            );
            state.parameterQueryCount += 1;
            state.queryDurationMs = performance.now() - started;
          } catch (error) {
            state.error = String(error?.message || error).slice(0, 240);
          }
        }
        return context;
      },
    });
  }, CLEANUP_PROOF_KEY);
  const identifier = handle?.identifier || null;
  if (identifier) scriptRemovalEntries(page).delete(identifier);
  return identifier;
}

/** Verify early evidence against Cesium's live scene without querying GL again. */
export async function readEarlyCesiumRendererProbe(page, timeoutMs = 5_000) {
  let timer;
  try {
    return await Promise.race([
      page.evaluate((key) => {
        const state = window[key];
        const scene = window.__godsEyeView?.viewer?.scene;
        if (!state?.captured || !state.canvas || !state.context)
          throw new Error('early renderer context was not captured');
        if (state.error)
          throw new Error('early renderer query failed: ' + state.error);
        if (state.contextLost || state.contextRestored)
          throw new Error('early renderer context was lost or restored');
        if (state.context?.isContextLost?.() === true)
          throw new Error('early renderer context is currently lost');
        if (state.canvas !== scene?.canvas)
          throw new Error('early renderer canvas does not match Cesium scene');
        const cesiumContext = scene?.context;
        const original = cesiumContext?._originalGLContext;
        if (!original)
          throw new Error('Cesium original WebGL context identity unavailable');
        if (state.context !== original)
          throw new Error('early renderer context does not match Cesium scene');
        if (
          !Number.isFinite(state.queryDurationMs) ||
          state.queryDurationMs < 0
        )
          throw new Error('early renderer query duration is invalid');
        if (
          !state.contextAttributes ||
          typeof state.contextAttributes.antialias !== 'boolean' ||
          typeof state.renderer !== 'string' ||
          !state.renderer.trim() ||
          !Number.isSafeInteger(state.parameterQueryCount) ||
          state.parameterQueryCount !== 2
        )
          throw new Error('early renderer context evidence is incomplete');
        return {
          renderer: String(state.renderer || ''),
          vendor:
            typeof state.vendor === 'string' && state.vendor
              ? state.vendor
              : null,
          contextAttributes: { ...state.contextAttributes },
          parameterQueryCount: state.parameterQueryCount,
          queryDurationMs: state.queryDurationMs,
          canvasMatchesScene: true,
          contextMatchesScene: true,
          contextLost: state.contextLost,
          contextRestored: state.contextRestored,
        };
      }, STATE_KEY),
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error('early renderer verification timed out')),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

const SCRIPT_REMOVALS = new WeakMap();

function cleanupStage(status = 'pending') {
  return {
    status,
    elapsedMs: null,
    pageExecutionElapsedMs: null,
    errorKind: null,
    errorDetail: null,
    lateCompletion: null,
    lateHostReceiptElapsedMs: null,
    lateHostReceiptScope:
      'host stage start to acknowledgement receipt; includes page execution, protocol delivery, and host scheduling',
    lateOutcome: null,
    lateErrorKind: null,
    lateErrorDetail: null,
  };
}

const LATE_DOCUMENT_STATUSES = new Set([
  'confirmed',
  'already-confirmed',
  'unavailable',
  'error',
]);
const LATE_DOCUMENT_ERROR_KINDS = new Set([
  'cleanup-state-not-found',
  'hook-restore-unconfirmed',
  'listener-removal-unconfirmed',
  'cleanup-state-delete-unconfirmed',
]);
const RENDER_LOOP_RETIREMENT_STATUSES = new Set([
  'confirmed',
  'already-disabled',
  'not-applicable-no-viewer',
  'not-applicable-page-closed',
  'viewer-render-loop-unavailable',
  'viewer-render-loop-not-disabled',
  'viewer-render-loop-set-failed',
  'not-attempted',
]);

function boundedLateDocumentOutcome(value) {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    !LATE_DOCUMENT_STATUSES.has(value.status)
  )
    return null;
  const booleanOrNull = (field) =>
    typeof value[field] === 'boolean' ? value[field] : null;
  const boundedCount = (field) =>
    Number.isSafeInteger(value[field]) &&
    value[field] >= 0 &&
    value[field] <= 64
      ? value[field]
      : null;
  const elapsed = value.pageExecutionElapsedMs;
  if (!Number.isFinite(elapsed) || elapsed < 0 || elapsed > 60_000) return null;
  let renderLoopRetirement = null;
  if (
    typeof value.renderLoopRetirement !== 'undefined' &&
    value.renderLoopRetirement !== null
  ) {
    const retirement = value.renderLoopRetirement;
    if (
      !retirement ||
      typeof retirement !== 'object' ||
      Array.isArray(retirement) ||
      retirement.requested !== true ||
      !RENDER_LOOP_RETIREMENT_STATUSES.has(retirement.status) ||
      ![null, true, false].includes(retirement.before) ||
      ![null, true, false].includes(retirement.after) ||
      typeof retirement.confirmed !== 'boolean' ||
      !Number.isFinite(retirement.pageExecutionElapsedMs) ||
      retirement.pageExecutionElapsedMs < 0 ||
      retirement.pageExecutionElapsedMs > 60_000
    )
      return null;
    renderLoopRetirement = {
      requested: true,
      status: retirement.status,
      before: retirement.before,
      after: retirement.after,
      confirmed: retirement.confirmed,
      pageExecutionElapsedMs: retirement.pageExecutionElapsedMs,
    };
  }
  return {
    status: value.status,
    pageExecutionElapsedMs: elapsed,
    statePresent: booleanOrNull('statePresent'),
    hookRestoreAttempted: booleanOrNull('hookRestoreAttempted'),
    hookRestored: booleanOrNull('hookRestored'),
    listenerCount: boundedCount('listenerCount'),
    listenerRemovalAttemptedCount: boundedCount(
      'listenerRemovalAttemptedCount',
    ),
    listenerRemovalConfirmedCount: boundedCount(
      'listenerRemovalConfirmedCount',
    ),
    listenerRemovalFailedCount: boundedCount('listenerRemovalFailedCount'),
    stateDeleted: booleanOrNull('stateDeleted'),
    renderLoopRetirement,
    errorKind: LATE_DOCUMENT_ERROR_KINDS.has(value.errorKind)
      ? value.errorKind
      : null,
  };
}

function scriptRemovalEntries(page) {
  let entries = SCRIPT_REMOVALS.get(page);
  if (!entries) {
    entries = new Map();
    SCRIPT_REMOVALS.set(page, entries);
  }
  return entries;
}

/** Remove only the future-document hook, leaving this document's observer live. */
export async function removeEarlyCesiumRendererProbeRegistrationWithEvidence(
  page,
  scriptIdentifier,
  timeoutMs = 1_000,
) {
  const startedAt = performance.now();
  const evidence = {
    schema: 'gev-early-renderer-registration-removal/v1',
    confirmed: false,
    timeoutMs: Number.isFinite(timeoutMs) ? Math.max(0, timeoutMs) : null,
    elapsedMs: 0,
    currentDocumentUntouched: true,
    scriptRegistration: {
      ...cleanupStage(scriptIdentifier ? 'pending' : 'not-registered'),
      verification: scriptIdentifier
        ? 'puppeteer-registration-removal-acknowledged; per-frame-removal-not-observable'
        : null,
    },
  };
  const stage = evidence.scriptRegistration;
  if (!scriptIdentifier) {
    evidence.confirmed = true;
    return evidence;
  }
  if (!page || (typeof page !== 'object' && typeof page !== 'function')) {
    stage.status = 'unavailable';
    stage.errorKind = 'page-api-unavailable';
    evidence.elapsedMs = Math.max(0, performance.now() - startedAt);
    return evidence;
  }

  const entries = scriptRemovalEntries(page);
  let entry = entries.get(scriptIdentifier);
  let newAttempt = false;
  if (!entry) {
    if (typeof page.removeScriptToEvaluateOnNewDocument !== 'function') {
      stage.status = 'unavailable';
      stage.errorKind = 'page-api-unavailable';
      evidence.elapsedMs = Math.max(0, performance.now() - startedAt);
      return evidence;
    }
    newAttempt = true;
    entry = { status: 'pending', errorKind: null, errorDetail: null };
    entries.set(scriptIdentifier, entry);
    entry.promise = Promise.resolve()
      .then(() => page.removeScriptToEvaluateOnNewDocument(scriptIdentifier))
      .then(
        () => {
          entry.status = 'confirmed';
          return { status: 'confirmed' };
        },
        (error) => {
          entry.status = 'error';
          entry.errorKind = safeCleanupErrorKind(error, true);
          entry.errorDetail = safeCleanupErrorDetail(error);
          return {
            status: 'error',
            errorKind: entry.errorKind,
            errorDetail: entry.errorDetail,
          };
        },
      );
  }

  if (entry.status === 'confirmed') {
    stage.status = newAttempt ? 'confirmed' : 'already-confirmed';
    evidence.confirmed = true;
  } else if (entry.status === 'error') {
    stage.status = 'error';
    stage.errorKind = entry.errorKind;
    stage.errorDetail = entry.errorDetail;
  } else {
    const boundedMs =
      Number.isFinite(timeoutMs) && timeoutMs >= 0 ? timeoutMs : 0;
    let timer;
    let timedOut = false;
    const completion = entry.promise.then((result) => {
      if (timedOut) {
        stage.lateCompletion = result.status;
        if (result.status !== 'confirmed') {
          stage.lateErrorKind =
            result.errorKind || 'registration-removal-error';
          stage.lateErrorDetail = result.errorDetail || null;
        }
      }
      return result;
    });
    const result = await Promise.race([
      completion,
      new Promise((resolve) => {
        timer = setTimeout(() => resolve({ status: 'timeout' }), boundedMs);
      }),
    ]);
    clearTimeout(timer);
    if (result.status === 'timeout') {
      timedOut = true;
      stage.status = 'timeout';
      stage.errorKind = 'operation-timeout';
      stage.lateCompletion = 'pending';
    } else {
      stage.status =
        result.status === 'confirmed' && !newAttempt
          ? 'already-confirmed'
          : result.status;
      stage.errorKind = result.errorKind || null;
      stage.errorDetail = result.errorDetail || null;
      evidence.confirmed = result.status === 'confirmed';
    }
  }
  stage.elapsedMs = Math.max(0, performance.now() - startedAt);
  evidence.elapsedMs = stage.elapsedMs;
  return evidence;
}

/**
 * Remove the document hook/listeners and target registration as separately
 * bounded operations. It preserves the original document-then-registration
 * order and total timeout. Returned records contain no target URLs or raw
 * protocol error strings.
 */
export async function cleanupEarlyCesiumRendererProbeWithEvidence(
  page,
  scriptIdentifier,
  timeoutMs = 1_000,
  { retireViewerRenderLoop = false } = {},
) {
  const startedAt = performance.now();
  const evidence = {
    schema: 'gev-early-renderer-probe-cleanup/v1',
    confirmed: false,
    timeoutMs: Number.isFinite(timeoutMs) ? Math.max(0, timeoutMs) : null,
    elapsedMs: 0,
    document: {
      ...cleanupStage('not-attempted'),
      statePresent: null,
      hookRestoreAttempted: false,
      hookRestored: null,
      listenerCount: null,
      listenerRemovalAttemptedCount: 0,
      listenerRemovalConfirmedCount: 0,
      listenerRemovalFailedCount: 0,
      stateDeleted: null,
      renderLoopRetirement: retireViewerRenderLoop
        ? {
            requested: true,
            status: 'not-attempted',
            before: null,
            after: null,
            confirmed: false,
            pageExecutionElapsedMs: null,
          }
        : null,
    },
    scriptRegistration: {
      ...cleanupStage(scriptIdentifier ? 'not-attempted' : 'not-registered'),
      verification: scriptIdentifier
        ? 'puppeteer-registration-removal-acknowledged; per-frame-removal-not-observable'
        : null,
    },
  };
  const boundedMs =
    Number.isFinite(timeoutMs) && timeoutMs >= 0 ? timeoutMs : 0;
  const remaining = () =>
    Math.max(0, boundedMs - (performance.now() - startedAt));
  const runStage = async (stage, operation, onConfirmed = () => {}) => {
    const operationStartedAt = performance.now();
    let timedOut = false;
    let operationRejected = false;
    let timer;
    const task = Promise.resolve()
      .then(operation)
      .then((result) => {
        const status = result?.status || 'confirmed';
        if (status === 'confirmed' || status === 'already-confirmed')
          onConfirmed(result);
        if (timedOut) {
          stage.lateCompletion = status;
          stage.lateHostReceiptElapsedMs = Math.max(
            0,
            performance.now() - operationStartedAt,
          );
          if (stage === evidence.document) {
            stage.lateOutcome = boundedLateDocumentOutcome(result);
            if (!stage.lateOutcome) {
              stage.lateCompletion = 'invalid-result';
              stage.lateErrorKind = 'invalid-late-document-result';
            } else if (
              !['confirmed', 'already-confirmed'].includes(
                stage.lateOutcome.status,
              )
            ) {
              stage.lateErrorKind =
                stage.lateOutcome.errorKind || 'cleanup-incomplete';
            }
          } else if (Number.isFinite(result?.pageExecutionElapsedMs)) {
            stage.pageExecutionElapsedMs = result.pageExecutionElapsedMs;
            if (!['confirmed', 'already-confirmed'].includes(status))
              stage.lateErrorKind = result?.errorKind || 'cleanup-incomplete';
          } else if (stage !== evidence.document) {
            if (!['confirmed', 'already-confirmed'].includes(status))
              stage.lateErrorKind = result?.errorKind || 'cleanup-incomplete';
          }
          if (stage === evidence.document) stage.lateErrorDetail = null;
          else if (stage.lateErrorKind)
            stage.lateErrorDetail = result?.errorDetail || null;
          return result;
        }
        stage.status = status;
        for (const [key, value] of Object.entries(result || {}))
          if (key !== 'status' && key in stage) stage[key] = value;
        stage.elapsedMs = Math.max(0, performance.now() - operationStartedAt);
        return result;
      })
      .catch((error) => {
        operationRejected = true;
        if (timedOut) {
          stage.lateCompletion = 'error';
          stage.lateHostReceiptElapsedMs = Math.max(
            0,
            performance.now() - operationStartedAt,
          );
          stage.lateErrorKind = safeCleanupErrorKind(
            error,
            stage === evidence.scriptRegistration,
          );
          stage.lateErrorDetail = safeCleanupErrorDetail(error);
          return null;
        }
        stage.status = 'error';
        stage.errorKind = safeCleanupErrorKind(
          error,
          stage === evidence.scriptRegistration,
        );
        stage.errorDetail = safeCleanupErrorDetail(error);
        stage.elapsedMs = Math.max(0, performance.now() - operationStartedAt);
        return null;
      });
    const outcome = await Promise.race([
      task.then((value) => ({ kind: 'settled', value })),
      new Promise((resolve) => {
        timer = setTimeout(() => resolve({ kind: 'timeout' }), remaining());
      }),
    ]);
    clearTimeout(timer);
    if (outcome.kind === 'timeout') {
      timedOut = true;
      stage.status = 'timeout';
      stage.errorKind = 'operation-timeout';
      stage.lateCompletion = 'pending';
      stage.elapsedMs = Math.max(0, performance.now() - operationStartedAt);
      return { settled: false, result: null };
    }
    return {
      settled: !operationRejected,
      result: outcome.value,
    };
  };

  let pageClosed = false;
  let documentOperationSettled = true;
  try {
    pageClosed = page?.isClosed?.() === true;
  } catch (error) {
    evidence.document.status = 'error';
    evidence.document.errorKind = 'page-state-error';
    evidence.document.errorDetail = safeCleanupErrorDetail(error);
  }
  if (pageClosed) {
    evidence.document.status = 'page-closed';
    evidence.document.hookRestored = null;
    evidence.document.stateDeleted = null;
    if (retireViewerRenderLoop)
      evidence.document.renderLoopRetirement = {
        requested: true,
        status: 'not-applicable-page-closed',
        before: null,
        after: null,
        confirmed: true,
        pageExecutionElapsedMs: 0,
      };
  } else if (page && typeof page.evaluate === 'function') {
    evidence.document.status = 'pending';
    const documentResult = await runStage(evidence.document, () =>
      page.evaluate(
        (key, proofKey, shouldRetireViewerRenderLoop) => {
          const pageExecutionStartedAt = performance.now();
          const renderLoopRetirement = shouldRetireViewerRenderLoop
            ? {
                requested: true,
                status: 'not-attempted',
                before: null,
                after: null,
                confirmed: false,
                pageExecutionElapsedMs: null,
              }
            : null;
          if (renderLoopRetirement) {
            const retirementStartedAt = performance.now();
            try {
              const viewer = window.__godsEyeView?.viewer;
              if (!viewer) {
                renderLoopRetirement.status = 'not-applicable-no-viewer';
                renderLoopRetirement.confirmed = true;
              } else if (typeof viewer.useDefaultRenderLoop !== 'boolean') {
                renderLoopRetirement.status = 'viewer-render-loop-unavailable';
              } else {
                renderLoopRetirement.before = viewer.useDefaultRenderLoop;
                if (renderLoopRetirement.before)
                  viewer.useDefaultRenderLoop = false;
                renderLoopRetirement.after = viewer.useDefaultRenderLoop;
                renderLoopRetirement.confirmed =
                  renderLoopRetirement.after === false;
                renderLoopRetirement.status = renderLoopRetirement.confirmed
                  ? renderLoopRetirement.before
                    ? 'confirmed'
                    : 'already-disabled'
                  : 'viewer-render-loop-not-disabled';
              }
            } catch {
              renderLoopRetirement.status = 'viewer-render-loop-set-failed';
            }
            renderLoopRetirement.pageExecutionElapsedMs = Math.max(
              0,
              performance.now() - retirementStartedAt,
            );
          }
          const finish = (record) => {
            record.pageExecutionElapsedMs = Math.max(
              0,
              performance.now() - pageExecutionStartedAt,
            );
            return record;
          };
          const state = window[key];
          const proof = window[proofKey];
          const prototype = HTMLCanvasElement.prototype;
          const record = {
            status: 'error',
            statePresent: Boolean(state),
            hookRestoreAttempted: false,
            hookRestored: false,
            listenerCount: Array.isArray(state?.listeners)
              ? state.listeners.length
              : 0,
            listenerRemovalAttemptedCount: 0,
            listenerRemovalConfirmedCount: 0,
            listenerRemovalFailedCount: 0,
            stateDeleted: false,
            renderLoopRetirement,
          };
          if (!state) {
            const proofMatches =
              proof &&
              Number.isFinite(proof.documentTimeOrigin) &&
              proof.documentTimeOrigin === performance.timeOrigin &&
              typeof proof.nativeGetContext === 'function' &&
              Object.getOwnPropertyDescriptor(prototype, 'getContext')
                ?.value === proof.nativeGetContext;
            record.status = proofMatches ? 'already-confirmed' : 'unavailable';
            record.errorKind = proofMatches ? null : 'cleanup-state-not-found';
            record.hookRestored = Boolean(proofMatches);
            record.stateDeleted = true;
            return finish(record);
          }
          delete window[proofKey];
          record.hookRestoreAttempted = true;
          try {
            state.restore?.();
          } catch {
            // Keep attempting listener removal and verify the hook separately.
          }
          record.hookRestored =
            typeof state.nativeGetContext === 'function' &&
            Object.getOwnPropertyDescriptor(prototype, 'getContext')?.value ===
              state.nativeGetContext;

          const remainingListeners = [];
          for (const entry of Array.isArray(state.listeners)
            ? state.listeners
            : []) {
            const [event, listener] = Array.isArray(entry) ? entry : [];
            record.listenerRemovalAttemptedCount += 1;
            try {
              if (
                typeof event !== 'string' ||
                typeof listener !== 'function' ||
                !state.canvas ||
                typeof state.canvas.removeEventListener !== 'function'
              )
                throw new Error('listener removal unavailable');
              state.canvas.removeEventListener(event, listener);
              record.listenerRemovalConfirmedCount += 1;
            } catch {
              record.listenerRemovalFailedCount += 1;
              remainingListeners.push(entry);
            }
          }
          state.listeners = remainingListeners;
          const complete =
            record.hookRestored &&
            record.listenerRemovalFailedCount === 0 &&
            remainingListeners.length === 0;
          if (!complete)
            record.errorKind = !record.hookRestored
              ? 'hook-restore-unconfirmed'
              : 'listener-removal-unconfirmed';
          if (complete) {
            record.status = 'confirmed';
            delete window[key];
            record.stateDeleted = !(key in window);
            if (!record.stateDeleted) {
              record.status = 'error';
              record.errorKind = 'cleanup-state-delete-unconfirmed';
            } else
              window[proofKey] = {
                nativeGetContext: state.nativeGetContext,
                documentTimeOrigin: performance.timeOrigin,
              };
          }
          return finish(record);
        },
        STATE_KEY,
        CLEANUP_PROOF_KEY,
        retireViewerRenderLoop,
      ),
    );
    documentOperationSettled = documentResult.settled;
    if (!documentResult.settled) {
      evidence.scriptRegistration.status = scriptIdentifier
        ? 'not-attempted'
        : 'not-registered';
      evidence.scriptRegistration.errorKind = scriptIdentifier
        ? 'document-stage-did-not-settle'
        : null;
    }
  } else {
    evidence.document.status = 'unavailable';
    evidence.document.errorKind = 'page-api-unavailable';
    documentOperationSettled = false;
  }

  if (scriptIdentifier && documentOperationSettled) {
    const registrationEvidence =
      await removeEarlyCesiumRendererProbeRegistrationWithEvidence(
        page,
        scriptIdentifier,
        remaining(),
      );
    evidence.scriptRegistration = registrationEvidence.scriptRegistration;
  } else if (
    scriptIdentifier &&
    evidence.scriptRegistration.status === 'not-attempted'
  ) {
    // Preserve document-stage failure attribution; registration removal was
    // not reached under the original sequential cleanup order.
  } else if (!scriptIdentifier) {
    evidence.scriptRegistration.status = 'not-registered';
  }
  evidence.elapsedMs = Math.max(0, performance.now() - startedAt);
  evidence.confirmed =
    ['confirmed', 'page-closed', 'already-confirmed'].includes(
      evidence.document.status,
    ) &&
    ['confirmed', 'not-registered', 'already-confirmed'].includes(
      evidence.scriptRegistration.status,
    ) &&
    (!retireViewerRenderLoop ||
      evidence.document.renderLoopRetirement?.confirmed === true);
  return evidence;
}

function safeCleanupErrorKind(error, isScriptRegistration = false) {
  if (error?.name === 'TimeoutError') return 'operation-timeout';
  if (error?.name === 'TargetClosedError' || error?.name === 'PageClosedError')
    return 'target-closed';
  const message = String(error?.message || error || '');
  if (isScriptRegistration && /unknown|not found|identifier/i.test(message))
    return 'unknown-script-registration';
  return isScriptRegistration
    ? 'registration-removal-error'
    : 'page-evaluation-error';
}

function safeCleanupErrorDetail(error) {
  const recorder = createFixtureInterceptionErrorRecorder({ limit: 1 });
  recorder.onError(error);
  return recorder.records[0]?.message || 'Cleanup operation failed.';
}

/** Legacy boolean API retained for recovery callers. */
export async function cleanupEarlyCesiumRendererProbe(
  page,
  scriptIdentifier,
  timeoutMs = 1_000,
) {
  const evidence = await cleanupEarlyCesiumRendererProbeWithEvidence(
    page,
    scriptIdentifier,
    timeoutMs,
  );
  return evidence.confirmed;
}
