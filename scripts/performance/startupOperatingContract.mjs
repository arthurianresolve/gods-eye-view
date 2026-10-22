import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';

export const STARTUP_OPERATING_CONTRACT_SCHEMA =
  'gev-default-startup-operating-contract/v1';
export const STARTUP_OPERATING_CONTRACT_ID =
  'empty-layer-default-austin-native-live-v1';
export const STARTUP_FIXED_TIME = '2026-10-08T12:00:00.000Z';
export const STARTUP_FIXED_TIME_MS = Date.parse(STARTUP_FIXED_TIME);
export const STARTUP_BOOTSTRAP_SOURCE_PATHS = Object.freeze([
  'src/app/viewer.js',
  'src/app/controls.js',
  'src/camera.js',
]);

/** This controls future default-boot captures; it cannot repair old evidence. */
export function assertStartupOperatingMode({
  enabled = false,
  startupOnlyShard = false,
  startupPageObservedEnabled = false,
  providerFixtureMode = null,
  startupAttributionEnabled = false,
  startupCpuProfileEnabled = false,
  startupProviderFixtureDiagnosticEnabled = false,
} = {}) {
  if (
    enabled &&
    (!startupOnlyShard ||
      !startupPageObservedEnabled ||
      providerFixtureMode !== 'infrastructure-dams' ||
      startupAttributionEnabled ||
      startupCpuProfileEnabled ||
      startupProviderFixtureDiagnosticEnabled)
  )
    throw new TypeError(
      '--startup-default-boot-v1 requires an infrastructure-dams --startup-only-shard with --startup-page-observed-v1 and live, unprofiled providers.',
    );
  return enabled === true;
}

/** Keep the real default camera path: shared views add a separate timed flight. */
export function createStartupOperatingUrl(value) {
  const url = new URL(value);
  assert.ok(['http:', 'https:'].includes(url.protocol));
  assert.ok(!url.username && !url.password);
  assert.equal(url.hash, '', 'Default startup must not restore a shared view');
  for (const [key, expected] of [
    ['welcome', '0'],
    ['lang', 'en'],
  ]) {
    const values = url.searchParams.getAll(key);
    assert.ok(
      values.length === 0 || (values.length === 1 && values[0] === expected),
      `Default startup ${key} input differs`,
    );
  }
  assert.ok(
    [...url.searchParams.keys()].every((key) =>
      ['welcome', 'lang'].includes(key),
    ),
    'Default startup has undeclared query inputs',
  );
  url.searchParams.set('welcome', '0');
  url.searchParams.set('lang', 'en');
  return url.href;
}

/** Hash committed bytes, so Windows checkout line endings cannot change pins. */
export function readStartupBootstrapSources({
  checkoutRoot,
  appCommit,
  execFile = execFileSync,
} = {}) {
  assert.ok(typeof checkoutRoot === 'string' && checkoutRoot.length > 0);
  assert.match(appCommit || '', /^[a-f0-9]{40}$/);
  return STARTUP_BOOTSTRAP_SOURCE_PATHS.map((sourcePath) => ({
    path: sourcePath,
    sha256: createHash('sha256')
      .update(
        execFile('git', ['show', `${appCommit}:${sourcePath}`], {
          cwd: checkoutRoot,
          windowsHide: true,
          maxBuffer: 1024 * 1024,
        }),
      )
      .digest('hex'),
  }));
}

export function createStartupOperatingContract(bootstrapSources) {
  const contract = {
    schema: STARTUP_OPERATING_CONTRACT_SCHEMA,
    id: STARTUP_OPERATING_CONTRACT_ID,
    fixtureWorkloadId: 'infrastructure-dams',
    fixedTime: STARTUP_FIXED_TIME,
    fixedTimeMs: STARTUP_FIXED_TIME_MS,
    locale: 'en',
    initialHash: '',
    cameraPath: 'unmodified-production-default-austin-cinematic',
    providerResponses: 'live-original-responses',
    bootstrapSources: structuredClone(bootstrapSources),
  };
  assertStartupOperatingContract(contract);
  return contract;
}

