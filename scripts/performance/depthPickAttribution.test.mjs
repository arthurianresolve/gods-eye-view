import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickPositionWithAttribution } from '../../src/data/scenePick.js';
import {
  createDepthPickAttributionIdentity,
  disposeDepthPickAttribution,
  disposeDepthPickAttributionForPage,
  depthPickRetirementConfirmed,
  installDepthPickAttribution,
  observeDepthPickAttributionBoundary,
  retainDepthPickBoundaryFailure,
  validateDepthPickAttributionEnvelope,
} from './depthPickAttribution.mjs';
import { createCaptureFailureReport } from './captureFailureReport.mjs';
import { compactCaptureCliFailure } from '../qa-performance-build-smoke.mjs';

function installWorld() {
  const listeners = new Set();
  const scene = {
    mode: 3,
    canvas: {
      width: 800,
      height: 600,
      getBoundingClientRect: () => ({
        left: 0,
        top: 0,
        width: 800,
        height: 600,
      }),
      pickPosition() {},
    },
    postRender: {
      addEventListener(listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    },
  };
  const camera = {
    positionCartographic: { longitude: 1, latitude: 0.5, height: 1000 },
    positionWC: { x: 1, y: 2, z: 3 },
    directionWC: { x: 0, y: 0, z: -1 },
    upWC: { x: 0, y: 1, z: 0 },
    viewMatrix: Array.from({ length: 16 }, (_, index) => index),
    frustum: { fov: 1, near: 1, far: 2, projectionMatrix: Array(16).fill(0) },
    heading: 0.2,
    pitch: -1,
    roll: 0,
  };
  const viewer = { scene, camera };
  globalThis.__godsEyeView = { viewer };
  return { viewer, scene, camera, listeners };
}

test('page observer is serializable, bounded, and captures per-pick inputs and caller', () => {
  const world = installWorld();
  const pageInstall = Function(
    `return (${installDepthPickAttribution.toString()})`,
  )();
  const pageObserve = Function(
    `return (${observeDepthPickAttributionBoundary.toString()})`,
  )();
  const pageDispose = Function(
    `return (${disposeDepthPickAttribution.toString()})`,
  )();
  const installed = pageInstall({
    scenario: 'idle',
    run: 1,
    captureOrdinal: 0,
    documentRole: 'provider-sample-0',
    documentId: 'sample-0',
    maxRows: 2,
  });
  assert.equal(installed.installed, true);
  for (const listener of world.listeners) listener();
  const originalResult = { x: 6378137 };
  world.scene.pickPosition = () => originalResult;
  const position = { x: 400, y: 300 };
  assert.equal(
    pickPositionWithAttribution(
      world.viewer,
      'voice-move-end-prewarm',
      position,
    ),
    originalResult,
  );
  world.camera.positionCartographic.height = 2000;
  pickPositionWithAttribution(
    world.viewer,
    'camera-orientation-action',
    position,
  );
  pickPositionWithAttribution(world.viewer, 'voice-move-end-prewarm', position);
  const snapshot = pageObserve({
    label: 'warmup',
    ownerToken: installed.ownerToken,
  });
  assert.equal(snapshot.available, true);
  assert.equal(snapshot.completedRenderRevision, 1);
  assert.equal(snapshot.pickCounts['voice-move-end-prewarm'], 2);
  assert.equal(snapshot.rows.length, 2);
  assert.equal(snapshot.omittedRows, 1);
  assert.equal(snapshot.rows[0].heightM, 1000);
  assert.equal(snapshot.rows[1].heightM, 2000);
  assert.deepEqual(snapshot.rows[0].positionWorld, [1, 2, 3]);
  assert.equal(snapshot.rows[0].inputCapturedBeforePick, true);
  assert.equal(snapshot.rows[0].x, 400);
  assert.equal(snapshot.rows[0].completedRenderRevision, 1);
  assert.equal(snapshot.rows[0].pickElapsedMs >= 0, true);
  assert.equal(JSON.stringify(snapshot).includes('http'), false);
  assert.equal(pageDispose({ ownerToken: 'wrong-owner' }).confirmed, false);
  const disposed = pageDispose({ ownerToken: installed.ownerToken });
  assert.equal(disposed.confirmed, true);
  assert.equal(world.listeners.size, 0);
  assert.equal(world.scene.__gevDepthPickAttribution, undefined);
  delete globalThis.__godsEyeView;
});

test('observer rejects unowned callers and does not dispose a replacement owner', () => {
  const world = installWorld();
  const installed = installDepthPickAttribution({
    scenario: 'idle',
    run: 2,
    captureOrdinal: 1,
    documentRole: 'provider-sample-1',
    documentId: 'sample-1',
  });
  const owner = world.scene.__gevDepthPickAttribution;
  world.scene.__gevDepthPickAttribution = {
    ownerToken: 'replacement',
    snapshot: () => ({}),
  };
  assert.equal(
    disposeDepthPickAttribution({ ownerToken: installed.ownerToken }).confirmed,
    false,
  );
  assert.equal(world.scene.__gevDepthPickAttribution.ownerToken, 'replacement');
  assert.equal(owner.ownerToken, installed.ownerToken);
  delete globalThis.__godsEyeView;
});

test('actual observer output validates and survives the failed-capture smoke projection', () => {
  const world = installWorld();
  const identity = {
    scenario: 'idle',
    run: 1,
    captureOrdinal: 0,
    documentRole: 'provider-sample-0',
    documentId: 'sample-0',
  };
  const install = installDepthPickAttribution({ ...identity, maxRows: 8 });
  world.scene.pickPosition = () => ({ x: 1, y: 2, z: 3 });
  pickPositionWithAttribution(world.viewer, 'voice-move-end-prewarm', {
    x: 400,
    y: 300,
  });
  for (const listener of world.listeners) listener();
  const warmupBoundary = observeDepthPickAttributionBoundary({
    label: 'warmup-boundary',
    ownerToken: install.ownerToken,
  });
  pickPositionWithAttribution(world.viewer, 'hud-summary-context', {
    x: 400,
    y: 300,
  });
  const measurementBoundary = observeDepthPickAttributionBoundary({
    label: 'measurement-boundary',
    ownerToken: install.ownerToken,
  });
  const disposed = disposeDepthPickAttribution({
    ownerToken: install.ownerToken,
  });
  const sample = {
    ...identity,
    schema: 'gev-depth-pick-attribution-sample/v1',
    ownerToken: install.ownerToken,
    install,
    warmupBoundary,
    measurementBoundary,
    finalSnapshot: disposed.finalSnapshot,
    cleanupConfirmed: disposed.confirmed,
  };
  const envelope = {
    enabled: true,
    schema: 'gev-depth-pick-attribution/v1',
    performanceAcceptanceEligible: false,
    status: 'complete',
    samples: [sample],
  };
  assert.equal(
    validateDepthPickAttributionEnvelope(envelope, [identity]),
    true,
  );
  for (const key of ['positionWorld', 'viewMatrix', 'projectionMatrix']) {
    for (const malformed of [[], [1], Array(17).fill(0)]) {
      const corrupted = structuredClone(envelope);
      corrupted.samples[0].warmupBoundary.rows[0][key] = malformed;
      assert.throws(
        () => validateDepthPickAttributionEnvelope(corrupted, [identity]),
        new RegExp(`input ${key} is invalid`),
      );
    }
  }
  const forged = structuredClone(envelope);
  forged.samples[0].warmupBoundary.rows[0].caller = 'arbitrary-caller';
  assert.throws(
    () => validateDepthPickAttributionEnvelope(forged, [identity]),
    /row is malformed/,
  );
  const eligible = structuredClone(envelope);
  eligible.performanceAcceptanceEligible = true;
  assert.throws(
    () => validateDepthPickAttributionEnvelope(eligible, [identity]),
    /incomplete or eligible/,
  );
  const wrongOrdinal = structuredClone(envelope);
  wrongOrdinal.samples[0].captureOrdinal = 1;
  assert.throws(
    () => validateDepthPickAttributionEnvelope(wrongOrdinal, [identity]),
    /identity is invalid/,
  );
  const failureReport = createCaptureFailureReport({
    source: { appCommit: 'a'.repeat(40), harnessCommit: 'b'.repeat(40) },
    workload: { depthPickAttribution: envelope },
    phase: 'measurement-boundary-render-wait',
    scenario: 'idle',
    run: 1,
    current: {
      phase: 'measurement-boundary-render-wait',
      depthPickAttribution: sample,
    },
    error: new Error('expected diagnostic failure'),
  });
  const compacted = compactCaptureCliFailure(failureReport);
  assert.equal(compacted.rawReportTruncated, false);
  const current = compacted.rawReport.progress.current.depthPickAttribution;
  assert.equal(current.warmupBoundary.rows[0].caller, 'voice-move-end-prewarm');
  assert.equal(current.warmupBoundary.rows[0].completedRenderRevision, 0);
  assert.equal(current.warmupBoundary.rows[0].pickElapsedMs >= 0, true);
  assert.equal(current.warmupBoundary.rows[0].x, 400);
  assert.equal(current.warmupBoundary.rows[0].positionWorld.length, 3);
  assert.equal(current.cleanupConfirmed, true);
  delete globalThis.__godsEyeView;
});

test('warmup timeout before assignment retains final rows, owner and cleanup', async () => {
  const world = installWorld();
  const captures = [
    { scenario: 'idle', run: 1 },
    { scenario: 'idle', run: 2 },
  ];
  const identity = createDepthPickAttributionIdentity(captures, {
    scenario: 'idle',
    run: 3,
    documentRole: 'provider-sample-2',
    documentId: 'sample-2',
  });
  assert.equal(identity.captureOrdinal, 2);
  const installed = installDepthPickAttribution({ ...identity, maxRows: 8 });
  const sample = {
    ...identity,
    schema: 'gev-depth-pick-attribution-sample/v1',
    ownerToken: installed.ownerToken,
    install: installed,
    warmupBoundary: null,
    measurementBoundary: null,
    cleanupConfirmed: false,
  };
  world.scene.pickPosition = () => ({ x: 1, y: 2, z: 3 });
  pickPositionWithAttribution(world.viewer, 'voice-move-end-prewarm', {
    x: 401,
    y: 301,
  });
  const boundary = observeDepthPickAttributionBoundary({
    label: 'warmup-boundary',
    ownerToken: installed.ownerToken,
  });
  const timeout = Object.assign(new Error('host boundary timed out'), {
    boundaryObservation: {
      page: { diagnostics: { finalObservation: structuredClone(boundary) } },
    },
  });
  // This is the producer's catch path: the `await` rejected before the normal
  // assignment of warmupBoundarySettle and warmupBoundary could execute.
  retainDepthPickBoundaryFailure(sample, 'warmupBoundary', timeout);

  const page = {
    async evaluate(pageFunction, args) {
      const serializedFunction = Function(
        `return (${pageFunction.toString()})`,
      )();
      const serializedArgs = JSON.parse(JSON.stringify(args));
      return JSON.parse(JSON.stringify(serializedFunction(serializedArgs)));
    },
  };
  await disposeDepthPickAttributionForPage(page, {
    ownerToken: installed.ownerToken,
    sample,
    install: installed,
  });
  assert.equal(sample.cleanupConfirmed, true);
  assert.equal(sample.finalSnapshot.ownerToken, installed.ownerToken);
  assert.equal(sample.finalSnapshot.rows[0].caller, 'voice-move-end-prewarm');

  const failureReport = createCaptureFailureReport({
    source: { appCommit: 'a'.repeat(40), harnessCommit: 'b'.repeat(40) },
    workload: { depthPickAttribution: { enabled: true, samples: [sample] } },
    phase: 'warmup-boundary-render-wait',
    scenario: identity.scenario,
    run: identity.run,
    current: {
      phase: 'warmup-boundary-render-wait',
      depthPickAttribution: sample,
    },
    error: timeout,
  });
  const compacted = compactCaptureCliFailure(failureReport);
  const retained = compacted.rawReport.progress.current.depthPickAttribution;
  assert.equal(compacted.rawReport.status, 'failed');
  assert.equal(compacted.rawReportTruncated, false);
  assert.equal(retained.captureOrdinal, 2);
  assert.equal(
    retained.warmupBoundary.rows[0].caller,
    'voice-move-end-prewarm',
  );
  assert.equal(retained.warmupBoundary.rows[0].x, 401);
  assert.equal(retained.finalSnapshot.ownerToken, installed.ownerToken);
  assert.equal(retained.cleanupConfirmed, true);
  assert.equal(world.listeners.size, 0);
  delete globalThis.__godsEyeView;
});

test('setup-document retirement permits no owner, but requires cleanup for an installed owner', () => {
  assert.equal(depthPickRetirementConfirmed(true, null, null), true);
  assert.equal(depthPickRetirementConfirmed(false, {}, null), true);
  assert.equal(depthPickRetirementConfirmed(true, {}, null), false);
  assert.equal(
    depthPickRetirementConfirmed(true, {}, { confirmed: false }),
    false,
  );
  assert.equal(
    depthPickRetirementConfirmed(true, {}, { confirmed: true }),
    true,
  );
});
