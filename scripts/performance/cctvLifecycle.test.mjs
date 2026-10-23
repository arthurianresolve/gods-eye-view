import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import sharp from 'sharp';
import { createCctvSource } from '../../src/layers/cctv/source.js';
import {
  assertCctvCheckpoint,
  assertCctvCameraPose,
  assertCctvCycleReuse,
  CCTV_RESOURCE_DIAGNOSTICS_SCHEMA,
  assertCctvRapidGeometryRevision,
  createCctvGeometryWorkerBoundaryInstaller,
  cctvLifecycleShareHash,
  cctvTaskErrorSignature,
  configureCctvLifecycleSceneInPage,
  createCctvLifecycleFixture,
  parseCctvLifecycleArgs,
  readCctvLifecycleCheckpointInPage,
  installCctvGeometryWorkerBoundaryInPage,
  reinitializeDisabledCctvModuleInPage,
  readCctvGeometryEvidenceInPage,
  setCctvLifecycleEnabledInPage,
  summarizeCctvGeometryEvidence,
  validateCctvLifecycleReport,
  waitForCctvLifecycleRenderInPage,
} from './cctvLifecycle.mjs';
import { installWorkerDiagnostics } from './workerDiagnostics.mjs';
import {
  captureCctvFixtureResponse,
  runCctvLifecycle,
  waitForCctvLifecycleDrain,
} from '../qa-cctv-lifecycle.mjs';

function validCheckpoint(enabled, probeError = false) {
  return {
    appCommit: 'a'.repeat(40),
    enabled,
    lifecycleState: {
      enabled,
      lifecycleState: enabled ? 'enabled' : 'disabled',
      uncertain: false,
    },
    moduleEnabled: enabled,
    stats: {
      count: 1,
      loading: false,
      loadingLoaded: 1,
      loadingTotal: 1,
      error: null,
    },
    cameras: [{ id: 'qa-cctv-lifecycle-camera-001', active: true }],
    cameraCount: 1,
    activeCameraId: 'qa-cctv-lifecycle-camera-001',
    diagnostics: {
      listeners: 4,
      timers: enabled ? 1 : 0,
      pendingJobs: 0,
      primitives: 1,
      entities: 1,
      dataSources: 0,
      cacheEntries: 0,
    },
    scene: { entities: 1, dataSources: 0, primitives: 8, groundPrimitives: 0 },
    cameraView: {
      west: -98,
      east: -97,
      south: 30,
      north: 31,
      containsFixture: true,
    },
    cameraPose: {
      longitude: -97.7431,
      latitude: 30.2672,
      heightM: 25_000,
      headingRadians: 0,
      pitchRadians: -1.2,
      rollRadians: 0,
    },
    boundaryRender: { frameNumber: 11, elapsedMs: 90 },
    render: { frameNumber: 22, elapsedMs: 1100 },
    drainStability: {
      status: 'stable',
      windowMs: 1000,
      sampleCount: 11,
      firstFrameNumber: 12,
      lastFrameNumber: 22,
      maximumSampleGapMs: 100,
    },
    worker: {
      instrumented: true,
      overflow: false,
      pending: 0,
      workerCount: 2,
      workersTruncated: false,
      workers: [
        {
          kind: 'createGeometry.js',
          submitted: 4,
          completed: 4,
          cancelled: 0,
          pending: 0,
          taskErrors: probeError ? 1 : 0,
          workerErrors: 0,
          postErrors: 0,
          terminated: probeError,
          oldestPendingMs: 0,
        },
        {
          kind: 'createGeometry.js',
          submitted: 3,
          completed: 3,
          cancelled: 0,
          pending: 0,
          taskErrors: 0,
          workerErrors: 0,
          postErrors: 0,
          terminated: false,
          oldestPendingMs: 0,
        },
      ],
    },
    renderer: {
      classification: 'software',
      name: 'SwiftShader',
      vendor: 'Google',
      contextAttributes: { antialias: true },
    },
    canvas: { width: 1440, height: 1000, cssWidth: 1440, cssHeight: 1000 },
  };
}

function validRapidGeometryRevision(applicationCommit = 'a'.repeat(40)) {
  const cameraId = createCctvLifecycleFixture().cameraId;
  const ids = ['ray-tl', 'ray-tr', 'ray-br', 'ray-bl', 'cap'].map(
    (role) => `cctv-${cameraId}-${role}`,
  );
  const makeSample = (
    rangeScale,
    geometryFill,
    pngFill,
    expectedVisible = true,
  ) => ({
    cameraCommit: applicationCommit,
    camera: {
      id: cameraId,
      rangeM: 800 * rangeScale,
      calibration: { rangeScale },
    },
    frameNumber: 12,
    canvas: {
      width: 1440,
      height: 1000,
      cssWidth: 1440,
      cssHeight: 1000,
    },
    entityCount: 5,
    expectedVisible,
    visibleEntityCount: expectedVisible ? 5 : 0,
    geometrySha256: geometryFill.repeat(64),
    styleSha256: 'c'.repeat(64),
    pngSha256: pngFill.repeat(64),
    pngBytes: 2048,
    pickCount: 5,
    pickedEntityIds: expectedVisible ? ids : Array(5).fill(null),
    pickedCameraIds: Array(5).fill(expectedVisible ? cameraId : null),
    matchingPickCount: expectedVisible ? 5 : 0,
  });
  const controlA = makeSample(0.82, 'a', 'd');
  const referenceB = makeSample(1.12, 'b', 'e');
  const disabledReferenceB = makeSample(1.12, 'f', '7', false);
  const checkpointEnabled = validCheckpoint(true, true);
  const checkpointDisabled = validCheckpoint(false, true);
  const checkpointDisabledHeld = structuredClone(checkpointDisabled);
  checkpointDisabledHeld.render.elapsedMs = 6;
  checkpointDisabledHeld.boundaryRender = { frameNumber: 21, elapsedMs: 6 };
  checkpointDisabledHeld.worker.pending = 1;
  checkpointDisabledHeld.worker.workers[1].pending = 1;
  checkpointDisabledHeld.worker.workers[1].completed--;
  const workerAtHold = {
    instrumented: true,
    overflow: false,
    pending: 1,
    workers: [
      {
        kind: 'heightmap.js',
        submitted: 0,
        completed: 0,
        cancelled: 0,
        pending: 0,
        taskErrors: 0,
        workerErrors: 0,
        postErrors: 0,
        terminated: false,
      },
      {
        kind: 'createGeometry.js',
        submitted: 1,
        completed: 0,
        cancelled: 0,
        pending: 1,
        taskErrors: 0,
        workerErrors: 0,
        postErrors: 0,
        terminated: false,
      },
    ],
  };
  return {
    status: 'passed',
    scope: 'held-worker-result; no worker-compute overlap claimed',
    applicationCommit,
    canvas: structuredClone(controlA.canvas),
    revisionA: { calibration: { rangeScale: 0.82 }, rangeM: 656 },
    revisionB: { calibration: { rangeScale: 1.12 }, rangeM: 896 },
    boundary: {
      enabledRelease: {
        arm: { status: 'armed', armedAtMs: 1 },
        held: {
          status: 'held',
          armedAtMs: 1,
          heldAtMs: 2,
          taskId: 91,
          workerKind: 'createGeometry.js',
          workerOrdinal: 1,
          submittedAtArm: 3,
          workerSubmittedAfterArm: 1,
          pendingAtHold: 1,
          overflow: false,
          workerAtHold: structuredClone(workerAtHold),
        },
        whileRevisionB: {
          status: 'held',
          taskId: 91,
          workerSubmissionsWhileHeld: 1,
          workerOrdinal: 1,
          workerKind: 'createGeometry.js',
          overflow: false,
          workerAtHold: structuredClone(workerAtHold),
        },
        released: { status: 'released', taskId: 91, releasedAtMs: 4 },
      },
      disabledRelease: {
        arm: { status: 'armed', armedAtMs: 5 },
        held: {
          status: 'held',
          armedAtMs: 5,
          heldAtMs: 6,
          taskId: 92,
          workerKind: 'createGeometry.js',
          workerOrdinal: 1,
          submittedAtArm: 3,
          workerSubmittedAfterArm: 1,
          pendingAtHold: 1,
          overflow: false,
          workerAtHold: structuredClone(workerAtHold),
        },
        whileRevisionB: {
          status: 'held',
          taskId: 92,
          workerSubmissionsWhileHeld: 1,
          workerOrdinal: 1,
          workerKind: 'createGeometry.js',
          overflow: false,
          workerAtHold: structuredClone(workerAtHold),
        },
        disabledBeforeRelease: checkpointDisabledHeld,
        disabledAtElapsedMs: checkpointDisabledHeld.render.elapsedMs,
        released: { status: 'released', taskId: 92, releasedAtMs: 7 },
      },
      final: {
        status: 'released',
        releasedAtMs: 8,
        taskId: 92,
        disposed: true,
        boundaryDisabled: true,
        listenersReleased: true,
        heldPayloadReleased: true,
        listenerCleanupErrors: 0,
        releaseError: null,
        diagnosticWorkerConstructorRetained: true,
        nativeWorkerConstructorRestored: false,
        disposedWithHeldResult: false,
      },
    },
    samples: {
      controlA,
      referenceB,
      afterRelease: structuredClone(referenceB),
      afterReenable: structuredClone(referenceB),
      disabledReferenceB,
      disabledWithHeldResult: structuredClone(disabledReferenceB),
      disabledAfterRelease: structuredClone(disabledReferenceB),
    },
    checkpoints: {
      settledAfterRelease: structuredClone(checkpointEnabled),
      disabledWithHeldResult: checkpointDisabledHeld,
      disabledReferenceB: structuredClone(checkpointDisabled),
      disabledAfterRace: structuredClone(checkpointDisabled),
      settledAfterDisableRelease: structuredClone(checkpointDisabled),
      reenabledAfterRace: structuredClone(checkpointEnabled),
      finalDisabled: structuredClone(checkpointDisabled),
    },
  };
}

