const SHA1 = /^[a-f0-9]{40}$/i;
const SHA256 = /^[a-f0-9]{64}$/i;
const STREAMED_TILE_ID = 's57-local-http-3dtiles-v1';
const STREAMED_TILE_STACK = 'qa-streamed-tiles';
const STREAMED_TILE_PATHS = Object.freeze({
  manifest: '/qa/s57-streaming/tileset.json',
  content: '/qa/s57-streaming/tile.glb',
});

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
      'legacy terrain-only observation; streamed tile ownership and memory are reported separately under streamedTiles'
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

function validTileSnapshot(snapshot, { active = false } = {}) {
  return (
    snapshot &&
    snapshot.factoryCalls === 1 &&
    snapshot.objectId === 1 &&
    (active
      ? snapshot.activeStackId === STREAMED_TILE_STACK &&
        snapshot.attachedToScene === true &&
        snapshot.show === true &&
        snapshot.tilesLoaded === true &&
        snapshot.latestVisible?.contentReady === true &&
        snapshot.latestVisible?.contentType === 'Model3DTileContent'
      : snapshot.activeStackId === 'qa-terrain-flat' &&
        snapshot.show === false) &&
    Number.isSafeInteger(snapshot.tileVisibleCount) &&
    snapshot.tileVisibleCount >= 0 &&
    Number.isSafeInteger(snapshot.tileLoadCount) &&
    snapshot.tileLoadCount >= 0 &&
    Number.isSafeInteger(snapshot.loadProgressCount) &&
    snapshot.loadProgressCount >= 0 &&
    snapshot.failureCount === 0 &&
    Number.isFinite(snapshot.maximumScreenSpaceError) &&
    snapshot.maximumScreenSpaceError > 0 &&
    typeof snapshot.dynamicScreenSpaceError === 'boolean' &&
    (snapshot.totalMemoryUsageInBytes === null ||
      (Number.isFinite(snapshot.totalMemoryUsageInBytes) &&
        snapshot.totalMemoryUsageInBytes >= 0)) &&
    (snapshot.totalMemoryUsageInBytes === null
      ? snapshot.totalMemoryUsageStatus === 'unavailable' &&
        snapshot.totalMemoryUsageUnavailableReason ===
          'Cesium3DTileset.totalMemoryUsageInBytes unavailable for this snapshot'
      : snapshot.totalMemoryUsageStatus === 'observed' &&
        snapshot.totalMemoryUsageUnavailableReason === null)
  );
}

function validStreamedTileSwitch(row, from, to) {
  if (
    row?.status !== 'ready' ||
    row.fromStackId !== from ||
    row.toStackId !== to ||
    !Number.isFinite(row.setStackElapsedMs) ||
    row.setStackElapsedMs < 0 ||
    !Number.isFinite(row.readinessElapsedMs) ||
    row.readinessElapsedMs < 0 ||
    !Number.isFinite(row.switchToSettledElapsedMs) ||
    row.switchToSettledElapsedMs + 0.01 <
      row.setStackElapsedMs + row.readinessElapsedMs ||
    !Number.isSafeInteger(row.providerLoadDelta) ||
    row.providerLoadDelta < 0 ||
    !Number.isSafeInteger(row.providerCacheReuseDelta) ||
    row.providerCacheReuseDelta < 0 ||
    row.pendingJobsAfterReadiness !== 0 ||
    row.readiness?.status !== 'ready' ||
    !Array.isArray(row.readiness.samples) ||
    row.readiness.samples.length < 3 ||
    row.readiness.samples.length > 64 ||
    !validStreamedControllerDiagnostics(row.before?.diagnostics) ||
    !validStreamedControllerDiagnostics(row.after?.diagnostics) ||
    row.providerLoadDelta !==
      row.after.diagnostics.providerLoadsStarted -
        row.before.diagnostics.providerLoadsStarted ||
    row.providerLoadDelta !== 0 ||
    row.providerCacheReuseDelta !==
      row.after.diagnostics.providerCacheReuses -
        row.before.diagnostics.providerCacheReuses ||
    row.providerCacheReuseDelta < 1 ||
    row.pendingJobsAfterReadiness !== row.after.diagnostics.pendingJobs ||
    row.pendingJobsAfterReadiness !== 0 ||
    row.after.diagnostics.providerLoadFailures !==
      row.before.diagnostics.providerLoadFailures ||
    row.after.diagnostics.providerLoadFailures !== 0
  )
    return false;
  if (to === STREAMED_TILE_STACK)
    return (
      row.providerCacheReuseDelta >= 1 &&
      row.readiness.final?.activeStackId === STREAMED_TILE_STACK &&
      row.readiness.final?.globeShow === false &&
      row.readiness.final?.tileset?.tilesLoaded === true &&
      row.readiness.final?.tileset?.latestVisible?.contentReady === true &&
      Number.isSafeInteger(row.readiness.startFrame) &&
      Number.isSafeInteger(
        row.readiness.final?.tileset?.latestVisible?.frameNumber,
      ) &&
      row.readiness.final.tileset.latestVisible.frameNumber >
        row.readiness.startFrame &&
      row.readiness.final?.workerPending === 0 &&
      row.readiness.stableWindowMs >= 1000 &&
      validTileSnapshot(row.after?.tile, { active: true })
    );
  return (
    row.readiness.final?.activeStackId === 'qa-terrain-flat' &&
    row.readiness.final?.tilesLoaded === true &&
    row.readiness.final?.workerCounters?.pending === 0 &&
    validTileSnapshot(row.after?.tile)
  );
}

