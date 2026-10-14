import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import vm from 'node:vm';

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../..',
);
const COLLISION_MANIFEST = JSON.parse(
  readFileSync(
    path.join(ROOT, 'patches/cesium-1.138.0-collision-transform.json'),
    'utf8',
  ),
);
let temporaryRoot;
const sourceRoot = path.join(ROOT, 'node_modules/@cesium/engine');
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');

function collisionBaseBytes(entry) {
  const filePath = path.join(ROOT, 'node_modules', entry.relativePath);
  const installed = readFileSync(filePath);
  const installedHash = hash(installed);
  if (installedHash === entry.sourceSha256) return installed;
  assert.equal(
    installedHash,
    entry.patchedSha256,
    `unexpected installed stage for ${entry.relativePath}`,
  );
  const text = installed.toString('utf8');
  assert.equal(text.split(entry.newText).length - 1, 1);
  const base = Buffer.from(text.replace(entry.newText, entry.oldText));
  assert.equal(hash(base), entry.sourceSha256);
  return base;
}

function createDocumentTarget() {
  return Object.assign(new EventTargetLite(), {
    location: { href: 'http://localhost/' },
    createElement() {
      return {
        style: {},
        getContext() {
          return null;
        },
        setAttribute() {},
        appendChild() {},
        removeChild() {},
        getElementsByTagName() {
          return [];
        },
      };
    },
    createComment() {
      return { nodeType: 8, appendChild() {}, removeChild() {} };
    },
    getElementsByTagName() {
      return [];
    },
    head: { appendChild() {} },
    body: { appendChild() {} },
    onmousewheel: undefined,
  });
}

class EventTargetLite {
  listeners = new Map();
  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) ?? new Set();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }
  removeEventListener(type, listener) {
    this.listeners.get(type)?.delete(listener);
  }
  dispatch(type, event) {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
}

function canvasFor() {
  return Object.assign(new EventTargetLite(), {
    disableRootEvents: true,
    clientWidth: 960,
    clientHeight: 640,
    width: 960,
    height: 640,
    onwheel: null,
    style: {},
    getBoundingClientRect() {
      return { left: 0, top: 0, width: 960, height: 640 };
    },
  });
}

function cameraState(engine, camera) {
  const position = camera.positionWC;
  const direction = camera.directionWC;
  const up = camera.upWC;
  const cartographic = engine.Ellipsoid.WGS84.cartesianToCartographic(position);
  return {
    position: [position.x, position.y, position.z],
    direction: [direction.x, direction.y, direction.z],
    up: [up.x, up.y, up.z],
    transform: Array.from(camera.transform),
    localMagnitude: engine.Cartesian3.magnitude(camera.position),
    height: cartographic.height,
  };
}

function createScene(engine, globeHeight, mode = engine.SceneMode.SCENE3D) {
  const canvas = canvasFor();
  const scene = {
    canvas,
    drawingBufferWidth: canvas.width,
    drawingBufferHeight: canvas.height,
    mapProjection: new engine.GeographicProjection(engine.Ellipsoid.WGS84),
    ellipsoid: engine.Ellipsoid.WGS84,
    globe: {},
    globeHeight,
    cameraUnderground: false,
    mode,
    pixelRatio: 1,
    verticalExaggeration: 1,
    verticalExaggerationRelativeHeight: 0,
    preUpdate: new engine.Event(),
  };
  scene.camera = new engine.Camera(scene);
  return scene;
}

function stationaryTrackedCameraTrial(
  engine,
  Controller,
  repetitions,
  { offset = [0, -9920, 6820], globeHeight, lastGlobeHeight } = {},
) {
  const scene = createScene(engine, globeHeight);
  const camera = scene.camera;
  const target = new engine.Cartesian3(
    -2709524.724362489,
    -4273752.2752025165,
    3884262.905497643,
  );
  camera.lookAtTransform(
    engine.Transforms.eastNorthUpToFixedFrame(target),
    new engine.Cartesian3(...offset),
  );
  const initial = cameraState(engine, camera);
  const originalSetTransform = camera._setTransform;
  let transformWrites = 0;
  camera._setTransform = function (...args) {
    transformWrites += 1;
    return originalSetTransform.apply(this, args);
  };
  const controller = new Controller(scene);
  if (lastGlobeHeight !== undefined) {
    controller._lastGlobeHeight = lastGlobeHeight;
  }
  for (let index = 0; index < repetitions; index += 1) controller.update();
  const final = cameraState(engine, camera);
  const finalGlobeHeight = controller._lastGlobeHeight;
  controller.destroy();
  return { initial, final, transformWrites, finalGlobeHeight };
}

