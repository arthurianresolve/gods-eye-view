import { createHash } from 'node:crypto';

const SHA1 = /^[a-f0-9]{40}$/i;
const FIXTURE_ID = 'qa-cctv-lifecycle-v1';
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

/** Apply one public Cesium view and disable CCTV auto-hop before readiness. */
export async function configureCctvLifecycleSceneInPage(view) {
  const debug = window.__godsEyeView;
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
  if (report?.schema !== 'gev-cctv-lifecycle/v1')
    throw new Error('Unsupported CCTV lifecycle report schema.');
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
    assertCctvCheckpoint(row, { expectedTaskErrors: allowedTaskErrors });
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
    report.warmup.enabled.diagnostics.dataSources < 1
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
      !Number.isSafeInteger(checkpoint?.render?.frameNumber) ||
      checkpoint.render.frameNumber < 1 ||
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
  };
  for (const row of snapshots) requireRenderedFrame(row);
  requireRenderedFrame(report.warmup.enabled, warmEnabledGeometry);
  requireRenderedFrame(report.warmup.disabled, warmDisabledGeometry);
  for (const cycle of report.cycles) {
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
  };
}

export function assertCctvCheckpoint(
  checkpoint,
  { expectedTaskErrors = null } = {},
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
