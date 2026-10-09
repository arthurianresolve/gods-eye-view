/**
 * Diagnostic only: observe completion of commands submitted before a fence.
 * A flush changes scheduling. This is neither GPU execution timing nor proof
 * that the GPU is idle; do not mix these samples with normal latency runs.
 */
export function observeSubmittedCommands(
  gl,
  {
    now = () => performance.now(),
    schedule = (callback) => setInterval(callback, 8),
    cancel = clearInterval,
  } = {},
) {
  const started = now();
  const result = {
    state: 'unavailable',
    completionObservedAfterMs: null,
    polls: 0,
    observationMs: null,
  };
  let sync = null;
  let timer = null;
  let finished = false;
  const release = () => {
    if (timer !== null) cancel(timer);
    timer = null;
    if (sync !== null) gl.deleteSync(sync);
    sync = null;
  };
  const poll = () => {
    if (finished || result.state !== 'pending') return;
    try {
      result.polls++;
      const value = gl.clientWaitSync(sync, 0, 0);
      if (value === gl.ALREADY_SIGNALED || value === gl.CONDITION_SATISFIED) {
        result.state = 'completed';
        result.completionObservedAfterMs = now() - started;
      } else if (value !== gl.TIMEOUT_EXPIRED) result.state = 'failed';
    } catch {
      result.state = 'failed';
    }
    if (result.state !== 'pending') release();
  };
  if (
    gl &&
    ['fenceSync', 'clientWaitSync', 'deleteSync', 'flush'].every(
      (name) => typeof gl[name] === 'function',
    )
  ) {
    try {
      sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
      if (sync === null) result.state = 'failed';
      else {
        result.state = 'pending';
        gl.flush();
        timer = schedule(poll);
      }
    } catch {
      result.state = 'failed';
      release();
    }
  }
  return {
    finish() {
      if (!finished) {
        poll();
        result.observationMs = now() - started;
        finished = true;
        release();
      }
      return { ...result };
    },
  };
}