function validReport(cycles = 5) {
  const fixture = createCctvLifecycleFixture();
  const enabled = validCheckpoint(true, true);
  const disabled = validCheckpoint(false, true);
  const direct = structuredClone(disabled);
  return {
    schema: 'gev-cctv-lifecycle/v3',
    resourceDiagnosticsSchema: CCTV_RESOURCE_DIAGNOSTICS_SCHEMA,
    status: 'passed',
    validationStatus: 'passed',
    applicationCommit: 'a'.repeat(40),
    harnessCommit: 'a'.repeat(40),
    servedApplicationCommit: 'a'.repeat(40),
    applicationSourceCleanAtStart: true,
    applicationSourceCleanAtEnd: true,
    sourceChangedDuringRun: false,
    githubMatchesHeadAtStart: true,
    githubMatchesHeadAtEnd: true,
    fixture: {
      id: fixture.id,
      sha256: fixture.sha256,
      cameraCount: 1,
      cameraId: fixture.cameraId,
      frameSha256: fixture.frameSha256,
      clockPolicy: fixture.clockPolicy,
      view: fixture.view,
    },
    environment: {
      nodeVersion: process.version,
      host: {
        platform: process.platform,
        architecture: process.arch,
        osRelease: 'test-os',
        cpu: 'test-cpu',
        logicalCpus: 2,
        memoryBytes: 1024,
      },
      cesiumVersion: '1.138.0',
      browserVersion: 'HeadlessChrome/152.0.0.0',
      viewport: { width: 1440, height: 1000 },
    },
    sceneConfiguration: { ...fixture.view, applied: true },
    sceneReadiness: { status: 'ready', elapsedMs: 1 },
    renderer: enabled.renderer,
    workerPreflight: {
      status: 'passed',
      expectedTaskErrorWorkers: [
        {
          index: 0,
          kind: 'createGeometry.js',
          taskErrors: 1,
          terminated: true,
        },
      ],
    },
    warmup: {
      enabled,
      disabled,
      createGeometrySubmitted: 3,
      workerTotals: {
        submitted: 7,
        completed: 7,
        workerCount: 2,
        identifiableCreateGeometryWorkers: 2,
        activeCreateGeometryWorkers: 1,
        activeCreateGeometrySubmitted: 3,
        allWorkerSubmitted: 7,
      },
    },
    cycles: Array.from({ length: cycles }, (_, index) => ({
      cycle: index + 1,
      status: 'passed',
      enabled: structuredClone(enabled),
      disabled: structuredClone(disabled),
      enabledWorkerTotals: {
        submitted: 7,
        completed: 7,
        workerCount: 2,
        identifiableCreateGeometryWorkers: 2,
        activeCreateGeometryWorkers: 1,
        activeCreateGeometrySubmitted: 3,
        allWorkerSubmitted: 7,
      },
      disabledWorkerTotals: {
        submitted: 7,
        completed: 7,
        workerCount: 2,
        identifiableCreateGeometryWorkers: 2,
        activeCreateGeometryWorkers: 1,
        activeCreateGeometrySubmitted: 3,
        allWorkerSubmitted: 7,
      },
      createGeometrySubmitted: 3,
    })),
    directReinit: {
      scope: 'disabled-direct-module-init',
      status: 'passed',
      initializedDisabled: structuredClone(disabled),
      rewarmedEnabled: structuredClone(enabled),
      checkpoint: direct,
    },
    rapidGeometryRevision: validRapidGeometryRevision(),
    fixtureDelivery: {
      id: fixture.id,
      sha256: fixture.sha256,
      cameraCount: 1,
      cameraId: fixture.cameraId,
      sourceResponses: 2,
      healthResponses: 2,
      frameResponses: 1,
      frameSha256: fixture.frameSha256,
      clockPolicy: fixture.clockPolicy,
      healthPolicy: 'fixed-empty-health-snapshot',
    },
    pageClose: {
      closeCompleted: true,
      openPageCount: 0,
      scope: 'owned-context-only',
    },
    contextClose: { completed: true },
    browserClose: {
      closeCompleted: true,
      forcedProcessTermination: false,
      observation: {
        closeDeadlineMs: 5000,
        closeElapsedMs: 100,
        forceProcessStatus: 'not-needed',
        processExit: { code: 0, signal: null, elapsedMs: 100 },
      },
    },
    applicationCommitAtEnd: 'a'.repeat(40),
    pageErrors: [],
    failedPhase: null,
    error: null,
  };
}

function cctvReportCheckpoints(report) {
  const checkpoints = [
    report.warmup.enabled,
    report.warmup.disabled,
    report.directReinit.initializedDisabled,
    report.directReinit.rewarmedEnabled,
    report.directReinit.checkpoint,
    ...report.cycles.flatMap((row) => [row.enabled, row.disabled]),
  ];
  if (report.rapidGeometryRevision?.checkpoints)
    checkpoints.push(
      ...Object.values(report.rapidGeometryRevision.checkpoints),
    );
  return checkpoints;
}

function emulateLegacyCctvResourceSemantics(report) {
  delete report.resourceDiagnosticsSchema;
  for (const checkpoint of cctvReportCheckpoints(report)) {
    checkpoint.diagnostics.dataSources = checkpoint.diagnostics.entities;
    delete checkpoint.diagnostics.entities;
  }
}

