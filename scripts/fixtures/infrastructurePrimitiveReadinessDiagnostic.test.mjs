import test from 'node:test';
import assert from 'node:assert/strict';
import * as Cesium from 'cesium';
import {
  collectInfrastructurePrimitiveReadiness,
  createInfrastructurePrimitiveReadinessEnvelope,
  createInfrastructurePrimitiveReadinessLifetime,
  infrastructurePrimitiveReadinessDiagnosticOptionEnabled,
  infrastructurePrimitiveReadinessDiagnosticRequested,
  observePrimitiveReadinessAfterFailure,
  selectPrimitiveReadinessTargets,
  validateInfrastructurePrimitiveReadinessEnvelope,
  validateInfrastructurePrimitiveReadinessReport,
} from './infrastructurePrimitiveReadinessDiagnostic.mjs';

const commit = 'a'.repeat(40);
const target = {
  entityId: 'fixture:target',
  sourceRecordId: 'target',
  visible: true,
};
const sourceEntity = new Cesium.Entity({ id: target.entityId });
const candidates = [target];
const gateFailure = {
  caseId: 'default-style',
  pair: 0,
  status: 'failed',
  stableFrames: 3,
  completedCaptures: 1,
  pickSearches: 1,
  geometryReady: true,
  sourceReady: true,
  pointPickObserved: true,
  stemPickObserved: false,
};

function viewerWith(
  primitives,
  groundPrimitives = new Cesium.PrimitiveCollection(),
) {
  return {
    dataSourceDisplay: { ready: true },
    scene: { primitives, groundPrimitives },
  };
}

function makeFixturePrimitive() {
  return new Cesium.Primitive({
    geometryInstances: [],
    appearance: new Cesium.PerInstanceColorAppearance(),
  });
}

function makeSnapshot(CesiumApi, viewer, options = {}) {
  return collectInfrastructurePrimitiveReadiness({
    Cesium: CesiumApi,
    viewer,
    candidates,
    entityById: new Map([[target.entityId, sourceEntity]]),
    ...options,
  });
}

function makeValidTriggeredEnvelope(snapshot) {
  const envelope = createInfrastructurePrimitiveReadinessEnvelope();
  const { report } = createInfrastructurePrimitiveReadinessLifetime(
    envelope,
    'entities',
  );
  report.status = 'observed';
  report.originalGate = gateFailure;
  report.targets = [
    {
      ...target,
      pointStatus: snapshot.targets[0]?.pointStatus || 'unknown',
      stemStatus: snapshot.targets[0]?.stemStatus || 'unknown',
    },
  ];
  report.initialSnapshot = snapshot;
  report.renderRevisionObserver = {
    available: true,
    cleanupConfirmed: true,
  };
  report.postFailureObservation = {
    phase: 'post-failure-later-frame-observation',
    originalGateFailed: true,
    acceptanceEligible: false,
    originalGate: gateFailure,
    requestedDiagnosticRender: true,
    additionalPickCalls: 0,
    durationBudgetMs: 3000,
    elapsedMs: 12,
    overBudget: false,
    status: 'completed-frame-observed',
    frame: {
      width: 32,
      height: 24,
      pixelSha256: 'b'.repeat(64),
      pngBase64: 'AA==',
      pngStatus: 'retained',
      completedFrameState: {
        completedRenderRevision: 8,
        cameraPosition: [1, 2, 3],
        renderClockIso: '2026-10-12T10:00:00.000Z',
        primitiveReadiness: snapshot,
      },
      completedFrameStateErrorName: null,
    },
  };
  envelope.status = 'partial-or-diagnostic-error';
  return envelope;
}

test('only explicitly requested datacenter diagnostics enable the fixture option', () => {
  assert.equal(
    infrastructurePrimitiveReadinessDiagnosticOptionEnabled([]),
    false,
  );
  assert.equal(
    infrastructurePrimitiveReadinessDiagnosticOptionEnabled([
      '--infrastructure-datacenters',
      '--infrastructure-primitive-readiness-diagnostic',
    ]),
    true,
  );
  assert.equal(
    infrastructurePrimitiveReadinessDiagnosticRequested(
      new URLSearchParams('primitive-readiness-diagnostic=1'),
    ),
    true,
  );
  assert.throws(
    () =>
      infrastructurePrimitiveReadinessDiagnosticOptionEnabled([
        '--infrastructure-primitive-readiness-diagnostic',
      ]),
    /requires --infrastructure-datacenters/,
  );
  assert.throws(
    () =>
      infrastructurePrimitiveReadinessDiagnosticOptionEnabled([
        '--infrastructure-datacenters',
        '--infrastructure-primitive-readiness-diagnostic',
        '--infrastructure-pick-path-diagnostic',
      ]),
    /must run separately/,
  );
});