export function assertStartupOperatingContract(contract) {
  assert.equal(contract?.schema, STARTUP_OPERATING_CONTRACT_SCHEMA);
  assert.equal(contract.id, STARTUP_OPERATING_CONTRACT_ID);
  assert.equal(contract.fixtureWorkloadId, 'infrastructure-dams');
  assert.equal(contract.fixedTime, STARTUP_FIXED_TIME);
  assert.equal(contract.fixedTimeMs, STARTUP_FIXED_TIME_MS);
  assert.equal(contract.locale, 'en');
  assert.equal(contract.initialHash, '');
  assert.equal(
    contract.cameraPath,
    'unmodified-production-default-austin-cinematic',
  );
  assert.equal(contract.providerResponses, 'live-original-responses');
  assert.deepEqual(
    contract.bootstrapSources?.map((entry) => entry.path),
    STARTUP_BOOTSTRAP_SOURCE_PATHS,
  );
  for (const entry of contract.bootstrapSources)
    assert.match(entry.sha256 || '', /^[a-f0-9]{64}$/);
  return true;
}

/** Run after the existing frozen Date installer and before any app script. */
export function installStartupOperatingReceiptInPage() {
  const url = new URL(location.href);
  Object.defineProperty(window, '__gevStartupOperatingReceiptV1', {
    configurable: true,
    value: Object.freeze({
      schema: 'gev-default-startup-document-receipt/v1',
      pathname: url.pathname,
      search: url.search,
      hash: url.hash,
      wallClockEpochMs: Date.now(),
    }),
  });
}

/**
 * Same readiness predicates and clock as page-observed v1. The opt-in state
 * reads follow the timestamp; they do not wait for or alter the moving camera.
 * Self-contained for Puppeteer's page serialization.
 */
export function observeStartupBoundaryInPage({
  boundary,
  includeOperatingState = false,
} = {}) {
  if (!['viewer', 'loader-hidden'].includes(boundary))
    throw new TypeError('Unsupported startup readiness boundary');
  const navigation = performance.getEntriesByType('navigation')[0];
  if (!navigation) return false;
  const app = window.__godsEyeView;
  if (boundary === 'viewer' && !app?.viewer) return false;
  if (
    boundary === 'loader-hidden' &&
    !document.getElementById('loading-screen')?.classList.contains('hidden')
  )
    return false;
  const result = {
    observedMsFromNavigationStart: performance.now() - navigation.startTime,
    visible: document.visibilityState === 'visible',
    focused: document.hasFocus(),
    visibilityState: document.visibilityState,
  };
  if (!includeOperatingState) return result;
  const viewer = app?.viewer;
  const scene = viewer?.scene;
  const camera = viewer?.camera;
  const canvas = scene?.canvas;
  const style = app?.styleManager;
  const visual = style?.getVisualState?.();
  const map = app?.mapStackController;
  const mapState = map?.getState?.();
  const clock = viewer?.clock;
  const vector = (value) =>
    value ? { x: value.x, y: value.y, z: value.z } : null;
  const viewport = {
    width: innerWidth,
    height: innerHeight,
    dpr: devicePixelRatio,
  };
  const drawingBuffer = { width: canvas?.width, height: canvas?.height };
  const nativeSharpnessProfile = {
    id: 'native-sharpness-v1',
    useBrowserRecommendedResolution: viewer?.useBrowserRecommendedResolution,
    resolutionScale: viewer?.resolutionScale,
    maximumScreenSpaceError: scene?.globe?.maximumScreenSpaceError,
    viewport,
    drawingBuffer,
  };
  result.operatingState = {
    boot: window.__gevStartupOperatingReceiptV1 || null,
    locale: document.documentElement?.lang || null,
    wallClockEpochMs: Date.now(),
    cesiumClock: {
      currentTime: clock?.currentTime
        ? {
            dayNumber: clock.currentTime.dayNumber,
            secondsOfDay: clock.currentTime.secondsOfDay,
          }
        : null,
      shouldAnimate: clock?.shouldAnimate,
      multiplier: clock?.multiplier,
    },
    camera: {
      position: vector(camera?.position),
      direction: vector(camera?.direction),
      up: vector(camera?.up),
      transform: camera?.transform ? Array.from(camera.transform) : null,
    },
    map: {
      activeId: mapState?.activeId,
      status: mapState?.status,
      globeShown: scene?.globe?.show,
      hasCesiumIonToken: mapState?.hasCesiumIonToken,
      // This is owned controller bookkeeping, not a Cesium class-name guess.
      terrainMode: map?._terrainMode,
      terrainFallback: map ? Boolean(map._terrainFallback) : null,
      photorealTilesetPresent: Boolean(app?.tileset),
    },
    enabledLayerIds:
      app?.dataManager
        ?.getAll?.()
        .filter((layer) => layer.enabled)
        .map((layer) => layer.id)
        .sort() || [],
    settings: {
      qualityMode: style?._adaptiveQuality?.getMode?.(),
      detectionMode: style?.services?.getDetectionMode?.(),
      densityPct: style?.services?.getDetectionTuning?.()?.densityPct,
      useBrowserRecommendedResolution: viewer?.useBrowserRecommendedResolution,
      resolutionScale: viewer?.resolutionScale,
      antialias: scene?.context?._gl?.getContextAttributes?.()?.antialias,
      msaaSamples: scene?.msaaSamples,
      fxaa: scene?.postProcessStages?.fxaa?.enabled,
      bloom: visual?.bloom?.enabled,
      bloomIntensity: visual?.bloom?.intensity,
      sharpen: visual?.sharpen?.enabled,
      sharpenIntensity: visual?.sharpen?.intensity,
      style: visual?.style,
      map: mapState?.activeId,
      maximumScreenSpaceError: scene?.globe?.maximumScreenSpaceError,
      nativeSharpnessProfile,
    },
  };
  return result;
}

