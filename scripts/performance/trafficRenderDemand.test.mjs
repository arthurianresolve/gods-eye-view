import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import * as Cesium from 'cesium';
import { EventEmitter } from 'node:events';
import { installTrafficFixtureInterception } from './trafficFixtureInterception.mjs';
import {
  compareTrafficRenderDemandRuns,
  validateTrafficRenderDemandRun,
} from './trafficRenderDemand.mjs';

const BASE = '1'.repeat(40);
const CANDIDATE = '2'.repeat(40);
const HASH = 'a'.repeat(64);
const EPOCH = Date.UTC(2026, 9, 11, 12, 0, 0);
const RENDERER = 'ANGLE (NVIDIA GeForce RTX 4090)';
const names = [
  'populated',
  'fading-retained-dots',
  'jam-heatlines',
  'high-altitude-clear',
  'return-arrival',
];

function makeRun(mode, appCommit, frames) {
  return {
    schema: 'gev-traffic-render-demand/v1',
    status: 'passed',
    mode,
    appCommit,
    fixtureSurface: {
      kind: 'generated-local-3d-tiles-1.1-plane',
      glbSha256: HASH,
      tilesetJsonSha256: 'b'.repeat(64),
      noNetworkSource: true,
      renderedReadyContent: [{ ready: true, type: 'Model3DTileContent' }],
      renderedReadyContentPostRenderFrame: 2,
      renderedReadyContentOverflow: false,
    },
    environment: {
      cesiumVersion: '1.138.0',
      viewport: { width: 1024, height: 768, dpr: 1 },
      renderMode: true,
      msaaSamples: 4,
      clockShouldAnimate: false,
    },
    rendererEvidence: {
      renderer: RENDERER,
      classification: {
        kind: 'native-gpu',
        accelerationVerified: true,
      },
      browserGraphicsInfo: { featureStatus: { webgl: 'enabled' } },
    },
    phases: [
      {
        name: 'enabled-empty-high-altitude-idle',
        elapsedMs: 10_001,
        frames,
        holds: mode === 'candidate' ? [] : ['traffic'],
        governorMode: mode === 'candidate' ? 'idle' : 'continuous',
        requestRenderMode: mode === 'candidate',
      },
      {
        name: 'arrival-natural-frame',
        noCaptureWakeBeforeFirstPopulation: true,
        captureCountBefore: 0,
        sourceResolvedAt: 100,
        firstPopulationFrame: { at: 120, count: 2 },
      },
      {
        name: 'disable-pending-request',
        abortedBefore: true,
        countAfterLateResponse: 0,
        holdsAfterLateResponse: [],
      },
      {
        name: 'disable-reinitialize-destroy',
        holds: [],
        primitiveCount: 1,
        primitiveBaseline: 1,
        groundPrimitiveBaseline: 0,
        groundPrimitiveCount: 0,
      },
    ],
    captures: names.map((name, index) => {
      const requestedEpochMs = EPOCH + [250, 2090, 2700, 2700, 4250][index];
      return {
        name,
        width: 1024,
        height: 768,
        pngSha256: String(index + 1).padStart(64, '0'),
        snapshot: {
          stats: {
            count: index === 3 ? 0 : 2,
            heatLines: index === 2 ? 2 : 0,
            fadingVisibleDots: index === 1 ? 1 : 0,
          },
          dots:
            index === 3
              ? []
              : [
                  {
                    id: 'dot-a',
                    roadKey: 'jam-a',
                    x: 12,
                    y: 30,
                    pixelSize: 5,
                    color: [1, 0, 0, 1],
                  },
                  {
                    id: 'dot-b',
                    roadKey: 'jam-a',
                    x: 18,
                    y: 30,
                    pixelSize: 4,
                    color: [1, 0, 0, 1],
                  },
                ],
          renderSettings: {
            viewport: { width: 1024, height: 768, dpr: 1 },
            drawingBuffer: { width: 1024, height: 768 },
            renderer: RENDERER,
            maskedRenderer: 'WebGL Renderer',
            msaaSamples: 4,
            contextAttributes: {
              antialias: true,
              preserveDrawingBuffer: true,
            },
          },
          clock: {
            requestedEpochMs,
            currentTimeIso: new Date(requestedEpochMs).toISOString(),
            shouldAnimate: false,
          },
        },
      };
    }),
    retentionFade: {
      startEpochMs: EPOCH + 2000,
      midpointEpochMs: EPOCH + 2090,
      during: {
        populationPending: true,
        fetching: false,
        flowPending: 0,
        heightPending: false,
        surfaceRefining: false,
      },
      after: { populationPending: false },
    },
    heatlineVisualWitness: {
      sameRenderedDots: true,
      heatlinePngSha256: HASH,
      noHeatlineControlPngSha256: 'b'.repeat(64),
      noHeatlineControlImagePng: 'data:image/png;base64,AA==',
      noHeatlineControlSnapshot: {
        stats: {
          count: 2,
          heatLines: 0,
          fadingVisibleDots: 0,
          jamViz: 'none',
        },
        dots: [
          {
            id: 'dot-a',
            roadKey: 'jam-a',
            x: 12,
            y: 30,
            pixelSize: 5,
            color: [1, 0, 0, 1],
          },
          {
            id: 'dot-b',
            roadKey: 'jam-a',
            x: 18,
            y: 30,
            pixelSize: 4,
            color: [1, 0, 0, 1],
          },
        ],
        renderSettings: {
          viewport: { width: 1024, height: 768, dpr: 1 },
          drawingBuffer: { width: 1024, height: 768 },
          renderer: RENDERER,
          maskedRenderer: 'WebGL Renderer',
          msaaSamples: 4,
          contextAttributes: {
            antialias: true,
            preserveDrawingBuffer: true,
          },
        },
        clock: {
          requestedEpochMs: EPOCH + 2700,
          currentTimeIso: new Date(EPOCH + 2700).toISOString(),
          shouldAnimate: false,
        },
      },
      changedPixels: 12,
      heatlineParamsBefore: { jamViz: 'heatline', densityScale: 0.2 },
      controlParamsRequested: { jamViz: 'none', densityScale: 0.200000001 },
      controlParamsEffective: { jamViz: 'none', densityScale: 0.200000001 },
      restoredParams: { jamViz: 'heatline', densityScale: 0.2 },
      effectiveRestoredParams: { jamViz: 'heatline', densityScale: 0.2 },
      sameSnapshotStatsExceptHeatlineSettings: true,
    },
    cleanup: {
      viewerDestroyed: true,
      listenersRemoved: true,
      governorUninstalled: true,
    },
  };
}

