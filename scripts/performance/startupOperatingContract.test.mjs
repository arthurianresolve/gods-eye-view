import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import vm from 'node:vm';
import {
  assertStartupOperatingContract,
  assertStartupOperatingMode,
  createStartupOperatingContract,
  createStartupOperatingUrl,
  installStartupOperatingReceiptInPage,
  observeStartupBoundaryInPage,
  readStartupBootstrapSources,
  STARTUP_BOOTSTRAP_SOURCE_PATHS,
  STARTUP_FIXED_TIME_MS,
  validateStartupOperatingEvidence,
} from './startupOperatingContract.mjs';

const bootstrapSources = STARTUP_BOOTSTRAP_SOURCE_PATHS.map((sourcePath) => ({
  path: sourcePath,
  sha256: 'a'.repeat(64),
}));

function makePage({ ready = true, hiddenLoader = true } = {}) {
  const nativeProfile = {
    id: 'native-sharpness-v1',
    useBrowserRecommendedResolution: false,
    resolutionScale: 1,
    maximumScreenSpaceError: 1,
    viewport: { width: 1440, height: 900, dpr: 2 },
    drawingBuffer: { width: 2880, height: 1800 },
  };
  const settings = {
    qualityMode: 'manual',
    detectionMode: 'DENSE',
    densityPct: 75,
    useBrowserRecommendedResolution: false,
    resolutionScale: 1,
    antialias: true,
    msaaSamples: 4,
    fxaa: false,
    bloom: false,
    bloomIntensity: 0,
    sharpen: true,
    sharpenIntensity: 49,
    style: 'normal',
    map: 'esri-imagery',
    maximumScreenSpaceError: 1,
    nativeSharpnessProfile: nativeProfile,
  };
  let performanceNow = 4500;
  const page = {
    URL,
    Date: class extends Date {
      static now() {
        return STARTUP_FIXED_TIME_MS;
      }
    },
    innerWidth: 1440,
    innerHeight: 900,
    devicePixelRatio: 2,
    location: { href: 'https://app.invalid/?welcome=0&lang=en' },
    performance: {
      now: () => performanceNow,
      getEntriesByType: () => [{ startTime: 0 }],
    },
    document: {
      documentElement: { lang: 'en' },
      visibilityState: 'visible',
      hasFocus: () => true,
      getElementById: () => ({
        classList: { contains: () => hiddenLoader },
      }),
    },
    __godsEyeView: ready
      ? {
          viewer: {
            useBrowserRecommendedResolution: false,
            resolutionScale: 1,
            clock: {
              currentTime: { dayNumber: 2461322, secondsOfDay: 37 },
              shouldAnimate: false,
              multiplier: 1,
            },
            camera: {
              position: { x: 100, y: 200, z: 300 },
              direction: { x: 0, y: 0, z: -1 },
              up: { x: 0, y: 1, z: 0 },
              transform: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
            },
            scene: {
              canvas: { width: 2880, height: 1800 },
              globe: { show: true, maximumScreenSpaceError: 1 },
              context: {
                _gl: { getContextAttributes: () => ({ antialias: true }) },
              },
              msaaSamples: 4,
              postProcessStages: { fxaa: { enabled: false } },
            },
          },
          styleManager: {
            getVisualState: () => {
              performanceNow += 3;
              return {
                style: 'normal',
                bloom: { enabled: false, intensity: 0 },
                sharpen: { enabled: true, intensity: 49 },
              };
            },
            _adaptiveQuality: { getMode: () => 'manual' },
            services: {
              getDetectionMode: () => 'DENSE',
              getDetectionTuning: () => ({ densityPct: 75 }),
            },
          },
          mapStackController: {
            getState: () => ({
              activeId: 'esri-imagery',
              status: 'ready',
              hasCesiumIonToken: false,
            }),
            _terrainMode: 'keyless',
            _terrainFallback: null,
          },
          dataManager: { getAll: () => [{ id: 'dams', enabled: false }] },
          tileset: null,
        }
      : null,
  };
  page.window = page;
  const context = vm.createContext(page);
  vm.runInContext(`(${installStartupOperatingReceiptInPage})();`, context);
  const observe = (boundary, includeOperatingState = true) =>
    structuredClone(
      vm.runInContext(
        `(${observeStartupBoundaryInPage})(${JSON.stringify({ boundary, includeOperatingState })});`,
        context,
      ),
    );
  return { page, observe, settings };
}

function makeEvidence() {
  const { page, observe, settings } = makePage();
  const viewer = observe('viewer');
  page.__godsEyeView.viewer.camera.position.x = 350;
  page.location.href += '#lat=30.2672&lon=-97.7431';
  const loader = observe('loader-hidden');
  return {
    contract: createStartupOperatingContract(bootstrapSources),
    startup: {
      operatingContract: createStartupOperatingContract(bootstrapSources),
      timingEvidence: {
        pageObserved: {
          viewerForeground: viewer,
          loaderHiddenForeground: loader,
        },
      },
    },
    expectedSettings: settings,
  };
}

