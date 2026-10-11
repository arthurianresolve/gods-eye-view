import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import os from 'node:os';
import puppeteer from 'puppeteer';
import { createServer } from 'vite';
import {
  classifyRenderer,
  readBrowserGraphicsInfo,
} from './rendererEvidence.mjs';
import {
  assertInitialRecoveryPage,
  closeOwnedRecoveryPage,
  closeRecoveryBrowser,
  stopOwnedRecoveryProcessTree,
} from './profileRecoveryPageOwnership.mjs';
import {
  assertInfrastructureSourceInventory,
  DEFAULT_INFRASTRUCTURE_FIXTURE_LAYER_ID,
  infrastructureFixtureLayer,
} from '../fixtures/infrastructureFixtureLayer.mjs';

export const INFRASTRUCTURE_BENEFIT_SCHEMA =
  'gev-infrastructure-benefit-comparison/v2';
export const INFRASTRUCTURE_BENEFIT_MODES = Object.freeze([
  'entities',
  'primitive-collections',
]);
export const INFRASTRUCTURE_BENEFIT_PAIRS = 5;
export const INFRASTRUCTURE_BENEFIT_EPOCH = '2026-10-11T12:00:00.000Z';
const EXPECTED_VIEWPORT = Object.freeze({ width: 1200, height: 900 });
const EXPECTED_CANVAS_CSS = Object.freeze({ width: 960, height: 640 });
const EXPECTED_CONTEXT_ATTRIBUTES = Object.freeze([
  'alpha',
  'antialias',
  'depth',
  'premultipliedAlpha',
  'preserveDrawingBuffer',
  'stencil',
]);
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function fail(message) {
  throw new Error(message);
}

