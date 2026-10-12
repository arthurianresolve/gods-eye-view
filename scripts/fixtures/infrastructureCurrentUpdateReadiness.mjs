export const INFRASTRUCTURE_CURRENT_UPDATE_READINESS_SCHEMA =
  'gev-infrastructure-current-update-readiness/v1';
export const INFRASTRUCTURE_CURRENT_UPDATE_READINESS_FLAG =
  '--infrastructure-current-update-readiness';

export function infrastructureCurrentUpdateReadinessRequested(searchParams) {
  return searchParams?.get?.('current-update-readiness-diagnostic') === '1';
}

export function infrastructureCurrentUpdateReadinessOptionEnabled(args) {
  const options = Array.isArray(args) ? args : [];
  const enabled = options.includes(
    INFRASTRUCTURE_CURRENT_UPDATE_READINESS_FLAG,
  );
  if (enabled && !options.includes('--infrastructure-datacenters'))
    throw new Error(
      `${INFRASTRUCTURE_CURRENT_UPDATE_READINESS_FLAG} requires --infrastructure-datacenters.`,
    );
  if (
    enabled &&
    (options.includes('--infrastructure-pick-path-diagnostic') ||
      options.includes('--infrastructure-primitive-readiness-diagnostic'))
  )
    throw new Error(
      'Current update readiness must run separately from other infrastructure diagnostics.',
    );
  return enabled;
}

export function createInfrastructureCurrentUpdateReadinessEnvelope() {
  return {
    schema: INFRASTRUCTURE_CURRENT_UPDATE_READINESS_SCHEMA,
    enabled: true,
    instrumented: true,
    diagnosticOnly: true,
    performanceAcceptanceEligible: false,
    scope:
      'observes Cesium DataSourceDisplay.update return values on existing calls, bound to the same preRender/postRender cycle and unchanged public EntityCollection revision; no extra update calls',
    status: 'running',
    lifetimes: ['entities', 'primitive-collections'].map((mode) => ({
      mode,
      available: false,
      cleanupConfirmed: false,
      installErrorName: null,
      samples: [],
    })),
  };
}

export function createInfrastructureCurrentUpdateReadinessSample({
  caseId,
  pair,
  status,
  generation,
  capture,
  lastObserverSnapshot,
  captureFrameErrorName,
  currentUpdateReadyForGeneration,
  latchedDataSourceDisplayReady,
}) {
  return {
    caseId,
    pair,
    status,
    generation,
    capture,
    lastObserverSnapshot,
    captureFrameErrorName,
    currentUpdateReadyForGeneration,
    latchedDataSourceDisplayReady,
  };
}

export function readInfrastructureCurrentUpdateWitness(observer, generation) {
  if (!observer?.available) return { snapshot: null, ready: false };
  let snapshot = null;
  try {
    snapshot = observer.read() ?? null;
    return {
      snapshot,
      ready: observer.isCurrentFrameReady(snapshot, generation) === true,
    };
  } catch {
    return { snapshot, ready: false };
  }
}

export function infrastructureCurrentUpdateGateReady({
  required,
  observerAvailable,
  witnessReady,
}) {
  return (
    required !== true || (observerAvailable === true && witnessReady === true)
  );
}

const hasOnlyKeys = (value, keys) =>
  value &&
  typeof value === 'object' &&
  !Array.isArray(value) &&
  Object.keys(value).every((key) => keys.includes(key));
const isNonnegativeSafeInteger = (value) =>
  Number.isSafeInteger(value) && value >= 0;
const completeSampleIdentities = () =>
  ['default-style', 'camera-lod-update-baseline', 'camera-lod-update'].flatMap(
    (caseId) =>
      Array.from({ length: 5 }, (_, pair) => `${caseId}\u0000${pair}`),
  );

