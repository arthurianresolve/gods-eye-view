import test from 'node:test';
import assert from 'node:assert/strict';
import {
  describeObservedRoute,
  observeCommonScene,
} from './commonSceneObserver.mjs';

function fakeWindow() {
  let parameterQueries = 0;
  const gl = {
    RENDERER: 1,
    VENDOR: 2,
    isContextLost: () => false,
    getParameter: (key) => {
      parameterQueries += 1;
      return key === 1 ? 'test renderer' : 'test vendor';
    },
  };
  const contextAttributes = {
    alpha: true,
    antialias: false,
    depth: true,
    failIfMajorPerformanceCaveat: false,
    powerPreference: 'default',
    premultipliedAlpha: true,
    preserveDrawingBuffer: true,
    stencil: false,
  };
  const visualState = {
    style: 'normal',
    styleParams: {},
    bloom: { enabled: false, intensity: 0 },
    sharpen: { enabled: false, intensity: 0 },
  };
  const style = {
    getVisualState: () => visualState,
    _adaptiveQuality: { getMode: () => 'manual' },
    services: {
      getDetectionTuning: () => ({ densityPct: 75 }),
      getDetectionMode: () => 'DENSE',
    },
    shareLinkManager: {
      getCurrentView: () => ({ style: 'normal', map: 'osm' }),
    },
  };
  const transform = Array(16).fill(0);
  transform[0] = transform[5] = transform[10] = transform[15] = 1;
  const layer = { id: 'flights', enabled: true, stats: { count: 2500 } };
  const windowObject = {
    __godsEyeView: {
      viewer: {
        scene: {
          postRender: { addEventListener() {} },
          canvas: {
            width: 640,
            height: 360,
            getContext: () => {
              throw new Error('Common observer must not query canvas context');
            },
          },
          context: { _originalGLContext: gl },
          msaaSamples: 4,
          postProcessStages: { fxaa: { enabled: true } },
        },
        camera: {
          position: { x: 1, y: 2, z: 3 },
          direction: { x: 0, y: 1, z: 0 },
          up: { x: 0, y: 0, z: 1 },
          transform,
        },
        resolutionScale: 1,
        clock: {
          currentTime: { dayNumber: 2_461_000, secondsOfDay: 43_200 },
          shouldAnimate: false,
          multiplier: 0,
        },
      },
      styleManager: style,
      dataManager: { getAll: () => [layer] },
    },
    navigator: { userAgent: 'test browser', platform: 'test' },
    __gevRecoveryEarlyRendererProbe: {
      captured: true,
      contextLost: false,
      contextRestored: false,
      renderer: 'test renderer',
      vendor: 'test vendor',
      contextAttributes,
      parameterQueryCount: 2,
      queryDurationMs: 0.25,
      canvas: null,
      context: gl,
    },
    innerWidth: 640,
    innerHeight: 360,
    devicePixelRatio: 1,
    document: { hasFocus: () => true, hidden: false },
    Date: { now: () => 1_797_840_000_000 },
    get parameterQueries() {
      return parameterQueries;
    },
  };
  windowObject.__gevRecoveryEarlyRendererProbe.canvas =
    windowObject.__godsEyeView.viewer.scene.canvas;
  return windowObject;
}

test('common observer emits shared Cesium scene and effective workload inputs', () => {
  const windowObject = fakeWindow();
  const queriesBefore = windowObject.parameterQueries;
  const observed = observeCommonScene({
    windowObject,
    appCommit: 'a'.repeat(40),
  });
  assert.equal(windowObject.parameterQueries, queriesBefore);
  assert.equal(observed.environment.renderer, 'test renderer');
  assert.equal(observed.environment.vendor, 'test vendor');
  assert.equal(observed.environment.rendererEvidence.parameterQueryCount, 2);
  assert.deepEqual(observed.environment.rendererEvidence.contextAttributes, {
    alpha: true,
    antialias: false,
    depth: true,
    failIfMajorPerformanceCaveat: false,
    powerPreference: 'default',
    premultipliedAlpha: true,
    preserveDrawingBuffer: true,
    stencil: false,
  });
  assert.deepEqual(observed.environment.drawingBuffer, {
    width: 640,
    height: 360,
  });
  assert.deepEqual(observed.environment.layers, [
    { id: 'flights', enabled: true, count: 2500 },
  ]);
  assert.equal(observed.environment.appCommit, 'a'.repeat(40));
  assert.equal(observed.settings.densityPct, 75);
  assert.equal(observed.settings.qualityMode, 'manual');
  assert.equal(observed.settings.bloom, false);
  assert.equal(observed.settings.bloomIntensity, 0);
  assert.equal(observed.settings.sharpen, false);
  assert.equal(observed.settings.sharpenIntensity, 0);
  assert.deepEqual(observed.cesiumClock, {
    currentTime: { dayNumber: 2_461_000, secondsOfDay: 43_200 },
    shouldAnimate: false,
    multiplier: 0,
  });
  assert.equal(observed.wallClockEpochMs, 1_797_840_000_000);
  assert.equal(observed.camera.transform.length, 16);
});

