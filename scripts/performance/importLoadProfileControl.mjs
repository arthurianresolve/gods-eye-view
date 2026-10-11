function waitForClick(button, timeoutMs) {
  return new Promise((resolve, reject) => {
    let timer;
    const finish = (callback, value) => {
      clearTimeout(timer);
      button.removeEventListener('click', onClick);
      callback(value);
    };
    const onClick = () => finish(resolve);
    button.addEventListener('click', onClick, { once: true });
    timer = setTimeout(
      () => finish(reject, new Error('Import profile control timed out')),
      timeoutMs,
    );
  });
}

/** Hold one load between explicit profiler-start and profiler-stop controls. */
export async function runControlledImportLoadProfile({
  startButton,
  finishButton,
  publishState,
  load,
  now = () => performance.now(),
  timeoutMs = 120_000,
}) {
  if (
    !startButton ||
    !finishButton ||
    typeof startButton.addEventListener !== 'function' ||
    typeof finishButton.addEventListener !== 'function' ||
    typeof publishState !== 'function' ||
    typeof load !== 'function' ||
    typeof now !== 'function' ||
    !Number.isFinite(timeoutMs) ||
    timeoutMs <= 0
  )
    throw new TypeError('Invalid controlled import profile');
  startButton.hidden = false;
  finishButton.hidden = true;
  const started = waitForClick(startButton, timeoutMs);
  publishState('ready');
  try {
    await started;
    startButton.hidden = true;
    publishState('loading');
    const loadStartMs = now();
    const value = await load();
    const loadEndMs = now();
    finishButton.hidden = false;
    const finished = waitForClick(finishButton, timeoutMs);
    publishState('loaded');
    await finished;
    return { value, loadStartMs, loadEndMs };
  } catch (error) {
    publishState('failed');
    throw error;
  } finally {
    startButton.hidden = true;
    finishButton.hidden = true;
  }
}
