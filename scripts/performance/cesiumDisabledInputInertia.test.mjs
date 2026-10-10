import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import vm from 'node:vm';
import * as Engine from '@cesium/engine';

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../..',
);
const MANIFEST = JSON.parse(
  readFileSync(path.join(ROOT, 'patches/cesium-1.138.0-inertia.json'), 'utf8'),
);
const require = createRequire(import.meta.url);
const NATIVE_DATE = globalThis.Date;

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function distributionFile(relativePath) {
  return path.join(ROOT, 'node_modules', relativePath);
}

function recoverStock(entry, patchedBytes) {
  assert.equal(sha256(patchedBytes), entry.patchedSha256);
  const patchedText = patchedBytes.toString('utf8');
  assert.equal(patchedText.split(entry.newText).length - 1, 1);
  const stock = Buffer.from(patchedText.replace(entry.newText, entry.oldText));
  assert.equal(sha256(stock), entry.sourceSha256);
  return stock;
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

let controlledNow = 1_800_000_000_000;
class ControlledDate extends NATIVE_DATE {
  constructor(...args) {
    super(...(args.length === 0 ? [controlledNow] : args));
  }

  static now() {
    return controlledNow;
  }
}

function setControlledTime() {
  controlledNow = 1_800_000_000_000;
  globalThis.Date = ControlledDate;
}

function advanceFrame() {
  controlledNow += 16;
}

function eventAt(x, y, button = 0, ctrlKey = false) {
  return {
    clientX: x,
    clientY: y,
    button,
    buttons: button === 0 ? 1 : button === 1 ? 4 : 2,
    shiftKey: false,
    ctrlKey,
    altKey: false,
    preventDefault() {},
    target: null,
  };
}

function createController(namespace, Controller, documentTarget) {
  const canvas = Object.assign(new EventTargetLite(), {
    disableRootEvents: true,
    clientWidth: 800,
    clientHeight: 600,
    onwheel: null,
    style: {},
    getBoundingClientRect() {
      return { left: 0, top: 0, width: 800, height: 600 };
    },
  });
  documentTarget.location = { href: 'http://localhost/' };
  globalThis.document = documentTarget;
  const scene = {
    canvas,
    drawingBufferWidth: 800,
    drawingBufferHeight: 600,
    mapProjection: new namespace.GeographicProjection(
      namespace.Ellipsoid.WGS84,
    ),
    ellipsoid: namespace.Ellipsoid.WGS84,
  };
  const camera = new namespace.Camera(scene);
  camera.setView({
    destination: namespace.Cartesian3.fromDegrees(-97.7, 30.3, 10_000_000),
    orientation: { heading: 0, pitch: -Math.PI / 2, roll: 0 },
  });
  Object.assign(scene, {
    camera,
    globe: undefined,
    mode: namespace.SceneMode.SCENE3D,
    verticalExaggeration: 1,
    verticalExaggerationRelativeHeight: 0,
    cameraUnderground: false,
  });
  const controller = new Controller(scene);
  controller.enableCollisionDetection = false;
  return { canvas, camera, controller };
}

function cameraPose(camera) {
  return {
    position: [camera.positionWC.x, camera.positionWC.y, camera.positionWC.z],
    direction: [
      camera.directionWC.x,
      camera.directionWC.y,
      camera.directionWC.z,
    ],
    up: [camera.upWC.x, camera.upWC.y, camera.upWC.z],
  };
}

function poseDistance(a, b) {
  return Math.hypot(
    ...a.position.map((value, index) => value - b.position[index]),
  );
}

function runLockedDrag(
  namespace,
  Controller,
  documentTarget,
  interleaveFrames,
) {
  setControlledTime();
  const { canvas, camera, controller } = createController(
    namespace,
    Controller,
    documentTarget,
  );
  canvas.dispatch('mousedown', eventAt(400, 300));
  controller.enableInputs = false;
  for (const point of [
    [408, 306],
    [416, 312],
    [424, 318],
    [432, 324],
    [440, 330],
  ]) {
    advanceFrame();
    canvas.dispatch('mousemove', eventAt(...point));
    if (interleaveFrames) controller.update();
  }
  advanceFrame();
  canvas.dispatch('mouseup', eventAt(440, 330));
  controller.update();
  const atUnlock = cameraPose(camera);
  controller.enableInputs = true;
  const afterUnlock = [];
  for (let index = 0; index < 8; index += 1) {
    advanceFrame();
    controller.update();
    afterUnlock.push(cameraPose(camera));
  }
  const frameMovementM = afterUnlock.map((pose, index) =>
    poseDistance(index === 0 ? atUnlock : afterUnlock[index - 1], pose),
  );
  controller.destroy();
  return {
    frameMovementM,
    totalMovementAfterUnlockM: frameMovementM.reduce(
      (sum, value) => sum + value,
      0,
    ),
  };
}

function runManualGesture(namespace, Controller, documentTarget, actionKind) {
  setControlledTime();
  const { canvas, camera, controller } = createController(
    namespace,
    Controller,
    documentTarget,
  );
  const initialPose = cameraPose(camera);
  const button = actionKind === 'tilt' ? 1 : actionKind === 'zoom' ? 2 : 0;
  const ctrlKey = actionKind === 'tilt' && false;
  const input = (x, y) => eventAt(x, y, button, ctrlKey);
  canvas.dispatch('mousedown', input(400, 300));
  const directPoses = [];
  for (const point of [
    [410, 307],
    [420, 315],
  ]) {
    advanceFrame();
    canvas.dispatch('mousemove', input(...point));
    controller.update();
    directPoses.push(cameraPose(camera));
  }
  advanceFrame();
  canvas.dispatch('mouseup', input(420, 315));
  const inertiaPoses = [];
  for (let index = 0; index < 8; index += 1) {
    advanceFrame();
    controller.update();
    inertiaPoses.push(cameraPose(camera));
  }
  controller.destroy();
  return { initialPose, directPoses, inertiaPoses };
}

function runFreshGestureAfterLock(namespace, Controller, documentTarget) {
  setControlledTime();
  const { canvas, camera, controller } = createController(
    namespace,
    Controller,
    documentTarget,
  );
  canvas.dispatch('mousedown', eventAt(400, 300));
  controller.enableInputs = false;
  advanceFrame();
  canvas.dispatch('mousemove', eventAt(430, 320));
  controller.update();
  advanceFrame();
  canvas.dispatch('mouseup', eventAt(430, 320));
  controller.update();
  controller.enableInputs = true;

  const beforeFreshGesture = cameraPose(camera);
  canvas.dispatch('mousedown', eventAt(400, 300));
  for (const point of [
    [410, 307],
    [420, 315],
  ]) {
    advanceFrame();
    canvas.dispatch('mousemove', eventAt(...point));
    controller.update();
  }
  advanceFrame();
  canvas.dispatch('mouseup', eventAt(420, 315));
  const afterRelease = cameraPose(camera);
  const inertiaPoses = [];
  for (let index = 0; index < 8; index += 1) {
    advanceFrame();
    controller.update();
    inertiaPoses.push(cameraPose(camera));
  }
  controller.destroy();
  return {
    directMovementM: poseDistance(beforeFreshGesture, afterRelease),
    inertiaMovementM: poseDistance(afterRelease, inertiaPoses.at(-1)),
    inertiaPoses,
  };
}

function runPriorInertiaThenLock(namespace, Controller, documentTarget) {
  setControlledTime();
  const { canvas, camera, controller } = createController(
    namespace,
    Controller,
    documentTarget,
  );
  canvas.dispatch('mousedown', eventAt(400, 300));
  for (const point of [
    [410, 307],
    [420, 315],
  ]) {
    advanceFrame();
    canvas.dispatch('mousemove', eventAt(...point));
    controller.update();
  }
  advanceFrame();
  canvas.dispatch('mouseup', eventAt(420, 315));
  const atRelease = cameraPose(camera);
  advanceFrame();
  controller.update();
  advanceFrame();
  controller.update();
  const beforeLock = cameraPose(camera);
  controller.enableInputs = false;
  advanceFrame();
  controller.update();
  const atUnlock = cameraPose(camera);
  controller.enableInputs = true;
  const afterUnlock = [];
  for (let index = 0; index < 5; index += 1) {
    advanceFrame();
    controller.update();
    afterUnlock.push(cameraPose(camera));
  }
  controller.destroy();
  return {
    activeInertiaMovementM: poseDistance(atRelease, beforeLock),
    postUnlockMovementM: poseDistance(atUnlock, afterUnlock.at(-1)),
  };
}

function runActionDisabledStaleInertia(namespace, Controller, documentTarget) {
  setControlledTime();
  const { canvas, camera, controller } = createController(
    namespace,
    Controller,
    documentTarget,
  );
  canvas.dispatch('mousedown', eventAt(400, 300));
  for (const point of [
    [410, 307],
    [420, 315],
  ]) {
    advanceFrame();
    canvas.dispatch('mousemove', eventAt(...point));
    controller.update();
  }
  advanceFrame();
  canvas.dispatch('mouseup', eventAt(420, 315));
  advanceFrame();
  controller.update();
  controller.enableRotate = false;
  advanceFrame();
  controller.update();
  const atReenable = cameraPose(camera);
  controller.enableRotate = true;
  for (let index = 0; index < 5; index += 1) {
    advanceFrame();
    controller.update();
  }
  const afterReenable = cameraPose(camera);
  controller.destroy();
  return poseDistance(atReenable, afterReenable);
}

function loadIife(filePath, documentTarget) {
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
    Date: ControlledDate,
    location: { href: 'http://localhost/' },
  };
  sandbox.global = sandbox;
  vm.runInNewContext(readFileSync(filePath, 'utf8'), sandbox, {
    filename: filePath,
    timeout: 15_000,
  });
  sandbox.document = documentTarget;
  return sandbox.Cesium;
}