test('serialized CCTV worker boundary holds the exact submitted geometry result and restores diagnostics', () => {
  let now = 10;
  class FakeWorker extends EventTarget {
    constructor(url) {
      super();
      this.url = url;
      this.removedListeners = 0;
    }
    postMessage() {}
    terminate() {}
    removeEventListener(...args) {
      this.removedListeners++;
      return super.removeEventListener(...args);
    }
  }
  const scope = {
    Worker: FakeWorker,
    MessageEvent,
    performance: { now: () => now },
  };
  const installer = createCctvGeometryWorkerBoundaryInstaller(
    installWorkerDiagnostics,
  );
  vm.runInNewContext(`(${installer.toString()})()`, { window: scope });
  const boundary = scope.__qaCctvGeometryBoundary;
  const other = new scope.Worker('/workers/heightmap.js');
  const geometry = new scope.Worker('/workers/createGeometry.js');
  const diagnosticPostMessage = geometry.postMessage;
  assert.equal(boundary.arm().status, 'armed');
  other.postMessage({ id: 7 });
  other.dispatchEvent(new MessageEvent('message', { data: { id: 7 } }));
  const payload = { id: 91, error: 'fixture task error payload' };
  geometry.postMessage(payload);
  now = 12;
  geometry.dispatchEvent(new MessageEvent('message', { data: payload }));
  const held = boundary.snapshot();
  assert.equal(held.status, 'held');
  assert.equal(held.workerKind, 'createGeometry.js');
  assert.equal(held.workerOrdinal, 1);
  assert.equal(held.taskId, 91);
  assert.equal(held.pendingAtHold, 1);
  assert.equal(held.workerSubmittedAfterArm, 1);
  assert.equal(Object.hasOwn(held, 'data'), false);
  assert.equal(boundary.held.data, payload);
  assert.equal(boundary.release(), true);
  const afterRelease = scope.__gevSoakWorkers.snapshot();
  assert.equal(afterRelease.pending, 0);
  assert.equal(
    afterRelease.workers.find((worker) => worker.kind === 'createGeometry.js')
      .taskErrors,
    1,
  );
  const final = boundary.dispose();
  assert.equal(final.status, 'released');
  assert.equal(final.boundaryDisabled, true);
  assert.equal(final.listenersReleased, true);
  assert.equal(final.heldPayloadReleased, true);
  assert.equal(final.diagnosticWorkerConstructorRetained, true);
  assert.equal(final.nativeWorkerConstructorRestored, false);
  assert.equal(scope.__qaCctvGeometryBoundary, null);
  assert.notEqual(geometry.postMessage, diagnosticPostMessage);
  geometry.postMessage({ id: 92 });
  geometry.dispatchEvent(new MessageEvent('message', { data: { id: 92 } }));
  assert.equal(scope.__gevSoakWorkers.snapshot().pending, 0);
  assert.equal(Object.hasOwn(geometry, '__cctvSubmittedAfterArm'), false);
  assert.equal(geometry.removedListeners, 1);
  assert.equal(final.disposedWithHeldResult, false);
  assert.equal(boundary.release(), false);
  boundary.dispose();
  assert.equal(geometry.removedListeners, 1);
});

test('CCTV worker boundary rejects a result from a different worker/task and cleans up', () => {
  let now = 4;
  class FakeWorker extends EventTarget {
    constructor(url) {
      super();
      this.url = url;
    }
    postMessage() {}
    terminate() {}
  }
  const scope = {
    Worker: FakeWorker,
    MessageEvent,
    performance: { now: () => now },
  };
  installCctvGeometryWorkerBoundaryInPage(scope, installWorkerDiagnostics);
  const owner = new scope.Worker('/workers/createGeometry.js');
  const wrong = new scope.Worker('/workers/createGeometry.js');
  const gate = scope.__qaCctvGeometryBoundary;
  gate.arm();
  owner.postMessage({ id: 301 });
  now = 5;
  wrong.dispatchEvent(new MessageEvent('message', { data: { id: 301 } }));
  assert.equal(gate.snapshot().status, 'armed');
  assert.equal(gate.snapshot().taskId, null);
  assert.equal(gate.snapshot().overflow, true);
  owner.terminate();
  const final = gate.dispose();
  assert.equal(final.listenersReleased, true);
  assert.equal(final.heldPayloadReleased, true);
  assert.equal(scope.__qaCctvGeometryBoundary, null);
  assert.equal(scope.__gevSoakWorkers.snapshot().pending, 0);
});

test('CCTV worker boundary installation rollback preserves the original error and releases partial ownership', () => {
  class FakeWorker extends EventTarget {
    constructor() {
      super();
      this.removed = 0;
    }
    postMessage() {}
    removeEventListener(...args) {
      this.removed++;
      return super.removeEventListener(...args);
    }
  }
  let created;
  const scope = {
    Worker: FakeWorker,
    MessageEvent,
    performance: { now: () => 1 },
  };
  const originalError = new Error('diagnostics install failed');
  assert.throws(
    () =>
      installCctvGeometryWorkerBoundaryInPage(scope, (target) => {
        created = new target.Worker('/workers/createGeometry.js');
        created.postMessage = () => {};
        throw originalError;
      }),
    (error) => error === originalError,
  );
  assert.equal(scope.Worker, FakeWorker);
  assert.equal(Object.hasOwn(created, '__cctvSubmittedAfterArm'), false);
  assert.equal(Object.hasOwn(created, '__cctvWorkerKind'), false);
  assert.equal(scope.__qaCctvGeometryBoundary, undefined);
  assert.equal(created.removed, 1);
});

test('CCTV worker boundary reports incomplete native listener cleanup instead of passing', () => {
  class FakeWorker extends EventTarget {
    postMessage() {}
    removeEventListener() {
      throw new Error('listener removal failed');
    }
  }
  const scope = {
    Worker: FakeWorker,
    MessageEvent,
    performance: { now: () => 1 },
  };
  installCctvGeometryWorkerBoundaryInPage(scope, installWorkerDiagnostics);
  new scope.Worker('/workers/createGeometry.js');
  const final = scope.__qaCctvGeometryBoundary.dispose();
  assert.equal(final.boundaryDisabled, true);
  assert.equal(final.listenersReleased, false);
  assert.ok(final.listenerCleanupErrors > 0);
  assert.equal(final.diagnosticWorkerConstructorRetained, true);
  assert.equal(final.nativeWorkerConstructorRestored, false);
  assert.equal(scope.__qaCctvGeometryBoundary, null);
});

test('CCTV geometry evidence uses the viewer clock without a Cesium global and captures inside postRender', async () => {
  const fixture = createCctvLifecycleFixture();
  const ids = ['ray-tl', 'ray-tr', 'ray-br', 'ray-bl', 'cap'].map(
    (role) => `cctv-${fixture.cameraId}-${role}`,
  );
  const listeners = new Set();
  const timeSample = { dayNumber: 2461324, secondsOfDay: 100 };
  const scene = {
    frameState: { frameNumber: 20 },
    postRender: {
      addEventListener(listener) {
        listeners.add(listener);
      },
      removeEventListener(listener) {
        listeners.delete(listener);
      },
    },
    requestRender() {
      scene.frameState.frameNumber++;
      for (const listener of [...listeners]) listener();
    },
    cartesianToCanvasCoordinates(position) {
      return { x: position.x, y: 2 };
    },
    pick(position) {
      return {
        id: { id: ids[Math.max(0, Math.min(4, Math.round(position.x) - 1))] },
      };
    },
    canvas: {
      width: 1440,
      height: 1000,
      getBoundingClientRect: () => ({ width: 1440, height: 1000 }),
      toDataURL: () => `data:image/png;base64,${fixture.framePngBase64}`,
    },
  };
  const entities = new Map(
    ids.map((id, index) => [
      id,
      {
        id,
        show: true,
        polyline: {
          show: { getValue: () => true },
          width: { getValue: () => 2 },
          positions: {
            getValue: (time) => {
              assert.equal(time, timeSample);
              return [
                { x: index, y: 0, z: 0 },
                { x: index + 1, y: 0, z: 0 },
              ];
            },
          },
          material: {
            color: {
              getValue: () => ({ toCssColorString: () => 'rgba(1,2,3,1)' }),
            },
          },
        },
      },
    ]),
  );
  const camera = {
    id: fixture.cameraId,
    lat: 30,
    lon: -97,
    headingDeg: 0,
    pitchDeg: -20,
    fovDeg: 60,
    rangeM: 800,
    mountHeightM: 10,
    calibration: { rangeScale: 1 },
  };
  const context = vm.createContext({
    window: {
      __godsEyeView: {
        viewer: {
          scene,
          clock: { currentTime: timeSample },
          entities: { getById: (id) => entities.get(id) },
        },
        dataManager: {
          layers: new Map([
            [
              'cctv',
              {
                module: {
                  getUIState: () => ({ cameras: [camera] }),
                  _extractPickedCameraIdForTest: (picked) =>
                    picked?.id ? camera.id : null,
                },
              },
            ],
          ]),
        },
      },
    },
    setTimeout,
    clearTimeout,
    performance: { now: () => 1 },
  });
  const evidence = await vm.runInContext(
    `(${readCctvGeometryEvidenceInPage.toString()})(${JSON.stringify(fixture.cameraId)})`,
    context,
  );
  const summary = summarizeCctvGeometryEvidence(evidence);
  assert.equal(evidence.frameNumber, 21);
  assert.equal(summary.entityCount, 5);
  assert.equal(summary.matchingPickCount, 5);
  assert.deepEqual(
    Array.from(summary.pickedCameraIds),
    Array(5).fill(fixture.cameraId),
  );
  assert.equal(summary.pngBytes > 32, true);
  assert.equal(listeners.size, 0);
  const wrongPick = structuredClone(evidence);
  wrongPick.picks[0].pickedEntityId = 'unrelated-fixture-entity';
  assert.throws(
    () => summarizeCctvGeometryEvidence(wrongPick),
    /pick evidence is invalid: sample 0, expected cctv-.*-ray-tl, observed "unrelated-fixture-entity"/,
  );
  const planePick = structuredClone(evidence);
  planePick.picks[0].pickedEntityId = `cctv-${fixture.cameraId}-plane`;
  assert.equal(
    summarizeCctvGeometryEvidence(planePick).pickedEntityIds[0],
    `cctv-${fixture.cameraId}-plane`,
  );
  planePick.picks[0].pickedCameraId = null;
  assert.throws(
    () => summarizeCctvGeometryEvidence(planePick),
    /pick evidence is invalid/,
  );
  const failedScene = {
    ...scene,
    requestRender: () => {
      throw new Error('render failed');
    },
  };
  context.window.__godsEyeView.viewer.scene = failedScene;
  await assert.rejects(
    vm.runInContext(
      `(${readCctvGeometryEvidenceInPage.toString()})(${JSON.stringify(fixture.cameraId)})`,
      context,
    ),
    /render failed/,
  );
  assert.equal(listeners.size, 0);
});

