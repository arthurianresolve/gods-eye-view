import { Buffer } from 'node:buffer';

export const MAX_CAPTURE_FAILURE_REPORT_BYTES = 256 * 1024;

const SENSITIVE_KEY =
  /^(?:url|body|bodybase64|payload|headers|authorization|token|password|secret|states|commandline)$/i;

function safeText(value, limit = 512) {
  return String(value ?? '')
    .replace(/https?:\/\/[^\s"'<>]+/gi, '[url]')
    .replace(/[A-Za-z]:\\[^\s"'<>]+/g, '[path]')
    .replace(
      /\b(token|password|secret|authorization)=([^&\s]+)/gi,
      '$1=[redacted]',
    )
    .slice(0, limit);
}

function boundedValue(value, depth = 0, seen = new WeakSet(), state = null) {
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') {
    if (value.length > 1024 && state) state.truncated = true;
    return safeText(value, 1024);
  }
  if (typeof value !== 'object') return undefined;
  if (depth >= 7) {
    if (state) state.truncated = true;
    return undefined;
  }
  if (seen.has(value)) {
    if (state) state.truncated = true;
    return '[circular]';
  }
  seen.add(value);
  if (Array.isArray(value)) {
    if (value.length > 256 && state) state.truncated = true;
    return value
      .slice(0, 256)
      .map((entry) => boundedValue(entry, depth + 1, seen, state));
  }
  const output = {};
  const entries = Object.entries(value);
  if (entries.length > 64 && state) state.truncated = true;
  for (const [key, entry] of entries.slice(0, 64)) {
    if (SENSITIVE_KEY.test(key)) continue;
    const bounded = boundedValue(entry, depth + 1, seen, state);
    if (bounded !== undefined) output[key] = bounded;
  }
  return output;
}

function sourceIdentity(source) {
  const provenance = source?.buildProvenance;
  const sha1 = (value) => (/^[a-f0-9]{40}$/.test(value || '') ? value : null);
  const sha256 = (value) => (/^[a-f0-9]{64}$/.test(value || '') ? value : null);
  const summary = (value) =>
    value && typeof value === 'object'
      ? {
          schema: safeText(value.schema, 80) || null,
          status: safeText(value.status, 80) || null,
          receiptSha256: sha256(value.receiptSha256),
          assetCount: Number.isInteger(value.assetCount)
            ? value.assetCount
            : null,
          totalAssetBytes: Number.isInteger(value.totalAssetBytes)
            ? value.totalAssetBytes
            : null,
        }
      : null;
  return {
    harnessCommit: sha1(source?.harnessCommit),
    harnessDirtyWorktree: source?.harnessDirtyWorktree ?? null,
    appCommit: sha1(source?.appCommit),
    appWorktreeState: safeText(source?.appWorktreeState, 32) || null,
    provenanceStatus: safeText(source?.provenanceStatus, 80) || null,
    reason: source?.reason ? safeText(source.reason, 240) : null,
    buildProvenance: provenance
      ? {
          schema: safeText(provenance.schema, 80) || null,
          status: safeText(provenance.status, 80) || null,
          scope: safeText(provenance.scope, 180) || null,
          receiptSha256: sha256(provenance.receiptSha256),
          appCommit: sha1(provenance.appCommit),
          harnessCommit: sha1(provenance.harnessCommit),
          before: summary(provenance.before),
          after: summary(provenance.after),
        }
      : null,
  };
}

/** Build a bounded failure-only artifact; it is not a capture report. */
export function createCaptureFailureReport({
  capturedAt = new Date().toISOString(),
  source,
  fixture,
  workload,
  phase,
  scenario = null,
  run = null,
  error,
  errorActual,
  errorExpected,
  errorOperator,
  current = null,
  startupSamples = [],
  completedSamples = [],
  fixtureDelivery = null,
} = {}) {
  const boundedState = { truncated: false };
  const fullCompleted = completedSamples
    .slice(-30)
    .map((sample) => boundedValue(sample, 0, new WeakSet(), boundedState));
  const fullStartup = startupSamples
    .slice(-5)
    .map((sample) => boundedValue(sample, 0, new WeakSet(), boundedState));
  const report = {
    schema: 'gev-performance-capture-failure/v1',
    captureSchema: 'gev-performance-capture/v1',
    status: 'failed',
    capturedAt: safeText(capturedAt, 48),
    comparisonEligible: false,
    comparisonReadiness: {
      status: 'not-ready',
      reason: 'Failed or incomplete captures are never comparison evidence.',
    },
    source: sourceIdentity(source),
    fixture: fixture
      ? {
          id: safeText(fixture.id, 100) || null,
          count: Number.isInteger(fixture.count) ? fixture.count : null,
          fixedTime: safeText(fixture.fixedTime, 32) || null,
          sha256: /^[a-f0-9]{64}$/.test(fixture.sha256 || '')
            ? fixture.sha256
            : null,
          byteLength: Number.isInteger(fixture.byteLength)
            ? fixture.byteLength
            : null,
        }
      : null,
    workload: boundedValue(workload, 0, new WeakSet(), boundedState),
    failure: {
      phase: safeText(phase || 'unknown', 80),
      scenario: scenario ? safeText(scenario, 80) : null,
      run: Number.isInteger(run) ? run : null,
      message: safeText(error?.message || error || 'Capture failed.', 512),
      operator: errorOperator ? safeText(errorOperator, 32) : null,
      actual: boundedValue(errorActual, 0, new WeakSet(), boundedState),
      expected: boundedValue(errorExpected, 0, new WeakSet(), boundedState),
    },
    fixtureDelivery: boundedValue(
      fixtureDelivery,
      0,
      new WeakSet(),
      boundedState,
    ),
    progress: {
      startupSampleCount: startupSamples.length,
      startupSamples: fullStartup,
      completedSampleCount: completedSamples.length,
      completedSamples: fullCompleted,
      current: boundedValue(current, 0, new WeakSet(), boundedState),
    },
    evidenceTruncated: boundedState.truncated,
  };

  report.progress.completedSamplesRetained =
    report.progress.completedSamples.length;
  report.progress.startupSamplesRetained =
    report.progress.startupSamples.length;
  const reportBytes = () =>
    Buffer.byteLength(`${JSON.stringify(report, null, 2)}\n`, 'utf8');
  let truncated = boundedState.truncated;
  while (
    reportBytes() > MAX_CAPTURE_FAILURE_REPORT_BYTES &&
    (report.progress.completedSamples.length ||
      report.progress.startupSamples.length)
  ) {
    if (report.progress.completedSamples.length)
      report.progress.completedSamples.shift();
    else report.progress.startupSamples.shift();
    truncated = true;
    report.progress.completedSamplesRetained =
      report.progress.completedSamples.length;
    report.progress.startupSamplesRetained =
      report.progress.startupSamples.length;
  }
  if (reportBytes() > MAX_CAPTURE_FAILURE_REPORT_BYTES) {
    report.progress.current = current
      ? {
          phase: safeText(current.phase || '', 80),
          beforeAvailable: Boolean(current.before),
          afterAvailable: Boolean(current.after),
          measurementAvailable: Boolean(current.measurement),
        }
      : null;
    report.failure.message = safeText(report.failure.message, 240);
    truncated = true;
  }
  report.evidenceTruncated = truncated;
  if (reportBytes() > MAX_CAPTURE_FAILURE_REPORT_BYTES)
    throw new Error('Bounded capture failure report exceeded its hard limit.');
  return report;
}
