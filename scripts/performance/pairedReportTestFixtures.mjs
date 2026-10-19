import {
  createObservedInfrastructureComparisonContract,
  createObservedMapStreamingComparisonContract,
  createObservedWeatherEffectsComparisonContract,
} from './captureComparisonContract.mjs';
import { createWeatherEffectsWorkloadFixture } from './weatherEffectsWorkloadFixture.mjs';
import { createInfrastructureWorkloadFixture } from './infrastructureWorkloadFixture.mjs';

export const baselineCommit = 'a'.repeat(40);
export const candidateCommit = 'b'.repeat(40);
export const harnessCommit = 'c'.repeat(40);
export const fixtureHash = 'd'.repeat(64);
export const scenarios = [
  'idle',
  'scripted-motion',
  'selected-aircraft-tracking',
];
export const startPose = {
  position: { x: 1, y: 2, z: 3 },
  direction: { x: 0, y: 1, z: 0 },
  up: { x: 0, y: 0, z: 1 },
  transform: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
};
export const routes = {
  idle: {
    id: 'parked-v1',
    start: startPose,
    elapsedDurationMs: 60_000,
    motionDistanceM: 0,
  },
  'scripted-motion': {
    id: 'elapsed-move-right-v1',
    start: startPose,
    elapsedDurationMs: 60_000,
    motionDistanceM: 19200,
  },
  'selected-aircraft-tracking': {
    id: 'entity-follow-v1',
    fixtureId: 'synthetic-aircraft-ring-v1',
    fixtureSha256: fixtureHash,
    fixedTime: '2026-10-08T12:00:00.000Z',
    startEpochMs: Date.parse('2026-10-08T12:00:00.000Z') + 30_000,
    endEpochMs: Date.parse('2026-10-08T12:00:00.000Z') + 90_000,
    cesiumCurrentTimeStart: { dayNumber: 2_460_000, secondsOfDay: 1 },
    cesiumCurrentTimeEnd: { dayNumber: 2_460_000, secondsOfDay: 1 },
    cesiumCurrentTimeStartMs: Date.parse('2026-10-08T12:00:00.000Z'),
    cesiumCurrentTimeEndMs: Date.parse('2026-10-08T12:00:00.000Z'),
    cesiumClockShouldAnimateStart: false,
    cesiumClockShouldAnimateEnd: false,
    cesiumClockStepStart: 0,
    cesiumClockStepEnd: 0,
    elapsedDurationMs: 60_000,
    warmupMs: 30_000,
    measurementMs: 60_000,
    motionDistanceM: 100,
    observedTargetDistanceM: 100,
    selectedIdentity: 'flights:000001',
    selectedIdentityEnd: 'flights:000001',
    trajectoryId: 'synthetic-aircraft-ring-v1:flights:000001',
    sourceAgeStartMs: 30_000,
    sourceAgeEndMs: 90_000,
    sourceLastUpdateStart: Date.parse('2026-10-08T12:00:00.000Z'),
    sourceLastUpdateEnd: Date.parse('2026-10-08T12:00:00.000Z'),
    sourceCountStart: 2500,
    sourceCountEnd: 2500,
    sourceFreshness: { start: 'current', end: 'current' },
    targetStart: { longitudeDeg: -97.7, latitudeDeg: 30.2, heightM: 1000 },
    targetEnd: { longitudeDeg: -97.6, latitudeDeg: 30.3, heightM: 1000 },
    start: {
      ...startPose,
      dateEpochMs: Date.parse('2026-10-08T12:00:30.000Z'),
    },
    end: { ...startPose, dateEpochMs: Date.parse('2026-10-08T12:01:30.000Z') },
  },
};
{
  const route = routes['selected-aircraft-tracking'];
  const radians = Math.PI / 180;
  const latitude1 = route.targetStart.latitudeDeg * radians;
  const latitude2 = route.targetEnd.latitudeDeg * radians;
  const deltaLatitude = latitude2 - latitude1;
  const deltaLongitude =
    (route.targetEnd.longitudeDeg - route.targetStart.longitudeDeg) * radians;
  const haversine =
    Math.sin(deltaLatitude / 2) ** 2 +
    Math.cos(latitude1) *
      Math.cos(latitude2) *
      Math.sin(deltaLongitude / 2) ** 2;
  route.motionDistanceM = route.observedTargetDistanceM =
    2 * 6_371_000 * Math.asin(Math.sqrt(haversine));
}
export const populations = [
  { id: 'flights', enabled: true, count: 2500 },
  { id: 'local-datacenters', enabled: true, count: 4362 },
  { id: 'local-dams', enabled: true, count: 716 },
];

