#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createRenderedSoakDriver } from './qa-rendered-soak-driver.mjs';
const DEFAULT_DURATION_MS = 60 * 60_000;

/** No counters advance until a real operation reports completion. Short runs are smoke tests. */
export async function runMixedUseSoak({
  durationMs = DEFAULT_DURATION_MS,
  now = () => Date.now(),
  driver,
  url = 'http://localhost:4174',
  browserOptions = {},
  intervalMs = 250,
  progress = () => {},
} = {}) {
  if (!Number.isFinite(durationMs) || durationMs <= 0)
    throw new TypeError('Duration must be positive.');
  const ownsDriver = !driver;
  driver ||= await createRenderedSoakDriver(url, { browserOptions });
  try {
    for (let i = 0; i < (driver.warmupIterations || 0); i++)
      await driver.runCycle(i);
    const firstRetainedMetrics = await driver.retainedMetrics?.();
    const startedAt = now();
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
    do {
      const result = await driver.runCycle(totals.iterations);
      for (const field of Object.keys(totals).filter(
        (name) => name !== 'iterations',
      )) {
        if (!Number.isInteger(result[field]) || result[field] < 1)
          throw new Error('Soak did not complete ' + field);
        totals[field] += result[field];
      }
      totals.iterations++;
      lastMetrics = (await driver.metrics?.()) || {};
      firstMetrics ||= lastMetrics;
      peakHeapBytes = Math.max(peakHeapBytes, lastMetrics.JSHeapUsedSize || 0);
      if (now() - lastProgress >= 60000) {
        progress({ elapsedMs: now() - startedAt, ...totals });
        lastProgress = now();
      }
      if (intervalMs)
        await new Promise((resolve) => setTimeout(resolve, intervalMs));
    } while (now() - startedAt < durationMs);
    return {
      scope: driver.scope || 'test-driver',
      renderer: driver.renderer || null,
      warmupIterations: driver.warmupIterations || 0,
      firstRetainedMetrics,
      lastRetainedMetrics: await driver.retainedMetrics?.(),
      hardwareRenderingValidated: Boolean(driver.hardwareRenderingValidated),
      fullSoak: now() - startedAt >= DEFAULT_DURATION_MS,
      durationMs: now() - startedAt,
      browserVersion: driver.browserVersion || 'test driver',
      ...totals,
      peakHeapBytes,
      firstMetrics,
      lastMetrics,
    };
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
  const report = await runMixedUseSoak({
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
}
