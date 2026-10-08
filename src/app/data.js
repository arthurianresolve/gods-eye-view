import { LayerLifecycle } from '../data/lifecycle.js';
import { LayerPresentation } from './layerPresentation.js';
import { createCyberSonarScene } from '../cyberSonarScene.js';
/** Register the application layer catalog before allowing state restoration. */
export function createApplicationData({
  scene: { viewer, mapStackController },
  controls: { styleManager },
  catalog,
  allowQaRegistration,
  onData,
  defer,
}) {
  // Initialize data layer manager
  const dataManager = new LayerLifecycle(viewer, {
    allowQaRegistration,
  });
  defer(async () => {
    await dataManager.destroyAll();
    if (dataManager.layers.size)
      throw new Error(
        `Data layers could not be destroyed: ${[...dataManager.layers.keys()].join(', ')}`,
      );
  });
  const timeCapabilityRemovers = [];
  for (const layer of catalog.layers) {
    if (typeof layer.getAnalystRecords !== 'function') continue;
    const readLive = () => {
      const current = dataManager
        .getAll()
        .find((record) => record.id === layer.id);
      const stats = current?.stats || {};
      return {
        sampleTimeMs: Number.isFinite(stats.lastUpdate)
          ? stats.lastUpdate
          : null,
        feedStatus: String(stats.status || 'unknown'),
        recordCount: Number.isFinite(stats.count) ? stats.count : 0,
      };
    };
    if (typeof layer.attachInvestigationTime === 'function') continue;
    if (layer.id === 'flights' && catalog.aircraftSource) {
      timeCapabilityRemovers.push(
        catalog.aircraftSource.attachCapabilities(catalog.timeCapabilities, {
          readLive,
        }),
      );
      continue;
    }
    if (layer.id === 'ais-live-vessels' && catalog.vesselSource) {
      timeCapabilityRemovers.push(
        catalog.vesselSource.attachCapabilities(catalog.timeCapabilities, {
          layerId: 'ais-live-vessels',
          readLive,
        }),
      );
      continue;
    }
    timeCapabilityRemovers.push(
      catalog.timeCapabilities?.register({
        id: layer.id,
        mode: 'live',
        label: layer.name || layer.id,
        readLive,
      }) || (() => {}),
    );
  }
  if (timeCapabilityRemovers.length)
    defer(() => {
      for (const remove of timeCapabilityRemovers.reverse()) remove();
    });
  const presentation = new LayerPresentation(dataManager, {
    weatherClock: catalog?.weatherClock,
    investigationTime: catalog?.investigationTime,
    aircraftSource: catalog?.aircraftSource,
    vesselSource: catalog?.vesselSource,
    timelineArbiter: catalog?.timelineArbiter,
    workspaceStorage: catalog?.workspaceStorage,
    recordingService: catalog?.aircraftRecording,
    vesselRecordingService: catalog?.vesselRecording,
  });
  defer(() => presentation.destroy());
  onData?.(dataManager);
  if (!catalog?.layers || !catalog?.metadata)
    throw new TypeError('An application layer catalog is required');
  const investigationTimeRemovers = [];
  for (const layer of catalog.layers) {
    if (typeof layer.attachInvestigationTime !== 'function') continue;
    const remove = layer.attachInvestigationTime(
      catalog.investigationTime,
      catalog.timeCapabilities,
    );
    if (typeof remove === 'function') investigationTimeRemovers.push(remove);
  }
  if (investigationTimeRemovers.length)
    defer(() => {
      for (const remove of investigationTimeRemovers.reverse()) remove();
    });
  for (const layer of catalog.layers) dataManager.register(layer);
  for (const layer of catalog.layers) layer.attachDataManager?.(dataManager);
  for (const layer of catalog.layers)
    layer.attachMapStackController?.(mapStackController);
  // Restoration starts only after the caller's complete registry is sealed.
  dataManager.finalizeRegistrations(catalog.metadata);
  if (allowQaRegistration) {
    window.__gevQaRegisterLayer = (targetManager, layerModule) => {
      if (targetManager !== dataManager)
        throw new Error('QA layer manager mismatch');
      return dataManager.registerForQa(layerModule);
    };
    window.__gevQaUnregisterLayer = (targetManager, layerId) => {
      if (targetManager !== dataManager)
        throw new Error('QA layer manager mismatch');
      return dataManager.unregisterForQa(layerId);
    };
    const register = window.__gevQaRegisterLayer;
    const unregister = window.__gevQaUnregisterLayer;
    defer(() => {
      if (window.__gevQaRegisterLayer === register)
        delete window.__gevQaRegisterLayer;
      if (window.__gevQaUnregisterLayer === unregister)
        delete window.__gevQaUnregisterLayer;
    });
  }
  presentation.mount(document.getElementById('data-toggles'));
  styleManager.attachDataManager(dataManager);
  defer(createCyberSonarScene(viewer, dataManager));

  return {
    dataManager,
    catalog,
    presentation,
    investigationTime: catalog.investigationTime,
    timeCapabilities: catalog.timeCapabilities,
    timelineArbiter: catalog.timelineArbiter,
    workspaceStorage: catalog.workspaceStorage,
    aircraftSource: catalog.aircraftSource,
    aircraftRecording: catalog.aircraftRecording,
    recordingRecovery: catalog.recordingRecovery,
    vesselSource: catalog.vesselSource,
    vesselRecording: catalog.vesselRecording,
    vesselRecordingRecovery: catalog.vesselRecordingRecovery,
  };
}
