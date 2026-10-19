#!/usr/bin/env node
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  assertBalancedStartupPlan,
  evaluateBalancedStartupConfirmation,
} from './performance/balancedStartupConfirmation.mjs';

function option(name) {
  const index = process.argv.indexOf(name);
  return index < 0 ? null : process.argv[index + 1] || null;
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

async function readJson(file) {
  const bytes = await fs.readFile(file);
  return { bytes, value: JSON.parse(bytes.toString('utf8')) };
}

async function resolveChild(root, relativePath) {
  if (
    typeof relativePath !== 'string' ||
    !relativePath ||
    path.isAbsolute(relativePath) ||
    relativePath.split(/[\\/]/).includes('..')
  )
    throw new Error('Startup artifact path must be a contained relative path.');
  const candidate = path.resolve(root, relativePath);
  const actual = await fs.realpath(candidate);
  const relative = path.relative(root, actual);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative))
    throw new Error(
      'Startup artifact resolved outside its evidence directory.',
    );
  return actual;
}

async function main() {
  const planPath = option('--plan');
  const envelopePath = option('--envelope');
  const outputPath = option('--out');
  const sealOnly = process.argv.includes('--seal');
  if (
    !planPath ||
    !outputPath ||
    (sealOnly && envelopePath) ||
    (!sealOnly && !envelopePath)
  )
    throw new Error(
      'Usage: node scripts/review-balanced-startup-confirmation.mjs --plan <predeclared.json> --seal --out <new-envelope.json>, or --plan <predeclared.json> --envelope <completed.json> --out <new-review.json>',
    );

  const absolutePlan = path.resolve(planPath);
  const evidenceRoot = await fs.realpath(path.dirname(absolutePlan));
  const planFile = await readJson(absolutePlan);
  const planSha256 = sha256(planFile.bytes);
  assertBalancedStartupPlan(planFile.value);
  if (sealOnly) {
    const slots = [];
    for (const slot of planFile.value.slots) {
      const shardPath = await resolveChild(evidenceRoot, slot.path);
      const bytes = await fs.readFile(shardPath);
      slots.push({
        slotId: slot.slotId,
        role: slot.role,
        path: slot.path,
        sha256: sha256(bytes),
      });
    }
    const envelope = {
      schema: 'gev-balanced-startup-envelope/v1',
      status: 'completed',
      sealedAt: new Date().toISOString(),
      planSha256,
      slots,
    };
    const absoluteOutput = path.resolve(outputPath);
    await fs.mkdir(path.dirname(absoluteOutput), { recursive: true });
    await fs.writeFile(
      absoluteOutput,
      `${JSON.stringify(envelope, null, 2)}\n`,
      {
        encoding: 'utf8',
        flag: 'wx',
      },
    );
    process.stdout.write(
      `${JSON.stringify({ status: envelope.status, output: absoluteOutput })}\n`,
    );
    return;
  }
  const envelopeFile = await readJson(path.resolve(envelopePath));
  const envelope = envelopeFile.value;
  if (envelope?.schema !== 'gev-balanced-startup-envelope/v1')
    throw new Error('Startup envelope schema is invalid.');
  if (envelope?.status !== 'completed')
    throw new Error('Startup envelope is not completed.');
  if (envelope?.planSha256 !== planSha256)
    throw new Error('Startup envelope does not bind the exact plan bytes.');
  if (!Array.isArray(envelope?.slots) || envelope.slots.length !== 10)
    throw new Error('Startup envelope must contain all ten slots.');

  const shards = [];
  for (let index = 0; index < planFile.value.slots.length; index++) {
    const declared = planFile.value.slots[index];
    const receipt = envelope.slots[index];
    if (
      receipt?.slotId !== declared.slotId ||
      receipt?.role !== declared.role ||
      receipt?.path !== declared.path
    )
      throw new Error(`Startup envelope slot ${index + 1} differs from plan.`);
    const shardPath = await resolveChild(evidenceRoot, declared.path);
    const shardFile = await readJson(shardPath);
    const actualSha256 = sha256(shardFile.bytes);
    if (receipt.sha256 !== actualSha256)
      throw new Error(`Startup shard ${declared.slotId} hash differs.`);
    shards.push({
      slot: declared,
      sha256: actualSha256,
      report: shardFile.value,
    });
  }

  const evaluated = evaluateBalancedStartupConfirmation({
    plan: planFile.value,
    shards,
  });
  const review = {
    ...evaluated,
    createdAt: new Date().toISOString(),
    plan: { path: path.basename(absolutePlan), sha256: planSha256 },
    envelope: {
      path: path.basename(path.resolve(envelopePath)),
      sha256: sha256(envelopeFile.bytes),
    },
    shards: shards.map(({ slot, sha256 }) => ({
      slotId: slot.slotId,
      role: slot.role,
      path: slot.path,
      sha256,
    })),
    note: 'Startup-only confirmation. It does not replace historical failed evidence or qualify motion performance.',
  };
  const absoluteOutput = path.resolve(outputPath);
  await fs.mkdir(path.dirname(absoluteOutput), { recursive: true });
  await fs.writeFile(absoluteOutput, `${JSON.stringify(review, null, 2)}\n`, {
    encoding: 'utf8',
    flag: 'wx',
  });
  process.stdout.write(
    `${JSON.stringify({ status: review.status, output: absoluteOutput })}\n`,
  );
  if (review.status === 'failed') process.exitCode = 1;
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  main().catch((error) => {
    process.stderr.write(`${String(error?.message || error).slice(0, 1000)}\n`);
    process.exitCode = 1;
  });
