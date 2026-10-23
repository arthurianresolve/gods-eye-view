import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import {
  probeWeatherVisibleWind,
  runVisibleWindProbeInPage,
  validateVisibleWindProbeReport,
  WEATHER_VISIBLE_WIND_PROBE_MAX_TIMEOUT_MS,
  WEATHER_VISIBLE_WIND_PROBE_SCHEMA,
} from './weatherVisibleWindProbe.mjs';

function fakePage(options = {}) {
  let now = 0;
  let paused = options.initialPaused ?? false;
  let phaseTime = 3;
  let visibleCells = options.visibleCells ?? 24;
  let heightFade = options.heightFade ?? 1;
  let ready = options.ready ?? true;
  let forcePauseMotion = options.forcePauseMotion ?? false;
  let forceResumeStuck = options.forceResumeStuck ?? false;
  let resumed = false;
  let wasPaused = paused;
  let throwOnRestore = options.throwOnRestore ?? false;
  let alterRestoreHeading = options.alterRestoreHeading ?? false;
  let setViewCalls = 0;
  const handlers = new Set();
  const layer = {
    id: 'wind',
    enabled: true,
    stats: options.omitLayerStats ? undefined : { count: 65_160 },
    getStats: () => ({ count: 65_160 }),
    module: {
      getParams: () => ({
        model: 'gfs',
        overlay: 'speed',
        paused,
        units: 'km/h',
      }),
      setParams: (params) => {
        if (typeof params.paused === 'boolean') {
          if (params.paused) wasPaused = true;
          if (wasPaused && !params.paused) resumed = true;
          paused = params.paused;
        }
      },
      getDiagnostics: () => ({
        renderMode: 'gpu-streamlines',
        paused,
        reducedMotion: false,
        hidden: false,
        framePending: false,
        gpu: {
          ready,
          heightFade,
          visibleCells,
          visibleVertexCount: visibleCells * 6,
          pathCount: visibleCells,
          displayHeightMeters: 12_000,
        },
      }),
    },
  };
  const manager = {
    getAll: () => [layer],
    isEnabled: () => true,
    layers: new Map([['wind', layer]]),
  };
  const position = {
    x: 1,
    y: 0.5,
    z: 12_000,
    clone() {
      return { x: this.x, y: this.y, z: this.z, clone: this.clone };
    },
  };
  const camera = {
    position,
    positionCartographic: null,
    heading: 0.1,
    pitch: -0.7,
    roll: 0,
    setView({ destination, orientation }) {
      setViewCalls += 1;
      if (throwOnRestore && setViewCalls > 1)
        throw new Error('restore refused');
      this.position = destination;
      this.positionCartographic = {
        longitude: destination.x,
        latitude: destination.y,
        height: destination.z,
      };
      this.heading =
        orientation.heading +
        (alterRestoreHeading && setViewCalls > 1 ? 0.1 : 0);
      this.pitch = orientation.pitch;
      this.roll = orientation.roll;
    },
  };
  camera.positionCartographic = {
    longitude: position.x,
    latitude: position.y,
    height: position.z,
  };
  const materialUniforms = {
    get phaseTime() {
      return phaseTime;
    },
    get heightFade() {
      return heightFade;
    },
  };
  const primitive = {
    appearance: {
      material: {
        type: options.materialType ?? 'GevWindStreamline',
        uniforms: materialUniforms,
      },
    },
  };
  const postRender = {
    addEventListener: (handler) => handlers.add(handler),
    removeEventListener: (handler) => handlers.delete(handler),
  };
  const scene = {
    globe: {
      maximumScreenSpaceError: 1,
      ellipsoid: {
        cartographicToCartesian: ({ longitude, latitude, height }) => ({
          x: longitude,
          y: latitude,
          z: height,
          clone() {
            return { x: this.x, y: this.y, z: this.z, clone: this.clone };
          },
        }),
      },
    },
    canvas: {
      clientWidth: 1440,
      clientHeight: 900,
      width: 2880,
      height: 1800,
    },
    primitives: {
      length:
        options.sharedWindMaterialReferences ??
        (options.duplicateWindMaterials ? 2 : 1),
      get: (index) =>
        index === 0
          ? primitive
          : {
              appearance: {
                material: options.sharedWindMaterialReferences
                  ? primitive.appearance.material
                  : {
                      type: 'GevWindStreamline',
                      uniforms: materialUniforms,
                    },
              },
            },
    },
    frameNumber: 0,
    msaaSamples: 4,
    context: {
      _originalGLContext: { getContextAttributes: () => ({ antialias: true }) },
    },
    postProcessStages: { fxaa: { enabled: true } },
    postRender,
  };
  const app = {
    viewer: {
      camera,
      scene,
      resolutionScale: 1,
      __gevNativeSharpnessProfile: 'native-sharpness-v1',
    },
    dataManager: manager,
    styleManager: {
      _adaptiveQuality: { getMode: () => 'manual' },
      _runExplicitNavigation: (_noun, run) =>
        options.refuseNavigation ? false : run(),
      getVisualState: () => ({
        style: 'normal',
        styleParams: { normal: { saturation: 1 } },
        bloom: { enabled: false, intensity: 0 },
        sharpen: { enabled: false, intensity: 0 },
        hud: { visible: true, variant: 'default' },
        detection: { mode: 'DENSE', density: 75, allocation: 'budgeted' },
        scope: { enabled: false, featherPct: 0 },
        mapStack: 'osm',
      }),
      services: {
        getDetectionTuning: () => ({ densityPct: 75 }),
        getDetectionMode: () => 'DENSE',
      },
    },
  };
  let expired = false;
  const sandbox = {
    window: { __godsEyeView: app, devicePixelRatio: 2 },
    performance: { now: () => now },
    setTimeout(callback, ms) {
      if (ms > 100) return 1;
      if (options.expireDuringWait && !expired) {
        now = 10_000;
        expired = true;
      } else now += ms;
      const advances =
        (!paused && !(forceResumeStuck && resumed)) ||
        (paused && forcePauseMotion);
      if (advances) phaseTime += ms / 1000;
      if (handlers.size) {
        scene.frameNumber += 1;
        for (const handler of handlers) handler();
      }
      callback();
      return 2;
    },
    clearTimeout() {},
    Promise,
    Number,
    Math,
    Array,
    Object,
    Set,
    String,
    JSON,
  };
  const page = {
    async evaluate(fn, ...args) {
      if (options.rejectEvaluate) throw new Error('page was closed');
      const source = `(${fn.toString()})(...${JSON.stringify(args)})`;
      return vm.runInNewContext(source, sandbox);
    },
  };
  return {
    page,
    handlers,
    getState: () => ({ paused, phaseTime, camera, setViewCalls }),
    setVisibleCells: (value) => {
      visibleCells = value;
    },
    setHeightFade: (value) => {
      heightFade = value;
    },
    setReady: (value) => {
      ready = value;
    },
    setForcePauseMotion: (value) => {
      forcePauseMotion = value;
    },
    setForceResumeStuck: (value) => {
      forceResumeStuck = value;
    },
  };
}

