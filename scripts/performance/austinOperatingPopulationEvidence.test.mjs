import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  createCaptureFailureReport,
  MAX_CAPTURE_FAILURE_REPORT_BYTES,
} from './captureFailureReport.mjs';
import { createAustinOperatingWorkloadFixture } from './austinOperatingWorkloadFixture.mjs';
import {
  assertAustinPopulationEvidence,
  assertAustinStableCatalogs,
} from './austinOperatingPopulationEvidence.mjs';

const fixture = createAustinOperatingWorkloadFixture();
const hashIds = (ids) =>
  createHash('sha256')
    .update(ids.slice().sort().join('\n'), 'utf8')
    .digest('hex');

function validState(
  installationIds = fixture.sourcePopulationIds['military-installations'].slice(
    0,
    425,
  ),
) {
  const ids = fixture.expectedLayerCounts;
  const selectedLayers = Object.entries(ids).map(([id, count]) => {
    const isInstallations = id === 'military-installations';
    const isViewport = [
      'alpr-cameras',
      'military-installations',
      'radio',
    ].includes(id);
    const sourcePopulation = isInstallations
      ? {
          count: installationIds.length,
          sha256: hashIds(installationIds),
          identityIds: installationIds,
          truncated: false,
        }
      : {
          count,
          sha256: id === 'wind' ? null : fixture.sourcePopulationHashes[id],
          truncated: false,
        };
    return {
      id,
      enabled: true,
      expectedSourceCatalogCount: count,
      count: isViewport ? sourcePopulation.count : count,
      viewportCount: isViewport ? (id === 'radio' ? 88 : 357) : null,
      sourcePopulation,
      loading: false,
      error: null,
    };
  });
  return { selectedLayers };
}

function installationRow(state) {
  return state.selectedLayers.find(
    (row) => row.id === 'military-installations',
  );
}

function installationFailure(state) {
  try {
    assertAustinPopulationEvidence(state, fixture, 'scripted-motion run 2');
  } catch (error) {
    return error;
  }
  assert.fail('Expected Austin installation population validation to fail.');
}

test('Austin population evidence binds full catalogs and allows native viewport subsets', () => {
  const first = validState(
    fixture.sourcePopulationIds['military-installations'].slice(0, 425),
  );
  const later = validState(
    fixture.sourcePopulationIds['military-installations'].slice(30, 475),
  );
  assertAustinPopulationEvidence(first, fixture, 'before');
  assertAustinPopulationEvidence(later, fixture, 'after');
  assert.doesNotThrow(() => assertAustinStableCatalogs(first, later, 'sample'));
});

test('Austin population evidence rejects stable same-size identity substitutions', () => {
  const state = validState();
  const satellites = state.selectedLayers.find(
    (row) => row.id === 'satellites',
  );
  satellites.sourcePopulation.sha256 = 'f'.repeat(64);
  assert.throws(
    () => assertAustinPopulationEvidence(state, fixture, 'forged'),
    /identities do not match/,
  );
});

test('Austin installation observations must be a unique subset of the declared catalog', () => {
  const state = validState();
  const row = installationRow(state);
  const ids = row.sourcePopulation.identityIds.slice();
  ids[0] = 'same-count-unknown-installation';
  row.sourcePopulation.identityIds = ids;
  row.sourcePopulation.sha256 = hashIds(ids);
  assert.throws(
    () =>
      assertAustinPopulationEvidence(state, fixture, 'unknown-installation'),
    /valid observed subset/,
  );
});

