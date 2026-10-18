import fs from 'node:fs/promises';
import path from 'node:path';

export const BROWSER_TRACE_SCHEMA = 'gev-browser-trace/v1';
export const MAX_BROWSER_TRACE_BYTES = 64 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 15_000;
const REQUESTED_CATEGORIES = [
  'devtools.timeline',
  'disabled-by-default-devtools.timeline',
  'toplevel',
  'cc',
  'viz',
  'gpu',
  'renderer.scheduler',
  'disabled-by-default-cc.debug',
  'disabled-by-default-gpu.service',
  'disabled-by-default-renderer.scheduler',
];

function timeoutMs(value, label) {
  const result = value ?? DEFAULT_TIMEOUT_MS;
  if (!Number.isSafeInteger(result) || result < 1 || result > 15_000)
    throw new RangeError(`${label} must be an integer between 1 and 15000.`);
  return result;
}

function boundedMessage(error) {
  return String(error?.message || error)
    .replace(/https?:\/\/[^\s"'<>]+/g, '[url]')
    .slice(0, 240);
}

function withTimeout(operation, limit, label) {
  let timer;
  const promise = Promise.resolve().then(operation);
  promise.catch(() => {});
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(
        () => reject(new Error(`${label} deadline exceeded.`)),
        limit,
      );
    }),
  ]).finally(() => clearTimeout(timer));
}

function traceConfig() {
  return {
    recordMode: 'recordUntilFull',
    includedCategories: REQUESTED_CATEGORIES,
    excludedCategories: [
      '*',
      'disabled-by-default-devtools.screenshot',
      'netlog',
      'disabled-by-default-network',
    ],
  };
}

/**
 * Start an opt-in, diagnostic-only Chromium trace on a fresh owned CDP session.
 * The returned stop operation writes the CDP JSON stream atomically and always
 * detaches this session; it never touches a caller-owned/shared session.
 */
