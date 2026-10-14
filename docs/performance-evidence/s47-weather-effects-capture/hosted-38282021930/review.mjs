import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  buildCaptureCliValidationExpectations,
  validateCaptureCliReport,
} from '../../../../scripts/qa-performance-build-smoke.mjs';
import {
  createWeatherEffectsWorkloadFixture,
  WEATHER_EFFECTS_WORKLOAD_ID,
} from '../../../../scripts/performance/weatherEffectsWorkloadFixture.mjs';

const commit = '1e6f6f9874d09a3b13a4e140da3c904834500db1';
const read = (name) => readFileSync(new URL(name, import.meta.url));
const identity = (name) => {
  const bytes = read(name);
  return {
    fileName: name,
    byteLength: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  };
};
const smoke = JSON.parse(read('performance-build-smoke.json'));
const rawName =
  'performance-build-smoke.json.capture-cli-report-candidate.json';
const raw = JSON.parse(read(rawName));
const run = JSON.parse(read('run.json'));
assert.equal(run.headSha, commit);
assert.equal(run.status, 'completed');
assert.equal(run.conclusion, 'success');
assert.equal(smoke.status, 'passed');
assert.equal(smoke.candidateSha, commit);
assert.equal(smoke.harnessSha, commit);
assert.equal(smoke.variants.length, 2);
assert(smoke.variants.every((variant) => variant.status === 'passed'));
const candidate = smoke.variants.find(
  (variant) => variant.label === 'candidate',
);
assert.equal(candidate.revision, commit);
const declaration = candidate.captureCliDiagnostic.captureCliReportArtifact;
const rawIdentity = identity(rawName);
assert.equal(declaration.status, 'preserved');
assert.equal(declaration.childStatus, 'completed');
assert.equal(declaration.sha256, rawIdentity.sha256);
assert.equal(declaration.byteLength, rawIdentity.byteLength);
assert.equal(declaration.fileName, rawName);
const expected = buildCaptureCliValidationExpectations({
  build: { receipt: { receiptSha256: candidate.receiptSha256 } },
  commit,
  harnessCommit: commit,
  fixture: createWeatherEffectsWorkloadFixture(),
  providerFixture: WEATHER_EFFECTS_WORKLOAD_ID,
  workerAuditMode: 'diagnostic',
  sceneFrameDiagnostics: false,
  firstMotionCpuProfile: false,
  depthPickAttribution: false,
});
const replay = validateCaptureCliReport(raw, expected);
assert.equal(replay.status, 'passed');
assert.equal(raw.comparisonEligible, false);
assert.equal(raw.workload.performanceAcceptanceEligible, false);
assert.equal(raw.workload.hardwareRequired, false);
assert.deepEqual(
  raw.captures.map(({ scenario, run }) => [scenario, run]),
  [
    ['idle', 1],
    ['idle', 2],
    ['scripted-motion', 1],
    ['scripted-motion', 2],
  ],
);
for (const sample of raw.captures) {
  assert(sample.renderedFrameCount >= 2);
  assert.equal(sample.foregroundThroughout, true);
  assert.deepEqual(sample.settings.before, sample.settings.after);
  assert.equal(sample.settings.before.qualityMode, 'manual');
  assert.equal(sample.settings.before.densityPct, 75);
}
assert.equal(raw.fixtureDelivery.assets.length, 14);
assert(raw.fixtureDelivery.assets.every((asset) => asset.responseCount > 0));
assert.deepEqual(raw.fixtureDelivery.routeErrors, []);
assert(raw.workload.rendererProbeCleanup.every((entry) => entry.confirmed));
assert(
  raw.workload.fixtureInterceptionReleases.every(
    (entry) =>
      entry.confirmed &&
      entry.targetClosed &&
      entry.stop.pendingCommandsAfterDrain === 0 &&
      entry.stop.pendingPreparationsAfterDrain === 0 &&
      entry.stop.unexpectedLateRequestCount === 0,
  ),
);

