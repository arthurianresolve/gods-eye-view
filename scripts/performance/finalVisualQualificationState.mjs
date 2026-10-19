/** Select only after the real globe surface is ready for the activation ray. */
export async function activateQualificationCctvInPage(cameraId) {
  const app = window.__godsEyeView;
  const manager = app?.dataManager;
  const style = app?.styleManager;
  // The production activation samples obstruction geometry once. Waiting after
  // activation cannot correct a range latched from an unfinished terrain tile.
  if (app?.viewer?.scene?.globe?.tilesLoaded !== true)
    throw new Error('Globe surface must be loaded before CCTV activation.');
  const result = await manager?.setEnabled?.('cctv', true, {
    origin: 'qa-final-visual',
  });
  if (result === false || !manager?.isEnabled?.('cctv'))
    throw new Error('CCTV could not be enabled.');
  const module = manager.layers.get('cctv')?.module;
  if (!module?.setParams)
    throw new Error(
      'CCTV fixture camera/projection selection API is unavailable.',
    );
  module.setParams({
    selectedCameraId: cameraId,
    showProjection: true,
    autoHop: false,
  });
  const params = module.getParams?.();
  if (params?.selectedCameraId !== cameraId || params.showProjection !== true)
    throw new Error('CCTV fixture still projection did not settle selected.');
  if (
    style?._adaptiveQuality?.getMode?.() !== 'manual' ||
    style?.services?.getDetectionMode?.() !== 'DENSE' ||
    style?.services?.getDetectionTuning?.()?.densityPct !== 75
  )
    throw new Error('Manual DENSE 75% settings did not settle.');
  return { tilesLoadedBeforeActivation: true, cameraId };
}

export function readQualificationStateInPage({
  checkpointValue,
  profileValue,
}) {
  const app = window.__godsEyeView;
  const tuning = app?.styleManager?.services?.getDetectionTuning?.() || {};
  const settings = {
    qualityMode: app?.styleManager?._adaptiveQuality?.getMode?.() || null,
    densityPct: Number.isFinite(tuning.densityPct) ? tuning.densityPct : null,
    detectionMode: app?.styleManager?.services?.getDetectionMode?.() || null,
    resolutionScale: app?.viewer?.resolutionScale ?? null,
    antialias:
      app?.viewer?.scene?.context?._gl?.getContextAttributes?.()?.antialias ??
      null,
    msaaSamples: app?.viewer?.scene?.msaaSamples ?? null,
    fxaa: app?.viewer?.scene?.postProcessStages?.fxaa?.enabled ?? null,
    visualState: app?.styleManager?.getVisualState?.() || null,
  };
  const visual = app?.styleManager?.getVisualState?.() || null;
  const hud = app?.styleManager?.hud;
  const hudElement = document.getElementById('intel-hud');
  return {
    checkpoint: checkpointValue,
    settings,
    visualState: visual,
    cctvParams:
      app?.dataManager?.layers?.get('cctv')?.module?.getParams?.() || null,
    cctvDiagnostics:
      app?.dataManager?.layers
        ?.get('cctv')
        ?.module?.getPerformanceDiagnostics?.() || null,
    populations: {
      cctv: checkpointValue.cameraCount,
      entities: checkpointValue.scene.entities,
      dataSources: checkpointValue.scene.dataSources,
    },
    camera: checkpointValue.cameraPose,
    hud: {
      mode: hud?.getMode?.() || null,
      visible: visual?.hud?.visible === true,
      variant: hud?.getVariant?.() || null,
      ariaHidden: hudElement?.getAttribute('aria-hidden') || null,
      display: hudElement ? getComputedStyle(hudElement).display : null,
      visibility: hudElement ? getComputedStyle(hudElement).visibility : null,
    },
    timestampMs: Date.now(),
    profile: profileValue,
  };
}

