import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createCaptureFailureReport } from './captureFailureReport.mjs';
import { preserveShaderProgramAttributionArtifact } from '../qa-performance-build-smoke.mjs';
import {
  boundedShaderProgramAttribution,
  cleanupEarlyCesiumRendererProbe,
  cleanupEarlyCesiumRendererProbeWithEvidence,
  createShaderProgramAttributionEnvelope,
  earlyRendererDocumentHook,
  installEarlyCesiumRendererProbe,
  readEarlyCesiumRendererProbe,
  retireEarlyCesiumRendererProbeForCapturePage,
  removeEarlyCesiumRendererProbeRegistrationWithEvidence,
} from './earlyCesiumRendererProbe.mjs';
import {
  createShaderProgramAttributionCheckpoint,
  persistShaderProgramAttributionCheckpoint,
  validateShaderProgramAttributionCheckpoint,
} from './shaderProgramAttributionArtifact.mjs';
import { PROFILE_RECOVERY_WORKSPACE_ASSET_SHA256 } from './profileRecoveryFixtureContract.mjs';
import {
  evaluatePairedRendererExperiment,
  RENDERER_EXPERIMENT_ORDERS,
} from './pairedRendererExperiment.mjs';

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
      sequenceIndex: { 'driver-late': 0, 'webgl-late': 1, 'driver-early': 2 }[
        variant
      ],
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
      assetSha256: PROFILE_RECOVERY_WORKSPACE_ASSET_SHA256,
      renderedFeatures: 1,
      settingsMatch: true,
      workspaceBundleMatches: true,
      timing: {
        rendererQueryTiming: config[1],
        rendererQueryMeasurement:
          config[1] === 'early' ? 'page-query' : 'host-round-trip',
        bootElapsedMs: 1000 * factor,
        rendererQueryDurationMs: 100,
        bootPlusQueryCriticalPathMs:
          (1200 + stageIds.indexOf(id) * 20) * factor,
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

function packet({
  factors = { 'driver-late': 1, 'webgl-late': 0.7, 'driver-early': 0.7 },
  order = 'ABC',
} = {}) {
  const sequence = RENDERER_EXPERIMENT_ORDERS[order];
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
    processResults: sequence.map((variant) => ({
      variant,
      status: 0,
      error: null,
    })),
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
  const result = evaluatePairedRendererExperiment(
    packet({
      factors: { 'driver-late': 1, 'webgl-late': 0.95, 'driver-early': 1.04 },
    }),
  );
  assert.equal(result.status, 'comparable');
  assert.equal(result.comparisons['webgl-late'].objectiveMet, false);
  assert.equal(result.adoptionEligibleByVariant['webgl-late'], false);
  assert.equal(result.adoptionEligibleByVariant['driver-early'], false);
});

test('eligibility is reported independently for each experimental candidate', () => {
  const result = evaluatePairedRendererExperiment(
    packet({
      factors: { 'driver-late': 1, 'webgl-late': 0.7, 'driver-early': 1.03 },
    }),
  );
  assert.equal(result.adoptionEligibleByVariant['webgl-late'], true);
  assert.equal(result.adoptionEligibleByVariant['driver-early'], false);
});

test('moving query time into a slower boot does not look like an end-to-end win', () => {
  const input = packet({
    factors: { 'driver-late': 1, 'webgl-late': 0.7, 'driver-early': 1 },
  });
  const early = input.reports.find(
    (entry) => entry.variant === 'driver-early',
  ).report;
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
  assert.equal(
    evaluatePairedRendererExperiment(packet({ order: 'CBA' })).order,
    'CBA',
  );
  const reports = packet({ order: 'CBA' }).reports;
  reports.find(
    (entry) => entry.variant === 'webgl-late',
  ).report.hostEnvironment.cpuModel = 'Other CPU';
  const result = evaluatePairedRendererExperiment({
    reports,
    order: 'CBA',
    expectedCommit: commit,
  });
  assert.equal(result.status, 'partially-comparable');
  assert.equal(result.comparisons['webgl-late'].status, 'incomparable');
});

test('AB and BA compare backend variants without requiring the early-query report', () => {
  for (const order of ['AB', 'BA']) {
    const result = evaluatePairedRendererExperiment(packet({ order }));
    assert.equal(result.status, 'comparable');
    assert.deepEqual(Object.keys(result.comparisons), ['webgl-late']);
    assert.equal(result.comparisons['webgl-late'].status, 'comparable');
  }
});

test('same-platform renderer comparisons support all recovery operating systems', () => {
  for (const platform of ['win32', 'darwin', 'linux']) {
    for (const order of ['AB', 'BA']) {
      const input = packet({ order });
      for (const { report } of input.reports) report.platform = platform;
      const result = evaluatePairedRendererExperiment(input);
      assert.equal(result.status, 'comparable');
      assert.equal(result.platform, platform);
      input.reports.find(
        ({ variant }) => variant === 'webgl-late',
      ).report.platform = 'unsupported';
      const invalid = evaluatePairedRendererExperiment(input);
      assert.equal(invalid.comparisons['webgl-late'].status, 'incomparable');
      assert.equal(invalid.adoptionEligibleByVariant['webgl-late'], false);
    }
  }
  const mixed = packet({ order: 'AB' });
  mixed.reports[1].report.platform = 'darwin';
  assert.equal(
    evaluatePairedRendererExperiment(mixed).comparisons['webgl-late'].status,
    'incomparable',
  );
  mixed.reports[0].report.platform = 'unsupported';
  assert.throws(
    () => evaluatePairedRendererExperiment(mixed),
    /unsupported platform/,
  );
});

test('a failed early candidate does not invalidate a completed backend comparison', () => {
  const input = packet({ order: 'ABC' });
  input.reports[2].report.status = 'failed';
  input.processResults[2].status = 1;
  const result = evaluatePairedRendererExperiment(input);
  assert.equal(result.status, 'partially-comparable');
  assert.equal(result.comparisons['webgl-late'].status, 'comparable');
  assert.equal(result.comparisons['webgl-late'].adoptionEligible, true);
  assert.equal(result.comparisons['driver-early'].status, 'incomparable');
  assert.equal(result.comparisons['driver-early'].adoptionEligible, false);
});

test('a sequence without the required driver control cannot compare a candidate', () => {
  const input = packet({ order: 'CBA' });
  input.reports = input.reports.slice(0, 1);
  input.processResults = input.processResults.slice(0, 1);
  assert.throws(
    () => evaluatePairedRendererExperiment(input),
    /control report is required/,
  );
});

test('dirty, wrong-build, missing, reordered, or invalid-ownership reports fail closed', () => {
  const cases = [
    (reports) => {
      reports[0].report.candidateCommit = 'd'.repeat(40);
    },
    (reports) => {
      reports[0].report.sourceDirtyAtStart = true;
    },
    (reports) => {
      reports[0].report.checks.pop();
    },
    (reports) => {
      reports[0].report.checks[1].pageOwnership.openPagesBeforeBrowserClose = 1;
    },
    (reports) => {
      reports[0].report.checks[2].timing.bootPlusQueryCriticalPathMs = NaN;
    },
    (reports) => {
      reports[0].report.checks[3].assetSha256 = 'f'.repeat(64);
    },
    (reports) => {
      reports[0].report.checks[4].settingsMatch = false;
    },
    (reports) => {
      delete reports[0].report.hostEnvironment.cpuModel;
    },
    (reports) => {
      reports[0].report.browserVersion = '';
    },
    (reports) => {
      delete reports[0].report.rendererExperiment.runId;
    },
    (reports) => {
      delete reports[0].report.viewport.width;
    },
    (reports) => {
      reports[0].report.checks[0].status = 'failed';
    },
    (reports) => {
      reports[0].report.checks[0].timing.bootPlusQueryCriticalPathMs = 100;
    },
  ];
  for (const mutate of cases) {
    const { reports, order, expectedCommit } = packet();
    mutate(reports);
    assert.throws(() =>
      evaluatePairedRendererExperiment({ reports, order, expectedCommit }),
    );
  }
  const incomplete = packet();
  incomplete.reports.pop();
  const partial = evaluatePairedRendererExperiment(incomplete);
  assert.equal(partial.status, 'partially-comparable');
  assert.equal(partial.comparisons['webgl-late'].status, 'comparable');
  assert.equal(partial.comparisons['driver-early'].status, 'incomparable');
  const reordered = packet({ order: 'AB' });
  reordered.reports.reverse();
  assert.throws(
    () => evaluatePairedRendererExperiment(reordered),
    /sequence prefix/,
  );
  const badProcessOrder = packet({ order: 'BA' });
  badProcessOrder.processResults.reverse();
  assert.throws(
    () => evaluatePairedRendererExperiment(badProcessOrder),
    /process results.*prefix/,
  );
  const browserMismatch = packet();
  browserMismatch.reports[1].report.browserVersion = 'Chrome/other';
  assert.equal(
    evaluatePairedRendererExperiment(browserMismatch).comparisons['webgl-late']
      .status,
    'incomparable',
  );
  const viewportMismatch = packet();
  viewportMismatch.reports[2].report.viewport.width += 1;
  assert.equal(
    evaluatePairedRendererExperiment(viewportMismatch).comparisons[
      'driver-early'
    ].status,
    'incomparable',
  );
  const duplicateRun = packet();
  duplicateRun.reports[2].report.rendererExperiment.runId = 'another-run';
  assert.equal(
    evaluatePairedRendererExperiment(duplicateRun).comparisons['driver-early']
      .status,
    'incomparable',
  );
});

