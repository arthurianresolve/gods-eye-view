/** Bounded observation of public scene owners, including hidden replacements. */
export function readScenePrimitiveReadiness(scene, Cesium) {
  const visited = new Set();
  const pending = [];
  const owners = [];
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
    }
  }
  visit(scene.primitives, 'primitives', 0);
  visit(scene.groundPrimitives, 'groundPrimitives', 0);
  return {
    ready: !truncated && pending.length === 0,
    observedOwners: visited.size,
    truncated,
    pending,
    owners,
  };
}
