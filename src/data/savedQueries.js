import { ANALYST_LAYERS, normalizeAnalystSpec } from './analystEngine.js';

export const SAVED_QUERY_LIMIT = 100;

/** Parse and validate editable query intent before it enters a workspace. */
export function parseSavedQuery(input) {
  if (!input || typeof input !== 'object' || input.version !== 1)
    throw new TypeError('Saved query version is unsupported.');
  const id = String(input.id || '').trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(id))
    throw new TypeError('Saved query id is invalid.');
  const name = String(input.name || '')
    .trim()
    .slice(0, 100);
  if (!name) throw new TypeError('Saved query needs a name.');
  const query = input.query;
  if (!query || typeof query !== 'object')
    throw new TypeError('Saved query intent is missing.');
  const layers = [
    ...new Set(Array.isArray(query.layers) ? query.layers.map(String) : []),
  ];
  if (
    !layers.length ||
    layers.length > 8 ||
    layers.some((key) => !ANALYST_LAYERS[key])
  )
    throw new TypeError('Select one to eight supported query layers.');
  const limit = query.limit ?? 50;
  if (!Number.isInteger(limit) || limit < 1 || limit > 500)
    throw new TypeError('Query result limit must be between 1 and 500.');
  const scope = query.scope || { kind: 'anywhere' };
  if (!['anywhere', 'view', 'radius', 'region'].includes(scope.kind))
    throw new TypeError('Query scope is unsupported.');
  const filters = Array.isArray(query.filters) ? query.filters : [];
  if (filters.length > 8)
    throw new TypeError('Saved query accepts at most eight filters.');
  const normalized = normalizeAnalystSpec(
    {
      layers,
      scope,
      filters,
      sortBy: query.sortBy || null,
      sortDir: query.sortDir || 'asc',
      limit,
    },
    layers,
  );
  if (!normalized)
    throw new TypeError(
      'Query fields, operators, values, or units are invalid for these layers.',
    );
  return Object.freeze({
    version: 1,
    id,
    name,
    updatedAt: Number.isSafeInteger(input.updatedAt) ? input.updatedAt : 0,
    query: Object.freeze({
      layers: Object.freeze(layers),
      scope: Object.freeze({ ...normalized.scope }),
      filters: Object.freeze(
        normalized.filters.map((filter) =>
          Object.freeze({
            field: filter.field,
            op: filter.op,
            value: filter.value,
          }),
        ),
      ),
      sortBy: normalized.sortBy || null,
      sortDir: normalized.sortDir || 'asc',
      limit,
    }),
  });
}

export function parseSavedQueryList(input) {
  if (!Array.isArray(input) || input.length > SAVED_QUERY_LIMIT)
    throw new RangeError(
      `A workspace can hold at most ${SAVED_QUERY_LIMIT} saved queries.`,
    );
  const items = input.map(parseSavedQuery);
  if (new Set(items.map((item) => item.id)).size !== items.length)
    throw new TypeError('Saved query ids must be unique.');
  return Object.freeze(items);
}
