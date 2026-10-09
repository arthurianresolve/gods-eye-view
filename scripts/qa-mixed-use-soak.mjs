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

/** No counters advance until a real operation reports completion. Short runs are smoke tests. */
export async function runMixedUseSoak({
  durationMs = DEFAULT_DURATION_MS,
  now = () => Date.now(),
  driver,
  url = 'http://localhost:4174',
  browserOptions = {},
  expectedCommit,
  checkpointIntervalMs = 5 * 60_000,
  intervalMs = 250,
  progress = () => {},
} = {}) {
  if (!Number.isFinite(durationMs) || durationMs <= 0)
    throw new TypeError('Duration must be positive.');
  const ownsDriver = !driver;
  driver ||= await createRenderedSoakDriver(url, {
    browserOptions,
    expectedCommit,
  });
  let report;
  try {
    for (let i = 0; i < (driver.warmupIterations || 0); i++)
      await driver.runCycle(i);
    const firstRetainedMetrics = await driver.retainedMetrics?.();
    const startedAt = now();
    const checkpoints = [{ elapsedMs: 0, metrics: firstRetainedMetrics }];
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
      applicationCommit: driver.applicationCommit || null,
      workerPreflight: driver.workerPreflight || null,
      warmupIterations: driver.warmupIterations || 0,
      firstRetainedMetrics,
      checkpoints,
      hardwareRenderingValidated: Boolean(driver.hardwareRenderingValidated),
      browserVersion: driver.browserVersion || 'test driver',
      operationStatus: 'running',
    };
    const updateReport = () =>
      Object.assign(report, totals, {
        durationMs: now() - startedAt,
        fullSoak: now() - startedAt >= DEFAULT_DURATION_MS,
        peakHeapBytes,
        firstMetrics,
        lastMetrics,
      });
    try {
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
          checkpoints.push({ elapsedMs: now() - startedAt, metrics });
          // Keep the warmed baseline and a bounded recent history.
          if (checkpoints.length > 128) checkpoints.splice(1, 1);
        }
        if (now() - lastProgress >= 60000) {
          progress({ elapsedMs: now() - startedAt, ...totals });
          lastProgress = now();
        }
        if (intervalMs)
          await new Promise((resolve) => setTimeout(resolve, intervalMs));
      } while (now() - startedAt < durationMs);
      report.lastRetainedMetrics = await driver.retainedMetrics?.();
      checkpoints.push({
        elapsedMs: now() - startedAt,
        metrics: report.lastRetainedMetrics,
      });
      report.operationStatus = 'passed';
      updateReport();
      report.stability = evaluateSoakStability(report);
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
      error.soakReport = report;
      throw error;
    }
  } finally {
    if (ownsDriver) await driver.close();
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
  const dirty = () =>
    Boolean(
      execFileSync('git', ['status', '--porcelain', '--untracked-files=no'], {
        encoding: 'utf8',
      }).trim(),
    );
  const sourceDirtyAtStart = dirty();
  let report, runError;
  try {
    report = await runMixedUseSoak({
      expectedCommit: commit,
      durationMs: Number(value('--duration-ms', DEFAULT_DURATION_MS)),
      url: value('--url', 'http://localhost:4174'),
      browserOptions: hasFlag('--headed')
        ? {
            headless: false,
            args: [
              '--no-sandbox',
              '--disable-dev-shm-usage',
              ...(hasFlag('--hardware') ? ['--use-angle=d3d11'] : []),
            ],
          }
        : {},
      progress: (report) => console.log(JSON.stringify(report)),
    });
  } catch (error) {
    runError = error;
    report = error.soakReport || {
      operationStatus: 'failed',
      error: error.message,
      fullSoak: false,
      hardwareRenderingValidated: false,
      stability: {
        status: 'pending',
        pending: ['Run failed before measurement.'],
      },
    };
  }
  report.candidateCommit = commit;
  report.sourceDirtyAtStart = sourceDirtyAtStart;
  report.sourceChangedDuringRun =
    dirty() ||
    execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim() !==
      commit;
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
