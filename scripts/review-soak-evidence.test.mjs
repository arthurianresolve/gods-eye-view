import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { reviewSoakEvidence } from './review-soak-evidence.mjs';

const commit = 'a'.repeat(40);
const validator = 'b'.repeat(40);
const fixture = () => ({
  candidateCommit: commit,
  applicationCommit: commit,
  operationStatus: 'passed',
  durationMs: 3600000,
  stability: { status: 'failed', failures: ['maps.providerCacheReuses grew'] },
  checkpoints: Array.from({ length: 13 }, (_, i) => ({
    elapsedMs: i * 300000,
    metrics: {
      JSHeapUsedSize: 1000000,
      JSEventListeners: 100,
      application: {
        workers: { instrumented: true, overflow: false, workers: [] },
        resources: {
          primitives: 4,
          ownerResources: { maps: { cacheEntries: 2, providerCacheReuses: i } },
        },
      },
    },
  })),
});

test('reassessment hashes original bytes and preserves the earlier failed verdict', () => {
  const original = fixture();
  const bytes = Buffer.from(JSON.stringify(original));
  const review = reviewSoakEvidence(bytes, validator);
  assert.equal(review.outcome, 'passed');
  assert.equal(review.originalStability.status, 'failed');
  assert.equal(review.candidateCommit, commit);
  assert.equal(review.validatorCommit, validator);
  assert.equal(
    review.sourceSha256,
    createHash('sha256').update(bytes).digest('hex'),
  );
  assert.deepEqual(JSON.parse(bytes), original);
  assert.equal(review.hardwareRenderingValidated, false);
});

test('actual retention and failed operations remain failures', () => {
  const retained = fixture();
  retained.checkpoints.at(-1).metrics.application.resources.primitives++;
  assert.equal(
    reviewSoakEvidence(Buffer.from(JSON.stringify(retained)), validator)
      .outcome,
    'failed',
  );
  const operationFailure = fixture();
  operationFailure.operationStatus = 'failed';
  assert.equal(
    reviewSoakEvidence(Buffer.from(JSON.stringify(operationFailure)), validator)
      .outcome,
    'failed',
  );
});

test('nested hosted reports retain tested revision and reject mismatch or incomplete data', () => {
  const original = { commit, soak: fixture() };
  assert.equal(
    reviewSoakEvidence(Buffer.from(JSON.stringify(original)), validator)
      .candidateCommit,
    commit,
  );
  original.commit = validator;
  assert.throws(
    () => reviewSoakEvidence(Buffer.from(JSON.stringify(original)), validator),
    /revisions/,
  );
  assert.throws(
    () => reviewSoakEvidence(Buffer.from('{'), validator),
    SyntaxError,
  );
  const incomplete = fixture();
  incomplete.operationStatus = 'running';
  assert.throws(
    () =>
      reviewSoakEvidence(Buffer.from(JSON.stringify(incomplete)), validator),
    /Completed/,
  );
});
