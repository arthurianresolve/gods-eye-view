/** Versioned, plain-data provenance for a source observation. */
export const EVIDENCE_VERSION = 1;

export const EVIDENCE_METHODS = Object.freeze([
  'observed',
  'interpolated',
  'predicted',
  'simulated',
  'reconstructed',
  'unknown',
]);

export const EVIDENCE_COMPLETENESS = Object.freeze([
  'complete',
  'partial',
  'unknown',
]);
export const EVIDENCE_FEED_STATES = Object.freeze([
  'nominal',
  'loading',
  'degraded',
  'partial',
  'stale',
  'fallback',
  'unavailable',
  'off',
  'unknown',
]);
export const EVIDENCE_REFERENCE_KINDS = Object.freeze([
  'source',
  'archive',
  'peeringdb',
  'user-linked',
]);
export const MAX_EVIDENCE_REFERENCES = 8;

const KNOWN_SOURCE_URLS = Object.freeze([
  { match: /opensky/i, url: 'https://opensky-network.org/' },
  { match: /adsb\.lol/i, url: 'https://www.adsb.lol/' },
  { match: /aisstream/i, url: 'https://aisstream.io/' },
  { match: /usgs/i, url: 'https://earthquake.usgs.gov/' },
  {
    match: /nasa\s*firms|firms/i,
    url: 'https://firms.modaps.eosdis.nasa.gov/',
  },
  {
    match: /noaa\s*gfs/i,
    url: 'https://www.ncei.noaa.gov/products/weather-climate-models/global-forecast',
  },
  { match: /ecmwf|ifs/i, url: 'https://www.ecmwf.int/en/forecasts' },
  { match: /open\s*-?\s*meteo/i, url: 'https://open-meteo.com/en/docs' },
]);

/** Homepage for a known provider label, or null when no mapping is defined. */
export function knownEvidenceSourceUrl(sourceId) {
  const entry = KNOWN_SOURCE_URLS.find(({ match }) =>
    match.test(sourceId || ''),
  );
  return entry?.url || null;
}

/** Accept a finite epoch or parseable date string; keep absence as null. */
export function evidenceInstant(value) {
  if (value == null || value === '') return null;
  const instant = typeof value === 'number' ? value : Date.parse(value);
  return Number.isFinite(instant) && instant > 0 ? instant : null;
}

/** Remove URL credentials, query values and fragments before displaying a source. */
export function safeEvidenceUrl(value) {
  const safe = safeReferenceUrl(value);
  if (!safe) return null;
  try {
    const url = new URL(safe);
    return `${url.origin}${url.pathname}`;
  } catch {
    return null;
  }
}

/** Keep a public HTTPS reference while preserving harmless query parameters. */
export function safeReferenceUrl(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > 4096)
    return null;
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase().replace(/\.$/, '');
    const ipv6 = host.startsWith('[') ? host.slice(1, -1) : '';
    const mappedMatch = ipv6.match(
      /^::ffff:(?:([\da-f]{1,4}):([\da-f]{1,4})|(\d+\.\d+\.\d+\.\d+))$/i,
    );
    const mappedIpv4 =
      mappedMatch?.[3] ||
      (mappedMatch
        ? `${parseInt(mappedMatch[1], 16) >> 8}.${parseInt(mappedMatch[1], 16) & 255}.${parseInt(mappedMatch[2], 16) >> 8}.${parseInt(mappedMatch[2], 16) & 255}`
        : null);
    const address = mappedIpv4 || host;
    const octets = /^\d+\.\d+\.\d+\.\d+$/.test(address)
      ? address.split('.').map(Number)
      : null;
    const privateIpv4 =
      octets &&
      ([0, 10, 127].includes(octets[0]) ||
        octets[0] >= 224 ||
        (octets[0] === 100 && octets[1] >= 64 && octets[1] <= 127) ||
        (octets[0] === 169 && octets[1] === 254) ||
        (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
        (octets[0] === 192 && octets[1] === 168) ||
        (octets[0] === 198 && [18, 19].includes(octets[1])));
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      (!ipv6 && !host.includes('.')) ||
      host === 'localhost' ||
      /\.(localhost|local|internal|home|lan)$/.test(host) ||
      host === '0.0.0.0' ||
      /^(127\.|10\.|192\.168\.|169\.254\.)/.test(host) ||
      /^172\.(1[6-9]|2\d|3[0-1])\./.test(host) ||
      ipv6 === '::1' ||
      ipv6 === '::' ||
      privateIpv4 ||
      /^(fc|fd|fe[89ab]|ff)/i.test(ipv6)
    )
      return null;
    url.hash = '';
    return url.toString();
  } catch {
    return null;
  }
}

