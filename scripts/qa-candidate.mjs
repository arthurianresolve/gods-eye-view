#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
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

const EXTERNAL_CHECK_IDS = new Set([
  'platform-installs',
  'mixed-use-soak',
  'hardware-matrix',
  'accessibility-review',
  'release-tag-match',
]);

/** Validate an external acceptance manifest against the candidate being reported. */
export function readValidationManifest(
  filePath,
  { candidateCommit, phase = 'pre-release' } = {},
) {
  if (!filePath) return null;
  const raw = JSON.parse(readFileSync(filePath, 'utf8'));
  if (!raw || raw.schemaVersion !== 1 || !Array.isArray(raw.checks))
    throw new TypeError(
      'Validation manifest must have schemaVersion 1 and checks.',
    );
  if (!['pre-release', 'post-publication'].includes(phase))
    throw new TypeError(`Unsupported validation phase: ${phase}`);
  if (raw.phase != null && raw.phase !== phase)
    throw new Error('Validation manifest phase does not match the report.');
  if (raw.candidateCommit !== candidateCommit)
    throw new Error(
      'Validation manifest candidate commit does not match the report.',
    );
  const seen = new Set();
  const checks = raw.checks.map((item) => {
    const id = String(item?.id || '').trim();
    if (!EXTERNAL_CHECK_IDS.has(id))
      throw new Error(`Unknown validation check: ${id || '(missing)'}`);
    if (id === 'release-tag-match' && phase !== 'post-publication')
      throw new Error(
        'release-tag-match evidence belongs to post-publication verification.',
      );
    if (seen.has(id)) throw new Error(`Duplicate validation check: ${id}`);
    seen.add(id);
    const status = item.status || item.outcome;
    if (!['passed', 'failed', 'pending'].includes(status))
      throw new Error(`Invalid validation outcome for ${id}.`);
    if (!String(item.environment || '').trim())
      throw new Error(`Validation environment is required for ${id}.`);
    const timestamp = Date.parse(item.timestamp || '');
    if (!Number.isFinite(timestamp))
      throw new Error(`Validation timestamp is required for ${id}.`);
    const artifacts = Array.isArray(item.artifacts) ? item.artifacts : [];
    if (artifacts.length > 8)
      throw new Error(`Too many validation artifacts for ${id}.`);
    for (const artifact of artifacts) {
      const ref =
        typeof artifact === 'string'
          ? artifact
          : artifact?.path || artifact?.url;
      if (!ref || typeof ref !== 'string')
        throw new Error(`Invalid validation artifact for ${id}.`);
      if (!/^https?:\/\//i.test(ref) && !existsSync(ref))
        throw new Error(`Validation artifact does not exist for ${id}: ${ref}`);
    }
    return Object.freeze({
      id,
      status,
      environment: String(item.environment).trim().slice(0, 240),
      timestamp: new Date(timestamp).toISOString(),
      artifacts: Object.freeze(
        artifacts.map((artifact) =>
          typeof artifact === 'string'
            ? artifact
            : artifact.path || artifact.url,
        ),
      ),
      notes: typeof item.notes === 'string' ? item.notes.slice(0, 500) : '',
    });
  });
  return Object.freeze({
    schemaVersion: 1,
    phase,
    candidateCommit,
    checks: Object.freeze(checks),
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
  commit = gitCommit(),
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

  let validationManifest = null;
  const manifestPath = String(env.GEV_VALIDATION_MANIFEST || '').trim();
  if (manifestPath) {
    try {
      validationManifest = readValidationManifest(manifestPath, {
        candidateCommit: commit,
        phase: env.GEV_VALIDATION_PHASE || 'pre-release',
      });
      const byId = new Map(
        validationManifest.checks.map((item) => [item.id, item]),
      );
      for (const check of checks) {
        const evidence = byId.get(check.id);
        if (!evidence) continue;
        check.status = evidence.status;
        check.summary = `${check.summary} (${validationManifest.phase}; ${evidence.environment})`;
        check.validation = evidence;
      }
    } catch (error) {
      checks.push({
        id: 'validation-manifest',
        required: true,
        status: 'failed',
        summary: error.message,
      });
    }
  }
  const readiness = evaluateCandidateReadiness(checks);
  const preReleaseReadiness = evaluateCandidateReadiness(
    checks.filter((check) => check.id !== 'release-tag-match'),
  );
  const publicationVerification = evaluateCandidateReadiness(
    checks.filter((check) => check.id === 'release-tag-match'),
  );
  return Object.freeze({
    schemaVersion: 1,
    generatedAt: now().toISOString(),
    commit,
    validationManifest,
    phases: {
      preRelease: preReleaseReadiness,
      publication: publicationVerification,
    },
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