/** Self-contained predicate, evaluated immediately before the debugger statement. */
export function isVisualSnapshotReadyToPause(snapshot) {
  const hud = snapshot?.hud;
  return Boolean(
    snapshot?.phase === 0 &&
    snapshot.reason === null &&
    hud?.recordingVisible === true &&
    hud.summaryTypingComplete === true &&
    typeof hud.summary === 'string' &&
    hud.summary.length > 0 &&
    hud.documentVisible === true &&
    hud.documentFocused === true &&
    hud.gaze?.status === 'ready' &&
    hud.hudDisplay !== 'none' &&
    Number.isFinite(hud.hudOpacity) &&
    (hud.hudVisible === true
      ? hud.hudVisibility === 'visible' && hud.hudOpacity >= 0.999
      : hud.hudVisible === false &&
        hud.hudVisibility === 'hidden' &&
        hud.hudOpacity <= 0.001),
  );
}

/** Bounded diagnostics from the same read used by the atomic pause guard. */
export function describeVisualPauseReadiness(snapshot) {
  const hud = snapshot?.hud;
  return {
    phase: snapshot?.phase ?? null,
    reason:
      typeof snapshot?.reason === 'string'
        ? snapshot.reason.slice(0, 120)
        : null,
    recordingVisible: hud?.recordingVisible === true,
    summaryTypingComplete: hud?.summaryTypingComplete === true,
    summaryPresent: typeof hud?.summary === 'string' && hud.summary.length > 0,
    documentVisible: hud?.documentVisible === true,
    documentFocused: hud?.documentFocused === true,
    gazeReady: hud?.gaze?.status === 'ready',
    hudVisible: typeof hud?.hudVisible === 'boolean' ? hud.hudVisible : null,
    hudVisibility:
      typeof hud?.hudVisibility === 'string'
        ? hud.hudVisibility.slice(0, 20)
        : null,
    hudDisplay:
      typeof hud?.hudDisplay === 'string' ? hud.hudDisplay.slice(0, 20) : null,
    hudOpacity: Number.isFinite(hud?.hudOpacity) ? hud.hudOpacity : null,
  };
}

/**
 * A settled demand-rendered scene can retain scanline phase 2 indefinitely.
 * Ask for one fresh frame when needed; waiting on a read-only phase check cannot
 * advance that canvas. This does not change clocks, settings, or render holds.
 */
export function requestVisualGuardFrame(snapshot) {
  if (snapshot?.phase !== 2 || snapshot.hud?.documentVisible !== true)
    return false;
  const scene = window.__godsEyeView?.viewer?.scene;
  if (typeof scene?.requestRender !== 'function')
    throw new Error('Visual guard cannot request its next completed frame.');
  scene.requestRender();
  return true;
}

