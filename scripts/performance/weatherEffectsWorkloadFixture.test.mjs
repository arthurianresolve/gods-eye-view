import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import * as Cesium from 'cesium';
import {
  createWeatherSource,
  weatherTileUrl,
} from '../../src/layers/weather/source.js';
import { createWindSource } from '../../src/layers/wind/source.js';
import { createWindLayer } from '../../src/layers/wind/index.js';
import { createWeatherClock } from '../../src/layers/weather/clock.js';
import { createWeatherPanel } from '../../src/ui/weatherPanel.js';
import { railFixture } from '../../src/ui/railTestFixture.mjs';
import { createInvestigationWeatherAdapter } from '../../src/time/weatherAdapter.js';
import {
  createFixtureInterceptionErrorRecorder,
  interceptFixtureSession,
} from './fixtureInterception.mjs';
import * as weatherEffectsFixtureApi from './weatherEffectsWorkloadFixture.mjs';
import {
  assertWeatherPhaseRunSet,
  assertWeatherEffectsClock,
  createWeatherEffectsFixtureDelivery,
  createWeatherEffectsWorkloadFixture,
  runWeatherEffectsPhaseSchedule,
  resetWeatherEffectsToLatest,
  prepareWeatherEffectsTimeline,
  selectWeatherEffectsPhaseInPage,
  waitForWeatherEffectsReadiness,
  WEATHER_EFFECTS_FIXED_TIME,
  WEATHER_EFFECTS_LAYER_COUNTS,
  assertWeatherEffectsWindState,
  configureWeatherEffectsMotionPreference,
  observeWeatherEffectsMotionPreference,
  recordWeatherMotionPreferencePreflight,
  assertWeatherEffectsMotionPreference,
} from './weatherEffectsWorkloadFixture.mjs';

const BASE = 'http://127.0.0.1:4173/';
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');

test('capture producer resolves weather fixture operations from its lazy module namespace', () => {
  const captureSource = readFileSync(
    new URL('../capture-scene-performance.mjs', import.meta.url),
    'utf8',
  );
  const dynamicOperations = [
    { name: 'createWeatherEffectsWorkloadFixture', invoked: true },
    { name: 'createWeatherEffectsFixtureDelivery', invoked: true },
    { name: 'resetWeatherEffectsToLatest', invoked: true },
    { name: 'prepareWeatherEffectsTimeline', invoked: true },
    { name: 'observeWeatherEffectsLayerState', invoked: false },
    { name: 'configureWeatherEffectsMotionPreference', invoked: true },
    { name: 'observeWeatherEffectsMotionPreference', invoked: false },
    { name: 'waitForWeatherEffectsReadiness', invoked: true },
    { name: 'assertWeatherEffectsWindState', invoked: true },
    { name: 'assertWeatherEffectsClock', invoked: true },
    { name: 'createWeatherEffectsFixtureLifecycle', invoked: true },
  ];

  for (const { name, invoked } of dynamicOperations) {
    assert.equal(typeof weatherEffectsFixtureApi[name], 'function');
    assert.match(
      captureSource,
      new RegExp(
        `weatherEffectsModule\\.${name}${invoked ? '\\s*\\(' : '(?=\\s*[,)])'}`,
      ),
      `${name} must resolve through the dynamically loaded fixture module`,
    );
    assert.doesNotMatch(
      captureSource,
      new RegExp(`(^|[^.\\w])${name}\\s*\\(`, 'm'),
      `${name} must not be referenced as an unbound identifier`,
    );
  }
  assert.match(
    captureSource,
    /weatherEffectsModule\s*=\s*\n?\s*await import\('\.\/performance\/weatherEffectsWorkloadFixture\.mjs'\)/,
    'the CLI must load weather fixture code dynamically after argument validation',
  );
});

test('weather capture pins and observes the effective reduced-motion preference', async () => {
  let configured;
  await configureWeatherEffectsMotionPreference({
    async emulateMediaFeatures(features) {
      configured = features;
    },
  });
  assert.deepEqual(configured, [
    { name: 'prefers-reduced-motion', value: 'no-preference' },
  ]);

  const observed = (matches) =>
    JSON.parse(
      JSON.stringify(
        runInNewContext(
          `(${observeWeatherEffectsMotionPreference.toString()})()`,
          { window: { matchMedia: () => ({ matches }) } },
        ),
      ),
    );
  const preference = observed(false);
  assert.deepEqual(preference, {
    schema: 'gev-weather-motion-preference/v1',
    reducedMotion: false,
  });
  assertWeatherEffectsMotionPreference(preference, 'test');
  assert.throws(
    () => assertWeatherEffectsMotionPreference(observed(true), 'reduced'),
    /reduced motion must be disabled/,
  );
  assert.throws(
    () =>
      assertWeatherEffectsMotionPreference(
        observedUnavailableMotionPreference(),
        'unavailable',
      ),
    /false/,
  );
});

test('weather preflight failure recording does not invent a cleared progress sample', () => {
  const observation = {
    schema: 'gev-weather-motion-preference/v1',
    reducedMotion: false,
  };
  const cleared = { phase: 'configure-weather-effects-fixture', current: null };

  assert.doesNotThrow(() =>
    recordWeatherMotionPreferencePreflight(cleared, observation),
  );
  assert.equal(cleared.current, null);

  const active = { current: { phase: 'configure-weather-effects-fixture' } };
  recordWeatherMotionPreferencePreflight(active, observation);
  assert.deepEqual(
    active.current.weatherMotionPreferencePreflight,
    observation,
  );
});

