import { createHash } from 'node:crypto';

const HASH = /^[a-f0-9]{64}$/;
const MAX_INSTALLATION_DIAGNOSTIC_IDS = 1_024;
const hashIds = (ids) =>
  createHash('sha256')
    .update(ids.slice().sort().join('\n'), 'utf8')
    .digest('hex');

function installationPopulationFailure(
  label,
  layer,
  expectedCatalogCount,
  allowedInstallationIds,
) {
  const population = layer?.sourcePopulation;
  const ids = population?.identityIds;
  const idsAvailable = Array.isArray(ids);
  const identityAnalysisBounded =
    idsAvailable && ids.length <= MAX_INSTALLATION_DIAGNOSTIC_IDS;
  const analyzedIds = identityAnalysisBounded ? ids : null;
  const nonStringIds = analyzedIds
    ? analyzedIds.filter((id) => typeof id !== 'string')
    : null;
  const unknownIds = analyzedIds
    ? analyzedIds.filter(
        (id) => typeof id === 'string' && !allowedInstallationIds.has(id),
      )
    : null;
  const uniqueCount = analyzedIds ? new Set(analyzedIds).size : null;
  const allIdsAreStrings =
    analyzedIds !== null && analyzedIds.every((id) => typeof id === 'string');
  const recomputedIdentitySha256 = allIdsAreStrings
    ? hashIds(analyzedIds)
    : null;
  const identitySha256Valid = HASH.test(population?.sha256 || '');
  const reasons = [];

  if (!layer) reasons.push('layer-missing');
  if (layer?.enabled !== true) reasons.push('layer-disabled');
  if (layer?.expectedSourceCatalogCount !== expectedCatalogCount)
    reasons.push('declared-catalog-count-mismatch');
  if (layer?.loading === true) reasons.push('still-loading');
  if (layer?.error != null) reasons.push('layer-error');
  if (!Number.isSafeInteger(population?.count))
    reasons.push('count-not-safe-integer');
  else if (population.count < 1) reasons.push('count-below-one');
  if (
    Number.isSafeInteger(population?.count) &&
    population.count > expectedCatalogCount
  )
    reasons.push('count-exceeds-declared-catalog');
  if (population?.truncated !== false)
    reasons.push('population-truncated-or-unknown');
  if (!idsAvailable) reasons.push('identity-list-missing');
  else if (ids.length !== population?.count)
    reasons.push('identity-count-mismatch');
  if (uniqueCount !== null && uniqueCount !== ids.length)
    reasons.push('duplicate-identities');
  if (nonStringIds?.length) reasons.push('non-string-identities');
  if (unknownIds?.length) reasons.push('unknown-identities');
  if (!identitySha256Valid) reasons.push('identity-digest-invalid');
  else if (
    recomputedIdentitySha256 !== null &&
    recomputedIdentitySha256 !== population.sha256
  )
    reasons.push('identity-digest-mismatch');

  const error = new Error(
    `Austin ${label} installations population is not a valid observed subset of the delivered synthetic catalog.`,
  );
  error.actual = {
    schema: 'gev-austin-installation-population-diagnostic/v1',
    label,
    reasonCodes: reasons,
    layerPresent: Boolean(layer),
    enabled: layer?.enabled ?? null,
    expectedSourceCatalogCount: layer?.expectedSourceCatalogCount ?? null,
    loading: layer?.loading ?? null,
    layerErrorPresent: layer?.error != null,
    layerError:
      typeof layer?.error === 'string' ? layer.error.slice(0, 160) : null,
    count: population?.count ?? null,
    truncated: population?.truncated ?? null,
    identityListPresent: idsAvailable,
    identityLength: idsAvailable ? ids.length : null,
    identityUniqueCount: uniqueCount,
    identityAnalysisTruncated: idsAvailable && !identityAnalysisBounded,
    unknownIdentityCount: unknownIds?.length ?? null,
    unknownIdentityExamples:
      unknownIds?.slice(0, 4).map((id) => id.slice(0, 80)) ?? null,
    nonStringIdentityCount: nonStringIds?.length ?? null,
    nonStringIdentityTypes:
      nonStringIds?.slice(0, 4).map((id) => typeof id) ?? null,
    identitySha256: population?.sha256 ?? null,
    identitySha256Valid,
    recomputedIdentitySha256,
    identitySha256Matches:
      recomputedIdentitySha256 === null
        ? null
        : recomputedIdentitySha256 === population?.sha256,
  };
  error.expected = {
    enabled: true,
    expectedSourceCatalogCount: expectedCatalogCount,
    loadingMustNotBeTrue: true,
    errorMustBeAbsent: true,
    countRange: { minimum: 1, maximum: expectedCatalogCount },
    truncated: false,
    identityLengthMustEqualCount: true,
    identitiesMustBeUniqueStringsInCatalog: true,
    sha256MustMatchSortedIdentityIds: true,
  };
  return error;
}

export function normalizeAustinSatelliteWitness(record) {
  const noradId = Number.isSafeInteger(record?.noradId)
    ? record.noradId
    : record?.id;
  if (
    !Number.isSafeInteger(noradId) ||
    !Number.isFinite(record?.latitude) ||
    !Number.isFinite(record?.longitude) ||
    !Number.isFinite(record?.altitudeM)
  )
    return null;
  return {
    noradId,
    latitude: record.latitude,
    longitude: record.longitude,
    altitudeM: record.altitudeM,
  };
}

