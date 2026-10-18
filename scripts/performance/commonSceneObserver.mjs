/**
 * Read comparison inputs from the page-owned app and Cesium surfaces shared
 * by the pinned baseline and current candidate. This function is deliberately
 * self-contained so Puppeteer can serialize it with page.evaluate().
 */
export function observeCommonScene({
  windowObject = globalThis.window,
  appCommit = null,
} = {}) {
  const fail = (field) => {
    throw new Error(`Common scene observer is missing ${field}.`);
  };
  const readVector = (value) => {
    if (![value?.x, value?.y, value?.z].every(Number.isFinite))
      fail('finite camera vector');
    return { x: value.x, y: value.y, z: value.z };
  };
  const readMatrix = (value) => {
    const values = Array.from(value || []);
    if (values.length !== 16 || !values.every(Number.isFinite))
      fail('camera transform');
    return values;
  };
  const app = windowObject?.__godsEyeView;
  const viewer = app?.viewer;
  const scene = viewer?.scene;
  const canvas = scene?.canvas;
  const style = app?.styleManager;
  const manager = app?.dataManager;
  if (!viewer) fail('application viewer');
  if (!scene?.postRender?.addEventListener) fail('scene postRender event');
  if (
    !canvas ||
    !Number.isFinite(canvas.width) ||
    !Number.isFinite(canvas.height)
  )
    fail('scene canvas dimensions');
  if (!style?.getVisualState) fail('visual-state reader');
  if (!style?._adaptiveQuality?.getMode) fail('quality-mode reader');
  if (!style?.services?.getDetectionTuning || !style.services.getDetectionMode)
    fail('detection settings readers');
  if (!manager?.getAll) fail('layer population reader');

  const rendererProbe = windowObject.__gevRecoveryEarlyRendererProbe;
  if (
    !rendererProbe?.captured ||
    !rendererProbe.canvas ||
    !rendererProbe.context
  )
    fail('early Cesium renderer evidence');
  if (rendererProbe.error) fail('early Cesium renderer query');
  if (rendererProbe.contextLost || rendererProbe.contextRestored)
    fail('unchanged Cesium WebGL context');
  if (rendererProbe.context?.isContextLost?.() === true)
    fail('live Cesium WebGL context');
  if (rendererProbe.canvas !== canvas) fail('Cesium renderer canvas identity');
  const originalContext = scene.context?._originalGLContext;
  if (!originalContext || originalContext !== rendererProbe.context)
    fail('Cesium renderer context identity');
  if (
    typeof rendererProbe.renderer !== 'string' ||
    !rendererProbe.renderer.trim() ||
    !rendererProbe.contextAttributes ||
    typeof rendererProbe.contextAttributes.antialias !== 'boolean' ||
    rendererProbe.parameterQueryCount !== 2 ||
    !Number.isFinite(rendererProbe.queryDurationMs) ||
    rendererProbe.queryDurationMs < 0
  )
    fail('complete early Cesium renderer evidence');
  const renderer = rendererProbe.renderer;
  const vendor =
    typeof rendererProbe.vendor === 'string' ? rendererProbe.vendor : null;
  const attributes = rendererProbe.contextAttributes;

  const layers = manager.getAll().map((layer) => {
    if (typeof layer?.id !== 'string' || !layer.id) fail('layer identity');
    const count = layer.stats?.count;
    if (layer.enabled && (!Number.isInteger(count) || count < 0))
      fail(`count for enabled layer ${layer.id}`);
    return {
      id: layer.id,
      enabled: Boolean(layer.enabled),
      count: Number.isInteger(count) && count >= 0 ? count : null,
    };
  });
  const visualState = style.getVisualState();
  if (
    !visualState?.style ||
    !visualState.styleParams ||
    typeof visualState.bloom?.enabled !== 'boolean' ||
    !Number.isFinite(visualState.bloom.intensity) ||
    typeof visualState.sharpen?.enabled !== 'boolean' ||
    !Number.isFinite(visualState.sharpen.intensity)
  )
    fail('effective visual state');
  const densityPct = style.services.getDetectionTuning()?.densityPct;
  const detectionMode = style.services.getDetectionMode();
  if (!Number.isFinite(densityPct)) fail('effective detection density');
  if (typeof detectionMode !== 'string' || !detectionMode)
    fail('detection mode');

  const view = style.shareLinkManager?.getCurrentView?.();
  const settings = {
    qualityMode: style._adaptiveQuality.getMode(),
    densityPct,
    detectionMode,
    resolutionScale: viewer.resolutionScale,
    antialias: attributes.antialias,
    msaaSamples: scene.msaaSamples,
    fxaa: scene.postProcessStages?.fxaa?.enabled,
    bloom: visualState.bloom.enabled,
    bloomIntensity: visualState.bloom.intensity,
    sharpen: visualState.sharpen.enabled,
    sharpenIntensity: visualState.sharpen.intensity,
    style: view?.style ?? visualState.style,
    map: view?.map ?? visualState.map ?? null,
    visualState,
  };
  const nativeSharpnessProfile =
    viewer.__gevNativeSharpnessProfile === 'native-sharpness-v1'
      ? {
          id: viewer.__gevNativeSharpnessProfile,
          useBrowserRecommendedResolution:
            viewer.useBrowserRecommendedResolution,
          resolutionScale: viewer.resolutionScale,
          maximumScreenSpaceError: viewer.globe?.maximumScreenSpaceError,
          viewport: {
            width: windowObject.innerWidth,
            height: windowObject.innerHeight,
            dpr: windowObject.devicePixelRatio,
          },
        }
      : null;
  if (nativeSharpnessProfile) {
    if (
      nativeSharpnessProfile.useBrowserRecommendedResolution !== false ||
      nativeSharpnessProfile.resolutionScale !== 1 ||
      nativeSharpnessProfile.maximumScreenSpaceError !== 1 ||
      !Number.isInteger(nativeSharpnessProfile.viewport.width) ||
      !Number.isInteger(nativeSharpnessProfile.viewport.height) ||
      !Number.isFinite(nativeSharpnessProfile.viewport.dpr)
    )
      fail('declared native sharpness profile');
  }
  if (nativeSharpnessProfile) settings.nativeSharpnessProfile = nativeSharpnessProfile;
  for (const key of ['resolutionScale', 'msaaSamples'])
    if (!Number.isFinite(settings[key])) fail(`effective ${key}`);
  for (const key of ['antialias', 'fxaa'])
    if (typeof settings[key] !== 'boolean') fail(`effective ${key}`);

  const currentTime = viewer.clock?.currentTime;
  const cesiumClock =
    currentTime &&
    Number.isFinite(currentTime.dayNumber) &&
    Number.isFinite(currentTime.secondsOfDay)
      ? {
          currentTime: {
            dayNumber: currentTime.dayNumber,
            secondsOfDay: currentTime.secondsOfDay,
          },
          shouldAnimate: viewer.clock.shouldAnimate,
          multiplier: viewer.clock.multiplier,
        }
      : null;

  return {
    environment: {
      userAgent: windowObject.navigator?.userAgent || null,
      platform: windowObject.navigator?.platform || null,
      renderer,
      vendor,
      rendererEvidence: {
        source: 'early-cesium-context-creation',
        canvasMatchesScene: true,
        contextMatchesScene: true,
        contextLost: false,
        contextRestored: false,
        parameterQueryCount: rendererProbe.parameterQueryCount,
        queryDurationMs: rendererProbe.queryDurationMs,
        contextAttributes: { ...attributes },
      },
      viewport: {
        width: windowObject.innerWidth,
        height: windowObject.innerHeight,
        dpr: windowObject.devicePixelRatio,
      },
      drawingBuffer: { width: canvas.width, height: canvas.height },
      ...(nativeSharpnessProfile ? { nativeSharpnessProfile } : {}),
      focused: windowObject.document.hasFocus(),
      visible: !windowObject.document.hidden,
      layers,
      totalObjects: layers.reduce(
        (total, layer) => total + (layer.count || 0),
        0,
      ),
      appCommit,
    },
    settings,
    wallClockEpochMs: windowObject.Date.now(),
    cesiumClock,
    camera: {
      position: readVector(viewer.camera.position),
      direction: readVector(viewer.camera.direction),
      up: readVector(viewer.camera.up),
      transform: readMatrix(viewer.camera.transform),
    },
  };
}

/** Convert the current capture callback's measured route into a paired descriptor. */
export function describeObservedRoute({
  scenario,
  start,
  durationMs,
  measurement,
  fixture,
} = {}) {
  const measured = measurement?.cameraPath;
  if (
    !['idle', 'scripted-motion', 'selected-aircraft-tracking'].includes(
      scenario,
    )
  )
    throw new Error(`Unsupported common-scene scenario: ${scenario}`);
  if (!measured?.id || !Number.isFinite(durationMs) || durationMs <= 0)
    throw new Error('Observed route descriptor is incomplete.');
  if (!start?.position || !Array.isArray(start.transform))
    throw new Error('Observed route start pose is incomplete.');
  const motionDistanceM =
    scenario === 'scripted-motion' ? measured.motionDistanceM : 0;
  if (!Number.isFinite(motionDistanceM) || motionDistanceM < 0)
    throw new Error('Observed route distance is unavailable.');
  return {
    id: measured.id,
    start,
    elapsedDurationMs: durationMs,
    motionDistanceM,
    ...(scenario === 'selected-aircraft-tracking'
      ? {
          selectedIdentity: 'flights:000001',
          trajectoryId: `${fixture?.id}:000001`,
        }
      : {}),
  };
}
