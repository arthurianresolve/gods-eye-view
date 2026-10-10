import * as Cesium from 'cesium';

const SUPPORTED_CESIUM_PREFIX = '1.138.';
const ANGLE_NAMES = Object.freeze(['heading', 'pitch', 'roll']);

function inheritedDescriptor(target, name) {
  for (
    let prototype = Object.getPrototypeOf(target);
    prototype;
    prototype = Object.getPrototypeOf(prototype)
  ) {
    const descriptor = Object.getOwnPropertyDescriptor(prototype, name);
    if (descriptor) return descriptor;
  }
  return null;
}

function nativeAngle(camera, name) {
  const descriptor = inheritedDescriptor(camera, name);
  return descriptor?.get ? descriptor.get.call(camera) : undefined;
}

function createAngleReader(camera, scene) {
  const ellipsoid = scene.ellipsoid || scene.mapProjection?.ellipsoid;
  const enu = new Cesium.Matrix4();
  const inverseEnu = new Cesium.Matrix4();
  const direction = new Cesium.Cartesian3();
  const up = new Cesium.Cartesian3();
  const right = new Cesium.Cartesian3();

  return (name) => {
    if (scene.mode !== Cesium.SceneMode.SCENE3D || !ellipsoid)
      return nativeAngle(camera, name);

    Cesium.Transforms.eastNorthUpToFixedFrame(
      camera.positionWC,
      ellipsoid,
      enu,
    );
    Cesium.Matrix4.inverseTransformation(enu, inverseEnu);
    Cesium.Matrix4.multiplyByPointAsVector(
      inverseEnu,
      camera.directionWC,
      direction,
    );
    Cesium.Matrix4.multiplyByPointAsVector(inverseEnu, camera.upWC, up);
    Cesium.Matrix4.multiplyByPointAsVector(inverseEnu, camera.rightWC, right);

    // Mirror Camera.js 1.138 getHeading/getPitch/getRoll without its _setTransform.
    if (name === 'heading') {
      let heading;
      if (
        !Cesium.Math.equalsEpsilon(
          Math.abs(direction.z),
          1.0,
          Cesium.Math.EPSILON3,
        )
      ) {
        heading =
          Math.atan2(direction.y, direction.x) - Cesium.Math.PI_OVER_TWO;
      } else {
        heading = Math.atan2(up.y, up.x) - Cesium.Math.PI_OVER_TWO;
      }
      return Cesium.Math.TWO_PI - Cesium.Math.zeroToTwoPi(heading);
    }

    if (name === 'pitch')
      return Cesium.Math.PI_OVER_TWO - Cesium.Math.acosClamped(direction.z);

    if (name === 'roll') {
      let roll = 0.0;
      if (
        !Cesium.Math.equalsEpsilon(
          Math.abs(direction.z),
          1.0,
          Cesium.Math.EPSILON3,
        )
      ) {
        roll = Math.atan2(-right.z, up.z);
        roll = Cesium.Math.zeroToTwoPi(roll + Cesium.Math.TWO_PI);
      }
      return roll;
    }

    return nativeAngle(camera, name);
  };
}

/**
 * Replace Cesium 1.138 SCENE3D HPR reads with non-mutating ENU calculations.
 * The stock getters temporarily change the camera transform, which can drift
 * its basis when Camera._updateCameraChanged polls heading and roll.
 */
export function installCesium138CameraAnglesCompat(viewer) {
  const camera = viewer?.camera;
  const scene = viewer?.scene;
  if (
    !camera ||
    !scene ||
    scene.mode !== Cesium.SceneMode.SCENE3D ||
    !String(Cesium.VERSION).startsWith(SUPPORTED_CESIUM_PREFIX)
  )
    return { installed: false, dispose() {} };

  const ownDescriptors = new Map();
  const accessors = new Map();
  const readAngle = createAngleReader(camera, scene);

  try {
    for (const name of ANGLE_NAMES) {
      const descriptor = inheritedDescriptor(camera, name);
      if (typeof descriptor?.get !== 'function')
        throw new TypeError(
          `Cesium camera ${name} accessor is not configurable`,
        );
      ownDescriptors.set(name, Object.getOwnPropertyDescriptor(camera, name));
      const getter = () => readAngle(name);
      Object.defineProperty(camera, name, {
        configurable: true,
        enumerable: descriptor.enumerable,
        get: getter,
      });
      accessors.set(name, getter);
    }
  } catch (error) {
    for (const name of accessors.keys()) {
      const own = ownDescriptors.get(name);
      if (own) Object.defineProperty(camera, name, own);
      else delete camera[name];
    }
    throw error;
  }

  let active = true;
  return {
    installed: true,
    dispose() {
      if (!active) return;
      active = false;
      for (const name of ANGLE_NAMES) {
        if (
          Object.getOwnPropertyDescriptor(camera, name)?.get !==
          accessors.get(name)
        )
          continue;
        const own = ownDescriptors.get(name);
        if (own) Object.defineProperty(camera, name, own);
        else delete camera[name];
      }
    },
  };
}
