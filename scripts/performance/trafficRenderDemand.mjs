const COMMIT_RE = /^[a-f0-9]{40}$/;
const HASH_RE = /^[a-f0-9]{64}$/;
export const TRAFFIC_PHASES = Object.freeze([
  'populated',
  'fading-retained-dots',
  'jam-heatlines',
  'high-altitude-clear',
  'return-arrival',
]);

function fail(message) {
  throw new Error(message);
}

function digest(value, label) {
  if (typeof value !== 'string' || !HASH_RE.test(value))
    fail(`Invalid ${label} SHA-256`);
}

function count(value, label, { min = 0 } = {}) {
  if (!Number.isSafeInteger(value) || value < min) fail(`Invalid ${label}`);
}

function validateCapture(capture, index) {
  const expected = TRAFFIC_PHASES[index];
  if (!capture || capture.name !== expected)
    fail(`Missing or out-of-order traffic capture: ${expected}`);
  count(capture.width, `${expected} width`, { min: 1 });
  count(capture.height, `${expected} height`, { min: 1 });
  digest(capture.pngSha256, `${expected} PNG`);
  const snapshot = capture.snapshot;
  if (!snapshot?.stats || !Array.isArray(snapshot.dots))
    fail(`Missing ${expected} rendered traffic snapshot`);
  count(snapshot.stats.count, `${expected} dot count`);
  count(snapshot.stats.heatLines, `${expected} heatline count`);
  if (snapshot.dots.length > snapshot.stats.count)
    fail(`Projected dot snapshot exceeds the population in ${expected}`);
  for (const dot of snapshot.dots) {
    if (
      typeof dot.roadKey !== 'string' ||
      typeof dot.id !== 'string' ||
      dot.id.length === 0 ||
      !Number.isFinite(dot.x) ||
      !Number.isFinite(dot.y) ||
      !Number.isFinite(dot.pixelSize) ||
      !Array.isArray(dot.color) ||
      dot.color.length !== 4 ||
      dot.color.some((value) => !Number.isFinite(value))
    )
      fail(`Invalid rendered dot evidence in ${expected}`);
  }
  if (
    !snapshot.renderSettings ||
    snapshot.renderSettings.viewport.width !== 1024 ||
    snapshot.renderSettings.viewport.height !== 768 ||
    snapshot.renderSettings.viewport.dpr !== 1 ||
    snapshot.renderSettings.drawingBuffer.width <= 0 ||
    snapshot.renderSettings.drawingBuffer.height <= 0 ||
    snapshot.renderSettings.msaaSamples !== 4 ||
    snapshot.renderSettings.contextAttributes?.antialias !== true ||
    snapshot.renderSettings.contextAttributes?.preserveDrawingBuffer !== true ||
    typeof snapshot.renderSettings.renderer !== 'string' ||
    typeof snapshot.renderSettings.maskedRenderer !== 'string'
  )
    fail(`Missing effective renderer settings in ${expected}`);
  const clock = snapshot.clock;
  if (
    !clock ||
    clock.shouldAnimate !== false ||
    !Number.isSafeInteger(clock.requestedEpochMs) ||
    typeof clock.currentTimeIso !== 'string' ||
    Date.parse(clock.currentTimeIso) !== clock.requestedEpochMs
  )
    fail(
      `Traffic fixture clock was not frozen at the requested time in ${expected}`,
    );
  if (
    expected !== 'high-altitude-clear' &&
    (snapshot.stats.count < 1 || snapshot.dots.length < 1)
  )
    fail(`Traffic population is empty in ${expected}`);
  if (
    expected === 'fading-retained-dots' &&
    snapshot.stats.fadingVisibleDots < 1
  )
    fail('The retained-dot capture does not contain a visible fade');
  if (expected === 'jam-heatlines' && snapshot.stats.heatLines < 1)
    fail('The jam capture has no classified heatline geometry');
  if (expected === 'high-altitude-clear' && snapshot.stats.count !== 0)
    fail('Traffic dots remained after the high-altitude clear');
}