/** Read-only paused-frame evidence for the detection scanline phase. */
export function readVisualSnapshotPhaseInPage({ expectedHudVisible } = {}) {
  const boundary = window.__gevVisualPresentationBoundary?.read?.();
  const canvas = document.getElementById('world-overlay-detection-surface');
  const rect = canvas?.getBoundingClientRect?.();
  const context = canvas?.getContext?.('2d');
  if (!boundary || !canvas || !rect || !context)
    throw new Error('Visual snapshot phase surfaces are unavailable.');
  const dprX = canvas.width / rect.width;
  const dprY = canvas.height / rect.height;
  if (
    !Number.isFinite(dprX) ||
    !Number.isFinite(dprY) ||
    dprX <= 0 ||
    dprY <= 0 ||
    Math.abs(dprX - dprY) > 0.01
  )
    throw new Error('Visual snapshot phase dimensions are unavailable.');
  const dpr = dprX;
  const rows = [];
  for (let cssRow = 0; cssRow < 8; cssRow++) {
    const pixelRow = Math.floor(cssRow * dpr);
    if (pixelRow >= canvas.height) break;
    const left = context.getImageData(0, pixelRow, 1, 1).data;
    const right = context.getImageData(
      Math.max(0, canvas.width - 1),
      pixelRow,
      1,
      1,
    ).data;
    rows.push({
      cssRow,
      pixelRow,
      leftAlpha: left[3],
      rightAlpha: right[3],
    });
  }
  const leftRows = rows
    .filter((row) => row.leftAlpha > 0)
    .map((row) => row.cssRow);
  const rightRows = rows
    .filter((row) => row.rightAlpha > 0)
    .map((row) => row.cssRow);
  const sameEdges =
    rows.length === 8 &&
    JSON.stringify(leftRows) === JSON.stringify(rightRows) &&
    (leftRows.join(',') === '0,4' || leftRows.join(',') === '2,6');
  const phase = sameEdges ? (leftRows[0] === 0 ? 0 : 2) : null;
  const hudSettled =
    expectedHudVisible === undefined ||
    boundary.hudVisible === expectedHudVisible;
  return {
    hud: boundary,
    phase,
    reason: !hudSettled
      ? 'hud-state-unsettled'
      : phase === null
        ? 'scanline-phase-unavailable'
        : null,
    alphaRows: rows,
    dimensions: {
      cssWidth: rect.width,
      cssHeight: rect.height,
      width: canvas.width,
      height: canvas.height,
      dpr,
    },
  };
}

/**
 * Wait for stable CCTV layout/scroll state over completed Cesium renders and
 * the browser layout frame that follows each render. This is capture
 * readiness only; it does not change application state or accept pixels.
 */
