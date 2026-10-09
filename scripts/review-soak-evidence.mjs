#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { evaluateSoakStability } from './performance/soakStability.mjs';

/** Re-evaluate historical measurements without modifying or relabeling them. */
export function reviewSoakEvidence(bytes, validatorCommit) {
  const original = JSON.parse(bytes.toString('utf8'));
  const report = original.soak || original;
  const candidateCommit = report.candidateCommit || original.commit;
  if (
    !/^[a-f0-9]{40}$/.test(validatorCommit || '') ||
    !/^[a-f0-9]{40}$/.test(candidateCommit || '') ||
    candidateCommit !== report.applicationCommit ||
    (original.commit && original.commit !== candidateCommit)
  )
    throw new Error(
      'Exact matching application and candidate revisions required.',
    );
  if (
    !Array.isArray(report.checkpoints) ||
    report.checkpoints.length < 2 ||
    !Number.isFinite(report.durationMs) ||
    !['passed', 'failed'].includes(report.operationStatus)
  )
    throw new Error('Completed measurements and operation outcome required.');
  const stability = evaluateSoakStability(report);
  return {
    schema: 'gev-soak-reassessment/v1',
    scope:
      'Historical measurements evaluated by a newer validator; not a new run or current-candidate acceptance.',
    sourceSha256: createHash('sha256').update(bytes).digest('hex'),
    candidateCommit,
    validatorCommit,
    applicationCommit: report.applicationCommit,
    originalStability: report.stability || null,
    originalOperationStatus: report.operationStatus,
    stability,
    outcome:
      report.operationStatus === 'failed' || stability.status === 'failed'
        ? 'failed'
        : stability.status,
    renderer: report.renderer || null,
    renderingEvidence: report.renderingEvidence || null,
    hardwareRenderingValidated: report.hardwareRenderingValidated === true,
    durationMs: report.durationMs,
    checkpointCount: report.checkpoints.length,
  };
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const [, , input, output] = process.argv;
  if (!input || !output)
    throw new Error(
      'Usage: node scripts/review-soak-evidence.mjs input.json new-review.json',
    );
  const git = (...args) =>
    execFileSync('git', args, { encoding: 'utf8' }).trim();
  if (git('status', '--porcelain', '--untracked-files=no'))
    throw new Error('Commit validator changes before evaluating evidence.');
  const review = reviewSoakEvidence(
    readFileSync(input),
    git('rev-parse', 'HEAD'),
  );
  writeFileSync(output, JSON.stringify(review, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify(review));
}
