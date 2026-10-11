/** Summarize Chromium's shutdown category without retaining trace arguments. */
export function summarizeShutdownTrace(trace) {
  if (!Array.isArray(trace?.traceEvents) || trace.traceEvents.length > 100_000)
    throw new Error('Shutdown trace events are missing or exceed the bound.');
  const stacks = new Map();
  const spans = [];
  let events = 0;
  let unmatchedEnds = 0;
  for (const event of trace.traceEvents) {
    if (
      !String(event?.cat || '')
        .split(',')
        .includes('shutdown')
    )
      continue;
    if (
      !Number.isFinite(event.ts) ||
      !Number.isSafeInteger(event.pid) ||
      !Number.isSafeInteger(event.tid)
    )
      throw new Error(
        'Invalid shutdown trace timestamp or process/thread identity.',
      );
    events++;
    const key = `${event.pid}:${event.tid}`;
    const stack = stacks.get(key) || [];
    const safe = {
      name: String(event.name || '(unnamed)').slice(0, 160),
      processId: event.pid,
      threadId: event.tid,
      startedAtUs: event.ts,
    };
    if (event.ph === 'X') {
      if (!Number.isFinite(event.dur) || event.dur < 0)
        throw new Error('Invalid shutdown trace duration.');
      spans.push({ ...safe, durationMs: event.dur / 1000 });
    } else if (event.ph === 'B') {
      stack.push(safe);
      stacks.set(key, stack);
    } else if (event.ph === 'E') {
      const begin = stack.pop();
      if (!begin) unmatchedEnds++;
      else if (event.ts < begin.startedAtUs)
        throw new Error('Shutdown trace end precedes begin.');
      else
        spans.push({
          ...begin,
          durationMs: (event.ts - begin.startedAtUs) / 1000,
        });
    }
  }
  const openSpans = [...stacks.values()].reduce(
    (count, stack) => count + stack.length,
    0,
  );
  return {
    schema: 'gev-chromium-shutdown-attribution/v1',
    scope:
      'Chromium shutdown-category wall intervals; nested spans overlap; tracing may affect timing; not application performance acceptance',
    status: events ? 'observed' : 'unavailable',
    shutdownEventCount: events,
    completedSpanCount: spans.length,
    openSpans,
    unmatchedEnds,
    longestSpans: spans
      .sort((a, b) => b.durationMs - a.durationMs)
      .slice(0, 40),
    truncatedSpans: Math.max(0, spans.length - 40),
    traceArgumentsRetained: false,
  };
}
