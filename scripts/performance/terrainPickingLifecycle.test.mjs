import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import * as Cesium from 'cesium';
import {
  installTerrainCurrentUpdateReadinessObserver,
  finalizeTerrainCurrentUpdateObservation,
} from '../fixtures/terrainCurrentUpdateReadiness.mjs';
import {
  parseTerrainPickingLifecycleArgs,
  validateTerrainPickingLifecycleReport,
} from './terrainPickingLifecycle.mjs';
import {
  installTerrainFixtureRequestInterception,
  runTerrainPickingLifecycle,
  waitForTerrainFixtureCompletion,
} from '../qa-terrain-picking-lifecycle.mjs';

function snapshot({
  terrainKind = 'EllipsoidTerrainProvider',
  activeStackId = 'qa-terrain-flat',
  pending = 0,
  submitted = 8,
} = {}) {
  return {
    map: {
      activeStackId,
      switchOrigin: 'manual',
      cacheEntries: 4,
      pendingJobs: 0,
      imageryLayers: 1,
      primitives: 0,
      estimatedTileBytes: null,
      providerLoadsStarted: 3,
      providerCacheReuses: 4,
      providerLoadFailures: 0,
      streamedTileMemoryBytes: null,
      streamedTileMemoryUnavailableReason:
        'local single-tile imagery and custom heightmap fixture; no streamed 3D tile memory source',
    },
    cables: {
      listeners: 4,
      pendingJobs: 0,
      dataSources: 3,
      cacheEntries: 2,
    },
    scene: {
      dataSources: 3,
      imageryLayers: 1,
      primitives: 0,
      terrainProviderKind: terrainKind,
      globeTilesLoaded: true,
      dataSourceDisplayReady: true,
      frameNumber: 100,
      postRenderCount: 100,
      canvas: [960, 640],
      camera: [
        [6_378_137, 0, 0],
        [0, 0, -1],
        [0, 1, 0],
      ],
    },
    workerCounters: {
      instrumented: true,
      overflow: false,
      pending,
      workers: [
        {
          kind: 'createGeometry.js',
          submitted,
          completed: submitted - pending,
          cancelled: 0,
          pending,
          taskErrors: 0,
          workerErrors: 0,
          postErrors: 0,
        },
      ],
    },
  };
}

