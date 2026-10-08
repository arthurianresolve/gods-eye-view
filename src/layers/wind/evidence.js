import {
  createEvidenceEnvelope,
  knownEvidenceSourceUrl,
} from '../../evidence/evidence.js';

const models = Object.freeze({
  gfs: {
    label: 'NOAA GFS',
    source: 'NOAA GFS',
    license: 'U.S. public domain',
  },
  ifs: {
    label: 'ECMWF IFS',
    source: 'ECMWF IFS',
    license: 'CC BY 4.0; ECMWF Terms of Use also apply',
  },
});

/** Provenance for one interpolated location in a forecast model grid. */
export function createWindEvidence(
  manifest,
  reading,
  { model = manifest?.model, receivedAt = null, feedState = 'unknown' } = {},
) {
  const provider = models[model] || models.gfs;
  const latitude = reading?.latitude;
  const longitude = reading?.longitude;
  const positionKnown = Number.isFinite(latitude) && Number.isFinite(longitude);
  const issuedAt = Date.parse(manifest?.cycle?.runIso);
  const validFrom = Date.parse(manifest?.cycle?.validIso);
  const issuedIsCurrent = Number.isFinite(issuedAt) && issuedAt <= Date.now();
  const coordinate = positionKnown
    ? `${latitude.toFixed(2)},${longitude.toFixed(2)}`
    : 'position-unknown';
  const run = issuedIsCurrent
    ? new Date(issuedAt).toISOString()
    : 'issue-unknown';
  const count = Number(manifest?.grid?.nx) * Number(manifest?.grid?.ny);

  return createEvidenceEnvelope({
    entityRef: {
      layerKey: 'wind',
      id: `${provider.label}:${coordinate}:${manifest?.cycle?.validIso || run}`,
    },
    sourceId: provider.source,
    sourceUrl: knownEvidenceSourceUrl(provider.source),
    licenseRef: provider.license,
    sourceRecordId: `${provider.label} cycle ${run}`,
    receivedAt,
    issuedAt: issuedIsCurrent ? issuedAt : null,
    validFrom: Number.isFinite(validFrom) ? validFrom : null,
    displayTime: Number.isFinite(validFrom) ? validFrom : null,
    method: 'predicted',
    displayMethod: 'interpolated',
    feedState: manifest?.stale ? 'stale' : feedState,
    coverage: {
      area: 'Global forecast grid at approximately 1° resolution',
      completeness: 'unknown',
      count: Number.isFinite(count) && count >= 0 ? count : null,
      reason:
        'This is an interpolated grid-cell sample; provider completeness is not independently certified.',
    },
    limitations: [
      'Forecast output, not a direct observation.',
      'Interpolation is between model grid points.',
      'Broad weather patterns; not street-level conditions.',
      ...(!positionKnown ? ['Sample location was not available.'] : []),
      ...(!issuedIsCurrent
        ? ['The model issue time was missing or in the future.']
        : []),
      'No uncertainty or retention metadata was supplied.',
    ],
  });
}
