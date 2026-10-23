import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { compareOverlayAttributionArms } from './overlayAttributionContract.mjs';

const profiles = [
  ['generic', 250],
  ['local-infrastructure', 320],
  ['all-live-radio', 864],
  ['phase6-detection', 5_000],
];

function median(values) {
  const ordered = [...values].sort((left, right) => left - right);
  return ordered[Math.floor(ordered.length / 2)];
}

function runArm({ profile, entries, pairIndex, enabled, sourceCommit }) {
  const stdout = execFileSync(
    process.execPath,
    [
      '--no-concurrent-recompilation',
      'src/overlays/worldOverlayAllocation.worker.mjs',
    ],
    {
      encoding: 'utf8',
      timeout: 120_000,
      maxBuffer: 2 * 1024 * 1024,
      env: {
        ...process.env,
        GEV_OVERLAY_CPU: '1',
        GEV_ALLOC_PROFILE: profile,
        GEV_ALLOC_ENTRIES: String(entries),
        GEV_ALLOC_MATCHED_ARM: enabled ? 'enabled' : 'disabled',
        GEV_ALLOC_SOURCE_COMMIT: sourceCommit,
        GEV_ALLOC_PAIR_INDEX: String(pairIndex),
      },
    },
  );
  const result = JSON.parse(stdout.trim().split('\n').at(-1));
  assert.equal(result.ok, true);
  return result;
}

const sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], {
  encoding: 'utf8',
}).trim();
assert.equal(
  execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim(),
  '',
  'A clean worktree is required.',
);
const report = {
  schema: 'gev-overlay-cpu/v2',
  sourceCommit,
  node: process.version,
  platform: process.platform,
  capturedAt: new Date().toISOString(),
  scope:
    'Matched isolated Node overlay CPU instrumentation; mock canvas, no browser, GPU, or rendered-frame claim',
  pairing: {
    arms: ['disabled', 'enabled'],
    independentWorkerProcessPerArm: true,
    virtualClock: 'starts at zero and advances 16 ms per identical frame',
    alternatingArmOrder: true,
  },
  workloads: [],
};

for (const [profile, entries] of profiles) {
  const workload = { profile, entries, pairs: [] };
  for (let pairIndex = 0; pairIndex < 5; pairIndex++) {
    const order =
      pairIndex % 2 ? ['enabled', 'disabled'] : ['disabled', 'enabled'];
    const arms = {};
    for (const arm of order)
      arms[arm] = runArm({
        profile,
        entries,
        pairIndex,
        enabled: arm === 'enabled',
        sourceCommit,
      });
    const comparison = compareOverlayAttributionArms(
      arms.disabled,
      arms.enabled,
    );
    workload.pairs.push({
      ...comparison,
      disabled: arms.disabled,
      enabled: arms.enabled,
    });
    console.log(
      JSON.stringify({
        profile,
        pairIndex,
        instrumentationRatio: comparison.instrumentationRatio,
        population: comparison.population,
      }),
    );
  }
  workload.disabledMedianCpuMsPerFrame = median(
    workload.pairs.map((pair) => pair.disabledCpuMsPerFrame),
  );
  workload.enabledMedianCpuMsPerFrame = median(
    workload.pairs.map((pair) => pair.enabledCpuMsPerFrame),
  );
  workload.medianInstrumentationRatio = median(
    workload.pairs.map((pair) => pair.instrumentationRatio),
  );
  report.workloads.push(workload);
}

assert.equal(
  execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim(),
  '',
  'Source changed during attribution capture.',
);
assert.equal(
  execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  sourceCommit,
  'Source revision changed during attribution capture.',
);
if (process.argv[2])
  writeFileSync(process.argv[2], JSON.stringify(report, null, 2) + '\n');
