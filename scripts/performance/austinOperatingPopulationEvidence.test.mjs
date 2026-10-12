import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
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
  const row = state.selectedLayers.find(
    (entry) => entry.id === 'military-installations',
  );
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
