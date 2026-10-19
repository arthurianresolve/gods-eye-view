export const WEATHER_VISIBLE_WIND_PROBE_SCHEMA =
  'gev-weather-visible-wind-probe/v1';
export const WEATHER_VISIBLE_WIND_PROBE_MAX_TIMEOUT_MS = 30_000;
export const WEATHER_VISIBLE_WIND_PROBE_INELIGIBLE_REASON =
  'visible-wind-probe-is-functionality-only-diagnostic';

const DEFAULT_TIMING = Object.freeze({
  settleMs: 2_000,
  unpausedMs: 3_000,
  pausedMs: 2_000,
  resumedMs: 3_000,
  timeoutMs: WEATHER_VISIBLE_WIND_PROBE_MAX_TIMEOUT_MS,
});

const TIMING_LIMITS = Object.freeze({
  settleMs: [250, 5_000],
  unpausedMs: [500, 5_000],
  pausedMs: [500, 5_000],
  resumedMs: [500, 5_000],
  timeoutMs: [5_000, WEATHER_VISIBLE_WIND_PROBE_MAX_TIMEOUT_MS],
});

function normalizeTiming(timing = {}) {
  if (!timing || typeof timing !== 'object' || Array.isArray(timing))
    timing = {};
  const normalized = {};
  for (const [key, [minimum, maximum]] of Object.entries(TIMING_LIMITS)) {
    const value = timing[key] ?? DEFAULT_TIMING[key];
    if (!Number.isSafeInteger(value) || value < minimum || value > maximum)
      throw new RangeError(`Invalid visible-wind probe ${key}.`);
    normalized[key] = value;
  }
  const required =
    normalized.settleMs +
    normalized.unpausedMs +
    normalized.pausedMs +
    normalized.resumedMs +
    1_000;
  if (normalized.timeoutMs < required)
    throw new RangeError(
      'Visible-wind probe timeout is shorter than its phases.',
    );
  return normalized;
}

/**
 * This function is serialized into the page by Puppeteer. Keep all browser
 * references local so its behavior does not depend on the Node module realm.
 */
