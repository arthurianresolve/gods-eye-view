import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { installSettledIdleObservation } from './settledIdleObservation.mjs';
import { assessSettledIdleSample } from './settledIdleQualification.mjs';

function fixture() {
  let clock = 0;
  const event = () => {
    const listeners = new Set();
    return {
      addEventListener(listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      emit(...args) {
        for (const listener of listeners) listener(...args);
      },
      get size() {
        return listeners.size;
      },
    };
  };
  const scene = {
    camera: {
      viewMatrix: Array.from({ length: 16 }, (_, i) => (i % 5 ? 0 : 1)),
    },
    postUpdate: event(),
    postRender: event(),
    requestRenderMode: true,
    globe: { tilesLoaded: true, tileLoadProgressEvent: event() },
  };
  const window = { __godsEyeView: { viewer: { scene } } };
  const context = vm.createContext({
    window,
    performance: { now: () => clock },
  });
  vm.runInContext(`(${installSettledIdleObservation})()`, context);
  const controller = window.__gevSettledIdleObservationV1;
  return {
    scene,
    window,
    controller,
    at(time) {
      clock = time;
    },
    finish() {
      clock = 63_000;
      const observation = JSON.parse(JSON.stringify(controller.stop(clock)));
      return {
        scenario: 'idle',
        durationMs: 60_000,
        renderedFrameCount: observation.completedFrameOffsetsMs.length,
        settledIdleObservation: observation,
      };
    },
  };
}

test('settled default-loop idle records the first frame and releases every owner', () => {
  const f = fixture();
  f.at(3_000);
  f.controller.start(3_000);
  f.at(3_100);
  f.scene.postRender.emit();
  const sample = f.finish();
  assert.deepEqual(
    sample.settledIdleObservation.completedFrameOffsetsMs,
    [100],
  );
  assert.equal(assessSettledIdleSample(sample).status, 'passed');
  assert.equal(sample.settledIdleObservation.settlement.settledBeforeMs, 3_000);
  assert.equal(f.scene.postUpdate.size, 0);
  assert.equal(f.scene.postRender.size, 0);
  assert.equal(f.scene.globe.tileLoadProgressEvent.size, 0);
  assert.equal(f.window.__gevSettledIdleObservationV1, undefined);
});

test('zero completed frames qualifies without manufacturing a frame percentile', () => {
  const f = fixture();
  f.at(3_000);
  f.controller.start(3_000);
  assert.equal(assessSettledIdleSample(f.finish()).status, 'passed');
});

test('normal update observations detect loading and camera movement between renders', () => {
  for (const change of [
    (scene) => (scene.globe.tilesLoaded = false),
    (scene) => (scene.requestRenderMode = false),
    (scene) => (scene.camera.viewMatrix[12] = 10),
  ]) {
    const f = fixture();
    f.at(3_000);
    f.controller.start(3_000);
    change(f.scene);
    f.scene.postUpdate.emit();
    f.scene.globe.tilesLoaded = true;
    f.scene.requestRenderMode = true;
    f.scene.camera.viewMatrix[12] = 0;
    assert.equal(assessSettledIdleSample(f.finish()).status, 'unavailable');
  }
});

test('nonzero pending tiles reset warmup settlement until a zero event', () => {
  const f = fixture();
  f.at(1_000);
  f.scene.globe.tileLoadProgressEvent.emit(1);
  f.at(2_000);
  f.scene.postUpdate.emit();
  f.at(2_500);
  f.scene.globe.tileLoadProgressEvent.emit(0);
  f.at(3_000);
  f.controller.start(3_000);
  const sample = f.finish();
  assert.equal(sample.settledIdleObservation.settlement.settledBeforeMs, 500);
  assert.equal(assessSettledIdleSample(sample).status, 'unavailable');
});

test('loading during measurement is not hidden by a later loaded state', () => {
  const f = fixture();
  f.at(3_000);
  f.controller.start(3_000);
  f.scene.globe.tileLoadProgressEvent.emit(5);
  f.scene.globe.tileLoadProgressEvent.emit(0);
  const sample = f.finish();
  assert.equal(
    sample.settledIdleObservation.settlement.nonzeroTileProgressEvents,
    1,
  );
  assert.equal(assessSettledIdleSample(sample).status, 'unavailable');
});

test('a burst across fixed ten-second buckets still fails', () => {
  const f = fixture();
  f.at(3_000);
  f.controller.start(3_000);
  for (const at of [12_999, 13_000, 13_001]) {
    f.at(at);
    f.scene.postRender.emit();
  }
  assert.equal(assessSettledIdleSample(f.finish()).status, 'failed');
});

test('bounded overflow cannot qualify', () => {
  const f = fixture();
  f.at(3_000);
  f.controller.start(3_000);
  f.at(4_000);
  for (let i = 0; i < 2050; i++) f.scene.postRender.emit();
  const sample = f.finish();
  assert.equal(
    sample.settledIdleObservation.completedFrameOffsetsMs.length,
    2048,
  );
  assert.equal(sample.settledIdleObservation.framesOmitted, 2);
  assert.throws(() => assessSettledIdleSample(sample), /truncated/);
});

test('cancel before measurement removes warmup listeners and permits a fresh owner', () => {
  const f = fixture();
  assert.equal(f.controller.dispose(), true);
  assert.equal(f.scene.postUpdate.size, 0);
  assert.equal(f.scene.postRender.size, 0);
  assert.equal(f.scene.globe.tileLoadProgressEvent.size, 0);
  assert.equal(f.window.__gevSettledIdleObservationV1, undefined);
  assert.throws(() => f.controller.start(3_000), /Invalid/);
});
