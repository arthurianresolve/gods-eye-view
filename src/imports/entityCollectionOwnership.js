/**
 * Remove only entities still owned by an import layer. The collection-wide
 * fast path is safe only when every current entity is one of the exact objects
 * recorded by the layer; mixed collections retain unrelated/replacement IDs.
 */
export function removeOwnedEntityCollection(collection, ownedEntities) {
  const values = collection.values;
  let ownsWholeCollection = values.length === ownedEntities.size;
  if (ownsWholeCollection) {
    for (const entity of values) {
      if (ownedEntities.get(entity.id) !== entity) {
        ownsWholeCollection = false;
        break;
      }
    }
  }
  if (ownsWholeCollection) {
    collection.removeAll();
    return;
  }

  collection.suspendEvents();
  try {
    for (const [id, ownedEntity] of ownedEntities) {
      if (collection.getById(id) === ownedEntity) collection.removeById(id);
    }
  } finally {
    collection.resumeEvents();
  }
}