export function makeReport(
  commit,
  motionP95 = [40, 42, 39, 41, 43],
  trackingP95 = [50, 48, 52, 49, 51],
) {
  const point = () => ({
    settings: {
      qualityMode: 'manual',
      densityPct: 75,
      detectionMode: 'DENSE',
      resolutionScale: 1,
      msaaSamples: 4,
      antialias: false,
      fxaa: true,
      visualState: {
        style: 'normal',
        styleParams: {},
        detection: { density: 75 },
      },
    },
    environment: {
      appCommit: commit,
      renderer: 'Intel UHD 620',
      viewport: { width: 1440, height: 900, dpr: 1 },
      drawingBuffer: { width: 1440, height: 900 },
      layers: structuredClone(populations),
    },
    focused: true,
    visible: true,
  });
  const captures = [];
  for (const scenario of scenarios) {
    for (let run = 1; run <= 5; run += 1) {
      const p95 =
        scenario === 'idle'
          ? null
          : scenario === 'scripted-motion'
            ? motionP95[run - 1]
            : trackingP95[run - 1];
      const frameCount = p95 == null ? 0 : 100;
      captures.push({
        scenario,
        run,
        durationMs: 60_005,
        frameCount,
        frameIntervalMs: { p50: p95, p95, max: p95, samples: frameCount },
        conditions: { before: point(), after: point() },
        foregroundThroughout: true,
        cameraPath: structuredClone(routes[scenario]),
      });
    }
  }
  return {
    schema: 'gev-performance-capture/v1',
    url: 'http://localhost:4173/austin',
    source: {
      appCommit: commit,
      appWorktreeState: 'clean',
      harnessCommit,
      harnessDirtyWorktree: false,
      reason: null,
      buildProvenance: {
        schema: 'gev-capture-build-provenance/v1',
        status: 'verified-local-build-and-served-assets-before-and-after',
        scope:
          'unsigned local build and served-byte checks; browser response bytes are not independently attested',
        receiptSha256: (commit === baselineCommit ? '1' : '2').repeat(64),
        appCommit: commit,
        harnessCommit,
        buildRecipe: {
          nodeVersion: 'v24.0.0',
          npmVersion: '11.0.0',
          dependencyInstall: 'npm ci --no-audit --no-fund',
          buildInvocation:
            'npm run build -- --outDir <new-empty-task-owned-directory>',
          packageJsonSha256: '3'.repeat(64),
          packageLockSha256: '4'.repeat(64),
          buildScriptSha256: '5'.repeat(64),
        },
        before: {
          schema: 'gev-served-assets-verification/v1',
          status: 'served-assets-match',
          receiptSha256: (commit === baselineCommit ? '1' : '2').repeat(64),
          assetCount: 10,
          totalAssetBytes: 1_000_000,
        },
        after: {
          schema: 'gev-served-assets-verification/v1',
          status: 'served-assets-match',
          receiptSha256: (commit === baselineCommit ? '1' : '2').repeat(64),
          assetCount: 10,
          totalAssetBytes: 1_000_000,
        },
        pageAssetAudit: {
          scriptRequestCount: 1,
          loadedAssetPaths: ['assets/app.js'],
          unexpectedAssetPaths: [],
        },
      },
    },
    comparisonContract: {
      schema: 'gev-performance-comparison-contract/v1',
      workloadId: 'dense-investigation',
      fixture: {
        id: 'synthetic-aircraft-ring-v1',
        sha256: fixtureHash,
        fixedTime: '2026-10-08T12:00:00.000Z',
      },
      fixtureDelivery: {
        schema: 'gev-fixture-delivery-observation/v1',
        status: 'observed',
        method: 'controlled-provider-boundary-v1',
        fixtureSha256: fixtureHash,
        fixedTime: '2026-10-08T12:00:00.000Z',
        observedFlightsCount: 2500,
      },
      routes: structuredClone(routes),
      browser: { name: 'Chrome', version: '152.0.7977.75' },
      rendering: {
        viewport: { width: 1440, height: 900, dpr: 1 },
        drawingBuffer: { width: 1440, height: 900 },
      },
      populations: structuredClone(populations),
      visual: { qualityMode: 'manual', detectionMode: 'DENSE', densityPct: 75 },
      objectiveScenarios: ['scripted-motion', 'selected-aircraft-tracking'],
    },
    comparisonEligible: true,
    fixtureDelivery: {
      schema: 'gev-fixture-delivery-observation/v1',
      status: 'observed',
      method: 'controlled-provider-boundary-v1',
      fixtureSha256: fixtureHash,
      fixedTime: '2026-10-08T12:00:00.000Z',
      fulfilledResponseCount: 15,
      observedFlightsCount: 2500,
    },
    environment: {
      appCommit: commit,
      userAgent: 'Mozilla/5.0 Chrome/152.0.7977.75',
      platform: 'Win32',
      renderer: 'Intel UHD 620',
      vendor: 'Intel',
      viewport: { width: 1440, height: 900, dpr: 1 },
      drawingBuffer: { width: 1440, height: 900 },
      layers: structuredClone(populations),
    },
    workload: {
      warmupMs: 30_000,
      durationPerSampleMs: 60_000,
      runsPerScenario: 5,
      scenarios: [...scenarios],
      fixture: {
        id: 'synthetic-aircraft-ring-v1',
        sha256: fixtureHash,
        fixedTime: '2026-10-08T12:00:00.000Z',
        count: 2500,
        seed: 1,
      },
      mixedLayers: ['local-datacenters', 'local-dams'],
      qualityMode: 'manual',
      expectedDensityPct: 75,
      detectionMode: 'DENSE',
      injectedDelayMs: 0,
      populationStableAcrossSamples: true,
      cameraPathStableAcrossSamples: true,
      cameraPath:
        'elapsed-move-right-v1 for scripted motion; parked-v1 for idle/tracking',
    },
    captures,
  };
}

