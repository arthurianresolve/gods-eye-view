import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = path.resolve(process.argv[2]);
const output = process.argv[3];
const apiUrl = pathToFileURL(path.join(root, 'src/cameraVerbs.js'));
const { Event } = await import(pathToFileURL(path.join(root, 'node_modules/cesium/Source/Cesium.js')));
const api = await import(apiUrl);
function owner() {
  const callbacks = [], inputs = new Map(), writes = [];
  const tick = new Event();
  const add = tick.addEventListener.bind(tick);
  tick.addEventListener = (f) => { callbacks.push(f); return add(f); };
  const viewer = {
    clock: { onTick: tick },
    scene: { tweens: [], requestRender() {}, canvas: {
      addEventListener: (name, f) => inputs.set(name, f),
      removeEventListener: (name, f) => { if (inputs.get(name) === f) inputs.delete(name); },
    } },
    camera: { pitch: -Math.PI / 4, positionCartographic: { height: 1000 },
      moveLeft: (v) => writes.push(v), lookAtTransform() {} },
    isDestroyed: () => false,
  };
  return { viewer, callbacks, inputs, writes, tick };
}
const first = owner(), second = owner();
api.initCameraVerbs(first.viewer);
assert.equal(api.moveCamera({ motion: 'pan', direction: 'left', mode: 'continuous' }).ok, true);
first.tick.raiseEvent();
const staleTick = first.callbacks[0], staleInput = first.inputs.get('pointerdown');
api.initCameraVerbs(second.viewer);
const replacementMotion = api.activeCameraMotionId();
second.tick.raiseEvent();
const carriedWrites = second.writes.length;
api.moveCamera({ motion: 'pan', direction: 'left', mode: 'continuous' });
const newMotion = api.activeCameraMotionId();
staleTick();
const lateWrites = second.writes.length - carriedWrites;
staleInput();
const newMotionSurvived = api.activeCameraMotionId() === newMotion;
api.interruptCameraMotion('root-review-complete');
api.disposeCameraVerbs?.(second.viewer);
const report = {
  schema: 'gev-camera-owner-replacement-review/v1',
  sourceSha256: createHash('sha256').update(readFileSync(apiUrl)).digest('hex'),
  scope: 'real Cesium.Event with camera/canvas stubs; replacement and late callback behavior only',
  replacementMotion, carriedWrites, lateWrites, newMotionSurvived,
  oldTickListeners: first.tick.numberOfListeners,
  oldInputListeners: first.inputs.size,
};
report.passed = replacementMotion === 0 && carriedWrites === 0 && lateWrites === 0 && newMotionSurvived;
if (output) writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
process.exitCode = report.passed ? 0 : 1;
