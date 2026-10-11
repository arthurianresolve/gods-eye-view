export const INFRASTRUCTURE_RUNTIME_SCHEMA =
  'gev-infrastructure-runtime-renderers/v2';
export const INFRASTRUCTURE_RUNTIME_CASES = Object.freeze([
  'default-style',
  'camera-lod-update',
]);
export const INFRASTRUCTURE_RUNTIME_PAIRS = 5;

function fail(message) {
  throw new Error(message);
}

function validateLifetime(lifetime, report) {
  if (
    !['entities', 'primitive-collections'].includes(lifetime?.mode) ||
    lifetime.status !== 'passed'
  )
    fail('Infrastructure renderer lifetime is invalid.');
  if (
    lifetime.activationOrder !== (lifetime.mode === 'entities' ? 0 : 1) ||
    typeof lifetime.activationContext !== 'string' ||
    lifetime.activationContext.length === 0
  )
    fail(`${lifetime.mode} activation order/context is invalid.`);
  if (
    !Number.isFinite(lifetime.activationDiagnosticMs) ||
    lifetime.activationDiagnosticMs <= 0 ||
    lifetime.activationTimingScope !==
      'single-layer-activation-diagnostic-not-performance-evidence'
  )
    fail(`${lifetime.mode} activation diagnostic is invalid.`);
  if (
    !lifetime.sceneBaseline ||
    ![
      'dataSources',
      'scenePrimitives',
      'groundPrimitives',
      'rendererOwners',
    ].every((key) => Number.isSafeInteger(lifetime.sceneBaseline[key])) ||
    JSON.stringify(lifetime.initialOwnership) !==
      JSON.stringify(lifetime.sceneBaseline)
  )
    fail(
      `${lifetime.mode} initial scene ownership is missing or inconsistent.`,
    );
  if (
    !Array.isArray(lifetime.samples) ||
    lifetime.samples.length !==
      INFRASTRUCTURE_RUNTIME_CASES.length * INFRASTRUCTURE_RUNTIME_PAIRS
  )
    fail(`${lifetime.mode} sample inventory is incomplete.`);
  for (const caseId of INFRASTRUCTURE_RUNTIME_CASES) {
    const rows = lifetime.samples.filter((row) => row.caseId === caseId);
    if (rows.length !== INFRASTRUCTURE_RUNTIME_PAIRS)
      fail(`${caseId} sample inventory is incomplete.`);
    for (let pair = 0; pair < INFRASTRUCTURE_RUNTIME_PAIRS; pair++) {
      const row = rows.find((sample) => sample.pair === pair);
      if (
        !row ||
        row.mode !== lifetime.mode ||
        row.status !== 'settled' ||
        row.sourceFeatureCount !== report.source.featureCount ||
        !Number.isSafeInteger(row.surfaceCount) ||
        row.surfaceCount <= 0 ||
        !Number.isSafeInteger(row.entityCount) ||
        row.entityCount < row.surfaceCount ||
        !/^[a-f0-9]{64}$/.test(row.identitySha256 || '') ||
        !/^[a-f0-9]{64}$/.test(row.geometrySha256 || '') ||
        !/^[a-f0-9]{64}$/.test(row.styleSha256 || '') ||
        !/^[a-f0-9]{64}$/.test(row.pixelSha256 || '') ||
        row.styleAudit?.entityId !== row.entitySelectionIdentity ||
        typeof row.styleAudit?.entityShow !== 'boolean' ||
        !['point', 'stem'].every((key) => {
          const channel = row.styleAudit[key];
          return (
            Array.isArray(channel?.rawColor) &&
            channel.rawColor.length === 4 &&
            channel.rawColor.every(
              (value) => Number.isFinite(value) && value >= 0 && value <= 1,
            ) &&
            typeof channel.graphicsOrPrimitiveShow === 'boolean' &&
            channel.effectiveShow ===
              (row.styleAudit.entityShow && channel.graphicsOrPrimitiveShow)
          );
        }) ||
        typeof row.pngBase64 !== 'string' ||
        row.pngBase64.length === 0 ||
        !Number.isSafeInteger(row.pixelDifferenceCount) ||
        row.pixelDifferenceCount <= 100 ||
        !Number.isSafeInteger(row.frame?.width) ||
        row.frame.width <= 0 ||
        !Number.isSafeInteger(row.frame?.height) ||
        row.frame.height <= 0 ||
        row.frame.width !== report.environment.drawingBuffer.width ||
        row.frame.height !== report.environment.drawingBuffer.height ||
        !Number.isSafeInteger(row.frame?.completedStableFrames) ||
        row.frame.completedStableFrames < 3 ||
        JSON.stringify(row.clock) !== JSON.stringify(report.renderClock) ||
        row.ownership?.renderer !== lifetime.mode ||
        row.ownership.datasourcePresent !== true ||
        row.ownership.entityCount !== row.entityCount ||
        row.ownership.surfaceEntityCount !== row.surfaceCount ||
        !Number.isSafeInteger(row.ownership.entitySurfaceGraphics) ||
        !['points', 'polylines', 'polygons'].every(
          (key) =>
            Number.isSafeInteger(row.ownership.preservedGraphics?.[key]) &&
            row.ownership.preservedGraphics[key] >= 0,
        ) ||
        !Number.isSafeInteger(row.ownership.rendererOwners) ||
        row.ownership.sceneDataSourceCount !==
          lifetime.sceneBaseline.dataSources + 1 ||
        row.ownership.scenePrimitiveCount !==
          lifetime.sceneBaseline.scenePrimitives +
            (lifetime.mode === 'primitive-collections' ? 1 : 0) ||
        row.ownership.sceneGroundPrimitiveCount !==
          lifetime.sceneBaseline.groundPrimitives
      )
        fail(
          `${caseId} pair ${pair + 1} has incomplete render or ownership evidence.`,
        );
      if (
        lifetime.mode === 'entities' &&
        (row.ownership.rendererOwners !== 0 ||
          row.ownership.entitySurfaceGraphics !== row.surfaceCount)
      )
        fail('Baseline did not use default Entity point/polyline Graphics.');
      if (
        row.layerResourceDiagnostics?.surfaceCollectionOwners !==
          (lifetime.mode === 'primitive-collections' ? 1 : 0) ||
        row.layerResourceDiagnostics?.surfacePoints !==
          (lifetime.mode === 'primitive-collections' ? row.surfaceCount : 0) ||
        row.layerResourceDiagnostics?.surfaceStems !==
          (lifetime.mode === 'primitive-collections' ? row.surfaceCount : 0)
      )
        fail(
          `${caseId} pair ${pair + 1} layer resource diagnostics are invalid.`,
        );
      if (
        lifetime.mode === 'primitive-collections' &&
        (row.ownership.rendererOwners !== 1 ||
          row.ownership.rendererOwnerChildren?.length !== 1 ||
          row.ownership.rendererOwnerChildren[0] !== 2 ||
          row.ownership.entitySurfaceGraphics !== 0 ||
          row.productionDiagnostics?.mode !== lifetime.mode ||
          row.productionDiagnostics.owners !== 1 ||
          row.productionDiagnostics.attached !== true ||
          row.productionDiagnostics.points !== row.surfaceCount ||
          row.productionDiagnostics.stems !== row.surfaceCount)
      )
        fail(
          'Candidate is not the sole production-owned collection representation.',
        );
      if (
        row.pointPick?.kind !== 'point' ||
        row.stemPick?.kind !== 'stem' ||
        row.pointPick.entityId !== row.stemPick.entityId ||
        row.pointPick.sourceRecordId !== row.stemPick.sourceRecordId ||
        row.entitySelectionIdentity !== row.pointPick.entityId ||
        ![row.pointPick, row.stemPick].every(
          (pick) =>
            Array.isArray(pick.screen) &&
            pick.screen.length === 2 &&
            pick.screen.every(Number.isFinite),
        )
      )
        fail(
          `${caseId} pair ${pair + 1} has invalid native scene pick/selection evidence.`,
        );
    }
  }
  if (
    lifetime.teardown?.layerDestroyed !== true ||
    lifetime.teardown.dataSourceRemoved !== true ||
    lifetime.teardown.rendererOwnersRemoved !== true ||
    lifetime.teardown.instrumentationRestored !== true ||
    lifetime.teardown.viewerKeptForNextLifetime !== true
  )
    fail(`${lifetime.mode} independent layer lifetime did not clean up.`);
}