/** Build a paired fixture from the registered five-run map-streaming contract. */
export function makeMapReport(
  commit,
  readinessMs = 20,
  { includeFrames = false, motionP95 } = {},
) {
  const fixture = {
    id: 'austin-map-streaming-synthetic-v5',
    manifestSha256: 'f'.repeat(64),
  };
  const route = {
    id: 'austin-map-rightward-v1',
    durationMs: 60_000,
    startupFlightDelayMs: 500,
    warmupMs: 30_000,
    moveRightMetersPerSecond: 120,
    headingRadians: 0,
    pitchRadians: -Math.PI / 2,
    declaredBounds: {
      west: -97.82,
      south: 30.2,
      east: -97.58,
      north: 30.34,
    },
  };
  const settings = {
    qualityMode: 'manual',
    densityPct: 75,
    detectionMode: 'DENSE',
    resolutionScale: 1,
    msaaSamples: 4,
    antialias: false,
    fxaa: true,
  };
  const delivery = {
    schema: 'gev-map-streaming-delivery/v1',
    status: 'observed',
    fixtureId: fixture.id,
    manifestSha256: fixture.manifestSha256,
    cleanupConfirmed: true,
    assets: [
      {
        path: 'tileset/tileset.json',
        sha256: 'a'.repeat(64),
        byteLength: 10,
      },
    ],
  };
  const journeys = Array.from({ length: 5 }, (_, index) => ({
    run: index + 1,
    route,
    settingsBefore: settings,
    settingsAfter: settings,
    transitions: [
      {
        stackId: 'photoreal',
        scheduledAtMs: 0,
        actualStartMs: 0,
        settledAtMs: 0,
      },
      {
        stackId: 'esri-imagery',
        scheduledAtMs: 15_000,
        actualStartMs: 15_000,
        settledAtMs: 15_000 + readinessMs,
      },
      {
        stackId: 'osm',
        scheduledAtMs: 30_000,
        actualStartMs: 30_000,
        settledAtMs: 30_000 + readinessMs,
      },
      {
        stackId: 'photoreal',
        scheduledAtMs: 45_000,
        actualStartMs: 45_000,
        settledAtMs: 45_000 + readinessMs,
      },
    ],
  }));
  const mapStreamingCapture = {
    schema: 'gev-map-streaming-capture/v1',
    workloadId: 'austin-map-streaming-v1',
    status: 'observed',
    performanceAcceptanceEligible: true,
    fixtureId: fixture.id,
    manifestSha256: fixture.manifestSha256,
    buildProfile: {
      id: 'austin-map-streaming-v1',
      configurationSha256: 'b'.repeat(64),
    },
    fixtureDelivery: delivery,
    journeys,
  };
  const environment = {
    appCommit: commit,
    userAgent: 'Mozilla/5.0 Chrome/152.0.7977.75',
    platform: 'Win32',
    renderer: 'Intel UHD 620',
    vendor: 'Intel',
    viewport: { width: 1440, height: 900, dpr: 1 },
    drawingBuffer: { width: 1440, height: 900 },
  };
  const workload = {
    warmupMs: 30_000,
    durationPerSampleMs: 60_000,
    runsPerScenario: 5,
    qualityMode: 'manual',
    expectedDensityPct: 75,
    detectionMode: 'DENSE',
    injectedDelayMs: 0,
    fixture: {
      id: fixture.id,
      sha256: fixture.manifestSha256,
      byteLength: 1,
    },
    mapStreamingCapture,
  };
  const report = makeReport(commit);
  report.comparisonContract = createObservedMapStreamingComparisonContract({
    fixture,
    mapStreamingCapture,
    environment,
    workload,
  });
  report.comparisonEligible = true;
  report.fixtureDelivery = delivery;
  report.environment = environment;
  report.workload = workload;
  report.captures = [];
  if (includeFrames) {
    const frames = makeReport(commit, motionP95).captures.filter(
      (sample) => sample.scenario !== 'selected-aircraft-tracking',
    );
    report.environment.layers = [];
    for (const sample of frames)
      for (const point of [sample.conditions.before, sample.conditions.after])
        point.environment.layers = [];
    Object.assign(workload, {
      scenarios: ['idle', 'scripted-motion'],
      populationStableAcrossSamples: true,
      cameraPathStableAcrossSamples: true,
    });
    report.captures = frames;
  }
  return report;
}