function observedUnavailableMotionPreference() {
  return runInNewContext(
    `(${observeWeatherEffectsMotionPreference.toString()})()`,
    { window: {} },
  );
}

test('weather-effects descriptor pins source assets, populations, route and epoch', () => {
  const fixture = createWeatherEffectsWorkloadFixture();
  assert.equal(fixture.schema, 'gev-weather-effects-fixture/v2');
  assert.equal(fixture.workloadId, 'austin-weather-effects-phased-v2');
  assert.deepEqual(fixture.mediaPreferences, {
    'prefers-reduced-motion': 'no-preference',
  });
  const {
    fixedTimeMs: _fixedTimeMs,
    manifestSha256: _manifestSha256,
    sha256: _sha256,
    clock: _clock,
    ...manifestDescriptor
  } = fixture;
  assert.equal(
    hash(Buffer.from(JSON.stringify(manifestDescriptor))),
    fixture.manifestSha256,
  );
  const previousDescriptor = structuredClone(manifestDescriptor);
  delete previousDescriptor.mediaPreferences;
  assert.equal(
    hash(Buffer.from(JSON.stringify(previousDescriptor))),
    '5ba7e41ab29a1b9eeb6c773059f872bcd9f12879f358c4e7aaccb4a152bbac9a',
  );
  assert.equal(fixture.phaseSchedule.schema, 'gev-weather-phase-schedule/v1');
  assert.deepEqual(
    fixture.phaseSchedule.phases.map(({ id, offsetMs, sourceTime }) => ({
      id,
      offsetMs,
      sourceTime,
    })),
    [
      { id: 'early-history', offsetMs: 0, sourceTime: fixture.timeline[0] },
      {
        id: 'middle-history',
        offsetMs: 20_000,
        sourceTime: fixture.timeline[1],
      },
      {
        id: 'latest-history',
        offsetMs: 40_000,
        sourceTime: fixture.timeline[2],
      },
    ],
  );
  assert.equal(fixture.fixedTime, WEATHER_EFFECTS_FIXED_TIME);
  assert.deepEqual(fixture.expectedLayerCounts, WEATHER_EFFECTS_LAYER_COUNTS);
  assert.deepEqual(fixture.camera, {
    id: 'austin-weather-oblique-v1',
    longitudeDeg: -97.7431,
    latitudeDeg: 30.2672,
    altitudeM: 12_000,
    headingDeg: 20,
    pitchDeg: -45,
  });
  assert.equal(fixture.visualState.qualityMode, 'manual');
  assert.equal(fixture.visualState.detectionMode, 'DENSE');
  assert.equal(fixture.visualState.densityPct, 75);
  assert.match(fixture.manifestSha256, /^[a-f0-9]{64}$/);
  for (const product of ['radar', 'clouds-regional', 'lightning']) {
    const frameHashes = fixture.assets
      .filter((asset) => asset.id.startsWith(`${product}-tile-`))
      .map((asset) => asset.sha256);
    assert.equal(frameHashes.length, 3);
    assert.equal(
      new Set(frameHashes).size,
      3,
      `${product} history frames must have distinct bytes`,
    );
  }
  for (const asset of fixture.assets) {
    const bytes = asset.path
      ? readFileSync(new URL(`../../${asset.path}`, import.meta.url))
      : Buffer.from(`${JSON.stringify(fixture.windManifest)}\n`);
    assert.equal(bytes.length, asset.byteLength, asset.id);
    assert.equal(hash(bytes), asset.sha256, asset.id);
  }
  const julian = new Cesium.JulianDate(
    fixture.clock.dayNumber,
    fixture.clock.secondsOfDay,
    Cesium.TimeStandard.TAI,
  );
  assert.equal(Cesium.JulianDate.toIso8601(julian, 3), fixture.fixedTime);
  assert.throws(
    () => createWeatherEffectsWorkloadFixture('2026-10-08T12:00:00Z'),
    /must be 2026-10-08T12:00:00\.000Z/,
  );
});

test('phased weather CLI rejects short runs before launch and accepts only the registered workload', () => {
  const cliPath = fileURLToPath(
    new URL('../capture-scene-performance.mjs', import.meta.url),
  );
  const run = (extraArgs) =>
    spawnSync(
      process.execPath,
      [
        cliPath,
        '--provider-fixture',
        'austin-weather-effects-phased-v2',
        ...extraArgs,
      ],
      { encoding: 'utf8', timeout: 15_000, windowsHide: true },
    );
  const shortWarmup = run([
    '--warmup-ms',
    '29999',
    '--seconds',
    '60',
    '--runs',
    '5',
  ]);
  assert.equal(shortWarmup.status, 1);
  assert.match(shortWarmup.stderr, /exact 30s\/60s\/5-run comparison contract/);
  assert.doesNotMatch(shortWarmup.stderr, /Comparison fixtures require/);

  const shortSample = run([
    '--warmup-ms',
    '30000',
    '--seconds',
    '59',
    '--runs',
    '5',
  ]);
  assert.equal(shortSample.status, 1);
  assert.match(shortSample.stderr, /exact 30s\/60s\/5-run comparison contract/);

  const incompleteDiagnostic = run([
    '--warmup-ms',
    '1000',
    '--seconds',
    '60',
    '--runs',
    '1',
    '--weather-phase-diagnostic',
    '--worker-audit-mode',
    'receipt-only',
  ]);
  assert.equal(incompleteDiagnostic.status, 1);
  assert.match(
    incompleteDiagnostic.stderr,
    /Comparison fixtures require verified build provenance options/,
  );
  assert.doesNotMatch(
    incompleteDiagnostic.stderr,
    /exact 30s\/60s\/5-run comparison contract/,
  );

  const unprovenancedValidProfile = run([
    '--warmup-ms',
    '30000',
    '--seconds',
    '60',
    '--runs',
    '5',
    '--worker-audit-mode',
    'receipt-only',
  ]);
  assert.equal(unprovenancedValidProfile.status, 1);
  assert.match(
    unprovenancedValidProfile.stderr,
    /Comparison fixtures require verified build provenance options/,
  );
  assert.doesNotMatch(
    unprovenancedValidProfile.stderr,
    /The phased weather\/effects comparison requires/,
  );
});

