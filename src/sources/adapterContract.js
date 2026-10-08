import { createEvidenceEnvelope } from '../evidence/evidence.js';

export const SOURCE_ADAPTER_LIMITS = Object.freeze({
  records: 5_000,
  idLength: 128,
});

function abortError() {
  return new DOMException('Source read was cancelled.', 'AbortError');
}

function normalizeObservation(input, { sourceId, sourceUrl, receivedAt, now }) {
  const id = String(input?.id ?? '').trim();
  const lat = Number(input?.lat);
  const lon = Number(input?.lon);
  if (!id || id.length > SOURCE_ADAPTER_LIMITS.idLength)
    throw new TypeError('Source observations need a bounded stable id.');
  if (
    !Number.isFinite(lat) ||
    lat < -90 ||
    lat > 90 ||
    !Number.isFinite(lon) ||
    lon < -180 ||
    lon > 180
  )
    throw new TypeError(`Observation ${id} has invalid WGS84 coordinates.`);
  const observedAt = input.observedAt == null ? null : Number(input.observedAt);
  if (
    observedAt != null &&
    (!Number.isSafeInteger(observedAt) || observedAt < 0)
  )
    throw new TypeError(`Observation ${id} has an invalid observedAt value.`);
  const evidence = createEvidenceEnvelope({
    entityRef: { layerKey: sourceId, id },
    sourceId,
    sourceUrl,
    sourceRecordId: input.sourceRecordId || id,
    observedAt,
    receivedAt,
    method: 'observed',
    feedState: 'nominal',
    coverage: { completeness: 'unknown' },
    limitations: [
      'The adapter does not claim coverage outside the returned records.',
    ],
    now,
  });
  const properties = {};
  for (const [key, value] of Object.entries(input.properties || {}).slice(
    0,
    48,
  )) {
    if (!/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(key)) continue;
    if (typeof value === 'string') properties[key] = value.slice(0, 500);
    else if (typeof value === 'number' && Number.isFinite(value))
      properties[key] = value;
    else if (typeof value === 'boolean' || value === null)
      properties[key] = value;
  }
  return Object.freeze({
    id,
    lat,
    lon,
    observedAt,
    properties: Object.freeze(properties),
    evidence,
  });
}

/** Build a bounded, cancellation-aware adapter around one source acquisition function. */
export function createSourceAdapter({
  id,
  label,
  attribution,
  acquire,
  capabilities = { temporalModes: ['live'] },
  retention = { record: false, export: false },
  now = () => Date.now(),
} = {}) {
  const sourceId = String(id || '').trim();
  const name = String(label || '').trim();
  if (
    !/^[a-z0-9][a-z0-9-]{0,63}$/.test(sourceId) ||
    !name ||
    typeof acquire !== 'function'
  )
    throw new TypeError(
      'Source adapter requires an id, label, and acquire function.',
    );
  if (
    !Array.isArray(capabilities.temporalModes) ||
    !capabilities.temporalModes.length
  )
    throw new TypeError('Source adapter must declare its temporal modes.');
  const permissions = Object.freeze({
    record: retention.record === true,
    export: retention.export === true,
    reason: String(
      retention.reason ||
        'Retention is disabled unless the source policy explicitly permits it.',
    ).slice(0, 500),
  });

  return Object.freeze({
    id: sourceId,
    label: name,
    attribution: String(attribution || '').slice(0, 500),
    capabilities: Object.freeze({
      temporalModes: Object.freeze([...capabilities.temporalModes]),
    }),
    retention: permissions,
    async read({ signal } = {}) {
      if (signal?.aborted) throw abortError();
      const raw = await acquire({ signal });
      if (signal?.aborted) throw abortError();
      if (!Array.isArray(raw?.observations))
        throw new TypeError('Source acquisition must return observations.');
      if (raw.observations.length > SOURCE_ADAPTER_LIMITS.records)
        throw new RangeError(
          `Source returned more than ${SOURCE_ADAPTER_LIMITS.records} records.`,
        );
      const receivedAt = now();
      return Object.freeze({
        sourceId,
        receivedAt,
        coverage: Object.freeze({
          ...(raw.coverage || {}),
          completeness: raw.coverage?.completeness || 'unknown',
        }),
        observations: Object.freeze(
          raw.observations.map((item) =>
            normalizeObservation(item, {
              sourceId,
              sourceUrl: raw.sourceUrl || null,
              receivedAt,
              now,
            }),
          ),
        ),
      });
    },
  });
}

/** Run common contributor checks against an adapter without installing its data. */
export async function runSourceAdapterConformance(adapter) {
  if (
    !adapter ||
    typeof adapter.read !== 'function' ||
    !adapter.capabilities ||
    !adapter.retention
  )
    throw new TypeError('Adapter is missing the documented source contract.');
  const controller = new AbortController();
  controller.abort('conformance');
  let cancelled = false;
  try {
    await adapter.read({ signal: controller.signal });
  } catch (error) {
    cancelled = error?.name === 'AbortError';
  }
  if (!cancelled)
    throw new Error('Adapter ignored an already-aborted read signal.');
  const result = await adapter.read({ signal: new AbortController().signal });
  if (
    !Array.isArray(result?.observations) ||
    result.observations.length > SOURCE_ADAPTER_LIMITS.records
  )
    throw new Error(
      'Adapter returned an invalid or oversized observation set.',
    );
  for (const row of result.observations) {
    if (!row?.evidence?.version || row.evidence.entityRef?.id !== row.id)
      throw new Error(
        `Observation ${row?.id || '(unknown)'} has no matching evidence reference.`,
      );
  }
  return Object.freeze({
    id: adapter.id,
    count: result.observations.length,
    cancelled: true,
  });
}