function validReport() {
  const relief = snapshot({ terrainKind: 'CustomHeightmapTerrainProvider' });
  const flat = snapshot();
  let updateGeneration = 0;
  const makeSwitch = (fromStackId, toStackId, measured = true) => {
    const generation = ++updateGeneration;
    const terrainKind =
      toStackId === 'qa-terrain-relief'
        ? 'CustomHeightmapTerrainProvider'
        : 'EllipsoidTerrainProvider';
    const before = snapshot({
      activeStackId: fromStackId,
      terrainKind:
        fromStackId === 'qa-terrain-relief'
          ? 'CustomHeightmapTerrainProvider'
          : 'EllipsoidTerrainProvider',
    });
    const afterSetStack = snapshot({
      activeStackId: toStackId,
      terrainKind,
    });
    const afterReady = snapshot({ activeStackId: toStackId, terrainKind });
    const sceneReadiness = {
      status: 'ready',
      label: 'synthetic-switch',
      elapsedMs: 1050,
      stableWindowMs: 1000,
      sampleCount: 3,
      samples: [],
      final: {
        frameNumber: 101,
        currentUpdateReadiness: {
          generation,
          ready: true,
          witness: {
            completedRenderRevision: generation + 10,
            updateSequenceAtPreRender: generation + 20,
            updateSequenceAtPostRender: generation + 20,
            updateGeneration: generation,
            generationAtPreRender: generation,
            generationAtPostRender: generation,
            updateReturnedBoolean: true,
            updateErrorName: null,
            collectionRevisionAtUpdateEntry: 1,
            collectionRevisionAtUpdateReturn: 1,
            collectionRevisionAtPreRender: 1,
            collectionRevisionAtPostRender: 1,
            collectionOwnerRevisionAtUpdateEntry: 0,
            collectionOwnerRevisionAtUpdateReturn: 0,
            collectionOwnerRevisionAtPreRender: 0,
            collectionOwnerRevisionAtPostRender: 0,
            updateOccurredForFrame: true,
          },
        },
      },
    };
    return {
      status: 'ready',
      measured,
      fromStackId,
      toStackId,
      switchOrigin: 'manual',
      setStackElapsedMs: 1.5,
      switchToSettledElapsedMs: 1051.5,
      sceneReadinessElapsedMs: sceneReadiness.elapsedMs,
      stableWindowMs: sceneReadiness.stableWindowMs,
      currentUpdateReadiness: sceneReadiness.final.currentUpdateReadiness,
      sceneReadiness: {
        status: 'ready',
        label: sceneReadiness.label,
        elapsedMs: sceneReadiness.elapsedMs,
        stableWindowMs: sceneReadiness.stableWindowMs,
        sampleCount: 3,
        final: sceneReadiness.final,
      },
      before,
      afterSetStack,
      afterReady,
      providerLoadDelta: 0,
      providerCacheReuseDelta: 0,
      providerLoadFailureDelta: 0,
      cacheEntryDelta: 0,
      pendingJobsAtSetStackCompletion: 0,
      pendingJobsAfterReadiness: 0,
      tileRequestsBefore: 0,
      tileRequestsAfter: toStackId === 'qa-terrain-relief' ? 1 : 0,
      tileRequestDelta: toStackId === 'qa-terrain-relief' ? 1 : 0,
      workerSubmittedDelta: 0,
      workerCompletedDelta: 0,
      workerPendingAfterReadiness: 0,
      estimatedTileBytesBefore: null,
      estimatedTileBytesAfter: null,
    };
  };
  return {
    schema: 'gev-terrain-picking-lifecycle/v1',
    status: 'passed',
    applicationCommit: 'a'.repeat(40),
    expectedApplicationCommit: 'a'.repeat(40),
    harnessCommit: 'a'.repeat(40),
    source: { commit: 'a'.repeat(40), cleanAtStart: true, cleanAtEnd: true },
    fixture: {
      externalProviderCalls: 0,
      terrainCoverage:
        'local custom heightmap tiles and ellipsoid reset; no network quantized-mesh tiles',
    },
    switchComparison: {
      status: 'passed',
      order: 'counterbalanced-relief-flat-and-flat-relief',
      timingBoundary:
        'setStack promise completion and the separate stable-scene wait are observed independently; switch-to-settled wall time runs from just before setStack through the final ownership snapshot and includes those snapshot costs, so stage values are not summed as end-to-end time',
      stableSceneGate:
        'existing waitForStableScene predicates: globe tiles loaded, latched DataSourceDisplay.ready, zero worker pending, stable camera and worker signature with advancing postRender for at least 1000 ms; current DataSourceDisplay.update true is now additionally required for comparison switches',
      checkpointScope:
        'active source, provider cache/load counters, local heightmap request count, worker counters, pending ownership, and controller tile-memory estimate',
      streamedTileMemoryBytes: null,
      streamedTileMemoryUnavailableReason:
        'fixture uses local single-tile imagery and a custom heightmap provider, not streamed 3D tiles',
      currentUpdateObserver: {
        available: true,
        installErrorName: null,
        entityCollectionCount: 4,
        requirement:
          'each switch waits for the existing DataSourceDisplay.update result true, bound to unchanged public EntityCollection contents, data-source ownership revision, exact collection identities, and that completed frame; no extra update calls',
        cleanupConfirmed: true,
        ownershipChanged: false,
        entityCollectionsMatch: true,
        finalState: {
          available: true,
          cleanupConfirmed: true,
          updateRestoreStatus: 'restored',
          generationCount: 14,
          updateCallCount: 24,
          collectionRevision: 1,
          collectionOwnerRevision: 0,
          ownershipChanged: false,
          entityCollectionsMatch: true,
          completedRenderRevision: 24,
          installErrorName: null,
        },
      },
    },
    warmup: flat,
    cycles: Array.from({ length: 5 }, (_, index) => {
      const flatFirst = index % 2 === 1;
      const start = flatFirst ? 'qa-terrain-relief' : 'qa-terrain-flat';
      const firstTarget = flatFirst ? 'qa-terrain-flat' : 'qa-terrain-relief';
      const secondTarget = flatFirst ? 'qa-terrain-relief' : 'qa-terrain-flat';
      const warmStart =
        index === 0
          ? null
          : makeSwitch(
              flatFirst ? 'qa-terrain-flat' : 'qa-terrain-relief',
              start,
              false,
            );
      const first = makeSwitch(start, firstTarget);
      const second = makeSwitch(firstTarget, secondTarget);
      return {
        cycle: index + 1,
        status: 'passed',
        order: flatFirst ? 'flat-relief' : 'relief-flat',
        warmStart,
        switches: [first, second],
        reliefSnapshot:
          firstTarget === 'qa-terrain-relief'
            ? first.afterReady
            : second.afterReady,
        flatSnapshot:
          firstTarget === 'qa-terrain-flat'
            ? first.afterReady
            : second.afterReady,
      };
    }),
    localTerrain: { tileRequests: 16 },
    firstTerrainTransition: {
      status: 'passed',
      beforeWorkerCounters: snapshot().workerCounters,
      afterWorkerCounters: snapshot({
        terrainKind: 'CustomHeightmapTerrainProvider',
        submitted: 10,
      }).workerCounters,
      submittedDelta: 2,
      completedDelta: 2,
      tileRequestsBefore: 0,
      tileRequestsAfter: 1,
      initialSceneAndCableWorkerActivity: {
        scope: 'fixture startup baseline',
        atInitialReadiness: snapshot().workerCounters,
        beforeTerrainSwitch: snapshot().workerCounters,
      },
    },
    staleTerrainReplacement: {
      status: 'passed',
      delayedSignalAborted: false,
      selectedStack: 'qa-terrain-relief',
    },
    destroyLateTerrain: {
      status: 'passed',
      signalAborted: true,
      fixtureOwnedDisposalHookCalledOnce: true,
      disposalScope:
        'fixture-owned hook only; this Cesium EllipsoidTerrainProvider has no native destroy method',
    },
    initialPick: { status: 'passed', pickedEntityId: 'qa-cable-1' },
    selectionLifecycle: {
      status: 'passed',
      completedReenablePicks: 3,
      stalePickAccepted: false,
    },
    fixtureCleanup: {
      status: 'passed',
      viewerDestroyed: true,
      final: {
        cables: { listeners: 0, dataSources: 0, cacheEntries: 0 },
        map: { pendingJobs: 0, cacheEntries: 0, imageryLayers: 0 },
      },
    },
    cleanup: {
      pageClosed: true,
      browserClose: { closeCompleted: true, forcedProcessTermination: false },
      serverClosed: true,
    },
  };
}