function earlyProbePage(performanceStep = 5, topLevel = true) {
  let now = 0;
  let parameterCalls = 0;
  class Canvas {
    constructor(widget = true) {
      this.widget = widget;
      this.listeners = new Map();
    }
    closest(selector) {
      return selector === '.cesium-widget' && this.widget ? {} : null;
    }
    addEventListener(type, fn) {
      this.listeners.set(type, fn);
    }
    removeEventListener(type) {
      this.listeners.delete(type);
    }
  }
  const native = function (kind) {
    if (!/^webgl/.test(kind)) return null;
    return {
      RENDERER: 7937,
      VENDOR: 7936,
      LINK_STATUS: 35714,
      ACTIVE_UNIFORMS: 35718,
      ACTIVE_ATTRIBUTES: 35721,
      VALIDATE_STATUS: 35715,
      isContextLost: () => false,
      createProgram: () => ({}),
      linkProgram: () => undefined,
      getProgramParameter: () => true,
      deleteProgram: () => undefined,
      getContextAttributes: () => ({
        alpha: true,
        antialias: false,
        depth: true,
        failIfMajorPerformanceCaveat: false,
        powerPreference: 'default',
        premultipliedAlpha: true,
        preserveDrawingBuffer: true,
        stencil: false,
      }),
      getExtension: () => ({
        UNMASKED_RENDERER_WEBGL: 37446,
        UNMASKED_VENDOR_WEBGL: 37445,
      }),
      getParameter: (key) => {
        parameterCalls += 1;
        return key === 37445 || key === 7936
          ? 'Google Inc.'
          : 'Google SwiftShader';
      },
    };
  };
  Object.defineProperty(Canvas.prototype, 'getContext', {
    configurable: true,
    writable: true,
    value: native,
  });
  const window = {};
  window.top = topLevel ? window : {};
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
  const registeredScripts = new Set();
  const page = {
    isClosed: () => false,
    evaluateOnNewDocument: async (fn, ...args) => {
      evaluate(fn, ...args);
      registeredScripts.add('early-hook');
      return { identifier: 'early-hook' };
    },
    evaluate: async (fn, ...args) => evaluate(fn, ...args),
    removeScriptToEvaluateOnNewDocument: async (id) => {
      registeredScripts.delete(id);
    },
  };
  return {
    page,
    Canvas,
    native,
    window,
    registeredScripts,
    get parameterCalls() {
      return parameterCalls;
    },
  };
}

test('future-document registration removal leaves the current probe live and is not repeated', async () => {
  const probePage = earlyProbePage();
  const { page, Canvas, native, window } = probePage;
  const identifier = await installEarlyCesiumRendererProbe(page);
  let removals = 0;
  page.removeScriptToEvaluateOnNewDocument = async (id) => {
    assert.equal(id, identifier);
    removals += 1;
  };
  const currentDocumentHook = Canvas.prototype.getContext;
  assert.notEqual(currentDocumentHook, native);

  const registration =
    await removeEarlyCesiumRendererProbeRegistrationWithEvidence(
      page,
      identifier,
    );
  assert.equal(registration.confirmed, true);
  assert.equal(registration.currentDocumentUntouched, true);
  assert.equal(registration.scriptRegistration.status, 'confirmed');
  assert.equal(Canvas.prototype.getContext, currentDocumentHook);

  const canvas = new Canvas();
  const gl = canvas.getContext('webgl2');
  assert.equal(Canvas.prototype.getContext, native);
  assert.equal(canvas.listeners.size, 2);
  window.__godsEyeView = {
    viewer: { scene: { canvas, context: { _originalGLContext: gl } } },
  };
  const contextLost = canvas.listeners.get('webglcontextlost');
  contextLost();
  await assert.rejects(readEarlyCesiumRendererProbe(page), /lost or restored/);

  const finalCleanup = await cleanupEarlyCesiumRendererProbeWithEvidence(
    page,
    identifier,
  );
  assert.equal(finalCleanup.confirmed, true);
  assert.equal(finalCleanup.scriptRegistration.status, 'already-confirmed');
  assert.equal(removals, 1, 'the future-document registration is removed once');
  assert.equal(canvas.listeners.size, 0);
});

test('capture retirement keeps the registration through its single document lifetime', async () => {
  const probePage = earlyProbePage();
  const { page, Canvas, native, window } = probePage;
  window.__godsEyeView = { viewer: { useDefaultRenderLoop: true } };
  const identifier = await installEarlyCesiumRendererProbe(page);
  let removals = 0;
  const removeRegistration = page.removeScriptToEvaluateOnNewDocument;
  page.goto = async () => ({ status: 'domcontentloaded' });
  page.removeScriptToEvaluateOnNewDocument = async (removedIdentifier) => {
    assert.equal(removedIdentifier, identifier);
    assert.equal(window.__godsEyeView.viewer.useDefaultRenderLoop, false);
    assert.equal(Canvas.prototype.getContext, native);
    await removeRegistration(removedIdentifier);
    removals += 1;
  };

  await page.goto('https://fixture.invalid/');
  assert.equal(removals, 0, 'navigation completion does not remove the hook');
  assert.equal(probePage.registeredScripts.has(identifier), true);
  assert.notEqual(Canvas.prototype.getContext, native);

  const finalObservation = await page.evaluate(() => ({
    completed: true,
    renderLoopActive: window.__godsEyeView.viewer.useDefaultRenderLoop,
  }));
  assert.equal(finalObservation.completed, true);
  assert.equal(finalObservation.renderLoopActive, true);
  const retirement = await retireEarlyCesiumRendererProbeForCapturePage(
    page,
    identifier,
    1_000,
  );

  assert.equal(retirement.confirmed, true);
  assert.equal(retirement.document.renderLoopRetirement.confirmed, true);
  assert.equal(retirement.scriptRegistration.status, 'confirmed');
  assert.equal(removals, 1);
  assert.equal(probePage.registeredScripts.has(identifier), false);
});

test('early probe does not install in a subframe document', async () => {
  const probePage = earlyProbePage(5, false);
  const { page, Canvas, native, window } = probePage;
  const identifier = await installEarlyCesiumRendererProbe(page);

  assert.equal(identifier, 'early-hook');
  assert.equal(Canvas.prototype.getContext, native);
  assert.equal('__gevRecoveryEarlyRendererProbe' in window, false);
});

test('an explicitly retired document stops its public Cesium render loop in the existing cleanup evaluation', async () => {
  const probePage = earlyProbePage();
  const { page, window } = probePage;
  window.__godsEyeView = { viewer: { useDefaultRenderLoop: true } };
  await installEarlyCesiumRendererProbe(page);
  let evaluations = 0;
  const evaluate = page.evaluate;
  page.evaluate = (...args) => {
    evaluations += 1;
    return evaluate(...args);
  };

  const cleanup = await cleanupEarlyCesiumRendererProbeWithEvidence(
    page,
    null,
    1_000,
    { retireViewerRenderLoop: true },
  );

  assert.equal(cleanup.confirmed, true);
  assert.equal(window.__godsEyeView.viewer.useDefaultRenderLoop, false);
  assert.equal(cleanup.document.renderLoopRetirement.requested, true);
  assert.equal(cleanup.document.renderLoopRetirement.status, 'confirmed');
  assert.equal(cleanup.document.renderLoopRetirement.before, true);
  assert.equal(cleanup.document.renderLoopRetirement.after, false);
  assert.equal(cleanup.document.renderLoopRetirement.confirmed, true);
  assert.equal(
    Number.isFinite(
      cleanup.document.renderLoopRetirement.pageExecutionElapsedMs,
    ),
    true,
  );
  assert.equal(evaluations, 1, 'retirement adds no page-evaluation round trip');
});

test('ordinary cleanup leaves render scheduling unchanged unless retirement is requested', async () => {
  const probePage = earlyProbePage();
  probePage.window.__godsEyeView = {
    viewer: { useDefaultRenderLoop: true },
  };
  await installEarlyCesiumRendererProbe(probePage.page);

  const cleanup = await cleanupEarlyCesiumRendererProbeWithEvidence(
    probePage.page,
    null,
  );

  assert.equal(cleanup.confirmed, true);
  assert.equal(
    probePage.window.__godsEyeView.viewer.useDefaultRenderLoop,
    true,
  );
  assert.equal(cleanup.document.renderLoopRetirement, null);
});

