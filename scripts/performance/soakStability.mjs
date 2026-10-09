export const FULL_SOAK_MS = 60 * 60_000;
const RETENTION_WINDOW_MS = 30 * 60_000;

function resourceCounts(metrics) {
  const resources = metrics?.application?.resources;
  if (!resources?.ownerResources) return null;
  const counts = {};
  for (const [key, value] of Object.entries(resources)) {
    if (typeof value === 'number' && Number.isFinite(value))
      counts[key] = value;
  }
  for (const [owner, owned] of Object.entries(resources.ownerResources)) {
    for (const [key, value] of Object.entries(owned)) {
      if (typeof value === 'number' && Number.isFinite(value))
        counts[`${owner}.${key}`] = value;
    }
  }
  return counts;
}

/** Conservative acceptance, independent of successful UI operation counts. */
export function evaluateSoakStability({ durationMs, checkpoints = [] }) {
  const failures = [],
    pending = [];
  if (!Number.isFinite(durationMs) || durationMs < FULL_SOAK_MS)
    pending.push('Requires a 60-minute run.');
  const first = checkpoints[0];
  const last = checkpoints.at(-1);
  const baseline = resourceCounts(first?.metrics);
  if (!baseline || !Object.keys(baseline).length)
    pending.push('Application-owned resource baseline is unavailable.');
  else {
    for (const point of checkpoints.slice(1)) {
      const current = resourceCounts(point.metrics);
      if (!current || Object.keys(baseline).some((key) => !(key in current))) {
        pending.push('Application resource checkpoint is incomplete.');
        continue;
      }
      for (const [key, value] of Object.entries(current)) {
        if (value > (baseline[key] ?? 0))
          failures.push(
            `Resource ${key} grew from ${baseline[key] ?? 0} to ${value} at ${point.elapsedMs} ms.`,
          );
      }
    }
  }
  // Include the last checkpoint at or before the start of the final 30 minutes.
  const startIndex = checkpoints.findLastIndex(
    (point) => point.elapsedMs <= (last?.elapsedMs ?? 0) - RETENTION_WINDOW_MS,
  );
  const window = startIndex >= 0 ? checkpoints.slice(startIndex) : [];
  let heapGrowthRatio = null;
  if (
    window.length < 4 ||
    window.some(
      (p, index) =>
        !(p.metrics?.JSHeapUsedSize > 0) ||
        (index > 0 && p.elapsedMs - window[index - 1].elapsedMs > 10 * 60_000),
    )
  )
    pending.push('Final 30-minute post-GC heap checkpoints are unavailable.');
  else {
    const startHeap = window[0].metrics.JSHeapUsedSize;
    heapGrowthRatio = (last.metrics.JSHeapUsedSize - startHeap) / startHeap;
    const peakGrowth = Math.max(
      ...window.map((p) => p.metrics.JSHeapUsedSize / startHeap - 1),
    );
    if (peakGrowth > 0.05)
      failures.push(
        'Retained heap exceeded 5% growth over the final 30-minute window.',
      );
  }
  const listeners = window.map((p) => p.metrics?.JSEventListeners);
  if (listeners.length >= 4 && listeners.every(Number.isFinite)) {
    const changes = listeners.slice(1).map((value, i) => value - listeners[i]);
    if (
      changes.every((delta) => delta >= 0) &&
      changes.filter((delta) => delta > 0).length >= 3
    )
      failures.push(
        'Browser listener counts retain a persistent upward trend; attribution is required.',
      );
  } else
    pending.push(
      'Final 30-minute browser listener checkpoints are unavailable.',
    );
  return {
    status: failures.length ? 'failed' : pending.length ? 'pending' : 'passed',
    failures: [...new Set(failures)],
    pending: [...new Set(pending)],
    heapGrowthRatio,
  };
}
