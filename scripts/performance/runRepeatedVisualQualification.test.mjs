import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  prepareRepeatedVisualQualification,
  runRepeatedVisualQualification,
} from './runRepeatedVisualQualification.mjs';

test('preparation freezes all controls before acquisition and refuses reuse without starting a browser', async (t) => {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), 'gev-repeated-visual-plan-'),
  );
  t.after(async () => {
    const resolved = await fs.realpath(root);
    assert.equal(
      path.dirname(resolved).toLowerCase(),
      (await fs.realpath(os.tmpdir())).toLowerCase(),
    );
    assert.ok(path.basename(resolved).startsWith('gev-repeated-visual-plan-'));
    await fs.rm(resolved, { recursive: true, force: true });
  });
  const options = {
    out: root,
    'baseline-app-sha': 'a'.repeat(40),
    'candidate-app-sha': 'b'.repeat(40),
    'visual-harness-sha': 'c'.repeat(40),
  };
  const prepared = await prepareRepeatedVisualQualification(options);
  assert.equal(prepared.browserStarted, false);
  const plan = JSON.parse(
    await fs.readFile(path.join(root, 'plan.json'), 'utf8'),
  );
  assert.equal(plan.pngCount, 24);
  assert.deepEqual(plan.roleOrder, [
    'baseline',
    'candidate',
    'baseline',
    'candidate',
    'baseline',
    'candidate',
  ]);
  await assert.rejects(
    prepareRepeatedVisualQualification(options),
    /new and empty/,
  );
  await assert.rejects(
    runRepeatedVisualQualification({
      ...options,
      'candidate-app-sha': 'd'.repeat(40),
    }),
    /Prepared visual plan differs/,
  );
  await fs.writeFile(path.join(root, 'partial.json'), '{}', { flag: 'wx' });
  await assert.rejects(
    runRepeatedVisualQualification(options),
    /no partial batch may be rerun/,
  );
});