test('retirement rejection fails cleanup with bounded explicit state', async () => {
  const probePage = earlyProbePage();
  let loopValue = true;
  probePage.window.__godsEyeView = {
    viewer: {
      get useDefaultRenderLoop() {
        return loopValue;
      },
      set useDefaultRenderLoop(_value) {
        throw new Error('private browser detail');
      },
    },
  };
  await installEarlyCesiumRendererProbe(probePage.page);

  const cleanup = await cleanupEarlyCesiumRendererProbeWithEvidence(
    probePage.page,
    null,
    1_000,
    { retireViewerRenderLoop: true },
  );

  assert.equal(cleanup.confirmed, false);
  assert.equal(cleanup.document.renderLoopRetirement.requested, true);
  assert.equal(
    cleanup.document.renderLoopRetirement.status,
    'viewer-render-loop-set-failed',
  );
  assert.equal(cleanup.document.renderLoopRetirement.before, true);
  assert.equal(cleanup.document.renderLoopRetirement.after, null);
  assert.equal(cleanup.document.renderLoopRetirement.confirmed, false);
  assert.equal(
    Number.isFinite(
      cleanup.document.renderLoopRetirement.pageExecutionElapsedMs,
    ),
    true,
  );
  assert.equal(
    JSON.stringify(cleanup).includes('private browser detail'),
    false,
  );
});

test('failed early registration removal is recorded and never retried at final cleanup', async () => {
  const probePage = earlyProbePage();
  const { page } = probePage;
  const identifier = await installEarlyCesiumRendererProbe(page);
  let removals = 0;
  page.removeScriptToEvaluateOnNewDocument = async () => {
    removals += 1;
    throw new Error('registration removal failed');
  };
  const registration =
    await removeEarlyCesiumRendererProbeRegistrationWithEvidence(
      page,
      identifier,
    );
  assert.equal(registration.confirmed, false);
  assert.equal(registration.scriptRegistration.status, 'error');
  assert.equal(
    registration.scriptRegistration.errorKind,
    'registration-removal-error',
  );
  const failureReport = createCaptureFailureReport({
    source: { appCommit: 'a'.repeat(40), harnessCommit: 'b'.repeat(40) },
    workload: { rendererProbeCleanup: [registration] },
    phase: 'main-navigation',
    error: new Error('future-document cleanup failed'),
  });
  assert.equal(
    failureReport.workload.rendererProbeCleanup[0].scriptRegistration.status,
    'error',
  );
  const finalCleanup = await cleanupEarlyCesiumRendererProbeWithEvidence(
    page,
    identifier,
  );
  assert.equal(finalCleanup.confirmed, false);
  assert.equal(finalCleanup.scriptRegistration.status, 'error');
  assert.equal(removals, 1);
});

test('late early-registration acknowledgement is reused without a duplicate removal', async () => {
  let finishRemoval;
  let removals = 0;
  const page = {
    isClosed: () => false,
    evaluate: async () => ({
      status: 'confirmed',
      statePresent: true,
      hookRestoreAttempted: true,
      hookRestored: true,
      listenerCount: 0,
      listenerRemovalAttemptedCount: 0,
      listenerRemovalConfirmedCount: 0,
      listenerRemovalFailedCount: 0,
      stateDeleted: true,
    }),
    removeScriptToEvaluateOnNewDocument: () => {
      removals += 1;
      return new Promise((resolve) => {
        finishRemoval = resolve;
      });
    },
  };
  const early = await removeEarlyCesiumRendererProbeRegistrationWithEvidence(
    page,
    'late-early-registration',
    5,
  );
  assert.equal(early.confirmed, false);
  assert.equal(early.scriptRegistration.status, 'timeout');

  await new Promise((resolve) => setTimeout(resolve, 20));
  const reusedWaiter =
    await removeEarlyCesiumRendererProbeRegistrationWithEvidence(
      page,
      'late-early-registration',
      5,
    );
  assert.equal(reusedWaiter.confirmed, false);
  assert.equal(reusedWaiter.scriptRegistration.status, 'timeout');

  await new Promise((resolve) => setTimeout(resolve, 30));
  finishRemoval();
  await new Promise((resolve) => setImmediate(resolve));

  const finalCleanupPromise = cleanupEarlyCesiumRendererProbeWithEvidence(
    page,
    'late-early-registration',
  );
  const finalCleanup = await finalCleanupPromise;
  assert.equal(finalCleanup.confirmed, true);
  assert.equal(finalCleanup.scriptRegistration.status, 'already-confirmed');
  assert.equal(early.scriptRegistration.lateCompletion, 'confirmed');
  assert.equal(reusedWaiter.scriptRegistration.lateCompletion, 'confirmed');
  assert.equal(
    Number.isFinite(early.scriptRegistration.lateHostReceiptElapsedMs),
    true,
  );
  assert.equal(
    Number.isFinite(reusedWaiter.scriptRegistration.lateHostReceiptElapsedMs),
    true,
  );
  assert.ok(early.scriptRegistration.lateHostReceiptElapsedMs >= 5);
  assert.ok(reusedWaiter.scriptRegistration.lateHostReceiptElapsedMs >= 5);
  assert.ok(
    early.scriptRegistration.lateHostReceiptElapsedMs -
      reusedWaiter.scriptRegistration.lateHostReceiptElapsedMs >=
      10,
  );
  assert.equal(removals, 1);
});

test('late registration-removal errors retain host receipt elapsed time and original timeout', async () => {
  const page = {
    removeScriptToEvaluateOnNewDocument: () =>
      new Promise((_, reject) => {
        setTimeout(() => reject(new Error('registration removal failed')), 20);
      }),
  };
  const evidence = await removeEarlyCesiumRendererProbeRegistrationWithEvidence(
    page,
    'late-error-registration',
    5,
  );

  assert.equal(evidence.confirmed, false);
  assert.equal(evidence.scriptRegistration.status, 'timeout');
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(evidence.scriptRegistration.lateCompletion, 'error');
  assert.equal(
    evidence.scriptRegistration.lateErrorKind,
    'registration-removal-error',
  );
  assert.ok(evidence.scriptRegistration.lateHostReceiptElapsedMs >= 15);
  const failureReport = createCaptureFailureReport({
    source: { appCommit: 'a'.repeat(40), harnessCommit: 'b'.repeat(40) },
    workload: { rendererProbeCleanup: [evidence] },
    phase: 'cleanup',
    error: new Error('registration removal timed out'),
  });
  assert.equal(
    failureReport.workload.rendererProbeCleanup[0].scriptRegistration
      .lateHostReceiptElapsedMs,
    evidence.scriptRegistration.lateHostReceiptElapsedMs,
  );
});

test('reinstalling in one Page invalidates prior registration acknowledgement', async () => {
  const probePage = earlyProbePage();
  const { page, Canvas, native } = probePage;
  let removals = 0;
  page.removeScriptToEvaluateOnNewDocument = async () => {
    removals += 1;
  };

  const firstIdentifier = await installEarlyCesiumRendererProbe(page);
  new Canvas().getContext('webgl2');
  const firstRemoval =
    await removeEarlyCesiumRendererProbeRegistrationWithEvidence(
      page,
      firstIdentifier,
    );
  assert.equal(firstRemoval.confirmed, true);
  assert.equal(removals, 1);

  const secondIdentifier = await installEarlyCesiumRendererProbe(page);
  assert.equal(secondIdentifier, firstIdentifier);
  const secondHook = Canvas.prototype.getContext;
  assert.notEqual(secondHook, native);
  const secondRemoval =
    await removeEarlyCesiumRendererProbeRegistrationWithEvidence(
      page,
      secondIdentifier,
    );
  assert.equal(secondRemoval.confirmed, true);
  assert.equal(secondRemoval.scriptRegistration.status, 'confirmed');
  assert.equal(Canvas.prototype.getContext, secondHook);
  assert.equal(removals, 2);
});

test('early probe preserves native getContext and captures identity once before scene observation', async () => {
  const probePage = earlyProbePage();
  const { page, Canvas, native, window } = probePage;
  await installEarlyCesiumRendererProbe(page);
  const canvas = new Canvas();
  const gl = canvas.getContext('webgl2', { alpha: false });
  assert.equal(probePage.parameterCalls, 2);
  assert.equal(gl.getParameter(7937), 'Google SwiftShader');
  assert.equal(
    Canvas.prototype.getContext,
    native,
    'wrapper restores after first real Cesium context',
  );
  window.__godsEyeView = {
    viewer: { scene: { canvas, context: { _originalGLContext: gl } } },
  };
  const result = await readEarlyCesiumRendererProbe(page);
  assert.equal(
    probePage.parameterCalls,
    3,
    'the later explicit test query is the only additional GL query',
  );
  assert.equal(result.renderer, 'Google SwiftShader');
  assert.equal(result.vendor, 'Google Inc.');
  assert.equal(result.parameterQueryCount, 2);
  assert.equal(result.contextAttributes.antialias, false);
  assert.equal(result.canvasMatchesScene, true);
  assert.equal(result.contextMatchesScene, true);
  assert.equal(await cleanupEarlyCesiumRendererProbe(page, 'early-hook'), true);
  assert.equal(window.__gevRecoveryEarlyRendererProbe, undefined);
});

test('early probe cleanup reports an unconfirmed timeout instead of success', async () => {
  const page = {
    isClosed: () => false,
    evaluate: () => new Promise(() => {}),
  };
  assert.equal(await cleanupEarlyCesiumRendererProbe(page, null, 5), false);
});

