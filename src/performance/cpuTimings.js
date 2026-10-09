const MAX_SERIES = 128;
const MAX_SAMPLES = 120;
const identifier = /^[a-z0-9_-]{1,64}$/i;
let session = null;

/** Opt-in local CPU diagnostics; disabled calls do not sample the clock. */
export function setCpuTimingsEnabled(
  enabled,
  { now = () => performance.now() } = {},
) {
  session = enabled ? { now, series: new Map(), overflow: false } : null;
}

export function beginCpuTiming(owner, phase) {
  if (!session || !identifier.test(owner) || !identifier.test(phase))
    return null;
  return { session, owner, phase, at: session.now() };
}

export function endCpuTiming(span) {
  if (!span || span.session !== session) return;
  const duration = session.now() - span.at;
  if (!Number.isFinite(duration) || duration < 0) return;
  const key = `${span.owner}:${span.phase}`;
  let row = session.series.get(key);
  if (!row) {
    if (session.series.size >= MAX_SERIES) {
      session.overflow = true;
      return;
    }
    row = {
      owner: span.owner,
      phase: span.phase,
      count: 0,
      totalMs: 0,
      maxMs: 0,
      samples: [],
    };
    session.series.set(key, row);
  }
  row.samples[row.count % MAX_SAMPLES] = duration;
  row.count += 1;
  row.totalMs += duration;
  row.maxMs = Math.max(row.maxMs, duration);
}

/** Synchronous application work only; promise wait and GPU execution are excluded. */
export function getCpuTimings() {
  if (!session) return null;
  return {
    enabled: true,
    overflow: session.overflow,
    scope: 'synchronous-application-cpu',
    series: [...session.series.values()]
      .map(({ samples, ...row }) => {
        const ordered = [...samples].sort((a, b) => a - b);
        return {
          ...row,
          sampleCount: ordered.length,
          p50Ms: ordered[Math.ceil(ordered.length * 0.5) - 1],
          p95Ms: ordered[Math.ceil(ordered.length * 0.95) - 1],
        };
      })
      .sort((a, b) => b.totalMs - a.totalMs),
  };
}