test('real observer publication satisfies the report contract before and after later lifecycle work', () => {
  const report = validReport();
  const collections = [new Cesium.EntityCollection()];
  let currentCollections = collections;
  const scene = {
    preRender: new Cesium.Event(),
    postRender: new Cesium.Event(),
  };
  const display = { update: () => true };
  const observer = installTerrainCurrentUpdateReadinessObserver({
    dataSourceDisplay: display,
    scene,
    entityCollections: collections,
    getCurrentEntityCollections: () => currentCollections,
  });
  for (let generation = 0; generation < 14; generation++) {
    observer.beginGeneration();
    display.update();
    scene.preRender.raiseEvent();
    scene.postRender.raiseEvent();
  }
  const metadata = {
    available: observer.available,
    installErrorName: observer.installErrorName,
    entityCollectionCount: collections.length,
    requirement: report.switchComparison.currentUpdateObserver.requirement,
  };
  report.switchComparison.currentUpdateObserver =
    finalizeTerrainCurrentUpdateObservation(observer, metadata);
  assert.equal(validateTerrainPickingLifecycleReport(report).status, 'passed');
  currentCollections = [];
  report.switchComparison.currentUpdateObserver =
    finalizeTerrainCurrentUpdateObservation(observer, metadata);
  assert.equal(validateTerrainPickingLifecycleReport(report).status, 'passed');
  delete report.switchComparison.currentUpdateObserver.entityCollectionsMatch;
  assert.throws(
    () => validateTerrainPickingLifecycleReport(report),
    /map-switch evidence/,
  );
});

