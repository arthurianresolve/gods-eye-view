import * as Cesium from 'cesium';
import 'cesium/Build/Cesium/Widgets/widgets.css';
import { createApplicationViewer } from '../../src/app/viewer.js';
import { createImportedGeometryLayer } from '../../src/imports/runtimeLayer.js';
import {
  captureFreshCesiumFrame,
  renderFreshCesiumFrame,
} from '../../src/freshFrame.js';
import { observeSubmittedCommands } from '../performance/glCompletionProbe.mjs';
import { getContextStore } from '../../src/data/contextStore.js';
import { readPerformanceEnvironment } from '../../src/performance/performanceSnapshot.js';
import {
  installRenderGovernor,
  uninstallRenderGovernor,
} from '../../src/renderGovernor.js';
import {
  createImportFrameDiagnostics,
  observeImportFrameHealth,
} from '../performance/importFrameDiagnostics.mjs';

const run = document.querySelector('#run');
const status = document.querySelector('#status');
const result = document.querySelector('#result');
const download = document.querySelector('#download');
const frameProbe = document.querySelector('#frame-probe');
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const runOptions = new URLSearchParams(window.location.search);
const requestedWorkload = runOptions.get('workload');
const requestedViewer =
  runOptions.get('viewer') === 'cesium' ? 'cesium' : 'application-wrapper';
if (
  ['paired', 'synchronous', 'cooperative'].includes(requestedWorkload)
)
  document.querySelector('#workload').value = requestedWorkload;
if (['initial-load', 'steady-population'].includes(requestedWorkload))
  status.textContent = 'Diagnostic only: unchanged loaded population';
