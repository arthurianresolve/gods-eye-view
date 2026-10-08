export const MAX_RECORDING_RADIUS_KM = 250;
const EARTH_RADIUS_KM = 6371.0088;

function coordinate(value, minimum, maximum, label) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < minimum || number > maximum)
    throw new RangeError(`${label} must be between ${minimum} and ${maximum}`);
  return number;
}

export function validateRecordingRegion(region = {}) {
  const center = region.center || region;
  const latitude = coordinate(
    center.latitude ?? center.lat,
    -90,
    90,
    'Latitude',
  );
  const longitude = coordinate(
    center.longitude ?? center.lon,
    -180,
    180,
    'Longitude',
  );
  const radiusKm = coordinate(
    region.radiusKm,
    0.01,
    MAX_RECORDING_RADIUS_KM,
    'Radius',
  );
  return Object.freeze({
    center: Object.freeze({ latitude, longitude }),
    radiusKm,
  });
}

function radians(degrees) {
  return (degrees * Math.PI) / 180;
}

export function distanceBetweenKm(first, second) {
  const lat1 = radians(
    coordinate(first.latitude ?? first.lat, -90, 90, 'Latitude'),
  );
  const lat2 = radians(
    coordinate(second.latitude ?? second.lat, -90, 90, 'Latitude'),
  );
  const deltaLat = lat2 - lat1;
  const deltaLon = radians(
    coordinate(second.longitude ?? second.lon, -180, 180, 'Longitude') -
      coordinate(first.longitude ?? first.lon, -180, 180, 'Longitude'),
  );
  const a =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLon / 2) ** 2;
  return EARTH_RADIUS_KM * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function isWithinRecordingRegion(region, observation) {
  const point = {
    latitude: observation.latitude ?? observation.lat,
    longitude: observation.longitude ?? observation.lon,
  };
  try {
    return distanceBetweenKm(region.center, point) <= region.radiusKm;
  } catch {
    return false;
  }
}
