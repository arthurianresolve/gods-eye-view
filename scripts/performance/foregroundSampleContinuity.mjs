export function evaluateForegroundSampleContinuity(sample) {
  const focus = sample?.focusContinuity;
  const visibility = sample?.visibilityContinuity;
  const foregroundThroughout =
    focus?.focusedAtStart === true &&
    focus?.focusedAtEnd === true &&
    visibility?.visibleAtStart === true &&
    visibility?.visibleAtEnd === true &&
    visibility?.visibleThroughout === true;

  return {
    schema: 'gev-performance-foreground-continuity/v1',
    foregroundThroughout,
    focusInterrupted: focus?.interruptionCount > 0,
    focusInterruptionCount: Number.isInteger(focus?.interruptionCount)
      ? focus.interruptionCount
      : null,
    hiddenObserved: visibility?.visibleThroughout === false,
  };
}
