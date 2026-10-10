/** Browser-evaluable snapshot of the public Cesium tracked entity at one epoch. */
export function observeTrackedEntityBoundary(expectedIdentity) {
  const app = window.__godsEyeView;
  const viewer = app?.viewer;
  const entity = viewer?.trackedEntity;
  const dateMs = Date.now();
  const currentTime = viewer?.clock?.currentTime;
  const JulianDate = window.Cesium?.JulianDate || currentTime?.constructor;
  const currentTimeEpochMs = currentTime && typeof JulianDate?.toDate === 'function'
    ? JulianDate.toDate(currentTime).getTime()
    : null;
  const cartesian = entity?.position?.getValue?.(currentTime);
  const ellipsoid = viewer?.scene?.globe?.ellipsoid;
  const cartographic = cartesian && ellipsoid?.cartesianToCartographic?.(cartesian);
  const camera = viewer?.camera;
  const stats = app?.dataManager?.layers?.get('flights')?.module?.getStats?.();
  const vector = (value) => value
    ? { x: value.x, y: value.y, z: value.z }
    : null;
  return {
    dateEpochMs: dateMs,
    cesiumCurrentTime: currentTime
      ? { dayNumber: currentTime.dayNumber, secondsOfDay: currentTime.secondsOfDay }
      : null,
    cesiumCurrentTimeEpochMs: currentTimeEpochMs,
    cesiumClockShouldAnimate: viewer?.clock?.shouldAnimate ?? null,
    cesiumClockStep: viewer?.clock?.clockStep ?? null,
    selectedIdentity: entity?.gevTrackedId ?? null,
    expectedIdentity,
    targetPosition: cartographic
      ? {
          longitudeDeg: (cartographic.longitude * 180) / Math.PI,
          latitudeDeg: (cartographic.latitude * 180) / Math.PI,
          heightM: cartographic.height,
        }
      : null,
    camera: camera
      ? {
          position: vector(camera.positionWC),
          direction: vector(camera.directionWC),
          up: vector(camera.upWC),
          transform: Array.from(camera.transform || []),
        }
      : null,
    source: {
      lastUpdate: stats?.lastUpdate ?? null,
      stale: stats?.stale ?? null,
      count: stats?.count ?? null,
      ageMs: Number.isFinite(stats?.lastUpdate) ? dateMs - stats.lastUpdate : null,
    },
  };
}

export function createEntityFollowRoute({
  fixtureId,
  fixtureSha256,
  fixedTime,
  warmupMs,
  measurementMs,
  start,
  end,
}) {
  const radians = Math.PI / 180;
  const targetDistanceM = start?.targetPosition && end?.targetPosition
    ? (() => {
        const latitude1 = start.targetPosition.latitudeDeg * radians;
        const latitude2 = end.targetPosition.latitudeDeg * radians;
        const deltaLatitude = latitude2 - latitude1;
        const deltaLongitude = (end.targetPosition.longitudeDeg - start.targetPosition.longitudeDeg) * radians;
        const haversine = Math.sin(deltaLatitude / 2) ** 2 +
          Math.cos(latitude1) * Math.cos(latitude2) * Math.sin(deltaLongitude / 2) ** 2;
        const horizontal = 2 * 6_371_000 * Math.asin(Math.sqrt(Math.min(1, haversine)));
        return Math.hypot(horizontal, end.targetPosition.heightM - start.targetPosition.heightM);
      })()
    : null;
  return {
    id: 'entity-follow-v1',
    fixtureId,
    fixtureSha256,
    fixedTime,
    selectedIdentity: start?.selectedIdentity,
    selectedIdentityEnd: end?.selectedIdentity,
    trajectoryId: `${fixtureId}:${start?.selectedIdentity || 'unavailable'}`,
    warmupMs,
    measurementMs,
    elapsedDurationMs: measurementMs,
    motionDistanceM: targetDistanceM,
    startEpochMs: start?.dateEpochMs,
    endEpochMs: end?.dateEpochMs,
    sourceAgeStartMs: start?.source?.ageMs,
    sourceAgeEndMs: end?.source?.ageMs,
    sourceLastUpdateStart: start?.source?.lastUpdate,
    sourceLastUpdateEnd: end?.source?.lastUpdate,
    sourceCountStart: start?.source?.count,
    sourceCountEnd: end?.source?.count,
    sourceFreshness: {
      start: start?.source?.stale === false ? 'current' : 'stale-or-unavailable',
      end: end?.source?.stale === false ? 'current' : 'stale-or-unavailable',
    },
    targetStart: start?.targetPosition,
    targetEnd: end?.targetPosition,
    cesiumCurrentTimeStart: start?.cesiumCurrentTime,
    cesiumCurrentTimeEnd: end?.cesiumCurrentTime,
    cesiumCurrentTimeStartMs: start?.cesiumCurrentTimeEpochMs,
    cesiumCurrentTimeEndMs: end?.cesiumCurrentTimeEpochMs,
    cesiumClockShouldAnimateStart: start?.cesiumClockShouldAnimate,
    cesiumClockShouldAnimateEnd: end?.cesiumClockShouldAnimate,
    cesiumClockStepStart: start?.cesiumClockStep,
    cesiumClockStepEnd: end?.cesiumClockStep,
    observedTargetDistanceM: targetDistanceM,
    start: start?.camera ? { ...start.camera, dateEpochMs: start.dateEpochMs } : null,
    end: end?.camera ? { ...end.camera, dateEpochMs: end.dateEpochMs } : null,
  };
}
