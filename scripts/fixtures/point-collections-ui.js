import * as Cesium from 'cesium';
import 'cesium/Build/Cesium/Widgets/widgets.css';
import { createApplicationViewer } from '../../src/app/viewer.js';
import { captureFreshCesiumFrame } from '../../src/freshFrame.js';
import { readPerformanceEnvironment } from '../../src/performance/performanceSnapshot.js';

const CORE = 840;
const DENSE = 10000;
const WARMUP_FRAMES = 60;
const MEASURE_FRAMES = 180;
// Pixel coordinates changed by the preserved first mixed/partitioned pair at
// 9dacb7c. This is diagnostic targeting only; it does not affect rendering.
const PRIOR_MISMATCH_PIXELS = Object.freeze([
  [495, 18],
  [421, 285],
  [160, 338],
  [479, 338],
  [160, 339],
  [479, 339],
  [152, 346],
  [153, 346],
  [486, 346],
  [487, 346],
  [152, 347],
  [487, 347],
  [145, 353],
  [146, 353],
  [493, 353],
  [494, 353],
  [145, 354],
  [494, 354],
  [319, 357],
  [320, 357],
  [319, 358],
  [320, 358],
  [319, 359],
  [320, 359],
]);
const MAX_PROJECTED_POINTS_PER_PIXEL = 16;
const MAX_RECORDED_FRUSTUMS = 16;
const MAX_RECORDED_POINT_COMMANDS = 16;
const run = document.querySelector('#run');
const status = document.querySelector('#status');
const output = document.querySelector('#result');
const download = document.querySelector('#download');
let report;
let pixelFrames = new WeakMap();
const check = (value, message) => {
  if (!value) throw new Error(message);
};

function finiteOrNull(value) {
  return Number.isFinite(value) ? value : null;
}

function passName(pass) {
  for (const [name, value] of Object.entries(Cesium.Pass || {})) {
    if (value === pass && Number.isInteger(value)) return name;
  }
  return null;
}

function snapshotPointCommand(command, collectionIndex, scene) {
  const volume = command.boundingVolume;
  const center = volume?.center;
  let interval = null;
  if (
    volume &&
    typeof volume.computePlaneDistances === 'function' &&
    scene.camera?.positionWC &&
    scene.camera?.directionWC
  ) {
    const result = { start: null, stop: null };
    const measured = volume.computePlaneDistances(
      scene.camera.positionWC,
      scene.camera.directionWC,
      result,
    );
    interval = {
      near: finiteOrNull(measured?.start),
      far: finiteOrNull(measured?.stop),
    };
  }
  return {
    collection: collectionIndex === 0 ? 'core' : 'dense',
    pass: finiteOrNull(command.pass),
    passName: passName(command.pass),
    bounds: center
      ? {
          center: {
            x: finiteOrNull(center.x),
            y: finiteOrNull(center.y),
            z: finiteOrNull(center.z),
          },
          radius: finiteOrNull(volume.radius),
        }
      : null,
    cameraDepthInterval: interval,
  };
}

