const SHA1 = /^[a-f0-9]{40}$/i;

export function parseTerrainPickingLifecycleArgs(argv = []) {
  const options = {
    out: 'qa-artifacts/terrain-picking-lifecycle.json',
    cycles: 5,
    drainMs: 10_000,
  };
  const keys = new Map([
    ['--out', 'out'],
    ['--cycles', 'cycles'],
    ['--drain-ms', 'drainMs'],
  ]);
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const key = keys.get(flag);
    const value = argv[index + 1];
    if (!key || !value || value.startsWith('--'))
      throw new TypeError(`Invalid terrain lifecycle argument: ${flag}`);
    options[key] =
      key === 'cycles' || key === 'drainMs' ? Number(value) : value;
    index += 1;
  }
  if (
    typeof options.out !== 'string' ||
    !options.out ||
    options.out.length > 1024
  )
    throw new TypeError('--out must be a nonempty bounded path.');
  if (
    !Number.isSafeInteger(options.cycles) ||
    options.cycles < 1 ||
    options.cycles > 10
  )
    throw new RangeError('--cycles must be between 1 and 10.');
  if (
    !Number.isSafeInteger(options.drainMs) ||
    options.drainMs < 1 ||
    options.drainMs > 10_000
  )
    throw new RangeError('--drain-ms must be between 1 and 10000.');
  return Object.freeze(options);
}

function validWorkers(snapshot) {
  if (
    !snapshot ||
    snapshot.instrumented !== true ||
    snapshot.overflow !== false ||
    !Number.isSafeInteger(snapshot.pending) ||
    snapshot.pending < 0 ||
    !Array.isArray(snapshot.workers) ||
    snapshot.workers.length > 64
  )
    return false;
  let pending = 0;
  for (const worker of snapshot.workers) {
    const counts = [
      worker?.submitted,
      worker?.completed,
      worker?.cancelled,
      worker?.pending,
      worker?.taskErrors,
      worker?.workerErrors,
      worker?.postErrors,
    ];
    if (
      counts.some((count) => !Number.isSafeInteger(count) || count < 0) ||
      worker.submitted !==
        worker.completed + worker.cancelled + worker.pending ||
      worker.taskErrors !== 0 ||
      worker.workerErrors !== 0 ||
      worker.postErrors !== 0
    )
      return false;
    pending += worker.pending;
  }
  return pending === snapshot.pending;
}

function workerTotals(snapshot) {
  if (!validWorkers(snapshot)) return null;
  return snapshot.workers.reduce(
    (totals, worker) => {
      totals.submitted += worker.submitted;
      totals.completed += worker.completed;
      totals.cancelled += worker.cancelled;
      totals.pending += worker.pending;
      return totals;
    },
    { submitted: 0, completed: 0, cancelled: 0, pending: 0 },
  );
}

function validMapDiagnostics(map) {
  return (
    map &&
    ['qa-terrain-flat', 'qa-terrain-relief'].includes(map.activeStackId) &&
    ['manual', 'automatic'].includes(map.switchOrigin) &&
    [
      map.cacheEntries,
      map.pendingJobs,
      map.imageryLayers,
      map.primitives,
      map.providerLoadsStarted,
      map.providerCacheReuses,
      map.providerLoadFailures,
    ].every((value) => Number.isSafeInteger(value) && value >= 0) &&
    (map.estimatedTileBytes === null ||
      (Number.isFinite(map.estimatedTileBytes) &&
        map.estimatedTileBytes >= 0)) &&
    map.streamedTileMemoryBytes === null &&
    map.streamedTileMemoryUnavailableReason ===
      'local single-tile imagery and custom heightmap fixture; no streamed 3D tile memory source'
  );
}

