import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateCandidateReadiness } from './qa-candidate.mjs';

test('candidate readiness distinguishes failed required gates from pending environment evidence', () => {
  assert.deepEqual(
    evaluateCandidateReadiness([{ required: true, status: 'passed' }]),
    {
      passed: true,
      releaseReady: true,
      failureCount: 0,
      pendingCount: 0,
    },
  );
  assert.deepEqual(
    evaluateCandidateReadiness([
      { required: true, status: 'passed' },
      { required: true, status: 'pending' },
    ]),
    { passed: true, releaseReady: false, failureCount: 0, pendingCount: 1 },
  );
  assert.deepEqual(
    evaluateCandidateReadiness([{ required: true, status: 'failed' }]),
    {
      passed: false,
      releaseReady: false,
      failureCount: 1,
      pendingCount: 1,
    },
  );
});
