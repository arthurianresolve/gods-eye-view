export const MAX_CAPTURE_STAGE_RECORDS = 24;

export class CaptureStageTimeoutError extends Error {
  constructor(stage, timeoutMs) {
    super(`Capture stage ${stage} exceeded ${timeoutMs} ms.`);
    this.name = 'CaptureStageTimeoutError';
    this.stage = stage;
    this.timeoutMs = timeoutMs;
  }
}

/** Keep bounded, payload-free timings for capture setup and audit stages. */
export function createCaptureStageJournal({
  now = () => performance.now(),
  scheduleTimeout = (callback, delay) => setTimeout(callback, delay),
  cancelTimeout = (handle) => clearTimeout(handle),
  onUpdate = () => {},
  maxRecords = MAX_CAPTURE_STAGE_RECORDS,
} = {}) {
  if (typeof now !== 'function')
    throw new TypeError('A monotonic clock function is required.');
  if (
    typeof scheduleTimeout !== 'function' ||
    typeof cancelTimeout !== 'function'
  )
    throw new TypeError('Capture stage timer functions are required.');
  if (
    typeof onUpdate !== 'function' ||
    !Number.isSafeInteger(maxRecords) ||
    maxRecords < 1 ||
    maxRecords > MAX_CAPTURE_STAGE_RECORDS
  )
    throw new TypeError('Capture stage journal bounds are invalid.');

  const records = [];
  let nextSequence = 1;

  function snapshot() {
    const snapshotTime = now();
    return records.map((record) => ({
      ...record,
      elapsedMs:
        record.status === 'running' && Number.isFinite(snapshotTime)
          ? Math.max(0, snapshotTime - record.startedAtMs)
          : record.elapsedMs,
    }));
  }

  function checkpoint() {
    return nextSequence - 1;
  }

  function since(sequence) {
    if (!Number.isSafeInteger(sequence) || sequence < 0)
      throw new TypeError('Capture stage checkpoint is invalid.');
    return records
      .filter((record) => record.sequence > sequence)
      .map((record) => ({ ...record }));
  }

  function publish() {
    try {
      onUpdate(snapshot());
    } catch {
      // Failure reporting must not change the capture operation itself.
    }
  }

  function remember(record) {
    records.push(record);
    if (records.length > maxRecords)
      records.splice(0, records.length - maxRecords);
    publish();
  }

  async function run(stage, operation, { timeoutMs = null } = {}) {
    if (typeof stage !== 'string' || stage.length === 0 || stage.length > 80)
      throw new TypeError('Capture stage name is invalid.');
    if (typeof operation !== 'function')
      throw new TypeError('Capture stage operation is required.');
    if (
      timeoutMs !== null &&
      (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1)
    )
      throw new TypeError('Capture stage timeout must be a positive integer.');

    const startedAtMs = now();
    if (!Number.isFinite(startedAtMs))
      throw new TypeError('Capture stage clock returned an invalid value.');
    const record = {
      sequence: nextSequence++,
      stage,
      status: 'running',
      startedAtMs,
      elapsedMs: null,
      timeoutMs,
      errorName: null,
    };
    remember(record);

    let timeoutHandle = null;
    const operationPromise = Promise.resolve().then(operation);
    const timeoutPromise =
      timeoutMs === null
        ? null
        : new Promise((_, reject) => {
            timeoutHandle = scheduleTimeout(() => {
              if (record.status !== 'running') return;
              record.status = 'timed-out';
              record.elapsedMs = Math.max(0, now() - startedAtMs);
              record.errorName = 'CaptureStageTimeoutError';
              publish();
              reject(new CaptureStageTimeoutError(stage, timeoutMs));
            }, timeoutMs);
          });

    try {
      const result = await (timeoutPromise
        ? Promise.race([operationPromise, timeoutPromise])
        : operationPromise);
      if (record.status === 'running') {
        record.status = 'completed';
        record.elapsedMs = Math.max(0, now() - startedAtMs);
        publish();
      }
      return result;
    } catch (error) {
      if (record.status === 'running') {
        record.status = 'failed';
        record.elapsedMs = Math.max(0, now() - startedAtMs);
        record.errorName =
          typeof error?.name === 'string' ? error.name.slice(0, 80) : 'Error';
        publish();
      }
      throw error;
    } finally {
      if (timeoutHandle !== null) cancelTimeout(timeoutHandle);
      // Promise.race keeps handlers attached if a timed-out operation settles
      // later; its result cannot change the timed-out record.
    }
  }

  return Object.freeze({ run, snapshot, checkpoint, since });
}
