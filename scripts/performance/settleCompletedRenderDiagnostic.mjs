/**
 * Browser-serializable render boundary probe. Kept separate from the ordinary
 * fixture waiter so diagnostic observations do not change its failure path.
 */
export function settleCompletedRenderDiagnostic(
  viewerOrTimeout,
  timeoutMs = 5000,
  progressFunctionName = null,
  invocationId = null,
  retireViewerRenderLoop = false,
  finalObservationFunction = null,
  finalObservationArgs = [],
  beforeRenderRequestFunction = null,
  beforeRenderRequestArgs = [],
  postRenderConditionFunction = null,
  postRenderConditionArgs = [],
) {
  const acknowledge = (stage, details) => {
    if (!progressFunctionName || !invocationId) return;
    try {
      const callback = globalThis[progressFunctionName];
      if (typeof callback !== 'function') return;
      Promise.resolve(callback(invocationId, stage, details)).catch(() => {});
    } catch {
      // The host observer may have timed out and removed this invocation.
    }
  };
  acknowledge('page-entry', { pageElapsedMs: 0 });
  const viewer =
    typeof viewerOrTimeout === 'number'
      ? globalThis.__godsEyeView?.viewer
      : viewerOrTimeout;
  if (typeof viewerOrTimeout === 'number') timeoutMs = viewerOrTimeout;
  const invalid =
    !viewer?.scene?.postRender?.addEventListener ||
    !Number.isFinite(timeoutMs) ||
    timeoutMs <= 0;
  const renderRequestAvailable =
    typeof viewer?.scene?.requestRender === 'function';
  if (invalid) {
    acknowledge('terminal', { errorName: 'TypeError' });
    acknowledge('cleanup', {});
    return Promise.resolve({
      status: 'page-error',
      error: {
        name: 'TypeError',
        message: 'A viewer postRender event and positive timeout are required.',
      },
      settleElapsedMs: null,
      diagnostics: {
        phase: 'page-entry',
        pageEntryElapsedMs: 0,
        pageElapsedMs: 0,
        listenerRegistered: false,
        renderRequestAvailable,
        renderRequestStarted: false,
        renderRequestCompleted: false,
        postRenderObserved: false,
        renderLoopRetirement: retireViewerRenderLoop
          ? {
              requested: true,
              status: 'not-attempted',
              before: null,
              after: null,
              confirmed: false,
              elapsedMs: null,
            }
          : null,
        finalObservation: null,
        finalObservationErrorName: null,
        beforeRenderRequestObservation: null,
        beforeRenderRequestErrorName: null,
        postRenderCondition: postRenderConditionFunction
          ? {
              enabled: true,
              observations: 0,
              initialReady: null,
              ready: null,
              readyPostRenderCount: 0,
              followupRenderRequested: false,
              followupRenderRequestStarted: false,
              followupRenderRequestCompleted: false,
              followupRenderRequestErrorName: null,
              acceptedAfterFollowupRender: false,
            }
          : null,
        pageTimerFired: false,
        cleanup: { timerCleared: false, listenerRemoved: false },
      },
    });
  }

  return new Promise((resolve) => {
    let done = false;
    let timer = null;
    let listener = null;
    let removeListener = null;
    const startedAt = globalThis.performance?.now?.();
    const diagnostics = {
      phase: 'page-entry',
      pageEntryElapsedMs: 0,
      pageElapsedMs: 0,
      listenerRegistered: false,
      listenerRegistrationElapsedMs: null,
      renderRequestAvailable,
      renderRequestStarted: false,
      renderRequestStartElapsedMs: null,
      renderRequestCompleted: false,
      renderRequestCompleteElapsedMs: null,
      postRenderObserved: false,
      postRenderElapsedMs: null,
      renderLoopRetirement: retireViewerRenderLoop
        ? {
            requested: true,
            status: 'not-attempted',
            before: null,
            after: null,
            confirmed: false,
            elapsedMs: null,
          }
        : null,
      finalObservation: null,
      finalObservationErrorName: null,
      beforeRenderRequestObservation: null,
      beforeRenderRequestErrorName: null,
      postRenderCondition: postRenderConditionFunction
        ? {
            enabled: true,
            observations: 0,
            initialReady: null,
            ready: null,
            readyPostRenderCount: 0,
            followupRenderRequested: false,
            followupRenderRequestStarted: false,
            followupRenderRequestCompleted: false,
            followupRenderRequestErrorName: null,
            acceptedAfterFollowupRender: false,
          }
        : null,
      pageTimerFired: false,
      pageTimerElapsedMs: null,
      cleanup: { timerCleared: false, listenerRemoved: false },
    };
    const elapsed = () => {
      const current = globalThis.performance?.now?.();
      return Number.isFinite(startedAt) && Number.isFinite(current)
        ? Math.max(0, current - startedAt)
        : null;
    };
    const finish = (error = null) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      diagnostics.cleanup.timerCleared = true;
      try {
        if (typeof removeListener === 'function') {
          removeListener();
          diagnostics.cleanup.listenerRemoved = true;
        } else if (
          listener &&
          typeof viewer.scene.postRender.removeEventListener === 'function'
        ) {
          viewer.scene.postRender.removeEventListener(listener);
          diagnostics.cleanup.listenerRemoved = true;
        } else diagnostics.cleanup.listenerRemoved = !listener;
      } catch {
        diagnostics.cleanup.listenerRemoved = false;
      }
      diagnostics.phase = error ? 'page-error' : 'settled';
      diagnostics.pageElapsedMs = elapsed();
      acknowledge('terminal', {
        pageElapsedMs: diagnostics.pageElapsedMs,
        errorName: error
          ? String(error.name || 'Error').slice(0, 80)
          : undefined,
      });
      acknowledge('cleanup', {
        listenerRegistered: diagnostics.listenerRegistered,
        renderRequestAvailable: diagnostics.renderRequestAvailable,
        renderRequestStarted: diagnostics.renderRequestStarted,
        renderRequestCompleted: diagnostics.renderRequestCompleted,
        postRenderObserved: diagnostics.postRenderObserved,
        pageTimerFired: diagnostics.pageTimerFired,
        pageElapsedMs: diagnostics.pageElapsedMs,
      });
      resolve({
        status: diagnostics.phase,
        settleElapsedMs: diagnostics.pageElapsedMs,
        error: error
          ? {
              name: String(error.name || 'Error').slice(0, 80),
              message: String(error.message || error).slice(0, 240),
            }
          : null,
        diagnostics,
      });
    };
    timer = setTimeout(() => {
      diagnostics.pageTimerFired = true;
      diagnostics.pageTimerElapsedMs = elapsed();
      acknowledge('page-timer-fired', {
        pageTimerFired: true,
        pageElapsedMs: diagnostics.pageTimerElapsedMs,
      });
      finish(
        new Error(
          'Completed render did not settle before the boundary timeout.',
        ),
      );
    }, timeoutMs);
    try {
      listener = () => {
        if (done) return;
        if (typeof postRenderConditionFunction === 'function') {
          let ready;
          try {
            ready = postRenderConditionFunction(
              viewer,
              ...(Array.isArray(postRenderConditionArgs)
                ? postRenderConditionArgs
                : []),
            );
            if (typeof ready !== 'boolean')
              throw new TypeError(
                'Post-render readiness condition must return a boolean.',
              );
          } catch (error) {
            diagnostics.postRenderCondition.ready = null;
            finish(error);
            return;
          }
          const condition = diagnostics.postRenderCondition;
          condition.observations = Math.min(
            Number.MAX_SAFE_INTEGER,
            condition.observations + 1,
          );
          condition.ready = ready;
          if (!ready) {
            condition.followupRenderRequested = false;
            return;
          }
          condition.readyPostRenderCount = Math.min(
            Number.MAX_SAFE_INTEGER,
            condition.readyPostRenderCount + 1,
          );
          if (!condition.followupRenderRequested) {
            if (!renderRequestAvailable) {
              finish(
                new Error(
                  'A subsequent completed render is unavailable while waiting for source readiness.',
                ),
              );
              return;
            }
            condition.followupRenderRequested = true;
            condition.followupRenderRequestStarted = true;
            try {
              viewer.scene.requestRender();
            } catch (error) {
              condition.followupRenderRequestErrorName = String(
                error?.name || 'Error',
              ).slice(0, 80);
              finish(error);
              return;
            }
            condition.followupRenderRequestCompleted = true;
            return;
          } else {
            condition.followupRenderRequested = false;
            condition.acceptedAfterFollowupRender = true;
          }
        }
        diagnostics.postRenderObserved = true;
        diagnostics.postRenderElapsedMs = elapsed();
        acknowledge('post-render', {
          postRenderObserved: true,
          pageElapsedMs: diagnostics.postRenderElapsedMs,
        });
        let finalObservationError = null;
        if (typeof finalObservationFunction === 'function') {
          try {
            diagnostics.finalObservation = finalObservationFunction(
              ...(Array.isArray(finalObservationArgs)
                ? finalObservationArgs
                : []),
            );
          } catch (error) {
            diagnostics.finalObservationErrorName = String(
              error?.name || 'Error',
            ).slice(0, 80);
            finalObservationError = error;
          }
        }
        let retirementError = null;
        if (retireViewerRenderLoop) {
          const retirementStartedAt = elapsed();
          const retirement = diagnostics.renderLoopRetirement;
          try {
            if (typeof viewer.useDefaultRenderLoop !== 'boolean') {
              retirement.status = 'viewer-render-loop-unavailable';
            } else {
              retirement.before = viewer.useDefaultRenderLoop;
              if (retirement.before) viewer.useDefaultRenderLoop = false;
              retirement.after = viewer.useDefaultRenderLoop;
              retirement.confirmed =
                retirement.before === true && retirement.after === false;
              retirement.status = retirement.confirmed
                ? 'retired-at-final-post-render'
                : retirement.before === false
                  ? 'already-disabled-before-final-post-render'
                  : 'viewer-render-loop-not-disabled';
            }
          } catch {
            retirement.status = 'viewer-render-loop-set-failed';
          }
          const retirementCompletedAt = elapsed();
          retirement.elapsedMs =
            Number.isFinite(retirementStartedAt) &&
            Number.isFinite(retirementCompletedAt)
              ? Math.max(0, retirementCompletedAt - retirementStartedAt)
              : null;
          if (!retirement.confirmed)
            retirementError = new Error(
              'Viewer render loop retirement at the final postRender boundary was not confirmed.',
            );
        }
        finish(finalObservationError || retirementError);
      };
      removeListener = viewer.scene.postRender.addEventListener(listener);
      diagnostics.listenerRegistered = true;
      diagnostics.listenerRegistrationElapsedMs = elapsed();
      diagnostics.phase = 'listener-registered';
      acknowledge('listener-registered', {
        listenerRegistered: true,
        pageElapsedMs: diagnostics.listenerRegistrationElapsedMs,
      });
      if (typeof beforeRenderRequestFunction === 'function') {
        try {
          diagnostics.beforeRenderRequestObservation =
            beforeRenderRequestFunction(
              ...(Array.isArray(beforeRenderRequestArgs)
                ? beforeRenderRequestArgs
                : []),
            );
          const fixtureClock = diagnostics.beforeRenderRequestObservation;
          if (fixtureClock?.schema === 'gev-phased-monotonic-wall-clock/v1')
            acknowledge('fixture-clock-held', {
              pageElapsedMs: elapsed(),
              fixtureClockPhase: fixtureClock.phase,
              fixtureClockElapsedMs: fixtureClock.elapsedMs,
              fixtureClockEpochMs: fixtureClock.epochMs,
              fixtureClockRunOrdinal: fixtureClock.runOrdinal,
              fixtureClockWarmupMs: fixtureClock.warmupMs,
              fixtureClockMeasurementMs: fixtureClock.measurementMs,
              fixtureClockWarmupNativeElapsedMs:
                fixtureClock.warmupNativeElapsedMs,
              fixtureClockMeasurementNativeElapsedMs:
                fixtureClock.measurementNativeElapsedMs,
              fixtureClockStartCount: fixtureClock.startCount,
              fixtureClockMeasurementStartCount:
                fixtureClock.measurementStartCount,
            });
        } catch (error) {
          diagnostics.beforeRenderRequestErrorName = String(
            error?.name || 'Error',
          ).slice(0, 80);
          finish(error);
          return;
        }
      }
      if (typeof postRenderConditionFunction === 'function') {
        try {
          const initialReady = postRenderConditionFunction(
            viewer,
            ...(Array.isArray(postRenderConditionArgs)
              ? postRenderConditionArgs
              : []),
          );
          if (typeof initialReady !== 'boolean')
            throw new TypeError(
              'Post-render readiness condition must return a boolean.',
            );
          diagnostics.postRenderCondition.initialReady = initialReady;
          diagnostics.postRenderCondition.ready = initialReady;
          diagnostics.postRenderCondition.observations = 1;
        } catch (error) {
          finish(error);
          return;
        }
      }
      if (renderRequestAvailable) {
        diagnostics.renderRequestStarted = true;
        diagnostics.renderRequestStartElapsedMs = elapsed();
        diagnostics.phase = 'render-request';
        acknowledge('render-request-started', {
          renderRequestAvailable: true,
          renderRequestStarted: true,
          pageElapsedMs: diagnostics.renderRequestStartElapsedMs,
        });
        viewer.scene.requestRender();
        diagnostics.renderRequestCompleted = true;
        diagnostics.renderRequestCompleteElapsedMs = elapsed();
        acknowledge('render-request-completed', {
          renderRequestCompleted: true,
          pageElapsedMs: diagnostics.renderRequestCompleteElapsedMs,
        });
      }
    } catch (error) {
      finish(error);
    }
  });
}