test('traffic render-demand validator accepts a complete baseline/candidate pair', () => {
  const baseline = makeRun('baseline', BASE, 83);
  const candidate = makeRun('candidate', CANDIDATE, 1);
  assert.equal(validateTrafficRenderDemandRun(baseline).mode, 'baseline');
  assert.equal(validateTrafficRenderDemandRun(candidate).mode, 'candidate');
  const comparison = compareTrafficRenderDemandRuns(baseline, candidate, {
    baselineCommit: BASE,
    candidateCommit: CANDIDATE,
  });
  assert.equal(comparison.baselineIdleFrames, 83);
  assert.equal(comparison.candidateIdleFrames, 1);
  assert.equal(comparison.phases.length, 5);
});

test('traffic render-demand validator rejects idle excess, shortened idle, and non-discriminating baseline', () => {
  const candidate = makeRun('candidate', CANDIDATE, 0);
  candidate.phases[0].frames = 3;
  assert.throws(
    () => validateTrafficRenderDemandRun(candidate),
    /more than two/,
  );
  candidate.phases[0].frames = 0;
  candidate.phases[0].elapsedMs = 9_000;
  assert.throws(() => validateTrafficRenderDemandRun(candidate), /ten seconds/);
  candidate.phases[0].elapsedMs = 10_001;
  const baseline = makeRun('baseline', BASE, 2);
  assert.throws(
    () => validateTrafficRenderDemandRun(baseline),
    /continuous empty-idle/,
  );
});

test('traffic render-demand validator rejects missing population, heatlines, or fading evidence', () => {
  const candidate = makeRun('candidate', CANDIDATE, 0);
  candidate.captures[1].snapshot.stats.fadingVisibleDots = 0;
  assert.throws(
    () => validateTrafficRenderDemandRun(candidate),
    /visible fade/,
  );
  candidate.captures[1].snapshot.stats.fadingVisibleDots = 1;
  candidate.captures[2].snapshot.stats.heatLines = 0;
  assert.throws(
    () => validateTrafficRenderDemandRun(candidate),
    /no classified/,
  );
  candidate.captures[2].snapshot.stats.heatLines = 2;
  candidate.captures[4].snapshot.stats.count = 0;
  candidate.captures[4].snapshot.dots = [];
  assert.throws(
    () => validateTrafficRenderDemandRun(candidate),
    /empty in return-arrival/,
  );
});

