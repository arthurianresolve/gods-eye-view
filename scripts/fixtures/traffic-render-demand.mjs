import * as Cesium from 'cesium';
import 'cesium/Build/Cesium/Widgets/widgets.css';
import { createTrafficLayer } from '../../src/layers/traffic/index.js';
import { captureFreshCesiumFrame } from '../../src/freshFrame.js';
import {
  getRenderGovernorDiagnostics,
  installRenderGovernor,
  uninstallRenderGovernor,
} from '../../src/renderGovernor.js';
import * as render from '../../src/renderGovernor.js';

const FIXTURE_EPOCH = Date.UTC(2026, 9, 11, 12, 0, 0);
const CENTER = { lon: -97.7431, lat: 30.2672 };
const MODE = new URLSearchParams(location.search).get('mode') || 'run';
const APP_COMMIT =
  typeof __GEV_APP_COMMIT__ === 'string' ? __GEV_APP_COMMIT__ : null;
const CASES = [
  'populated',
  'fading-retained-dots',
  'jam-heatlines',
  'high-altitude-clear',
  'return-arrival',
];
let logicalNow = FIXTURE_EPOCH;
let viewer = null;
let layer = null;
let disposed = false;
const sourceCalls = [];
let firstPopulationFrame = null;
let capturesIssued = 0;
let listenerBaseline = null;
let primitiveBaseline = null;
let listenersRemoved = false;
let removeTileVisibleListener = null;
let tileContentVisibleInFrame = [];
let tileContentVisibleOverflow = false;
let latestVisibleTileContent = [];
let latestVisibleTileContentOverflow = false;
let surfacePostRenderFrame = 0;
let report;

function status(message) {
  document.querySelector('#status').textContent = message;
}

function bytesHash(bytes) {
  return crypto.subtle
    .digest('SHA-256', bytes)
    .then((digest) =>
      [...new Uint8Array(digest)]
        .map((byte) => byte.toString(16).padStart(2, '0'))
        .join(''),
    );
}

function toBase64(bytes) {
  let binary = '';
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize)
    binary += String.fromCharCode(
      ...bytes.subarray(offset, offset + chunkSize),
    );
  return btoa(binary);
}

function align4(value) {
  return (value + 3) & ~3;
}

function makeGroundGlb() {
  const positions = new Float32Array([
    -2600, -2600, 0, 2600, -2600, 0, 2600, 2600, 0, -2600, 2600, 0,
  ]);
  const normals = new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]);
  const indices = new Uint16Array([0, 1, 2, 0, 2, 3]);
  const positionBytes = new Uint8Array(positions.buffer);
  const normalBytes = new Uint8Array(normals.buffer);
  const indexBytes = new Uint8Array(indices.buffer);
  const binaryLength =
    align4(positionBytes.length) +
    align4(normalBytes.length) +
    align4(indexBytes.length);
  const binary = new Uint8Array(binaryLength);
  let offset = 0;
  binary.set(positionBytes, offset);
  const positionOffset = offset;
  offset += align4(positionBytes.length);
  binary.set(normalBytes, offset);
  const normalOffset = offset;
  offset += align4(normalBytes.length);
  binary.set(indexBytes, offset);
  const indexOffset = offset;
  const document = {
    asset: { version: '2.0', generator: 'traffic-render-demand-fixture' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0 }],
    meshes: [
      {
        primitives: [
          { attributes: { POSITION: 0, NORMAL: 1 }, indices: 2, material: 0 },
        ],
      },
    ],
    materials: [
      {
        pbrMetallicRoughness: {
          baseColorFactor: [0.42, 0.46, 0.4, 1],
          metallicFactor: 0,
          roughnessFactor: 1,
        },
        doubleSided: true,
      },
    ],
    buffers: [{ byteLength: binaryLength }],
    bufferViews: [
      {
        buffer: 0,
        byteOffset: positionOffset,
        byteLength: positionBytes.length,
        target: 34962,
      },
      {
        buffer: 0,
        byteOffset: normalOffset,
        byteLength: normalBytes.length,
        target: 34962,
      },
      {
        buffer: 0,
        byteOffset: indexOffset,
        byteLength: indexBytes.length,
        target: 34963,
      },
    ],
    accessors: [
      {
        bufferView: 0,
        componentType: 5126,
        count: 4,
        type: 'VEC3',
        min: [-2600, -2600, 0],
        max: [2600, 2600, 0],
      },
      { bufferView: 1, componentType: 5126, count: 4, type: 'VEC3' },
      { bufferView: 2, componentType: 5123, count: 6, type: 'SCALAR' },
    ],
  };
  const json = new TextEncoder().encode(JSON.stringify(document));
  const jsonLength = align4(json.length);
  const total = 12 + 8 + jsonLength + 8 + binary.length;
  const glb = new ArrayBuffer(total);
  const view = new DataView(glb);
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, total, true);
  view.setUint32(12, jsonLength, true);
  view.setUint32(16, 0x4e4f534a, true);
  new Uint8Array(glb, 20, json.length).set(json);
  new Uint8Array(glb, 20 + json.length, jsonLength - json.length).fill(0x20);
  const binHeader = 20 + jsonLength;
  view.setUint32(binHeader, binary.length, true);
  view.setUint32(binHeader + 4, 0x004e4942, true);
  new Uint8Array(glb, binHeader + 8).set(binary);
  return new Uint8Array(glb);
}

