import { createHash } from 'node:crypto';

const SHA1 = /^[a-f0-9]{40}$/i;
const FIXTURE_ID = 'qa-cctv-lifecycle-v1';
export const CCTV_RESOURCE_DIAGNOSTICS_SCHEMA =
  'gev-cctv-resource-diagnostics/entities-v1';
const LEGACY_CCTV_RESOURCE_DIAGNOSTICS_SCHEMA =
  'legacy-cctv-diagnostics/dataSources-alias-entities-v1';
const FIXTURE_CAMERA_ID = 'qa-cctv-lifecycle-camera-001';
const FIXTURE_VIEW = Object.freeze({
  longitude: -97.7431,
  latitude: 30.2672,
  heightM: 25_000,
  headingRadians: 0,
  pitchRadians: -1.2,
  rollRadians: 0,
  autoHop: false,
});

export function parseCctvLifecycleArgs(args = []) {
  const options = {
    url: 'http://localhost:4174',
    cycles: 5,
    drainMs: 10_000,
    out: null,
    expectedCommit: null,
  };
  const keys = new Map([
    ['--url', 'url'],
    ['--cycles', 'cycles'],
    ['--drain-ms', 'drainMs'],
    ['--out', 'out'],
    ['--expected-commit', 'expectedCommit'],
  ]);
  for (let index = 0; index < args.length; index++) {
    const flag = args[index];
    const key = keys.get(flag);
    if (!key || index + 1 >= args.length || args[index + 1].startsWith('--'))
      throw new TypeError(`Invalid CCTV lifecycle argument: ${flag}`);
    const value = args[++index];
    if (key === 'cycles' || key === 'drainMs') {
      const parsed = Number(value);
      if (!Number.isSafeInteger(parsed))
        throw new TypeError(`${flag} must be an integer.`);
      options[key] = parsed;
    } else options[key] = value;
  }
  const url = new URL(options.url);
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== '/'
  )
    throw new TypeError(
      '--url must be an HTTP(S) origin without credentials, path, query, or fragment.',
    );
  if (options.cycles < 1 || options.cycles > 10)
    throw new RangeError('--cycles must be between 1 and 10.');
  if (options.drainMs < 1 || options.drainMs > 10_000)
    throw new RangeError('--drain-ms must be between 1 and 10000.');
  if (options.out !== null && (!options.out || options.out.length > 1024))
    throw new TypeError('--out must be a nonempty bounded path.');
  if (options.expectedCommit !== null && !SHA1.test(options.expectedCommit))
    throw new TypeError('--expected-commit must be a full Git SHA.');
  return Object.freeze(options);
}

export function createCctvLifecycleFixture() {
  const framePngBase64 =
    'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEUlEQVQImWNQ7rnzH4QZYAwAVbIKKdmcsa8AAAAASUVORK5CYII=';
  const clockPolicy = 'native-wall-clock; fixed source payload and frame bytes';
  const sources = [
    {
      id: FIXTURE_CAMERA_ID,
      name: 'Lifecycle fixture camera',
      city: 'Austin',
      cityId: 'austin',
      lat: 30.2672,
      lon: -97.7431,
      headingDeg: 0,
      fovDeg: 70,
      rangeM: 700,
      mountHeightM: 22,
      pitchDeg: -17,
      feedType: 'image',
      provider: 'Synthetic QA fixture',
      sourceKind: 'synthetic',
      url: 'https://fixture.invalid/camera.jpg',
    },
  ];
  const payload = {
    id: FIXTURE_ID,
    sources,
    health: [],
    frameSha256: createHash('sha256')
      .update(Buffer.from(framePngBase64, 'base64'))
      .digest('hex'),
    clockPolicy,
    view: FIXTURE_VIEW,
  };
  const sha256 = createHash('sha256')
    .update(JSON.stringify(payload))
    .digest('hex');
  return Object.freeze({
    ...payload,
    sha256,
    cameraId: FIXTURE_CAMERA_ID,
    framePngBase64,
  });
}

/** Finite share state suppresses the app's unrelated startup Austin flight. */
export function cctvLifecycleShareHash(view = FIXTURE_VIEW) {
  return `#${new URLSearchParams({
    lat: String(view.latitude),
    lon: String(view.longitude),
  })}`;
}

/** Apply one public Cesium view after the incoming share state has settled. */
export async function configureCctvLifecycleSceneInPage(view) {
  const debug = window.__godsEyeView;
  const initialRestore = debug?.styleManager?.initialRestorePromise;
  if (!initialRestore || typeof initialRestore.then !== 'function')
    throw new Error('CCTV fixture share-state restoration is unavailable.');
  await initialRestore;
  const manager = debug?.dataManager;
  const viewer = debug?.viewer;
  const ellipsoid = viewer?.scene?.globe?.ellipsoid;
  if (
    !manager?.setLayerParams ||
    !viewer?.camera?.setView ||
    !ellipsoid?.cartographicToCartesian
  )
    throw new Error('CCTV lifecycle scene configuration APIs are unavailable.');
  const result = manager.setLayerParams(
    'cctv',
    { autoHop: false },
    { origin: 'qa-cctv-lifecycle' },
  );
  if (
    result !== true ||
    debug.dataManager.layers.get('cctv')?.module?.getUIState?.()?.autoHop !==
      false
  )
    throw new Error('CCTV fixture auto-hop could not be disabled.');
  const destination = ellipsoid.cartographicToCartesian({
    longitude: (view.longitude * Math.PI) / 180,
    latitude: (view.latitude * Math.PI) / 180,
    height: view.heightM,
  });
  viewer.camera.setView({
    destination,
    orientation: {
      heading: view.headingRadians,
      pitch: view.pitchRadians,
      roll: view.rollRadians,
    },
  });
  return { ...view, applied: true };
}

/** Serialized page callback: returns only bounded CCTV/scene ownership data. */
export function readCctvLifecycleCheckpointInPage({
  includeRenderer = false,
  fixtureView = null,
} = {}) {
  const debug = window.__godsEyeView;
  const entry = debug?.dataManager?.layers?.get('cctv');
  const module = entry?.module;
  const viewer = debug?.viewer;
  const scene = viewer?.scene;
  if (!debug || !entry || !module || !viewer || !scene)
    throw new Error('CCTV lifecycle app owner is unavailable.');
  const stats = module.getStats?.() || null;
  const ui = module.getUIState?.() || null;
  const diagnostics = module.getPerformanceDiagnostics?.() || null;
  const worker = window.__gevSoakWorkers?.snapshot?.() || null;
  const cameras = Array.isArray(ui?.cameras) ? ui.cameras : [];
  const gl = scene.context?._originalGLContext || scene.context?._gl || null;
  let renderer = null;
  let vendor = null;
  let contextAttributes = null;
  if (includeRenderer && gl) {
    contextAttributes = gl.getContextAttributes?.() || null;
    try {
      const ext = gl.getExtension?.('WEBGL_debug_renderer_info');
      if (ext) {
        renderer = String(
          gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) || '',
        ).slice(0, 160);
        vendor = String(gl.getParameter(ext.UNMASKED_VENDOR_WEBGL) || '').slice(
          0,
          120,
        );
      }
    } catch {}
  }
  let cameraView = null;
  let cameraPose = null;
  if (fixtureView) {
    try {
      const rectangle = viewer.camera.computeViewRectangle(
        scene.globe.ellipsoid,
      );
      if (rectangle) {
        const west = (rectangle.west * 180) / Math.PI;
        const east = (rectangle.east * 180) / Math.PI;
        const south = (rectangle.south * 180) / Math.PI;
        const north = (rectangle.north * 180) / Math.PI;
        const longitudeInside =
          west <= east
            ? fixtureView.longitude >= west && fixtureView.longitude <= east
            : fixtureView.longitude >= west || fixtureView.longitude <= east;
        cameraView = {
          west,
          east,
          south,
          north,
          containsFixture:
            longitudeInside &&
            fixtureView.latitude >= south &&
            fixtureView.latitude <= north,
        };
      }
    } catch {}
    try {
      const cartographic = scene.globe.ellipsoid.cartesianToCartographic(
        viewer.camera.positionWC,
      );
      if (cartographic) {
        cameraPose = {
          longitude: (cartographic.longitude * 180) / Math.PI,
          latitude: (cartographic.latitude * 180) / Math.PI,
          heightM: cartographic.height,
          headingRadians: viewer.camera.heading,
          pitchRadians: viewer.camera.pitch,
          rollRadians: viewer.camera.roll,
        };
      }
    } catch {}
  }
  return {
    appCommit: debug.getPerformanceEnvironment?.()?.appCommit || null,
    enabled: debug.dataManager.isEnabled('cctv'),
    lifecycleState: debug.dataManager.getLayerLifecycleState?.('cctv') || null,
    moduleEnabled: ui?.enabled ?? null,
    stats: stats && {
      count: stats.count,
      loading: stats.loading,
      loadingLoaded: stats.loadingLoaded,
      loadingTotal: stats.loadingTotal,
      error: stats.error ? String(stats.error).slice(0, 180) : null,
    },
    cameras: cameras.slice(0, 16).map((camera) => ({
      id: String(camera?.id || '').slice(0, 100),
      active: Boolean(camera?.active),
    })),
    cameraCount: cameras.length,
    activeCameraId:
      typeof ui?.activeCameraId === 'string' ? ui.activeCameraId : null,
    diagnostics,
    scene: {
      entities: viewer.entities?.values?.length ?? null,
      dataSources: viewer.dataSources?.length ?? null,
      primitives: scene.primitives?.length ?? null,
      groundPrimitives: scene.groundPrimitives?.length ?? null,
    },
    worker: worker && {
      instrumented: worker.instrumented === true,
      overflow: worker.overflow === true,
      pending: worker.pending,
      workerCount: Array.isArray(worker.workers) ? worker.workers.length : null,
      workersTruncated: worker.overflow === true,
      workers: Array.isArray(worker.workers)
        ? worker.workers.slice(0, 64).map((item) => ({
            kind: String(item?.kind || 'unknown').slice(0, 80),
            submitted: item?.submitted,
            completed: item?.completed,
            cancelled: item?.cancelled,
            pending: item?.pending,
            taskErrors: item?.taskErrors,
            workerErrors: item?.workerErrors,
            postErrors: item?.postErrors,
            terminated: item?.terminated === true,
            oldestPendingMs: item?.oldestPendingMs,
          }))
        : null,
    },
    renderer: {
      classification: /swiftshader/i.test(renderer || '')
        ? 'software'
        : renderer
          ? 'other'
          : 'unavailable',
      name: renderer,
      vendor,
      contextAttributes,
    },
    cameraView,
    cameraPose,
    canvas: (() => {
      const rect = scene.canvas?.getBoundingClientRect?.();
      return rect
        ? {
            width: scene.canvas.width,
            height: scene.canvas.height,
            cssWidth: rect.width,
            cssHeight: rect.height,
          }
        : null;
    })(),
  };
}