function belowTerrainCollisionTrial(
  engine,
  Controller,
  mode = engine.SceneMode.SCENE3D,
) {
  const scene = createScene(engine, 100, mode);
  const camera = scene.camera;
  const target = engine.Cartesian3.fromDegrees(-122.3, 37.8, 0);
  camera.lookAtTransform(
    engine.Transforms.eastNorthUpToFixedFrame(target),
    new engine.Cartesian3(0, -100, 100),
  );
  const controller = new Controller(scene);
  controller.minimumZoomDistance = 150;
  controller._lastGlobeHeight = 100;
  const originalSetTransform = camera._setTransform;
  let transformWrites = 0;
  camera._setTransform = function (...args) {
    transformWrites += 1;
    return originalSetTransform.apply(this, args);
  };
  const before = cameraState(engine, camera);
  controller.update();
  const after = cameraState(engine, camera);
  const lastGlobeHeight = controller._lastGlobeHeight;
  controller.destroy();
  return { before, after, transformWrites, lastGlobeHeight };
}

function manualMovementCollisionTrial(engine, Controller) {
  const scene = createScene(engine, 100);
  const canvas = scene.canvas;
  const camera = scene.camera;
  const target = engine.Cartesian3.fromDegrees(-122.3, 37.8, 0);
  camera.lookAtTransform(
    engine.Transforms.eastNorthUpToFixedFrame(target),
    new engine.Cartesian3(0, -100, 100),
  );
  const controller = new Controller(scene);
  controller.minimumZoomDistance = 150;
  controller._lastGlobeHeight = 100;
  const priorDocument = globalThis.document;
  if (priorDocument === undefined) globalThis.document = new EventTargetLite();
  try {
    canvas.dispatch('mousedown', eventAt(400, 300, 0));
    canvas.dispatch('mousemove', eventAt(414, 309, 0));
    controller.update();
    canvas.dispatch('mouseup', eventAt(414, 309, 0));
    const output = cameraState(engine, camera);
    const lastGlobeHeight = controller._lastGlobeHeight;
    return { output, lastGlobeHeight };
  } finally {
    controller.destroy();
    if (priorDocument === undefined) delete globalThis.document;
    else globalThis.document = priorDocument;
  }
}

function eventAt(x, y, button) {
  return {
    clientX: x,
    clientY: y,
    button,
    buttons: button === 0 ? 1 : button === 1 ? 4 : 2,
    shiftKey: false,
    ctrlKey: false,
    altKey: false,
    preventDefault() {},
    target: null,
  };
}

function sceneModeTrial(engine, Controller, mode) {
  const scene = createScene(engine, 100, mode);
  const camera = scene.camera;
  const target = engine.Cartesian3.fromDegrees(-122.3, 37.8, 0);
  camera.lookAtTransform(
    engine.Transforms.eastNorthUpToFixedFrame(target),
    new engine.Cartesian3(0, -100, 100),
  );
  const controller = new Controller(scene);
  controller.minimumZoomDistance = 150;
  controller._lastGlobeHeight = 100;
  const originalSetTransform = camera._setTransform;
  let transformWrites = 0;
  camera._setTransform = function (...args) {
    transformWrites += 1;
    return originalSetTransform.apply(this, args);
  };
  controller.update();
  const output = cameraState(engine, camera);
  controller.destroy();
  return { output, transformWrites };
}

async function loadSource(bytes, name) {
  const directory = path.join(temporaryRoot, name);
  mkdirSync(directory, { recursive: true });
  cpSync(path.join(sourceRoot, 'Source'), path.join(directory, 'Source'), {
    recursive: true,
    // Traverse through Node's JS copy path. The Node 24 native recursive path
    // failed while materializing a fresh Source/Scene directory in hosted CI.
    // Copy every entry and keep filesystem errors fatal; do not retry or omit it.
    filter: () => true,
  });
  writeFileSync(
    path.join(directory, 'package.json'),
    JSON.stringify({ type: 'module', version: '22.3.0' }),
  );
  symlinkSync(
    path.join(ROOT, 'node_modules'),
    path.join(directory, 'node_modules'),
    'junction',
  );
  const controllerPath = path.join(
    directory,
    'Source/Scene/ScreenSpaceCameraController.js',
  );
  writeFileSync(controllerPath, bytes);
  const load = (relative) =>
    import(
      `${pathToFileURL(path.join(directory, 'Source', relative)).href}?${randomUUID()}`
    );
  const [
    Camera,
    Controller,
    Cartesian3,
    Ellipsoid,
    Event,
    GeographicProjection,
    SceneMode,
    Transforms,
  ] = await Promise.all([
    load('Scene/Camera.js'),
    load('Scene/ScreenSpaceCameraController.js'),
    load('Core/Cartesian3.js'),
    load('Core/Ellipsoid.js'),
    load('Core/Event.js'),
    load('Core/GeographicProjection.js'),
    load('Scene/SceneMode.js'),
    load('Core/Transforms.js'),
  ]);
  return {
    Camera: Camera.default,
    ScreenSpaceCameraController: Controller.default,
    Cartesian3: Cartesian3.default,
    Ellipsoid: Ellipsoid.default,
    Event: Event.default,
    GeographicProjection: GeographicProjection.default,
    SceneMode: SceneMode.default,
    Transforms: Transforms.default,
  };
}

