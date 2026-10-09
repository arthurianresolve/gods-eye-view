import { SceneDirector } from '../scenes/director.js';
import * as Cesium from 'cesium';
import { createAnalystEngine } from '../data/analystEngine.js';
import { layerSnapshot } from '../data/layerSnapshot.js';
import { createWorkspaceLibraryPanel } from '../ui/workspaceLibrary.js';
import {
  createCommandPalette,
  createWorkflowLayoutManager,
} from '../ui/commandPalette.js';
import { createImportedGeometryLayer } from '../imports/runtimeLayer.js';
import { createDiagnosticsPanel } from '../ui/diagnosticsPanel.js';
import { loadStoredErrors } from '../voice/realtimeDiagnostics.js';
import { initAnnotations } from '../annotations/index.js';
import { initDrawTool } from '../annotations/drawTool.js';
import { initImageryBoxTool } from '../ui/imageryBoxTool.js';
import { createRecentImageryPanel } from '../ui/recentImagery.js';
import { initGevVoiceCommands } from '../voice/gevRealtime.js';
import { installViews, isEmbeddedInline } from './embed.js';
import { installScopeMask, destroyScopeMask } from '../scopeMask.js';
import {
  installRenderGovernor,
  getRenderGovernorDiagnostics,
  governorRequestRender,
  holdContinuousRender,
  releaseContinuousRender,
} from '../renderGovernor.js';
import {
  createPerformanceMonitor,
  readPerformanceEnvironment,
} from '../performance/performanceSnapshot.js';
import { getWorldOverlayDiagnostics } from '../overlays/worldOverlay.js';

