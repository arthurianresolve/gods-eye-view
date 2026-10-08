#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';

export function evaluateCandidateReadiness(checks) {
  const failures = checks.filter(
    (item) => item.required && item.status === 'failed',
  );
  const pending = checks.filter(
    (item) => item.required && item.status !== 'passed',
  );
  return Object.freeze({
    passed: failures.length === 0,
    releaseReady: pending.length === 0,
    failureCount: failures.length,
    pendingCount: pending.length,
  });
}

function commandCheck(label, command, args, { env = process.env } = {}) {
  const result = spawnSync(command, args, {
    cwd: ROOT,
    env: { ...env, PUPPETEER_SKIP_DOWNLOAD: '1' },
    encoding: 'utf8',
    shell: process.platform === 'win32',
    maxBuffer: 32 * 1024 * 1024,
  });
  return {
    id: label,
    required: true,
    status: result.status === 0 ? 'passed' : 'failed',
    exitCode: result.status,
    summary: `${command} ${args.join(' ')}`,
    output: `${result.stdout || ''}${result.stderr || ''}`.slice(-12_000),
  };
}

function gitCommit() {
  const result = spawnSync('git', ['rev-parse', 'HEAD'], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  return result.status === 0 ? result.stdout.trim() : 'unknown';
}

export async function runCandidateMatrix({
  env = process.env,
  now = () => new Date(),
} = {}) {
  const checks = [];
  for (const [label, args] of [
    ['format', ['run', 'format:check']],
    ['boundaries', ['run', 'check:boundaries']],
    ['unit', ['test']],
    ['production-build', ['run', 'build']],
  ])
    checks.push(commandCheck(label, npm, args, { env }));

  const appUrl = String(env.GEV_CANDIDATE_URL || '').trim();
  if (appUrl) {
    for (const [id, script] of [
      ['workspace-library', 'qa:workspaces'],
      ['timeline', 'qa:timeline'],
      ['recording', 'qa:recording'],
      ['evidence-panel', 'qa:evidence-panel'],
      ['panel-resize', 'qa:panel-resize'],
      ['render-resolution', 'qa:render-resolution'],
    ])
      checks.push(
        commandCheck(id, npm, ['run', script, '--', '--url', appUrl], { env }),
      );
  } else {
    checks.push({
      id: 'browser-journeys',
      required: true,
      status: 'pending',
      summary: 'Set GEV_CANDIDATE_URL to a running candidate application.',
    });
  }

  for (const [id, summary] of [
    [
      'platform-installs',
      'Clean install and upgrade on Windows, macOS and Linux with a prior supported workspace.',
    ],
    [
      'mixed-use-soak',
      '60-minute mixed-use run, repeated source toggles, replay seeks, workspace switching, imports and recovery.',
    ],
    [
      'hardware-matrix',
      'Repeat renderer captures on named supported hardware; software rendering is not GPU evidence.',
    ],
    [
      'accessibility-review',
      'Manual keyboard, screen reader, 200% zoom, contrast and five-participant first-task study.',
    ],
    [
      'release-tag-match',
      'Confirm the tested commit equals the signed/tagged release commit and verify published checksums.',
    ],
  ])
    checks.push({ id, required: true, status: 'pending', summary });

  const readiness = evaluateCandidateReadiness(checks);
  return Object.freeze({
    schemaVersion: 1,
    generatedAt: now().toISOString(),
    commit: gitCommit(),
    status: readiness.releaseReady
      ? 'ready'
      : readiness.passed
        ? 'pending-evidence'
        : 'failed',
    readiness,
    checks,
  });
}

async function main(args) {
  const outputIndex = args.indexOf('--out');
  const output =
    outputIndex >= 0 ? path.resolve(args[outputIndex + 1] || '') : null;
  const report = await runCandidateMatrix();
  if (output) {
    await mkdir(path.dirname(output), { recursive: true });
    await writeFile(output, `${JSON.stringify(report, null, 2)}\n`, {
      flag: 'wx',
    });
    console.log(`Candidate report written to ${path.relative(ROOT, output)}.`);
  }
  console.log(JSON.stringify(report, null, 2));
  if (report.status === 'failed') process.exitCode = 1;
  else if (report.status === 'pending-evidence') process.exitCode = 2;
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  await main(process.argv.slice(2));