function snapshotRenderDiagnostics(
  scene,
  collections,
  emittedCommandCapture,
  points,
) {
  const emittedCommands = Array.isArray(emittedCommandCapture?.commands)
    ? emittedCommandCapture.commands
    : [];
  const emittedFrameNumber = Number.isInteger(
    emittedCommandCapture?.frameNumber,
  )
    ? emittedCommandCapture.frameNumber
    : null;
  const truncatedEmittedCommandCount = Number.isInteger(
    emittedCommandCapture?.truncatedCount,
  )
    ? emittedCommandCapture.truncatedCount
    : null;
  const captureFrameNumber = scene.frameState?.frameNumber;
  if (!Number.isInteger(captureFrameNumber)) {
    throw new Error('Cesium capture frameState.frameNumber was unavailable.');
  }
  if (captureFrameNumber !== emittedFrameNumber) {
    throw new Error(
      `Command/capture frame mismatch: ${emittedFrameNumber ?? 'unavailable'} versus ${captureFrameNumber}.`,
    );
  }
  const view = scene.view;
  const oit = view?.oit;
  let oitSupported = null;
  try {
    if (typeof oit?.isSupported === 'function')
      oitSupported = oit.isSupported();
  } catch {
    oitSupported = null;
  }
  const environmentState = scene.environmentState;
  const frustumList = scene.frustumCommandsList;
  const passCount = Number.isInteger(Cesium.Pass?.NUMBER_OF_PASSES)
    ? Cesium.Pass.NUMBER_OF_PASSES
    : null;
  const frustums = Array.isArray(frustumList)
    ? frustumList.slice(0, MAX_RECORDED_FRUSTUMS).map((frustum, index) => {
        const byPass = [];
        const count = passCount ?? frustum.indices?.length ?? 0;
        for (let pass = 0; pass < count; pass++) {
          const commandCount = Number.isInteger(frustum.indices?.[pass])
            ? frustum.indices[pass]
            : null;
          if (commandCount === null) continue;
          const commands = frustum.commands?.[pass];
          if (!Array.isArray(commands)) continue;
          const owners = [];
          const limit = Math.min(commandCount, commands.length);
          for (let i = 0; i < limit; i++) {
            const ownerIndex = collections.indexOf(commands[i]?.owner);
            if (ownerIndex >= 0)
              owners.push(ownerIndex === 0 ? 'core' : 'dense');
          }
          if (owners.length || commandCount > 0) {
            byPass.push({
              pass: finiteOrNull(pass),
              passName: passName(pass),
              commandCount,
              collectionOwners: owners.slice(0, MAX_RECORDED_POINT_COMMANDS),
              truncatedOwners: Math.max(
                0,
                owners.length - MAX_RECORDED_POINT_COMMANDS,
              ),
            });
          }
        }
        return {
          index,
          near: finiteOrNull(frustum.near),
          far: finiteOrNull(frustum.far),
          byPass,
        };
      })
    : null;

  const projectedTargets = PRIOR_MISMATCH_PIXELS.map(([x, y]) => ({
    pixelIndex: { x, y },
    pixelCenter: { x: x + 0.5, y: y + 0.5 },
    points: [],
    candidateCount: null,
    truncatedPoints: null,
  }));
  const projection = Cesium.SceneTransforms?.worldToDrawingBufferCoordinates;
  const projected = new Cesium.Cartesian2();
  let projectedPointCount = 0;
  const scenePixelRatio = finiteOrNull(scene.pixelRatio);
  const czmPixelRatio = finiteOrNull(scene.context?.uniformState?.pixelRatio);
  const drawingBufferScale = {
    x:
      Number.isFinite(scene.canvas?.clientWidth) && scene.canvas.clientWidth > 0
        ? finiteOrNull(scene.drawingBufferWidth / scene.canvas.clientWidth)
        : null,
    y:
      Number.isFinite(scene.canvas?.clientHeight) &&
      scene.canvas.clientHeight > 0
        ? finiteOrNull(scene.drawingBufferHeight / scene.canvas.clientHeight)
        : null,
  };
  if (typeof projection === 'function' && Number.isFinite(czmPixelRatio)) {
    for (const target of projectedTargets) {
      target.candidateCount = 0;
      target.truncatedPoints = 0;
    }
    for (const point of points) {
      const center = projection(scene, point.position, projected);
      if (!center || !Number.isFinite(center.x) || !Number.isFinite(center.y))
        continue;
      projectedPointCount++;
      const pointSizePx = Number(point.pixelSize) * czmPixelRatio;
      if (!Number.isFinite(pointSizePx)) continue;
      const radiusPx = Math.max(0, pointSizePx * 0.5 + 1);
      for (const target of projectedTargets) {
        const dx = center.x - target.pixelCenter.x;
        const dy = center.y - target.pixelCenter.y;
        if (Math.abs(dx) > radiusPx || Math.abs(dy) > radiusPx) continue;
        target.candidateCount++;
        if (target.points.length < MAX_PROJECTED_POINTS_PER_PIXEL) {
          target.points.push({
            id: typeof point.id === 'string' ? point.id : null,
            center: { x: finiteOrNull(center.x), y: finiteOrNull(center.y) },
            pixelSize: finiteOrNull(point.pixelSize),
            shaderPixelSizePx: finiteOrNull(pointSizePx),
            coverageRadiusPx: finiteOrNull(radiusPx),
            show: typeof point.show === 'boolean' ? point.show : null,
            distancePx: Math.hypot(dx, dy),
          });
        } else {
          target.truncatedPoints++;
        }
      }
    }
  }

  return {
    cesiumVersion: typeof Cesium.VERSION === 'string' ? Cesium.VERSION : null,
    oit: {
      requested:
        typeof scene.orderIndependentTranslucency === 'boolean'
          ? scene.orderIndependentTranslucency
          : null,
      depthTextureAvailable:
        typeof scene.context?.depthTexture === 'boolean'
          ? scene.context.depthTexture
          : null,
      viewOitPresent: oit ? true : null,
      supported: typeof oitSupported === 'boolean' ? oitSupported : null,
      active:
        typeof environmentState?.useOIT === 'boolean'
          ? environmentState.useOIT
          : null,
    },
    captureFrameNumber,
    emittedCommandFrameNumber: emittedFrameNumber,
    commandsMatchCaptureFrame: true,
    pointPixelScaling: {
      scenePixelRatio,
      czmPixelRatio,
      drawingBufferScale,
      pointVertexShaderUsesCzmPixelRatio: true,
      neighborhoodSemantics:
        'Projected-center proximity using shader pixel size plus one drawing-buffer pixel; not exact fragment coverage.',
    },
    camera: {
      positionWC: scene.camera?.positionWC
        ? {
            x: finiteOrNull(scene.camera.positionWC.x),
            y: finiteOrNull(scene.camera.positionWC.y),
            z: finiteOrNull(scene.camera.positionWC.z),
          }
        : null,
      directionWC: scene.camera?.directionWC
        ? {
            x: finiteOrNull(scene.camera.directionWC.x),
            y: finiteOrNull(scene.camera.directionWC.y),
            z: finiteOrNull(scene.camera.directionWC.z),
          }
        : null,
    },
    emittedPointCommands: emittedCommands,
    truncatedEmittedPointCommands: truncatedEmittedCommandCount,
    frustumCount: Array.isArray(frustumList) ? frustumList.length : null,
    truncatedFrustums: Array.isArray(frustumList)
      ? Math.max(0, frustumList.length - MAX_RECORDED_FRUSTUMS)
      : null,
    frustums,
    projectedPointCount:
      typeof projection === 'function' ? projectedPointCount : null,
    projectedMismatchNeighborhoods: projectedTargets,
  };
}

