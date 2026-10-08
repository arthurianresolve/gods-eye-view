import { createEvidenceEnvelope } from '../../evidence/evidence.js';

/** Source and issue-time evidence for one NOAA NHC/CPHC storm advisory. */
export function createCycloneEvidence(
  storm,
  { receivedAt = null, snapshotAt = null, feedState = 'unknown' } = {},
) {
  const observedAt = Date.parse(storm?.positionAt);
  const issuedAt = Date.parse(storm?.issuedAt);
  const observedIsCurrent =
    Number.isFinite(observedAt) && observedAt <= Date.now();
  const issuedIsCurrent = Number.isFinite(issuedAt) && issuedAt <= Date.now();
  return createEvidenceEnvelope({
    entityRef: { layerKey: 'weather-cyclones', id: storm?.id },
    sourceId: 'NOAA NHC / CPHC',
    sourceUrl: storm?.advisoryUrl,
    licenseRef: 'NWS public-data terms',
    sourceRecordId: storm?.id,
    observedAt: observedIsCurrent ? observedAt : null,
    receivedAt,
    snapshotAt,
    issuedAt: issuedIsCurrent ? issuedAt : null,
    displayTime: observedIsCurrent ? observedAt : null,
    method: observedIsCurrent ? 'observed' : 'unknown',
    displayMethod: 'observed',
    feedState,
    coverage: {
      area: 'Atlantic and eastern/central North Pacific advisories',
      completeness: 'partial',
      reason:
        'Coverage is limited to published NHC and CPHC advisories; it is not worldwide.',
    },
    limitations: [
      ...(!observedIsCurrent
        ? ['The advisory position time is missing or in the future.']
        : []),
      ...(!issuedIsCurrent
        ? ['The advisory issue time is missing or in the future.']
        : []),
      'A forecast cone describes center-track uncertainty, not the full hazard area.',
      'No retention metadata was supplied with this advisory.',
    ],
  });
}
