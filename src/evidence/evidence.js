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

const KNOWN_SOURCE_URLS = Object.freeze([
  { match: /opensky/i, url: 'https://opensky-network.org/' },
  { match: /adsb\.lol/i, url: 'https://www.adsb.lol/' },
  { match: /aisstream/i, url: 'https://aisstream.io/' },
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
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password) return null;
    return `${url.origin}${url.pathname}`;
  } catch {
    return null;
  }
}

function optionalText(value, maxLength = 240) {
  if (typeof value !== 'string') return null;
  const clean = value.trim().slice(0, maxLength);
  return clean || null;
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
  const validFrom = evidenceInstant(input.validFrom);
  const validTo = evidenceInstant(input.validTo);
  const issuedAt = evidenceInstant(input.issuedAt);
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
    observationId:
      optionalText(input.observationId, 240) ||
      (layerKey && entityId
        ? `${layerKey}:${entityId}:${observedAt ?? 'time-unknown'}`
        : null),
    entityRef: Object.freeze({ layerKey, id: entityId }),
    sourceId: optionalText(input.sourceId, 120),
    sourceRecordId: optionalText(input.sourceRecordId, 160),
    sourceUrl: safeEvidenceUrl(input.sourceUrl),
    observedAt,
    receivedAt,
    snapshotAt,
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
