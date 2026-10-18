import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { validateIdleCadenceDisposition } from './idleCadenceDisposition.mjs';

const BASELINE = 'e7a878e168bc97ffedddc27e13bf3e69b7ee6256';
const CANDIDATE = '19065997a3f6360d68cb9ed5b389c4754856b596';
const profile = { id: 'native-sharpness-v1', useBrowserRecommendedResolution: false, resolutionScale: 1, maximumScreenSpaceError: 1, viewport: { width: 1440, height: 900, dpr: 2 }, drawingBuffer: { width: 2880, height: 1800 } };
const identity = { renderer: 'ANGLE (Intel UHD Graphics 620 Direct3D11)', vendor: 'Google Inc. (Intel)', userAgent: 'Chrome/152' };
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const pack = (value) => { const bytes = JSON.stringify(value); return { value, bytes }; };
function side(label, appSha, hold, scheduled) {
  const witness = (n) => ({ latitude: 30 + n, longitude: -97 - n });
  const sample = (n) => ({ visibility: 'visible', focused: true, wind: { paused: false, gpu: { ready: true, heightFade: 0, visibleCells: 0 } }, satelliteWitness: witness(n), renderGovernor: { mode: hold ? 'continuous' : 'idle', holds: hold ? [hold] : [], scheduledUpdates: ['satellites-periodic', ...(scheduled ? ['cctv-still'] : [])] } });
  return { label, appSha, samples: [sample(0), sample(1)], profile, final: { performanceSnapshot: { identity } }, windVisibilityProbe: { status: 'observed', first: { diagnostics: { gpu: { ready: true, visibleCells: 9, visibleVertexCount: 110080, heightFade: 1 } }, material: { phaseTime: 1 } }, second: { diagnostics: { gpu: { ready: true, visibleCells: 9, visibleVertexCount: 110080, heightFade: 1 } }, material: { phaseTime: 2 }, postRender: { intervals: [100] } } }, teardown: { errors: [] } };
}
function valid() {
  const diagnostic = { schema: 'gev-austin-operating-render-demand-diagnostic/v1', status: 'diagnostic-non-comparable', comparable: false, fixture: { route: { id: 'austin-operating-city-route-v1', altitudeM: 12000 }, visualState: { qualityMode: 'manual', detectionMode: 'DENSE', densityPct: 75 } }, identities: { baselineCommit: BASELINE, candidateCommit: CANDIDATE }, sides: [side('baseline', BASELINE, 'cctv-projection', false), side('candidate', CANDIDATE, null, true)] };
  const baseline = pack({ marker: 'baseline' });
  const candidate = pack({ marker: 'candidate' });
  const diagnosticEvidence = pack(diagnostic);
  const disposition = { schema: 'gev-idle-cadence-disposition/v1', scenario: 'idle', workloadId: 'austin-operating-v1', routeId: 'austin-operating-city-route-v1', baselineAppSha: BASELINE, candidateAppSha: CANDIDATE, baselineRawSha256: digest(baseline.bytes), candidateRawSha256: digest(candidate.bytes), diagnosticSha256: digest(diagnosticEvidence.bytes) };
  return { disposition, diagnostic: diagnosticEvidence, baseline, candidate };
}

test('valid Austin evidence resolves only idle cadence', () => {
  assert.deepEqual(validateIdleCadenceDisposition(valid()), { resolvedScenarios: ['idle'], metric: 'frame-interval-p95-ms', classification: 'intentional-demand-cadence-change', visualAcceptance: 'not-assessed', motionAcceptance: 'not-assessed' });
});

for (const [name, mutate] of [
  ['wrong hold', (x) => { for (const sample of x.diagnostic.value.sides[0].samples) sample.renderGovernor.holds = []; }],
  ['stagnant satellite', (x) => { x.diagnostic.value.sides[1].samples[1].satelliteWitness = x.diagnostic.value.sides[1].samples[0].satelliteWitness; }],
  ['phase stopped', (x) => { x.diagnostic.value.sides[1].windVisibilityProbe.second.material.phaseTime = 1; }],
  ['cleanup error', (x) => { x.diagnostic.value.sides[0].teardown.errors = [{ stage: 'close' }]; }],
]) {
  test(`rejects ${name}`, () => {
    const input = valid();
    mutate(input);
    assert.throws(() => validateIdleCadenceDisposition(input), /Idle cadence disposition rejected/);
  });
}

test('rejects evidence without raw bytes or for another workload', () => {
  const input = valid();
  input.baseline = { value: input.baseline.value };
  assert.throws(() => validateIdleCadenceDisposition(input), /raw bytes/);
  const other = valid();
  other.disposition.workloadId = 'dense-investigation';
  assert.throws(() => validateIdleCadenceDisposition(other), /workload/);
});
