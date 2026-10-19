#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createRenderedSoakDriver } from './qa-rendered-soak-driver.mjs';
import {
  evaluateSoakStability,
  FULL_SOAK_MS,
} from './performance/soakStability.mjs';
const DEFAULT_DURATION_MS = FULL_SOAK_MS;
const RETENTION_ANCHOR_MS = 30 * 60_000;
// Match the stability gate's bounded checkpoint-gap allowance twice: once for
// a late first anchor and once for atomic cycle completion after its target.
const MAX_RETENTION_ANCHORED_EXTENSION_MS = 2 * 12 * 60_000;

export function resolveNativeResolutionFlag(args = process.argv) {
  return args.includes('--native-resolution');
}

export function resolveExpectedApplicationCommit(value, harnessCommit) {
  const commit = String(value || harnessCommit || '').trim();
  if (!/^[a-f0-9]{40}$/.test(commit))
    throw new TypeError('Expected application commit must be a full SHA.');
  return commit;
}

/** Preserve owned cleanup evidence when driver creation fails before measurement. */
export function createSoakSetupFailureReport(error) {
  const report = {
    operationStatus: 'failed',
    error: error?.message || 'Rendered soak setup failed.',
    datacenterFixtureProtocol: 'cdp-fetch-fulfilled-hash-count-v1',
    fullSoak: false,
    hardwareRenderingValidated: false,
    stability: {
      status: 'pending',
      pending: ['Run failed before measurement.'],
    },
  };
  if (error?.browserClose) report.browserClose = error.browserClose;
  if (error?.cleanupError) report.cleanupError = error.cleanupError;
  return report;
}

function assertSoakDatacenterFixtureReceipt(receipt) {
  if (
    receipt?.schema !== 'gev-soak-datacenter-fixture/v2' ||
    receipt.fulfillmentProtocol !== 'cdp-fetch-fulfilled-hash-count-v1' ||
    receipt.status !== 'validated' ||
    receipt.requestCount !== 1 ||
    receipt.preparedRequestCount !== 1 ||
    receipt.fulfilledRequestCount !== 1 ||
    receipt.responseStatus !== 200 ||
    receipt.applicationOrigin !== receipt.assetOrigin ||
    !/^https?:\/\//.test(receipt.applicationOrigin || '') ||
    (!/(?:^|\/)assets\/datacenters-[A-Za-z0-9_-]{8}\.geojsonl$/.test(
      receipt.assetPath || '',
    ) &&
      !String(receipt.assetPath || '').endsWith(
        '/src/data/local_data/datacenters/datacenters.geojsonl',
      )) ||
    !/^[a-f0-9]{64}$/.test(receipt.bodySha256 || '') ||
    receipt.bodySha256 !== receipt.expectedBodySha256 ||
    receipt.deliveredFeatureCount !== 8 ||
    receipt.expectedFeatureCount !== 8 ||
    receipt.materializedFeatureCount !== 8 ||
    receipt.disabledMaterializedFeatureCount !== 0 ||
    receipt.disabledRenderableCount !== 0 ||
    receipt.setupTiming !== 'unmeasured-before-interaction-samples' ||
    receipt.preloadEnabledObserved !== true ||
    receipt.preloadDisabledObserved !== true ||
    !Array.isArray(receipt.requests) ||
    receipt.requests.length !== 1 ||
    receipt.requests[0]?.prepared !== true ||
    receipt.requests[0]?.fulfilled !== true ||
    receipt.requests[0]?.responseStatus !== 200 ||
    receipt.requests[0]?.bodySha256 !== receipt.bodySha256 ||
    receipt.requests[0]?.deliveredFeatureCount !== 8 ||
    receipt.requests[0]?.origin !== receipt.applicationOrigin ||
    receipt.requests[0]?.pathname !== receipt.assetPath
  )
    throw new Error(
      'Rendered soak requires a fulfilled, materialized eight-feature datacenter fixture preflight.',
    );
  return receipt;
}