test('terrain lifecycle CLI accepts only bounded local fixture inputs', () => {
  assert.deepEqual(
    parseTerrainPickingLifecycleArgs([
      '--cycles',
      '4',
      '--drain-ms',
      '9000',
      '--out',
      'qa-artifacts/run.json',
    ]),
    {
      out: 'qa-artifacts/run.json',
      cycles: 4,
      drainMs: 9000,
    },
  );
  for (const args of [
    ['--cycles', '11'],
    ['--drain-ms', '10001'],
    ['--unknown', 'value'],
  ])
    assert.throws(() => parseTerrainPickingLifecycleArgs(args));
});

test('fixture terrain and imagery providers match the installed Cesium constructors', () => {
  const heights = new Float32Array(16 * 16);
  const terrain = new Cesium.CustomHeightmapTerrainProvider({
    width: 16,
    height: 16,
    callback: () => heights,
  });
  assert.equal(terrain.constructor.name, 'CustomHeightmapTerrainProvider');
  assert.equal(typeof terrain.requestTileGeometry, 'function');
  const imagery = new Cesium.SingleTileImageryProvider({
    url: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEUlEQVQImWNwSGj4D8IMMAYAR7QIfd+vnL0AAAAASUVORK5CYII=',
    tileWidth: 2,
    tileHeight: 2,
  });
  assert.equal(imagery.constructor.name, 'SingleTileImageryProvider');
  assert.equal(imagery.tileWidth, 2);
  assert.equal(imagery.tileHeight, 2);
});

test('real local terrain and selection lifecycle report validates as a complete bounded result', () => {
  assert.deepEqual(validateTerrainPickingLifecycleReport(validReport()), {
    status: 'passed',
    cycles: 5,
    switchTransitions: 10,
    terrainTileRequests: 16,
    terrainTransitionWorkerSubmissions: 2,
    terrainTransitionWorkerCompletions: 2,
    selectionReenablePicks: 3,
    applicationCommit: 'a'.repeat(40),
  });
});

test('validator rejects missing cycles, unfinished workers, stale selection, or incomplete cleanup', () => {
  const missing = validReport();
  missing.cycles.pop();
  assert.throws(() => validateTerrainPickingLifecycleReport(missing));

  const duplicateCycle = validReport();
  duplicateCycle.cycles[4].cycle = 4;
  assert.throws(() => validateTerrainPickingLifecycleReport(duplicateCycle));

  const pending = validReport();
  pending.cycles[0].reliefSnapshot.workerCounters.pending = 1;
  pending.cycles[0].reliefSnapshot.workerCounters.workers[0].pending = 1;
  pending.cycles[0].reliefSnapshot.workerCounters.workers[0].completed = 7;
  assert.throws(() => validateTerrainPickingLifecycleReport(pending));

  const stale = validReport();
  stale.selectionLifecycle.stalePickAccepted = true;
  assert.throws(() => validateTerrainPickingLifecycleReport(stale));

  const cleanup = validReport();
  cleanup.fixtureCleanup.viewerDestroyed = false;
  assert.throws(() => validateTerrainPickingLifecycleReport(cleanup));
});

