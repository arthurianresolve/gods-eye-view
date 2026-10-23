import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluateForegroundSampleContinuity } from './foregroundSampleContinuity.mjs';

function sample({
  focusedAtStart = true,
  focusedAtEnd = true,
  interruptionCount = 0,
  visibleAtStart = true,
  visibleAtEnd = true,
  visibleThroughout = true,
} = {}) {
  return {
    focusContinuity: {
      focusedAtStart,
      focusedAtEnd,
      interruptionCount,
    },
    visibilityContinuity: {
      visibleAtStart,
      visibleAtEnd,
      visibleThroughout,
    },
  };
}

test('accepts a visible sample with focused boundaries and records transient blur', () => {
  assert.deepEqual(
    evaluateForegroundSampleContinuity(sample({ interruptionCount: 2 })),
    {
      schema: 'gev-performance-foreground-continuity/v1',
      foregroundThroughout: true,
      focusInterrupted: true,
      focusInterruptionCount: 2,
      hiddenObserved: false,
    },
  );
});

test('accepts visible rendering when input focus ends elsewhere', () => {
  const result = evaluateForegroundSampleContinuity(
    sample({ focusedAtEnd: false, interruptionCount: 1 }),
  );
  assert.equal(result.foregroundThroughout, true);
  assert.equal(result.focusInterrupted, true);
  assert.equal(result.focusInterruptionCount, 1);
  assert.equal(result.hiddenObserved, false);
});

test('rejects hidden samples and unfocused boundaries', () => {
  for (const input of [
    { visibleThroughout: false },
    { visibleAtStart: false },
    { visibleAtEnd: false },
    { focusedAtStart: false },
  ])
    assert.equal(
      evaluateForegroundSampleContinuity(sample(input)).foregroundThroughout,
      false,
    );
});

test('rejects missing continuity evidence', () => {
  assert.deepEqual(evaluateForegroundSampleContinuity({}), {
    schema: 'gev-performance-foreground-continuity/v1',
    foregroundThroughout: false,
    focusInterrupted: false,
    focusInterruptionCount: null,
    hiddenObserved: false,
  });
});
