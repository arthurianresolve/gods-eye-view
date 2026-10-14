import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assessHostedSourceFinish,
  assessHostedSourceStart,
  inspectTrackedWorktree,
} from './hostedSourceProvenance.mjs';

const commit = 'a'.repeat(40);
const replacementCommit = 'b'.repeat(40);

function fakeInspection(head, status = '') {
  return inspectTrackedWorktree({
    execute(args) {
      if (args[0] === 'rev-parse') return `${head}\n`;
      if (args[0] === 'status') return status;
      throw new Error('unexpected git command');
    },
  });
}

test('clean matching checkout is eligible and remains unchanged', () => {
  const start = fakeInspection(commit);
  assert.deepEqual(assessHostedSourceStart(start, commit), {
    harnessCommit: commit,
    sourceDirtyAtStart: false,
    harnessDirtyAtStart: false,
    valid: true,
    error: null,
  });
  assert.deepEqual(assessHostedSourceFinish(start, fakeInspection(commit)), {
    sourceChangedDuringRun: false,
    harnessChangedDuringRun: false,
    error: null,
  });
});

test('wrong expected revision is rejected before measurement', () => {
  const start = fakeInspection(commit);
  assert.equal(assessHostedSourceStart(start, replacementCommit).valid, false);
});

test('tracked dirty input is reported and rejected', () => {
  const start = fakeInspection(commit, ' M src/app.js\n');
  const assessment = assessHostedSourceStart(start, commit);
  assert.equal(assessment.valid, false);
  assert.equal(assessment.sourceDirtyAtStart, true);
  assert.equal(assessment.harnessDirtyAtStart, true);
});

test('HEAD change during run marks both source and harness changed', () => {
  const start = fakeInspection(commit);
  assert.deepEqual(
    assessHostedSourceFinish(start, fakeInspection(replacementCommit)),
    {
      sourceChangedDuringRun: true,
      harnessChangedDuringRun: true,
      error: null,
    },
  );
});

test('tracked source change during run is detected without a commit change', () => {
  const start = fakeInspection(commit);
  assert.deepEqual(
    assessHostedSourceFinish(start, fakeInspection(commit, ' M src/app.js\n')),
    {
      sourceChangedDuringRun: true,
      harnessChangedDuringRun: true,
      error: null,
    },
  );
});

test('unavailable inspection stays unknown and can never be treated as clean', () => {
  const unavailable = inspectTrackedWorktree({
    execute() {
      throw new Error('git unavailable');
    },
  });
  const start = assessHostedSourceStart(unavailable, commit);
  assert.equal(start.valid, false);
  assert.equal(start.harnessCommit, null);
  assert.equal(start.sourceDirtyAtStart, null);
  assert.equal(start.harnessDirtyAtStart, null);
  assert.equal(
    assessHostedSourceFinish(unavailable, unavailable).sourceChangedDuringRun,
    null,
  );
});