export async function waitForVisualReadinessInPage({
  expectedHudVisible,
  pointer = { x: 1, y: 1 },
  timeoutMs = 5000,
  stableRenders = 2,
} = {}) {
  const scene = window.__godsEyeView?.viewer?.scene;
  const boundary = window.__gevVisualPresentationBoundary;
  if (
    !scene?.postRender?.addEventListener ||
    typeof scene.requestRender !== 'function' ||
    typeof boundary?.read !== 'function' ||
    !Number.isSafeInteger(stableRenders) ||
    stableRenders < 2 ||
    !Number.isFinite(timeoutMs) ||
    timeoutMs <= 0
  )
    throw new Error('Visual readiness observer is unavailable.');

  const startedAt = performance.now();
  const deadline = startedAt + timeoutMs;
  let previousSignature = null;
  let consecutive = 0;
  let completedRenders = 0;
  let lastProof = null;
  let lastFrame = null;
  let previousFrameNumber = null;
  let reason = 'scroll-layout-not-stable';

  while (performance.now() < deadline) {
    const remaining = Math.max(1, deadline - performance.now());
    const frame = await new Promise((resolve) => {
      let timer;
      let removeListener;
      let settled = false;
      const finish = (value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        removeListener?.();
        resolve(value);
      };
      const listener = () =>
        finish({
          status: 'rendered',
          frameNumber: Number.isSafeInteger(scene.frameState?.frameNumber)
            ? scene.frameState.frameNumber
            : null,
          elapsedMs: performance.now() - startedAt,
        });
      try {
        const remove = scene.postRender.addEventListener(listener);
        removeListener =
          typeof remove === 'function'
            ? remove
            : () => scene.postRender.removeEventListener(listener);
        timer = setTimeout(
          () => finish({ status: 'render-timeout' }),
          remaining,
        );
        scene.requestRender();
      } catch {
        finish({ status: 'render-request-failed' });
      }
    });
    if (frame.status !== 'rendered') {
      reason =
        frame.status === 'render-request-failed'
          ? 'render-request-failed'
          : 'completed-render-timeout';
      break;
    }
    completedRenders++;
    lastFrame = frame;
    if (!Number.isSafeInteger(frame.frameNumber)) {
      reason = 'render-frame-number-unavailable';
      previousSignature = null;
      consecutive = 0;
      continue;
    }
    if (
      previousFrameNumber !== null &&
      frame.frameNumber <= previousFrameNumber
    ) {
      reason = 'render-frame-number-not-advanced';
      previousSignature = null;
      consecutive = 0;
      continue;
    }
    previousFrameNumber = frame.frameNumber;
    let layoutTimer = null;
    let layoutFrameHandle = null;
    const layoutFrameResult = await new Promise((resolve) => {
      let settled = false;
      const finish = (value) => {
        if (settled) return;
        settled = true;
        if (layoutTimer !== null) clearTimeout(layoutTimer);
        if (layoutFrameHandle !== null) cancelAnimationFrame(layoutFrameHandle);
        resolve(value);
      };
      const remaining = Math.max(1, deadline - performance.now());
      try {
        layoutTimer = setTimeout(() => finish('timeout'), remaining);
        layoutFrameHandle = requestAnimationFrame(() => finish('rendered'));
      } catch {
        finish('request-failed');
      }
    });
    if (layoutFrameResult !== 'rendered') {
      reason =
        layoutFrameResult === 'request-failed'
          ? 'browser-layout-frame-request-failed'
          : 'browser-layout-frame-timeout';
      break;
    }
    const proof = boundary.read();
    lastProof = proof;
    const containers = proof?.scrollContainers;
    if (
      !Array.isArray(containers) ||
      containers.length !== 3 ||
      containers[0]?.present !== true ||
      containers[1]?.present !== true
    ) {
      reason = 'cctv-scroll-surfaces-unavailable';
      previousSignature = null;
      consecutive = 0;
      continue;
    }
    if (
      proof?.pointer?.x !== pointer.x ||
      proof?.pointer?.y !== pointer.y ||
      proof?.pointer?.pointerType !== 'mouse'
    ) {
      reason = 'fixed-pointer-position-unobserved';
      previousSignature = null;
      consecutive = 0;
      continue;
    }
    if (proof?.gaze?.status !== 'ready') {
      reason = proof?.gaze?.status || 'logo-gaze-not-settled';
      previousSignature = null;
      consecutive = 0;
      continue;
    }
    if (
      proof?.hudVisible !== expectedHudVisible ||
      proof?.hudDisplay === 'none' ||
      proof?.hudVisibility !== (expectedHudVisible ? 'visible' : 'hidden') ||
      !Number.isFinite(proof?.hudOpacity) ||
      (expectedHudVisible
        ? proof.hudOpacity < 0.999
        : proof.hudOpacity > 0.001) ||
      proof?.recordingVisible !== true ||
      proof?.summaryTypingComplete !== true ||
      !proof?.summary ||
      proof?.documentVisible !== true ||
      proof?.documentFocused !== true ||
      !proof?.activeElement ||
      typeof proof.activeElement.tagName !== 'string' ||
      typeof proof.activeElement.id !== 'string' ||
      typeof proof.activeElement.className !== 'string'
    ) {
      reason = 'hud-or-document-not-settled';
      previousSignature = null;
      consecutive = 0;
      continue;
    }
    const signature = JSON.stringify({
      revision: proof.revision,
      hudVisible: proof.hudVisible,
      hudOpacity: proof.hudOpacity,
      hudVisibility: proof.hudVisibility,
      hudDisplay: proof.hudDisplay,
      summary: proof.summary,
      scrollContainers: containers,
      pointer: proof.pointer,
      gaze: proof.gaze,
      activeElement: proof.activeElement,
    });
    if (signature === previousSignature) consecutive++;
    else consecutive = 1;
    previousSignature = signature;
    reason = 'scroll-layout-not-stable';
    if (consecutive >= stableRenders)
      return {
        status: 'ready',
        consecutiveStableRenders: consecutive,
        completedRenders,
        completedRender: lastFrame,
        proof,
      };
  }
  return {
    status: 'not-ready',
    reason,
    consecutiveStableRenders: consecutive,
    completedRenders,
    completedRender: lastFrame,
    proof: lastProof,
  };
}
