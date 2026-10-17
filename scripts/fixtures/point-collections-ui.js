import * as Cesium from 'cesium';
import 'cesium/Build/Cesium/Widgets/widgets.css';
import { createApplicationViewer } from '../../src/app/viewer.js';
import { captureFreshCesiumFrame } from '../../src/freshFrame.js';
import { readPerformanceEnvironment } from '../../src/performance/performanceSnapshot.js';

const CORE = 840;
const DENSE = 10000;
const WARMUP_FRAMES = 60;
const MEASURE_FRAMES = 180;
const run = document.querySelector('#run');
const status = document.querySelector('#status');
const output = document.querySelector('#result');
const download = document.querySelector('#download');
let report;
let pixelFrames = new WeakMap();
const check = (value, message) => {
  if (!value) throw new Error(message);
};

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

async function pixels(viewer) {
  const canvas = await captureFreshCesiumFrame(viewer);
  check(canvas, 'A completed capture frame was unavailable.');
  try {
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
    return {
      sha256,
      bytes,
      png: canvas.toDataURL('image/png'),
      width: canvas.width,
      height: canvas.height,
    };
  } finally {
    canvas.width = canvas.height = 0;
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

async function sample(viewer, mode) {
  const scene = viewer.scene;
  const collections = [];
  const originalUpdates = [];
  const cpuSamples = [];
  const intervals = [];
  let measured = false;
  let frameCpu = 0;
  const addCollection = () => {
    const collection = scene.primitives.add(
      new Cesium.PointPrimitiveCollection(),
    );
    collections.push(collection);
    const update = collection.update;
    originalUpdates.push(update);
    collection.update = function (frameState) {
      if (!measured) return update.call(this, frameState);
      const started = performance.now();
      try {
        return update.call(this, frameState);
      } finally {
        frameCpu += performance.now() - started;
      }
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
    let frame = 0;
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
    const capture = await pixels(viewer);
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
    schema: 'gev-point-collection-diagnostic/v1',
    applicationCommit: __GEV_APP_COMMIT__,
    harnessCommit: __GEV_APP_COMMIT__,
    timestamp: new Date().toISOString(),
    fixture: 'synthetic-840-core-10000-dense/v1',
    scope:
      'Instrumented fixed-frame submission diagnostic; not application motion, GPU time or an accepted optimization',
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
        const record = await sample(viewer, mode);
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