test('CCTV lifecycle args constrain cycles, drain deadline and origin URL', () => {
  assert.deepEqual(
    parseCctvLifecycleArgs(['--cycles', '5', '--drain-ms', '10000']).cycles,
    5,
  );
  assert.throws(() => parseCctvLifecycleArgs(['--cycles', '11']), /cycles/);
  assert.throws(() => parseCctvLifecycleArgs(['--drain-ms', '10001']), /drain/);
  assert.throws(
    () => parseCctvLifecycleArgs(['--url', 'https://user:pass@example.test']),
    /url/,
  );
  assert.throws(
    () => parseCctvLifecycleArgs(['--unexpected', 'x']),
    /argument/,
  );
});

test('fixture response serves only the exact CCTV source and health endpoints', () => {
  const fixture = createCctvLifecycleFixture();
  const base = 'http://localhost:4174';
  const sources = captureCctvFixtureResponse(
    fixture,
    new URL(`${base}/api/cctv/sources`),
    base,
  );
  const health = captureCctvFixtureResponse(
    fixture,
    new URL(`${base}/api/cctv/health`),
    base,
  );
  assert.equal(JSON.parse(sources.body).sources[0].id, fixture.cameraId);
  assert.deepEqual(JSON.parse(health.body).cameras, []);
  const productionFrameUrl = new URL(
    createCctvSource().getFrameUrl(fixture.sources[0]),
    base,
  );
  assert.match(productionFrameUrl.search, /label=/);
  assert.equal(
    captureCctvFixtureResponse(fixture, productionFrameUrl, base).contentType,
    'image/png',
  );
  assert.equal(
    captureCctvFixtureResponse(
      fixture,
      new URL(`${base}/api/cctv/frame/not-the-fixture?label=ignored`),
      base,
    ),
    null,
  );
  assert.equal(
    captureCctvFixtureResponse(
      fixture,
      new URL('https://external.test/api/cctv/sources'),
      base,
    ),
    null,
  );
  assert.equal(
    captureCctvFixtureResponse(
      fixture,
      new URL(`${base}/api/cctv/sources?x=1`),
      base,
    ),
    null,
  );
  assert.match(fixture.sha256, /^[a-f0-9]{64}$/);
});

test('serialized checkpoint callback reads the actual module, scene, worker and renderer fields', async () => {
  const module = {
    getStats: () => ({
      count: 1,
      loading: false,
      loadingLoaded: 1,
      loadingTotal: 1,
      error: null,
    }),
    getUIState: () => ({
      enabled: true,
      cameras: [{ id: 'qa-cctv-lifecycle-camera-001', active: true }],
      activeCameraId: 'qa-cctv-lifecycle-camera-001',
    }),
    getPerformanceDiagnostics: () => ({
      listeners: 1,
      timers: 0,
      pendingJobs: 0,
      primitives: 1,
      entities: 0,
      dataSources: 0,
      cacheEntries: 0,
    }),
  };
  const gl = {
    getContextAttributes: () => ({ antialias: true }),
    getExtension: () => ({
      UNMASKED_RENDERER_WEBGL: 1,
      UNMASKED_VENDOR_WEBGL: 2,
    }),
    getParameter: (parameter) =>
      parameter === 1 ? 'Google SwiftShader' : 'Google',
  };
  const result = vm.runInNewContext(
    `(${readCctvLifecycleCheckpointInPage.toString()})({ includeRenderer: true, fixtureView: ${JSON.stringify(createCctvLifecycleFixture().view)} })`,
    {
      window: {
        __godsEyeView: {
          dataManager: {
            layers: new Map([['cctv', { module }]]),
            isEnabled: () => true,
            getLayerLifecycleState: () => 'enabled',
            setLayerParams: () => true,
          },
          viewer: {
            scene: {
              context: { _originalGLContext: gl },
              globe: {
                ellipsoid: {
                  cartographicToCartesian: (point) => point,
                  cartesianToCartographic: (point) => point,
                },
              },
              primitives: { length: 3 },
              groundPrimitives: { length: 0 },
              canvas: {
                width: 1440,
                height: 1000,
                getBoundingClientRect: () => ({ width: 1440, height: 1000 }),
              },
            },
            camera: {
              setView: () => {},
              positionWC: {
                longitude: (-97.7431 * Math.PI) / 180,
                latitude: (30.2672 * Math.PI) / 180,
                height: 25_000,
              },
              heading: 0,
              pitch: -1.2,
              roll: 0,
              computeViewRectangle: () => ({
                west: (-98 * Math.PI) / 180,
                east: (-97 * Math.PI) / 180,
                south: (30 * Math.PI) / 180,
                north: (31 * Math.PI) / 180,
              }),
            },
            entities: { values: [1] },
            dataSources: { length: 0 },
          },
          getPerformanceEnvironment: () => ({ appCommit: 'a'.repeat(40) }),
        },
        __gevSoakWorkers: {
          snapshot: () => ({
            instrumented: true,
            overflow: false,
            pending: 0,
            workers: [],
          }),
        },
      },
      module,
    },
  );
  assert.equal(result.renderer.classification, 'software');
  assert.equal(result.renderer.name, 'Google SwiftShader');
  assert.equal(result.cameraCount, 1);
  assert.equal(result.scene.primitives, 3);
  assert.equal(result.cameraView.containsFixture, true);
  assert.ok(Math.abs(result.cameraPose.longitude - -97.7431) < 1e-10);
  assert.ok(Math.abs(result.cameraPose.latitude - 30.2672) < 1e-10);
  assert.equal(result.cameraPose.heightM, 25_000);
  assertCctvCheckpoint(result);
  const configured = [];
  const ordered = [];
  let resolveRestore;
  const initialRestorePromise = new Promise((resolve) => {
    resolveRestore = resolve;
  });
  const configContext = vm.createContext({
    window: {
      __godsEyeView: {
        styleManager: { initialRestorePromise },
        dataManager: {
          setLayerParams: () => {
            ordered.push('params');
            return true;
          },
          layers: new Map([
            ['cctv', { module: { getUIState: () => ({ autoHop: false }) } }],
          ]),
        },
        viewer: {
          scene: {
            globe: {
              ellipsoid: { cartographicToCartesian: (point) => point },
            },
          },
          camera: { setView: (value) => configured.push(value) },
        },
      },
    },
    Math,
    Promise,
    Error,
  });
  const configPromise = vm.runInContext(
    `(${configureCctvLifecycleSceneInPage.toString()})(${JSON.stringify(createCctvLifecycleFixture().view)})`,
    configContext,
  );
  assert.deepEqual(ordered, []);
  resolveRestore();
  const sceneConfiguration = await configPromise;
  assert.deepEqual(JSON.parse(JSON.stringify(sceneConfiguration)), {
    ...createCctvLifecycleFixture().view,
    applied: true,
  });
  assert.equal(configured.length, 1);
  assert.deepEqual(ordered, ['params']);
});