function summary(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return {
    samples: sorted.length,
    median: sorted[Math.floor(sorted.length / 2)] ?? null,
    p95: sorted[Math.max(0, Math.ceil(sorted.length * 0.95) - 1)] ?? null,
    max: sorted.at(-1) ?? null,
  };
}

// Count public WebGL submission calls only. These byte counts are not GPU time,
// physical bus traffic, or driver allocations. Restore the two methods on exit.
function observeSubmissions(gl) {
  const originals = new Map();
  let active = false;
  const counts = {
    bufferDataCalls: 0,
    bufferSubDataCalls: 0,
    submittedBytes: 0,
  };
  for (const method of ['bufferData', 'bufferSubData']) {
    const original = gl[method];
    originals.set(method, {
      own: Object.getOwnPropertyDescriptor(gl, method),
      original,
    });
    gl[method] = function (...args) {
      if (active) {
        counts[`${method}Calls`]++;
        const data = args[method === 'bufferData' ? 1 : 2];
        const offset = args[3] || 0;
        const length = args[4];
        const elementBytes = data?.BYTES_PER_ELEMENT || 1;
        counts.submittedBytes +=
          typeof data === 'number'
            ? data
            : length > 0
              ? length * elementBytes
              : Math.max(0, (data?.byteLength || 0) - offset * elementBytes);
      }
      return original.apply(this, args);
    };
  }
  return {
    start: () => (active = true),
    stop: () => (active = false),
    counts,
    dispose() {
      active = false;
      for (const [method, { own }] of originals) {
        if (own) Object.defineProperty(gl, method, own);
        else delete gl[method];
      }
    },
  };
}