/** A moving default camera is recorded, never forced to a favorable pose. */
export function validateStartupOperatingEvidence({
  contract,
  startup,
  expectedSettings,
} = {}) {
  assertStartupOperatingContract(contract);
  assert.deepEqual(startup?.operatingContract, contract);
  const page = startup?.timingEvidence?.pageObserved;
  const states = [
    page?.viewerForeground?.operatingState,
    page?.loaderHiddenForeground?.operatingState,
  ];
  assert.deepEqual(states[0]?.boot, states[1]?.boot);
  for (const state of states) {
    assert.equal(
      state?.boot?.schema,
      'gev-default-startup-document-receipt/v1',
    );
    assert.ok(
      typeof state.boot.pathname === 'string' &&
        state.boot.pathname.startsWith('/'),
    );
    const bootUrl = new URL(
      `${state.boot.pathname}${state.boot.search}${state.boot.hash}`,
      'https://startup.invalid',
    );
    assert.equal(bootUrl.hash, '');
    assert.equal(bootUrl.searchParams.get('welcome'), '0');
    assert.equal(bootUrl.searchParams.get('lang'), 'en');
    assert.equal(createStartupOperatingUrl(bootUrl.href), bootUrl.href);
    assert.equal(state.boot.wallClockEpochMs, contract.fixedTimeMs);
    assert.equal(state.wallClockEpochMs, contract.fixedTimeMs);
    assert.equal(state.locale, contract.locale);
    assert.deepEqual(state.cesiumClock, {
      currentTime: { dayNumber: 2461322, secondsOfDay: 37 },
      shouldAnimate: false,
      multiplier: 1,
    });
    assert.deepEqual(state.enabledLayerIds, []);
    assert.deepEqual(state.map, {
      activeId: 'esri-imagery',
      status: 'ready',
      globeShown: true,
      hasCesiumIonToken: false,
      terrainMode: 'keyless',
      terrainFallback: false,
      photorealTilesetPresent: false,
    });
    for (const key of ['position', 'direction', 'up'])
      assert.ok(
        ['x', 'y', 'z'].every((axis) =>
          Number.isFinite(state.camera?.[key]?.[axis]),
        ),
        `Default startup camera ${key} is incomplete`,
      );
    assert.ok(
      Array.isArray(state.camera?.transform) &&
        state.camera.transform.length === 16 &&
        state.camera.transform.every(Number.isFinite),
      'Default startup camera transform is incomplete',
    );
    assert.ok(expectedSettings, 'Startup settings pins are required');
    assert.deepEqual(state.settings, expectedSettings);
  }
  return true;
}