test('CCTV share hash has finite camera coordinates and suppresses the unrelated startup flight', () => {
  assert.equal(cctvLifecycleShareHash(), '#lat=30.2672&lon=-97.7431');
  assert.match(cctvLifecycleShareHash(), /lat=-?\d+(?:\.\d+)?&lon=-?\d/);
});

test('synthetic CCTV frame is a decodable 2x2 PNG and its bytes match the fixture digest', async () => {
  const fixture = createCctvLifecycleFixture();
  const response = captureCctvFixtureResponse(
    fixture,
    new URL(`http://localhost:4174/api/cctv/frame/${fixture.cameraId}`),
    'http://localhost:4174',
  );
  assert.equal(response.contentType, 'image/png');
  const bytes = Buffer.from(response.body);
  const decoded = await sharp(bytes).metadata();
  assert.equal(decoded.format, 'png');
  assert.equal(decoded.width, 2);
  assert.equal(decoded.height, 2);
});

test('serialized manager toggles and disabled direct init invoke real public methods', async () => {
  const calls = [];
  const manager = {
    isEnabled: () => false,
    setEnabled: async (...args) => {
      calls.push(args);
      return true;
    },
    layers: new Map([
      ['cctv', { module: { init: async () => calls.push(['init']) } }],
    ]),
  };
  const context = vm.createContext({
    window: { __godsEyeView: { dataManager: manager, viewer: {} } },
    TypeError,
    Error,
  });
  await vm.runInContext(
    `(${setCctvLifecycleEnabledInPage.toString()})(false)`,
    context,
  );
  await vm.runInContext(
    `(${reinitializeDisabledCctvModuleInPage.toString()})()`,
    context,
  );
  assert.equal(calls[0][0], 'cctv');
  assert.equal(calls[0][1], false);
  assert.deepEqual(calls[1], ['init']);
});

test('completed-render waiter registers, requests through governor and removes its listener', async () => {
  const listeners = new Set();
  const scene = {
    postRender: {
      addEventListener: (listener) => {
        listeners.add(listener);
      },
      removeEventListener: (listener) => {
        listeners.delete(listener);
      },
    },
    frameState: { frameNumber: 17 },
    requestRender: () => {
      requested++;
      queueMicrotask(() => [...listeners].forEach((listener) => listener()));
    },
  };
  let requested = 0;
  const pageContext = vm.createContext({
    window: {
      __godsEyeView: {
        viewer: { scene },
        requestRender: () => {
          requested++;
          queueMicrotask(() =>
            [...listeners].forEach((listener) => listener()),
          );
        },
      },
    },
    performance: { now: () => 123 },
    Promise,
    setTimeout,
    clearTimeout,
    Error,
    Number,
  });
  const result = await vm.runInContext(
    `(${waitForCctvLifecycleRenderInPage.toString()})(100)`,
    pageContext,
  );
  assert.equal(result.frameNumber, 17);
  assert.equal(requested, 1);
  assert.equal(listeners.size, 0);
});

test('CCTV checkpoint rejects pending/errors/invalid counters', () => {
  const pending = validCheckpoint(false);
  pending.worker.pending = 1;
  assert.throws(() => assertCctvCheckpoint(pending), /worker/);
  const loading = validCheckpoint(true);
  loading.stats.loading = true;
  assert.throws(() => assertCctvCheckpoint(loading), /settled/);
  const negative = validCheckpoint(false);
  negative.diagnostics.listeners = -1;
  assert.throws(() => assertCctvCheckpoint(negative), /listeners/);
  const missingEntities = validCheckpoint(false);
  delete missingEntities.diagnostics.entities;
  assert.throws(() => assertCctvCheckpoint(missingEntities), /entities/);
  const mislabeledEntities = validCheckpoint(false);
  mislabeledEntities.diagnostics.dataSources = 1;
  assert.throws(
    () => assertCctvCheckpoint(mislabeledEntities),
    /scene entities as data sources/,
  );
  const workerError = validCheckpoint(false);
  workerError.worker.workers[0].taskErrors = 1;
  assert.throws(() => assertCctvCheckpoint(workerError), /worker/);
  const incompleteWorkerInventory = validCheckpoint(false);
  incompleteWorkerInventory.worker.workerCount++;
  assert.throws(
    () => assertCctvCheckpoint(incompleteWorkerInventory),
    /worker checkpoint/,
  );
  const inconsistentWorkerTotals = validCheckpoint(false);
  inconsistentWorkerTotals.worker.workers[1].completed--;
  assert.throws(
    () => assertCctvCheckpoint(inconsistentWorkerTotals),
    /worker checkpoint/,
  );
});

