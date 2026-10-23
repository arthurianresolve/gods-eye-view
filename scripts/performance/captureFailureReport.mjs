import { Buffer } from 'node:buffer';
import { randomUUID } from 'node:crypto';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const MAX_CAPTURE_FAILURE_REPORT_BYTES = 256 * 1024;
export const MAX_CAPTURE_FIXTURE_INTERCEPTION_ERRORS = 8;

/** Write a bounded failure artifact, optionally refreshing it atomically. */
export async function writeCaptureFailureReportFile(
  filePath,
  json,
  { refresh = false } = {},
) {
  if (typeof filePath !== 'string' || !filePath || typeof json !== 'string')
    throw new TypeError('Capture failure report path and JSON are required.');
  if (Buffer.byteLength(json, 'utf8') > MAX_CAPTURE_FAILURE_REPORT_BYTES)
    throw new Error('Bounded capture failure report exceeded its hard limit.');
  const resolvedPath = path.resolve(filePath);
  await mkdir(path.dirname(resolvedPath), { recursive: true });
  if (!refresh) {
    await writeFile(resolvedPath, json, 'utf8');
    return;
  }
  const temporaryPath = `${resolvedPath}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporaryPath, json, { encoding: 'utf8', flag: 'wx' });
    await rename(temporaryPath, resolvedPath);
  } catch (error) {
    await rm(temporaryPath, { force: true }).catch(() => {});
    throw error;
  }
}

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

/** Preserve the bounded weather-phase context when the generic message is compacted. */
export function extractBoundedWeatherPhaseContext(message) {
  const text = String(message ?? '');
  const prefix = text.match(
    /^Weather phase [A-Za-z0-9][A-Za-z0-9._-]{0,63} was missing, late or wrong\. context=|^Weather timeline no longer has the three pinned phases\. context=/,
  );
  if (!prefix) return null;
  const payload = text.slice(prefix[0].length);
  if (payload.length > 4096) return null;
  try {
    const value = JSON.parse(payload);
    if (!value || typeof value !== 'object' || Array.isArray(value))
      return null;
    const boundedTime = (entry) =>
      typeof entry === 'string' &&
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(entry)
        ? entry
        : null;
    const boundedTimes = (entry) =>
      Array.isArray(entry) && entry.length === 3
        ? entry.map((time) => boundedTime(time))
        : null;
    const result = {
      expectedSourceTimes: boundedTimes(value.expectedSourceTimes),
      observedSourceTimes: boundedTimes(value.observedSourceTimes),
      elapsedMs: Number.isFinite(value.elapsedMs) ? value.elapsedMs : null,
      phase:
        value.phase && typeof value.phase === 'object'
          ? {
              id:
                typeof value.phase.id === 'string' &&
                /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(value.phase.id)
                  ? value.phase.id
                  : null,
              offsetMs: Number.isFinite(value.phase.offsetMs)
                ? value.phase.offsetMs
                : null,
            }
          : null,
      deadline:
        value.deadline && typeof value.deadline === 'object'
          ? {
              elapsedMs: Number.isFinite(value.deadline.elapsedMs)
                ? value.deadline.elapsedMs
                : null,
              absoluteMs: Number.isFinite(value.deadline.absoluteMs)
                ? value.deadline.absoluteMs
                : null,
            }
          : null,
      clock:
        value.clock && typeof value.clock === 'object'
          ? {
              mode: ['history', 'latest'].includes(value.clock.mode)
                ? value.clock.mode
                : null,
              target: boundedTime(value.clock.target),
              playing:
                typeof value.clock.playing === 'boolean'
                  ? value.clock.playing
                  : null,
            }
          : null,
      slider:
        value.slider && typeof value.slider === 'object'
          ? {
              value:
                typeof value.slider.value === 'string' &&
                /^\d{1,8}$/.test(value.slider.value)
                  ? value.slider.value
                  : null,
              max:
                typeof value.slider.max === 'string' &&
                /^\d{1,8}$/.test(value.slider.max)
                  ? value.slider.max
                  : null,
            }
          : null,
      fixtureSha256:
        typeof value.fixtureSha256 === 'string' &&
        /^[a-f0-9]{64}$/.test(value.fixtureSha256)
          ? value.fixtureSha256
          : null,
    };
    if (
      !result.expectedSourceTimes ||
      !result.observedSourceTimes ||
      !result.phase ||
      !result.deadline ||
      !result.clock ||
      !result.slider ||
      !result.fixtureSha256
    )
      return null;
    if (value.transition && typeof value.transition === 'object') {
      const boundedCount = (entry) =>
        Number.isSafeInteger(entry) && entry >= 0 && entry <= 10_000_000
          ? entry
          : null;
      const boundedBoolean = (entry) =>
        typeof entry === 'boolean' ? entry : null;
      const ids = ['weather-radar', 'weather-satellite', 'weather-lightning'];
      result.transition = {
        dispatchedAtElapsedMs: Number.isFinite(
          value.transition.dispatchedAtElapsedMs,
        )
          ? value.transition.dispatchedAtElapsedMs
          : null,
        dispatchCompletedAtElapsedMs: Number.isFinite(
          value.transition.dispatchCompletedAtElapsedMs,
        )
          ? value.transition.dispatchCompletedAtElapsedMs
          : null,
        globeTilesLoaded: boundedBoolean(value.transition.globeTilesLoaded),
        layers: ids.map((id, index) => {
          const entry = Array.isArray(value.transition.layers)
            ? value.transition.layers[index]
            : null;
          const layer = entry?.id === id ? entry : null;
          return {
            id,
            loading: boundedBoolean(layer?.loading),
            hidden: boundedBoolean(layer?.hidden),
            time: boundedTime(layer?.time),
            pendingTiles: boundedCount(layer?.pendingTiles),
            deferredTiles: boundedCount(layer?.deferredTiles),
            loadedTiles: boundedCount(layer?.loadedTiles),
            imageryCount: boundedCount(layer?.imageryCount),
            hasError: boundedBoolean(layer?.hasError),
          };
        }),
      };
    }
    return result;
  } catch {
    return null;
  }
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

const FOREGROUND_DIAGNOSTIC_KEYS = [
  'schema',
  'category',
  'runnerExited',
  'runnerTimedOut',
  'runnerKilled',
  'runnerExitCode',
  'runnerSignal',
  'runnerErrorCode',
  'browserPid',
  'windowHandleAvailable',
  'windowHandleSource',
  'handlePollAttempts',
  'inputAttached',
  'showWindowAccepted',
  'bringWindowToTopAccepted',
  'setForegroundAccepted',
  'foregroundConfirmed',
  'foregroundPid',
  'foregroundProcessName',
  'desktopState',
  'status',
];

/** Preserve only the bounded, non-secret foreground activation contract. */
export function sanitizeForegroundActivationDiagnostic(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const output = {};
  for (const key of FOREGROUND_DIAGNOSTIC_KEYS) {
    if (!Object.hasOwn(value, key)) continue;
    const entry = value[key];
    if (entry === null) output[key] = null;
    else if (typeof entry === 'boolean') output[key] = entry;
    else if (Number.isSafeInteger(entry)) output[key] = entry;
    else if (typeof entry === 'string' && entry.length <= 128)
      output[key] = safeText(entry, 128);
  }
  return Object.keys(output).length ? output : null;
}

/** Return the same redacted, depth- and collection-bounded projection used by
 * failure artifacts. Callers still enforce their serialized byte cap. */
export function boundCaptureReportEvidence(value) {
  const state = { truncated: false };
  return {
    value: boundedValue(value, 0, new WeakSet(), state),
    truncated: state.truncated,
  };
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

function compactOversizedSection(value, label) {
  const output = {
    evidenceOmittedReason: `${label}-exceeded-bounded-failure-report-budget`,
  };
  if (!value || typeof value !== 'object') return output;
  const retainedKeys = [];
  for (const [key, entry] of Object.entries(value)) {
    if (retainedKeys.length >= 32) break;
    if (
      entry === null ||
      typeof entry === 'boolean' ||
      (typeof entry === 'number' && Number.isFinite(entry)) ||
      (typeof entry === 'string' && entry.length <= 256)
    ) {
      output[key] = boundedValue(entry);
      retainedKeys.push(key);
    } else if (
      Array.isArray(entry) &&
      entry.length <= 32 &&
      entry.every((item) => typeof item === 'string' && item.length <= 128)
    ) {
      output[key] = [...entry];
      retainedKeys.push(key);
    }
  }
  output.retainedKeyCount = retainedKeys.length;
  output.omittedKeyCount = Math.max(
    0,
    Object.keys(value).length - retainedKeys.length,
  );
  return output;
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
  fixtureInterceptionErrors = [],
} = {}) {
  const weatherPhaseContext = extractBoundedWeatherPhaseContext(
    error?.message || error,
  );
  const boundedState = { truncated: false };
  if (
    Array.isArray(fixtureInterceptionErrors) &&
    fixtureInterceptionErrors.length > MAX_CAPTURE_FIXTURE_INTERCEPTION_ERRORS
  )
    boundedState.truncated = true;
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
      ...(weatherPhaseContext
        ? {
            weatherPhaseContext,
          }
        : {}),
      operator: errorOperator ? safeText(errorOperator, 32) : null,
      ...(sanitizeForegroundActivationDiagnostic(error?.foregroundActivation)
        ? {
            foregroundActivation: sanitizeForegroundActivationDiagnostic(
              error.foregroundActivation,
            ),
          }
        : {}),
      actual: boundedValue(errorActual, 0, new WeakSet(), boundedState),
      expected: boundedValue(errorExpected, 0, new WeakSet(), boundedState),
    },
    fixtureDelivery: boundedValue(
      fixtureDelivery,
      0,
      new WeakSet(),
      boundedState,
    ),
    ...(Array.isArray(fixtureInterceptionErrors) &&
    fixtureInterceptionErrors.length
      ? {
          fixtureInterceptionErrors: boundedValue(
            fixtureInterceptionErrors.slice(
              0,
              MAX_CAPTURE_FIXTURE_INTERCEPTION_ERRORS,
            ),
            0,
            new WeakSet(),
            boundedState,
          ),
        }
      : {}),
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
  if (reportBytes() > MAX_CAPTURE_FAILURE_REPORT_BYTES) {
    report.workload = compactOversizedSection(workload, 'workload');
    report.fixtureDelivery = compactOversizedSection(
      fixtureDelivery,
      'fixture-delivery',
    );
    report.failure.actual = undefined;
    report.failure.expected = undefined;
    truncated = true;
  }
  if (reportBytes() > MAX_CAPTURE_FAILURE_REPORT_BYTES) {
    report.progress.completedSamples = [];
    report.progress.startupSamples = [];
    report.progress.completedSamplesRetained = 0;
    report.progress.startupSamplesRetained = 0;
    report.progress.current = current
      ? { phase: safeText(current.phase || '', 80) }
      : null;
    truncated = true;
  }
  report.evidenceTruncated = truncated;
  if (reportBytes() > MAX_CAPTURE_FAILURE_REPORT_BYTES)
    throw new Error('Bounded capture failure report exceeded its hard limit.');
  return report;
}
