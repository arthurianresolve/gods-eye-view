import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';

const HEX_40 = /^[a-f0-9]{40}$/;
const HEX_64 = /^[a-f0-9]{64}$/;

function fail(message) {
  throw new Error(`Overlay attribution pair ${message}.`);
}

function isCount(value, maximum) {
  return Number.isSafeInteger(value) && value >= 0 && value <= maximum;
}

function validPopulation(population, profile, entryCount) {
  if (profile === 'phase6-detection')
    return (
      population?.kind === 'detection-observations' &&
      population.profile === 'DENSE' &&
      population.densityPct === 100 &&
      isCount(population.observationCount, entryCount) &&
      isCount(population.candidateCount, entryCount) &&
      isCount(population.visibleCount, entryCount) &&
      isCount(population.selectedCount, entryCount) &&
      isCount(population.collectiveLabelBudget, entryCount) &&
      Number.isSafeInteger(population.solveRevision) &&
      population.observationCount > 0 &&
      population.candidateCount <= population.observationCount &&
      population.selectedCount <= population.visibleCount &&
      population.selectedCount <= population.collectiveLabelBudget
    );
  if (
    population?.kind !== 'world-overlay' ||
    !isCount(population.candidateCount, entryCount) ||
    !isCount(population.paintedCount, entryCount) ||
    population.paintedCount > population.candidateCount ||
    !population.paintedBySource ||
    typeof population.paintedBySource !== 'object' ||
    Array.isArray(population.paintedBySource) ||
    !Array.isArray(population.workloadSourceIds) ||
    population.workloadSourceIds.length === 0 ||
    !population.workloadSourceIds.every(
      (sourceId) => typeof sourceId === 'string' && sourceId.length > 0,
    ) ||
    new Set(population.workloadSourceIds).size !==
      population.workloadSourceIds.length
  )
    return false;
  const paintedEntries = Object.entries(population.paintedBySource);
  return (
    paintedEntries.every(
      ([sourceId, count]) =>
        population.workloadSourceIds.includes(sourceId) &&
        isCount(count, entryCount),
    ) &&
    paintedEntries.reduce((sum, [, count]) => sum + count, 0) ===
      population.paintedCount
  );
}

