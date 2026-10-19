const DEFAULT_PAUSE_TIMEOUT_MS = 5_000;
const DEFAULT_OPERATION_TIMEOUT_MS = 15_000;

function boundedTimeout(value, fallback, label) {
  const timeoutMs = value === undefined ? fallback : value;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 15_000)
    throw new RangeError(`${label} must be an integer between 1 and 15000.`);
  return timeoutMs;
}

function withTimeout(operation, timeoutMs, label) {
  let timer;
  return Promise.race([
    Promise.resolve().then(operation),
    new Promise((_, reject) => {
      timer = setTimeout(
        () => reject(new Error(`${label} deadline exceeded.`)),
        timeoutMs,
      );
    }),
  ]).finally(() => clearTimeout(timer));
}

function callbackExpression(callback, args) {
  if (callback == null) return null;
  if (typeof callback !== 'function')
    throw new TypeError('Paused read callback must be a function.');
  let serializedArgs = '';
  if (args !== undefined) {
    serializedArgs = JSON.stringify(args);
    if (serializedArgs === undefined || serializedArgs.length > 4096)
      throw new TypeError('Paused read callback arguments are not bounded.');
    serializedArgs = `(${serializedArgs})`;
  }
  return `(${callback.toString()})(${serializedArgs})`;
}

