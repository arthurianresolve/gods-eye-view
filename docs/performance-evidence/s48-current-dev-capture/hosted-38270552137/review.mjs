import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = process.argv[2] || path.dirname(fileURLToPath(import.meta.url));
const expectedCommit = '73018ec58d578401789de49ecb29cfec41a8bf72';
const artifacts = [];
function read(name) {
  const bytes = readFileSync(path.join(root, name));
  const entry = {
    file: name,
    bytes: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  };
  artifacts.push(entry);
  return { value: JSON.parse(bytes), ...entry };
}
const { value: outer } = read('performance-build-smoke.json');
const raw = read(
  'performance-build-smoke.json.capture-cli-report-candidate.json',
);
const report = raw.value;
const { value: run } = read('run.json');
const candidate = outer.variants.find((item) => item.label === 'candidate');
assert.equal(run.headSha, expectedCommit);
assert.equal(run.status, 'completed');
assert.equal(run.conclusion, 'failure');
assert.equal(outer.status, 'failed');
assert.equal(outer.candidateSha, expectedCommit);
assert.equal(outer.harnessSha, expectedCommit);
assert.equal(candidate.status, 'failed');
assert.match(candidate.failure, /^Child process timed out;/);
assert.equal(candidate.captureCliReportArtifact.sha256, raw.sha256);
assert.equal(candidate.captureCliReportArtifact.byteLength, raw.bytes);
assert.equal(report.status, 'failed');
assert.equal(report.source.appCommit, expectedCommit);
assert.equal(report.source.harnessCommit, expectedCommit);
assert.equal(report.source.buildProvenance.after, null);
assert.equal(report.progress.completedSampleCount, 4);
assert.equal(report.progress.completedSamplesRetained, 2);
assert.equal(report.failure.scenario, 'selected-aircraft-tracking');
assert.equal(report.failure.phase, 'warmup');

const profiles = report.workload.providerSampleCpuProfiles.profiles.map(
  (window) => {
    const key = `provider-${window.targetScenario}-${window.targetRun}`;
    const { value: index } = read(`${key}-cpu-profile-ref.json`);
    assert.deepEqual(index.profile, window.profile);
    assert.equal(index.profile.status, 'complete');
    assert.deepEqual(index.profile.profilerErrors, []);
    const artifact = read(index.profile.fileName);
    assert.equal(artifact.sha256, index.profile.sha256);
    assert.equal(artifact.bytes, index.profile.byteLength);
    const profile = artifact.value.profile;
    assert.equal(profile.samples.length, profile.timeDeltas.length);
    const nodes = new Map(profile.nodes.map((node) => [node.id, node]));
    const weights = new Map();
    let totalUs = 0;
    profile.samples.forEach((id, i) => {
      assert.ok(nodes.has(id));
      const delta = profile.timeDeltas[i];
      assert.ok(Number.isFinite(delta) && delta >= 0);
      totalUs += delta;
      const label = nodes.get(id).callFrame.functionName || '(anonymous)';
      weights.set(label, (weights.get(label) || 0) + delta);
    });
    return {
      scenario: window.targetScenario,
      run: window.targetRun,
      status: window.status,
      samples: profile.samples.length,
      windowMs: (profile.endTime - profile.startTime) / 1000,
      sampledDeltaMs: totalUs / 1000,
      topLeafWeightsMs: Object.fromEntries(
        [...weights]
          .sort((a, b) => b[1] - a[1])
          .slice(0, 12)
          .map(([name, value]) => [name, value / 1000]),
      ),
    };
  },
);
assert.equal(profiles.length, 3);
const summary = {
  schema: 'gev-s48-current-dev-hosted-review/v1',
  testedCommit: expectedCommit,
  runUrl: run.url,
  captureStatus: 'failed',
  performanceAcceptanceEligible: false,
  failure: outer.failure,
  childFailure: report.failure,
  interpretation:
    'The outer 180-second child deadline initiates owned-process shutdown. The inner warmup sees Target closed before its 6000 ms deadline. This does not independently establish a tracking, application or GPU fault.',
  completedSampleCount: report.progress.completedSampleCount,
  retainedCompletedSamples: report.progress.completedSamples.map((sample) => ({
    scenario: sample.scenario,
    run: sample.run,
    renderedFrameCount: sample.renderedFrameCount,
    durationMs: sample.durationMs,
    totalObjects: sample.totalObjects,
    quality: sample.quality,
    foregroundThroughout: sample.foregroundThroughout,
  })),
  failedBoundary: report.progress.current.warmupBoundaryObservation,
  preCaptureAssets: report.source.buildProvenance.before,
  postCaptureAssets: report.source.buildProvenance.after,
  startupEnvironment: report.progress.startupSamples.map((sample) => ({
    userAgent: sample.userAgent,
    renderer: sample.renderer,
    viewport: sample.viewport,
    drawingBuffer: sample.drawingBuffer,
  })),
  probeCleanups: report.workload.rendererProbeCleanup.map((item) => ({
    phase: item.phase,
    confirmed: item.confirmed,
    elapsedMs: item.elapsedMs,
    documentStatus: item.document.status,
    scriptStatus: item.scriptRegistration.status,
  })),
  fixtureReleases: report.workload.fixtureInterceptionReleases.map((item) => ({
    documentRole: item.documentRole,
    confirmed: item.confirmed,
    targetClosed: item.targetClosed,
    pendingCommandsAfterDrain: item.stop.pendingCommandsAfterDrain,
    pendingPreparationsAfterDrain: item.stop.pendingPreparationsAfterDrain,
    pendingAbortSubscriptionsAfterDrain:
      item.stop.pendingAbortSubscriptionsAfterDrain,
  })),
  profiles,
  profileInterpretation:
    'Statistical main-thread leaf weights include native waits, idle and GC; not precise CPU execution or measured GPU duration. No matched performance benefit is established.',
  depthPicks: report.workload.depthPickAttribution.samples.map((sample) => ({
    scenario: sample.scenario,
    run: sample.run,
    cleanupConfirmed: sample.cleanupConfirmed,
    rows: (
      sample.measurementBoundary?.rows ||
      sample.warmupBoundary?.rows ||
      []
    ).map((row) => ({
      kind: row.kind,
      caller: row.caller,
      pickElapsedMs: row.pickElapsedMs,
      cacheHit: row.cacheHit,
      completedRenderRevision: row.completedRenderRevision,
    })),
  })),
  artifacts,
};
writeFileSync(
  path.join(root, 'review.json'),
  `${JSON.stringify(summary, null, 2)}\n`,
);
console.log(
  JSON.stringify({
    status: 'failed-capture-preserved',
    completedSamples: 4,
    profiles,
  }),
);
