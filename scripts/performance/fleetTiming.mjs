import assert from 'node:assert/strict';

function distribution(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return {
    count: sorted.length,
    medianMs: sorted[Math.floor(sorted.length / 2)],
    p95Ms: sorted[Math.floor(sorted.length * 0.95)],
    maxMs: sorted.at(-1),
    totalMs: sorted.reduce((sum, value) => sum + value, 0),
  };
}

/** Observed JS/wall timings only. These instrumented samples are not an acceptance benchmark. */
export function summarizeFleetTiming(trace) {
  assert.equal(trace?.truncated, false, 'Incomplete timing trace');
  assert.ok(
    Number.isInteger(trace.maxEvents) &&
      trace.maxEvents > 0 &&
      trace.maxEvents <= 20000,
  );
  assert.ok(
    Array.isArray(trace.events) && trace.events.length <= trace.maxEvents,
  );
  assert.equal(trace.events[0]?.kind, 'start');
  assert.equal(trace.events.at(-1)?.kind, 'stop');
  const methods = ['initializeFrame', 'render', 'requestRender'];
  const phases = ['preUpdate', 'postUpdate', 'preRender', 'postRender'];
  const allowed = new Set([
    'start',
    'stop',
    ...phases,
    'timer-scheduled',
    'timer-start',
    'timer-end',
    'timer-cancelled',
    ...methods.flatMap((m) => [`${m}-start`, `${m}-end`]),
  ]);
  const timers = new Map();
  const samples = Object.fromEntries(
    [...methods, 'updateCallbacks', 'renderSubmission'].map((key) => [key, []]),
  );
  const starts = new Map();
  const delays = { 'render-governor': [], other: [] };
  const timerCpu = { 'render-governor': [], other: [] };
  const postRenderTimes = [];
  let previous = 0;
  for (const event of trace.events) {
    assert.ok(allowed.has(event.kind), 'Unknown timing event');
    assert.ok(
      Number.isFinite(event.at) && event.at >= previous,
      'Invalid timing event order',
    );
    previous = event.at;
    if (event.kind === 'timer-scheduled') {
      assert.ok(
        Number.isInteger(event.id) && event.id > 0 && !timers.has(event.id),
        'Duplicate or invalid timer identity',
      );
      assert.ok(Object.hasOwn(delays, event.owner), 'Unknown timer owner');
      assert.ok(
        Number.isFinite(event.dueAt) &&
          Number.isFinite(event.scheduledAt) &&
          event.dueAt >= event.scheduledAt &&
          event.scheduledAt >= 0,
      );
      timers.set(event.id, { ...event, state: 'pending' });
    } else if (event.kind.startsWith('timer-')) {
      const timer = timers.get(event.id);
      assert.ok(timer, 'Unknown timer identity');
      if (event.kind === 'timer-start') {
        assert.equal(timer.state, 'pending');
        timer.state = 'running';
        timer.startedAt = event.at;
        // Browsers may round timer delays. Retain signed lateness instead of
        // silently treating an early callback as a zero-delay observation.
        delays[timer.owner].push(event.at - timer.dueAt);
      } else if (event.kind === 'timer-end') {
        assert.equal(timer.state, 'running');
        timer.state = 'finished';
        timerCpu[timer.owner].push(event.at - timer.startedAt);
      } else {
        assert.equal(timer.state, 'pending');
        timer.state = 'cancelled';
      }
    }
    for (const [key, first, last] of [
      ...methods.map((m) => [m, `${m}-start`, `${m}-end`]),
      ['updateCallbacks', 'preUpdate', 'postUpdate'],
      ['renderSubmission', 'preRender', 'postRender'],
    ]) {
      if (event.kind === first) {
        const stack = starts.get(key) || [];
        stack.push(event.at);
        starts.set(key, stack);
      } else if (event.kind === last) {
        const start = starts.get(key)?.pop();
        assert.ok(start !== undefined, `Unmatched ${event.kind}`);
        samples[key].push(event.at - start);
      }
    }
    if (event.kind === 'postRender') postRenderTimes.push(event.at);
  }
  return {
    scope:
      'Instrumented attribution only; overlapping CPU spans must not be added. Render submission is not GPU execution time. Frame intervals include intentional idle.',
    durationMs: previous,
    eventCount: trace.events.length,
    synchronousSpansMs: Object.fromEntries(
      Object.entries(samples).map(([k, v]) => [k, distribution(v)]),
    ),
    timerLatenessMs: Object.fromEntries(
      Object.entries(delays).map(([k, v]) => [k, distribution(v)]),
    ),
    timerCallbackCpuMs: Object.fromEntries(
      Object.entries(timerCpu).map(([k, v]) => [k, distribution(v)]),
    ),
    renderedFrameIntervalsMs: distribution(
      postRenderTimes.slice(1).map((at, i) => at - postRenderTimes[i]),
    ),
    renderedFrames: postRenderTimes.length,
    unfinishedSpans: Object.fromEntries(
      [...starts].filter(([, v]) => v.length).map(([k, v]) => [k, v.length]),
    ),
    timersPendingAtStop: [...timers.values()].filter(
      (t) => t.state === 'pending',
    ).length,
    gpuExecutionMs: null,
  };
}