test('traffic render-demand comparison rejects image, state, source, and cleanup mismatches', () => {
  const baseline = makeRun('baseline', BASE, 80);
  const candidate = makeRun('candidate', CANDIDATE, 0);
  candidate.captures[0].pngSha256 = HASH;
  assert.throws(
    () => compareTrafficRenderDemandRuns(baseline, candidate),
    /differs in populated/,
  );
  candidate.captures[0].pngSha256 = baseline.captures[0].pngSha256;
  candidate.phases[1].sourceResolvedAt = 200;
  assert.throws(
    () => validateTrafficRenderDemandRun(candidate),
    /natural frame/,
  );
  candidate.phases[1].sourceResolvedAt = 100;
  candidate.phases[2].holdsAfterLateResponse = ['traffic'];
  assert.throws(() => validateTrafficRenderDemandRun(candidate), /late source/);
  candidate.phases[2].holdsAfterLateResponse = [];
  candidate.cleanup.viewerDestroyed = false;
  assert.throws(() => validateTrafficRenderDemandRun(candidate), /cleanup/);
});

test('traffic render-demand validator binds exact commit and local surface identity', () => {
  const candidate = makeRun('candidate', CANDIDATE, 0);
  assert.throws(
    () => validateTrafficRenderDemandRun(candidate, { expectedCommit: BASE }),
    /commit mismatch/,
  );
  candidate.fixtureSurface.noNetworkSource = false;
  assert.throws(() => validateTrafficRenderDemandRun(candidate), /not a local/);
});

test('traffic evidence requires an observed ready surface frame, stable dot IDs, and frozen clock', () => {
  const candidate = makeRun('candidate', CANDIDATE, 0);
  candidate.fixtureSurface.renderedReadyContent = [];
  assert.throws(
    () => validateTrafficRenderDemandRun(candidate),
    /visible content/,
  );

  candidate.fixtureSurface.renderedReadyContent = [
    { ready: true, type: 'Model3DTileContent' },
  ];
  candidate.fixtureSurface.renderedReadyContentPostRenderFrame = 0;
  assert.throws(
    () => validateTrafficRenderDemandRun(candidate),
    /visible content/,
  );
  candidate.fixtureSurface.renderedReadyContentPostRenderFrame = 2;
  candidate.fixtureSurface.renderedReadyContentOverflow = true;
  assert.throws(
    () => validateTrafficRenderDemandRun(candidate),
    /visible content/,
  );
  candidate.fixtureSurface.renderedReadyContentOverflow = false;
  candidate.captures[0].snapshot.dots[0].id = '';
  assert.throws(
    () => validateTrafficRenderDemandRun(candidate),
    /rendered dot evidence/,
  );

  candidate.captures[0].snapshot.dots[0].id = 'dot-a';
  candidate.captures[0].snapshot.clock.shouldAnimate = true;
  assert.throws(
    () => validateTrafficRenderDemandRun(candidate),
    /clock was not frozen/,
  );

  candidate.captures[0].snapshot.clock.shouldAnimate = false;
  candidate.captures[0].snapshot.clock.currentTimeIso = new Date(
    EPOCH + 251,
  ).toISOString();
  assert.throws(
    () => validateTrafficRenderDemandRun(candidate),
    /clock was not frozen/,
  );
});

test('traffic comparison rejects unverified acceleration and changed heatline-control dots', () => {
  const candidate = makeRun('candidate', CANDIDATE, 0);
  candidate.rendererEvidence.classification.accelerationVerified = false;
  assert.throws(
    () => validateTrafficRenderDemandRun(candidate),
    /accelerated WebGL rendering/,
  );
  candidate.rendererEvidence.classification.accelerationVerified = true;
  candidate.heatlineVisualWitness.noHeatlineControlSnapshot.dots[0].color[3] = 0.5;
  assert.throws(
    () => validateTrafficRenderDemandRun(candidate),
    /changed dot identity, projection, size or style/,
  );
});

test('heatline control proves visible pixels change and parameters restore', () => {
  const candidate = makeRun('candidate', CANDIDATE, 0);
  candidate.heatlineVisualWitness.sameRenderedDots = false;
  assert.throws(
    () => validateTrafficRenderDemandRun(candidate),
    /visible heatline-only pixel control/,
  );
  candidate.heatlineVisualWitness.sameRenderedDots = true;
  candidate.heatlineVisualWitness.effectiveRestoredParams.densityScale = 0.3;
  assert.throws(
    () => validateTrafficRenderDemandRun(candidate),
    /parameters were not auditable or restored/,
  );
  candidate.heatlineVisualWitness.effectiveRestoredParams.densityScale = 0.2;
  assert.equal(validateTrafficRenderDemandRun(candidate).mode, 'candidate');
});