function validStreamedTileEvidence(report, expectedCycles) {
  const evidence = report?.streamedTiles;
  const assets = report?.streamedTileAssets;
  const http = report?.streamedTileHttpEvidence;
  if (
    evidence?.status !== 'passed' ||
    evidence.fixtureId !== STREAMED_TILE_ID ||
    evidence.stackId !== STREAMED_TILE_STACK ||
    evidence.assetPaths?.manifest !== STREAMED_TILE_PATHS.manifest ||
    evidence.assetPaths?.content !== STREAMED_TILE_PATHS.content ||
    assets?.fixtureId !== STREAMED_TILE_ID ||
    assets.manifest?.path !== STREAMED_TILE_PATHS.manifest ||
    assets.content?.path !== STREAMED_TILE_PATHS.content ||
    !SHA256.test(assets.manifest?.sha256 || '') ||
    !SHA256.test(assets.content?.sha256 || '') ||
    !Number.isSafeInteger(assets.manifest?.byteLength) ||
    assets.manifest.byteLength < 100 ||
    !Number.isSafeInteger(assets.content?.byteLength) ||
    assets.content.byteLength < 20 ||
    evidence.supersededFactory?.status !== 'passed' ||
    !Number.isFinite(evidence.supersededFactory.elapsedMs) ||
    evidence.supersededFactory.elapsedMs < 0 ||
    !Number.isSafeInteger(evidence.supersededFactory.staleGeneration) ||
    evidence.supersededFactory.staleGeneration < 1 ||
    !Number.isSafeInteger(evidence.supersededFactory.supersedingGeneration) ||
    evidence.supersededFactory.supersedingGeneration <=
      evidence.supersededFactory.staleGeneration ||
    evidence.supersededFactory.factoryCalls !== 1 ||
    evidence.supersededFactory.signalAborted !== false ||
    evidence.supersededFactory.factoryResolvedWhileFlatActive !== true ||
    evidence.supersededFactory.sceneAttachmentAfterLateResolution !== false ||
    evidence.supersededFactory.activeStackAfterLateResolution !==
      'qa-terrain-flat' ||
    !Number.isFinite(
      evidence.supersededFactory.httpCheckpointBeforeTileActivation
        ?.observedAfterMs,
    ) ||
    evidence.supersededFactory.httpCheckpointBeforeTileActivation
      .observedAfterMs < 0 ||
    evidence.supersededFactory.httpCheckpointBeforeTileActivation
      .observedAfterMs > 1000 ||
    evidence.supersededFactory.httpCheckpointBeforeTileActivation?.browser
      ?.counts?.manifest?.completed !== 1 ||
    evidence.supersededFactory.httpCheckpointBeforeTileActivation?.browser
      ?.counts?.manifest?.requests !== 1 ||
    evidence.supersededFactory.httpCheckpointBeforeTileActivation?.browser
      ?.counts?.manifest?.responses !== 1 ||
    evidence.supersededFactory.httpCheckpointBeforeTileActivation?.browser
      ?.counts?.content?.requests !== 0 ||
    evidence.supersededFactory.httpCheckpointBeforeTileActivation?.server
      ?.counts?.manifest?.successfulResponses !== 1 ||
    evidence.supersededFactory.httpCheckpointBeforeTileActivation?.server
      ?.counts?.manifest?.requests !== 1 ||
    evidence.supersededFactory.httpCheckpointBeforeTileActivation?.server
      ?.counts?.content?.requests !== 0 ||
    evidence.pendingContentActivation?.status !== 'activated-pending-content' ||
    evidence.pendingContentActivation.activeStackId !== STREAMED_TILE_STACK ||
    !Number.isFinite(evidence.pendingContentActivation.setStackElapsedMs) ||
    evidence.pendingContentActivation.setStackElapsedMs < 0 ||
    evidence.supersededContent?.status !== 'passed' ||
    evidence.supersededContent.observedPausedContentPath !==
      STREAMED_TILE_PATHS.content ||
    evidence.supersededContent.activeStackAtPause !== STREAMED_TILE_STACK ||
    evidence.supersededContent.activeStackAfterSupersession !==
      'qa-terrain-flat' ||
    evidence.supersededContent.tileSetHiddenAtCancellation !== true ||
    evidence.supersededContent.cancellation?.status !==
      'cancellation-observed' ||
    evidence.supersededContent.cancellation?.request?.failure !== true ||
    evidence.supersededContent.cancellation?.request?.failureClass !==
      'cancellation' ||
    !['ERR_ABORTED', 'ERR_CANCELED'].includes(
      evidence.supersededContent.cancellation?.request?.failureCode,
    ) ||
    evidence.supersededContent.cancellation?.activeStackId !==
      'qa-terrain-flat' ||
    evidence.supersededContent.cancellation?.tileSetShow !== false ||
    !Number.isFinite(evidence.supersededContent.cancellation?.elapsedMs) ||
    evidence.supersededContent.cancellation.elapsedMs < 0 ||
    evidence.supersededContent.cancellation.browser?.counts?.content
      ?.requests !== 1 ||
    evidence.supersededContent.cancellation.browser?.counts?.content?.failed !==
      1 ||
    evidence.supersededContent.cancellation.browser?.pendingCount !== 0 ||
    evidence.supersededContent.cancellation?.server?.counts?.content
      ?.requests !== 0 ||
    !validStreamedBrowserEvidence(
      evidence.supersededContent.delivery?.browser,
      assets,
    ) ||
    !sameStreamedBrowserRequestRows(
      evidence.supersededContent.delivery.browser.requests,
      http?.browser?.requests,
    ) ||
    evidence.supersededContent.delivery?.server?.counts?.content?.requests !==
      1 ||
    evidence.supersededContent.delivery?.server?.counts?.content
      ?.successfulResponses !== 1 ||
    evidence.supersededContent.browserAtPause?.counts?.content?.requests !==
      1 ||
    evidence.supersededContent.browserAtPause?.counts?.content?.completed !==
      0 ||
    evidence.supersededContent.serverAtPause?.counts?.content?.requests !== 0 ||
    !validStreamedTileSwitch(
      evidence.firstVisibleActivation,
      'qa-terrain-flat',
      STREAMED_TILE_STACK,
    ) ||
    !validStreamedTileSwitch(
      evidence.postWarmReturn,
      STREAMED_TILE_STACK,
      'qa-terrain-flat',
    ) ||
    !validTileSnapshot(evidence.warmCacheState?.tile, { active: true }) ||
    !Array.isArray(evidence.cycles) ||
    evidence.cycles.length !== expectedCycles ||
    evidence.cycles.some((row, index) => {
      const tilesFirst = (index + 1) % 2 === 0;
      const first = tilesFirst ? STREAMED_TILE_STACK : 'qa-terrain-flat';
      const second = tilesFirst ? 'qa-terrain-flat' : STREAMED_TILE_STACK;
      return (
        row.status !== 'passed' ||
        row.cycle !== index + 1 ||
        row.order !== (tilesFirst ? 'tiles-flat-tiles' : 'flat-tiles-flat') ||
        !Array.isArray(row.switches) ||
        row.switches.length !== 2 ||
        !validStreamedTileSwitch(row.switches[0], first, second) ||
        !validStreamedTileSwitch(row.switches[1], second, first) ||
        (row.warmStart !== null &&
          !validStreamedTileSwitch(
            row.warmStart,
            tilesFirst ? 'qa-terrain-flat' : STREAMED_TILE_STACK,
            first,
          ))
      );
    }) ||
    !validTileSnapshot(evidence.final?.tile) ||
    evidence.final.activeStackId !== 'qa-terrain-flat' ||
    !Number.isSafeInteger(evidence.eventOverflowCount) ||
    evidence.eventOverflowCount < 0 ||
    !Array.isArray(evidence.eventRows) ||
    evidence.eventRows.length > 32 ||
    evidence.cleanup?.attemptedCount !== 4 ||
    evidence.cleanup?.removedCount !== 4 ||
    evidence.cleanup?.cleanupConfirmed !== true ||
    evidence.cleanup?.errors?.length !== 0 ||
    evidence.controllerDestroyedTileset !== true ||
    http?.assetIdentity?.manifest?.sha256 !== assets.manifest.sha256 ||
    http?.assetIdentity?.content?.sha256 !== assets.content.sha256 ||
    !validStreamedBrowserEvidence(http?.browser, assets) ||
    http?.server?.source !== 'local-http-server-request-events' ||
    http.server.overflowCount !== 0 ||
    http.server.pendingCount !== 0 ||
    http.server.counts?.manifest?.requests !== 1 ||
    http.server.counts?.manifest?.successfulResponses !== 1 ||
    http.server.counts?.manifest?.bytesFromHeader !==
      assets.manifest.byteLength ||
    http.server.counts?.content?.requests !== 1 ||
    http.server.counts?.content?.successfulResponses !== 1 ||
    http.server.counts?.content?.bytesFromHeader !==
      assets.content.byteLength ||
    http.networkListenerCleanupConfirmed !== true ||
    http.serverListenerCleanupConfirmed !== true ||
    http.contentInterception?.status !== 'passed' ||
    http.contentInterception.pauseObservedBeforeContinue !== true ||
    http.contentInterception.supersededRequestTerminal?.status !==
      'cancellation-observed' ||
    !validCancelledContentRequest(
      http.contentInterception.supersededRequestTerminal?.request,
    ) ||
    http.contentInterception.supersededRequestTerminal.request.failureCode !==
      http.browser.requests.filter((row) => row.kind === 'content')[0]
        ?.failureCode ||
    http.contentInterception.supersededRequestTerminal?.server?.counts?.content
      ?.requests !== 0 ||
    http.contentInterception.supersededRequestTerminal?.browser
      ?.pendingCount !== 0 ||
    http.contentInterception.reactivationDelivery?.browserCounts?.completed !==
      1 ||
    http.contentInterception.reactivationDelivery?.browserCounts?.failed !==
      1 ||
    http.contentInterception.reactivationDelivery?.browserCounts?.requests !==
      2 ||
    http.contentInterception.reactivationDelivery?.serverCounts?.requests !==
      1 ||
    http.contentInterception.reactivationDelivery?.serverCounts
      ?.successfulResponses !== 1 ||
    http.contentInterception.browserAtPause?.counts?.content?.requests !== 1 ||
    http.contentInterception.browserAtPause?.counts?.content?.completed !== 0 ||
    http.contentInterception.serverAtPause?.counts?.content?.requests !== 0 ||
    report.fixtureCleanup?.final?.map?.primitives !== 0 ||
    report.fixtureCleanup?.final?.map?.cacheEntries !== 0
  )
    return false;
  const warmedDiagnostics = evidence.warmCacheState.diagnostics;
  const tileSnapshots = [
    evidence.firstVisibleActivation.after.tile,
    evidence.postWarmReturn.after.tile,
    evidence.warmCacheState.tile,
    evidence.final.tile,
    ...evidence.cycles.flatMap((cycle) =>
      cycle.switches.map((row) => row.after.tile),
    ),
  ];
  const tileSettings = tileSnapshots[0];
  const postWarmSwitches = [
    evidence.postWarmReturn,
    ...evidence.cycles.flatMap((cycle) => [
      ...(cycle.warmStart ? [cycle.warmStart] : []),
      ...cycle.switches,
    ]),
  ];
  return (
    tileSnapshots.every(
      (tile) =>
        tile &&
        Number.isFinite(tile.maximumScreenSpaceError) &&
        tile.maximumScreenSpaceError === tileSettings.maximumScreenSpaceError &&
        typeof tile.dynamicScreenSpaceError === 'boolean' &&
        tile.dynamicScreenSpaceError === tileSettings.dynamicScreenSpaceError,
    ) &&
    sameStreamedCacheOwnership(
      evidence.firstVisibleActivation.after?.diagnostics,
      warmedDiagnostics,
    ) &&
    sameStreamedCacheOwnership(
      evidence.final?.diagnostics,
      warmedDiagnostics,
    ) &&
    postWarmSwitches.every(
      (row) =>
        sameStreamedCacheOwnership(
          row.before?.diagnostics,
          warmedDiagnostics,
        ) &&
        sameStreamedCacheOwnership(row.after?.diagnostics, warmedDiagnostics),
    )
  );
}

