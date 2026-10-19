#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import {
  createMatrixCaptureInvocation,
  createMatrixResult,
  matrixReportPath,
  matrixCaptureHarness,
  PERFORMANCE_MATRIX_RESULT_SCHEMA,
  readReusableMatrixReport,
  sha256File,
  validateMatrixPairWithNativeEvidence,
  validatePerformanceMatrixPlan,
} from './performance/performanceMatrix.mjs';

const args = process.argv.slice(2);
const option = (name, fallback = null) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : fallback;
};
const planPath = option('--plan');
const resultPath = option('--out');
const resume = args.includes('--resume');
const dryRun = args.includes('--dry-run');

assert.ok(planPath, '--plan is required');
assert.ok(resultPath, '--out is required');
const plan = validatePerformanceMatrixPlan(
  JSON.parse(fs.readFileSync(path.resolve(planPath), 'utf8')),
);
const resolvedResultPath = path.resolve(resultPath);
assert.ok(
  resolvedResultPath.startsWith(`${path.resolve(plan.outputRoot)}${path.sep}`),
  '--out must be inside the plan outputRoot',
);
if (fs.existsSync(resolvedResultPath) && !resume)
  throw new Error('Matrix result already exists; pass --resume to verify it.');

function runCapture(invocation) {
  return new Promise((resolve, reject) => {
    const child = spawn(invocation.command, invocation.args, {
      cwd: invocation.cwd,
      env: { ...process.env, ...invocation.env },
      stdio: 'inherit',
      windowsHide: true,
    });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) resolve();
      else
        reject(
          new Error(
            `Capture exited with ${signal ? `signal ${signal}` : `code ${code}`}.`,
          ),
        );
    });
  });
}

await fs.promises.mkdir(plan.outputRoot, { recursive: true });
const startedAt = new Date().toISOString();
const completedRows = [];
for (const row of plan.rows) {
  const execution = [];
  for (const role of row.order) {
    const invocation = createMatrixCaptureInvocation(plan, row, role);
    const exists = fs.existsSync(invocation.reportPath);
    if (exists) {
      if (!resume)
        throw new Error(
          `Refusing to overwrite existing report ${invocation.reportPath}.`,
        );
      readReusableMatrixReport(plan, row, role);
      execution.push({ role, disposition: 'verified-reuse' });
    } else if (dryRun) {
      execution.push({ role, disposition: 'planned' });
    } else {
      await runCapture(invocation);
      readReusableMatrixReport(plan, row, role);
      execution.push({ role, disposition: 'captured' });
    }
  }
  if (dryRun) {
    completedRows.push({
      id: row.id,
      providerFixture: row.providerFixture,
      order: row.order,
      execution,
      status: 'planned',
    });
    continue;
  }
  const comparison = await validateMatrixPairWithNativeEvidence(plan, row);
  completedRows.push({
    id: row.id,
    providerFixture: row.providerFixture,
    order: row.order,
    execution,
    status: comparison.status,
    reports: Object.fromEntries(
      ['baseline', 'candidate'].map((role) => {
        const reportPath = matrixReportPath(plan, row, role);
        return [
          role,
          {
            path: path
              .relative(plan.outputRoot, reportPath)
              .replaceAll('\\', '/'),
            sha256: sha256File(reportPath),
          },
        ];
      }),
    ),
    comparison,
    source: {
      captureHarnessCommit: matrixCaptureHarness(plan, row).commit,
      buildHarnessCommit: plan.buildHarness.commit,
    },
  });
}

const result = dryRun
  ? {
      schema: PERFORMANCE_MATRIX_RESULT_SCHEMA,
      status: 'planned',
      startedAt,
      rows: completedRows,
    }
  : createMatrixResult(plan, completedRows, startedAt);
await fs.promises.writeFile(
  resolvedResultPath,
  `${JSON.stringify(result, null, 2)}\n`,
  { flag: resume ? 'w' : 'wx' },
);
process.stdout.write(`Wrote ${resolvedResultPath}\n`);