// Execute the fixture's real run/cleanup path, with only construction replaced.
// This catches teardown references that node --check cannot detect.
async function runBrokenFixture(Viewer) {
  const source = (
    await readFile(
      new URL('../fixtures/traffic-render-demand.mjs', import.meta.url),
      'utf8',
    )
  ).replaceAll('\r\n', '\n');
  const start = source.indexOf('async function run() {');
  const end = source.indexOf('\nrun()\n', start);
  assert.ok(start >= 0 && end > start);
  const dateNow = () => 123;
  const random = () => 0.5;
  const context = {
    Cesium: { Viewer, EllipsoidTerrainProvider: class {} },
    Date: { now: dateNow },
    Math: Object.assign(Object.create(Math), { random }),
    performance: { now: () => 42 },
    FIXTURE_EPOCH: EPOCH,
    MODE: 'baseline',
    APP_COMMIT: BASE,
    CASES: names,
    logicalNow: EPOCH,
    viewer: null,
    layer: null,
    disposed: false,
    sourceCalls: [],
    listenersRemoved: false,
    removeTileVisibleListener: null,
    getRenderGovernorDiagnostics: () => ({ installed: false }),
    report: null,
  };
  vm.createContext(context);
  const run = vm.runInContext(source.slice(start, end) + '\nrun', context);
  let failure;
  try {
    await run();
  } catch (error) {
    failure = error;
  }
  assert.equal(context.Date.now, dateNow);
  assert.equal(context.Math.random, random);
  assert.equal(context.disposed, true);
  return { failure, report: context.report };
}

test('fixture construction failure survives cleanup and restores clock/random', async () => {
  const original = new Error('injected viewer construction failure');
  const result = await runBrokenFixture(
    class {
      constructor() {
        throw original;
      }
    },
  );
  assert.equal(result.failure, original);
  assert.equal(result.report.cleanup.viewerDestroyed, true);
  assert.equal(result.report.cleanup.governorUninstalled, true);
  assert.equal(result.report.cleanup.errors.length, 0);
});

test('fixture disposal failure is recorded without hiding the setup error', async () => {
  const original = new Error('injected scene setup failure');
  let destructionAttempted = false;
  const result = await runBrokenFixture(
    class {
      set resolutionScale(value) {
        throw original;
      }
      isDestroyed() {
        return false;
      }
      destroy() {
        destructionAttempted = true;
        throw new Error('injected disposal failure');
      }
    },
  );
  assert.equal(result.failure, original);
  assert.equal(destructionAttempted, true);
  assert.equal(result.report.cleanup.viewerDestroyed, false);
  assert.equal(result.report.cleanup.errors[0].owner, 'viewer');
  assert.equal(
    result.report.cleanup.errors[0].message,
    'injected disposal failure',
  );
});

test('failed setup reports its cause before missing renderer evidence', () => {
  assert.throws(
    () =>
      validateTrafficRenderDemandRun({
        schema: 'gev-traffic-render-demand/v1',
        mode: 'baseline',
        status: 'failed',
        error: { message: 'Local fixture tiles did not settle' },
        captures: [],
      }),
    /Traffic fixture failed: Local fixture tiles did not settle/,
  );
});

test('heatline control rejects leftover geometry, a changed clock, and cleanup errors', () => {
  const run = makeRun('candidate', CANDIDATE, 0);
  run.heatlineVisualWitness.noHeatlineControlSnapshot.stats.heatLines = 1;
  assert.throws(() => validateTrafficRenderDemandRun(run), /did not remove/);
  run.heatlineVisualWitness.noHeatlineControlSnapshot.stats.heatLines = 0;
  run.heatlineVisualWitness.noHeatlineControlSnapshot.clock.requestedEpochMs++;
  assert.throws(
    () => validateTrafficRenderDemandRun(run),
    /unrelated rendered scene inputs/,
  );
  run.heatlineVisualWitness.noHeatlineControlSnapshot.clock.requestedEpochMs--;
  run.cleanup.errors = [{ owner: 'viewer', message: 'disposal failed' }];
  assert.throws(
    () => validateTrafficRenderDemandRun(run),
    /cleanup did not complete/,
  );
});

test('traffic teardown rejects retained primitives after owner destruction', () => {
  const run = makeRun('candidate', CANDIDATE, 0);
  const teardown = run.phases.find(
    (phase) => phase.name === 'disable-reinitialize-destroy',
  );
  teardown.primitiveCount++;
  assert.throws(
    () => validateTrafficRenderDemandRun(run),
    /cleanup evidence is incomplete/,
  );
});

