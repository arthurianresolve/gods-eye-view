const FRESH_HEALTH_MS = 5 * 60_000;

function fresh(timestamp, health, now) {
  const expiryMs =
    Number.isFinite(health?.refreshIntervalMs) && health.refreshIntervalMs > 0
      ? health.refreshIntervalMs * 3
      : FRESH_HEALTH_MS;
  return (
    Number.isFinite(timestamp) && now >= timestamp && now - timestamp < expiryMs
  );
}

/** Return whether a health observation is recent enough to guide automation. */
export function isFreshCameraHealth(health, now = Date.now()) {
  return fresh(health?.updatedAt, health, now);
}

/** Expire proxy and browser decode conclusions independently, retaining timestamps. */
export function currentCameraHealth(health, now = Date.now()) {
  if (!health) return null;
  const proxyFresh = isFreshCameraHealth(health, now);
  return {
    ...health,
    status: proxyFresh ? health.status : 'stale',
    reasonCode: proxyFresh ? health.reasonCode : 'stale-health',
    decodeStatus: fresh(health.decodeAttemptedAt, health, now)
      ? health.decodeStatus
      : 'unknown',
    decodeReason: fresh(health.decodeAttemptedAt, health, now)
      ? health.decodeReason
      : 'unknown',
  };
}

/** Known placeholder/failure states are excluded from automatic camera choice. */
export function isCameraEligibleForAutoSelection(health, now = Date.now()) {
  if (
    fresh(health?.decodeAttemptedAt, health, now) &&
    health.decodeStatus === 'failed'
  )
    return false;
  if (!health || !isFreshCameraHealth(health, now)) return true;
  if (['unavailable', 'degraded'].includes(health.status)) return false;
  if (
    [
      'synthetic-placeholder',
      'known-placeholder',
      'upstream-failure',
      'upstream-timeout',
      'decode-failure',
    ].includes(health.reasonCode)
  )
    return false;
  return true;
}

/** Healthy fresh delivery wins equal-distance ties without hiding unknown state. */
export function cameraHealthRank(health, now = Date.now()) {
  if (!isCameraEligibleForAutoSelection(health, now)) return 2;
  if (isFreshCameraHealth(health, now) && health.status === 'ok') return 0;
  if (!health || !isFreshCameraHealth(health, now)) return 1;
  return 2;
}
