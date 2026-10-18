export function readQualificationStateInPage({ checkpointValue, profileValue }) {
    const app = window.__godsEyeView;
    const tuning = app?.styleManager?.services?.getDetectionTuning?.() || {};
    const settings = {
      qualityMode: app?.styleManager?._adaptiveQuality?.getMode?.() || null,
      densityPct: Number.isFinite(tuning.densityPct) ? tuning.densityPct : null,
      detectionMode: app?.styleManager?.services?.getDetectionMode?.() || null,
      resolutionScale: app?.viewer?.resolutionScale ?? null,
      antialias: app?.viewer?.scene?.context?._gl?.getContextAttributes?.()?.antialias ?? null,
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
      cctvParams: app?.dataManager?.layers?.get('cctv')?.module?.getParams?.() || null,
      cctvDiagnostics: app?.dataManager?.layers?.get('cctv')?.module?.getPerformanceDiagnostics?.() || null,
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
`n