test('weather phase observations bind every scheduled source, elapsed time and paused clock', () => {
  const fixture = createWeatherEffectsWorkloadFixture();
  const evidence = {
    schema: 'gev-weather-phase-observations/v1',
    durationMs: 60_000,
    fixtureSha256: fixture.sha256,
    phases: fixture.phaseSchedule.phases.map((phase) => ({
      id: phase.id,
      fixtureSha256: fixture.sha256,
      expectedSourceTime: phase.sourceTime,
      scheduledAtMs: phase.offsetMs,
      observedAtElapsedMs: phase.offsetMs + 150,
      sourceObservationTimes: Array(3).fill(phase.sourceTime),
      clock: { mode: 'history', playing: false },
    })),
  };
  assert.equal(
    assertWeatherPhaseRunSet(evidence, fixture, { durationMs: 60_000 }),
    true,
  );
  for (const mutate of [
    (value) => value.phases.pop(),
    (value) => (value.phases[1].expectedSourceTime = fixture.timeline[0]),
    (value) =>
      (value.phases[1].sourceObservationTimes[2] = fixture.timeline[0]),
    (value) => (value.phases[1].observedAtElapsedMs = 26_000),
    (value) => (value.phases[1].clock.playing = true),
    (value) => (value.fixtureSha256 = '0'.repeat(64)),
  ]) {
    const invalid = structuredClone(evidence);
    mutate(invalid);
    assert.throws(() =>
      assertWeatherPhaseRunSet(invalid, fixture, { durationMs: 60_000 }),
    );
  }
  assert.throws(() =>
    assertWeatherPhaseRunSet(evidence, fixture, { durationMs: 30_000 }),
  );
});