const SHORT_TIMING = {
  settleMs: 250,
  unpausedMs: 500,
  pausedMs: 500,
  resumedMs: 500,
  timeoutMs: 5_000,
};

test('visible wind probe proves visible GPU flow, pause stability, resume, and restoration', async () => {
  const fixture = fakePage();
  const report = await probeWeatherVisibleWind({
    page: fixture.page,
    timing: SHORT_TIMING,
  });
  assert.equal(report.schema, WEATHER_VISIBLE_WIND_PROBE_SCHEMA);
  assert.equal(report.diagnosticOnly, true);
  assert.equal(report.performanceAcceptanceEligible, false);
  assert.equal(report.status, 'observed');
  assert.ok(
    report.phases.unpaused.end.windMaterial.phaseTime >
      report.phases.unpaused.start.windMaterial.phaseTime,
  );
  assert.equal(
    report.phases.paused.start.windMaterial.phaseTime,
    report.phases.paused.end.windMaterial.phaseTime,
  );
  assert.ok(
    report.phases.resumed.end.windMaterial.phaseTime >
      report.phases.resumed.start.windMaterial.phaseTime,
  );
  assert.ok(report.phases.resumed.postRenderCount > 0);
  assert.equal(fixture.handlers.size, 0);
  assert.equal(fixture.getState().paused, false);
  assert.equal(fixture.getState().camera.position.z, 12_000);
  assert.deepEqual(validateVisibleWindProbeReport(report), {
    valid: true,
    failures: [],
  });
});