/** Validate source catalogs separately from viewport-filtered populations. */
export function assertAustinPopulationEvidence(state, fixture, label) {
  if (!Array.isArray(state?.selectedLayers))
    throw new Error(
      `Austin ${label} native population observations are unavailable.`,
    );
  const expected = fixture.expectedLayerCounts;
  const fixedCatalogs = ['satellites', 'cctv', 'alpr-cameras', 'radio', 'wind'];
  for (const id of fixedCatalogs) {
    const row = state.selectedLayers.find((entry) => entry.id === id);
    const population = row?.sourcePopulation;
    if (
      !row ||
      row.enabled !== true ||
      row.expectedSourceCatalogCount !== expected[id] ||
      population?.count !== expected[id] ||
      population?.truncated !== false ||
      row.loading === true ||
      row.error != null
    )
      throw new Error(
        `Austin ${label} ${id} source population does not match its declared catalog: ${JSON.stringify(population)}`,
      );
    if (
      id !== 'wind' &&
      (!HASH.test(population.sha256 || '') ||
        population.sha256 !== fixture.sourcePopulationHashes?.[id])
    )
      throw new Error(
        `Austin ${label} ${id} source identities do not match the pinned catalog.`,
      );
  }

  const installations = state.selectedLayers.find(
    (entry) => entry.id === 'military-installations',
  );
  const installationPopulation = installations?.sourcePopulation;
  const allowedInstallationIds = new Set(
    fixture.sourcePopulationIds?.['military-installations'] || [],
  );
  const observedInstallationIds = installationPopulation?.identityIds;
  const invalidInstallationPopulation =
    !installations ||
    installations.enabled !== true ||
    installations.expectedSourceCatalogCount !==
      expected['military-installations'] ||
    installations.loading === true ||
    installations.error != null ||
    !Number.isSafeInteger(installationPopulation?.count) ||
    installationPopulation.count < 1 ||
    installationPopulation.count > expected['military-installations'] ||
    installationPopulation.truncated !== false ||
    !Array.isArray(observedInstallationIds) ||
    observedInstallationIds.length !== installationPopulation.count ||
    new Set(observedInstallationIds).size !== observedInstallationIds.length ||
    observedInstallationIds.some(
      (id) => typeof id !== 'string' || !allowedInstallationIds.has(id),
    ) ||
    !HASH.test(installationPopulation.sha256 || '') ||
    hashIds(observedInstallationIds) !== installationPopulation.sha256;
  if (invalidInstallationPopulation)
    throw installationPopulationFailure(
      label,
      installations,
      expected['military-installations'],
      allowedInstallationIds,
    );

  const alpr = state.selectedLayers.find(
    (entry) => entry.id === 'alpr-cameras',
  );
  const radio = state.selectedLayers.find((entry) => entry.id === 'radio');
  for (const id of ['satellites', 'cctv', 'wind']) {
    if (
      state.selectedLayers.find((entry) => entry.id === id)?.viewportCount !==
      null
    )
      throw new Error(
        `Austin ${label} ${id} is not a viewport-filtered population.`,
      );
  }
  if (
    !Number.isSafeInteger(alpr?.viewportCount) ||
    alpr.viewportCount < 0 ||
    alpr.viewportCount > alpr.sourcePopulation.count ||
    !Number.isSafeInteger(radio?.viewportCount) ||
    radio.viewportCount < 0 ||
    radio.viewportCount > expected.radio
  )
    throw new Error(
      `Austin ${label} viewport-filtered ALPR/radio populations are invalid.`,
    );
  if (
    !Number.isSafeInteger(installations.viewportCount) ||
    installations.viewportCount < 1 ||
    installations.viewportCount > installationPopulation.count
  )
    throw new Error(
      `Austin ${label} installation viewport population is invalid.`,
    );
}

export function assertAustinStableCatalogs(before, after, label) {
  for (const id of ['satellites', 'cctv', 'alpr-cameras', 'radio', 'wind']) {
    const left = before?.selectedLayers?.find((entry) => entry.id === id);
    const right = after?.selectedLayers?.find((entry) => entry.id === id);
    if (
      left?.sourcePopulation?.count !== right?.sourcePopulation?.count ||
      left?.sourcePopulation?.sha256 !== right?.sourcePopulation?.sha256
    )
      throw new Error(
        `Austin ${label} ${id} source population changed within a sample.`,
      );
  }
}

export function summarizeAustinNativePopulations(sample) {
  const clock = sample?.austinOperatingClock;
  const project = (layers) =>
    Array.isArray(layers)
      ? layers.map((layer) => ({
          id: layer.id,
          enabled: layer.enabled,
          count: layer.count,
          viewportCount: layer.viewportCount,
          nearbyCount: layer.nearbyCount,
          onScreenCount: layer.onScreenCount,
          sourcePopulation: {
            count: layer.sourcePopulation?.count ?? null,
            sha256: layer.sourcePopulation?.sha256 ?? null,
            positionSha256: layer.sourcePopulation?.positionSha256 ?? null,
            truncated: layer.sourcePopulation?.truncated ?? null,
            ...(layer.id === 'military-installations'
              ? { identityIds: layer.sourcePopulation?.identityIds ?? null }
              : {}),
          },
          loading: layer.loading,
          error: layer.error,
        }))
      : null;
  return {
    scenario: sample?.scenario ?? null,
    run: sample?.run ?? null,
    documentRole: sample?.documentRole ?? null,
    documentId: sample?.documentId ?? null,
    before: project(clock?.selectedLayersBefore),
    after: project(clock?.selectedLayersAfter),
  };
}
