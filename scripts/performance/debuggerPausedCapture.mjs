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

function callbackExpression(callback) {
  if (callback == null) return null;
  if (typeof callback !== 'function')
    throw new TypeError('Paused read callback must be a function.');
  return `(${callback.toString()})()`;
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
  const expression = callbackExpression(readCallback);
  const session = await page.createCDPSession();
  if (!session?.send || !session?.on || !session?.detach)
    throw new TypeError('The owned CDP session is incomplete.');
  let pausedEvent = null;
  let pauseResolve;
  let pauseReject;
  let pauseTimer;
  const pausePromise = new Promise((resolve, reject) => {
    pauseResolve = resolve;
    pauseReject = reject;
    pauseTimer = setTimeout(
      () => reject(new Error('Debugger pause deadline exceeded.')),
      pauseLimit,
    );
  });
  const onPaused = (event) => {
    if (pausedEvent) return;
    pausedEvent = event;
    clearTimeout(pauseTimer);
    pauseResolve(event);
  };
  session.on('Debugger.paused', onPaused);
  let primaryError = null;
  const cleanupErrors = [];
  try {
    await withTimeout(
      () => session.send('Debugger.enable'),
      pauseLimit,
      'Debugger.enable',
    );
    const event = await pausePromise;
    const callFrameId = event?.callFrames?.[0]?.callFrameId;
    if (!callFrameId) throw new Error('Debugger pause has no top call frame.');
    let readValue;
    if (expression) {
      const evaluated = await withTimeout(
        () =>
          session.send('Debugger.evaluateOnCallFrame', {
            callFrameId,
            expression,
            returnByValue: true,
            silent: true,
          }),
        operationLimit,
        'Debugger.evaluateOnCallFrame',
      );
      if (evaluated?.exceptionDetails || evaluated?.result?.subtype === 'error')
        throw new Error('Paused read callback failed.');
      readValue = evaluated?.result?.value;
    }
    const screenshotResult = await withTimeout(
      screenshot,
      operationLimit,
      'paused screenshot',
    );
    return { paused: event, readValue, screenshot: screenshotResult };
  } catch (error) {
    primaryError = error;
  } finally {
    clearTimeout(pauseTimer);
    session.off?.('Debugger.paused', onPaused);
    if (!session.off) session.removeListener?.('Debugger.paused', onPaused);
    if (pausedEvent) {
      try {
        await withTimeout(
          () => session.send('Debugger.resume'),
          operationLimit,
          'Debugger.resume',
        );
      } catch (error) {
        cleanupErrors.push({ stage: 'resume', error });
      }
    }
    try {
      await withTimeout(
        () => session.send('Debugger.disable'),
        operationLimit,
        'Debugger.disable',
      );
    } catch (error) {
      cleanupErrors.push({ stage: 'disable', error });
    }
    try {
      await withTimeout(() => session.detach(), operationLimit, 'CDP detach');
    } catch (error) {
      cleanupErrors.push({ stage: 'detach', error });
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
}