test('visible wind probe rejects absent GPU readiness and zero visible geometry', async () => {
  for (const configure of [
    (fixture) => fixture.setReady(false),
    (fixture) => fixture.setVisibleCells(0),
    (fixture) => fixture.setHeightFade(0),
  ]) {
    const fixture = fakePage();
    configure(fixture);
    const report = await probeWeatherVisibleWind({
      page: fixture.page,
      timing: SHORT_TIMING,
    });
    assert.equal(report.status, 'failed');
    assert.ok(
      report.failureReasons.includes('wind-gpu-not-visible-at-probe-pose'),
    );
    assert.equal(fixture.getState().camera.position.z, 12_000);
  }
});

test('visible wind probe requires normalized settled population counts', async () => {
  const report = await probeWeatherVisibleWind({
    page: fakePage({ omitLayerStats: true }).page,
    timing: SHORT_TIMING,
  });
  assert.equal(report.status, 'failed');
  assert.ok(
    report.failureReasons.some((reason) =>
      reason.startsWith('enabled-layer-population-count-unavailable:'),
    ),
  );
});

test('visible wind probe requires one explicitly identified streamline material', async () => {
  for (const options of [
    { materialType: 'UnrelatedMaterial' },
    { duplicateWindMaterials: true },
  ]) {
    const report = await probeWeatherVisibleWind({
      page: fakePage(options).page,
      timing: SHORT_TIMING,
    });
    assert.equal(report.status, 'failed');
    assert.ok(
      report.failureReasons.includes('wind-gpu-not-visible-at-probe-pose'),
    );
  }
});

test('visible wind probe counts a material shared across spatial cells once', async () => {
  const fixture = fakePage({ sharedWindMaterialReferences: 72 });
  const report = await probeWeatherVisibleWind({
    page: fixture.page,
    timing: SHORT_TIMING,
  });
  assert.equal(report.status, 'observed');
  const material = report.phases.unpaused.start.windMaterial;
  assert.equal(material.matchCount, 1);
  assert.equal(material.materialReferenceCount, 72);
  assert.equal(material.traversalComplete, true);
  assert.equal(fixture.handlers.size, 0);
});

test('visible wind probe never treats a truncated primitive traversal as unique ownership', async () => {
  const report = await probeWeatherVisibleWind({
    page: fakePage({ sharedWindMaterialReferences: 2100 }).page,
    timing: SHORT_TIMING,
  });
  assert.equal(report.status, 'failed');
  assert.equal(
    report.phases.unpaused.start.windMaterial.traversalComplete,
    false,
  );
  assert.equal(report.phases.unpaused.start.windMaterial.phaseTime, null);
});

test('visible wind probe rejects phase drift while paused and a stuck resumed phase', async () => {
  const pausedDrift = fakePage({ forcePauseMotion: true });
  const pausedReport = await probeWeatherVisibleWind({
    page: pausedDrift.page,
    timing: SHORT_TIMING,
  });
  assert.ok(
    pausedReport.failureReasons.includes('paused-wind-phase-was-not-stable'),
  );

  const resumedStuck = fakePage({ forceResumeStuck: true });
  const resumedReport = await probeWeatherVisibleWind({
    page: resumedStuck.page,
    timing: SHORT_TIMING,
  });
  assert.ok(
    resumedReport.failureReasons.includes(
      'resumed-wind-did-not-advance-with-natural-render',
    ),
  );
  assert.equal(resumedStuck.handlers.size, 0);
});

test('visible wind probe restores camera and pause state when observation throws', async () => {
  const fixture = fakePage({ throwOnRestore: true });
  const report = await probeWeatherVisibleWind({
    page: fixture.page,
    timing: SHORT_TIMING,
  });
  assert.equal(report.status, 'failed');
  assert.ok(report.failureReasons.includes('camera-restore-failed'));
  assert.equal(report.cleanup.pauseRestored, true);
  assert.equal(fixture.handlers.size, 0);
});

