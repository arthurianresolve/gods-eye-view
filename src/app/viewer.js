import * as Cesium from 'cesium';
import { applyModelAtmosphereWorkaround } from './atmosphereCompat.js';

const PINCH_ZOOM_MULTIPLIER = 8;
const MAX_PINCH_PIXEL_DELTA = 120;
const DEFAULT_RESOLUTION_HEADROOM = 0.99;

function boundedPinchDelta(delta) {
  if (!Number.isFinite(delta) || delta === 0) return delta;
  return (
    Math.sign(delta) *
    Math.min(Math.abs(delta) * PINCH_ZOOM_MULTIPLIER, MAX_PINCH_PIXEL_DELTA)
  );
}

/**
 * Add browser trackpad pinch to Cesium's zoom inputs and return its disposer.
 * Browsers expose this gesture as a small pixel-mode Ctrl+wheel event.
 */
export function installTrackpadPinchZoom(
  viewer,
  { createWheelEvent = (type, init) => new WheelEvent(type, init) } = {},
) {
  const controller = viewer?.scene?.screenSpaceCameraController;
  const container = viewer?.container;
  const canvas = viewer?.canvas;
  if (!controller || !container || !canvas)
    throw new TypeError('A complete Cesium viewer is required');

  const originalZoomEventTypes = controller.zoomEventTypes;
  const zoomEventTypes = Array.isArray(originalZoomEventTypes)
    ? originalZoomEventTypes
    : originalZoomEventTypes === undefined
      ? []
      : [originalZoomEventTypes];
  const alreadyHandlesControlWheel = zoomEventTypes.some(
    (binding) =>
      binding?.eventType === Cesium.CameraEventType.WHEEL &&
      binding?.modifier === Cesium.KeyboardEventModifier.CTRL,
  );
  const configuredZoomEventTypes = alreadyHandlesControlWheel
    ? originalZoomEventTypes
    : [
        ...zoomEventTypes,
        {
          eventType: Cesium.CameraEventType.WHEEL,
          modifier: Cesium.KeyboardEventModifier.CTRL,
        },
      ];
  if (!alreadyHandlesControlWheel)
    controller.zoomEventTypes = configuredZoomEventTypes;

  const relayedEvents = new WeakSet();
  const relayPinch = (event) => {
    if (
      !event.ctrlKey ||
      relayedEvents.has(event) ||
      event.deltaMode !== 0 ||
      !Number.isFinite(event.deltaY) ||
      event.deltaY === 0
    )
      return;
    let relayed;
    try {
      relayed = createWheelEvent('wheel', {
        deltaX: event.deltaX,
        deltaY: boundedPinchDelta(event.deltaY),
        deltaZ: event.deltaZ,
        deltaMode: event.deltaMode,
        screenX: event.screenX,
        screenY: event.screenY,
        clientX: event.clientX,
        clientY: event.clientY,
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
        view: globalThis.window,
      });
    } catch {
      // The registered Ctrl+wheel binding can still consume the original.
      return;
    }
    relayedEvents.add(relayed);
    event.preventDefault();
    event.stopPropagation();
    canvas.dispatchEvent(relayed);
  };
  container.addEventListener('wheel', relayPinch, {
    capture: true,
    passive: false,
  });

  let active = true;
  return () => {
    if (!active) return;
    active = false;
    container.removeEventListener('wheel', relayPinch, true);
    if (
      !alreadyHandlesControlWheel &&
      controller.zoomEventTypes === configuredZoomEventTypes
    )
      controller.zoomEventTypes = originalZoomEventTypes;
  };
}

/**
 * Keep the Cesium drawing buffer inside the active WebGL texture and
 * renderbuffer limits while retaining the caller's requested quality scale.
 */
