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

function validSettledSnapshot(snapshot) {
  return (
    snapshot &&
    snapshot.map &&
    Number.isSafeInteger(snapshot.map.cacheEntries) &&
    snapshot.map.cacheEntries >= 0 &&
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
    !Array.isArray(report.cycles) ||
    report.cycles.length !== expectedCycles ||
    report.cycles.some(
      (row, index) =>
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
          report.warmup.cables.cacheEntries,
    )
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
    terrainTileRequests: report.localTerrain.tileRequests,
    terrainTransitionWorkerSubmissions:
      report.firstTerrainTransition.submittedDelta,
    terrainTransitionWorkerCompletions:
      report.firstTerrainTransition.completedDelta,
    selectionReenablePicks: report.selectionLifecycle.completedReenablePicks,
    applicationCommit: report.applicationCommit,
  };
}
