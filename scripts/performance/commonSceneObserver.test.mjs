import test from 'node:test';
import assert from 'node:assert/strict';
import {
  describeObservedRoute,
  observeCommonScene,
} from './commonSceneObserver.mjs';

function fakeWindow() {
  const gl = {
    RENDERER: 1,
    VENDOR: 2,
    getContextAttributes: () => ({ antialias: false }),
    getExtension: () => null,
    getParameter: (key) => (key === 1 ? 'test renderer' : 'test vendor'),
  };
  const visualState = { style: 'normal', styleParams: {} };
  const style = {
    getVisualState: () => visualState,
    _adaptiveQuality: { getMode: () => 'manual' },
    services: {
      getDetectionTuning: () => ({ densityPct: 75 }),
      getDetectionMode: () => 'DENSE',
    },
    bloomEnabled: false,
    bloomIntensity: 0,
    sharpenEnabled: false,
    sharpenIntensity: 0,
    shareLinkManager: {
      getCurrentView: () => ({ style: 'normal', map: 'osm' }),
    },
  };
  const transform = Array(16).fill(0);
  transform[0] = transform[5] = transform[10] = transform[15] = 1;
  const layer = { id: 'flights', enabled: true, stats: { count: 2500 } };
  return {
    __godsEyeView: {
      viewer: {
        scene: {
          postRender: { addEventListener() {} },
          canvas: {
            width: 640,
            height: 360,
            getContext: () => gl,
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
      },
      styleManager: style,
      dataManager: { getAll: () => [layer] },
    },
    navigator: { userAgent: 'test browser', platform: 'test' },
    innerWidth: 640,
    innerHeight: 360,
    devicePixelRatio: 1,
    document: { hasFocus: () => true, hidden: false },
  };
}

test('common observer emits shared Cesium scene and effective workload inputs', () => {
  const observed = observeCommonScene({
    windowObject: fakeWindow(),
    appCommit: 'a'.repeat(40),
  });
  assert.equal(observed.environment.renderer, 'test renderer');
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
  assert.equal(observed.camera.transform.length, 16);
});

test('common observer refuses to invent missing renderer, counts or visual settings', () => {
  const noRenderer = fakeWindow();
  noRenderer.__godsEyeView.viewer.scene.context._originalGLContext.getParameter =
    () => null;
  assert.throws(
    () => observeCommonScene({ windowObject: noRenderer }),
    /renderer identity/,
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