/** Serialized completed-render waiter; it requests through the app governor. */
export async function waitForCctvLifecycleRenderInPage(timeoutMs = 5000) {
  const debug = window.__godsEyeView;
  const scene = debug?.viewer?.scene;
  if (!scene?.postRender?.addEventListener)
    throw new Error('CCTV lifecycle scene render event is unavailable.');
  let timer;
  let listener;
  try {
    return await new Promise((resolve, reject) => {
      listener = () =>
        resolve({
          frameNumber: Number.isSafeInteger(scene.frameState?.frameNumber)
            ? scene.frameState.frameNumber
            : null,
          elapsedMs: performance.now(),
        });
      scene.postRender.addEventListener(listener);
      timer = setTimeout(
        () => reject(new Error('CCTV completed render deadline exceeded.')),
        timeoutMs,
      );
      scene.requestRender();
    });
  } finally {
    clearTimeout(timer);
    if (listener) scene.postRender.removeEventListener(listener);
  }
}

/** Serialized browser-side operation. It uses the supported data-manager API. */
export async function setCctvLifecycleEnabledInPage(enabled) {
  if (typeof enabled !== 'boolean')
    throw new TypeError('CCTV enabled state is invalid.');
  const manager = window.__godsEyeView?.dataManager;
  if (!manager?.setEnabled)
    throw new Error('CCTV lifecycle manager API is unavailable.');
  const result = await manager.setEnabled('cctv', enabled, {
    origin: 'qa-cctv-lifecycle',
  });
  if (result === false || manager.isEnabled('cctv') !== enabled)
    throw new Error(`CCTV manager did not settle enabled=${enabled}.`);
  return true;
}

/**
 * Fixture-only boundary for one real Cesium createGeometry worker response.
 * The native worker computes and posts the untouched result; the boundary
 * pauses delivery on the main thread before worker diagnostics and Cesium's
 * normal response handler, then re-dispatches that same data after revision B
 * has been applied. No worker is terminated and no result payload is changed.
 * @param {Window} scope Browser window.
 * @param {(scope: Window) => void} installDiagnostics Existing worker observer.
 */