export function validateInfrastructureCurrentUpdateReadinessEnvelope(
  envelope,
  { allowPartial = false } = {},
) {
  const fail = (message) => {
    throw new Error(
      `Infrastructure current-update readiness is invalid: ${message}`,
    );
  };
  if (
    !envelope ||
    typeof envelope !== 'object' ||
    Array.isArray(envelope) ||
    !hasOnlyKeys(envelope, [
      'schema',
      'enabled',
      'instrumented',
      'diagnosticOnly',
      'performanceAcceptanceEligible',
      'scope',
      'status',
      'lifetimes',
    ]) ||
    envelope.schema !== INFRASTRUCTURE_CURRENT_UPDATE_READINESS_SCHEMA ||
    envelope.enabled !== true ||
    envelope.instrumented !== true ||
    envelope.diagnosticOnly !== true ||
    envelope.performanceAcceptanceEligible !== false ||
    !Array.isArray(envelope.lifetimes) ||
    envelope.lifetimes.length > 2
  )
    fail('envelope contract mismatch');
  if (
    !['complete', 'partial-or-diagnostic-error', 'running'].includes(
      envelope.status,
    ) ||
    (!allowPartial && envelope.status !== 'complete') ||
    (!allowPartial && envelope.lifetimes.length !== 2)
  )
    fail('diagnostic is incomplete');
  const expectedModes = ['entities', 'primitive-collections'];
  for (const [index, lifetime] of envelope.lifetimes.entries()) {
    if (
      !lifetime ||
      !hasOnlyKeys(lifetime, [
        'mode',
        'available',
        'cleanupConfirmed',
        'installErrorName',
        'samples',
        'finalObserverState',
      ]) ||
      lifetime.mode !== expectedModes[index] ||
      typeof lifetime.available !== 'boolean' ||
      typeof lifetime.cleanupConfirmed !== 'boolean' ||
      !Array.isArray(lifetime.samples) ||
      lifetime.samples.length > 64
    )
      fail('lifetime identity or cleanup record is malformed');
    if (!allowPartial && (!lifetime.available || !lifetime.cleanupConfirmed))
      fail('observer unavailable or cleanup unconfirmed');
    if (
      lifetime.installErrorName !== null &&
      typeof lifetime.installErrorName !== 'string'
    )
      fail('observer installation error is malformed');
    if (
      lifetime.finalObserverState !== undefined &&
      (!hasOnlyKeys(lifetime.finalObserverState, [
        'schema',
        'available',
        'cleanupConfirmed',
        'updateRestoreStatus',
        'generationCount',
        'updateCallCount',
        'collectionRevision',
        'completedRenderRevision',
        'installErrorName',
      ]) ||
        lifetime.finalObserverState.schema !==
          INFRASTRUCTURE_CURRENT_UPDATE_READINESS_SCHEMA ||
        lifetime.finalObserverState.available !== lifetime.available ||
        lifetime.finalObserverState.cleanupConfirmed !==
          lifetime.cleanupConfirmed ||
        ![
          'restored',
          'replaced-by-another-owner',
          'restore-failed',
          'not-installed',
        ].includes(lifetime.finalObserverState.updateRestoreStatus) ||
        !isNonnegativeSafeInteger(
          lifetime.finalObserverState.generationCount,
        ) ||
        !isNonnegativeSafeInteger(
          lifetime.finalObserverState.updateCallCount,
        ) ||
        !isNonnegativeSafeInteger(
          lifetime.finalObserverState.collectionRevision,
        ) ||
        !isNonnegativeSafeInteger(
          lifetime.finalObserverState.completedRenderRevision,
        ))
    )
      fail('final observer state is malformed');
    if (
      !allowPartial &&
      (lifetime.finalObserverState?.cleanupConfirmed !== true ||
        lifetime.finalObserverState?.updateRestoreStatus !== 'restored')
    )
      fail('complete diagnostic lacks confirmed observer restoration');
    const identities = new Set();
    for (const sample of lifetime.samples) {
      if (
        !sample ||
        !hasOnlyKeys(sample, [
          'caseId',
          'pair',
          'status',
          'generation',
          'capture',
          'captureFrameErrorName',
          'lastObserverSnapshot',
          'currentUpdateReadyForGeneration',
          'latchedDataSourceDisplayReady',
        ]) ||
        typeof sample.caseId !== 'string' ||
        !Number.isSafeInteger(sample.pair) ||
        sample.pair < 0 ||
        !['settled', 'failed'].includes(sample.status) ||
        (sample.captureFrameErrorName !== null &&
          !['TypeError', 'DeveloperError', 'RangeError', 'Error'].includes(
            sample.captureFrameErrorName,
          )) ||
        typeof sample.currentUpdateReadyForGeneration !== 'boolean' ||
        ![null, true, false].includes(sample.latchedDataSourceDisplayReady)
      )
        fail('sample identity or outcome is malformed');
      const sampleIdentity = `${sample.caseId}\u0000${sample.pair}`;
      if (identities.has(sampleIdentity)) fail('duplicate sample identity');
      identities.add(sampleIdentity);
      if (sample.lastObserverSnapshot !== null) {
        const last = sample.lastObserverSnapshot;
        if (
          !hasOnlyKeys(last, [
            'completedRenderRevision',
            'updateSequenceAtPreRender',
            'updateSequenceAtPostRender',
            'updateGeneration',
            'generationAtPreRender',
            'generationAtPostRender',
            'updateReturnedBoolean',
            'updateErrorName',
            'collectionRevisionAtUpdateEntry',
            'collectionRevisionAtUpdateReturn',
            'collectionRevisionAtPreRender',
            'collectionRevisionAtPostRender',
            'updateOccurredForFrame',
          ]) ||
          !isNonnegativeSafeInteger(last.completedRenderRevision) ||
          last.completedRenderRevision <= 0 ||
          !isNonnegativeSafeInteger(last.collectionRevisionAtPreRender) ||
          !isNonnegativeSafeInteger(last.collectionRevisionAtPostRender) ||
          typeof last.updateOccurredForFrame !== 'boolean'
        )
          fail('last observer snapshot is malformed');
      }
      if (allowPartial && (!sample.capture || sample.generation === null)) {
        if (sample.currentUpdateReadyForGeneration !== false)
          fail('unavailable sample cannot claim readiness');
        continue;
      }
      if (
        !Number.isSafeInteger(sample.generation) ||
        sample.generation <= 0 ||
        !sample.capture ||
        typeof sample.capture !== 'object' ||
        !hasOnlyKeys(sample.capture, [
          'completedRenderRevision',
          'updateSequenceAtPreRender',
          'updateSequenceAtPostRender',
          'updateGeneration',
          'generationAtPreRender',
          'generationAtPostRender',
          'updateReturnedBoolean',
          'updateErrorName',
          'collectionRevisionAtUpdateEntry',
          'collectionRevisionAtUpdateReturn',
          'collectionRevisionAtPreRender',
          'collectionRevisionAtPostRender',
          'updateOccurredForFrame',
        ]) ||
        !Number.isSafeInteger(sample.capture.completedRenderRevision) ||
        sample.capture.completedRenderRevision <= 0 ||
        !Number.isSafeInteger(sample.capture.updateSequenceAtPreRender) ||
        sample.capture.updateSequenceAtPreRender <= 0 ||
        !Number.isSafeInteger(sample.capture.updateSequenceAtPostRender) ||
        sample.capture.updateSequenceAtPostRender <= 0 ||
        !Number.isSafeInteger(sample.capture.updateGeneration) ||
        !Number.isSafeInteger(sample.capture.generationAtPreRender) ||
        !Number.isSafeInteger(sample.capture.generationAtPostRender) ||
        ![true, false, null].includes(sample.capture.updateReturnedBoolean) ||
        ![null, 'TypeError', 'DeveloperError', 'RangeError', 'Error'].includes(
          sample.capture.updateErrorName,
        ) ||
        typeof sample.capture.updateOccurredForFrame !== 'boolean' ||
        typeof sample.latchedDataSourceDisplayReady !== 'boolean' ||
        !isNonnegativeSafeInteger(
          sample.capture.collectionRevisionAtUpdateEntry,
        ) ||
        !isNonnegativeSafeInteger(
          sample.capture.collectionRevisionAtUpdateReturn,
        ) ||
        !isNonnegativeSafeInteger(
          sample.capture.collectionRevisionAtPreRender,
        ) ||
        !isNonnegativeSafeInteger(sample.capture.collectionRevisionAtPostRender)
      )
        fail('sample witness is malformed');
      const capture = sample.capture;
      const revisionsAgree =
        capture.collectionRevisionAtUpdateEntry ===
          capture.collectionRevisionAtUpdateReturn &&
        capture.collectionRevisionAtUpdateReturn ===
          capture.collectionRevisionAtPreRender &&
        capture.collectionRevisionAtPreRender ===
          capture.collectionRevisionAtPostRender;
      const currentReady =
        capture.updateOccurredForFrame === true &&
        capture.updateReturnedBoolean === true &&
        capture.updateErrorName === null &&
        capture.updateGeneration === sample.generation &&
        capture.generationAtPreRender === sample.generation &&
        capture.generationAtPostRender === sample.generation &&
        capture.updateSequenceAtPreRender ===
          capture.updateSequenceAtPostRender &&
        revisionsAgree;
      if (
        lifetime.finalObserverState &&
        (sample.generation > lifetime.finalObserverState.generationCount ||
          capture.updateSequenceAtPostRender >
            lifetime.finalObserverState.updateCallCount ||
          capture.completedRenderRevision >
            lifetime.finalObserverState.completedRenderRevision ||
          capture.collectionRevisionAtPostRender >
            lifetime.finalObserverState.collectionRevision)
      )
        fail('sample witness exceeds its final observer counters');
      if (sample.currentUpdateReadyForGeneration !== currentReady)
        fail('sample readiness does not match the captured update witness');
      if (sample.captureFrameErrorName !== null && currentReady)
        fail('capture error cannot accompany a ready current frame');
      if (!allowPartial && !currentReady)
        fail('complete diagnostic contains an unready current update');
    }
    if (!allowPartial && envelope.status === 'complete') {
      const expected = completeSampleIdentities();
      if (
        lifetime.available !== true ||
        lifetime.cleanupConfirmed !== true ||
        lifetime.samples.length !== expected.length ||
        expected.some((identity) => !identities.has(identity)) ||
        lifetime.samples.some(
          (sample) =>
            sample.status !== 'settled' ||
            sample.captureFrameErrorName !== null ||
            sample.currentUpdateReadyForGeneration !== true,
        )
      )
        fail('complete diagnostic lacks full settled sample coverage');
    }
  }
  return envelope;
}

