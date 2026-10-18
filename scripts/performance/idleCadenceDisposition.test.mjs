import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { validateIdleCadenceDisposition } from './idleCadenceDisposition.mjs';

const BASELINE = 'e7a878e168bc97ffedddc27e13bf3e69b7ee6256';
const CANDIDATE = '19065997a3f6360d68cb9ed5b389c4754856b596';
const profile = {
  id: 'native-sharpness-v1',
  useBrowserRecommendedResolution: false,
  resolutionScale: 1,
  maximumScreenSpaceError: 1,
  viewport: { width: 1440, height: 900, dpr: 2 },
  drawingBuffer: { width: 2880, height: 1800 },
};
const identity = {
  renderer: 'ANGLE (Intel UHD Graphics 620 Direct3D11)',
  vendor: 'Google Inc. (Intel)',
  userAgent: 'Chrome/152',
  viewport: { width: 1440, height: 900, dpr: 2 },
  drawingBuffer: { width: 2880, height: 1800 },
};
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const pack = (value) => ({ bytes: JSON.stringify(value) });
const raw = (sha) => ({
  appCommit: sha,
  workload: {
    providerFixture: 'austin-operating-v1',
    fixtureId: 'austin-operating-composed-v1',
    qualityMode: 'manual',
    detectionMode: 'DENSE',
    expectedDensityPct: 75,
  },
  environment: {
    focused: true,
    visible: true,
    renderer: identity.renderer,
    vendor: identity.vendor,
    userAgent: identity.userAgent,
    viewport: { width: 1440, height: 900, dpr: 2 },
    drawingBuffer: { width: 2880, height: 1800 },
    nativeSharpnessProfile: profile,
  },
  captures: [
    {
      settings: {
        before: { nativeSharpnessProfile: profile },
        after: { nativeSharpnessProfile: profile },
      },
    },
    {
      settings: {
        before: { nativeSharpnessProfile: profile },
        after: { nativeSharpnessProfile: profile },
      },
    },
  ],
});
function side(label, appSha, hold, scheduled) {
  const witness = (n) => ({ latitude: 30 + n, longitude: -97 - n });
  const sample = (n) => ({
    at: 1000 + n * 1000,
    visibility: 'visible',
    focused: true,
    wind: {
      paused: false,
      gpu: {
        ready: true,
        heightFade: 0,
        visibleCells: 0,
        visibleVertexCount: 0,
      },
    },
    satelliteWitness: witness(n),
    performanceSnapshot: {
      settings: {
        qualityMode: 'manual',
        densityPct: 75,
        detectionMode: 'DENSE',
      },
    },
    requestRenderMode: !hold,
    renderGovernor: {
      installed: true,
      mode: hold ? 'continuous' : 'idle',
      holds: hold ? [hold] : [],
      scheduledUpdates: [
        'satellites-periodic',
        ...(scheduled ? ['cctv-still'] : []),
      ],
    },
  });
  return {
    label,
    appSha,
    status: 'observed',
    rendererClassification: { accelerationVerified: true },
    renderer: { renderer: identity.renderer },
    samples: [sample(0), sample(1)],
    profile,
    final: { performanceSnapshot: { identity } },
    windVisibilityProbe: {
      status: 'observed',
      intervention: 'elevated-60000m-after-natural-observation',
      first: {
        at: 1000,
        diagnostics: {
          gpu: {
            ready: true,
            visibleCells: 9,
            visibleVertexCount: 110080,
            heightFade: 1,
          },
        },
        material: { phaseTime: 1 },
      },
      second: {
        at: 7000,
        diagnostics: {
          gpu: {
            ready: true,
            visibleCells: 9,
            visibleVertexCount: 110080,
            heightFade: 1,
          },
        },
        material: { phaseTime: 2 },
        postRender: { intervals: [100], visibility: 'visible', focused: true },
      },
    },
    teardown: { errors: [], cleanupErrors: [] },
  };
}
function valid() {
  const diagnostic = {
    schema: 'gev-austin-operating-render-demand-diagnostic/v1',
    status: 'diagnostic-non-comparable',
    comparable: false,
    fixture: {
      route: { id: 'austin-operating-city-route-v1', altitudeM: 12000 },
      visualState: {
        qualityMode: 'manual',
        detectionMode: 'DENSE',
        densityPct: 75,
      },
    },
    identities: { baselineCommit: BASELINE, candidateCommit: CANDIDATE },
    sides: [
      side('baseline', BASELINE, 'cctv-projection', false),
      side('candidate', CANDIDATE, null, true),
    ],
  };
  const baseline = pack(raw(BASELINE));
  const candidate = pack(raw(CANDIDATE));
  const diagnosticEvidence = pack(diagnostic);
  const disposition = {
    schema: 'gev-idle-cadence-disposition/v1',
    scenario: 'idle',
    workloadId: 'austin-operating-v1',
    routeId: 'austin-operating-city-route-v1',
    baselineAppSha: BASELINE,
    candidateAppSha: CANDIDATE,
    baselineRawSha256: digest(baseline.bytes),
    candidateRawSha256: digest(candidate.bytes),
    diagnosticSha256: digest(diagnosticEvidence.bytes),
  };
  return { disposition, diagnostic: diagnosticEvidence, baseline, candidate };
}

test('valid Austin evidence resolves only idle cadence', () => {
  assert.deepEqual(validateIdleCadenceDisposition(valid()), {
    resolvedScenarios: ['idle'],
    metric: 'frame-interval-p95-ms',
    classification: 'intentional-demand-cadence-change',
    visualAcceptance: 'not-assessed',
    motionAcceptance: 'not-assessed',
  });
});

