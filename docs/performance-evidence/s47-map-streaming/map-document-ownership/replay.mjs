import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { validateCaptureCliReport } from '../../../../scripts/qa-performance-build-smoke.mjs';
import {
  MAP_FIXTURE_BUILD_PROFILE_ID,
  resolveMapFixtureBuildProfile,
} from '../../../../scripts/performance/buildProvenance.mjs';
import { createDeterministicMapStreamingFixture } from '../../../../scripts/performance/mapStreamingFixture.mjs';
import { validateMapStreamingCaptureReport } from '../../../../scripts/performance/mapStreamingCapture.mjs';
import { MAP_STREAMING_WORKLOAD_ID } from '../../../../scripts/performance/mapStreamingWorkloadContract.mjs';
import { NATIVE_MACOS_DIAGNOSTIC_BACKEND } from '../../../../scripts/performance/hostedRendererBackend.mjs';

const raw = await readFile(
  new URL(
    '../native-v4-38416400160/performance-build-smoke.json.capture-cli-report-candidate.json',
    import.meta.url,
  ),
);
const reportSha256 = createHash('sha256').update(raw).digest('hex');
assert.equal(raw.byteLength, 392710);
assert.equal(
  reportSha256,
  'eedb5df55316c6460a3ff6837d7a125c626695fc4f9dad5c1dd8eb1e076dc0c9',
);
const report = JSON.parse(raw.toString('utf8'));
const fixture = await createDeterministicMapStreamingFixture();
const profile = resolveMapFixtureBuildProfile(MAP_FIXTURE_BUILD_PROFILE_ID);
const expected = {
  appSha: 'f50565a094d583820a661849d9b888c5a65b0ae8',
  harnessSha: 'f50565a094d583820a661849d9b888c5a65b0ae8',
  receiptSha256:
    '75ed45c818840e8d1dd7628541dcf14cff2f7e3b18a506390a1c73f5fc00d331',
  providerFixture: MAP_STREAMING_WORKLOAD_ID,
  workerAuditMode: 'diagnostic',
  captureRendererBackend: NATIVE_MACOS_DIAGNOSTIC_BACKEND,
  mapStreamingFixture: fixture,
  mapStreamingBuildProfile: profile,
  warmupMs: 1000,
  durationPerSampleMs: 1000,
  validateMapStreamingCapture(capture) {
    validateMapStreamingCaptureReport(capture, { fixture, profile });
  },
};
if (process.argv.includes('--expect-old-failure')) {
  assert.throws(
    () => validateCaptureCliReport(report, expected),
    /Every owned capture document must have exactly one cleanup record/,
  );
  console.log(
    JSON.stringify({ originalMismatchReproduced: true, reportSha256 }),
  );
} else {
  const result = validateCaptureCliReport(report, expected);
  assert.equal(result.status, 'passed');
  assert.equal(result.comparisonEligible, false);
  const cases = [
    ['missing cleanup', (r) => r.workload.rendererProbeCleanup.pop()],
    [
      'duplicate cleanup',
      (r) =>
        r.workload.rendererProbeCleanup.push(
          structuredClone(r.workload.rendererProbeCleanup[1]),
        ),
    ],
    [
      'wrong cleanup owner',
      (r) => (r.workload.rendererProbeCleanup[1].documentId = 'wrong'),
    ],
    [
      'unconfirmed main retirement',
      (r) =>
        (r.workload.rendererProbeCleanup[1].document.renderLoopRetirement.confirmed = false),
    ],
    ['missing sample owner', (r) => delete r.captures[0].documentId],
    [
      'wrong sample owner',
      (r) => (r.captures[0].documentId = 'provider-document-1'),
    ],
    [
      'wrong sample role',
      (r) => (r.captures[0].documentRole = 'provider-sample-1'),
    ],
    ['duplicate sample key', (r) => (r.captures[1].run = 1)],
    [
      'missing worker owner',
      (r) => r.source.buildProvenance.pageAssetAudit.workerAuditDocuments.pop(),
    ],
    [
      'duplicate diagnostic owner',
      (r) =>
        r.performanceDiagnostics.documents.push(
          structuredClone(r.performanceDiagnostics.documents[1]),
        ),
    ],
    [
      'wrong delivery owner',
      (r) =>
        (r.workload.mapStreamingCapture.documentDeliveries[1].documentId =
          'wrong'),
    ],
    ['missing release', (r) => r.workload.fixtureInterceptionReleases.pop()],
    [
      'hardware qualification claim',
      (r) => (r.environment.hardwareEligible = true),
    ],
    ['comparison eligibility claim', (r) => (r.comparisonEligible = true)],
  ];
  const rejectedMutations = cases.map(([name, mutate]) => {
    const changed = structuredClone(report);
    mutate(changed);
    assert.throws(
      () => validateCaptureCliReport(changed, expected),
      undefined,
      name,
    );
    return name;
  });
  console.log(
    JSON.stringify(
      {
        scope: 'CPU validator replay only; original hosted run remains failed',
        reportSha256,
        reportBytes: raw.byteLength,
        validatorStatus: result.status,
        comparisonEligible: result.comparisonEligible,
        captureCount: report.captures.length,
        rejectedMutations,
      },
      null,
      2,
    ),
  );
}