async function pixels(viewer, readFrameDiagnostics) {
  const controller = new AbortController();
  let removeDiagnostics;
  let failDiagnostics;
  let diagnosticsTimer;
  let canvas;
  let diagnosticsSettled = false;
  const capturePromise = captureFreshCesiumFrame(viewer, {
    signal: controller.signal,
  });
  const diagnosticsPromise = new Promise((resolve, reject) => {
    const scene = viewer.scene;
    const finish = (callback, value) => {
      if (diagnosticsSettled) return;
      diagnosticsSettled = true;
      clearTimeout(diagnosticsTimer);
      try {
        removeDiagnostics?.();
      } catch {
        // Resolve the diagnostics promise even if listener removal throws.
      }
      callback(value);
    };
    const onPostRender = () => {
      try {
        finish(resolve, readFrameDiagnostics());
      } catch (error) {
        finish(reject, error);
      }
    };
    failDiagnostics = (error) => finish(reject, error);
    try {
      const unsubscribe = scene.postRender.addEventListener(onPostRender);
      removeDiagnostics =
        typeof unsubscribe === 'function'
          ? unsubscribe
          : () => scene.postRender.removeEventListener?.(onPostRender);
      diagnosticsTimer = setTimeout(
        () =>
          finish(
            reject,
            new Error('Matching postRender diagnostics timed out.'),
          ),
        410,
      );
    } catch (error) {
      finish(reject, error);
    }
  });
  let diagnostics;
  try {
    [canvas, diagnostics] = await Promise.all([
      capturePromise,
      diagnosticsPromise,
    ]);
    check(canvas, 'A completed capture frame was unavailable.');
    const bytes = canvas
      .getContext('2d')
      .getImageData(0, 0, canvas.width, canvas.height).data;
    let coloredPixels = 0;
    for (let i = 0; i < bytes.length; i += 4)
      if (bytes[i] > 32 || bytes[i + 1] > 32 || bytes[i + 2] > 32)
        coloredPixels++;
    check(
      coloredPixels > 1000,
      'Capture does not contain the populated point field.',
    );
    const sha256 = [
      ...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)),
    ]
      .map((value) => value.toString(16).padStart(2, '0'))
      .join('');
    const capture = {
      sha256,
      bytes,
      png: canvas.toDataURL('image/png'),
      width: canvas.width,
      height: canvas.height,
    };
    return { capture, diagnostics };
  } finally {
    clearTimeout(diagnosticsTimer);
    failDiagnostics?.(
      new Error('Capture completed before matching diagnostics.'),
    );
    try {
      controller.abort();
    } catch {
      // Abort is best-effort; the bounded capture helper also owns a timeout.
    }
    try {
      const settledCanvas = await capturePromise;
      if (!canvas) canvas = settledCanvas;
    } catch {
      // Cleanup must not replace the original capture or diagnostics failure.
    }
    try {
      if (canvas) canvas.width = canvas.height = 0;
    } catch {
      // Retain the primary error if a browser canvas rejects disposal.
    }
  }
}

function requireSamePixels(first, second, label) {
  if (first.pixels === second.pixels) return;
  const before = pixelFrames.get(first);
  const after = pixelFrames.get(second);
  let changedPixels = 0;
  let maximumChannelDifference = 0;
  let left = before.width,
    top = before.height,
    right = -1,
    bottom = -1;
  check(
    before.width === after.width && before.height === after.height,
    'Capture dimensions changed.',
  );
  for (let i = 0; i < before.bytes.length; i += 4) {
    let changed = false;
    for (let channel = 0; channel < 4; channel++) {
      const delta = Math.abs(
        before.bytes[i + channel] - after.bytes[i + channel],
      );
      maximumChannelDifference = Math.max(maximumChannelDifference, delta);
      changed ||= delta !== 0;
    }
    if (changed) {
      changedPixels++;
      const index = i / 4;
      const x = index % before.width;
      const y = Math.floor(index / before.width);
      left = Math.min(left, x);
      top = Math.min(top, y);
      right = Math.max(right, x);
      bottom = Math.max(bottom, y);
    }
  }
  report.visualMismatch = {
    label,
    changedPixels,
    totalPixels: before.width * before.height,
    maximumChannelDifference,
    bounds: { left, top, right, bottom },
    samePositions: first.positionSha256 === second.positionSha256,
    beforePng: before.png,
    afterPng: after.png,
  };
  throw new Error(`${label}: rendered pixels differ.`);
}

