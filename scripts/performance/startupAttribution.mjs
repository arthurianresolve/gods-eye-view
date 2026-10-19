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
const RESOURCE_TIMING_LIMIT = 256;
const RESOURCE_INITIATOR_TYPES = Object.freeze([
  'css',
  'fetch',
  'img',
  'link',
  'script',
  'xmlhttprequest',
  'other',
]);
const RESOURCE_PROVIDER_CLASSES = Object.freeze([
  'sameOriginAssets',
  'tokenApi',
  'google',
  'cesium',
  'esri',
  'reearth',
  'osm',
  'otherSameOrigin',
  'otherCrossOrigin',
  'unknown',
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

function boundedCount(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function boundedBytes(value) {
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : null;
}

function boundedResourceTimingSummary(value) {
  if (!value || typeof value !== 'object') return null;
  const initiatorCounts = Object.fromEntries(
    RESOURCE_INITIATOR_TYPES.map((type) => [
      type,
      boundedCount(value.initiatorCounts?.[type]),
    ]),
  );
  const providerClasses = Object.fromEntries(
    RESOURCE_PROVIDER_CLASSES.map((providerClass) => {
      const valueForClass = value.providerClasses?.[providerClass];
      return [
        providerClass,
        {
          count: boundedCount(valueForClass?.count),
          durationAvailableCount: boundedCount(
            valueForClass?.durationAvailableCount,
          ),
          maxDurationMs: Number.isFinite(valueForClass?.maxDurationMs)
            ? Math.max(0, valueForClass.maxDurationMs)
            : null,
          latestResponseEndMs: Number.isFinite(
            valueForClass?.latestResponseEndMs,
          )
            ? Math.max(0, valueForClass.latestResponseEndMs)
            : null,
        },
      ];
    }),
  );
  return {
    source: 'performance-resource-timing',
    coverage: 'bounded-retained-resource-entries-only',
    sizeInterpretation: 'zero-may-mean-tao-restricted-or-cached',
    limit: RESOURCE_TIMING_LIMIT,
    entryCount: boundedCount(value.entryCount),
    summarizedEntryCount: boundedCount(value.summarizedEntryCount),
    omittedEntryCount: boundedCount(value.omittedEntryCount),
    truncated: value.truncated === true,
    bufferCapacity: null,
    droppedEntryCount: null,
    originCounts: {
      sameOrigin: boundedCount(value.originCounts?.sameOrigin),
      crossOrigin: boundedCount(value.originCounts?.crossOrigin),
      unavailable: boundedCount(value.originCounts?.unavailable),
    },
    initiatorCounts,
    providerClasses,
    duration: {
      availableCount: boundedCount(value.duration?.availableCount),
      maxMs: Number.isFinite(value.duration?.maxMs)
        ? Math.max(0, value.duration.maxMs)
        : null,
    },
    transferSize: {
      availableCount: boundedCount(value.transferSize?.availableCount),
      knownPositiveBytes: boundedBytes(value.transferSize?.knownPositiveBytes),
      zeroOrUnavailableCount: boundedCount(
        value.transferSize?.zeroOrUnavailableCount,
      ),
    },
    encodedBodySize: {
      availableCount: boundedCount(value.encodedBodySize?.availableCount),
      knownPositiveBytes: boundedBytes(
        value.encodedBodySize?.knownPositiveBytes,
      ),
      zeroOrUnavailableCount: boundedCount(
        value.encodedBodySize?.zeroOrUnavailableCount,
      ),
    },
  };
}

function boundedMapIdentity(value) {
  if (!value || typeof value !== 'object') return null;
  const activeId = value.activeId;
  const safeId =
    typeof activeId === 'string' &&
    /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/.test(activeId)
      ? activeId
      : null;
  const terrainProviderKind = ['cesium-terrain', 'ellipsoid', 'other'].includes(
    value.terrainProviderKind,
  )
    ? value.terrainProviderKind
    : null;
  return {
    activeStackId: safeId,
    status: ['ready', 'switching'].includes(value.status) ? value.status : null,
    switchOrigin: ['manual', 'automatic'].includes(value.switchOrigin)
      ? value.switchOrigin
      : null,
    globeShown: typeof value.globeShown === 'boolean' ? value.globeShown : null,
    terrainProviderKind,
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
  resourceTimingSummary,
  mapIdentity,
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
      resourceTimingSummary: boundedResourceTimingSummary(
        resourceTimingSummary,
      ),
      mapIdentity: boundedMapIdentity(mapIdentity),
    },
  };
}

/** Browser-serializable, bounded page-state read at the existing settled point. */
export function readStartupAttributionPageState() {
  const resourceTimingLimit = 256;
  const resourceInitiatorTypes = [
    'css',
    'fetch',
    'img',
    'link',
    'script',
    'xmlhttprequest',
    'other',
  ];
  const resourceProviderClasses = [
    'sameOriginAssets',
    'tokenApi',
    'google',
    'cesium',
    'esri',
    'reearth',
    'osm',
    'otherSameOrigin',
    'otherCrossOrigin',
    'unknown',
  ];
  const app = globalThis.window?.__godsEyeView;
  const navigation = performance.getEntriesByType('navigation')[0];
  const layers = app?.dataManager?.getAll?.() || [];
  let resourceTimingSummary = null;
  try {
    const entries = performance.getEntriesByType('resource');
    if (Array.isArray(entries)) {
      const sampled = entries.slice(0, resourceTimingLimit);
      const originCounts = { sameOrigin: 0, crossOrigin: 0, unavailable: 0 };
      const initiatorCounts = {
        css: 0,
        fetch: 0,
        img: 0,
        link: 0,
        script: 0,
        xmlhttprequest: 0,
        other: 0,
      };
      const providerClasses = Object.fromEntries(
        resourceProviderClasses.map((providerClass) => [
          providerClass,
          {
            count: 0,
            durationAvailableCount: 0,
            maxDurationMs: null,
            latestResponseEndMs: null,
          },
        ]),
      );
      let durationAvailableCount = 0;
      let durationMaxMs = null;
      let transferSizeAvailableCount = 0;
      let transferSizeKnownPositiveBytes = 0;
      let transferSizeZeroOrUnavailableCount = 0;
      let encodedBodyAvailableCount = 0;
      let encodedBodyKnownPositiveBytes = 0;
      let encodedBodyZeroOrUnavailableCount = 0;
      for (const entry of sampled) {
        let providerClass = 'unknown';
        const resourceName = entry?.name;
        try {
          if (
            typeof resourceName !== 'string' ||
            resourceName.trim().length === 0
          )
            throw new TypeError('Resource entry has no name');
          const resourceUrl = new URL(resourceName, location.href);
          if (!['http:', 'https:'].includes(resourceUrl.protocol))
            throw new TypeError('Resource entry is not an HTTP request');
          const sameOrigin = resourceUrl.origin === location.origin;
          if (sameOrigin) originCounts.sameOrigin += 1;
          else originCounts.crossOrigin += 1;
          const hostname = resourceUrl.hostname.toLowerCase();
          if (sameOrigin) {
            providerClass =
              resourceUrl.pathname === '/api/google/tiles-token'
                ? 'tokenApi'
                : /^\/(?:assets|cesium(?:-[a-zA-Z0-9]+)?)(?:\/|$)/.test(
                      resourceUrl.pathname,
                    )
                  ? 'sameOriginAssets'
                  : 'otherSameOrigin';
          } else if (
            hostname === 'tile.googleapis.com' ||
            hostname.endsWith('.googleapis.com')
          ) {
            providerClass = 'google';
          } else if (
            hostname === 'api.cesium.com' ||
            hostname.endsWith('.cesium.com')
          ) {
            providerClass = 'cesium';
          } else if (hostname.endsWith('.arcgisonline.com')) {
            providerClass = 'esri';
          } else if (
            hostname === 'terrain.reearth.land' ||
            hostname.endsWith('.reearth.land')
          ) {
            providerClass = 'reearth';
          } else if (hostname === 'tile.openstreetmap.org') {
            providerClass = 'osm';
          } else {
            providerClass = sameOrigin ? 'otherSameOrigin' : 'otherCrossOrigin';
          }
        } catch {
          originCounts.unavailable += 1;
        }
        const providerSummary = providerClasses[providerClass];
        providerSummary.count += 1;
        const initiator = resourceInitiatorTypes.includes(entry?.initiatorType)
          ? entry.initiatorType
          : 'other';
        initiatorCounts[initiator] += 1;
        if (Number.isFinite(entry?.duration) && entry.duration >= 0) {
          durationAvailableCount += 1;
          durationMaxMs = Math.max(durationMaxMs ?? 0, entry.duration);
          providerSummary.durationAvailableCount += 1;
          providerSummary.maxDurationMs = Math.max(
            providerSummary.maxDurationMs ?? 0,
            entry.duration,
          );
        }
        if (Number.isFinite(entry?.responseEnd) && entry.responseEnd >= 0) {
          providerSummary.latestResponseEndMs = Math.max(
            providerSummary.latestResponseEndMs ?? 0,
            entry.responseEnd,
          );
        }
        if (Number.isFinite(entry?.transferSize) && entry.transferSize > 0) {
          transferSizeAvailableCount += 1;
          transferSizeKnownPositiveBytes += Math.floor(entry.transferSize);
        } else transferSizeZeroOrUnavailableCount += 1;
        if (
          Number.isFinite(entry?.encodedBodySize) &&
          entry.encodedBodySize > 0
        ) {
          encodedBodyAvailableCount += 1;
          encodedBodyKnownPositiveBytes += Math.floor(entry.encodedBodySize);
        } else encodedBodyZeroOrUnavailableCount += 1;
      }
      resourceTimingSummary = {
        coverage: 'bounded-retained-resource-entries-only',
        sizeInterpretation: 'zero-may-mean-tao-restricted-or-cached',
        entryCount: entries.length,
        summarizedEntryCount: sampled.length,
        omittedEntryCount: Math.max(0, entries.length - sampled.length),
        truncated: entries.length > sampled.length,
        bufferCapacity: null,
        droppedEntryCount: null,
        originCounts,
        initiatorCounts,
        providerClasses,
        duration: {
          availableCount: durationAvailableCount,
          maxMs: durationMaxMs,
        },
        transferSize: {
          availableCount: transferSizeAvailableCount,
          knownPositiveBytes: transferSizeKnownPositiveBytes,
          zeroOrUnavailableCount: transferSizeZeroOrUnavailableCount,
        },
        encodedBodySize: {
          availableCount: encodedBodyAvailableCount,
          knownPositiveBytes: encodedBodyKnownPositiveBytes,
          zeroOrUnavailableCount: encodedBodyZeroOrUnavailableCount,
        },
      };
    }
  } catch {
    resourceTimingSummary = null;
  }
  let mapIdentity = null;
  try {
    const viewer = app?.viewer;
    const mapState = app?.mapStackController?.getState?.();
    if (mapState) {
      const providerName = viewer?.terrainProvider?.constructor?.name;
      mapIdentity = {
        activeId: mapState.activeId,
        status: mapState.status,
        switchOrigin: mapState.switchOrigin,
        globeShown:
          typeof viewer?.scene?.globe?.show === 'boolean'
            ? viewer.scene.globe.show
            : null,
        terrainProviderKind:
          providerName === 'CesiumTerrainProvider'
            ? 'cesium-terrain'
            : providerName === 'EllipsoidTerrainProvider'
              ? 'ellipsoid'
              : providerName
                ? 'other'
                : null,
      };
    }
  } catch {
    mapIdentity = null;
  }
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
    resourceTimingSummary,
    mapIdentity,
  };
}
