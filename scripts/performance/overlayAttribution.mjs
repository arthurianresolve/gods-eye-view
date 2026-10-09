import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const commit = execFileSync('git', ['rev-parse', 'HEAD'], {
  encoding: 'utf8',
}).trim();
assert.equal(
  execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim(),
  '',
  'A clean worktree is required.',
);
const report = {
  schema: 'gev-overlay-cpu/v1',
  commit,
  node: process.version,
  platform: process.platform,
  capturedAt: new Date().toISOString(),
  scope:
    'Node overlay algorithm attribution and instrumentation overhead; mock canvas; no browser or GPU claim',
  workloads: [],
};
for (const [profile, entries] of [
  ['generic', 250],
  ['local-infrastructure', 320],
  ['all-live-radio', 864],
  ['phase6-detection', 5000],
]) {
  const stdout = execFileSync(
    process.execPath,
    [
      '--no-concurrent-recompilation',
      'src/overlays/worldOverlayAllocation.worker.mjs',
    ],
    {
      encoding: 'utf8',
      timeout: 120000,
      maxBuffer: 2 * 1024 * 1024,
      env: {
        ...process.env,
        GEV_OVERLAY_CPU: '1',
        GEV_ALLOC_PROFILE: profile,
        GEV_ALLOC_ENTRIES: String(entries),
      },
    },
  );
  const row = JSON.parse(stdout.trim().split('\n').at(-1));
  assert.equal(row.ok, true);
  const median = (enabled) =>
    row.samples
      .filter((sample) => sample.enabled === enabled)
      .map((sample) => sample.cpuMs / sample.frames)
      .sort((a, b) => a - b)[2];
  row.disabledMedianCpuMs = median(false);
  row.enabledMedianCpuMs = median(true);
  row.instrumentationRatio =
    row.enabledMedianCpuMs / row.disabledMedianCpuMs - 1;
  report.workloads.push(row);
  console.log(
    JSON.stringify({
      profile,
      disabledMedianCpuMs: row.disabledMedianCpuMs,
      enabledMedianCpuMs: row.enabledMedianCpuMs,
      instrumentationRatio: row.instrumentationRatio,
    }),
  );
}
if (process.argv[2])
  writeFileSync(process.argv[2], JSON.stringify(report, null, 2) + '\n');