test('default startup mode requires the live, unprofiled page-observed dam shard', () => {
  const valid = {
    enabled: true,
    startupOnlyShard: true,
    startupPageObservedEnabled: true,
    providerFixtureMode: 'infrastructure-dams',
  };
  assert.equal(assertStartupOperatingMode(), false);
  assert.equal(assertStartupOperatingMode(valid), true);
  for (const changed of [
    { startupOnlyShard: false },
    { startupPageObservedEnabled: false },
    { providerFixtureMode: 'infrastructure-datacenters' },
    { startupAttributionEnabled: true },
    { startupCpuProfileEnabled: true },
    { startupProviderFixtureDiagnosticEnabled: true },
  ])
    assert.throws(() => assertStartupOperatingMode({ ...valid, ...changed }));
});

test('startup URL pins English and welcome without changing the production camera path', () => {
  assert.equal(
    createStartupOperatingUrl('https://app.invalid/preview/'),
    'https://app.invalid/preview/?welcome=0&lang=en',
  );
  for (const suffix of [
    '#lat=30&lon=-97',
    '?lang=ru',
    '?lang=en&lang=en',
    '?welcome=1',
    '?welcome=0&welcome=0',
    '?qa=1',
  ])
    assert.throws(() =>
      createStartupOperatingUrl(`https://app.invalid/${suffix}`),
    );
});

test('bootstrap source pins read the named Git blobs rather than checkout text', () => {
  const calls = [];
  const bytes = Buffer.from('committed source\n');
  const sources = readStartupBootstrapSources({
    checkoutRoot: 'checked-app',
    appCommit: 'b'.repeat(40),
    execFile(command, args, options) {
      calls.push({ command, args, options });
      return bytes;
    },
  });
  assert.equal(calls.length, STARTUP_BOOTSTRAP_SOURCE_PATHS.length);
  for (const [index, call] of calls.entries()) {
    assert.equal(call.command, 'git');
    assert.deepEqual(call.args, [
      'show',
      `${'b'.repeat(40)}:${STARTUP_BOOTSTRAP_SOURCE_PATHS[index]}`,
    ]);
    assert.equal(call.options.cwd, 'checked-app');
    assert.equal(call.options.windowsHide, true);
    assert.equal(
      sources[index].sha256,
      createHash('sha256').update(bytes).digest('hex'),
    );
  }
});

test('contract rejects omitted source pins, changed operating inputs, and a moving wall epoch', () => {
  const contract = createStartupOperatingContract(bootstrapSources);
  for (const mutate of [
    (value) => value.bootstrapSources.pop(),
    (value) => (value.bootstrapSources[0].path = 'other.js'),
    (value) => (value.bootstrapSources[0].sha256 = ''),
    (value) => (value.fixedTimeMs += 1),
    (value) => (value.locale = 'ru'),
    (value) => (value.initialHash = '#lat=30'),
    (value) => (value.providerResponses = 'synthetic'),
  ]) {
    const changed = structuredClone(contract);
    mutate(changed);
    assert.throws(() => assertStartupOperatingContract(changed));
  }
});

test('serialized predicates preserve v1 readiness and timestamp before observing scene state', () => {
  assert.equal(makePage({ ready: false }).observe('viewer'), false);
  assert.equal(
    makePage({ hiddenLoader: false }).observe('loader-hidden'),
    false,
  );
  const { observe } = makePage();
  const result = observe('viewer');
  assert.equal(result.observedMsFromNavigationStart, 4500);
  assert.equal(result.operatingState.wallClockEpochMs, STARTUP_FIXED_TIME_MS);
  const legacy = observe('viewer', false);
  assert.equal(legacy.observedMsFromNavigationStart, 4503);
  assert.equal(legacy.operatingState, undefined);
});

test('startup evidence retains the initial URL, accepts the natural moving camera, and pins native quality', () => {
  const evidence = makeEvidence();
  assert.equal(validateStartupOperatingEvidence(evidence), true);
  const observed = evidence.startup.timingEvidence.pageObserved;
  assert.equal(observed.viewerForeground.operatingState.camera.position.x, 100);
  assert.equal(
    observed.loaderHiddenForeground.operatingState.camera.position.x,
    350,
  );
  assert.equal(observed.loaderHiddenForeground.operatingState.boot.hash, '');
});

test('startup evidence rejects missing clocks or camera, flat terrain, enabled layers, and lower quality at either boundary', () => {
  for (const boundary of ['viewerForeground', 'loaderHiddenForeground'])
    for (const mutate of [
      (state) => delete state.boot,
      (state) => (state.boot.hash = '#lat=30&lon=-97'),
      (state) => (state.boot.search = '?welcome=0'),
      (state) => (state.boot.wallClockEpochMs += 1),
      (state) => (state.wallClockEpochMs += 1),
      (state) => (state.locale = 'ru'),
      (state) => (state.cesiumClock.currentTime.secondsOfDay += 1),
      (state) => (state.cesiumClock.shouldAnimate = true),
      (state) => delete state.camera.position,
      (state) => (state.camera.transform[1] = Number.NaN),
      (state) => (state.map.terrainFallback = true),
      (state) => (state.map.activeId = 'osm'),
      (state) => state.enabledLayerIds.push('dams'),
      (state) => (state.settings.resolutionScale = 0.5),
      (state) =>
        (state.settings.nativeSharpnessProfile.drawingBuffer.width = 1440),
    ]) {
      const evidence = makeEvidence();
      mutate(
        evidence.startup.timingEvidence.pageObserved[boundary].operatingState,
      );
      assert.throws(() => validateStartupOperatingEvidence(evidence));
    }
});