export async function runVisibleWindProbeInPage(timing) {
  const result = {
    schema: 'gev-weather-visible-wind-probe/v1',
    diagnosticOnly: true,
    performanceAcceptanceEligible: false,
    ineligibleReason: 'visible-wind-probe-is-functionality-only-diagnostic',
    probeHeightMeters: 60_000,
    timing,
    status: 'failed',
    failureReasons: [],
    camera: { before: null, probe: null, restored: null },
    windParams: { before: null, during: null, after: null },
    scene: { before: null, after: null },
    phases: { unpaused: null, paused: null, resumed: null },
    invariantChecks: [],
    navigationOwnership: {
      moveAttempted: false,
      moveAccepted: false,
      restoreAccepted: false,
    },
    cleanup: { attempted: false, cameraRestored: false, pauseRestored: false },
  };
  const app = window.__godsEyeView;
  const viewer = app?.viewer;
  const manager = app?.dataManager;
  const wind = manager?.layers?.get('wind')?.module;
  const styleManager = app?.styleManager;
  const runOwnedNavigation = styleManager?._runExplicitNavigation;
  const scene = viewer?.scene;
  const canvas = scene?.canvas;
  const ellipsoid = scene?.globe?.ellipsoid;
  if (
    !viewer?.camera ||
    !scene?.postRender ||
    !wind?.getDiagnostics ||
    typeof ellipsoid?.cartographicToCartesian !== 'function' ||
    typeof runOwnedNavigation !== 'function'
  ) {
    result.failureReasons.push('application-wind-api-unavailable');
    return result;
  }

  const finite = (value) => Number.isFinite(value);
  const cloneCartesian = (value) =>
    value && finite(value.x) && finite(value.y) && finite(value.z)
      ? { x: value.x, y: value.y, z: value.z }
      : null;
  const cameraState = () => {
    const cartographic = viewer.camera.positionCartographic;
    return {
      position: cloneCartesian(viewer.camera.position),
      longitude: finite(cartographic?.longitude)
        ? cartographic.longitude
        : null,
      latitude: finite(cartographic?.latitude) ? cartographic.latitude : null,
      altitudeMeters: finite(cartographic?.height) ? cartographic.height : null,
      heading: finite(viewer.camera.heading) ? viewer.camera.heading : null,
      pitch: finite(viewer.camera.pitch) ? viewer.camera.pitch : null,
      roll: finite(viewer.camera.roll) ? viewer.camera.roll : null,
    };
  };
  const params = () => {
    const value = wind.getParams?.();
    return value && typeof value === 'object'
      ? {
          model:
            typeof value.model === 'string' ? value.model.slice(0, 32) : null,
          overlay:
            typeof value.overlay === 'string'
              ? value.overlay.slice(0, 32)
              : null,
          paused: typeof value.paused === 'boolean' ? value.paused : null,
          units:
            typeof value.units === 'string' ? value.units.slice(0, 24) : null,
        }
      : null;
  };
  const sceneState = () => {
    const layers = manager?.getAll?.();
    if (!Array.isArray(layers)) return null;
    const enabledLayerIds = [];
    const populations = [];
    let enabledPopulationCountUnavailable = 0;
    for (const layer of layers.slice(0, 64)) {
      const id = typeof layer?.id === 'string' ? layer.id : null;
      if (!id) continue;
      const enabled = manager.isEnabled?.(id) === true;
      if (enabled) enabledLayerIds.push(id);
      // getAll() supplies the manager's normalized stats row, including the
      // settled count contract used by the performance observer. A module's
      // raw getStats() is not guaranteed to include that normalized count.
      const count = Number.isSafeInteger(layer.stats?.count)
        ? layer.stats.count
        : null;
      if (enabled && count === null) enabledPopulationCountUnavailable += 1;
      populations.push({
        id: id.slice(0, 64),
        enabled,
        count,
      });
    }
    enabledLayerIds.sort();
    populations.sort((a, b) => a.id.localeCompare(b.id));
    const visual = styleManager?.getVisualState?.();
    const styleParams = visual?.styleParams;
    let normalizedStyleParams = null;
    if (styleParams && typeof styleParams === 'object') {
      const styleIds = Object.keys(styleParams).sort();
      if (styleIds.length <= 32) {
        normalizedStyleParams = {};
        for (const styleId of styleIds) {
          const uniforms = styleParams[styleId];
          if (
            !/^[A-Za-z0-9_-]{1,48}$/.test(styleId) ||
            !uniforms ||
            typeof uniforms !== 'object' ||
            Object.keys(uniforms).length > 32
          ) {
            normalizedStyleParams = null;
            break;
          }
          const values = {};
          for (const [name, value] of Object.entries(uniforms).sort(
            ([a], [b]) => a.localeCompare(b),
          )) {
            if (
              !/^[A-Za-z0-9_-]{1,64}$/.test(name) ||
              (!Number.isFinite(value) && typeof value !== 'boolean')
            ) {
              normalizedStyleParams = null;
              break;
            }
            values[name] = value;
          }
          if (!normalizedStyleParams) break;
          normalizedStyleParams[styleId] = values;
        }
      }
    }
    const contextAttributes =
      scene.context?._originalGLContext?.getContextAttributes?.();
    const effectiveSettings = {
      qualityMode: styleManager?._adaptiveQuality?.getMode?.() ?? null,
      resolutionScale: Number.isFinite(viewer.resolutionScale)
        ? viewer.resolutionScale
        : null,
      maximumScreenSpaceError: Number.isFinite(
        scene.globe?.maximumScreenSpaceError,
      )
        ? scene.globe.maximumScreenSpaceError
        : null,
      msaaSamples: Number.isFinite(scene.msaaSamples)
        ? scene.msaaSamples
        : null,
      fxaa:
        typeof scene.postProcessStages?.fxaa?.enabled === 'boolean'
          ? scene.postProcessStages.fxaa.enabled
          : null,
      antialias:
        typeof contextAttributes?.antialias === 'boolean'
          ? contextAttributes.antialias
          : null,
      nativeSharpnessProfile:
        viewer.__gevNativeSharpnessProfile === 'native-sharpness-v1'
          ? viewer.__gevNativeSharpnessProfile
          : null,
      visual:
        visual && typeof visual === 'object'
          ? {
              style: typeof visual.style === 'string' ? visual.style : null,
              styleParams: normalizedStyleParams,
              bloom: visual.bloom ?? null,
              sharpen: visual.sharpen ?? null,
              hud: visual.hud ?? null,
              detection: visual.detection ?? null,
              scope: visual.scope ?? null,
              mapStack:
                typeof visual.mapStack === 'string' ? visual.mapStack : null,
            }
          : null,
    };
    const settingsComplete = Boolean(
      effectiveSettings.qualityMode === 'manual' &&
      Number.isFinite(effectiveSettings.resolutionScale) &&
      Number.isFinite(effectiveSettings.maximumScreenSpaceError) &&
      Number.isFinite(effectiveSettings.msaaSamples) &&
      effectiveSettings.fxaa !== null &&
      effectiveSettings.antialias !== null &&
      effectiveSettings.nativeSharpnessProfile &&
      effectiveSettings.visual?.style &&
      effectiveSettings.visual?.styleParams &&
      effectiveSettings.visual?.bloom?.enabled !== undefined &&
      Number.isFinite(effectiveSettings.visual?.bloom?.intensity) &&
      effectiveSettings.visual?.sharpen?.enabled !== undefined &&
      Number.isFinite(effectiveSettings.visual?.sharpen?.intensity) &&
      effectiveSettings.visual?.hud?.visible !== undefined &&
      effectiveSettings.visual?.detection?.mode &&
      Number.isFinite(effectiveSettings.visual?.detection?.density) &&
      effectiveSettings.visual?.detection?.allocation &&
      effectiveSettings.visual?.scope?.enabled !== undefined &&
      Number.isFinite(effectiveSettings.visual?.scope?.featherPct) &&
      effectiveSettings.visual?.mapStack,
    );
    return {
      enabledLayerIds,
      populations,
      layerCount: layers.length,
      layersOmitted: Math.max(0, layers.length - 64),
      enabledPopulationCountUnavailable,
      settings: effectiveSettings,
      settingsComplete,
      densityPct:
        app.styleManager?.services?.getDetectionTuning?.()?.densityPct ?? null,
      detectionMode: app.styleManager?.services?.getDetectionMode?.() ?? null,
      viewport: canvas
        ? {
            width: Number.isFinite(canvas.clientWidth)
              ? canvas.clientWidth
              : null,
            height: Number.isFinite(canvas.clientHeight)
              ? canvas.clientHeight
              : null,
            drawingBufferWidth: Number.isFinite(canvas.width)
              ? canvas.width
              : null,
            drawingBufferHeight: Number.isFinite(canvas.height)
              ? canvas.height
              : null,
            dpr: Number.isFinite(window.devicePixelRatio)
              ? window.devicePixelRatio
              : null,
          }
        : null,
    };
  };
  const readWindMaterial = () => {
    const queue = [{ value: scene.primitives, depth: 0 }];
    const seen = new Set();
    const seenMaterials = new Set();
    const matches = [];
    let materialReferenceCount = 0;
    let traversalComplete = true;
    for (let cursor = 0; cursor < queue.length && cursor < 2048; cursor++) {
      const { value, depth } = queue[cursor];
      if (!value || seen.has(value)) continue;
      seen.add(value);
      const material = value.appearance?.material;
      const uniforms = material?.uniforms;
      if (
        material?.type === 'GevWindStreamline' ||
        material?._type === 'GevWindStreamline'
      ) {
        materialReferenceCount++;
        // Wind's spatial cells share one material. Count ownership objects,
        // not primitive references; two independent materials stay ambiguous.
        if (!seenMaterials.has(material)) {
          seenMaterials.add(material);
          matches.push({
            phaseTime: finite(uniforms?.phaseTime) ? uniforms.phaseTime : null,
            heightFade: finite(uniforms?.heightFade)
              ? uniforms.heightFade
              : null,
          });
        }
      }
      if (
        depth < 4 &&
        typeof value.get === 'function' &&
        Number.isInteger(value.length)
      )
        for (
          let index = 0;
          index < value.length && queue.length < 2048;
          index++
        )
          queue.push({ value: value.get(index), depth: depth + 1 });
      if (
        typeof value.get === 'function' &&
        Number.isInteger(value.length) &&
        value.length > 0 &&
        (depth >= 4 || queue.length >= 2048)
      )
        traversalComplete = false;
    }
    return {
      ...(matches.length === 1 && traversalComplete
        ? matches[0]
        : { phaseTime: null, heightFade: null }),
      matchCount: matches.length,
      materialReferenceCount,
      traversalComplete,
    };
  };
  const readDiagnostics = () => {
    const state = wind.getDiagnostics?.() ?? {};
    const gpu = state.gpu ?? {};
    return {
      renderMode: ['gpu-streamlines', 'canvas-fallback'].includes(
        state.renderMode,
      )
        ? state.renderMode
        : null,
      paused: typeof state.paused === 'boolean' ? state.paused : null,
      reducedMotion:
        typeof state.reducedMotion === 'boolean' ? state.reducedMotion : null,
      hidden: typeof state.hidden === 'boolean' ? state.hidden : null,
      framePending:
        typeof state.framePending === 'boolean' ? state.framePending : null,
      gpu: {
        ready: typeof gpu.ready === 'boolean' ? gpu.ready : null,
        heightFade:
          finite(gpu.heightFade) && gpu.heightFade >= 0 && gpu.heightFade <= 1
            ? gpu.heightFade
            : null,
        visibleCells:
          Number.isSafeInteger(gpu.visibleCells) && gpu.visibleCells >= 0
            ? gpu.visibleCells
            : null,
        visibleVertexCount:
          Number.isSafeInteger(gpu.visibleVertexCount) &&
          gpu.visibleVertexCount >= 0
            ? gpu.visibleVertexCount
            : null,
        pathCount:
          Number.isSafeInteger(gpu.pathCount) && gpu.pathCount >= 0
            ? gpu.pathCount
            : null,
        displayHeightMeters:
          finite(gpu.displayHeightMeters) && gpu.displayHeightMeters >= 0
            ? gpu.displayHeightMeters
            : null,
      },
    };
  };
  const frames = [];
  const maxFrames = 256;
  let postRenderCount = 0;
  const startedAt = performance.now();
  let timedOut = false;
  let timer = null;
  let listenerAttached = false;
  const onPostRender = () => {
    postRenderCount += 1;
    if (frames.length >= maxFrames) return;
    const frameNumber =
      scene.frameState?.frameNumber ??
      scene._frameState?.frameNumber ??
      scene.frameNumber;
    frames.push({
      atMs: performance.now() - startedAt,
      frameNumber: Number.isSafeInteger(frameNumber) ? frameNumber : null,
      windMaterial: readWindMaterial(),
    });
  };
  const waitBounded = async (durationMs) => {
    const endAt = performance.now() + durationMs;
    while (performance.now() < endAt) {
      if (performance.now() - startedAt >= timing.timeoutMs) {
        timedOut = true;
        return false;
      }
      await new Promise((resolve) =>
        setTimeout(resolve, Math.min(100, endAt - performance.now())),
      );
    }
    return true;
  };
  const sameStableScene = (before, after) =>
    Boolean(
      before &&
      after &&
      JSON.stringify(before.enabledLayerIds) ===
        JSON.stringify(after.enabledLayerIds) &&
      JSON.stringify(before.populations) ===
        JSON.stringify(after.populations) &&
      JSON.stringify(before.settings) === JSON.stringify(after.settings) &&
      before.settingsComplete === true &&
      after.settingsComplete === true &&
      before.densityPct === after.densityPct &&
      before.detectionMode === after.detectionMode &&
      JSON.stringify(before.viewport) === JSON.stringify(after.viewport),
    );
  const sameWindSettings = (before, after) =>
    Boolean(
      before &&
      after &&
      before.model === after.model &&
      before.overlay === after.overlay &&
      before.units === after.units,
    );
  const angleDistance = (left, right) =>
    Math.abs(Math.atan2(Math.sin(left - right), Math.cos(left - right)));
  const sameCameraPose = (expected, actual) =>
    Boolean(
      expected?.position &&
      actual?.position &&
      Math.hypot(
        expected.position.x - actual.position.x,
        expected.position.y - actual.position.y,
        expected.position.z - actual.position.z,
      ) <= 1 &&
      Math.abs(expected.altitudeMeters - actual.altitudeMeters) <= 1 &&
      Math.abs(expected.latitude - actual.latitude) <= 1e-9 &&
      angleDistance(expected.longitude, actual.longitude) <= 1e-9 &&
      angleDistance(expected.heading, actual.heading) <= 1e-9 &&
      Math.abs(expected.pitch - actual.pitch) <= 1e-9 &&
      angleDistance(expected.roll, actual.roll) <= 1e-9,
    );
  const setOwnedCameraPose = (destination, pose) =>
    runOwnedNavigation.call(styleManager, 'camera', () =>
      viewer.camera.setView({
        destination,
        orientation: {
          heading: pose.heading,
          pitch: pose.pitch,
          roll: pose.roll,
        },
      }),
    );
  const checkInvariants = (label, referenceScene, referenceParams) => {
    const observedScene = sceneState();
    const observedParams = params();
    const sceneUnchanged = sameStableScene(referenceScene, observedScene);
    const windSettingsUnchanged = sameWindSettings(
      referenceParams,
      observedParams,
    );
    result.invariantChecks.push({
      stage: label,
      atMs: performance.now() - startedAt,
      sceneUnchanged,
      windSettingsUnchanged,
    });
    if (!sceneUnchanged)
      result.failureReasons.push(
        `scene-population-or-settings-changed:${label}`,
      );
    if (!windSettingsUnchanged)
      result.failureReasons.push(`wind-settings-changed:${label}`);
    if (observedScene?.enabledPopulationCountUnavailable !== 0)
      result.failureReasons.push(
        `enabled-layer-population-count-unavailable:${label}`,
      );
  };
  const visibleReady = (observation) => {
    const diagnostics = observation?.diagnostics;
    return Boolean(
      diagnostics?.renderMode === 'gpu-streamlines' &&
      diagnostics.paused === false &&
      diagnostics.reducedMotion === false &&
      diagnostics.hidden === false &&
      diagnostics.gpu?.ready === true &&
      diagnostics.gpu.heightFade > 0 &&
      diagnostics.gpu.visibleCells > 0 &&
      diagnostics.gpu.visibleVertexCount > 0 &&
      diagnostics.gpu.pathCount > 0 &&
      observation.windMaterial?.matchCount === 1 &&
      Number.isFinite(observation.windMaterial.phaseTime) &&
      observation.windMaterial.heightFade > 0,
    );
  };

  let home = null;
  let homePosition = null;
  let priorParams = null;
  let cameraMoveAttempted = false;
  try {
    home = cameraState();
    homePosition = viewer.camera.position.clone?.() ?? null;
    priorParams = params();
    result.camera.before = home;
    result.windParams.before = priorParams;
    result.scene.before = sceneState();
    if (
      !home.position ||
      !Number.isFinite(home.longitude) ||
      !Number.isFinite(home.latitude) ||
      !Number.isFinite(home.altitudeMeters) ||
      !homePosition ||
      !priorParams ||
      typeof priorParams.paused !== 'boolean' ||
      !result.scene.before
    ) {
      result.failureReasons.push('initial-state-unavailable');
      return result;
    }
    scene.postRender.addEventListener(onPostRender);
    listenerAttached = true;
    timer = setTimeout(() => {
      timedOut = true;
    }, timing.timeoutMs);
    const elevated = ellipsoid.cartographicToCartesian({
      longitude: home.longitude,
      latitude: home.latitude,
      height: 60_000,
    });
    cameraMoveAttempted = true;
    result.navigationOwnership.moveAttempted = true;
    const moveResult = setOwnedCameraPose(elevated, home);
    result.navigationOwnership.moveAccepted = moveResult !== false;
    if (moveResult === false)
      result.failureReasons.push('camera-navigation-ownership-refused');
    wind.setParams({ paused: false });
    result.camera.probe = cameraState();
    if (
      Math.abs(result.camera.probe.altitudeMeters - 60_000) > 5 ||
      Math.abs(result.camera.probe.latitude - home.latitude) > 1e-9 ||
      angleDistance(result.camera.probe.longitude, home.longitude) > 1e-9 ||
      angleDistance(result.camera.probe.heading, home.heading) > 1e-9 ||
      Math.abs(result.camera.probe.pitch - home.pitch) > 1e-9 ||
      angleDistance(result.camera.probe.roll, home.roll) > 1e-9
    )
      result.failureReasons.push('probe-camera-height-mismatch');
    if (!(await waitBounded(timing.settleMs)))
      result.failureReasons.push('probe-timeout-during-camera-settle');

    const baseWind = params();
    const baseScene = sceneState();
    if (!sameWindSettings(priorParams, baseWind))
      result.failureReasons.push('wind-settings-changed-during-camera-setup');
    if (!sameStableScene(result.scene.before, baseScene))
      result.failureReasons.push(
        'scene-population-or-settings-changed-during-setup',
      );
    if (
      result.scene.before.enabledPopulationCountUnavailable !== 0 ||
      baseScene.enabledPopulationCountUnavailable !== 0 ||
      result.scene.before.layersOmitted !== 0 ||
      baseScene.layersOmitted !== 0
    )
      result.failureReasons.push('enabled-layer-population-count-unavailable');
    result.windParams.during = baseWind;

    const unpausedFrameStart = postRenderCount;
    const unpausedStoredFrameStart = frames.length;
    const unpausedStart = {
      diagnostics: readDiagnostics(),
      windMaterial: readWindMaterial(),
    };
    checkInvariants('unpaused-start', baseScene, baseWind);
    if (!visibleReady(unpausedStart))
      result.failureReasons.push('wind-gpu-not-visible-at-probe-pose');
    await waitBounded(timing.unpausedMs);
    const unpausedEnd = {
      diagnostics: readDiagnostics(),
      windMaterial: readWindMaterial(),
    };
    checkInvariants('unpaused-end', baseScene, baseWind);
    result.phases.unpaused = {
      durationMs: timing.unpausedMs,
      start: unpausedStart,
      end: unpausedEnd,
      postRenderCount: postRenderCount - unpausedFrameStart,
      frames: frames.slice(unpausedStoredFrameStart, maxFrames),
      framesOmitted: Math.max(
        0,
        postRenderCount -
          unpausedFrameStart -
          (frames.length - unpausedStoredFrameStart),
      ),
    };
    if (
      !visibleReady(unpausedEnd) ||
      unpausedEnd.windMaterial.phaseTime ===
        unpausedStart.windMaterial.phaseTime
    )
      result.failureReasons.push('unpaused-wind-phase-did-not-advance-visibly');
    if (postRenderCount === unpausedFrameStart)
      result.failureReasons.push('no-natural-postrender-observed');

    const pauseFrameStart = postRenderCount;
    const pauseStoredFrameStart = frames.length;
    wind.setParams({ paused: true });
    const pauseStart = {
      diagnostics: readDiagnostics(),
      windMaterial: readWindMaterial(),
    };
    checkInvariants('paused-start', baseScene, baseWind);
    await waitBounded(timing.pausedMs);
    const pauseEnd = {
      diagnostics: readDiagnostics(),
      windMaterial: readWindMaterial(),
    };
    checkInvariants('paused-end', baseScene, baseWind);
    result.phases.paused = {
      durationMs: timing.pausedMs,
      start: pauseStart,
      end: pauseEnd,
      postRenderCount: postRenderCount - pauseFrameStart,
      frames: frames.slice(pauseStoredFrameStart, maxFrames),
      framesOmitted: Math.max(
        0,
        postRenderCount -
          pauseFrameStart -
          (frames.length - pauseStoredFrameStart),
      ),
    };
    if (
      pauseStart.diagnostics.paused !== true ||
      pauseEnd.diagnostics.paused !== true ||
      pauseStart.windMaterial.matchCount !== 1 ||
      pauseStart.windMaterial.phaseTime === null ||
      pauseStart.windMaterial.phaseTime !== pauseEnd.windMaterial.phaseTime
    )
      result.failureReasons.push('paused-wind-phase-was-not-stable');

    const resumeFrameStart = postRenderCount;
    const resumeStoredFrameStart = frames.length;
    wind.setParams({ paused: false });
    const resumeStart = {
      diagnostics: readDiagnostics(),
      windMaterial: readWindMaterial(),
    };
    await waitBounded(timing.resumedMs);
    const resumeEnd = {
      diagnostics: readDiagnostics(),
      windMaterial: readWindMaterial(),
    };
    checkInvariants('resumed-end', baseScene, baseWind);
    result.phases.resumed = {
      durationMs: timing.resumedMs,
      start: resumeStart,
      end: resumeEnd,
      postRenderCount: postRenderCount - resumeFrameStart,
      frames: frames.slice(resumeStoredFrameStart, maxFrames),
      framesOmitted: Math.max(
        0,
        postRenderCount -
          resumeFrameStart -
          (frames.length - resumeStoredFrameStart),
      ),
    };
    if (
      resumeStart.diagnostics.paused !== false ||
      !visibleReady(resumeEnd) ||
      resumeStart.windMaterial.matchCount !== 1 ||
      resumeStart.windMaterial.phaseTime === resumeEnd.windMaterial.phaseTime ||
      postRenderCount <= resumeFrameStart
    )
      result.failureReasons.push(
        'resumed-wind-did-not-advance-with-natural-render',
      );

    const stableAfter = sceneState();
    const windAfter = params();
    result.scene.after = stableAfter;
    result.windParams.after = windAfter;
    if (!sameStableScene(baseScene, stableAfter))
      result.failureReasons.push('scene-population-or-settings-changed');
    if (stableAfter?.enabledPopulationCountUnavailable !== 0)
      result.failureReasons.push('enabled-layer-population-count-unavailable');
    if (!sameWindSettings(priorParams, windAfter))
      result.failureReasons.push('wind-settings-not-restored');
    if (timedOut) result.failureReasons.push('probe-timeout');
  } catch (error) {
    result.failureReasons.push(
      `probe-error:${String(error?.name || 'Error').slice(0, 48)}`,
    );
  } finally {
    result.cleanup.attempted = true;
    if (timer !== null) clearTimeout(timer);
    if (listenerAttached) {
      try {
        scene.postRender.removeEventListener(onPostRender);
      } catch {
        result.failureReasons.push('postrender-listener-cleanup-failed');
      }
    }
    try {
      if (cameraMoveAttempted && home?.position) {
        const restoreResult = setOwnedCameraPose(homePosition, home);
        result.navigationOwnership.restoreAccepted = restoreResult !== false;
        if (restoreResult === false) throw new Error('navigation-refused');
      }
    } catch {
      result.failureReasons.push('camera-restore-failed');
    }
    try {
      if (priorParams && typeof priorParams.paused === 'boolean')
        wind.setParams({ paused: priorParams.paused });
    } catch {
      result.failureReasons.push('wind-pause-restore-failed');
    }
    try {
      result.camera.restored = cameraState();
      result.windParams.after = params();
      result.cleanup.cameraRestored = sameCameraPose(
        home,
        result.camera.restored,
      );
      result.cleanup.pauseRestored =
        result.windParams.after?.paused === priorParams?.paused;
    } catch {
      result.failureReasons.push('restoration-verification-failed');
      result.cleanup.cameraRestored = false;
      result.cleanup.pauseRestored = false;
    }
    if (!result.cleanup.cameraRestored)
      result.failureReasons.push('camera-restoration-unverified');
    if (!result.cleanup.pauseRestored)
      result.failureReasons.push('wind-pause-restoration-unverified');
  }
  result.status = result.failureReasons.length === 0 ? 'observed' : 'failed';
  result.totalElapsedMs = Math.max(0, performance.now() - startedAt);
  return result;
}