async function sample(viewer, mode, boundsControl = null) {
  const scene = viewer.scene;
  const collections = [];
  const originalUpdates = [];
  const cpuSamples = [];
  const intervals = [];
  let frame = 0;
  let measured = false;
  let frameCpu = 0;
  let captureCommandSnapshot = false;
  let snapshotFrameNumber = null;
  let emittedPointCommands = [];
  let truncatedEmittedPointCommands = 0;
  // Diagnostic intervention only, active after latency/submission measurement.
  // Never promote command-bound replacement into the application renderer.
  let captureBoundsOverride = null;
  const addCollection = () => {
    const collection = scene.primitives.add(
      new Cesium.PointPrimitiveCollection(),
    );
    collections.push(collection);
    const collectionIndex = collections.length - 1;
    const update = collection.update;
    originalUpdates.push(update);
    collection.update = function (frameState) {
      if (!captureCommandSnapshot) {
        if (!measured) return update.call(this, frameState);
        const started = performance.now();
        try {
          return update.call(this, frameState);
        } finally {
          frameCpu += performance.now() - started;
        }
      }
      const commandList = frameState?.commandList;
      const firstCommand = Array.isArray(commandList)
        ? commandList.length
        : null;
      const commandFrameNumber = frameState?.frameNumber;
      if (!Number.isInteger(commandFrameNumber)) {
        throw new Error(
          'Cesium emitted command frameState.frameNumber was unavailable.',
        );
      }
      const result = update.call(this, frameState);
      if (firstCommand !== null && Array.isArray(commandList)) {
        if (snapshotFrameNumber !== commandFrameNumber) {
          snapshotFrameNumber = commandFrameNumber;
          emittedPointCommands = [];
          truncatedEmittedPointCommands = 0;
        }
        for (const command of commandList.slice(firstCommand)) {
          if (command?.owner === collection) {
            if (captureBoundsOverride) {
              command.boundingVolume = captureBoundsOverride;
            }
            if (emittedPointCommands.length < MAX_RECORDED_POINT_COMMANDS) {
              emittedPointCommands.push(
                snapshotPointCommand(command, collectionIndex, scene),
              );
            } else {
              truncatedEmittedPointCommands++;
            }
          }
        }
      }
      return result;
    };
    return collection;
  };
  const core = addCollection();
  const dense = mode === 'partitioned' ? addCollection() : core;
  const points = [];
  const bases = [];
  const scratch = new Cesium.Cartesian3();
  const submissions = observeSubmissions(scene.context._gl);
  let removeBefore, removeAfter, removeError, timer;
  try {
    for (let i = 0; i < CORE + DENSE; i++) {
      const base = Cesium.Cartesian3.fromDegrees(
        ((i % 110) - 55) * 0.005,
        (Math.floor(i / 110) - 49) * 0.005,
        1000,
      );
      bases.push(base);
      points.push(
        (i < CORE ? core : dense).add({
          id: `synthetic-${i}`,
          position: base,
          show: i !== 0,
          pixelSize: i < CORE ? 6 : 3,
          color:
            i < CORE ? Cesium.Color.CYAN : Cesium.Color.WHITE.withAlpha(0.9),
          outlineWidth: 0,
        }),
      );
    }
    let denseCursor = CORE;
    let previousFrameAt = null;
    let beganAt;
    const writePosition = (index) => {
      Cesium.Cartesian3.clone(bases[index], scratch);
      scratch.z += frame * 0.25;
      points[index].position = scratch;
    };
    await new Promise((resolve, reject) => {
      timer = setTimeout(
        () => reject(new Error('Collection diagnostic frame timeout')),
        30000,
      );
      removeError = scene.renderError.addEventListener((_scene, error) =>
        reject(error),
      );
      removeBefore = scene.preRender.addEventListener(() => {
        frame++;
        measured = frame > WARMUP_FRAMES;
        frameCpu = 0;
        if (frame === WARMUP_FRAMES + 1) {
          beganAt = performance.now();
          previousFrameAt = null;
          submissions.start();
        }
        // Same fixed source steps in both variants: one hidden tracked dot per
        // frame, core fleet every twelve frames and 34 dense points per frame.
        // The real satellite layer is unchanged; this excludes SGP4 and labels.
        if (frame % 12 === 0) for (let i = 1; i < CORE; i++) writePosition(i);
        for (let i = 0; i < Math.ceil(DENSE / 300); i++) {
          writePosition(denseCursor++);
          if (denseCursor >= CORE + DENSE) denseCursor = CORE;
        }
        writePosition(0);
      });
      removeAfter = scene.postRender.addEventListener(() => {
        if (!measured) return;
        const now = performance.now();
        cpuSamples.push(frameCpu);
        if (previousFrameAt !== null) intervals.push(now - previousFrameAt);
        previousFrameAt = now;
        if (cpuSamples.length === MEASURE_FRAMES) resolve();
      });
    });
    const measuredMs = performance.now() - beganAt;
    removeBefore();
    removeAfter();
    removeError();
    clearTimeout(timer);
    submissions.stop();
    measured = false;
    const coordinates = new Float64Array(points.length * 3);
    for (let i = 0; i < points.length; i++) {
      const position = points[i].position;
      coordinates.set([position.x, position.y, position.z], i * 3);
    }
    const positionSha256 = [
      ...new Uint8Array(await crypto.subtle.digest('SHA-256', coordinates)),
    ]
      .map((value) => value.toString(16).padStart(2, '0'))
      .join('');
    captureCommandSnapshot = true;
    let captureResult;
    let boundsAttribution = null;
    const captureCurrent = () =>
      pixels(viewer, () =>
        snapshotRenderDiagnostics(
          scene,
          collections,
          {
            frameNumber: snapshotFrameNumber,
            commands: emittedPointCommands,
            truncatedCount: truncatedEmittedPointCommands,
          },
          points,
        ),
      );
    try {
      captureResult = await captureCurrent();
      if (boundsControl) {
        check(
          mode === 'partitioned',
          'Bounds attribution requires a partitioned sample.',
        );
        check(
          positionSha256 === boundsControl.positionSha256,
          'Bounds control positions differ.',
        );
        const bounds =
          boundsControl.renderDiagnostics?.emittedPointCommands?.[0]?.bounds;
        check(
          bounds &&
            [
              bounds.center.x,
              bounds.center.y,
              bounds.center.z,
              bounds.radius,
            ].every(Number.isFinite),
          'Mixed control bounds are unavailable.',
        );
        captureBoundsOverride = new Cesium.BoundingSphere(
          new Cesium.Cartesian3(
            bounds.center.x,
            bounds.center.y,
            bounds.center.z,
          ),
          bounds.radius,
        );
        const intervened = await captureCurrent();
        captureBoundsOverride = null;
        const restored = await captureCurrent();
        check(
          restored.capture.sha256 === captureResult.capture.sha256,
          'Restoring natural command bounds did not restore the original image.',
        );
        boundsAttribution = {
          scope:
            'Capture-only command-bound intervention; not a production optimization or performance acceptance.',
          sourceMixedPixels: boundsControl.pixels,
          sourceMixedBounds: bounds,
          naturalPixels: captureResult.capture.sha256,
          intervenedPixels: intervened.capture.sha256,
          restoredPixels: restored.capture.sha256,
          interventionMatchesMixed:
            intervened.capture.sha256 === boundsControl.pixels,
          restorationMatchesNatural: true,
          intervenedDiagnostics: intervened.diagnostics,
          restoredDiagnostics: restored.diagnostics,
          intervenedPng: intervened.capture.png,
          restoredPng: restored.capture.png,
        };
      }
    } finally {
      captureBoundsOverride = null;
      captureCommandSnapshot = false;
    }
    const { capture, diagnostics: renderDiagnostics } = captureResult;
    const snapshot = {
      mode,
      collections: collections.length,
      points: collections.reduce(
        (count, collection) => count + collection.length,
        0,
      ),
      measuredMs,
      renderedFrames: cpuSamples.length,
      collectionUpdateCpuMs: summary(cpuSamples),
      renderedFrameIntervalMs: summary(intervals),
      submissions: { ...submissions.counts },
      pixels: capture.sha256,
      positionSha256,
      renderDiagnostics,
      boundsAttribution,
    };
    pixelFrames.set(snapshot, capture);
    check(snapshot.points === CORE + DENSE, 'Point population changed.');
    return snapshot;
  } finally {
    clearTimeout(timer);
    removeBefore?.();
    removeAfter?.();
    removeError?.();
    submissions.dispose();
    for (let i = 0; i < collections.length; i++) {
      collections[i].update = originalUpdates[i];
      scene.primitives.remove(collections[i]);
    }
  }
}