export function makeWeatherReport(commit) {
  const report = makeReport(commit);
  const fixture = createWeatherEffectsWorkloadFixture();
  const populations = Object.entries(fixture.expectedLayerCounts)
    .map(([id, count]) => ({ id, enabled: true, count }))
    .sort((left, right) => left.id.localeCompare(right.id));
  const deliveryAssets = fixture.assets.map((asset) => ({
    id: asset.id,
    sha256: asset.sha256,
    byteLength: asset.byteLength,
    contentType: asset.contentType,
    responseCount: 1,
  }));
  const delivery = {
    schema: 'gev-weather-effects-fixture-delivery/v2',
    status: 'observed',
    workloadId: fixture.workloadId,
    method: 'same-origin-hash-pinned-weather-phase-fixture-v2',
    fixtureId: fixture.id,
    fixtureSha256: fixture.sha256,
    fixedTime: fixture.fixedTime,
    phaseSchedule: structuredClone(fixture.phaseSchedule),
    assets: deliveryAssets,
    populationsBefore: populations,
    populationsAfter: populations,
    fulfilledResponseCount: deliveryAssets.length,
    routeErrors: [],
  };
  report.captures = report.captures
    .filter(
      (sample) =>
        sample.scenario === 'idle' || sample.scenario === 'scripted-motion',
    )
    .map((sample) => {
      const visualSettings = structuredClone(sample.conditions.before.settings);
      const phaseObservations = {
        schema: 'gev-weather-phase-observations/v1',
        durationMs: 60_000,
        fixtureSha256: fixture.sha256,
        phases: fixture.phaseSchedule.phases.map((phase) => ({
          id: phase.id,
          fixtureSha256: fixture.sha256,
          expectedSourceTime: phase.sourceTime,
          scheduledAtMs: phase.offsetMs,
          observedAtElapsedMs: phase.offsetMs + 100,
          sourceObservationTimes: Array(3).fill(phase.sourceTime),
          clock: { mode: 'history', playing: false },
        })),
      };
      const state = {
        clock: { mode: 'latest', playing: false },
        motionPreference: {
          schema: 'gev-weather-motion-preference/v1',
          reducedMotion: false,
        },
        sourceObservationTimes: Array(3).fill(fixture.timeline.at(-1)),
        visualState: {
          satelliteProduct: 'clouds-regional',
          satelliteInfrared: 'filtered',
          radarOpacity: 'strong',
          lightningOpacity: 'strong',
          windModel: 'gfs',
          windOverlay: 'speed',
          windPaused: false,
        },
        populations: populations.map((row) => ({
          ...row,
          loading: false,
          error: null,
        })),
      };
      sample.layers = structuredClone(populations);
      sample.settings = {
        before: structuredClone(visualSettings),
        after: structuredClone(visualSettings),
      };
      for (const boundary of ['before', 'after']) {
        sample.conditions[boundary].settings = structuredClone(visualSettings);
        sample.conditions[boundary].environment.layers =
          structuredClone(populations);
      }
      sample.fixtureDelivery = structuredClone(delivery);
      sample.weatherEffectsClock = {
        schema: 'gev-weather-effects-clock/v2',
        fixedHarnessTime: fixture.fixedTime,
        wallClockBeforeMs: Date.parse(fixture.fixedTime),
        wallClockAfterMs: Date.parse(fixture.fixedTime),
        motionPreferencePreflight: {
          schema: 'gev-weather-motion-preference/v1',
          reducedMotion: false,
        },
        weatherStateBefore: structuredClone(state),
        weatherStateAfter: {
          ...structuredClone(state),
          clock: { mode: 'history', playing: false },
        },
        phaseObservations,
      };
      return sample;
    });
  report.environment.layers = structuredClone(populations);
  report.fixtureDelivery = delivery;
  report.workload.scenarios = ['idle', 'scripted-motion'];
  report.workload.fixture = fixture;
  report.workload.qualityMode = 'manual';
  report.workload.expectedDensityPct = 75;
  report.workload.detectionMode = 'DENSE';
  report.workload.populationStableAcrossSamples = true;
  report.workload.cameraPathStableAcrossSamples = true;
  report.comparisonContract = createObservedWeatherEffectsComparisonContract({
    fixture,
    fixtureDelivery: delivery,
    environment: report.environment,
    captures: report.captures,
    scenarios: report.workload.scenarios,
    workload: {
      warmupMs: report.workload.warmupMs,
      durationPerSampleMs: report.workload.durationPerSampleMs,
      runsPerScenario: report.workload.runsPerScenario,
    },
  });
  report.comparisonEligible = true;
  return report;
}