function sameStreamedCacheOwnership(snapshot, warmed) {
  return (
    validStreamedControllerDiagnostics(snapshot) &&
    validStreamedControllerDiagnostics(warmed) &&
    snapshot.cacheEntries === warmed.cacheEntries &&
    snapshot.primitives === warmed.primitives &&
    snapshot.providerLoadsStarted === warmed.providerLoadsStarted &&
    snapshot.providerLoadFailures === warmed.providerLoadFailures &&
    snapshot.pendingJobs === 0
  );
}

function validStreamedControllerDiagnostics(value) {
  return (
    value &&
    [
      'pendingJobs',
      'primitives',
      'cacheEntries',
      'providerLoadsStarted',
      'providerCacheReuses',
      'providerLoadFailures',
    ].every((field) => Number.isSafeInteger(value[field]) && value[field] >= 0)
  );
}

function validCancelledContentRequest(row) {
  // The recognized network error code is the explicit cancellation witness;
  // retain the separate CDP canceled flag as context, but do not let it
  // override a generic transport failure.
  return (
    row?.kind === 'content' &&
    row.method === 'GET' &&
    row.status === null &&
    row.failure === true &&
    row.failureClass === 'cancellation' &&
    ['ERR_ABORTED', 'ERR_CANCELED'].includes(row.failureCode) &&
    row.encodedDataLength === null
  );
}

