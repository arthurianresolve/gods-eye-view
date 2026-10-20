import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  parseFinalVisualQualificationArgs,
  produceRepeatedVisualPairEvidence,
} from './runFinalVisualQualification.mjs';
import {
  createRepeatedVisualPlan,
  validateRepeatedVisualQualification,
} from './repeatedVisualQualification.mjs';

const json = (value) => Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');

/** Preparation performs no browser work. The policy is frozen before acquisition. */
export async function prepareRepeatedVisualQualification(options) {
  const out = path.resolve(options.out);
  await fs.mkdir(out, { recursive: true });
  assert.equal(
    (await fs.readdir(out)).length,
    0,
    'Repeated output must be new and empty',
  );
  const bytes = json(createRepeatedVisualPlan(options));
  await fs.writeFile(path.join(out, 'plan.json'), bytes, { flag: 'wx' });
  return { planSha256: digest(bytes), outputRoot: out, browserStarted: false };
}

export async function runRepeatedVisualQualification(options) {
  const out = path.resolve(options.out);
  assert.deepEqual(
    (await fs.readdir(out)).sort(),
    ['plan.json'],
    'Use the prepared fresh batch; no partial batch may be rerun or overwritten',
  );
  const planBytes = await fs.readFile(path.join(out, 'plan.json'));
  assert.deepEqual(
    JSON.parse(planBytes.toString('utf8')),
    createRepeatedVisualPlan(options),
    'Prepared visual plan differs from requested application or producer identity',
  );
  const planSha256 = digest(planBytes);
  const plan = JSON.parse(planBytes.toString('utf8'));
  const pairs = [];
  const completed = [];
  let stage = 'capture';
  try {
    // Fixed BC / BC / BC acquisition. Each call owns two newly launched browsers
    // and fresh documents. Do not inspect pixels until all six documents finish.
    for (let ordinal = 1; ordinal <= 3; ordinal++) {
      const pairRoot = path.join(out, `pair-${ordinal}`);
      await produceRepeatedVisualPairEvidence({
        ...options,
        out: pairRoot,
        repeatedControlPlan: {
          policy: plan.policy,
          planSha256,
          pairOrdinal: ordinal,
        },
      });
      const bytes = await fs.readFile(
        path.join(pairRoot, 'final-visual-qualification.json'),
      );
      pairs.push({ bytes, evidenceRoot: pairRoot });
      completed.push({ pairOrdinal: ordinal, reportSha256: digest(bytes) });
    }
    stage = 'validation';
    const result = await validateRepeatedVisualQualification({
      planBytes,
      pairs,
    });
    await fs.writeFile(path.join(out, 'validation.json'), json(result), {
      flag: 'wx',
    });
    return result;
  } catch (error) {
    await fs.writeFile(
      path.join(out, 'failure.json'),
      json({
        schema: 'gev-repeated-visual-qualification-failure/v1',
        planSha256,
        stage,
        completed,
        status: 'failed',
        error: String(error?.message || error).slice(0, 1000),
      }),
      { flag: 'wx' },
    );
    throw error;
  }
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const options = parseFinalVisualQualificationArgs(process.argv);
  assert.ok(
    ['prepare', 'run'].includes(options.mode),
    '--mode prepare or --mode run required',
  );
  const result =
    options.mode === 'prepare'
      ? await prepareRepeatedVisualQualification(options)
      : await runRepeatedVisualQualification(options);
  console.log(JSON.stringify(result));
}