test('cleanup evidence verifies the live hook and listeners plus registration acknowledgement', async () => {
  const probePage = earlyProbePage();
  const { page, Canvas, native, window } = probePage;
  await installEarlyCesiumRendererProbe(page);
  const canvas = new Canvas();
  canvas.getContext('webgl2');
  assert.equal(canvas.listeners.size, 2);
  let removedIdentifier = null;
  const order = [];
  const nativeEvaluate = page.evaluate;
  page.evaluate = async (...args) => {
    order.push('document');
    return nativeEvaluate(...args);
  };
  page.removeScriptToEvaluateOnNewDocument = async (identifier) => {
    order.push('registration');
    removedIdentifier = identifier;
  };

  const evidence = await cleanupEarlyCesiumRendererProbeWithEvidence(
    page,
    'early-hook',
  );
  assert.equal(evidence.confirmed, true);
  assert.equal(evidence.document.status, 'confirmed');
  assert.equal(evidence.document.hookRestored, true);
  assert.equal(evidence.document.listenerCount, 2);
  assert.equal(evidence.document.listenerRemovalAttemptedCount, 2);
  assert.equal(evidence.document.listenerRemovalConfirmedCount, 2);
  assert.equal(evidence.document.listenerRemovalFailedCount, 0);
  assert.equal(evidence.document.stateDeleted, true);
  assert.equal(evidence.scriptRegistration.status, 'confirmed');
  assert.match(evidence.scriptRegistration.verification, /acknowledged/);
  assert.equal(removedIdentifier, 'early-hook');
  assert.deepEqual(order, ['document', 'registration']);
  assert.equal(Canvas.prototype.getContext, native);
  assert.equal(canvas.listeners.size, 0);
  assert.equal(window.__gevRecoveryEarlyRendererProbe, undefined);
});

test('document and future-registration cleanup failures remain separately attributed', async () => {
  const documentFailure = await cleanupEarlyCesiumRendererProbeWithEvidence(
    {
      isClosed: () => false,
      evaluate: async () => {
        throw new Error(
          'Evaluation failed at /Users/example/app token=topsecret Authorization: Basic Zm9vOmJhcg==',
        );
      },
      removeScriptToEvaluateOnNewDocument: async () => {},
    },
    'script-id',
  );
  assert.equal(documentFailure.confirmed, false);
  assert.equal(documentFailure.document.status, 'error');
  assert.equal(documentFailure.document.errorKind, 'page-evaluation-error');
  assert.equal(documentFailure.scriptRegistration.status, 'not-attempted');
  assert.match(documentFailure.document.errorDetail, /Evaluation failed/);
  assert.equal(
    JSON.stringify(documentFailure).includes('/Users/example'),
    false,
  );
  assert.equal(JSON.stringify(documentFailure).includes('topsecret'), false);
  assert.equal(JSON.stringify(documentFailure).includes('Zm9vOmJhcg'), false);

  const registrationFailure = await cleanupEarlyCesiumRendererProbeWithEvidence(
    {
      isClosed: () => false,
      evaluate: async () => ({
        status: 'confirmed',
        statePresent: true,
        hookRestoreAttempted: true,
        hookRestored: true,
        listenerCount: 0,
        listenerRemovalAttemptedCount: 0,
        listenerRemovalConfirmedCount: 0,
        listenerRemovalFailedCount: 0,
        stateDeleted: true,
      }),
      removeScriptToEvaluateOnNewDocument: async () => {
        throw Object.assign(new Error('protocol internals'), {
          name: 'TargetClosedError',
        });
      },
    },
    'script-id',
  );
  assert.equal(registrationFailure.confirmed, false);
  assert.equal(registrationFailure.document.status, 'confirmed');
  assert.equal(registrationFailure.scriptRegistration.status, 'error');
  assert.equal(
    registrationFailure.scriptRegistration.errorKind,
    'target-closed',
  );
  assert.equal(
    registrationFailure.scriptRegistration.errorDetail,
    'protocol internals',
  );
  const missingRegistration = await cleanupEarlyCesiumRendererProbeWithEvidence(
    {
      isClosed: () => true,
      removeScriptToEvaluateOnNewDocument: async () => {
        throw new Error('Script with given identifier 17 not found');
      },
    },
    'missing-id',
  );
  assert.equal(missingRegistration.document.status, 'page-closed');
  assert.equal(missingRegistration.scriptRegistration.status, 'error');
  assert.equal(
    missingRegistration.scriptRegistration.errorKind,
    'unknown-script-registration',
  );
  assert.match(
    missingRegistration.scriptRegistration.errorDetail,
    /identifier/,
  );
});

test('a fresh installation in the same Page is cleaned instead of reusing prior-document proof', async () => {
  const probePage = earlyProbePage();
  await installEarlyCesiumRendererProbe(probePage.page);
  const firstCanvas = new probePage.Canvas();
  firstCanvas.getContext('webgl2');
  const first = await cleanupEarlyCesiumRendererProbeWithEvidence(
    probePage.page,
    'first-script',
  );
  assert.equal(first.confirmed, true);

  await installEarlyCesiumRendererProbe(probePage.page);
  const secondCanvas = new probePage.Canvas();
  secondCanvas.getContext('webgl2');
  const second = await cleanupEarlyCesiumRendererProbeWithEvidence(
    probePage.page,
    'second-script',
  );
  assert.equal(second.confirmed, true);
  assert.equal(second.document.status, 'confirmed');
  assert.equal(second.document.statePresent, true);
  assert.equal(second.document.listenerRemovalAttemptedCount, 2);
  assert.equal(secondCanvas.listeners.size, 0);
});

