export const IMPORT_GEOMETRY_WAKE_ARMS = Object.freeze([
  'whole-feature-timer',
  'chunked-timer',
  'chunked-message-channel',
]);
export const IMPORT_GEOMETRY_WAKE_TYPES = Object.freeze([
  'LineString',
  'Polygon',
]);
export const IMPORT_GEOMETRY_WAKE_PAIR_COUNT = 5;
const SHA1 = /^[a-f0-9]{40}$/i;
const SHA256 = /^[a-f0-9]{64}$/i;
const MAX_PNG_DATA_URL_LENGTH = 750_000;

export function createImportGeometryWakeRunRecord(
  fixture,
  { pairIndex, pageErrors },
) {
  return {
    ...fixture,
    pairIndex,
    pageErrors: [...pageErrors],
  };
}

function finiteNonnegative(value) {
  return Number.isFinite(value) && value >= 0;
}

function equalJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function median(values) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)];
}

export function summarizeImportGeometryWakeReport(report) {
  return Object.fromEntries(
    IMPORT_GEOMETRY_WAKE_TYPES.map((type) => [
      type,
      Object.fromEntries(
        IMPORT_GEOMETRY_WAKE_ARMS.map((arm) => {
          const samples = report.pairs.map(
            (pair) =>
              pair.runs[arm].samples[IMPORT_GEOMETRY_WAKE_TYPES.indexOf(type)],
          );
          return [
            arm,
            {
              runs: samples.length,
              medianLoadElapsedMs: median(
                samples.map((sample) => sample.loadElapsedMs),
              ),
              medianMaximumActiveSpanMs: median(
                samples.map((sample) => sample.maximumActiveSpanMs),
              ),
              medianTotalActiveSpanMs: median(
                samples.map((sample) => sample.totalActiveSpanMs),
              ),
              medianScheduledCallbacks: median(
                samples.map((sample) => sample.callbackCount),
              ),
              medianTotalWakeMs: median(
                samples.map((sample) =>
                  sample.wakeMs.reduce((sum, value) => sum + value, 0),
                ),
              ),
            },
          ];
        }),
      ),
    ]),
  );
}

