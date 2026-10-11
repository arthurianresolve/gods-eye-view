/**
 * Remove exact entities owned by an import layer in their original insertion
 * order. Individual removals preserve Cesium visualizer reuse and externally
 * suspended collection event ordering; replacements and unrelated entities
 * are left untouched.
 */
export function removeOwnedEntityCollection(collection, ownedEntities) {
  for (const [id, ownedEntity] of ownedEntities)
    if (collection.getById(id) === ownedEntity) collection.removeById(id);
}
