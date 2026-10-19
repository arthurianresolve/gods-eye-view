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
  const startedAtMs = 1_000_000 + index * 1_000;
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
    settings: structuredClone(settings),
    startup: {
      runCount: 1,
      measurement: STARTUP_MEASUREMENT,
      observations: [
        {
          run: 1,
          measurement: STARTUP_MEASUREMENT,
          appReadyMs:
            values.appReadyMs ?? (slot.role === 'control' ? 4000 : 4100),
          initialSettleMs:
            values.initialSettleMs ?? (slot.role === 'control' ? 5000 : 5050),
          cacheDisabled: true,
          foregroundActivation,
          renderer: environment.renderer,
          viewport: structuredClone(environment.viewport),
          drawingBuffer: structuredClone(environment.drawingBuffer),
        },
      ],
    },
    browserClose: {
      closeApiCompleted: true,
      normalProcessExit: true,
      processExitCode: 0,
      processExitSignal: null,
      forcedTerminationAttempted: false,
    },
    processSpan: { startedAtMs, completedAtMs: startedAtMs + 500 },
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

test('balanced startup confirmation preserves the predeclared order and gates both semantics', () => {
  const result = evaluateBalancedStartupConfirmation(makeInput());
  assert.equal(result.status, 'passed');
  assert.equal(result.confirmationOnly, true);
  assert.equal(result.motionEligible, false);
  assert.deepEqual(result.order, BALANCED_STARTUP_ORDER);
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

test('balanced startup confirmation rejects malformed and wrong-revision shards', () => {
  for (const mutate of [
    (shards) => (shards[0].report.schema = 'wrong-schema'),
    (shards) => (shards[0].report.status = 'failed'),
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
