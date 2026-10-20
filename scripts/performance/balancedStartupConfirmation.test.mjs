import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  BALANCED_STARTUP_ORDER,
  evaluateBalancedStartupConfirmation,
  STARTUP_MEASUREMENT,
} from './balancedStartupConfirmation.mjs';
import {
  LEGACY_STARTUP_METHOD,
  PAGE_OBSERVED_STARTUP_MEASUREMENT,
  PAGE_OBSERVED_STARTUP_METHOD,
  PAGE_OBSERVED_STARTUP_SCHEMA,
  PAGE_OBSERVED_STARTUP_SEMANTICS,
} from './startupObservationMethod.mjs';
import {
  createStartupOperatingContract,
  STARTUP_BOOTSTRAP_SOURCE_PATHS,
  STARTUP_FIXED_TIME_MS,
} from './startupOperatingContract.mjs';

const controlCommit = 'a'.repeat(40);
const candidateCommit = 'b'.repeat(40);
const captureProducerCommit = 'c'.repeat(40);
const buildHarnessCommit = 'd'.repeat(40);
const controlReceipt = '1'.repeat(64);
const candidateReceipt = '2'.repeat(64);
const REVIEW_SCRIPT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'review-balanced-startup-confirmation.mjs',
);
const environment = {
  browserVersion: 'Chrome/155.0.8059.84',
  renderer: 'ANGLE (Intel, Intel(R) UHD Graphics 620, OpenGL 4.5)',
  userAgent: 'Mozilla/5.0 Chrome/155.0.8059.84',
  platform: 'Win32',
  viewport: { width: 1440, height: 900, dpr: 2 },
  drawingBuffer: { width: 2880, height: 1800 },
  nativeSharpnessProfile: {
    id: 'native-sharpness-v1',
    useBrowserRecommendedResolution: false,
    resolutionScale: 1,
    maximumScreenSpaceError: 1,
    viewport: { width: 1440, height: 900, dpr: 2 },
    drawingBuffer: { width: 2880, height: 1800 },
  },
};
const settings = {
  qualityMode: 'manual',
  detectionMode: 'DENSE',
  densityPct: 50,
  useBrowserRecommendedResolution: false,
  resolutionScale: 1,
  antialias: true,
  msaaSamples: 4,
  fxaa: true,
  bloom: false,
  bloomIntensity: 0,
  sharpen: false,
  sharpenIntensity: 0,
  style: 'satellite',
  map: 'roadmap',
  maximumScreenSpaceError: 1,
  nativeSharpnessProfile: {
    id: 'native-sharpness-v1',
    useBrowserRecommendedResolution: false,
    resolutionScale: 1,
    maximumScreenSpaceError: 1,
    viewport: { width: 1440, height: 900, dpr: 2 },
    drawingBuffer: { width: 2880, height: 1800 },
  },
};

function makePlan() {
  return {
    schema: 'gev-balanced-startup-plan/v1',
    status: 'predeclared',
    createdAt: new Date(900_000).toISOString(),
    motionEligible: false,
    applicationCommits: { control: controlCommit, candidate: candidateCommit },
    captureProducerCommit,
    buildHarnessCommit,
    buildReceiptSha256: {
      control: controlReceipt,
      candidate: candidateReceipt,
    },
    fixture: {
      workloadId: 'infrastructure-dams',
      id: 'bundled-dams-static-v1',
      sha256: 'e'.repeat(64),
    },
    measurement: STARTUP_MEASUREMENT,
    thresholdPct: 10,
    expectedEnvironment: structuredClone(environment),
    expectedSettings: structuredClone(settings),
    slots: BALANCED_STARTUP_ORDER.map((role, index) => ({
      slot: index + 1,
      slotId: `startup-${String(index + 1).padStart(2, '0')}`,
      role,
      path: `shards/startup-${String(index + 1).padStart(2, '0')}.json`,
    })),
  };
}

