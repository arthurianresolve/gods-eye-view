import * as Cesium from 'cesium';
import 'cesium/Build/Cesium/Widgets/widgets.css';
import { createApplicationViewer } from '../../src/app/viewer.js';
import { captureFreshCesiumFrame } from '../../src/freshFrame.js';
import { readPerformanceEnvironment } from '../../src/performance/performanceSnapshot.js';

const run = document.querySelector('#run');
const status = document.querySelector('#status');
const result = document.querySelector('#result');
const download = document.querySelector('#download');
const container = document.querySelector('#viewer');
let report;

function check(condition, message) {
  if (!condition) throw new Error(message);
}
async function sample(viewer, label, width, height, color) {
  container.style.width = `${width}px`;
  container.style.height = `${height}px`;
  viewer.resize();
  viewer.scene.backgroundColor = color;
  const framesBefore = viewer.scene.postRender.numberOfListeners;
  const canvas = await captureFreshCesiumFrame(viewer);
  check(canvas, `${label}: no fresh frame`);
  try {
    check(
      canvas.width === viewer.canvas.width &&
        canvas.height === viewer.canvas.height,
      `${label}: wrong dimensions`,
    );
    const pixel = [...canvas.getContext('2d').getImageData(1, 1, 1, 1).data];
    const expected = color.toBytes();
    check(
      pixel
        .slice(0, 3)
        .every((channel, index) => Math.abs(channel - expected[index]) <= 2),
      `${label}: stale/black frame: ${pixel}`,
    );
    check(
      viewer.scene.postRender.numberOfListeners === framesBefore,
      `${label}: listener retained`,
    );
    return {
      label,
      status: 'passed',
      width: canvas.width,
      height: canvas.height,
      pixel,
      listeners: framesBefore,
    };
  } finally {
    canvas.width = canvas.height = 0;
  }
}

run.addEventListener('click', async () => {
  run.disabled = true;
  download.disabled = true;
  report = {
    schema: 'gev-capture-matrix/v1',
    fixture: 'synthetic-colour-depth-points/v1',
    applicationCommit: __GEV_APP_COMMIT__,
    harnessCommit: __GEV_APP_COMMIT__,
    capturedAt: new Date().toISOString(),
    scope: 'isolated application viewer; no performance claim',
    checks: [],
    environments: [],
    status: 'running',
  };
  let viewer;
  try {
    check(
      /^[a-f0-9]{40}$/.test(report.applicationCommit || ''),
      'Start the local server with GEV_APP_COMMIT set to its clean source revision.',
    );
    for (const preserveDrawingBuffer of [true, false]) {
      status.textContent = `Checking preserveDrawingBuffer=${preserveDrawingBuffer}`;
      viewer = createApplicationViewer({
        container,
        creditContainer: document.querySelector('#credits'),
        preserveDrawingBuffer,
      });
      viewer.scene.skyBox.show = false;
      viewer.scene.skyAtmosphere.show = false;
      viewer.scene.sun.show = false;
      viewer.scene.moon.show = false;
      viewer.scene.globe.show = false;
      viewer.scene.requestRenderMode = true;
      viewer.scene.maximumRenderTimeChange = Infinity;
      const points = viewer.scene.primitives.add(
        new Cesium.PointPrimitiveCollection(),
      );
      for (let i = 0; i < 100; i++)
        points.add({
          position: Cesium.Cartesian3.fromDegrees(
            -97.74 + i * 0.001,
            30.27,
            100,
          ),
          color: Cesium.Color.WHITE,
          pixelSize: 8,
        });
      viewer.camera.setView({
        destination: Cesium.Cartesian3.fromDegrees(-97.69, 30.27, 10000),
      });
      report.environments.push({
        ...readPerformanceEnvironment({
          viewer,
          appCommit: __GEV_APP_COMMIT__,
          harnessCommit: __GEV_APP_COMMIT__,
        }),
        preserveDrawingBuffer:
          viewer.scene.context._gl.getContextAttributes().preserveDrawingBuffer,
        msaaSamples: viewer.scene.msaaSamples,
      });
      for (const [label, width, height, color] of [
        ['idle', 640, 360, Cesium.Color.RED],
        ['moving', 640, 360, Cesium.Color.BLUE],
        ['portrait', 360, 640, Cesium.Color.LIME],
        ['resized', 720, 400, Cesium.Color.RED],
        ['restored', 640, 360, Cesium.Color.BLUE],
      ]) {
        if (label === 'moving') viewer.camera.moveRight(250);
        report.checks.push({
          preserveDrawingBuffer,
          ...(await sample(viewer, label, width, height, color)),
        });
      }
      const capture = captureFreshCesiumFrame(viewer);
      viewer.destroy();
      viewer = null;
      check((await capture) === null, 'destroyed capture did not cancel');
      report.checks.push({
        preserveDrawingBuffer,
        label: 'destroy-pending',
        status: 'passed',
      });
    }
    report.status = 'passed';
  } catch (error) {
    report.status = 'failed';
    report.error = error.message;
  } finally {
    if (viewer && !viewer.isDestroyed()) viewer.destroy();
    status.textContent = `${report.status}: ${report.checks.length} checks`;
    result.textContent = JSON.stringify(report, null, 2);
    run.disabled = false;
    download.disabled = false;
  }
});
download.addEventListener('click', () => {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }),
  );
  const link = document.createElement('a');
  link.href = url;
  link.download = `capture-matrix-${report.applicationCommit.slice(0, 7)}.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
});
