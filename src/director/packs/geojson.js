import { PACK_LIMITS } from './manifest.js';

/**
 * Incrementally validate and normalize one geometry feature. Each coordinate
 * yields in small coordinate batches, allowing import previews to share the
 * exact pack validation rules while honoring their cooperative time budget.
 */
export function* validatePackGeoJSONFeature(
  feature,
  {
    id = feature?.id,
    seenIds = null,
    maximumPositions = PACK_LIMITS.positions,
    cooperative = true,
    includeBounds = true,
  } = {},
) {
  if (
    feature?.type !== 'Feature' ||
    typeof id !== 'string' ||
    !id.trim() ||
    id.length > 256 ||
    seenIds?.has(id)
  )
    throw new Error('Features require distinct string IDs');

  let positions = 0;
  const bounds = [Infinity, Infinity, -Infinity, -Infinity];
  const cooperativeBatchSize = 32;
  function position(point) {
    if (
      !Array.isArray(point) ||
      ![2, 3].includes(point.length) ||
      point.some((value) => !Number.isFinite(value)) ||
      Math.abs(point[0]) > 180 ||
      Math.abs(point[1]) > 90 ||
      (point.length === 3 && (point[2] < -12000 || point[2] > 1e9)) ||
      ++positions > maximumPositions
    )
      throw new Error('Invalid geographic position');
    const normalized = [point[0], point[1], point[2] ?? 0];
    if (includeBounds) {
      bounds[0] = Math.min(bounds[0], normalized[0]);
      bounds[1] = Math.min(bounds[1], normalized[1]);
      bounds[2] = Math.max(bounds[2], normalized[0]);
      bounds[3] = Math.max(bounds[3], normalized[1]);
    }
    return normalized;
  }

  function* line(points, ring = false) {
    if (!Array.isArray(points) || points.length < (ring ? 4 : 2))
      throw new Error('Invalid line');
    let normalized;
    if (!cooperative) {
      normalized = points.map(position);
    } else {
      normalized = [];
      for (const point of points) {
        normalized.push(position(point));
        if (positions % cooperativeBatchSize === 0) yield;
      }
    }
    if (
      ring &&
      normalized[0].some((value, index) => value !== normalized.at(-1)[index])
    )
      throw new Error('Unclosed ring');
    return normalized;
  }

  const geometry = feature.geometry;
  let coordinates;
  if (geometry?.type === 'Point') {
    coordinates = position(geometry.coordinates);
    if (cooperative && positions % cooperativeBatchSize === 0) yield;
  } else if (geometry?.type === 'LineString')
    coordinates = yield* line(geometry.coordinates);
  else if (
    geometry?.type === 'Polygon' &&
    Array.isArray(geometry.coordinates) &&
    geometry.coordinates.length &&
    geometry.coordinates.length <= 128
  ) {
    coordinates = [];
    for (const ring of geometry.coordinates)
      coordinates.push(yield* line(ring, true));
  } else throw new Error('Unsupported geometry');

  return {
    id,
    type: geometry.type,
    coordinates,
    positionCount: positions,
    bounds: positions && includeBounds ? bounds : null,
  };
}

/** Decode a bounded geometry-only GeoJSON collection. */
export function decodePackGeoJSON(bytes) {
  const value = JSON.parse(
    new TextDecoder('utf-8', { fatal: true }).decode(bytes),
  );
  if (
    value?.type !== 'FeatureCollection' ||
    !Array.isArray(value.features) ||
    value.features.length > PACK_LIMITS.features
  )
    throw new Error('Expected a bounded FeatureCollection');
  let positions = 0;
  const ids = new Set();
  const decoded = [];
  for (const feature of value.features) {
    const validator = validatePackGeoJSONFeature(feature, {
      seenIds: ids,
      maximumPositions: PACK_LIMITS.positions - positions,
      cooperative: false,
      includeBounds: false,
    });
    let step = validator.next();
    while (!step.done) step = validator.next();
    const result = step.value;
    positions += result.positionCount;
    ids.add(result.id);
    decoded.push({
      id: result.id,
      type: result.type,
      coordinates: result.coordinates,
    });
  }
  return decoded;
}
