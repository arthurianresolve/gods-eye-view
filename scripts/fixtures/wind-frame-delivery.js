import * as Cesium from 'cesium';
import 'cesium/Build/Cesium/Widgets/widgets.css';
import { createApplicationViewer } from '../../src/app/viewer.js';
import { createWindRendering } from '../../src/layers/wind/rendering.js';
import {
  captureFreshCesiumFrame,
  renderFreshCesiumFrame,
} from '../../src/freshFrame.js';
import { readPerformanceEnvironment } from '../../src/performance/performanceSnapshot.js';
import {
  createImportFrameDiagnostics,
  observeImportFrameHealth,
} from '../performance/importFrameDiagnostics.mjs';
import { runWindFrameProbe } from '../performance/windFrameProbe.mjs';

const runButton = document.querySelector('#run');
const downloadButton = document.querySelector('#download');
const sceneModeSelect = document.querySelector('#scene-mode');
const captureModeSelect = document.querySelector('#capture-mode');
const status = document.querySelector('#status');
const result = document.querySelector('#result');
const appCommit =
  typeof __GEV_APP_COMMIT__ === 'string' ? __GEV_APP_COMMIT__ : null;

const windSnapshot = {
  model: 'fixture',
  units: 'm/s',
  level: 'surface',
  cycle: { runIso: '2026-01-01T00:00:00Z' },
  grid: { nx: 360, ny: 181, lo1: 0, la1: 90, dx: 1, dy: 1 },
  u: Float32Array.from(
    { length: 65160 },
    (_, index) => 10 + Math.sin(index * 0.01) * 3,
  ),
  v: Float32Array.from(
    { length: 65160 },
    (_, index) => Math.cos(index * 0.01) * 4,
  ),
};

function createRafObservation() {
  const startedAt = performance.now();
  const samples = [];
  let previous = null;
  let frameId = null;
  let active = true;
  let frameCount = 0;
  let maximumGapMs = null;

  const tick = (timestamp) => {
    if (!active) return;
    const current = Number.isFinite(timestamp) ? timestamp : performance.now();
    if (previous !== null) {
      const gap = Math.max(0, current - previous);
      maximumGapMs = Math.max(maximumGapMs ?? 0, gap);
    }
    previous = current;
    frameCount++;
    if (samples.length < 24) samples.push(Math.max(0, current - startedAt));
    frameId = requestAnimationFrame(tick);
  };
  frameId = requestAnimationFrame(tick);

  return {
    snapshot() {
      return {
        status: active ? 'observing' : 'stopped',
        frames: frameCount,
        firstFrameDelayMs: samples[0] ?? null,
        maximumGapMs: samples.length < 2 ? null : maximumGapMs,
        sampleElapsedMs: [...samples],
      };
    },
    stop() {
      if (!active) return;
      active = false;
      if (frameId !== null) cancelAnimationFrame(frameId);
    },
  };
}

function createWindField() {
  return {
    ...windSnapshot,
    scalar: null,
  };
}

function readPixels(canvas) {
  if (!canvas?.width || !canvas?.height)
    throw new Error('Copied frame has no drawable pixels.');
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Copied frame has no 2D readback context.');
  return context.getImageData(0, 0, canvas.width, canvas.height).data;
}

async function hashPixels(pixels) {
  const digest = await crypto.subtle.digest('SHA-256', pixels);
  return [...new Uint8Array(digest)]
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('');
}

function downloadReport(report) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }),
  );
  const anchor = document.createElement('a');
  anchor.href = url;
  const runId = String(report.capturedAt || 'unknown').replace(/[:.]/g, '-');
  anchor.download = `wind-frame-delivery-${report.control.sceneMode}-${report.control.captureMode}-${appCommit?.slice(0, 7) || 'local'}-${runId}.json`;
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

let lastReport = null;
downloadButton.addEventListener('click', () => {
  if (lastReport) downloadReport(lastReport);
});