const negativeControls = [];
for (const [name, change] of [
  [
    'wrong application commit',
    (report) => {
      report.source.appCommit = '0'.repeat(40);
    },
  ],
  [
    'wrong served fixture hash',
    (report) => {
      report.fixtureDelivery.fixtureSha256 = '0'.repeat(64);
    },
  ],
  [
    'missing sample',
    (report) => {
      report.captures.pop();
    },
  ],
  [
    'wrong wall clock',
    (report) => {
      report.captures[0].weatherEffectsClock.wallClockAfterMs += 1;
    },
  ],
  [
    'empty source observation timestamps',
    (report) => {
      report.captures[0].weatherEffectsClock.weatherStateAfter.sourceObservationTimes =
        [];
    },
  ],
  [
    'unconfirmed renderer cleanup',
    (report) => {
      report.workload.rendererProbeCleanup[0].confirmed = false;
    },
  ],
  [
    'missing renderer cleanup',
    (report) => {
      report.workload.rendererProbeCleanup = [];
    },
  ],
  [
    'unconfirmed interception release',
    (report) => {
      report.workload.fixtureInterceptionReleases[0].confirmed = false;
    },
  ],
  [
    'missing interception release',
    (report) => {
      report.workload.fixtureInterceptionReleases = [];
    },
  ],
  [
    'missing startup retirement',
    (report) => {
      report.workload.rendererLoopRetirements = [];
    },
  ],
]) {
  const changed = structuredClone(raw);
  change(changed);
  let rejection;
  try {
    validateCaptureCliReport(changed, expected);
  } catch (error) {
    rejection = error.message;
  }
  assert(rejection, `Validator accepted negative control: ${name}`);
  negativeControls.push({ name, outcome: 'rejected', reason: rejection });
}

const review = {
  schema: 'gev-weather-effects-hosted-review/v1',
  status: 'passed-integration-diagnostic',
  commit,
  runUrl: run.url,
  rawValidatorReplay: replay.status,
  validatorSourceSha256: createHash('sha256')
    .update(
      readFileSync(
        new URL(
          '../../../../scripts/qa-performance-build-smoke.mjs',
          import.meta.url,
        ),
      ),
    )
    .digest('hex'),
  receiptSha256: candidate.receiptSha256,
  files: [
    'performance-build-smoke.json',
    rawName,
    'run.json',
    'review.mjs',
  ].map(identity),
  fixtureSha256: raw.fixtureDelivery.fixtureSha256,
  fixtureAssetsObserved: raw.fixtureDelivery.assets.length,
  environment: {
    userAgent: raw.environment.userAgent,
    platform: raw.environment.platform,
    renderer: raw.environment.renderer,
    viewport: raw.environment.viewport,
    drawingBuffer: raw.environment.drawingBuffer,
  },
  settings: raw.captures[0].settings.before,
  selectedPopulations: raw.fixtureDelivery.populationsBefore,
  samples: raw.captures.map((sample) => ({
    scenario: sample.scenario,
    run: sample.run,
    durationMs: sample.durationMs,
    renderedFrameCount: sample.renderedFrameCount,
    frameCount: sample.frameCount,
    fixedWallClockMs: sample.weatherEffectsClock.wallClockBeforeMs,
    before: sample.weatherEffectsClock.weatherStateBefore,
    after: sample.weatherEffectsClock.weatherStateAfter,
  })),
  rendererCleanup: raw.workload.rendererProbeCleanup.map(
    ({ documentRole, confirmed }) => ({ documentRole, confirmed }),
  ),
  fixtureRelease: raw.workload.fixtureInterceptionReleases.map(
    ({ documentRole, confirmed, targetClosed, stop }) => ({
      documentRole,
      confirmed,
      targetClosed,
      stop,
    }),
  ),
  negativeControls,
  limitations: [
    'Software-rendered short integration diagnostic, not hardware or latency acceptance.',
    'One-second warmup and one-second samples; two runs each for idle and motion.',
    'Native weather playback may still display a previous source time while its next requested target loads.',
    'No five-run matched comparison, full effects matrix, full soak, or Windows performance result.',
    'S47, S48, S58 and S60 remain partial; historical failed reports remain failed.',
  ],
};
writeFileSync(
  new URL('review.json', import.meta.url),
  `${JSON.stringify(review, null, 2)}\n`,
);
console.log(
  JSON.stringify({
    status: review.status,
    samples: review.samples.length,
    negativeControls: negativeControls.length,
    review: fileURLToPath(new URL('review.json', import.meta.url)),
  }),
);
