import assert from 'node:assert/strict';
import test from 'node:test';
import {
  resolveWeatherIdleDiagnosticContract,
  observeWeatherPhaseRequests,
  summarizeWeatherIdleDiagnostic,
  WEATHER_IDLE_DIAGNOSTIC_INELIGIBLE_REASON,
} from './weatherIdleDiagnostic.mjs';

const BASE = {
  enabled: true,
  workloadId: 'austin-weather-effects-phased-v2',
  warmupMs: 30_000,
  seconds: 60,
  runs: 1,
};

test('visible wind probe is restricted to a post-measurement idle diagnostic', () => {
  for (const options of [
    { visibleWindProbe: true },
    { ...BASE, enabled: false, visibleWindProbe: true },
    { ...BASE, otherWeatherDiagnostic: true, visibleWindProbe: true },
    { ...BASE, runs: 5, visibleWindProbe: true },
  ])
    assert.throws(
      () => resolveWeatherIdleDiagnosticContract(options),
      TypeError,
    );
  const result = resolveWeatherIdleDiagnosticContract({
    ...BASE,
    visibleWindProbe: true,
  });
  assert.equal(result.visibleWindProbe, 'after-measurement-only');
  assert.equal(result.performanceAcceptanceEligible, false);
  assert.deepEqual(result.scenarios, ['idle']);
});

test('weather idle diagnostic is exact-duration and explicitly ineligible', () => {
  assert.deepEqual(resolveWeatherIdleDiagnosticContract(BASE), {
    mode: 'idle-render-demand-diagnostic',
    scenarios: ['idle'],
    diagnosticOnly: true,
    performanceAcceptanceEligible: false,
    ineligibleReason: WEATHER_IDLE_DIAGNOSTIC_INELIGIBLE_REASON,
  });
  assert.equal(
    resolveWeatherIdleDiagnosticContract({ ...BASE, enabled: false }),
    null,
  );
  for (const override of [
    { workloadId: 'infrastructure-datacenters' },
    { warmupMs: 1_000 },
    { seconds: 30 },
    { runs: 2 },
    { otherWeatherDiagnostic: true },
  ])
    assert.throws(
      () => resolveWeatherIdleDiagnosticContract({ ...BASE, ...override }),
      TypeError,
    );
});

test('phase observer timestamps request and settlement without replacing page methods', async () => {
  let clock = 10;
  const page = {
    evaluate: async (_fn, payload) =>
      payload.phase
        ? { observedAtElapsedMs: payload.phase.offsetMs + 4 }
        : undefined,
    waitForFunction: () => 'preserved',
  };
  const events = [];
  const observed = observeWeatherPhaseRequests(page, {
    now: () => clock++,
    onEvent: (event) => events.push(event),
  });
  const other = await observed.page.evaluate(() => null, { unrelated: true });
  const phase = await observed.page.evaluate(() => null, {
    phase: { id: 'early-history', offsetMs: 0 },
    fixtureSha256: 'a'.repeat(64),
  });
  assert.equal(other, undefined);
  assert.deepEqual(phase, { observedAtElapsedMs: 4 });
  assert.equal(observed.page.waitForFunction(), 'preserved');
  assert.equal(observed.events.length, 1);
  assert.equal(observed.events[0].status, 'fulfilled');
  assert.equal(observed.events[0].requestHostPerformanceNowMs, 10);
  assert.equal(observed.events[0].completionHostPerformanceNowMs, 11);
  assert.equal(observed.events[0].pageObservedAtElapsedMs, 4);
  assert.deepEqual(
    events.map((event) => event.status),
    ['pending', 'fulfilled'],
  );
});