test('CCTV lifecycle report validates five exact toggles, scene resources and direct disabled reinit', () => {
  const report = validReport();
  const fixture = createCctvLifecycleFixture();
  assert.equal(assertCctvCycleReuse(report.cycles[0], report.warmup), true);
  const wrappedHeading = structuredClone(report.cycles[0].enabled);
  wrappedHeading.cameraPose.headingRadians = Math.PI * 2;
  assertCctvCameraPose(wrappedHeading, fixture.view);
  assert.equal(
    validateCctvLifecycleReport(report, { fixtureSha256: fixture.sha256 })
      .status,
    'passed',
  );
  const legacyV1 = structuredClone(report);
  legacyV1.schema = 'gev-cctv-lifecycle/v1';
  delete legacyV1.rapidGeometryRevision;
  emulateLegacyCctvResourceSemantics(legacyV1);
  const legacyV1Result = validateCctvLifecycleReport(legacyV1, {
    fixtureSha256: fixture.sha256,
  });
  assert.equal(legacyV1Result.status, 'passed');
  assert.equal(
    legacyV1Result.resourceDiagnosticsSchema,
    'legacy-cctv-diagnostics/dataSources-alias-entities-v1',
  );
  const legacyV2 = structuredClone(report);
  legacyV2.schema = 'gev-cctv-lifecycle/v2';
  emulateLegacyCctvResourceSemantics(legacyV2);
  assert.equal(
    validateCctvLifecycleReport(legacyV2, { fixtureSha256: fixture.sha256 })
      .status,
    'passed',
  );
  for (const schema of ['gev-cctv-lifecycle/v1', 'gev-cctv-lifecycle/v2']) {
    for (const mode of ['zero', 'missing']) {
      const invalidWarmup = structuredClone(legacyV2);
      invalidWarmup.schema = schema;
      const diagnostics = invalidWarmup.warmup.enabled.diagnostics;
      if (mode === 'zero') diagnostics.dataSources = 0;
      else delete diagnostics.dataSources;
      assert.throws(
        () =>
          validateCctvLifecycleReport(invalidWarmup, {
            fixtureSha256: fixture.sha256,
          }),
        /diagnostic dataSources|materialize visible scene geometry/,
      );
    }
  }
  const unlabeledCurrent = structuredClone(report);
  delete unlabeledCurrent.resourceDiagnosticsSchema;
  assert.throws(
    () =>
      validateCctvLifecycleReport(unlabeledCurrent, {
        fixtureSha256: fixture.sha256,
      }),
    /resource diagnostic semantics/,
  );
  const oldSchemaNewSemantics = structuredClone(legacyV2);
  oldSchemaNewSemantics.resourceDiagnosticsSchema =
    CCTV_RESOURCE_DIAGNOSTICS_SCHEMA;
  assert.throws(
    () =>
      validateCctvLifecycleReport(oldSchemaNewSemantics, {
        fixtureSha256: fixture.sha256,
      }),
    /resource diagnostic semantics/,
  );
  const missingCycle = structuredClone(report);
  missingCycle.cycles.pop();
  assert.throws(
    () =>
      validateCctvLifecycleReport(missingCycle, {
        fixtureSha256: fixture.sha256,
      }),
    /inventory/,
  );
  const changedResource = structuredClone(report);
  changedResource.cycles[2].disabled.scene.primitives++;
  assert.throws(
    () =>
      validateCctvLifecycleReport(changedResource, {
        fixtureSha256: fixture.sha256,
      }),
    /resources/,
  );
  const extraGeometry = structuredClone(report);
  extraGeometry.cycles[0].createGeometrySubmitted++;
  assert.throws(
    () =>
      validateCctvLifecycleReport(extraGeometry, {
        fixtureSha256: fixture.sha256,
      }),
    /resubmitted/,
  );
  const forcedClose = structuredClone(report);
  forcedClose.browserClose.forcedProcessTermination = true;
  assert.throws(
    () =>
      validateCctvLifecycleReport(forcedClose, {
        fixtureSha256: fixture.sha256,
      }),
    /close cleanly/,
  );
  const wrongFixture = structuredClone(report);
  wrongFixture.fixture.cameraId = 'another-camera';
  assert.throws(
    () =>
      validateCctvLifecycleReport(wrongFixture, {
        fixtureSha256: fixture.sha256,
      }),
    /fixture identity/,
  );
  const changedCheckpointCommit = structuredClone(report);
  changedCheckpointCommit.cycles[0].enabled.appCommit = 'b'.repeat(40);
  assert.throws(
    () =>
      validateCctvLifecycleReport(changedCheckpointCommit, {
        fixtureSha256: fixture.sha256,
      }),
    /checkpoint application commit/,
  );
  const truncatedWorkers = structuredClone(report);
  truncatedWorkers.cycles[0].enabled.worker.workersTruncated = true;
  assert.throws(
    () =>
      validateCctvLifecycleReport(truncatedWorkers, {
        fixtureSha256: fixture.sha256,
      }),
    /worker checkpoint/,
  );
  const noActiveGeometry = structuredClone(report);
  noActiveGeometry.warmup.enabled.worker.workers[1].terminated = true;
  assert.throws(
    () =>
      validateCctvLifecycleReport(noActiveGeometry, {
        fixtureSha256: fixture.sha256,
      }),
    /nonterminated createGeometry/,
  );
  const missingDelivery = structuredClone(report);
  delete missingDelivery.fixtureDelivery.frameResponses;
  assert.throws(
    () =>
      validateCctvLifecycleReport(missingDelivery, {
        fixtureSha256: fixture.sha256,
      }),
    /delivery/,
  );
  const startupFlight = structuredClone(report);
  startupFlight.cycles[0].enabled.cameraPose.latitude += 1;
  assert.throws(
    () =>
      validateCctvLifecycleReport(startupFlight, {
        fixtureSha256: fixture.sha256,
      }),
    /camera pose/,
  );
  const unstableCheckpoint = structuredClone(report);
  unstableCheckpoint.cycles[0].disabled.drainStability.windowMs = 999;
  assert.throws(
    () =>
      validateCctvLifecycleReport(unstableCheckpoint, {
        fixtureSha256: fixture.sha256,
      }),
    /stable one-second/,
  );
  const wrongWorker = structuredClone(report);
  wrongWorker.rapidGeometryRevision.boundary.enabledRelease.held.workerKind =
    'heightmap.js';
  assert.throws(
    () =>
      validateCctvLifecycleReport(wrongWorker, {
        fixtureSha256: fixture.sha256,
      }),
    /worker identity/,
  );
  const wrongTask = structuredClone(report);
  wrongTask.rapidGeometryRevision.boundary.disabledRelease.whileRevisionB
    .taskId++;
  assert.throws(
    () =>
      validateCctvLifecycleReport(wrongTask, {
        fixtureSha256: fixture.sha256,
      }),
    /release ordering/,
  );
  const noBSubmission = structuredClone(report);
  noBSubmission.rapidGeometryRevision.boundary.enabledRelease.whileRevisionB.workerSubmissionsWhileHeld = 0;
  assert.throws(
    () =>
      validateCctvLifecycleReport(noBSubmission, {
        fixtureSha256: fixture.sha256,
      }),
    /release ordering/,
  );
  const releasedBeforeDisable = structuredClone(report);
  releasedBeforeDisable.rapidGeometryRevision.checkpoints.disabledWithHeldResult.worker.pending = 0;
  releasedBeforeDisable.rapidGeometryRevision.checkpoints.disabledWithHeldResult.worker.workers[1].pending = 0;
  assert.throws(
    () =>
      validateCctvLifecycleReport(releasedBeforeDisable, {
        fixtureSha256: fixture.sha256,
      }),
    /worker boundary/,
  );
  const projectionPicks = structuredClone(report);
  for (const name of ['referenceB', 'afterRelease', 'afterReenable']) {
    projectionPicks.rapidGeometryRevision.samples[name].pickedEntityIds[0] =
      `cctv-${fixture.cameraId}-plane`;
  }
  assert.doesNotThrow(() =>
    validateCctvLifecycleReport(projectionPicks, {
      fixtureSha256: fixture.sha256,
    }),
  );
  projectionPicks.rapidGeometryRevision.samples.afterRelease.pickedCameraIds[0] =
    'unrelated-camera';
  assert.throws(
    () =>
      validateCctvLifecycleReport(projectionPicks, {
        fixtureSha256: fixture.sha256,
      }),
    /sample is invalid/,
  );
  const changedPickedId = structuredClone(report);
  for (const invalidState of [
    'disabled',
    { enabled: false, lifecycleState: 'disabled', uncertain: true },
    { enabled: true, lifecycleState: 'disabled', uncertain: false },
    { enabled: false, lifecycleState: 'disabling', uncertain: false },
  ]) {
    const invalidLifecycle = structuredClone(report);
    invalidLifecycle.rapidGeometryRevision.checkpoints.disabledWithHeldResult.lifecycleState =
      invalidState;
    assert.throws(
      () =>
        validateCctvLifecycleReport(invalidLifecycle, {
          fixtureSha256: fixture.sha256,
        }),
      /not disabled with revision A still pending/,
    );
  }
  changedPickedId.rapidGeometryRevision.samples.afterReenable.pickedEntityIds[0] =
    changedPickedId.rapidGeometryRevision.samples.referenceB.pickedEntityIds[1];
  assert.throws(
    () =>
      validateCctvLifecycleReport(changedPickedId, {
        fixtureSha256: fixture.sha256,
      }),
    /pick identities/,
  );
  const disabledResurrection = structuredClone(report);
  disabledResurrection.rapidGeometryRevision.samples.disabledAfterRelease.pngSha256 =
    '9'.repeat(64);
  assert.throws(
    () =>
      validateCctvLifecycleReport(disabledResurrection, {
        fixtureSha256: fixture.sha256,
      }),
    /resurrected/,
  );
  const noCleanup = structuredClone(report);
  noCleanup.rapidGeometryRevision.boundary.final.listenersReleased = false;
  assert.throws(
    () =>
      validateCctvLifecycleReport(noCleanup, {
        fixtureSha256: fixture.sha256,
      }),
    /worker boundary/,
  );
});

