import assert from 'node:assert/strict';
import test from 'node:test';
import {
  PHASED_WEATHER_WORKLOAD_ID,
  WEATHER_BALANCED_SHARD_INELIGIBLE_REASON,
  WEATHER_INTERLEAVED_INELIGIBLE_REASON,
  resolveWeatherCaptureContract,
} from './weatherInterleavedDiagnosticContract.mjs';

const exact = {
  workloadId: PHASED_WEATHER_WORKLOAD_ID,
  warmupMs: 30_000,
  seconds: 60,
  runs: 5,
};

test('normal weather comparison contract keeps both scenarios and eligibility', () => {
  assert.deepEqual(resolveWeatherCaptureContract(exact), {
    mode: 'comparison',
    scenarios: ['idle', 'scripted-motion'],
    diagnosticOnly: false,
    performanceAcceptanceEligible: true,
    ineligibleReason: null,
  });
});

test('existing phase producer diagnostic contract and scenario plan stay unchanged', () => {
  assert.deepEqual(
    resolveWeatherCaptureContract({
      ...exact,
      phaseDiagnostic: true,
      warmupMs: 1_000,
      runs: 1,
    }),
    {
      mode: 'phase-producer-diagnostic',
      scenarios: ['idle', 'scripted-motion'],
      diagnosticOnly: true,
      performanceAcceptanceEligible: false,
      ineligibleReason:
        'weather-effects-fixture-is-a-short-diagnostic-not-performance-acceptance',
    },
  );
});

test('interleaved diagnostic selects only scripted motion and is explicitly ineligible', () => {
  assert.deepEqual(
    resolveWeatherCaptureContract({
      ...exact,
      runs: 1,
      interleavedDiagnostic: true,
    }),
    {
      mode: 'interleaved-motion-diagnostic',
      scenarios: ['scripted-motion'],
      diagnosticOnly: true,
      performanceAcceptanceEligible: false,
      ineligibleReason: WEATHER_INTERLEAVED_INELIGIBLE_REASON,
    },
  );
});

test('interleaved option rejects non-weather fixtures and incompatible timing', () => {
  assert.throws(
    () =>
      resolveWeatherCaptureContract({
        workloadId: 'dense-investigation',
        interleavedDiagnostic: true,
        warmupMs: 30_000,
        seconds: 60,
        runs: 1,
      }),
    /requires the phased weather\/effects fixture/,
  );
  for (const overrides of [{ warmupMs: 1_000 }, { seconds: 30 }, { runs: 5 }])
    assert.throws(
      () =>
        resolveWeatherCaptureContract({
          ...exact,
          ...overrides,
          runs: overrides.runs ?? 1,
          interleavedDiagnostic: true,
        }),
      /requires exactly 30s warmup, 60s measurement and one run/,
    );
});

test('balanced qualification shard keeps both full scenarios and stays ineligible alone', () => {
  assert.deepEqual(
    resolveWeatherCaptureContract({
      ...exact,
      runs: 1,
      balancedQualificationShard: true,
    }),
    {
      mode: 'balanced-qualification-shard',
      scenarios: ['idle', 'scripted-motion'],
      diagnosticOnly: false,
      qualificationShard: true,
      performanceAcceptanceEligible: false,
      ineligibleReason: WEATHER_BALANCED_SHARD_INELIGIBLE_REASON,
    },
  );
  assert.throws(
    () =>
      resolveWeatherCaptureContract({
        ...exact,
        balancedQualificationShard: true,
        runs: 5,
      }),
    /requires exactly 30s warmup, 60s measurement and one run/,
  );
  assert.throws(
    () =>
      resolveWeatherCaptureContract({
        ...exact,
        workloadId: 'dense-investigation',
        balancedQualificationShard: true,
        runs: 1,
      }),
    /requires the phased weather\/effects fixture/,
  );
});

test('weather diagnostic and qualification shard flags cannot be combined', () => {
  assert.throws(
    () =>
      resolveWeatherCaptureContract({
        ...exact,
        phaseDiagnostic: true,
        interleavedDiagnostic: true,
      }),
    /mutually exclusive/,
  );
  assert.throws(
    () =>
      resolveWeatherCaptureContract({
        ...exact,
        interleavedDiagnostic: true,
        balancedQualificationShard: true,
        runs: 1,
      }),
    /mutually exclusive/,
  );
});

test('unrelated workloads without weather diagnostic flags remain unaffected', () => {
  assert.equal(
    resolveWeatherCaptureContract({
      workloadId: 'dense-investigation',
      warmupMs: 2_000,
      seconds: 10,
      runs: 2,
    }),
    null,
  );
});