/** Attach scene tools, rendering listeners and the application debug handle. */
export async function createApplicationTools({
  scene,
  controls,
  data,
  loadingScreen,
  placeSearch,
  voice = {},
  startChrome,
  onSceneDirector,
  sceneDataPacks,
  signal,
  defer,
}) {
  const { viewer, tileset, mapStackController, operations } = scene;
  const { styleManager, weatherEffects, cockpitCloudEffects } = controls;
  const {
    dataManager,
    investigationTime,
    timeCapabilities,
    timelineArbiter,
    workspaceStorage,
    aircraftSource,
    aircraftRecording,
    recordingRecovery,
    vesselSource,
    vesselRecording,
    vesselRecordingRecovery,
  } = data;
  const sceneDirector = new SceneDirector(viewer, styleManager, dataManager, {
    dataPacks: sceneDataPacks,
    workspaceStorage,
    timelineArbiter,
    isMapStackAvailable: (id) =>
      mapStackController?.isStackAvailable(id) === true,
  });
  defer(() => sceneDirector.destroy());
  await sceneDirector.restorePersistedProject({ signal });
  signal.throwIfAborted();
  const importedGeometryLayer = createImportedGeometryLayer({ viewer });
  defer(() => importedGeometryLayer.destroy());
  const analystEngine = createAnalystEngine({
    now: () => investigationTime?.now?.() ?? Date.now(),
    getTemporalContext: () => ({
      ...(investigationTime?.getState?.() || {}),
      ...(investigationTime?.getTemporalContext?.() || {}),
    }),
    getRecords(layerKey) {
      const row = dataManager.layers.get(layerKey);
      if (!row || !dataManager.isEnabled(layerKey)) return [];
      const values = row.module?.getAnalystRecords?.(250_001) || [];
      return values.length > 250_000 ? values.slice(0, 250_000) : values;
    },
    getRecordCoverage(layerKey, records) {
      const stats =
        dataManager.layers.get(layerKey)?.module?.getStats?.() || {};
      const total = Number(stats.count);
      return Number.isFinite(total) && total > records.length
        ? { total, truncated: true }
        : { total: records.length };
    },
    getLayerSnapshot(layerKey) {
      const row = dataManager.getAll?.().find((layer) => layer.id === layerKey);
      const module = dataManager.layers.get(layerKey)?.module;
      return layerSnapshot(
        row || {
          id: layerKey,
          enabled: dataManager.isEnabled(layerKey),
          stats: module?.getStats?.() || {},
        },
      );
    },
    getViewContext() {
      const cartographic = Cesium.Ellipsoid.WGS84.cartesianToCartographic(
        viewer.camera.positionWC || viewer.camera.position,
      );
      return {
        lat: Cesium.Math.toDegrees(cartographic?.latitude || 0),
        lon: Cesium.Math.toDegrees(cartographic?.longitude || 0),
        viewRadiusKm: Math.max(
          25,
          Math.min(1000, (cartographic?.height || 100_000) / 1000),
        ),
      };
    },
    resolveRegionRing: (name, querySignal) =>
      operations.annotationResolver.resolveRegionRingForQuery(
        name,
        querySignal,
        placeSearch,
      ),
  });
  const workspaceLibraryPanel = createWorkspaceLibraryPanel({
    container: document.querySelector('#scene-panel .scene-panel-inner'),
    storage: workspaceStorage,
    shareLinkManager: styleManager.shareLinkManager,
    shareRestoration: styleManager._shareRestoration,
    navigation: styleManager._navigation,
    analystEngine,
    onImportedData: (imports, options) =>
      importedGeometryLayer.load(imports, options),
  });
  defer(() => workspaceLibraryPanel.destroy());
  const diagnosticsPanel = createDiagnosticsPanel({
    container: document.querySelector('#scene-panel .scene-panel-inner'),
    async collect() {
      const estimate = await navigator.storage?.estimate?.().catch(() => null);
      const storageState = await workspaceStorage.getAvailability?.();
      const context = viewer.scene.context;
      const gl = context?._gl;
      let renderer = context?.webgl2 ? 'WebGL2' : 'WebGL';
      try {
        const extension = gl?.getExtension('WEBGL_debug_renderer_info');
        if (extension)
          renderer =
            gl.getParameter(extension.UNMASKED_RENDERER_WEBGL) || renderer;
      } catch {
        /* renderer detail is optional */
      }
      return {
        appVersion: '0.2.1',
        renderer,
        capabilities: {
          webgl2: Boolean(context?.webgl2),
          indexedDb: typeof indexedDB !== 'undefined',
          secureContext: globalThis.isSecureContext === true,
          online: navigator.onLine !== false,
          webCrypto: Boolean(globalThis.crypto?.subtle),
        },
        storage: {
          usageBytes: estimate?.usage,
          quotaBytes: estimate?.quota,
          availability:
            storageState?.status || storageState?.mode || 'indexeddb',
        },
        feeds: (dataManager.getAll?.() || []).map((layer) => ({
          id: layer.id,
          enabled: layer.enabled,
          state: layer.stats?.feedState || layer.stats?.status,
          source: layer.stats?.source || layer.source,
          latencyMs: layer.stats?.latencyMs,
          retrying: layer.stats?.retrying,
          error: layer.stats?.error || layer.stats?.lastError,
        })),
        errors: loadStoredErrors(),
      };
    },
    getSettings() {
      const view = styleManager.shareLinkManager.getCurrentView() || {};
      const visualKeys = [
        'style',
        'map',
        'bloom',
        'sharpen',
        'bloomIntensity',
        'sharpenIntensity',
        'hudVariant',
        'hudVisible',
        'detectionMode',
        'detectionDensity',
        'detectionAllocation',
        'detectionFadePct',
        'detectionOutsideOpacityPct',
        'celestialRing',
        'scopeEnabled',
        'scopeFeatherPct',
        'scopeTerminusPct',
        'mapStack',
      ];
      let units = {};
      try {
        units = JSON.parse(localStorage.getItem('gev:units:v1') || '{}');
      } catch {
        /* malformed preference is ignored */
      }
      return {
        units,
        sourceSelections: view.layers || [],
        visualPreferences: Object.fromEntries(
          visualKeys
            .filter((key) => key in view)
            .map((key) => [key, view[key]]),
        ),
      };
    },
    async applySettings(settings) {
      const manager = styleManager.shareLinkManager;
      const previousView = manager.getCurrentView();
      let previousUnits = null;
      try {
        previousUnits = localStorage.getItem('gev:units:v1');
      } catch {
        /* unavailable storage */
      }
      if (!previousView)
        throw new Error('The current view is not ready to apply settings.');
      try {
        await manager.applyView({
          ...previousView,
          layers: settings.sourceSelections,
          ...settings.visualPreferences,
        });
        localStorage.setItem('gev:units:v1', JSON.stringify(settings.units));
        window.dispatchEvent(
          new CustomEvent('gev:settings-restored', {
            detail: { units: settings.units },
          }),
        );
      } catch (error) {
        try {
          await manager.applyView(previousView);
        } catch {
          /* preserve the original failure */
        }
        try {
          if (previousUnits == null) localStorage.removeItem('gev:units:v1');
          else localStorage.setItem('gev:units:v1', previousUnits);
        } catch {
          /* storage can be unavailable */
        }
        throw error;
      }
    },
  });
  defer(() => diagnosticsPanel.destroy());
  const workflowLayouts = createWorkflowLayoutManager({ styleManager });
  const commandPalette = createCommandPalette({
    context: {
      dataManager,
      investigationTime,
      workspaceLibraryPanel,
      sceneDirector,
      diagnosticsPanel,
      workflowLayouts,
      styleManager,
      workspaceStorage,
    },
    commands: [
      {
        label: 'Save workspace',
        description: 'Save the current view as an investigation',
        keywords: 'investigation persist',
        availability: (context) =>
          context.workspaceStorage
            ? true
            : {
                available: false,
                reason: 'Workspace storage is not initialized',
              },
        run: (context) => context.workspaceLibraryPanel.saveCurrent(),
      },
      {
        label: 'Open workspace library',
        description: 'Reopen, duplicate, import or recover an investigation',
        keywords: 'open import recover',
        run: (context) => context.workspaceLibraryPanel.openLibrary(),
      },
      {
        label: 'Show synthetic offline demo',
        description:
          'Create a clearly labeled local demo with no network source',
        keywords: 'demo offline example synthetic first use',
        run: (context) => context.workspaceLibraryPanel.showOfflineDemo(),
      },
      {
        label: 'Undo scene authoring change',
        description: 'Restore the previous Director scene project revision',
        keywords: 'director scene edit undo',
        availability: (context) =>
          context.sceneDirector?.canUndoAuthoring?.()
            ? true
            : {
                available: false,
                reason: 'No saved scene edit can be undone right now',
              },
        run: (context) => context.sceneDirector.undoAuthoring(),
      },
      {
        label: 'Redo scene authoring change',
        description: 'Reapply a Director scene project revision',
        keywords: 'director scene edit redo',
        availability: (context) =>
          context.sceneDirector?.canRedoAuthoring?.()
            ? true
            : {
                available: false,
                reason: 'No scene edit can be redone right now',
              },
        run: (context) => context.sceneDirector.redoAuthoring(),
      },
      {
        label: 'Undo authored change',
        description: 'Restore the previous saved annotation or authored view',
        keywords: 'revert edit mark drawing',
        availability: (context) =>
          context.workspaceLibraryPanel.canUndo()
            ? true
            : {
                available: false,
                reason: 'No authored workspace change to undo',
              },
        run: (context) => context.workspaceLibraryPanel.undo(),
      },
      {
        label: 'Redo authored change',
        description: 'Reapply the next authored workspace change',
        keywords: 'reapply edit mark drawing',
        availability: (context) =>
          context.workspaceLibraryPanel.canRedo()
            ? true
            : {
                available: false,
                reason: 'No authored workspace change to redo',
              },
        run: (context) => context.workspaceLibraryPanel.redo(),
      },
      ...['explore', 'investigate', 'director'].map((layout) => ({
        label: `${layout[0].toUpperCase()}${layout.slice(1)} layout`,
        description: `Show the ${layout} workflow panels`,
        keywords: 'workflow panels',
        run: (context) => context.workflowLayouts.apply(layout),
      })),
      {
        label: 'Restore previous panel layout',
        description: 'Leave a temporary workflow layout',
        availability: (context) =>
          context.workflowLayouts.active
            ? true
            : {
                available: false,
                reason: 'No temporary workflow layout is active',
              },
        run: (context) => context.workflowLayouts.restore(),
      },
      {
        label: 'Return timeline to live',
        description: 'Switch aircraft and vessel time back to current feeds',
        keywords: 'time replay now',
        availability: (context) =>
          context.investigationTime
            ? true
            : { available: false, reason: 'Investigation time is unavailable' },
        run: (context) => context.investigationTime.returnLive(),
      },
      {
        label: 'Clear selected data layers',
        description: 'Turn off the currently selected data layers',
        keywords: 'remove hide data',
        run: (context) => context.styleManager.clearSelectedLayers(),
      },
      {
        label: 'Reset to full globe',
        description: 'Return to the full globe camera view',
        keywords: 'camera home world',
        run: (context) => context.styleManager.resetToGlobeView(),
      },
      {
        label: 'Open evidence inspector',
        description: 'Show source, observation time and coverage details',
        keywords: 'inspect provenance evidence',
        run: (context) =>
          context.styleManager.setPanelCollapsed('evidence-panel', false, {
            persist: false,
            syncShare: false,
          }),
      },
    ],
  });
  defer(() => commandPalette.destroy());
  defer(() => workflowLayouts.destroy());
  dataManager.layers
    .get('bhote-koshi-2026')
    ?.module.attachSceneController(sceneDirector);
  onSceneDirector?.(sceneDirector);
  const annotations = initAnnotations({
    viewer,
    tileset,
    placeSearch,
    resolver: operations.annotationResolver,
  });
  defer(() => {
    if (window.__gevAnnotations === annotations) delete window.__gevAnnotations;
    annotations.destroy();
  });
  // DISPLAY ▸ Draw: the same whiteboard, drawn by hand. It claims the pointer
  // while a session is open, so its teardown belongs to the application
  // lifetime rather than to whoever last pressed the button.
  const drawTool = initDrawTool({ viewer, annotations });
  defer(() => drawTool?.destroy());
  // DATA ▸ Recent Imagery: the box tool claims the pointer like Draw and the
  // panel lives on the right rail, so both belong to the application
  // lifetime. The tileset lets the layer drape while the globe is hidden.
  const recentImagery = dataManager.layers.get('recent-imagery')?.module;
  if (recentImagery) {
    recentImagery.attachTileset(tileset);
    const imageryBoxTool = initImageryBoxTool({
      viewer,
      onBox: (box) => recentImagery.setBox(box),
      onCancel: (reason, message, box) => {
        if (message) recentImagery.reportBoxRefusal(message, box);
      },
      onActive: (active) => recentImagery.setToolActive(active),
      // The tool takes Escape in a capture listener, so the panel's order
      // (clear a preview before cancelling the tool) is applied here.
      onEscape: () => recentImagery.clearPreview(),
    });
    // The readout mounts in its rail body through the layer panel, like the
    // weather readout.
    data.presentation.attachRecentImagery((container) =>
      createRecentImageryPanel({
        container,
        viewer,
        layer: recentImagery,
        tool: imageryBoxTool,
      }),
    );
    // The live gate's handle (scripts/qa-recent-imagery.mjs).
    const recentImageryHandle = { layer: recentImagery, tool: imageryBoxTool };
    window.__gevRecentImagery = recentImageryHandle;
    defer(() => {
      if (window.__gevRecentImagery === recentImageryHandle)
        delete window.__gevRecentImagery;
      data.presentation.attachRecentImagery(null);
      imageryBoxTool?.destroy();
    });
  }
  if (startChrome)
    defer(startChrome({ loadingScreen, styleManager, dataManager, signal }));
  // Idle render governor: flips the scene into requestRenderMode whenever
  // nothing animates per frame. Installed AFTER every module above has had
  // its chance to register pre-install holds. (perf wave 2)
  installRenderGovernor(viewer);

  // Install the explicit scope mask used by the DISPLAY controls.
  installScopeMask(viewer);
  defer(() => destroyScopeMask());

  // The follow camera recomputes the tracked target's dead-reckon position
  // every frame — tracking anything is a per-frame animation. (perf wave 2)
  const removeTrackingListener = viewer.trackedEntityChanged.addEventListener(
    () => {
      if (viewer.trackedEntity) holdContinuousRender('tracked-entity');
      else releaseContinuousRender('tracked-entity');
    },
  );

  // Hidden-state suspension (perf wave 2): when the window/tab is hidden,
  // stop the default render loop outright — a hidden canvas repaints for
  // nobody, and browser rAF throttling still lets throttled frames burn
  // GPU. Holder/data state is untouched, so return is seamless: restore
  // the loop, refresh the one DOM surface we gated, render a frame.
  const syncVisibilitySuspension = () => {
    // A panel's host may report it hidden while it is on screen; the panel
    // keeps drawing itself (see keepPanelRendering in embed.js).
    const hidden = document.hidden && !isEmbeddedInline();
    viewer.useDefaultRenderLoop = !hidden;
    cockpitCloudEffects?.setSuspended?.(hidden);
    if (!hidden) {
      data.presentation.flushVisible();
      governorRequestRender('visibility-restore');
    }
  };
  document.addEventListener('visibilitychange', syncVisibilitySuspension);
  defer(() =>
    document.removeEventListener('visibilitychange', syncVisibilitySuspension),
  );
  defer(() => {
    removeTrackingListener();
    releaseContinuousRender('tracked-entity');
  });
  // Apply the CURRENT state too — bootstrap can complete while the tab is
  // already hidden, and waiting for the next transition would leave the
  // loop burning behind a hidden tab. (perf wave 2 fix)
  syncVisibilitySuspension();

  const performanceMonitor = createPerformanceMonitor({
    viewer,
    dataManager,
    appCommit:
      typeof __GEV_APP_COMMIT__ === 'string' ? __GEV_APP_COMMIT__ : null,
    readDiagnostics: getRenderGovernorDiagnostics,
    readTimings: () => {
      const overlay = getWorldOverlayDiagnostics?.() || {};
      return {
        overlayProjectionMs: overlay.projectionMs ?? null,
        overlayPlacementMs: overlay.solveMs ?? null,
        overlayPaintMs: overlay.paintMs ?? null,
      };
    },
    readSettings: () => {
      const view = styleManager.shareLinkManager?.getCurrentView?.() || {};
      const tuning = styleManager.services?.getDetectionTuning?.() || {};
      return {
        qualityMode: styleManager._adaptiveQuality?.getMode?.() || null,
        densityPct: Number.isFinite(tuning.densityPct)
          ? tuning.densityPct
          : null,
        detectionMode: styleManager.services?.getDetectionMode?.() || null,
        resolutionScale: view.resolutionScale ?? null,
        antialias: viewer.scene.context?.antialias ?? null,
      };
    },
  });
  defer(() => performanceMonitor.destroy());

  window.__godsEyeView = {
    viewer,
    styleManager,
    tileset,
    dataManager,
    investigationTime,
    timeCapabilities,
    timelineArbiter,
    workspaceStorage,
    aircraftSource,
    aircraftRecording,
    recordingRecovery,
    vesselSource,
    vesselRecording,
    vesselRecordingRecovery,
    sceneDirector,
    workspaceLibraryPanel,
    importedGeometryLayer,
    analystEngine,
    mapStackController,
    annotations,
    weatherEffects,
    cockpitCloudEffects,
    getRenderGovernorDiagnostics,
    surfaceServices: operations.surface,
    requestRender: governorRequestRender,
    getPerformanceEnvironment: () =>
      readPerformanceEnvironment({
        viewer,
        dataManager,
        appCommit:
          typeof __GEV_APP_COMMIT__ === 'string' ? __GEV_APP_COMMIT__ : null,
      }),
    getPerformanceSnapshot: (extra) => performanceMonitor.getSnapshot(extra),
  };
  const debug = window.__godsEyeView;
  defer(() => {
    if (window.__godsEyeView === debug) delete window.__godsEyeView;
  });
  const voiceCommands = initGevVoiceCommands({
    ...voice,
    floorServices: operations.surface.groundFloor,
    annotationResolver: operations.annotationResolver,
    searchNavigation: operations.searchAndFlyTo,
    signal,
    placeSearch,
    viewer,
    styleManager,
    dataManager,
    investigationTime,
    sceneDirector,
    annotations,
  });
  defer(() => {
    voiceCommands.stop({ removeUi: true });
    if (window.__gevVoiceCommands === voiceCommands)
      delete window.__gevVoiceCommands;
  });
  debug.voiceCommands = voiceCommands;
  defer(
    installViews({
      shell: styleManager,
      viewer,
      dataManager,
      run: (name, args) => voiceCommands.runner(name, args, { signal }),
      signal,
    }),
  );
  return { sceneDirector, annotations, voiceCommands };
}