test('validator fails closed on external requests and malformed terrain evidence', () => {
  const external = validReport();
  external.fixture.externalProviderCalls = 1;
  assert.throws(() => validateTerrainPickingLifecycleReport(external));

  const noTiles = validReport();
  noTiles.localTerrain.tileRequests = 0;
  assert.throws(() => validateTerrainPickingLifecycleReport(noTiles));

  const badCounters = validReport();
  badCounters.warmup.workerCounters.overflow = true;
  assert.throws(() => validateTerrainPickingLifecycleReport(badCounters));

  const noTransitionWork = validReport();
  noTransitionWork.firstTerrainTransition.submittedDelta = 0;
  assert.throws(() => validateTerrainPickingLifecycleReport(noTransitionWork));

  const fabricatedCompletion = validReport();
  fabricatedCompletion.firstTerrainTransition.completedDelta = 3;
  assert.throws(() =>
    validateTerrainPickingLifecycleReport(fabricatedCompletion),
  );
});

test('counterbalanced switch evidence separates activation, readiness and observed ownership', () => {
  const report = validReport();
  const result = validateTerrainPickingLifecycleReport(report);
  assert.equal(result.switchTransitions, 10);
  assert.equal(report.cycles[0].switches[0].fromStackId, 'qa-terrain-flat');
  assert.equal(report.cycles[0].switches[0].toStackId, 'qa-terrain-relief');
  assert.equal(report.cycles[1].switches[0].fromStackId, 'qa-terrain-relief');
  assert.equal(report.cycles[1].switches[0].toStackId, 'qa-terrain-flat');
  assert.equal(report.cycles[0].switches[0].setStackElapsedMs, 1.5);
  assert.equal(report.cycles[0].switches[0].sceneReadinessElapsedMs, 1050);
  assert.equal(report.cycles[0].switches[0].estimatedTileBytesAfter, null);
  assert.equal(report.switchComparison.streamedTileMemoryBytes, null);
});

test('switch validator rejects wrong order, owner, timing, counter deltas and fabricated memory', () => {
  const mutations = [
    (report) => {
      report.cycles[1].order = 'relief-flat';
    },
    (report) => {
      report.cycles[0].switches[0].afterReady.map.activeStackId =
        'qa-terrain-flat';
    },
    (report) => {
      report.cycles[0].switches[0].setStackElapsedMs = -1;
    },
    (report) => {
      report.cycles[0].switches[0].sceneReadinessElapsedMs =
        report.cycles[0].switches[0].setStackElapsedMs;
      report.cycles[0].switches[0].sceneReadiness.elapsedMs =
        report.cycles[0].switches[0].setStackElapsedMs;
    },
    (report) => {
      const row = report.cycles[0].switches[0];
      row.switchToSettledElapsedMs =
        row.setStackElapsedMs + row.sceneReadinessElapsedMs - 1;
    },
    (report) => {
      const row = report.cycles[0].switches[0];
      row.sceneReadinessElapsedMs = row.stableWindowMs - 1;
      row.sceneReadiness.elapsedMs = row.sceneReadinessElapsedMs;
    },
    (report) => {
      const row = report.cycles[0].switches[0];
      row.afterReady.map.providerLoadsStarted =
        row.before.map.providerLoadsStarted - 1;
      row.providerLoadDelta = -1;
    },
    (report) => {
      const row = report.cycles[0].switches[0];
      row.afterReady.map.providerCacheReuses =
        row.before.map.providerCacheReuses - 1;
      row.providerCacheReuseDelta = -1;
    },
    (report) => {
      report.cycles[0].switches[0].providerCacheReuseDelta = 9;
    },
    (report) => {
      report.cycles[0].switches[0].workerSubmittedDelta = 1;
    },
    (report) => {
      report.cycles[0].switches[0].tileRequestDelta = -1;
    },
    (report) => {
      report.cycles[0].switches[0].estimatedTileBytesAfter = 1234;
    },
    (report) => {
      report.switchComparison.streamedTileMemoryBytes = 0;
    },
    (report) => {
      report.cycles[2].warmStart = null;
    },
    (report) => {
      report.cycles[0].switches[0].currentUpdateReadiness.ready = false;
    },
    (report) => {
      report.cycles[0].switches[0].currentUpdateReadiness.witness.updateReturnedBoolean = false;
    },
    (report) => {
      report.switchComparison.currentUpdateObserver.cleanupConfirmed = false;
    },
    (report) => {
      report.switchComparison.currentUpdateObserver.finalState.updateRestoreStatus =
        'replaced-by-another-owner';
    },
  ];
  for (const mutate of mutations) {
    const report = validReport();
    mutate(report);
    assert.throws(() => validateTerrainPickingLifecycleReport(report));
  }
});

