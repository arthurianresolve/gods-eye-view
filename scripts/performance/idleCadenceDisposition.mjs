import { createHash } from 'node:crypto';

const SHA256 = /^[a-f0-9]{64}$/i;
const SHA1 = /^[a-f0-9]{40}$/i;
const BASELINE_SHA = 'e7a878e168bc97ffedddc27e13bf3e69b7ee6256';
const CANDIDATE_SHA = '19065997a3f6360d68cb9ed5b389c4754856b596';
const CURRENT_CANDIDATE_SHA = 'd8ef90024db6e6f1c96b5645c24b85586f9e337a';
// Each candidate needs its own complete diagnostic and original raw pair.
// Admitting the current revision never reuses or relabels the historical one.
const DIAGNOSTIC_CANDIDATES = new Set([CANDIDATE_SHA, CURRENT_CANDIDATE_SHA]);
const ROUTE_ID = 'austin-operating-city-route-v1';
const MAX_DIAGNOSTIC_BYTES = 4 * 1024 * 1024;
// Full five-run raw reports retain per-frame evidence and are intentionally
// larger than the compact diagnostic. Keep their parser bound explicit.
const MAX_RAW_CAPTURE_REPORT_BYTES = 32 * 1024 * 1024;

function digest(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function evidence(input, label) {
  if (!input || typeof input !== 'object')
    throw new TypeError(`${label} evidence is required.`);
  const bytes = input.bytes;
  const limit =
    label === 'diagnostic'
      ? MAX_DIAGNOSTIC_BYTES
      : MAX_RAW_CAPTURE_REPORT_BYTES;
  if (Buffer.isBuffer(bytes) && bytes.length > limit)
    throw new RangeError(
      `${label} raw bytes exceed the ${limit / (1024 * 1024)} MiB bound.`,
    );
  if (typeof bytes === 'string' && Buffer.byteLength(bytes) > limit)
    throw new RangeError(
      `${label} raw bytes exceed the ${limit / (1024 * 1024)} MiB bound.`,
    );
  if (!(typeof bytes === 'string' || Buffer.isBuffer(bytes)))
    throw new TypeError(
      `${label} raw bytes are required for hash recomputation.`,
    );
  let value;
  try {
    value = JSON.parse(Buffer.from(bytes).toString('utf8'));
  } catch {
    throw new TypeError(`${label} raw bytes are not valid JSON.`);
  }
  if (!value || typeof value !== 'object')
    throw new TypeError(`${label} parsed report is required.`);
  return { value, sha256: digest(Buffer.from(bytes)) };
}

function fail(message) {
  throw new Error(`Idle cadence disposition rejected: ${message}`);
}
function equal(actual, expected, message) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) fail(message);
}
function finite(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function captureProfile(report) {
  return (
    report?.captures?.[0]?.settings?.before?.nativeSharpnessProfile ?? null
  );
}

function renderer(report) {
  return {
    renderer:
      report?.environment?.renderer ??
      report?.environment?.identity?.renderer ??
      report?.identity?.renderer ??
      null,
    vendor:
      report?.environment?.vendor ??
      report?.environment?.identity?.vendor ??
      report?.identity?.vendor ??
      null,
    userAgent:
      report?.environment?.userAgent ??
      report?.environment?.identity?.userAgent ??
      report?.identity?.userAgent ??
      null,
    viewport:
      report?.environment?.viewport ??
      report?.environment?.identity?.viewport ??
      report?.identity?.viewport ??
      null,
    drawingBuffer:
      report?.environment?.drawingBuffer ??
      report?.environment?.identity?.drawingBuffer ??
      report?.identity?.drawingBuffer ??
      null,
  };
}

function assertNatural(side, label, expectedHold) {
  const samples = side.samples;
  if (!Array.isArray(samples) || samples.length < 2)
    fail(`${label} natural samples are missing.`);
  for (const sample of samples) {
    if (
      !finite(sample.at) ||
      sample.renderGovernor?.installed !== true ||
      sample.renderGovernor.mode !== (expectedHold ? 'continuous' : 'idle')
    )
      fail(`${label} sample timing/governor state is invalid.`);
    if (sample.visibility !== 'visible' || sample.focused !== true)
      fail(`${label} sample is not visible and focused.`);
    const gpu = sample.wind?.gpu;
    if (
      sample.wind?.paused !== false ||
      gpu?.ready !== true ||
      gpu.heightFade !== 0 ||
      gpu.visibleVertexCount !== 0 ||
      gpu.visibleCells !== 0
    )
      fail(
        `${label} natural wind state is not the declared parked-view state.`,
      );
    if (
      !sample.satelliteWitness ||
      !finite(sample.satelliteWitness.latitude) ||
      !finite(sample.satelliteWitness.longitude)
    )
      fail(`${label} satellite witness is missing.`);
  }
  if (
    samples.some(
      (sample, index) => index > 0 && sample.at <= samples[index - 1].at,
    )
  )
    fail(`${label} natural sample times are not increasing.`);
  const phases = samples
    .map((sample) => sample.windMaterial?.phaseTime)
    .filter((value) => value !== null && value !== undefined);
  if (
    phases.some((value) => !finite(value)) ||
    phases.some((value, index) => index > 0 && value !== phases[index - 1])
  )
    fail(`${label} parked wind phase changed unexpectedly.`);
  const expectedHolds = expectedHold ? [expectedHold] : [];
  const expectedScheduled = expectedHold
    ? ['satellites-periodic']
    : ['cctv-still', 'satellites-periodic'];
  for (const sample of samples) {
    equal(
      [...(sample.renderGovernor?.holds ?? [])].sort(),
      expectedHolds,
      `${label} hold set differs.`,
    );
    equal(
      [...new Set(sample.renderGovernor?.scheduledUpdates ?? [])].sort(),
      expectedScheduled,
      `${label} scheduled demand set differs.`,
    );
  }
  const witnesses = samples
    .map((sample) => sample.satelliteWitness)
    .filter(Boolean);
  const first = witnesses[0];
  if (
    !first ||
    !witnesses.some(
      (row) =>
        row.latitude !== first.latitude || row.longitude !== first.longitude,
    )
  )
    fail(`${label} satellite witness did not move.`);
}

function assertElevated(side, label) {
  const probe = side.windVisibilityProbe;
  const first = probe?.first;
  const second = probe?.second;
  const a = first?.diagnostics?.gpu;
  const b = second?.diagnostics?.gpu;
  if (
    probe?.status !== 'observed' ||
    probe.intervention !== 'elevated-60000m-after-natural-observation' ||
    !a ||
    !b ||
    a.ready !== true ||
    b.ready !== true ||
    !Number.isInteger(a.visibleCells) ||
    a.visibleCells <= 0 ||
    !Number.isInteger(b.visibleCells) ||
    b.visibleCells <= 0 ||
    !Number.isInteger(a.visibleVertexCount) ||
    a.visibleVertexCount <= 0 ||
    !Number.isInteger(b.visibleVertexCount) ||
    b.visibleVertexCount <= 0 ||
    !finite(a.heightFade) ||
    a.heightFade <= 0 ||
    a.heightFade > 1 ||
    !finite(b.heightFade) ||
    b.heightFade <= 0 ||
    b.heightFade > 1 ||
    !finite(first.at) ||
    !finite(second.at) ||
    second.at - first.at < 5000
  )
    fail(`${label} elevated wind visibility was not observed.`);
  if (
    !finite(first.material?.phaseTime) ||
    !finite(second.material?.phaseTime) ||
    second.material.phaseTime <= first.material.phaseTime
  )
    fail(`${label} elevated wind phase did not advance.`);
  if (
    a.visibleCells !== b.visibleCells ||
    a.visibleVertexCount !== b.visibleVertexCount ||
    a.heightFade !== b.heightFade
  )
    fail(`${label} elevated wind geometry/opacity changed.`);
  if (
    !Array.isArray(second.postRender?.intervals) ||
    second.postRender.intervals.length < 1 ||
    second.postRender.visibility !== 'visible' ||
    second.postRender.focused !== true ||
    second.postRender.intervals.some((value) => !finite(value) || value <= 0)
  )
    fail(`${label} elevated completed-frame witness is invalid.`);
}

/**
 * Validate the frozen Austin idle-cadence investigation contract.
 * This only resolves the inter-render interval metric; it is not a visual or
 * motion acceptance result. All hashes are recomputed from supplied bytes.
 */
export function validateIdleCadenceDisposition({
  disposition,
  diagnostic,
  baseline,
  candidate,
} = {}) {
  const d = evidence(diagnostic, 'diagnostic');
  const b = evidence(baseline, 'baseline');
  const c = evidence(candidate, 'candidate');
  if (
    disposition?.schema !== 'gev-idle-cadence-disposition/v1' ||
    disposition.scenario !== 'idle'
  )
    fail('schema or scenario is unsupported.');
  if (
    disposition.workloadId !== 'austin-operating-v1' ||
    disposition.routeId !== ROUTE_ID
  )
    fail('workload or route is unsupported.');
  if (
    !SHA1.test(disposition.baselineAppSha || '') ||
    !SHA1.test(disposition.candidateAppSha || '') ||
    disposition.baselineAppSha !== BASELINE_SHA ||
    !DIAGNOSTIC_CANDIDATES.has(disposition.candidateAppSha)
  )
    fail('application identities are not the frozen Austin pair.');
  const candidateSha = disposition.candidateAppSha;
  if (
    !SHA256.test(disposition.baselineRawSha256 || '') ||
    disposition.baselineRawSha256 !== b.sha256 ||
    !SHA256.test(disposition.candidateRawSha256 || '') ||
    disposition.candidateRawSha256 !== c.sha256 ||
    !SHA256.test(disposition.diagnosticSha256 || '') ||
    disposition.diagnosticSha256 !== d.sha256
  )
    fail('raw report or diagnostic hash does not match supplied bytes.');
  const report = d.value;
  if (
    report.schema !== 'gev-austin-operating-render-demand-diagnostic/v1' ||
    report.status !== 'diagnostic-non-comparable' ||
    report.comparable !== false
  )
    fail('diagnostic schema/status is invalid.');
  if (
    report.identities?.baselineCommit !== BASELINE_SHA ||
    report.identities?.candidateCommit !== candidateSha
  )
    fail('diagnostic identities are invalid.');
  if (
    !Array.isArray(report.sides) ||
    report.sides.length !== 2 ||
    new Set(report.sides.map((side) => side.label)).size !== 2
  )
    fail('exactly two unique diagnostic sides are required.');
  const sides = Object.fromEntries(
    report.sides.map((side) => [side.label, side]),
  );
  if (
    !sides.baseline ||
    !sides.candidate ||
    sides.baseline.status !== 'observed' ||
    sides.candidate.status !== 'observed'
  )
    fail('both diagnostic sides are required.');
  if (
    sides.baseline.appSha !== BASELINE_SHA ||
    sides.candidate.appSha !== candidateSha
  )
    fail('diagnostic side identities are invalid.');
  equal(report.fixture?.route?.id, ROUTE_ID, 'fixture route differs.');
  equal(
    report.fixture?.route?.altitudeM,
    12000,
    'fixture route altitude differs.',
  );
  equal(
    report.fixture?.visualState?.qualityMode,
    'manual',
    'quality mode differs.',
  );
  equal(
    report.fixture?.visualState?.detectionMode,
    'DENSE',
    'detection mode differs.',
  );
  equal(report.fixture?.visualState?.densityPct, 75, 'density differs.');
  const assertRaw = (raw, label, expectedSha) => {
    const workload = raw.workload ?? {};
    const appCommit = raw.appCommit ?? raw.environment?.appCommit;
    if (
      appCommit !== expectedSha ||
      workload.providerFixture !== 'austin-operating-v1' ||
      workload.fixtureId !== 'austin-operating-composed-v1' ||
      workload.qualityMode !== 'manual' ||
      workload.detectionMode !== 'DENSE' ||
      workload.expectedDensityPct !== 75 ||
      raw.environment?.focused !== true ||
      raw.environment?.visible !== true
    )
      fail(`${label} raw application identity or fixture contract differs.`);
    const info = renderer(raw);
    if (
      !info.renderer ||
      !info.vendor ||
      !info.userAgent ||
      !info.viewport ||
      !info.drawingBuffer
    )
      fail(`${label} raw renderer evidence is missing.`);
    const captures = raw.captures;
    if (!Array.isArray(captures) || captures.length < 2)
      fail(`${label} raw capture boundaries are missing.`);
    const profiles = captures.flatMap((capture) => [
      capture.settings?.before?.nativeSharpnessProfile,
      capture.settings?.after?.nativeSharpnessProfile,
    ]);
    if (profiles.some((value) => !value))
      fail(`${label} raw native profile boundary is missing.`);
    const profile = profiles[0];
    for (const value of profiles) {
      equal(value, profile, `${label} raw native profile boundaries differ.`);
      if (
        value.id !== 'native-sharpness-v1' ||
        value.useBrowserRecommendedResolution !== false ||
        value.resolutionScale !== 1 ||
        value.maximumScreenSpaceError !== 1 ||
        value.viewport?.width !== 1440 ||
        value.viewport?.height !== 900 ||
        value.viewport?.dpr !== 2 ||
        value.drawingBuffer?.width !== 2880 ||
        value.drawingBuffer?.height !== 1800
      )
        fail(`${label} raw native profile dimensions/settings are invalid.`);
    }
    if (
      !profile ||
      profile.id !== 'native-sharpness-v1' ||
      profile.useBrowserRecommendedResolution !== false ||
      profile.resolutionScale !== 1 ||
      profile.maximumScreenSpaceError !== 1
    )
      fail(`${label} raw native profile is missing.`);
    return info;
  };
  const rbRaw = b.value;
  const rcRaw = c.value;
  const rb = assertRaw(rbRaw, 'baseline', BASELINE_SHA);
  const rc = assertRaw(rcRaw, 'candidate', candidateSha);
  if (candidateSha === CURRENT_CANDIDATE_SHA) {
    const browserVersion = rbRaw.graphics?.browserVersion;
    if (!/^Chrome\/\d+\.\d+\.\d+\.\d+$/.test(browserVersion || ''))
      fail('current raw full browser version is missing.');
    if (
      rcRaw.graphics?.browserVersion !== browserVersion ||
      sides.baseline.graphics?.browserVersion !== browserVersion ||
      sides.candidate.graphics?.browserVersion !== browserVersion
    )
      fail('current diagnostic and raw full browser versions differ.');
  }
  equal(rb, rc, 'renderer/browser/native dimensions differ.');
  equal(
    captureProfile(rbRaw),
    captureProfile(rcRaw),
    'native sharpness settings differ.',
  );
  for (const [label, side] of Object.entries(sides)) {
    const sideIdentity = renderer(side.final?.performanceSnapshot ?? {});
    if (
      !sideIdentity.renderer ||
      !sideIdentity.vendor ||
      !sideIdentity.userAgent ||
      !sideIdentity.viewport ||
      !sideIdentity.drawingBuffer
    )
      fail(`${label} diagnostic renderer boundary is missing.`);
    equal(
      sideIdentity,
      label === 'baseline' ? rb : rc,
      `${label} diagnostic and raw renderer differ.`,
    );
    equal(
      side.profile,
      captureProfile(label === 'baseline' ? rbRaw : rcRaw),
      `${label} diagnostic and raw profile differ.`,
    );
    for (const sample of side.samples ?? []) {
      const settings = sample.performanceSnapshot?.settings;
      if (
        settings?.qualityMode !== 'manual' ||
        settings?.densityPct !== 75 ||
        settings?.detectionMode !== 'DENSE' ||
        sample.requestRenderMode !== (label === 'candidate') ||
        !sample.renderGovernor
      )
        fail(`${label} sample settings/render mode are missing.`);
    }
  }
  assertNatural(sides.baseline, 'baseline', 'cctv-projection');
  assertNatural(sides.candidate, 'candidate', null);
  assertElevated(sides.baseline, 'baseline');
  assertElevated(sides.candidate, 'candidate');
  for (const [label, side] of Object.entries(sides)) {
    if (
      side.rendererClassification?.accelerationVerified !== true ||
      !/UHD Graphics 620|UHD620/i.test(
        String(
          typeof side.renderer === 'string'
            ? side.renderer
            : (side.renderer?.renderer ?? ''),
        ),
      )
    )
      fail(`${label} native UHD620 graphics proof is missing.`);
    if (
      !Array.isArray(side.teardown?.cleanupErrors) ||
      side.teardown.cleanupErrors.length ||
      side.teardown?.errors?.length
    )
      fail(`${label} cleanup reported errors.`);
  }
  const bg = sides.baseline.windVisibilityProbe.first?.diagnostics?.gpu;
  const cg = sides.candidate.windVisibilityProbe.first?.diagnostics?.gpu;
  if (
    bg?.visibleCells !== cg?.visibleCells ||
    bg?.visibleVertexCount !== cg?.visibleVertexCount ||
    bg?.heightFade !== cg?.heightFade
  )
    fail('cross-side elevated wind geometry differs.');
  return {
    resolvedScenarios: ['idle'],
    metric: 'frame-interval-p95-ms',
    classification: 'intentional-demand-cadence-change',
    visualAcceptance: 'not-assessed',
    motionAcceptance: 'not-assessed',
  };
}
