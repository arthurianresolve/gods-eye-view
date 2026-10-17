import {
  createEvidenceEnvelope,
  knownEvidenceSourceUrl,
} from '../../evidence/evidence.js';
import { fireDetectionKey } from '../../data/firmsLabels.js';

/** Provenance for one NASA FIRMS detection without inventing missing time. */
export function createFirmsEvidence(
  fire,
  {
    receivedAt = null,
    snapshotAt = null,
    displayTime = null,
    historyWindow = null,
    feedState = 'unknown',
    missingSources = [],
    truncated = false,
  } = {},
) {
  const observedAt =
    Number.isFinite(fire?.acqMs) && fire.acqMs > 0 ? fire.acqMs : null;
  const observationIsCurrent = observedAt != null && observedAt <= Date.now();
  const missing = [
    ...new Set(
      (Array.isArray(missingSources) ? missingSources : []).filter(
        (value) => typeof value === 'string',
      ),
    ),
  ];
  return createEvidenceEnvelope({
    entityRef: {
      layerKey: 'local-firms',
      id: fireDetectionKey(fire),
    },
    sourceId: 'NASA FIRMS',
    sourceUrl: knownEvidenceSourceUrl('NASA FIRMS'),
    licenseRef: 'CC0 / U.S. public domain data',
    sourceRecordId: fireDetectionKey(fire),
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
      area: 'Global NASA FIRMS active-fire detections · trailing 24 h',
      intervalStart: historyWindow?.from ?? null,
      intervalEnd: historyWindow?.to ?? null,
      completeness: missing.length ? 'partial' : 'unknown',
      truncated,
      reason: missing.length
        ? `No data from ${missing.slice(0, 4).join(', ')}.`
        : 'Completeness of the source snapshot is not independently certified.',
    },
    limitations: [
      ...(!observationIsCurrent
        ? [
            observedAt == null
              ? 'NASA FIRMS did not provide an acquisition time for this detection.'
              : 'The FIRMS acquisition time was in the future and was not accepted.',
          ]
        : []),
      ...(missing.length
        ? ['One or more FIRMS source feeds were unavailable.']
        : []),
    ],
  });
}
