import assert from 'node:assert/strict';

export const LEGACY_STARTUP_METHOD = 'host-end-to-end-after-navigation-v1';
export const LEGACY_STARTUP_MEASUREMENT =
  'navigation-to-viewer-existence-and-loading-screen-hidden';
export const PAGE_OBSERVED_STARTUP_METHOD = 'page-observed-after-foreground-v1';
export const PAGE_OBSERVED_STARTUP_MEASUREMENT =
  'navigation-to-page-observed-viewer-and-loader-hidden';
export const PAGE_OBSERVED_STARTUP_SCHEMA =
  'gev-page-observed-startup-timing/v1';
export const PAGE_OBSERVED_STARTUP_SEMANTICS =
  'performance.now at first page predicate observation; an upper bound on state availability, not exact publication or first visible render; page and host clocks are validated independently';

export function assertStartupObservationMode({
  enabled = false,
  startupOnlyShard = false,
  startupAttributionEnabled = false,
} = {}) {
  if (enabled && !startupOnlyShard)
    throw new TypeError(
      '--startup-page-observed-v1 requires --startup-only-shard.',
    );
  if (enabled && startupAttributionEnabled)
    throw new TypeError(
      '--startup-page-observed-v1 cannot be combined with --startup-attribution.',
    );
  return enabled === true;
}

export function effectiveStartupMethod(plan) {
  return plan?.startupMethod || LEGACY_STARTUP_METHOD;
}

export function validatePageObservedStartupTiming(startup, observation) {
  assert.equal(startup?.method, PAGE_OBSERVED_STARTUP_METHOD);
  assert.equal(startup?.measurement, PAGE_OBSERVED_STARTUP_MEASUREMENT);
  assert.equal(startup?.timingEvidence?.schema, PAGE_OBSERVED_STARTUP_SCHEMA);
  assert.equal(
    startup?.timingEvidence?.semantics,
    PAGE_OBSERVED_STARTUP_SEMANTICS,
  );

  const evidence = startup.timingEvidence;
  const finitePositive = (value, label) =>
    assert.ok(Number.isFinite(value) && value > 0, `${label} must be positive`);
  for (const key of [
    'navigationStartedAtMs',
    'navigationCompletedAtMs',
    'viewerWaitStartedAtMs',
    'viewerObservedAtMs',
    'diagnosticsDisableStartedAtMs',
    'diagnosticsDisableCompletedAtMs',
    'loaderWaitStartedAtMs',
    'loaderHiddenObservedAtMs',
  ])
    finitePositive(evidence.hostBoundaries?.[key], `hostBoundaries.${key}`);

  const host = evidence.hostBoundaries;
  assert.ok(
    host.navigationStartedAtMs <= host.navigationCompletedAtMs &&
      host.navigationCompletedAtMs <= host.viewerWaitStartedAtMs &&
      host.navigationCompletedAtMs <= host.loaderWaitStartedAtMs &&
      host.viewerWaitStartedAtMs <= host.viewerObservedAtMs &&
      host.loaderWaitStartedAtMs <= host.loaderHiddenObservedAtMs &&
      host.viewerObservedAtMs <= host.diagnosticsDisableStartedAtMs &&
      host.loaderHiddenObservedAtMs <= host.diagnosticsDisableStartedAtMs &&
      host.diagnosticsDisableStartedAtMs <=
        host.diagnosticsDisableCompletedAtMs,
    'Host startup observation boundaries are out of order',
  );

  const foreground = evidence.preNavigationForeground;
  finitePositive(
    foreground?.startedAtMs,
    'preNavigationForeground.startedAtMs',
  );
  finitePositive(
    foreground?.completedAtMs,
    'preNavigationForeground.completedAtMs',
  );
  finitePositive(foreground?.elapsedMs, 'preNavigationForeground.elapsedMs');
  assert.ok(foreground.startedAtMs <= foreground.completedAtMs);
  assert.equal(
    foreground.elapsedMs,
    foreground.completedAtMs - foreground.startedAtMs,
  );
  assert.ok(
    foreground.completedAtMs <= host.navigationStartedAtMs,
    'Owned page foreground must be confirmed before navigation timing starts',
  );
  assert.equal(foreground.activation?.visible, true);
  assert.equal(foreground.activation?.focused, true);
  assert.equal(foreground.activation?.visibilityState, 'visible');
  assert.equal(
    foreground.activation?.hostWindowActivation?.status,
    'foreground-confirmed',
  );
  assert.equal(
    foreground.activation?.hostWindowActivation?.foregroundConfirmed,
    true,
  );
  assert.deepEqual(
    foreground.activation,
    observation?.foregroundActivation,
    'Pre-navigation foreground receipt must match the startup observation',
  );

  const page = evidence.pageObserved;
  finitePositive(
    page?.viewerExistenceMsFromNavigationStart,
    'page viewer time',
  );
  finitePositive(
    page?.loadingScreenHiddenMsFromNavigationStart,
    'page loader time',
  );
  assert.equal(
    observation?.appReadyMs,
    page.viewerExistenceMsFromNavigationStart,
  );
  assert.equal(
    observation?.initialSettleMs,
    page.loadingScreenHiddenMsFromNavigationStart,
  );

  const hostObserved = evidence.hostObserved;
  finitePositive(
    hostObserved?.viewerExistenceMsFromNavigationStart,
    'host-observed viewer time',
  );
  finitePositive(
    hostObserved?.loadingScreenHiddenMsFromNavigationStart,
    'host-observed loader time',
  );
  assert.equal(
    hostObserved.viewerExistenceMsFromNavigationStart,
    host.viewerObservedAtMs - host.navigationStartedAtMs,
    'Host-observed viewer duration must match host-clock boundaries',
  );
  assert.equal(
    hostObserved.loadingScreenHiddenMsFromNavigationStart,
    host.loaderHiddenObservedAtMs - host.navigationStartedAtMs,
    'Host-observed loader duration must match host-clock boundaries',
  );
  for (const key of ['viewerForeground', 'loaderHiddenForeground']) {
    assert.equal(page[key]?.visible, true, `${key} must be visible`);
    assert.equal(page[key]?.focused, true, `${key} must be focused`);
    assert.equal(
      page[key]?.visibilityState,
      'visible',
      `${key} visibilityState must be visible`,
    );
    finitePositive(
      page[key]?.observedMsFromNavigationStart,
      `${key}.observedMsFromNavigationStart`,
    );
  }
  assert.deepEqual(
    page.viewerForeground.observedMsFromNavigationStart,
    page.viewerExistenceMsFromNavigationStart,
  );
  assert.deepEqual(
    page.loaderHiddenForeground.observedMsFromNavigationStart,
    page.loadingScreenHiddenMsFromNavigationStart,
  );
  assert.equal(evidence.finalPageState?.visible, true);
  assert.equal(evidence.finalPageState?.focused, true);
  assert.deepEqual(
    observation?.finalPageState,
    evidence.finalPageState,
    'Final visible/focused proof must match the terminal page observation',
  );
  return true;
}