test('idle summary binds long gaps to sampled render demand and preserves phase clocks', () => {
  const report = summarizeWeatherIdleDiagnostic({
    raw: {
      samplePeriodMs: 250,
      frameEventsObserved: 3,
      frameEvents: [
        {
          atMs: 0,
          governor: { mode: 'idle', holds: [], scheduledUpdates: [] },
        },
        {
          atMs: 1_500,
          governor: {
            mode: 'idle',
            holds: [],
            scheduledUpdates: ['satellites-periodic'],
          },
        },
        {
          atMs: 3_000,
          governor: {
            mode: 'continuous',
            holds: ['wind'],
            scheduledUpdates: [],
          },
        },
      ],
      governorSamplesObserved: 3,
      governorSamples: [
        {
          atMs: 300,
          governor: { mode: 'idle', holds: [], scheduledUpdates: [] },
        },
        {
          atMs: 700,
          governor: {
            mode: 'idle',
            holds: [],
            scheduledUpdates: ['satellites-periodic'],
          },
        },
        {
          atMs: 2_000,
          governor: {
            mode: 'continuous',
            holds: ['wind'],
            scheduledUpdates: [],
          },
        },
      ],
      snapshotReadCount: 9,
      snapshotReadTotalDurationMs: 0.9,
      snapshotReadMaxDurationMs: 0.2,
    },
    phaseObservations: {
      phases: [
        {
          id: 'early-history',
          scheduledAtMs: 0,
          observedAtElapsedMs: 2_000,
          sourceObservationTimes: ['2026-10-08T11:50:00Z'],
        },
      ],
    },
    phaseRequestEvents: [
      {
        phaseId: 'early-history',
        requestHostPerformanceNowMs: 100,
        completionHostPerformanceNowMs: 300,
        pageObservedAtElapsedMs: 2_000,
        status: 'fulfilled',
      },
    ],
  });
  assert.equal(report.diagnosticOnly, true);
  assert.equal(report.performanceAcceptanceEligible, false);
  assert.equal(report.gapsOverOneSecond.length, 2);
  assert.equal(
    report.gapsOverOneSecond[0].continuousDemandDuringGap,
    'observed-absent',
  );
  assert.equal(
    report.gapsOverOneSecond[1].continuousDemandDuringGap,
    'observed-present',
  );
  assert.deepEqual(report.phaseRequests[0], {
    phaseId: 'early-history',
    requestHostPerformanceNowMs: 100,
    completionHostPerformanceNowMs: 300,
    status: 'fulfilled',
    pageObservedCompletionElapsedMs: 2_000,
    errorName: null,
  });
  assert.equal(report.phases[0].pageObservedCompletionElapsedMs, 2_000);
  assert.equal(report.timingSemantics.noCrossClockOrderingClaim, true);
});

test('diagnostic sanitizes request labels and caps retained frame records', () => {
  const frames = Array.from({ length: 514 }, (_, index) => ({
    atMs: index * 2,
    governor: {
      mode: 'idle',
      holds: [],
      scheduledUpdates: [],
      recentRequests: [
        { reason: 'https://example.invalid/private?token=x', at: 1 },
      ],
    },
  }));
  const report = summarizeWeatherIdleDiagnostic({
    raw: { frameEventsObserved: frames.length, frameEvents: frames },
    phaseObservations: { phases: [] },
  });
  assert.equal(report.frameEvents.length, 512);
  assert.equal(report.instrumentation.frameEventsOmitted, 2);
  assert.equal(report.ownerChanges.length, 0);
  assert.equal(
    report.frameEvents[0].governor.recentRequests[0].reason,
    '[redacted]',
  );
  assert.ok(!JSON.stringify(report).includes('private?token'));
});

test('idle gaps retain bounded public wind state and distinguish GPU fade from unknown canvas visibility', () => {
  const gpuState = (heightFade, visibleCells) => ({
    renderMode: 'gpu-streamlines',
    paused: false,
    reducedMotion: false,
    hidden: false,
    framePending: true,
    gpu: {
      ready: true,
      heightFade,
      visibleCells,
      visibleVertexCount: visibleCells * 12,
      pathCount: 64,
      displayHeightMeters: 12_000,
    },
  });
  const report = summarizeWeatherIdleDiagnostic({
    raw: {
      frameEvents: [
        {
          atMs: 0,
          diagnosticsObservedAtMs: 2,
          governor: { mode: 'idle', holds: [], scheduledUpdates: [] },
          windRenderer: gpuState(0, 0),
        },
        {
          atMs: 1_500,
          diagnosticsObservedAtMs: 1_502,
          governor: { mode: 'idle', holds: [], scheduledUpdates: [] },
          windRenderer: gpuState(0, 0),
        },
        {
          atMs: 3_000,
          diagnosticsObservedAtMs: 3_002,
          governor: { mode: 'idle', holds: [], scheduledUpdates: [] },
          windRenderer: gpuState(0.5, 4),
        },
        {
          atMs: 4_500,
          diagnosticsObservedAtMs: 4_502,
          governor: { mode: 'idle', holds: [], scheduledUpdates: [] },
          windRenderer: {
            renderMode: 'canvas-fallback',
            paused: false,
            reducedMotion: false,
            hidden: false,
            framePending: true,
            gpu: null,
          },
        },
        {
          atMs: 6_000,
          diagnosticsObservedAtMs: 6_002,
          governor: { mode: 'idle', holds: [], scheduledUpdates: [] },
          windRenderer: {
            renderMode: 'canvas-fallback',
            paused: false,
            reducedMotion: false,
            hidden: false,
            framePending: true,
            gpu: null,
          },
        },
      ],
      governorSamples: [
        {
          atMs: 750,
          governor: { mode: 'idle', holds: [], scheduledUpdates: [] },
          windRenderer: gpuState(0, 0),
        },
        {
          atMs: 2_250,
          governor: { mode: 'idle', holds: [], scheduledUpdates: [] },
          windRenderer: gpuState(0.5, 4),
        },
      ],
    },
    phaseObservations: { phases: [] },
  });

  assert.equal(report.frameEvents[0].diagnosticsObservedAtMs, 2);
  assert.equal(
    report.frameEvents[0].windRenderer.gpu.displayHeightMeters,
    12_000,
  );
  assert.equal(
    report.governorSamples[0].windRenderer.renderMode,
    'gpu-streamlines',
  );
  assert.deepEqual(
    report.gapsOverOneSecond.map((gap) => gap.windRenderingAssessment),
    [
      'gpu-streamlines-fully-faded',
      'gpu-cells-eligible',
      'mixed-render-modes',
      'canvas-visibility-unknown',
    ],
  );
  assert.equal(
    report.requestAttribution.directWindSceneRequestRenderCaptured,
    false,
  );
  assert.match(report.requestAttribution.note, /scene\.requestRender directly/);
});

