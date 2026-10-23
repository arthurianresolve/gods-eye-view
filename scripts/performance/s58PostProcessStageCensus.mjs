import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PostProcessStage, PostProcessStageCollection, VERSION } from 'cesium';
import { VisualEffects } from '../../src/ui/visualEffects.js';
import { VisualSettings } from '../../src/ui/visualSettings.js';
import { STYLES, TRANSITION_DURATION_MS } from '../../src/ui/visualPresets.js';

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../..',
);
const SOURCE_FILES = [
  'src/ui/visualEffects.js',
  'src/ui/visualSettings.js',
  'src/ui/visualPresets.js',
  'package-lock.json',
  'scripts/performance/s58PostProcessStageCensus.mjs',
];

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

function sourceIdentity() {
  const files = Object.fromEntries(
    SOURCE_FILES.map((relativePath) => [
      relativePath,
      sha256(readFileSync(path.join(ROOT, relativePath))),
    ]),
  );
  let commit = null;
  let dirty = null;
  try {
    commit = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    dirty =
      execFileSync('git', ['status', '--porcelain'], {
        cwd: ROOT,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim().length > 0;
  } catch {
    // Source hashes remain authoritative when the diagnostic runs outside git.
  }
  return { commit, dirty, files };
}

function makeFixtureDescriptor() {
  return {
    id: 's58-visual-effects-stage-census-v1',
    engine: `Cesium-${VERSION}`,
    path: 'VisualSettings.setStyle -> VisualEffects -> real Cesium PostProcessStageCollection; UI boundary stubbed',
    selectedStyleSequence: ['normal', 'noir', 'thermal'],
    transitionDurationMs: TRANSITION_DURATION_MS,
    crossfadeSamplesMs: [250, 500],
    finalEffects: {
      bloomEnabled: true,
      bloomIntensity: 100,
      sharpenEnabled: true,
    },
    observation:
      'stage ownership/enabled state only; no collection update or WebGL context',
  };
}

function snapshot({
  collection,
  effects,
  label,
  expectedStyles,
  selectedStyle,
}) {
  const stages = Object.entries(effects.stages).map(([name, stage]) => ({
    name,
    nativeStage: stage instanceof PostProcessStage,
    inCollection: Array.from({ length: collection.length }, (_, index) =>
      collection.get(index),
    ).includes(stage),
    enabled: Boolean(stage.enabled),
    intensity: Number(stage.uniforms.intensity),
    animated: stage.uniforms.time !== undefined,
    time:
      stage.uniforms.time === undefined ? null : Number(stage.uniforms.time),
  }));
  const enabledStyles = stages
    .filter((stage) => stage.enabled)
    .map((stage) => stage.name)
    .sort();
  return {
    label,
    selectedStyle,
    expectedEnabledStyles: [...expectedStyles].sort(),
    enabledStyles,
    styleStages: stages,
    styleStageCount: stages.length,
    enabledStyleContributionCount: enabledStyles.length,
    sharpen: effects.sharpenStage
      ? {
          nativeStage: effects.sharpenStage instanceof PostProcessStage,
          inCollection: Array.from({ length: collection.length }, (_, index) =>
            collection.get(index),
          ).includes(effects.sharpenStage),
          enabled: Boolean(effects.sharpenStage.enabled),
          amount: Number(effects.sharpenStage.uniforms.amount),
        }
      : null,
    borrowedBloom: effects.bloomStage
      ? {
          enabled: Boolean(effects.bloomStage.enabled),
          intensity: effects.bloomIntensity,
        }
      : null,
    transitionCount: effects.transitions.size,
    collectionLength: collection.length,
  };
}

/**
 * Run the real VisualEffects owner against real Cesium stage objects without a
 * Viewer, WebGL context, collection update, or rendered-frame claim.
 * The optional duplicate injection exists only for validator negative tests.
 */
export function captureS58PostProcessStageCensus({
  injectDuplicateEnabledStyle = false,
} = {}) {
  let clock = 0;
  let nextFrameId = 0;
  const pendingFrames = new Map();
  const holds = new Set();
  const collection = new PostProcessStageCollection();
  const bloom = collection.bloom;
  const originalBloom = {
    enabled: bloom.enabled,
    uniforms: Object.fromEntries(
      ['glowOnly', 'contrast', 'brightness', 'delta', 'sigma', 'stepSize'].map(
        (key) => [key, bloom.uniforms[key]],
      ),
    ),
  };
  const effects = new VisualEffects({
    viewer: { scene: { postProcessStages: collection } },
    requestRender() {},
    holdRender: (reason) => holds.add(reason),
    releaseRender: (reason) => holds.delete(reason),
    requestFrame(callback) {
      const id = nextFrameId++;
      pendingFrames.set(id, callback);
      return id;
    },
    cancelFrame(id) {
      pendingFrames.delete(id);
    },
    now: () => clock,
    wallNow: () => 1_800_000_000_000 + clock,
  });
  const timeline = [];

  const record = (label, selectedStyle, expectedStyles) => {
    timeline.push(
      snapshot({ collection, effects, label, expectedStyles, selectedStyle }),
    );
  };
  const tick = (time) => {
    clock = time;
    const callbacks = [...pendingFrames.values()];
    pendingFrames.clear();
    for (const callback of callbacks) callback();
  };
  const previousGlobals = {
    document: Object.getOwnPropertyDescriptor(globalThis, 'document'),
    window: Object.getOwnPropertyDescriptor(globalThis, 'window'),
    CustomEvent: Object.getOwnPropertyDescriptor(globalThis, 'CustomEvent'),
  };
  const rootElement = { dataset: {} };
  globalThis.document = {
    documentElement: rootElement,
    querySelectorAll: () => [],
  };
  globalThis.window = { dispatchEvent() {} };
  if (typeof globalThis.CustomEvent !== 'function') {
    globalThis.CustomEvent = class CustomEvent {
      constructor(type, init = {}) {
        this.type = type;
        this.detail = init.detail;
      }
    };
  }
  const styleOwner = Object.create(VisualSettings.prototype);
  Object.assign(styleOwner, {
    activeStyle: 'normal',
    readHud: () => ({ getVariant: () => 'tactical', onStyleChange() {} }),
    readShareLinks: () => ({ claimRestoreLane() {}, onStyleChange() {} }),
    services: { setDetectionStyle() {} },
    _visualEffects: effects,
    _styleIndicator: {},
    _syncShareState() {},
    setCelestialRingEnabled() {},
    _updateStyleMiniStatus() {},
    _updateSliderPanel() {},
    _updateHudButtonState() {},
    _syncIrBoost() {},
    _syncCockpitInheritedStyle() {},
  });

  try {
    effects.initStyles();
    effects.initPostProcess();
    record('initialized-normal', 'normal', []);

    styleOwner.setStyle('noir', {
      applyPreset: false,
      revealParameters: false,
    });
    tick(250);
    record('normal-to-noir-midpoint', 'noir', ['noir']);
    tick(500);
    record('settled-noir', 'noir', ['noir']);

    styleOwner.setStyle('thermal', {
      applyPreset: false,
      revealParameters: false,
    });
    tick(750);
    record('noir-to-thermal-crossfade', 'thermal', ['noir', 'thermal']);
    tick(1000);
    effects.setSharpenEnabled(true);
    effects.setBloomEnabled(true);
    effects.applyBloomIntensity(100);
    if (injectDuplicateEnabledStyle)
      effects.setStageIntensity(effects.stages.retro, 1);
    record('settled-thermal-with-effects', 'thermal', ['thermal']);

    const beforeDestroy = {
      pendingAnimationFrames: pendingFrames.size,
      renderHolds: [...holds].sort(),
      ownedStageCount: [
        ...Object.values(effects.stages),
        effects.sharpenStage,
      ].filter((stage) =>
        Array.from({ length: collection.length }, (_, index) =>
          collection.get(index),
        ).includes(stage),
      ).length,
    };
    effects.destroy();
    const afterDestroy = {
      collectionLength: collection.length,
      pendingAnimationFrames: pendingFrames.size,
      renderHolds: [...holds].sort(),
      bloomRestored:
        bloom.enabled === originalBloom.enabled &&
        [
          'glowOnly',
          'contrast',
          'brightness',
          'delta',
          'sigma',
          'stepSize',
        ].every((key) => bloom.uniforms[key] === originalBloom.uniforms[key]),
    };
    const descriptor = makeFixtureDescriptor();
    const identity = sourceIdentity();
    return {
      schemaVersion: 1,
      fixture: {
        ...descriptor,
        sha256: sha256(Buffer.from(JSON.stringify(descriptor))),
      },
      identity: {
        source: identity,
        cesiumVersion: VERSION,
      },
      timeline,
      ownership: { beforeDestroy, afterDestroy },
      renderedFrames: null,
      gpuPassCount: null,
      shaderCompilation: null,
      scope:
        'Enabled stage ownership only. No WebGL, stage collection update, rendered pixels, or GPU pass measurement.',
    };
  } finally {
    if (!effects.destroyed) effects.destroy();
    collection.destroy();
    for (const [key, descriptor] of Object.entries(previousGlobals)) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  }
}

export function validateS58PostProcessStageCensus(report) {
  if (
    report?.schemaVersion !== 1 ||
    report.fixture?.id !== 's58-visual-effects-stage-census-v1'
  )
    throw new Error('Unsupported S58 stage census schema or fixture.');
  if (
    report.identity?.cesiumVersion !== VERSION ||
    report.fixture.engine !== `Cesium-${VERSION}`
  )
    throw new Error('S58 stage census Cesium identity mismatch.');
  if (
    !report.identity?.source?.files ||
    Object.values(report.identity.source.files).some(
      (digest) => !/^[a-f0-9]{64}$/.test(digest),
    )
  )
    throw new Error('S58 stage census source identity is incomplete.');
  const actualSourceFiles = Object.fromEntries(
    SOURCE_FILES.map((relativePath) => [
      relativePath,
      sha256(readFileSync(path.join(ROOT, relativePath))),
    ]),
  );
  if (
    JSON.stringify(report.identity.source.files) !==
    JSON.stringify(actualSourceFiles)
  )
    throw new Error(
      'S58 stage census source hashes do not match this checkout.',
    );
  const { sha256: fixtureDigest, ...fixtureDescriptor } = report.fixture;
  const expectedDescriptor = makeFixtureDescriptor();
  if (JSON.stringify(fixtureDescriptor) !== JSON.stringify(expectedDescriptor))
    throw new Error('S58 stage census fixture settings mismatch.');
  if (
    fixtureDigest !==
    sha256(
      Buffer.from(
        JSON.stringify({
          id: report.fixture.id,
          engine: report.fixture.engine,
          path: report.fixture.path,
          selectedStyleSequence: report.fixture.selectedStyleSequence,
          transitionDurationMs: report.fixture.transitionDurationMs,
          crossfadeSamplesMs: report.fixture.crossfadeSamplesMs,
          finalEffects: report.fixture.finalEffects,
          observation: report.fixture.observation,
        }),
      ),
    )
  )
    throw new Error('S58 stage census fixture digest mismatch.');
  const expectedLabels = [
    'initialized-normal',
    'normal-to-noir-midpoint',
    'settled-noir',
    'noir-to-thermal-crossfade',
    'settled-thermal-with-effects',
  ];
  const expectedStates = [
    { selectedStyle: 'normal', styles: [] },
    { selectedStyle: 'noir', styles: ['noir'] },
    { selectedStyle: 'noir', styles: ['noir'] },
    { selectedStyle: 'thermal', styles: ['noir', 'thermal'] },
    { selectedStyle: 'thermal', styles: ['thermal'] },
  ];
  if (report.timeline?.length !== expectedLabels.length)
    throw new Error('S58 stage census timeline is incomplete.');
  for (let index = 0; index < expectedLabels.length; index++) {
    const row = report.timeline[index];
    if (row.label !== expectedLabels[index])
      throw new Error('S58 stage census timeline order mismatch.');
    const state = expectedStates[index];
    const actual = row.styleStages
      .filter((stage) => stage.enabled)
      .map((stage) => stage.name)
      .sort();
    const expected = [...state.styles].sort();
    if (
      row.selectedStyle !== state.selectedStyle ||
      JSON.stringify([...row.expectedEnabledStyles].sort()) !==
        JSON.stringify(expected) ||
      JSON.stringify([...row.enabledStyles].sort()) !==
        JSON.stringify(actual) ||
      row.enabledStyleContributionCount !== actual.length ||
      JSON.stringify(actual) !== JSON.stringify(expected)
    )
      throw new Error(`Unexpected enabled style contribution at ${row.label}.`);
    if (
      row.styleStageCount !== Object.keys(STYLES).length ||
      row.styleStages.length !== Object.keys(STYLES).length ||
      row.collectionLength !== Object.keys(STYLES).length + 1 ||
      row.styleStages.some(
        (stage) =>
          !stage.nativeStage ||
          !stage.inCollection ||
          !Number.isFinite(stage.intensity) ||
          stage.intensity < 0 ||
          stage.intensity > 1 ||
          stage.enabled !== stage.intensity > 0.001 ||
          (stage.animated && !Number.isFinite(stage.time)),
      )
    )
      throw new Error(`Invalid owned style-stage inventory at ${row.label}.`);
    if (
      JSON.stringify(row.styleStages.map((stage) => stage.name).sort()) !==
      JSON.stringify(Object.keys(STYLES).sort())
    )
      throw new Error(`Unexpected owned style-stage names at ${row.label}.`);
    const transitionCounts = [0, 1, 0, 2, 0];
    if (row.transitionCount !== transitionCounts[index])
      throw new Error(`Unexpected transition ownership at ${row.label}.`);
  }
  const active = report.timeline.at(-1);
  if (
    active.sharpen?.nativeStage !== true ||
    !active.sharpen.inCollection ||
    active.sharpen.enabled !== true ||
    active.sharpen.amount !== 1.08 ||
    active.borrowedBloom?.enabled !== true ||
    active.borrowedBloom.intensity !== 100
  )
    throw new Error(
      'S58 settled effect settings do not match the declared fixture.',
    );
  if (
    report.timeline
      .slice(0, -1)
      .some(
        (row) =>
          row.sharpen?.enabled !== false ||
          row.borrowedBloom?.enabled !== false,
      )
  )
    throw new Error(
      'S58 effect stages enabled outside the declared final state.',
    );
  const end = report.ownership?.afterDestroy;
  if (
    report.ownership?.beforeDestroy?.ownedStageCount !==
      Object.keys(STYLES).length + 1 ||
    report.ownership.beforeDestroy.pendingAnimationFrames !== 1 ||
    JSON.stringify(report.ownership.beforeDestroy.renderHolds) !==
      JSON.stringify(['style-anim']) ||
    end?.collectionLength !== 0 ||
    end?.pendingAnimationFrames !== 0 ||
    end?.renderHolds?.length !== 0 ||
    end?.bloomRestored !== true
  )
    throw new Error('S58 stage ownership did not retire or restore cleanly.');
  if (
    report.renderedFrames !== null ||
    report.gpuPassCount !== null ||
    report.shaderCompilation !== null
  )
    throw new Error(
      'S58 stage census must not claim rendered or GPU evidence.',
    );
  return { valid: true, timelineEntries: report.timeline.length };
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const report = captureS58PostProcessStageCensus();
  validateS58PostProcessStageCensus(report);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}
