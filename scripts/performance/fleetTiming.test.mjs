import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeFleetTiming } from './fleetTiming.mjs';
import { validateFleetComparison } from './fleetComparison.mjs';

function trace() {
  return {
    maxEvents: 20000,
    truncated: false,
    events: [
      { kind: 'start', at: 0 },
      {
        kind: 'timer-scheduled',
        at: 0,
        id: 1,
        owner: 'render-governor',
        scheduledAt: 0,
        dueAt: 80,
      },
      { kind: 'initializeFrame-start', at: 80 },
      { kind: 'initializeFrame-end', at: 84 },
      { kind: 'timer-start', at: 85, id: 1 },
      { kind: 'timer-end', at: 86, id: 1 },
      { kind: 'render-start', at: 87 },
      { kind: 'preUpdate', at: 88 },
      { kind: 'postUpdate', at: 90 },
      { kind: 'preRender', at: 91 },
      { kind: 'postRender', at: 95 },
      { kind: 'render-end', at: 97 },
      { kind: 'stop', at: 100 },
    ],
  };
}
test('summarizes timer delays separately from synchronous update and render work', () => {
  const result = summarizeFleetTiming(trace());
  assert.equal(result.timerLatenessMs['render-governor'].medianMs, 5);
  assert.equal(result.timerCallbackCpuMs['render-governor'].medianMs, 1);
  assert.equal(result.synchronousSpansMs.initializeFrame.medianMs, 4);
  assert.equal(result.synchronousSpansMs.render.medianMs, 10);
  assert.equal(result.synchronousSpansMs.updateCallbacks.medianMs, 2);
  assert.equal(result.synchronousSpansMs.renderSubmission.medianMs, 4);
  assert.equal(result.gpuExecutionMs, null);
  assert.equal(result.timerLatenessMs.other, null);
  assert.equal(result.renderedFrameIntervalsMs, null);
});
test('rejects truncated, malformed and incomplete timing evidence', () => {
  for (const mutate of [
    (t) => {
      t.truncated = true;
    },
    (t) => {
      t.events.pop();
    },
    (t) => {
      t.events[2].at = -1;
    },
    (t) => {
      t.events[4].id = 55;
    },
    (t) => {
      t.events[1].owner = 'unknown';
    },
    (t) => {
      t.events[3].kind = 'unsupported';
    },
  ]) {
    const t = trace();
    mutate(t);
    assert.throws(() => summarizeFleetTiming(t));
  }
});
test('performance acceptance refuses an instrumented diagnostic report', async () => {
  await assert.rejects(
    validateFleetComparison({ diagnosticOnly: true }),
    /Instrumented diagnostics/,
  );
});
