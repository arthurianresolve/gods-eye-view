import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import * as Cesium from 'cesium';
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
  pending = 0,
  submitted = 8,
} = {}) {
  return {
    map: { cacheEntries: 4, pendingJobs: 0, imageryLayers: 1 },
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
    warmup: flat,
    cycles: Array.from({ length: 5 }, (_, index) => ({
      cycle: index + 1,
      status: 'passed',
      reliefSnapshot: relief,
      flatSnapshot: flat,
    })),
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