/** Accept only a public PeeringDB facility path for an explicitly user-linked reference. */
export function safePeeringDbFacilityUrl(value) {
  const safe = safeReferenceUrl(value);
  if (!safe) return null;
  try {
    const url = new URL(safe);
    if (
      url.hostname !== 'www.peeringdb.com' &&
      url.hostname !== 'peeringdb.com'
    )
      return null;
    return !url.port && /^\/fac\/[1-9]\d*\/?$/.test(url.pathname)
      ? 'https://www.peeringdb.com' + url.pathname.replace(/\/$/, '')
      : null;
  } catch {
    return null;
  }
}

function optionalText(value, maxLength = 240) {
  if (typeof value !== 'string') return null;
  const clean = value.trim().slice(0, maxLength);
  return clean || null;
}

function normalizeReference(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const url = safeReferenceUrl(value.url);
  if (!url) return null;
  const kind = EVIDENCE_REFERENCE_KINDS.includes(value.kind)
    ? value.kind
    : 'user-linked';
  const archiveAt = evidenceInstant(value.archiveAt);
  const lookedUpAt = evidenceInstant(value.lookedUpAt);
  return Object.freeze({
    kind,
    url,
    title: optionalText(value.title, 160),
    originalUrl: safeReferenceUrl(value.originalUrl),
    archiveAt,
    lookedUpAt,
  });
}

/** Strict import boundary; legacy envelopes without references remain valid. */
export function validateEvidenceReferences(evidence) {
  if (!evidence || !Object.hasOwn(evidence, 'references')) return;
  if (
    !Array.isArray(evidence.references) ||
    evidence.references.length > MAX_EVIDENCE_REFERENCES
  )
    throw new TypeError('Evidence references must be a bounded list.');
  for (const reference of evidence.references) {
    if (
      !reference ||
      Array.isArray(reference) ||
      !EVIDENCE_REFERENCE_KINDS.includes(reference.kind) ||
      !safeReferenceUrl(reference.url) ||
      (reference.originalUrl != null &&
        !safeReferenceUrl(reference.originalUrl))
    )
      throw new TypeError('Evidence reference has an unsafe URL or kind.');
    if (
      reference.title != null &&
      (typeof reference.title !== 'string' || reference.title.length > 160)
    )
      throw new TypeError('Evidence reference title is invalid.');
    for (const field of ['archiveAt', 'lookedUpAt']) {
      if (reference[field] != null && evidenceInstant(reference[field]) == null)
        throw new TypeError('Evidence reference timestamp is invalid.');
    }
  }
}

/**
 * Build a small immutable envelope. This never treats local receipt as source
 * observation time and never derives a confidence value.
 */
