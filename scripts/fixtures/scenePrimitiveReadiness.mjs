/** Bounded fixture observation of scene owners, including hidden replacements. */
export function readScenePrimitiveReadiness(scene, Cesium) {
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
    const owner = {
      path,
      type: primitive.constructor?.name || null,
      ready: typeof primitive.ready === 'boolean' ? primitive.ready : null,
      show: typeof primitive.show === 'boolean' ? primitive.show : null,
    };
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
