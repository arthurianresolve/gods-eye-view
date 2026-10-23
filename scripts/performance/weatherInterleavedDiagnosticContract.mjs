export const PHASED_WEATHER_WORKLOAD_ID = 'austin-weather-effects-phased-v2';

export const WEATHER_INTERLEAVED_INELIGIBLE_REASON =
  'weather-interleaved-motion-diagnostic-is-ineligible-for-comparison';
export const WEATHER_BALANCED_SHARD_INELIGIBLE_REASON =
  'weather-balanced-qualification-shard-is-ineligible-standalone';

export function resolveWeatherCaptureContract({
  workloadId,
  phaseDiagnostic = false,
  interleavedDiagnostic = false,
  balancedQualificationShard = false,
  warmupMs,
  seconds,
  runs,
}) {
  if (
    [phaseDiagnostic, interleavedDiagnostic, balancedQualificationShard].filter(
      Boolean,
    ).length > 1
  )
    throw new TypeError(
      'Weather phase diagnostics, interleaved diagnostics and balanced qualification shards are mutually exclusive.',
    );

  if (
    !phaseDiagnostic &&
    !interleavedDiagnostic &&
    !balancedQualificationShard &&
    workloadId !== PHASED_WEATHER_WORKLOAD_ID
  )
    return null;
  if (workloadId !== PHASED_WEATHER_WORKLOAD_ID) {
    const option = balancedQualificationShard
      ? '--weather-balanced-qualification-shard'
      : interleavedDiagnostic
        ? '--weather-interleaved-diagnostic'
        : '--weather-phase-diagnostic';
    throw new TypeError(
      `${option} requires the phased weather/effects fixture.`,
    );
  }

  const comparison = warmupMs === 30_000 && seconds === 60 && runs === 5;
  const phaseProducer = warmupMs === 1_000 && seconds === 60 && runs === 1;
  const interleavedMotion = warmupMs === 30_000 && seconds === 60 && runs === 1;
  const balancedShard = warmupMs === 30_000 && seconds === 60 && runs === 1;

  if (balancedQualificationShard) {
    if (!balancedShard)
      throw new TypeError(
        '--weather-balanced-qualification-shard requires exactly 30s warmup, 60s measurement and one run.',
      );
    return {
      mode: 'balanced-qualification-shard',
      scenarios: ['idle', 'scripted-motion'],
      diagnosticOnly: false,
      qualificationShard: true,
      performanceAcceptanceEligible: false,
      ineligibleReason: WEATHER_BALANCED_SHARD_INELIGIBLE_REASON,
    };
  }

  if (interleavedDiagnostic) {
    if (!interleavedMotion)
      throw new TypeError(
        '--weather-interleaved-diagnostic requires exactly 30s warmup, 60s measurement and one run.',
      );
    return {
      mode: 'interleaved-motion-diagnostic',
      scenarios: ['scripted-motion'],
      diagnosticOnly: true,
      performanceAcceptanceEligible: false,
      ineligibleReason: WEATHER_INTERLEAVED_INELIGIBLE_REASON,
    };
  }

  if (phaseDiagnostic) {
    if (!phaseProducer)
      throw new TypeError(
        'Phased weather/effects requires either the exact 30s/60s/5-run comparison contract or the explicit 1s/60s/1-run producer diagnostic.',
      );
    return {
      mode: 'phase-producer-diagnostic',
      scenarios: ['idle', 'scripted-motion'],
      diagnosticOnly: true,
      performanceAcceptanceEligible: false,
      ineligibleReason:
        'weather-effects-fixture-is-a-short-diagnostic-not-performance-acceptance',
    };
  }

  if (!comparison)
    throw new TypeError(
      'Phased weather/effects requires either the exact 30s/60s/5-run comparison contract or the explicit 1s/60s/1-run producer diagnostic.',
    );
  return {
    mode: 'comparison',
    scenarios: ['idle', 'scripted-motion'],
    diagnosticOnly: false,
    performanceAcceptanceEligible: true,
    ineligibleReason: null,
  };
}