function loadIife(bytes, name, documentTarget) {
  const sandbox = {
    console,
    URL,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    performance,
    TextDecoder,
    TextEncoder,
    atob,
    btoa,
    Blob,
    TransformStream,
    ReadableStream,
    WritableStream,
    Response,
    Request,
    Headers,
    AbortController,
    location: { href: 'http://localhost/' },
    document: documentTarget,
    navigator: { userAgent: 'node' },
  };
  sandbox.global = sandbox;
  sandbox.window = sandbox;
  vm.runInNewContext(bytes.toString('utf8'), sandbox, {
    filename: name,
    timeout: 30_000,
  });
  return sandbox.Cesium;
}

function loadCjs(bytes, name, documentTarget) {
  const directory = path.join(temporaryRoot, name);
  mkdirSync(directory, { recursive: true });
  symlinkSync(
    path.join(ROOT, 'node_modules'),
    path.join(directory, 'node_modules'),
    'junction',
  );
  const modulePath = path.join(directory, 'index.cjs');
  writeFileSync(modulePath, bytes);
  const priorDocument = globalThis.document;
  const priorWindow = globalThis.window;
  globalThis.document = documentTarget;
  globalThis.window = globalThis;
  try {
    return createRequire(modulePath)(modulePath);
  } finally {
    if (priorDocument === undefined) delete globalThis.document;
    else globalThis.document = priorDocument;
    if (priorWindow === undefined) delete globalThis.window;
    else globalThis.window = priorWindow;
  }
}

async function loadDistribution(entry, bytes, suffix) {
  const documentTarget = createDocumentTarget();
  if (entry.relativePath.startsWith('@cesium/engine/Source/')) {
    return loadSource(bytes, `${suffix}-source`);
  }
  const isCjs = entry.relativePath.endsWith('.cjs');
  return isCjs
    ? loadCjs(
        bytes,
        `${suffix}-${path.basename(path.dirname(entry.relativePath))}`,
        documentTarget,
      )
    : loadIife(bytes, entry.relativePath, documentTarget);
}