/** No counters advance until a real operation reports completion. Short runs are smoke tests. */
export async function runMixedUseSoak({
  durationMs = DEFAULT_DURATION_MS,
  now = () => Date.now(),
  driver,
  url = 'http://localhost:4174',
  browserOptions = {},
  expectedCommit,
  prewarmApplication = false,
  checkpointIntervalMs = 5 * 60_000,
  intervalMs = 250,
  recordingBundleOut = null,
  location = null,
  nativeResolution = false,
  progress = () => {},
} = {}) {
  if (!Number.isFinite(durationMs) || durationMs <= 0)
    throw new TypeError('Duration must be positive.');
  const usesRetentionAnchor = durationMs >= FULL_SOAK_MS;
  const ownsDriver = !driver;
  driver ||= await createRenderedSoakDriver(url, {
    browserOptions,
    expectedCommit,
    prewarmApplication,
    location,
    nativeResolution,
  });
  let report, runFailure;
  let datacenterFixtureReceipt = null;
  const exportRecordingBundle = async () => {
    if (!recordingBundleOut) return null;
    if (typeof driver.exportRecordingBundle !== 'function')
      throw new Error(
        'A recording bundle output was requested, but the soak driver cannot export one.',
      );
    const bundle = await driver.exportRecordingBundle();
    if (!bundle)
      throw new Error(
        'The rendered soak did not contain the expected recording-rendered-soak bundle.',
      );
    const target = path.resolve(recordingBundleOut);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, JSON.stringify(bundle, null, 2) + '\n', {
      flag: 'wx',
    });
    return {
      path: target,
      format: bundle.format,
      version: bundle.version,
      recordingId: bundle.document?.id || null,
      bytes: Buffer.byteLength(JSON.stringify(bundle)),
    };
  };
  try {
    if (typeof driver.validateDatacenterSoakFixture !== 'function')
      throw new Error(
        'Rendered soak driver does not provide the required datacenter fixture preflight.',
      );
    datacenterFixtureReceipt = assertSoakDatacenterFixtureReceipt(
      await driver.validateDatacenterSoakFixture(),
    );
    for (let i = 0; i < (driver.warmupIterations || 0); i++)
      await driver.runCycle(i);
    const firstRetainedMetrics = await driver.retainedMetrics?.();
    const startedAt = now();
    const checkpoints = [{ elapsedMs: 0, metrics: firstRetainedMetrics }];
    const checkpointSchedule = {
      requestedDurationMs: durationMs,
      actualDurationMs: 0,
      anchorElapsedMs: null,
      targetDurationMs: durationMs,
      maxExtraRuntimeMs: usesRetentionAnchor
        ? MAX_RETENTION_ANCHORED_EXTENSION_MS
        : 0,
      status: usesRetentionAnchor ? 'awaiting-anchor' : 'not-applicable',
    };
    const totals = {
      iterations: 0,
      sourceToggles: 0,
      replaySeeks: 0,
      imports: 0,
      workspaceReloads: 0,
      archiveFailures: 0,
      cameraRecoveries: 0,
    };
    let peakHeapBytes = 0,
      firstMetrics = null,
      lastMetrics = null,
      lastProgress = startedAt;
    report = {
      scope: driver.scope || 'test-driver',
      renderer: driver.renderer || null,
      graphics: driver.graphics || null,
      renderingEvidence: driver.renderingEvidence || null,
      environment: driver.environment || null,
      nativeResolution: driver.nativeResolution || null,
      location: driver.location || null,
      applicationCommit: driver.applicationCommit || null,
      workerPreflight: driver.workerPreflight || null,
      startupPrewarm: driver.startupPrewarm || null,
      datacenterFixtureReceipt,
      datacenterFixtureProtocol: 'cdp-fetch-fulfilled-hash-count-v1',
      warmupIterations: driver.warmupIterations || 0,
      firstRetainedMetrics,
      checkpoints,
      checkpointSchedule,
      hardwareRenderingValidated: Boolean(driver.hardwareRenderingValidated),
      browserVersion: driver.browserVersion || 'test driver',
      operationStatus: 'running',
    };
    const updateReport = () =>
      Object.assign(report, totals, {
        durationMs: now() - startedAt,
        checkpointSchedule: {
          ...checkpointSchedule,
          actualDurationMs: now() - startedAt,
        },
        fullSoak: now() - startedAt >= DEFAULT_DURATION_MS,
        peakHeapBytes,
        firstMetrics,
        lastMetrics,
      });
    try {
      let boundedScheduleFailure = null;
      do {
        const result = await driver.runCycle(totals.iterations);
        const fields = Object.keys(totals).filter(
          (name) => name !== 'iterations',
        );
        for (const field of fields) {
          if (!Number.isInteger(result[field]) || result[field] < 1)
            throw new Error('Soak did not complete ' + field);
        }
        for (const field of fields) totals[field] += result[field];
        totals.iterations++;
        lastMetrics = (await driver.metrics?.()) || {};
        firstMetrics ||= lastMetrics;
        peakHeapBytes = Math.max(
          peakHeapBytes,
          lastMetrics.JSHeapUsedSize || 0,
        );
        updateReport();
        if (
          now() - startedAt - checkpoints.at(-1).elapsedMs >=
          checkpointIntervalMs
        ) {
          const metrics = await driver.retainedMetrics?.();
          const checkpointElapsedMs = now() - startedAt;
          checkpoints.push({ elapsedMs: checkpointElapsedMs, metrics });
          if (
            usesRetentionAnchor &&
            checkpointSchedule.anchorElapsedMs === null &&
            checkpointElapsedMs >= RETENTION_ANCHOR_MS
          ) {
            checkpointSchedule.anchorElapsedMs = checkpointElapsedMs;
            checkpointSchedule.targetDurationMs = Math.max(
              durationMs,
              checkpointElapsedMs + RETENTION_ANCHOR_MS,
            );
            checkpointSchedule.status = 'anchored';
          }
          // Keep the warmed baseline and a bounded recent history.
          if (checkpoints.length > 128) checkpoints.splice(1, 1);
        }
        if (now() - lastProgress >= 60000) {
          progress({ elapsedMs: now() - startedAt, ...totals });
          lastProgress = now();
        }
        if (intervalMs)
          await new Promise((resolve) => setTimeout(resolve, intervalMs));
        const elapsedMs = now() - startedAt;
        const maximumElapsedMs =
          durationMs + MAX_RETENTION_ANCHORED_EXTENSION_MS;
        if (
          usesRetentionAnchor &&
          elapsedMs >= durationMs &&
          checkpointSchedule.anchorElapsedMs === null &&
          elapsedMs >= maximumElapsedMs
        ) {
          boundedScheduleFailure =
            'No equivalent-state retention anchor was observed within the bounded extension.';
        } else if (
          usesRetentionAnchor &&
          elapsedMs >= durationMs &&
          checkpointSchedule.anchorElapsedMs !== null &&
          checkpointSchedule.targetDurationMs > maximumElapsedMs
        ) {
          boundedScheduleFailure =
            'The retention-anchored target exceeds the bounded extension.';
        } else if (usesRetentionAnchor && elapsedMs > maximumElapsedMs) {
          boundedScheduleFailure =
            'The soak exceeded its bounded retention extension before reaching the target.';
        }
        if (boundedScheduleFailure) {
          checkpointSchedule.status = 'bounded-failure';
          throw new Error(boundedScheduleFailure);
        }
        if (
          elapsedMs >= checkpointSchedule.targetDurationMs &&
          (!usesRetentionAnchor || checkpointSchedule.anchorElapsedMs !== null)
        )
          break;
      } while (true);
      report.lastRetainedMetrics = await driver.retainedMetrics?.();
      if (
        usesRetentionAnchor &&
        now() - startedAt > durationMs + MAX_RETENTION_ANCHORED_EXTENSION_MS
      ) {
        checkpointSchedule.status = 'bounded-failure';
        throw new Error(
          'Final retained checkpoint exceeded the bounded retention extension.',
        );
      }
      checkpointSchedule.status = usesRetentionAnchor
        ? 'completed'
        : 'not-applicable';
      checkpoints.push({
        elapsedMs: now() - startedAt,
        metrics: report.lastRetainedMetrics,
      });
      report.operationStatus = 'passed';
      updateReport();
      report.stability = evaluateSoakStability(report);
      if (recordingBundleOut)
        report.recordingBundleExport = await exportRecordingBundle();
      return report;
    } catch (error) {
      updateReport();
      report.operationStatus = 'failed';
      report.error = error.message;
      // This may be an intermediate scene, so keep it out of equivalent-state
      // plateau checkpoints while retaining its worker/resource diagnostics.
      try {
        report.failureMetrics = await driver.retainedMetrics?.();
      } catch {
        report.failureMetrics = null;
      }
      report.stability = evaluateSoakStability(report);
      if (recordingBundleOut) {
        try {
          report.recordingBundleExport = await exportRecordingBundle();
        } catch (bundleError) {
          report.recordingBundleExport = {
            status: 'failed',
            error: bundleError.message,
          };
        }
      }
      error.soakReport = report;
      throw error;
    }
  } catch (error) {
    runFailure = error;
    if (!report) {
      report = createSoakSetupFailureReport(error);
      report.datacenterFixtureReceipt =
        datacenterFixtureReceipt ||
        driver.readDatacenterSoakFixtureReceipt?.() ||
        null;
      error.soakReport = report;
    }
    throw error;
  } finally {
    if (ownsDriver) {
      try {
        const close = await driver.close();
        if (report) report.browserClose = close;
      } catch (error) {
        if (report) {
          report.browserClose = error.browserClose || { closeCompleted: false };
          report.cleanupError =
            'Application soak browser did not close normally.';
          report.operationStatus = 'failed';
        }
        if (!runFailure) {
          error.soakReport = report;
          throw error;
        }
      }
    }
  }
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const value = (name, fallback) => {
    const index = process.argv.indexOf(name);
    return index < 0 ? fallback : process.argv[index + 1];
  };
  const hasFlag = (name) => process.argv.includes(name);
  const commit = execFileSync('git', ['rev-parse', 'HEAD'], {
    encoding: 'utf8',
  }).trim();
  const expectedApplicationCommit = resolveExpectedApplicationCommit(
    value('--expected-commit', commit),
    commit,
  );
  const dirty = () =>
    Boolean(
      execFileSync('git', ['status', '--porcelain'], {
        encoding: 'utf8',
      }).trim(),
    );
  const sourceDirtyAtStart = dirty();
  let report, runError;
  try {
    report = await runMixedUseSoak({
      expectedCommit: expectedApplicationCommit,
      prewarmApplication: hasFlag('--prewarm-application'),
      nativeResolution: resolveNativeResolutionFlag(),
      durationMs: Number(value('--duration-ms', DEFAULT_DURATION_MS)),
      url: value('--url', 'http://localhost:4174'),
      recordingBundleOut: value('--recording-bundle-out', null),
      location: {
        latitude: Number(value('--latitude', 40.7)),
        longitude: Number(value('--longitude', -73.9)),
        altitude: Number(value('--altitude', 1000)),
      },
      browserOptions: hasFlag('--headed')
        ? {
            headless: false,
            args: [
              '--no-sandbox',
              '--disable-dev-shm-usage',
              '--disable-background-timer-throttling',
              '--disable-backgrounding-occluded-windows',
              '--disable-renderer-backgrounding',
              ...(hasFlag('--hardware') ? ['--use-angle=d3d11'] : []),
            ],
          }
        : {},
      progress: (report) => console.log(JSON.stringify(report)),
    });
  } catch (error) {
    runError = error;
    report = error.soakReport || createSoakSetupFailureReport(error);
  }
  report.candidateCommit = expectedApplicationCommit;
  report.harnessCommit = commit;
  report.sourceDirtyAtStart = sourceDirtyAtStart;
  report.harnessDirtyAtStart = sourceDirtyAtStart;
  report.sourceChangedDuringRun =
    dirty() ||
    execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim() !==
      commit;
  report.harnessChangedDuringRun = report.sourceChangedDuringRun;
  const out = value('--out', null);
  if (out) {
    await mkdir(path.dirname(out), { recursive: true });
    await writeFile(out, JSON.stringify(report, null, 2) + '\n', {
      flag: 'wx',
    });
  }
  console.log(JSON.stringify(report, null, 2));
  if (
    runError ||
    report.stability.status === 'failed' ||
    (report.fullSoak && report.stability.status !== 'passed') ||
    report.sourceDirtyAtStart ||
    report.sourceChangedDuringRun
  )
    process.exitCode = 1;
}
