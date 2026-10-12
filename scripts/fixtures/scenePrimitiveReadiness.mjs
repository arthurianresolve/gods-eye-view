/** Bounded fixture observation of scene owners, including hidden replacements. */
const CESIUM_GROUND_PRIMITIVE_VERSION = '1.138.0';
const MAX_INTERNAL_COUNT = 100_000;
// Private PrimitiveState.js values in the pinned Cesium 1.138.0 source.
// Keep this map local and version-gated; do not depend on an engine export.
const PRIMITIVE_STATES = Object.freeze([
  'READY',
  'CREATING',
  'CREATED',
  'COMBINING',
  'COMBINED',
  'COMPLETE',
  'FAILED',
]);

function boundedArrayCount(value) {
  if (value === undefined) return { count: null, status: 'absent' };
  if (!Array.isArray(value)) return { count: null, status: 'unknown-shape' };
  if (!Number.isSafeInteger(value.length) || value.length > MAX_INTERNAL_COUNT)
    return { count: null, status: 'out-of-bounds' };
  return { count: value.length, status: 'observed' };
}

function sanitizePrimitiveError(error) {
  if (!error || typeof error !== 'object') return null;
  const clean = (value, fallback) => {
    if (typeof value !== 'string') return fallback;
    return value
      .replace(/https?:\/\/[^\s)]+/gi, '[url]')
      .replace(/(?:[A-Z]:\\|\\\\)[^\s)]+/gi, '[path]')
      .replace(/\/(?:Users|home|private|tmp|var|mnt)\/[^\s)]+/gi, '[path]')
      .slice(0, 160);
  };
  return {
    name: clean(error.name, 'Error'),
    message: clean(error.message, 'Primitive error'),
  };
}

function readGroundPolylineBuildState(primitive, Cesium, path) {
  if (Cesium.VERSION !== CESIUM_GROUND_PRIMITIVE_VERSION)
    return {
      status: 'unavailable',
      reason: 'unsupported-cesium-version',
      cesiumVersion: typeof Cesium.VERSION === 'string' ? Cesium.VERSION : null,
    };

  if (typeof Cesium.GroundPolylinePrimitive !== 'function')
    return { status: 'unavailable', reason: 'missing-ground-polyline-type' };
  if (!(primitive instanceof Cesium.GroundPolylinePrimitive))
    return { status: 'unavailable', reason: 'ground-polyline-type-mismatch' };
  const outerAsynchronous = primitive.asynchronous;
  if (typeof outerAsynchronous !== 'boolean')
    return {
      status: 'unavailable',
      reason: 'outer-asynchronous-flag-shape',
      cesiumVersion: CESIUM_GROUND_PRIMITIVE_VERSION,
    };

  const inner = primitive._primitive;
  if (inner === undefined || inner === null)
    return {
      schema: 'gev-cesium-ground-polyline-build-state/v1',
      status: 'observed',
      cesiumVersion: CESIUM_GROUND_PRIMITIVE_VERSION,
      primitivePresent: false,
      primitiveReady: null,
      primitiveShow: null,
      asynchronous: outerAsynchronous,
      innerAsynchronous: null,
      state: null,
      instanceCount: null,
      createGeometryResultsCount: null,
      geometriesCount: null,
      vertexArraysCount: null,
      error: null,
    };
  if (
    typeof Cesium.Primitive !== 'function' ||
    !(inner instanceof Cesium.Primitive)
  )
    return {
      status: 'unavailable',
      reason: 'inner-primitive-type-mismatch',
      cesiumVersion: CESIUM_GROUND_PRIMITIVE_VERSION,
    };

  const stateValue = inner._state;
  const innerAsynchronous = inner.asynchronous;
  const primitiveReady = inner.ready;
  const primitiveShow = inner.show;
  if (
    typeof innerAsynchronous !== 'boolean' ||
    typeof primitiveReady !== 'boolean' ||
    typeof primitiveShow !== 'boolean'
  )
    return {
      status: 'unavailable',
      reason: 'inner-primitive-state-shape',
      cesiumVersion: CESIUM_GROUND_PRIMITIVE_VERSION,
    };
  const stateName =
    Number.isInteger(stateValue) &&
    stateValue >= 0 &&
    stateValue < PRIMITIVE_STATES.length
      ? PRIMITIVE_STATES[stateValue]
      : null;
  const countFields = {
    createGeometryResultsCount: boundedArrayCount(inner._createGeometryResults),
    geometriesCount: boundedArrayCount(inner._geometries),
    vertexArraysCount: boundedArrayCount(inner._va),
  };
  const invalidCount = Object.values(countFields).find(
    (field) => !['observed', 'absent'].includes(field.status),
  );
  if (invalidCount || !stateName) {
    return {
      status: 'unavailable',
      reason: invalidCount?.status || 'unknown-primitive-state',
      cesiumVersion: CESIUM_GROUND_PRIMITIVE_VERSION,
      stateValue: Number.isInteger(stateValue) ? stateValue : null,
    };
  }
  const instanceCount = inner._numberOfInstances;
  if (
    !Number.isSafeInteger(instanceCount) ||
    instanceCount < 0 ||
    instanceCount > MAX_INTERNAL_COUNT
  )
    return {
      status: 'unavailable',
      reason: 'instance-count-out-of-bounds',
      cesiumVersion: CESIUM_GROUND_PRIMITIVE_VERSION,
    };
  if (
    inner._error !== undefined &&
    inner._error !== null &&
    (typeof inner._error !== 'object' ||
      typeof inner._error.message !== 'string')
  )
    return {
      status: 'unavailable',
      reason: 'inner-error-shape',
      cesiumVersion: CESIUM_GROUND_PRIMITIVE_VERSION,
    };

  return {
    schema: 'gev-cesium-ground-polyline-build-state/v1',
    status: 'observed',
    cesiumVersion: CESIUM_GROUND_PRIMITIVE_VERSION,
    primitivePresent: true,
    primitiveReady,
    primitiveShow,
    asynchronous: outerAsynchronous,
    innerAsynchronous,
    state: { value: stateValue, name: stateName },
    instanceCount,
    createGeometryResultsCount: countFields.createGeometryResultsCount.count,
    geometriesCount: countFields.geometriesCount.count,
    vertexArraysCount: countFields.vertexArraysCount.count,
    error: sanitizePrimitiveError(inner._error),
    ownerPath: path,
  };
}

