import { createHash } from 'node:crypto';
import {
  CABLE_REFERENCE_RENDER_CASES,
  CABLE_REFERENCE_RENDER_POPULATION,
  CABLE_REFERENCE_RENDER_SAMPLES,
  CABLE_REFERENCE_RENDER_SCHEMA,
} from '../fixtures/cable-reference-collections-contract.mjs';

export {
  CABLE_REFERENCE_RENDER_CASES,
  CABLE_REFERENCE_RENDER_POPULATION,
  CABLE_REFERENCE_RENDER_SAMPLES,
  CABLE_REFERENCE_RENDER_SCHEMA,
};

function fail(message) {
  throw new Error(message);
}

function sha256(value) {
  return /^[a-f0-9]{64}$/.test(value || '');
}

function jsonSha256(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function same(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function samePickIdentity(left, right) {
  return same(
    [
      left?.kind,
      left?.sourceKind,
      left?.entityId,
      left?.sourceRecordId,
      left?.sourceOrdinal,
      left?.screen,
    ],
    [
      right?.kind,
      right?.sourceKind,
      right?.entityId,
      right?.sourceRecordId,
      right?.sourceOrdinal,
      right?.screen,
    ],
  );
}

function requirePopulation(population, mode) {
  for (const [key, expected] of Object.entries(
    CABLE_REFERENCE_RENDER_POPULATION,
  )) {
    if (population?.[key] !== expected)
      fail(`${mode} has an incomplete ${key} population.`);
  }
}

function validatePick(pick, kind, mode) {
  const pointTypes = ['PointPrimitive'];
  const stemTypes = ['Polyline', 'PolylineCollection', 'Primitive'];
  if (
    pick?.kind !== kind ||
    !['cable', 'landing-point'].includes(pick?.sourceKind) ||
    typeof pick?.entityId !== 'string' ||
    !pick.entityId ||
    typeof pick?.sourceRecordId !== 'string' ||
    !pick.sourceRecordId ||
    pick.entityId !==
      `${pick.sourceKind}-reference-${pick.sourceOrdinal}-${pick.sourceRecordId}` ||
    pick.ownerVerified !== true ||
    !Number.isSafeInteger(pick?.sourceOrdinal) ||
    pick.sourceOrdinal < 0 ||
    !Array.isArray(pick.screen) ||
    pick.screen.length !== 2 ||
    !pick.screen.every(Number.isFinite) ||
    (kind === 'point' && !pointTypes.includes(pick.primitiveType)) ||
    (kind === 'stem' && !stemTypes.includes(pick.primitiveType)) ||
    (kind === 'stem' &&
      pick.primitiveType === 'Primitive' &&
      pick.appearanceType !== 'PolylineColorAppearance')
  )
    fail(`${mode} ${kind} pick is not a verified native owned pick.`);
}

function validateCamera(camera, caseId) {
  const actual = camera?.actualCamera;
  const vector = (value) =>
    Array.isArray(value) && value.length === 3 && value.every(Number.isFinite);
  if (
    camera?.caseId !== caseId ||
    !Array.isArray(camera.targetCartographic) ||
    camera.targetCartographic.length !== 3 ||
    !camera.targetCartographic.every(Number.isFinite) ||
    camera.targetCartographic[0] < -Math.PI ||
    camera.targetCartographic[0] > Math.PI ||
    camera.targetCartographic[1] < -Math.PI / 2 ||
    camera.targetCartographic[1] > Math.PI / 2 ||
    !Number.isFinite(camera.rangeMeters) ||
    camera.rangeMeters <= 0 ||
    !Number.isFinite(camera.headingRadians) ||
    !Number.isFinite(camera.pitchRadians) ||
    camera.restoredTransform !== 'IDENTITY' ||
    !vector(actual?.position) ||
    !vector(actual?.direction) ||
    !vector(actual?.up)
  )
    fail(`${caseId} camera contract is missing or malformed.`);
}

function validateLifetime(lifetime, report, modeIndex) {
  const mode = modeIndex === 0 ? 'entities' : 'collections';
  if (lifetime?.mode !== mode || lifetime.status !== 'passed')
    fail(`${mode} lifetime is missing or failed.`);
  if (lifetime.activationOrder !== modeIndex)
    fail(`${mode} lifetime activation order is invalid.`);
  requirePopulation(lifetime.population, mode);
  for (const field of [
    'sourceIdentitySha256',
    'sourceManifestSha256',
    'viewerSettingsSha256',
    'viewerEnvironmentSha256',
    'geometrySha256',
    'styleSha256',
    'overlaySha256',
  ])
    if (!sha256(lifetime[field])) fail(`${mode} ${field} is invalid.`);
  if (
    lifetime.ownership?.baselineDataSources !==
      report.viewer.baselineDataSources ||
    lifetime.ownership?.activeDataSources !==
      report.viewer.baselineDataSources + 3 ||
    lifetime.ownership?.referenceGraphics !==
      (mode === 'entities' ? 2629 * 2 : 0) ||
    lifetime.ownership?.referenceCollections !==
      (mode === 'collections' ? 2 : 0) ||
    lifetime.ownership?.referencePoints !==
      (mode === 'collections' ? 2629 : 0) ||
    lifetime.ownership?.referenceStems !== (mode === 'collections' ? 2629 : 0)
  )
    fail(`${mode} renderer ownership inventory is invalid.`);
  if (lifetime.sourceManifestSha256 !== report.source.identitySha256)
    fail(`${mode} source manifest differs from the bundled source identity.`);
  if (
    lifetime.teardown?.disabled !== true ||
    lifetime.teardown?.reEnabled !== true ||
    lifetime.teardown?.dataSourcesRemoved !== 3 ||
    lifetime.teardown?.collectionsRemoved !==
      (mode === 'collections' ? 6 : 0) ||
    lifetime.teardown?.overlayHidden !== true ||
    lifetime.teardown?.destroyed !== true ||
    lifetime.teardown?.listenersAfterDestroy !== 0 ||
    lifetime.teardown?.remainingDataSources !==
      report.viewer.baselineDataSources ||
    lifetime.teardown?.remainingCollections !== 0 ||
    lifetime.cleanupError
  )
    fail(`${mode} disable/re-enable/destroy ownership did not settle.`);
  if (!Array.isArray(lifetime.samples)) fail(`${mode} samples are missing.`);
  const expectedRows =
    CABLE_REFERENCE_RENDER_CASES.length * CABLE_REFERENCE_RENDER_SAMPLES;
  if (lifetime.samples.length !== expectedRows)
    fail(`${mode} sample inventory is incomplete.`);
  for (const caseId of CABLE_REFERENCE_RENDER_CASES) {
    const rows = lifetime.samples.filter((sample) => sample.caseId === caseId);
    if (rows.length !== CABLE_REFERENCE_RENDER_SAMPLES)
      fail(`${mode} ${caseId} samples are incomplete.`);
    for (let index = 0; index < rows.length; index += 1) {
      const row = rows[index];
      if (
        report.samplingContract === 'owned-primitives-ready/v1' &&
        (row.primitiveReadiness?.ready !== true ||
          row.primitiveReadiness?.truncated !== false ||
          !Number.isSafeInteger(row.primitiveReadiness?.observedOwners) ||
          row.primitiveReadiness.observedOwners <= 0 ||
          !Array.isArray(row.primitiveReadiness?.pending) ||
          row.primitiveReadiness.pending.length !== 0)
      )
        fail(
          `${mode} ${caseId} sample ${index + 1} has unfinished primitive work.`,
        );
      if (
        row.mode !== mode ||
        row.caseId !== caseId ||
        row.sample !== index ||
        row.status !== 'settled' ||
        !Number.isSafeInteger(row.stableFrames) ||
        row.stableFrames < 3 ||
        !same(row.clock, report.renderClock) ||
        !same(row.sourceCounts, CABLE_REFERENCE_RENDER_POPULATION) ||
        row.sourceIdentitySha256 !== lifetime.sourceIdentitySha256 ||
        row.sourceManifestSha256 !== lifetime.sourceManifestSha256 ||
        !sha256(row.sourceIdentitySha256) ||
        !sha256(row.geometrySha256) ||
        !sha256(row.styleSha256) ||
        !sha256(row.overlaySha256) ||
        !sha256(row.cameraSha256) ||
        row.cameraSha256 !== jsonSha256(row.camera) ||
        (caseId === 'camera-change' &&
          (row.cameraSweep?.status !== 'swept' ||
            !Number.isSafeInteger(row.cameraSweep.frameNumber) ||
            row.cameraSweep.frameNumber <= 0 ||
            row.cameraSweep.finalPoseVerified !== true ||
            row.cameraSweep.flightCompleteVerified !== true ||
            row.cameraSweep.cameraEventWaitMs !== 500)) ||
        (caseId === 'default-style' &&
          (row.cameraSweep?.status !== 'not-required' ||
            row.cameraSweep.frameNumber !== null ||
            row.cameraSweep.finalPoseVerified !== null ||
            row.cameraSweep.flightCompleteVerified !== null ||
            row.cameraSweep.cameraEventWaitMs !== null)) ||
        !Number.isSafeInteger(row.frame?.width) ||
        !Number.isSafeInteger(row.frame?.height) ||
        row.frame.width <= 0 ||
        row.frame.height <= 0 ||
        row.frame.width !== report.environment.drawingBuffer.width ||
        row.frame.height !== report.environment.drawingBuffer.height ||
        !sha256(row.pixelSha256) ||
        typeof row.pngBase64 !== 'string' ||
        row.pngBase64.length === 0 ||
        row.pngBase64.length > 4_000_000 ||
        row.classification?.terrain !== 'TERRAIN' ||
        row.classification?.photoreal !== 'CESIUM_3D_TILE' ||
        row.classification?.afterRestore !== 'TERRAIN' ||
        row.visibility?.visibleReferences <= 0 ||
        row.visibility?.hiddenReferences <= 0 ||
        row.visibility.visibleReferences + row.visibility.hiddenReferences !==
          CABLE_REFERENCE_RENDER_POPULATION.referenceRecords ||
        row.ownership?.referenceCollections !==
          (mode === 'collections' ? 2 : 0) ||
        row.ownership?.referencePoints !==
          (mode === 'collections' ? 2629 : 0) ||
        row.ownership?.referenceStems !== (mode === 'collections' ? 2629 : 0)
      )
        fail(`${mode} ${caseId} sample ${index + 1} is incomplete.`);
      validateCamera(row.camera, caseId);
      validatePick(row.pointPick, 'point', mode);
      validatePick(row.stemPick, 'stem', mode);
    }
  }
}

/** Strict acceptance validator for the complete bundled cable source. */
export function validateCableReferenceCollectionsReport(
  report,
  { expectedCommit } = {},
) {
  if (report?.schema !== CABLE_REFERENCE_RENDER_SCHEMA)
    fail('Cable collection render schema is invalid.');
  if (
    report.samplingContract !== undefined &&
    report.samplingContract !== 'owned-primitives-ready/v1'
  )
    fail('Cable primitive sampling contract is unknown.');
  if (!/^[a-f0-9]{40}$/.test(expectedCommit || ''))
    fail('An exact application commit is required.');
  if (
    report.applicationCommit !== expectedCommit ||
    report.harnessCommit !== expectedCommit
  )
    fail('Cable render fixture source identity changed.');
  if (report.status !== 'passed' || report.error || report.failedPhase)
    fail('Cable collection rendered comparison failed.');
  requirePopulation(report.source?.population, 'source');
  if (
    !sha256(report.source?.cableGeoSha256) ||
    !sha256(report.source?.landingGeoSha256) ||
    !sha256(report.source?.identitySha256)
  )
    fail('Bundled cable source provenance is incomplete.');
  if (
    report.renderClock?.iso !== '2026-10-11T12:34:56.000Z' ||
    report.renderClock?.shouldAnimate !== false
  )
    fail('Cable fixture render clock is not the fixed declared time.');
  if (
    report.viewer?.baselineDataSources !== 0 ||
    report.viewer?.lifetimeCount !== 2 ||
    report.viewer?.sceneMode !== 'SCENE3D' ||
    report.viewer?.globeShown !== true ||
    report.viewer?.terrainProvider !== 'EllipsoidTerrainProvider' ||
    report.settings?.requestRenderMode !== false ||
    report.settings?.resolutionScale !== 1 ||
    report.settings?.msaaSamples !== 4 ||
    report.settings?.preserveDrawingBuffer !== true ||
    report.settings?.antialias !== true ||
    report.settings?.webglVersion?.includes('WebGL 2.0') !== true ||
    !Number.isSafeInteger(report.environment?.drawingBuffer?.width) ||
    !Number.isSafeInteger(report.environment?.drawingBuffer?.height) ||
    report.environment.drawingBuffer.width <= 0 ||
    report.environment.drawingBuffer.height <= 0 ||
    report.environment.viewport?.dpr !== 1 ||
    report.environment.viewport?.width !== 1200 ||
    report.environment.viewport?.height !== 1000 ||
    report.environment.drawingBuffer.width !== 960 ||
    report.environment.drawingBuffer.height !== 640
  )
    fail('Cable fixture viewer/render environment is incomplete.');
  if (
    report.lifetimes?.length !== 2 ||
    report.comparisons?.length !==
      CABLE_REFERENCE_RENDER_CASES.length * CABLE_REFERENCE_RENDER_SAMPLES
  )
    fail('Cable renderer lifetime/comparison inventory is incomplete.');
  report.lifetimes.forEach((lifetime, index) =>
    validateLifetime(lifetime, report, index),
  );
  if (
    report.lifetimes[0].sourceIdentitySha256 !==
      report.lifetimes[1].sourceIdentitySha256 ||
    report.lifetimes[0].viewerSettingsSha256 !==
      report.lifetimes[1].viewerSettingsSha256 ||
    report.lifetimes[0].viewerEnvironmentSha256 !==
      report.lifetimes[1].viewerEnvironmentSha256
  )
    fail('Entity/collection viewer/source identity differs.');
  for (const lifetime of report.lifetimes) {
    if (
      lifetime.viewerSettingsSha256 !== jsonSha256(report.settings) ||
      lifetime.viewerEnvironmentSha256 !== jsonSha256(report.environment)
    )
      fail(`${lifetime.mode} viewer settings/environment hashes are stale.`);
  }
  let comparisonIndex = 0;
  for (const caseId of CABLE_REFERENCE_RENDER_CASES) {
    for (let sample = 0; sample < CABLE_REFERENCE_RENDER_SAMPLES; sample += 1) {
      const entity = report.lifetimes[0].samples.find(
        (row) => row.caseId === caseId && row.sample === sample,
      );
      const collections = report.lifetimes[1].samples.find(
        (row) => row.caseId === caseId && row.sample === sample,
      );
      const comparison = report.comparisons[comparisonIndex++];
      if (
        !entity ||
        !collections ||
        comparison?.caseId !== caseId ||
        comparison.sample !== sample ||
        comparison.pixelDifferenceCount !== 0 ||
        comparison.pixelSha256 !== entity.pixelSha256 ||
        entity.pixelSha256 !== collections.pixelSha256 ||
        !samePickIdentity(entity.pointPick, collections.pointPick) ||
        !samePickIdentity(entity.stemPick, collections.stemPick) ||
        entity.pointPick.entityId !== collections.pointPick.entityId ||
        entity.pointPick.sourceRecordId !==
          collections.pointPick.sourceRecordId ||
        entity.pointPick.sourceOrdinal !==
          collections.pointPick.sourceOrdinal ||
        entity.pointPick.sourceKind !== collections.pointPick.sourceKind ||
        entity.stemPick.entityId !== collections.stemPick.entityId ||
        entity.stemPick.sourceRecordId !==
          collections.stemPick.sourceRecordId ||
        entity.stemPick.sourceOrdinal !== collections.stemPick.sourceOrdinal ||
        entity.stemPick.sourceKind !== collections.stemPick.sourceKind ||
        !same(entity.camera, collections.camera) ||
        entity.sourceIdentitySha256 !== collections.sourceIdentitySha256 ||
        !same(entity.classification, collections.classification) ||
        !same(entity.visibility, collections.visibility) ||
        entity.geometrySha256 !== collections.geometrySha256 ||
        entity.styleSha256 !== collections.styleSha256 ||
        entity.overlaySha256 !== collections.overlaySha256 ||
        !comparison.exactPixels ||
        !comparison.sameGeometry ||
        !comparison.sameStyle ||
        !comparison.sameSourceIdentities ||
        !comparison.samePointPick ||
        !comparison.sameStemPick
      )
        fail(`${caseId} sample ${sample + 1} differs across renderers.`);
    }
  }
  return true;
}