test('camera restoration checks orientation and records refused owned navigation', async () => {
  const changedHeading = await probeWeatherVisibleWind({
    page: fakePage({ alterRestoreHeading: true }).page,
    timing: SHORT_TIMING,
  });
  assert.equal(changedHeading.status, 'failed');
  assert.ok(
    changedHeading.failureReasons.includes('camera-restoration-unverified'),
  );

  const refused = await probeWeatherVisibleWind({
    page: fakePage({ refuseNavigation: true }).page,
    timing: SHORT_TIMING,
  });
  assert.equal(refused.status, 'failed');
  assert.equal(refused.navigationOwnership.moveAccepted, false);
  assert.ok(
    refused.failureReasons.includes('camera-navigation-ownership-refused'),
  );
});

test('probe temporarily resumes pre-paused wind and restores the original pause state', async () => {
  const fixture = fakePage({ initialPaused: true });
  const report = await probeWeatherVisibleWind({
    page: fixture.page,
    timing: SHORT_TIMING,
  });
  assert.equal(report.status, 'observed');
  assert.equal(report.windParams.before.paused, true);
  assert.equal(report.phases.unpaused.start.diagnostics.paused, false);
  assert.equal(report.cleanup.pauseRestored, true);
  assert.equal(fixture.getState().paused, true);
});

test('page evaluation failure is retained as failed with cleanup unknown', async () => {
  const report = await probeWeatherVisibleWind({
    page: fakePage({ rejectEvaluate: true }).page,
    timing: SHORT_TIMING,
  });
  assert.equal(report.status, 'failed');
  assert.equal(report.cleanup.attempted, false);
  assert.match(report.failureReasons[0], /^page-evaluation-failed:/);
  assert.equal(report.pageEvaluationMayBeRunning, false);
  assert.ok(Number.isFinite(report.hostElapsedMs));
});

test('host cancellation is bounded and reports page cleanup as unknown', async () => {
  const controller = new AbortController();
  let evaluationStarted = false;
  const page = {
    evaluate: () => {
      evaluationStarted = true;
      return new Promise(() => {});
    },
  };
  const pending = probeWeatherVisibleWind({
    page,
    timing: SHORT_TIMING,
    signal: controller.signal,
  });
  await Promise.resolve();
  controller.abort();
  const report = await pending;
  assert.equal(evaluationStarted, true);
  assert.equal(report.status, 'failed');
  assert.equal(report.pageEvaluationMayBeRunning, true);
  assert.equal(report.cleanup.cameraRestored, false);
  assert.equal(report.cleanup.pauseRestored, false);
  assert.equal(report.totalElapsedMs, null);
  assert.ok(Number.isFinite(report.hostElapsedMs));
});

test('probe deadline fails closed and still restores owned page state', async () => {
  const fixture = fakePage({ expireDuringWait: true });
  const report = await probeWeatherVisibleWind({
    page: fixture.page,
    timing: SHORT_TIMING,
  });
  assert.equal(report.status, 'failed');
  assert.ok(report.failureReasons.includes('probe-timeout'));
  assert.equal(report.cleanup.cameraRestored, true);
  assert.equal(report.cleanup.pauseRestored, true);
  assert.equal(fixture.handlers.size, 0);
});

test('probe timing and returned diagnostic report fail closed', async () => {
  await assert.rejects(
    probeWeatherVisibleWind({
      page: fakePage().page,
      timing: { timeoutMs: 4_000 },
    }),
    RangeError,
  );
  assert.equal(WEATHER_VISIBLE_WIND_PROBE_MAX_TIMEOUT_MS, 30_000);
  assert.deepEqual(
    validateVisibleWindProbeReport({
      schema: WEATHER_VISIBLE_WIND_PROBE_SCHEMA,
    }),
    {
      valid: false,
      failures: [
        'not-explicitly-diagnostic-only',
        'probe-not-observed',
        'camera-not-restored',
        'pause-not-restored',
        'probe-has-failures',
      ],
    },
  );
});

test('probe evaluator is self-contained when serialized into an isolated page realm', async () => {
  const fixture = fakePage();
  const report = await fixture.page.evaluate(
    runVisibleWindProbeInPage,
    SHORT_TIMING,
  );
  assert.equal(report.status, 'observed');
  assert.equal(report.cleanup.cameraRestored, true);
  assert.equal(report.phases.resumed.end.diagnostics.gpu.visibleCells, 24);
});