function validSettledSnapshot(snapshot) {
  return (
    snapshot &&
    validMapDiagnostics(snapshot.map) &&
    snapshot.map.pendingJobs === 0 &&
    Number.isSafeInteger(snapshot.map.imageryLayers) &&
    snapshot.map.imageryLayers >= 0 &&
    snapshot.cables &&
    Number.isSafeInteger(snapshot.cables.listeners) &&
    snapshot.cables.listeners >= 0 &&
    snapshot.cables.pendingJobs === 0 &&
    Number.isSafeInteger(snapshot.cables.dataSources) &&
    snapshot.cables.dataSources >= 0 &&
    Number.isSafeInteger(snapshot.cables.cacheEntries) &&
    snapshot.cables.cacheEntries >= 0 &&
    snapshot.scene &&
    snapshot.scene.globeTilesLoaded === true &&
    snapshot.scene.dataSourceDisplayReady === true &&
    Number.isSafeInteger(snapshot.scene.frameNumber) &&
    snapshot.scene.frameNumber >= 0 &&
    Array.isArray(snapshot.scene.canvas) &&
    snapshot.scene.canvas.length === 2 &&
    snapshot.scene.canvas.every(
      (value) => Number.isSafeInteger(value) && value > 0,
    ) &&
    Array.isArray(snapshot.scene.camera) &&
    snapshot.scene.camera.length === 3 &&
    snapshot.scene.camera.every(
      (vector) =>
        Array.isArray(vector) &&
        vector.length === 3 &&
        vector.every(Number.isFinite),
    ) &&
    validWorkers(snapshot.workerCounters) &&
    snapshot.workerCounters.pending === 0
  );
}

function validSwitchCheckpointSnapshot(snapshot, { settled = false } = {}) {
  if (
    !snapshot ||
    !validMapDiagnostics(snapshot.map) ||
    !Number.isSafeInteger(snapshot.map.pendingJobs) ||
    snapshot.map.pendingJobs < 0 ||
    !snapshot.cables ||
    !Number.isSafeInteger(snapshot.cables.listeners) ||
    snapshot.cables.listeners < 0 ||
    !Number.isSafeInteger(snapshot.cables.pendingJobs) ||
    snapshot.cables.pendingJobs < 0 ||
    !Number.isSafeInteger(snapshot.cables.dataSources) ||
    snapshot.cables.dataSources < 0 ||
    !Number.isSafeInteger(snapshot.cables.cacheEntries) ||
    snapshot.cables.cacheEntries < 0 ||
    !snapshot.scene ||
    !Number.isSafeInteger(snapshot.scene.frameNumber) ||
    snapshot.scene.frameNumber < 0 ||
    typeof snapshot.scene.globeTilesLoaded !== 'boolean' ||
    typeof snapshot.scene.dataSourceDisplayReady !== 'boolean' ||
    !validWorkers(snapshot.workerCounters)
  )
    return false;
  return (
    !settled ||
    (snapshot.map.pendingJobs === 0 &&
      snapshot.cables.pendingJobs === 0 &&
      snapshot.scene.globeTilesLoaded === true &&
      snapshot.scene.dataSourceDisplayReady === true &&
      snapshot.workerCounters.pending === 0)
  );
}

