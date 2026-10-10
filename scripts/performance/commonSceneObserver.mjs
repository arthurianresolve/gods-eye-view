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

  const gl =
    scene.context?._originalGLContext ||
    scene.context?._gl ||
    canvas.getContext('webgl2') ||
    canvas.getContext('webgl');
  if (!gl?.getParameter || !gl.getContextAttributes)
    fail('Cesium WebGL context');
  const attributes = gl.getContextAttributes();
  if (!attributes) fail('WebGL context attributes');
  const extension = gl.getExtension('WEBGL_debug_renderer_info');
  const renderer = extension
    ? gl.getParameter(extension.UNMASKED_RENDERER_WEBGL)
    : gl.getParameter(gl.RENDERER);
  const vendor = extension
    ? gl.getParameter(extension.UNMASKED_VENDOR_WEBGL)
    : gl.getParameter(gl.VENDOR);
  if (typeof renderer !== 'string' || !renderer.trim())
    fail('renderer identity');

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
  if (!visualState?.style || !visualState.styleParams)
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
    bloom: style.bloomEnabled,
    bloomIntensity: style.bloomIntensity,
    sharpen: style.sharpenEnabled,
    sharpenIntensity: style.sharpenIntensity,
    style: view?.style ?? visualState.style,
    map: view?.map ?? visualState.map ?? null,
    visualState,
  };
  for (const key of ['resolutionScale', 'msaaSamples'])
    if (!Number.isFinite(settings[key])) fail(`effective ${key}`);
  for (const key of ['antialias', 'fxaa'])
    if (typeof settings[key] !== 'boolean') fail(`effective ${key}`);

  return {
    environment: {
      userAgent: windowObject.navigator?.userAgent || null,
      platform: windowObject.navigator?.platform || null,
      renderer,
      vendor: typeof vendor === 'string' ? vendor : null,
      viewport: {
        width: windowObject.innerWidth,
        height: windowObject.innerHeight,
        dpr: windowObject.devicePixelRatio,
      },
      drawingBuffer: { width: canvas.width, height: canvas.height },
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