function makeReport(plan, slot, index, values = {}) {
  const appCommit = plan.applicationCommits[slot.role];
  const receiptSha256 = plan.buildReceiptSha256[slot.role];
  const startedAtMs = 1_000_000 + index * 10_000;
  const foregroundActivation = {
    visible: true,
    focused: true,
    visibilityState: 'visible',
    hostWindowActivation: {
      status: 'foreground-confirmed',
      foregroundConfirmed: true,
      browserPid: 100 + index,
      foregroundPid: 100 + index,
    },
  };
  const appReadyMs =
    values.appReadyMs ?? (slot.role === 'control' ? 4000 : 4100);
  const initialSettleMs =
    values.initialSettleMs ?? (slot.role === 'control' ? 5000 : 5050);
  const startupMethod = plan.startupMethod || LEGACY_STARTUP_METHOD;
  const startup = {
    runCount: 1,
    measurement: plan.measurement,
    observations: [
      {
        run: 1,
        measurement: plan.measurement,
        appReadyMs,
        initialSettleMs,
        cacheDisabled: true,
        foregroundActivation,
        renderer: environment.renderer,
        viewport: structuredClone(environment.viewport),
        drawingBuffer: structuredClone(environment.drawingBuffer),
      },
    ],
  };
  if (startupMethod === PAGE_OBSERVED_STARTUP_METHOD) {
    const navigationStartedAtMs = startedAtMs + 10;
    const navigationCompletedAtMs =
      navigationStartedAtMs + Math.max(1, appReadyMs - 100);
    startup.method = startupMethod;
    startup.timingEvidence = {
      schema: PAGE_OBSERVED_STARTUP_SCHEMA,
      semantics: PAGE_OBSERVED_STARTUP_SEMANTICS,
      preNavigationForeground: {
        startedAtMs: startedAtMs + 1,
        completedAtMs: startedAtMs + 5,
        elapsedMs: 4,
        activation: foregroundActivation,
      },
      hostBoundaries: {
        navigationStartedAtMs,
        navigationCompletedAtMs,
        viewerWaitStartedAtMs: navigationCompletedAtMs,
        loaderWaitStartedAtMs: navigationCompletedAtMs,
        viewerObservedAtMs: navigationStartedAtMs + appReadyMs + 25,
        loaderHiddenObservedAtMs: navigationStartedAtMs + initialSettleMs + 110,
        diagnosticsDisableStartedAtMs:
          navigationStartedAtMs +
          Math.max(appReadyMs + 25, initialSettleMs + 110) +
          1,
        diagnosticsDisableCompletedAtMs:
          navigationStartedAtMs +
          Math.max(appReadyMs + 25, initialSettleMs + 110) +
          11,
      },
      pageObserved: {
        viewerExistenceMsFromNavigationStart: appReadyMs,
        loadingScreenHiddenMsFromNavigationStart: initialSettleMs,
        viewerForeground: {
          observedMsFromNavigationStart: appReadyMs,
          visible: true,
          focused: true,
          visibilityState: 'visible',
        },
        loaderHiddenForeground: {
          observedMsFromNavigationStart: initialSettleMs,
          visible: true,
          focused: true,
          visibilityState: 'visible',
        },
      },
      hostObserved: {
        viewerExistenceMsFromNavigationStart: appReadyMs + 25,
        loadingScreenHiddenMsFromNavigationStart: initialSettleMs + 110,
      },
      finalPageState: { visible: true, focused: true },
    };
    startup.observations[0].finalPageState = {
      ...startup.timingEvidence.finalPageState,
    };
  }
  return {
    schema: 'gev-startup-observation-shard/v1',
    status: 'completed',
    comparisonEligible: false,
    motionEligible: false,
    integrity: { status: 'passed' },
    slotId: slot.slotId,
    role: slot.role,
    source: {
      appCommit,
      captureProducerCommit,
      buildHarnessCommit,
      buildProvenance: { receiptSha256 },
    },
    fixture: structuredClone(plan.fixture),
    graphics: { browserVersion: environment.browserVersion },
    environment: structuredClone(environment),
    settings: structuredClone(plan.expectedSettings),
    startup,
    browserClose: {
      closeApiCompleted: true,
      normalProcessExit: true,
      processExitCode: 0,
      processExitSignal: null,
      forcedTerminationAttempted: false,
    },
    processSpan: { startedAtMs, completedAtMs: startedAtMs + 6000 },
  };
}

function makeInput({ mutatePlan, mutateReports, valuesForRole } = {}) {
  const plan = makePlan();
  mutatePlan?.(plan);
  const shards = plan.slots.map((slot, index) => {
    const values = valuesForRole?.(slot.role, index) || {};
    return {
      slot,
      sha256: String(index + 1).padStart(64, '0'),
      report: makeReport(plan, slot, index, values),
    };
  });
  mutateReports?.(shards, plan);
  return { plan, shards };
}