function validSwitchObservation(
  switchRow,
  { fromStackId, toStackId, measured },
) {
  const current = switchRow?.currentUpdateReadiness;
  const witness = current?.witness;
  const revisions = [
    witness?.collectionRevisionAtUpdateEntry,
    witness?.collectionRevisionAtUpdateReturn,
    witness?.collectionRevisionAtPreRender,
    witness?.collectionRevisionAtPostRender,
  ];
  const ownerRevisions = [
    witness?.collectionOwnerRevisionAtUpdateEntry,
    witness?.collectionOwnerRevisionAtUpdateReturn,
    witness?.collectionOwnerRevisionAtPreRender,
    witness?.collectionOwnerRevisionAtPostRender,
  ];
  if (
    !switchRow ||
    switchRow.status !== 'ready' ||
    switchRow.measured !== measured ||
    switchRow.fromStackId !== fromStackId ||
    switchRow.toStackId !== toStackId ||
    switchRow.switchOrigin !== 'manual' ||
    !Number.isFinite(switchRow.setStackElapsedMs) ||
    switchRow.setStackElapsedMs < 0 ||
    !Number.isFinite(switchRow.switchToSettledElapsedMs) ||
    switchRow.switchToSettledElapsedMs + 0.01 <
      switchRow.setStackElapsedMs + switchRow.sceneReadinessElapsedMs ||
    !Number.isFinite(switchRow.sceneReadinessElapsedMs) ||
    switchRow.sceneReadinessElapsedMs < switchRow.stableWindowMs ||
    !Number.isFinite(switchRow.stableWindowMs) ||
    switchRow.stableWindowMs < 0 ||
    switchRow.sceneReadiness?.status !== 'ready' ||
    typeof switchRow.sceneReadiness.label !== 'string' ||
    !switchRow.sceneReadiness.label ||
    !Number.isSafeInteger(switchRow.sceneReadiness.sampleCount) ||
    switchRow.sceneReadiness.sampleCount < 3 ||
    switchRow.sceneReadiness.sampleCount > 64 ||
    !switchRow.sceneReadiness.final ||
    !Number.isSafeInteger(switchRow.sceneReadiness.final.frameNumber) ||
    switchRow.sceneReadiness.final.currentUpdateReadiness?.ready !== true ||
    JSON.stringify(
      switchRow.sceneReadiness.final.currentUpdateReadiness.witness,
    ) !== JSON.stringify(witness) ||
    switchRow.sceneReadiness.elapsedMs !== switchRow.sceneReadinessElapsedMs ||
    switchRow.sceneReadiness.stableWindowMs !== switchRow.stableWindowMs ||
    switchRow.stableWindowMs < 1000 ||
    current?.ready !== true ||
    !Number.isSafeInteger(current.generation) ||
    current.generation < 1 ||
    !witness ||
    !Number.isSafeInteger(witness.completedRenderRevision) ||
    witness.completedRenderRevision < 1 ||
    !Number.isSafeInteger(witness.updateSequenceAtPreRender) ||
    witness.updateSequenceAtPreRender < 1 ||
    witness.updateSequenceAtPostRender !== witness.updateSequenceAtPreRender ||
    !revisions.every(
      (revision) => Number.isSafeInteger(revision) && revision >= 0,
    ) ||
    new Set(revisions).size !== 1 ||
    !ownerRevisions.every(
      (revision) => Number.isSafeInteger(revision) && revision >= 0,
    ) ||
    new Set(ownerRevisions).size !== 1 ||
    witness.updateOccurredForFrame !== true ||
    witness.updateReturnedBoolean !== true ||
    witness.updateErrorName !== null ||
    witness.updateGeneration !== current.generation ||
    witness.generationAtPreRender !== current.generation ||
    witness.generationAtPostRender !== current.generation ||
    !validSwitchCheckpointSnapshot(switchRow.before, { settled: true }) ||
    !validSwitchCheckpointSnapshot(switchRow.afterSetStack) ||
    !validSwitchCheckpointSnapshot(switchRow.afterReady, { settled: true }) ||
    switchRow.before.map.activeStackId !== fromStackId ||
    switchRow.afterSetStack.map.activeStackId !== toStackId ||
    switchRow.afterReady.map.activeStackId !== toStackId ||
    switchRow.pendingJobsAtSetStackCompletion !==
      switchRow.afterSetStack.map.pendingJobs ||
    switchRow.pendingJobsAfterReadiness !==
      switchRow.afterReady.map.pendingJobs ||
    switchRow.pendingJobsAfterReadiness !== 0 ||
    switchRow.providerLoadDelta !==
      switchRow.afterReady.map.providerLoadsStarted -
        switchRow.before.map.providerLoadsStarted ||
    switchRow.providerLoadDelta < 0 ||
    switchRow.providerCacheReuseDelta !==
      switchRow.afterReady.map.providerCacheReuses -
        switchRow.before.map.providerCacheReuses ||
    switchRow.providerCacheReuseDelta < 0 ||
    switchRow.providerLoadFailureDelta !==
      switchRow.afterReady.map.providerLoadFailures -
        switchRow.before.map.providerLoadFailures ||
    switchRow.providerLoadFailureDelta !== 0 ||
    switchRow.cacheEntryDelta !==
      switchRow.afterReady.map.cacheEntries -
        switchRow.before.map.cacheEntries ||
    switchRow.cacheEntryDelta < 0 ||
    !Number.isSafeInteger(switchRow.tileRequestsBefore) ||
    switchRow.tileRequestsBefore < 0 ||
    !Number.isSafeInteger(switchRow.tileRequestsAfter) ||
    switchRow.tileRequestsAfter < 0 ||
    switchRow.tileRequestDelta !==
      switchRow.tileRequestsAfter - switchRow.tileRequestsBefore ||
    !Number.isSafeInteger(switchRow.tileRequestDelta) ||
    switchRow.tileRequestDelta < 0 ||
    !Number.isSafeInteger(switchRow.workerSubmittedDelta) ||
    switchRow.workerSubmittedDelta < 0 ||
    !Number.isSafeInteger(switchRow.workerCompletedDelta) ||
    switchRow.workerCompletedDelta < 0 ||
    switchRow.workerPendingAfterReadiness !== 0 ||
    switchRow.estimatedTileBytesBefore !==
      switchRow.before.map.estimatedTileBytes ||
    switchRow.estimatedTileBytesAfter !==
      switchRow.afterReady.map.estimatedTileBytes
  )
    return false;
  const beforeWorkers = workerTotals(switchRow.before.workerCounters);
  const readyWorkers = workerTotals(switchRow.afterReady.workerCounters);
  return Boolean(
    beforeWorkers &&
    readyWorkers &&
    switchRow.workerSubmittedDelta ===
      readyWorkers.submitted - beforeWorkers.submitted &&
    switchRow.workerCompletedDelta ===
      readyWorkers.completed - beforeWorkers.completed &&
    switchRow.workerPendingAfterReadiness === readyWorkers.pending,
  );
}

