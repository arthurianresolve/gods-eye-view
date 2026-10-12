const MAX_CLASSIFICATION_ROWS = 3000;
const MAX_GROUND_OWNERS = 4;
const MAX_READINESS_OWNERS = 64;
const MAX_TRACE_OBSERVATIONS = 8;

function checkedRows(rows, label) {
  if (!Array.isArray(rows) || rows.length > MAX_CLASSIFICATION_ROWS)
    throw new TypeError(
      `${label} classification rows are unavailable or oversized.`,
    );
  const ids = new Set();
  for (const row of rows) {
    if (
      !row ||
      typeof row.id !== 'string' ||
      !row.id ||
      ids.has(row.id) ||
      !['TERRAIN', 'CESIUM_3D_TILE', 'BOTH'].includes(row.classification)
    )
      throw new TypeError(`${label} classification row is malformed.`);
    ids.add(row.id);
  }
  return rows;
}

function countsFor(rows) {
  const counts = { TERRAIN: 0, CESIUM_3D_TILE: 0, BOTH: 0 };
  for (const row of rows) counts[row.classification] += 1;
  return counts;
}

/** Bounded exact identity/order and classification comparison for fixture rows. */
export function compareCableClassificationRows(before, after) {
  checkedRows(before, 'Before');
  checkedRows(after, 'After');
  const beforeById = new Map(before.map((row) => [row.id, row]));
  const afterById = new Map(after.map((row) => [row.id, row]));
  let changedEntityCount = 0;
  const sharedLength = Math.min(before.length, after.length);
  let identityOrderStable = before.length === after.length;
  for (let index = 0; index < sharedLength; index += 1) {
    if (before[index].id !== after[index].id) identityOrderStable = false;
  }
  for (const [id, beforeRow] of beforeById) {
    const afterRow = afterById.get(id);
    if (afterRow && beforeRow.classification !== afterRow.classification)
      changedEntityCount += 1;
  }
  const addedEntityCount = after.filter(
    (row) => !beforeById.has(row.id),
  ).length;
  const removedEntityCount = before.filter(
    (row) => !afterById.has(row.id),
  ).length;
  return {
    beforeCount: before.length,
    afterCount: after.length,
    identityOrderStable,
    changedEntityCount,
    addedEntityCount,
    removedEntityCount,
    before: countsFor(before),
    after: countsFor(after),
  };
}

/** Project the fixture's pinned-engine readiness observer to bounded GPP rows. */
export function summarizeCablePrimitiveReadiness(readiness) {
  if (!readiness || typeof readiness !== 'object')
    return { available: false, reason: 'missing-readiness' };
  const owners = Array.isArray(readiness.owners) ? readiness.owners : null;
  if (!owners) return { available: false, reason: 'missing-owner-list' };
  if (owners.length > MAX_READINESS_OWNERS)
    return { available: false, reason: 'owner-list-out-of-bounds' };
  const ground = owners.filter(
    (owner) => owner?.type === 'GroundPolylinePrimitive',
  );
  return {
    available: true,
    ready: readiness.ready === true,
    observedOwners: Number.isSafeInteger(readiness.observedOwners)
      ? readiness.observedOwners
      : null,
    pendingCount: Array.isArray(readiness.pending)
      ? readiness.pending.length
      : null,
    unsupportedCount: Array.isArray(readiness.unsupportedOwners)
      ? readiness.unsupportedOwners.length
      : null,
    groundPolylineCount: ground.length,
    groundPolylines: ground.slice(0, MAX_GROUND_OWNERS).map((owner) => ({
      path: typeof owner.path === 'string' ? owner.path.slice(0, 120) : null,
      fixtureOwnerId:
        typeof owner.fixtureOwnerId === 'string'
          ? owner.fixtureOwnerId.slice(0, 64)
          : null,
      ready: typeof owner.ready === 'boolean' ? owner.ready : null,
      show: typeof owner.show === 'boolean' ? owner.show : null,
      build:
        owner.buildState?.status === 'observed'
          ? {
              primitivePresent: owner.buildState.primitivePresent,
              primitiveReady: owner.buildState.primitiveReady,
              primitiveShow: owner.buildState.primitiveShow,
              state: owner.buildState.state?.name ?? null,
              instanceCount: owner.buildState.instanceCount,
              createGeometryResultsCount:
                owner.buildState.createGeometryResultsCount,
              geometriesCount: owner.buildState.geometriesCount,
              vertexArraysCount: owner.buildState.vertexArraysCount,
              errorName: owner.buildState.error?.name ?? null,
            }
          : {
              status: owner.buildState?.status ?? 'not-observed',
              reason: owner.buildState?.reason ?? null,
            },
    })),
    groundPolylinesTruncated: ground.length > MAX_GROUND_OWNERS,
  };
}

/** Keep only a bounded compact view of the existing readiness trace. */
export function summarizeCableClassificationTrace(trace) {
  if (!trace || !Array.isArray(trace.observations))
    return { available: false, reason: 'missing-trace' };
  if (trace.observations.length > MAX_TRACE_OBSERVATIONS)
    return { available: false, reason: 'trace-observations-out-of-bounds' };
  return {
    stage: typeof trace.stage === 'string' ? trace.stage.slice(0, 80) : null,
    observationCount: Number.isSafeInteger(trace.observationCount)
      ? trace.observationCount
      : null,
    truncated: trace.truncated === true,
    observations: trace.observations.slice(0, 8).map((row) => ({
      elapsedMs: Number.isFinite(row.elapsedMs) ? row.elapsedMs : null,
      remainingMs: Number.isFinite(row.remainingMs) ? row.remainingMs : null,
      frameNumber: Number.isSafeInteger(row.frameNumber)
        ? row.frameNumber
        : null,
      dataSourceDisplayReady: row.dataSourceDisplayReady === true,
      globeTilesLoaded: row.globeTilesLoaded === true,
      primitiveReadiness:
        row.primitiveReadiness?.available === true
          ? summarizeCablePrimitiveReadiness(row.primitiveReadiness.value)
          : { available: false },
      stableFrames: Number.isSafeInteger(row.stableFrames)
        ? row.stableFrames
        : null,
      signatureStable: row.signatureStable === true,
    })),
  };
}
