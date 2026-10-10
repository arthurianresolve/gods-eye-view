import * as Cesium from 'cesium';
import {
  MISSION_ORBIT_PATTERN_GROUPS,
  MISSION_ORBIT_DASHES_PER_GROUP,
} from './policy.js';

export function createOrbitRendering({
  state: layerState,
  services,
  parts,
  source,
}) {
  const { orbitFrameModelMatrix } = services.satellites;
  const makeOrbitDemand =
    services.render?.registerRenderDemand ||
    (() => ({ schedule: () => () => {}, invalidate() {}, dispose() {} }));
  let orbitDemand = makeOrbitDemand('rocket-launches-orbit-cadence');
  let orbitCadenceActive = false;
  let cancelOrbitWake = () => {};
  let orbitGeneration = 0;
  let lastOrbitUpdateMs = null;

  /**
   * Register the selected-orbit tactical material once. Each group begins with
   * one compact round dot followed by one hundred short dashes.
   */

  function ensureMissionOrbitPatternRegistered() {
    if (layerState._missionOrbitPatternRegistered) return;
    new Cesium.Material({
      fabric: {
        type: 'GevMissionOrbitTactical',
        uniforms: {
          color: Cesium.Color.CYAN,
          groupCount: MISSION_ORBIT_PATTERN_GROUPS,
          dashCount: MISSION_ORBIT_DASHES_PER_GROUP,
        },
        source: `
        czm_material czm_getMaterial(czm_materialInput materialInput) {
          czm_material material = czm_getDefaultMaterial(materialInput);
          float groupPosition = fract(materialInput.st.s * groupCount);
          float markPosition = groupPosition * (dashCount + 1.0);
          float markIndex = floor(markPosition);
          float localPosition = fract(markPosition);
          float centerDistance = abs(localPosition - 0.5);
          float edge = max(fwidth(localPosition) * 1.35, 0.012);
          float dashAlong = 1.0 - smoothstep(0.27 - edge, 0.27 + edge, centerDistance);
          float dashAcross = 1.0 - smoothstep(0.12, 0.24, abs(materialInput.st.t - 0.5));
          float dash = dashAlong * dashAcross;
          float dotAlong = (localPosition - 0.5) / 0.32;
          float dotAcross = (materialInput.st.t - 0.5) / 0.5;
          float dot = 1.0 - smoothstep(0.78, 1.0, length(vec2(dotAlong, dotAcross)));
          float isDot = 1.0 - step(0.5, markIndex);
          float visible = mix(dash, dot, isDot);
          material.diffuse = color.rgb;
          material.emission = color.rgb * mix(0.07, 0.65, isDot);
          material.alpha = color.a * visible * mix(0.58, 1.0, isDot);
          return material;
        }`,
      },
    });
    layerState._missionOrbitPatternRegistered = true;
  }

  function createMissionOrbitPatternMaterial(color) {
    ensureMissionOrbitPatternRegistered();
    return Cesium.Material.fromType('GevMissionOrbitTactical', {
      color,
      groupCount: MISSION_ORBIT_PATTERN_GROUPS,
      dashCount: MISSION_ORBIT_DASHES_PER_GROUP,
    });
  }

  function missionOrbitPrimitiveVisible(launchId) {
    return Boolean(
      layerState._enabled &&
      layerState._dataSource?.show &&
      (!layerState._selectedLaunchId ||
        layerState._selectedLaunchId === launchId),
    );
  }

  function syncMissionOrbitPrimitiveVisibility() {
    for (const [launchId, path] of layerState._missionOrbitPrimitives) {
      if (path.primitive)
        path.primitive.show = missionOrbitPrimitiveVisible(launchId);
    }
    syncOrbitCadence();
    orbitDemand?.invalidate?.();
  }

  function hasVisibleOrbitPrimitive() {
    if (!layerState._enabled || !layerState._dataSource?.show) return false;
    for (const [launchId, path] of layerState._missionOrbitPrimitives) {
      if (path.primitive && missionOrbitPrimitiveVisible(launchId)) return true;
    }
    return false;
  }

  function scheduleOrbitCadence() {
    if (!orbitDemand || orbitCadenceActive) return;
    orbitCadenceActive = true;
    const generation = ++orbitGeneration;
    const nextDelay = () =>
      lastOrbitUpdateMs === null
        ? 1000
        : Math.max(0, 1000 - (Date.now() - lastOrbitUpdateMs));
    const wake = () => {
      if (generation !== orbitGeneration || !orbitCadenceActive) return;
      if (!hasVisibleOrbitPrimitive()) {
        orbitGeneration += 1;
        orbitCadenceActive = false;
        return;
      }
      refreshMissionOrbitFramesIfDue(new Date(), false);
      cancelOrbitWake = orbitDemand.schedule(wake, nextDelay());
    };
    cancelOrbitWake = orbitDemand.schedule(wake, nextDelay());
  }

  function syncOrbitCadence() {
    if (hasVisibleOrbitPrimitive()) {
      scheduleOrbitCadence();
    } else if (orbitCadenceActive) {
      orbitCadenceActive = false;
      orbitGeneration += 1;
      cancelOrbitWake();
      cancelOrbitWake = () => {};
    }
  }

  function destroyOrbitCadence() {
    orbitCadenceActive = false;
    orbitGeneration += 1;
    lastOrbitUpdateMs = null;
    cancelOrbitWake();
    cancelOrbitWake = () => {};
    orbitDemand?.dispose();
    orbitDemand = null;
  }

  function resetOrbitCadence() {
    if (orbitDemand) destroyOrbitCadence();
    orbitDemand = makeOrbitDemand('rocket-launches-orbit-cadence');
  }

  function refreshMissionOrbitFramesIfDue(
    nowDate = new Date(),
    reschedule = true,
  ) {
    if (!hasVisibleOrbitPrimitive()) return false;
    const nowMs = nowDate.getTime();
    if (
      !Number.isFinite(nowMs) ||
      (lastOrbitUpdateMs !== null && nowMs - lastOrbitUpdateMs < 1000)
    )
      return false;
    updateMissionOrbitPrimitiveFrames(nowDate);
    lastOrbitUpdateMs = nowMs;
    if (reschedule && orbitCadenceActive) {
      orbitCadenceActive = false;
      orbitGeneration += 1;
      cancelOrbitWake();
      cancelOrbitWake = () => {};
      scheduleOrbitCadence();
    }
    return true;
  }

  function removeMissionOrbitPrimitives() {
    for (const path of layerState._missionOrbitPrimitives.values()) {
      if (path.primitive && layerState._viewer?.scene?.primitives) {
        layerState._viewer.scene.primitives.remove(path.primitive);
      }
    }
    layerState._missionOrbitPrimitives.clear();
    syncOrbitCadence();
  }

  function updateMissionOrbitPrimitiveFrames(nowDate) {
    for (const [launchId, path] of layerState._missionOrbitPrimitives) {
      if (!path.primitive || !missionOrbitPrimitiveVisible(launchId)) continue;
      orbitFrameModelMatrix(
        path.gmstAtBake,
        nowDate,
        path.primitive.modelMatrix,
      );
      if (path.labelBakePosition && path.labelPosition) {
        Cesium.Matrix4.multiplyByPoint(
          path.primitive.modelMatrix,
          path.labelBakePosition,
          path.labelPosition,
        );
      }
    }
  }

  function addMissionOrbitPrimitive(launch, orbitPath, satelliteTrack) {
    if (
      !layerState._viewer ||
      !satelliteTrack ||
      !Number.isFinite(satelliteTrack.gmstAtBake)
    )
      return false;
    const collection = new Cesium.PolylineCollection();
    collection.add({
      positions: orbitPath,
      width: 3,
      material: createMissionOrbitPatternMaterial(
        Cesium.Color.fromCssColorString('#22e6e6').withAlpha(0.95),
      ),
    });
    collection.show = missionOrbitPrimitiveVisible(launch.id);
    orbitFrameModelMatrix(
      satelliteTrack.gmstAtBake,
      new Date(),
      collection.modelMatrix,
    );
    lastOrbitUpdateMs = Date.now();
    layerState._viewer.scene.primitives.add(collection);
    layerState._missionOrbitPrimitives.set(launch.id, {
      primitive: collection,
      gmstAtBake: satelliteTrack.gmstAtBake,
    });
    syncOrbitCadence();
    return true;
  }

  function MissionOrbitPatternMaterialProperty(color) {
    ensureMissionOrbitPatternRegistered();
    this._color = color;
    this._definitionChanged = new Cesium.Event();
  }
  Object.defineProperties(MissionOrbitPatternMaterialProperty.prototype, {
    isConstant: {
      get() {
        return true;
      },
    },
    definitionChanged: {
      get() {
        return this._definitionChanged;
      },
    },
  });
  MissionOrbitPatternMaterialProperty.prototype.getType = function getType() {
    return 'GevMissionOrbitTactical';
  };
  MissionOrbitPatternMaterialProperty.prototype.getValue = function getValue(
    time,
    result,
  ) {
    if (!Cesium.defined(result)) result = {};
    result.color = this._color;
    result.groupCount = MISSION_ORBIT_PATTERN_GROUPS;
    result.dashCount = MISSION_ORBIT_DASHES_PER_GROUP;
    return result;
  };
  MissionOrbitPatternMaterialProperty.prototype.equals = function equals(
    other,
  ) {
    return this === other;
  };
  return {
    ensureMissionOrbitPatternRegistered,
    createMissionOrbitPatternMaterial,
    missionOrbitPrimitiveVisible,
    syncMissionOrbitPrimitiveVisibility,
    removeMissionOrbitPrimitives,
    updateMissionOrbitPrimitiveFrames,
    refreshMissionOrbitFramesIfDue,
    destroyOrbitCadence,
    resetOrbitCadence,
    addMissionOrbitPrimitive,
    MissionOrbitPatternMaterialProperty,
  };
}