test('visible source targets are selected within the fixture-owned bound', () => {
  assert.deepEqual(
    selectPrimitiveReadinessTargets([
      {
        ...target,
        entityShow: true,
        point: { show: true },
        stem: { show: true },
      },
      {
        ...target,
        entityId: 'hidden',
        entityShow: false,
        point: { show: true },
        stem: { show: true },
      },
    ]),
    [target],
  );
});

test('a latched display-ready flag does not hide a pending current Cesium primitive', () => {
  const primitives = new Cesium.PrimitiveCollection();
  primitives.add(makeFixturePrimitive());
  const snapshot = makeSnapshot(Cesium, viewerWith(primitives));
  assert.equal(snapshot.latchedDataSourceDisplayReady, true);
  assert.equal(snapshot.owners[0].ready, false);
  assert.equal(snapshot.targets[0].stemStatus, 'pending-owner-unmapped');
  assert.equal(snapshot.status, 'observed');
});

test('ready primitive instance attributes are read only after current readiness', () => {
  class FakeCollection {
    constructor(children = []) {
      this.children = children;
    }
    get length() {
      return this.children.length;
    }
    get(index) {
      return this.children[index];
    }
  }
  class ReadyPrimitive {
    ready = true;
    show = true;
    reads = 0;
    getGeometryInstanceAttributes(id) {
      this.reads++;
      this.argument = id;
      return id === sourceEntity ? { color: [1, 2, 3, 4] } : undefined;
    }
  }
  const primitive = new ReadyPrimitive();
  const fakeCesium = {
    VERSION: '1.138.0',
    PrimitiveCollection: FakeCollection,
    GroundPolylinePrimitive: class GroundPolylinePrimitive {},
    Primitive: ReadyPrimitive,
    PointPrimitiveCollection: class PointPrimitiveCollection {},
  };
  const snapshot = makeSnapshot(
    fakeCesium,
    viewerWith(new FakeCollection([primitive]), new FakeCollection()),
  );
  assert.equal(snapshot.targets[0].stemStatus, 'observed');
  assert.equal(primitive.reads, 1);
  assert.equal(primitive.argument, sourceEntity);
  assert.equal(
    snapshot.owners[0].targetAttributes[0].status,
    'attributes-present',
  );
});

test('point children are matched by public identity and a large collection is bounded', () => {
  const points = new Cesium.PointPrimitiveCollection();
  points.add({ id: sourceEntity, show: true });
  points.add({ id: new Cesium.Entity({ id: target.entityId }), show: true });
  points.add({ id: { id: 'other' }, show: true });
  const root = new Cesium.PrimitiveCollection();
  root.add(points);
  const snapshot = makeSnapshot(Cesium, viewerWith(root), {
    maxPointChildren: 1,
  });
  assert.equal(snapshot.owners[0].childScanStatus, 'truncated');
  assert.equal(snapshot.targets[0].pointStatus, 'observed');
  assert.equal(snapshot.truncated, true);
  const exactIdentity = makeSnapshot(Cesium, viewerWith(root));
  assert.equal(exactIdentity.targets[0].pointStatus, 'observed');
  assert.equal(
    exactIdentity.owners[0].targetAttributes.length,
    1,
    'a distinct Entity with the same string ID must not match the requested owner',
  );
});

test('OrderedGroundPrimitiveCollection is recorded as unavailable without reading its private index', () => {
  class OrderedGroundPrimitiveCollection {
    get length() {
      throw new Error('private length must not be read');
    }
    get() {
      throw new Error('private get must not be read');
    }
  }
  const ground = new Cesium.PrimitiveCollection();
  ground.add(new OrderedGroundPrimitiveCollection());
  const snapshot = makeSnapshot(
    Cesium,
    viewerWith(new Cesium.PrimitiveCollection(), ground),
  );
  assert.equal(snapshot.unindexedCollectionCount, 1);
  assert.equal(snapshot.owners[0].kind, 'unsupported-nested-collection');
  assert.equal(snapshot.targets[0].stemStatus, 'unknown-unindexed-owner');
});

test('unsupported Cesium versions and missing root APIs remain explicitly unknown', () => {
  const unsupported = makeSnapshot(
    { ...Cesium, VERSION: '1.139.0' },
    viewerWith(new Cesium.PrimitiveCollection()),
  );
  assert.equal(unsupported.versionStatus, 'unsupported');
  assert.equal(unsupported.status, 'unknown');
  assert.equal(unsupported.roots[0].status, 'version-unsupported');
  const missing = makeSnapshot(Cesium, { scene: {} });
  assert.equal(missing.roots[0].status, 'unsupported-root-shape');
  assert.equal(missing.roots[1].status, 'unsupported-root-shape');
});