test('Cesium collision transform fast path preserves correction and avoids stationary no-op transforms in all five distributions', async (t) => {
  temporaryRoot = mkdtempSync(
    path.join(os.tmpdir(), 'gev-collision-distributions-'),
  );
  t.after(() => rmSync(temporaryRoot, { recursive: true, force: true }));
  const selections = [
    '@cesium/engine/Source/Scene/ScreenSpaceCameraController.js',
    'cesium/Build/Cesium/index.cjs',
    'cesium/Build/CesiumUnminified/index.cjs',
    'cesium/Build/Cesium/Cesium.js',
    'cesium/Build/CesiumUnminified/Cesium.js',
  ];
  for (const relativePath of selections) {
    const entry = COLLISION_MANIFEST.files.find(
      (item) => item.relativePath === relativePath,
    );
    assert.ok(entry, `missing collision manifest entry: ${relativePath}`);
    const baselineBytes = collisionBaseBytes(entry);
    const candidateBytes = Buffer.from(
      baselineBytes.toString('utf8').replace(entry.oldText, entry.newText),
    );
    assert.equal(hash(candidateBytes), entry.patchedSha256);
    const baseline = await loadDistribution(
      entry,
      baselineBytes,
      `baseline-${randomUUID()}`,
    );
    const candidate = await loadDistribution(
      entry,
      candidateBytes,
      `candidate-${randomUUID()}`,
    );
    const baselineController = baseline.ScreenSpaceCameraController;
    const candidateController = candidate.ScreenSpaceCameraController;
    assert.equal(typeof baselineController, 'function', relativePath);
    assert.equal(typeof candidateController, 'function', relativePath);

    const control = stationaryTrackedCameraTrial(
      baseline,
      baselineController,
      8,
    );
    const optimized = stationaryTrackedCameraTrial(
      candidate,
      candidateController,
      8,
    );
    assert.equal(
      control.transformWrites,
      16,
      `${relativePath}: baseline should take two transform switches per frame`,
    );
    assert.equal(
      optimized.transformWrites,
      0,
      `${relativePath}: no-op tracked camera should not switch transforms`,
    );
    assert.deepEqual(
      optimized.final,
      optimized.initial,
      `${relativePath}: stationary camera pose changed`,
    );

    const lowAltitudeControl = stationaryTrackedCameraTrial(
      baseline,
      baselineController,
      1,
      { offset: [0, -100, 1_000], globeHeight: 100, lastGlobeHeight: 100 },
    );
    const lowAltitudeCandidate = stationaryTrackedCameraTrial(
      candidate,
      candidateController,
      1,
      { offset: [0, -100, 1_000], globeHeight: 100, lastGlobeHeight: 100 },
    );
    assert.equal(lowAltitudeControl.transformWrites, 2);
    assert.equal(lowAltitudeCandidate.transformWrites, 0);
    assert.equal(
      lowAltitudeCandidate.final.height,
      lowAltitudeCandidate.initial.height,
    );
    assert.deepEqual(lowAltitudeCandidate.final, lowAltitudeCandidate.initial);
    assert.equal(
      lowAltitudeCandidate.finalGlobeHeight,
      lowAltitudeControl.finalGlobeHeight,
    );

    const smoothingControl = stationaryTrackedCameraTrial(
      baseline,
      baselineController,
      1,
      { offset: [0, -100, 1_000], globeHeight: 200, lastGlobeHeight: 100 },
    );
    const smoothingCandidate = stationaryTrackedCameraTrial(
      candidate,
      candidateController,
      1,
      { offset: [0, -100, 1_000], globeHeight: 200, lastGlobeHeight: 100 },
    );
    assert.equal(smoothingControl.transformWrites, 2);
    assert.equal(smoothingCandidate.transformWrites, 0);
    assert.deepEqual(smoothingCandidate.final, smoothingCandidate.initial);
    assert.equal(smoothingCandidate.finalGlobeHeight, 110);
    assert.equal(
      smoothingCandidate.finalGlobeHeight,
      smoothingControl.finalGlobeHeight,
    );

    const collisionControl = belowTerrainCollisionTrial(
      baseline,
      baselineController,
    );
    const collisionCandidate = belowTerrainCollisionTrial(
      candidate,
      candidateController,
    );
    assert.deepEqual(
      collisionCandidate.after,
      collisionControl.after,
      `${relativePath}: correction output differs`,
    );
    assert.equal(
      collisionCandidate.lastGlobeHeight,
      collisionControl.lastGlobeHeight,
      `${relativePath}: globe-height tracking differs`,
    );
    assert.ok(
      collisionCandidate.after.localMagnitude >= 150,
      `${relativePath}: minimumZoomDistance was not enforced`,
    );
    assert.notDeepEqual(
      collisionCandidate.after.position,
      collisionCandidate.before.position,
      `${relativePath}: below-terrain control did not exercise correction`,
    );

    const manualControl = manualMovementCollisionTrial(
      baseline,
      baselineController,
    );
    const manualCandidate = manualMovementCollisionTrial(
      candidate,
      candidateController,
    );
    assert.deepEqual(manualCandidate, manualControl);
    assert.ok(manualCandidate.output.localMagnitude >= 150);
    t.diagnostic(
      `${relativePath}: 16 baseline switches vs 0 candidate; collision pose exact`,
    );

    for (const mode of [
      baseline.SceneMode.SCENE2D,
      baseline.SceneMode.COLUMBUS_VIEW,
    ]) {
      const modeControl = sceneModeTrial(baseline, baselineController, mode);
      const modeCandidate = sceneModeTrial(
        candidate,
        candidateController,
        candidate.SceneMode[
          mode === baseline.SceneMode.SCENE2D ? 'SCENE2D' : 'COLUMBUS_VIEW'
        ],
      );
      assert.deepEqual(modeCandidate.output, modeControl.output);
      assert.equal(modeCandidate.transformWrites, modeControl.transformWrites);
    }
  }
});