test('common observer refuses to invent missing renderer, counts or visual settings', () => {
  const noRenderer = fakeWindow();
  noRenderer.__gevRecoveryEarlyRendererProbe.renderer = null;
  noRenderer.__gevRecoveryEarlyRendererProbe.canvas =
    noRenderer.__godsEyeView.viewer.scene.canvas;
  assert.throws(
    () => observeCommonScene({ windowObject: noRenderer }),
    /complete early Cesium renderer evidence/,
  );

  const noCount = fakeWindow();
  noCount.__godsEyeView.dataManager.getAll = () => [
    { id: 'flights', enabled: true, stats: {} },
  ];
  assert.throws(
    () => observeCommonScene({ windowObject: noCount }),
    /count for enabled layer flights/,
  );

  const noVisualState = fakeWindow();
  delete noVisualState.__godsEyeView.styleManager.getVisualState;
  assert.throws(
    () => observeCommonScene({ windowObject: noVisualState }),
    /visual-state reader/,
  );

  for (const field of ['bloom', 'sharpen']) {
    const invalidIntensity = fakeWindow();
    invalidIntensity.__godsEyeView.styleManager.getVisualState = () => ({
      style: 'normal',
      styleParams: {},
      bloom: { enabled: false, intensity: 0 },
      sharpen: { enabled: false, intensity: 0 },
      [field]: { enabled: false },
    });
    assert.throws(
      () => observeCommonScene({ windowObject: invalidIntensity }),
      /effective visual state/,
      `${field} intensity must be present and finite`,
    );

    const nonFiniteIntensity = fakeWindow();
    const readVisualState =
      nonFiniteIntensity.__godsEyeView.styleManager.getVisualState;
    nonFiniteIntensity.__godsEyeView.styleManager.getVisualState = () => ({
      ...readVisualState(),
      [field]: { enabled: false, intensity: Number.NaN },
    });
    assert.throws(
      () => observeCommonScene({ windowObject: nonFiniteIntensity }),
      /effective visual state/,
      `${field} intensity must be finite`,
    );
  }
});

test('common observer rejects missing, replaced, lost, and restored early contexts', () => {
  const missing = fakeWindow();
  delete missing.__gevRecoveryEarlyRendererProbe;
  assert.throws(
    () => observeCommonScene({ windowObject: missing }),
    /early Cesium renderer evidence/,
  );

  const replaced = fakeWindow();
  replaced.__gevRecoveryEarlyRendererProbe.canvas =
    replaced.__godsEyeView.viewer.scene.canvas;
  replaced.__godsEyeView.viewer.scene.context._originalGLContext = {};
  assert.throws(
    () => observeCommonScene({ windowObject: replaced }),
    /Cesium renderer context identity/,
  );

  for (const field of ['contextLost', 'contextRestored']) {
    const changed = fakeWindow();
    changed.__gevRecoveryEarlyRendererProbe.canvas =
      changed.__godsEyeView.viewer.scene.canvas;
    changed.__gevRecoveryEarlyRendererProbe[field] = true;
    assert.throws(
      () => observeCommonScene({ windowObject: changed }),
      /unchanged Cesium WebGL context/,
    );
  }
});

test('baseline and candidate observations consume their own cached page renderer evidence', () => {
  const appCommits = ['a'.repeat(40), 'b'.repeat(40)];
  const observations = appCommits.map((appCommit) => {
    const windowObject = fakeWindow();
    const queriesBefore = windowObject.parameterQueries;
    const observed = observeCommonScene({ windowObject, appCommit });
    assert.equal(windowObject.parameterQueries, queriesBefore);
    return observed;
  });
  assert.deepEqual(
    observations.map((item) => item.environment.appCommit),
    appCommits,
  );
  assert.ok(
    observations.every(
      (item) =>
        item.environment.rendererEvidence.source ===
        'early-cesium-context-creation',
    ),
  );
});

test('route adapter preserves the measured motion distance and tracking identity', () => {
  const start = {
    position: { x: 1, y: 2, z: 3 },
    direction: { x: 0, y: 1, z: 0 },
    up: { x: 0, y: 0, z: 1 },
    transform: Array(16).fill(0),
  };
  const motion = describeObservedRoute({
    scenario: 'scripted-motion',
    start,
    durationMs: 60_000,
    measurement: {
      cameraPath: { id: 'elapsed-move-right-v1', motionDistanceM: 19_200 },
    },
  });
  assert.equal(motion.motionDistanceM, 19_200);
  assert.equal(motion.elapsedDurationMs, 60_000);
  const tracking = describeObservedRoute({
    scenario: 'selected-aircraft-tracking',
    start,
    durationMs: 60_000,
    measurement: {
      cameraPath: { id: 'tracked-aircraft-v1', motionDistanceM: 80 },
    },
    fixture: { id: 'ring-v1' },
  });
  assert.equal(tracking.motionDistanceM, 0);
  assert.equal(tracking.selectedIdentity, 'flights:000001');
  assert.equal(tracking.trajectoryId, 'ring-v1:000001');
  assert.throws(
    () =>
      describeObservedRoute({
        scenario: 'scripted-motion',
        start,
        durationMs: 60_000,
        measurement: {
          cameraPath: { id: 'route', motionDistanceM: undefined },
        },
      }),
    /distance is unavailable/,
  );
});
