import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

function add(errors, valid, message) {
  if (!valid) errors.push(message);
}

function jsonEqual(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function validSha256(value) {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
}

function validPngDataUrl(value) {
  return (
    typeof value === 'string' &&
    value.startsWith('data:image/png;base64,') &&
    value.length <= 1_500_000 &&
    /^[A-Za-z0-9+/]+=*$/.test(value.slice('data:image/png;base64,'.length))
  );
}

function mixedParityKey(value, expectedRenderer) {
  const readiness = value?.readiness;
  const settings = value?.renderSettings;
  if (
    value?.schema !== 'gev-import-mixed-geometry-parity/v1' ||
    value?.status !== 'passed' ||
    value?.renderer !== expectedRenderer ||
    !validSha256(value?.rowsSha256) ||
    !validSha256(value?.nativePicksSha256) ||
    !Array.isArray(value?.rows) ||
    value.rows.length !== 3 ||
    value?.load?.drawn !== 3 ||
    value?.load?.omitted !== 0 ||
    typeof settings?.priorGlobeShow !== 'boolean' ||
    settings.globeShow !== true ||
    settings.terrainProvider !== 'EllipsoidTerrainProvider' ||
    settings.imageryLayerCount !== 0 ||
    settings.baseLayer !== false ||
    readiness?.status !== 'passed' ||
    readiness.timeoutMs !== 10_000 ||
    !Number.isFinite(readiness.elapsedMs) ||
    readiness.elapsedMs < 0 ||
    readiness.elapsedMs > readiness.timeoutMs ||
    !Number.isInteger(readiness.attempts) ||
    readiness.attempts < 1 ||
    !Array.isArray(readiness.observations) ||
    readiness.observations.length < 1 ||
    readiness.observations.length > 8 ||
    !Array.isArray(readiness.nativePicks) ||
    readiness.nativePicks.length !== 3 ||
    !Array.isArray(value?.nativePicks) ||
    value.nativePicks.length !== 3 ||
    !validSha256(value?.capture?.pixelSha256) ||
    !validPngDataUrl(value?.capture?.pngDataUrl) ||
    !Number.isInteger(value?.capture?.width) ||
    value.capture.width < 1 ||
    !Number.isInteger(value?.capture?.height) ||
    value.capture.height < 1
  )
    return null;
  const shapes = ['point', 'line', 'polygon'];
  const entityIds = ['line', 'point', 'polygon'].map(
    (shape) => `gev-import:mixed-parity:mixed-parity:${shape}`,
  );
  if (
    !jsonEqual(value.entityIds, entityIds) ||
    !jsonEqual(
      value.nativePicks.map((row) => row?.shape),
      shapes,
    ) ||
    !value.nativePicks.every(
      (row, index) =>
        Array.isArray(row?.screen) &&
        row.screen.length === 2 &&
        row.screen.every(Number.isFinite) &&
        row.onCanvas === true &&
        row.expectedEntityId ===
          `gev-import:mixed-parity:mixed-parity:${shapes[index]}` &&
        row.pickedEntityId === row.expectedEntityId,
    )
  )
    return null;
  if (
    !jsonEqual(readiness.nativePicks, value.nativePicks) ||
    !readiness.observations.at(-1)?.ready ||
    !jsonEqual(readiness.observations.at(-1)?.nativePicks, value.nativePicks) ||
    readiness.observations.some(
      (observation) =>
        !Number.isFinite(observation?.atMs) ||
        observation.atMs < 0 ||
        observation.atMs > readiness.timeoutMs ||
        typeof observation?.ready !== 'boolean' ||
        !Array.isArray(observation?.nativePicks) ||
        observation.nativePicks.length !== 3,
    )
  )
    return null;
  return {
    entityIds: value.entityIds,
    rows: value.rows,
    rowsSha256: value.rowsSha256,
    nativePicks: value.nativePicks,
    nativePicksSha256: value.nativePicksSha256,
    renderSettings: settings,
    capture: value.capture,
  };
}

function pointStateKey(state, representation) {
  const pickRows = state?.nativePickWitness?.rows;
  const validPickRows =
    Array.isArray(pickRows) &&
    pickRows.every(
      (row) =>
        typeof row?.targetId === 'string' &&
        row.targetId.startsWith('gev-import:fixture:') &&
        Array.isArray(row.screen) &&
        row.screen.length === 2 &&
        row.screen.every(Number.isFinite) &&
        (row.pickedEntityId === null ||
          (typeof row.pickedEntityId === 'string' &&
            row.pickedEntityId.startsWith('gev-import:fixture:'))),
    );
  const countedHits = validPickRows
    ? pickRows.filter((row) => row.pickedEntityId !== null).length
    : -1;
  if (
    state?.available !== true ||
    state?.renderer !== representation ||
    state?.expectedCount !== 5000 ||
    state?.entityCount !== 5000 ||
    state?.primitiveCount !== 5000 ||
    !validSha256(state?.entityOrderAndStateSha256) ||
    !validSha256(state?.entityToPrimitiveAssignmentSha256) ||
    !validSha256(state?.primitiveDrawOrderAndStateSha256) ||
    !Number.isInteger(state?.nativePickWitness?.tested) ||
    state.nativePickWitness.tested < 1 ||
    !Number.isInteger(state?.nativePickWitness?.importedHits) ||
    state.nativePickWitness.importedHits < 1 ||
    !Array.isArray(state?.nativePickWitness?.rows) ||
    state.nativePickWitness.rows.length !== state.nativePickWitness.tested ||
    !validPickRows ||
    state.nativePickWitness.importedHits !== countedHits
  )
    return null;
  return {
    expectedCount: state.expectedCount,
    entityCount: state.entityCount,
    visualizerItemCount: state.visualizerItemCount,
    primitiveCount: state.primitiveCount,
    blendOption: state.blendOption,
    entityOrderAndStateSha256: state.entityOrderAndStateSha256,
    entityToPrimitiveAssignmentSha256: state.entityToPrimitiveAssignmentSha256,
    primitiveDrawOrderAndStateSha256: state.primitiveDrawOrderAndStateSha256,
    nativePickWitness: state.nativePickWitness.rows,
    nativePickTested: state.nativePickWitness.tested,
    nativePickImportedHits: state.nativePickWitness.importedHits,
  };
}

function samplesByPairAndMode(fixture, errors, label) {
  const samples = fixture?.samples;
  add(
    errors,
    Array.isArray(samples) && samples.length === 10,
    `${label} must contain ten paired pixel samples`,
  );
  if (!Array.isArray(samples)) return new Map();
  const result = new Map();
  for (const sample of samples) {
    const key = `${sample?.pair}:${sample?.mode}`;
    add(
      errors,
      Number.isInteger(sample?.pair) &&
        sample.pair >= 0 &&
        sample.pair < 5 &&
        ['synchronous', 'cooperative'].includes(sample?.mode),
      `${label} contains an invalid pair/mode key`,
    );
    add(
      errors,
      !result.has(key),
      `${label} contains a duplicate sample ${key}`,
    );
    if (result.has(key)) continue;
    result.set(key, sample);
    add(
      errors,
      validSha256(sample?.pixelSha256),
      `${label} sample ${key} lacks pixel hash`,
    );
    add(
      errors,
      sample?.features === 5000,
      `${label} sample ${key} population changed`,
    );
    add(
      errors,
      validPngDataUrl(sample?.pixelPngDataUrl),
      `${label} sample ${key} lacks its bounded PNG witness`,
    );
  }
  add(errors, result.size === 10, `${label} pair/mode inventory is incomplete`);
  return result;
}

function normalizedConfiguration(configuration) {
  if (!configuration || typeof configuration !== 'object') return null;
  return { ...configuration, pointRepresentation: '<renderer-mode>' };
}

function fixtureOf(run) {
  return run?.importBatches || run;
}

/**
 * Compare separate fresh hosted runs of the Entity and app-owned point paths.
 * Each report has five sync/cooperative workload pairs; renderer order is not
 * alternated and this comparison is correctness-only, not benefit evidence.
 */
export function compareImportPointRepresentationReports(
  entityRun,
  collectionRun,
) {
  const errors = [];
  const entity = fixtureOf(entityRun);
  const collection = fixtureOf(collectionRun);

  for (const [run, fixture, expected, label] of [
    [entityRun, entity, 'entity', 'Entity run'],
    [collectionRun, collection, 'primitive-collection', 'collection run'],
  ]) {
    add(
      errors,
      run?.schema === 'gev-hosted-native-renderer/v1',
      `${label} hosted report missing`,
    );
    add(
      errors,
      run?.status === 'passed' && run?.hardwareRenderingAvailable === true,
      `${label} did not pass on verified accelerated rendering`,
    );
    add(
      errors,
      run?.captureMatrix?.status === 'passed',
      `${label} capture matrix failed`,
    );
    add(
      errors,
      fixture?.schema === 'gev-import-batches/v2' &&
        fixture?.status === 'passed',
      `${label} import fixture failed`,
    );
    add(
      errors,
      fixture?.pointRepresentation === expected,
      `${label} renderer identity mismatch`,
    );
    add(
      errors,
      fixture?.mixedGeometryParityRequested === true,
      `${label} did not request the mixed geometry parity capture`,
    );
    add(
      errors,
      fixture?.workload === 'paired' && fixture?.captureMode === 'pixels',
      `${label} must use paired pixel mode`,
    );
    add(
      errors,
      fixture?.featureLimit === 5000 &&
        fixture?.fixture === 'synthetic-5000-import-points/v1',
      `${label} workload identity changed`,
    );
    add(
      errors,
      Array.isArray(run?.renderingEvidence) &&
        run.renderingEvidence.length === 2 &&
        run.renderingEvidence.every(
          (evidence) => evidence?.accelerationVerified === true,
        ),
      `${label} acceleration evidence is incomplete`,
    );
    add(
      errors,
      fixture?.environment?.appCommit === fixture?.applicationCommit,
      `${label} observed app commit mismatch`,
    );
    add(
      errors,
      fixture?.environment?.harnessCommit === fixture?.harnessCommit,
      `${label} observed harness commit mismatch`,
    );
    add(
      errors,
      fixture?.renderConfiguration?.pointRepresentation === expected,
      `${label} render configuration mismatch`,
    );
    const resources = fixture?.warmedResources;
    add(
      errors,
      resources?.importedFeatureCount === 5000 &&
        resources?.pointPrimitiveCount === 5000,
      `${label} warmup population or primitive count mismatch`,
    );
    if (expected === 'entity')
      add(
        errors,
        resources?.entities >= 5000,
        `${label} did not warm the Entity collection`,
      );
    else
      add(
        errors,
        resources?.entities < 5000,
        `${label} point entities were unexpectedly added to viewer.entities`,
      );
  }

  const expectedCommit = entity?.applicationCommit;
  add(
    errors,
    typeof expectedCommit === 'string' && /^[a-f0-9]{40}$/.test(expectedCommit),
    'application commit is invalid',
  );
  add(
    errors,
    collection?.applicationCommit === expectedCommit,
    'renderer runs use different application commits',
  );
  add(
    errors,
    entity?.harnessCommit === collection?.harnessCommit,
    'renderer runs use different fixture commits',
  );
  add(
    errors,
    entity?.viewerConstruction === collection?.viewerConstruction,
    'viewer construction differs',
  );
  add(
    errors,
    jsonEqual(entity?.environment, collection?.environment),
    'renderer environments differ',
  );
  add(
    errors,
    jsonEqual(
      normalizedConfiguration(entity?.renderConfiguration),
      normalizedConfiguration(collection?.renderConfiguration),
    ),
    'effective render settings or camera differ',
  );
  const entityMixed = mixedParityKey(entity?.mixedGeometryParity, 'entity');
  const collectionMixed = mixedParityKey(
    collection?.mixedGeometryParity,
    'primitive-collection',
  );
  add(
    errors,
    Boolean(entityMixed && collectionMixed),
    'mixed geometry capture, rows, or native picks are incomplete',
  );
  if (entityMixed && collectionMixed) {
    add(
      errors,
      entityMixed.capture.width === collectionMixed.capture.width &&
        entityMixed.capture.height === collectionMixed.capture.height &&
        entityMixed.capture.pixelSha256 === collectionMixed.capture.pixelSha256,
      'mixed point/line/polygon pixels differ across renderers',
    );
    add(
      errors,
      jsonEqual(entityMixed.entityIds, collectionMixed.entityIds) &&
        jsonEqual(entityMixed.rows, collectionMixed.rows) &&
        entityMixed.rowsSha256 === collectionMixed.rowsSha256,
      'mixed point/line/polygon Entity identities or geometry differ',
    );
    add(
      errors,
      jsonEqual(entityMixed.nativePicks, collectionMixed.nativePicks) &&
        entityMixed.nativePicksSha256 === collectionMixed.nativePicksSha256,
      'mixed point/line/polygon native picks differ',
    );
    add(
      errors,
      jsonEqual(entityMixed.renderSettings, collectionMixed.renderSettings),
      'mixed geometry globe or terrain settings differ across renderers',
    );
  }

  const entitySamples = samplesByPairAndMode(entity, errors, 'Entity run');
  const collectionSamples = samplesByPairAndMode(
    collection,
    errors,
    'collection run',
  );
  let pixelMatches = 0;
  let pointStateMatches = 0;
  for (let pair = 0; pair < 5; pair++) {
    for (const mode of ['synchronous', 'cooperative']) {
      const key = `${pair}:${mode}`;
      const baselineSample = entitySamples.get(key);
      const candidateSample = collectionSamples.get(key);
      if (!baselineSample || !candidateSample) continue;
      const pixelsMatch =
        baselineSample.pixelSha256 === candidateSample.pixelSha256;
      add(errors, pixelsMatch, `pixel output differs for ${key}`);
      if (pixelsMatch) pixelMatches++;
      const baselineState = pointStateKey(
        baselineSample.pointVisualState,
        'entity',
      );
      const candidateState = pointStateKey(
        candidateSample.pointVisualState,
        'primitive-collection',
      );
      add(
        errors,
        Boolean(baselineState && candidateState),
        `point state or native pick witness incomplete for ${key}`,
      );
      if (baselineState && candidateState) {
        const stateMatches = jsonEqual(
          { ...baselineState, visualizerItemCount: null },
          { ...candidateState, visualizerItemCount: null },
        );
        add(
          errors,
          stateMatches,
          `point identity/style/order/picks differ for ${key}`,
        );
        if (stateMatches) pointStateMatches++;
      }
    }
  }
  add(
    errors,
    entity?.largeGeometry?.exactOutputParity === true,
    'Entity run large geometry parity failed',
  );
  add(
    errors,
    collection?.largeGeometry?.exactOutputParity === true,
    'collection run large geometry parity failed',
  );
  add(
    errors,
    jsonEqual(
      entity?.largeGeometry?.synchronous?.rows,
      collection?.largeGeometry?.synchronous?.rows,
    ),
    'synchronous line/polygon geometry differs',
  );
  add(
    errors,
    jsonEqual(
      entity?.largeGeometry?.cooperative?.rows,
      collection?.largeGeometry?.cooperative?.rows,
    ),
    'cooperative line/polygon geometry differs',
  );
  add(
    errors,
    entity?.cancellation?.ownershipReleased === true &&
      collection?.cancellation?.ownershipReleased === true,
    'one renderer failed ownership cleanup',
  );
  for (const [fixture, label] of [
    [entity, 'Entity run'],
    [collection, 'collection run'],
  ])
    add(
      errors,
      fixture?.cancellation?.attempted === 12 &&
        fixture?.cancellation?.abortErrors === 12 &&
        fixture?.cancellation?.pendingJobsAfter === 0 &&
        fixture?.cancellation?.featureCountAfter === 0 &&
        fixture?.cancellation?.pointPrimitiveCountAfter === 0,
      `${label} cancellation/primitive cleanup is incomplete`,
    );

  return {
    valid: errors.length === 0,
    errors,
    summary: {
      schema: 'gev-import-point-representation-comparison/v1',
      applicationCommit: expectedCommit || null,
      fixtureCommit: entity?.harnessCommit || null,
      representationPairs: 1,
      synchronousCooperativePairsPerRepresentation: 5,
      pixelSamplesCompared: pixelMatches,
      pointStateSamplesCompared: pointStateMatches,
      pngWitnessCount: entitySamples.size + collectionSamples.size + 2,
      mixedGeometryPixelParity: Boolean(
        entityMixed &&
        collectionMixed &&
        entityMixed.capture.pixelSha256 === collectionMixed.capture.pixelSha256,
      ),
      mixedGeometryNativePickCount: entityMixed?.nativePicks.length || 0,
      geometryParity: errors.every((error) => !error.includes('geometry')),
      cancellationCleanup:
        entity?.cancellation?.ownershipReleased === true &&
        collection?.cancellation?.ownershipReleased === true,
      performanceAcceptanceEligible: false,
    },
  };
}
async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

function argumentValue(prefix) {
  return process.argv
    .find((value) => value.startsWith(prefix))
    ?.slice(prefix.length);
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const entityPath = argumentValue('--entity-report=');
  const collectionPath = argumentValue('--collection-report=');
  if (!entityPath || !collectionPath)
    throw new Error(
      'Usage: node importPointRepresentationComparison.mjs --entity-report=PATH --collection-report=PATH',
    );
  const result = compareImportPointRepresentationReports(
    await readJson(entityPath),
    await readJson(collectionPath),
  );
  console.log(JSON.stringify(result, null, 2));
  if (!result.valid) process.exitCode = 1;
}
