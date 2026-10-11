import {
  IMPORT_TRACE_CATEGORIES,
  IMPORT_TRACE_EVENT_LIMIT,
  createImportTraceEventCollector,
} from './importTraceAttribution.mjs';

function requirePositiveTimeout(value, name) {
  if (!Number.isFinite(value) || value <= 0)
    throw new TypeError(`${name} must be a positive finite number`);
  return value;
}

function waitFor(promise, timeoutMs, message, setTimer, clearTimer) {
  let timer;
  return Promise.race([
    Promise.resolve(promise),
    new Promise((_, reject) => {
      timer = setTimer(() => reject(new Error(message)), timeoutMs);
    }),
  ]).finally(() => {
    if (timer !== undefined) clearTimer(timer);
  });
}

export async function startImportTraceSession(
  session,
  {
    timeoutMs = 15_000,
    cleanupTimeoutMs = 1_000,
    setTimer = setTimeout,
    clearTimer = clearTimeout,
  } = {},
) {
  requirePositiveTimeout(timeoutMs, 'timeoutMs');
  requirePositiveTimeout(cleanupTimeoutMs, 'cleanupTimeoutMs');
  if (
    !session ||
    typeof session.on !== 'function' ||
    typeof session.off !== 'function' ||
    typeof session.send !== 'function' ||
    typeof session.detach !== 'function'
  )
    throw new TypeError('Invalid tracing session');

  const collector = createImportTraceEventCollector(IMPORT_TRACE_EVENT_LIMIT);
  let collectorError = null;
  let bufferUsagePeak = null;
  let bufferUsageCount = 0;
  let completionObserved = false;
  let dataLossOccurred = null;
  let completeResolve;
  const completed = new Promise((resolve) => {
    completeResolve = resolve;
  });
  const onData = ({ value } = {}) => {
    try {
      collector.add(Array.isArray(value) ? value : []);
    } catch (error) {
      collectorError ||= String(error?.message || error).slice(0, 240);
    }
  };
  const onBufferUsage = (event = {}) => {
    if (!event || typeof event !== 'object' || Array.isArray(event)) {
      collectorError ||= 'trace-buffer-usage-malformed';
      return;
    }
    const supplied = ['percentFull', 'value'].filter((key) =>
      Object.hasOwn(event, key),
    );
    if (!supplied.length) return;
    const values = supplied.map((key) => event[key]);
    if (
      values.some((value) => !Number.isFinite(value) || value < 0 || value > 1)
    ) {
      collectorError ||= 'trace-buffer-usage-malformed';
      return;
    }
    bufferUsageCount += 1;
    bufferUsagePeak = Math.max(bufferUsagePeak ?? 0, ...values);
  };
  // Pinned devtools-protocol 0.0.1666840 declares TracingCompleteEvent's
  // dataLossOccurred as required (types/protocol.d.ts, Tracing domain); the
  // BufferUsageEvent percentFull remains optional. Do not infer delivery from
  // the periodic sample when tracingComplete supplies the authoritative flag.
  const onComplete = (event = {}) => {
    completionObserved = true;
    if (typeof event.dataLossOccurred !== 'boolean') {
      collectorError ||= 'trace-data-loss-flag-missing-or-malformed';
    } else {
      dataLossOccurred = event.dataLossOccurred;
      if (dataLossOccurred) collectorError ||= 'trace-data-loss-reported';
    }
    completeResolve();
  };
  const removeListeners = () => {
    session.off('Tracing.dataCollected', onData);
    session.off('Tracing.bufferUsage', onBufferUsage);
    session.off('Tracing.tracingComplete', onComplete);
  };
  const detachBounded = () =>
    waitFor(
      Promise.resolve().then(() => session.detach()),
      cleanupTimeoutMs,
      'Tracing session detach timed out',
      setTimer,
      clearTimer,
    );

  try {
    session.on('Tracing.dataCollected', onData);
    session.on('Tracing.bufferUsage', onBufferUsage);
    session.on('Tracing.tracingComplete', onComplete);
    await waitFor(
      Promise.resolve().then(() =>
        session.send('Tracing.start', {
          categories: IMPORT_TRACE_CATEGORIES,
          options: 'record-until-full',
          bufferUsageReportingInterval: 100,
        }),
      ),
      timeoutMs,
      'Tracing.start acknowledgement timed out',
      setTimer,
      clearTimer,
    );
  } catch (error) {
    removeListeners();
    try {
      await detachBounded();
    } catch (cleanupError) {
      if (error && typeof error === 'object')
        error.traceCleanupError = String(
          cleanupError?.message || cleanupError,
        ).slice(0, 240);
    }
    throw error;
  }

  let stopped = false;
  return {
    async stop() {
      if (stopped) throw new Error('Import trace already stopped');
      stopped = true;
      let stopError = null;
      try {
        await waitFor(
          Promise.all([
            Promise.resolve().then(() => session.send('Tracing.end')),
            completed,
          ]),
          timeoutMs,
          'Tracing.end acknowledgement/completion timed out',
          setTimer,
          clearTimer,
        );
      } catch (error) {
        stopError = String(error?.message || error).slice(0, 240);
      } finally {
        removeListeners();
        try {
          await detachBounded();
        } catch (error) {
          stopError ||= String(error?.message || error).slice(0, 240);
        }
      }
      stopError ||= collectorError;
      return {
        ...collector.finish(),
        bufferUsagePeak,
        bufferUsageCount,
        bufferUsageStatus: bufferUsageCount ? 'observed' : 'unavailable',
        completionObserved,
        dataLossOccurred,
        stopError,
      };
    },
  };
}