test('serialized weather phase driver selects every source through the real clock-backed timeline slider', async () => {
  const fixture = createWeatherEffectsWorkloadFixture();
  const clock = createWeatherClock();
  const modules = new Map();
  const productEvidence = new Map();
  const ids = ['weather-radar', 'weather-satellite', 'weather-lightning'];
  const unregister = ids.map((id) => {
    let shown = null;
    const product = {
      id,
      maxGapMs: 24 * 60 * 60_000,
      getTimes: () => fixture.timeline,
      getShownTime: () => shown,
      isSuspended: () => false,
      async apply(time) {
        shown = time;
        return true;
      },
    };
    const remove = clock.register(product);
    const evidence = {
      historyFrames: fixture.timeline.length,
      observedAtOverride: null,
    };
    productEvidence.set(id, evidence);
    modules.set(id, {
      getStats: () => ({
        observedAt: evidence.observedAtOverride ?? shown,
        loading: false,
      }),
      getDiagnostics: () => {
        const { mode, target, playing } = clock.getState();
        return {
          clock: { mode, target, playing },
          historyFrames: evidence.historyFrames,
        };
      },
      getParams: () =>
        id === 'weather-satellite'
          ? { product: 'clouds-regional', infrared: 'filtered' }
          : { opacity: 'strong' },
    });
    return remove;
  });
  const f = railFixture();
  const view = createWeatherPanel({ container: f.container, clock });
  view.update(
    ids.map((id) => ({
      id,
      summary: { label: id, coverage: 'pinned source fixture' },
    })),
  );
  const root = f.find((node) => node.className === 'weather-readout');
  root.querySelector = (selector) => {
    if (selector === 'input[aria-label="Observed history"]')
      return f.find(
        (node) =>
          node.tagName === 'INPUT' &&
          node.getAttribute('aria-label') === 'Observed history',
        root,
      );
    if (selector.includes('Earlier observation'))
      return f.find(
        (node) =>
          node.tagName === 'BUTTON' && node.title === 'Earlier observation',
        root,
      );
    if (selector.includes('Newest frame per product'))
      return f.find(
        (node) =>
          node.tagName === 'BUTTON' &&
          node.title === 'Newest frame per product',
        root,
      );
    if (selector.includes('Replay observed history'))
      return f.find(
        (node) =>
          node.tagName === 'BUTTON' && node.title === 'Replay observed history',
        root,
      );
    return null;
  };
  const window = {
    __gevWeatherMeasurementStartedAt: 100,
    __godsEyeView: {
      dataManager: {
        layers: {
          get: (id) => ({
            module:
              modules.get(id) ||
              (id === 'wind'
                ? {
                    getParams: () => ({
                      model: 'GFS',
                      overlay: 'speed',
                      paused: false,
                    }),
                    getStats: () => ({ loading: false, gridCells: 65_160 }),
                  }
                : null),
          }),
        },
      },
    },
  };
  const document = {
    querySelector: () => root,
  };
  let now = 100;
  const performance = { now: () => now };
  const setTimeout = (resolve, delay) => {
    now += delay;
    queueMicrotask(resolve);
    return 1;
  };
  const page = {
    evaluate: (operation, args) =>
      runInNewContext(`(${operation.toString()})(${JSON.stringify(args)})`, {
        window,
        document,
        performance,
        setTimeout,
        clearTimeout: () => {},
        Event,
      }),
  };
  try {
    const startupPreflight = await prepareWeatherEffectsTimeline({
      page,
      fixture,
    });
    assert.equal(startupPreflight.schema, 'gev-weather-history-preflight/v1');
    assert.deepEqual(
      Array.from(startupPreflight.phases, ({ timelineIndex, sourceTime }) => ({
        timelineIndex,
        sourceTime,
      })),
      fixture.phaseSchedule.phases.map(({ timelineIndex, sourceTime }) => ({
        timelineIndex,
        sourceTime,
      })),
    );
    assert.deepEqual(
      Array.from(startupPreflight.phases, ({ sourceObservationTimes }) =>
        Array.from(sourceObservationTimes),
      ),
      fixture.timeline.map((time) => Array(3).fill(time)),
    );
    assert.equal(startupPreflight.startup.clock.mode, 'latest');
    assert.equal(startupPreflight.reset.clock.mode, 'latest');
    assert.deepEqual(
      Array.from(startupPreflight.selectedTimes, (times) => Array.from(times)),
      [
        fixture.timeline.at(-1),
        ...fixture.timeline,
        fixture.timeline.at(-1),
      ].map((time) => Array(3).fill(time)),
    );
    assert.deepEqual(
      Array.from(startupPreflight.reset.sourceObservationTimes),
      Array(3).fill(fixture.timeline.at(-1)),
    );

    productEvidence.get('weather-lightning').historyFrames = 2;
    await assert.rejects(
      prepareWeatherEffectsTimeline({ page, fixture, timeoutMs: 100 }),
      /history ended before its pinned timeline: .*"sliderMaximum":2,"historyFrames":\[3,3,2\]/,
    );
    productEvidence.get('weather-lightning').historyFrames =
      fixture.timeline.length;

    productEvidence.get('weather-lightning').observedAtOverride =
      fixture.timeline[0];
    await assert.rejects(
      prepareWeatherEffectsTimeline({ page, fixture, timeoutMs: 100 }),
      /did not settle at latest/,
    );
    productEvidence.get('weather-lightning').observedAtOverride = null;

    const observations = [];
    for (const phase of fixture.phaseSchedule.phases) {
      const result = await runInNewContext(
        `(${selectWeatherEffectsPhaseInPage.toString()})(${JSON.stringify({
          phase,
          fixtureSha256: fixture.sha256,
          maximumLatenessMs: fixture.phaseSchedule.maximumLatenessMs,
          measurementStartedAt: 100,
        })})`,
        {
          window,
          document,
          performance,
          setTimeout,
          clearTimeout: () => {},
          Event,
        },
      );
      observations.push(result);
      assert.equal(result.id, phase.id);
      assert.equal(result.clock.mode, 'history');
      assert.equal(result.clock.playing, false);
      assert.deepEqual(
        Array.from(result.sourceObservationTimes),
        Array(3).fill(phase.sourceTime),
      );
    }
    assert.deepEqual(
      observations.map(({ id }) => id),
      ['early-history', 'middle-history', 'latest-history'],
    );
    assert.equal(clock.getState().mode, 'history');
    assert.equal(clock.getState().target, fixture.timeline.at(-1));
    const slider = root.querySelector('input[aria-label="Observed history"]');

    const firstReset = await resetWeatherEffectsToLatest({ page, fixture });
    assert.equal(firstReset.mode, 'latest');
    assert.equal(firstReset.playing, false);
    assert.equal(firstReset.fixtureSha256, fixture.sha256);
    assert.deepEqual(
      Array.from(firstReset.sourceObservationTimes),
      Array(3).fill(fixture.timeline.at(-1)),
    );

    window.__gevWeatherMeasurementStartedAt = 40_100;
    now = 40_100;
    const repeatedPhase = await runInNewContext(
      `(${selectWeatherEffectsPhaseInPage.toString()})(${JSON.stringify({
        phase: fixture.phaseSchedule.phases[1],
        fixtureSha256: fixture.sha256,
        maximumLatenessMs: fixture.phaseSchedule.maximumLatenessMs,
        measurementStartedAt: 40_100,
      })})`,
      {
        window,
        document,
        performance,
        setTimeout,
        clearTimeout: () => {},
        Event,
      },
    );
    assert.equal(repeatedPhase.clock.mode, 'history');
    assert.deepEqual(
      Array.from(repeatedPhase.sourceObservationTimes),
      Array(3).fill(fixture.timeline[1]),
    );
    const secondReset = await resetWeatherEffectsToLatest({ page, fixture });
    assert.equal(secondReset.mode, 'latest');
    assert.deepEqual(
      Array.from(secondReset.sourceObservationTimes),
      Array(3).fill(fixture.timeline.at(-1)),
    );

    window.__gevWeatherMeasurementStartedAt = 101;
    await assert.rejects(
      runInNewContext(
        `(${selectWeatherEffectsPhaseInPage.toString()})(${JSON.stringify({
          phase: fixture.phaseSchedule.phases[1],
          fixtureSha256: fixture.sha256,
          maximumLatenessMs: fixture.phaseSchedule.maximumLatenessMs,
          measurementStartedAt: 100,
        })})`,
        {
          window,
          document,
          performance,
          setTimeout,
          clearTimeout: () => {},
          Event,
        },
      ),
      /outlived its measurement owner/,
    );
    assert.equal(slider.value, '2');
  } finally {
    view.destroy();
    clock.destroy();
    for (const remove of unregister) remove();
  }
});

