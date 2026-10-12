import globals from 'globals';

export const CAPTURE_NO_UNDEF_FILES = Object.freeze([
  'scripts/capture-scene-performance.mjs',
  'scripts/qa-performance-build-smoke.mjs',
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
  'scripts/performance/austinSatelliteSampledEpoch.mjs',
  'scripts/performance/austinSatelliteSampledEpoch.test.mjs',
  'scripts/performance/captureComparisonContract.mjs',
  'scripts/performance/hostedRendererBackend.mjs',
  'scripts/performance/renderBoundaryObservation.mjs',
]);

export const CAPTURE_NO_UNDEF_CONFIG = Object.freeze({
  files: [...CAPTURE_NO_UNDEF_FILES],
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
