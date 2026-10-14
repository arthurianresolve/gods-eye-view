import globals from 'globals';

export const CAPTURE_NO_UNDEF_FILES = Object.freeze([
  'scripts/capture-scene-performance.mjs',
  'scripts/qa-performance-build-smoke.mjs',
  'scripts/qa-performance-build-smoke.test.mjs',
  'scripts/qa-application.mjs',
  'scripts/performance/austinOperatingComparisonContract.test.mjs',
  'scripts/performance/austinOperatingDocumentEvidence.mjs',
  'scripts/performance/austinOperatingDocumentEvidence.test.mjs',
  'scripts/performance/austinOperatingPopulationEvidence.mjs',
  'scripts/performance/austinOperatingPopulationEvidence.test.mjs',
  'scripts/performance/austinOperatingReadinessHistory.mjs',
  'scripts/performance/austinOperatingReadinessHistory.test.mjs',
  'scripts/performance/austinOperatingWorkloadContract.mjs',
  'scripts/performance/austinOperatingWorkloadFixture.mjs',
  'scripts/performance/austinOperatingWorkloadFixture.test.mjs',
  'scripts/performance/weatherEffectsWorkloadFixture.mjs',
  'scripts/performance/weatherEffectsWorkloadFixture.test.mjs',
  'scripts/performance/productionFlightFixture.mjs',
  'scripts/performance/productionFlightFixture.test.mjs',
  'scripts/performance/austinSatelliteSampledEpoch.mjs',
  'scripts/performance/austinSatelliteSampledEpoch.test.mjs',
  'scripts/performance/aircraftFleetTickAudit.mjs',
  'scripts/performance/aircraftFleetTickAudit.test.mjs',
  'scripts/performance/mapStreamingCapture.mjs',
  'scripts/performance/mapStreamingCapture.test.mjs',
  'scripts/performance/mapStreamingFixture.mjs',
  'scripts/performance/mapStreamingFixture.test.mjs',
  'scripts/performance/mapStreamingFixtureDelivery.mjs',
  'scripts/performance/mapStreamingFixtureDelivery.test.mjs',
  'scripts/performance/cctvViewshedRetention.mjs',
  'scripts/performance/cctvViewshedRetention.test.mjs',
  'scripts/performance/s58PostProcessStageCensus.mjs',
  'scripts/performance/s58PostProcessStageCensus.test.mjs',
  'scripts/fixtures/cctv-calibration-demand.js',
  'scripts/qa-hosted-capture.mjs',
  'scripts/performance/mapStreamingWorkloadContract.mjs',
  'scripts/performance/captureComparisonContract.mjs',
  'scripts/performance/pairedReport.mjs',
  'scripts/performance/pairedReport.test.mjs',
  'scripts/performance/hostedRendererBackend.mjs',
  'scripts/performance/renderBoundaryObservation.mjs',
]);

export const CAPTURE_NO_UNDEF_CONFIG = Object.freeze({
  files: [...CAPTURE_NO_UNDEF_FILES],
  linterOptions: {
    noInlineConfig: true,
  },
  languageOptions: {
    ecmaVersion: 'latest',
    sourceType: 'module',
    globals: {
      ...globals.es2021,
      ...globals.browser,
      ...globals.node,
    },
  },
  rules: {
    'no-undef': 'error',
  },
});

// Vite replaces this diagnostic-only identifier in the CCTV fixture build.
// Keep it scoped to that fixture so other capture files still catch typos.
export const CAPTURE_NO_UNDEF_FIXTURE_CONFIG = Object.freeze({
  files: ['scripts/fixtures/cctv-calibration-demand.js'],
  languageOptions: {
    globals: {
      __GEV_APP_COMMIT__: 'readonly',
    },
  },
});
