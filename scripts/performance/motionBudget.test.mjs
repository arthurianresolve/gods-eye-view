import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateMotionFrameBudget } from './motionBudget.mjs';

test('motion budgets exclude intentionally sparse idle frames', () => {
  assert.deepEqual(
    evaluateMotionFrameBudget(
      [
        { scenario: 'idle', run: 1, frameIntervalMs: { p95: 1_000 } },
        { scenario: 'scripted-motion', run: 1, frameIntervalMs: { p95: 40 } },
      ],
      50,
    ),
    { maxP95FrameMs: 50, status: 'passed', failures: [] },
  );
});

test('a moving-scene sample above the configured frame budget fails', () => {
  assert.deepEqual(
    evaluateMotionFrameBudget(
      [{ scenario: 'scripted-motion', run: 2, frameIntervalMs: { p95: 51 } }],
      50,
    ),
    {
      maxP95FrameMs: 50,
      status: 'failed',
      failures: [{ run: 2, p95FrameMs: 51, reason: 'budget-exceeded' }],
    },
  );
});

test('missing moving-scene metrics and missing motion samples remain incomplete', () => {
  assert.equal(
    evaluateMotionFrameBudget(
      [{ scenario: 'scripted-motion', run: 1, frameIntervalMs: { p95: null } }],
      50,
    ).status,
    'incomplete',
  );
  assert.equal(
    evaluateMotionFrameBudget(
      [{ scenario: 'idle', run: 1, frameIntervalMs: { p95: 1_000 } }],
      50,
    ).status,
    'incomplete',
  );
});

test('an omitted threshold records that no regression budget was evaluated', () => {
  assert.deepEqual(
    evaluateMotionFrameBudget([], 0),
    { maxP95FrameMs: null, status: 'not-configured', failures: [] },
  );
});