run.addEventListener('click', async () => {
  run.disabled = download.disabled = true;
  output.textContent = '';
  pixelFrames = new WeakMap();
  report = {
    schema: 'gev-point-collection-diagnostic/v3-bounds-intervention',
    applicationCommit: __GEV_APP_COMMIT__,
    harnessCommit: __GEV_APP_COMMIT__,
    timestamp: new Date().toISOString(),
    fixture: 'synthetic-840-core-10000-dense/v1',
    scope:
      'Fixed-frame comparison plus capture-only command-bound intervention; original image gate is unchanged; no production optimization or GPU-time claim',
    warmupFrames: WARMUP_FRAMES,
    measurementFrames: MEASURE_FRAMES,
    pairs: 5,
    status: 'running',
    controls: [],
    samples: [],
  };
  let viewer;
  let backgrounded = document.visibilityState !== 'visible';
  const visibility = () => {
    if (document.visibilityState !== 'visible') backgrounded = true;
  };
  document.addEventListener('visibilitychange', visibility);
  try {
    check(
      /^[a-f0-9]{40}$/.test(report.applicationCommit || ''),
      'An exact served source revision is required.',
    );
    viewer = createApplicationViewer({
      container: document.querySelector('#viewer'),
      creditContainer: document.querySelector('#credits'),
    });
    viewer.scene.globe.show =
      viewer.scene.skyBox.show =
      viewer.scene.skyAtmosphere.show =
      viewer.scene.sun.show =
      viewer.scene.moon.show =
        false;
    viewer.scene.requestRenderMode = false;
    viewer.camera.setView({
      destination: Cesium.Cartesian3.fromDegrees(0, 0, 85000),
    });
    report.environment = readPerformanceEnvironment({
      viewer,
      appCommit: report.applicationCommit,
      harnessCommit: report.harnessCommit,
    });
    report.settings = {
      resolutionScale: viewer.resolutionScale,
      msaaSamples: viewer.scene.msaaSamples,
      context: viewer.scene.context._gl.getContextAttributes(),
      width: viewer.canvas.width,
      height: viewer.canvas.height,
    };
    status.textContent = 'Checking two identical mixed-collection controls';
    report.controls.push(await sample(viewer, 'mixed'));
    report.controls.push(await sample(viewer, 'mixed'));
    requireSamePixels(...report.controls, 'Repeated mixed control');
    for (let pair = 0; pair < 5; pair++) {
      const modes =
        pair % 2 ? ['partitioned', 'mixed'] : ['mixed', 'partitioned'];
      for (const mode of modes) {
        status.textContent = `Pair ${pair + 1}/5: ${mode}`;
        const record = await sample(
          viewer,
          mode,
          mode === 'partitioned' ? report.controls[0] : null,
        );
        record.pair = pair;
        report.samples.push(record);
      }
      const [first, second] = report.samples.slice(-2);
      requireSamePixels(first, second, 'Mixed versus partitioned');
      check(!backgrounded, 'Diagnostic was backgrounded.');
      check(
        viewer.canvas.width === report.settings.width &&
          viewer.canvas.height === report.settings.height,
        'Drawing-buffer size changed.',
      );
    }
    report.status = 'passed';
  } catch (error) {
    report.status = 'failed';
    report.error = error.message;
  } finally {
    document.removeEventListener('visibilitychange', visibility);
    if (viewer && !viewer.isDestroyed()) viewer.destroy();
    pixelFrames = new WeakMap();
    report.backgrounded = backgrounded;
    output.textContent = JSON.stringify(report, null, 2);
    status.textContent = `${report.status}: ${report.samples.length}/10 samples`;
    run.disabled = download.disabled = false;
  }
});

download.addEventListener('click', () => {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }),
  );
  const link = document.createElement('a');
  link.href = url;
  link.download = `point-collections-${report.applicationCommit.slice(0, 7)}.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
});