function loadIifeText(text, filename, documentTarget) {
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
    Date: ControlledDate,
    location: { href: 'http://localhost/' },
  };
  sandbox.global = sandbox;
  vm.runInNewContext(text, sandbox, { filename, timeout: 15_000 });
  sandbox.document = documentTarget;
  return sandbox.Cesium;
}

async function withDistribution(entry, kind, run) {
  const realPath = distributionFile(entry.relativePath);
  const patchedBytes = readFileSync(realPath);
  const stockBytes = recoverStock(entry, patchedBytes);
  const temporaryPath = path.join(
    path.dirname(realPath),
    `inertia-stock-${process.pid}-${randomUUID()}${path.extname(realPath)}`,
  );
  const documentTarget = Object.assign(new EventTargetLite(), {
    onmousewheel: undefined,
  });
  writeFileSync(temporaryPath, stockBytes, { flag: 'wx' });
  try {
    delete globalThis.document;
    delete globalThis.window;
    let stockNamespace;
    let patchedNamespace;
    let stockController;
    let patchedController;
    if (kind === 'source') {
      stockNamespace = Engine;
      patchedNamespace = Engine;
      stockController = (
        await import(
          `${pathToFileURL(temporaryPath).href}?stock=${randomUUID()}`
        )
      ).default;
      patchedController = (
        await import(`${pathToFileURL(realPath).href}?patched=${randomUUID()}`)
      ).default;
    } else if (kind === 'cjs') {
      stockNamespace = require(temporaryPath);
      patchedNamespace = require(realPath);
      stockController = stockNamespace.ScreenSpaceCameraController;
      patchedController = patchedNamespace.ScreenSpaceCameraController;
    } else {
      stockNamespace = loadIife(temporaryPath, documentTarget);
      patchedNamespace = loadIifeText(
        patchedBytes.toString('utf8'),
        realPath,
        documentTarget,
      );
      stockController = stockNamespace.ScreenSpaceCameraController;
      patchedController = patchedNamespace.ScreenSpaceCameraController;
    }
    assert.equal(typeof stockController, 'function');
    assert.equal(typeof patchedController, 'function');
    await run({
      stockNamespace,
      patchedNamespace,
      stockController,
      patchedController,
      documentTarget,
    });
  } finally {
    rmSync(temporaryPath, { force: true });
  }
}

