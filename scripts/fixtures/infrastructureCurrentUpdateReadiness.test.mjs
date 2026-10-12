import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createInfrastructureCurrentUpdateReadinessEnvelope,
  createInfrastructureCurrentUpdateReadinessSample,
  infrastructureCurrentUpdateReadinessOptionEnabled,
  installInfrastructureCurrentUpdateReadinessObserver,
  readInfrastructureCurrentUpdateWitness,
  validateInfrastructureCurrentUpdateReadinessEnvelope,
} from './infrastructureCurrentUpdateReadiness.mjs';

class FakeEvent {
  listeners = new Set();

  addEventListener(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  raiseEvent(...args) {
    for (const listener of [...this.listeners]) listener(...args);
  }
}

function fixtureDisplay(updates = []) {
  const collectionChanged = new FakeEvent();
  const display = {
    ready: false,
    calls: [],
    update(...args) {
      this.calls.push(args);
      const result = updates.length ? updates.shift() : true;
      this.ready ||= result === true;
      return result;
    },
  };
  const scene = {
    frameState: { frameNumber: 0 },
    preRender: new FakeEvent(),
    postRender: new FakeEvent(),
  };
  const entityCollection = { collectionChanged };
  return {
    display,
    scene,
    entityCollection,
    frame() {
      scene.frameState.frameNumber += 1;
      scene.preRender.raiseEvent(scene);
      scene.postRender.raiseEvent(scene);
    },
  };
}

test('current update result rejects latched ready true until the current generation recovers', () => {
  const fixture = fixtureDisplay([true, false, true]);
  const observer = installInfrastructureCurrentUpdateReadinessObserver({
    dataSourceDisplay: fixture.display,
    scene: fixture.scene,
    entityCollection: fixture.entityCollection,
  });
  assert.equal(observer.available, true);

  const firstGeneration = observer.beginGeneration().generation;
  assert.equal(fixture.display.update('time-1'), true);
  fixture.frame();
  const initial = observer.read();
  assert.equal(fixture.display.ready, true);
  assert.equal(observer.isCurrentFrameReady(initial, firstGeneration), true);

  const changedGeneration = observer.beginGeneration().generation;
  assert.equal(fixture.display.update('time-2'), false);
  fixture.frame();
  const pending = observer.read();
  assert.equal(fixture.display.ready, true);
  assert.equal(pending.updateReturnedBoolean, false);
  assert.equal(observer.isCurrentFrameReady(pending, changedGeneration), false);

  assert.equal(fixture.display.update('time-3'), true);
  fixture.frame();
  assert.equal(
    observer.isCurrentFrameReady(observer.read(), changedGeneration),
    true,
  );
  assert.equal(fixture.display.calls.length, 3);
  assert.equal(observer.dispose(), true);
});

test('collection mutation and generation changes invalidate prior update readiness', () => {
  const fixture = fixtureDisplay([true, true, true]);
  const observer = installInfrastructureCurrentUpdateReadinessObserver({
    dataSourceDisplay: fixture.display,
    scene: fixture.scene,
    entityCollection: fixture.entityCollection,
  });
  const generation = observer.beginGeneration().generation;
  fixture.display.update('time-1');
  fixture.scene.frameState.frameNumber += 1;
  fixture.scene.preRender.raiseEvent(fixture.scene);
  fixture.entityCollection.collectionChanged.raiseEvent();
  fixture.scene.postRender.raiseEvent(fixture.scene);
  const mutatedDuringRender = observer.read();
  assert.equal(
    observer.isCurrentFrameReady(mutatedDuringRender, generation),
    false,
  );

  const nextGeneration = observer.beginGeneration().generation;
  fixture.display.update('time-2');
  fixture.frame();
  const readyBeforeMutation = observer.read();
  assert.equal(
    observer.isCurrentFrameReady(readyBeforeMutation, nextGeneration),
    true,
  );
  fixture.entityCollection.collectionChanged.raiseEvent();
  assert.equal(
    observer.isCurrentFrameReady(readyBeforeMutation, nextGeneration),
    false,
  );

  observer.beginGeneration();
  fixture.frame();
  assert.equal(
    observer.isCurrentFrameReady(observer.read(), nextGeneration),
    false,
  );
  assert.equal(observer.dispose(), true);
});

test('update wrapper preserves this, arguments, return value and thrown errors', () => {
  const fixture = fixtureDisplay();
  const marker = Symbol('caller-this');
  const calls = [];
  fixture.display.update = function (...args) {
    calls.push({ thisValue: this, args });
    if (args[0] === 'throw') throw new TypeError('source update failed');
    return args[1];
  };
  const original = fixture.display.update;
  const observer = installInfrastructureCurrentUpdateReadinessObserver({
    dataSourceDisplay: fixture.display,
    scene: fixture.scene,
    entityCollection: fixture.entityCollection,
  });
  const generation = observer.beginGeneration().generation;
  // A foreign receiver is forwarded faithfully but is not attributed to this display.
  assert.equal(fixture.display.update.call(marker, 'args', true), true);
  assert.equal(observer.snapshot().updateCallCount, 0);
  assert.equal(fixture.display.update('owned', true), true);
  fixture.frame();
  assert.equal(observer.isCurrentFrameReady(observer.read(), generation), true);
  assert.throws(
    () => fixture.display.update('throw', false),
    /source update failed/,
  );
  assert.equal(calls.length, 3);
  assert.equal(calls[0].thisValue, marker);
  assert.deepEqual(calls[0].args, ['args', true]);
  fixture.frame();
  assert.equal(observer.read().updateErrorName, 'TypeError');
  assert.equal(observer.dispose(), true);
  assert.equal(fixture.display.update, original);
});

test('dispose reports an update replacement and leaves the later owner intact', () => {
  const fixture = fixtureDisplay();
  const observer = installInfrastructureCurrentUpdateReadinessObserver({
    dataSourceDisplay: fixture.display,
    scene: fixture.scene,
    entityCollection: fixture.entityCollection,
  });
  const laterOwner = () => 'later owner';
  fixture.display.update = laterOwner;
  assert.equal(observer.dispose(), false);
  assert.equal(fixture.display.update, laterOwner);
  assert.equal(
    observer.snapshot().updateRestoreStatus,
    'replaced-by-another-owner',
  );
  assert.equal(fixture.scene.preRender.listeners.size, 0);
  assert.equal(fixture.scene.postRender.listeners.size, 0);
  assert.equal(fixture.entityCollection.collectionChanged.listeners.size, 0);
});

test('inactive observer rejects snapshots and retained wrapper only forwards', () => {
  const fixture = fixtureDisplay([true, true]);
  const observer = installInfrastructureCurrentUpdateReadinessObserver({
    dataSourceDisplay: fixture.display,
    scene: fixture.scene,
    entityCollection: fixture.entityCollection,
  });
  const retainedWrapper = fixture.display.update;
  observer.beginGeneration();
  fixture.display.update('before-dispose');
  fixture.frame();
  assert.ok(observer.read());
  assert.equal(observer.dispose(), true);
  assert.equal(observer.read(), null);
  assert.equal(observer.isCurrentFrameReady(observer.snapshot(), 1), false);

  const callCount = observer.snapshot().updateCallCount;
  assert.equal(
    Reflect.apply(retainedWrapper, fixture.display, ['retained']),
    true,
  );
  assert.equal(observer.snapshot().updateCallCount, callCount);
  assert.equal(fixture.display.calls.length, 2);
});

test('witness callback failures explicitly produce unavailable readiness', () => {
  assert.deepEqual(
    readInfrastructureCurrentUpdateWitness(
      {
        available: true,
        read() {
          throw new Error('observer snapshot failed');
        },
        isCurrentFrameReady() {
          return true;
        },
      },
      1,
    ),
    { snapshot: null, ready: false },
  );
  assert.deepEqual(
    readInfrastructureCurrentUpdateWitness(
      {
        available: true,
        read: () => ({ completedRenderRevision: 1 }),
        isCurrentFrameReady() {
          throw new Error('readiness callback failed');
        },
      },
      1,
    ),
    { snapshot: { completedRenderRevision: 1 }, ready: false },
  );
});

test('partial observer setup rolls back its wrapper when an event cannot be observed', () => {
  const fixture = fixtureDisplay();
  fixture.scene.postRender = {};
  const original = fixture.display.update;
  const observer = installInfrastructureCurrentUpdateReadinessObserver({
    dataSourceDisplay: fixture.display,
    scene: fixture.scene,
    entityCollection: fixture.entityCollection,
  });
  assert.equal(observer.available, false);
  assert.equal(observer.snapshot().installErrorName, 'TypeError');
  assert.equal(fixture.display.update, original);
  assert.equal(fixture.scene.preRender.listeners.size, 0);
});

function validCapture(generation = 1) {
  return {
    completedRenderRevision: 1,
    updateSequenceAtPreRender: 1,
    updateSequenceAtPostRender: 1,
    updateGeneration: generation,
    generationAtPreRender: generation,
    generationAtPostRender: generation,
    updateReturnedBoolean: true,
    updateErrorName: null,
    collectionRevisionAtUpdateEntry: 2,
    collectionRevisionAtUpdateReturn: 2,
    collectionRevisionAtPreRender: 2,
    collectionRevisionAtPostRender: 2,
    updateOccurredForFrame: true,
  };
}

test('validator accepts exact current-update witnesses and rejects forged readiness', () => {
  const envelope = createInfrastructureCurrentUpdateReadinessEnvelope();
  envelope.status = 'complete';
  for (const lifetime of envelope.lifetimes) {
    lifetime.available = true;
    lifetime.cleanupConfirmed = true;
    lifetime.finalObserverState = {
      schema: 'gev-infrastructure-current-update-readiness/v1',
      available: true,
      cleanupConfirmed: true,
      updateRestoreStatus: 'restored',
      generationCount: 15,
      updateCallCount: 15,
      collectionRevision: 2,
      completedRenderRevision: 15,
      installErrorName: null,
    };
    const caseIds = [
      'default-style',
      'camera-lod-update-baseline',
      'camera-lod-update',
    ];
    let generation = 0;
    for (const caseId of caseIds)
      for (let pair = 0; pair < 5; pair++) {
        generation += 1;
        lifetime.samples.push({
          caseId,
          pair,
          status: 'settled',
          generation,
          capture: validCapture(generation),
          captureFrameErrorName: null,
          lastObserverSnapshot: null,
          currentUpdateReadyForGeneration: true,
          latchedDataSourceDisplayReady: true,
        });
      }
  }
  assert.equal(
    validateInfrastructureCurrentUpdateReadinessEnvelope(envelope),
    envelope,
  );
  const forged = structuredClone(envelope);
  forged.lifetimes[0].samples[0].capture.collectionRevisionAtPostRender = 3;
  assert.throws(
    () => validateInfrastructureCurrentUpdateReadinessEnvelope(forged),
    /witness exceeds|readiness does not match/,
  );
  const missingCleanup = structuredClone(envelope);
  missingCleanup.lifetimes[0].cleanupConfirmed = false;
  assert.throws(
    () => validateInfrastructureCurrentUpdateReadinessEnvelope(missingCleanup),
    /cleanup unconfirmed/,
  );
  const negativeCounter = structuredClone(envelope);
  negativeCounter.lifetimes[0].finalObserverState.collectionRevision = -1;
  assert.throws(
    () => validateInfrastructureCurrentUpdateReadinessEnvelope(negativeCounter),
    /final observer state is malformed/,
  );
  const extraField = structuredClone(envelope);
  extraField.instrumentationPayload = 'unexpected';
  assert.throws(
    () => validateInfrastructureCurrentUpdateReadinessEnvelope(extraField),
    /envelope contract mismatch/,
  );
  const duplicate = structuredClone(envelope);
  duplicate.lifetimes[0].samples.push({
    ...duplicate.lifetimes[0].samples[0],
  });
  assert.throws(
    () => validateInfrastructureCurrentUpdateReadinessEnvelope(duplicate),
    /duplicate sample identity/,
  );
});

test('partial failure evidence can remain unavailable but cannot claim readiness', () => {
  const envelope = createInfrastructureCurrentUpdateReadinessEnvelope();
  envelope.status = 'partial-or-diagnostic-error';
  envelope.lifetimes[0].samples.push({
    caseId: 'camera-lod-update',
    pair: 0,
    status: 'failed',
    generation: null,
    capture: null,
    captureFrameErrorName: null,
    lastObserverSnapshot: null,
    currentUpdateReadyForGeneration: false,
    latchedDataSourceDisplayReady: null,
  });
  assert.equal(
    validateInfrastructureCurrentUpdateReadinessEnvelope(envelope, {
      allowPartial: true,
    }),
    envelope,
  );
  envelope.lifetimes[0].samples[0].currentUpdateReadyForGeneration = true;
  assert.throws(
    () =>
      validateInfrastructureCurrentUpdateReadinessEnvelope(envelope, {
        allowPartial: true,
      }),
    /cannot claim readiness/,
  );
});

test('fixture sample builder constructs bounded success and failure records', () => {
  const success = createInfrastructureCurrentUpdateReadinessSample({
    caseId: 'default-style',
    pair: 0,
    status: 'settled',
    generation: 1,
    capture: validCapture(),
    lastObserverSnapshot: null,
    captureFrameErrorName: null,
    currentUpdateReadyForGeneration: true,
    latchedDataSourceDisplayReady: true,
  });
  assert.equal(success.currentUpdateReadyForGeneration, true);
  assert.equal(success.status, 'settled');

  const failure = createInfrastructureCurrentUpdateReadinessSample({
    caseId: 'camera-lod-update',
    pair: 0,
    status: 'failed',
    generation: null,
    capture: null,
    lastObserverSnapshot: null,
    captureFrameErrorName: 'Error',
    currentUpdateReadyForGeneration: false,
    latchedDataSourceDisplayReady: null,
  });
  assert.equal(failure.currentUpdateReadyForGeneration, false);
  assert.equal(failure.capture, null);
  assert.equal(failure.status, 'failed');
});

test('failed gate may retain a valid current-update witness without claiming fixture success', () => {
  const envelope = createInfrastructureCurrentUpdateReadinessEnvelope();
  envelope.status = 'partial-or-diagnostic-error';
  const lifetime = envelope.lifetimes[0];
  lifetime.samples.push({
    caseId: 'default-style',
    pair: 0,
    status: 'failed',
    generation: 1,
    capture: validCapture(),
    captureFrameErrorName: null,
    lastObserverSnapshot: null,
    currentUpdateReadyForGeneration: true,
    latchedDataSourceDisplayReady: true,
  });
  assert.equal(
    validateInfrastructureCurrentUpdateReadinessEnvelope(envelope, {
      allowPartial: true,
    }),
    envelope,
  );
  lifetime.samples[0].capture.updateSequenceAtPreRender = null;
  assert.throws(
    () =>
      validateInfrastructureCurrentUpdateReadinessEnvelope(envelope, {
        allowPartial: true,
      }),
    /sample witness is malformed/,
  );
});

test('CLI option is datacenter-only and mutually exclusive with other diagnostics', () => {
  assert.equal(infrastructureCurrentUpdateReadinessOptionEnabled([]), false);
  assert.equal(
    infrastructureCurrentUpdateReadinessOptionEnabled([
      '--infrastructure-datacenters',
      '--infrastructure-current-update-readiness',
    ]),
    true,
  );
  assert.throws(
    () =>
      infrastructureCurrentUpdateReadinessOptionEnabled([
        '--infrastructure-current-update-readiness',
      ]),
    /requires --infrastructure-datacenters/,
  );
  assert.throws(
    () =>
      infrastructureCurrentUpdateReadinessOptionEnabled([
        '--infrastructure-datacenters',
        '--infrastructure-current-update-readiness',
        '--infrastructure-pick-path-diagnostic',
      ]),
    /must run separately/,
  );
});
