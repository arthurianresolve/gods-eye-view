import * as Cesium from 'cesium';
import 'cesium/Build/Cesium/Widgets/widgets.css';
import { createApplicationViewer } from '../../src/app/viewer.js';
import { createImportedGeometryLayer } from '../../src/imports/runtimeLayer.js';
import { captureFreshCesiumFrame } from '../../src/freshFrame.js';
import { getContextStore } from '../../src/data/contextStore.js';
import { readPerformanceEnvironment } from '../../src/performance/performanceSnapshot.js';

const run = document.querySelector('#run');
const status = document.querySelector('#status');
const result = document.querySelector('#result');
const download = document.querySelector('#download');
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
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
async function pixels(viewer) {
  const canvas = await captureFreshCesiumFrame(viewer);
  check(canvas, 'A fresh capture is required.');
  try {
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
  run.disabled = download.disabled = true;
  report = {
    schema: 'gev-import-batches/v1',
    applicationCommit: __GEV_APP_COMMIT__,
    harnessCommit: __GEV_APP_COMMIT__,
    capturedAt: new Date().toISOString(),
    fixture: 'synthetic-5000-import-points/v1',
    scope:
      'isolated import correctness and event-loop responsiveness; no full-application or GPU speedup claim',
    checks: [],
    samples: [],
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
    viewer = createApplicationViewer({
      container: document.querySelector('#viewer'),
      creditContainer: document.querySelector('#credits'),
    });
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
    await wait(1000);
    let expectedPixels = null;
    for (let pair = 0; pair < 5; pair++) {
      for (const mode of pair % 2
        ? ['cooperative', 'synchronous']
        : ['synchronous', 'cooperative']) {
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
        await wait(250);
        const hash = await pixels(viewer);
        if (expectedPixels === null) expectedPixels = hash;
        check(
          hash === expectedPixels,
          'Final pixels differ across equivalent imports.',
        );
        report.samples.push({
          pair,
          mode,
          elapsedMs,
          maxHeartbeatGapMs: Math.max(...gaps),
          features: 5000,
          pixelSha256: hash,
        });
      }
    }
    report.checks.push({
      id: 'same-population-evidence-and-pixels',
      status: 'passed',
    });
    status.textContent = 'Checking cancellation and repeated teardown';
    for (let i = 0; i < 12; i++) {
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
    report.checks.push({
      id: 'twelve-cancelled-imports-release-ownership',
      status: 'passed',
    });
    check(
      !backgrounded,
      'Foreground interrupted; rerun for valid measurements.',
    );
    report.status = 'passed';
  } catch (error) {
    report.status = 'failed';
    report.error = error.message;
  } finally {
    layer?.destroy();
    viewer?.destroy();
    document.removeEventListener('visibilitychange', visibility);
    report.foregroundUninterrupted = !backgrounded;
    result.textContent = JSON.stringify(report, null, 2);
    status.textContent = report.status;
    run.disabled = download.disabled = false;
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
