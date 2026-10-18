import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

const SHA256 = /^[a-f0-9]{64}$/i;
const SHA1 = /^[a-f0-9]{40}$/i;
const BASELINE_SHA = 'e7a878e168bc97ffedddc27e13bf3e69b7ee6256';
const CANDIDATE_SHA = '19065997a3f6360d68cb9ed5b389c4754856b596';
const ROUTE_ID = 'austin-operating-city-route-v1';

function digest(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function evidence(input, label) {
  if (!input || typeof input !== 'object') throw new TypeError(`${label} evidence is required.`);
  const bytes = input.bytes ?? input.rawBytes ?? input.sourceBytes;
  if (!(typeof bytes === 'string' || Buffer.isBuffer(bytes)))
    throw new TypeError(`${label} raw bytes are required for hash recomputation.`);
  const value = input.value ?? input.report ?? input.data;
  if (!value || typeof value !== 'object') throw new TypeError(`${label} parsed report is required.`);
  return { value, sha256: digest(Buffer.from(bytes)) };
}

function fail(message) { throw new Error(`Idle cadence disposition rejected: ${message}`); }
function equal(actual, expected, message) { if (JSON.stringify(actual) !== JSON.stringify(expected)) fail(message); }
function finite(value) { return typeof value === 'number' && Number.isFinite(value); }

function appSha(report) {
  return report?.environment?.appCommit ?? report?.environment?.identity?.appCommit ?? report?.identity?.appCommit ?? report?.appCommit ?? null;
}

function nativeSettings(report) {
  return report?.environment?.nativeSharpnessProfile ?? report?.environment?.settings?.nativeSharpnessProfile ?? report?.profile ?? null;
}

function renderer(report) {
  return {
    renderer: report?.environment?.renderer ?? report?.environment?.identity?.renderer ?? report?.identity?.renderer ?? null,
    vendor: report?.environment?.vendor ?? report?.environment?.identity?.vendor ?? report?.identity?.vendor ?? null,
    userAgent: report?.environment?.userAgent ?? report?.environment?.identity?.userAgent ?? report?.identity?.userAgent ?? null,
    viewport: report?.environment?.viewport ?? report?.environment?.identity?.viewport ?? report?.identity?.viewport ?? null,
    drawingBuffer: report?.environment?.drawingBuffer ?? report?.environment?.identity?.drawingBuffer ?? report?.identity?.drawingBuffer ?? null,
  };
}

function assertNatural(side, label, expectedHold) {
  const samples = side.samples;
  if (!Array.isArray(samples) || samples.length < 2) fail(`${label} natural samples are missing.`);
  for (const sample of samples) {
    if (sample.visibility !== 'visible' || sample.focused !== true) fail(`${label} sample is not visible and focused.`);
    const gpu = sample.wind?.gpu;
    if (sample.wind?.paused !== false || gpu?.ready !== true || gpu.heightFade !== 0 || gpu.visibleCells !== 0)
      fail(`${label} natural wind state is not the declared parked-view state.`);
    if (!sample.satelliteWitness || !finite(sample.satelliteWitness.latitude) || !finite(sample.satelliteWitness.longitude)) fail(`${label} satellite witness is missing.`);
  }
  const holds = new Set(samples.flatMap((sample) => sample.renderGovernor?.holds ?? []));
  const scheduled = new Set(samples.flatMap((sample) => sample.renderGovernor?.scheduledUpdates ?? []));
  if (expectedHold && !holds.has(expectedHold)) fail(`${label} expected continuous hold is missing.`);
  if (!expectedHold && holds.has('cctv-projection')) fail(`${label} still CCTV continuous hold remains.`);
  if (!scheduled.has('satellites-periodic')) fail(`${label} satellite periodic scheduler is missing.`);
  if (!expectedHold && !scheduled.has('cctv-still')) fail(`${label} still CCTV scheduler is missing.`);
  const witnesses = samples.map((sample) => sample.satelliteWitness).filter(Boolean);
  const first = witnesses[0];
  if (!first || !witnesses.some((row) => row.latitude !== first.latitude || row.longitude !== first.longitude))
    fail(`${label} satellite witness did not move.`);
}

function assertElevated(side, label) {
  const probe = side.windVisibilityProbe;
  const first = probe?.first;
  const second = probe?.second;
  const a = first?.diagnostics?.gpu;
  const b = second?.diagnostics?.gpu;
  if (probe?.status !== 'observed' || !a || !b || a.ready !== true || b.ready !== true || a.visibleCells <= 0 || b.visibleCells <= 0)
    fail(`${label} elevated wind visibility was not observed.`);
  if (!finite(first.material?.phaseTime) || !finite(second.material?.phaseTime) || second.material.phaseTime <= first.material.phaseTime)
    fail(`${label} elevated wind phase did not advance.`);
  if (a.visibleCells !== b.visibleCells || a.visibleVertexCount !== b.visibleVertexCount || a.heightFade !== b.heightFade)
    fail(`${label} elevated wind geometry/opacity changed.`);
  if (!Array.isArray(second.postRender?.intervals) || second.postRender.intervals.length < 1)
    fail(`${label} elevated completed-frame witness is missing.`);
}

/**
 * Validate the one known Austin idle-cadence investigation disposition.
 * This only resolves the inter-render interval metric; it is not a visual or
 * motion acceptance result. All hashes are recomputed from supplied bytes.
 */
export function validateIdleCadenceDisposition({ disposition, diagnostic, baseline, candidate } = {}) {
  const d = evidence(diagnostic, 'diagnostic');
  const b = evidence(baseline, 'baseline');
  const c = evidence(candidate, 'candidate');
  if (disposition?.schema !== 'gev-idle-cadence-disposition/v1' || disposition.scenario !== 'idle') fail('schema or scenario is unsupported.');
  if (disposition.workloadId !== 'austin-operating-v1' || disposition.routeId !== ROUTE_ID) fail('workload or route is unsupported.');
  if (!SHA1.test(disposition.baselineAppSha || '') || !SHA1.test(disposition.candidateAppSha || '') || disposition.baselineAppSha !== BASELINE_SHA || disposition.candidateAppSha !== CANDIDATE_SHA) fail('application identities are not the frozen Austin pair.');
  if (!SHA256.test(disposition.baselineRawSha256 || '') || disposition.baselineRawSha256 !== b.sha256 || !SHA256.test(disposition.candidateRawSha256 || '') || disposition.candidateRawSha256 !== c.sha256 || !SHA256.test(disposition.diagnosticSha256 || '') || disposition.diagnosticSha256 !== d.sha256) fail('raw report or diagnostic hash does not match supplied bytes.');
  const report = d.value;
  if (report.schema !== 'gev-austin-operating-render-demand-diagnostic/v1' || report.status !== 'diagnostic-non-comparable' || report.comparable !== false) fail('diagnostic schema/status is invalid.');
  if (report.identities?.baselineCommit !== BASELINE_SHA || report.identities?.candidateCommit !== CANDIDATE_SHA) fail('diagnostic identities are invalid.');
  const sides = Object.fromEntries((report.sides || []).map((side) => [side.label, side]));
  if (!sides.baseline || !sides.candidate) fail('both diagnostic sides are required.');
  if (sides.baseline.appSha !== BASELINE_SHA || sides.candidate.appSha !== CANDIDATE_SHA) fail('diagnostic side identities are invalid.');
  equal(report.fixture?.route?.id, ROUTE_ID, 'fixture route differs.');
  equal(report.fixture?.route?.altitudeM, 12000, 'fixture route altitude differs.');
  equal(report.fixture?.visualState?.qualityMode, 'manual', 'quality mode differs.');
  equal(report.fixture?.visualState?.detectionMode, 'DENSE', 'detection mode differs.');
  equal(report.fixture?.visualState?.densityPct, 75, 'density differs.');
  const rb = renderer(sides.baseline.final?.performanceSnapshot ?? sides.baseline.environment ?? sides.baseline.environment);
  const rc = renderer(sides.candidate.final?.performanceSnapshot ?? sides.candidate.environment ?? sides.candidate.environment);
  equal(rb, rc, 'renderer/browser/native dimensions differ.');
  equal(nativeSettings(sides.baseline), nativeSettings(sides.candidate), 'native sharpness settings differ.');
  assertNatural(sides.baseline, 'baseline', 'cctv-projection');
  assertNatural(sides.candidate, 'candidate', null);
  assertElevated(sides.baseline, 'baseline');
  assertElevated(sides.candidate, 'candidate');
  for (const [label, side] of Object.entries(sides)) if (side.teardown?.errors?.length) fail(`${label} cleanup reported errors.`);
  return { resolvedScenarios: ['idle'], metric: 'frame-interval-p95-ms', classification: 'intentional-demand-cadence-change', visualAcceptance: 'not-assessed', motionAcceptance: 'not-assessed' };
}