test('weather phase driver cancels pending phase work when capture fails early', async () => {
  const fixture = createWeatherEffectsWorkloadFixture();
  let rejectSample;
  const samplePromise = new Promise((_, reject) => {
    rejectSample = reject;
  });
  const selectedPhases = [];
  const scheduled = [];
  const canceled = [];
  let abortCount = 0;
  const failure = new Error('capture rejected during phase schedule');
  const page = {
    waitForFunction: async () => true,
    evaluate: async (fn, value) => {
      if (value?.phase) {
        selectedPhases.push(value.phase.id);
        return { id: value.phase.id };
      }
      if (fn.toString().includes('__gevWeatherMeasurementAbort')) {
        abortCount += 1;
        return undefined;
      }
      return 100;
    },
  };
  const run = runWeatherEffectsPhaseSchedule({
    page,
    fixture,
    samplePromise,
    now: () => 0,
    schedule: (_callback, delayMs) => {
      const handle = { delayMs };
      scheduled.push(handle);
      rejectSample(failure);
      return handle;
    },
    cancel: (handle) => canceled.push(handle),
  });
  await assert.rejects(run, (error) => error === failure);
  assert.deepEqual(selectedPhases, ['early-history']);
  assert.deepEqual(
    scheduled.map(({ delayMs }) => delayMs),
    [20_000],
  );
  assert.deepEqual(canceled, scheduled);
  assert.equal(abortCount, 1);
});

test('real weather and wind source adapters consume the pinned manifests and grid', async () => {
  const fixture = createWeatherEffectsWorkloadFixture();
  const delivery = createWeatherEffectsFixtureDelivery(fixture, BASE);
  const fulfilled = [];
  const fetchImpl = async (input, init = {}) => {
    const url = new URL(input, BASE);
    const routed = await delivery.respond(url, {
      method: init.method || 'GET',
    });
    if (!routed) throw new Error(`No weather fixture route: ${url.pathname}`);
    const bytes = Buffer.from(routed.body);
    delivery.onFulfilled({
      url: url.href,
      method: init.method || 'GET',
      status: routed.status,
      bodyBase64: bytes.toString('base64'),
    });
    fulfilled.push(url.pathname);
    return new Response(bytes, {
      status: routed.status,
      headers: { 'content-type': routed.contentType },
    });
  };
  const weather = createWeatherSource({ fetchImpl });
  const snapshots = await Promise.all(
    ['radar', 'clouds-regional', 'lightning'].map((product) =>
      weather.getSnapshot({ product }),
    ),
  );
  assert.deepEqual(
    snapshots.map((snapshot) => snapshot.latest),
    [fixture.fixedTime, fixture.fixedTime, fixture.fixedTime],
  );
  const tileUrl = weatherTileUrl('radar', fixture.fixedTime, { size: 256 })
    .replace('{z}', '2')
    .replace('{x}', '3')
    .replace('{y}', '1');
  // Cesium's tile provider consumes this same source URL constructor; route an
  // exact rendered-tile request through the fixture delivery boundary.
  const routedTile = await delivery.respond(new URL(tileUrl, BASE), {
    method: 'GET',
  });
  assert.equal(routedTile.contentType, 'image/png');
  delivery.onFulfilled({
    url: new URL(tileUrl, BASE).href,
    method: 'GET',
    status: 200,
    bodyBase64: Buffer.from(routedTile.body).toString('base64'),
  });
  const wind = await createWindSource({ fetchImpl }).getSnapshot({
    model: 'gfs',
    overlay: 'none',
  });
  assert.equal(wind.grid.nx, 360);
  assert.equal(wind.grid.ny, 181);
  assert.equal(wind.u.length, 65_160);
  assert.equal(wind.v.length, 65_160);
  assert.ok([...wind.u, ...wind.v].every(Number.isFinite));
  assert.deepEqual(fulfilled, [
    '/api/weather/manifest',
    '/api/weather/manifest',
    '/api/weather/manifest',
    '/api/wind/manifest',
    '/api/wind/grid/gfs-weather-effects-v1.bin',
  ]);
});

test('wind preflight reads the actual layer parameter and loading APIs', async (t) => {
  const fixture = createWeatherEffectsWorkloadFixture();
  const layer = createWindLayer({
    feed: {
      async getSnapshot() {
        return {
          ...fixture.windManifest,
          grid: fixture.windManifest.grid,
          u: new Float32Array(360 * 181),
          v: new Float32Array(360 * 181),
        };
      },
    },
  });
  t.after(() => layer.destroy());
  layer.setParams({ model: 'gfs', overlay: 'speed', paused: false });
  layer.enable();
  await layer.update();
  const params = layer.getParams();
  const stats = layer.getStats();
  assert.deepEqual(params, {
    model: 'gfs',
    overlay: 'speed',
    paused: false,
    units: 'km/h',
  });
  assert.equal('loading' in params, false);
  assert.equal(stats.loading, false);
  assertWeatherEffectsWindState(params, stats);
  assert.throws(
    () => assertWeatherEffectsWindState({ ...params, model: 'GFS' }, stats),
    /GFS model/,
  );
  assert.throws(
    () => assertWeatherEffectsWindState(params, { ...stats, loading: true }),
    /must be ready/,
  );
});

