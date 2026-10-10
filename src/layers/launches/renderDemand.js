import * as Cesium from 'cesium';

/** Render ownership shared by mission selection, camera flights, and orbit wakes. */
export function createLaunchRenderDemand(render, state) {
  const makeOwner =
    render?.registerRenderDemand ||
    (() => ({
      setContinuous() {},
      schedule: () => () => {},
      invalidate() {},
      dispose() {},
    }));
  let owner = makeOwner('rocket-launches');
  const cameraFlights = new Set();
  let active = false;
  let disposed = false;

  function sync() {
    if (disposed) return;
    owner.setContinuous(
      active &&
        Boolean(
          state._selectedLaunchId ||
          state._replayCameraLaunchId ||
          cameraFlights.size,
        ),
    );
  }

  function wrapCameraFlight(scene, camera, methodName, ...args) {
    if (!camera || typeof camera[methodName] !== 'function') return undefined;
    if (scene?.mode === Cesium.SceneMode.MORPHING)
      return camera[methodName](...args);
    const optionsIndex = args.length - 1;
    const options = args[optionsIndex] || {};
    const token = {};
    cameraFlights.add(token);
    sync();
    const release = () => {
      if (!cameraFlights.delete(token)) return;
      sync();
    };
    const complete = options?.complete;
    const cancel = options?.cancel;
    const invokeOwnedCallback = (callback, receiver, callbackArgs) => {
      if (!cameraFlights.has(token)) return;
      try {
        callback?.apply(receiver, callbackArgs);
      } finally {
        release();
      }
    };
    const wrappedOptions = {
      ...options,
      complete(...args) {
        invokeOwnedCallback(complete, this, args);
      },
      cancel(...args) {
        invokeOwnedCallback(cancel, this, args);
      },
    };
    try {
      args[optionsIndex] = wrappedOptions;
      return camera[methodName](...args);
    } catch (error) {
      release();
      throw error;
    }
  }

  function cancelCameraFlights() {
    if (!cameraFlights.size) return;
    cameraFlights.clear();
    sync();
  }

  function dispose() {
    if (disposed) return;
    active = false;
    cameraFlights.clear();
    disposed = true;
    owner.dispose();
  }

  function reset() {
    if (!disposed) owner.dispose();
    owner = makeOwner('rocket-launches');
    cameraFlights.clear();
    active = false;
    disposed = false;
  }

  return {
    setActive(value) {
      active = Boolean(value);
      sync();
    },
    sync,
    wrapCameraFlight,
    cancelCameraFlights,
    invalidate() {
      if (!disposed) owner.invalidate();
    },
    dispose,
    reset,
  };
}