const safeErrorName = (error) =>
  ['TypeError', 'DeveloperError', 'RangeError'].includes(error?.name)
    ? error.name
    : 'Error';

function addOwnedListener(event, listener) {
  if (typeof event?.addEventListener !== 'function')
    throw new TypeError('Scene render event is unavailable.');
  const remove = event.addEventListener(listener);
  if (typeof remove === 'function') return remove;
  if (typeof event.removeEventListener === 'function')
    return () => event.removeEventListener(listener);
  throw new TypeError('Scene render event cleanup is unavailable.');
}

/**
 * Observe the result of the DataSourceDisplay.update call Cesium already makes.
 * This wrapper never calls update itself and only binds that result to an
 * ordinary preRender/postRender pair.
 */
export function installInfrastructureCurrentUpdateReadinessObserver({
  dataSourceDisplay,
  scene,
  entityCollection,
}) {
  let active = true;
  let generationCounter = 0;
  let currentGeneration = 0;
  let updateSequence = 0;
  let collectionRevision = 0;
  let completedRenderRevision = 0;
  let lastCompletedUpdateSequence = 0;
  let latestUpdate = null;
  let pendingRender = null;
  let latestCompletedRender = null;
  let removeCollectionChanged = null;
  let removePreRender = null;
  let removePostRender = null;
  let updateWrapper = null;
  let installErrorName = null;
  let updateRestoreStatus = 'not-installed';
  let cleanupConfirmed = false;
  const originalOwnDescriptor =
    dataSourceDisplay &&
    Object.getOwnPropertyDescriptor(dataSourceDisplay, 'update');
  const originalUpdate = dataSourceDisplay?.update;

  const observer = {
    schema: INFRASTRUCTURE_CURRENT_UPDATE_READINESS_SCHEMA,
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
        snapshot.completedRenderRevision > 0 &&
        snapshot.collectionRevisionAtUpdateEntry ===
          snapshot.collectionRevisionAtPostRender &&
        snapshot.collectionRevisionAtUpdateReturn ===
          snapshot.collectionRevisionAtPostRender &&
        snapshot.collectionRevisionAtUpdateEntry ===
          snapshot.collectionRevisionAtUpdateReturn &&
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
      for (const [name, remove] of [
        ['collectionChanged', removeCollectionChanged],
        ['preRender', removePreRender],
        ['postRender', removePostRender],
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
        if (name === 'collectionChanged') removeCollectionChanged = null;
        else if (name === 'preRender') removePreRender = null;
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
      return cleanupConfirmed;
    },
    snapshot() {
      return {
        schema: INFRASTRUCTURE_CURRENT_UPDATE_READINESS_SCHEMA,
        available: observer.available,
        cleanupConfirmed,
        updateRestoreStatus,
        generationCount: generationCounter,
        updateCallCount: updateSequence,
        collectionRevision,
        completedRenderRevision,
        installErrorName,
      };
    },
  };

  try {
    if (
      typeof originalUpdate !== 'function' ||
      typeof entityCollection?.collectionChanged?.addEventListener !==
        'function' ||
      typeof scene?.preRender?.addEventListener !== 'function' ||
      typeof scene?.postRender?.addEventListener !== 'function'
    )
      throw new TypeError(
        'DataSourceDisplay update observation is unavailable.',
      );
    updateWrapper = function (...args) {
      if (!active || this !== dataSourceDisplay)
        return Reflect.apply(originalUpdate, this, args);
      const sequence = ++updateSequence;
      const generation = currentGeneration;
      const collectionRevisionAtEntry = collectionRevision;
      let result;
      try {
        result = Reflect.apply(originalUpdate, this, args);
      } catch (error) {
        latestUpdate = {
          sequence,
          generation,
          collectionRevisionAtEntry,
          collectionRevisionAtReturn: collectionRevision,
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
    removeCollectionChanged = addOwnedListener(
      entityCollection.collectionChanged,
      () => {
        collectionRevision += 1;
      },
    );
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