function fixtureResult(status = 'passed') {
  const report = validReport();
  report.initialReadiness = snapshot();
  report.initialReadiness.scene.renderer = {
    renderer: 'software test renderer',
  };
  report.cleanup = report.fixtureCleanup;
  delete report.fixtureCleanup;
  report.status = status;
  report.phase = 'first-heightmap-transition';
  report.currentObservation = {
    stage: 'first-heightmap-transition',
    workerCounters: snapshot().workerCounters,
    frameNumber: 100,
  };
  if (status !== 'passed') {
    report.error = 'synthetic local terrain failure';
    report.failedPhase = 'first-heightmap-transition';
  }
  return report;
}

function runnerDependencies({
  result = fixtureResult(),
  servedCommit = 'a'.repeat(40),
  navigationError = null,
  browserCloseError = null,
  failFinalWrite = false,
  completionError = null,
} = {}) {
  const state = {
    written: [],
    closed: { page: 0, browser: 0, server: 0 },
    failedWriteReport: null,
    cdpSessionDetached: 0,
  };
  const cdpSession = new EventEmitter();
  cdpSession.send = async () => {};
  cdpSession.detach = async () => {
    state.cdpSessionDetached++;
  };
  const page = {
    on() {},
    async setViewport() {},
    async createCDPSession() {
      return cdpSession;
    },
    async goto() {
      if (navigationError) throw navigationError;
    },
    async waitForSelector() {},
    async evaluate(fn) {
      const source = String(fn);
      if (
        source.includes('__terrainPickingLifecycleProgress') &&
        completionError
      )
        throw completionError;
      if (source.includes('__terrainPickingLifecycleProgress'))
        return {
          status: result?.status || 'running',
          phase: result?.phase || null,
        };
      if (source.includes('navigator.userAgent'))
        return 'Mozilla/5.0 Chrome/152.0.0.0';
      if (source.includes('__terrainPickingBuildIdentity'))
        return { applicationCommit: servedCommit, harnessCommit: servedCommit };
      if (source.includes('__terrainPickingLifecycleResult')) return result;
      return undefined;
    },
    async click() {},
    async waitForFunction() {},
    async close() {
      state.closed.page++;
    },
  };
  const browser = {
    async newPage() {
      return page;
    },
    async version() {
      return 'Chrome/152.0.0.0';
    },
  };
  return {
    state,
    deps: {
      createServer: async () => ({
        async listen() {},
        async close() {
          state.closed.server++;
        },
      }),
      launchBrowser: async () => browser,
      closeBrowser: async () => {
        state.closed.browser++;
        if (browserCloseError) throw browserCloseError;
        return { closeCompleted: true, forcedProcessTermination: false };
      },
      sourceIdentity: () => ({ commit: 'a'.repeat(40), cleanAtStart: true }),
      writeReport: async (_path, report) => {
        if (failFinalWrite && report.progress?.phase === 'complete') {
          state.failedWriteReport = report;
          throw new Error('synthetic final report write failure');
        }
        state.written.push(structuredClone(report));
      },
      readHostEnvironment: () => ({ platform: 'test', hosted: true }),
      readBrowserGraphicsInfo: async () => ({
        renderer: 'software test renderer',
      }),
      classifyRenderer: () => ({
        classification: 'software',
        eligibleForHardwareClaims: false,
      }),
    },
  };
}

