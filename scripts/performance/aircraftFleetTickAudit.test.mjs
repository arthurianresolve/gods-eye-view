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
  for (const variant of [
    changedAltitude,
    changedCompleteness,
    changedOrder,
    changedClock,
  ])
    assert.notEqual(aircraftFleetTickFixtureSha256(variant), baseline);
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