export async function probeWeatherVisibleWind({ page, timing, signal } = {}) {
  if (!page || typeof page.evaluate !== 'function')
    throw new TypeError('A Puppeteer page with evaluate() is required.');
  const normalizedTiming = normalizeTiming(timing);
  const hostStartedAt = Date.now();
  let hostTimer = null;
  let abortListener = null;
  let pageEvaluationMayBeRunning = false;
  try {
    if (signal?.aborted) {
      pageEvaluationMayBeRunning = false;
      throw Object.assign(new Error('Visible-wind probe cancelled.'), {
        name: 'AbortError',
      });
    }
    const evaluation = Promise.resolve().then(() =>
      page.evaluate(runVisibleWindProbeInPage, normalizedTiming),
    );
    const bounds = [
      evaluation,
      new Promise((_, reject) => {
        hostTimer = setTimeout(() => {
          pageEvaluationMayBeRunning = true;
          reject(
            Object.assign(
              new Error('Visible-wind page evaluation timed out.'),
              {
                name: 'TimeoutError',
              },
            ),
          );
        }, normalizedTiming.timeoutMs + 2_000);
      }),
    ];
    if (signal) {
      bounds.push(
        new Promise((_, reject) => {
          abortListener = () => {
            pageEvaluationMayBeRunning = true;
            reject(
              Object.assign(new Error('Visible-wind probe cancelled.'), {
                name: 'AbortError',
              }),
            );
          };
          signal.addEventListener('abort', abortListener, { once: true });
          // An AbortSignal can change between the initial check and listener
          // installation. Recheck after subscribing so that race cannot hang.
          if (signal.aborted) abortListener();
        }),
      );
    }
    const report = await Promise.race(bounds);
    if (
      report?.schema !== WEATHER_VISIBLE_WIND_PROBE_SCHEMA ||
      report?.diagnosticOnly !== true ||
      report?.performanceAcceptanceEligible !== false ||
      !['observed', 'failed'].includes(report?.status) ||
      !Array.isArray(report?.failureReasons)
    )
      throw new Error('Visible-wind probe returned an invalid report.');
    return {
      ...report,
      hostElapsedMs: Math.max(0, Date.now() - hostStartedAt),
    };
  } catch (error) {
    return {
      schema: WEATHER_VISIBLE_WIND_PROBE_SCHEMA,
      diagnosticOnly: true,
      performanceAcceptanceEligible: false,
      ineligibleReason: WEATHER_VISIBLE_WIND_PROBE_INELIGIBLE_REASON,
      timing: normalizedTiming,
      status: 'failed',
      failureReasons: [
        `page-evaluation-failed:${String(error?.name || 'Error').slice(0, 48)}`,
      ],
      cleanup: {
        attempted: false,
        cameraRestored: false,
        pauseRestored: false,
      },
      pageEvaluationMayBeRunning,
      totalElapsedMs: null,
      hostElapsedMs: Math.max(0, Date.now() - hostStartedAt),
    };
  } finally {
    if (hostTimer !== null) clearTimeout(hostTimer);
    if (abortListener) signal?.removeEventListener?.('abort', abortListener);
  }
}

export function validateVisibleWindProbeReport(report) {
  const failures = [];
  if (report?.schema !== WEATHER_VISIBLE_WIND_PROBE_SCHEMA)
    failures.push('wrong-schema');
  if (
    report?.diagnosticOnly !== true ||
    report?.performanceAcceptanceEligible !== false
  )
    failures.push('not-explicitly-diagnostic-only');
  if (report?.status !== 'observed') failures.push('probe-not-observed');
  if (report?.cleanup?.cameraRestored !== true)
    failures.push('camera-not-restored');
  if (report?.cleanup?.pauseRestored !== true)
    failures.push('pause-not-restored');
  if (!Array.isArray(report?.failureReasons) || report.failureReasons.length)
    failures.push('probe-has-failures');
  return { valid: failures.length === 0, failures };
}