test('collection cycles stop at the bounded public traversal boundary', () => {
  class FakeCollection {
    children = [];
    get length() {
      return this.children.length;
    }
    get(index) {
      return this.children[index];
    }
  }
  const root = new FakeCollection();
  root.children.push(root);
  const fakeCesium = {
    VERSION: '1.138',
    PrimitiveCollection: FakeCollection,
    GroundPolylinePrimitive: class GroundPolylinePrimitive {},
    Primitive: class Primitive {},
    PointPrimitiveCollection: class PointPrimitiveCollection {},
  };
  const snapshot = makeSnapshot(
    fakeCesium,
    viewerWith(root, new FakeCollection()),
  );
  assert.equal(snapshot.truncated, true);
  assert.equal(snapshot.roots[0].status, 'observed');
});

test('the deepest emitted leaf path is accepted by the report validator', () => {
  const root = new Cesium.PrimitiveCollection();
  let leafCollection = root;
  for (let depth = 0; depth < 4; depth++) {
    const nested = new Cesium.PrimitiveCollection();
    leafCollection.add(nested);
    leafCollection = nested;
  }
  leafCollection.add(makeFixturePrimitive());
  const snapshot = makeSnapshot(Cesium, viewerWith(root));
  assert.equal(snapshot.owners[0].path, 'scene.primitives/0/0/0/0/0');
  assert.doesNotThrow(() =>
    validateInfrastructurePrimitiveReadinessEnvelope(
      makeValidTriggeredEnvelope(snapshot),
    ),
  );
});

test('unknown and throwing nodes share the global traversal budget', () => {
  class FakeCollection {
    constructor(children = []) {
      this.children = children;
      this.reads = 0;
    }
    get length() {
      return this.children.length;
    }
    get(index) {
      this.reads++;
      if (this.throwReads) throw new Error('read failed');
      return this.children[index];
    }
  }
  class EmptyUnknown {}
  const manyUnknown = new FakeCollection(
    Array.from({ length: 500 }, () => new EmptyUnknown()),
  );
  const fakeCesium = {
    VERSION: '1.138.0',
    PrimitiveCollection: FakeCollection,
    GroundPolylinePrimitive: class GroundPolylinePrimitive {},
    Primitive: class Primitive {},
    PointPrimitiveCollection: class PointPrimitiveCollection {},
  };
  const snapshot = makeSnapshot(
    fakeCesium,
    viewerWith(manyUnknown, new FakeCollection()),
  );
  assert.equal(snapshot.visitedNodeCount, snapshot.maxVisitedNodes);
  assert.equal(snapshot.truncated, true);
  assert.equal(snapshot.unknownOwnerCount, snapshot.maxVisitedNodes - 1);
  assert.equal(manyUnknown.reads, snapshot.maxVisitedNodes - 1);

  const throwing = new FakeCollection(Array(500).fill({}));
  throwing.throwReads = true;
  const failedReads = makeSnapshot(
    fakeCesium,
    viewerWith(throwing, new FakeCollection()),
  );
  assert.equal(failedReads.truncated, true);
  assert.equal(failedReads.readErrorCount, failedReads.maxVisitedNodes - 1);
  assert.equal(throwing.reads, failedReads.maxVisitedNodes - 1);
});

test('point-child inspection has one total cap across multiple collections', () => {
  class FakeCollection {
    constructor(children = []) {
      this.children = children;
    }
    get length() {
      return this.children.length;
    }
    get(index) {
      return this.children[index];
    }
  }
  class FakePointCollection {
    constructor(count) {
      this.children = Array.from({ length: count }, () => ({
        id: null,
        show: true,
      }));
    }
    get length() {
      return this.children.length;
    }
    get(index) {
      return this.children[index];
    }
  }
  const fakeCesium = {
    VERSION: '1.138.0',
    PrimitiveCollection: FakeCollection,
    GroundPolylinePrimitive: class GroundPolylinePrimitive {},
    Primitive: class Primitive {},
    PointPrimitiveCollection: FakePointCollection,
  };
  const root = new FakeCollection([
    new FakePointCollection(3000),
    new FakePointCollection(3000),
  ]);
  const snapshot = makeSnapshot(
    fakeCesium,
    viewerWith(root, new FakeCollection()),
  );
  assert.equal(snapshot.pointChildrenInspected, 5000);
  assert.equal(snapshot.truncated, true);
  assert.equal(snapshot.owners[0].inspectedChildren, 3000);
  assert.equal(snapshot.owners[1].inspectedChildren, 2000);
});

