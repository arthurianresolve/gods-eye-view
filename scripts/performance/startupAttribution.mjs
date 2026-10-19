import assert from 'node:assert/strict';

export const STARTUP_ATTRIBUTION_SCHEMA =
  'gev-startup-attribution-diagnostic/v1';

const TIMESTAMP_KEYS = Object.freeze([
  'navigationCompletedAtMs',
  'foregroundStartedAtMs',
  'foregroundCompletedAtMs',
  'viewerWaitStartedAtMs',
  'viewerObservedAtMs',
  'diagnosticsDisableStartedAtMs',
  'diagnosticsDisableCompletedAtMs',
  'loaderWaitStartedAtMs',
  'loaderHiddenObservedAtMs',
]);

export function assertStartupAttributionMode({
  enabled,
  startupOnlyShard,
} = {}) {
  if (enabled && !startupOnlyShard)
    throw new TypeError(
      '--startup-attribution requires --startup-only-shard and is diagnostic-only.',
    );
  return enabled === true;
}

function finiteTimestamp(value, key) {
  assert.ok(Number.isFinite(value), `${key} must be a finite host timestamp`);
  return value;
}

function boundedNavigationTiming(value) {
  const keys = [
    'startTime',
    'duration',
    'responseStart',
    'domInteractive',
    'domContentLoadedEventEnd',
    'loadEventEnd',
    'domComplete',
  ];
  return Object.fromEntries(
    keys.map((key) => [key, Number.isFinite(value?.[key]) ? value[key] : null]),
  );
}

function boundedStrings(values, { maxItems, maxLength }) {
  if (!Array.isArray(values)) return { values: null, omittedCount: 0 };
  const selected = values
    .slice(0, maxItems)
    .map((value) => String(value).slice(0, maxLength));
  return {
    values: selected,
    omittedCount: Math.max(0, values.length - selected.length),
  };
}

export function createStartupAttribution({
  startedAtMs,
  navigationCompletedAtMs,
  foregroundStartedAtMs,
  foregroundCompletedAtMs,
  viewerWaitStartedAtMs,
  viewerObservedAtMs,
  diagnosticsDisableStartedAtMs,
  diagnosticsDisableCompletedAtMs,
  loaderWaitStartedAtMs,
  loaderHiddenObservedAtMs,
  navigationTiming,
  locale,
  navigatorLanguages,
  enabledLayerIds,
} = {}) {
  const times = {
    startedAtMs,
    navigationCompletedAtMs,
    foregroundStartedAtMs,
    foregroundCompletedAtMs,
    viewerWaitStartedAtMs,
    viewerObservedAtMs,
    diagnosticsDisableStartedAtMs,
    diagnosticsDisableCompletedAtMs,
    loaderWaitStartedAtMs,
    loaderHiddenObservedAtMs,
  };
  for (const [key, value] of Object.entries(times)) finiteTimestamp(value, key);
  let previous = startedAtMs;
  for (const key of TIMESTAMP_KEYS) {
    assert.ok(
      times[key] >= previous,
      `${key} must not precede the prior boundary`,
    );
    previous = times[key];
  }
  assert.ok(foregroundCompletedAtMs >= foregroundStartedAtMs);
  assert.ok(diagnosticsDisableCompletedAtMs >= diagnosticsDisableStartedAtMs);

  const languages = boundedStrings(navigatorLanguages, {
    maxItems: 8,
    maxLength: 32,
  });
  const layers = boundedStrings(enabledLayerIds, {
    maxItems: 64,
    maxLength: 64,
  });
  return {
    schema: STARTUP_ATTRIBUTION_SCHEMA,
    diagnosticOnly: true,
    clock: 'host-Date.now; navigationTiming is page performance entry',
    hostBoundaries: {
      startedAtMs,
      navigationCompletedAtMs,
      foregroundActivation: {
        startedAtMs: foregroundStartedAtMs,
        completedAtMs: foregroundCompletedAtMs,
        elapsedMs: foregroundCompletedAtMs - foregroundStartedAtMs,
      },
      viewerExistence: {
        waitStartedAtMs: viewerWaitStartedAtMs,
        observedAtMs: viewerObservedAtMs,
        elapsedFromStartMs: viewerObservedAtMs - startedAtMs,
      },
      diagnosticsDisable: {
        startedAtMs: diagnosticsDisableStartedAtMs,
        completedAtMs: diagnosticsDisableCompletedAtMs,
        elapsedMs:
          diagnosticsDisableCompletedAtMs - diagnosticsDisableStartedAtMs,
      },
      loadingScreenHidden: {
        waitStartedAtMs: loaderWaitStartedAtMs,
        observedAtMs: loaderHiddenObservedAtMs,
        elapsedFromStartMs: loaderHiddenObservedAtMs - startedAtMs,
      },
    },
    navigationTiming: boundedNavigationTiming(navigationTiming),
    pageState: {
      locale: typeof locale === 'string' ? locale.slice(0, 32) : null,
      navigatorLanguages: languages.values,
      omittedNavigatorLanguageCount: languages.omittedCount,
      enabledLayerIds: layers.values,
      omittedEnabledLayerIdCount: layers.omittedCount,
    },
  };
}

/** Browser-serializable, bounded page-state read at the existing settled point. */
export function readStartupAttributionPageState() {
  const app = globalThis.window?.__godsEyeView;
  const navigation = performance.getEntriesByType('navigation')[0];
  const layers = app?.dataManager?.getAll?.() || [];
  return {
    locale: document.documentElement?.lang || null,
    navigatorLanguages: Array.isArray(navigator.languages)
      ? navigator.languages.slice(0, 9)
      : null,
    enabledLayerIds: layers
      .filter((layer) => layer?.enabled === true)
      .map((layer) => layer.id)
      .slice(0, 65),
    navigationTiming: navigation
      ? {
          startTime: navigation.startTime,
          duration: navigation.duration,
          responseStart: navigation.responseStart,
          domInteractive: navigation.domInteractive,
          domContentLoadedEventEnd: navigation.domContentLoadedEventEnd,
          loadEventEnd: navigation.loadEventEnd,
          domComplete: navigation.domComplete,
        }
      : null,
  };
}