export function installCctvGeometryWorkerBoundaryInPage(
  scope,
  installDiagnostics,
) {
  if (!scope || typeof installDiagnostics !== 'function')
    throw new TypeError('CCTV geometry boundary installer is unavailable.');
  const NativeWorker = scope.Worker;
  if (typeof NativeWorker !== 'function')
    throw new Error('Native Worker is unavailable for the CCTV fixture.');

  const listeners = [];
  let instrumentedWorker = null;
  let disposed = false;
  const gate = {
    status: 'installed',
    armedAtMs: null,
    heldAtMs: null,
    releasedAtMs: null,
    taskId: null,
    workerKind: null,
    workerOrdinal: null,
    workerSubmittedAfterArm: null,
    workerSubmissionsWhileHeld: 0,
    pendingAtHold: null,
    submittedAtArm: null,
    held: null,
    overflow: false,
    boundaryDisabled: false,
    nativeWorkerConstructorRestored: false,
    diagnosticWorkerConstructorRetained: false,
    listenersReleased: false,
    heldPayloadReleased: false,
    releaseError: null,
    listenerCleanupErrors: 0,
    arm() {
      if (disposed || !['installed', 'released'].includes(this.status))
        throw new Error('CCTV geometry boundary cannot be armed.');
      const current = scope.__gevSoakWorkers?.snapshot?.();
      if (
        !current ||
        current.instrumented !== true ||
        current.overflow !== false ||
        current.pending !== 0 ||
        !Array.isArray(current.workers) ||
        current.workers.length > 64 ||
        current.workers.some((worker) =>
          [
            worker.submitted,
            worker.completed,
            worker.cancelled,
            worker.pending,
            worker.taskErrors,
            worker.workerErrors,
            worker.postErrors,
          ].some((value) => !Number.isSafeInteger(value) || value < 0),
        )
      )
        throw new Error('CCTV geometry boundary requires settled workers.');
      for (const { worker } of listeners)
        worker.__cctvSubmittedAfterArm?.clear?.();
      this.heldAtMs = null;
      this.releasedAtMs = null;
      this.taskId = null;
      this.workerKind = null;
      this.workerOrdinal = null;
      this.workerSubmittedAfterArm = null;
      this.workerSubmissionsWhileHeld = 0;
      this.pendingAtHold = null;
      this.held = null;
      this.overflow = false;
      this.submittedAtArm = current.workers
        .filter((worker) => worker.kind === 'createGeometry.js')
        .reduce((sum, worker) => sum + worker.submitted, 0);
      this.armedAtMs = scope.performance.now();
      this.status = 'armed';
      return this.snapshot();
    },
    snapshot() {
      return {
        status: this.status,
        armedAtMs: this.armedAtMs,
        heldAtMs: this.heldAtMs,
        releasedAtMs: this.releasedAtMs,
        taskId: this.taskId,
        workerKind: this.workerKind,
        workerOrdinal: this.workerOrdinal,
        workerSubmittedAfterArm: this.workerSubmittedAfterArm,
        workerSubmissionsWhileHeld: this.workerSubmissionsWhileHeld,
        pendingAtHold: this.pendingAtHold,
        submittedAtArm: this.submittedAtArm,
        overflow: this.overflow,
        disposed,
        boundaryDisabled: this.boundaryDisabled,
        nativeWorkerConstructorRestored: this.nativeWorkerConstructorRestored,
        diagnosticWorkerConstructorRetained:
          this.diagnosticWorkerConstructorRetained,
        listenersReleased: this.listenersReleased,
        heldPayloadReleased: this.heldPayloadReleased,
        disposedWithHeldResult: this.disposedWithHeldResult ?? false,
        releaseError: this.releaseError,
        listenerCleanupErrors: this.listenerCleanupErrors,
      };
    },
    release() {
      if (!this.held) return false;
      const held = this.held;
      this.held = null;
      this.releasedAtMs = scope.performance.now();
      this.status = 'released';
      // Reuse the worker's exact structured-clone result object. This event
      // only resumes ordinary main-thread delivery after revision B is set.
      try {
        const event = new scope.MessageEvent('message', {
          data: held.data,
          origin: held.origin,
          lastEventId: held.lastEventId,
          ports: held.ports,
        });
        held.worker.dispatchEvent(event);
      } catch (error) {
        this.releaseError = String(error?.message || error).slice(0, 160);
        throw error;
      } finally {
        held.worker.__cctvSubmittedAfterArm?.delete?.(held.taskId);
      }
      return true;
    },
    dispose() {
      if (disposed) return this.snapshot();
      let releasedOnDispose = false;
      try {
        releasedOnDispose = this.release();
      } catch {}
      const cleanupRows = listeners.splice(0);
      for (const { worker, listener, diagnosticPostMessage } of cleanupRows) {
        try {
          worker.removeEventListener('message', listener);
        } catch {
          this.listenerCleanupErrors = Math.min(
            64,
            this.listenerCleanupErrors + 1,
          );
        }
        try {
          worker.__cctvSubmittedAfterArm?.clear?.();
          delete worker.__cctvSubmittedAfterArm;
          delete worker.__cctvWorkerKind;
          delete worker.__cctvPostMessage;
          if (typeof diagnosticPostMessage === 'function')
            Object.defineProperty(worker, 'postMessage', {
              configurable: true,
              enumerable: true,
              writable: true,
              value: diagnosticPostMessage,
            });
        } catch {
          this.listenerCleanupErrors = Math.min(
            64,
            this.listenerCleanupErrors + 1,
          );
        }
      }
      if (this.status === 'held') this.status = 'disposed';
      else if (releasedOnDispose) this.status = 'released-during-dispose';
      else if (this.status === 'installed' || this.status === 'armed')
        this.status = 'disposed';
      this.nativeWorkerConstructorRestored = scope.Worker === NativeWorker;
      this.diagnosticWorkerConstructorRetained =
        !!instrumentedWorker && scope.Worker === instrumentedWorker;
      this.boundaryDisabled = true;
      this.listenersReleased = this.listenerCleanupErrors === 0;
      this.heldPayloadReleased = this.held === null;
      scope.__qaCctvGeometryBoundary = null;
      disposed = true;
      this.disposedWithHeldResult = releasedOnDispose;
      return this.snapshot();
    },
  };

  class CctvBoundaryWorker extends NativeWorker {
    constructor(url, options) {
      super(url, options);
      if (disposed) return;
      if (listeners.length >= 64) {
        gate.overflow = true;
        return;
      }
      const name = String(url).split(/[?#]/)[0].split('/').at(-1);
      const workerOrdinal = listeners.length;
      this.__cctvWorkerKind = name;
      this.__cctvSubmittedAfterArm = new Set();
      const listener = (event) => {
        if (
          gate.status !== 'armed' ||
          gate.held ||
          name !== 'createGeometry.js'
        )
          return;
        if (
          !Number.isSafeInteger(event.data?.id) ||
          !this.__cctvSubmittedAfterArm.has(event.data.id)
        ) {
          gate.overflow = true;
          return;
        }
        const current = scope.__gevSoakWorkers?.snapshot?.();
        if (
          current?.overflow !== false ||
          !Number.isSafeInteger(current?.pending) ||
          current.pending < 1
        ) {
          gate.overflow = true;
          return;
        }
        gate.held = {
          worker: this,
          data: event.data,
          taskId: event.data.id,
          origin: event.origin,
          lastEventId: event.lastEventId,
          ports: event.ports,
        };
        gate.status = 'held';
        gate.heldAtMs = scope.performance.now();
        gate.taskId = event.data.id;
        gate.workerKind = name;
        gate.workerOrdinal = workerOrdinal;
        gate.pendingAtHold = current.pending;
        gate.workerSubmittedAfterArm = this.__cctvSubmittedAfterArm.size;
        event.stopImmediatePropagation();
      };
      this.addEventListener('message', listener);
      listeners.push({ worker: this, listener, diagnosticPostMessage: null });
    }

    get postMessage() {
      return this.__cctvPostMessage || NativeWorker.prototype.postMessage;
    }

    set postMessage(diagnosticPostMessage) {
      const row = listeners.find((entry) => entry.worker === this);
      if (row) row.diagnosticPostMessage = diagnosticPostMessage;
      this.__cctvPostMessage = function (...args) {
        const taskId = args[0]?.id;
        if (
          gate.status === 'armed' &&
          this.__cctvWorkerKind === 'createGeometry.js' &&
          Number.isSafeInteger(taskId)
        ) {
          if (this.__cctvSubmittedAfterArm.size >= 1024) {
            gate.overflow = true;
          } else {
            this.__cctvSubmittedAfterArm.add(taskId);
          }
        } else if (
          gate.status === 'held' &&
          this.__cctvWorkerKind === 'createGeometry.js' &&
          Number.isSafeInteger(taskId)
        ) {
          gate.workerSubmissionsWhileHeld = Math.min(
            1024,
            gate.workerSubmissionsWhileHeld + 1,
          );
        }
        return diagnosticPostMessage.apply(this, args);
      };
    }
  }

  try {
    scope.Worker = CctvBoundaryWorker;
    installDiagnostics(scope);
    instrumentedWorker = scope.Worker;
    scope.__qaCctvGeometryBoundary = gate;
  } catch (error) {
    scope.Worker = NativeWorker;
    for (const { worker, listener, diagnosticPostMessage } of listeners) {
      try {
        worker.removeEventListener('message', listener);
      } catch {}
      try {
        delete worker.__cctvSubmittedAfterArm;
        delete worker.__cctvWorkerKind;
        delete worker.__cctvPostMessage;
        if (typeof diagnosticPostMessage === 'function')
          Object.defineProperty(worker, 'postMessage', {
            configurable: true,
            enumerable: true,
            writable: true,
            value: diagnosticPostMessage,
          });
      } catch {}
    }
    throw error;
  }
  return gate.snapshot();
}

/** Build a self-contained callback for Puppeteer's evaluateOnNewDocument. */
export function createCctvGeometryWorkerBoundaryInstaller(installDiagnostics) {
  if (typeof installDiagnostics !== 'function')
    throw new TypeError('Worker diagnostics installer is unavailable.');
  const source = `return function installCctvWorkerBoundaryAndDiagnostics() {
    const installDiagnostics = (${installDiagnostics.toString()});
    (${installCctvGeometryWorkerBoundaryInPage.toString()})(window, installDiagnostics);
  };`;
  return new Function(source)();
}

/** Read only the bounded test gate and public aggregate worker counters. */
export function readCctvGeometryWorkerBoundaryInPage() {
  const boundary = window.__qaCctvGeometryBoundary;
  const workerDiagnostics = window.__gevSoakWorkers?.snapshot?.();
  if (!boundary || !workerDiagnostics)
    throw new Error('CCTV geometry worker boundary is unavailable.');
  return {
    boundary: boundary.snapshot(),
    worker: workerDiagnostics,
  };
}

/** Apply one public calibration patch without reaching into layer internals. */
export function applyCctvLifecycleCalibrationInPage({ cameraId, patch }) {
  const module = window.__godsEyeView?.dataManager?.layers?.get('cctv')?.module;
  if (!module?.setParams || typeof cameraId !== 'string' || !patch)
    throw new Error('CCTV calibration fixture API is unavailable.');
  module.setParams({ calibration: { cameraId, patch } });
  const camera = module
    .getUIState?.()
    ?.cameras?.find((item) => item.id === cameraId);
  if (!camera) throw new Error('CCTV calibration fixture camera is missing.');
  return {
    rangeM: camera.rangeM,
    calibration: camera.calibration,
    groundPriorM: camera.groundPriorM,
  };
}

/** Capture actual public Entity positions and canvas pixels for race comparison. */
export async function readCctvGeometryEvidenceInPage(
  cameraId,
  expectedVisible = true,
) {
  const timeoutMs = 5000;
  const debug = window.__godsEyeView;
  const viewer = debug?.viewer;
  const module = debug?.dataManager?.layers?.get('cctv')?.module;
  const camera = module
    ?.getUIState?.()
    ?.cameras?.find((item) => item.id === cameraId);
  if (
    !viewer?.scene ||
    !viewer.clock?.currentTime ||
    !camera ||
    typeof module?._extractPickedCameraIdForTest !== 'function'
  )
    throw new Error('CCTV geometry evidence owner is unavailable.');
  const scene = viewer.scene;
  let listener;
  let timer;
  try {
    return await new Promise((resolve, reject) => {
      listener = () => {
        try {
          const time = viewer.clock.currentTime;
          const roles = ['ray-tl', 'ray-tr', 'ray-br', 'ray-bl', 'cap'];
          const entities = roles.map((role) => {
            const entity = viewer.entities.getById(`cctv-${cameraId}-${role}`);
            const value = entity?.polyline?.positions?.getValue?.(time);
            if (!entity || !Array.isArray(value) || value.length < 2)
              throw new Error(`CCTV ${role} Entity positions are unavailable.`);
            return {
              id: entity.id,
              show:
                entity.show !== false &&
                entity.polyline.show?.getValue?.(time) !== false,
              width: entity.polyline.width?.getValue?.(time) ?? null,
              material:
                entity.polyline.material?.color
                  ?.getValue?.(time)
                  ?.toCssColorString?.() || null,
              positions: value.map(({ x, y, z }) => [x, y, z]),
            };
          });
          const canvas = scene.canvas;
          const rect = canvas.getBoundingClientRect();
          const picks = entities.map((entity) => {
            const points = entity.positions;
            const middle = points[Math.floor(points.length / 2)];
            const world = { x: middle[0], y: middle[1], z: middle[2] };
            const position = scene.cartesianToCanvasCoordinates(world);
            if (
              !position ||
              !Number.isFinite(position.x) ||
              !Number.isFinite(position.y)
            )
              return {
                entityId: entity.id,
                pickedEntityId: null,
                pickedCameraId: null,
              };
            const picked = scene.pick(position);
            const pickedId = picked?.id?.id ?? picked?.id ?? null;
            return {
              entityId: entity.id,
              pickedEntityId: typeof pickedId === 'string' ? pickedId : null,
              pickedCameraId: module._extractPickedCameraIdForTest(picked),
            };
          });
          resolve({
            expectedVisible,
            camera: {
              id: camera.id,
              lat: camera.lat,
              lon: camera.lon,
              headingDeg: camera.headingDeg,
              pitchDeg: camera.pitchDeg,
              fovDeg: camera.fovDeg,
              rangeM: camera.rangeM,
              mountHeightM: camera.mountHeightM,
              calibration: camera.calibration,
            },
            frameNumber: Number.isSafeInteger(scene.frameState?.frameNumber)
              ? scene.frameState.frameNumber
              : null,
            canvas: {
              width: canvas.width,
              height: canvas.height,
              cssWidth: rect.width,
              cssHeight: rect.height,
              png: canvas.toDataURL('image/png'),
            },
            entities,
            picks,
          });
        } catch (error) {
          reject(error);
        }
      };
      scene.postRender.addEventListener(listener);
      timer = setTimeout(
        () =>
          reject(new Error('CCTV fresh geometry capture deadline exceeded.')),
        timeoutMs,
      );
      scene.requestRender();
    });
  } finally {
    clearTimeout(timer);
    if (listener) scene.postRender.removeEventListener(listener);
  }
}

/** Reduce a fresh-render sample to bounded pixel, geometry and pick evidence. */
export function summarizeCctvGeometryEvidence(evidence) {
  const ids = ['ray-tl', 'ray-tr', 'ray-br', 'ray-bl', 'cap'].map(
    (role) => `cctv-${FIXTURE_CAMERA_ID}-${role}`,
  );
  // The active projection plane overlaps the cap and is also a legitimate
  // selectable surface. Validate its real owner, not just the ID spelling.
  const pickIds = [...ids, `cctv-${FIXTURE_CAMERA_ID}-plane`];
  if (
    evidence?.camera?.id !== FIXTURE_CAMERA_ID ||
    typeof evidence.expectedVisible !== 'boolean' ||
    !Number.isSafeInteger(evidence.frameNumber) ||
    evidence.frameNumber < 1 ||
    !Number.isSafeInteger(evidence.canvas?.width) ||
    evidence.canvas.width < 1 ||
    !Number.isSafeInteger(evidence.canvas?.height) ||
    evidence.canvas.height < 1 ||
    !Number.isFinite(evidence.canvas?.cssWidth) ||
    evidence.canvas.cssWidth < 1 ||
    !Number.isFinite(evidence.canvas?.cssHeight) ||
    evidence.canvas.cssHeight < 1 ||
    !/^data:image\/png;base64,[A-Za-z0-9+/]+=*$/.test(
      evidence.canvas.png || '',
    ) ||
    !Array.isArray(evidence.entities) ||
    evidence.entities.length !== ids.length ||
    !Array.isArray(evidence.picks) ||
    evidence.picks.length !== ids.length
  )
    throw new Error('CCTV rapid geometry evidence is incomplete.');
  const entities = evidence.entities.map((entity, index) => {
    if (
      entity?.id !== ids[index] ||
      typeof entity.show !== 'boolean' ||
      !Number.isFinite(entity.width) ||
      entity.width <= 0 ||
      typeof entity.material !== 'string' ||
      !Array.isArray(entity.positions) ||
      entity.positions.length < 2 ||
      entity.positions.some(
        (position) =>
          !Array.isArray(position) ||
          position.length !== 3 ||
          !position.every(Number.isFinite),
      )
    )
      throw new Error('CCTV rapid geometry Entity evidence is invalid.');
    return {
      id: entity.id,
      show: entity.show,
      width: entity.width,
      material: entity.material,
      positions: entity.positions,
    };
  });
  const picks = evidence.picks.map((pick, index) => {
    if (
      pick?.entityId !== ids[index] ||
      (pick.pickedEntityId !== null &&
        (!pickIds.includes(pick.pickedEntityId) ||
          pick.pickedCameraId !== FIXTURE_CAMERA_ID)) ||
      (pick.pickedEntityId === null && pick.pickedCameraId !== null)
    )
      throw new Error(
        `CCTV rapid geometry pick evidence is invalid: sample ${index}, expected ${ids[index]}, observed ${JSON.stringify(pick?.pickedEntityId)?.slice(0, 160) ?? 'undefined'}.`,
      );
    return {
      entityId: pick.entityId,
      pickedEntityId: pick.pickedEntityId,
      pickedCameraId: pick.pickedCameraId,
    };
  });
  const visibleEntityCount = entities.filter((entity) => entity.show).length;
  if (
    (evidence.expectedVisible && visibleEntityCount !== entities.length) ||
    (!evidence.expectedVisible && visibleEntityCount !== 0) ||
    (!evidence.expectedVisible && picks.some((pick) => pick.pickedEntityId))
  )
    throw new Error('CCTV rapid geometry visibility evidence is invalid.');
  const png = Buffer.from(evidence.canvas.png.slice(22), 'base64');
  if (png.length < 32 || png.length > 4_000_000)
    throw new Error('CCTV rapid geometry PNG evidence is outside its bound.');
  const geometryBytes = JSON.stringify(entities);
  const styleBytes = JSON.stringify(
    entities.map(({ id, show, width, material }) => ({
      id,
      show,
      width,
      material,
    })),
  );
  return {
    camera: evidence.camera,
    frameNumber: evidence.frameNumber,
    canvas: {
      width: evidence.canvas.width,
      height: evidence.canvas.height,
      cssWidth: evidence.canvas.cssWidth,
      cssHeight: evidence.canvas.cssHeight,
    },
    entityCount: entities.length,
    expectedVisible: evidence.expectedVisible,
    visibleEntityCount,
    geometrySha256: createHash('sha256').update(geometryBytes).digest('hex'),
    styleSha256: createHash('sha256').update(styleBytes).digest('hex'),
    pngSha256: createHash('sha256').update(png).digest('hex'),
    pngBytes: png.length,
    pickCount: picks.length,
    pickedEntityIds: picks.map((pick) => pick.pickedEntityId),
    pickedCameraIds: picks.map((pick) => pick.pickedCameraId),
    matchingPickCount: picks.filter(
      (pick) => pick.pickedEntityId === pick.entityId,
    ).length,
  };
}

export function assertCctvRapidGeometryRevision(
  revision,
  {
    expectedTaskErrors = null,
    warmup = null,
    resourceDiagnosticsSchema = CCTV_RESOURCE_DIAGNOSTICS_SCHEMA,
  } = {},
) {
  const enabledCase = revision?.boundary?.enabledRelease;
  const disabledCase = revision?.boundary?.disabledRelease;
  const gate = enabledCase?.held;
  const afterB = enabledCase?.whileRevisionB;
  const disabledHeld = disabledCase?.held;
  const disabledAfterB = disabledCase?.whileRevisionB;
  const final = revision?.boundary?.final;
  const ids = ['ray-tl', 'ray-tr', 'ray-br', 'ray-bl', 'cap'].map(
    (role) => `cctv-${FIXTURE_CAMERA_ID}-${role}`,
  );
  const pickIds = [...ids, `cctv-${FIXTURE_CAMERA_ID}-plane`];
  if (
    revision?.status !== 'passed' ||
    revision.scope !==
      'held-worker-result; no worker-compute overlap claimed' ||
    !revision.revisionA ||
    !revision.revisionB ||
    equalJson(revision.revisionA.calibration, revision.revisionB.calibration) ||
    enabledCase?.arm?.status !== 'armed' ||
    gate?.status !== 'held' ||
    afterB?.status !== 'held' ||
    enabledCase?.released?.status !== 'released' ||
    enabledCase.released.taskId !== gate.taskId ||
    disabledHeld?.status !== 'held' ||
    disabledAfterB?.status !== 'held' ||
    disabledCase?.arm?.status !== 'armed' ||
    disabledCase?.released?.status !== 'released' ||
    disabledCase.released.taskId !== disabledHeld.taskId ||
    disabledCase?.disabledBeforeRelease?.enabled !== false ||
    !Number.isSafeInteger(
      disabledCase?.disabledBeforeRelease?.worker?.pending,
    ) ||
    disabledCase.disabledBeforeRelease.worker.pending < 1 ||
    !Array.isArray(disabledCase?.disabledBeforeRelease?.worker?.workers) ||
    disabledCase.disabledBeforeRelease.worker.workers.reduce(
      (sum, worker) => sum + worker.pending,
      0,
    ) !== disabledCase.disabledBeforeRelease.worker.pending ||
    disabledCase?.disabledAtElapsedMs !==
      disabledCase?.disabledBeforeRelease?.boundaryRender?.elapsedMs ||
    enabledCase?.arm?.armedAtMs !== gate?.armedAtMs ||
    disabledCase?.arm?.armedAtMs !== disabledHeld?.armedAtMs ||
    final?.status !== 'released' ||
    !finiteNonnegative(gate.armedAtMs) ||
    !finiteNonnegative(gate.heldAtMs) ||
    gate.heldAtMs < gate.armedAtMs ||
    !finiteNonnegative(final.releasedAtMs) ||
    !finiteNonnegative(enabledCase.released.releasedAtMs) ||
    !finiteNonnegative(disabledCase.released.releasedAtMs) ||
    !Number.isSafeInteger(gate.submittedAtArm) ||
    !final?.disposed ||
    final.boundaryDisabled !== true ||
    final.listenersReleased !== true ||
    final.heldPayloadReleased !== true ||
    final.listenerCleanupErrors !== 0 ||
    final.releaseError !== null ||
    final.diagnosticWorkerConstructorRetained !== true ||
    final.nativeWorkerConstructorRestored !== false ||
    final.disposedWithHeldResult !== false
  )
    throw new Error('CCTV rapid geometry worker boundary evidence is invalid.');
  for (const [sampleGate, isHeldObservation] of [
    [gate, true],
    [afterB, false],
    [disabledHeld, true],
    [disabledAfterB, false],
  ]) {
    const workerRows = sampleGate?.workerAtHold?.workers;
    const workerRecord = workerRows?.[sampleGate?.workerOrdinal];
    if (
      sampleGate?.workerKind !== 'createGeometry.js' ||
      !Number.isSafeInteger(sampleGate.taskId) ||
      !Number.isSafeInteger(sampleGate.workerOrdinal) ||
      sampleGate.workerOrdinal < 0 ||
      (isHeldObservation &&
        (!Number.isSafeInteger(sampleGate.pendingAtHold) ||
          sampleGate.pendingAtHold < 1 ||
          !Number.isSafeInteger(sampleGate.workerSubmittedAfterArm) ||
          sampleGate.workerSubmittedAfterArm < 1)) ||
      sampleGate.overflow !== false ||
      !Array.isArray(workerRows) ||
      workerRows.length > 64 ||
      sampleGate.workerAtHold?.overflow !== false ||
      !Number.isSafeInteger(sampleGate.workerAtHold?.pending) ||
      sampleGate.workerAtHold.pending < 1 ||
      sampleGate.workerAtHold.pending !==
        workerRows.reduce((sum, worker) => sum + worker.pending, 0) ||
      sampleGate.workerAtHold.instrumented !== true ||
      workerRows.some(
        (worker) =>
          ![
            worker.submitted,
            worker.completed,
            worker.cancelled,
            worker.pending,
            worker.taskErrors,
            worker.workerErrors,
            worker.postErrors,
          ].every((value) => Number.isSafeInteger(value) && value >= 0) ||
          worker.workerErrors !== 0 ||
          worker.postErrors !== 0 ||
          worker.submitted !==
            worker.completed + worker.cancelled + worker.pending,
      ) ||
      workerRecord?.kind !== 'createGeometry.js' ||
      ![
        workerRecord?.submitted,
        workerRecord?.completed,
        workerRecord?.cancelled,
        workerRecord?.pending,
        workerRecord?.postErrors,
      ].every((value) => Number.isSafeInteger(value) && value >= 0) ||
      workerRecord.pending < 1 ||
      workerRecord.submitted !==
        workerRecord.completed +
          workerRecord.cancelled +
          workerRecord.pending ||
      workerRecord.postErrors !== 0
    )
      throw new Error('CCTV held result worker identity is invalid.');
  }
  if (
    gate.taskId !== afterB.taskId ||
    disabledHeld.taskId !== disabledAfterB.taskId ||
    disabledCase.released.taskId !== disabledHeld.taskId ||
    final.taskId !== disabledHeld.taskId ||
    !Number.isSafeInteger(afterB.workerSubmissionsWhileHeld) ||
    afterB.workerSubmissionsWhileHeld < 1 ||
    !Number.isSafeInteger(disabledAfterB.workerSubmissionsWhileHeld) ||
    disabledAfterB.workerSubmissionsWhileHeld < 1 ||
    enabledCase.released.releasedAtMs < gate.heldAtMs ||
    disabledCase.released.releasedAtMs < disabledHeld.heldAtMs ||
    disabledCase.released.releasedAtMs < disabledCase.disabledAtElapsedMs
  )
    throw new Error('CCTV late-result release ordering is invalid.');
  const names = ['controlA', 'referenceB', 'afterRelease', 'afterReenable'];
  for (const name of names) {
    const sample = revision.samples?.[name];
    if (
      sample?.camera?.id !== FIXTURE_CAMERA_ID ||
      !SHA1.test(sample?.cameraCommit || '') ||
      sample.cameraCommit !== revision.applicationCommit ||
      !Number.isSafeInteger(sample.frameNumber) ||
      sample.frameNumber < 1 ||
      !Number.isFinite(sample.camera?.rangeM) ||
      !sample.camera?.calibration ||
      sample.entityCount !== 5 ||
      sample.expectedVisible !== true ||
      sample.visibleEntityCount !== 5 ||
      !/^[a-f0-9]{64}$/.test(sample.geometrySha256 || '') ||
      !/^[a-f0-9]{64}$/.test(sample.styleSha256 || '') ||
      !/^[a-f0-9]{64}$/.test(sample.pngSha256 || '') ||
      !Number.isSafeInteger(sample.pngBytes) ||
      sample.pngBytes < 32 ||
      sample.pngBytes > 4_000_000 ||
      sample.pickCount !== 5 ||
      !Array.isArray(sample.pickedEntityIds) ||
      sample.pickedEntityIds.length !== 5 ||
      !Array.isArray(sample.pickedCameraIds) ||
      sample.pickedCameraIds.length !== 5 ||
      !sample.pickedEntityIds.every((id, index) =>
        id === null
          ? sample.pickedCameraIds[index] === null
          : pickIds.includes(id) &&
            sample.pickedCameraIds[index] === FIXTURE_CAMERA_ID,
      ) ||
      sample.canvas?.width !== revision.canvas?.width ||
      sample.canvas?.height !== revision.canvas?.height ||
      sample.canvas?.cssWidth !== revision.canvas?.cssWidth ||
      sample.canvas?.cssHeight !== revision.canvas?.cssHeight
    )
      throw new Error(`CCTV rapid geometry ${name} sample is invalid.`);
  }
  const reference = revision.samples.referenceB;
  const controlA = revision.samples.controlA;
  const expectedPicks = reference.pickedEntityIds;
  if (
    equalJson(controlA.camera.calibration, reference.camera.calibration) ||
    controlA.geometrySha256 === reference.geometrySha256 ||
    controlA.pngSha256 === reference.pngSha256
  )
    throw new Error(
      'CCTV settled revision A and B controls do not prove distinct visible output.',
    );
  if (!equalJson(reference.camera.calibration, revision.revisionB.calibration))
    throw new Error('CCTV reference sample does not show revision B.');
  if (!expectedPicks.some((id) => id !== null))
    throw new Error('CCTV revision B has no observed native pick identity.');
  for (const name of ['afterRelease', 'afterReenable']) {
    const sample = revision.samples[name];
    for (const key of [
      'geometrySha256',
      'styleSha256',
      'pngSha256',
      'pngBytes',
      'visibleEntityCount',
    ])
      if (sample[key] !== reference[key])
        throw new Error(`CCTV revision B did not match ${name} ${key}.`);
    if (!equalJson(sample.pickedEntityIds, reference.pickedEntityIds))
      throw new Error(`CCTV revision B pick identities changed in ${name}.`);
    if (!equalJson(sample.camera.calibration, revision.revisionB.calibration))
      throw new Error(`CCTV revision B calibration changed in ${name}.`);
  }
  if (
    !equalJson(revision.samples.afterRelease.pickedEntityIds, expectedPicks) ||
    !equalJson(revision.samples.afterReenable.pickedEntityIds, expectedPicks)
  )
    throw new Error('CCTV revision B pick identities changed after release.');
  const disabledNames = [
    'disabledReferenceB',
    'disabledWithHeldResult',
    'disabledAfterRelease',
  ];
  for (const name of disabledNames) {
    const sample = revision.samples?.[name];
    if (
      sample?.camera?.id !== FIXTURE_CAMERA_ID ||
      sample.cameraCommit !== revision.applicationCommit ||
      sample.expectedVisible !== false ||
      !Number.isSafeInteger(sample.frameNumber) ||
      sample.frameNumber < 1 ||
      sample.entityCount !== 5 ||
      sample.visibleEntityCount !== 0 ||
      !Array.isArray(sample.pickedEntityIds) ||
      sample.pickedEntityIds.length !== 5 ||
      sample.pickedEntityIds.some((id) => id !== null) ||
      !Array.isArray(sample.pickedCameraIds) ||
      sample.pickedCameraIds.length !== 5 ||
      sample.pickedCameraIds.some((id) => id !== null) ||
      !/^[a-f0-9]{64}$/.test(sample.geometrySha256 || '') ||
      !/^[a-f0-9]{64}$/.test(sample.styleSha256 || '') ||
      !/^[a-f0-9]{64}$/.test(sample.pngSha256 || '') ||
      sample.canvas?.width !== revision.canvas?.width ||
      sample.canvas?.height !== revision.canvas?.height ||
      sample.canvas?.cssWidth !== revision.canvas?.cssWidth ||
      sample.canvas?.cssHeight !== revision.canvas?.cssHeight ||
      !equalJson(sample.camera.calibration, revision.revisionB.calibration)
    )
      throw new Error(
        `CCTV rapid geometry ${name} disabled sample is invalid: ${JSON.stringify(
          {
            expectedVisible: sample?.expectedVisible,
            visibleEntityCount: sample?.visibleEntityCount,
            pickedEntityIds: sample?.pickedEntityIds,
            cameraCalibration: sample?.camera?.calibration,
            revisionCalibration: revision.revisionB.calibration,
            sampleCanvas: sample?.canvas,
            revisionCanvas: revision.canvas,
            cameraId: sample?.camera?.id,
            cameraCommit: sample?.cameraCommit,
            revisionCommit: revision.applicationCommit,
            frameNumber: sample?.frameNumber,
            entityCount: sample?.entityCount,
            hashes: [
              sample?.geometrySha256,
              sample?.styleSha256,
              sample?.pngSha256,
            ],
          },
        )}`,
      );
  }
  const disabledReference = revision.samples.disabledReferenceB;
  for (const name of ['disabledWithHeldResult', 'disabledAfterRelease']) {
    const sample = revision.samples[name];
    for (const key of ['geometrySha256', 'styleSha256', 'pngSha256'])
      if (sample[key] !== disabledReference[key])
        throw new Error(`Disabled CCTV output resurrected during ${name}.`);
  }
  const settledKeys = [
    'settledAfterRelease',
    'disabledReferenceB',
    'disabledAfterRace',
    'settledAfterDisableRelease',
    'reenabledAfterRace',
    'finalDisabled',
  ];
  if (
    !settledKeys.every((key) => {
      const checkpoint = revision.checkpoints?.[key];
      return (
        checkpoint &&
        checkpoint.worker?.pending === 0 &&
        checkpoint.diagnostics?.pendingJobs === 0 &&
        checkpoint.stats?.loading === false
      );
    }) ||
    revision.checkpoints.disabledAfterRace.enabled !== false ||
    revision.checkpoints.reenabledAfterRace.enabled !== true ||
    revision.checkpoints.finalDisabled.enabled !== false
  )
    throw new Error('CCTV rapid geometry lifecycle checkpoints are invalid.');
  if (!warmup?.enabled || !warmup?.disabled)
    throw new Error('CCTV rapid geometry ownership baselines are missing.');
  for (const [key, enabled, baseline] of [
    ['settledAfterRelease', true, warmup.enabled],
    ['disabledReferenceB', false, warmup.disabled],
    ['disabledAfterRace', false, warmup.disabled],
    ['settledAfterDisableRelease', false, warmup.disabled],
    ['reenabledAfterRace', true, warmup.enabled],
    ['finalDisabled', false, warmup.disabled],
  ]) {
    const checkpoint = revision.checkpoints[key];
    if (
      checkpoint.enabled !== enabled ||
      checkpoint.appCommit !== revision.applicationCommit ||
      !equalJson(checkpoint.scene, baseline.scene) ||
      !equalJson(checkpoint.diagnostics, baseline.diagnostics)
    )
      throw new Error(`CCTV rapid geometry ${key} ownership changed.`);
    if (key !== 'disabledWithHeldResult')
      assertCctvCheckpoint(checkpoint, {
        expectedTaskErrors,
        resourceDiagnosticsSchema,
      });
  }
  const heldCheckpoint = revision.checkpoints.disabledWithHeldResult;
  if (
    heldCheckpoint?.enabled !== false ||
    heldCheckpoint?.moduleEnabled !== false ||
    heldCheckpoint?.lifecycleState?.enabled !== false ||
    heldCheckpoint?.lifecycleState?.lifecycleState !== 'disabled' ||
    heldCheckpoint?.lifecycleState?.uncertain !== false ||
    heldCheckpoint?.cameraCount !== 1 ||
    heldCheckpoint?.cameras?.[0]?.id !== FIXTURE_CAMERA_ID ||
    heldCheckpoint?.stats?.loading !== false ||
    heldCheckpoint.worker?.instrumented !== true ||
    heldCheckpoint.worker?.overflow !== false ||
    heldCheckpoint.worker?.workersTruncated !== false ||
    heldCheckpoint.worker?.workerCount !==
      heldCheckpoint.worker?.workers?.length ||
    !Number.isSafeInteger(heldCheckpoint.worker?.pending) ||
    heldCheckpoint.worker.pending < 1 ||
    !Array.isArray(heldCheckpoint.worker.workers) ||
    heldCheckpoint.worker.workers.length > 64 ||
    heldCheckpoint.worker.workers.some(
      (worker) =>
        ![
          worker.pending,
          worker.submitted,
          worker.completed,
          worker.cancelled,
          worker.taskErrors,
          worker.workerErrors,
          worker.postErrors,
        ].every((value) => Number.isSafeInteger(value) && value >= 0) ||
        worker.postErrors !== 0 ||
        worker.submitted !==
          worker.completed + worker.cancelled + worker.pending,
    ) ||
    heldCheckpoint.worker.workers.reduce(
      (sum, worker) => sum + worker.pending,
      0,
    ) !== heldCheckpoint.worker.pending ||
    heldCheckpoint.worker.workers[disabledHeld.workerOrdinal]?.kind !==
      'createGeometry.js' ||
    heldCheckpoint.worker.workers[disabledHeld.workerOrdinal]?.pending < 1 ||
    !Number.isSafeInteger(heldCheckpoint.diagnostics?.pendingJobs) ||
    heldCheckpoint.diagnostics.pendingJobs < 0 ||
    !finiteNonnegative(heldCheckpoint.boundaryRender?.elapsedMs) ||
    !Number.isSafeInteger(heldCheckpoint.boundaryRender?.frameNumber) ||
    disabledCase.disabledAtElapsedMs !==
      heldCheckpoint.boundaryRender.elapsedMs ||
    heldCheckpoint.stats?.loading !== false
  )
    throw new Error('CCTV was not disabled with revision A still pending.');
  const workerBaseline = cctvGeometryTotals(
    revision.checkpoints.settledAfterDisableRelease,
  );
  for (const key of [
    'disabledAfterRace',
    'reenabledAfterRace',
    'finalDisabled',
  ])
    if (
      !equalJson(cctvGeometryTotals(revision.checkpoints[key]), workerBaseline)
    )
      throw new Error(
        `CCTV rapid geometry added work during ${key} toggle reuse.`,
      );
  return true;
}

/** Explicit disabled module.init path, distinct from normal manager toggles. */
export async function reinitializeDisabledCctvModuleInPage() {
  const debug = window.__godsEyeView;
  const entry = debug?.dataManager?.layers?.get('cctv');
  if (!entry?.module?.init || !debug?.viewer)
    throw new Error('CCTV module reinitialization API is unavailable.');
  if (debug.dataManager.isEnabled('cctv'))
    throw new Error('CCTV direct reinitialization requires a disabled module.');
  await entry.module.init(debug.viewer);
  return true;
}

function finiteNonnegative(value) {
  return Number.isFinite(value) && value >= 0;
}

function equalJson(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function assertCctvCameraPose(checkpoint, expectedView = FIXTURE_VIEW) {
  const pose = checkpoint?.cameraPose;
  const angleDistance = (left, right) =>
    Math.abs(Math.atan2(Math.sin(left - right), Math.cos(left - right)));
  if (
    !pose ||
    ![
      pose.longitude,
      pose.latitude,
      pose.heightM,
      pose.headingRadians,
      pose.pitchRadians,
      pose.rollRadians,
    ].every(Number.isFinite) ||
    Math.abs(pose.longitude - expectedView.longitude) > 0.001 ||
    Math.abs(pose.latitude - expectedView.latitude) > 0.001 ||
    Math.abs(pose.heightM - expectedView.heightM) > 5 ||
    angleDistance(pose.headingRadians, expectedView.headingRadians) > 0.0001 ||
    Math.abs(pose.pitchRadians - expectedView.pitchRadians) > 0.0001 ||
    angleDistance(pose.rollRadians, expectedView.rollRadians) > 0.0001
  )
    throw new Error('CCTV camera pose differs from the declared fixture view.');
  return pose;
}

export function assertCctvStableDrain(checkpoint) {
  const stable = checkpoint?.drainStability;
  if (
    stable?.status !== 'stable' ||
    !Number.isSafeInteger(stable.sampleCount) ||
    stable.sampleCount < 3 ||
    !Number.isFinite(stable.windowMs) ||
    stable.windowMs < 1000 ||
    !Number.isSafeInteger(stable.firstFrameNumber) ||
    !Number.isSafeInteger(stable.lastFrameNumber) ||
    stable.lastFrameNumber <= stable.firstFrameNumber ||
    !Number.isFinite(stable.maximumSampleGapMs) ||
    stable.maximumSampleGapMs < 0 ||
    stable.maximumSampleGapMs > 10_000
  )
    throw new Error(
      'CCTV checkpoint lacks a stable one-second native-render drain window.',
    );
  return stable;
}

export function assertCctvCycleReuse(cycle, warmup) {
  if (
    !cycle ||
    cycle.enabled?.enabled !== true ||
    cycle.disabled?.enabled !== false ||
    cycle.enabled?.cameraCount !== 1 ||
    cycle.disabled?.cameraCount !== 1 ||
    cycle.enabled.cameras?.[0]?.id !== FIXTURE_CAMERA_ID ||
    cycle.disabled.cameras?.[0]?.id !== FIXTURE_CAMERA_ID ||
    cycle.enabled.activeCameraId !== FIXTURE_CAMERA_ID
  )
    throw new Error(`CCTV fixture ownership changed in cycle ${cycle?.cycle}.`);
  assertCctvStableDrain(cycle.enabled);
  assertCctvStableDrain(cycle.disabled);
  if (
    !equalJson(cycle.enabled.diagnostics, warmup.enabled.diagnostics) ||
    !equalJson(cycle.disabled.diagnostics, warmup.disabled.diagnostics)
  )
    throw new Error(`CCTV diagnostics changed in cycle ${cycle.cycle}.`);
  if (
    !equalJson(cycle.enabled.scene, warmup.enabled.scene) ||
    !equalJson(cycle.disabled.scene, warmup.disabled.scene)
  )
    throw new Error(`CCTV scene resources changed in cycle ${cycle.cycle}.`);
  const warmEnabledGeometry = cctvGeometryTotals(warmup.enabled);
  const warmDisabledGeometry = cctvGeometryTotals(warmup.disabled);
  const enabledGeometry = cctvGeometryTotals(cycle.enabled);
  const disabledGeometry = cctvGeometryTotals(cycle.disabled);
  if (
    !equalJson(warmEnabledGeometry, warmDisabledGeometry) ||
    cycle.createGeometrySubmitted !==
      warmEnabledGeometry.activeCreateGeometrySubmitted ||
    !equalJson(cycle.enabledWorkerTotals, enabledGeometry) ||
    !equalJson(cycle.disabledWorkerTotals, disabledGeometry) ||
    !equalJson(enabledGeometry, warmEnabledGeometry) ||
    !equalJson(disabledGeometry, warmDisabledGeometry)
  )
    throw new Error(
      `CCTV toggle resubmitted settled createGeometry work in cycle ${cycle.cycle}.`,
    );
  return true;
}

export function cctvGeometryTotals(checkpoint) {
  const workers = checkpoint?.worker?.workers;
  if (
    !Array.isArray(workers) ||
    workers.length > 64 ||
    checkpoint.worker.workerCount !== workers.length
  )
    throw new Error('CCTV worker totals are unavailable or truncated.');
  const geometry = workers.filter((worker) =>
    /creategeometry/i.test(worker.kind),
  );
  const active = geometry.filter(
    (worker) => !worker.terminated && worker.taskErrors === 0,
  );
  const sum = (rows, key) =>
    rows.reduce((total, worker) => total + worker[key], 0);
  return {
    submitted: sum(geometry, 'submitted'),
    completed: sum(geometry, 'completed'),
    workerCount: workers.length,
    identifiableCreateGeometryWorkers: geometry.length,
    activeCreateGeometryWorkers: active.length,
    activeCreateGeometrySubmitted: sum(active, 'submitted'),
    allWorkerSubmitted: sum(workers, 'submitted'),
  };
}

export function validateCctvLifecycleReport(
  report,
  { cycles = 5, fixtureSha256 } = {},
) {
  if (
    ![
      'gev-cctv-lifecycle/v1',
      'gev-cctv-lifecycle/v2',
      'gev-cctv-lifecycle/v3',
    ].includes(report?.schema)
  )
    throw new Error('Unsupported CCTV lifecycle report schema.');
  const resourceDiagnosticsSchema =
    report.schema === 'gev-cctv-lifecycle/v3'
      ? CCTV_RESOURCE_DIAGNOSTICS_SCHEMA
      : LEGACY_CCTV_RESOURCE_DIAGNOSTICS_SCHEMA;
  if (
    (report.schema === 'gev-cctv-lifecycle/v3' &&
      report.resourceDiagnosticsSchema !== CCTV_RESOURCE_DIAGNOSTICS_SCHEMA) ||
    (report.schema !== 'gev-cctv-lifecycle/v3' &&
      report.resourceDiagnosticsSchema !== undefined)
  )
    throw new Error('CCTV resource diagnostic semantics are mislabeled.');
  if (report.status !== 'passed' || report.validationStatus !== 'passed')
    throw new Error(
      'CCTV lifecycle run did not complete with passing validation.',
    );
  if (
    report.fixture?.id !== FIXTURE_ID ||
    report.fixture?.sha256 !== fixtureSha256 ||
    report.fixture?.cameraCount !== 1 ||
    report.fixture?.cameraId !== FIXTURE_CAMERA_ID ||
    !equalJson(report.fixture?.view, FIXTURE_VIEW) ||
    !/^[a-f0-9]{64}$/.test(report.fixture?.frameSha256 || '')
  )
    throw new Error('CCTV synthetic fixture identity is missing or changed.');
  if (
    !SHA1.test(report.applicationCommit || '') ||
    report.applicationCommit !== report.harnessCommit ||
    report.applicationCommitAtEnd !== report.applicationCommit ||
    report.sourceChangedDuringRun !== false ||
    report.applicationSourceCleanAtStart !== true ||
    report.applicationSourceCleanAtEnd !== true
  )
    throw new Error('CCTV application source identity is invalid or changed.');
  if (
    report.githubMatchesHeadAtStart !== true ||
    report.githubMatchesHeadAtEnd !== true ||
    report.servedApplicationCommit !== report.applicationCommit
  )
    throw new Error(
      'CCTV served, checkout, and hosted workflow identities differ.',
    );
  if (
    report.failedPhase !== null ||
    report.error !== null ||
    !Array.isArray(report.pageErrors) ||
    report.pageErrors.length !== 0 ||
    report.sceneReadiness?.status !== 'ready' ||
    report.workerPreflight?.status !== 'passed'
  )
    throw new Error(
      'CCTV lifecycle contains a failure or incomplete readiness evidence.',
    );
  const environment = report.environment;
  if (
    typeof environment?.nodeVersion !== 'string' ||
    !/^v\d+\.\d+\.\d+/.test(environment.nodeVersion) ||
    typeof environment.host?.platform !== 'string' ||
    typeof environment.host?.architecture !== 'string' ||
    typeof environment.host?.osRelease !== 'string' ||
    typeof environment.host?.cpu !== 'string' ||
    !Number.isSafeInteger(environment.host?.logicalCpus) ||
    environment.host.logicalCpus < 1 ||
    !Number.isSafeInteger(environment.host?.memoryBytes) ||
    environment.host.memoryBytes < 1 ||
    !/^\d+\.\d+\.\d+/.test(environment.cesiumVersion || '') ||
    typeof environment.browserVersion !== 'string' ||
    !/(?:HeadlessChrome|Chrome|Chromium)\/\d+\./.test(
      environment.browserVersion,
    ) ||
    environment.viewport?.width !== 1440 ||
    environment.viewport?.height !== 1000
  )
    throw new Error(
      'CCTV browser, operating system, toolchain or viewport identity is incomplete.',
    );
  if (!equalJson(report.sceneConfiguration, { ...FIXTURE_VIEW, applied: true }))
    throw new Error('CCTV fixture view or auto-hop policy was not applied.');
  if (report.renderer?.classification !== 'software' || !report.renderer?.name)
    throw new Error(
      'This hosted lifecycle diagnostic requires observed software rendering.',
    );
  if (
    report.cycles?.length !== cycles ||
    report.cycles.some(
      (row, index) => row.cycle !== index + 1 || row.status !== 'passed',
    )
  )
    throw new Error('CCTV lifecycle cycle inventory is incomplete.');
  const allowedTaskErrors = report.workerPreflight?.expectedTaskErrorWorkers;
  if (
    !Array.isArray(allowedTaskErrors) ||
    allowedTaskErrors.length !== 1 ||
    allowedTaskErrors[0].kind !== 'createGeometry.js' ||
    allowedTaskErrors[0].taskErrors !== 1 ||
    allowedTaskErrors[0].terminated !== true
  )
    throw new Error('CCTV worker preflight residue is missing or unexpected.');
  const snapshots = [
    report.warmup?.enabled,
    report.warmup?.disabled,
    report.directReinit?.initializedDisabled,
    report.directReinit?.rewarmedEnabled,
    report.directReinit?.checkpoint,
    ...report.cycles.flatMap((row) => [row.enabled, row.disabled]),
  ];
  for (const row of snapshots) {
    assertCctvCheckpoint(row, {
      expectedTaskErrors: allowedTaskErrors,
      resourceDiagnosticsSchema,
    });
    if (row.appCommit !== report.applicationCommit)
      throw new Error(
        'CCTV checkpoint application commit differs from the report identity.',
      );
  }
  if (
    report.warmup.enabled.enabled !== true ||
    report.warmup.disabled.enabled !== false
  )
    throw new Error('CCTV warmup enabled/disabled baselines are reversed.');
  if (
    report.warmup.enabled.cameraCount !== 1 ||
    report.warmup.disabled.cameraCount !== 1 ||
    report.warmup.enabled.cameras[0]?.id !== report.fixture.cameraId ||
    report.warmup.disabled.cameras[0]?.id !== report.fixture.cameraId
  )
    throw new Error(
      'CCTV warmup baselines do not contain the declared fixture camera.',
    );
  if (
    !report.warmup.enabled.cameraView?.containsFixture ||
    report.warmup.enabled.diagnostics.primitives < 1 ||
    report.warmup.enabled.diagnostics.entities < 1
  )
    throw new Error(
      'CCTV fixture camera did not materialize visible scene geometry.',
    );
  const warmEnabledGeometry = cctvGeometryTotals(report.warmup.enabled);
  const warmDisabledGeometry = cctvGeometryTotals(report.warmup.disabled);
  if (
    warmEnabledGeometry.activeCreateGeometryWorkers < 1 ||
    warmEnabledGeometry.activeCreateGeometrySubmitted < 1 ||
    report.warmup.createGeometrySubmitted !==
      warmEnabledGeometry.activeCreateGeometrySubmitted ||
    !equalJson(report.warmup.workerTotals, warmEnabledGeometry) ||
    !equalJson(warmDisabledGeometry, warmEnabledGeometry)
  )
    throw new Error(
      'CCTV nonterminated createGeometry work was not observable and stable after warmup.',
    );
  const requireRenderedFrame = (checkpoint, expectedTotals = null) => {
    if (
      !Number.isSafeInteger(checkpoint?.boundaryRender?.frameNumber) ||
      checkpoint.boundaryRender.frameNumber < 1 ||
      !finiteNonnegative(checkpoint.boundaryRender?.elapsedMs) ||
      !Number.isSafeInteger(checkpoint?.render?.frameNumber) ||
      checkpoint.render.frameNumber < 1 ||
      checkpoint.render.frameNumber <= checkpoint.boundaryRender.frameNumber ||
      !finiteNonnegative(checkpoint.render?.elapsedMs)
    )
      throw new Error(
        'CCTV lifecycle checkpoint lacks its completed native render observation.',
      );
    const totals = cctvGeometryTotals(checkpoint);
    if (expectedTotals && !equalJson(totals, expectedTotals))
      throw new Error(
        'CCTV cumulative createGeometry worker totals changed after warmup.',
      );
    if (!checkpoint.cameraView?.containsFixture)
      throw new Error('CCTV synthetic camera left the declared scene view.');
    assertCctvCameraPose(checkpoint, report.fixture.view);
    assertCctvStableDrain(checkpoint);
  };
  for (const row of snapshots) requireRenderedFrame(row);
  requireRenderedFrame(report.warmup.enabled, warmEnabledGeometry);
  requireRenderedFrame(report.warmup.disabled, warmDisabledGeometry);
  for (const cycle of report.cycles) {
    assertCctvCycleReuse(cycle, report.warmup);
    if (
      cycle.enabled.enabled !== true ||
      cycle.disabled.enabled !== false ||
      cycle.enabled.cameraCount !== 1 ||
      cycle.disabled.cameraCount !== 1 ||
      cycle.enabled.cameras[0]?.id !== report.fixture.cameraId ||
      cycle.disabled.cameras[0]?.id !== report.fixture.cameraId ||
      cycle.enabled.activeCameraId !== report.fixture.cameraId
    )
      throw new Error(
        `CCTV fixture ownership changed in cycle ${cycle.cycle}.`,
      );
    if (
      !equalJson(cycle.enabled.diagnostics, report.warmup.enabled.diagnostics)
    )
      throw new Error(
        `CCTV enabled diagnostics changed in cycle ${cycle.cycle}.`,
      );
    if (
      !equalJson(cycle.disabled.diagnostics, report.warmup.disabled.diagnostics)
    )
      throw new Error(
        `CCTV disabled diagnostics changed in cycle ${cycle.cycle}.`,
      );
    if (
      !equalJson(cycle.enabled.scene, report.warmup.enabled.scene) ||
      !equalJson(cycle.disabled.scene, report.warmup.disabled.scene)
    )
      throw new Error(`CCTV scene resources changed in cycle ${cycle.cycle}.`);
    const enabledGeometry = cctvGeometryTotals(cycle.enabled);
    const disabledGeometry = cctvGeometryTotals(cycle.disabled);
    requireRenderedFrame(cycle.enabled, warmEnabledGeometry);
    requireRenderedFrame(cycle.disabled, warmDisabledGeometry);
    if (
      cycle.createGeometrySubmitted !== report.warmup.createGeometrySubmitted ||
      !equalJson(cycle.enabledWorkerTotals, enabledGeometry) ||
      !equalJson(cycle.disabledWorkerTotals, disabledGeometry) ||
      !equalJson(enabledGeometry, warmEnabledGeometry) ||
      !equalJson(disabledGeometry, warmDisabledGeometry)
    )
      throw new Error(
        `CCTV toggle resubmitted settled createGeometry work in cycle ${cycle.cycle}.`,
      );
  }
  if (
    report.directReinit.scope !== 'disabled-direct-module-init' ||
    report.directReinit.status !== 'passed' ||
    report.directReinit.initializedDisabled.enabled !== false ||
    report.directReinit.rewarmedEnabled.enabled !== true ||
    report.directReinit.checkpoint.enabled !== false ||
    report.directReinit.checkpoint.cameraCount !== 1 ||
    report.directReinit.checkpoint.cameras[0]?.id !== report.fixture.cameraId
  )
    throw new Error(
      'CCTV direct reinitialization scope is missing or enabled.',
    );
  if (
    !equalJson(
      report.directReinit.rewarmedEnabled.diagnostics,
      report.warmup.enabled.diagnostics,
    ) ||
    !equalJson(
      report.directReinit.rewarmedEnabled.scene,
      report.warmup.enabled.scene,
    ) ||
    !equalJson(
      report.directReinit.checkpoint.diagnostics,
      report.warmup.disabled.diagnostics,
    ) ||
    !equalJson(
      report.directReinit.checkpoint.scene,
      report.warmup.disabled.scene,
    )
  )
    throw new Error(
      'CCTV direct module reinitialization changed settled disabled resources.',
    );
  if (
    cctvGeometryTotals(report.directReinit.rewarmedEnabled)
      .activeCreateGeometrySubmitted < 1
  )
    throw new Error(
      'CCTV direct module reinitialization did not rematerialize fixture geometry.',
    );
  if (
    report.schema === 'gev-cctv-lifecycle/v2' ||
    report.schema === 'gev-cctv-lifecycle/v3'
  ) {
    if (
      report.rapidGeometryRevision?.applicationCommit !==
      report.applicationCommit
    )
      throw new Error(
        'CCTV rapid geometry evidence application identity is missing.',
      );
    assertCctvRapidGeometryRevision(report.rapidGeometryRevision, {
      expectedTaskErrors:
        report.workerPreflight?.expectedTaskErrorWorkers ?? null,
      warmup: report.warmup,
      resourceDiagnosticsSchema,
    });
  }
  if (
    report.fixtureDelivery?.id !== FIXTURE_ID ||
    report.fixtureDelivery?.sha256 !== report.fixture.sha256 ||
    report.fixtureDelivery?.cameraCount !== 1 ||
    report.fixtureDelivery?.cameraId !== report.fixture.cameraId ||
    !['sourceResponses', 'healthResponses', 'frameResponses'].every(
      (key) =>
        Number.isSafeInteger(report.fixtureDelivery?.[key]) &&
        report.fixtureDelivery[key] >= 0 &&
        report.fixtureDelivery[key] <= 1000,
    ) ||
    report.fixtureDelivery?.sourceResponses < 2 ||
    report.fixtureDelivery?.healthResponses < 2 ||
    report.fixtureDelivery?.frameResponses < 1 ||
    report.fixtureDelivery?.clockPolicy !==
      'native-wall-clock; fixed source payload and frame bytes' ||
    report.fixtureDelivery?.healthPolicy !== 'fixed-empty-health-snapshot' ||
    report.fixtureDelivery?.frameSha256 !== report.fixture.frameSha256
  )
    throw new Error(
      'CCTV fixture delivery or fixed-clock policy was not observed.',
    );
  if (
    !report.browserClose?.closeCompleted ||
    report.browserClose?.forcedProcessTermination ||
    report.browserClose?.observation?.closeDeadlineMs !== 5000 ||
    !finiteNonnegative(report.browserClose?.observation?.closeElapsedMs) ||
    report.browserClose.observation.closeElapsedMs > 5000 ||
    report.browserClose.observation.forceProcessStatus !== 'not-needed' ||
    report.browserClose.observation.processExit?.code !== 0 ||
    report.browserClose.observation.processExit?.signal !== null ||
    report.pageClose?.closeCompleted !== true ||
    report.pageClose.scope !== 'owned-context-only' ||
    report.pageClose.openPageCount !== 0 ||
    report.contextClose?.completed !== true
  )
    throw new Error('Owned CCTV lifecycle browser did not close cleanly.');
  return {
    status: 'passed',
    cycles: cycles,
    scope: 'software-renderer-lifecycle-diagnostic',
    resourceDiagnosticsSchema,
  };
}

export function assertCctvCheckpoint(
  checkpoint,
  {
    expectedTaskErrors = null,
    resourceDiagnosticsSchema = CCTV_RESOURCE_DIAGNOSTICS_SCHEMA,
  } = {},
) {
  const count = checkpoint?.diagnostics;
  if (
    !checkpoint ||
    typeof checkpoint.enabled !== 'boolean' ||
    typeof checkpoint.moduleEnabled !== 'boolean' ||
    checkpoint.enabled !== checkpoint.moduleEnabled
  )
    throw new Error(
      'CCTV enabled state checkpoint is missing or contradictory.',
    );
  for (const key of [
    'listeners',
    'timers',
    'pendingJobs',
    'primitives',
    'dataSources',
    'cacheEntries',
  ])
    if (!Number.isSafeInteger(count?.[key]) || count[key] < 0)
      throw new Error(`CCTV diagnostic ${key} is missing or invalid.`);
  if (resourceDiagnosticsSchema === CCTV_RESOURCE_DIAGNOSTICS_SCHEMA) {
    if (!Number.isSafeInteger(count.entities) || count.entities < 0)
      throw new Error('CCTV diagnostic entities is missing or invalid.');
  } else if (
    resourceDiagnosticsSchema !== LEGACY_CCTV_RESOURCE_DIAGNOSTICS_SCHEMA
  )
    throw new Error('CCTV resource diagnostic semantics are unsupported.');
  if (
    resourceDiagnosticsSchema === CCTV_RESOURCE_DIAGNOSTICS_SCHEMA &&
    count.dataSources !== 0
  )
    throw new Error(
      'CCTV owner diagnostics must not report scene entities as data sources.',
    );
  for (const key of [
    'entities',
    'dataSources',
    'primitives',
    'groundPrimitives',
  ])
    if (
      !Number.isSafeInteger(checkpoint.scene?.[key]) ||
      checkpoint.scene[key] < 0
    )
      throw new Error(`CCTV scene resource ${key} is missing or invalid.`);
  const worker = checkpoint.worker;
  if (
    worker?.instrumented !== true ||
    worker.overflow !== false ||
    worker.workersTruncated !== false ||
    worker.pending !== 0 ||
    !Array.isArray(worker.workers) ||
    worker.workers.length > 64 ||
    worker.workerCount !== worker.workers.length
  )
    throw new Error(
      'CCTV worker checkpoint is missing, pending, or overflowed.',
    );
  const taskErrorRows = [];
  for (let index = 0; index < worker.workers.length; index++) {
    const item = worker.workers[index];
    if (
      !item ||
      ![
        'submitted',
        'completed',
        'cancelled',
        'pending',
        'taskErrors',
        'workerErrors',
        'postErrors',
      ].every((key) => Number.isSafeInteger(item[key]) && item[key] >= 0) ||
      item.pending !== 0 ||
      item.workerErrors !== 0 ||
      item.postErrors !== 0 ||
      item.submitted !== item.completed + item.cancelled + item.pending
    )
      throw new Error(
        'CCTV worker checkpoint contains pending work or errors.',
      );
    if (item.taskErrors > 0)
      taskErrorRows.push({
        index,
        kind: item.kind,
        taskErrors: item.taskErrors,
        terminated: item.terminated,
      });
  }
  if (expectedTaskErrors === null) {
    if (taskErrorRows.length)
      throw new Error(
        'CCTV worker checkpoint contains unexpected task errors.',
      );
  } else if (!equalJson(taskErrorRows, expectedTaskErrors)) {
    throw new Error(
      'CCTV worker task-error history differs from the validated preflight probe.',
    );
  }
  if (
    checkpoint.stats?.error ||
    checkpoint.stats?.loading === true ||
    !finiteNonnegative(checkpoint.stats?.count)
  )
    throw new Error('CCTV module status is not settled.');
  return checkpoint;
}

export function cctvTaskErrorSignature(checkpoint) {
  if (!Array.isArray(checkpoint?.worker?.workers))
    throw new Error(
      'CCTV worker diagnostics are missing from the preflight residue.',
    );
  return checkpoint.worker.workers.flatMap((item, index) =>
    item.taskErrors > 0
      ? [
          {
            index,
            kind: item.kind,
            taskErrors: item.taskErrors,
            terminated: item.terminated,
          },
        ]
      : [],
  );
}

export function assertExpectedCctvProbeResidue(checkpoint) {
  const signature = cctvTaskErrorSignature(checkpoint);
  if (
    signature.length !== 1 ||
    signature[0].kind !== 'createGeometry.js' ||
    signature[0].taskErrors !== 1 ||
    signature[0].terminated !== true
  )
    throw new Error(
      'CCTV worker preflight did not leave its one expected terminated createGeometry error.',
    );
  assertCctvCheckpoint(checkpoint, { expectedTaskErrors: signature });
  return signature;
}
