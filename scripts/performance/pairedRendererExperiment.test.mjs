import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {
  cleanupEarlyCesiumRendererProbe,
  installEarlyCesiumRendererProbe,
  readEarlyCesiumRendererProbe,
} from './earlyCesiumRendererProbe.mjs';
import { evaluatePairedRendererExperiment } from './pairedRendererExperiment.mjs';

const commit = 'a'.repeat(40);
const stageIds = [
  'prior-install-saves-browser-workspace',
  'interrupted-update-retained-application',
  'prior-install-rollback-same-profile',
  'upgraded-application-same-profile',
  'failed-verification-rolls-back-and-reopens-assets',
];

function report(variant, { factor = 1, cpu = 'Test CPU' } = {}) {
  const config = {
    'driver-late': ['swiftshader-gl-driver', 'late'],
    'webgl-late': ['swiftshader-webgl-only', 'late'],
    'driver-early': ['swiftshader-gl-driver', 'early'],
  }[variant];
  return {
    scope: 'prior-install-browser-profile-recovery',
    candidateCommit: commit,
    priorCommit: 'b'.repeat(40),
    platform: 'win32',
    os: 'win32-build',
    node: 'v24.14.0',
    hostEnvironment: { cpuModel: cpu, logicalCpus: 4, totalMemoryBytes: 1e9 },
    requestedRenderingBackend: config[0],
    rendererExperiment: {
      variant,
      queryTiming: config[1],
      sequenceOrder: 'ABC',
      sequenceIndex: { 'driver-late': 0, 'webgl-late': 1, 'driver-early': 2 }[variant],
      runId: 'test-run',
    },
    browserVersion: 'Chrome/140.0',
    viewport: { width: 960, height: 640 },
    sourceDirtyAtStart: false,
    sourceChangedDuringRun: false,
    status: 'passed',
    checks: stageIds.map((id) => ({
      id,
      status: 'passed',
      renderer: 'Google SwiftShader',
      assetSha256: 'd41c5ba5b579e090afd39f445f3df21b3a476581996c3980627e9bbc3d403d9c',
      renderedFeatures: 1,
      settingsMatch: true,
      workspaceBundleMatches: true,
      timing: {
        rendererQueryTiming: config[1],
        rendererQueryMeasurement: config[1] === 'early' ? 'page-query' : 'host-round-trip',
        bootElapsedMs: 1000 * factor,
        rendererQueryDurationMs: 100,
        bootPlusQueryCriticalPathMs: (1200 + stageIds.indexOf(id) * 20) * factor,
      },
      pageOwnership: {
        initialPageCount: 1,
        appPagesBeforeNavigation: 0,
        appPagesAfterBoot: 1,
        appPagesAfterWorkspace: 1,
        unexpectedCreatedPageTargets: 0,
        closeCompleted: true,
        openPagesBeforeBrowserClose: 0,
        browserCloseCompleted: true,
        forcedBrowserProcessTermination: false,
      },
    })),
  };
}

function packet({ factors = { 'driver-late': 1, 'webgl-late': 0.7, 'driver-early': 0.7 }, order = 'ABC' } = {}) {
  const sequence = order === 'ABC'
    ? ['driver-late', 'webgl-late', 'driver-early']
    : ['driver-early', 'webgl-late', 'driver-late'];
  return {
    reports: sequence.map((variant) => ({
      variant,
      report: {
        ...report(variant, { factor: factors[variant] }),
        rendererExperiment: {
          ...report(variant).rendererExperiment,
          sequenceOrder: order,
          sequenceIndex: sequence.indexOf(variant),
          runId: 'test-run',
        },
      },
    })),
    order,
    expectedCommit: commit,
  };
}

test('same-runner packet validates invariants and reports objective separately', () => {
  const result = evaluatePairedRendererExperiment(packet());
  assert.equal(result.status, 'comparable');
  assert.equal(result.adoptionEligibleByVariant['webgl-late'], true);
  assert.equal(result.adoptionEligibleByVariant['driver-early'], true);
  assert.equal(result.comparisons['webgl-late'].objectiveMet, true);
  assert.equal(result.comparisons['driver-early'].objectiveMet, true);
  assert.match(result.evidenceScope, /not hardware-performance acceptance/);
});