export function validateTerrainPickingLifecycleReport(
  report,
  { expectedCycles = 5 } = {},
) {
  if (!report || report.schema !== 'gev-terrain-picking-lifecycle/v1')
    throw new TypeError('Unsupported terrain/picking lifecycle report schema.');
  if (report.status !== 'passed')
    throw new Error('Terrain/picking lifecycle report did not pass.');
  if (!SHA1.test(report.applicationCommit || ''))
    throw new Error('Terrain/picking report has no full application commit.');
  if (
    report.applicationCommit !== report.expectedApplicationCommit ||
    report.harnessCommit !== report.applicationCommit ||
    report.source?.commit !== report.applicationCommit
  )
    throw new Error(
      'Terrain/picking fixture identity does not match the declared commit.',
    );
  if (
    report.source?.cleanAtStart !== true ||
    report.source?.cleanAtEnd !== true
  )
    throw new Error('Terrain/picking report source identity is not clean.');
  if (report.fixture?.externalProviderCalls !== 0)
    throw new Error(
      'Terrain/picking fixture observed an external provider call.',
    );
  if (
    report.fixture?.terrainCoverage !==
    'local custom heightmap tiles and ellipsoid reset; no network quantized-mesh tiles'
  )
    throw new Error('Terrain coverage is absent or misrepresented.');
  if (!validSettledSnapshot(report.warmup))
    throw new Error(
      'Terrain/picking warm baseline is incomplete or unsettled.',
    );
  if (report.warmup.scene.terrainProviderKind !== 'EllipsoidTerrainProvider')
    throw new Error(
      'Terrain/picking baseline is not the ellipsoid reset state.',
    );
  if (
    report.switchComparison?.status !== 'passed' ||
    report.switchComparison.order !==
      'counterbalanced-relief-flat-and-flat-relief' ||
    report.switchComparison.timingBoundary !==
      'setStack promise completion and the separate stable-scene wait are observed independently; switch-to-settled wall time runs from just before setStack through the final ownership snapshot and includes those snapshot costs, so stage values are not summed as end-to-end time' ||
    report.switchComparison.stableSceneGate !==
      'existing waitForStableScene predicates: globe tiles loaded, latched DataSourceDisplay.ready, zero worker pending, stable camera and worker signature with advancing postRender for at least 1000 ms; current DataSourceDisplay.update true is now additionally required for comparison switches' ||
    report.switchComparison.checkpointScope !==
      'active source, provider cache/load counters, local heightmap request count, worker counters, pending ownership, and controller tile-memory estimate' ||
    report.switchComparison.streamedTileMemoryBytes !== null ||
    report.switchComparison.streamedTileMemoryUnavailableReason !==
      'fixture uses local single-tile imagery and a custom heightmap provider, not streamed 3D tiles' ||
    report.switchComparison.currentUpdateObserver?.available !== true ||
    report.switchComparison.currentUpdateObserver?.installErrorName !== null ||
    !Number.isSafeInteger(
      report.switchComparison.currentUpdateObserver?.entityCollectionCount,
    ) ||
    report.switchComparison.currentUpdateObserver.entityCollectionCount < 1 ||
    report.switchComparison.currentUpdateObserver.cleanupConfirmed !== true ||
    report.switchComparison.currentUpdateObserver.ownershipChanged !== false ||
    report.switchComparison.currentUpdateObserver.entityCollectionsMatch !==
      true ||
    report.switchComparison.currentUpdateObserver.finalState?.available !==
      true ||
    report.switchComparison.currentUpdateObserver.finalState
      ?.cleanupConfirmed !== true ||
    report.switchComparison.currentUpdateObserver.finalState
      ?.updateRestoreStatus !== 'restored' ||
    report.switchComparison.currentUpdateObserver.finalState
      ?.ownershipChanged !== false ||
    report.switchComparison.currentUpdateObserver.finalState
      ?.entityCollectionsMatch !== true ||
    report.switchComparison.currentUpdateObserver.requirement !==
      'each switch waits for the existing DataSourceDisplay.update result true, bound to unchanged public EntityCollection contents, data-source ownership revision, exact collection identities, and that completed frame; no extra update calls' ||
    !Number.isSafeInteger(
      report.switchComparison.currentUpdateObserver.finalState?.generationCount,
    ) ||
    report.switchComparison.currentUpdateObserver.finalState.generationCount !==
      expectedCycles * 3 - 1 ||
    !Number.isSafeInteger(
      report.switchComparison.currentUpdateObserver.finalState?.updateCallCount,
    ) ||
    report.switchComparison.currentUpdateObserver.finalState.updateCallCount <
      expectedCycles * 3 - 1 ||
    report.switchComparison.currentUpdateObserver.finalState
      ?.installErrorName !== null ||
    !Number.isSafeInteger(
      report.switchComparison.currentUpdateObserver.finalState
        ?.completedRenderRevision,
    ) ||
    report.switchComparison.currentUpdateObserver.finalState
      .completedRenderRevision < 1 ||
    !Number.isSafeInteger(
      report.switchComparison.currentUpdateObserver.finalState
        ?.collectionRevision,
    ) ||
    report.switchComparison.currentUpdateObserver.finalState
      .collectionRevision < 0 ||
    !Number.isSafeInteger(
      report.switchComparison.currentUpdateObserver.finalState
        ?.collectionOwnerRevision,
    ) ||
    report.switchComparison.currentUpdateObserver.finalState
      .collectionOwnerRevision < 0
  )
    throw new Error('Counterbalanced map-switch evidence is incomplete.');
  let expectedGeneration = 0;
  if (
    !Array.isArray(report.cycles) ||
    report.cycles.length !== expectedCycles ||
    report.cycles.some((row, index) => {
      const flatFirst = index % 2 === 1;
      const startStack = flatFirst ? 'qa-terrain-relief' : 'qa-terrain-flat';
      const firstTarget = flatFirst ? 'qa-terrain-flat' : 'qa-terrain-relief';
      const secondTarget = flatFirst ? 'qa-terrain-relief' : 'qa-terrain-flat';
      if (index > 0) {
        expectedGeneration += 1;
        if (
          !validSwitchObservation(row.warmStart, {
            fromStackId: flatFirst ? 'qa-terrain-flat' : 'qa-terrain-relief',
            toStackId: startStack,
            measured: false,
          }) ||
          row.warmStart.currentUpdateReadiness.generation !== expectedGeneration
        )
          return true;
      } else if (row.warmStart !== null) return true;
      expectedGeneration += 1;
      const firstGeneration = expectedGeneration;
      expectedGeneration += 1;
      const secondGeneration = expectedGeneration;
      return (
        row.status !== 'passed' ||
        row.cycle !== index + 1 ||
        !validSettledSnapshot(row.reliefSnapshot) ||
        !validSettledSnapshot(row.flatSnapshot) ||
        row.reliefSnapshot.scene.terrainProviderKind !==
          'CustomHeightmapTerrainProvider' ||
        row.flatSnapshot.scene.terrainProviderKind !==
          'EllipsoidTerrainProvider' ||
        row.flatSnapshot.map.cacheEntries !== report.warmup.map.cacheEntries ||
        row.flatSnapshot.map.imageryLayers !==
          report.warmup.map.imageryLayers ||
        row.flatSnapshot.cables.dataSources !==
          report.warmup.cables.dataSources ||
        row.flatSnapshot.cables.listeners !== report.warmup.cables.listeners ||
        row.flatSnapshot.cables.cacheEntries !==
          report.warmup.cables.cacheEntries ||
        row.order !== (flatFirst ? 'flat-relief' : 'relief-flat') ||
        !Array.isArray(row.switches) ||
        row.switches.length !== 2 ||
        row.switches[0]?.fromStackId !== startStack ||
        row.switches[0]?.toStackId !== firstTarget ||
        !validSwitchObservation(row.switches[0], {
          fromStackId: startStack,
          toStackId: firstTarget,
          measured: true,
        }) ||
        row.switches[0].currentUpdateReadiness.generation !== firstGeneration ||
        !validSwitchObservation(row.switches[1], {
          fromStackId: firstTarget,
          toStackId: secondTarget,
          measured: true,
        }) ||
        row.switches[1].currentUpdateReadiness.generation !==
          secondGeneration ||
        JSON.stringify(row.reliefSnapshot) !==
          JSON.stringify(
            row.switches.find(
              (switchRow) => switchRow.toStackId === 'qa-terrain-relief',
            )?.afterReady,
          ) ||
        JSON.stringify(row.flatSnapshot) !==
          JSON.stringify(
            row.switches.find(
              (switchRow) => switchRow.toStackId === 'qa-terrain-flat',
            )?.afterReady,
          )
      );
    }) ||
    expectedGeneration !== expectedCycles * 3 - 1
  )
    throw new Error('Terrain/picking toggle cycle inventory is incomplete.');
  if (
    report.localTerrain?.tileRequests < 1 ||
    !Number.isSafeInteger(report.localTerrain.tileRequests) ||
    !report.firstTerrainTransition ||
    report.firstTerrainTransition.status !== 'passed' ||
    !validWorkers(report.firstTerrainTransition.beforeWorkerCounters) ||
    !validWorkers(report.firstTerrainTransition.afterWorkerCounters) ||
    report.firstTerrainTransition.afterWorkerCounters.pending !== 0 ||
    !Number.isSafeInteger(report.firstTerrainTransition.submittedDelta) ||
    report.firstTerrainTransition.submittedDelta < 1 ||
    !Number.isSafeInteger(report.firstTerrainTransition.completedDelta) ||
    report.firstTerrainTransition.completedDelta < 1 ||
    report.firstTerrainTransition.completedDelta !==
      workerTotals(report.firstTerrainTransition.afterWorkerCounters)
        .completed -
        workerTotals(report.firstTerrainTransition.beforeWorkerCounters)
          .completed ||
    report.firstTerrainTransition.submittedDelta !==
      workerTotals(report.firstTerrainTransition.afterWorkerCounters)
        .submitted -
        workerTotals(report.firstTerrainTransition.beforeWorkerCounters)
          .submitted ||
    report.firstTerrainTransition.tileRequestsBefore !== 0 ||
    report.firstTerrainTransition.tileRequestsAfter < 1 ||
    !report.firstTerrainTransition.initialSceneAndCableWorkerActivity ||
    !validWorkers(
      report.firstTerrainTransition.initialSceneAndCableWorkerActivity
        .atInitialReadiness,
    ) ||
    !validWorkers(
      report.firstTerrainTransition.initialSceneAndCableWorkerActivity
        .beforeTerrainSwitch,
    ) ||
    report.staleTerrainReplacement?.status !== 'passed' ||
    report.staleTerrainReplacement.delayedSignalAborted !== false ||
    report.staleTerrainReplacement.selectedStack !== 'qa-terrain-relief' ||
    report.destroyLateTerrain?.status !== 'passed' ||
    report.destroyLateTerrain.signalAborted !== true ||
    report.destroyLateTerrain.fixtureOwnedDisposalHookCalledOnce !== true ||
    report.destroyLateTerrain.disposalScope !==
      'fixture-owned hook only; this Cesium EllipsoidTerrainProvider has no native destroy method'
  )
    throw new Error('Terrain replacement/cancellation evidence is incomplete.');
  if (
    report.initialPick?.status !== 'passed' ||
    !report.initialPick.pickedEntityId ||
    report.selectionLifecycle?.status !== 'passed' ||
    report.selectionLifecycle.completedReenablePicks !== 3 ||
    report.selectionLifecycle.stalePickAccepted !== false
  )
    throw new Error(
      'Current/stale selection lifecycle evidence is incomplete.',
    );
  if (
    report.fixtureCleanup?.status !== 'passed' ||
    report.fixtureCleanup.viewerDestroyed !== true ||
    report.fixtureCleanup.final?.cables?.listeners !== 0 ||
    report.fixtureCleanup.final?.cables?.dataSources !== 0 ||
    report.fixtureCleanup.final?.cables?.cacheEntries !== 0 ||
    report.fixtureCleanup.final?.map?.pendingJobs !== 0 ||
    report.fixtureCleanup.final?.map?.cacheEntries !== 0 ||
    report.fixtureCleanup.final?.map?.imageryLayers !== 0 ||
    report.cleanup?.pageClosed !== true ||
    report.cleanup?.browserClose?.closeCompleted !== true ||
    report.cleanup?.browserClose?.forcedProcessTermination === true ||
    report.cleanup?.serverClosed !== true
  )
    throw new Error('Terrain/picking fixture cleanup was incomplete.');
  return {
    status: 'passed',
    cycles: report.cycles.length,
    switchTransitions: report.cycles.length * 2,
    terrainTileRequests: report.localTerrain.tileRequests,
    terrainTransitionWorkerSubmissions:
      report.firstTerrainTransition.submittedDelta,
    terrainTransitionWorkerCompletions:
      report.firstTerrainTransition.completedDelta,
    selectionReenablePicks: report.selectionLifecycle.completedReenablePicks,
    applicationCommit: report.applicationCommit,
  };
}