function validateHeatlineVisualWitness(witness, captures) {
  const inlineImage = /^data:image\/png;base64,[A-Za-z0-9+/]+=*$/.test(
    witness?.noHeatlineControlImagePng || '',
  );
  const externallyVerifiedImage =
    typeof witness?.noHeatlineControlImagePath === 'string' &&
    witness.noHeatlineControlImagePath.trim() !== '' &&
    witness.externalPixelVerification?.method === 'sharp.ensureAlpha().raw()' &&
    witness.externalPixelVerification.changedPixels === witness.changedPixels;
  if (
    !witness ||
    witness.sameRenderedDots !== true ||
    !Number.isSafeInteger(witness.changedPixels) ||
    witness.changedPixels < 1 ||
    typeof witness.heatlinePngSha256 !== 'string' ||
    typeof witness.noHeatlineControlPngSha256 !== 'string' ||
    !(inlineImage || externallyVerifiedImage) ||
    !witness.noHeatlineControlSnapshot ||
    witness.sameSnapshotStatsExceptHeatlineSettings !== true
  )
    fail('Missing visible heatline-only pixel control');
  digest(witness.heatlinePngSha256, 'heatline control PNG');
  digest(witness.noHeatlineControlPngSha256, 'no-heatline control PNG');
  const primary = captures.find((capture) => capture.name === 'jam-heatlines');
  if (
    !primary ||
    JSON.stringify(primary.snapshot.dots) !==
      JSON.stringify(witness.noHeatlineControlSnapshot.dots)
  )
    fail('Heatline control changed dot identity, projection, size or style');
  const heatlineStats = { ...primary.snapshot.stats };
  const noHeatlineStats = { ...witness.noHeatlineControlSnapshot.stats };
  delete heatlineStats.heatLines;
  delete heatlineStats.jamViz;
  delete noHeatlineStats.heatLines;
  delete noHeatlineStats.jamViz;
  if (
    JSON.stringify(heatlineStats) !== JSON.stringify(noHeatlineStats) ||
    JSON.stringify(primary.snapshot.camera) !==
      JSON.stringify(witness.noHeatlineControlSnapshot.camera) ||
    JSON.stringify(primary.snapshot.renderSettings) !==
      JSON.stringify(witness.noHeatlineControlSnapshot.renderSettings)
  )
    fail('Heatline visual control changed unrelated rendered scene inputs');
  const before = witness.heatlineParamsBefore;
  const requested = witness.controlParamsRequested;
  const effective = witness.controlParamsEffective;
  const restored = witness.restoredParams;
  const effectiveRestored = witness.effectiveRestoredParams;
  if (
    before?.jamViz !== 'heatline' ||
    !Number.isFinite(before.densityScale) ||
    requested?.jamViz !== 'none' ||
    !Number.isFinite(requested.densityScale) ||
    effective?.jamViz !== 'none' ||
    !Number.isFinite(effective.densityScale) ||
    effective.densityScale !==
      Math.max(0.2, Math.min(2.5, requested.densityScale)) ||
    restored?.jamViz !== before.jamViz ||
    restored?.densityScale !== before.densityScale ||
    effectiveRestored?.jamViz !== before.jamViz ||
    effectiveRestored?.densityScale !== before.densityScale
  )
    fail('Heatline control parameters were not auditable or restored');
}

function validateRendererEvidence(evidence) {
  const classification = evidence?.classification;
  const graphics = evidence?.browserGraphicsInfo;
  if (
    !['native-gpu', 'apple-paravirtual-metal'].includes(classification?.kind) ||
    classification.accelerationVerified !== true ||
    graphics?.featureStatus?.webgl !== 'enabled' ||
    typeof evidence.renderer !== 'string' ||
    evidence.renderer.trim() === ''
  )
    fail('Traffic comparison did not verify accelerated WebGL rendering');
}

