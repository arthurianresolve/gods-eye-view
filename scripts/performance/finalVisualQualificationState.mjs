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