test('real investigation weather adapter preserves observed frame time apart from harness time', async (t) => {
  const fixture = createWeatherEffectsWorkloadFixture();
  const harnessEpoch = fixture.fixedTimeMs;
  let shownTime = null;
  const weatherClock = createWeatherClock({ now: () => harnessEpoch });
  weatherClock.register({
    id: 'weather-radar',
    maxGapMs: 30 * 60_000,
    getTimes: () => fixture.timeline,
    getShownTime: () => shownTime,
    isSuspended: () => false,
    async apply(time) {
      shownTime = time;
      return true;
    },
  });
  const listeners = new Set();
  let state = { mode: 'live', timeMs: null };
  const investigationTime = {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    seek(timeMs) {
      state = { mode: 'paused', timeMs };
      for (const listener of [...listeners]) listener(state);
    },
  };
  const adapter = createInvestigationWeatherAdapter({
    weatherClock,
    investigationTime,
  });
  t.after(() => {
    adapter.destroy();
    weatherClock.destroy();
  });
  investigationTime.seek(Date.parse(fixture.timeline[0]));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(weatherClock.getState().mode, 'history');
  assert.equal(weatherClock.getState().target, fixture.timeline[0]);
  assert.equal(shownTime, fixture.timeline[0]);
  assert.notEqual(shownTime, new Date(harnessEpoch).toISOString());
  assert.equal(harnessEpoch, Date.parse(WEATHER_EFFECTS_FIXED_TIME));
});

test('fixture responder enforces exact query and method, then audits tile bytes', async () => {
  const fixture = createWeatherEffectsWorkloadFixture();
  const delivery = createWeatherEffectsFixtureDelivery(fixture, BASE);
  const route = (path, method = 'GET') =>
    delivery.respond(new URL(path, BASE), { method });
  const tilePath = `/api/weather/tile?product=radar&time=${encodeURIComponent(fixture.fixedTime)}&z=2&x=3&y=1`;
  const tile = await route(tilePath);
  assert.equal(tile.contentType, 'image/png');
  delivery.onFulfilled({
    url: new URL(tilePath, BASE).href,
    method: 'GET',
    status: 200,
    bodyBase64: Buffer.from(tile.body).toString('base64'),
  });
  for (const [path, method] of [
    [tilePath + '&host=https://bad.invalid', 'GET'],
    [tilePath.replace('y=1', 'y=4'), 'GET'],
    [tilePath, 'POST'],
    ['/api/wind/manifest?model=ifs&overlay=none', 'GET'],
    ['/api/weather/manifest?product=radar&extra=1', 'GET'],
  ])
    await assert.rejects(route(path, method), /Unexpected or malformed/);
  await assert.rejects(
    route('/api/weather/unknown'),
    /Unexpected or malformed/,
  );
});

test('real fixture interception accepts accessor methods, ignores unrelated API fallback and diagnoses owned malformed routes', async () => {
  const fixture = createWeatherEffectsWorkloadFixture();
  const delivery = createWeatherEffectsFixtureDelivery(fixture, BASE);
  const client = new EventEmitter();
  const commands = [];
  client.send = async (method, params) => {
    commands.push({ method, params });
    return {};
  };
  const recorder = createFixtureInterceptionErrorRecorder();
  const controller = await interceptFixtureSession(
    client,
    BASE,
    (url, request) => delivery.respond(url, request),
    recorder.onError,
    {
      onFulfilled: delivery.onFulfilled,
      getErrorContext: () => ({
        documentRole: 'main-measured',
        documentId: 'main-measured-document',
        sessionOrdinal: 1,
        lifecycleStage: 'active',
      }),
    },
  );
  const request = async (pathname) => {
    const event = {
      requestId: `request-${commands.length}`,
      request: { url: new URL(pathname, BASE).href, method: 'GET' },
    };
    await Promise.all(
      client
        .listeners('Fetch.requestPaused')
        .map((listener) => listener(event)),
    );
  };

  try {
    await request('/api/weather/manifest?product=radar');
    assert.equal(delivery.snapshot()['radar-manifest'], 1);

    await request('/api/aircraft?token=unrelated-secret');
    assert.equal(
      commands.filter(({ method }) => method === 'Fetch.fulfillRequest').length,
      2,
      'the generic same-origin API fallback is fulfilled but excluded from weather asset counts',
    );
    assert.equal(recorder.records.length, 0);

    const routeFailurePromise = delivery.waitForRouteError();
    await request(
      '/api/weather/manifest?product=radar&token=must-not-be-retained',
    );
    const routeFailure = await routeFailurePromise;
    assert.match(routeFailure.message, /GET api\.weather\.manifest/);
    assert.equal(recorder.records.length, 1);
    assert.equal(recorder.records[0].phase, 'request-command');
    assert.match(recorder.records[0].message, /GET api\.weather\.manifest/);
    assert.match(recorder.records[0].message, /product=radar/);
    assert.match(recorder.records[0].message, /unexpectedQueryKeyCount=1/);
    assert.equal(
      recorder.records[0].message.includes('must-not-be-retained'),
      false,
    );
    assert.equal(
      delivery.routeErrors[0].request.includes('must-not-be-retained'),
      false,
    );
    assert.equal(commands.at(-1).method, 'Fetch.failRequest');
  } finally {
    await controller.stopAndDrain();
    delivery.dispose();
  }
});

test('weather route-error wait is cancellable and rejects on disposal', async () => {
  const fixture = createWeatherEffectsWorkloadFixture();
  const delivery = createWeatherEffectsFixtureDelivery(fixture, BASE);
  const controller = new AbortController();
  const waiting = delivery.waitForRouteError({ signal: controller.signal });
  controller.abort(new Error('readiness completed'));
  await assert.rejects(waiting, /readiness completed/);

  const disposedDelivery = createWeatherEffectsFixtureDelivery(fixture, BASE);
  const disposedWait = disposedDelivery.waitForRouteError();
  disposedDelivery.dispose();
  await assert.rejects(disposedWait, /disposed/);
  delivery.dispose();
});