export function installResolutionScaleGuard(
  viewer,
  {
    maxTextureSize,
    maxRenderbufferSize,
    ResizeObserverClass = globalThis.ResizeObserver,
    windowTarget = globalThis.window,
    documentTarget = globalThis.document,
    headroom = DEFAULT_RESOLUTION_HEADROOM,
  } = {},
) {
  if (!viewer?.canvas || !viewer?.scene || !viewer?.container)
    throw new TypeError('A complete Cesium viewer is required');

  const gl = viewer.scene.context?._gl;
  const readLimit = (explicit, key) => {
    if (Number.isFinite(explicit) && explicit > 0) return explicit;
    if (!gl || !Number.isFinite(gl[key])) return null;
    try {
      const value = gl.getParameter(gl[key]);
      return Number.isFinite(value) && value > 0 ? value : null;
    } catch {
      return null;
    }
  };
  const textureLimit = readLimit(maxTextureSize, 'MAX_TEXTURE_SIZE');
  const renderbufferLimit = readLimit(
    maxRenderbufferSize,
    'MAX_RENDERBUFFER_SIZE',
  );
  const limit = [textureLimit, renderbufferLimit]
    .filter((value) => value !== null)
    .reduce((minimum, value) => Math.min(minimum, value), Infinity);

  let descriptor;
  for (
    let prototype = Object.getPrototypeOf(viewer);
    prototype && !descriptor;
    prototype = Object.getPrototypeOf(prototype)
  ) {
    descriptor = Object.getOwnPropertyDescriptor(prototype, 'resolutionScale');
  }
  const originalOwnDescriptor = Object.getOwnPropertyDescriptor(
    viewer,
    'resolutionScale',
  );
  const rawGetScale = () =>
    descriptor?.get
      ? descriptor.get.call(viewer)
      : viewer._cesiumWidget?.resolutionScale;
  const rawSetScale = (value) => {
    if (descriptor?.set) descriptor.set.call(viewer, value);
    else if (viewer._cesiumWidget) viewer._cesiumWidget.resolutionScale = value;
  };
  let requestedScale = rawGetScale();
  if (!Number.isFinite(requestedScale) || requestedScale <= 0)
    requestedScale = 1;
  let active = true;

  const apply = () => {
    if (!active || !Number.isFinite(limit)) return;
    const width = Number(viewer.canvas.clientWidth);
    const height = Number(viewer.canvas.clientHeight);
    if (!(width > 0 && height > 0)) return;
    const pixelRatio = viewer.useBrowserRecommendedResolution
      ? 1
      : Math.max(1, Number(windowTarget?.devicePixelRatio) || 1);
    const effectiveScale = boundedResolutionScale({
      width,
      height,
      maxTextureSize: limit,
      requestedScale,
      pixelRatio,
      headroom,
    });
    if (Math.abs(rawGetScale() - effectiveScale) > 1e-4) {
      rawSetScale(effectiveScale);
      viewer.scene.requestRender?.();
    }
  };

  if (descriptor?.get && descriptor?.set) {
    Object.defineProperty(viewer, 'resolutionScale', {
      configurable: true,
      enumerable: descriptor.enumerable,
      get: rawGetScale,
      set(value) {
        const requested = Number(value);
        if (!Number.isFinite(requested) || requested <= 0) {
          rawSetScale(value);
          return;
        }
        requestedScale = requested;
        apply();
      },
    });
  }

  const observer = ResizeObserverClass ? new ResizeObserverClass(apply) : null;
  observer?.observe(viewer.container);
  windowTarget?.addEventListener?.('resize', apply);
  windowTarget?.visualViewport?.addEventListener?.('resize', apply);
  documentTarget?.addEventListener?.('fullscreenchange', apply);
  apply();

  return {
    update: apply,
    destroy() {
      if (!active) return;
      active = false;
      observer?.disconnect();
      windowTarget?.removeEventListener?.('resize', apply);
      windowTarget?.visualViewport?.removeEventListener?.('resize', apply);
      documentTarget?.removeEventListener?.('fullscreenchange', apply);
      if (originalOwnDescriptor)
        Object.defineProperty(viewer, 'resolutionScale', originalOwnDescriptor);
      else delete viewer.resolutionScale;
    },
  };
}

/** Return a positive scale that fits both framebuffer limits. */
export function boundedResolutionScale({
  width,
  height,
  maxTextureSize,
  requestedScale = 1,
  pixelRatio = 1,
  headroom = DEFAULT_RESOLUTION_HEADROOM,
}) {
  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0 ||
    !Number.isFinite(maxTextureSize) ||
    maxTextureSize <= 0 ||
    !Number.isFinite(requestedScale) ||
    requestedScale <= 0 ||
    !Number.isFinite(pixelRatio) ||
    pixelRatio <= 0
  )
    return requestedScale;
  const safety = Number.isFinite(headroom)
    ? Math.min(1, Math.max(0.5, headroom))
    : DEFAULT_RESOLUTION_HEADROOM;
  const cap =
    (maxTextureSize * safety) / (Math.max(width, height) * pixelRatio);
  return Math.min(requestedScale, cap);
}

/** Create the standard globe viewer in caller-owned, visible containers. */
export function createApplicationViewer({ container, creditContainer }) {
  if (!container || !creditContainer)
    throw new TypeError('Viewer and credit containers are required');
  const viewer = new Cesium.Viewer(container, {
    timeline: false,
    animation: false,
    baseLayerPicker: false,
    geocoder: false,
    homeButton: false,
    sceneModePicker: false,
    navigationHelpButton: false,
    fullscreenButton: false,
    vrButton: false,
    selectionIndicator: false,
    infoBox: false,
    baseLayer: false,
    creditContainer,
    msaaSamples: 4,
    // Captures copy pixels from the completed postRender frame. Keeping the
    // browser's drawing buffer alive between frames otherwise adds a sizeable
    // GPU allocation on every viewer.
    contextOptions: { webgl: { preserveDrawingBuffer: false } },
  });
  try {
    viewer.targetFrameRate = 60;
    // Before any tile builds a draw command: Cesium's per-vertex model
    // atmosphere fails to LINK on Apple's Metal backend and kills the
    // render loop. See app/atmosphereCompat.js.
    applyModelAtmosphereWorkaround(viewer.scene);
    viewer.scene.globe.show = false;
    viewer.scene.skyAtmosphere.show = true;
    viewer.scene.skyAtmosphere.atmosphereLightIntensity = 18;
    viewer.scene.skyAtmosphere.saturationShift = -0.12;
    viewer.scene.skyAtmosphere.brightnessShift = -0.08;
    const resolutionGuard = installResolutionScaleGuard(viewer);
    const originalDestroy = viewer.destroy;
    viewer.destroy = function destroyWithResolutionGuard(...args) {
      resolutionGuard.destroy();
      return originalDestroy.apply(this, args);
    };
    return viewer;
  } catch (error) {
    viewer.destroy();
    throw error;
  }
}
