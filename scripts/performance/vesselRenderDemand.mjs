import {
  FOCUS_UPDATE_MS,
  VISIBILITY_UPDATE_MS,
} from '../../src/layers/vessels/policy.js';

const HASH_RE = /^[a-f0-9]{64}$/;
const COMMIT_RE = /^[a-f0-9]{40}$/;
const PAIR_COUNT = 5;
const PAIRS = [
  { name: 'idleBefore', durationMs: 3000, minMs: 2700, maxMs: 3500 },
  { name: 'focusActive', durationMs: 800, minMs: 700, maxMs: 1100 },
  { name: 'focusRelease', durationMs: 1000, minMs: 900, maxMs: 1300 },
  { name: 'idleAfter', durationMs: 2000, minMs: 1800, maxMs: 2500 },
];

function validCount(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function validDigest(value) {
  return typeof value === 'string' && HASH_RE.test(value);
}

function phaseName(value, mode) {
  if (typeof value !== 'string') return null;
  const prefix = `${mode}-`;
  const name = value.startsWith(prefix) ? value.slice(prefix.length) : value;
  return (
    {
      'focus-active': 'focusActive',
      'focus-release': 'focusRelease',
      'idle-after': 'idleAfter',
    }[name] || name
  );
}

function validatePhase(phase, plan, population, mode) {
  if (!phase || phase.name !== plan.name)
    throw new Error(`Missing vessel render-demand phase: ${plan.name}`);
  if (
    !validCount(phase.completedFrames) ||
    phase.completedFrames < 1 ||
    !Number.isFinite(phase.elapsedMs) ||
    phase.elapsedMs < plan.minMs ||
    phase.elapsedMs > plan.maxMs ||
    !Number.isFinite(phase.startElapsedMs) ||
    !Number.isFinite(phase.endElapsedMs) ||
    phase.endElapsedMs <= phase.startElapsedMs ||
    phase.requestedDurationMs !== plan.durationMs
  )
    throw new Error(
      `Invalid vessel phase timing or rendered-frame evidence: ${plan.name}`,
    );
  if (
    !validCount(phase.visibleVesselCount) ||
    phase.visibleVesselCount !== population
  )
    throw new Error(`Vessel visible population changed in phase: ${plan.name}`);
  if (
    !validDigest(phase.rgbaSha256) ||
    !validCount(phase.nonBackgroundPixels) ||
    phase.nonBackgroundPixels < 1
  )
    throw new Error(`Missing non-background vessel pixels: ${plan.name}`);
  if (
    phase.frameOverflow !== false ||
    phase.alphaOverflow !== false ||
    !Number.isFinite(phase.minAlpha) ||
    phase.minAlpha < 0 ||
    phase.minAlpha > 255 ||
    !Number.isFinite(phase.endMinAlpha) ||
    phase.endMinAlpha < 0 ||
    phase.endMinAlpha > 255
  )
    throw new Error(`Invalid vessel alpha/frame observation: ${plan.name}`);
  if (plan.name === 'focusActive' && phase.minAlpha >= 245)
    throw new Error('Focused vessels were not observed dimmed');
  if (
    !validCount(phase.endDimmedVesselCount) ||
    phase.endDimmedVesselCount > population
  )
    throw new Error(`Invalid dimmed vessel count: ${plan.name}`);
  if (
    plan.name === 'focusActive' &&
    (phase.endDimmedVesselCount < 1 || phase.endMinAlpha >= 245)
  )
    throw new Error(
      'Focused vessels did not remain dimmed at the phase endpoint',
    );
  if (
    plan.name !== 'focusActive' &&
    (phase.endMinAlpha < 250 || phase.endDimmedVesselCount !== 0)
  )
    throw new Error(`Vessel focus alpha did not restore by ${plan.name}`);
  if (typeof phase.requestRenderModeAtEnd !== 'boolean')
    throw new Error(`Missing observed render mode: ${plan.name}`);
  if (phase.requestRenderModeAtEnd !== (mode === 'candidate'))
    throw new Error(`Unexpected governor render mode in phase: ${plan.name}`);
}

function validateRun(report, expected = {}) {
  if (!report || report.schema !== 'gev-vessel-render-demand/v1')
    throw new Error('Unsupported vessel render-demand report schema');
  if (!['control', 'candidate'].includes(report.mode))
    throw new Error('Invalid vessel render-demand mode');
  if (expected.mode && report.mode !== expected.mode)
    throw new Error('Vessel render-demand mode mismatch');
  if (report.status !== 'passed' || report.error || report.failedPhase)
    throw new Error('Vessel render-demand run did not complete successfully');
  if (
    !COMMIT_RE.test(expected.expectedCommit || '') ||
    report.applicationCommit !== expected.expectedCommit ||
    report.harnessCommit !== expected.expectedCommit
  )
    throw new Error('Vessel application or harness commit identity mismatch');
  if (
    !validCount(report.population) ||
    report.population < 2 ||
    !validDigest(report.fixtureSha256)
  )
    throw new Error('Vessel fixture population or identity is missing');
  if (
    !Number.isFinite(report.viewport?.width) ||
    report.viewport.width <= 0 ||
    !Number.isFinite(report.viewport?.height) ||
    report.viewport.height <= 0 ||
    !Number.isFinite(report.viewport?.devicePixelRatio) ||
    report.viewport.devicePixelRatio <= 0
  )
    throw new Error('Invalid vessel fixture viewport');
  if (
    !report.renderingSettings ||
    report.renderingSettings.requestRenderMode !== true ||
    report.renderingSettings.maximumRenderTimeChange !== 'Infinity' ||
    !Number.isFinite(report.renderingSettings.msaaSamples) ||
    !report.renderingSettings.contextAttributes ||
    report.renderingSettings.drawingBufferWidth !== report.viewport.width ||
    report.renderingSettings.drawingBufferHeight !== report.viewport.height ||
    report.renderingSettings.devicePixelRatio !==
      report.viewport.devicePixelRatio
  )
    throw new Error('Vessel rendering settings or drawing buffer are missing');
  if (!Array.isArray(report.phases) || report.phases.length !== PAIRS.length)
    throw new Error('Vessel fixture phase inventory is incomplete');
  for (let index = 0; index < PAIRS.length; index++)
    validatePhase(
      report.phases[index],
      PAIRS[index],
      report.population,
      report.mode,
    );
  if (report.mode === 'candidate') validateCandidateCadence(report);
  if (
    report.cleanup?.layerDestroyed !== true ||
    report.cleanup?.renderDemandDisposed !== true ||
    report.cleanup?.viewerDestroyed !== true ||
    report.cleanup?.governorUninstalled !== true
  )
    throw new Error('Vessel trial cleanup is incomplete');
  return report;
}

function validateCandidateCadence(report) {
  if (
    !Array.isArray(report.scheduledUpdates) ||
    !report.scheduledUpdates.length
  )
    throw new Error('Candidate did not report scheduled updates');
  if (
    !report.scheduledUpdates.every(
      (entry) =>
        Number.isFinite(entry.requestedDelayMs) &&
        entry.requestedDelayMs >= 0 &&
        (entry.completed === false
          ? entry.actualDelayMs === null &&
            entry.firedAt === null &&
            entry.firedPhase === null
          : entry.completed === true &&
            Number.isFinite(entry.actualDelayMs) &&
            entry.actualDelayMs >= 0 &&
            Number.isFinite(entry.firedAt)) &&
        ['setup', 'capture', ...PAIRS.map((phase) => phase.name)].includes(
          phaseName(entry.requestedPhase, report.mode),
        ) &&
        (entry.completed === false ||
          ['setup', 'capture', ...PAIRS.map((phase) => phase.name)].includes(
            phaseName(entry.firedPhase, report.mode),
          )),
    )
  )
    throw new Error('Candidate has invalid scheduled update timing');
  for (const entry of report.scheduledUpdates) {
    const name = phaseName(entry.requestedPhase, report.mode);
    // The release window includes its settled tail, when 800 ms is correct.
    // Actual release passes and restored alpha are checked independently below.
    const limit =
      name === 'focusActive' ? FOCUS_UPDATE_MS : VISIBILITY_UPDATE_MS;
    if (entry.requestedDelayMs > limit + 5)
      throw new Error(`Candidate requested delay exceeds ${name} policy`);
  }

  for (const [field, phases, minimum, maximumGapMs] of [
    ['visibilityPasses', ['idleBefore', 'idleAfter'], 2, null],
    ['focusPasses', ['focusActive', 'focusRelease'], 3, 250],
  ]) {
    const observations = report[field];
    if (
      !Array.isArray(observations) ||
      observations.length > 256 ||
      !observations.every(
        (entry) =>
          phases.includes(phaseName(entry?.phase, report.mode)) &&
          Number.isFinite(entry.elapsedMs),
      )
    )
      throw new Error(`Candidate has invalid observed ${field}`);
    for (const phase of phases) {
      const bounds = report.phases.find((entry) => entry.name === phase);
      const times = observations
        .filter((entry) => phaseName(entry.phase, report.mode) === phase)
        .map((entry) => entry.elapsedMs)
        .sort((a, b) => a - b);
      if (
        times.length < minimum ||
        times.some(
          (time) => time < bounds.startElapsedMs || time > bounds.endElapsedMs,
        )
      )
        throw new Error(`Candidate lacks observed ${phase} production passes`);
      if (
        maximumGapMs !== null &&
        times.slice(1).some((time, index) => time - times[index] > maximumGapMs)
      )
        throw new Error(`Candidate ${phase} production pass cadence stalled`);
    }
  }
}

export function validateVesselRenderDemandReport(
  report,
  { expectedCommit } = {},
) {
  if (
    !COMMIT_RE.test(expectedCommit || '') ||
    report?.applicationCommit !== expectedCommit ||
    report?.harnessCommit !== expectedCommit
  )
    throw new Error(
      'Vessel render-demand application or harness commit mismatch',
    );
  if (
    report?.schema !== 'gev-vessel-render-demand/v1' ||
    report.status !== 'passed' ||
    report.mode !== 'paired' ||
    report.error ||
    report.failedPhase
  )
    throw new Error('Vessel paired render-demand report is incomplete');
  if (
    typeof report.environment?.renderer !== 'string' ||
    !report.environment.renderer.trim()
  )
    throw new Error('Vessel report is missing observed renderer identity');
  if (
    report.environment?.graphics?.drawingBufferWidth !==
      report.viewport?.width ||
    report.environment?.graphics?.drawingBufferHeight !==
      report.viewport?.height ||
    !report.environment?.graphics?.contextAttributes ||
    JSON.stringify(report.environment.graphics.contextAttributes) !==
      JSON.stringify(report.renderingSettings?.contextAttributes)
  )
    throw new Error('Vessel observed graphics settings are incomplete');
  if (
    report.cadencePolicyMs?.idleVisibility !== VISIBILITY_UPDATE_MS ||
    report.cadencePolicyMs?.activeFocus !== FOCUS_UPDATE_MS
  )
    throw new Error('Vessel cadence policy identity is invalid');
  if (
    report.fixtureClock?.shouldAnimate !== false ||
    !Number.isFinite(report.fixtureClock?.epochMs) ||
    report.fixtureClock.epochMs !== report.fixtureEpochMs ||
    typeof report.scope !== 'string' ||
    !report.scope.includes('billboard-only')
  )
    throw new Error('Vessel fixture clock or measurement scope is missing');
  if (!Array.isArray(report.pairs) || report.pairs.length !== PAIR_COUNT)
    throw new Error('Vessel report must contain five paired trials');
  const pairIds = new Set();
  for (const [index, pair] of report.pairs.entries()) {
    if (
      !Number.isSafeInteger(pair?.pair) ||
      pair.pair !== index ||
      pairIds.has(pair.pair)
    )
      throw new Error('Vessel pair identities must be exactly 0 through 4');
    pairIds.add(pair.pair);
    const expectedOrder =
      pair.pair % 2 === 0 ? ['control', 'candidate'] : ['candidate', 'control'];
    if (pair.order?.join(',') !== expectedOrder.join(','))
      throw new Error(`Vessel pair ${pair.pair} is not alternating`);
    if (!Array.isArray(pair.runs) || pair.runs.length !== 2)
      throw new Error(`Vessel pair ${pair.pair} must contain two runs`);
    const control = pair.runs.find((run) => run.mode === 'control');
    const candidate = pair.runs.find((run) => run.mode === 'candidate');
    for (const run of pair.runs) {
      if (
        run.applicationCommit !== expectedCommit ||
        run.harnessCommit !== expectedCommit ||
        run.viewport?.width !== report.viewport?.width ||
        run.viewport?.height !== report.viewport?.height ||
        run.viewport?.devicePixelRatio !== report.viewport?.devicePixelRatio ||
        JSON.stringify(run.renderingSettings) !==
          JSON.stringify(report.renderingSettings)
      )
        throw new Error(
          `Vessel pair ${pair.pair} run commit identity or settings mismatch`,
        );
    }
    const compared = compareVesselRenderDemandRuns(control, candidate, {
      expectedCommit,
    });
    if (
      !Array.isArray(pair.comparison?.phaseResults) ||
      pair.comparison.phaseResults.length !== compared.phaseResults.length ||
      pair.comparison.phaseResults.some(
        (entry, item) =>
          entry.name !== compared.phaseResults[item].name ||
          entry.controlFrames !== compared.phaseResults[item].controlFrames ||
          entry.candidateFrames !==
            compared.phaseResults[item].candidateFrames ||
          entry.outputSha256 !== compared.phaseResults[item].outputSha256 ||
          entry.frameReduction !== compared.phaseResults[item].frameReduction,
      )
    )
      throw new Error(
        `Vessel pair ${pair.pair} comparison summary is inconsistent`,
      );
  }
  if (
    report.cleanup?.viewerDestroyed !== true ||
    report.cleanup?.governorUninstalled !== true ||
    report.cleanup?.viewerDestroyedCount !== PAIR_COUNT * 2 ||
    report.cleanup?.governorUninstalledCount !== PAIR_COUNT * 2
  )
    throw new Error('Vessel viewer cleanup is incomplete');
  return report;
}

export function compareVesselRenderDemandRuns(
  controlInput,
  candidateInput,
  expected = {},
) {
  const control = validateRun(controlInput, { ...expected, mode: 'control' });
  const candidate = validateRun(candidateInput, {
    ...expected,
    mode: 'candidate',
  });
  if (
    control.fixtureSha256 !== candidate.fixtureSha256 ||
    control.population !== candidate.population ||
    control.applicationCommit !== candidate.applicationCommit ||
    control.harnessCommit !== candidate.harnessCommit ||
    control.viewport.width !== candidate.viewport.width ||
    control.viewport.height !== candidate.viewport.height ||
    control.viewport.devicePixelRatio !== candidate.viewport.devicePixelRatio ||
    JSON.stringify(control.renderingSettings) !==
      JSON.stringify(candidate.renderingSettings)
  )
    throw new Error('Vessel control and candidate fixture inputs differ');
  const phaseResults = PAIRS.map((phase, index) => {
    const before = control.phases[index];
    const after = candidate.phases[index];
    if (before.name !== phase.name || after.name !== phase.name)
      throw new Error(`Vessel phase order mismatch: ${phase.name}`);
    if (
      before.visibleVesselCount !== after.visibleVesselCount ||
      before.rgbaSha256 !== after.rgbaSha256 ||
      before.nonBackgroundPixels !== after.nonBackgroundPixels
    )
      throw new Error(`Vessel rendered output differs in phase ${phase.name}`);
    const frameReduction =
      before.completedFrames > 0
        ? 1 - after.completedFrames / before.completedFrames
        : null;
    if (
      (phase.name === 'idleBefore' || phase.name === 'idleAfter') &&
      !(after.completedFrames < before.completedFrames)
    )
      throw new Error(
        `Candidate did not reduce repeated idle frames in ${phase.name}`,
      );
    return {
      name: phase.name,
      controlFrames: before.completedFrames,
      candidateFrames: after.completedFrames,
      frameReduction,
      outputSha256: before.rgbaSha256,
      visibleVesselCount: before.visibleVesselCount,
    };
  });
  return {
    schema: 'gev-vessel-render-demand-pair/v1',
    fixtureSha256: control.fixtureSha256,
    population: control.population,
    phaseResults,
    control,
    candidate,
  };
}
