const SOURCE_ORDINAL_PREFIX = '__gev_cable_source_ordinal_v1';

/**
 * Copy normalized GeoJSON features with a temporary source ordinal. Cesium
 * keeps the original Feature ID (including its normal duplicate-ID suffixing)
 * for every expanded geometry part, while the PropertyBag ordinal lets us
 * recover the exact parent feature without relying on Entity enumeration.
 */
export function withSourceOrdinals(features) {
  if (!Array.isArray(features)) {
    throw new TypeError('GeoJSON features must be an array.');
  }
  const usedNames = new Set(
    features.flatMap((feature) => Object.keys(feature?.properties || {})),
  );
  let propertyName = SOURCE_ORDINAL_PREFIX;
  for (let suffix = 1; usedNames.has(propertyName); suffix += 1) {
    propertyName = SOURCE_ORDINAL_PREFIX + '_' + suffix;
  }
  return {
    propertyName,
    features: features.map((feature, index) => ({
      ...feature,
      properties: { ...feature?.properties, [propertyName]: index },
    })),
  };
}

/** Remove the temporary field from GeoJSON copies after Cesium has loaded them. */
export function clearSourceOrdinalAnnotations({ features, propertyName }) {
  if (!Array.isArray(features)) return;
  for (const feature of features) {
    if (
      feature?.properties &&
      Object.hasOwn(feature.properties, propertyName)
    ) {
      delete feature.properties[propertyName];
    }
  }
}

/**
 * Group loaded Cesium Entities by their temporary parent-feature ordinal and
 * remove that property from every Entity. This binds every Multi* segment to
 * its true source record while leaving public Cesium Entity IDs untouched.
 */
export function groupEntitiesBySourceOrdinal(
  entities,
  { features, propertyName },
) {
  const featureCount = features.length;
  if (
    !Array.isArray(entities) ||
    !Number.isSafeInteger(featureCount) ||
    featureCount < 0
  ) {
    throw new TypeError(
      'Loaded Entities and source feature count are invalid.',
    );
  }
  const groups = Array.from({ length: featureCount }, () => []);
  const values = {};
  let failure = null;
  try {
    for (const entity of entities) {
      const properties = entity?.properties;
      if (!properties?.hasProperty?.(propertyName)) {
        throw new Error('A loaded Entity is missing its source ordinal.');
      }
      properties.getValue(undefined, values);
      const ordinal = values[propertyName];
      if (
        !Number.isSafeInteger(ordinal) ||
        ordinal < 0 ||
        ordinal >= featureCount
      ) {
        throw new Error('A loaded Entity has an invalid source ordinal.');
      }
      groups[ordinal].push(entity);
    }
  } catch (error) {
    failure = error;
  } finally {
    for (const entity of entities) {
      const properties = entity?.properties;
      if (properties?.hasProperty?.(propertyName)) {
        properties.removeProperty(propertyName);
      }
    }
  }
  if (failure) throw failure;
  return groups;
}

export function featureReference(feature) {
  const geometry = feature?.geometry;
  if (!geometry) return null;

  const props = feature?.properties || {};
  const propertyCoords = coordsFromProperty(props.coordinates);
  if (propertyCoords) {
    return {
      lon: propertyCoords[0],
      lat: propertyCoords[1],
    };
  }

  if (geometry.type === 'Point') {
    const coords = coordsFromPoint(geometry.coordinates);
    if (!coords) return null;
    return { lon: coords[0], lat: coords[1] };
  }

  const coords = [];
  collectLonLat(geometry.coordinates, coords);
  if (!coords.length) return null;

  let lonSum = 0;
  let latSum = 0;
  for (const [lon, lat] of coords) {
    lonSum += lon;
    latSum += lat;
  }
  return {
    lon: lonSum / coords.length,
    lat: latSum / coords.length,
  };
}

export function coordsFromProperty(value) {
  if (!Array.isArray(value) || value.length < 2) return null;
  const lon = Number(value[0]);
  const lat = Number(value[1]);
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
  return [lon, lat];
}

export function coordsFromPoint(value) {
  if (!Array.isArray(value) || value.length < 2) return null;
  const lon = Number(value[0]);
  const lat = Number(value[1]);
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
  return [lon, lat];
}

export function collectLonLat(value, out) {
  if (!Array.isArray(value)) return;
  if (typeof value[0] === 'number' && typeof value[1] === 'number') {
    const lon = Number(value[0]);
    const lat = Number(value[1]);
    if (Number.isFinite(lon) && Number.isFinite(lat)) {
      out.push([lon, lat]);
    }
    return;
  }
  for (const child of value) collectLonLat(child, out);
}

export function featureLabel(feature) {
  const props = feature?.properties || {};
  return String(props.name || props.id || feature?.id || '').trim();
}

/**
 * Plain source identity shared by analyst/pick paths and Cesium render objects.
 * It deliberately contains no Entity or graphics state, so rebuilding a data
 * source cannot make an old render object resolve as the active feature.
 */
export function createCableFeatureRecord(feature, kind, reference) {
  if (!feature || !reference || !['cable', 'landing-point'].includes(kind))
    return null;
  const id = String(feature.id || feature.properties?.id || '');
  if (!id) return null;
  const stableReference = Object.freeze({
    lon: reference.lon,
    lat: reference.lat,
  });
  return Object.freeze({
    id,
    featureId: id,
    identity: `${kind}:${id}`,
    kind,
    label: featureLabel(feature),
    reference: stableReference,
  });
}

export function normalizeFeatures(json, kind) {
  const features = Array.isArray(json?.features) ? json.features : [];
  return features.map((feature, index) => {
    const id = feature?.properties?.id || feature?.id || `${kind}-${index}`;
    return {
      ...feature,
      id: String(id),
    };
  });
}