function makeOperatingInput() {
  const input = makeInput({
    mutatePlan(plan) {
      plan.startupMethod = PAGE_OBSERVED_STARTUP_METHOD;
      plan.measurement = PAGE_OBSERVED_STARTUP_MEASUREMENT;
      plan.expectedSettings.map = 'esri-imagery';
      plan.expectedSettings.style = 'normal';
      plan.startupOperatingContract = createStartupOperatingContract(
        STARTUP_BOOTSTRAP_SOURCE_PATHS.map((sourcePath) => ({
          path: sourcePath,
          sha256: 'f'.repeat(64),
        })),
      );
    },
  });
  for (const { report } of input.shards) {
    report.startup.operatingContract = structuredClone(
      input.plan.startupOperatingContract,
    );
    const observed = report.startup.timingEvidence.pageObserved;
    for (const [index, key] of [
      'viewerForeground',
      'loaderHiddenForeground',
    ].entries())
      observed[key].operatingState = {
        boot: {
          schema: 'gev-default-startup-document-receipt/v1',
          pathname: '/',
          search: '?welcome=0&lang=en',
          hash: '',
          wallClockEpochMs: STARTUP_FIXED_TIME_MS,
        },
        locale: 'en',
        wallClockEpochMs: STARTUP_FIXED_TIME_MS,
        cesiumClock: {
          currentTime: { dayNumber: 2461322, secondsOfDay: 37 },
          shouldAnimate: false,
          multiplier: 1,
        },
        camera: {
          position: { x: 100 + index, y: 200, z: 300 },
          direction: { x: 0, y: 0, z: -1 },
          up: { x: 0, y: 1, z: 0 },
          transform: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
        },
        map: {
          activeId: 'esri-imagery',
          status: 'ready',
          globeShown: true,
          hasCesiumIonToken: false,
          terrainMode: 'keyless',
          terrainFallback: false,
          photorealTilesetPresent: false,
        },
        enabledLayerIds: [],
        settings: structuredClone(input.plan.expectedSettings),
      };
  }
  return input;
}

test('balanced startup confirmation preserves the predeclared order and gates both semantics', () => {
  const result = evaluateBalancedStartupConfirmation(makeInput());
  assert.equal(result.status, 'passed');
  assert.equal(result.confirmationOnly, true);
  assert.equal(result.motionEligible, false);
  assert.deepEqual(result.order, BALANCED_STARTUP_ORDER);
  assert.equal(result.startupMethod, undefined);
  assert.equal(result.appReady.semantic, 'navigation-to-viewer-existence');
  assert.equal(result.appReady.changePct, 2.5);
  assert.equal(result.loadingHidden.changePct, 1);
});

test('balanced startup confirmation fails either over-ten-percent median regression', () => {
  for (const key of ['appReadyMs', 'initialSettleMs']) {
    const input = makeInput({
      valuesForRole: (role) => ({
        [key]: role === 'control' ? 4000 : 4410,
      }),
    });
    const result = evaluateBalancedStartupConfirmation(input);
    assert.equal(result.status, 'failed');
    assert.equal(
      result[key === 'appReadyMs' ? 'appReady' : 'loadingHidden']
        .regressionOver10Pct,
      true,
    );
  }
});

test('page-observed confirmation accepts matching page upper bounds and preserves host timings separately', () => {
  const input = makeInput({
    mutatePlan(plan) {
      plan.startupMethod = PAGE_OBSERVED_STARTUP_METHOD;
      plan.measurement = PAGE_OBSERVED_STARTUP_MEASUREMENT;
    },
  });
  const result = evaluateBalancedStartupConfirmation(input);
  assert.equal(result.status, 'passed');
  assert.equal(result.startupMethod, PAGE_OBSERVED_STARTUP_METHOD);
  assert.equal(result.appReady.semantic, PAGE_OBSERVED_STARTUP_SEMANTICS);
});