function cleanupError(stage, error) {
  return {
    stage,
    message: String(error?.message || error)
      .replace(/https?:\/\/[^\s"'<>]+/g, '[url]')
      .slice(0, 240),
  };
}

/**
 * Capture one page operation while its owned CDP debugger session is paused.
 * This is intentionally standalone: callers decide whether a paused snapshot
 * is appropriate, and no application timers, styles, or quality settings are
 * changed here.
 */
export async function captureWithDebuggerPause({
  page,
  readCallback = null,
  readCallbackArgs,
  pauseWhen = null,
  screenshot,
  pauseTimeoutMs,
  operationTimeoutMs,
} = {}) {
  if (!page?.createCDPSession || typeof screenshot !== 'function')
    throw new TypeError('A page and screenshot operation are required.');
  const pauseLimit = boundedTimeout(
    pauseTimeoutMs,
    DEFAULT_PAUSE_TIMEOUT_MS,
    'pauseTimeoutMs',
  );
  const operationLimit = boundedTimeout(
    operationTimeoutMs,
    DEFAULT_OPERATION_TIMEOUT_MS,
    'operationTimeoutMs',
  );
  const expression = callbackExpression(readCallback, readCallbackArgs);
  if (
    pauseWhen !== null &&
    (typeof pauseWhen !== 'function' ||
      !expression ||
      pauseWhen.toString().length > 4096)
  )
    throw new TypeError(
      'An atomic pause guard requires a bounded predicate and a read callback.',
    );
  // The predicate and debugger statement execute in the same browser task.
  // Host-side readiness followed by a separate pause can cross an animation
  // boundary. Polling here never takes or selects a screenshot: it only waits
  // for the declared phase, without changing any application input or clock.
  const guardedExpression =
    pauseWhen === null
      ? null
      : `(() => {
    const ready = (${pauseWhen.toString()})(${expression});
    if (typeof ready !== 'boolean') throw new TypeError('Pause guard must return a boolean.');
    if (ready) debugger;
    return ready;
  })()\n//# sourceURL=gev-qualification-guarded-pause.js`;
  const session = await page.createCDPSession();
  if (!session?.send || !session?.on || !session?.detach)
    throw new TypeError('The owned CDP session is incomplete.');
  let pausedEvent = null;
  let closed = false;
  const pauseDeadline = performance.now() + pauseLimit;
  let pauseResolve;
  let pauseReject;
  let pauseTimer;
  let guardPollTimer;
  let guardChecks = 0;
  const pausePromise = new Promise((resolve, reject) => {
    pauseResolve = resolve;
    pauseReject = reject;
    pauseTimer = setTimeout(
      () => reject(new Error('Debugger pause deadline exceeded.')),
      pauseLimit,
    );
  });
  // The rejection is consumed by the guarded await below; this handler also
  // prevents a late timeout from becoming an unhandled rejection during CDP
  // cleanup.
  void pausePromise.catch(() => {});
  const onPaused = (event) => {
    if (closed || pausedEvent) return;
    pausedEvent = event;
    clearTimeout(pauseTimer);
    pauseResolve(event);
  };
  session.on('Debugger.paused', onPaused);
  let primaryError = null;
  const cleanupErrors = [];
  let result = null;
  const cleanup = { resumed: false, disabled: false, detached: false };
  try {
    const pauseRemaining = (label) => {
      const remaining = Math.ceil(pauseDeadline - performance.now());
      if (remaining < 1) throw new Error(`${label} deadline exceeded.`);
      return remaining;
    };
    await withTimeout(
      () => session.send('Debugger.enable'),
      pauseRemaining('Debugger.enable'),
      'Debugger.enable',
    );
    pauseRemaining('Runtime.evaluate');
    // Dispatch a new task rather than interrupting an arbitrary render stack.
    // Interrupting Cesium while it is submitting a frame can leave the
    // compositor waiting for that stack to unwind, blocking a paused capture.
    // This command completes only after resume; awaiting it here would deadlock.
    if (guardedExpression) {
      while (!pausedEvent) {
        pauseRemaining('Atomic pause guard');
        guardChecks++;
        const outcome = await Promise.race([
          pausePromise.then((event) => ({ kind: 'paused', event })),
          session
            .send('Runtime.evaluate', {
              expression: guardedExpression,
              returnByValue: true,
              silent: true,
            })
            .then((result) => ({ kind: 'evaluated', result })),
        ]);
        if (outcome.kind === 'paused') break;
        if (
          outcome.result?.exceptionDetails ||
          outcome.result?.result?.subtype === 'error'
        )
          throw new Error('Atomic pause guard failed.');
        if (outcome.result?.result?.value !== false)
          throw new Error('Guarded pause task completed without pausing.');
        await Promise.race([
          pausePromise,
          new Promise((resolve) => {
            guardPollTimer = setTimeout(
              resolve,
              Math.min(50, pauseRemaining('Atomic pause guard')),
            );
          }),
        ]);
        clearTimeout(guardPollTimer);
      }
    } else
      void session
        .send('Runtime.evaluate', {
          expression: 'debugger;\n//# sourceURL=gev-qualification-pause.js',
          silent: true,
        })
        .then(
          () => {
            if (!pausedEvent && !closed)
              pauseReject(new Error('Pause task completed without pausing.'));
          },
          (error) => {
            if (!closed) pauseReject(error);
          },
        );
    const event = await pausePromise;
    const callFrameId = event?.callFrames?.[0]?.callFrameId;
    if (!callFrameId) throw new Error('Debugger pause has no top call frame.');
    const operationDeadline = performance.now() + operationLimit;
    const operationRemaining = (label) => {
      const remaining = Math.ceil(operationDeadline - performance.now());
      if (remaining < 1) throw new Error(`${label} deadline exceeded.`);
      return remaining;
    };
    const evaluateRead = async () => {
      if (!expression) return null;
      if (closed) throw new Error('Paused read was canceled.');
      const evaluated = await withTimeout(
        () =>
          session.send('Debugger.evaluateOnCallFrame', {
            callFrameId,
            expression,
            returnByValue: true,
            silent: true,
          }),
        operationRemaining('Debugger.evaluateOnCallFrame'),
        'Debugger.evaluateOnCallFrame',
      );
      if (evaluated?.exceptionDetails || evaluated?.result?.subtype === 'error')
        throw new Error('Paused read callback failed.');
      if (closed) throw new Error('Paused read was canceled.');
      return evaluated?.result?.value;
    };
    const readBefore = await evaluateRead();
    const screenshotResult = await withTimeout(
      async () => {
        if (closed) throw new Error('Paused screenshot was canceled.');
        const value = await screenshot(readBefore);
        if (closed) throw new Error('Paused screenshot was canceled.');
        return value;
      },
      operationRemaining('paused screenshot'),
      'paused screenshot',
    );
    const readAfter = await evaluateRead();
    result = {
      pause: {
        boundary: 'runtime-task',
        ...(guardedExpression
          ? {
              guard: {
                method: 'atomic-read-then-debugger/v1',
                checks: guardChecks,
                pollIntervalMs: 50,
              },
            }
          : {}),
        reason:
          typeof event?.reason === 'string' ? event.reason.slice(0, 80) : null,
      },
      readBefore,
      readAfter,
      screenshot: screenshotResult,
    };
  } catch (error) {
    primaryError = error;
  } finally {
    closed = true;
    clearTimeout(pauseTimer);
    clearTimeout(guardPollTimer);
    session.off?.('Debugger.paused', onPaused);
    if (!session.off) session.removeListener?.('Debugger.paused', onPaused);
    if (pausedEvent) {
      try {
        await withTimeout(
          () => session.send('Debugger.resume'),
          operationLimit,
          'Debugger.resume',
        );
        cleanup.resumed = true;
      } catch (error) {
        cleanupErrors.push(cleanupError('resume', error));
      }
    }
    try {
      await withTimeout(
        () => session.send('Debugger.disable'),
        operationLimit,
        'Debugger.disable',
      );
      cleanup.disabled = true;
    } catch (error) {
      cleanupErrors.push(cleanupError('disable', error));
    }
    try {
      await withTimeout(() => session.detach(), operationLimit, 'CDP detach');
      cleanup.detached = true;
    } catch (error) {
      cleanupErrors.push(cleanupError('detach', error));
    }
  }
  if (primaryError) {
    if (cleanupErrors.length) primaryError.cleanupErrors = cleanupErrors;
    throw primaryError;
  }
  if (cleanupErrors.length) {
    const error = new Error('Paused capture cleanup failed.');
    error.cleanupErrors = cleanupErrors;
    throw error;
  }
  result.cleanup = cleanup;
  return result;
}