function validSuccessfulContentRequest(row) {
  return (
    row?.kind === 'content' &&
    row.method === 'GET' &&
    row.status === 200 &&
    row.failure === false &&
    row.failureClass === null &&
    row.failureCode === null &&
    row.canceled === null &&
    Number.isFinite(row.encodedDataLength) &&
    row.encodedDataLength > 0
  );
}

function validStreamedBrowserEvidence(snapshot, assets) {
  if (
    snapshot?.origin !== 'fixture-origin-only' ||
    snapshot.overflowCount !== 0 ||
    snapshot.pendingCount !== 0 ||
    snapshot.counts?.manifest?.requests !== 1 ||
    snapshot.counts?.manifest?.responses !== 1 ||
    snapshot.counts?.manifest?.completed !== 1 ||
    snapshot.counts?.manifest?.failed !== 0 ||
    snapshot.counts?.content?.requests !== 2 ||
    snapshot.counts?.content?.responses !== 1 ||
    snapshot.counts?.content?.completed !== 1 ||
    snapshot.counts?.content?.failed !== 1 ||
    !Array.isArray(snapshot.requests) ||
    snapshot.requests.length !== 3
  )
    return false;
  const [manifest, canceled, delivered] = snapshot.requests;
  return (
    manifest?.kind === 'manifest' &&
    manifest.method === 'GET' &&
    manifest.status === 200 &&
    manifest.failure === false &&
    Number.isFinite(manifest.encodedDataLength) &&
    manifest.encodedDataLength > 0 &&
    validCancelledContentRequest(canceled) &&
    validSuccessfulContentRequest(delivered)
  );
}