let frameDiagnostics = null;
const check = (condition, message) => {
  if (!condition) throw new Error(message);
};
const imports = [
  {
    id: 'fixture',
    kind: 'synthetic-demo',
    attribution: 'Generated local fixture',
    records: Array.from({ length: 5000 }, (_, i) => ({
      id: String(i),
      properties: { name: `Fixture ${i}` },
      geometry: {
        type: 'Point',
        coordinates: [
          (i % 100) * 0.003 - 0.15,
          Math.floor(i / 100) * 0.003 - 0.075,
        ],
      },
    })),
  },
];
let report;
function resources(viewer) {
  const collections = [];
  const visit = (value, depth = 0) => {
    if (!value || depth > 5 || collections.length >= 64) return;
    collections.push({
      type: value.constructor.name,
      count: value.length ?? null,
    });
    if (value instanceof Cesium.PrimitiveCollection)
      for (let i = 0; i < value.length; i++) visit(value.get(i), depth + 1);
  };
  visit(viewer.scene.primitives);
  return {
    heapBytes: performance.memory?.usedJSHeapSize ?? null,
    heapScope: 'Unforced heap sample; not retained-memory acceptance',
    entities: viewer.entities.values.length,
    collections,
  };
}
frameProbe.addEventListener('click', async () => {
  run.disabled = download.disabled = frameProbe.disabled = true;
  result.textContent = '';
  status.textContent =
    'Observing ordinary browser callbacks for five seconds, without Cesium';
  let count = 0,
    previous = performance.now(),
    maximumGapMs = 0,
    frame;
  const started = previous;
  const tick = () => {
    const current = performance.now();
    maximumGapMs = Math.max(maximumGapMs, current - previous);
    previous = current;
    count++;
    frame = requestAnimationFrame(tick);
  };
  frame = requestAnimationFrame(tick);
  await wait(5000);
  cancelAnimationFrame(frame);
  result.textContent = JSON.stringify(
    {
      scope:
        'Browser scheduling diagnostic without a Cesium viewer; not acceptance evidence',
      frames: count,
      maximumGapMs: count ? maximumGapMs : null,
      trailingGapMs: performance.now() - previous,
      elapsedMs: performance.now() - started,
      visibility: document.visibilityState,
      focused: document.hasFocus(),
    },
    null,
    2,
  );
  status.textContent = 'Browser scheduling diagnostic complete';
  run.disabled = frameProbe.disabled = false;
});
function settledFrame(viewer) {
  return new Promise((resolve, reject) => {
    const remove = viewer.scene.postRender.addEventListener(() => {
      clearTimeout(timer);
      remove();
      resolve();
    });
    const timer = setTimeout(() => {
      remove();
      reject(
        new Error('Fixture did not complete a render within ten seconds.'),
      );
    }, 10000);
    viewer.scene.requestRender();
  });
}
async function pixels(viewer, sample) {
  const started = performance.now();
  const browserStateBefore = report.diagnosticsEnabled
    ? frameDiagnostics.snapshotCanvas(viewer.canvas)
    : null;
  let frames = 0;
  let updates = 0;
  let animationFrames = 0;
  let lastHeartbeat = started;
  let maximumHeartbeatGapMs = 0;
  const heartbeat = setInterval(() => {
    const current = performance.now();
    maximumHeartbeatGapMs = Math.max(
      maximumHeartbeatGapMs,
      current - lastHeartbeat,
    );
    lastHeartbeat = current;
  }, 8);
  let raf;
  const tick = () => {
    animationFrames++;
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
  const removeUpdate = viewer.scene.preUpdate.addEventListener(() => updates++);
  const remove = viewer.scene.postRender.addEventListener(() => frames++);
  const submittedCommands = report.observeCommands
    ? observeSubmittedCommands(viewer.canvas.getContext('webgl2'))
    : null;
  let canvas;
  try {
    canvas = await (report.captureMode === 'render-only'
      ? renderFreshCesiumFrame(viewer)
      : captureFreshCesiumFrame(viewer));
  } finally {
    clearInterval(heartbeat);
    remove();
    removeUpdate();
    cancelAnimationFrame(raf);
    if (submittedCommands)
      sample.submittedCommands = submittedCommands.finish();
  }
  maximumHeartbeatGapMs = Math.max(
    maximumHeartbeatGapMs,
    performance.now() - lastHeartbeat,
  );
  sample.capture = {
    elapsedMs: performance.now() - started,
    renderedFrames: frames,
    updates,
    animationFrames,
    maximumHeartbeatGapMs,
    defaultRenderLoop: viewer.useDefaultRenderLoop,
    targetFrameRate: viewer.targetFrameRate,
    requestRenderMode: viewer.scene.requestRenderMode,
    width: viewer.canvas.width,
    height: viewer.canvas.height,
    contextLost: viewer.canvas.getContext('webgl2')?.isContextLost() ?? null,
    visible: document.visibilityState,
    completed: Boolean(canvas),
    ...(report.diagnosticsEnabled
      ? {
          browserStateBefore,
          browserStateAfter: frameDiagnostics.snapshotCanvas(viewer.canvas),
        }
      : {}),
  };
  if (!canvas && report.diagnosticsEnabled)
    sample.rafHealthWhileViewerAlive = await observeImportFrameHealth();
  check(canvas, 'A fresh capture is required.');
  if (report.captureMode === 'render-only') return null;
  try {
    if (report.captureMode === 'copy-only') return null;
    const data = canvas
      .getContext('2d')
      .getImageData(0, 0, canvas.width, canvas.height).data;
    check(
      data.some((channel, i) => i % 4 !== 3 && channel > 30),
      'The fixture did not render visible points.',
    );
    const digest = await crypto.subtle.digest('SHA-256', data);
    return [...new Uint8Array(digest)]
      .map((n) => n.toString(16).padStart(2, '0'))
      .join('');
  } finally {
    canvas.width = canvas.height = 0;
  }
}

run.addEventListener('click', async () => {
  run.disabled = download.disabled = frameProbe.disabled = true;
  result.textContent = '';
  const workload =
    ['initial-load', 'steady-population'].includes(requestedWorkload)
      ? requestedWorkload
      : document.querySelector('#workload').value;
  const diagnosticRun =
    runOptions.get('diag') === '1' ||
    ['initial-load', 'steady-population'].includes(workload) ||
    requestedViewer === 'cesium';
  frameDiagnostics = diagnosticRun ? createImportFrameDiagnostics() : null;
  const preserveDrawingBuffer = document.querySelector('#preserve').checked;
  report = {
    schema: 'gev-import-batches/v1',
    applicationCommit: __GEV_APP_COMMIT__,
    harnessCommit: __GEV_APP_COMMIT__,
    capturedAt: new Date().toISOString(),
    documentVisibleAtStart: document.visibilityState === 'visible',
    documentFocusedAtStart: document.hasFocus(),
    desktopForegroundVerification: 'unavailable',
    foregroundUninterruptedScope:
      'document visibility only; does not verify desktop foreground or occlusion',
    fixture: 'synthetic-5000-import-points/v1',
    workload,
    viewerConstruction: requestedViewer,
    diagnosticsEnabled: diagnosticRun,
    ...(diagnosticRun
      ? {
          diagnosticClassification:
            'opt-in browser scheduling diagnosis only; not performance acceptance',
        }
      : {}),
    preserveDrawingBuffer,
    captureMode: document.querySelector('#capture-mode').value,
    renderDemand: document.querySelector('#render-demand').checked,
    observeCommands: document.querySelector('#observe-commands').checked,
    commandObservationScope:
      'Optional flushed WebGL fence: prior submitted commands only, not GPU timing or a normal latency comparison',
      scope:
        'isolated import correctness and event-loop responsiveness; no full-application or GPU speedup claim',
    checks: [],
    samples: [],
    renderErrors: [],
    status: 'running',
  };
  let viewer, layer;
  let backgrounded = document.visibilityState !== 'visible';
  const visibility = () => {
    if (document.visibilityState !== 'visible') backgrounded = true;
  };
  document.addEventListener('visibilitychange', visibility);
  try {
    check(
      /^[a-f0-9]{40}$/.test(report.applicationCommit || ''),
      'Exact source revision required.',
    );
    const viewerOptions = {
      timeline: false,
      animation: false,
      baseLayerPicker: false,
      geocoder: false,
      homeButton: false,
      sceneModePicker: false,
      navigationHelpButton: false,
      fullscreenButton: false,
      vrButton: false,
      selectionIndicator: false,
      infoBox: false,
      baseLayer: false,
      creditContainer: document.querySelector('#credits'),
      msaaSamples: 4,
      contextOptions: { webgl: { preserveDrawingBuffer } },
    };
    if (requestedViewer === 'cesium') {
      report.scope =
        'diagnostic-only direct Cesium.Viewer comparison with application options; omits application atmosphere workaround and resolution guard; no performance acceptance';
      report.diagnosticClassification =
        'opt-in viewer-construction isolation only; not performance acceptance';
      viewer = new Cesium.Viewer(
        document.querySelector('#viewer'),
        viewerOptions,
      );
      viewer.targetFrameRate = 60;
    } else {
      viewer = createApplicationViewer({
        container: document.querySelector('#viewer'),
        creditContainer: document.querySelector('#credits'),
        preserveDrawingBuffer,
      });
    }
    viewer.scene.renderError.addEventListener((_scene, error) => {
      report.renderErrors.push(String(error?.message || error).slice(0, 400));
      if (report.renderErrors.length > 4) report.renderErrors.shift();
    });
    if (report.renderDemand) installRenderGovernor(viewer);
    for (const item of ['skyBox', 'skyAtmosphere', 'sun', 'moon', 'globe'])
      viewer.scene[item].show = false;
    viewer.camera.setView({
      destination: Cesium.Cartesian3.fromDegrees(0, 0, 85000),
    });
    report.environment = readPerformanceEnvironment({
      viewer,
      appCommit: report.applicationCommit,
      harnessCommit: report.harnessCommit,
    });
    layer = createImportedGeometryLayer({ viewer });
    status.textContent = diagnosticRun
      ? 'Diagnostic only: warming the complete 5,000-point population'
      : 'Warming the complete point population';
    const coldAt = performance.now();
    await layer.loadAsync(imports, { workspaceId: 'fixture' });
    await settledFrame(viewer);
    report.coldActivationMs = performance.now() - coldAt;
    report.warmedResources = resources(viewer);
    let expectedPixels = null;
    if (workload === 'initial-load') {
      const sample = {
        pair: null,
        mode: 'initial-loaded-population',
        elapsedMs: report.coldActivationMs,
        preCaptureDrainMs: 20,
        maxHeartbeatGapMs: null,
        features: 5000,
        resources: resources(viewer),
      };
      report.samples.push(sample);
      await wait(20);
      sample.pixelSha256 = await pixels(viewer, sample);
      check(
        sample.capture?.completed &&
          (report.captureMode !== 'pixels' || Boolean(sample.pixelSha256)),
        'Initial loaded-population diagnostic did not capture the 5,000-point scene.',
      );
      report.checks.push({
        id: 'initial-5000-point-population-diagnostic',
        status: 'passed',
      });
    } else if (workload === 'steady-population') {
      report.diagnosticClassification =
        'opt-in steady-population scheduling diagnosis only; not performance acceptance';
      report.steadyPopulation = {
        features: 5000,
        captures: 10,
        interCaptureWaitMs: 150,
        preCaptureDrainMs: 20,
        sceneMutatedBetweenCaptures: false,
      };
      for (let captureIndex = 0; captureIndex < 10; captureIndex++) {
        status.textContent = `Steady-population capture ${captureIndex + 1}/10`;
        if (captureIndex > 0) await wait(150);
        check(
          layer.getState().featureCount === 5000 &&
            getContextStore().entities.size === 5000,
          'The steady diagnostic population changed between captures.',
        );
        await wait(20);
        const sample = {
          pair: null,
          mode: 'steady-loaded-population',
          captureIndex,
          interCaptureWaitMs: captureIndex > 0 ? 150 : null,
          preCaptureDrainMs: 20,
          features: 5000,
          resources: resources(viewer),
        };
        report.samples.push(sample);
        sample.pixelSha256 = await pixels(viewer, sample);
        if (expectedPixels === null) expectedPixels = sample.pixelSha256;
        check(
          sample.pixelSha256 === expectedPixels,
          'Steady-population pixels changed between captures.',
        );
      }
      report.checks.push({
        id: 'ten-captures-over-unchanged-5000-point-population-diagnostic',
        status: 'passed',
      });
    } else {
      for (let pair = 0; pair < 5; pair++) {
        const modes =
          workload === 'paired'
            ? pair % 2
              ? ['cooperative', 'synchronous']
              : ['synchronous', 'cooperative']
            : [workload, workload];
        for (const mode of modes) {
          status.textContent = `Pair ${pair + 1}/5: ${mode} import`;
          layer.clear();
          await wait(150);
          let previous = performance.now();
          const gaps = [];
          const timer = setInterval(() => {
            const time = performance.now();
            gaps.push(time - previous);
            previous = time;
          }, 5);
          const started = performance.now();
          let elapsedMs;
          try {
            await (mode === 'synchronous'
              ? layer.load(imports, { workspaceId: 'fixture' })
              : layer.loadAsync(imports, { workspaceId: 'fixture' }));
            elapsedMs = performance.now() - started;
            await wait(20);
          } finally {
            clearInterval(timer);
          }
          check(
            layer.getState().featureCount === 5000 &&
              getContextStore().entities.size === 5000,
            'Incomplete import or stale evidence context.',
          );
          check(layer.getState().pendingJobs === 0, 'Import task retained.');
          const sample = {
            pair,
            mode,
            elapsedMs,
            maxHeartbeatGapMs: Math.max(...gaps),
            features: 5000,
            resources: resources(viewer),
          };
          report.samples.push(sample);
          // The capture operation owns its completed-frame wait. Request it from
          // the import task, rather than immediately chaining two postRender waits.
          const hash = await pixels(viewer, sample);
          sample.pixelSha256 = hash;
          if (expectedPixels === null) expectedPixels = hash;
          check(
            hash === expectedPixels,
            'Final pixels differ across equivalent imports.',
          );
        }
      }
      report.checks.push({
        id:
          report.captureMode === 'pixels'
            ? 'same-population-evidence-and-pixels'
            : 'diagnostic-population-and-fresh-frames-without-pixel-equivalence',
        status: 'passed',
      });
    }
    if (!['initial-load', 'steady-population'].includes(workload))
      status.textContent = 'Checking cancellation and repeated teardown';
    for (
      let i = 0;
      !['initial-load', 'steady-population'].includes(workload) && i < 12;
      i++
    ) {
      const pending = layer.loadAsync(imports, { workspaceId: 'cancelled' });
      const observed = pending.then(
        () => 'completed',
        (error) => error.name,
      );
      layer.clear();
      check(
        (await observed) === 'AbortError',
        'Cancelled work did not reject.',
      );
      check(
        layer.getState().featureCount === 0 &&
          layer.getState().pendingJobs === 0 &&
          getContextStore().entities.size === 0,
        'Cancelled import retained ownership.',
      );
      await wait(10);
    }
    if (!['initial-load', 'steady-population'].includes(workload))
      report.checks.push({
        id: 'twelve-cancelled-imports-release-ownership',
        status: 'passed',
      });
    check(
      !backgrounded,
      'Document visibility changed; rerun for valid measurements.',
    );
    report.status = 'passed';
  } catch (error) {
    report.status = 'failed';
    report.error = error.message;
  } finally {
    layer?.destroy();
    if (viewer) uninstallRenderGovernor(viewer);
    viewer?.destroy();
    document.removeEventListener('visibilitychange', visibility);
    report.documentVisibleThroughout = !backgrounded;
    report.documentFocusedAtEnd = document.hasFocus();
    report.foregroundUninterrupted = !backgrounded;
    if (frameDiagnostics) {
      report.browserLifecycleEvents = frameDiagnostics.events();
      frameDiagnostics.dispose();
      frameDiagnostics = null;
    }
    result.textContent = JSON.stringify(report, null, 2);
    status.textContent = report.status;
    run.disabled = download.disabled = frameProbe.disabled = false;
  }
});
download.addEventListener('click', () => {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }),
  );
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `import-batches-${report.applicationCommit.slice(0, 7)}.json`;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});