function runTransitionSequence(namespace, Controller, documentTarget) {
  setControlledTime();
  const { canvas, camera, controller } = createController(
    namespace,
    Controller,
    documentTarget,
  );
  const actionRecords = [];
  for (const actionKind of ['rotate', 'zoom', 'tilt']) {
    const button = actionKind === 'tilt' ? 1 : actionKind === 'zoom' ? 2 : 0;
    const ctrlKey = false;
    const input = (x, y) => eventAt(x, y, button, ctrlKey);
    canvas.dispatch('mousedown', input(400, 300));
    for (const point of [
      [410, 307],
      [420, 315],
    ]) {
      advanceFrame();
      canvas.dispatch('mousemove', input(...point));
      controller.update();
    }
    advanceFrame();
    canvas.dispatch('mouseup', input(420, 315));
    const beforeInertia = cameraPose(camera);
    const inertiaPoses = [];
    for (let index = 0; index < 4; index += 1) {
      advanceFrame();
      controller.update();
      inertiaPoses.push(cameraPose(camera));
    }
    actionRecords.push({ beforeInertia, inertiaPoses });
  }
  controller.destroy();
  return actionRecords;
}

test('disabled camera input cancels stale inertia across every Cesium 1.138 distribution', async () => {
  const entries = [
    {
      kind: 'source',
      relativePath:
        '@cesium/engine/Source/Scene/ScreenSpaceCameraController.js',
    },
    { kind: 'cjs', relativePath: 'cesium/Build/Cesium/index.cjs' },
    { kind: 'cjs', relativePath: 'cesium/Build/CesiumUnminified/index.cjs' },
    { kind: 'iife', relativePath: 'cesium/Build/Cesium/Cesium.js' },
    { kind: 'iife', relativePath: 'cesium/Build/CesiumUnminified/Cesium.js' },
  ];
  const previousDocument = globalThis.document;
  const previousDate = globalThis.Date;
  const previousLocation = globalThis.location;
  const previousWindow = globalThis.window;
  try {
    for (const selection of entries) {
      const entry = MANIFEST.files.find(
        (candidate) => candidate.relativePath === selection.relativePath,
      );
      assert.ok(entry, `missing manifest entry for ${selection.relativePath}`);
      await withDistribution(entry, selection.kind, async (distribution) => {
        const {
          stockNamespace,
          patchedNamespace,
          stockController,
          patchedController,
          documentTarget,
        } = distribution;

        const stockLocked = runLockedDrag(
          stockNamespace,
          stockController,
          documentTarget,
          true,
        );
        const patchedLocked = runLockedDrag(
          patchedNamespace,
          patchedController,
          documentTarget,
          true,
        );
        assert.ok(
          stockLocked.totalMovementAfterUnlockM > 1,
          `${selection.relativePath}: stock control did not reproduce stale inertia`,
        );
        assert.equal(
          patchedLocked.totalMovementAfterUnlockM,
          0,
          `${selection.relativePath}: disabled drag resumed after unlock`,
        );

        const stockNoFrames = runLockedDrag(
          stockNamespace,
          stockController,
          documentTarget,
          false,
        );
        const patchedNoFrames = runLockedDrag(
          patchedNamespace,
          patchedController,
          documentTarget,
          false,
        );
        assert.equal(stockNoFrames.totalMovementAfterUnlockM, 0);
        assert.equal(patchedNoFrames.totalMovementAfterUnlockM, 0);

        const stockPriorInertia = runPriorInertiaThenLock(
          stockNamespace,
          stockController,
          documentTarget,
        );
        const patchedPriorInertia = runPriorInertiaThenLock(
          patchedNamespace,
          patchedController,
          documentTarget,
        );
        assert.ok(stockPriorInertia.postUnlockMovementM > 1);
        assert.ok(stockPriorInertia.activeInertiaMovementM > 1);
        assert.equal(patchedPriorInertia.postUnlockMovementM, 0);

        assert.ok(
          runActionDisabledStaleInertia(
            stockNamespace,
            stockController,
            documentTarget,
          ) > 1,
          `${selection.relativePath}: stock per-action control did not move`,
        );
        assert.equal(
          runActionDisabledStaleInertia(
            patchedNamespace,
            patchedController,
            documentTarget,
          ),
          0,
          `${selection.relativePath}: disabled action resumed stale inertia`,
        );

        const freshGesture = runFreshGestureAfterLock(
          patchedNamespace,
          patchedController,
          documentTarget,
        );
        assert.ok(freshGesture.directMovementM > 1);
        assert.ok(freshGesture.inertiaMovementM > 1);

        for (const actionKind of ['rotate', 'zoom', 'tilt']) {
          const stockManual = runManualGesture(
            stockNamespace,
            stockController,
            documentTarget,
            actionKind,
          );
          const patchedManual = runManualGesture(
            patchedNamespace,
            patchedController,
            documentTarget,
            actionKind,
          );
          assert.notDeepEqual(
            stockManual.directPoses.at(-1),
            stockManual.initialPose,
            `${selection.relativePath}: pristine ${actionKind} gesture was a no-op`,
          );
          assert.notDeepEqual(
            stockManual.inertiaPoses.at(-1),
            stockManual.directPoses.at(-1),
            `${selection.relativePath}: pristine ${actionKind} inertia was a no-op`,
          );
          assert.deepEqual(
            patchedManual,
            stockManual,
            `${selection.relativePath}: ordinary ${actionKind} behavior changed`,
          );
        }

        assert.deepEqual(
          runTransitionSequence(
            patchedNamespace,
            patchedController,
            documentTarget,
          ),
          runTransitionSequence(
            stockNamespace,
            stockController,
            documentTarget,
          ),
          `${selection.relativePath}: cross-action inertia behavior changed`,
        );
      });
    }
  } finally {
    globalThis.Date = previousDate;
    if (previousLocation === undefined) delete globalThis.location;
    else globalThis.location = previousLocation;
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  }
});