test('the later-frame capture is budgeted and cannot pass the original failed gate', async () => {
  let requestedTimeout;
  const result = await observePrimitiveReadinessAfterFailure({
    gateFailure,
    maxDurationMs: 25,
    capture: async ({ timeoutMs, markRenderRequested }) => {
      markRenderRequested();
      requestedTimeout = timeoutMs;
      return {
        width: 32,
        height: 24,
        pixelSha256: 'c'.repeat(64),
        pngBase64: 'AA==',
        completedFrameState: null,
        pixels: new Uint8Array([1]),
      };
    },
  });
  assert.equal(requestedTimeout, 25);
  assert.equal(result.status, 'completed-frame-observed');
  assert.equal(result.originalGateFailed, true);
  assert.equal(result.acceptanceEligible, false);
  assert.equal(result.additionalPickCalls, 0);
  assert.equal(result.frame.completedFrameState, null);
  assert.doesNotThrow(() =>
    validateInfrastructurePrimitiveReadinessEnvelope(
      makeValidTriggeredEnvelope(
        makeSnapshot(Cesium, viewerWith(new Cesium.PrimitiveCollection())),
      ),
    ),
  );
});

test('post-failure budget expiry and capture errors remain diagnostic-only', async () => {
  let captureSignal;
  const expired = await observePrimitiveReadinessAfterFailure({
    gateFailure,
    maxDurationMs: 10,
    capture: ({ signal, markRenderRequested }) => {
      markRenderRequested();
      captureSignal = signal;
      return new Promise(() => {});
    },
  });
  assert.equal(expired.status, 'capture-budget-expired');
  assert.equal(captureSignal.aborted, true);
  const failed = await observePrimitiveReadinessAfterFailure({
    gateFailure,
    capture: async () => {
      throw new Error('capture failed');
    },
  });
  assert.equal(failed.status, 'diagnostic-error');
  assert.equal(failed.errorName, 'Error');
  const invalid = await observePrimitiveReadinessAfterFailure({
    gateFailure: { ...gateFailure, status: 'passed' },
    capture: async () => ({}),
  });
  assert.equal(invalid.status, 'diagnostic-error');
  assert.equal(invalid.errorName, 'TypeError');
});

test('a normal bounded frame capture with no completed render is explicit', async () => {
  const result = await observePrimitiveReadinessAfterFailure({
    gateFailure,
    capture: async ({ markRenderRequested }) => {
      markRenderRequested();
      return null;
    },
  });
  assert.equal(result.status, 'no-completed-frame');
  assert.equal(result.frame, null);
  const envelope = makeValidTriggeredEnvelope(
    makeSnapshot(Cesium, viewerWith(new Cesium.PrimitiveCollection())),
  );
  envelope.lifetimes[0].postFailureObservation = result;
  assert.doesNotThrow(() =>
    validateInfrastructurePrimitiveReadinessEnvelope(envelope),
  );
});

test('a completed capture after its measured budget is retained as late, never on-time', async () => {
  const readings = [0, 45];
  const late = await observePrimitiveReadinessAfterFailure({
    gateFailure,
    maxDurationMs: 10,
    now: () => readings.shift() ?? 45,
    capture: async ({ markRenderRequested }) => {
      markRenderRequested();
      return {
        width: 32,
        height: 24,
        pixelSha256: 'd'.repeat(64),
        pngBase64: 'AA==',
        completedFrameState: null,
      };
    },
  });
  assert.equal(late.elapsedMs, 45);
  assert.equal(late.overBudget, true);
  assert.equal(late.status, 'late-frame-observed');
});

test('later-frame PNG evidence is bounded and malformed base64 is explicit', async () => {
  const invalid = await observePrimitiveReadinessAfterFailure({
    gateFailure,
    capture: async ({ markRenderRequested }) => {
      markRenderRequested();
      return {
        width: 32,
        height: 24,
        pixelSha256: 'e'.repeat(64),
        pngBase64: 'data:image/png;base64,AA==',
      };
    },
  });
  assert.equal(invalid.frame.pngBase64, null);
  assert.equal(invalid.frame.pngStatus, 'invalid');
  assert.doesNotThrow(() =>
    validateInfrastructurePrimitiveReadinessEnvelope(
      makeValidTriggeredEnvelope(
        makeSnapshot(Cesium, viewerWith(new Cesium.PrimitiveCollection())),
      ),
    ),
  );
});

