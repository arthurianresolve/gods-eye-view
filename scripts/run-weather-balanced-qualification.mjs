#!/usr/bin/env node
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import {
  createWeatherBalancedCaptureInvocation,
  validateWeatherBalancedEnvelope,
  validateWeatherBalancedPlan,
  WEATHER_BALANCED_ENVELOPE_SCHEMA,
  WEATHER_BALANCED_ORDER,
} from './performance/weatherBalancedQualification.mjs';
import { validatePortableBuildProvenanceReceipt } from './performance/buildProvenance.mjs';

const args = process.argv.slice(2);
const option = (name) => {
  const index = args.indexOf(name);
  return index < 0 ? null : args[index + 1];
};
const planPath = option('--plan');
assert.ok(planPath, '--plan is required');
const planBytes = fs.readFileSync(path.resolve(planPath));
const plan = validateWeatherBalancedPlan(
  JSON.parse(planBytes.toString('utf8')),
);
for (const [label, value] of [
  ['output root', plan.outputRoot],
  ['Chrome executable', plan.browser.executable],
  ['capture harness checkout', plan.captureHarness.checkout],
  ['build harness checkout', plan.buildHarness.checkout],
  ...['control', 'candidate'].flatMap((role) => [
    [`${role} app checkout`, plan[role].appCheckout],
    [`${role} build root`, plan[role].build.root],
    [`${role} build receipt`, plan[role].build.receipt],
  ]),
])
  assert.ok(path.isAbsolute(value), `${label} must be absolute on this runner`);
const outputRoot = path.resolve(plan.outputRoot);
assert.ok(
  !fs.existsSync(outputRoot),
  'Qualification output root must be fresh',
);
function verifyChrome() {
  const chromeBytes = fs.readFileSync(plan.browser.executable);
  assert.equal(
    crypto.createHash('sha256').update(chromeBytes).digest('hex'),
    plan.browser.executableSha256,
    'Chrome executable changed after plan declaration',
  );
}
verifyChrome();
const buildReceiptBytes = {};
for (const role of ['control', 'candidate']) {
  const receipt = fs.readFileSync(plan[role].build.receipt);
  const digest = crypto.createHash('sha256').update(receipt).digest('hex');
  assert.equal(
    digest,
    plan[role].build.receiptSha256,
    `${role} build receipt changed`,
  );
  validatePortableBuildProvenanceReceipt(JSON.parse(receipt.toString('utf8')), {
    expectedAppCommit: plan[role].appCommit,
    expectedHarnessCommit: plan.buildHarness.commit,
  });
  buildReceiptBytes[role] = receipt;
}
fs.mkdirSync(outputRoot, { recursive: false });
fs.writeFileSync(path.join(outputRoot, 'qualification-plan.json'), planBytes, {
  flag: 'wx',
});
const buildReceipts = {};
for (const role of ['control', 'candidate']) {
  const file = `build-receipt-${role}.json`;
  const bytes = buildReceiptBytes[role];
  fs.writeFileSync(path.join(outputRoot, file), bytes, { flag: 'wx' });
  buildReceipts[role] = {
    path: file,
    sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
  };
}
const startedAt = new Date().toISOString();
const children = [];

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

function writeEnvelope(envelope) {
  fs.writeFileSync(
    path.join(outputRoot, 'qualification-envelope.json'),
    `${JSON.stringify(envelope, null, 2)}\n`,
    { flag: 'wx' },
  );
}

try {
  for (let index = 0; index < WEATHER_BALANCED_ORDER.length; index += 1) {
    verifyChrome();
    const role = WEATHER_BALANCED_ORDER[index];
    const sequence = index + 1;
    const pairIndex = Math.floor(index / 2) + 1;
    const pairId = `${plan.planId}-pair-${String(pairIndex).padStart(2, '0')}`;
    const runId = `${plan.planId}-${role}-${String(pairIndex).padStart(2, '0')}`;
    const file = `sample-${String(sequence).padStart(2, '0')}-${role}.json`;
    const absoluteReportPath = path.join(outputRoot, file);
    const captureStartedAt = new Date().toISOString();
    await runCapture(
      createWeatherBalancedCaptureInvocation(plan, role, absoluteReportPath),
    );
    const bytes = fs.readFileSync(absoluteReportPath);
    const digest = crypto.createHash('sha256').update(bytes).digest('hex');
    const captureCompletedAt = new Date().toISOString();
    children.push({
      path: file,
      sha256: digest,
      sequence,
      role,
      pairIndex,
      pairId,
      runId,
      startedAt: captureStartedAt,
      completedAt: captureCompletedAt,
    });
  }
  const envelope = {
    schema: WEATHER_BALANCED_ENVELOPE_SCHEMA,
    status: 'completed',
    diagnosticOnly: false,
    acceptanceEligible: true,
    planId: plan.planId,
    planArtifact: {
      path: 'qualification-plan.json',
      sha256: crypto.createHash('sha256').update(planBytes).digest('hex'),
    },
    buildReceipts,
    order: WEATHER_BALANCED_ORDER,
    startedAt,
    completedAt: new Date().toISOString(),
    children,
  };
  validateWeatherBalancedEnvelope(envelope, { root: outputRoot, plan });
  writeEnvelope(envelope);
} catch (error) {
  writeEnvelope({
    schema: WEATHER_BALANCED_ENVELOPE_SCHEMA,
    status: 'failed',
    diagnosticOnly: false,
    acceptanceEligible: false,
    planId: plan.planId,
    planArtifact: {
      path: 'qualification-plan.json',
      sha256: crypto.createHash('sha256').update(planBytes).digest('hex'),
    },
    buildReceipts,
    order: WEATHER_BALANCED_ORDER,
    startedAt,
    completedAt: new Date().toISOString(),
    children,
    error: String(error?.message || error).slice(0, 500),
  });
  throw error;
}