export function evaluateCompletedRenderDiagnostic(
  targetPage,
  pageTimeoutMs,
  {
    progressFunctionName,
    invocationId,
    retireViewerRenderLoop = false,
    finalObservationFunction = null,
    finalObservationArgs = [],
    beforeRenderRequestFunction = null,
    beforeRenderRequestArgs = [],
    postRenderConditionFunction = null,
    postRenderConditionArgs = [],
  },
) {
  const hasBrowserCallbacks =
    typeof finalObservationFunction === 'function' ||
    typeof beforeRenderRequestFunction === 'function' ||
    typeof postRenderConditionFunction === 'function';
  const pageFunction = hasBrowserCallbacks
    ? createCompletedRenderDiagnosticWithObservation(
        finalObservationFunction,
        finalObservationArgs,
        beforeRenderRequestFunction,
        beforeRenderRequestArgs,
        postRenderConditionFunction,
        postRenderConditionArgs,
      )
    : settleCompletedRenderDiagnostic;
  const args = [
    pageTimeoutMs,
    pageTimeoutMs,
    progressFunctionName,
    invocationId,
    retireViewerRenderLoop,
  ];
  if (!hasBrowserCallbacks) args.push(null, [], null, [], null, []);
  return targetPage.evaluate(pageFunction, ...args);
}