test('wind renderer diagnostics null invalid values, omit payload fields, and bound per-gap samples', () => {
  const frames = [
    {
      atMs: 0,
      governor: { mode: 'idle', holds: [], scheduledUpdates: [] },
      windRenderer: {
        renderMode: 'unexpected-mode',
        paused: 'false',
        reducedMotion: false,
        hidden: false,
        framePending: true,
        gpu: {
          ready: true,
          heightFade: 10,
          visibleCells: -1,
          visibleVertexCount: 2_000_000,
          pathCount: 4,
          displayHeightMeters: Number.POSITIVE_INFINITY,
        },
        url: 'https://example.invalid/?token=secret',
      },
    },
    {
      atMs: 2_000,
      governor: { mode: 'idle', holds: [], scheduledUpdates: [] },
      windRenderer: null,
    },
  ];
  const samples = Array.from({ length: 10 }, (_, index) => ({
    atMs: 100 + index * 100,
    governor: { mode: 'idle', holds: [], scheduledUpdates: [] },
    windRenderer: {
      renderMode: `unknown-${index}`,
      paused: false,
      reducedMotion: false,
      hidden: false,
      framePending: true,
      gpu: {
        ready: true,
        heightFade: 0.1,
        visibleCells: index + 1,
        visibleVertexCount: 12,
        pathCount: 8,
        displayHeightMeters: 12_000,
      },
    },
  }));
  const report = summarizeWeatherIdleDiagnostic({
    raw: { frameEvents: frames, governorSamples: samples },
    phaseObservations: { phases: [] },
  });

  assert.equal(report.frameEvents[0].windRenderer.renderMode, null);
  assert.equal(report.frameEvents[0].windRenderer.paused, null);
  assert.equal(report.frameEvents[0].windRenderer.gpu.heightFade, null);
  assert.equal(report.frameEvents[0].windRenderer.gpu.visibleCells, null);
  assert.equal(report.frameEvents[0].windRenderer.gpu.visibleVertexCount, null);
  assert.equal(report.frameEvents[1].windRenderer, null);
  assert.equal(report.gapsOverOneSecond[0].windRendererObservations.length, 8);
  assert.equal(report.gapsOverOneSecond[0].windRendererObservationsOmitted, 3);
  assert.equal(report.gapsOverOneSecond[0].windRenderingAssessment, 'unknown');
  assert.ok(!JSON.stringify(report).includes('example.invalid'));
  assert.ok(!JSON.stringify(report).includes('secret'));
});

test('missing or malformed wind observations cannot certify a fully faded interval', () => {
  const faded = {
    renderMode: 'gpu-streamlines',
    gpu: { heightFade: 0, visibleCells: 0 },
  };
  for (const incomplete of [
    null,
    { renderMode: null, gpu: faded.gpu },
    { renderMode: 'gpu-streamlines', gpu: null },
    { renderMode: 'gpu-streamlines', gpu: {} },
    { renderMode: 'gpu-streamlines', gpu: { heightFade: 0 } },
    { renderMode: 'gpu-streamlines', gpu: { visibleCells: 0 } },
  ]) {
    const report = summarizeWeatherIdleDiagnostic({
      raw: {
        frameEvents: [
          { atMs: 0, windRenderer: faded },
          { atMs: 2_000, windRenderer: faded },
        ],
        governorSamples: [{ atMs: 500, windRenderer: incomplete }],
      },
    });
    assert.equal(
      report.gapsOverOneSecond[0].windRenderingAssessment,
      'gpu-visibility-incomplete',
    );
  }
});