async function addFixtureTileset(viewerInstance) {
  const glb = makeGroundGlb();
  const glbBlob = URL.createObjectURL(
    new Blob([glb], { type: 'model/gltf-binary' }),
  );
  let jsonBlob = null;
  let tileset = null;
  let phase = 'create-local-tileset';
  let removePostRender = null;
  let removeLoadProgress = null;
  let removeTileFailed = null;
  let removeRenderError = null;
  let settleTimer = null;
  let inspectFrame = null;
  let readinessSettled = false;
  const diagnosticCleanupErrors = [];
  const loadProgressRecords = [];
  const tileFailureRecords = [];
  const renderErrorRecords = [];
  const readinessReadErrors = [];
  const diagnosticMessage = (error, fallback) =>
    String(error?.message || error || fallback)
      .replace(/(?:https?|blob|data|file):[^\s"'<>]+/gi, '[redacted-url]')
      .slice(0, 240);
  const removeOwned = (remove, owner) => {
    if (typeof remove !== 'function') return;
    try {
      remove();
    } catch (error) {
      diagnosticCleanupErrors.push({
        owner,
        message: diagnosticMessage(error, 'Observer cleanup failed'),
      });
    }
  };
  const cleanupReadiness = () => {
    if (settleTimer !== null) {
      clearTimeout(settleTimer);
      settleTimer = null;
    }
    if (inspectFrame !== null) {
      cancelAnimationFrame(inspectFrame);
      inspectFrame = null;
    }
    removeOwned(removePostRender, 'surface-post-render');
    removePostRender = null;
    removeOwned(removeLoadProgress, 'tileset-load-progress');
    removeLoadProgress = null;
    removeOwned(removeTileFailed, 'tileset-tile-failed');
    removeTileFailed = null;
    removeOwned(removeRenderError, 'scene-render-error');
    removeRenderError = null;
    removeOwned(removeTileVisibleListener, 'tileset-tile-visible');
    removeTileVisibleListener = null;
  };
  const readinessSnapshot = () => ({
    phase,
    tilesetTilesLoaded: readReadinessValue(
      'tileset.tilesLoaded',
      () => tileset?.tilesLoaded,
    ),
    globeTilesLoaded: readReadinessValue(
      'globe.tilesLoaded',
      () => viewerInstance.scene.globe?.tilesLoaded,
    ),
    postRenderFrame: surfacePostRenderFrame,
    latestVisibleTileContent: latestVisibleTileContent.slice(0, 16),
    latestVisibleTileContentOverflow,
    loadProgress: loadProgressRecords.slice(-8),
    tileFailures: tileFailureRecords.slice(-8),
    renderErrors: renderErrorRecords.slice(-8),
    readinessReadErrors: readinessReadErrors.slice(-8),
    observerCleanupErrors: diagnosticCleanupErrors.slice(-8),
  });
  function readReadinessValue(label, read) {
    try {
      const value = read();
      return typeof value === 'boolean' ? value : null;
    } catch (error) {
      readinessReadErrors.push({
        label,
        message: diagnosticMessage(error, 'Readiness getter failed'),
      });
      if (readinessReadErrors.length > 8) readinessReadErrors.shift();
      return null;
    }
  }
  const transform = Cesium.Transforms.eastNorthUpToFixedFrame(
    Cesium.Cartesian3.fromDegrees(CENTER.lon, CENTER.lat, 1.5),
  );
  const tilesetJson = {
    asset: { version: '1.1', gltfUpAxis: 'Z' },
    // This is the error when the entire 5.2 km surface is absent. Zero here
    // tells Cesium it may omit the whole tree, even though the leaf has content.
    // The leaf error below stays zero: its geometry is already full detail.
    geometricError: 5_200,
    root: {
      boundingVolume: { box: [0, 0, 0, 2600, 0, 0, 0, 2600, 0, 0, 0, 5] },
      geometricError: 0,
      refine: 'ADD',
      transform: Array.from(transform),
      content: { uri: glbBlob },
    },
  };
  jsonBlob = URL.createObjectURL(
    new Blob([JSON.stringify(tilesetJson)], { type: 'application/json' }),
  );
  try {
    phase = 'load-tileset-json';
    tileset = await Cesium.Cesium3DTileset.fromUrl(jsonBlob, {
      maximumScreenSpaceError: 1,
      maximumMemoryUsage: 16,
      dynamicScreenSpaceError: false,
    });
    phase = 'add-tileset-to-scene';
    viewerInstance.scene.primitives.add(tileset);
    removeTileVisibleListener = tileset.tileVisible.addEventListener((tile) => {
      const content = tile.content;
      if (tileContentVisibleInFrame.length < 16) {
        tileContentVisibleInFrame.push({
          ready: content?.ready === true,
          type: content?.constructor?.name || null,
          model3DTileContentInstance:
            content instanceof Cesium.Model3DTileContent,
        });
      } else {
        tileContentVisibleOverflow = true;
      }
    });
    removeLoadProgress = tileset.loadProgress.addEventListener(
      (pendingRequests, processing) => {
        loadProgressRecords.push({
          atMonotonicMs: Number(performance.now().toFixed(3)),
          pendingRequests:
            Number.isSafeInteger(pendingRequests) && pendingRequests >= 0
              ? pendingRequests
              : null,
          processing:
            Number.isSafeInteger(processing) && processing >= 0
              ? processing
              : null,
        });
        if (loadProgressRecords.length > 8) loadProgressRecords.shift();
      },
    );
    removeTileFailed = tileset.tileFailed.addEventListener((error) => {
      tileFailureRecords.push({
        atMonotonicMs: Number(performance.now().toFixed(3)),
        name: String(error?.name || 'TileLoadError').slice(0, 80),
        message: diagnosticMessage(error, 'Unknown tile failure'),
      });
      if (tileFailureRecords.length > 8) tileFailureRecords.shift();
    });
    removeRenderError = viewerInstance.scene.renderError?.addEventListener?.(
      (_scene, error) => {
        renderErrorRecords.push({
          atMonotonicMs: Number(performance.now().toFixed(3)),
          name: String(error?.name || 'RenderError').slice(0, 80),
          message: diagnosticMessage(error, 'Unknown render error'),
        });
        if (renderErrorRecords.length > 8) renderErrorRecords.shift();
      },
    );
    phase = 'wait-rendered-content';
    removePostRender = viewerInstance.scene.postRender.addEventListener(() => {
      surfacePostRenderFrame++;
      latestVisibleTileContent = tileContentVisibleInFrame.slice(0, 16);
      latestVisibleTileContentOverflow = tileContentVisibleOverflow;
      tileContentVisibleInFrame = [];
      tileContentVisibleOverflow = false;
    });
    await new Promise((resolve, reject) => {
      const finish = (error = null) => {
        if (readinessSettled) return;
        readinessSettled = true;
        cleanupReadiness();
        if (error) reject(error);
        else if (diagnosticCleanupErrors.length)
          reject(
            new Error(
              'Local fixture readiness listener cleanup failed: ' +
                JSON.stringify(diagnosticCleanupErrors),
            ),
          );
        else resolve();
      };
      const inspect = () => {
        inspectFrame = null;
        try {
          if (
            tileset.tilesLoaded &&
            viewerInstance.scene.globe.tilesLoaded &&
            latestVisibleTileContent.some(
              (content) =>
                content.ready && content.type === 'Model3DTileContent',
            )
          ) {
            finish();
            return;
          }
          inspectFrame = requestAnimationFrame(inspect);
        } catch (error) {
          finish(error);
        }
      };
      try {
        settleTimer = setTimeout(
          () => finish(new Error('Local fixture tiles did not settle')),
          15_000,
        );
        inspectFrame = requestAnimationFrame(inspect);
      } catch (error) {
        finish(error);
      }
    });
    const canonicalTileset = JSON.parse(JSON.stringify(tilesetJson));
    canonicalTileset.root.content.uri = 'generated-glb://traffic-ground-plane';
    report.fixtureSurface = {
      kind: 'generated-local-3d-tiles-1.1-plane',
      glbSha256: await bytesHash(glb),
      tilesetJsonSha256: await bytesHash(
        new TextEncoder().encode(JSON.stringify(canonicalTileset)),
      ),
      glbBytes: glb.byteLength,
      noNetworkSource: true,
      renderedReadyContent: latestVisibleTileContent,
      renderedReadyContentPostRenderFrame: surfacePostRenderFrame,
      renderedReadyContentOverflow: latestVisibleTileContentOverflow,
      contentTransport: 'fixture-owned blob URL',
      assetSource:
        'makeGroundGlb() in this fixture; authored deterministic fixture geometry',
    };
    return { tileset, urls: [glbBlob, jsonBlob] };
  } catch (error) {
    cleanupReadiness();
    report.fixtureSurfaceProgress = readinessSnapshot();
    try {
      URL.revokeObjectURL(glbBlob);
    } catch {}
    if (jsonBlob) {
      try {
        URL.revokeObjectURL(jsonBlob);
      } catch {}
    }
    throw error;
  } finally {
    if (!readinessSettled) cleanupReadiness();
  }
}

function roads() {
  const rows = [];
  const routes = [
    { id: 'jam-east', type: 'primary', level: 0.86, offset: 0 },
    { id: 'slow-north', type: 'trunk', level: 0.56, offset: 0.003 },
    { id: 'free-west', type: 'motorway', level: 0.18, offset: -0.003 },
  ];
  for (const route of routes) {
    const coords = [];
    for (let i = 0; i < 8; i++) {
      const t = (i - 3.5) * 0.004;
      coords.push([
        CENTER.lon + t,
        CENTER.lat + route.offset + (route.id === 'slow-north' ? t * 0.4 : 0),
      ]);
    }
    rows.push({
      id: route.id,
      type: route.type,
      roadClass: route.type,
      coordinates: coords,
      directFlow: true,
      flow: { level: route.level, closure: false },
      oneway: 1,
    });
  }
  return rows;
}

function source() {
  const records = roads();
  return {
    requestRoads: async (_bounds, { signal, majorOnly } = {}) => {
      const request = {
        startedAt: performance.now(),
        aborted: false,
        majorOnly: Boolean(majorOnly),
        resolvedAt: null,
      };
      sourceCalls.push(request);
      signal?.addEventListener(
        'abort',
        () => {
          request.aborted = true;
        },
        { once: true },
      );
      await new Promise((resolve, reject) => {
        const timer = setTimeout(resolve, 140);
        signal?.addEventListener(
          'abort',
          () => {
            clearTimeout(timer);
            reject(signal.reason || new DOMException('Aborted', 'AbortError'));
          },
          { once: true },
        );
      });
      const selected = records.filter(
        (road) =>
          !majorOnly || ['motorway', 'trunk', 'primary'].includes(road.type),
      );
      return {
        ok: true,
        status: 200,
        headers: new Headers(),
        json: async () => {
          request.resolvedAt = performance.now();
          return {
            roads: selected,
            roadSource: 'Deterministic fixture',
            partial: false,
          };
        },
      };
    },
    getStatus: async () => ({ hasKey: true, error: null }),
    fetchFlowForBounds: async () => [],
    getFlowSessionStats: () => ({ tilesFetched: 0 }),
    resetFlowTileCache() {},
    prefetch() {},
  };
}

function services() {
  return {
    credits: {
      showOsmCredit() {},
      hideOsmCredit() {},
      registerDynamicCredit() {},
    },
    ground: { cachedGroundFloor: () => 0 },
    render,
  };
}

function addPostRenderCounter() {
  const frames = [];
  const listener = () => frames.push(performance.now());
  const remove = viewer.scene.postRender.addEventListener(listener);
  return { frames, remove };
}

function readRenderer(gl) {
  const maskedRenderer = gl.getParameter(gl.RENDERER);
  const extension = gl.getExtension('WEBGL_debug_renderer_info');
  return {
    renderer: extension
      ? gl.getParameter(extension.UNMASKED_RENDERER_WEBGL)
      : maskedRenderer,
    maskedRenderer,
  };
}

function projectedSnapshot() {
  const gl = viewer.scene.context._gl;
  const renderer = readRenderer(gl);
  const pixels = [];
  let fadingVisibleDots = 0;
  layer.visitMotionDots((id, roadKey, point) => {
    if (id === null || id === undefined || String(id).length === 0)
      throw new Error('Traffic dot has no stable source identity');
    const screen = Cesium.SceneTransforms.worldToWindowCoordinates(
      viewer.scene,
      point.position,
    );
    if (!screen || !Number.isFinite(screen.x) || !Number.isFinite(screen.y))
      return;
    pixels.push({
      id: String(id),
      roadKey,
      x: Number(screen.x.toFixed(4)),
      y: Number(screen.y.toFixed(4)),
      pixelSize: Number(point.pixelSize.toFixed(6)),
      color: [
        point.color.red,
        point.color.green,
        point.color.blue,
        point.color.alpha,
      ].map((v) => Number(v.toFixed(6))),
    });
    if (pixels.at(-1).pixelSize > 0 && pixels.at(-1).pixelSize < 4)
      fadingVisibleDots++;
  });
  const stats = layer.getStats();
  return {
    stats: {
      count: stats.count,
      heatLines: stats.heatLines,
      fadingVisibleDots,
      flowBuckets: stats.flowBuckets,
      jamViz: stats.jamViz,
      loading: stats.loading,
    },
    dots: pixels,
    camera: {
      position: [
        viewer.camera.position.x,
        viewer.camera.position.y,
        viewer.camera.position.z,
      ].map((v) => Number(v.toFixed(6))),
      direction: [
        viewer.camera.direction.x,
        viewer.camera.direction.y,
        viewer.camera.direction.z,
      ].map((v) => Number(v.toFixed(9))),
    },
    clock: {
      requestedEpochMs: logicalNow,
      currentTimeIso: Cesium.JulianDate.toIso8601(viewer.clock.currentTime),
      shouldAnimate: viewer.clock.shouldAnimate,
    },
    renderSettings: {
      viewport: {
        width: innerWidth,
        height: innerHeight,
        dpr: devicePixelRatio,
      },
      drawingBuffer: {
        width: viewer.scene.canvas.width,
        height: viewer.scene.canvas.height,
      },
      msaaSamples: viewer.scene.msaaSamples,
      contextAttributes: gl.getContextAttributes(),
      renderer: renderer.renderer,
      maskedRenderer: renderer.maskedRenderer,
      vendor: gl.getParameter(gl.VENDOR),
    },
  };
}

async function capture(
  name,
  { retainPixels = false, includeReport = true } = {},
) {
  capturesIssued++;
  status(`Capturing ${name}`);
  const canvas = await captureFreshCesiumFrame(viewer, { timeoutMs: 400 });
  if (!canvas) throw new Error(`Fresh capture timed out: ${name}`);
  const snapshot = projectedSnapshot();
  const pixelContext = retainPixels ? canvas.getContext('2d') : null;
  const rgba = pixelContext
    ? new Uint8ClampedArray(
        pixelContext.getImageData(0, 0, canvas.width, canvas.height).data,
      )
    : null;
  const blob = await new Promise((resolve) =>
    canvas.toBlob(resolve, 'image/png'),
  );
  if (!blob) throw new Error(`PNG encoding failed: ${name}`);
  const image = await blob.arrayBuffer();
  const entry = {
    name,
    width: canvas.width,
    height: canvas.height,
    pngSha256: await bytesHash(image),
    imagePng: `data:image/png;base64,${toBase64(new Uint8Array(image))}`,
    snapshot,
  };
  canvas.width = canvas.height = 0;
  if (name === 'fading-retained-dots' && snapshot.stats.fadingVisibleDots < 1)
    throw new Error('The retained-dot phase did not observe a visible fade');
  if (name === 'jam-heatlines' && snapshot.stats.heatLines < 1)
    throw new Error(
      'The deterministic jam roads did not produce heatline geometry',
    );
  if (name === 'high-altitude-clear' && snapshot.stats.count !== 0)
    throw new Error('The high-altitude phase still contains traffic dots');
  if (name === 'return-arrival' && snapshot.stats.count < 1)
    throw new Error('Traffic did not return after the high-altitude clear');
  if (includeReport) report.captures.push(entry);
  return { ...entry, rgba };
}

function changedPixelCount(left, right) {
  if (left.length !== right.length)
    throw new Error('Canvas readback size changed');
  let changed = 0;
  for (let offset = 0; offset < left.length; offset += 4) {
    if (
      left[offset] !== right[offset] ||
      left[offset + 1] !== right[offset + 1] ||
      left[offset + 2] !== right[offset + 2] ||
      left[offset + 3] !== right[offset + 3]
    )
      changed++;
  }
  return changed;
}

function waitUntil(predicate, timeoutMs, label) {
  return new Promise((resolve, reject) => {
    const start = performance.now();
    const inspect = () => {
      if (predicate()) return resolve();
      if (performance.now() - start > timeoutMs)
        return reject(new Error(`Timed out waiting for ${label}`));
      setTimeout(inspect, 25);
    };
    inspect();
  });
}

function setClock(value) {
  logicalNow = value;
  viewer.clock.currentTime = Cesium.JulianDate.fromDate(new Date(value));
}

function waitForNaturalFrame(predicate, timeoutMs, label) {
  return new Promise((resolve, reject) => {
    let timer = null;
    const remove = viewer.scene.postRender.addEventListener(() => {
      if (predicate()) {
        clearTimeout(timer);
        remove?.();
        resolve(performance.now());
      }
    });
    timer = setTimeout(() => {
      remove?.();
      reject(new Error(`Timed out waiting for a natural frame: ${label}`));
    }, timeoutMs);
  });
}

async function requestActiveFrame(label) {
  const frame = waitForNaturalFrame(() => true, 2_000, label);
  viewer.scene.requestRender();
  await frame;
}

function eventListenerCounts() {
  return {
    preRender: viewer.scene.preRender.numberOfListeners,
    cameraChanged: viewer.camera.changed.numberOfListeners,
    cameraMoveEnd: viewer.camera.moveEnd.numberOfListeners,
    postRender: viewer.scene.postRender.numberOfListeners,
  };
}

async function run() {
  const originalDateNow = Date.now;
  const originalRandom = Math.random;
  let randomState = 0x51f17e;
  Date.now = () => logicalNow;
  Math.random = () => {
    randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0;
    return randomState / 0x1_0000_0000;
  };
  let surfaceUrls = [];
  let primaryError = null;
  try {
    report = {
      schema: 'gev-traffic-render-demand/v1',
      status: 'running',
      mode: MODE,
      appCommit: APP_COMMIT,
      harness: 'scripts/fixtures/traffic-render-demand.mjs',
      expectedCaptures: CASES,
      startedAtMonotonic: performance.now(),
      captures: [],
      phases: [],
      sourceCalls: [],
      cleanup: {},
    };
    viewer = new Cesium.Viewer('viewer', {
      animation: false,
      baseLayerPicker: false,
      geocoder: false,
      homeButton: false,
      infoBox: false,
      navigationHelpButton: false,
      sceneModePicker: false,
      selectionIndicator: false,
      timeline: false,
      fullscreenButton: false,
      vrButton: false,
      baseLayer: false,
      terrainProvider: new Cesium.EllipsoidTerrainProvider(),
      requestRenderMode: true,
      maximumRenderTimeChange: Infinity,
      msaaSamples: 4,
      useDefaultRenderLoop: true,
      contextOptions: {
        webgl: { alpha: false, antialias: true, preserveDrawingBuffer: true },
      },
    });
    viewer.resolutionScale = 1;
    viewer.scene.globe.show = true;
    viewer.scene.skyBox.show = false;
    viewer.scene.skyAtmosphere.show = false;
    viewer.scene.backgroundColor = Cesium.Color.fromCssColorString('#07111d');
    viewer.scene.screenSpaceCameraController.enableCollisionDetection = false;
    viewer.clock.shouldAnimate = false;
    viewer.camera.setView({
      destination: Cesium.Cartesian3.fromDegrees(
        CENTER.lon,
        CENTER.lat,
        12_000,
      ),
      orientation: { heading: 0, pitch: -Math.PI / 2, roll: 0 },
    });
    installRenderGovernor(viewer);
    const tileState = await addFixtureTileset(viewer);
    surfaceUrls = tileState.urls;
    listenerBaseline = eventListenerCounts();
    primitiveBaseline = viewer.scene.primitives.length;
    setClock(FIXTURE_EPOCH);
    layer = createTrafficLayer({ services: services(), source: source() });
    layer.setParams(
      { roadMode: 'tomtom', jamViz: 'heatline', uncoveredRoads: 'hide' },
      { origin: 'user' },
    );
    layer.init(viewer);
    layer.enable(viewer);
    await waitForNaturalFrame(
      () =>
        viewer.scene.globe.tilesLoaded &&
        tileState.tileset.tilesLoaded &&
        latestVisibleTileContent.some(
          (content) => content.ready && content.type === 'Model3DTileContent',
        ),
      15_000,
      'local surface initial render',
    );
    await waitUntil(
      () => !layer.getStats().loading,
      10_000,
      'initial high-altitude idle',
    );

    const idle = addPostRenderCounter();
    const idleStarted = performance.now();
    await new Promise((resolve) => setTimeout(resolve, 10_000));
    const idleEnded = performance.now();
    const idleFrames = idle.frames.filter(
      (time) => time >= idleStarted && time <= idleEnded,
    ).length;
    idle.remove();
    report.phases.push({
      name: 'enabled-empty-high-altitude-idle',
      elapsedMs: idleEnded - idleStarted,
      frames: idleFrames,
      holds: getRenderGovernorDiagnostics().holds || [],
      governorMode: getRenderGovernorDiagnostics().mode,
      requestRenderMode: viewer.scene.requestRenderMode,
    });
    if (MODE === 'candidate') {
      if (idleEnded - idleStarted < 9_999)
        throw new Error('Idle observation was shorter than 10 seconds');
      if (idleFrames > 2)
        throw new Error(
          `Enabled empty traffic rendered ${idleFrames} frames during idle`,
        );
    }

    // Camera entry triggers the real viewport/fetch path. Observe the first
    // populated completed render before any fixture capture can request a frame.
    status('Waiting for asynchronous traffic arrival');
    viewer.camera.setView({
      destination: Cesium.Cartesian3.fromDegrees(CENTER.lon, CENTER.lat, 2_400),
      orientation: { heading: 0, pitch: -Math.PI / 2, roll: 0 },
    });
    const captureCountBeforeArrival = capturesIssued;
    const firstFrameWait = waitForNaturalFrame(
      () => {
        const current = layer.getStats().count;
        if (current > 0 && !firstPopulationFrame) {
          firstPopulationFrame = { at: performance.now(), count: current };
        }
        return Boolean(firstPopulationFrame);
      },
      12_000,
      'first populated render after source resolution',
    );
    await firstFrameWait;
    report.phases.push({
      name: 'arrival-natural-frame',
      firstPopulationFrame,
      sourceResolvedAt: Math.min(
        ...sourceCalls
          .filter((call) => call.resolvedAt !== null)
          .map((call) => call.resolvedAt),
      ),
      captureCountBefore: captureCountBeforeArrival,
      noCaptureWakeBeforeFirstPopulation: capturesIssued === 0,
    });
    if (!Number.isFinite(report.phases.at(-1).sourceResolvedAt))
      throw new Error(
        'Population became visible before the fixture source resolved',
      );
    if (report.phases.at(-1).sourceResolvedAt > firstPopulationFrame.at)
      throw new Error('The first populated frame preceded source resolution');
    if (captureCountBeforeArrival !== 0 || capturesIssued !== 0)
      throw new Error(
        'A screenshot capture requested a frame before arrival was observed',
      );
    await waitUntil(
      () => !layer.getStats().loading,
      10_000,
      'traffic population settled',
    );
    setClock(FIXTURE_EPOCH + 250);
    await requestActiveFrame('populated active snapshot');
    await capture('populated');

    setClock(FIXTURE_EPOCH + 2_000);
    layer.setParams({ densityScale: 0.2 });
    await waitUntil(
      () => !layer.getStats().loading,
      8_000,
      'retention reconciliation',
    );
    setClock(FIXTURE_EPOCH + 2_090);
    await requestActiveFrame('retained fade snapshot');
    await capture('fading-retained-dots');

    setClock(FIXTURE_EPOCH + 2_700);
    const heatlineCapture = await capture('jam-heatlines', {
      retainPixels: true,
    });
    const heatlineParamsBefore = layer.getParams();
    const noHeatlineControlParams = {
      jamViz: 'none',
      densityScale: 0.200000001,
    };
    // jamViz applies on the next road rebuild in both compared revisions.
    // Set it before the density-triggered rebuild, not in the same call.
    layer.setParams({ jamViz: noHeatlineControlParams.jamViz });
    layer.setParams({ densityScale: noHeatlineControlParams.densityScale });
    await requestActiveFrame('heatline disabled control');
    const noHeatlineCapture = await capture('jam-heatlines-disabled-control', {
      retainPixels: true,
      includeReport: false,
    });
    const sameDots =
      JSON.stringify(heatlineCapture.snapshot.dots) ===
      JSON.stringify(noHeatlineCapture.snapshot.dots);
    const changedPixels = changedPixelCount(
      heatlineCapture.rgba,
      noHeatlineCapture.rgba,
    );
    const heatlineStats = { ...heatlineCapture.snapshot.stats };
    const noHeatlineStats = { ...noHeatlineCapture.snapshot.stats };
    delete heatlineStats.heatLines;
    delete heatlineStats.jamViz;
    delete noHeatlineStats.heatLines;
    delete noHeatlineStats.jamViz;
    const restoredParams = {
      jamViz: heatlineParamsBefore.jamViz,
      densityScale: heatlineParamsBefore.densityScale,
    };
    report.heatlineVisualWitness = {
      sameRenderedDots: sameDots,
      heatlinePngSha256: heatlineCapture.pngSha256,
      noHeatlineControlPngSha256: noHeatlineCapture.pngSha256,
      noHeatlineControlImagePng: noHeatlineCapture.imagePng,
      noHeatlineControlSnapshot: noHeatlineCapture.snapshot,
      changedPixels,
      heatlineParamsBefore: {
        jamViz: heatlineParamsBefore.jamViz,
        densityScale: heatlineParamsBefore.densityScale,
      },
      controlParamsRequested: noHeatlineControlParams,
      controlParamsEffective: layer.getParams(),
      restoredParams,
      sameSnapshotStatsExceptHeatlineSettings:
        JSON.stringify(heatlineStats) === JSON.stringify(noHeatlineStats),
    };
    if (
      !sameDots ||
      changedPixels < 1 ||
      noHeatlineCapture.snapshot.stats.heatLines !== 0 ||
      noHeatlineCapture.snapshot.stats.jamViz !== 'none' ||
      report.heatlineVisualWitness.controlParamsEffective.jamViz !== 'none' ||
      report.heatlineVisualWitness.controlParamsEffective.densityScale !==
        Math.max(0.2, Math.min(2.5, noHeatlineControlParams.densityScale)) ||
      !report.heatlineVisualWitness.sameSnapshotStatsExceptHeatlineSettings
    )
      throw new Error(
        'The local tileset did not produce a visible heatline-only pixel difference',
      );
    layer.setParams({ jamViz: restoredParams.jamViz });
    layer.setParams({ densityScale: restoredParams.densityScale });
    await waitUntil(
      () =>
        layer.getStats().heatLines > 0 &&
        layer.getStats().jamViz === restoredParams.jamViz,
      4_000,
      'heatline restoration before clear',
    );
    const effectiveRestoredParams = layer.getParams();
    report.heatlineVisualWitness.effectiveRestoredParams = {
      jamViz: effectiveRestoredParams.jamViz,
      densityScale: effectiveRestoredParams.densityScale,
    };
    if (
      effectiveRestoredParams.jamViz !== restoredParams.jamViz ||
      effectiveRestoredParams.densityScale !== restoredParams.densityScale
    )
      throw new Error(
        'The heatline visual control did not restore its parameters',
      );

    viewer.camera.setView({
      destination: Cesium.Cartesian3.fromDegrees(
        CENTER.lon,
        CENTER.lat,
        12_000,
      ),
      orientation: { heading: 0, pitch: -Math.PI / 2, roll: 0 },
    });
    await waitForNaturalFrame(
      () => layer.getStats().count === 0 && layer.getStats().heatLines === 0,
      8_000,
      'high-altitude clear frame',
    );
    await capture('high-altitude-clear');

    setClock(FIXTURE_EPOCH + 4_000);
    viewer.camera.setView({
      destination: Cesium.Cartesian3.fromDegrees(CENTER.lon, CENTER.lat, 2_400),
      orientation: { heading: 0, pitch: -Math.PI / 2, roll: 0 },
    });
    await waitForNaturalFrame(
      () => layer.getStats().count > 0,
      12_000,
      'return arrival frame',
    );
    await waitUntil(
      () => !layer.getStats().loading,
      8_000,
      'return population settled',
    );
    setClock(FIXTURE_EPOCH + 4_250);
    await requestActiveFrame('return population visible snapshot');
    await capture('return-arrival');

    // Disable/re-enable on the same layer and prove a pending source cannot
    // reacquire rendering after disable; then destroy and build a fresh owner.
    viewer.camera.setView({
      destination: Cesium.Cartesian3.fromDegrees(
        CENTER.lon,
        CENTER.lat,
        12_000,
      ),
      orientation: { heading: 0, pitch: -Math.PI / 2, roll: 0 },
    });
    await waitForNaturalFrame(
      () => layer.getStats().count === 0,
      8_000,
      'pre-disable clear',
    );
    viewer.camera.setView({
      destination: Cesium.Cartesian3.fromDegrees(CENTER.lon, CENTER.lat, 2_400),
      orientation: { heading: 0, pitch: -Math.PI / 2, roll: 0 },
    });
    const sourceCallStart = sourceCalls.length;
    await waitUntil(
      () => sourceCalls.length > sourceCallStart,
      3_000,
      'new pending road request',
    );
    const pendingAtDisable = sourceCalls.at(-1);
    layer.disable(viewer);
    const abortedBefore = pendingAtDisable?.aborted === true;
    await new Promise((resolve) => setTimeout(resolve, 220));
    report.phases.push({
      name: 'disable-pending-request',
      abortedBefore,
      countAfterLateResponse: layer.getStats().count,
      holdsAfterLateResponse: getRenderGovernorDiagnostics().holds || [],
    });
    if (MODE === 'candidate' && !abortedBefore)
      throw new Error(
        'Disabling traffic did not abort the pending fixture request',
      );
    if (layer.getStats().count !== 0)
      throw new Error(
        'A late source response repopulated a disabled traffic layer',
      );
    if ((getRenderGovernorDiagnostics().holds || []).includes('traffic'))
      throw new Error(
        'A disabled traffic layer retained the continuous render hold',
      );
    layer.destroy(viewer);
    layer = null;
    const replacement = createTrafficLayer({
      services: services(),
      source: source(),
    });
    replacement.init(viewer);
    replacement.enable(viewer);
    replacement.disable(viewer);
    replacement.destroy(viewer);
    const listenersAfterDestroy = eventListenerCounts();
    report.phases.push({
      name: 'disable-reinitialize-destroy',
      holds: getRenderGovernorDiagnostics().holds || [],
      primitiveCount: viewer.scene.primitives.length,
      primitiveBaseline,
      listenerBaseline,
      listenersAfterDestroy,
    });
    if ((getRenderGovernorDiagnostics().holds || []).includes('traffic'))
      throw new Error('The destroyed traffic owners left a render hold behind');
    if (
      JSON.stringify(listenerBaseline) !== JSON.stringify(listenersAfterDestroy)
    )
      throw new Error(
        'Traffic layer listeners did not return to their pre-init baseline',
      );
    if (viewer.scene.primitives.length !== primitiveBaseline)
      throw new Error(
        'Traffic primitives did not return to their pre-init baseline',
      );
    listenersRemoved = true;
    report.environment = {
      viewport: {
        width: innerWidth,
        height: innerHeight,
        dpr: devicePixelRatio,
      },
      cesiumVersion: Cesium.VERSION,
      ...readRenderer(viewer.scene.context._gl),
      renderMode: viewer.scene.requestRenderMode,
      msaaSamples: viewer.scene.msaaSamples,
      sourceEpoch: FIXTURE_EPOCH,
      clockShouldAnimate: viewer.clock.shouldAnimate,
    };
    report.sourceCalls = sourceCalls.map(
      ({ startedAt, resolvedAt, aborted, majorOnly }) => ({
        startedAt: Number(startedAt.toFixed(3)),
        resolvedAt: resolvedAt === null ? null : Number(resolvedAt.toFixed(3)),
        aborted,
        majorOnly,
      }),
    );
    report.status = 'passed';
  } catch (error) {
    primaryError = error;
    throw error;
  } finally {
    disposed = true;
    // Restore process-wide fixture overrides even if any owner fails disposal.
    Date.now = originalDateNow;
    Math.random = originalRandom;
    const cleanupErrors = [];
    const clean = (owner, action) => {
      try {
        return action();
      } catch (error) {
        cleanupErrors.push({ owner, message: String(error?.message || error) });
        return false;
      }
    };
    clean('traffic-layer', () => {
      if (layer && viewer) layer.destroy(viewer);
    });
    layer = null;
    for (const url of surfaceUrls)
      clean('surface-url', () => URL.revokeObjectURL(url));
    clean('tile-visible-listener', () => removeTileVisibleListener?.());
    removeTileVisibleListener = null;
    const governorUninstalled = clean('render-governor', () => {
      if (viewer && getRenderGovernorDiagnostics().installed)
        uninstallRenderGovernor(viewer);
      return getRenderGovernorDiagnostics().installed === false;
    });
    const viewerDestroyed = clean('viewer', () => {
      if (viewer && !viewer.isDestroyed()) viewer.destroy();
      return !viewer || viewer.isDestroyed();
    });
    report.cleanup = {
      disposed,
      viewerDestroyed,
      listenersRemoved,
      governorUninstalled,
      errors: cleanupErrors,
    };
    report.sourceCalls = sourceCalls.map(
      ({ startedAt, resolvedAt, aborted, majorOnly }) => ({
        startedAt: Number(startedAt.toFixed(3)),
        resolvedAt: resolvedAt === null ? null : Number(resolvedAt.toFixed(3)),
        aborted,
        majorOnly,
      }),
    );
    report.endedAtMonotonic = performance.now();
    // A disposal failure is a failure, but must never replace the original cause.
    if (!primaryError && cleanupErrors.length)
      throw new Error(
        'Traffic fixture cleanup failed: ' + JSON.stringify(cleanupErrors),
      );
  }
}

run()
  .then(() => {
    document.querySelector('#result').textContent = JSON.stringify(report);
    document.querySelector('#result').style.display = 'block';
    status(
      report.status === 'passed'
        ? 'Traffic fixture complete'
        : 'Traffic fixture failed',
    );
    globalThis.__trafficRenderDemandResult = report;
  })
  .catch((error) => {
    report ||= {
      schema: 'gev-traffic-render-demand/v1',
      mode: MODE,
      captures: [],
      phases: [],
    };
    report.status = 'failed';
    report.error = {
      name: error?.name || 'Error',
      message: String(error?.message || error),
    };
    report.endedAtMonotonic = performance.now();
    document.querySelector('#result').textContent = JSON.stringify(report);
    document.querySelector('#result').style.display = 'block';
    status('Traffic fixture failed');
    globalThis.__trafficRenderDemandResult = report;
  });