export function validateTrafficRenderDemandRun(input, expected = {}) {
  const report = input;
  if (!report || report.schema !== 'gev-traffic-render-demand/v1')
    fail('Unsupported traffic render-demand report');
  if (!['baseline', 'candidate'].includes(report.mode))
    fail('Invalid traffic implementation label');
  if (expected.mode && report.mode !== expected.mode)
    fail('Traffic implementation label mismatch');
  if (report.status !== 'passed' || report.error)
    fail(`Traffic fixture failed: ${report.error?.message || 'unknown error'}`);
  if (!COMMIT_RE.test(report.appCommit || ''))
    fail('Traffic fixture has no injected application commit');
  if (expected.expectedCommit && report.appCommit !== expected.expectedCommit)
    fail('Traffic fixture application commit mismatch');
  validateRendererEvidence(report.rendererEvidence);
  if (
    report.captures.some(
      (capture) =>
        capture.snapshot.renderSettings.renderer !==
        report.rendererEvidence.renderer,
    )
  )
    fail('Capture renderer identity changed during a traffic trial');
  if (!report.fixtureSurface || report.fixtureSurface.noNetworkSource !== true)
    fail('Traffic fixture surface is not a local deterministic asset');
  digest(report.fixtureSurface.glbSha256, 'fixture GLB');
  digest(report.fixtureSurface.tilesetJsonSha256, 'fixture tileset JSON');
  if (report.fixtureSurface.kind !== 'generated-local-3d-tiles-1.1-plane')
    fail('Unexpected traffic fixture surface');
  if (
    !Array.isArray(report.fixtureSurface.renderedReadyContent) ||
    !report.fixtureSurface.renderedReadyContent.some(
      (content) =>
        content?.ready === true && content.type === 'Model3DTileContent',
    ) ||
    report.fixtureSurface.renderedReadyContentOverflow !== false ||
    !Number.isSafeInteger(
      report.fixtureSurface.renderedReadyContentPostRenderFrame,
    ) ||
    report.fixtureSurface.renderedReadyContentPostRenderFrame < 1
  )
    fail(
      'Local surface readiness was not observed as visible content on a completed frame',
    );
  if (!report.environment || report.environment.cesiumVersion !== '1.138.0')
    fail('Unexpected Cesium runtime');
  if (
    report.environment.viewport?.width !== 1024 ||
    report.environment.viewport?.height !== 768 ||
    report.environment.viewport?.dpr !== 1
  )
    fail('Traffic fixture viewport settings differ');
  if (
    report.environment.renderMode !== true ||
    report.environment.msaaSamples !== 4 ||
    report.environment.clockShouldAnimate !== false
  )
    fail('Traffic fixture effective render settings differ');
  const idle = report.phases?.find(
    (phase) => phase.name === 'enabled-empty-high-altitude-idle',
  );
  if (
    !idle ||
    !Number.isFinite(idle.elapsedMs) ||
    idle.elapsedMs < 9_999 ||
    idle.elapsedMs > 10_500
  )
    fail('Traffic empty-idle measurement did not observe ten seconds');
  count(idle.frames, 'traffic empty-idle frame count');
  if (report.mode === 'candidate' && idle.frames > 2)
    fail('Candidate rendered more than two empty-idle frames');
  if (report.mode === 'baseline' && idle.frames <= 2)
    fail('Baseline control did not exhibit its continuous empty-idle frames');
  if (
    !Array.isArray(idle.holds) ||
    (report.mode === 'candidate' &&
      (idle.holds.includes('traffic') ||
        idle.governorMode !== 'idle' ||
        idle.requestRenderMode !== true)) ||
    (report.mode === 'baseline' &&
      (!idle.holds.includes('traffic') ||
        idle.governorMode !== 'continuous' ||
        idle.requestRenderMode !== false))
  )
    fail('Traffic empty-idle render ownership does not match its mode');
  const arrival = report.phases.find(
    (phase) => phase.name === 'arrival-natural-frame',
  );
  if (
    !arrival ||
    arrival.noCaptureWakeBeforeFirstPopulation !== true ||
    arrival.captureCountBefore !== 0 ||
    !Number.isFinite(arrival.sourceResolvedAt) ||
    !Number.isFinite(arrival.firstPopulationFrame?.at) ||
    arrival.sourceResolvedAt > arrival.firstPopulationFrame.at ||
    arrival.firstPopulationFrame.count < 1
  )
    fail('Arrival was not observed on a natural frame after source resolution');
  if (
    !Array.isArray(report.captures) ||
    report.captures.length !== TRAFFIC_PHASES.length
  )
    fail('Traffic fixture did not produce all five captures');
  report.captures.forEach(validateCapture);
  validateHeatlineVisualWitness(report.heatlineVisualWitness, report.captures);
  const abort = report.phases.find(
    (phase) => phase.name === 'disable-pending-request',
  );
  if (
    !abort ||
    abort.abortedBefore !== true ||
    abort.countAfterLateResponse !== 0 ||
    abort.holdsAfterLateResponse?.includes('traffic')
  )
    fail(
      'Disabled traffic accepted a late source response or retained its hold',
    );
  const teardown = report.phases.find(
    (phase) => phase.name === 'disable-reinitialize-destroy',
  );
  if (
    !teardown ||
    teardown.holds?.includes('traffic') ||
    !Number.isSafeInteger(teardown.primitiveCount)
  )
    fail('Traffic owner reinitialization/cleanup evidence is incomplete');
  if (
    report.cleanup?.viewerDestroyed !== true ||
    report.cleanup?.listenersRemoved !== true ||
    report.cleanup?.governorUninstalled !== true
  )
    fail('Traffic fixture cleanup did not complete');
  return report;
}