test('default-boot confirmation pins future operating inputs and keeps the original ten-percent gates', () => {
  const input = makeOperatingInput();
  const passed = evaluateBalancedStartupConfirmation(input);
  assert.equal(passed.status, 'passed');
  assert.deepEqual(
    passed.startupOperatingContract,
    input.plan.startupOperatingContract,
  );
  for (const { report, slot } of input.shards)
    if (slot.role === 'candidate') {
      const observation = report.startup.observations[0];
      const extraMs = 1000;
      observation.appReadyMs += extraMs;
      const timing = report.startup.timingEvidence;
      timing.pageObserved.viewerExistenceMsFromNavigationStart += extraMs;
      timing.pageObserved.viewerForeground.observedMsFromNavigationStart +=
        extraMs;
      timing.hostBoundaries.viewerObservedAtMs += extraMs;
      timing.hostObserved.viewerExistenceMsFromNavigationStart += extraMs;
      timing.hostBoundaries.diagnosticsDisableStartedAtMs += extraMs;
      timing.hostBoundaries.diagnosticsDisableCompletedAtMs += extraMs;
    }
  const failed = evaluateBalancedStartupConfirmation(input);
  assert.equal(failed.status, 'failed');
  assert.equal(failed.appReady.regressionOver10Pct, true);
});

test('default-boot confirmation rejects old shards, undeclared conditions, changed bootstrap sources, and missing boundary state', () => {
  for (const mutate of [
    (input) => delete input.shards[0].report.startup.operatingContract,
    (input) => delete input.plan.startupOperatingContract,
    (input) =>
      (input.shards[1].report.startup.operatingContract.bootstrapSources[0].sha256 =
        '1'.repeat(64)),
    (input) =>
      delete input.shards[1].report.startup.timingEvidence.pageObserved
        .viewerForeground.operatingState,
    (input) =>
      (input.shards[1].report.startup.timingEvidence.pageObserved.loaderHiddenForeground.operatingState.wallClockEpochMs += 1),
    (input) => (input.plan.thresholdPct = 20),
  ]) {
    const input = makeOperatingInput();
    mutate(input);
    assert.throws(() => evaluateBalancedStartupConfirmation(input));
  }
});

test('page and host elapsed startup clocks are validated independently', () => {
  const input = makeInput({
    mutatePlan(plan) {
      plan.startupMethod = PAGE_OBSERVED_STARTUP_METHOD;
      plan.measurement = PAGE_OBSERVED_STARTUP_MEASUREMENT;
    },
    mutateReports(shards) {
      const evidence = shards[0].report.startup.timingEvidence;
      const pageViewerMs =
        evidence.hostObserved.viewerExistenceMsFromNavigationStart + 100;
      evidence.pageObserved.viewerExistenceMsFromNavigationStart = pageViewerMs;
      evidence.pageObserved.viewerForeground.observedMsFromNavigationStart =
        pageViewerMs;
      shards[0].report.startup.observations[0].appReadyMs = pageViewerMs;
    },
  });
  assert.doesNotThrow(() => evaluateBalancedStartupConfirmation(input));
});

