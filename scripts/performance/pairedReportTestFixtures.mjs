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
      browser: { name: 'Chrome', version: '152.0' },
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