export function validateInfrastructureRuntimeReport(
  report,
  { expectedCommit } = {},
) {
  if (report?.schema !== INFRASTRUCTURE_RUNTIME_SCHEMA)
    fail('Infrastructure runtime report schema is invalid.');
  if (!/^[a-f0-9]{40}$/.test(expectedCommit || ''))
    fail('An exact application commit is required.');
  if (
    report.applicationCommit !== expectedCommit ||
    report.harnessCommit !== expectedCommit
  )
    fail('Infrastructure runtime source identity changed.');
  if (
    report.environment?.appCommit !== expectedCommit ||
    report.environment?.harnessCommit !== expectedCommit ||
    typeof report.environment?.renderer !== 'string' ||
    !report.environment.renderer ||
    !Number.isSafeInteger(report.environment?.drawingBuffer?.width) ||
    report.environment.drawingBuffer.width <= 0 ||
    !Number.isSafeInteger(report.environment?.drawingBuffer?.height) ||
    report.environment.drawingBuffer.height <= 0
  )
    fail('Infrastructure observed renderer environment is missing or invalid.');
  if (report.status !== 'passed' || report.error || report.failedPhase)
    fail('Infrastructure runtime comparison did not pass.');
  if (
    !Number.isSafeInteger(report.source?.featureCount) ||
    report.source.featureCount <= 0 ||
    !Number.isSafeInteger(report.source?.payloadBytes) ||
    report.source.payloadBytes <= 0 ||
    !/^[a-f0-9]{64}$/.test(report.source?.payloadSha256 || '')
  )
    fail('Infrastructure runtime source identity is invalid.');
  if (
    report.candidateRepresentation?.id !==
      'production-local-infrastructure-primitive-collections/rgba8/v1' ||
    report.candidateRepresentation?.stemColorEncoding !==
      'entity-color-attribute-byte'
  )
    fail('Production candidate representation identity is invalid.');
  if (
    !Array.isArray(report.lifetimes) ||
    report.lifetimes.length !== 2 ||
    report.lifetimes[0]?.mode !== 'entities' ||
    report.lifetimes[1]?.mode !== 'primitive-collections'
  )
    fail(
      'Expected independent default and candidate layer lifetimes in order.',
    );
  for (const lifetime of report.lifetimes) validateLifetime(lifetime, report);
  if (
    JSON.stringify(report.lifetimes[0].initialOwnership) !==
    JSON.stringify(report.lifetimes[1].initialOwnership)
  )
    fail(
      'The independent renderer lifetimes began with different scene ownership baselines.',
    );
  if (
    report.lifetimes.some(
      (lifetime) =>
        lifetime.teardown.dataSourceCountAfterDestroy !==
          lifetime.sceneBaseline.dataSources ||
        lifetime.teardown.ownerCountAfterDestroy !==
          lifetime.sceneBaseline.rendererOwners ||
        lifetime.teardown.scenePrimitiveCountAfterDestroy !==
          lifetime.sceneBaseline.scenePrimitives ||
        lifetime.teardown.groundPrimitiveCountAfterDestroy !==
          lifetime.sceneBaseline.groundPrimitives,
    )
  )
    fail(
      'A renderer lifetime left owned scene resources attached after teardown.',
    );
  if (
    JSON.stringify(report.lifetimes[0].sceneBaseline) !==
    JSON.stringify(report.lifetimes[1].sceneBaseline)
  )
    fail(
      'The independent renderer lifetimes began with different scene ownership baselines.',
    );
  if (
    !Array.isArray(report.comparisons) ||
    report.comparisons.length !==
      INFRASTRUCTURE_RUNTIME_CASES.length * INFRASTRUCTURE_RUNTIME_PAIRS
  )
    fail('Infrastructure renderer comparison inventory is incomplete.');
  const recomputed = compareInfrastructureRuntimeLifetimes(
    report.lifetimes[0],
    report.lifetimes[1],
  );
  if (JSON.stringify(report.comparisons) !== JSON.stringify(recomputed))
    fail('Infrastructure renderer comparisons do not match captured samples.');
  if (
    report.samplingScope !==
    'five-correctness-snapshots-per-case-not-alternating-performance-runs'
  )
    fail('Infrastructure renderer sampling scope is invalid.');
  if (
    !report.renderClock?.iso ||
    !Number.isSafeInteger(report.renderClock.julianDayNumber) ||
    !Number.isFinite(report.renderClock.secondsOfDay) ||
    report.renderClock.shouldAnimate !== false
  )
    fail('Infrastructure renderer comparison clock is invalid.');
  const warmup = report.viewerOwnedDisplayWarmup;
  if (
    warmup?.completedFrames !== 2 ||
    warmup.temporaryDataSourceRemoved !== true ||
    !Number.isSafeInteger(warmup.dataSourcesBefore) ||
    warmup.dataSourcesBefore !== warmup.dataSourcesAfter ||
    !['scenePrimitives', 'groundPrimitives'].every(
      (key) =>
        Number.isSafeInteger(warmup.primitiveCountsBefore?.[key]) &&
        Number.isSafeInteger(warmup.primitiveCountsAfter?.[key]),
    )
  )
    fail(
      'Cesium viewer-owned data-source display was not warmed and restored.',
    );
  if (
    report.lifetimes.some(
      (lifetime) =>
        JSON.stringify(lifetime.renderClock) !==
          JSON.stringify(report.renderClock) ||
        lifetime.sceneBaseline.scenePrimitives !==
          warmup.primitiveCountsAfter.scenePrimitives ||
        lifetime.sceneBaseline.groundPrimitives !==
          warmup.primitiveCountsAfter.groundPrimitives,
    )
  )
    fail('Renderer lifetimes used different warmed scene or clock state.');
  if (report.cleanup?.viewerDestroyed !== true)
    fail('Fixture viewer was not destroyed.');
  return true;
}

