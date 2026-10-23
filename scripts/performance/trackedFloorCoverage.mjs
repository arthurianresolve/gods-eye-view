/** Build a bounded corridor of coarse cells for a moving tracked-floor fixture. */
export function buildTrackedFloorCoverage({
  start,
  feedFix,
  trackDeg,
  velocityMps,
  horizonMs,
  maxCells = 64,
  maxSamples = 1024,
  sampleSpacingM = 12,
}) {
  const EARTH_RADIUS_M = 6371008.8;
  const FLOOR_CELL_DEG = 0.001;
  const finitePoint = (point) =>
    point && Number.isFinite(point.lat) && Number.isFinite(point.lon);
  if (
    !finitePoint(start) ||
    !finitePoint(feedFix) ||
    ![
      trackDeg,
      velocityMps,
      horizonMs,
      maxCells,
      maxSamples,
      sampleSpacingM,
    ].every(Number.isFinite) ||
    velocityMps <= 0 ||
    horizonMs <= 0 ||
    maxCells < 1 ||
    maxSamples < 1 ||
    sampleSpacingM <= 0
  ) {
    return { error: 'invalid tracked-floor route input' };
  }

  const radians = (value) => (value * Math.PI) / 180;
  const degrees = (value) => (value * 180) / Math.PI;
  const destination = (origin, distanceM) => {
    const angular = distanceM / EARTH_RADIUS_M;
    const bearing = radians(trackDeg);
    const lat1 = radians(origin.lat);
    const lon1 = radians(origin.lon);
    const lat2 = Math.asin(
      Math.sin(lat1) * Math.cos(angular) +
        Math.cos(lat1) * Math.sin(angular) * Math.cos(bearing),
    );
    const lon2 =
      lon1 +
      Math.atan2(
        Math.sin(bearing) * Math.sin(angular) * Math.cos(lat1),
        Math.cos(angular) - Math.sin(lat1) * Math.sin(lat2),
      );
    return { lat: degrees(lat2), lon: degrees(lon2) };
  };
  const distanceM = (a, b) => {
    const lat1 = radians(a.lat),
      lat2 = radians(b.lat);
    const dLat = lat2 - lat1,
      dLon = radians(b.lon - a.lon);
    const h =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
    return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
  };
  const roundCell = (value) => Number(value.toFixed(3));
  const endpoint = destination(feedFix, (velocityMps * horizonMs) / 1000);
  const cells = new Map();
  let sampledPoints = 0;
  const addLeg = (from, to) => {
    const length = distanceM(from, to);
    const steps = Math.max(1, Math.ceil(length / sampleSpacingM));
    if (!Number.isFinite(steps) || steps > maxSamples) return false;
    for (let step = 0; step <= steps; step++) {
      if (++sampledPoints > maxSamples) return false;
      const t = step / steps;
      const point = {
        lat: from.lat + (to.lat - from.lat) * t,
        lon: from.lon + (to.lon - from.lon) * t,
      };
      const center = { lat: roundCell(point.lat), lon: roundCell(point.lon) };
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const cell = {
            lat: roundCell(center.lat + dy * FLOOR_CELL_DEG),
            lon: roundCell(center.lon + dx * FLOOR_CELL_DEG),
          };
          cells.set(`${cell.lat},${cell.lon}`, cell);
          if (cells.size > maxCells) return false;
        }
      }
    }
    return true;
  };

  if (!addLeg(start, feedFix) || !addLeg(feedFix, endpoint)) {
    return {
      error: 'tracked-floor route exceeds construction bounds',
      sampledPoints,
      cellCount: cells.size,
    };
  }
  return {
    start: { lat: start.lat, lon: start.lon },
    feedFix: { lat: feedFix.lat, lon: feedFix.lon },
    endpoint,
    trackDeg,
    velocityMps,
    horizonMs,
    forwardDistanceM: (velocityMps * horizonMs) / 1000,
    sampledPoints,
    cells: [...cells.values()],
  };
}

/** Evidence for a live checkpoint; the caller supplies the actual mesh read. */
export function trackedFloorCoverageSample({
  position,
  startedAtMs,
  nowMs,
  route,
  meshFloor,
}) {
  const EARTH_RADIUS_M = 6371008.8;
  if (
    !position ||
    !Number.isFinite(position.lat) ||
    !Number.isFinite(position.lon) ||
    !Number.isFinite(position.heightM) ||
    !Number.isFinite(startedAtMs) ||
    !Number.isFinite(nowMs) ||
    !route ||
    !Array.isArray(route.cells)
  )
    return null;
  const actualCell = {
    lat: Number(position.lat.toFixed(3)),
    lon: Number(position.lon.toFixed(3)),
  };
  const cellKey = `${actualCell.lat},${actualCell.lon}`;
  const keys = new Set(route.cells.map((cell) => `${cell.lat},${cell.lon}`));
  const elapsedMs = nowMs - startedAtMs;
  const radians = (value) => (value * Math.PI) / 180;
  const lat1 = radians(route.start.lat),
    lat2 = radians(position.lat);
  const dLat = lat2 - lat1,
    dLon = radians(position.lon - route.start.lon);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return {
    elapsedMs,
    position: { ...position },
    actualCell,
    distanceFromStartM: 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h)),
    meshFloor,
    withinSeededRoute: keys.has(cellKey),
    withinTimeBound: elapsedMs >= 0 && elapsedMs <= route.horizonMs,
  };
}

export function trackedFloorCoverageSamplePasses(sample, seededFloorM) {
  return (
    !!sample &&
    sample.withinSeededRoute === true &&
    sample.withinTimeBound === true &&
    sample.meshFloor === seededFloorM
  );
}