test('installation-subset failures retain reason codes and bounded observed predicates', () => {
  const mutations = [
    [
      'missing-layer',
      (state) => {
        state.selectedLayers = state.selectedLayers.filter(
          (row) => row.id !== 'military-installations',
        );
      },
      'layer-missing',
    ],
    [
      'disabled',
      (state) => {
        installationRow(state).enabled = false;
      },
      'layer-disabled',
    ],
    [
      'still-loading',
      (state) => {
        installationRow(state).loading = true;
      },
      'still-loading',
    ],
    [
      'layer-error',
      (state) => {
        installationRow(state).error = 'fixture source failed';
      },
      'layer-error',
    ],
    [
      'truncated',
      (state) => {
        installationRow(state).sourcePopulation.truncated = true;
      },
      'population-truncated-or-unknown',
    ],
    [
      'count',
      (state) => {
        installationRow(state).sourcePopulation.count = 0;
      },
      'count-below-one',
    ],
    [
      'identity-length',
      (state) => {
        installationRow(state).sourcePopulation.identityIds.pop();
      },
      'identity-count-mismatch',
    ],
    [
      'duplicate-identity',
      (state) => {
        const population = installationRow(state).sourcePopulation;
        population.identityIds[0] = population.identityIds[1];
        population.sha256 = hashIds(population.identityIds);
      },
      'duplicate-identities',
    ],
    [
      'unknown-identity',
      (state) => {
        const population = installationRow(state).sourcePopulation;
        population.identityIds[0] = 'unknown-source-record';
        population.sha256 = hashIds(population.identityIds);
      },
      'unknown-identities',
    ],
    [
      'non-string-identity',
      (state) => {
        const population = installationRow(state).sourcePopulation;
        population.identityIds[0] = null;
      },
      'non-string-identities',
    ],
    [
      'invalid-digest',
      (state) => {
        installationRow(state).sourcePopulation.sha256 = 'not-a-sha256';
      },
      'identity-digest-invalid',
    ],
    [
      'mismatched-digest',
      (state) => {
        installationRow(state).sourcePopulation.sha256 = 'f'.repeat(64);
      },
      'identity-digest-mismatch',
    ],
  ];

  for (const [name, mutate, reasonCode] of mutations) {
    const state = validState();
    mutate(state);
    const error = installationFailure(state);
    assert.match(error.message, /valid observed subset/);
    assert.ok(error.actual.reasonCodes.includes(reasonCode), name);
    assert.equal(
      error.actual.schema,
      'gev-austin-installation-population-diagnostic/v1',
      name,
    );
    assert.equal(error.expected.enabled, true, name);
  }

  const erroredState = validState();
  installationRow(erroredState).error =
    'source failed https://private.example/path';
  const reportError = installationFailure(erroredState);
  const report = createCaptureFailureReport({
    phase: 'validate-sample-integrity',
    scenario: 'scripted-motion',
    run: 2,
    error: reportError,
    errorActual: reportError.actual,
    errorExpected: reportError.expected,
  });
  assert.equal(report.failure.actual.layerErrorPresent, true);
  assert.equal(report.failure.actual.layerError, 'source failed [url]');
  assert.equal(report.failure.actual.label, 'scripted-motion run 2');
});

test('installation failure predicates survive bounded report serialization when samples are trimmed', () => {
  const state = validState();
  installationRow(state).sourcePopulation.sha256 = 'f'.repeat(64);
  const error = installationFailure(state);
  const completedSamples = Array.from({ length: 4 }, (_, index) => ({
    index,
    timingRows: Array(256).fill('x'.repeat(1_024)),
  }));
  const report = createCaptureFailureReport({
    phase: 'validate-sample-integrity',
    scenario: 'scripted-motion',
    run: 2,
    error,
    errorActual: error.actual,
    errorExpected: error.expected,
    current: {
      phase: 'validate-sample-integrity',
      scenario: 'scripted-motion',
      run: 2,
      before: { large: 'before'.repeat(2_000) },
      after: { large: 'after'.repeat(2_000) },
    },
    completedSamples,
  });
  const json = `${JSON.stringify(report, null, 2)}\n`;
  assert.ok(
    Buffer.byteLength(json, 'utf8') <= MAX_CAPTURE_FAILURE_REPORT_BYTES,
  );
  assert.equal(report.progress.completedSampleCount, completedSamples.length);
  assert.ok(report.progress.completedSamplesRetained < completedSamples.length);
  assert.equal(report.failure.actual.label, 'scripted-motion run 2');
  assert.ok(
    report.failure.actual.reasonCodes.includes('identity-digest-mismatch'),
  );
  assert.equal(report.failure.expected.sha256MustMatchSortedIdentityIds, true);
  assert.equal(report.evidenceTruncated, true);
  assert.doesNotMatch(json, /private\.example/);
});

test('viewport counts are not inferred for whole-catalog or grid layers', () => {
  const state = validState();
  for (const id of ['satellites', 'cctv', 'wind']) {
    state.selectedLayers.find((row) => row.id === id).viewportCount = 1;
  }
  assert.throws(
    () =>
      assertAustinPopulationEvidence(state, fixture, 'misreported-viewport'),
    /not a viewport-filtered population/,
  );
});