function same(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function sameDatacenterTarget(left, right) {
  const pick = (value) =>
    value && {
      kind: value.kind,
      layerId: value.layerId,
      ownerVerified: value.ownerVerified,
      entityId: value.entityId,
      sourceRecordId: value.sourceRecordId,
      screen: value.screen,
    };
  return (
    left?.layerId === right?.layerId &&
    left?.entityId === right?.entityId &&
    same(left?.pointScreen, right?.pointScreen) &&
    same(left?.stemScreen, right?.stemScreen) &&
    same(pick(left?.point), pick(right?.point)) &&
    same(pick(left?.stem), pick(right?.stem))
  );
}

function metricSample(run, phase) {
  const sample = run?.memory?.[phase];
  return (
    sample?.gcRequested === true &&
    sample?.metric === 'Performance.getMetrics.JSHeapUsedSize' &&
    Number.isSafeInteger(sample?.bytes) &&
    sample.bytes >= 0
  );
}

async function settleWithin(operation, timeoutMs) {
  let timer;
  try {
    return await Promise.race([
      Promise.resolve(operation).then(
        (value) => ({ completed: true, value }),
        (error) => ({ completed: false, error }),
      ),
      new Promise((resolveTimeout) => {
        timer = setTimeout(
          () => resolveTimeout({ completed: false }),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

function median(values) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)];
}

function validateRun(run, mode, suite, expectedCommit, layer) {
  if (
    run?.mode !== mode ||
    run?.suite !== suite ||
    run?.status !== 'passed' ||
    run?.applicationCommit !== expectedCommit ||
    run?.harnessCommit !== expectedCommit ||
    run?.phase !== 'viewer-destroyed'
  )
    fail(`${mode}/${suite} run identity or lifecycle is invalid.`);
  if (
    (layer.layerId !== DEFAULT_INFRASTRUCTURE_FIXTURE_LAYER_ID &&
      run.layerId !== layer.layerId) ||
    (run.layerId != null && run.layerId !== layer.layerId)
  )
    fail(`${mode}/${suite} run selected a different infrastructure layer.`);
  if (
    !/^[a-f0-9]{64}$/.test(run.source?.payloadSha256 || '') ||
    run.source?.featureCount !== layer.sourceFeatureCount ||
    (layer.layerId !== DEFAULT_INFRASTRUCTURE_FIXTURE_LAYER_ID &&
      run.source?.layerId !== layer.layerId) ||
    !Number.isSafeInteger(run.source?.payloadBytes) ||
    run.source.payloadBytes <= 0
  )
    fail(`${mode}/${suite} source identity is incomplete.`);
  if (
    run.renderClock?.iso !== INFRASTRUCTURE_BENEFIT_EPOCH ||
    run.renderClock?.shouldAnimate !== false ||
    !run.settings ||
    run.settings.width !== EXPECTED_VIEWPORT.width ||
    run.settings.height !== EXPECTED_VIEWPORT.height ||
    run.settings.canvasCssWidth !== EXPECTED_CANVAS_CSS.width ||
    run.settings.canvasCssHeight !== EXPECTED_CANVAS_CSS.height ||
    run.settings.devicePixelRatio !== 1 ||
    run.settings.resolutionScale !== 1 ||
    run.settings.requestRenderMode !== true ||
    run.settings.maximumRenderTimeChange !== 'Infinity' ||
    run.settings.msaaSamples !== 4 ||
    !run.settings.contextAttributes ||
    !same(
      Object.keys(run.settings.contextAttributes).sort(),
      [...EXPECTED_CONTEXT_ATTRIBUTES].sort(),
    ) ||
    !Object.values(run.settings.contextAttributes).every(
      (value) => typeof value === 'boolean',
    ) ||
    run.settings.contextAttributes.preserveDrawingBuffer !== true ||
    run.settings.contextAttributes.antialias !== true ||
    run.settings.contextAttributes.depth !== true ||
    run.settings.globeLighting !== false ||
    run.settings.drawingBufferWidth !== EXPECTED_CANVAS_CSS.width ||
    run.settings.drawingBufferHeight !== EXPECTED_CANVAS_CSS.height
  )
    fail(`${mode}/${suite} render settings or fixed clock are invalid.`);
  if (layer.layerId === 'local-datacenters') {
    const camera = run.cameraContract;
    if (
      camera?.layerId !== layer.layerId ||
      camera.kind !== 'lookAt-world-frame' ||
      !Array.isArray(camera.targetCartographic) ||
      camera.targetCartographic.length !== 3 ||
      !camera.targetCartographic.every(Number.isFinite) ||
      Math.abs(camera.targetCartographic[0]) > Math.PI ||
      Math.abs(camera.targetCartographic[1]) > Math.PI / 2 ||
      camera.headingRadians !== 0 ||
      camera.pitchRadians !== -Math.PI / 3 ||
      camera.rangeMeters !== 140_000 ||
      camera.restoredTransform !== 'IDENTITY'
    )
      fail(
        `${mode}/${suite} datacenter camera contract is missing or invalid.`,
      );
  }
  if (
    run.sourceReady?.count !== layer.entityCount ||
    run.surfacePopulation?.statsCount !== layer.entityCount ||
    run.surfacePopulation?.entityCount !== layer.entityCount ||
    (layer.layerId !== DEFAULT_INFRASTRUCTURE_FIXTURE_LAYER_ID &&
      run.surfacePopulation?.layerId !== layer.layerId) ||
    (run.surfacePopulation?.layerId != null &&
      run.surfacePopulation.layerId !== layer.layerId) ||
    !Number.isSafeInteger(run.surfacePopulation?.surfaceCount) ||
    run.surfacePopulation.surfaceCount !== layer.surfaceCount
  )
    fail(`${mode}/${suite} source population is incomplete or truncated.`);
  if (
    (layer.layerId !== DEFAULT_INFRASTRUCTURE_FIXTURE_LAYER_ID ||
      run.surfacePopulation?.preservedGraphics != null) &&
    !same(run.surfacePopulation?.preservedGraphics, layer.preservedGraphics)
  )
    fail(`${mode}/${suite} preserved source geometry inventory is incomplete.`);
  if (
    (mode === 'entities' &&
      (run.surfacePopulation.resources?.owners !== 0 ||
        run.surfacePopulation.resources?.surfaceGraphics !==
          layer.surfaceCount ||
        run.surfacePopulation.resources?.collectionPoints !== 0 ||
        run.surfacePopulation.resources?.collectionStems !== 0)) ||
    (mode === 'primitive-collections' &&
      (run.surfacePopulation.resources?.owners !== 1 ||
        run.surfacePopulation.resources?.surfaceGraphics !== 0 ||
        run.surfacePopulation.resources?.collectionPoints !==
          layer.surfaceCount ||
        run.surfacePopulation.resources?.collectionStems !==
          layer.surfaceCount)) ||
    !/^[a-f0-9]{64}$/.test(run.surfacePopulation?.identitySha256 || '') ||
    !Number.isFinite(run.sourceReadyElapsedMs) ||
    run.sourceReadyElapsedMs <= 0 ||
    !Number.isFinite(run.firstUsable?.elapsedFromSourceReadyMs) ||
    run.firstUsable.elapsedFromSourceReadyMs <= 0 ||
    !/^[a-f0-9]{64}$/.test(run.firstUsable?.pixelSha256 || '') ||
    run.firstUsable?.changedPixels <= 100 ||
    run.firstUsable?.geometryDirty !== false ||
    run.firstUsable?.cameraRevisionReady !== true ||
    run.firstUsable?.dataSourcesReady !== true ||
    run.firstUsable?.globeTilesLoaded !== true ||
    !Array.isArray(run.firstUsable?.cameraPosition) ||
    run.firstUsable.cameraPosition.length !== 3 ||
    !run.firstUsable.cameraPosition.every(Number.isFinite) ||
    !Number.isSafeInteger(run.firstUsable?.width) ||
    run.firstUsable.width <= 0 ||
    !Number.isSafeInteger(run.firstUsable?.height) ||
    run.firstUsable.height <= 0 ||
    !/^[a-f0-9]{64}$/.test(run.settledPixelSha256 || '') ||
    !run.firstUsable?.target?.entityId
  )
    fail(
      `${mode}/${suite} activation or first-usable-frame evidence is invalid.`,
    );
  if (layer.layerId === 'local-datacenters') {
    const target = run.firstUsable.target;
    const validPick = (pick, kind, screen) => {
      const collection = mode === 'primitive-collections';
      const validPrimitiveType =
        kind === 'point'
          ? pick?.primitiveType === 'PointPrimitive'
          : collection
            ? pick?.primitiveType === 'Polyline'
            : pick?.primitiveType === 'GroundPolylinePrimitive' ||
              (pick?.primitiveType === 'Primitive' &&
                [
                  'PolylineColorAppearance',
                  'PolylineMaterialAppearance',
                ].includes(pick.appearanceType));
      return (
        pick?.kind === kind &&
        pick.layerId === layer.layerId &&
        pick.ownerVerified === true &&
        typeof pick.entityId === 'string' &&
        pick.entityId.length > 0 &&
        typeof pick.sourceRecordId === 'string' &&
        pick.sourceRecordId.length > 0 &&
        validPrimitiveType &&
        Array.isArray(pick.screen) &&
        pick.screen.length === 2 &&
        pick.screen.every(Number.isFinite) &&
        same(pick.screen, screen)
      );
    };
    if (
      target?.layerId !== layer.layerId ||
      !validPick(target.point, 'point', target.pointScreen) ||
      !validPick(target.stem, 'stem', target.stemScreen) ||
      target.entityId !== target.stem.entityId ||
      run.firstUsable.selectedEntityIdentity !== target.stem.entityId
    )
      fail(`${mode}/${suite} datacenter native-pick ownership is invalid.`);
  }
  if (
    !run.environment?.renderer ||
    !run.environment?.cesiumVersion ||
    run.environment.appCommit !== expectedCommit ||
    run.environment.harnessCommit !== expectedCommit ||
    run.environment.rendererClass?.accelerationVerified !== true ||
    !['native-gpu', 'apple-paravirtual-metal'].includes(
      run.environment.rendererClass?.kind,
    ) ||
    run.environment.graphics?.featureStatus?.webgl !== 'enabled' ||
    (run.environment.graphics?.featureStatus?.webgl2 != null &&
      run.environment.graphics.featureStatus.webgl2 !== 'enabled')
  )
    fail(`${mode}/${suite} accelerated renderer evidence is invalid.`);
  if (
    run.imageBuffersReleased !== true ||
    !run.images ||
    !['firstUsable', 'settled'].every((kind) => {
      const image = run.images[kind];
      return (
        image?.path ===
          `images/${suite}-pair-${String(run.pairIndex + 1).padStart(2, '0')}-${mode}-${kind}.png` &&
        /^[a-f0-9]{64}$/.test(image?.sha256 || '') &&
        Number.isSafeInteger(image?.byteLength) &&
        image.byteLength > PNG_SIGNATURE.length &&
        image.byteLength <= 10 * 1024 * 1024 &&
        image.width === run.firstUsable.width &&
        image.height === run.firstUsable.height &&
        image.width === run.settings.drawingBufferWidth &&
        image.height === run.settings.drawingBufferHeight
      );
    })
  )
    fail(`${mode}/${suite} PNG frame evidence is incomplete.`);
  if (
    !run.teardown?.layerDestroyed ||
    !run.teardown?.viewerDestroyed ||
    run.teardown?.ownerCountAfterDestroy !== 0 ||
    run.teardown?.dataSourceCountAfterDestroy !== run.warmup?.dataSources ||
    run.teardown?.normalPrimitiveCountAfterDestroy !==
      run.warmup?.normalPrimitives ||
    run.teardown?.groundPrimitiveCountAfterDestroy !==
      run.warmup?.groundPrimitives
  )
    fail(`${mode}/${suite} resource cleanup is incomplete.`);
  if (suite === 'memory') {
    if (
      ![
        'beforeActivation',
        'enabledSettled',
        'afterLayerDestroy',
        'afterViewerDestroy',
      ].every((phase) => metricSample(run, phase)) ||
      run.memory.scope !== 'post-forced-gc-js-heap-used-size-only'
    )
      fail(`${mode} forced-GC memory evidence is incomplete.`);
    if (
      run.memory.layerReferencesReleased !== true ||
      run.memory.viewerReferencesReleased !== true ||
      run.memory.imageBuffersReleased !== true
    )
      fail(`${mode} memory sample retained fixture ownership references.`);
  } else if (run.memory !== undefined) {
    fail('Latency suite must not collect forced-GC memory samples.');
  }
}

function resolveReportLayer(report, expectedLayerId) {
  const layerId =
    report?.layerId ||
    report?.pairs?.[0]?.runs?.entities?.source?.layerId ||
    DEFAULT_INFRASTRUCTURE_FIXTURE_LAYER_ID;
  const layer = infrastructureFixtureLayer(layerId);
  if (expectedLayerId && layer.layerId !== expectedLayerId)
    fail('Infrastructure benefit report selected a different requested layer.');
  if (
    layer.layerId !== DEFAULT_INFRASTRUCTURE_FIXTURE_LAYER_ID &&
    report?.layerId !== layer.layerId
  )
    fail(
      'Datacenter benefit reports must explicitly identify their source layer.',
    );
  return layer;
}

export function summarizeInfrastructureBenefitPairs(pairs) {
  return Object.fromEntries(
    ['latency', 'memory'].map((suite) => [
      suite,
      Object.fromEntries(
        INFRASTRUCTURE_BENEFIT_MODES.map((mode) => {
          const runs = pairs
            .filter((pair) => pair.suite === suite)
            .map((pair) => pair.runs[mode]);
          if (runs.length !== INFRASTRUCTURE_BENEFIT_PAIRS)
            fail(`${suite} summary has an incomplete sample inventory.`);
          if (suite === 'latency')
            return [
              mode,
              {
                sourceReadyElapsedMedianMs: median(
                  runs.map((run) => run.sourceReadyElapsedMs),
                ),
                firstUsableAfterSourceReadyMedianMs: median(
                  runs.map((run) => run.firstUsable.elapsedFromSourceReadyMs),
                ),
                samples: runs.length,
              },
            ];
          return [
            mode,
            {
              enabledHeapDeltaMedianBytes: median(
                runs.map(
                  (run) =>
                    run.memory.enabledSettled.bytes -
                    run.memory.beforeActivation.bytes,
                ),
              ),
              afterDestroyHeapDeltaMedianBytes: median(
                runs.map(
                  (run) =>
                    run.memory.afterLayerDestroy.bytes -
                    run.memory.beforeActivation.bytes,
                ),
              ),
              absoluteHeapBytesAfterGc: median(
                runs.map((run) => run.memory.afterLayerDestroy.bytes),
              ),
              afterViewerDestroyHeapDeltaMedianBytes: median(
                runs.map(
                  (run) =>
                    run.memory.afterViewerDestroy.bytes -
                    run.memory.beforeActivation.bytes,
                ),
              ),
              samples: runs.length,
            },
          ];
        }),
      ),
    ]),
  );
}

export function validateInfrastructureBenefitReport(
  report,
  { expectedCommit, expectedLayerId } = {},
) {
  let layer;
  try {
    layer = resolveReportLayer(report, expectedLayerId);
  } catch (error) {
    fail(error.message);
  }
  const expectedSchema = layer.benefitSchema;
  if (report?.schema !== expectedSchema)
    fail('Infrastructure benefit report schema is invalid.');
  if (!/^[a-f0-9]{40}$/.test(expectedCommit || ''))
    fail('An exact application commit is required.');
  if (
    report.status !== 'passed' ||
    report.applicationCommit !== expectedCommit ||
    report.harnessCommit !== expectedCommit ||
    report.renderClock?.iso !== INFRASTRUCTURE_BENEFIT_EPOCH ||
    report.renderClock?.shouldAnimate !== false
  )
    fail('Infrastructure benefit report identity or fixed clock is invalid.');
  if (
    report.measurementScope?.latency !==
      'fresh-viewer-source-ready-to-first-usable-postRender-before-rgba-readback-hash-and-pick-verification-no-forced-gc' ||
    report.measurementScope?.memory !==
      'separate-fresh-viewer-post-forced-gc-js-heap-used-size-only' ||
    report.measurementScope?.retainedMemoryClaim !==
      'none-js-heap-used-size-is-a-proxy-and-excludes-gpu-native-cesium-and-browser-process-memory'
  )
    fail('Infrastructure benefit measurement scope is mislabeled.');
  if (
    report.measurementScope?.verificationCost !==
    'postRender-rgba-readback-full-frame-hash-and-native-pick-search-run-after-the-first-usable-timestamp'
  )
    fail('First-usable verification timing boundary is undocumented.');
  const requiredSourcePaths = [
    'package-lock.json',
    'patches/cesium-1.138.0-inertia.json',
    'patches/cesium-1.138.0-collision-transform.json',
    'src/data/infrastructure.js',
    'src/data/localGeojsonCore.js',
    'src/data/localGeojsonLod.js',
    'src/data/infrastructureOverlayEntry.js',
    'src/data/inputOwnership.js',
    'src/app/localGeojsonServices.js',
    'src/app/viewer.js',
    'src/app/atmosphereCompat.js',
    'src/app/cameraAnglesCompat.js',
    'src/freshFrame.js',
    'src/renderGovernor.js',
    'src/data/dataCredits.js',
    'src/sources/infrastructureData.js',
    'src/performance/performanceSnapshot.js',
    'scripts/fixtures/infrastructure-benefit.html',
    'scripts/fixtures/infrastructure-benefit.mjs',
    'scripts/performance/infrastructureBenefitComparison.mjs',
    'scripts/performance/infrastructureBenefitComparison.test.mjs',
  ];
  if (layer.layerId !== DEFAULT_INFRASTRUCTURE_FIXTURE_LAYER_ID)
    requiredSourcePaths.push(
      'scripts/fixtures/infrastructureFixtureLayer.mjs',
      'scripts/fixtures/infrastructureFixtureCamera.mjs',
      'scripts/fixtures/infrastructureNativePickOwnership.mjs',
    );
  const dependencyBytes = report.provenance?.installedDependencyBytes;
  if (
    !requiredSourcePaths.every((path) =>
      /^[a-f0-9]{64}$/.test(report.provenance?.files?.[path] || ''),
    ) ||
    !/^[a-f0-9]{64}$/.test(dependencyBytes?.cesiumPackageSha256 || '') ||
    !/^[a-f0-9]{64}$/.test(dependencyBytes?.enginePackageSha256 || '') ||
    dependencyBytes?.cesiumVersion !== '1.138.0' ||
    dependencyBytes?.engineVersion !== '22.3.0' ||
    Object.keys(dependencyBytes?.cesiumFiles || {}).length !== 5 ||
    !Object.values(dependencyBytes?.cesiumFiles || {}).every((digest) =>
      /^[a-f0-9]{64}$/.test(digest),
    )
  )
    fail(
      'Infrastructure benefit source or installed Cesium identity is incomplete.',
    );
  if (
    !Array.isArray(report.pairs) ||
    report.pairs.length !== INFRASTRUCTURE_BENEFIT_PAIRS * 2
  )
    fail('Infrastructure benefit paired inventory is incomplete.');
  if (
    report.environment?.rendererClass?.accelerationVerified !== true ||
    !['native-gpu', 'apple-paravirtual-metal'].includes(
      report.environment?.rendererClass?.kind,
    ) ||
    report.environment?.graphics?.featureStatus?.webgl !== 'enabled' ||
    (report.environment.graphics.featureStatus.webgl2 != null &&
      report.environment.graphics.featureStatus.webgl2 !== 'enabled')
  )
    fail('Browser acceleration was not independently verified.');

  for (const suite of ['latency', 'memory']) {
    const pairs = report.pairs.filter((pair) => pair.suite === suite);
    if (pairs.length !== INFRASTRUCTURE_BENEFIT_PAIRS)
      fail(`${suite} pair inventory is incomplete.`);
    for (let index = 0; index < INFRASTRUCTURE_BENEFIT_PAIRS; index++) {
      const pair = pairs[index];
      const expectedOrder =
        index % 2 === 0
          ? ['entities', 'primitive-collections']
          : ['primitive-collections', 'entities'];
      if (
        pair.index !== index ||
        !same(pair.order, expectedOrder) ||
        pair.sameInputAndOutput !== true ||
        !pair.runs ||
        !same(
          Object.keys(pair.runs).sort(),
          [...INFRASTRUCTURE_BENEFIT_MODES].sort(),
        )
      )
        fail(`${suite} pair ${index + 1} is not fresh and alternating.`);
      for (const mode of INFRASTRUCTURE_BENEFIT_MODES)
        validateRun(pair.runs[mode], mode, suite, expectedCommit, layer);
      for (const mode of INFRASTRUCTURE_BENEFIT_MODES) {
        const source = pair.runs[mode].source;
        try {
          assertInfrastructureSourceInventory(
            { ...source, layerId: source.layerId || layer.layerId },
            layer,
          );
        } catch (error) {
          fail(error.message);
        }
      }
      const baseline = pair.runs.entities;
      const candidate = pair.runs['primitive-collections'];
      if (
        !same(baseline.settings, candidate.settings) ||
        !same(baseline.renderClock, candidate.renderClock) ||
        !same(baseline.cameraContract, candidate.cameraContract)
      )
        fail(
          `${suite} pair ${index + 1} changed settings, render clock, or camera contract.`,
        );
      if (
        layer.layerId === 'local-datacenters' &&
        !sameDatacenterTarget(
          baseline.firstUsable.target,
          candidate.firstUsable.target,
        )
      )
        fail(
          `${suite} pair ${index + 1} changed actual datacenter point/stem picks.`,
        );
      for (const path of [
        'source.payloadSha256',
        'source.featureCount',
        'source.payloadBytes',
        'surfacePopulation.statsCount',
        'surfacePopulation.entityCount',
        'surfacePopulation.surfaceCount',
        'surfacePopulation.identitySha256',
        'firstUsable.pixelSha256',
        'settledPixelSha256',
        'images.firstUsable.sha256',
        'images.settled.sha256',
        'firstUsable.width',
        'firstUsable.height',
        'renderClock.iso',
        'settings.width',
        'settings.height',
        'settings.devicePixelRatio',
        'settings.drawingBufferWidth',
        'settings.drawingBufferHeight',
        'settings.canvasCssWidth',
        'settings.canvasCssHeight',
        'settings.resolutionScale',
        'settings.msaaSamples',
      ]) {
        const get = (value) =>
          path.split('.').reduce((item, key) => item?.[key], value);
        if (!Object.is(get(baseline, path), get(candidate, path)))
          fail(`${suite} pair ${index + 1} differs at ${path}.`);
      }
      if (
        baseline.environment.renderer !== candidate.environment.renderer ||
        baseline.environment.cesiumVersion !==
          candidate.environment.cesiumVersion
      )
        fail(`${suite} pair ${index + 1} used different render environments.`);
      if (!same(baseline.environment, candidate.environment))
        fail(`${suite} pair ${index + 1} used different graphics settings.`);
      const expectedDeltas = compareInfrastructureBenefitPair(pair);
      if (!same(pair.deltas, expectedDeltas))
        fail(`${suite} pair ${index + 1} delta summary is stale.`);
    }
  }
  if (layer.layerId === 'local-datacenters') {
    const cameraContracts = report.pairs.flatMap((pair) =>
      INFRASTRUCTURE_BENEFIT_MODES.map(
        (mode) => pair.runs[mode].cameraContract,
      ),
    );
    if (
      cameraContracts.length !== INFRASTRUCTURE_BENEFIT_PAIRS * 2 * 2 ||
      cameraContracts.some((contract) => !same(contract, cameraContracts[0]))
    )
      fail(
        'Datacenter benefit runs did not share one fixed source-anchor camera.',
      );
  }
  if (!same(report.summary, summarizeInfrastructureBenefitPairs(report.pairs)))
    fail('Infrastructure benefit summary is stale.');
  const imagePaths = report.pairs.flatMap((pair) =>
    INFRASTRUCTURE_BENEFIT_MODES.flatMap((mode) =>
      ['firstUsable', 'settled'].map(
        (kind) => pair.runs[mode].images[kind].path,
      ),
    ),
  );
  if (
    imagePaths.length !==
      INFRASTRUCTURE_BENEFIT_PAIRS *
        2 *
        INFRASTRUCTURE_BENEFIT_MODES.length *
        2 ||
    new Set(imagePaths).size !== imagePaths.length
  )
    fail('PNG evidence paths are duplicated across samples.');
  const referenceRun = report.pairs[0].runs.entities;
  for (const pair of report.pairs) {
    for (const mode of INFRASTRUCTURE_BENEFIT_MODES) {
      const run = pair.runs[mode];
      if (
        run.source.payloadSha256 !== referenceRun.source.payloadSha256 ||
        run.source.featureCount !== referenceRun.source.featureCount ||
        run.surfacePopulation.identitySha256 !==
          referenceRun.surfacePopulation.identitySha256 ||
        !same(
          run.surfacePopulation.preservedGraphics || null,
          referenceRun.surfacePopulation.preservedGraphics || null,
        ) ||
        run.firstUsable.pixelSha256 !== referenceRun.firstUsable.pixelSha256 ||
        !same(run.settings, referenceRun.settings) ||
        !same(run.renderClock, referenceRun.renderClock) ||
        run.environment.renderer !== referenceRun.environment.renderer ||
        !same(
          run.environment.rendererClass,
          referenceRun.environment.rendererClass,
        ) ||
        !same(run.environment.graphics, referenceRun.environment.graphics) ||
        run.environment.cesiumVersion !== referenceRun.environment.cesiumVersion
      )
        fail(
          `${pair.suite} pair ${pair.index + 1} changed across fresh viewers.`,
        );
      if (
        layer.layerId === 'local-datacenters' &&
        !sameDatacenterTarget(
          run.firstUsable.target,
          referenceRun.firstUsable.target,
        )
      )
        fail(
          `${pair.suite} pair ${pair.index + 1} changed datacenter picks across viewers.`,
        );
    }
  }
  if (
    report.cleanup?.browserClosed !== true ||
    report.cleanup?.initialPageClosed !== true ||
    report.cleanup?.pagesClosed !== true ||
    report.cleanup?.sessionsDetached !== true ||
    report.cleanup?.serverClosed !== true ||
    report.cleanup?.sourceTreeUnchanged !== true
  )
    fail('Infrastructure benefit comparison cleanup is incomplete.');
  return true;
}

export function compareInfrastructureBenefitPair(pair) {
  const baseline = pair?.runs?.entities;
  const candidate = pair?.runs?.['primitive-collections'];
  if (!baseline || !candidate) fail('Benefit pair is missing a renderer run.');
  const deltas = {
    candidateMinusEntitiesSourceReadyMs:
      candidate.sourceReadyElapsedMs - baseline.sourceReadyElapsedMs,
    candidateMinusEntitiesFirstUsableAfterReadyMs:
      candidate.firstUsable.elapsedFromSourceReadyMs -
      baseline.firstUsable.elapsedFromSourceReadyMs,
    matchedPopulation: true,
    matchedOutputPixels:
      candidate.firstUsable.pixelSha256 === baseline.firstUsable.pixelSha256,
  };
  if (pair.suite === 'memory') {
    deltas.candidateMinusEntitiesEnabledHeapDeltaBytes =
      candidate.memory.enabledSettled.bytes -
      candidate.memory.beforeActivation.bytes -
      (baseline.memory.enabledSettled.bytes -
        baseline.memory.beforeActivation.bytes);
    deltas.candidateMinusEntitiesAfterDestroyHeapDeltaBytes =
      candidate.memory.afterLayerDestroy.bytes -
      candidate.memory.beforeActivation.bytes -
      (baseline.memory.afterLayerDestroy.bytes -
        baseline.memory.beforeActivation.bytes);
    deltas.candidateMinusEntitiesAfterViewerDestroyHeapDeltaBytes =
      candidate.memory.afterViewerDestroy.bytes -
      candidate.memory.beforeActivation.bytes -
      (baseline.memory.afterViewerDestroy.bytes -
        baseline.memory.beforeActivation.bytes);
  }
  return deltas;
}

const isMain =
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url;

if (isMain) {
  assert.equal(process.env.GITHUB_ACTIONS, 'true', 'Run on hosted CI only.');
  const expectedCommit = process.env.CANDIDATE_SHA;
  assert.match(expectedCommit || '', /^[a-f0-9]{40}$/);
  const outputPath = process.argv[2];
  const layerOption = process.argv.indexOf('--layer-id');
  const requestedLayerId =
    layerOption >= 0
      ? process.argv[layerOption + 1]
      : DEFAULT_INFRASTRUCTURE_FIXTURE_LAYER_ID;
  const selectedLayer = infrastructureFixtureLayer(requestedLayerId);
  assert.ok(
    outputPath,
    'Usage: infrastructureBenefitComparison.mjs OUTPUT_DIR [--layer-id local-datacenters]',
  );

  const root = resolve(process.cwd());
  const output = resolve(outputPath);
  assert.equal(existsSync(output), false, 'Refusing to overwrite evidence.');
  const git = (args) =>
    execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
  const immutableFiles = [
    'package-lock.json',
    'patches/cesium-1.138.0-inertia.json',
    'patches/cesium-1.138.0-collision-transform.json',
    'src/data/infrastructure.js',
    'src/data/localGeojsonCore.js',
    'src/data/localGeojsonLod.js',
    'src/data/infrastructureOverlayEntry.js',
    'src/data/inputOwnership.js',
    'src/app/localGeojsonServices.js',
    'src/app/viewer.js',
    'src/app/atmosphereCompat.js',
    'src/app/cameraAnglesCompat.js',
    'src/freshFrame.js',
    'src/renderGovernor.js',
    'src/data/dataCredits.js',
    'src/sources/infrastructureData.js',
    'src/performance/performanceSnapshot.js',
    'scripts/fixtures/infrastructure-benefit.html',
    'scripts/fixtures/infrastructure-benefit.mjs',
    'scripts/fixtures/infrastructureNativePickOwnership.mjs',
    'scripts/fixtures/infrastructureFixtureLayer.mjs',
    'scripts/fixtures/infrastructureFixtureCamera.mjs',
    'scripts/performance/infrastructureBenefitComparison.mjs',
    'scripts/performance/infrastructureBenefitComparison.test.mjs',
    'scripts/performance/rendererEvidence.mjs',
    'scripts/performance/profileRecoveryPageOwnership.mjs',
    'scripts/performance/fixtureInterception.mjs',
  ];
  assert.equal(
    git(['rev-parse', 'HEAD']),
    expectedCommit,
    'Wrong source commit.',
  );
  assert.equal(
    git(['status', '--porcelain']),
    '',
    'Source tree must be clean.',
  );
  const sourceHashes = Object.fromEntries(
    immutableFiles.map((path) => [
      path,
      hash(readFileSync(resolve(root, path))),
    ]),
  );
  const patchManifests = [
    'patches/cesium-1.138.0-inertia.json',
    'patches/cesium-1.138.0-collision-transform.json',
  ].map((path) => ({
    path,
    manifest: JSON.parse(readFileSync(resolve(root, path), 'utf8')),
  }));
  const cesiumFiles = [
    ...new Map(
      patchManifests
        .flatMap(({ manifest }) => manifest.files)
        .map((file) => [file.relativePath, file]),
    ).values(),
  ];
  const cesiumInstalledHashes = Object.fromEntries(
    cesiumFiles.map((file) => {
      const bytes = readFileSync(
        resolve(root, 'node_modules', file.relativePath),
      );
      const digest = hash(bytes);
      assert.equal(
        digest,
        file.patchedSha256,
        `Installed Cesium bytes differ: ${file.relativePath}`,
      );
      return [file.relativePath, digest];
    }),
  );
  const cesiumPackageBytes = readFileSync(
    resolve(root, 'node_modules/cesium/package.json'),
  );
  const enginePackageBytes = readFileSync(
    resolve(root, 'node_modules/@cesium/engine/package.json'),
  );
  const enginePackageInfo = JSON.parse(enginePackageBytes.toString('utf8'));
  const packageInfo = JSON.parse(cesiumPackageBytes.toString('utf8'));
  assert.equal(packageInfo.version, patchManifests[0].manifest.cesiumVersion);
  assert.equal(
    enginePackageInfo.version,
    patchManifests[0].manifest.engineVersion,
  );
  assert.ok(
    patchManifests.every(
      ({ manifest }) =>
        manifest.cesiumVersion === packageInfo.version &&
        manifest.engineVersion === enginePackageInfo.version,
    ),
    'Cesium patch manifests and installed package versions disagree.',
  );
  const report = {
    schema: selectedLayer.benefitSchema,
    layerId: selectedLayer.layerId,
    status: 'running',
    applicationCommit: expectedCommit,
    harnessCommit: expectedCommit,
    startedAt: new Date().toISOString(),
    renderClock: {
      iso: INFRASTRUCTURE_BENEFIT_EPOCH,
      shouldAnimate: false,
    },
    measurementScope: {
      latency:
        'fresh-viewer-source-ready-to-first-usable-postRender-before-rgba-readback-hash-and-pick-verification-no-forced-gc',
      memory: 'separate-fresh-viewer-post-forced-gc-js-heap-used-size-only',
      verificationCost:
        'postRender-rgba-readback-full-frame-hash-and-native-pick-search-run-after-the-first-usable-timestamp',
      retainedMemoryClaim:
        'none-js-heap-used-size-is-a-proxy-and-excludes-gpu-native-cesium-and-browser-process-memory',
      pairCountPerSuite: INFRASTRUCTURE_BENEFIT_PAIRS,
      alternation:
        'entities,candidate then candidate,entities within each suite',
    },
    provenance: {
      node: process.version,
      platform: process.platform,
      architecture: process.arch,
      osRelease: os.release(),
      cesiumVersion: packageInfo.version,
      files: sourceHashes,
      packageLockSha256: sourceHashes['package-lock.json'],
      patchManifests: Object.fromEntries(
        patchManifests.map(({ path }) => [path, sourceHashes[path]]),
      ),
      installedDependencyBytes: {
        cesiumPackageSha256: hash(cesiumPackageBytes),
        enginePackageSha256: hash(enginePackageBytes),
        cesiumVersion: packageInfo.version,
        engineVersion: enginePackageInfo.version,
        cesiumFiles: cesiumInstalledHashes,
      },
    },
    environment: null,
    pairs: [],
    cleanup: {
      browserClosed: false,
      initialPageClosed: false,
      pagesClosed: false,
      sessionsDetached: false,
      serverClosed: false,
      sourceTreeUnchanged: false,
    },
  };
  mkdirSync(dirname(output), { recursive: true });
  mkdirSync(output, { recursive: false });
  const reportFile = resolve(output, 'report.json');
  let temporaryReport = null;
  const save = () => {
    temporaryReport = resolve(output, `.report-${process.pid}.tmp`);
    writeFileSync(temporaryReport, `${JSON.stringify(report, null, 2)}\n`);
    renameSync(temporaryReport, reportFile);
    temporaryReport = null;
  };
  const pages = [];
  const sessions = [];
  let browser;
  let server;
  let failure = null;
  const capture = (error) => {
    failure ||= error;
    report.status = 'failed';
    (report.errors ||= []).push(String(error?.stack || error).slice(0, 7000));
    save();
  };
  const waitState = async (page, predicate, timeoutMs) => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const state = await page.evaluate(
        () =>
          window.__s54InfrastructureBenefit?.snapshot?.() ||
          window.__s54InfrastructureBenefitState ||
          null,
      );
      if (
        state?.phase === 'activation-error' ||
        state?.phase === 'destroy-error'
      )
        throw new Error(state.error || `Fixture entered ${state.phase}.`);
      if (predicate(state)) return state;
      await new Promise((resolvePoll) => setTimeout(resolvePoll, 40));
    }
    const last = await page.evaluate(
      () =>
        window.__s54InfrastructureBenefit?.snapshot?.() ||
        window.__s54InfrastructureBenefitState ||
        null,
    );
    throw new Error(
      `Fixture phase timed out: ${JSON.stringify(last).slice(0, 2000)}`,
    );
  };
  const gcHeap = async (session) => {
    await session.send('HeapProfiler.collectGarbage');
    const metrics = await session.send('Performance.getMetrics');
    const value = metrics.metrics.find(
      (entry) => entry.name === 'JSHeapUsedSize',
    )?.value;
    assert.ok(
      Number.isFinite(value) && value >= 0,
      'JSHeapUsedSize is unavailable.',
    );
    return Math.round(value);
  };
  const persistPng = (suite, pairIndex, mode, kind, dataUrl, dimensions) => {
    assert.match(dataUrl || '', /^data:image\/png;base64,[A-Za-z0-9+/]+=*$/);
    const png = Buffer.from(
      dataUrl.slice('data:image/png;base64,'.length),
      'base64',
    );
    assert.ok(
      png.length > PNG_SIGNATURE.length && png.length <= 10 * 1024 * 1024,
    );
    assert.deepEqual(png.subarray(0, PNG_SIGNATURE.length), PNG_SIGNATURE);
    assert.equal(png.readUInt32BE(16), dimensions.width);
    assert.equal(png.readUInt32BE(20), dimensions.height);
    const relativePath = `images/${suite}-pair-${String(pairIndex + 1).padStart(2, '0')}-${mode}-${kind}.png`;
    const absolutePath = resolve(output, relativePath);
    mkdirSync(dirname(absolutePath), { recursive: true });
    const temporaryPath = `${absolutePath}.${process.pid}.tmp`;
    writeFileSync(temporaryPath, png, { flag: 'wx' });
    renameSync(temporaryPath, absolutePath);
    return {
      path: relativePath,
      sha256: hash(png),
      byteLength: png.length,
      width: dimensions.width,
      height: dimensions.height,
    };
  };
  const runOne = async (mode, suite, pairIndex, indexInOrder, pair) => {
    const context = await browser.createBrowserContext();
    const page = await context.newPage();
    const session = await page.createCDPSession();
    const record = {
      mode,
      suite,
      pairIndex,
      orderIndex: indexInOrder,
      layerId: selectedLayer.layerId,
      applicationCommit: expectedCommit,
      harnessCommit: expectedCommit,
      status: 'running',
      phase: 'new-page',
      pageErrors: [],
      externalRequests: [],
      interceptionErrors: [],
      cleanup: null,
    };
    pair.runs[mode] = record;
    pages.push({ page, context, record });
    sessions.push({ session, detached: false });
    page.on('pageerror', (error) => {
      if (record.pageErrors.length < 20)
        record.pageErrors.push(String(error.message).slice(0, 400));
    });
    try {
      await page.setViewport({
        width: 1200,
        height: 900,
        deviceScaleFactor: 1,
      });
      await page.setCacheEnabled(false);
      await session.send('Performance.enable');
      if (suite === 'memory') await session.send('HeapProfiler.enable');
      const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
      const { interceptFixtureSession } = await import(
        new URL('./fixtureInterception.mjs', import.meta.url)
      );
      await interceptFixtureSession(
        session,
        origin,
        (url) => {
          if (
            ['http:', 'https:'].includes(url.protocol) &&
            url.origin !== origin &&
            record.externalRequests.length < 20
          )
            record.externalRequests.push(url.origin);
          return null;
        },
        (error) => {
          if (record.interceptionErrors.length < 20)
            record.interceptionErrors.push(String(error.message).slice(0, 400));
        },
      );
      const response = await page.goto(
        `${origin}/scripts/fixtures/infrastructure-benefit.html?mode=${mode}&layerId=${encodeURIComponent(selectedLayer.layerId)}&epoch=${encodeURIComponent(INFRASTRUCTURE_BENEFIT_EPOCH)}`,
        { waitUntil: 'networkidle0', timeout: 60_000 },
      );
      assert.equal(response?.status(), 200, 'Benefit fixture did not load.');
      record.phase = 'viewer-ready';
      let state = await waitState(
        page,
        (value) => value?.phase === 'ready',
        60_000,
      );
      record.ready = state;
      if (suite === 'memory') {
        record.memory = {
          scope: 'post-forced-gc-js-heap-used-size-only',
          beforeActivation: {
            bytes: await gcHeap(session),
            metric: 'Performance.getMetrics.JSHeapUsedSize',
            gcRequested: true,
          },
        };
      }
      record.phase = 'activating';
      await page.evaluate(() => window.__s54InfrastructureBenefit.start());
      state = await waitState(
        page,
        (value) => value?.phase === 'enabled-settled',
        180_000,
      );
      record.result = state;
      record.phase = 'enabled-settled';
      assert.deepEqual(record.pageErrors, [], 'Browser page raised errors.');
      assert.deepEqual(
        record.externalRequests,
        [],
        'Fixture made external requests.',
      );
      assert.deepEqual(
        record.interceptionErrors,
        [],
        'Fixture interception failed.',
      );
      assert.equal(state.applicationCommit, expectedCommit);
      assert.equal(state.mode, mode);
      assert.equal(state.layerId, selectedLayer.layerId);
      record.source = state.source;
      record.renderClock = state.renderTime;
      record.settings = state.settings;
      report.environment ||= {};
      report.environment.renderer = state.environment.renderer;
      report.environment.rendererClass = classifyRenderer(
        state.environment.renderer,
        report.environment.graphics,
      );
      record.environment = {
        ...state.environment,
        graphics: report.environment.graphics,
        rendererClass: report.environment.rendererClass,
      };
      assert.equal(
        record.environment.rendererClass.accelerationVerified,
        true,
        'Browser acceleration is not verified; refusing a software/unknown renderer.',
      );
      record.warmup = state.warmup;
      record.cameraContract = state.cameraContract || null;
      record.sourceReady = state.sourceReady;
      record.sourceReadyElapsedMs = state.sourceReadyElapsedMs;
      record.firstUsable = state.firstUsable;
      record.settledPixelSha256 = state.settledPixelSha256;
      record.surfacePopulation = state.surfacePopulation;
      record.enabledSettledResources = state.enabledSettledResources;
      let imageArtifacts = await page.evaluate(() =>
        window.__s54InfrastructureBenefit.exportImageArtifacts(),
      );
      assert.equal(
        imageArtifacts?.buffersReleased,
        true,
        'Fixture did not clear retained RGBA image buffers.',
      );
      record.images = {
        firstUsable: persistPng(
          suite,
          pairIndex,
          mode,
          'firstUsable',
          imageArtifacts.firstUsablePng,
          imageArtifacts,
        ),
        settled: persistPng(
          suite,
          pairIndex,
          mode,
          'settled',
          imageArtifacts.settledPng,
          imageArtifacts,
        ),
      };
      record.imageBuffersReleased = true;
      imageArtifacts = null;
      for (const image of Object.values(record.images)) {
        const bytes = readFileSync(resolve(output, image.path));
        assert.equal(hash(bytes), image.sha256, 'Saved PNG hash changed.');
        assert.deepEqual(
          bytes.subarray(0, PNG_SIGNATURE.length),
          PNG_SIGNATURE,
        );
        assert.equal(bytes.readUInt32BE(16), image.width);
        assert.equal(bytes.readUInt32BE(20), image.height);
      }
      if (suite === 'memory') {
        record.memory.imageBuffersReleased = true;
        record.memory.enabledSettled = {
          bytes: await gcHeap(session),
          metric: 'Performance.getMetrics.JSHeapUsedSize',
          gcRequested: true,
        };
      }
      record.phase = 'destroying-layer';
      const destroyed = await page.evaluate(() =>
        window.__s54InfrastructureBenefit.destroyLayer(),
      );
      assert.equal(destroyed?.ok, true, 'Layer teardown failed.');
      state = destroyed.state;
      const layerReferences = await page.evaluate(() =>
        window.__s54InfrastructureBenefit.releaseLayerReferences(),
      );
      assert.equal(
        layerReferences?.ok && layerReferences.released,
        true,
        'Fixture retained layer-owned references after teardown.',
      );
      if (suite === 'memory') record.memory.layerReferencesReleased = true;
      if (suite === 'memory')
        record.memory.afterLayerDestroy = {
          bytes: await gcHeap(session),
          metric: 'Performance.getMetrics.JSHeapUsedSize',
          gcRequested: true,
        };
      const viewerDestroyed = await page.evaluate(() =>
        window.__s54InfrastructureBenefit.destroyViewer(),
      );
      assert.equal(viewerDestroyed?.ok, true, 'Viewer teardown failed.');
      assert.equal(viewerDestroyed?.state?.phase, 'viewer-destroyed');
      assert.equal(
        viewerDestroyed?.referencesReleased,
        true,
        'Fixture retained viewer-owned references after teardown.',
      );
      if (suite === 'memory') record.memory.viewerReferencesReleased = true;
      if (suite === 'memory')
        record.memory.afterViewerDestroy = {
          bytes: await gcHeap(session),
          metric: 'Performance.getMetrics.JSHeapUsedSize',
          gcRequested: true,
        };
      record.phase = 'viewer-destroyed';
      record.teardown = {
        layerDestroyed: state.phase === 'layer-destroyed',
        viewerDestroyed: true,
        ownerCountAfterDestroy: state.afterDestroyResources?.owners,
        dataSourceCountAfterDestroy: state.afterDestroyResources?.dataSources,
        normalPrimitiveCountAfterDestroy:
          state.afterDestroyResources?.normalPrimitives,
        groundPrimitiveCountAfterDestroy:
          state.afterDestroyResources?.groundPrimitives,
      };
      record.status = 'passed';
      return record;
    } catch (error) {
      record.status = 'failed';
      record.error = String(error?.stack || error).slice(0, 8000);
      try {
        record.partial = await page.evaluate(
          () =>
            window.__s54InfrastructureBenefit?.snapshot?.() ||
            window.__s54InfrastructureBenefitState ||
            null,
        );
      } catch {}
      throw error;
    } finally {
      let cleanupError = null;
      try {
        await session.detach();
        sessions.find((item) => item.session === session).detached = true;
      } catch (error) {
        record.cleanup ||= {};
        record.cleanup.sessionDetached = false;
        cleanupError = error;
      }
      record.cleanup ||= {};
      record.cleanup.sessionDetached ??= true;
      try {
        record.cleanup.page = await closeOwnedRecoveryPage(page, browser, 3000);
      } catch (error) {
        cleanupError ||= error;
        record.cleanup.page = { closeCompleted: false, openPageCount: null };
      }
      const contextResult = await settleWithin(context.close(), 3000);
      record.cleanup.contextClosed =
        contextResult.completed && contextResult.value !== false;
      record.cleanup.complete =
        record.cleanup.page?.closeCompleted === true &&
        record.cleanup.page?.openPageCount === 0 &&
        record.cleanup.contextClosed === true &&
        record.cleanup.sessionDetached === true;
      if (!record.cleanup.complete)
        cleanupError ||= new Error(
          `${mode}/${suite} owned page/context cleanup failed.`,
        );
      if (cleanupError) throw cleanupError;
    }
  };

  try {
    save();
    server = await createServer({
      root,
      configFile: resolve(root, 'vite.config.js'),
      define: { __GEV_APP_COMMIT__: JSON.stringify(expectedCommit) },
      server: { host: '127.0.0.1', port: 0, hmr: false },
      logLevel: 'warn',
      clearScreen: false,
    });
    await server.listen();
    const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
    browser = await puppeteer.launch({
      headless: true,
      timeout: 30_000,
      args: ['--no-sandbox', '--disable-dev-shm-usage'],
    });
    const initialPage = assertInitialRecoveryPage(
      await browser.pages(),
      origin,
    );
    const initialPageClose = await closeOwnedRecoveryPage(
      initialPage,
      browser,
      3000,
    );
    assert.equal(initialPageClose.closeCompleted, true);
    assert.equal(initialPageClose.openPageCount, 0);
    report.cleanup.initialPageClosed = true;
    const graphics = await readBrowserGraphicsInfo(browser);
    report.environment = { graphics, renderer: null, rendererClass: null };
    save();

    for (const suite of ['latency', 'memory']) {
      for (let index = 0; index < INFRASTRUCTURE_BENEFIT_PAIRS; index++) {
        const order =
          index % 2 === 0
            ? ['entities', 'primitive-collections']
            : ['primitive-collections', 'entities'];
        const pair = { suite, index, order, runs: {} };
        report.pairs.push(pair);
        save();
        for (let orderIndex = 0; orderIndex < order.length; orderIndex++) {
          const mode = order[orderIndex];
          const record = await runOne(mode, suite, index, orderIndex, pair);
          validateRun(record, mode, suite, expectedCommit, selectedLayer);
          save();
        }
        const baseline = pair.runs.entities;
        const candidate = pair.runs['primitive-collections'];
        assert.equal(
          baseline.source.payloadSha256,
          candidate.source.payloadSha256,
        );
        assert.equal(
          baseline.source.featureCount,
          candidate.source.featureCount,
        );
        assert.equal(
          baseline.surfacePopulation.identitySha256,
          candidate.surfacePopulation.identitySha256,
        );
        assert.equal(
          baseline.firstUsable.pixelSha256,
          candidate.firstUsable.pixelSha256,
        );
        assert.deepEqual(baseline.settings, candidate.settings);
        assert.deepEqual(baseline.renderClock, candidate.renderClock);
        pair.sameInputAndOutput = true;
        if (suite === 'memory') {
          pair.heapDeltas = Object.fromEntries(
            INFRASTRUCTURE_BENEFIT_MODES.map((mode) => {
              const samples = pair.runs[mode].memory;
              return [
                mode,
                {
                  enabledMinusBeforeBytes:
                    samples.enabledSettled.bytes -
                    samples.beforeActivation.bytes,
                  afterDestroyMinusBeforeBytes:
                    samples.afterLayerDestroy.bytes -
                    samples.beforeActivation.bytes,
                  afterViewerDestroyMinusBeforeBytes:
                    samples.afterViewerDestroy.bytes -
                    samples.beforeActivation.bytes,
                },
              ];
            }),
          );
        }
        pair.deltas = compareInfrastructureBenefitPair(pair);
        save();
      }
    }
    report.summary = summarizeInfrastructureBenefitPairs(report.pairs);
    report.status = 'passed';
  } catch (error) {
    failure = error;
    capture(error);
  } finally {
    for (const owned of pages) {
      if (!owned.record.cleanup?.complete) {
        owned.record.cleanup ||= {};
        try {
          if (!owned.page.isClosed()) {
            owned.record.cleanup.page = await closeOwnedRecoveryPage(
              owned.page,
              browser,
              3000,
            );
          } else {
            const remainingPages = await settleWithin(browser.pages(), 3000);
            owned.record.cleanup.page = {
              closeCompleted: true,
              openPageCount: remainingPages.completed
                ? remainingPages.value.length
                : null,
            };
          }
          if (!owned.context.closed) {
            const contextClose = await settleWithin(
              owned.context.close(),
              3000,
            );
            owned.record.cleanup.contextClosed = contextClose.completed;
          } else owned.record.cleanup.contextClosed = true;
          owned.record.cleanup.complete =
            owned.record.cleanup.page?.closeCompleted === true &&
            owned.record.cleanup.page?.openPageCount === 0 &&
            owned.record.cleanup.contextClosed === true &&
            owned.record.cleanup.sessionDetached === true;
        } catch (error) {
          owned.record.cleanup ||= {};
          owned.record.cleanup.error = String(error.message).slice(0, 500);
          failure ||= error;
        }
      }
    }
    report.cleanup.pagesClosed = pages.every(
      (entry) => entry.record.cleanup?.complete,
    );
    report.cleanup.sessionsDetached = sessions.every((entry) => entry.detached);
    if (browser) {
      const close = await closeRecoveryBrowser(browser, {
        timeoutMs: 5000,
        forceProcess: () => stopOwnedRecoveryProcessTree(browser.process()),
      });
      report.cleanup.browserClosed =
        close.closeCompleted && !close.forcedProcessTermination;
      report.browserClose = close;
      if (!report.cleanup.browserClosed)
        failure ||= new Error('Browser shutdown was not clean.');
    }
    if (server) {
      const serverClose = await settleWithin(server.close(), 5000);
      report.cleanup.serverClosed = serverClose.completed;
      if (!report.cleanup.serverClosed)
        failure ||= new Error('Vite server shutdown was not clean.');
    }
    try {
      assert.equal(git(['rev-parse', 'HEAD']), expectedCommit);
      assert.equal(git(['status', '--porcelain']), '');
      for (const path of immutableFiles)
        assert.equal(
          hash(readFileSync(resolve(root, path))),
          sourceHashes[path],
        );
      assert.equal(
        hash(readFileSync(resolve(root, 'node_modules/cesium/package.json'))),
        hash(cesiumPackageBytes),
      );
      assert.equal(
        hash(
          readFileSync(
            resolve(root, 'node_modules/@cesium/engine/package.json'),
          ),
        ),
        hash(enginePackageBytes),
      );
      for (const [path, expected] of Object.entries(cesiumInstalledHashes))
        assert.equal(
          hash(readFileSync(resolve(root, 'node_modules', path))),
          expected,
        );
      report.cleanup.sourceTreeUnchanged = true;
    } catch (error) {
      failure ||= error;
      (report.errors ||= []).push(String(error.message).slice(0, 1000));
    }
    report.finishedAt = new Date().toISOString();
    if (failure) report.status = 'failed';
    else {
      try {
        validateInfrastructureBenefitReport(report, {
          expectedCommit,
          expectedLayerId: selectedLayer.layerId,
        });
      } catch (error) {
        failure = error;
        report.status = 'failed';
        (report.errors ||= []).push(String(error.message).slice(0, 2000));
      }
    }
    if (temporaryReport) {
      try {
        await import('node:fs/promises').then(({ unlink }) =>
          unlink(temporaryReport),
        );
      } catch {}
    }
    save();
  }
  console.log(
    JSON.stringify({
      schema: report.schema,
      status: report.status,
      reportPath: reportFile,
      pairs: report.pairs.length,
      renderer: report.environment?.renderer?.renderer,
      cleanup: report.cleanup,
    }),
  );
  if (failure) process.exitCode = 1;
}