test('a small valid change remains comparable but misses the target', () => {
  const result = evaluatePairedRendererExperiment(packet({
    factors: { 'driver-late': 1, 'webgl-late': 0.95, 'driver-early': 1.04 },
  }));
  assert.equal(result.status, 'comparable');
  assert.equal(result.comparisons['webgl-late'].objectiveMet, false);
  assert.equal(result.adoptionEligibleByVariant['webgl-late'], false);
  assert.equal(result.adoptionEligibleByVariant['driver-early'], false);
});

test('eligibility is reported independently for each experimental candidate', () => {
  const result = evaluatePairedRendererExperiment(packet({
    factors: { 'driver-late': 1, 'webgl-late': 0.7, 'driver-early': 1.03 },
  }));
  assert.equal(result.adoptionEligibleByVariant['webgl-late'], true);
  assert.equal(result.adoptionEligibleByVariant['driver-early'], false);
});

test('moving query time into a slower boot does not look like an end-to-end win', () => {
  const input = packet({
    factors: { 'driver-late': 1, 'webgl-late': 0.7, 'driver-early': 1 },
  });
  const early = input.reports.find((entry) => entry.variant === 'driver-early').report;
  for (const check of early.checks) {
    check.timing.rendererQueryDurationMs = 1;
    check.timing.bootElapsedMs *= 1.4;
    check.timing.bootPlusQueryCriticalPathMs *= 1.4;
  }
  const result = evaluatePairedRendererExperiment(input);
  assert.equal(result.comparisons['driver-early'].objectiveMet, false);
  assert.equal(result.adoptionEligibleByVariant['driver-early'], false);
});

test('CBA order and same-host comparisons are enforced', () => {
  assert.equal(evaluatePairedRendererExperiment(packet({ order: 'CBA' })).order, 'CBA');
  const reports = packet({ order: 'CBA' }).reports;
  reports.find((entry) => entry.variant === 'webgl-late').report.hostEnvironment.cpuModel = 'Other CPU';
  assert.throws(
    () => evaluatePairedRendererExperiment({ reports, order: 'CBA', expectedCommit: commit }),
    /host changed/,
  );
});

test('dirty, wrong-build, missing, reordered, or invalid-ownership reports fail closed', () => {
  const cases = [
    (reports) => { reports[0].report.candidateCommit = 'd'.repeat(40); },
    (reports) => { reports[0].report.sourceDirtyAtStart = true; },
    (reports) => { reports[0].report.checks.pop(); },
    (reports) => { reports[0].report.checks[1].pageOwnership.openPagesBeforeBrowserClose = 1; },
    (reports) => { reports[0].report.checks[2].timing.bootPlusQueryCriticalPathMs = NaN; },
    (reports) => { reports[0].report.checks[3].assetSha256 = 'f'.repeat(64); },
    (reports) => { reports[0].report.checks[4].settingsMatch = false; },
    (reports) => { delete reports[0].report.hostEnvironment.cpuModel; },
    (reports) => { reports[0].report.browserVersion = ''; },
    (reports) => { delete reports[0].report.rendererExperiment.runId; },
    (reports) => { delete reports[0].report.viewport.width; },
    (reports) => { reports[0].report.checks[0].status = 'failed'; },
    (reports) => { reports[0].report.checks[0].timing.bootPlusQueryCriticalPathMs = 100; },
  ];
  for (const mutate of cases) {
    const { reports, order, expectedCommit } = packet();
    mutate(reports);
    assert.throws(() => evaluatePairedRendererExperiment({ reports, order, expectedCommit }));
  }
  const incomplete = packet();
  incomplete.reports.pop();
  assert.throws(() => evaluatePairedRendererExperiment(incomplete), /three reports/);
  const browserMismatch = packet();
  browserMismatch.reports[1].report.browserVersion = 'Chrome/other';
  assert.throws(() => evaluatePairedRendererExperiment(browserMismatch), /browserVersion differs/);
  const viewportMismatch = packet();
  viewportMismatch.reports[2].report.viewport.width += 1;
  assert.throws(() => evaluatePairedRendererExperiment(viewportMismatch), /viewport differs/);
  const duplicateRun = packet();
  duplicateRun.reports[2].report.rendererExperiment.runId = 'another-run';
  assert.throws(() => evaluatePairedRendererExperiment(duplicateRun), /run identity differs/);
});

