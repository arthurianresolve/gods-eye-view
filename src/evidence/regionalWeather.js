import { createEvidenceEnvelope, knownEvidenceSourceUrl } from './evidence.js';

/** Evidence for Open-Meteo's gridded current-conditions response. */
export function createRegionalWeatherEvidence(
  weather,
  { latitude, longitude, receivedAt = Date.now(), feedState = 'unknown' } = {},
) {
  const currentTime =
    typeof weather?.observedAt === 'string' &&
    !/(?:z|[+-]\d\d:?\d\d)$/i.test(weather.observedAt)
      ? `${weather.observedAt}Z`
      : weather?.observedAt;
  const validAt = Date.parse(currentTime);
  const locationKnown = Number.isFinite(latitude) && Number.isFinite(longitude);
  const coordinate = locationKnown
    ? `${latitude.toFixed(3)},${longitude.toFixed(3)}`
    : 'location-unknown';

  return createEvidenceEnvelope({
    entityRef: {
      layerKey: 'weather-current',
      id: `${coordinate}:${Number.isFinite(validAt) ? validAt : 'time-unknown'}`,
    },
    sourceId: 'Open-Meteo',
    sourceUrl: knownEvidenceSourceUrl('Open-Meteo'),
    licenseRef: 'CC BY 4.0',
    receivedAt,
    validFrom: Number.isFinite(validAt) ? validAt : null,
    displayTime: Number.isFinite(validAt) ? validAt : null,
    method: Number.isFinite(validAt) ? 'predicted' : 'unknown',
    displayMethod: locationKnown ? 'interpolated' : 'unknown',
    feedState,
    coverage: {
      area: locationKnown
        ? `Open-Meteo grid near ${coordinate}`
        : 'Open-Meteo gridded current conditions',
      completeness: 'unknown',
      reason: 'Provider does not certify complete station or grid coverage.',
    },
    limitations: [
      'The current-conditions field is gridded model output, not a station observation.',
      'The provider did not supply a model issue time or uncertainty estimate.',
      ...(!Number.isFinite(validAt)
        ? ['The provider did not supply a valid time.']
        : []),
      ...(!locationKnown ? ['The query location was not available.'] : []),
      'No retention metadata was supplied with this response.',
    ],
  });
}
