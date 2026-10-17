const FOREGROUND_ACTIVATION_SCHEMA = 'gev-performance-foreground-activation/v1';

function observeForegroundState() {
  return {
    visible: !document.hidden,
    focused: document.hasFocus(),
    visibilityState: document.visibilityState,
  };
}

export async function activateForegroundPage(
  page,
  { timeoutMs = 5000, pollingMs = 50 } = {},
) {
  if (!page || typeof page.bringToFront !== 'function')
    throw new TypeError('Foreground activation requires a browser page.');
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0)
    throw new TypeError('Foreground activation timeout must be positive.');
  if (!Number.isFinite(pollingMs) || pollingMs <= 0)
    throw new TypeError('Foreground activation polling must be positive.');

  await page.bringToFront();
  let state = null;
  let waitOutcome = 'condition-resolved';
  try {
    await page.waitForFunction(() => !document.hidden && document.hasFocus(), {
      timeout: timeoutMs,
      polling: pollingMs,
    });
  } catch (error) {
    state = await page.evaluate(observeForegroundState).catch(() => null);
    if (!state?.visible || !state?.focused) {
      const activationError = new Error(
        `Performance page did not become visible and focused: ${JSON.stringify(state)}`,
        { cause: error },
      );
      activationError.name = 'ForegroundActivationError';
      activationError.state = state;
      throw activationError;
    }
    waitOutcome = 'final-observation-confirmed-after-wait-error';
  }

  state ||= await page.evaluate(observeForegroundState);
  if (!state.visible || !state.focused) {
    const error = new Error(
      `Performance page lost foreground immediately after activation: ${JSON.stringify(state)}`,
    );
    error.name = 'ForegroundActivationError';
    error.state = state;
    throw error;
  }
  return {
    schema: FOREGROUND_ACTIVATION_SCHEMA,
    ...state,
    timeoutMs,
    pollingMs,
    waitOutcome,
  };
}

export { FOREGROUND_ACTIVATION_SCHEMA };
