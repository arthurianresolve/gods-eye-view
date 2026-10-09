import * as Cesium from 'cesium';
import 'cesium/Build/Cesium/Widgets/widgets.css';
import { createApplicationViewer } from '../../src/app/viewer.js';
import { captureFreshCesiumFrame } from '../../src/freshFrame.js';
import { readPerformanceEnvironment } from '../../src/performance/performanceSnapshot.js';
import {
  installRenderGovernor,
  uninstallRenderGovernor,
  registerRenderDemand,
  getRenderGovernorDiagnostics,
} from '../../src/renderGovernor.js';

const run = document.querySelector('#run');
const status = document.querySelector('#status');
const result = document.querySelector('#result');
const download = document.querySelector('#download');
let report;
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
function check(condition, message) {
  if (!condition) throw new Error(message);
}

run.addEventListener('click', async () => {
  run.disabled = download.disabled = true;
  report = {
    schema: 'gev-render-demand/v1',
    applicationCommit: __GEV_APP_COMMIT__,
    harnessCommit: __GEV_APP_COMMIT__,
    capturedAt: new Date().toISOString(),
    fixture: 'synthetic-governor/v1',
    scope:
      'isolated governor correctness, not whole-application cadence or performance',
    checks: [],
    status: 'running',
  };
  let viewer, removeFrame, periodic, first, second;
  let backgrounded = document.visibilityState !== 'visible';
  const onVisibility = () => {
    if (document.visibilityState !== 'visible') backgrounded = true;
  };
  document.addEventListener('visibilitychange', onVisibility);
  try {
    check(
      /^[a-f0-9]{40}$/.test(report.applicationCommit || ''),
      'An exact served source revision is required.',
    );
    viewer = createApplicationViewer({
      container: document.querySelector('#viewer'),
      creditContainer: document.querySelector('#credits'),
    });
    viewer.scene.skyBox.show =
      viewer.scene.skyAtmosphere.show =
      viewer.scene.sun.show =
      viewer.scene.moon.show =
      viewer.scene.globe.show =
        false;
    installRenderGovernor(viewer);
    let frames = 0;
    removeFrame = viewer.scene.postRender.addEventListener(() => frames++);
    report.environment = readPerformanceEnvironment({
      viewer,
      appCommit: report.applicationCommit,
      harnessCommit: report.harnessCommit,
    });
    report.settings = {
      resolutionScale: viewer.resolutionScale,
      msaaSamples: viewer.scene.msaaSamples,
      antialias: viewer.scene.context._gl.getContextAttributes().antialias,
      preserveDrawingBuffer:
        viewer.scene.context._gl.getContextAttributes().preserveDrawingBuffer,
    };
    await wait(1500);
    status.textContent = 'Measuring ten seconds of settled idle';
    const idleStart = frames;
    const idleAt = performance.now();
    await wait(10000);
    const idleFrames = frames - idleStart;
    check(
      idleFrames <= 2,
      `Idle rendered ${idleFrames} frames, expected at most two.`,
    );
    report.checks.push({
      id: 'idle-ten-seconds',
      status: 'passed',
      frames: idleFrames,
      durationMs: performance.now() - idleAt,
    });

    status.textContent = 'Checking scheduled cadence and independent owners';
    periodic = registerRenderDemand('fixture-periodic');
    const calls = [];
    const periodicAt = performance.now();
    const tick = () => {
      calls.push(performance.now() - periodicAt);
      viewer.scene.backgroundColor =
        calls.length % 2 ? Cesium.Color.BLUE : Cesium.Color.RED;
      if (calls.length < 3) periodic.schedule(tick, 1000);
    };
    periodic.schedule(tick, 1000);
    const periodicStart = frames;
    await wait(3400);
    check(
      calls.length === 3,
      `Expected three one-second updates, observed ${calls.length}.`,
    );
    check(
      calls.every((time, index) => time >= (index + 1) * 995),
      'Periodic update ran before its deadline.',
    );
    check(
      frames - periodicStart >= 3 && frames - periodicStart <= 6,
      'Periodic visual updates did not retain bounded render cadence.',
    );
    report.checks.push({
      id: 'one-second-cadence',
      status: 'passed',
      callsMs: calls,
      frames: frames - periodicStart,
    });

    first = registerRenderDemand('same-name');
    second = registerRenderDemand('same-name');
    first.setContinuous(true);
    second.setContinuous(true);
    first.dispose();
    const continuousStart = frames;
    await wait(350);
    check(
      frames > continuousStart && !viewer.scene.requestRenderMode,
      'Disposing one owner froze the remaining animation.',
    );
    second.setContinuous(false);
    viewer.scene.backgroundColor = Cesium.Color.LIME;
    second.invalidate();
    const canvas = await captureFreshCesiumFrame(viewer);
    check(canvas, 'Final invalidation did not produce a fresh frame.');
    try {
      const pixel = [...canvas.getContext('2d').getImageData(1, 1, 1, 1).data];
      check(
        pixel[1] > 250 && pixel[0] < 3 && pixel[2] < 3,
        'Final transition frame was stale.',
      );
      report.checks.push({
        id: 'independent-owners-and-final-frame',
        status: 'passed',
        pixel,
      });
    } finally {
      canvas.width = canvas.height = 0;
    }
    let lateCall = false;
    second.schedule(() => {
      lateCall = true;
    }, 50);
    second.dispose();
    periodic.dispose();
    await wait(250);
    check(!lateCall, 'Disposed scheduled work executed.');
    const diagnostics = getRenderGovernorDiagnostics();
    check(
      diagnostics.holds.length === 0 &&
        diagnostics.scheduledUpdates.length === 0,
      'Governor retained fixture ownership.',
    );
    report.checks.push({
      id: 'disposal',
      status: 'passed',
      holds: 0,
      scheduledUpdates: 0,
    });
    check(!backgrounded, 'The fixture was backgrounded during measurement.');
    report.status = 'passed';
  } catch (error) {
    report.status = 'failed';
    report.error = error.message;
  } finally {
    first?.dispose();
    second?.dispose();
    periodic?.dispose();
    removeFrame?.();
    if (viewer) {
      uninstallRenderGovernor(viewer);
      if (!viewer.isDestroyed()) viewer.destroy();
    }
    document.removeEventListener('visibilitychange', onVisibility);
    report.backgrounded = backgrounded;
    result.textContent = JSON.stringify(report, null, 2);
    status.textContent = `${report.status}: ${report.checks.length} checks`;
    run.disabled = download.disabled = false;
  }
});
download.addEventListener('click', () => {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }),
  );
  const link = document.createElement('a');
  link.href = url;
  link.download = `render-demand-${report.applicationCommit.slice(0, 7)}.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
});
