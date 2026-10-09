#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { evaluatePairedRendererExperiment } from './performance/pairedRendererExperiment.mjs';
import { RENDERER_EXPERIMENT_VARIANTS } from './performance/pairedRendererExperiment.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const order = process.argv[2];
assert.ok(['ABC', 'CBA'].includes(order), 'Usage: node scripts/qa-renderer-recovery-experiment.mjs ABC|CBA');
const expectedCommit = process.env.GITHUB_SHA ||
  spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).stdout.trim();
assert.match(expectedCommit, /^[a-f0-9]{40}$/i, 'Expected full source commit SHA');
const head = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' });
const status = spawnSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' });
assert.equal(head.status, 0, 'Unable to inspect source HEAD');
assert.equal(status.status, 0, 'Unable to inspect source checkout');
assert.equal(head.stdout.trim(), expectedCommit, 'Workflow source SHA differs from checkout HEAD');
assert.equal(status.stdout.trim(), '', 'Renderer experiment requires a clean checkout');
const outputDirectory = path.resolve(root, 'qa-artifacts', `renderer-recovery-${order.toLowerCase()}`);
await mkdir(outputDirectory, { recursive: true });
const sequence = order === 'ABC'
  ? ['driver-late', 'webgl-late', 'driver-early']
  : ['driver-early', 'webgl-late', 'driver-late'];
const reports = [];
const processResults = [];
const sequenceRunId = `${order}-${expectedCommit.slice(0, 12)}-${process.pid}`;
for (let sequenceIndex = 0; sequenceIndex < sequence.length; sequenceIndex++) {
  const variant = sequence[sequenceIndex];
  const config = RENDERER_EXPERIMENT_VARIANTS[variant];
  const reportPath = path.join(outputDirectory, `${variant}.json`);
  const logPath = path.join(outputDirectory, `${variant}.log`);
  const child = spawnSync(
    process.execPath,
    ['scripts/qa-profile-recovery.mjs', '--out', reportPath],
    {
      cwd: root,
      encoding: 'utf8',
      timeout: 30 * 60_000,
      maxBuffer: 4 * 1024 * 1024,
      windowsHide: true,
      env: {
        ...process.env,
        GEV_QA_SOFTWARE_RENDERING: '1',
        GEV_QA_SWIFTSHADER_WEBGL_ONLY:
          config.backend === 'swiftshader-webgl-only' ? '1' : '0',
        GEV_QA_RENDERER_QUERY_TIMING: config.queryTiming,
        GEV_QA_RENDERER_EXPERIMENT_VARIANT: variant,
        GEV_QA_RENDERER_EXPERIMENT_ORDER: order,
        GEV_QA_RENDERER_EXPERIMENT_INDEX: String(sequenceIndex),
        GEV_QA_RENDERER_EXPERIMENT_ID: sequenceRunId,
        GEV_PROFILE_RECOVERY_DIAGNOSTICS: '0',
      },
    },
  );
  const combinedLog = `${child.stdout || ''}${child.stderr || ''}`;
  await writeFile(logPath, combinedLog.slice(-2_000_000));
  processResults.push({
    variant,
    status: child.status,
    signal: child.signal,
    error: child.error?.message || null,
    reportFile: path.basename(reportPath),
    logFile: path.basename(logPath),
  });
  try {
    reports.push({ variant, report: JSON.parse(await readFile(reportPath, 'utf8')) });
  } catch {
    // Retain all remaining variants even when a recovery process did not emit JSON.
  }
  console.log(JSON.stringify({ phase: 'renderer-experiment-variant-complete', ...processResults.at(-1) }));
  if (child.status !== 0 || child.error) break;
}

let comparison = null;
let validationError = null;
try {
  assert.ok(processResults.every((result) => result.status === 0), 'A recovery process failed or timed out');
  comparison = evaluatePairedRendererExperiment({ reports, order, expectedCommit });
} catch (error) {
  validationError = String(error?.message || error).slice(0, 400);
}
const packet = {
  scope: 'same-runner-ordered-renderer-recovery-experiment',
  order,
  expectedCommit,
  sequence,
  runId: sequenceRunId,
  processResults,
  reportFiles: sequence.map((variant) => `${variant}.json`),
  logFiles: sequence.map((variant) => `${variant}.log`),
  comparison,
  validationError,
};
const packetPath = path.join(outputDirectory, 'packet.json');
await writeFile(packetPath, JSON.stringify(packet, null, 2) + '\n');
console.log('GEV_RENDERER_EXPERIMENT_PACKET ' + JSON.stringify(packet));
if (!comparison) process.exitCode = 1;
