import assert from 'node:assert/strict';
import test from 'node:test';
import {
  aircraftFleetTickFixtureSha256,
  createAircraftFleetTickAudit,
  createAircraftFleetTickFixtureDescriptor,
} from './aircraftFleetTickAudit.mjs';

test('real flight and military fleet ticks cover representative mutation owners', () => {
  const originalNow = Date.now;
  const report = createAircraftFleetTickAudit();

  assert.equal(report.clock.restoredAfterRun, true);
  assert.equal(Date.now, originalNow);
  assert.match(report.source.gitHead, /^[a-f0-9]{40}$/);
  assert.equal(typeof report.source.workingTreeClean, 'boolean');
  assert.match(report.source.statusSha256, /^[a-f0-9]{64}$/);
  assert.match(report.source.lockfileSha256, /^[a-f0-9]{64}$/);
  assert.equal(report.source.cesiumVersion, '1.138.0');
  assert.equal(
    report.fixture.descriptor.cadenceMs,
    report.fixture.descriptor.militaryCadenceMs,
  );
  assert.match(report.fixture.sha256, /^[a-f0-9]{64}$/);
  assert.equal(
    report.fixture.sha256,
    aircraftFleetTickFixtureSha256(report.fixture.descriptor),
  );
  assert.deepEqual(
    report.runs.map(({ kind }) => kind),
    ['flights', 'military'],
  );

  for (const run of report.runs) {
    assert.equal(run.tick.tickAdds, 0);
    assert.equal(run.tick.tickRemoves, 0);
    assert.equal(run.tick.identityPreserved, true);
    assert.deepEqual(Object.values(run.tick.witnesses), Array(7).fill(true));
    assert.deepEqual(
      run.stages.map(({ name }) => name),
      [
        'cold-due',
        'sub-cadence-skip',
        'next-due',
        'warmed-repeat',
        'changed-moving-input',
      ],
    );
    const [cold, skipped, nextDue, warmed, changed] = run.stages;
    assert.equal(cold.executed, true);
    assert.equal(skipped.executed, false);
    assert.equal(skipped.lastFleetTickMsAfter, cold.lastFleetTickMsAfter);
    assert.equal(skipped.identityPreserved, true);
    assert.equal(skipped.movingDeltaM, cold.movingDeltaM);
    assert.equal(nextDue.executed, true);
    assert.equal(nextDue.lastFleetTickMsAfter - cold.lastFleetTickMsAfter, 80);
    assert.equal(warmed.executed, true);
    assert.equal(warmed.identityPreserved, true);
    assert.deepEqual(warmed.writeDeltas, nextDue.writeDeltas);
    assert.equal(changed.executed, true);
    assert.equal(changed.movingDeltaM, 10);
    const movingId = report.fixture.descriptor.contacts.find(
      ({ role }) => role === 'moving',
    ).id;
    assert.equal(
      changed.writeDeltas.find(({ id }) => id === movingId).position,
      1,
    );
    assert.equal(run.scratchArgumentUse.uniqueScratchArguments, 1);
    assert.ok(run.scratchArgumentUse.deadReckonCalls > 0);
    assert.equal(run.churn.detectsChurn, true);
    assert.equal(run.churn.cardinalityBefore, run.churn.cardinalityAfter);
    assert.equal(run.cleanup.collectionDestroyed, true);
    assert.equal(run.cleanup.recordsCleared, true);
    assert.equal(run.allocations.cesiumCartesianAllocations, null);
    assert.equal(run.allocations.applicationHeapAllocations, null);
    assert.equal(run.allocations.gpuUploads, null);

    const writes = new Map(run.tick.writeDeltas.map((row) => [row.id, row]));
    const contacts = new Map(
      report.fixture.descriptor.contacts.map((contact) => [
        contact.role,
        contact,
      ]),
    );
    assert.equal(writes.get(contacts.get('stationary').id).position, 0);
    assert.equal(writes.get(contacts.get('moving').id).position, 1);
    assert.equal(writes.get(contacts.get('selected').id).position, 0);
    assert.equal(writes.get(contacts.get('selected').id).show, 0);
    assert.equal(writes.get(contacts.get('fading').id).color, 1);
    assert.equal(writes.get(contacts.get('horizon-hidden').id).show, 1);
    assert.equal(
      run.tick.modelHandoffs.find(
        ({ id }) => id === contacts.get('model-handoff').id,
      ).modelShown,
      true,
    );
  }
});

test('fleet fixture identity changes with altitude, completeness, order, and clock', () => {
  const fixture = createAircraftFleetTickFixtureDescriptor();
  const baseline = aircraftFleetTickFixtureSha256(fixture);
  const changedAltitude = createAircraftFleetTickFixtureDescriptor({
    altitudeOffsetM: 500,
  });
  const changedCompleteness = createAircraftFleetTickFixtureDescriptor({
    complete: false,
  });
  const changedOrder = createAircraftFleetTickFixtureDescriptor({
    stageOrder: [...fixture.stageOrder].reverse(),
  });
  const changedClock = createAircraftFleetTickFixtureDescriptor({
    receiptClockMs: fixture.receiptClockMs + 1,
  });
  const changedTickSequence = {
    ...fixture,
    tickSequence: fixture.tickSequence.map((stage, index) =>
      index === 1 ? { ...stage, offsetMs: stage.offsetMs + 1 } : stage,
    ),
  };
  for (const variant of [
    changedAltitude,
    changedCompleteness,
    changedOrder,
    changedClock,
  ])
    assert.notEqual(aircraftFleetTickFixtureSha256(variant), baseline);
  assert.notEqual(
    aircraftFleetTickFixtureSha256(changedTickSequence),
    baseline,
  );
});

test('fleet audit restores the deterministic receipt clock after a failure', () => {
  const originalNow = Date.now;
  const invalidFixture = {
    ...createAircraftFleetTickFixtureDescriptor(),
    contacts: [],
  };
  assert.throws(
    () => createAircraftFleetTickAudit({ fixture: invalidFixture }),
    /id|contact/i,
  );
  assert.equal(Date.now, originalNow);
});

test('setup failure destroys the owned billboard collection and restores clock', () => {
  const originalNow = Date.now;
  let createdCollection;
  assert.throws(
    () =>
      createAircraftFleetTickAudit({
        onCollectionCreated(counted) {
          createdCollection = counted.collection;
          throw new Error('injected setup failure');
        },
      }),
    /injected setup failure/,
  );
  assert.ok(createdCollection);
  assert.equal(createdCollection.isDestroyed(), true);
  assert.equal(createdCollection.length, 0);
  assert.equal(Date.now, originalNow);
});
