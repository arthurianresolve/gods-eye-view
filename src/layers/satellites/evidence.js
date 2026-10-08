import { createEvidenceEnvelope } from '../../evidence/evidence.js';
import { layerFeedState } from '../../data/feedState.js';

/** Keep a propagated satellite position distinct from its source element epoch. */
export function createSatelliteEvidence({
  noradId,
  group,
  displayTime,
  elementEpoch,
  state,
}) {
  if (noradId == null || noradId === '') return null;
  const sourceState = state || {};
  const status =
    sourceState._lastError === 'CelesTrak unreachable'
      ? 'unavailable'
      : sourceState._lastError
        ? 'degraded'
        : 'nominal';
  return createEvidenceEnvelope({
    entityRef: { layerKey: 'satellites', id: String(noradId) },
    sourceId: 'CelesTrak',
    sourceUrl: 'https://celestrak.org/',
    sourceRecordId: String(noradId),
    snapshotAt: sourceState._lastUpdate,
    displayTime,
    elementEpoch,
    method: 'predicted',
    displayMethod: 'predicted',
    feedState: layerFeedState({
      source: 'CelesTrak',
      count: sourceState._count,
      lastUpdate: sourceState._lastUpdate,
      error: sourceState._lastError,
      status,
    }),
    coverage: {
      area: `CelesTrak ${group || 'catalog'} orbital elements`,
      completeness: 'partial',
      reason: 'Catalog groups do not represent every object in orbit.',
    },
    limitations: [
      'The displayed position is propagated from orbital elements; the element epoch is not a direct position observation.',
      ...(elementEpoch == null
        ? ['The source orbital element epoch is unavailable.']
        : []),
    ],
  });
}