runButton.addEventListener('click', async () => {
  runButton.disabled = true;
  downloadButton.disabled = true;
  sceneModeSelect.disabled = true;
  captureModeSelect.disabled = true;
  result.textContent = '';

  const control = Object.freeze({
    sceneMode: sceneModeSelect.value,
    captureMode: captureModeSelect.value,
  });
  const report = {
    schema: 'gev-wind-frame-delivery/v1',
    applicationCommit: appCommit,
    harnessCommit: appCommit,
    capturedAt: new Date().toISOString(),
    fixture: 'synthetic-360x181-wind-and-scalars/v1',
    control,
    comparisonScope:
      control.sceneMode === 'globe-only'
        ? 'Globe-only control omits the generated wind imagery; compare only frame and capture-path delivery.'
        : 'Paused synthetic wind geometry and generated imagery are present; no animation or performance acceptance is claimed.',
    pixelEquivalence:
      control.captureMode === 'copy'
        ? 'Per-attempt pixel hashes are diagnostic only; no cross-control image-equivalence claim is made.'
        : 'Pixels are not copied or compared; no image-equivalence claim is made.',
    build: {
      recipe: 'Vite development fixture',
      productionBundle: false,
    },
    desktopForegroundVerification: 'unavailable',
    limits: { attempts: 3, interAttemptTimerMs: 20, frameDeadlineMs: 400 },
    timingSemantics: {
      frameWaitMs:
        'No-copy mode waits for postRender without allocating a copy canvas.',
      frameWaitAndCopyMs:
        'Copy mode combines the bounded postRender wait and synchronous drawImage copy; drawImage is not separately instrumented.',
      getImageDataMs:
        'Synchronous 2D pixel extraction after a successful copy.',
      hashMs: 'SHA-256 after pixel extraction; outside the frame wait.',
    },
    status: 'running',
    attempts: [],
  };
  lastReport = null;

  let viewer = null;
  let rendering = null;
  let rafObservation = null;
  const frameDiagnostics = createImportFrameDiagnostics();
  const sceneEvents = { preUpdate: 0, preRender: 0, postRender: 0 };
  const renderErrors = [];
  const contextEvents = [];
  const removes = [];
  let backgrounded = document.hidden;
  const visibility = () => {
    if (document.hidden) backgrounded = true;
  };
  document.addEventListener('visibilitychange', visibility);

  try {
    if (!/^[a-f0-9]{40}$/.test(appCommit || ''))
      throw new Error('Exact application revision is unavailable.');
    status.textContent = 'Preparing selected scene';
    viewer = createApplicationViewer({
      container: document.querySelector('#viewer'),
      creditContainer: document.querySelector('#credits'),
    });

    for (const name of ['webglcontextlost', 'webglcontextrestored']) {
      const listener = () => {
        if (contextEvents.length < 8)
          contextEvents.push({ type: name, atMs: performance.now() });
      };
      viewer.scene.canvas.addEventListener(name, listener);
      removes.push(() =>
        viewer.scene.canvas.removeEventListener(name, listener),
      );
    }
    for (const name of Object.keys(sceneEvents))
      removes.push(
        viewer.scene[name].addEventListener(() => sceneEvents[name]++),
      );
    removes.push(
      viewer.scene.renderError.addEventListener((_scene, error) => {
        if (renderErrors.length < 8)
          renderErrors.push({
            name: String(error?.name || 'Error').slice(0, 80),
            message: String(error?.message || error).slice(0, 300),
          });
      }),
    );

    for (const name of ['skyBox', 'skyAtmosphere', 'sun', 'moon'])
      viewer.scene[name].show = false;
    viewer.scene.globe.show = true;
    viewer.scene.globe.enableLighting = false;
    viewer.scene.requestRenderMode = true;
    viewer.scene.maximumRenderTimeChange = Infinity;
    viewer.camera.setView({
      destination: Cesium.Cartesian3.fromDegrees(20, 5, 3_000_000),
    });

    report.environment = readPerformanceEnvironment({
      viewer,
      appCommit,
      harnessCommit: appCommit,
    });
    report.renderer = {
      renderer: report.environment?.renderer ?? null,
      vendor: report.environment?.vendor ?? null,
    };
    const gl = viewer.scene.context?._gl;
    try {
      report.contextAttributes = gl?.getContextAttributes?.() || null;
    } catch {
      report.contextAttributes = null;
    }
    report.setupStartedAtMs = performance.now();

    if (control.sceneMode === 'paused-wind') {
      rendering = createWindRendering({
        cesium: Cesium,
        container: document.querySelector('#viewer'),
        getViewer: () => viewer,
      });
      rendering.attach();
      rendering.setOptions({ overlay: 'speed', paused: true });
      rendering.setField(createWindField());
      rendering.start();
    }

    const readReadiness = () => {
      const windDiagnostics =
        control.sceneMode === 'paused-wind' ? rendering.getDiagnostics() : null;
      return {
        gpuReady:
          control.sceneMode === 'globe-only'
            ? null
            : Boolean(windDiagnostics?.gpu?.ready),
        imageryActive:
          control.sceneMode === 'globe-only'
            ? null
            : Boolean(windDiagnostics?.imageryActive),
        globeTilesLoaded: Boolean(viewer.scene.globe.tilesLoaded),
      };
    };
    const isReady = (value) =>
      value.globeTilesLoaded &&
      (control.sceneMode === 'globe-only' ||
        (value.gpuReady && value.imageryActive));
    const setupDeadline = performance.now() + 15000;
    let readiness = readReadiness();
    while (performance.now() < setupDeadline && !isReady(readiness)) {
      viewer.scene.requestRender();
      await new Promise((resolve) => setTimeout(resolve, 100));
      readiness = readReadiness();
    }
    report.setupElapsedMs = Math.max(
      0,
      performance.now() - report.setupStartedAtMs,
    );
    report.sceneReadiness = {
      ...readiness,
      status: isReady(readiness) ? 'ready' : 'timed-out',
      deadlineMs: 15000,
    };
    if (!isReady(readiness))
      throw new Error('Selected scene did not become ready within 15000 ms.');

    rafObservation = createRafObservation();
    status.textContent = `Running ${control.sceneMode} / ${control.captureMode}`;
    const probe = await runWindFrameProbe({
      captureMode: control.captureMode,
      waitForFrame: ({ captureMode, timeoutMs }) =>
        captureMode === 'copy'
          ? captureFreshCesiumFrame(viewer, { timeoutMs })
          : renderFreshCesiumFrame(viewer, { timeoutMs }),
      readPixels,
      hashPixels,
      releaseFrame(canvas) {
        canvas.width = canvas.height = 0;
      },
      snapshot: () => ({
        sceneEvents: { ...sceneEvents },
        page: frameDiagnostics.snapshotCanvas(viewer.scene.canvas),
        raf: rafObservation.snapshot(),
      }),
    });
    report.probe = probe;
    report.attempts = probe.attempts;
    report.status = probe.status === 'complete' ? 'observed' : 'failed';
    if (probe.status === 'failed') {
      report.failure = {
        phase: probe.attempts.at(-1)?.failurePhase || 'probe',
        message:
          probe.attempts.at(-1)?.error || 'Frame probe did not complete.',
      };
      rafObservation.stop();
      report.failureFollowup = {
        scope:
          'Observation after failure only; not a retry or acceptance attempt.',
        ...(await observeImportFrameHealth()),
      };
    }
  } catch (error) {
    report.status = 'failed';
    report.failure ||= {
      phase: 'setup',
      message: String(error?.message || error).slice(0, 300),
    };
    if (viewer && !viewer.isDestroyed()) {
      rafObservation?.stop();
      report.failureFollowup = {
        scope:
          'Observation after failure only; not a retry or acceptance attempt.',
        ...(await observeImportFrameHealth()),
      };
    }
  } finally {
    rafObservation?.stop();
    report.finishedAt = new Date().toISOString();
    report.sceneEvents = { ...sceneEvents };
    report.renderErrors = renderErrors;
    report.contextEvents = contextEvents;
    report.lifecycleEvents = frameDiagnostics.events();
    report.foregroundUninterrupted = !backgrounded;
    report.desktopForegroundVerification = 'unavailable';
    report.cleanup = {
      listenersRemoved: true,
      diagnosticsDisposed: false,
      windRenderingDestroyed: rendering === null,
      viewerDestroyed: viewer === null || viewer.isDestroyed(),
      errors: [],
    };
    for (const remove of removes) {
      try {
        remove();
      } catch (error) {
        report.cleanup.listenersRemoved = false;
        report.cleanup.errors.push(
          String(error?.message || error).slice(0, 200),
        );
      }
    }
    try {
      frameDiagnostics.dispose();
      report.cleanup.diagnosticsDisposed = true;
    } catch (error) {
      report.cleanup.errors.push(String(error?.message || error).slice(0, 200));
    }
    try {
      rendering?.destroy();
      report.cleanup.windRenderingDestroyed = true;
    } catch (error) {
      report.cleanup.errors.push(String(error?.message || error).slice(0, 200));
    }
    try {
      if (viewer && !viewer.isDestroyed()) viewer.destroy();
      report.cleanup.viewerDestroyed = !viewer || viewer.isDestroyed();
    } catch (error) {
      report.cleanup.errors.push(String(error?.message || error).slice(0, 200));
    }
    try {
      document.removeEventListener('visibilitychange', visibility);
    } catch (error) {
      report.cleanup.errors.push(String(error?.message || error).slice(0, 200));
    }
    if (report.cleanup.errors.length) report.status = 'failed';
    lastReport = report;
    result.textContent = JSON.stringify(report, null, 2);
    status.textContent = report.status;
    downloadButton.disabled = false;
    runButton.disabled = false;
    sceneModeSelect.disabled = false;
    captureModeSelect.disabled = false;
  }
});