function createCctvRunnerDependencies({
  failBoot = false,
  resubmitOnFirstCycle = false,
  extraDirectReinitBuilds = false,
} = {}) {
  const order = [];
  const commit = 'a'.repeat(40);
  const fixture = createCctvLifecycleFixture();
  const fixtureFrameUrl = new URL(
    createCctvSource().getFrameUrl(fixture.sources[0]),
    'http://localhost:4174',
  ).href;
  let enabled = false;
  let enableCalls = 0;
  let onFulfilled;
  let rendererReads = 0;
  let browserLaunchOptions = null;
  let bootOptions = null;
  let pageClosed = false;
  let bootHash = null;
  const worker = {
    instrumented: true,
    overflow: false,
    pending: 0,
    workers: [
      {
        kind: 'createGeometry.js',
        submitted: 4,
        completed: 4,
        cancelled: 0,
        pending: 0,
        taskErrors: 1,
        workerErrors: 0,
        postErrors: 0,
        terminated: true,
        oldestPendingMs: 0,
      },
      {
        kind: 'createGeometry.js',
        submitted: 3,
        completed: 3,
        cancelled: 0,
        pending: 0,
        taskErrors: 0,
        workerErrors: 0,
        postErrors: 0,
        terminated: false,
        oldestPendingMs: 0,
      },
    ],
  };
  const fulfill = (pathOrUrl) =>
    onFulfilled?.({
      url: pathOrUrl.startsWith('http://')
        ? pathOrUrl
        : `http://localhost:4174${pathOrUrl}`,
    });
  const module = {
    getStats: () => ({
      count: 1,
      loading: false,
      loadingLoaded: 1,
      loadingTotal: 1,
      error: null,
    }),
    getUIState: () => ({
      enabled,
      cameras: [{ id: fixture.cameraId, active: true }],
      activeCameraId: fixture.cameraId,
      autoHop: false,
    }),
    getPerformanceDiagnostics: () => ({
      listeners: 4,
      timers: enabled ? 1 : 0,
      pendingJobs: 0,
      primitives: 1,
      entities: 1,
      dataSources: 0,
      cacheEntries: 0,
    }),
    init: async () => {
      if (extraDirectReinitBuilds) {
        worker.workers[1].submitted += 2;
        worker.workers[1].completed += 2;
      }
      fulfill('/api/cctv/sources');
      fulfill('/api/cctv/health');
    },
  };
  const manager = {
    layers: new Map([['cctv', { module }]]),
    isEnabled: () => enabled,
    getLayerLifecycleState: () => (enabled ? 'enabled' : 'disabled'),
    getAll: () => [
      { id: 'cctv', enabled },
      { id: 'terrain', enabled: false },
    ],
    restoreEnabledLayerIds: async (ids) => {
      order.push('disable-unrelated');
      enabled = ids.includes('cctv');
    },
    setEnabled: async (id, value) => {
      order.push(value ? 'enable' : 'disable');
      enabled = value;
      if (value) {
        enableCalls++;
        if (resubmitOnFirstCycle && enableCalls === 2) {
          worker.workers[1].submitted++;
          worker.workers[1].completed++;
        }
        fulfill('/api/cctv/sources');
        fulfill('/api/cctv/health');
        fulfill(fixtureFrameUrl);
      }
      return true;
    },
    setLayerParams: () => true,
  };
  const listeners = new Set();
  const gl = {
    getContextAttributes: () => ({ antialias: true }),
    getExtension: () => {
      rendererReads++;
      return { UNMASKED_RENDERER_WEBGL: 1, UNMASKED_VENDOR_WEBGL: 2 };
    },
    getParameter: (parameter) =>
      parameter === 1 ? 'Google SwiftShader' : 'Google',
  };
  const scene = {
    postRender: {
      addEventListener: (listener) => listeners.add(listener),
      removeEventListener: (listener) => listeners.delete(listener),
    },
    frameState: { frameNumber: 1 },
    context: { _originalGLContext: gl },
    globe: {
      ellipsoid: {
        cartographicToCartesian: (position) => position,
        cartesianToCartographic: (position) => position,
      },
    },
    primitives: { length: 8 },
    groundPrimitives: { length: 0 },
    canvas: {
      width: 1440,
      height: 1000,
      getBoundingClientRect: () => ({ width: 1440, height: 1000 }),
    },
    requestRender: () => {
      scene.frameState.frameNumber++;
      for (const listener of [...listeners]) listener();
    },
  };
  const debug = {
    dataManager: manager,
    viewer: {
      scene,
      camera: {
        setView: ({ destination, orientation }) => {
          debug.viewer.camera.positionWC = destination;
          debug.viewer.camera.heading = orientation.heading;
          debug.viewer.camera.pitch = orientation.pitch;
          debug.viewer.camera.roll = orientation.roll;
        },
        positionWC: {
          longitude: (-97.7431 * Math.PI) / 180,
          latitude: (30.2672 * Math.PI) / 180,
          height: 25_000,
        },
        heading: 0,
        pitch: -1.2,
        roll: 0,
        computeViewRectangle: () => ({
          west: (-98 * Math.PI) / 180,
          east: (-97 * Math.PI) / 180,
          south: (30 * Math.PI) / 180,
          north: (31 * Math.PI) / 180,
        }),
      },
      entities: { values: [1] },
      dataSources: { length: 0 },
    },
    styleManager: { initialRestorePromise: Promise.resolve() },
    getPerformanceEnvironment: () => ({ appCommit: commit }),
  };
  const page = {
    url: () => (pageClosed ? 'about:blank' : 'http://localhost:4174/'),
    isClosed: () => pageClosed,
    close: async () => {
      pageClosed = true;
      order.push('page-close');
    },
    setDefaultTimeout() {},
    evaluateOnNewDocument() {},
    evaluate: async (callback, ...args) => {
      const context = vm.createContext({
        window: {
          __godsEyeView: debug,
          __gevSoakWorkers: { snapshot: () => worker },
        },
        Promise,
        Error,
        TypeError,
        Number,
        String,
        Boolean,
        Array,
        setTimeout,
        clearTimeout,
        performance: { now: () => 1 },
      });
      return vm.runInContext(`(${callback.toString()})`, context)(...args);
    },
  };
  const context = {
    newPage: async () => page,
    pages: async () => (pageClosed ? [] : [page]),
    close: async () => {
      order.push('context-close');
    },
  };
  const browser = {
    createBrowserContext: async () => context,
    pages: async () => [
      { url: () => 'about:blank' },
      ...(pageClosed ? [] : [page]),
    ],
    process: () => ({}),
    version: async () => 'HeadlessChrome/152.0.0.0',
  };
  const identity = {
    commit,
    clean: true,
    githubSha: commit,
    githubMatchesHead: true,
  };
  const dependencies = {
    gitIdentity: () => identity,
    launchFixtureBrowser: async (options) => {
      browserLaunchOptions = options;
      order.push('browser-launch');
      return browser;
    },
    prepareFixturePage: async (_browser, base, options) => {
      onFulfilled = options.onFulfilled;
      const sourceResponse = options.respond(
        new URL('/api/cctv/sources', base),
      );
      assert.equal(sourceResponse.status, 200);
      assert.deepEqual(JSON.parse(sourceResponse.body), {
        sources: createCctvLifecycleFixture().sources,
      });
      return { page, errors: [], verifyNetwork: async () => true };
    },
    bootFixturePage: async (_page, _base, options) => {
      const { hash, onProgress: bootProgress } = options;
      bootOptions = options;
      order.push('boot');
      bootHash = hash;
      bootProgress('ready');
      if (failBoot) throw new Error('synthetic boot failure');
    },
    cleanupFixturePageDiagnostics: async () => {
      order.push('page-diagnostics-cleanup');
    },
    installWorkerDiagnostics: () => {},
    installLifecycleRenderWaiter: () => {},
    installLifecycleDrainObserver: () => {},
    installLifecycleSceneReadinessObserver: () => {},
    runRapidGeometryRevision: async (_page, report) => {
      order.push('rapid-geometry-revision');
      const revision = validRapidGeometryRevision(report.applicationCommit);
      assertCctvRapidGeometryRevision(revision, {
        expectedTaskErrors: report.workerPreflight.expectedTaskErrorWorkers,
        warmup: report.warmup,
      });
      return revision;
    },
    waitForLifecycleSceneReadiness: async () => {
      order.push('scene-ready');
      return { status: 'ready', elapsedMs: 1 };
    },
    readWorkerPreflight: async () => {
      order.push('worker-preflight');
      return { status: 'passed' };
    },
    closeRecoveryBrowser: async (_browser, { timeoutMs }) => {
      order.push('browser-close');
      return {
        closeCompleted: true,
        forcedProcessTermination: false,
        observation: {
          closeDeadlineMs: timeoutMs,
          closeElapsedMs: 10,
          forceProcessStatus: 'not-needed',
          processExit: { code: 0, signal: null, elapsedMs: 10 },
        },
      };
    },
    stopOwnedRecoveryProcessTree: async () => ({
      attempted: false,
      confirmed: true,
      reason: 'already-exited',
    }),
  };
  return {
    dependencies,
    order,
    commit,
    page,
    worker,
    get rendererReads() {
      return rendererReads;
    },
    get bootHash() {
      return bootHash;
    },
    get browserLaunchOptions() {
      return browserLaunchOptions;
    },
    get bootOptions() {
      return bootOptions;
    },
  };
}

