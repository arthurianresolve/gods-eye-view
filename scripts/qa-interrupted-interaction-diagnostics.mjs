#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { evaluateInterruptedInteractionDiagnostics } from './performance/qualificationMetrics.mjs';

const capturePath = process.argv[2];
if (!capturePath || process.argv.length !== 3) {
  console.error(
    'Usage: node scripts/qa-interrupted-interaction-diagnostics.mjs <capture.json>',
  );
  process.exitCode = 2;
} else {
  try {
    const stat = statSync(capturePath);
    if (!stat.isFile() || stat.size > 16 * 1024 * 1024)
      throw new Error('Capture must be a regular JSON file of at most 16 MiB');
    const bytes = readFileSync(capturePath);
    const capture = JSON.parse(bytes);
    const diagnostic = evaluateInterruptedInteractionDiagnostics(capture);
    console.log(
      JSON.stringify(
        {
          schema: 'gev-interrupted-interaction-receipt/v1',
          rawSha256: createHash('sha256').update(bytes).digest('hex'),
          baselineCommit: capture.sourceCaptures?.application?.baseline ?? null,
          candidateCommit:
            capture.sourceCaptures?.application?.candidate ?? null,
          diagnostic,
        },
        null,
        2,
      ),
    );
    if (diagnostic.status !== 'diagnostic') process.exitCode = 1;
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