export function createEvidenceEnvelope(input = {}) {
  const entityRef = input.entityRef || {};
  const layerKey = optionalText(entityRef.layerKey, 80);
  const entityId = optionalText(entityRef.id, 160);
  const now = evidenceInstant(input.now) ?? Date.now();
  const rawObservedAt = evidenceInstant(input.observedAt);
  const rawReceivedAt = evidenceInstant(input.receivedAt);
  const observedAt =
    rawObservedAt != null && rawObservedAt <= now ? rawObservedAt : null;
  const receivedAt =
    rawReceivedAt != null && rawReceivedAt <= now ? rawReceivedAt : null;
  const snapshotAt = evidenceInstant(input.snapshotAt);
  const displayTime = evidenceInstant(input.displayTime);
  const elementEpoch = evidenceInstant(input.elementEpoch);
  const validFrom = evidenceInstant(input.validFrom);
  const validTo = evidenceInstant(input.validTo);
  const issuedAt = evidenceInstant(input.issuedAt);
  const references = Object.freeze(
    (Array.isArray(input.references) ? input.references : [])
      .map(normalizeReference)
      .filter(Boolean)
      .slice(0, MAX_EVIDENCE_REFERENCES),
  );
  const method = EVIDENCE_METHODS.includes(input.method)
    ? input.method
    : 'unknown';
  const completeness = EVIDENCE_COMPLETENESS.includes(
    input.coverage?.completeness,
  )
    ? input.coverage.completeness
    : 'unknown';
  const count = Number(input.coverage?.count);

  return Object.freeze({
    version: EVIDENCE_VERSION,
    ...(input.cameraHealth && typeof input.cameraHealth === 'object'
      ? {
          cameraHealth: Object.freeze({
            sourceStatus: optionalText(input.cameraHealth.sourceStatus, 40),
            sourceKind: optionalText(input.cameraHealth.sourceKind, 40),
            healthReason: optionalText(input.cameraHealth.healthReason, 80),
            upstreamReasonCode: optionalText(
              input.cameraHealth.upstreamReasonCode,
              80,
            ),
            transportStatus: optionalText(
              input.cameraHealth.transportStatus,
              40,
            ),
            healthAttemptedAt: evidenceInstant(
              input.cameraHealth.healthAttemptedAt,
            ),
            healthLastSuccessAt: evidenceInstant(
              input.cameraHealth.healthLastSuccessAt,
            ),
            decodeStatus: optionalText(input.cameraHealth.decodeStatus, 40),
            decodeReason: optionalText(input.cameraHealth.decodeReason, 80),
            decodeAttemptedAt: evidenceInstant(
              input.cameraHealth.decodeAttemptedAt,
            ),
            decodeLastSuccessAt: evidenceInstant(
              input.cameraHealth.decodeLastSuccessAt,
            ),
            videoFallback: input.cameraHealth.videoFallback === true,
          }),
        }
      : {}),
    observationId:
      optionalText(input.observationId, 240) ||
      (layerKey && entityId
        ? `${layerKey}:${entityId}:${observedAt ?? 'time-unknown'}`
        : null),
    entityRef: Object.freeze({ layerKey, id: entityId }),
    sourceId: optionalText(input.sourceId, 120),
    sourceRecordId: optionalText(input.sourceRecordId, 160),
    sourceUrl: safeEvidenceUrl(input.sourceUrl),
    references,
    observedAt,
    receivedAt,
    snapshotAt,
    displayTime,
    elementEpoch,
    validFrom,
    validTo,
    issuedAt,
    method,
    derivationRefs: Object.freeze(
      (Array.isArray(input.derivationRefs) ? input.derivationRefs : [])
        .map((value) => optionalText(value, 240))
        .filter(Boolean)
        .slice(0, 8),
    ),
    displayMethod: EVIDENCE_METHODS.includes(input.displayMethod)
      ? input.displayMethod
      : 'unknown',
    feedState: EVIDENCE_FEED_STATES.includes(input.feedState)
      ? input.feedState
      : 'unknown',
    coverage: Object.freeze({
      area: optionalText(input.coverage?.area, 240),
      intervalStart: evidenceInstant(input.coverage?.intervalStart),
      intervalEnd: evidenceInstant(input.coverage?.intervalEnd),
      completeness,
      truncated: input.coverage?.truncated === true,
      count: Number.isFinite(count) && count >= 0 ? count : null,
      reason: optionalText(input.coverage?.reason),
    }),
    uncertainty: Object.freeze({
      value:
        Number.isFinite(input.uncertainty?.value) &&
        input.uncertainty.value >= 0
          ? input.uncertainty.value
          : null,
      unit: optionalText(input.uncertainty?.unit, 40),
      kind: optionalText(input.uncertainty?.kind, 80),
    }),
    licenseRef: optionalText(input.licenseRef, 120),
    retentionPolicyId: optionalText(input.retentionPolicyId, 120),
    limitations: Object.freeze(
      [
        ...(Array.isArray(input.limitations) ? input.limitations : []),
        rawObservedAt != null && observedAt == null
          ? 'Source observation time is in the future and was not accepted.'
          : null,
        rawReceivedAt != null && receivedAt == null
          ? 'Local receipt time is in the future and was not accepted.'
          : null,
      ]
        .map((value) => optionalText(value, 240))
        .filter(Boolean)
        .slice(0, 8),
    ),
  });
}

/** Normalize legacy or current evidence to a safe immutable envelope. */
export function normalizeEvidence(value = {}) {
  return createEvidenceEnvelope(value);
}
