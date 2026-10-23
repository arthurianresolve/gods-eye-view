import { runBoundedBoundaryProfile } from './boundedCpuProfile.mjs';

export const STARTUP_CPU_ATTRIBUTION_SCHEMA =
  'gev-startup-cpu-attribution-diagnostic/v1';
export const STARTUP_CPU_PROFILE_MAX_WINDOW_MS = 30_000;

export function assertStartupCpuAttributionMode({
  enabled,
  startupOnlyShard,
  startupAttributionEnabled,
  startupPageObservedEnabled,
  firstMotionCpuProfileEnabled,
  artifactDirectory,
} = {}) {
  if (enabled && (!startupOnlyShard || !startupAttributionEnabled))
    throw new TypeError(
      '--startup-cpu-profile requires --startup-only-shard and --startup-attribution.',
    );
  if (enabled && startupPageObservedEnabled)
    throw new TypeError(
      '--startup-cpu-profile cannot be combined with --startup-page-observed-v1.',
    );
  if (enabled && firstMotionCpuProfileEnabled)
    throw new TypeError(
      '--startup-cpu-profile cannot be combined with --first-motion-cpu-profile.',
    );
  if (enabled && !artifactDirectory)
    throw new TypeError(
      '--startup-cpu-profile requires --cpu-profile-artifact-directory.',
    );
  if (!enabled && firstMotionCpuProfileEnabled === false && artifactDirectory)
    throw new TypeError(
      '--cpu-profile-artifact-directory requires a CPU profile mode.',
    );
  return enabled === true;
}

function boundedElapsed(value) {
  return Number.isFinite(value) && value >= 0
    ? Math.round(value * 10) / 10
    : null;
}

function projectBoundary(boundary) {
  if (!boundary || typeof boundary !== 'object') return null;
  return {
    pageObservedMsFromNavigationStart: boundedElapsed(
      boundary.pageObservedMsFromNavigationStart,
    ),
    hostObservedElapsedMs: boundedElapsed(boundary.hostObservedElapsedMs),
  };
}

/**
 * Starts a bounded CDP CPU profile before navigation. The caller must finish
 * this window immediately after the viewer and loading-screen boundaries are
 * both observed. The profiler never changes capture eligibility.
 */
export async function beginStartupCpuAttribution({
  page,
  artifactDirectory,
  fileName = 'startup-navigation-ready-cpu-profile.json',
  profileRunner = runBoundedBoundaryProfile,
  maxWindowMs = STARTUP_CPU_PROFILE_MAX_WINDOW_MS,
  operationTimeoutMs = 2_000,
} = {}) {
  if (!page || typeof page.createCDPSession !== 'function')
    throw new TypeError(
      'Startup CPU profile requires an owned Puppeteer page.',
    );
  if (typeof artifactDirectory !== 'string' || !artifactDirectory)
    throw new TypeError('Startup CPU profile artifact directory is required.');
  if (!/^[a-z0-9][a-z0-9-]{0,80}\.json$/.test(fileName))
    throw new TypeError('Startup CPU profile filename is invalid.');
  if (
    !Number.isInteger(maxWindowMs) ||
    maxWindowMs < 1 ||
    maxWindowMs > STARTUP_CPU_PROFILE_MAX_WINDOW_MS
  )
    throw new TypeError('Startup CPU profile window exceeds its fixed bound.');

  let releaseOperation;
  let signalStarted;
  let startSignaled = false;
  let finished = false;
  let finishPromise = null;
  const operationGate = new Promise((resolve) => {
    releaseOperation = resolve;
  });
  const started = new Promise((resolve) => {
    signalStarted = resolve;
  });
  const signalStart = (profilerStarted) => {
    if (startSignaled) return;
    startSignaled = true;
    signalStarted({ profilerStarted: profilerStarted === true });
  };
  const profilePromise = Promise.resolve()
    .then(() =>
      profileRunner({
        page,
        label: 'startup navigation through viewer and loading-screen readiness',
        artifactDirectory,
        fileName,
        operation: () => operationGate,
        maxWindowMs,
        operationTimeoutMs,
        onStarted: ({ profilerStarted }) => signalStart(profilerStarted),
      }),
    )
    .then(
      (result) => ({ ok: true, result }),
      (error) => {
        signalStart(false);
        return { ok: false, error };
      },
    );

  return {
    started,
    async finish({ outcome, viewerBoundary, loadingHiddenBoundary } = {}) {
      if (finishPromise) return finishPromise;
      if (finished)
        throw new Error('Startup CPU profile was already finished.');
      finished = true;
      const finishRequestedAtMs = Date.now();
      releaseOperation({ outcome: outcome === 'ready' ? 'ready' : 'failed' });
      finishPromise = profilePromise.then(({ ok, result, error }) => {
        const profile = ok ? result?.profile || null : null;
        return {
          schema: STARTUP_CPU_ATTRIBUTION_SCHEMA,
          diagnosticOnly: true,
          performanceAcceptanceEligible: false,
          scope:
            'sampled main-thread CPU stacks from before startup navigation through the loading-screen-hidden observation; CDP stop and bounded profile persistence follow that boundary, add overhead, and are diagnostic only',
          outcome: outcome === 'ready' ? 'ready' : 'failed',
          status:
            outcome === 'ready' && profile?.status === 'complete'
              ? 'complete'
              : 'incomplete',
          boundaries: {
            viewerExistence: projectBoundary(viewerBoundary),
            loadingScreenHidden: projectBoundary(loadingHiddenBoundary),
          },
          profilerStopAndPersistenceElapsedMs: boundedElapsed(
            Date.now() - finishRequestedAtMs,
          ),
          ...(profile ? { profile } : {}),
          ...(!ok
            ? { profileErrorName: String(error?.name || 'Error').slice(0, 80) }
            : {}),
        };
      });
      return finishPromise;
    },
  };
}
