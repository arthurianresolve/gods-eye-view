import * as Cesium from 'cesium';
import 'cesium/Build/Cesium/Widgets/widgets.css';
import { createApplicationViewer } from '../../src/app/viewer.js';
import { createWindRendering } from '../../src/layers/wind/rendering.js';
import { captureFreshCesiumFrame } from '../../src/freshFrame.js';
import { readPerformanceEnvironment } from '../../src/performance/performanceSnapshot.js';
import {
  createImportFrameDiagnostics,
  observeImportFrameHealth,
} from '../performance/importFrameDiagnostics.mjs';

const run = document.querySelector('#run');
const status = document.querySelector('#status');
const result = document.querySelector('#result');
const check = (value, message) => {
  if (!value) throw new Error(message);
};
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const snapshot = {
  model: 'fixture',
  units: 'm/s',
  level: 'surface',
  cycle: { runIso: '2026-01-01T00:00:00Z' },
  grid: { nx: 360, ny: 181, lo1: 0, la1: 90, dx: 1, dy: 1 },
  u: Float32Array.from(
    { length: 65160 },
    (_, i) => 10 + Math.sin(i * 0.01) * 3,
  ),
  v: Float32Array.from({ length: 65160 }, (_, i) => Math.cos(i * 0.01) * 4),
};
run.addEventListener('click', async () => {
  run.disabled = true;
  result.textContent = '';
  const report = {
    schema: 'gev-wind-image-reuse/v1',
    applicationCommit: __GEV_APP_COMMIT__,
    harnessCommit: __GEV_APP_COMMIT__,
    capturedAt: new Date().toISOString(),
    fixture: 'synthetic-360x181-wind-and-scalars/v1',
    scope:
      'Same-build forced construction versus retained-image equivalence at a fixed pose; isolated globe host, paused real GPU wind geometry. No FPS, latency or soak claim.',
    checks: [],
    captureAttempts: [],
    status: 'running',
  };
  let viewer, rendering;
  const frameDiagnostics = createImportFrameDiagnostics();
  const removes = [];
  const sceneEvents = { preUpdate: 0, preRender: 0, postRender: 0 };
  const renderErrors = [];
  const contextEvents = [];
  let backgrounded = document.hidden;
  const visibility = () => {
    if (document.hidden) backgrounded = true;
  };
  document.addEventListener('visibilitychange', visibility);
  try {
    check(
      /^[a-f0-9]{40}$/.test(report.applicationCommit),
      'Exact revision required',
    );
    viewer = createApplicationViewer({
      container: document.querySelector('#viewer'),
      creditContainer: document.querySelector('#credits'),
    });
    for (const name of ['webglcontextlost', 'webglcontextrestored']) {
      const listener = () => {
        if (contextEvents.length < 8)
          contextEvents.push({ type: name, atMs: performance.now() });
      };
      const canvas = viewer.scene.canvas;
      canvas.addEventListener(name, listener);
      removes.push(() => canvas.removeEventListener(name, listener));
    }
    for (const name of Object.keys(sceneEvents))
      removes.push(
        viewer.scene[name].addEventListener(() => sceneEvents[name]++),
      );
    removes.push(
      viewer.scene.renderError.addEventListener((_scene, error) => {
        if (renderErrors.length < 8)
          renderErrors.push({
            name: error?.name,
            message: String(error?.message).slice(0, 500),
          });
      }),
    );
    for (const item of ['skyBox', 'skyAtmosphere', 'sun', 'moon'])
      viewer.scene[item].show = false;
    viewer.scene.globe.show = true;
    viewer.scene.globe.enableLighting = false;
    viewer.scene.requestRenderMode = true;
    viewer.scene.maximumRenderTimeChange = Infinity;
    viewer.camera.setView({
      destination: Cesium.Cartesian3.fromDegrees(20, 5, 3_000_000),
    });
    report.environment = readPerformanceEnvironment({
      viewer,
      appCommit: __GEV_APP_COMMIT__,
      harnessCommit: __GEV_APP_COMMIT__,
    });
    rendering = createWindRendering({
      cesium: Cesium,
      container: document.querySelector('#viewer'),
      getViewer: () => viewer,
    });
    rendering.attach();
    const ready = async () => {
      const deadline = performance.now() + 15000;
      do {
        viewer.scene.requestRender();
        await wait(100);
        const state = rendering.getDiagnostics();
        if (
          state.gpu?.ready &&
          state.imageryActive &&
          viewer.scene.globe.tilesLoaded
        )
          return;
      } while (performance.now() < deadline);
      throw new Error('Wind geometry or imagery did not settle');
    };
    const pixels = async (phase) => {
      const attempt = {
        phase,
        startedAtMs: performance.now(),
        before: { ...sceneEvents },
        visibility: frameDiagnostics.snapshotCanvas(viewer.scene.canvas),
      };
      report.captureAttempts.push(attempt);
      const canvas = await captureFreshCesiumFrame(viewer);
      attempt.elapsedMs = performance.now() - attempt.startedAtMs;
      attempt.after = { ...sceneEvents };
      attempt.copied = Boolean(canvas);
      attempt.viewerLoopEnabled = viewer.useDefaultRenderLoop;
      attempt.contextDestroyed = viewer.scene.context?.isDestroyed?.() === true;
      check(canvas, 'Fresh capture did not complete');
      try {
        const rgba = canvas
          .getContext('2d')
          .getImageData(0, 0, canvas.width, canvas.height).data;
        const digest = await crypto.subtle.digest('SHA-256', rgba);
        return [...new Uint8Array(digest)]
          .map((n) => n.toString(16).padStart(2, '0'))
          .join('');
      } finally {
        canvas.width = canvas.height = 0;
      }
    };
    for (const overlay of ['speed', 'temperature', 'pressure']) {
      status.textContent = `Checking ${overlay}`;
      rendering.clear();
      rendering.setOptions({ overlay, paused: true });
      const field = {
        ...snapshot,
        scalar: {
          kind: overlay,
          units: overlay === 'pressure' ? 'hPa' : '\u00b0C',
          values: Float32Array.from(
            { length: 65160 },
            (_, i) =>
              (overlay === 'pressure' ? 1013 : 20) + Math.sin(i * 0.001) * 10,
          ),
        },
      };
      rendering.setField(field);
      rendering.start();
      await ready();
      const image = viewer.imageryLayers.get(0);
      const expected = await pixels(`${overlay}:constructed`);
      const control = await pixels(`${overlay}:control`);
      check(expected === control, `${overlay}: repeated control pixels differ`);
      const before = rendering.getDiagnostics();
      rendering.setField({
        ...field,
        u: new Float32Array(field.u),
        v: new Float32Array(field.v),
        scalar: {
          ...field.scalar,
          values: new Float32Array(field.scalar.values),
        },
      });
      await ready();
      const observed = await pixels(`${overlay}:retained`);
      const after = rendering.getDiagnostics();
      const entry = {
        overlay,
        expected,
        control,
        observed,
        imageRetained: viewer.imageryLayers.get(0) === image,
        pathCount: after.gpu?.pathCount,
        vertexCount: after.gpu?.vertexCount,
        status: 'failed',
      };
      report.checks.push(entry);
      check(expected === observed, `${overlay}: reused-image pixels differ`);
      check(entry.imageRetained, `${overlay}: image was replaced`);
      check(
        after.gpu.pathCount === before.gpu.pathCount &&
          after.gpu.vertexCount === before.gpu.vertexCount,
        'Flow population changed',
      );
      entry.status = 'passed';
    }
    check(
      new Set(report.checks.map((item) => item.expected)).size === 3,
      'Distinct scalar fields must produce distinct images',
    );
    check(!backgrounded, 'Foreground interrupted');
    report.status = 'passed';
  } catch (error) {
    report.status = 'failed';
    report.error = error.message;
    if (viewer && !viewer.isDestroyed())
      report.failureFrameHealth = await observeImportFrameHealth();
  } finally {
    report.sceneEvents = { ...sceneEvents };
    report.renderErrors = renderErrors;
    report.contextEvents = contextEvents;
    report.lifecycleEvents = frameDiagnostics.events();
    for (const remove of removes) remove();
    frameDiagnostics.dispose();
    rendering?.destroy();
    viewer?.destroy();
    document.removeEventListener('visibilitychange', visibility);
    report.foregroundUninterrupted = !backgrounded;
    result.textContent = JSON.stringify(report, null, 2);
    status.textContent = report.status;
    run.disabled = false;
  }
});