test('retention fade requires clock advancement and completed retirement', () => {
  const run = makeRun('candidate', CANDIDATE, 0);
  run.retentionFade.midpointEpochMs = run.retentionFade.startEpochMs;
  assert.throws(
    () => validateTrafficRenderDemandRun(run),
    /controlled fixture clock/,
  );
  run.retentionFade.midpointEpochMs += 90;
  run.retentionFade.after.populationPending = true;
  assert.throws(
    () => validateTrafficRenderDemandRun(run),
    /controlled fixture clock/,
  );
});

test('traffic teardown rejects a leaked ground heatline primitive', () => {
  const run = makeRun('candidate', CANDIDATE, 0);
  run.phases.find((phase) => phase.name === 'disable-reinitialize-destroy')
    .groundPrimitiveCount++;
  assert.throws(
    () => validateTrafficRenderDemandRun(run),
    /cleanup evidence is incomplete/,
  );
});

test('traffic interception resolves unpaired geometry worker fetches and blocks external destinations', async () => {
  const session = new EventEmitter();
  const commands = [];
  session.send = async (method, params) => {
    commands.push({ method, params });
  };
  const evidence = {
    externalRequests: [],
    interceptionErrors: [],
    workerRequestsObserved: 0,
  };
  await installTrafficFixtureInterception(
    { createCDPSession: async () => session },
    'http://127.0.0.1:4174',
    evidence,
  );
  const pause = async (requestId, url) => {
    const count = commands.length;
    session.emit('Fetch.requestPaused', {
      requestId,
      request: { url, method: 'GET' },
    });
    for (let i = 0; i < 10 && commands.length === count; i++)
      await new Promise((resolve) => setImmediate(resolve));
    return commands.at(-1);
  };
  assert.deepEqual(
    await pause(
      'unpaired-geometry',
      'http://127.0.0.1:4174/cesium/Workers/createGroundPolylineGeometry.js',
    ),
    {
      method: 'Fetch.continueRequest',
      params: { requestId: 'unpaired-geometry' },
    },
  );
  assert.equal(session.listenerCount('Network.requestWillBeSent'), 0);
  assert.equal(evidence.workerRequestsObserved, 1);
  assert.deepEqual(
    await pause(
      'external-geometry',
      'https://provider.invalid/geometry.js?credential=must-not-retain',
    ),
    {
      method: 'Fetch.failRequest',
      params: {
        requestId: 'external-geometry',
        errorReason: 'BlockedByClient',
      },
    },
  );
  assert.deepEqual(evidence.externalRequests, ['https://provider.invalid']);
  assert.deepEqual(evidence.interceptionErrors, []);
});

test('traffic interception releases its session after setup failure', async () => {
  let detached = false;
  const session = new EventEmitter();
  session.send = async () => {
    throw Error('injected setup failure');
  };
  session.detach = async () => {
    detached = true;
  };
  await assert.rejects(
    installTrafficFixtureInterception(
      { createCDPSession: async () => session },
      'http://localhost',
      {
        externalRequests: [],
        interceptionErrors: [],
        workerRequestsObserved: 0,
      },
    ),
    /injected setup failure/,
  );
  assert.equal(detached, true);
});

test('fixture serializes real Julian dates at its integer millisecond precision', async () => {
  const source = await readFile(
    new URL('../fixtures/traffic-render-demand.mjs', import.meta.url),
    'utf8',
  );
  const start = source.indexOf('function clockSnapshot() {');
  const end = source.indexOf('function projectedSnapshot()', start);
  assert.ok(start >= 0 && end > start);
  const scope = {
    Cesium,
    logicalNow: EPOCH,
    viewer: {
      clock: {
        currentTime: Cesium.JulianDate.fromDate(new Date(EPOCH)),
        shouldAnimate: false,
      },
    },
  };
  vm.createContext(scope);
  const snapshot = vm.runInContext(
    source.slice(start, end) + '\nclockSnapshot',
    scope,
  );
  for (const offset of [0, 90, 250, 2090, 2700, 4250]) {
    scope.logicalNow = EPOCH + offset;
    scope.viewer.clock.currentTime = Cesium.JulianDate.fromDate(
      new Date(scope.logicalNow),
    );
    const observed = snapshot();
    assert.equal(
      observed.currentTimeIso,
      new Date(scope.logicalNow).toISOString(),
    );
    assert.equal(Date.parse(observed.currentTimeIso), scope.logicalNow);
    assert.equal(observed.shouldAnimate, false);
  }
  scope.viewer.clock.currentTime = Cesium.JulianDate.addSeconds(
    scope.viewer.clock.currentTime,
    0.001,
    new Cesium.JulianDate(),
  );
  assert.notEqual(
    Date.parse(snapshot().currentTimeIso),
    scope.logicalNow,
    'real clock drift must remain observable',
  );
});