test('runner preserves fixture identity, partial evidence, and owned cleanup', async () => {
  const success = runnerDependencies();
  const passed = await runTerrainPickingLifecycle({
    out: 'ignored.json',
    deps: success.deps,
  });
  assert.equal(passed.status, 'passed');
  assert.equal(passed.fixtureCleanup.viewerDestroyed, true);
  assert.equal(passed.cleanup.browserClose.closeCompleted, true);
  assert.equal(passed.cleanup.cdpSessionDetached, true);
  assert.deepEqual(success.state.closed, { page: 1, browser: 1, server: 1 });
  assert.equal(success.state.cdpSessionDetached, 1);

  const wrongBuild = runnerDependencies({
    servedCommit: 'b'.repeat(40),
    result: null,
  });
  await assert.rejects(
    runTerrainPickingLifecycle({ out: 'ignored.json', deps: wrongBuild.deps }),
    /Served fixture build identity/,
  );
  const wrongBuildReport = wrongBuild.state.written.at(-1);
  assert.equal(wrongBuildReport.status, 'failed');
  assert.equal(wrongBuildReport.applicationCommit, null);
  assert.equal(
    wrongBuildReport.servedBuildIdentity.applicationCommit,
    'b'.repeat(40),
  );
  assert.deepEqual(wrongBuild.state.closed, { page: 1, browser: 1, server: 1 });

  const failedFixture = runnerDependencies({ result: fixtureResult('failed') });
  await assert.rejects(
    runTerrainPickingLifecycle({
      out: 'ignored.json',
      deps: failedFixture.deps,
    }),
    /synthetic local terrain failure/,
  );
  const partial = failedFixture.state.written.at(-1);
  assert.equal(partial.status, 'failed');
  assert.equal(partial.failedPhase, 'first-heightmap-transition');
  assert.deepEqual(failedFixture.state.closed, {
    page: 1,
    browser: 1,
    server: 1,
  });

  const startup = runnerDependencies({
    navigationError: new Error('fixture navigation failed'),
  });
  await assert.rejects(
    runTerrainPickingLifecycle({ out: 'ignored.json', deps: startup.deps }),
    /fixture navigation failed/,
  );
  assert.equal(startup.state.written.at(-1).error, 'fixture navigation failed');
  assert.deepEqual(startup.state.closed, { page: 1, browser: 1, server: 1 });

  const closeFailure = runnerDependencies({
    browserCloseError: new Error('synthetic browser close failure'),
  });
  await assert.rejects(
    runTerrainPickingLifecycle({
      out: 'ignored.json',
      deps: closeFailure.deps,
    }),
    /synthetic browser close failure/,
  );
  assert.equal(closeFailure.state.closed.server, 1);
  assert.equal(closeFailure.state.written.at(-1).status, 'failed');

  const writeFailure = runnerDependencies({ failFinalWrite: true });
  await assert.rejects(
    runTerrainPickingLifecycle({
      out: 'ignored.json',
      deps: writeFailure.deps,
    }),
    /synthetic final report write failure/,
  );
  assert.equal(writeFailure.state.failedWriteReport.status, 'failed');
  assert.match(
    writeFailure.state.failedWriteReport.error,
    /Final evidence report write failed/,
  );

  const protocolError = new Error('Waiting failed', {
    cause: new Error('Protocol call exceeded configured bound'),
  });
  const waitFailure = runnerDependencies({ completionError: protocolError });
  await assert.rejects(
    runTerrainPickingLifecycle({ out: 'ignored.json', deps: waitFailure.deps }),
    /Waiting failed/,
  );
  const waitFailureReport = waitFailure.state.written.at(-1);
  assert.equal(waitFailureReport.errorDetails.name, 'Error');
  assert.equal(
    waitFailureReport.errorDetails.cause.message,
    'Protocol call exceeded configured bound',
  );
  assert.equal(waitFailureReport.progress.currentObservation.frameNumber, 100);
});