test('page-observed confirmation rejects mixed methods, inconsistent identities, malformed timestamps, and reversed boundaries', () => {
  const badCases = [
    (plan) => {
      plan.startupMethod = PAGE_OBSERVED_STARTUP_METHOD;
      plan.measurement = STARTUP_MEASUREMENT;
    },
    (plan, shards) => {
      plan.startupMethod = PAGE_OBSERVED_STARTUP_METHOD;
      plan.measurement = PAGE_OBSERVED_STARTUP_MEASUREMENT;
      shards[0].report.startup.method = LEGACY_STARTUP_METHOD;
    },
    (plan, shards) => {
      plan.startupMethod = PAGE_OBSERVED_STARTUP_METHOD;
      plan.measurement = PAGE_OBSERVED_STARTUP_MEASUREMENT;
      shards[0].report.startup.timingEvidence.pageObserved.viewerExistenceMsFromNavigationStart =
        Number.NaN;
    },
    (plan, shards) => {
      plan.startupMethod = PAGE_OBSERVED_STARTUP_METHOD;
      plan.measurement = PAGE_OBSERVED_STARTUP_MEASUREMENT;
      shards[0].report.startup.timingEvidence.hostBoundaries.viewerObservedAtMs =
        shards[0].report.startup.timingEvidence.hostBoundaries
          .navigationCompletedAtMs - 1;
    },
    (plan, shards) => {
      plan.startupMethod = PAGE_OBSERVED_STARTUP_METHOD;
      plan.measurement = PAGE_OBSERVED_STARTUP_MEASUREMENT;
      shards[0].report.startup.timingEvidence.preNavigationForeground.completedAtMs =
        shards[0].report.startup.timingEvidence.hostBoundaries
          .navigationStartedAtMs + 1;
    },
    (plan, shards) => {
      plan.startupMethod = PAGE_OBSERVED_STARTUP_METHOD;
      plan.measurement = PAGE_OBSERVED_STARTUP_MEASUREMENT;
      shards[0].report.startup.timingEvidence.pageObserved.viewerForeground.focused = false;
    },
    (plan, shards) => {
      plan.startupMethod = PAGE_OBSERVED_STARTUP_METHOD;
      plan.measurement = PAGE_OBSERVED_STARTUP_MEASUREMENT;
      shards[0].report.startup.timingEvidence.finalPageState.visible = false;
      shards[0].report.startup.observations[0].finalPageState.visible = false;
    },
    (plan, shards) => {
      plan.startupMethod = PAGE_OBSERVED_STARTUP_METHOD;
      plan.measurement = PAGE_OBSERVED_STARTUP_MEASUREMENT;
      shards[0].report.startup.timingEvidence.hostObserved.viewerExistenceMsFromNavigationStart =
        shards[0].report.startup.timingEvidence.hostObserved
          .viewerExistenceMsFromNavigationStart + 1;
    },
    (plan, shards) => {
      plan.startupMethod = PAGE_OBSERVED_STARTUP_METHOD;
      plan.measurement = PAGE_OBSERVED_STARTUP_MEASUREMENT;
      shards[0].report.startup.timingEvidence.hostObserved.loadingScreenHiddenMsFromNavigationStart += 1;
    },
  ];
  for (const mutate of badCases) {
    const input = makeInput({
      mutatePlan(plan) {
        plan.startupMethod = PAGE_OBSERVED_STARTUP_METHOD;
        plan.measurement = PAGE_OBSERVED_STARTUP_MEASUREMENT;
      },
      mutateReports(shards, plan) {
        mutate(plan, shards);
      },
    });
    assert.throws(() => evaluateBalancedStartupConfirmation(input));
  }
});

test('balanced startup confirmation rejects malformed and wrong-revision shards', () => {
  for (const mutate of [
    (shards) => (shards[0].report.schema = 'wrong-schema'),
    (shards) => (shards[0].report.status = 'failed'),
    (shards) => {
      shards[0].report.schema = 'gev-startup-attribution-diagnostic/v1';
      shards[0].report.status = 'diagnostic-only';
      shards[0].report.diagnosticOnly = true;
    },
    (shards) => (shards[0].report.source.appCommit = candidateCommit),
    (shards) =>
      (shards[0].report.startup.observations[0].cacheDisabled = false),
    (shards) =>
      (shards[0].report.startup.observations[0].appReadyMs = Number.NaN),
    (shards) => (shards[0].report.browserClose.normalProcessExit = false),
    (shards) =>
      (shards[0].report.browserClose.forcedTerminationAttempted = true),
    (shards) => (shards[0].report.environment.renderer = 'different renderer'),
    (shards) => (shards[0].report.settings.densityPct = 75),
    (shards) => (shards[0].report.environment.viewport.dpr = 1.25),
  ]) {
    const input = makeInput({ mutateReports: mutate });
    assert.throws(() => evaluateBalancedStartupConfirmation(input));
  }
});

test('balanced startup confirmation rejects missing, duplicate, reordered and overlapping shards', () => {
  {
    const input = makeInput();
    input.shards.pop();
    assert.throws(() => evaluateBalancedStartupConfirmation(input));
  }
  for (const mutate of [
    (shards) => (shards[1] = structuredClone(shards[0])),
    (shards) => ([shards[0], shards[1]] = [shards[1], shards[0]]),
    (shards) =>
      (shards[1].report.processSpan.startedAtMs =
        shards[0].report.processSpan.completedAtMs),
  ]) {
    const input = makeInput({ mutateReports: mutate });
    assert.throws(() => evaluateBalancedStartupConfirmation(input));
  }
});