export function compareInfrastructureRuntimeLifetimes(baseline, candidate) {
  if (
    baseline?.mode !== 'entities' ||
    candidate?.mode !== 'primitive-collections'
  )
    fail('Expected default Entity and production collection lifetimes.');
  const comparisons = [];
  for (const caseId of INFRASTRUCTURE_RUNTIME_CASES) {
    for (let pair = 0; pair < INFRASTRUCTURE_RUNTIME_PAIRS; pair++) {
      const left = baseline.samples.find(
        (row) => row.caseId === caseId && row.pair === pair,
      );
      const right = candidate.samples.find(
        (row) => row.caseId === caseId && row.pair === pair,
      );
      if (!left || !right)
        fail(`${caseId} pair ${pair + 1} is missing a renderer sample.`);
      const exactFields = [
        'identitySha256',
        'geometrySha256',
        'styleSha256',
        'pixelSha256',
      ];
      const equal = Object.fromEntries(
        exactFields.map((field) => [field, left[field] === right[field]]),
      );
      if (
        JSON.stringify(left.ownership.preservedGraphics) !==
        JSON.stringify(right.ownership.preservedGraphics)
      )
        fail('Preserved source geometry inventory differs between renderers.');
      const picksEqual =
        JSON.stringify(left.pointPick) === JSON.stringify(right.pointPick) &&
        JSON.stringify(left.stemPick) === JSON.stringify(right.stemPick);
      const framebufferEqual =
        left.frame.width === right.frame.width &&
        left.frame.height === right.frame.height;
      if (
        Object.values(equal).some((value) => !value) ||
        !picksEqual ||
        !framebufferEqual
      )
        fail(
          `${caseId} pair ${pair + 1} differs between production renderers.`,
        );
      comparisons.push({
        caseId,
        pair,
        pixelSha256Equal: equal.pixelSha256,
        identityEqual: equal.identitySha256,
        geometryEqual: equal.geometrySha256,
        styleEqual: equal.styleSha256,
        picksEqual,
        framebufferEqual,
      });
    }
  }
  return comparisons;
}

/** Generated surface Graphics and original source geometry have separate owners. */
export function countInfrastructureGraphics(entities, surfaceEntities) {
  const surfaces = new Set(surfaceEntities);
  let surfaceGraphics = 0;
  const preservedGraphics = { points: 0, polylines: 0, polygons: 0 };
  for (const entity of entities) {
    if (surfaces.has(entity)) {
      if (entity.point || entity.polyline) surfaceGraphics++;
    } else {
      if (entity.point) preservedGraphics.points++;
      if (entity.polyline) preservedGraphics.polylines++;
    }
    if (entity.polygon) preservedGraphics.polygons++;
  }
  return { surfaceGraphics, preservedGraphics };
}
