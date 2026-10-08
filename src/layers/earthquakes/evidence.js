import {
  createEvidenceEnvelope,
  knownEvidenceSourceUrl,
} from '../../evidence/evidence.js';

/** Provenance for one event from the loaded USGS all-day M2.5+ feed. */
export function createEarthquakeEvidence(
  record,
  {
    receivedAt = null,
    snapshotAt = null,
    displayTime = null,
    historyWindow = null,
    feedState = 'unknown',
    truncated = false,
  } = {},
) {
  const observedAt = Number.isFinite(record?.timeMs) ? record.timeMs : null;
  const observationIsCurrent = observedAt != null && observedAt <= Date.now();
  return createEvidenceEnvelope({
    entityRef: { layerKey: 'earthquakes', id: record?.id },
    sourceId: 'USGS',
    sourceUrl: knownEvidenceSourceUrl('USGS'),
    licenseRef: 'U.S. public domain',
    sourceRecordId: record?.id,
    observedAt,
    receivedAt,
    snapshotAt:
      Number.isFinite(snapshotAt) && snapshotAt <= Date.now()
        ? snapshotAt
        : null,
    displayTime,
    method: observationIsCurrent ? 'observed' : 'unknown',
    displayMethod: 'observed',
    feedState,
    coverage: {
      area: 'USGS all-day M2.5+ feed',
      intervalStart: historyWindow?.from ?? null,
      intervalEnd: historyWindow?.to ?? null,
      completeness: 'unknown',
      truncated,
      reason: 'The layer contains the loaded USGS summary records above M2.5.',
    },
    limitations: observationIsCurrent
      ? []
      : [
          observedAt == null
            ? 'USGS did not provide an event time for this record.'
            : 'The USGS event time was in the future and was not accepted.',
        ],
  });
}