/** Build a paired fixture from the registered infrastructure producer contract. */
export function makeInfrastructureReport(commit, workloadId) {
  const report = makeReport(commit);
  const fixture = createInfrastructureWorkloadFixture(
    workloadId,
    '2026-10-08T12:00:00.000Z',
  );
  const populations = Object.entries(fixture.expectedLayerCounts)
    .map(([id, count]) => ({ id, enabled: true, count }))
    .sort((left, right) => left.id.localeCompare(right.id));
  const settings = structuredClone(
    report.captures[0].conditions.before.settings,
  );
  const assets = fixture.assets.map(({ id, sha256, byteLength }) => ({
    id,
    sha256,
    byteLength,
    status: 200,
    responseCount: 1,
  }));
  const fixtureDelivery = {
    schema: 'gev-infrastructure-fixture-delivery-observation/v1',
    status: 'observed',
    method: 'actual same-origin bundled asset response bodies SHA-256 verified',
    fixtureId: fixture.id,
    fixtureSha256: fixture.sha256,
    fixedTime: fixture.fixedTime,
    assets,
    populationsBefore: populations,
    populationsAfter: populations,
  };
  const clock = {
    currentTime: fixture.clock,
    shouldAnimate: false,
    multiplier: 0,
  };
  const routes = {
    idle: {
      id: 'parked-v1',
      start: structuredClone(routesForInfrastructure(fixture)),
      elapsedDurationMs: 60_000,
      motionDistanceM: 0,
    },
    'scripted-motion': {
      id: 'elapsed-move-right-v1',
      start: structuredClone(routesForInfrastructure(fixture)),
      elapsedDurationMs: 60_000,
      motionDistanceM: 15_000,
    },
  };
  const captures = [];
  for (const scenario of Object.keys(routes))
    for (let run = 1; run <= 5; run += 1) {
      const frameIntervalMs = scenario === 'idle' ? null : 38 + run;
      captures.push({
        scenario,
        run,
        documentRole: 'main-measured',
        documentId: 'main-measured-document',
        durationMs: 60_005,
        frameCount: frameIntervalMs === null ? 0 : 100,
        frameIntervalMs:
          frameIntervalMs === null
            ? { p50: null, p95: null, max: null, samples: 0 }
            : {
                p50: frameIntervalMs,
                p95: frameIntervalMs,
                max: frameIntervalMs,
                samples: 100,
              },
        conditions: {
          before: {
            ...structuredClone(report.captures[0].conditions.before),
            environment: {
              ...structuredClone(
                report.captures[0].conditions.before.environment,
              ),
              layers: structuredClone(populations),
            },
          },
          after: {
            ...structuredClone(report.captures[0].conditions.after),
            environment: {
              ...structuredClone(
                report.captures[0].conditions.after.environment,
              ),
              layers: structuredClone(populations),
            },
          },
        },
        foregroundThroughout: true,
        cameraPath: structuredClone(routes[scenario]),
        layers: structuredClone(populations),
        settings: {
          before: structuredClone(settings),
          after: structuredClone(settings),
        },
        fixtureDelivery: structuredClone(fixtureDelivery),
        infrastructureFixtureClock: {
          fixedTime: fixture.fixedTime,
          wallClockBeforeMs: fixture.fixedTimeMs,
          wallClockAfterMs: fixture.fixedTimeMs,
          cesiumBefore: structuredClone(clock),
          cesiumAfter: structuredClone(clock),
        },
      });
    }
  report.captures = captures;
  report.fixtureDelivery = structuredClone(fixtureDelivery);
  report.environment.layers = structuredClone(populations);
  report.workload = {
    warmupMs: 30_000,
    durationPerSampleMs: 60_000,
    runsPerScenario: 5,
    scenarios: Object.keys(routes),
    fixture,
    qualityMode: 'manual',
    expectedDensityPct: 75,
    detectionMode: 'DENSE',
    injectedDelayMs: 0,
    populationStableAcrossSamples: true,
    cameraPathStableAcrossSamples: true,
  };
  report.comparisonContract = createObservedInfrastructureComparisonContract({
    fixture,
    fixtureDelivery,
    environment: report.environment,
    captures,
    scenarios: report.workload.scenarios,
    workload: {
      warmupMs: report.workload.warmupMs,
      durationPerSampleMs: report.workload.durationPerSampleMs,
      runsPerScenario: report.workload.runsPerScenario,
    },
  });
  return report;
}

function routesForInfrastructure(fixture) {
  const { longitudeDeg, latitudeDeg, altitudeM } = fixture.camera;
  const longitude = (longitudeDeg * Math.PI) / 180;
  const latitude = (latitudeDeg * Math.PI) / 180;
  const radius = 6_378_137 + altitudeM;
  const radial = {
    x: Math.cos(latitude) * Math.cos(longitude),
    y: Math.cos(latitude) * Math.sin(longitude),
    z: Math.sin(latitude),
  };
  const north = {
    x: -Math.sin(latitude) * Math.cos(longitude),
    y: -Math.sin(latitude) * Math.sin(longitude),
    z: Math.cos(latitude),
  };
  const position = Object.fromEntries(
    Object.entries(radial).map(([axis, value]) => [axis, value * radius]),
  );
  return {
    position,
    direction: Object.fromEntries(
      Object.entries(radial).map(([axis, value]) => [axis, -value]),
    ),
    up: north,
    transform: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
  };
}