export function readScenePrimitiveReadiness(
  scene,
  Cesium,
  { ownerIdentityFor = null } = {},
) {
  const visited = new Set();
  const pending = [];
  const owners = [];
  const unsupportedOwners = [];
  let truncated = false;
  function visit(primitive, path, depth) {
    if (!primitive || visited.has(primitive)) return;
    if (visited.size >= 64 || depth > 8) {
      truncated = true;
      return;
    }
    visited.add(primitive);
    const fixtureOwnerId =
      typeof ownerIdentityFor === 'function'
        ? ownerIdentityFor(primitive)
        : null;
    const owner = {
      path,
      type: primitive.constructor?.name || null,
      ready: typeof primitive.ready === 'boolean' ? primitive.ready : null,
      show: typeof primitive.show === 'boolean' ? primitive.show : null,
      ...(typeof fixtureOwnerId === 'string'
        ? { fixtureOwnerId: fixtureOwnerId.slice(0, 64) }
        : {}),
    };
    if (
      owner.ready === false &&
      typeof Cesium.GroundPolylinePrimitive === 'function' &&
      primitive instanceof Cesium.GroundPolylinePrimitive
    ) {
      owner.buildState = readGroundPolylineBuildState(primitive, Cesium, path);
      if (owner.buildState.status === 'unavailable')
        unsupportedOwners.push({
          path: `${path}/inner-primitive`,
          type: owner.buildState.reason,
        });
    }
    owners.push(owner);
    if (owner.ready === false) pending.push({ path, type: owner.type });
    // A data source can report ready before its hidden static replacement is
    // materialized. Inspect owners only, never individual point/line buffers.
    if (primitive instanceof Cesium.PrimitiveCollection) {
      for (let index = 0; index < primitive.length; index++) {
        visit(primitive.get(index), `${path}/${index}`, depth + 1);
        if (truncated) break;
      }
    } else if (
      typeof Cesium.OrderedGroundPrimitiveCollection === 'function' &&
      primitive instanceof Cesium.OrderedGroundPrimitiveCollection
    ) {
      // Cesium 1.138's public dataSourceDisplay.ready is sticky. Its ordered
      // ground owner exposes no public child accessor, so fixture readiness
      // needs this read-only, version/shape-checked list of PrimitiveCollections.
      // Never alter owners, worker jobs, or geometry buffers to obtain a pass.
      const groups = primitive._collectionsArray;
      if (
        (Cesium.VERSION !== '1.138' && Cesium.VERSION !== '1.138.0') ||
        !Array.isArray(groups) ||
        groups.length > 64 ||
        groups.some(
          (group) => !(group instanceof Cesium.PrimitiveCollection),
        ) ||
        groups.reduce((count, group) => count + group.length, 0) !==
          primitive.length
      ) {
        unsupportedOwners.push({ path, type: owner.type });
        return;
      }
      for (let index = 0; index < groups.length; index++) {
        visit(groups[index], `${path}/z-group-${index}`, depth + 1);
        if (truncated) break;
      }
    }
  }
  visit(scene.primitives, 'primitives', 0);
  visit(scene.groundPrimitives, 'groundPrimitives', 0);
  return {
    ready: !truncated && pending.length === 0 && unsupportedOwners.length === 0,
    observedOwners: visited.size,
    truncated,
    pending,
    owners,
    unsupportedOwners,
  };
}