for (const [name, mutate] of [
  [
    'wrong hold',
    (x) => {
      const d = JSON.parse(x.diagnostic.bytes);
      for (const sample of d.sides[0].samples) sample.renderGovernor.holds = [];
      x.diagnostic.bytes = JSON.stringify(d);
    },
  ],
  [
    'stagnant satellite',
    (x) => {
      const d = JSON.parse(x.diagnostic.bytes);
      d.sides[1].samples[1].satelliteWitness =
        d.sides[1].samples[0].satelliteWitness;
      x.diagnostic.bytes = JSON.stringify(d);
    },
  ],
  [
    'phase stopped',
    (x) => {
      const d = JSON.parse(x.diagnostic.bytes);
      d.sides[1].windVisibilityProbe.second.material.phaseTime = 1;
      x.diagnostic.bytes = JSON.stringify(d);
    },
  ],
  [
    'cleanup error',
    (x) => {
      const d = JSON.parse(x.diagnostic.bytes);
      d.sides[0].teardown.cleanupErrors = [{ stage: 'close' }];
      x.diagnostic.bytes = JSON.stringify(d);
    },
  ],
]) {
  test(`rejects ${name}`, () => {
    const input = valid();
    mutate(input);
    input.disposition.diagnosticSha256 = digest(input.diagnostic.bytes);
    assert.throws(
      () => validateIdleCadenceDisposition(input),
      /Idle cadence disposition rejected/,
    );
  });
}

test('rejects evidence without raw bytes or for another workload', () => {
  const input = valid();
  input.baseline = {};
  assert.throws(() => validateIdleCadenceDisposition(input), /raw bytes/);
  const other = valid();
  other.disposition.workloadId = 'dense-investigation';
  assert.throws(() => validateIdleCadenceDisposition(other), /workload/);
});

test('ignores a mismatched independently supplied parsed object', () => {
  const input = valid();
  input.diagnostic.value = { schema: 'fake' };
  assert.deepEqual(validateIdleCadenceDisposition(input).resolvedScenarios, [
    'idle',
  ]);
});

for (const [name, mutate] of [
  [
    'arbitrary extra hold',
    (d) =>
      d.sides[1].samples.forEach((sample) =>
        sample.renderGovernor.holds.push('unexpected'),
      ),
  ],
  [
    'cross-side renderer',
    (d) => {
      d.sides[1].final.performanceSnapshot.identity.renderer =
        'ANGLE (other GPU)';
    },
  ],
  [
    'missing cleanup array',
    (d) => {
      delete d.sides[0].teardown.cleanupErrors;
    },
  ],
  [
    'duplicate side label',
    (d) => {
      d.sides[1].label = 'baseline';
    },
  ],
]) {
  test(`rejects ${name} after recomputed diagnostic hash`, () => {
    const input = valid();
    const parsed = JSON.parse(input.diagnostic.bytes);
    mutate(parsed);
    input.diagnostic.bytes = JSON.stringify(parsed);
    input.disposition.diagnosticSha256 = digest(input.diagnostic.bytes);
    assert.throws(
      () => validateIdleCadenceDisposition(input),
      /Idle cadence disposition rejected/,
    );
  });
}

test('enforces separate diagnostic and full-report byte bounds', () => {
  const input = valid();
  const diagnosticBytes = input.diagnostic.bytes;
  input.diagnostic.bytes = `${diagnosticBytes}${' '.repeat(4 * 1024 * 1024)}`;
  assert.throws(
    () => validateIdleCadenceDisposition(input),
    /diagnostic raw bytes exceed/,
  );
  const full = valid();
  full.baseline.bytes = `${full.baseline.bytes}${' '.repeat(32 * 1024 * 1024)}`;
  assert.throws(
    () => validateIdleCadenceDisposition(full),
    /baseline raw bytes exceed/,
  );
});

for (const [name, mutate] of [
  [
    'missing vertex count',
    (d) => {
      delete d.sides[0].windVisibilityProbe.first.diagnostics.gpu
        .visibleVertexCount;
    },
  ],
  [
    'empty frame witness',
    (d) => {
      d.sides[0].windVisibilityProbe.second.postRender.intervals = [];
    },
  ],
  [
    'unknown render mode',
    (d) => {
      d.sides[0].samples[0].renderGovernor.mode = 'unknown';
    },
  ],
  [
    'non-increasing sample time',
    (d) => {
      d.sides[0].samples[1].at = d.sides[0].samples[0].at;
    },
  ],
  [
    'short elevated probe',
    (d) => {
      d.sides[0].windVisibilityProbe.second.at =
        d.sides[0].windVisibilityProbe.first.at + 1000;
    },
  ],
])
  test(`rejects ${name} as semantic evidence, not a digest mismatch`, () => {
    const input = valid(),
      value = JSON.parse(input.diagnostic.bytes);
    mutate(value);
    input.diagnostic.bytes = JSON.stringify(value);
    input.disposition.diagnosticSha256 = digest(input.diagnostic.bytes);
    assert.throws(
      () => validateIdleCadenceDisposition(input),
      /Idle cadence disposition rejected/,
    );
  });

test('a later raw settings boundary cannot hide behind the first valid profile', () => {
  const input = valid(),
    value = JSON.parse(input.baseline.bytes);
  value.captures[1].settings.after.nativeSharpnessProfile.resolutionScale = 0.5;
  input.baseline.bytes = JSON.stringify(value);
  input.disposition.baselineRawSha256 = digest(input.baseline.bytes);
  assert.throws(
    () => validateIdleCadenceDisposition(input),
    /native profile|profile boundary/i,
  );
});