/**
 * Compose trusted browser function sources on the host, so Puppeteer only
 * serializes one self-contained page function and JSON-safe arguments. Function
 * values passed as evaluate arguments are not serializable by Puppeteer.
 */
export function createCompletedRenderDiagnosticWithObservation(
  observationFunction = null,
  observationArgs = [],
  beforeRenderRequestFunction = null,
  beforeRenderRequestArgs = [],
  postRenderConditionFunction = null,
  postRenderConditionArgs = [],
) {
  if (
    (observationFunction !== null &&
      typeof observationFunction !== 'function') ||
    !Array.isArray(observationArgs) ||
    (beforeRenderRequestFunction !== null &&
      typeof beforeRenderRequestFunction !== 'function') ||
    !Array.isArray(beforeRenderRequestArgs) ||
    (postRenderConditionFunction !== null &&
      typeof postRenderConditionFunction !== 'function') ||
    !Array.isArray(postRenderConditionArgs)
  )
    throw new TypeError(
      'Browser observation callbacks and argument arrays are invalid.',
    );
  const serializedFinalArgs = JSON.stringify(observationArgs);
  const serializedBeforeArgs = JSON.stringify(beforeRenderRequestArgs);
  const serializedConditionArgs = JSON.stringify(postRenderConditionArgs);
  if (
    typeof serializedFinalArgs !== 'string' ||
    typeof serializedBeforeArgs !== 'string' ||
    typeof serializedConditionArgs !== 'string'
  )
    throw new TypeError(
      'Browser observation arguments must be JSON serializable.',
    );
  const composed = `function composedCompletedRenderDiagnostic(
    viewerOrTimeout,
    timeoutMs,
    progressFunctionName,
    invocationId,
    retireViewerRenderLoop,
  ) {
    const settle = ${settleCompletedRenderDiagnostic.toString()};
    const observation = ${observationFunction ? observationFunction.toString() : 'null'};
    const beforeRenderRequest = ${beforeRenderRequestFunction ? beforeRenderRequestFunction.toString() : 'null'};
    const postRenderCondition = ${postRenderConditionFunction ? postRenderConditionFunction.toString() : 'null'};
    return settle(
      viewerOrTimeout,
      timeoutMs,
      progressFunctionName,
      invocationId,
      retireViewerRenderLoop,
      observation,
      ${serializedFinalArgs},
      beforeRenderRequest,
      ${serializedBeforeArgs},
      postRenderCondition,
      ${serializedConditionArgs},
    );
  }`;
  return new Function(`return (${composed});`)();
}