test('CCTV runner completes the full serialized lifecycle and closes owned resources', async () => {
  const runner = createCctvRunnerDependencies({
    extraDirectReinitBuilds: true,
  });
  const { dependencies, order, commit } = runner;
  const progressSnapshots = [];
  const report = await runCctvLifecycle({
    url: 'http://localhost:4174',
    cycles: 2,
    drainMs: 2000,
    expectedCommit: commit,
    dependencies,
    onProgress: (event, currentReport) =>
      progressSnapshots.push([event.phase, currentReport.status]),
  });
  assert.equal(report.status, 'passed', report.error);
  assert.equal(report.validationStatus, 'passed');
  assert.equal(report.cycles.length, 2);
  for (const row of [
    report.warmup.enabled,
    report.warmup.disabled,
    ...report.cycles.flatMap((cycle) => [cycle.enabled, cycle.disabled]),
    report.directReinit.initializedDisabled,
    report.directReinit.rewarmedEnabled,
    report.directReinit.checkpoint,
  ]) {
    assert.equal(row.drainStability.status, 'stable');
    assert.ok(row.drainStability.windowMs >= 1000);
    assert.ok(row.drainStability.sampleCount >= 3);
    assert.ok(
      row.drainStability.lastFrameNumber > row.drainStability.firstFrameNumber,
    );
  }
  assert.equal(report.fixtureDelivery.frameResponses, 4);
  assert.ok(
    report.directReinit.rewarmedEnabled.worker.workers[1].submitted >
      report.warmup.enabled.worker.workers[1].submitted,
    'direct module init may legitimately build geometry after destroying its prior state',
  );
  assert.equal(report.pageClose.scope, 'owned-context-only');
  assert.equal(report.pageClose.openPageCount, 0);
  assert.equal(report.environment.browserVersion, 'HeadlessChrome/152.0.0.0');
  assert.equal(runner.bootHash, '#lat=30.2672&lon=-97.7431');
  assert.equal(runner.browserLaunchOptions.protocolTimeout, 180_000);
  assert.equal(runner.bootOptions.applicationReadyTimeoutMs, 180_000);
  assert.ok(report.environment.host.osRelease);
  assert.equal(
    runner.rendererReads,
    1,
    'renderer identity is read only at the initial ready checkpoint',
  );
  assert.equal(order.filter((phase) => phase === 'worker-preflight').length, 1);
  assert.ok(order.indexOf('scene-ready') < order.indexOf('worker-preflight'));
  assert.ok(order.indexOf('worker-preflight') < order.indexOf('enable'));
  assert.ok(order.indexOf('page-close') < order.indexOf('context-close'));
  assert.ok(order.indexOf('context-close') < order.indexOf('browser-close'));
  assert.ok(
    progressSnapshots.some(
      ([phase]) => phase === 'cycle-2-disable:completed-render',
    ),
  );
  assert.equal(progressSnapshots.at(-1)[1], 'running');
});

test('CCTV stable drain restarts its window when new work appears after initial quiescence', async () => {
  const { page, worker } = createCctvRunnerDependencies();
  const fixture = createCctvLifecycleFixture();
  const initialCheckpoint = await page.evaluate(
    readCctvLifecycleCheckpointInPage,
    { fixtureView: fixture.view },
  );
  const expectedTaskErrors = cctvTaskErrorSignature(initialCheckpoint);
  const observations = [];
  let injected = false;
  let delayedWork;
  const result = await waitForCctvLifecycleDrain(page, 3000, {
    expectedTaskErrors,
    fixtureView: fixture.view,
    stableWindowMs: 1000,
    sampleIntervalMs: 100,
    onObservation: (observation, checkpoint) => {
      observations.push({
        elapsedMs: observation.elapsedMs,
        stableElapsedMs: observation.stableElapsedMs,
        submitted: checkpoint.worker.workers[1].submitted,
        pending: checkpoint.worker.pending,
      });
      if (!injected) {
        injected = true;
        delayedWork = setTimeout(() => {
          worker.workers[1].submitted++;
          worker.workers[1].completed++;
        }, 350);
      }
    },
  });
  clearTimeout(delayedWork);

  assert.equal(observations[0].pending, 0);
  assert.equal(observations[0].stableElapsedMs, 0);
  assert.ok(observations.some((sample) => sample.submitted === 4));
  assert.equal(result.checkpoint.worker.workers[1].submitted, 4);
  assert.ok(result.stability.windowMs >= 1000);
  assert.ok(result.elapsedMs >= 1300);
});

test('CCTV stable drain accepts slow native frames without imposing a frame-rate gate', async () => {
  const { page } = createCctvRunnerDependencies();
  const originalEvaluate = page.evaluate.bind(page);
  page.evaluate = async (callback, ...args) => {
    if (callback.name === 'waitForCctvLifecycleRenderInPage')
      await new Promise((resolve) => setTimeout(resolve, 600));
    return originalEvaluate(callback, ...args);
  };
  const initial = await page.evaluate(readCctvLifecycleCheckpointInPage);
  const result = await waitForCctvLifecycleDrain(page, 4000, {
    expectedTaskErrors: cctvTaskErrorSignature(initial),
  });
  assert.ok(result.stability.sampleCount >= 3);
  assert.ok(result.stability.sampleCount < 10);
  assert.ok(result.stability.maximumSampleGapMs > 500);
  assert.ok(result.stability.windowMs >= 1000);
  assert.equal(result.checkpoint.drainHistory.truncated, false);
  assert.ok(result.checkpoint.drainHistory.samples.length >= 3);
});

test('CCTV drain preserves the last observation when a later render request fails', async () => {
  const { page } = createCctvRunnerDependencies();
  const originalEvaluate = page.evaluate.bind(page);
  let renderCalls = 0;
  page.evaluate = async (callback, ...args) => {
    if (
      callback.name === 'waitForCctvLifecycleRenderInPage' &&
      ++renderCalls === 2
    )
      throw new Error('synthetic render deadline');
    return originalEvaluate(callback, ...args);
  };
  const initial = await page.evaluate(readCctvLifecycleCheckpointInPage);
  await assert.rejects(
    waitForCctvLifecycleDrain(page, 2000, {
      expectedTaskErrors: cctvTaskErrorSignature(initial),
    }),
    (error) => {
      assert.match(error.message, /synthetic render deadline/);
      assert.equal(error.drainHistory.samples.length, 1);
      assert.equal(error.drainHistory.truncated, false);
      assert.equal(error.lastCheckpoint.worker.pending, 0);
      assert.equal(error.drainStability.sampleCount, 1);
      return true;
    },
  );
});

test('CCTV runner retains the original phase/error and closes acquired resources on failure', async () => {
  const { dependencies, order, commit } = createCctvRunnerDependencies({
    failBoot: true,
  });
  const report = await runCctvLifecycle({
    url: 'http://localhost:4174',
    expectedCommit: commit,
    dependencies,
  });
  assert.equal(report.status, 'failed');
  assert.match(report.error, /synthetic boot failure/);
  assert.equal(report.failedPhase, 'application-boot:ready');
  assert.ok(order.includes('page-close'));
  assert.ok(order.includes('context-close'));
  assert.ok(order.includes('browser-close'));
});

test('CCTV runner retains structured worker preflight failure evidence', async () => {
  const { dependencies, commit } = createCctvRunnerDependencies();
  const evidence = {
    schema: 'gev-lifecycle-failure-evidence/v1',
    caseId: 'worker-preflight',
    failedPhase: 'worker-preflight-validation',
  };
  dependencies.readWorkerPreflight = async () => {
    const error = new Error('synthetic worker preflight failure');
    error.lifecycleFailureEvidence = evidence;
    throw error;
  };
  const report = await runCctvLifecycle({
    url: 'http://localhost:4174',
    expectedCommit: commit,
    dependencies,
  });
  assert.equal(report.status, 'failed');
  assert.equal(report.failedPhase, 'worker-aware-fixture-preflight');
  assert.deepEqual(report.workerPreflightFailure, evidence);
});

test('CCTV runner does not mark a toggle passed before warmed-resource reuse is verified', async () => {
  const { dependencies, commit } = createCctvRunnerDependencies({
    resubmitOnFirstCycle: true,
  });
  const report = await runCctvLifecycle({
    url: 'http://localhost:4174',
    cycles: 1,
    drainMs: 2000,
    expectedCommit: commit,
    dependencies,
  });
  assert.equal(report.status, 'failed');
  assert.equal(report.failedPhase, 'cycle-1:reuse-validation');
  assert.equal(report.cycles[0].status, 'running');
  assert.match(report.error, /resubmitted settled createGeometry/);
});