function sameStreamedBrowserRequestRows(first, second) {
  if (
    !Array.isArray(first) ||
    !Array.isArray(second) ||
    first.length !== second.length
  )
    return false;
  const fields = [
    'kind',
    'method',
    'status',
    'fromDiskCache',
    'fromServiceWorker',
    'fromPrefetchCache',
    'servedFromCache',
    'encodedDataLength',
    'failure',
    'failureClass',
    'failureCode',
    'canceled',
  ];
  return first.every((row, index) =>
    fields.every((field) => row[field] === second[index]?.[field]),
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
      'legacy terrain-only comparison excludes streamed tile memory; separate streamedTiles observations report it' ||
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
  if (!validStreamedTileEvidence(report, expectedCycles))
    throw new Error(
      'HTTP streamed-tile lifecycle evidence is incomplete or inconsistent.',
    );
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
    streamedTileFactoryCalls:
      report.streamedTiles.supersededFactory.factoryCalls,
    streamedTileHttpManifestResponses:
      report.streamedTileHttpEvidence.server.counts.manifest
        .successfulResponses,
    streamedTileHttpContentResponses:
      report.streamedTileHttpEvidence.server.counts.content.successfulResponses,
    streamedTileSwitches: report.streamedTiles.cycles.length * 2,
    applicationCommit: report.applicationCommit,
  };
}
