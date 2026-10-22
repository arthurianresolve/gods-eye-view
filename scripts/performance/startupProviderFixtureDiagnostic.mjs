export const STARTUP_PROVIDER_URL_PATTERNS = Object.freeze([
  'https://services.arcgisonline.com/*',
  'https://terrain.reearth.land/*',
  'https://tile.openstreetmap.org/*',
  'https://tile.googleapis.com/*',
  'https://assets.ion.cesium.com/*',
]);

const safeError = (error) => ({
  name: String(error?.name || 'Error').slice(0, 48),
});

function isCount(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

export function classifyStartupProviderFixtureDocument(owner, releases) {
  let delivery = owner?.finalEvidence || null;
  let summaryError = null;
  if (!delivery) {
    try {
      delivery = owner?.delivery?.summary?.() || null;
    } catch (error) {
      summaryError = safeError(error);
    }
  }

  const allReleases = Array.isArray(releases) ? releases : [];
  const matchingReleases = allReleases.filter(
    (release) =>
      release?.documentRole === owner?.documentRole &&
      release?.documentId === owner?.documentId &&
      release?.sessionOrdinal === owner?.sessionOrdinal,
  );
  const release = matchingReleases.length === 1 ? matchingReleases[0] : null;
  const unmatched = owner?.unmatchedExternal;
  const unmatchedProviderCount =
    unmatched?.byProvider && typeof unmatched.byProvider === 'object'
      ? Object.values(unmatched.byProvider).reduce(
          (sum, count) => sum + (isCount(count) ? count : Number.NaN),
          0,
        )
      : Number.NaN;
  const unmatchedValid =
    unmatched &&
    isCount(unmatched.count) &&
    unmatched.byProvider &&
    typeof unmatched.byProvider === 'object' &&
    Array.isArray(unmatched.examples) &&
    unmatched.examples.length <= 8 &&
    isCount(unmatched.omittedExamples) &&
    unmatched.count === unmatched.examples.length + unmatched.omittedExamples &&
    unmatched.count === unmatchedProviderCount;
  const payloads = Array.isArray(delivery?.assets) ? delivery.assets : null;
  const payloadHashesValid =
    payloads !== null &&
    payloads.every(
      (asset) =>
        typeof asset?.path === 'string' &&
        asset.path.length > 0 &&
        asset.path.length <= 256 &&
        /^[a-f0-9]{64}$/.test(asset.sha256 || '') &&
        isCount(asset.byteLength) &&
        isCount(asset.fulfilledAckCount),
    ) &&
    payloads.reduce((sum, asset) => sum + asset.fulfilledAckCount, 0) ===
      delivery.fulfilledAckCount;
  const deliveryValid =
    delivery &&
    isCount(delivery.requestedCount) &&
    isCount(delivery.fulfilledAckCount) &&
    isCount(delivery.pendingCount) &&
    isCount(delivery.errorObservationCount) &&
    isCount(delivery.omittedErrorObservationCount) &&
    isCount(delivery.omittedErrorKindCount) &&
    isCount(delivery.unexpectedFulfillmentCount) &&
    isCount(delivery.cancelledCount) &&
    delivery.requestedCount ===
      delivery.fulfilledAckCount +
        delivery.cancelledCount +
        delivery.pendingCount &&
    payloadHashesValid;
  const failed =
    owner?.disposed !== true ||
    Boolean(owner?.error) ||
    Boolean(summaryError) ||
    !deliveryValid ||
    !unmatchedValid ||
    delivery?.cleanupConfirmed !== true ||
    delivery?.pendingCount !== 0 ||
    delivery?.errorObservationCount !== 0 ||
    delivery?.omittedErrorObservationCount !== 0 ||
    delivery?.omittedErrorKindCount !== 0 ||
    delivery?.unexpectedFulfillmentCount !== 0 ||
    unmatched?.omittedExamples !== 0 ||
    matchingReleases.length !== 1 ||
    release?.confirmed !== true;
  const covered =
    !failed &&
    unmatched.count === 0 &&
    delivery.requestedCount > 0 &&
    delivery.fulfilledAckCount > 0;

  return {
    documentRole: owner?.documentRole ?? null,
    documentId: owner?.documentId ?? null,
    sessionOrdinal: owner?.sessionOrdinal ?? null,
    status: covered ? 'completed' : failed ? 'failed' : 'incomplete',
    delivery,
    unmatchedExternal: unmatchedValid
      ? {
          count: unmatched.count,
          byProvider: { ...unmatched.byProvider },
          examples: unmatched.examples.slice(0, 8).map((item) => ({
            provider: String(item?.provider || 'unknown').slice(0, 24),
            method: String(item?.method || 'unknown').slice(0, 12),
            resourceType: String(item?.resourceType || 'unknown').slice(0, 24),
          })),
          omittedExamples: unmatched.omittedExamples,
        }
      : null,
    release,
    error: owner?.error ? safeError(owner.error) : summaryError,
    omittedReleaseCount: Math.max(0, matchingReleases.length - 1),
  };
}

export function summarizeStartupProviderFixtureDiagnostic({
  fixture,
  owners,
  releases,
  ineligibleReason,
}) {
  const documents = Array.isArray(owners)
    ? owners.map((owner) => {
        try {
          return classifyStartupProviderFixtureDocument(owner, releases);
        } catch (error) {
          return {
            documentRole: owner?.documentRole ?? null,
            documentId: owner?.documentId ?? null,
            sessionOrdinal: owner?.sessionOrdinal ?? null,
            status: 'failed',
            delivery: null,
            unmatchedExternal: null,
            release: null,
            error: safeError(error),
            omittedReleaseCount: 0,
          };
        }
      })
    : [];
  const status =
    documents.length === 1 && documents[0].status === 'completed'
      ? 'completed'
      : documents.some((document) => document.status === 'failed')
        ? 'failed'
        : 'incomplete';
  return {
    schema: 'gev-startup-provider-fixture-diagnostic/v1',
    status,
    diagnosticOnly: true,
    comparisonEligible: false,
    acceptanceEligible: false,
    ineligibleReason,
    fixture,
    documents,
  };
}
