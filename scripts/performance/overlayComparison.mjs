import { execFileSync } from 'node:child_process';
import os from 'node:os';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
const roots = {
  baseline: resolve(process.argv[2] || '../gev-overlay-baseline'),
  candidate: resolve(process.argv[3] || '.'),
};
const output = resolve(
  process.argv[4] || 'qa-artifacts/overlay-layout-comparison.json',
);
const report = {
  schema: 'gev-overlay-comparison/v1',
  capturedAt: new Date().toISOString(),
  node: process.version,
  platform: process.platform,
  cpuModel: os.cpus()[0]?.model || null,
  osRelease: os.release(),
  status: 'running',
  scope:
    'Node synchronous overlay algorithm; mock Canvas2D; no GPU or browser FPS claim',
  revisions: {},
  workloads: [],
};
for (const [name, cwd] of Object.entries(roots)) {
  assert.equal(
    execFileSync('git', ['status', '--porcelain'], {
      cwd,
      encoding: 'utf8',
    }).trim(),
    '',
  );
  report.revisions[name] = execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd,
    encoding: 'utf8',
  }).trim();
}
for (const [profile, entries] of [
  ['generic', 250],
  ['local-infrastructure', 320],
  ['all-live-radio', 864],
  ['phase6-detection', 5000],
]) {
  const workload = { profile, entries, pairs: [] };
  for (let run = 0; run < 5; run++) {
    const pair = {
      run,
      order: run % 2 ? ['candidate', 'baseline'] : ['baseline', 'candidate'],
    };
    for (const name of pair.order) {
      const out = execFileSync(
        process.execPath,
        [
          '--no-concurrent-recompilation',
          'src/overlays/worldOverlayAllocation.worker.mjs',
        ],
        {
          cwd: roots[name],
          encoding: 'utf8',
          timeout: 120000,
          maxBuffer: 2097152,
          env: {
            ...process.env,
            GEV_OVERLAY_CPU: '1',
            GEV_ALLOC_PROFILE: profile,
            GEV_ALLOC_ENTRIES: String(entries),
          },
        },
      );
      const result = JSON.parse(out.trim().split('\n').at(-1));
      assert.equal(result.ok, true);
      pair[name] = result;
      pair[name].medianCpuMs = result.samples
        .filter((s) => !s.enabled)
        .map((s) => s.cpuMs / s.frames)
        .sort((a, b) => a - b)[2];
    }
    assert.deepEqual(
      pair.baseline.samples.map((s) => [s.candidates, s.painted]),
      pair.candidate.samples.map((s) => [s.candidates, s.painted]),
    );
    pair.ratio = pair.candidate.medianCpuMs / pair.baseline.medianCpuMs - 1;
    workload.pairs.push(pair);
    console.log(JSON.stringify({ profile, run, ratio: pair.ratio }));
  }
  workload.medianRatio = workload.pairs
    .map((p) => p.ratio)
    .sort((a, b) => a - b)[2];
  report.workloads.push(workload);
  writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
}

for (const [name, cwd] of Object.entries(roots)) {
  assert.equal(
    execFileSync('git', ['status', '--porcelain'], {
      cwd,
      encoding: 'utf8',
    }).trim(),
    '',
    'Source changed during capture: ' + name,
  );
  assert.equal(
    execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd,
      encoding: 'utf8',
    }).trim(),
    report.revisions[name],
    'Revision changed during capture: ' + name,
  );
}
report.status = 'complete';
writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