function earlyProbePage(performanceStep = 5) {
  let now = 0;
  class Canvas {
    constructor(widget = true) {
      this.widget = widget;
      this.listeners = new Map();
    }
    closest(selector) { return selector === '.cesium-widget' && this.widget ? {} : null; }
    addEventListener(type, fn) { this.listeners.set(type, fn); }
    removeEventListener(type) { this.listeners.delete(type); }
  }
  const native = function (kind) {
    if (!/^webgl/.test(kind)) return null;
    return {
      RENDERER: 7937,
      getExtension: () => ({ UNMASKED_RENDERER_WEBGL: 37446 }),
      getParameter: () => 'Google SwiftShader',
    };
  };
  Object.defineProperty(Canvas.prototype, 'getContext', {
    configurable: true,
    writable: true,
    value: native,
  });
  const window = {};
  const context = vm.createContext({
    window,
    HTMLCanvasElement: Canvas,
    performance: { now: () => (now += performanceStep) },
    Object,
    String,
    Reflect,
  });
  const evaluate = (fn, ...args) =>
    vm.runInContext(`(${fn.toString()})(...${JSON.stringify(args)})`, context);
  const page = {
    isClosed: () => false,
    evaluateOnNewDocument: async (fn) => {
      evaluate(fn);
      return { identifier: 'early-hook' };
    },
    evaluate: async (fn, ...args) => evaluate(fn, ...args),
    removeScriptToEvaluateOnNewDocument: async (id) => id,
  };
  return { page, Canvas, native, window };
}

test('early probe preserves native getContext semantics and verifies real scene identity', async () => {
  const { page, Canvas, native, window } = earlyProbePage();
  await installEarlyCesiumRendererProbe(page);
  const canvas = new Canvas();
  const gl = canvas.getContext('webgl2', { alpha: false });
  assert.equal(gl.getParameter(7937), 'Google SwiftShader');
  assert.equal(Canvas.prototype.getContext, native, 'wrapper restores after first real Cesium context');
  window.__godsEyeView = {
    viewer: { scene: { canvas, context: { _originalGLContext: gl } } },
  };
  const result = await readEarlyCesiumRendererProbe(page);
  assert.equal(result.renderer, 'Google SwiftShader');
  assert.equal(result.canvasMatchesScene, true);
  assert.equal(result.contextMatchesScene, true);
  assert.equal(await cleanupEarlyCesiumRendererProbe(page, 'early-hook'), true);
  assert.equal(window.__gevRecoveryEarlyRendererProbe, undefined);
});

test('early probe ignores non-Cesium canvases and rejects missing, replaced, or lost contexts', async () => {
  const missing = earlyProbePage();
  await installEarlyCesiumRendererProbe(missing.page);
  new missing.Canvas(false).getContext('webgl2');
  assert.equal(await missing.page.evaluate((key) => window[key]?.captured, '__gevRecoveryEarlyRendererProbe'), false);
  await assert.rejects(readEarlyCesiumRendererProbe(missing.page), /not captured/);

  const replaced = earlyProbePage();
  await installEarlyCesiumRendererProbe(replaced.page);
  const canvas = new replaced.Canvas();
  const gl = canvas.getContext('webgl2');
  replaced.window.__godsEyeView = { viewer: { scene: { canvas, context: { _originalGLContext: {} } } } };
  await assert.rejects(readEarlyCesiumRendererProbe(replaced.page), /does not match Cesium/);

  const lost = earlyProbePage();
  await installEarlyCesiumRendererProbe(lost.page);
  const lostCanvas = new lost.Canvas();
  lostCanvas.getContext('webgl2');
  lostCanvas.listeners.get('webglcontextlost')({ preventDefault() {} });
  lost.window.__godsEyeView = { viewer: { scene: { canvas: lostCanvas, context: { _originalGLContext: lost.window.__gevRecoveryEarlyRendererProbe.context } } } };
  await assert.rejects(readEarlyCesiumRendererProbe(lost.page), /lost or restored/);
});

test('early probe accepts a valid zero-duration clock sample', async () => {
  const { page, Canvas, window } = earlyProbePage(0);
  await installEarlyCesiumRendererProbe(page);
  const canvas = new Canvas();
  const gl = canvas.getContext('webgl2');
  window.__godsEyeView = { viewer: { scene: { canvas, context: { _originalGLContext: gl } } } };
  const result = await readEarlyCesiumRendererProbe(page);
  assert.equal(result.queryDurationMs, 0);
});