/** Validate two isolated arms share the same deterministic owner and frame path. */
export function compareOverlayAttributionArms(disabled, enabled) {
  if (
    disabled?.schema !== 'gev-overlay-cpu-arm/v1' ||
    enabled?.schema !== 'gev-overlay-cpu-arm/v1' ||
    disabled.status !== 'complete' ||
    enabled.status !== 'complete' ||
    disabled.timingEnabled !== false ||
    enabled.timingEnabled !== true
  )
    fail('is missing a complete disabled/enabled arm');

  for (const key of ['sourceCommit', 'profile', 'entryCount', 'pairIndex'])
    if (disabled[key] !== enabled[key]) fail(`has mismatched ${key}`);
  if (!HEX_40.test(disabled.sourceCommit)) fail('has an invalid source commit');
  if (
    !/^[a-z0-9-]{1,48}$/.test(disabled.profile) ||
    !Number.isSafeInteger(disabled.entryCount) ||
    disabled.entryCount < 1 ||
    disabled.entryCount > 5_000 ||
    !Number.isSafeInteger(disabled.pairIndex) ||
    disabled.pairIndex < 0 ||
    disabled.pairIndex >= 5
  )
    fail('has invalid workload identity');

  if (
    disabled.fixture?.schema !== 'gev-overlay-attribution-fixture/v1' ||
    !HEX_64.test(disabled.fixture.sha256) ||
    !disabled.fixture.descriptor ||
    disabled.fixture.descriptor.sourceCommit !== disabled.sourceCommit ||
    disabled.fixture.descriptor.profile !== disabled.profile ||
    disabled.fixture.descriptor.entryCount !== disabled.entryCount ||
    disabled.fixture.descriptor.pairIndex !== disabled.pairIndex ||
    createHash('sha256')
      .update(JSON.stringify(disabled.fixture.descriptor))
      .digest('hex') !== disabled.fixture.sha256 ||
    !isDeepStrictEqual(disabled.fixture, enabled.fixture)
  )
    fail('does not share a valid fixture identity');
  const descriptor = disabled.fixture.descriptor;
  if (
    descriptor.schema !== 'gev-overlay-attribution-fixture/v1' ||
    descriptor.viewportWidth !== 1_600 ||
    descriptor.viewportHeight !== 900 ||
    descriptor.dpr !== 2 ||
    descriptor.frameMs !== 16 ||
    descriptor.virtualStartTimeMs !== 0 ||
    !Number.isSafeInteger(descriptor.solveIntervalMs) ||
    descriptor.solveIntervalMs < 1 ||
    !Number.isSafeInteger(descriptor.warmupFrames) ||
    descriptor.warmupFrames < 1 ||
    !Number.isSafeInteger(descriptor.settleFrames) ||
    descriptor.settleFrames < 0 ||
    !Number.isSafeInteger(descriptor.measuredFrames) ||
    descriptor.measuredFrames < 1 ||
    descriptor.cameraPath !== 'fixed-scene-camera' ||
    descriptor.motionPath !== 'seeded-sinusoidal-frame-v1'
  )
    fail('does not match the declared camera, motion and frame fixture');

  for (const boundary of ['start', 'end']) {
    const left = disabled[boundary];
    const right = enabled[boundary];
    if (
      !left ||
      !right ||
      !Number.isSafeInteger(left.frame) ||
      !Number.isSafeInteger(left.virtualTimeMs) ||
      left.frame !== right.frame ||
      left.virtualTimeMs !== right.virtualTimeMs ||
      !validPopulation(
        left.population,
        disabled.profile,
        disabled.entryCount,
      ) ||
      !validPopulation(right.population, enabled.profile, enabled.entryCount) ||
      !isDeepStrictEqual(left.population, right.population)
    )
      fail(`has mismatched ${boundary} frame or population`);
  }

  const frames = disabled.fixture.descriptor?.measuredFrames;
  if (
    !Number.isSafeInteger(frames) ||
    frames < 1 ||
    disabled.end.frame - disabled.start.frame !== frames ||
    disabled.end.virtualTimeMs - disabled.start.virtualTimeMs !==
      frames * descriptor.frameMs ||
    disabled.start.frame !==
      descriptor.warmupFrames + descriptor.settleFrames ||
    disabled.start.virtualTimeMs !== disabled.start.frame * descriptor.frameMs
  )
    fail('does not match its declared measured frame interval');

  for (const arm of [disabled, enabled])
    if (
      !Number.isFinite(arm.cpuMs) ||
      arm.cpuMs <= 0 ||
      arm.frames !== frames ||
      !Number.isFinite(arm.cpuMsPerFrame) ||
      arm.cpuMsPerFrame !== arm.cpuMs / frames
    )
      fail('has invalid CPU timing');

  if (
    disabled.cpuTimings !== null ||
    enabled.cpuTimings?.enabled !== true ||
    enabled.cpuTimings.scope !== 'synchronous-application-cpu' ||
    enabled.cpuTimings.overflow !== false ||
    !Array.isArray(enabled.cpuTimings.series) ||
    enabled.cpuTimings.series.length === 0
  )
    fail('has invalid instrumentation mode or timing diagnostics');

  return {
    pairIndex: disabled.pairIndex,
    profile: disabled.profile,
    entryCount: disabled.entryCount,
    fixtureSha256: disabled.fixture.sha256,
    frames,
    disabledCpuMsPerFrame: disabled.cpuMsPerFrame,
    enabledCpuMsPerFrame: enabled.cpuMsPerFrame,
    instrumentationRatio: enabled.cpuMsPerFrame / disabled.cpuMsPerFrame - 1,
    population: disabled.end.population,
  };
}