export function validateImportGeometryWakeReport(
  report,
  { expectedCommit, expectedHarnessCommit = expectedCommit } = {},
) {
  if (
    report?.schema !== 'gev-import-geometry-wake/v1' ||
    report.status !== 'passed' ||
    report.contextIsolation !==
      'fresh-page-and-viewer-per-arm-run;shared-browser-process' ||
    report.performanceAccepted !== false ||
    report.batchBudgetAcceptance !== 'not-evaluated'
  )
    throw new Error('Large-geometry wake comparison is incomplete.');
  if (
    !SHA1.test(expectedCommit || '') ||
    !SHA1.test(expectedHarnessCommit || '') ||
    report.source?.applicationCommit !== expectedCommit ||
    report.source?.harnessCommit !== expectedHarnessCommit ||
    !SHA256.test(report.source?.runtimeLayerSha256 || '') ||
    !SHA256.test(report.source?.cooperativeSha256 || '') ||
    !SHA256.test(report.source?.fixtureSha256 || '') ||
    !SHA256.test(report.source?.fixtureHtmlSha256 || '') ||
    !SHA256.test(report.source?.schedulerSha256 || '') ||
    !SHA256.test(report.source?.packageLockSha256 || '') ||
    !SHA256.test(report.source?.cesiumEntrySha256 || '') ||
    !SHA256.test(report.source?.cesiumSceneSha256 || '') ||
    !SHA256.test(report.source?.runnerSha256 || '') ||
    !SHA256.test(report.source?.validatorSha256 || '') ||
    report.source?.dirtyAtStart !== false ||
    report.source?.sourceDirtyAtStart !== false ||
    report.source?.harnessDirtyAtStart !== false ||
    report.source?.changedDuringRun !== false
  )
    throw new Error('Large-geometry source provenance is invalid.');
  if (
    report.pairCount !== IMPORT_GEOMETRY_WAKE_PAIR_COUNT ||
    !Array.isArray(report.pairs) ||
    report.pairs.length !== IMPORT_GEOMETRY_WAKE_PAIR_COUNT
  )
    throw new Error('Large-geometry pair inventory is incomplete.');

  const settings = [];
  const sampleSettings = [];
  const geometryHashes = new Map();
  const pixelHashes = new Map();
  let pngBytes = 0;
  for (
    let pairIndex = 0;
    pairIndex < IMPORT_GEOMETRY_WAKE_PAIR_COUNT;
    pairIndex++
  ) {
    const pair = report.pairs[pairIndex];
    const expectedOrder = IMPORT_GEOMETRY_WAKE_ARMS.map(
      (_, offset) =>
        IMPORT_GEOMETRY_WAKE_ARMS[
          (pairIndex + offset) % IMPORT_GEOMETRY_WAKE_ARMS.length
        ],
    );
    if (
      pair?.index !== pairIndex ||
      !equalJson(pair.order, expectedOrder) ||
      !pair.runs ||
      !equalJson(
        Object.keys(pair.runs).sort(),
        [...IMPORT_GEOMETRY_WAKE_ARMS].sort(),
      )
    )
      throw new Error(`Pair ${pairIndex} has an invalid arm inventory.`);

    for (const arm of IMPORT_GEOMETRY_WAKE_ARMS) {
      const run = pair.runs[arm];
      if (
        run?.schema !== 'gev-import-geometry-wake-sample/v1' ||
        run.status !== 'passed' ||
        !Array.isArray(run.pageErrors) ||
        run.pageErrors.length !== 0 ||
        run.pageCleanup?.closeCompleted !== true ||
        run.pageCleanup?.openPageCount !== 0 ||
        run.pairIndex !== pairIndex ||
        run.applicationCommit !== expectedCommit ||
        run.harnessCommit !== expectedHarnessCommit ||
        run.arm !== arm ||
        run.schedulerKind !==
          (arm === 'chunked-message-channel'
            ? 'MessageChannel'
            : 'setTimeout') ||
        run.chunkSize !== (arm.startsWith('chunked-') ? 256 : 0) ||
        !Array.isArray(run.samples) ||
        run.samples.length !== IMPORT_GEOMETRY_WAKE_TYPES.length ||
        !Array.isArray(run.renderErrors) ||
        run.renderErrors.length !== 0 ||
        !run.environment ||
        typeof run.environment.canvas?.drawingBufferWidth !== 'number' ||
        typeof run.environment.canvas?.drawingBufferHeight !== 'number' ||
        run.environment.canvas.drawingBufferWidth <= 0 ||
        run.environment.canvas.drawingBufferHeight <= 0 ||
        run.environment.clockCurrentTime !== '2025-01-01T00:00:00.000Z' ||
        run.environment.clockShouldAnimate !== false ||
        typeof run.environment.msaa !== 'boolean' ||
        run.environment.renderLoop !== true ||
        typeof run.environment.requestRenderMode !== 'boolean' ||
        !Number.isFinite(run.environment.canvas.cssWidth) ||
        run.environment.canvas.cssWidth <= 0 ||
        !Number.isFinite(run.environment.canvas.cssHeight) ||
        run.environment.canvas.cssHeight <= 0 ||
        typeof run.environment.webglContextAttributes?.antialias !==
          'boolean' ||
        typeof run.environment.renderer !== 'string' ||
        run.environment.renderer.length === 0 ||
        typeof run.environment.vendor !== 'string' ||
        run.environment.vendor.length === 0 ||
        typeof run.environment.cesiumVersion !== 'string' ||
        run.environment.contextLost !== false ||
        !Number.isSafeInteger(run.environment.sceneMsaaSamples) ||
        run.environment.sceneMsaaSamples < 0 ||
        !Number.isFinite(run.environment.resolutionScale) ||
        run.environment.resolutionScale <= 0 ||
        run.environment.globeShow !== true ||
        run.environment.imageryLayerCount !== 0 ||
        run.environment.terrainProvider !== 'EllipsoidTerrainProvider'
      )
        throw new Error(
          `Pair ${pairIndex} ${arm} render evidence is incomplete.`,
        );
      settings.push(run.environment);

      for (
        let typeIndex = 0;
        typeIndex < IMPORT_GEOMETRY_WAKE_TYPES.length;
        typeIndex++
      ) {
        const type = IMPORT_GEOMETRY_WAKE_TYPES[typeIndex];
        const sample = run.samples[typeIndex];
        const expectedId = `gev-import:geometry-wake:large-geometry:${type}`;
        if (
          sample?.type !== type ||
          sample.entityId !== expectedId ||
          sample.positionCount !== 50_000 ||
          !Array.isArray(sample.ringLengths) ||
          !equalJson(
            sample.ringLengths,
            type === 'LineString' ? [50_000] : [25_000, 25_000],
          ) ||
          sample.ringLengths.reduce((sum, value) => sum + value, 0) !==
            50_000 ||
          !SHA256.test(sample.geometrySha256 || '') ||
          !finiteNonnegative(sample.loadElapsedMs) ||
          !finiteNonnegative(sample.initialActiveSpanMs) ||
          !finiteNonnegative(sample.maximumActiveSpanMs) ||
          !finiteNonnegative(sample.totalActiveSpanMs) ||
          !Number.isSafeInteger(sample.callbackCount) ||
          sample.callbackCount < 0 ||
          !Number.isSafeInteger(sample.scheduleCount) ||
          sample.scheduleCount !== sample.callbackCount ||
          !Number.isSafeInteger(sample.activeSpansOver4ms) ||
          sample.activeSpansOver4ms < 0 ||
          !Array.isArray(sample.wakeMs) ||
          !Array.isArray(sample.activeCallbackMs) ||
          sample.wakeMs.length !== sample.callbackCount ||
          sample.activeCallbackMs.length !== sample.callbackCount ||
          [...sample.wakeMs, ...sample.activeCallbackMs].some(
            (value) => !finiteNonnegative(value),
          )
        )
          throw new Error(
            `Pair ${pairIndex} ${arm} ${type} timings are invalid.`,
          );
        const activeSpans = [
          sample.initialActiveSpanMs,
          ...sample.activeCallbackMs,
        ];
        const maximumActiveSpanMs = Math.max(...activeSpans);
        const totalActiveSpanMs = activeSpans.reduce(
          (sum, value) => sum + value,
          0,
        );
        const activeSpansOver4ms = activeSpans.filter(
          (value) => value > 4,
        ).length;
        if (
          Math.abs(sample.maximumActiveSpanMs - maximumActiveSpanMs) > 0.001 ||
          Math.abs(sample.totalActiveSpanMs - totalActiveSpanMs) > 0.001 ||
          sample.activeSpansOver4ms !== activeSpansOver4ms ||
          sample.readiness?.timeoutMs !== 20_000 ||
          !Number.isSafeInteger(sample.readiness?.attempts) ||
          sample.readiness.attempts < 1
        )
          throw new Error(
            `Pair ${pairIndex} ${arm} ${type} timing summary is inconsistent.`,
          );
        if (
          !sample.renderSettings ||
          sample.renderSettings.fixedTime !== '2025-01-01T00:00:00.000Z' ||
          sample.renderSettings.clockCurrentTime !==
            '2025-01-01T00:00:00.000Z' ||
          sample.renderSettings.clockShouldAnimate !== false ||
          sample.renderSettings.sceneMode !== run.environment.sceneMode ||
          sample.renderSettings.requestRenderMode !==
            run.environment.requestRenderMode ||
          !equalJson(
            sample.renderSettings.webglContextAttributes,
            run.environment.webglContextAttributes,
          ) ||
          sample.renderSettings.globeShow !== true ||
          sample.renderSettings.terrainProvider !==
            'EllipsoidTerrainProvider' ||
          sample.renderSettings.imageryLayerCount !== 0 ||
          sample.renderSettings.canvasWidth !==
            run.environment.canvas.drawingBufferWidth ||
          sample.renderSettings.canvasHeight !==
            run.environment.canvas.drawingBufferHeight ||
          sample.renderSettings.renderer !== run.environment.renderer ||
          sample.renderSettings.vendor !== run.environment.vendor ||
          sample.renderSettings.cesiumVersion !==
            run.environment.cesiumVersion ||
          sample.renderSettings.contextLost !== false ||
          sample.renderSettings.sceneMsaaSamples !==
            run.environment.sceneMsaaSamples ||
          sample.renderSettings.resolutionScale !==
            run.environment.resolutionScale ||
          !equalJson(
            sample.renderSettings.cameraPosition,
            run.environment.cameraPosition,
          ) ||
          !equalJson(
            sample.renderSettings.cameraDirection,
            run.environment.cameraDirection,
          ) ||
          !Array.isArray(sample.renderSettings.cameraPosition) ||
          sample.renderSettings.cameraPosition.length !== 3 ||
          sample.renderSettings.cameraPosition.some(
            (value) => !Number.isFinite(value),
          ) ||
          !Array.isArray(sample.renderSettings.cameraDirection) ||
          sample.renderSettings.cameraDirection.length !== 3 ||
          sample.renderSettings.cameraDirection.some(
            (value) => !Number.isFinite(value),
          )
        )
          throw new Error(
            `Pair ${pairIndex} ${arm} ${type} settings are invalid.`,
          );
        sampleSettings.push(sample.renderSettings);
        if (
          sample.readiness?.status !== 'passed' ||
          sample.readiness.pickedEntityId !== expectedId ||
          sample.readiness.onCanvas !== true ||
          !finiteNonnegative(sample.readiness.elapsedMs) ||
          sample.capture?.width !== sample.renderSettings.canvasWidth ||
          sample.capture?.height !== sample.renderSettings.canvasHeight ||
          !SHA256.test(sample.capture?.pixelSha256 || '') ||
          typeof sample.capture?.pngDataUrl !== 'string' ||
          !sample.capture.pngDataUrl.startsWith('data:image/png;base64,') ||
          sample.capture.pngDataUrl.length > MAX_PNG_DATA_URL_LENGTH
        )
          throw new Error(
            `Pair ${pairIndex} ${arm} ${type} visual proof is invalid.`,
          );
        pngBytes += sample.capture.pngDataUrl.length;
        const geometryKey = `${type}:geometry`;
        const pixelKey = `${type}:pixels`;
        const priorGeometry = geometryHashes.get(geometryKey);
        const priorPixels = pixelHashes.get(pixelKey);
        if (
          (priorGeometry && priorGeometry !== sample.geometrySha256) ||
          (priorPixels && priorPixels !== sample.capture.pixelSha256)
        )
          throw new Error(
            `Rendered ${type} output differs across comparison runs.`,
          );
        geometryHashes.set(geometryKey, sample.geometrySha256);
        pixelHashes.set(pixelKey, sample.capture.pixelSha256);
        if (
          sample.cleanup?.featureCount !== 0 ||
          sample.cleanup?.pendingJobs !== 0 ||
          sample.cleanup?.sceneEntityCount !== 0 ||
          sample.cleanup?.contextRecordCount !== 0 ||
          sample.cleanup?.schedulerPendingCount !== 0
        )
          throw new Error(
            `Pair ${pairIndex} ${arm} ${type} cleanup leaked ownership.`,
          );
      }
      for (const type of IMPORT_GEOMETRY_WAKE_TYPES) {
        const cancellation = run.cancellation?.[type];
        if (
          cancellation?.outcome !== 'AbortError' ||
          cancellation.scope !==
            'synthetic-budget-clock-queued-wake-cancel-before-dispatch' ||
          !Number.isSafeInteger(cancellation.budgetClockCalls) ||
          cancellation.budgetClockCalls < 2 ||
          cancellation.pendingSchedulerTasksBeforeClear !== 1 ||
          !Number.isSafeInteger(cancellation.entitiesBeforeClear) ||
          cancellation.entitiesBeforeClear < 0 ||
          cancellation.entitiesBeforeClear > 1 ||
          cancellation.featureCountAfter !== 0 ||
          cancellation.pendingJobsAfter !== 0 ||
          cancellation.entitiesAfter !== 0 ||
          cancellation.contextRecordCountAfter !== 0 ||
          cancellation.pendingSchedulerTasksAfter !== 0
        )
          throw new Error(
            `Pair ${pairIndex} ${arm} ${type} cancellation leaked work.`,
          );
      }
    }
  }
  if (
    settings.some((setting) => !equalJson(setting, settings[0])) ||
    sampleSettings.some((setting) => !equalJson(setting, sampleSettings[0])) ||
    pngBytes >
      IMPORT_GEOMETRY_WAKE_PAIR_COUNT *
        IMPORT_GEOMETRY_WAKE_ARMS.length *
        IMPORT_GEOMETRY_WAKE_TYPES.length *
        MAX_PNG_DATA_URL_LENGTH
  )
    throw new Error('Render settings or PNG evidence bounds changed.');
  if (
    report.renderer !== settings[0].renderer ||
    report.cesiumVersion !== settings[0].cesiumVersion
  )
    throw new Error('Recorded scene renderer does not match its arm reports.');

  if (
    report.renderingEvidence?.accelerationVerified !== true ||
    !['native-gpu', 'apple-paravirtual-metal'].includes(
      report.renderingEvidence?.kind,
    )
  )
    throw new Error('The hosted renderer is not verified as accelerated.');
  if (
    report.browserCleanup?.closeCompleted !== true ||
    report.serverCleanup?.confirmed !== true ||
    report.cleanupError != null
  )
    throw new Error('Hosted browser or fixture-server cleanup is incomplete.');

  const summary = summarizeImportGeometryWakeReport(report);
  if (!equalJson(report.summary, summary))
    throw new Error('Large-geometry summary differs from its raw samples.');
  return report;
}
