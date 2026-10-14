const WORKER_TIMEOUT_MS = 30_000;

function workerError(code, message) {
  return Object.assign(new Error(message), { code });
}

/** Parse JSON in an owned, one-shot module worker for explicit experiments. */
export function parseJsonInWorker(
  text,
  {
    signal,
    WorkerConstructor = globalThis.Worker,
    timeoutMs = WORKER_TIMEOUT_MS,
  } = {},
) {
  signal?.throwIfAborted();
  if (typeof WorkerConstructor !== 'function')
    throw workerError(
      'worker-unavailable',
      'This browser does not support the optional JSON parser worker.',
    );
  if (
    !Number.isFinite(timeoutMs) ||
    timeoutMs <= 0 ||
    timeoutMs > WORKER_TIMEOUT_MS
  )
    throw new RangeError('JSON parser worker timeout is outside its bound.');

  return new Promise((resolve, reject) => {
    let worker;
    let timer = null;
    let settled = false;

    const retire = () => {
      if (timer !== null) clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      if (!worker) return;
      worker.onmessage = null;
      worker.onerror = null;
      worker.onmessageerror = null;
      try {
        worker.terminate();
      } catch {
        // Settlement remains authoritative if a browser throws during teardown.
      }
    };
    const settle = (callback, value) => {
      if (settled) return;
      settled = true;
      retire();
      callback(value);
    };
    const onAbort = () => {
      let error;
      try {
        signal.throwIfAborted();
      } catch (reason) {
        error = reason;
      }
      settle(
        reject,
        error || workerError('aborted', 'JSON parsing was cancelled.'),
      );
    };

    try {
      worker = new WorkerConstructor(
        new URL('./geojsonJson.worker.js', import.meta.url),
        { type: 'module' },
      );
    } catch {
      settle(
        reject,
        workerError(
          'worker-start-failed',
          'The JSON parser worker could not start.',
        ),
      );
      return;
    }

    worker.onmessage = (event) => {
      const response = event?.data;
      if (
        response?.type !== 'geojson-json-result' ||
        response.requestId !== 1 ||
        typeof response.ok !== 'boolean'
      ) {
        settle(
          reject,
          workerError(
            'worker-protocol-error',
            'The JSON parser worker returned an invalid response.',
          ),
        );
      } else if (response.ok) {
        settle(resolve, response.value);
      } else if (response.code === 'invalid-json') {
        settle(
          reject,
          workerError('invalid-json', 'GeoJSON is not valid JSON.'),
        );
      } else {
        settle(
          reject,
          workerError(
            'worker-protocol-error',
            'The JSON parser worker rejected the request.',
          ),
        );
      }
    };
    worker.onerror = (event) => {
      event?.preventDefault?.();
      settle(
        reject,
        workerError('worker-error', 'The JSON parser worker failed.'),
      );
    };
    worker.onmessageerror = () =>
      settle(
        reject,
        workerError(
          'worker-message-error',
          'The JSON parser worker response could not be read.',
        ),
      );
    signal?.addEventListener('abort', onAbort, { once: true });
    if (signal?.aborted) {
      onAbort();
      return;
    }
    timer = setTimeout(
      () =>
        settle(
          reject,
          workerError(
            'worker-timeout',
            'The JSON parser worker exceeded its time limit.',
          ),
        ),
      timeoutMs,
    );
    try {
      worker.postMessage({
        type: 'parse-geojson-json',
        requestId: 1,
        text,
      });
    } catch {
      settle(
        reject,
        workerError(
          'worker-post-failed',
          'The JSON parser request could not be sent.',
        ),
      );
    }
  });
}