export function compareTrafficRenderDemandRuns(
  baselineInput,
  candidateInput,
  expected = {},
) {
  const baseline = validateTrafficRenderDemandRun(baselineInput, {
    expectedCommit: expected.baselineCommit,
    mode: 'baseline',
  });
  const candidate = validateTrafficRenderDemandRun(candidateInput, {
    expectedCommit: expected.candidateCommit,
    mode: 'candidate',
  });
  if (
    baseline.fixtureSurface.glbSha256 !== candidate.fixtureSurface.glbSha256 ||
    baseline.fixtureSurface.tilesetJsonSha256 !==
      candidate.fixtureSurface.tilesetJsonSha256 ||
    JSON.stringify(baseline.environment.viewport) !==
      JSON.stringify(candidate.environment.viewport) ||
    baseline.environment.renderMode !== candidate.environment.renderMode ||
    baseline.environment.msaaSamples !== candidate.environment.msaaSamples ||
    baseline.environment.cesiumVersion !== candidate.environment.cesiumVersion
  )
    fail('A/B fixture assets or renderer inputs differ');
  if (
    baseline.rendererEvidence.classification.kind !==
      candidate.rendererEvidence.classification.kind ||
    baseline.rendererEvidence.renderer !==
      candidate.rendererEvidence.renderer ||
    JSON.stringify(baseline.rendererEvidence.browserGraphicsInfo) !==
      JSON.stringify(candidate.rendererEvidence.browserGraphicsInfo)
  )
    fail('Accelerated renderer evidence differs between implementations');
  const phases = TRAFFIC_PHASES.map((name, index) => {
    const left = baseline.captures[index];
    const right = candidate.captures[index];
    if (
      left.pngSha256 !== right.pngSha256 ||
      JSON.stringify(left.snapshot) !== JSON.stringify(right.snapshot)
    )
      fail(`Traffic rendered output differs in ${name}`);
    return {
      name,
      pngSha256: left.pngSha256,
      dotCount: left.snapshot.stats.count,
      heatLines: left.snapshot.stats.heatLines,
    };
  });
  const comparableHeatlineWitness = (witness) => {
    const {
      noHeatlineControlImagePng,
      noHeatlineControlImagePath,
      externalPixelVerification,
      ...evidence
    } = witness;
    return evidence;
  };
  if (
    JSON.stringify(
      comparableHeatlineWitness(baseline.heatlineVisualWitness),
    ) !==
    JSON.stringify(comparableHeatlineWitness(candidate.heatlineVisualWitness))
  )
    fail('Heatline visual control differs between implementations');
  if (candidate.phases[0].frames > 2 || baseline.phases[0].frames <= 2)
    fail('Traffic empty-state frame-count comparison is not discriminating');
  return {
    schema: 'gev-traffic-render-demand-comparison/v1',
    baselineCommit: baseline.appCommit,
    candidateCommit: candidate.appCommit,
    baselineIdleFrames: baseline.phases[0].frames,
    candidateIdleFrames: candidate.phases[0].frames,
    idleElapsedMs: candidate.phases[0].elapsedMs,
    phases,
  };
}
