const safeErrorName = (error) =>
  ['TypeError', 'DeveloperError', 'RangeError'].includes(error?.name)
    ? error.name
    : 'Error';

function addOwnedListener(event, listener) {
  if (typeof event?.addEventListener !== 'function')
    throw new TypeError('Scene update event is unavailable.');
  const remove = event.addEventListener(listener);
  if (typeof remove === 'function') return remove;
  if (typeof event.removeEventListener === 'function')
    return () => event.removeEventListener(listener);
  throw new TypeError('Scene update event cleanup is unavailable.');
}

/**
 * Observe the DataSourceDisplay.update result Cesium already computes and bind
 * it to that frame's preRender/postRender pair. This fixture helper never calls
 * update itself.
 */
export function installTerrainCurrentUpdateReadinessObserver({
  dataSourceDisplay,
  scene,
  entityCollections,
  ownershipCollection = null,
  getCurrentEntityCollections = null,
}) {
  let active = true;
  let generationCounter = 0;
  let currentGeneration = 0;
  let updateSequence = 0;
  let collectionRevision = 0;
  let collectionOwnerRevision = 0;
  let ownershipChanged = false;
  let completedRenderRevision = 0;
  let lastCompletedUpdateSequence = 0;
  let latestUpdate = null;
  let pendingRender = null;
  let latestCompletedRender = null;
  let updateWrapper = null;
  let installErrorName = null;
  let updateRestoreStatus = 'not-installed';
  let cleanupConfirmed = false;
  let disposedSnapshot = null;
  const removeCollectionChanged = [];
  let removePreRender = null;
  let removePostRender = null;
  let removeOwnershipChanged = null;
  const originalOwnDescriptor =
    dataSourceDisplay &&
    Object.getOwnPropertyDescriptor(dataSourceDisplay, 'update');
  const originalUpdate = dataSourceDisplay?.update;
  const collections = [
    ...new Set(
      (Array.isArray(entityCollections) ? entityCollections : []).filter(
        Boolean,
      ),
    ),
  ];
  const currentCollectionsMatch = () => {
    if (typeof getCurrentEntityCollections !== 'function') return true;
    try {
      const current = [
        ...new Set((getCurrentEntityCollections() || []).filter(Boolean)),
      ];
      return (
        current.length === collections.length &&
        collections.every((collection) => current.includes(collection))
      );
    } catch {
      return false;
    }
  };

  const observer = {
    available: false,
    get cleanupConfirmed() {
      return cleanupConfirmed;
    },
    get installErrorName() {
      return installErrorName;
    },
    beginGeneration() {
      if (!active || !observer.available)
        return { generation: null, available: false };
      generationCounter += 1;
      currentGeneration = generationCounter;
      return { generation: currentGeneration, available: true };
    },
    read() {
      if (!active || !observer.available || !latestCompletedRender) return null;
      return { ...latestCompletedRender };
    },
    isCurrentFrameReady(snapshot, expectedGeneration) {
      return (
        active &&
        observer.available &&
        snapshot !== null &&
        typeof snapshot === 'object' &&
        Number.isSafeInteger(expectedGeneration) &&
        expectedGeneration > 0 &&
        currentGeneration === expectedGeneration &&
        snapshot.completedRenderRevision === completedRenderRevision &&
        collectionRevision === snapshot.collectionRevisionAtPostRender &&
        collectionOwnerRevision ===
          snapshot.collectionOwnerRevisionAtPostRender &&
        !ownershipChanged &&
        currentCollectionsMatch() &&
        snapshot.completedRenderRevision > 0 &&
        snapshot.collectionRevisionAtUpdateEntry ===
          snapshot.collectionRevisionAtPostRender &&
        snapshot.collectionRevisionAtUpdateReturn ===
          snapshot.collectionRevisionAtPostRender &&
        snapshot.collectionRevisionAtUpdateEntry ===
          snapshot.collectionRevisionAtUpdateReturn &&
        snapshot.collectionOwnerRevisionAtUpdateEntry ===
          snapshot.collectionOwnerRevisionAtUpdateReturn &&
        snapshot.collectionOwnerRevisionAtUpdateReturn ===
          snapshot.collectionOwnerRevisionAtPreRender &&
        snapshot.collectionOwnerRevisionAtPreRender ===
          snapshot.collectionOwnerRevisionAtPostRender &&
        snapshot.collectionRevisionAtUpdateReturn ===
          snapshot.collectionRevisionAtPreRender &&
        snapshot.updateOccurredForFrame === true &&
        snapshot.updateReturnedBoolean === true &&
        snapshot.updateErrorName === null &&
        snapshot.updateGeneration === expectedGeneration &&
        snapshot.generationAtPreRender === expectedGeneration &&
        snapshot.generationAtPostRender === expectedGeneration &&
        snapshot.updateSequenceAtPreRender ===
          snapshot.updateSequenceAtPostRender
      );
    },
    dispose() {
      if (!active) return cleanupConfirmed;
      active = false;
      let cleanupOk = true;
      for (const remove of removeCollectionChanged.splice(0)) {
        try {
          remove();
        } catch {
          cleanupOk = false;
        }
      }
      try {
        if (removeOwnershipChanged) removeOwnershipChanged();
      } catch {
        cleanupOk = false;
      }
      removeOwnershipChanged = null;
      for (const [remove, name] of [
        [removePreRender, 'preRender'],
        [removePostRender, 'postRender'],
      ]) {
        try {
          if (typeof remove !== 'function') {
            cleanupOk = false;
            continue;
          }
          remove();
        } catch {
          cleanupOk = false;
        }
        if (name === 'preRender') removePreRender = null;
        else removePostRender = null;
      }
      try {
        if (dataSourceDisplay?.update === updateWrapper) {
          if (originalOwnDescriptor)
            Object.defineProperty(
              dataSourceDisplay,
              'update',
              originalOwnDescriptor,
            );
          else if (!Reflect.deleteProperty(dataSourceDisplay, 'update'))
            cleanupOk = false;
          updateRestoreStatus = 'restored';
        } else if (
          updateWrapper &&
          dataSourceDisplay?.update !== updateWrapper
        ) {
          updateRestoreStatus = 'replaced-by-another-owner';
          cleanupOk = false;
        } else {
          updateRestoreStatus = 'not-installed';
        }
      } catch {
        cleanupOk = false;
        updateRestoreStatus = 'restore-failed';
      }
      cleanupConfirmed = cleanupOk;
      // The observer owns only the comparison epoch. Later selection/recovery
      // cases intentionally replace collections after this observer is retired.
      disposedSnapshot = observer.snapshot();
      return cleanupConfirmed;
    },
    snapshot() {
      if (disposedSnapshot) return { ...disposedSnapshot };
      return {
        available: observer.available,
        cleanupConfirmed,
        updateRestoreStatus,
        generationCount: generationCounter,
        updateCallCount: updateSequence,
        collectionRevision,
        collectionOwnerRevision,
        ownershipChanged,
        entityCollectionsMatch: currentCollectionsMatch(),
        completedRenderRevision,
        installErrorName,
      };
    },
  };

  try {
    if (
      typeof originalUpdate !== 'function' ||
      collections.length === 0 ||
      (getCurrentEntityCollections !== null &&
        typeof getCurrentEntityCollections !== 'function') ||
      (ownershipCollection !== null &&
        ['dataSourceAdded', 'dataSourceRemoved', 'dataSourceMoved'].some(
          (eventName) =>
            typeof ownershipCollection?.[eventName]?.addEventListener !==
            'function',
        )) ||
      !currentCollectionsMatch() ||
      collections.some(
        (collection) =>
          typeof collection?.collectionChanged?.addEventListener !== 'function',
      ) ||
      typeof scene?.preRender?.addEventListener !== 'function' ||
      typeof scene?.postRender?.addEventListener !== 'function'
    )
      throw new TypeError(
        'Current DataSourceDisplay update observation is unavailable.',
      );

    updateWrapper = function (...args) {
      if (!active || this !== dataSourceDisplay)
        return Reflect.apply(originalUpdate, this, args);
      const sequence = ++updateSequence;
      const generation = currentGeneration;
      const collectionRevisionAtEntry = collectionRevision;
      const collectionOwnerRevisionAtEntry = collectionOwnerRevision;
      let result;
      try {
        result = Reflect.apply(originalUpdate, this, args);
      } catch (error) {
        latestUpdate = {
          sequence,
          generation,
          collectionRevisionAtEntry,
          collectionRevisionAtReturn: collectionRevision,
          collectionOwnerRevisionAtEntry,
          collectionOwnerRevisionAtReturn: collectionOwnerRevision,
          returnedBoolean: false,
          errorName: safeErrorName(error),
        };
        throw error;
      }
      latestUpdate = {
        sequence,
        generation,
        collectionRevisionAtEntry,
        collectionRevisionAtReturn: collectionRevision,
        collectionOwnerRevisionAtEntry,
        collectionOwnerRevisionAtReturn: collectionOwnerRevision,
        returnedBoolean: typeof result === 'boolean' ? result : null,
        errorName: null,
      };
      return result;
    };
    Object.defineProperty(dataSourceDisplay, 'update', {
      configurable: true,
      enumerable: originalOwnDescriptor?.enumerable ?? false,
      writable: true,
      value: updateWrapper,
    });
    updateRestoreStatus = 'installed';
    for (const collection of collections) {
      removeCollectionChanged.push(
        addOwnedListener(collection.collectionChanged, () => {
          collectionRevision += 1;
        }),
      );
    }
    if (ownershipCollection) {
      const disposers = [];
      try {
        for (const eventName of [
          'dataSourceAdded',
          'dataSourceRemoved',
          'dataSourceMoved',
        ]) {
          disposers.push(
            addOwnedListener(ownershipCollection[eventName], () => {
              collectionOwnerRevision += 1;
              ownershipChanged = true;
            }),
          );
        }
        removeOwnershipChanged = () => {
          let clean = true;
          for (const remove of disposers.splice(0)) {
            try {
              remove();
            } catch {
              clean = false;
            }
          }
          if (!clean) throw new Error('Ownership listener cleanup failed.');
        };
      } catch (error) {
        for (const remove of disposers.splice(0)) {
          try {
            remove();
          } catch {
            // Preserve the original installation error below.
          }
        }
        throw error;
      }
    }
    removePreRender = addOwnedListener(scene.preRender, () => {
      if (!active) return;
      pendingRender = {
        updateSequence: latestUpdate?.sequence ?? null,
        updateGeneration: latestUpdate?.generation ?? null,
        updateReturnedBoolean: latestUpdate?.returnedBoolean ?? null,
        updateErrorName: latestUpdate?.errorName ?? null,
        collectionRevisionAtUpdateEntry:
          latestUpdate?.collectionRevisionAtEntry ?? null,
        collectionRevisionAtUpdateReturn:
          latestUpdate?.collectionRevisionAtReturn ?? null,
        generation: currentGeneration,
        collectionRevisionAtPreRender: collectionRevision,
        collectionOwnerRevisionAtUpdateEntry:
          latestUpdate?.collectionOwnerRevisionAtEntry ?? null,
        collectionOwnerRevisionAtUpdateReturn:
          latestUpdate?.collectionOwnerRevisionAtReturn ?? null,
        collectionOwnerRevisionAtPreRender: collectionOwnerRevision,
      };
    });
    removePostRender = addOwnedListener(scene.postRender, () => {
      if (!active) return;
      completedRenderRevision += 1;
      const pre = pendingRender;
      const postSequence = latestUpdate?.sequence ?? null;
      latestCompletedRender = {
        completedRenderRevision,
        updateSequenceAtPreRender: pre?.updateSequence ?? null,
        updateSequenceAtPostRender: postSequence,
        updateGeneration: pre?.updateGeneration ?? null,
        generationAtPreRender: pre?.generation ?? null,
        generationAtPostRender: currentGeneration,
        updateReturnedBoolean: pre?.updateReturnedBoolean ?? null,
        updateErrorName: pre?.updateErrorName ?? null,
        collectionRevisionAtUpdateEntry:
          pre?.collectionRevisionAtUpdateEntry ?? null,
        collectionRevisionAtUpdateReturn:
          pre?.collectionRevisionAtUpdateReturn ?? null,
        collectionRevisionAtPreRender:
          pre?.collectionRevisionAtPreRender ?? null,
        collectionRevisionAtPostRender: collectionRevision,
        collectionOwnerRevisionAtUpdateEntry:
          pre?.collectionOwnerRevisionAtUpdateEntry ?? null,
        collectionOwnerRevisionAtUpdateReturn:
          pre?.collectionOwnerRevisionAtUpdateReturn ?? null,
        collectionOwnerRevisionAtPreRender:
          pre?.collectionOwnerRevisionAtPreRender ?? null,
        collectionOwnerRevisionAtPostRender: collectionOwnerRevision,
        updateOccurredForFrame:
          pre?.updateSequence !== null &&
          pre?.updateSequence !== undefined &&
          pre.updateSequence > lastCompletedUpdateSequence &&
          postSequence === pre.updateSequence,
      };
      if (postSequence !== null)
        lastCompletedUpdateSequence = Math.max(
          lastCompletedUpdateSequence,
          postSequence,
        );
      pendingRender = null;
    });
    observer.available = true;
  } catch (error) {
    installErrorName = safeErrorName(error);
    observer.dispose();
    observer.available = false;
  }
  return observer;
}

/** Publish the same retired observation at the comparison and finally boundaries. */
export function finalizeTerrainCurrentUpdateObservation(
  observer,
  metadata = {},
) {
  const cleanupConfirmed = observer.dispose();
  const finalState = observer.snapshot();
  return {
    ...metadata,
    cleanupConfirmed,
    ownershipChanged: finalState.ownershipChanged,
    entityCollectionsMatch: finalState.entityCollectionsMatch,
    finalState,
  };
}