test('fixture completion uses repeated bounded synchronous status polls', async () => {
  let clock = 0;
  let polls = 0;
  const page = {
    async evaluate(fn) {
      polls++;
      if (String(fn).includes('__terrainPickingLifecycleProgress'))
        return { status: polls >= 3 ? 'passed' : 'running', phase: 'test' };
      return { status: 'passed', applicationCommit: 'a'.repeat(40) };
    },
    async waitForFunction() {
      throw new Error('Long remote-awaited wait must not be used.');
    },
  };
  const complete = await waitForTerrainFixtureCompletion(page, 1000, {
    pollIntervalMs: 100,
    now: () => clock,
    pause: async (ms) => {
      clock += ms;
    },
  });
  assert.equal(complete.progress.status, 'passed');
  assert.equal(complete.report.status, 'passed');
  assert.equal(polls, 4);
});

test('fixture completion retains last phase and observation when a bounded poll fails', async () => {
  let polls = 0;
  const page = {
    async evaluate(fn) {
      if (!String(fn).includes('__terrainPickingLifecycleProgress'))
        return null;
      polls++;
      if (polls === 1)
        return {
          status: 'running',
          phase: 'initial-local-terrain-and-entity-warmup',
          currentObservation: {
            frameNumber: 12,
            workerCounters: snapshot().workerCounters,
          },
        };
      throw new Error('bounded synchronous evaluation failed');
    },
  };
  await assert.rejects(
    waitForTerrainFixtureCompletion(page, 1000, {
      pollIntervalMs: 10,
      now: (() => {
        let time = 0;
        return () => time;
      })(),
      pause: async () => {},
    }),
    (error) => {
      assert.equal(
        error.fixtureProgress.phase,
        'initial-local-terrain-and-entity-warmup',
      );
      assert.equal(error.fixtureProgress.currentObservation.frameNumber, 12);
      return true;
    },
  );
});

test('raw CDP Fetch interception resolves worker requests without Network pairing', async () => {
  const client = new EventEmitter();
  const commands = [];
  client.send = async (method, params) => {
    commands.push({ method, params });
  };
  client.detach = async () => {};
  let externalRequests = 0;
  await installTerrainFixtureRequestInterception(
    { createCDPSession: async () => client },
    {
      origin: 'http://127.0.0.1:4174',
      onExternalRequest: () => externalRequests++,
    },
  );
  assert.deepEqual(commands[0], {
    method: 'Fetch.enable',
    params: { patterns: [{ urlPattern: '*' }] },
  });

  client.emit('Fetch.requestPaused', {
    requestId: 'worker-request-without-network-event',
    request: {
      url: 'http://127.0.0.1:4174/assets/terrain-worker.js',
      method: 'GET',
      postData: null,
    },
  });
  for (let attempt = 0; attempt < 10 && commands.length < 2; attempt++)
    await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(commands[1], {
    method: 'Fetch.continueRequest',
    params: { requestId: 'worker-request-without-network-event' },
  });
  assert.equal(externalRequests, 0);
  assert.equal(client.listenerCount('Network.requestWillBeSent'), 0);

  client.emit('Fetch.requestPaused', {
    requestId: 'external-worker-request',
    request: {
      url: 'https://example.invalid/terrain-worker.js',
      method: 'GET',
      postData: null,
    },
  });
  for (let attempt = 0; attempt < 10 && commands.length < 3; attempt++)
    await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(commands[2], {
    method: 'Fetch.failRequest',
    params: {
      requestId: 'external-worker-request',
      errorReason: 'BlockedByClient',
    },
  });
  assert.equal(externalRequests, 1);
});