test('cleanup timeout preserves separate stages and records late completion', async () => {
  let finishDocument;
  let documentCleaned = false;
  const page = {
    isClosed: () => false,
    evaluate: () => {
      if (documentCleaned)
        return Promise.resolve({
          status: 'already-confirmed',
          statePresent: false,
          hookRestored: true,
          stateDeleted: true,
        });
      return new Promise((resolve) => {
        finishDocument = (result) => {
          documentCleaned = true;
          resolve(result);
        };
      });
    },
    removeScriptToEvaluateOnNewDocument: async () => {},
  };
  const evidence = await cleanupEarlyCesiumRendererProbeWithEvidence(
    page,
    null,
    5,
  );
  assert.equal(evidence.confirmed, false);
  assert.equal(evidence.document.status, 'timeout');
  assert.equal(evidence.scriptRegistration.status, 'not-registered');
  assert.equal(evidence.document.errorKind, 'operation-timeout');
  assert.equal(evidence.document.lateCompletion, 'pending');
  finishDocument({
    status: 'confirmed',
    pageExecutionElapsedMs: 6.25,
    statePresent: true,
    hookRestoreAttempted: true,
    hookRestored: true,
    listenerCount: 0,
    listenerRemovalAttemptedCount: 0,
    listenerRemovalConfirmedCount: 0,
    listenerRemovalFailedCount: 0,
    stateDeleted: true,
    errorKind: null,
    debugUrl: 'https://user:secret@example.test/token/SECRET',
    authorization: 'Bearer secret-token',
    oversized: 'x'.repeat(100_000),
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(evidence.document.status, 'timeout');
  assert.equal(evidence.document.lateCompletion, 'confirmed');
  assert.equal(evidence.confirmed, false);
  assert.equal(evidence.document.errorKind, 'operation-timeout');
  assert.equal(evidence.document.lateHostReceiptElapsedMs > 0, true);
  assert.deepEqual(evidence.document.lateOutcome, {
    status: 'confirmed',
    pageExecutionElapsedMs: 6.25,
    statePresent: true,
    hookRestoreAttempted: true,
    hookRestored: true,
    listenerCount: 0,
    listenerRemovalAttemptedCount: 0,
    listenerRemovalConfirmedCount: 0,
    listenerRemovalFailedCount: 0,
    stateDeleted: true,
    renderLoopRetirement: null,
    errorKind: null,
  });
  assert.equal(JSON.stringify(evidence).length < 2_000, true);
  assert.doesNotMatch(
    JSON.stringify(evidence),
    /secret|example\.test|oversized/,
  );
  const failure = createCaptureFailureReport({
    source: { appCommit: 'a'.repeat(40), harnessCommit: 'b'.repeat(40) },
    workload: { rendererProbeCleanup: [evidence] },
    phase: 'cleanup',
    error: new Error('cleanup timed out'),
  });
  assert.deepEqual(
    failure.workload.rendererProbeCleanup[0].document.lateOutcome,
    evidence.document.lateOutcome,
  );
  assert.equal(
    failure.workload.rendererProbeCleanup[0].document.status,
    'timeout',
  );
  const retry = await cleanupEarlyCesiumRendererProbeWithEvidence(
    page,
    'script-id',
  );
  assert.equal(retry.confirmed, true);
  assert.equal(retry.document.status, 'already-confirmed');
  assert.equal(retry.scriptRegistration.status, 'confirmed');

  let finishRegistration;
  const registrationPage = {
    isClosed: () => false,
    evaluate: async () => ({
      status: 'confirmed',
      statePresent: true,
      hookRestoreAttempted: true,
      hookRestored: true,
      listenerCount: 0,
      listenerRemovalAttemptedCount: 0,
      listenerRemovalConfirmedCount: 0,
      listenerRemovalFailedCount: 0,
      stateDeleted: true,
    }),
    removeScriptToEvaluateOnNewDocument: () =>
      new Promise((resolve) => {
        finishRegistration = resolve;
      }),
  };
  const registrationEvidence =
    await cleanupEarlyCesiumRendererProbeWithEvidence(
      registrationPage,
      'registration-id',
      5,
    );
  assert.equal(registrationEvidence.document.status, 'confirmed');
  assert.equal(registrationEvidence.scriptRegistration.status, 'timeout');
  assert.equal(
    registrationEvidence.scriptRegistration.lateCompletion,
    'pending',
  );
  finishRegistration();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(registrationEvidence.scriptRegistration.status, 'timeout');
  assert.equal(
    registrationEvidence.scriptRegistration.lateCompletion,
    'confirmed',
  );
  const registrationRetry = await cleanupEarlyCesiumRendererProbeWithEvidence(
    registrationPage,
    'registration-id',
  );
  assert.equal(registrationRetry.confirmed, true);
  assert.equal(
    registrationRetry.scriptRegistration.status,
    'already-confirmed',
  );

  let rejectLateRemoval;
  const lateErrorPage = {
    isClosed: () => false,
    evaluate: async () => ({
      status: 'confirmed',
      statePresent: true,
      hookRestoreAttempted: true,
      hookRestored: true,
      listenerCount: 0,
      listenerRemovalAttemptedCount: 0,
      listenerRemovalConfirmedCount: 0,
      listenerRemovalFailedCount: 0,
      stateDeleted: true,
    }),
    removeScriptToEvaluateOnNewDocument: () =>
      new Promise((_, reject) => {
        rejectLateRemoval = reject;
      }),
  };
  const lateError = await cleanupEarlyCesiumRendererProbeWithEvidence(
    lateErrorPage,
    'late-error-id',
    5,
  );
  rejectLateRemoval(new Error('Script identifier was not found'));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(lateError.scriptRegistration.status, 'timeout');
  assert.equal(lateError.scriptRegistration.lateCompletion, 'error');
  assert.equal(
    lateError.scriptRegistration.lateErrorKind,
    'unknown-script-registration',
  );
});

test('cleanup attempts every owned listener and bounded failure reports retain stage evidence', async () => {
  const probePage = earlyProbePage();
  await installEarlyCesiumRendererProbe(probePage.page);
  const canvas = new probePage.Canvas();
  canvas.getContext('webgl2');
  const nativeRemove = canvas.removeEventListener.bind(canvas);
  canvas.removeEventListener = (event, listener) => {
    if (event === 'webglcontextlost') throw new Error('remove failed');
    nativeRemove(event, listener);
  };
  const cleanup = await cleanupEarlyCesiumRendererProbeWithEvidence(
    probePage.page,
    'early-hook',
  );
  assert.equal(cleanup.confirmed, false);
  assert.equal(cleanup.document.hookRestored, true);
  assert.equal(cleanup.document.listenerRemovalAttemptedCount, 2);
  assert.equal(cleanup.document.listenerRemovalConfirmedCount, 1);
  assert.equal(cleanup.document.listenerRemovalFailedCount, 1);
  assert.equal(cleanup.document.errorKind, 'listener-removal-unconfirmed');
  assert.equal(cleanup.document.stateDeleted, false);

  const report = createCaptureFailureReport({
    source: { appCommit: 'a'.repeat(40), harnessCommit: 'b'.repeat(40) },
    workload: { rendererProbeCleanup: [cleanup] },
    phase: 'cleanup',
    error: new Error('renderer cleanup failed'),
  });
  const evidence = report.workload.rendererProbeCleanup[0];
  assert.equal(evidence.document.listenerRemovalFailedCount, 1);
  assert.equal(evidence.scriptRegistration.status, 'confirmed');
  assert.equal(JSON.stringify(report).includes('remove failed'), false);
});

test('late page cleanup retains bounded page timing without converting the host timeout', async () => {
  const probe = earlyProbePage(1);
  await installEarlyCesiumRendererProbe(probe.page);
  const canvas = new probe.Canvas();
  const context = canvas.getContext('webgl2');
  const evaluate = probe.page.evaluate;
  let releaseAcknowledgement;
  let pageOutcome;
  probe.page.evaluate = (...args) =>
    new Promise((resolve, reject) => {
      evaluate(...args).then((result) => {
        pageOutcome = result;
        releaseAcknowledgement = () => resolve(result);
      }, reject);
    });

  const cleanup = await cleanupEarlyCesiumRendererProbeWithEvidence(
    probe.page,
    null,
    5,
  );
  assert.equal(cleanup.confirmed, false);
  assert.equal(cleanup.document.status, 'timeout');
  assert.equal(cleanup.document.errorKind, 'operation-timeout');
  assert.equal(cleanup.document.lateCompletion, 'pending');
  assert.equal(typeof releaseAcknowledgement, 'function');
  // Timeout and late receipt are both measured from the page-evaluation stage
  // start, so compare them directly instead of comparing the receipt to the
  // overall cleanup timeout (which starts slightly earlier).
  assert.match(
    cleanup.document.lateHostReceiptScope,
    /stage start to acknowledgement receipt/,
  );
  releaseAcknowledgement();
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(pageOutcome.status, 'confirmed');
  assert.equal(
    Number.isFinite(pageOutcome.pageExecutionElapsedMs) &&
      pageOutcome.pageExecutionElapsedMs >= 0,
    true,
  );
  assert.equal(cleanup.document.status, 'timeout');
  assert.equal(cleanup.confirmed, false);
  assert.equal(cleanup.document.lateCompletion, 'confirmed');
  assert.equal(
    cleanup.document.lateOutcome.pageExecutionElapsedMs,
    pageOutcome.pageExecutionElapsedMs,
  );
  const hasLateReceiptAfterTimeout = (stage) =>
    stage?.status === 'timeout' &&
    Number.isFinite(stage.elapsedMs) &&
    stage.elapsedMs >= 0 &&
    Number.isFinite(stage.lateHostReceiptElapsedMs) &&
    stage.lateHostReceiptElapsedMs >= stage.elapsedMs;
  assert.equal(hasLateReceiptAfterTimeout(cleanup.document), true);
  assert.equal(
    hasLateReceiptAfterTimeout({
      ...cleanup.document,
      lateHostReceiptElapsedMs: null,
    }),
    false,
  );
  assert.equal(
    hasLateReceiptAfterTimeout({
      ...cleanup.document,
      lateHostReceiptElapsedMs: 0,
    }),
    false,
  );
  assert.equal(
    hasLateReceiptAfterTimeout({
      ...cleanup.document,
      lateHostReceiptElapsedMs: Math.max(0, cleanup.document.elapsedMs - 0.001),
    }),
    false,
  );
  assert.equal(cleanup.document.lateOutcome.listenerCount, 2);
  assert.equal(cleanup.document.lateOutcome.listenerRemovalAttemptedCount, 2);
  assert.equal(cleanup.document.lateOutcome.listenerRemovalConfirmedCount, 2);
  assert.equal(cleanup.document.lateOutcome.stateDeleted, true);
  assert.equal(Object.keys(cleanup.document.lateOutcome).length, 12);
  assert.equal(JSON.stringify(cleanup).length < 2_000, true);
});

test('late retirement acknowledgement remains a timeout but retains its bounded state', async () => {
  const probe = earlyProbePage(1);
  probe.window.__godsEyeView = { viewer: { useDefaultRenderLoop: true } };
  await installEarlyCesiumRendererProbe(probe.page);
  const evaluate = probe.page.evaluate;
  let releaseAcknowledgement;
  let pageOutcome;
  probe.page.evaluate = (...args) =>
    new Promise((resolve, reject) => {
      evaluate(...args).then((result) => {
        pageOutcome = result;
        releaseAcknowledgement = () => resolve(result);
      }, reject);
    });

  const cleanup = await cleanupEarlyCesiumRendererProbeWithEvidence(
    probe.page,
    null,
    5,
    { retireViewerRenderLoop: true },
  );
  assert.equal(cleanup.confirmed, false);
  assert.equal(cleanup.document.status, 'timeout');
  releaseAcknowledgement();
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(pageOutcome.renderLoopRetirement.confirmed, true);
  assert.equal(cleanup.confirmed, false);
  assert.equal(cleanup.document.status, 'timeout');
  assert.equal(
    cleanup.document.lateOutcome.renderLoopRetirement.confirmed,
    true,
  );
});

test('shader attribution timeout keeps its original failure and late snapshot', async (t) => {
  const probe = earlyProbePage(1);
  await installEarlyCesiumRendererProbe(probe.page, {
    shaderProgramAttribution: true,
  });
  const context = new probe.Canvas().getContext('webgl2');
  const program = context.createProgram();
  context.linkProgram(program);
  context.getProgramParameter(program, context.LINK_STATUS);
  const evaluate = probe.page.evaluate;
  let releaseAcknowledgement;
  probe.page.evaluate = (...args) =>
    new Promise((resolve, reject) => {
      evaluate(...args).then((result) => {
        releaseAcknowledgement = () => resolve(result);
      }, reject);
    });

  const cleanup = await cleanupEarlyCesiumRendererProbeWithEvidence(
    probe.page,
    null,
    5,
    { requireShaderProgramAttribution: true },
  );
  assert.equal(cleanup.document.status, 'timeout');
  assert.equal(cleanup.document.errorKind, 'operation-timeout');
  assert.equal(cleanup.confirmed, false);
  assert.equal(typeof releaseAcknowledgement, 'function');

  const directory = await mkdtemp(
    path.join(await realpath(os.tmpdir()), 'gev-shader-late-checkpoint-'),
  );
  t.after(async () => rm(directory, { recursive: true, force: true }));
  const sourcePath = path.join(
    directory,
    'capture.shader-program-attribution.json',
  );
  const artifactPath = path.join(
    directory,
    'smoke.shader-program-attribution.json',
  );
  const row = {
    phase: 'measurement-boundary-cleanup',
    documentRole: 'provider-idle-1',
    documentId: 'timeout-document-1',
    confirmed: cleanup.confirmed,
    document: cleanup.document,
  };
  const attributionProvenance = {
    appSha: 'a'.repeat(40),
    harnessSha: 'b'.repeat(40),
    receiptSha256: 'c'.repeat(64),
  };
  const beforeLate = await persistShaderProgramAttributionCheckpoint({
    checkpointPath: sourcePath,
    cleanupRows: [row],
    expectedDocumentCount: 1,
    provenance: attributionProvenance,
  });
  assert.equal(beforeLate.checkpoint.status, 'partial');
  assert.equal(beforeLate.checkpoint.documents[0].lateAttribution, null);
  assert.equal(cleanup.document.status, 'timeout');
  assert.equal(cleanup.confirmed, false);

  releaseAcknowledgement();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(cleanup.document.status, 'timeout');
  assert.equal(cleanup.confirmed, false);
  assert.equal(cleanup.document.lateCompletion, 'confirmed');
  assert.equal(
    cleanup.document.lateOutcome.shaderProgramAttribution.status,
    'complete',
  );
  assert.equal(
    cleanup.document.lateOutcome.shaderProgramAttribution.cleanup.confirmed,
    true,
  );

  const afterLate = await persistShaderProgramAttributionCheckpoint({
    checkpointPath: sourcePath,
    cleanupRows: [row],
    expectedDocumentCount: 1,
    provenance: attributionProvenance,
  });
  assert.equal(afterLate.checkpoint.status, 'partial');
  assert.equal(
    afterLate.checkpoint.documents[0].lateOutcomeStatus,
    'confirmed',
  );
  const ingested = await preserveShaderProgramAttributionArtifact(
    sourcePath,
    `${sourcePath}.ref.json`,
    artifactPath,
    attributionProvenance,
  );
  assert.equal(ingested.artifact.status, 'preserved');
  const document = ingested.checkpoint.documents[0];
  assert.equal(document.status, 'unavailable');
  assert.equal(document.outerCleanupConfirmed, false);
  assert.equal(document.cleanupConfirmed, false);
  assert.equal(document.lateOutcomeStatus, 'confirmed');
  assert.equal(
    document.lateAttribution.programs[0].parameterNames[0].name,
    'LINK_STATUS',
  );
  const originalFailure = createCaptureFailureReport({
    source: {
      appCommit: attributionProvenance.appSha,
      harnessCommit: attributionProvenance.harnessSha,
    },
    fixture: null,
    workload: { rendererProbeCleanup: [row] },
    phase: 'outer-timeout',
    error: new Error('outer timeout'),
  });
  assert.equal(originalFailure.failure.phase, 'outer-timeout');
  assert.equal(
    originalFailure.workload.rendererProbeCleanup[0].document.status,
    'timeout',
  );
});

test('shader envelope preserves unavailable and malformed observer evidence', () => {
  const cleanup = {
    schema: 'gev-early-renderer-probe-cleanup/v1',
    confirmed: false,
    documentRole: 'provider-idle-1',
    documentId: 'document-1',
    document: {
      shaderProgramAttribution: {
        schema: 'gev-shader-program-lifecycle/v1',
        status: 'unavailable',
        error: 'method-install-failed',
        cleanup: {
          confirmed: true,
          requestedMethodCount: 4,
          installedMethodCount: 2,
          restoredMethodCount: 2,
          changedOwnerCount: 0,
        },
        ownerChanged: false,
      },
    },
  };
  const unavailable = createShaderProgramAttributionEnvelope([cleanup], 1);
  assert.equal(unavailable.status, 'incomplete');
  assert.equal(unavailable.documents[0].status, 'unavailable');
  assert.equal(unavailable.documents[0].trackedProgramCount, null);
  assert.equal(unavailable.documents[0].limits, null);
  assert.equal(unavailable.documents[0].cleanupConfirmed, false);

  cleanup.document.shaderProgramAttribution = null;
  const malformed = createShaderProgramAttributionEnvelope([cleanup], 1);
  assert.equal(malformed.status, 'incomplete');
  assert.equal(malformed.documents.length, 0);

  cleanup.document.shaderProgramAttribution = {
    schema: 'gev-shader-program-lifecycle/v1',
    status: 'truncated',
    cleanup: { confirmed: true },
  };
  const truncated = createShaderProgramAttributionEnvelope([cleanup], 1);
  assert.equal(truncated.status, 'incomplete');
  assert.equal(truncated.documents[0].status, 'unavailable');
  assert.equal(truncated.documents[0].trackedProgramCount, null);
});

test('late document errors discard untrusted status and error fields after timeout', async () => {
  for (const status of ['error', 'invalid status with secret']) {
    let finishEvaluation;
    const page = {
      isClosed: () => false,
      evaluate: () =>
        new Promise((resolve) => {
          finishEvaluation = resolve;
        }),
    };
    const cleanup = await cleanupEarlyCesiumRendererProbeWithEvidence(
      page,
      null,
      5,
    );
    assert.equal(cleanup.document.status, 'timeout');
    assert.equal(cleanup.confirmed, false);
    finishEvaluation({
      status,
      pageExecutionElapsedMs: 4,
      statePresent: true,
      hookRestoreAttempted: true,
      hookRestored: false,
      listenerCount: 1,
      listenerRemovalAttemptedCount: 1,
      listenerRemovalConfirmedCount: 0,
      listenerRemovalFailedCount: 1,
      stateDeleted: false,
      errorKind: `Authorization: Basic ${'credential'.repeat(5000)}`,
      errorDetail: 'C:/Users/private/token=very-secret',
      url: 'https://example.test/private?token=secret',
      oversized: 'x'.repeat(100_000),
    });
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(cleanup.document.status, 'timeout');
    assert.equal(cleanup.document.errorKind, 'operation-timeout');
    assert.equal(cleanup.confirmed, false);
    assert.equal(
      cleanup.document.lateCompletion,
      status === 'error' ? 'error' : 'invalid-result',
    );
    assert.equal(
      cleanup.document.lateErrorKind,
      status === 'error'
        ? 'cleanup-incomplete'
        : 'invalid-late-document-result',
    );
    assert.equal(cleanup.document.lateErrorDetail, null);
    assert.equal(cleanup.document.lateOutcome?.errorKind ?? null, null);
    assert.equal(JSON.stringify(cleanup).length < 2_000, true);
    assert.doesNotMatch(
      JSON.stringify(cleanup),
      /credential|private|very-secret|example\.test|oversized|Authorization/,
    );
  }
});

test('early probe ignores non-Cesium canvases and rejects missing, replaced, or lost contexts', async () => {
  const missing = earlyProbePage();
  await installEarlyCesiumRendererProbe(missing.page);
  new missing.Canvas(false).getContext('webgl2');
  assert.equal(
    await missing.page.evaluate(
      (key) => window[key]?.captured,
      '__gevRecoveryEarlyRendererProbe',
    ),
    false,
  );
  await assert.rejects(
    readEarlyCesiumRendererProbe(missing.page),
    /not captured/,
  );

  const replaced = earlyProbePage();
  await installEarlyCesiumRendererProbe(replaced.page);
  const canvas = new replaced.Canvas();
  const gl = canvas.getContext('webgl2');
  replaced.window.__godsEyeView = {
    viewer: { scene: { canvas, context: { _originalGLContext: {} } } },
  };
  await assert.rejects(
    readEarlyCesiumRendererProbe(replaced.page),
    /does not match Cesium/,
  );

  const lost = earlyProbePage();
  await installEarlyCesiumRendererProbe(lost.page);
  const lostCanvas = new lost.Canvas();
  lostCanvas.getContext('webgl2');
  lostCanvas.listeners.get('webglcontextlost')({ preventDefault() {} });
  lost.window.__godsEyeView = {
    viewer: {
      scene: {
        canvas: lostCanvas,
        context: {
          _originalGLContext:
            lost.window.__gevRecoveryEarlyRendererProbe.context,
        },
      },
    },
  };
  await assert.rejects(
    readEarlyCesiumRendererProbe(lost.page),
    /lost or restored/,
  );
});

test('early probe accepts a valid zero-duration clock sample', async () => {
  const { page, Canvas, window } = earlyProbePage(0);
  await installEarlyCesiumRendererProbe(page);
  const canvas = new Canvas();
  const gl = canvas.getContext('webgl2');
  window.__godsEyeView = {
    viewer: { scene: { canvas, context: { _originalGLContext: gl } } },
  };
  const result = await readEarlyCesiumRendererProbe(page);
  assert.equal(result.queryDurationMs, 0);
});

test('shader lifecycle hook preserves GL calls and reports bounded program history', () => {
  const listeners = new Map();
  class Canvas {
    closest(selector) {
      return selector === '.cesium-widget' ? {} : null;
    }
    addEventListener(name, listener) {
      listeners.set(name, listener);
    }
  }
  const callLog = [];
  const program = {};
  const nullProgram = {};
  const context = {
    LINK_STATUS: 35714,
    ACTIVE_UNIFORMS: 35718,
    ACTIVE_ATTRIBUTES: 35721,
    VALIDATE_STATUS: 35715,
    getContextAttributes() {
      return { alpha: false, antialias: true };
    },
    getExtension() {
      return null;
    },
    getParameter() {
      return 'test';
    },
    createProgram(...args) {
      callLog.push(['createProgram', args, this]);
      return program;
    },
    linkProgram(...args) {
      callLog.push(['linkProgram', args, this]);
      return undefined;
    },
    getProgramParameter(...args) {
      callLog.push(['getProgramParameter', args, this]);
      if (args[1] === 'throw-null') throw null;
      if (args[1] === context.LINK_STATUS) return true;
      if (args[1] === context.ACTIVE_UNIFORMS) return 4;
      return nullProgram;
    },
    deleteProgram(...args) {
      callLog.push(['deleteProgram', args, this]);
      return undefined;
    },
  };
  const originalMethods = Object.fromEntries(
    [
      'createProgram',
      'linkProgram',
      'getProgramParameter',
      'deleteProgram',
    ].map((name) => [name, context[name]]),
  );
  class HTMLCanvasElement extends Canvas {
    getContext(kind) {
      assert.equal(this, canvas);
      return kind === 'webgl2' ? context : null;
    }
  }
  const canvas = new HTMLCanvasElement();
  const window = {};
  window.top = window;
  const sandbox = {
    window,
    HTMLCanvasElement,
    performance: { now: () => 10 },
    Map,
    WeakMap,
    Object,
    Number,
    Array,
    String,
    Boolean,
    Math,
    Reflect,
    Error,
  };
  vm.runInNewContext(
    `(${earlyRendererDocumentHook.toString()})("proof", true)`,
    sandbox,
  );
  canvas.getContext('webgl2');
  assert.equal(callLog.length, 0);
  const created = context.createProgram('arg');
  context.linkProgram(created, 'link-arg');
  assert.equal(context.getProgramParameter(created, context.LINK_STATUS), true);
  assert.equal(
    context.getProgramParameter(created, context.ACTIVE_UNIFORMS),
    4,
  );
  assert.equal(
    context.getProgramParameter(created, context.ACTIVE_UNIFORMS),
    4,
  );
  assert.equal(context.getProgramParameter(created, 12345), nullProgram);
  context.linkProgram(created, 'second-link');
  assert.equal(context.getProgramParameter(created, context.LINK_STATUS), true);
  const foreignReceiver = {};
  assert.equal(
    context.getProgramParameter.call(
      foreignReceiver,
      created,
      context.LINK_STATUS,
    ),
    true,
  );
  let didThrow = false;
  let thrown;
  try {
    context.getProgramParameter(created, 'throw-null');
  } catch (error) {
    didThrow = true;
    thrown = error;
  }
  assert.equal(didThrow, true);
  assert.equal(thrown, null);
  context.deleteProgram(created);
  assert.deepEqual(
    callLog.map(([name]) => name),
    [
      'createProgram',
      'linkProgram',
      'getProgramParameter',
      'getProgramParameter',
      'getProgramParameter',
      'getProgramParameter',
      'linkProgram',
      'getProgramParameter',
      'getProgramParameter',
      'getProgramParameter',
      'deleteProgram',
    ],
  );
  const observer =
    window.__gevRecoveryEarlyRendererProbe.shaderProgramAttribution;
  assert.ok(observer);
  const retainedWrapper = context.getProgramParameter;
  const snapshot = observer.snapshotAndDispose();
  assert.equal(snapshot.status, 'complete');
  assert.equal(snapshot.totals.getProgramParameter.calls, 6);
  assert.equal(snapshot.totals.getProgramParameter.errors, 1);
  assert.equal(snapshot.programs.length, 1);
  assert.equal(snapshot.programs[0].linkCalls, 2);
  assert.equal(
    JSON.stringify(
      snapshot.programs[0].parameterNames.map((row) => [row.name, row.calls]),
    ),
    JSON.stringify([
      ['LINK_STATUS', 2],
      ['ACTIVE_UNIFORMS', 2],
      ['other', 1],
      ['other', 1],
    ]),
  );
  assert.equal(snapshot.programs[0].parameterNames[0].linkCallBeforeQuery, 2);
  assert.equal(
    snapshot.programs[0].parameterNames[0].linkConfirmedBeforeQuery,
    0,
  );
  assert.equal(
    snapshot.programs[0].parameterNames[1].linkConfirmedBeforeQuery,
    2,
  );
  assert.equal(snapshot.programs[0].parameterNames[1].firstQueries, 1);
  assert.equal(snapshot.programs[0].parameterNames[1].repeatedQueries, 1);
  assert.equal(snapshot.cleanup.confirmed, true);
  assert.equal(snapshot.cleanup.restoredMethodCount, 4);
  for (const name of Object.keys(originalMethods))
    assert.equal(context[name], originalMethods[name]);
  assert.equal(
    retainedWrapper.call(context, created, context.LINK_STATUS),
    true,
  );
  assert.equal(snapshot.totals.getProgramParameter.calls, 6);
  assert.equal(callLog[8][2], foreignReceiver);
  assert.equal(callLog.length, 12);
  for (const invalid of [
    { limits: null },
    { totals: null },
    { totals: [] },
    {},
  ]) {
    assert.doesNotThrow(() => boundedShaderProgramAttribution(invalid));
    assert.equal(boundedShaderProgramAttribution(invalid), null);
  }
  assert.equal(boundedShaderProgramAttribution({ totals: null }), null);
  const missingParameterRows = structuredClone(snapshot);
  missingParameterRows.programs[0].parameterNames = [];
  assert.equal(boundedShaderProgramAttribution(missingParameterRows), null);
  const forgedFirstQueryCount = structuredClone(snapshot);
  forgedFirstQueryCount.programs[0].parameterNames[0].firstQueries = 0;
  forgedFirstQueryCount.programs[0].parameterNames[0].repeatedQueries =
    forgedFirstQueryCount.programs[0].parameterNames[0].calls;
  assert.equal(boundedShaderProgramAttribution(forgedFirstQueryCount), null);
  const withUnexpectedFields = structuredClone(snapshot);
  withUnexpectedFields.totals.createProgram.requestBody = {
    authorization: 'must-not-escape',
  };
  withUnexpectedFields.programs[0].unexpectedPayload = 'must-not-escape';
  const bounded = boundedShaderProgramAttribution(withUnexpectedFields);
  assert.equal(
    Object.hasOwn(bounded.totals.createProgram, 'requestBody'),
    false,
  );
  assert.equal(Object.hasOwn(bounded.programs[0], 'unexpectedPayload'), false);
});

test('shader attribution installation is opt-in and cleanup is owner-safe', async () => {
  const disabled = earlyProbePage();
  await installEarlyCesiumRendererProbe(disabled.page);
  const disabledCanvas = new disabled.Canvas();
  const disabledContext = disabledCanvas.getContext('webgl2');
  assert.equal(
    disabled.window.__gevRecoveryEarlyRendererProbe
      .shaderProgramAttributionEnabled,
    false,
  );
  assert.equal(disabledContext.createProgram.name, 'createProgram');

  const enabled = earlyProbePage();
  const identifier = await installEarlyCesiumRendererProbe(enabled.page, {
    shaderProgramAttribution: true,
  });
  const canvas = new enabled.Canvas();
  const context = canvas.getContext('webgl2');
  const program = context.createProgram();
  context.linkProgram(program);
  assert.equal(context.getProgramParameter(program, context.LINK_STATUS), true);
  const cleanup = await cleanupEarlyCesiumRendererProbeWithEvidence(
    enabled.page,
    identifier,
    1000,
    { requireShaderProgramAttribution: true },
  );
  assert.equal(cleanup.confirmed, true);
  const attribution = cleanup.document.shaderProgramAttribution;
  assert.equal(attribution.status, 'complete');
  assert.equal(attribution.cleanup.confirmed, true);
  assert.equal(attribution.totals.getProgramParameter.calls, 1);
  assert.equal(boundedShaderProgramAttribution(attribution).status, 'complete');

  const replaced = earlyProbePage();
  const replacedIdentifier = await installEarlyCesiumRendererProbe(
    replaced.page,
    { shaderProgramAttribution: true },
  );
  const replacedCanvas = new replaced.Canvas();
  const replacedContext = replacedCanvas.getContext('webgl2');
  const replacement = function replacementLink() {};
  replacedContext.linkProgram = replacement;
  const replacedCleanup = await cleanupEarlyCesiumRendererProbeWithEvidence(
    replaced.page,
    replacedIdentifier,
    1000,
    { requireShaderProgramAttribution: true },
  );
  assert.equal(replacedCleanup.confirmed, false);
  assert.equal(
    replacedCleanup.document.shaderProgramAttribution.status,
    'unavailable',
  );
  assert.equal(
    replacedCleanup.document.shaderProgramAttribution.cleanup.changedOwnerCount,
    1,
  );
  assert.equal(replacedContext.linkProgram, replacement);

  const throwingGetter = earlyProbePage();
  const throwingIdentifier = await installEarlyCesiumRendererProbe(
    throwingGetter.page,
    { shaderProgramAttribution: true },
  );
  const throwingCanvas = new throwingGetter.Canvas();
  const throwingContext = throwingCanvas.getContext('webgl2');
  const wrappedMethods = Object.fromEntries(
    ['createProgram', 'getProgramParameter', 'deleteProgram'].map((name) => [
      name,
      throwingContext[name],
    ]),
  );
  const getterError = new Error('replacement getter sentinel');
  Object.defineProperty(throwingContext, 'linkProgram', {
    configurable: true,
    get() {
      throw getterError;
    },
  });
  const throwingCleanup = await cleanupEarlyCesiumRendererProbeWithEvidence(
    throwingGetter.page,
    throwingIdentifier,
    1000,
    { requireShaderProgramAttribution: true },
  );
  assert.equal(throwingCleanup.confirmed, false);
  for (const [name, wrapped] of Object.entries(wrappedMethods))
    assert.notEqual(throwingContext[name], wrapped);
  assert.equal(
    throwingCleanup.document.shaderProgramAttribution.cleanup
      .restoredMethodCount,
    3,
  );
  assert.throws(
    () => throwingContext.linkProgram,
    (error) => error === getterError,
  );

  const partial = earlyProbePage();
  const partialContext = partial.native('webgl2');
  delete partialContext.deleteProgram;
  Object.defineProperty(partial.Canvas.prototype, 'getContext', {
    configurable: true,
    writable: true,
    value: () => partialContext,
  });
  const partialIdentifier = await installEarlyCesiumRendererProbe(
    partial.page,
    { shaderProgramAttribution: true },
  );
  const partialCanvas = new partial.Canvas();
  partialCanvas.getContext('webgl2');
  const partialCleanup = await cleanupEarlyCesiumRendererProbeWithEvidence(
    partial.page,
    partialIdentifier,
    1000,
    { requireShaderProgramAttribution: true },
  );
  assert.equal(partialCleanup.confirmed, true);
  assert.equal(
    partialCleanup.document.shaderProgramAttribution.status,
    'unavailable',
  );
  assert.equal(
    partialCleanup.document.shaderProgramAttribution.error,
    'method-install-failed',
  );
  assert.equal(
    partialCleanup.document.shaderProgramAttribution.cleanup.confirmed,
    true,
  );
  assert.equal(
    boundedShaderProgramAttribution(
      partialCleanup.document.shaderProgramAttribution,
    ).status,
    'unavailable',
  );

  const forged = structuredClone(attribution);
  forged.programs[0].parameterNames[0].elapsedSumMs = 'secret';
  assert.equal(boundedShaderProgramAttribution(forged), null);
  const truncated = structuredClone(attribution);
  truncated.status = 'truncated';
  assert.equal(boundedShaderProgramAttribution(truncated), null);
});

test('shader attribution records bounded overflow without confusing it with cleanup failure', async () => {
  const fixture = earlyProbePage();
  const identifier = await installEarlyCesiumRendererProbe(fixture.page, {
    shaderProgramAttribution: true,
  });
  const canvas = new fixture.Canvas();
  const context = canvas.getContext('webgl2');
  const programs = Array.from({ length: 129 }, () => context.createProgram());
  for (const pname of [1, 2, 3, 4, 5])
    context.getProgramParameter(programs[0], pname);

  const cleanup = await cleanupEarlyCesiumRendererProbeWithEvidence(
    fixture.page,
    identifier,
    1000,
    { requireShaderProgramAttribution: true },
  );
  const attribution = cleanup.document.shaderProgramAttribution;
  assert.equal(attribution.status, 'truncated');
  assert.equal(attribution.limits.truncated, true);
  assert.equal(attribution.limits.untrackedProgramOperationCount, 1);
  assert.equal(attribution.limits.pnameRowsOverflow, 1);
  assert.equal(attribution.programs.length, 128);
  assert.equal(attribution.programs[0].parameterNames.length, 4);
  assert.equal(attribution.cleanup.confirmed, true);
  assert.equal(
    boundedShaderProgramAttribution(attribution).status,
    'truncated',
  );
  assert.equal(cleanup.confirmed, true);
});

test('shader checkpoint preserves actual pname rows across generic failure projection', async () => {
  const fixture = earlyProbePage();
  const identifier = await installEarlyCesiumRendererProbe(fixture.page, {
    shaderProgramAttribution: true,
  });
  const context = new fixture.Canvas().getContext('webgl2');
  const program = context.createProgram();
  context.linkProgram(program);
  context.getProgramParameter(program, context.LINK_STATUS);
  context.getProgramParameter(program, context.ACTIVE_UNIFORMS);
  context.getProgramParameter(program, context.ACTIVE_ATTRIBUTES);
  const cleanup = await cleanupEarlyCesiumRendererProbeWithEvidence(
    fixture.page,
    identifier,
    1000,
    { requireShaderProgramAttribution: true },
  );
  const row = {
    phase: 'provider-sample-cleanup',
    documentRole: 'provider-sample-idle-1',
    documentId: 'sample-document-1',
    confirmed: cleanup.confirmed,
    document: cleanup.document,
  };
  const checkpoint = createShaderProgramAttributionCheckpoint([row], 3, {
    appSha: 'a'.repeat(40),
    harnessSha: 'b'.repeat(40),
    receiptSha256: 'c'.repeat(64),
  });
  assert.equal(checkpoint.status, 'partial');
  assert.equal(
    checkpoint.documents[0].attribution.programs[0].parameterNames.length,
    3,
  );
  const parsedCheckpoint = validateShaderProgramAttributionCheckpoint(
    JSON.parse(JSON.stringify(checkpoint)),
    {
      appSha: 'a'.repeat(40),
      harnessSha: 'b'.repeat(40),
      receiptSha256: 'c'.repeat(64),
    },
  );
  assert.equal(
    parsedCheckpoint.documents[0].attribution.programs[0].parameterNames.length,
    3,
  );

  const failure = createCaptureFailureReport({
    source: { appCommit: 'a'.repeat(40), harnessCommit: 'b'.repeat(40) },
    fixture: null,
    workload: { rendererProbeCleanup: [row] },
    phase: 'outer-timeout',
    error: new Error('outer timeout'),
  });
  const projected =
    failure.workload.rendererProbeCleanup[0].document.shaderProgramAttribution;
  assert.equal(projected.programs[0].parameterNames, undefined);
  assert.equal(failure.failure.phase, 'outer-timeout');

  const directory = await mkdtemp(
    path.join(await realpath(os.tmpdir()), 'gev-shader-observer-projection-'),
  );
  try {
    const sourcePath = path.join(
      directory,
      'actual.shader-program-attribution.json',
    );
    const referencePath = `${sourcePath}.ref.json`;
    const artifactPath = path.join(
      directory,
      'smoke.shader-program-attribution.json',
    );
    const persisted = await persistShaderProgramAttributionCheckpoint({
      checkpointPath: sourcePath,
      cleanupRows: [row],
      expectedDocumentCount: 3,
      provenance: {
        appSha: 'a'.repeat(40),
        harnessSha: 'b'.repeat(40),
        receiptSha256: 'c'.repeat(64),
      },
    });
    assert.equal(persisted.artifact.status, 'partial');
    const checkpointBytes = await readFile(sourcePath);
    assert.ok(await readFile(referencePath));
    const storedFailure = path.join(directory, 'capture-failure.json');
    await writeFile(storedFailure, `${JSON.stringify(failure)}\n`);
    const reportOnDisk = JSON.parse(await readFile(storedFailure, 'utf8'));
    assert.equal(
      reportOnDisk.workload.rendererProbeCleanup[0].document
        .shaderProgramAttribution.programs[0].parameterNames,
      undefined,
    );
    const sidecar = await preserveShaderProgramAttributionArtifact(
      sourcePath,
      referencePath,
      artifactPath,
      {
        appSha: 'a'.repeat(40),
        harnessSha: 'b'.repeat(40),
        receiptSha256: 'c'.repeat(64),
      },
    );
    assert.equal(sidecar.artifact.status, 'preserved');
    assert.equal(
      sidecar.checkpoint.documents[0].attribution.programs[0].parameterNames
        .length,
      3,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