export async function startBrowserTrace({
  page,
  outputPath,
  timeoutMs: operationTimeoutMs,
  maxBytes = MAX_BROWSER_TRACE_BYTES,
} = {}) {
  if (!page?.createCDPSession) throw new TypeError('A page is required.');
  if (typeof outputPath !== 'string' || !path.isAbsolute(outputPath))
    throw new TypeError('Browser trace output must be an absolute path.');
  if (
    !Number.isSafeInteger(maxBytes) ||
    maxBytes < 1 ||
    maxBytes > MAX_BROWSER_TRACE_BYTES
  )
    throw new RangeError(
      `maxBytes must be between 1 and ${MAX_BROWSER_TRACE_BYTES}.`,
    );
  const limit = timeoutMs(operationTimeoutMs, 'Browser trace timeoutMs');
  if (
    await fs.lstat(path.resolve(outputPath)).then(
      () => true,
      () => false,
    )
  )
    throw new Error('Browser trace output already exists.');
  const createPromise = Promise.resolve().then(() => page.createCDPSession());
  createPromise.catch(() => {});
  let session;
  try {
    session = await withTimeout(
      () => createPromise,
      limit,
      'Browser trace CDP session creation',
    );
  } catch (error) {
    createPromise
      .then((lateSession) =>
        withTimeout(
          () => lateSession?.detach?.(),
          limit,
          'Late browser trace CDP detach',
        ).catch(() => {}),
      )
      .catch(() => {});
    throw error;
  }
  if (!session?.send || !session?.on || !session?.detach) {
    try {
      await withTimeout(
        () => session?.detach?.(),
        limit,
        'Browser trace detach',
      );
    } catch {}
    throw new TypeError('The browser trace CDP session is incomplete.');
  }

  let closed = false;
  let completionResolve;
  let completionReject;
  let completionEvent = null;
  let completionSeen = false;
  let completionStream = null;
  let completionBeforeStop = false;
  let stopped = false;
  let bufferUsage = null;
  const completion = new Promise((resolve, reject) => {
    completionResolve = resolve;
    completionReject = reject;
  });
  completion.catch(() => {});
  const onComplete = (event) => {
    if (closed || completionSeen) return;
    completionSeen = true;
    completionBeforeStop = !stopped;
    if (typeof event?.stream !== 'string' || !event.stream) {
      completionReject(new Error('Tracing completion had no stream handle.'));
      return;
    }
    completionStream = event.stream;
    if (
      event.dataLossOccurred !== undefined &&
      typeof event.dataLossOccurred !== 'boolean'
    ) {
      completionReject(
        new Error('Tracing completion had invalid data-loss metadata.'),
      );
      return;
    }
    if (event.traceFormat !== undefined && event.traceFormat !== 'json') {
      completionReject(
        new Error('Tracing completion had an unexpected format.'),
      );
      return;
    }
    if (
      event.streamCompression !== undefined &&
      event.streamCompression !== 'none'
    ) {
      completionReject(
        new Error('Tracing completion had unexpected compression.'),
      );
      return;
    }
    completionEvent = {
      dataLossOccurred:
        typeof event.dataLossOccurred === 'boolean'
          ? event.dataLossOccurred
          : null,
      traceFormat: event.traceFormat ?? null,
    };
    completionResolve(event.stream);
  };
  session.on('Tracing.tracingComplete', onComplete);
  const onBufferUsage = (event) => {
    const percentFull =
      typeof event?.percentFull === 'number' ? event.percentFull : event?.value;
    if (!Number.isFinite(percentFull) || percentFull < 0) return;
    const boundedPercentFull = Math.min(percentFull, 1);
    if (!bufferUsage || boundedPercentFull >= bufferUsage.percentFull)
      bufferUsage = {
        percentFull: boundedPercentFull,
        eventCount: Number.isSafeInteger(event?.eventCount)
          ? event.eventCount
          : null,
        value: Number.isFinite(event?.value) ? event.value : null,
      };
  };
  session.on('Tracing.bufferUsage', onBufferUsage);

  let started = false;
  let startOperation = null;
  let supportedCategories = null;
  try {
    const categoryResult = await withTimeout(
      () => session.send('Tracing.getCategories'),
      limit,
      'Tracing.getCategories',
    );
    if (Array.isArray(categoryResult?.categories))
      supportedCategories = REQUESTED_CATEGORIES.filter((category) =>
        categoryResult.categories.includes(category),
      );
    const startParams = {
      transferMode: 'ReturnAsStream',
      streamFormat: 'json',
      streamCompression: 'none',
      bufferUsageReportingInterval: 1000,
      traceConfig: {
        ...traceConfig(),
        traceBufferSizeInKb: 32 * 1024,
        enableArgumentFilter: true,
      },
    };
    startOperation = Promise.resolve().then(() =>
      session.send('Tracing.start', startParams),
    );
    startOperation.catch(() => {});
    await withTimeout(() => startOperation, limit, 'Tracing.start');
    started = true;
  } catch (error) {
    closed = true;
    session.off?.('Tracing.tracingComplete', onComplete);
    session.off?.('Tracing.bufferUsage', onBufferUsage);
    if (!session.off) {
      session.removeListener?.('Tracing.tracingComplete', onComplete);
      session.removeListener?.('Tracing.bufferUsage', onBufferUsage);
    }
    if (startOperation) {
      startOperation
        .then(async () => {
          await withTimeout(
            () => session.send('Tracing.end'),
            limit,
            'Late browser trace end',
          ).catch(() => {});
          try {
            await withTimeout(
              () => session.detach(),
              limit,
              'Late browser trace detach',
            );
          } catch {}
        })
        .catch(async () => {
          await withTimeout(
            () => session.detach(),
            limit,
            'Late browser trace detach',
          ).catch(() => {});
        });
    } else {
      await withTimeout(
        () => session.detach(),
        limit,
        'Browser trace detach',
      ).catch(() => {});
    }
    throw error;
  }

  const stop = async () => {
    if (stopped)
      return { schema: BROWSER_TRACE_SCHEMA, status: 'already-stopped' };
    stopped = true;
    let primaryError = null;
    const cleanupErrors = [];
    let streamHandle = null;
    let result = null;
    let tempPath = `${path.resolve(outputPath)}.partial-${process.pid}-${Date.now()}`;
    let tempHandle = null;
    let bytes = 0;
    const stopDeadline = Date.now() + limit;
    const remaining = (label) => {
      const value = stopDeadline - Date.now();
      if (value < 1) throw new Error(`${label} deadline exceeded.`);
      return value;
    };
    try {
      if (!started) throw new Error('Browser trace was not started.');
      if (!completionSeen)
        await withTimeout(
          () => session.send('Tracing.end'),
          remaining('Tracing.end'),
          'Tracing.end',
        );
      streamHandle = await withTimeout(
        () => completion,
        remaining('Tracing completion'),
        'Tracing completion',
      );
      await fs.mkdir(path.dirname(path.resolve(outputPath)), {
        recursive: true,
      });
      tempHandle = await fs.open(tempPath, 'wx');
      let eof = false;
      while (!eof) {
        const chunk = await withTimeout(
          () =>
            session.send('IO.read', { handle: streamHandle, size: 64 * 1024 }),
          remaining('Trace stream read'),
          'Trace stream read',
        );
        if (typeof chunk?.data !== 'string')
          throw new Error('Trace stream returned invalid data.');
        if (Buffer.byteLength(chunk.data) > 96 * 1024)
          throw new Error('Trace stream chunk exceeded its byte bound.');
        const data = chunk.base64Encoded
          ? Buffer.from(chunk.data, 'base64')
          : Buffer.from(chunk.data);
        bytes += data.length;
        if (bytes > maxBytes)
          throw new Error('Browser trace exceeded its byte bound.');
        await tempHandle.write(data);
        eof = chunk.eof === true;
      }
      await tempHandle.close();
      tempHandle = null;
      await fs.link(tempPath, path.resolve(outputPath));
      await fs.unlink(tempPath);
      tempPath = null;
      const truncated =
        completionEvent?.dataLossOccurred === true ||
        bufferUsage?.percentFull >= 1;
      const completionStatus = truncated
        ? 'truncated'
        : completionEvent?.dataLossOccurred === false && !completionBeforeStop
          ? 'completed'
          : 'incomplete';
      result = {
        schema: BROWSER_TRACE_SCHEMA,
        status: completionStatus,
        outputPath: path.resolve(outputPath),
        bytes,
        recordMode: 'recordUntilFull',
        full: truncated,
        truncated,
        traceFormat: completionEvent?.traceFormat,
        supportedCategories,
        bufferUsage,
        dataLossOccurred: completionEvent?.dataLossOccurred,
        completionBeforeStop,
      };
    } catch (error) {
      primaryError = error;
      if (tempHandle) await tempHandle.close().catch(() => {});
      if (tempPath) await fs.rm(tempPath, { force: true }).catch(() => {});
    } finally {
      closed = true;
      session.off?.('Tracing.tracingComplete', onComplete);
      session.off?.('Tracing.bufferUsage', onBufferUsage);
      if (!session.off) {
        session.removeListener?.('Tracing.tracingComplete', onComplete);
        session.removeListener?.('Tracing.bufferUsage', onBufferUsage);
      }
      streamHandle ||= completionStream;
      if (streamHandle)
        await withTimeout(
          () => session.send('IO.close', { handle: streamHandle }),
          limit,
          'Trace stream close',
        ).catch((error) =>
          cleanupErrors.push({
            stage: 'stream-close',
            message: boundedMessage(error),
          }),
        );
      await withTimeout(
        () => session.detach(),
        limit,
        'Browser trace detach',
      ).catch((error) => {
        cleanupErrors.push({ stage: 'detach', message: boundedMessage(error) });
      });
    }
    if (cleanupErrors.length && !primaryError)
      primaryError = new Error('Browser trace cleanup failed.');
    if (!primaryError) return result;
    const error = new Error(
      `Browser trace capture failed: ${boundedMessage(primaryError)}`,
    );
    error.cause = primaryError;
    if (cleanupErrors.length) error.cleanupErrors = cleanupErrors;
    throw error;
  };

  return {
    stop,
    schema: BROWSER_TRACE_SCHEMA,
    recordMode: 'recordUntilFull',
    maxBytes,
  };
}
