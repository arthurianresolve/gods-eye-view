// Bounded, read-only fixture diagnostics. Never alter readiness, show attributes,
// worker ownership, or render demand to make an observation pass.
export function readInfrastructurePrimitiveReadiness(scene, Cesium) {
  const visited = new Set();
  const pending = [];
  let truncated = false;
  function visit(primitive, path, depth) {
    if (!primitive || visited.has(primitive)) return;
    if (visited.size >= 64 || depth > 8) {
      truncated = true;
      return;
    }
    visited.add(primitive);
    // Hidden replacement primitives still own unfinished work. A data-source
    // update can report ready before its static visualizer publishes them.
    if (primitive.ready === false)
      pending.push({ path, type: primitive.constructor?.name || null });
    if (primitive instanceof Cesium.PrimitiveCollection)
      for (let index = 0; index < primitive.length; index++)
        visit(primitive.get(index), `${path}/${index}`, depth + 1);
  }
  visit(scene.primitives, 'primitives', 0);
  visit(scene.groundPrimitives, 'groundPrimitives', 0);
  return {
    ready: !truncated && pending.length === 0,
    observedOwners: visited.size,
    truncated,
    pending,
  };
}

export function observeInfrastructurePrimitives(scene, rows, Cesium) {
  const targets = rows
    .filter((row) => row.entityShow && row.point.show && row.stem.show)
    .slice(0, 4);
  const result = { nodes: [], truncated: false, targets: [] };
  for (const row of targets) {
    const positions = row.stem.positions.map(
      (value) => new Cesium.Cartesian3(...value),
    );
    const expected = Cesium.BoundingSphere.fromPoints(positions);
    result.targets.push({
      entityId: row.entityId,
      sourceRecordId: row.sourceRecordId,
      expectedStemSphere: sphere(expected),
    });
  }
  const visited = new Set();
  function visit(primitive, path, depth) {
    if (!primitive || visited.has(primitive)) return;
    if (result.nodes.length >= 64 || depth > 8) {
      result.truncated = true;
      return;
    }
    visited.add(primitive);
    const entry = {
      path,
      type: primitive.constructor?.name || null,
      show: typeof primitive.show === 'boolean' ? primitive.show : null,
      ready: typeof primitive.ready === 'boolean' ? primitive.ready : null,
      appearance: primitive.appearance?.constructor?.name || null,
      count: Number.isSafeInteger(primitive.length) ? primitive.length : null,
      instances: [],
    };
    result.nodes.push(entry);
    if (
      primitive.ready === true &&
      typeof primitive.getGeometryInstanceAttributes === 'function'
    ) {
      for (const row of targets) {
        try {
          const attributes = primitive.getGeometryInstanceAttributes(
            row.entity,
          );
          if (!attributes) continue;
          entry.instances.push({
            entityId: row.entityId,
            show: attributes.show ? [...attributes.show] : null,
            color: attributes.color ? [...attributes.color] : null,
            distanceDisplayCondition: attributes.distanceDisplayCondition
              ? [...attributes.distanceDisplayCondition]
              : null,
            boundingSphere: sphere(attributes.boundingSphere),
          });
        } catch (error) {
          entry.instances.push({ entityId: row.entityId, error: error.name });
        }
      }
    }
    // Descend through owner collections only, never thousands of individual
    // points, polylines, or private engine structures.
    if (primitive instanceof Cesium.PrimitiveCollection) {
      for (let index = 0; index < primitive.length; index++) {
        visit(primitive.get(index), `${path}/${index}`, depth + 1);
        if (result.truncated) break;
      }
    }
  }
  visit(scene.primitives, 'primitives', 0);
  visit(scene.groundPrimitives, 'groundPrimitives', 0);
  return result;
}

function sphere(value) {
  return value
    ? {
        center: [value.center.x, value.center.y, value.center.z],
        radius: value.radius,
      }
    : null;
}

export async function observeInfrastructureFrameDelivery(
  viewer,
  capture,
  { documentLike = globalThis.document, now = () => performance.now() } = {},
) {
  const started = now();
  let updates = 0;
  let frames = 0;
  const removers = [];
  const documentState = () => ({
    visibility: documentLike?.visibilityState ?? null,
    hidden: documentLike?.hidden ?? null,
    focused: documentLike?.hasFocus?.() ?? null,
  });
  const before = documentState();
  try {
    removers.push(viewer.scene.preUpdate.addEventListener(() => updates++));
    removers.push(viewer.scene.postRender.addEventListener(() => frames++));
    const canvas = await capture();
    return {
      canvas,
      delivery: {
        elapsedMs: now() - started,
        updates,
        renderedFrames: frames,
        before,
        after: documentState(),
        defaultRenderLoop: viewer.useDefaultRenderLoop,
        targetFrameRate: viewer.targetFrameRate,
        requestRenderMode: viewer.scene.requestRenderMode,
        width: viewer.scene.canvas.width,
        height: viewer.scene.canvas.height,
        completed: Boolean(canvas),
      },
    };
  } finally {
    for (const remove of removers) remove();
  }
}