test('weather readiness aborts polling on owned route failure and disposes late handles', async () => {
  let readinessSignal;
  let resolveReadiness;
  let lateHandleDisposed = false;
  const page = {
    waitForFunction(_predicate, options) {
      readinessSignal = options.signal;
      return new Promise((resolve) => {
        resolveReadiness = resolve;
      });
    },
  };
  const delivery = {
    waitForRouteError({ signal }) {
      return new Promise((resolve, reject) => {
        if (signal.aborted) reject(signal.reason);
        else
          signal.addEventListener('abort', () => reject(signal.reason), {
            once: true,
          });
        queueMicrotask(() => resolve(new Error('owned weather route failed')));
      });
    },
  };
  const readiness = waitForWeatherEffectsReadiness(
    page,
    { expectedLayerCounts: {}, selectedLayerIds: [] },
    delivery,
    60_000,
  );
  await assert.rejects(readiness, /owned weather route failed/);
  assert.equal(readinessSignal.aborted, true);

  resolveReadiness({
    async jsonValue() {
      return { status: 'ready', layers: [] };
    },
    async dispose() {
      lateHandleDisposed = true;
    },
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(lateHandleDisposed, true);

  let simultaneousHandleDisposals = 0;
  await assert.rejects(
    waitForWeatherEffectsReadiness(
      {
        waitForFunction: async () => ({
          async jsonValue() {
            return { status: 'ready', layers: [] };
          },
          async dispose() {
            simultaneousHandleDisposals += 1;
          },
        }),
      },
      { expectedLayerCounts: {}, selectedLayerIds: [] },
      {
        waitForRouteError: async () => new Error('simultaneous route failure'),
      },
      60_000,
    ),
    /simultaneous route failure/,
  );
  assert.equal(simultaneousHandleDisposals, 1);

  const readFailure = new Error('readiness handle read failed');
  let failedHandleDisposals = 0;
  await assert.rejects(
    waitForWeatherEffectsReadiness(
      {
        waitForFunction: async () => ({
          async jsonValue() {
            throw readFailure;
          },
          async dispose() {
            failedHandleDisposals += 1;
            throw new Error('handle disposal also failed');
          },
        }),
      },
      { expectedLayerCounts: {}, selectedLayerIds: [] },
      {
        waitForRouteError({ signal }) {
          return new Promise((_resolve, reject) => {
            signal.addEventListener('abort', () => reject(signal.reason), {
              once: true,
            });
          });
        },
      },
      60_000,
    ),
    (error) => error === readFailure,
  );
  assert.equal(failedHandleDisposals, 1);
});

test('weather failure snapshot is page-serializable and exposes only bounded selected-layer state', () => {
  const managerRows = [
    { id: 'weather-radar', enabled: true, stats: { count: 0 } },
    { id: 'weather-satellite', enabled: true, stats: { count: 0 } },
    { id: 'weather-lightning', enabled: true, stats: { count: 0 } },
    { id: 'wind', enabled: true, stats: { count: 0 } },
    { id: 'private-layer', enabled: true, stats: { count: 123 } },
  ];
  const modules = new Map(
    managerRows.map((row) => [
      row.id,
      {
        getStats: () => ({
          loading: row.id === 'weather-radar',
          error:
            row.id === 'weather-radar'
              ? 'source unavailable at https://private.invalid/map?token=must-hide'
              : null,
          observedAt: null,
        }),
        getParams: () =>
          row.id === 'weather-satellite'
            ? { product: 'clouds-regional', infrared: 'filtered' }
            : row.id === 'wind'
              ? { model: 'gfs', overlay: 'speed', paused: false }
              : {},
        getDiagnostics: () =>
          row.id === 'weather-radar'
            ? {
                clock: { mode: 'history', target: fixtureTime, playing: false },
              }
            : null,
      },
    ]),
  );
  const fixtureTime = WEATHER_EFFECTS_FIXED_TIME;
  const window = {
    __godsEyeView: {
      dataManager: {
        getAll: () => managerRows,
        layers: { get: (id) => ({ module: modules.get(id) }) },
      },
    },
  };
  const observed = JSON.parse(
    JSON.stringify(
      runInNewContext(
        `(${weatherEffectsFixtureApi.observeWeatherEffectsLayerState.toString()})()`,
        { window: { ...window, matchMedia: () => ({ matches: false }) } },
      ),
    ),
  );
  assert.equal(observed.status, 'observed');
  assert.deepEqual(
    observed.layers.map(({ id }) => id),
    ['weather-radar', 'weather-satellite', 'weather-lightning', 'wind'],
  );
  assert.equal(observed.layers[0].loading, true);
  assert.deepEqual(observed.motionPreference, {
    schema: 'gev-weather-motion-preference/v1',
    reducedMotion: false,
  });
  assert.equal(observed.layers[0].error, 'source unavailable at [url]');
  assert.equal(observed.layers[1].product, 'clouds-regional');
  assert.deepEqual(observed.clock, {
    mode: 'history',
    target: fixtureTime,
    playing: false,
  });
  assert.equal(JSON.stringify(observed).includes('private-layer'), false);
});

test('weather delivery fails closed on missing source, wrong bytes or population drift', async () => {
  const fixture = createWeatherEffectsWorkloadFixture();
  const delivery = createWeatherEffectsFixtureDelivery(fixture, BASE);
  const layers = Object.entries(fixture.expectedLayerCounts).map(
    ([id, count]) => ({ id, enabled: true, count }),
  );
  const radarManifest = await delivery.respond(
    new URL('/api/weather/manifest?product=radar', BASE),
    { method: 'GET' },
  );
  delivery.onFulfilled({
    url: new URL('/api/weather/manifest?product=radar', BASE).href,
    method: 'GET',
    status: 200,
    bodyBase64: Buffer.from(radarManifest.body).toString('base64'),
  });
  assert.throws(
    () => delivery.summarize(layers, layers),
    /tile|expected|missing/i,
  );

  const changed = createWeatherEffectsFixtureDelivery(fixture, BASE);
  await assert.rejects(
    changed.respond(
      new URL('/api/weather/manifest?product=radar&unexpected=true', BASE),
      { method: 'GET' },
    ),
    /Unexpected or malformed/,
  );
  await assert.rejects(
    changed.respond(new URL('/api/weather/unknown', BASE), {
      method: 'GET',
    }),
    /Unexpected or malformed/,
  );
  await assert.rejects(
    createWeatherSource({
      fetchImpl: async () => new Response('not a manifest'),
    }).getSnapshot({ product: 'radar' }),
    /Malformed weather manifest|JSON/i,
  );
  const wrongGrid = createWindSource({
    fetchImpl: async (url) =>
      url.includes('/manifest')
        ? Response.json({
            ...fixture.windManifest,
            gridUrl: 'https://outside.invalid/grid',
          })
        : new Response(Buffer.alloc(0)),
  });
  await assert.rejects(wrongGrid.getSnapshot(), /Malformed wind manifest/);
  assert.throws(
    () =>
      delivery.summarize(
        layers,
        layers.map((row) => ({ ...row, count: row.count + 1 })),
      ),
    /deeply|expected|populations/i,
  );
});

test('delivery summary requires and hashes each distinct weather history frame', async () => {
  const fixture = createWeatherEffectsWorkloadFixture();
  const delivery = createWeatherEffectsFixtureDelivery(fixture, BASE);
  const fulfill = async (assetId, url) => {
    const result = await delivery.respond(new URL(url, BASE), {
      method: 'GET',
    });
    assert.ok(result, assetId);
    delivery.onFulfilled({
      url: new URL(url, BASE).href,
      method: 'GET',
      status: result.status,
      bodyBase64: Buffer.from(result.body).toString('base64'),
    });
  };
  for (const product of ['radar', 'clouds-regional', 'lightning']) {
    await fulfill(
      `${product}-manifest`,
      `/api/weather/manifest?product=${product}`,
    );
    for (const time of fixture.manifests[product].times) {
      await fulfill(
        `${product}-tile`,
        `/api/weather/tile?product=${product}&time=${encodeURIComponent(time)}&z=2&x=3&y=1`,
      );
    }
  }
  await fulfill('wind-manifest', '/api/wind/manifest?model=gfs');
  await fulfill('wind-grid', fixture.windManifest.gridUrl);
  const layers = Object.entries(fixture.expectedLayerCounts).map(
    ([id, count]) => ({ id, enabled: true, count }),
  );
  const summary = delivery.summarize(layers, layers);
  assert.equal(summary.assets.length, fixture.assets.length);
  assert.ok(summary.assets.every((asset) => asset.responseCount > 0));
  assert.deepEqual(
    fixture.assets
      .filter((asset) => asset.id.endsWith('tile-0'))
      .map((asset) => asset.id)
      .sort(),
    ['clouds-regional-tile-0', 'lightning-tile-0', 'radar-tile-0'],
  );
  assert.throws(
    () =>
      delivery.summarize(
        [...layers, { id: 'unexpected-layer', enabled: true, count: 9 }],
        layers,
      ),
    /deeply|expected|populations/i,
  );
});

test('pending fixture delivery wait is canceled and releases its timer on disposal', async () => {
  const fixture = createWeatherEffectsWorkloadFixture();
  const delivery = createWeatherEffectsFixtureDelivery(fixture, BASE);
  const pending = delivery.waitForRequiredAssets(60_000);
  assert.equal(delivery.dispose(), true);
  await assert.rejects(pending, /disposed/);
  assert.equal(delivery.dispose(), false);
  await assert.rejects(delivery.waitForRequiredAssets(1000), /disposed/);
});

test('aborted fixture delivery wait preserves cancellation and removes its waiter', async () => {
  const fixture = createWeatherEffectsWorkloadFixture();
  const delivery = createWeatherEffectsFixtureDelivery(fixture, BASE);
  const controller = new AbortController();
  const pending = delivery.waitForRequiredAssets(60_000, {
    signal: controller.signal,
  });
  controller.abort(new Error('owned page closed'));
  await assert.rejects(pending, /owned page closed/);
  delivery.dispose();
});

test('weather clock assertion checks exact wall and Cesium epoch on both boundaries', () => {
  const fixture = createWeatherEffectsWorkloadFixture();
  const observation = {
    wallClockEpochMs: fixture.fixedTimeMs,
    cesiumClock: {
      currentTime: {
        dayNumber: fixture.clock.dayNumber,
        secondsOfDay: fixture.clock.secondsOfDay,
      },
      shouldAnimate: false,
      multiplier: 0,
    },
  };
  assertWeatherEffectsClock(observation, fixture, 'sample before');
  for (const change of [
    { wallClockEpochMs: fixture.fixedTimeMs + 1 },
    { cesiumClock: { ...observation.cesiumClock, shouldAnimate: true } },
    { cesiumClock: { ...observation.cesiumClock, multiplier: 1 } },
  ])
    assert.throws(
      () =>
        assertWeatherEffectsClock(
          { ...observation, ...change },
          fixture,
          'sample after',
        ),
      /sample after/,
    );
});