test('captured-frame witness errors preserve capture and release ownership', async () => {
  const { processOwnedCapturedFrame } =
    await import('./infrastructurePickPathDiagnostic.mjs');
  let released = false;
  const output = await processOwnedCapturedFrame({
    capture: async () => ({ pixels: new Uint8Array([1]) }),
    readFrameState() {
      throw new Error('witness unavailable');
    },
    process(canvas, witness) {
      assert.equal(witness.completedFrameState, null);
      assert.equal(witness.completedFrameStateErrorName, 'Error');
      return canvas.pixels.length;
    },
    release(canvas) {
      released = true;
      canvas.pixels = null;
    },
  });
  assert.equal(output, 1);
  assert.equal(released, true);
});

test('strict envelope validation accepts bounded diagnostic-only observations', () => {
  const root = new Cesium.PrimitiveCollection();
  root.add(makeFixturePrimitive());
  const snapshot = makeSnapshot(Cesium, viewerWith(root));
  assert.equal(
    validateInfrastructurePrimitiveReadinessEnvelope(
      makeValidTriggeredEnvelope(snapshot),
    ).status,
    'partial-or-diagnostic-error',
  );
});

test('runtime report consumer validates both triggered and no-trigger producer envelopes', () => {
  const triggeredEnvelope = makeValidTriggeredEnvelope(
    makeSnapshot(Cesium, viewerWith(new Cesium.PrimitiveCollection())),
  );
  assert.doesNotThrow(() =>
    validateInfrastructurePrimitiveReadinessReport({
      status: 'failed',
      instrumentation: {
        primitiveReadinessDiagnostic: triggeredEnvelope,
      },
    }),
  );
  assert.doesNotThrow(() =>
    validateInfrastructurePrimitiveReadinessReport({
      status: 'passed',
      instrumentation: {
        primitiveReadinessDiagnostic:
          createInfrastructurePrimitiveReadinessEnvelope(),
      },
    }),
  );
  assert.throws(() =>
    validateInfrastructurePrimitiveReadinessReport({
      instrumentation: {
        primitiveReadinessDiagnostic: { ...triggeredEnvelope, maxOwners: 0 },
      },
    }),
  );
});

test('envelope validation rejects forged state, bounds, identifiers and rescue claims', () => {
  const root = new Cesium.PrimitiveCollection();
  root.add(makeFixturePrimitive());
  const valid = makeValidTriggeredEnvelope(
    makeSnapshot(Cesium, viewerWith(root)),
  );
  const mutations = [
    (copy) => (copy.extra = true),
    (copy) => (copy.lifetimes[0].initialSnapshot.extra = 'forged'),
    (copy) => (copy.lifetimes[0].initialSnapshot.owners[0].ownerId = -1),
    (copy) =>
      (copy.lifetimes[0].initialSnapshot.owners[0].path = 'scene.other'),
    (copy) =>
      (copy.lifetimes[0].initialSnapshot.owners[0].targetAttributes = [
        {
          entityId: target.entityId,
          status: 'attributes-present',
          secret: true,
        },
      ]),
    (copy) =>
      (copy.lifetimes[0].postFailureObservation.additionalPickCalls = 1),
    (copy) =>
      (copy.lifetimes[0].postFailureObservation.requestedDiagnosticRender = false),
    (copy) =>
      (copy.lifetimes[0].postFailureObservation.originalGate.status = 'passed'),
    (copy) =>
      (copy.lifetimes[0].postFailureObservation.frame.completedFrameState.completedRenderRevision = 0),
    (copy) => {
      copy.lifetimes[0].postFailureObservation.frame.pngBase64 = '%%%';
    },
    (copy) => (copy.performanceAcceptanceEligible = true),
  ];
  for (const mutate of mutations) {
    const copy = structuredClone(valid);
    mutate(copy);
    assert.throws(() => validateInfrastructurePrimitiveReadinessEnvelope(copy));
  }
});

test('incomplete original gates cannot be represented as completed acceptance evidence', () => {
  const unsupported = makeSnapshot(
    { ...Cesium, VERSION: 'future' },
    viewerWith(new Cesium.PrimitiveCollection()),
  );
  const envelope = makeValidTriggeredEnvelope(unsupported);
  assert.doesNotThrow(() =>
    validateInfrastructurePrimitiveReadinessEnvelope(envelope),
  );
  envelope.lifetimes[0].postFailureObservation.acceptanceEligible = true;
  assert.throws(() =>
    validateInfrastructurePrimitiveReadinessEnvelope(envelope),
  );
});
