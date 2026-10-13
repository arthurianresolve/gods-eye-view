import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AIRCRAFT_BILLBOARD_AUDIT_SCHEMA,
  createAircraftBillboardMutationAudit,
} from './aircraftBillboardMutationAudit.mjs';

test('flight and military snapshot producers retain Billboard identity through absence policy', () => {
  const report = createAircraftBillboardMutationAudit();
  assert.equal(report.schema, AIRCRAFT_BILLBOARD_AUDIT_SCHEMA);
  assert.equal(report.cesiumVersion, '1.138.0');
  assert.equal(report.fixture.recordCount, 3);
  assert.match(report.fixture.sha256, /^[a-f0-9]{64}$/);
  assert.equal(Object.keys(report.sourceSha256).length, 7);
  for (const sourceDigest of Object.values(report.sourceSha256))
    assert.match(sourceDigest, /^[a-f0-9]{64}$/);
  assert.match(report.scope, /no-webgl/);
  assert.equal(report.runs.length, 2);

  for (const run of report.runs) {
    const [
      initial,
      repeated,
      changed,
      partial,
      miss1,
      miss2,
      miss3,
      reappeared,
    ] = run.stages;
    assert.deepEqual(
      run.stages.map((stage) => stage.label),
      [
        'initial-population',
        'equivalent-repeat',
        'changed-positions-same-identities',
        'partial-absence-retained',
        'complete-miss-1',
        'complete-miss-2',
        'complete-miss-3-removal',
        'reappearance',
      ],
    );
    assert.equal(initial.added, 3);
    assert.equal(initial.collectionLength, 3);
    assert.equal(repeated.added, 0);
    assert.equal(repeated.removed, 0);
    assert.equal(repeated.identitySha256, initial.identitySha256);
    assert.equal(changed.added, 0);
    assert.equal(changed.removed, 0);
    assert.equal(changed.identitySha256, initial.identitySha256);
    assert.equal(partial.complete, false);
    assert.equal(partial.removed, 0);
    assert.equal(partial.retainedCount, 3);
    assert.deepEqual([miss1.removed, miss2.removed, miss3.removed], [0, 0, 3]);
    assert.equal(miss3.collectionLength, 0);
    assert.equal(reappeared.added, 1);
    assert.equal(reappeared.retainedCount, 1);
    assert.notEqual(reappeared.identitySha256, initial.identitySha256);
    assert.equal(run.churnControl.detected, true);
    assert.equal(run.churnControl.added, 3);
    assert.equal(run.churnControl.removedBeforeRepeat, 3);
    assert.equal(run.churnControl.removed, 0);
    assert.notEqual(
      run.churnControl.identitySha256,
      run.churnControl.previousIdentitySha256,
    );
    for (const cleanup of [run.cleanup, run.churnControl.cleanup]) {
      assert.equal(cleanup.lengthAfterRemoval, 0);
      assert.equal(cleanup.destroyed, true);
      assert.equal(cleanup.prototypeInstrumentationInstalled, false);
    }
  }

  const [flights, military] = report.runs;
  assert.equal(flights.stages[1].attemptedColorWrites, 3);
  assert.equal(military.stages[1].attemptedColorWrites, 0);
  for (const run of report.runs) {
    for (const stage of run.stages)
      assert.equal(stage.attemptedPositionWrites, 0);
  }
  assert.match(report.limitations.join(' '), /No WebGL context/);
  assert.match(
    report.limitations.join(' '),
    /no aircraft before\/after optimization/,
  );
});