test('balanced startup plan rejects duplicate paths, wrong order and incomplete identity pins', () => {
  for (const mutatePlan of [
    (plan) => (plan.slots[1].path = plan.slots[0].path),
    (plan) => (plan.slots[0].role = 'candidate'),
    (plan) => delete plan.expectedEnvironment.renderer,
    (plan) => (plan.expectedSettings.resolutionScale = 0.5),
    (plan) => {
      plan.expectedEnvironment.nativeSharpnessProfile.resolutionScale = 0.5;
      plan.expectedSettings.nativeSharpnessProfile.resolutionScale = 0.5;
      plan.expectedSettings.resolutionScale = 0.5;
      plan.expectedEnvironment.drawingBuffer.width = 1440;
      plan.expectedEnvironment.drawingBuffer.height = 900;
      plan.expectedEnvironment.nativeSharpnessProfile.drawingBuffer.width = 1440;
      plan.expectedEnvironment.nativeSharpnessProfile.drawingBuffer.height = 900;
      plan.expectedSettings.nativeSharpnessProfile.drawingBuffer.width = 1440;
      plan.expectedSettings.nativeSharpnessProfile.drawingBuffer.height = 900;
    },
    (plan) => {
      plan.expectedEnvironment.nativeSharpnessProfile.useBrowserRecommendedResolution = true;
      plan.expectedSettings.nativeSharpnessProfile.useBrowserRecommendedResolution = true;
      plan.expectedSettings.useBrowserRecommendedResolution = true;
    },
    (plan) => (plan.createdAt = 'not a date'),
    (plan) => delete plan.createdAt,
    (plan) => (plan.thresholdPct = 20),
  ]) {
    const input = makeInput({ mutatePlan });
    assert.throws(() => evaluateBalancedStartupConfirmation(input));
  }
});

test('balanced startup plan must predate every shard attempt', () => {
  const input = makeInput();
  input.plan.createdAt = new Date(
    input.shards[0].report.processSpan.startedAtMs,
  ).toISOString();
  assert.throws(() => evaluateBalancedStartupConfirmation(input));
});

test('startup review CLI verifies the predeclared plan and each raw shard hash', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'gev-startup-review-'));
  try {
    const input = makeInput();
    const planPath = path.join(root, 'plan.json');
    const envelopePath = path.join(root, 'envelope.json');
    const outputPath = path.join(root, 'review.json');
    const planBytes = Buffer.from(JSON.stringify(input.plan));
    await fs.writeFile(planPath, planBytes, { flag: 'wx' });
    for (const { slot, report } of input.shards) {
      const shardPath = path.join(root, slot.path);
      const bytes = Buffer.from(JSON.stringify(report));
      await fs.mkdir(path.dirname(shardPath), { recursive: true });
      await fs.writeFile(shardPath, bytes, { flag: 'wx' });
    }
    const invoke = (destination, seal = false) =>
      spawnSync(
        process.execPath,
        [
          REVIEW_SCRIPT,
          '--plan',
          planPath,
          ...(seal ? ['--seal'] : ['--envelope', envelopePath]),
          '--out',
          destination,
        ],
        { encoding: 'utf8' },
      );
    const sealed = invoke(envelopePath, true);
    assert.equal(sealed.status, 0, sealed.stderr);
    const envelope = JSON.parse(await fs.readFile(envelopePath, 'utf8'));
    assert.equal(
      envelope.planSha256,
      createHash('sha256').update(planBytes).digest('hex'),
    );
    const hashReceipt = envelope.slots[0];
    const firstBytes = await fs.readFile(
      path.join(root, input.plan.slots[0].path),
    );
    assert.equal(
      hashReceipt.sha256,
      createHash('sha256').update(firstBytes).digest('hex'),
    );
    const invokeReview = (destination) =>
      spawnSync(
        process.execPath,
        [
          REVIEW_SCRIPT,
          '--plan',
          planPath,
          '--envelope',
          envelopePath,
          '--out',
          destination,
        ],
        { encoding: 'utf8' },
      );
    const good = invokeReview(outputPath);
    assert.equal(good.status, 0, good.stderr);
    assert.equal(
      JSON.parse(await fs.readFile(outputPath, 'utf8')).status,
      'passed',
    );

    const firstShardPath = path.join(root, input.plan.slots[0].path);
    await fs.appendFile(firstShardPath, ' ');
    const tampered = invokeReview(path.join(root, 'tampered-review.json'));
    assert.equal(tampered.status, 1);
    assert.match(tampered.stderr, /hash differs/);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
