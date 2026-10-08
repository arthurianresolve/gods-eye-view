const FRESH_HEALTH_MS = 5 * 60_000;

/** Return whether a health observation is recent enough to guide automation. */
export function isFreshCameraHealth(health, now = Date.now()) {
  return (
    Number.isFinite(health?.updatedAt) &&
    now - health.updatedAt <= FRESH_HEALTH_MS
  );
}

/** Known placeholder/failure states are excluded from automatic camera choice. */
export function isCameraEligibleForAutoSelection(health, now = Date.now()) {
  if (!health || !isFreshCameraHealth(health, now)) return true;
  if (['unavailable', 'degraded'].includes(health.status)) return false;
  if (
    [
      'synthetic-placeholder',
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
  if (isFreshCameraHealth(health, now) && health.status === 'ok') return 0;
  if (!health || !isFreshCameraHealth(health, now)) return 1;
  return 2;
}
