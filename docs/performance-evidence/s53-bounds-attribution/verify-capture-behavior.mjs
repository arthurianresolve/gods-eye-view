import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const path = process.argv[2];
if (!path) throw new Error('Pass the frozen fixture file to verify.');
const bytes = readFileSync(path);
const source = bytes.toString('utf8');
const start = source.indexOf('async function pixels(');
const end = source.indexOf('\nfunction requireSamePixels(', start);
assert.ok(start >= 0 && end > start);
const functionSource = source.slice(start,end);
function environment({ nullCapture = false, delayedDigest = false } = {}) {
  const listeners = new Set(), timers = new Map();
  let timerId = 0, frame = 0, resolveDigest;
  const digest = delayedDigest ? new Promise(resolve => { resolveDigest = resolve; }) : Promise.resolve(new ArrayBuffer(32));
  const canvas = { width:40, height:40, getContext:() => ({getImageData:() => ({data:new Uint8ClampedArray(40*40*4).fill(255)})}), toDataURL:() => 'data:image/png;base64,fixture' };
  const scene = { postRender:{ addEventListener(fn) { listeners.add(fn); return () => listeners.delete(fn); }, removeEventListener(fn) { listeners.delete(fn); } } };
  const capture = (viewer,{signal}) => new Promise(resolve => {
    const finish = value => { listeners.delete(onRender); signal.removeEventListener('abort',onAbort); resolve(value); };
    const onRender = () => finish(nullCapture ? null : canvas);
    const onAbort = () => finish(null);
    signal.addEventListener('abort',onAbort,{once:true});
    listeners.add(onRender);
  });
  const pixels = new Function('captureFreshCesiumFrame','check','crypto','setTimeout','clearTimeout', functionSource + '\nreturn pixels;')(
    capture, (ok,message) => { if (!ok) throw new Error(message); }, {subtle:{digest:() => digest}},
    (fn) => { const id = ++timerId; timers.set(id,fn); return id; }, id => timers.delete(id),
  );
  return {
    pixels, canvas, viewer:{scene},
    currentFrame:() => frame,
    emit(value) { frame = value; for (const callback of [...listeners]) callback(); },
    finishDigest() { resolveDigest?.(new ArrayBuffer(32)); },
    fireTimers() { for (const [id,fn] of [...timers]) { timers.delete(id); fn(); } },
    assertClean({releaseCanvas=true}={}) { assert.equal(listeners.size,0,'listeners released'); assert.equal(timers.size,0,'timers released'); if (releaseCanvas) {assert.equal(canvas.width,0,'copied canvas width released'); assert.equal(canvas.height,0,'copied canvas height released');} },
  };
}
const cases = [
  ['capture-frame metadata survives a later frame while hashing', async () => {
    const env = environment({delayedDigest:true});
    const result = env.pixels(env.viewer, () => ({frame:env.currentFrame()}));
    env.emit(101); await Promise.resolve(); env.emit(102); env.finishDigest();
    const value = await result;
    assert.equal(value.diagnostics.frame,101); assert.equal(value.capture.width,40); env.assertClean();
  }],
  ['diagnostics failure releases an already copied canvas', async () => {
    const env = environment();
    const result = env.pixels(env.viewer, () => {throw new Error('diagnostic failed');});
    env.emit(103); await assert.rejects(result,/diagnostic failed/); env.assertClean();
  }],
  ['null capture rejects and releases listeners and timers', async () => {
    const env = environment({nullCapture:true});
    const result = env.pixels(env.viewer, () => ({frame:env.currentFrame()}));
    env.emit(104); await assert.rejects(result,/completed capture frame was unavailable/); env.assertClean({releaseCanvas:false});
  }],
  ['no render aborts pending capture after diagnostics timeout', async () => {
    const env = environment();
    const result = env.pixels(env.viewer, () => ({frame:env.currentFrame()}));
    env.fireTimers(); await assert.rejects(result,/diagnostics timed out/); env.assertClean({releaseCanvas:false});
  }],
];
const outcomes = [];
for (const [name,run] of cases) {
  try { await run(); outcomes.push({name,status:'passed'}); }
  catch(error) { outcomes.push({name,status:'failed',error:error.message}); }
}
console.log(JSON.stringify({fixture:path,sha256:createHash('sha256').update(bytes).digest('hex'),scope:'Actual fixture pixels() function with controlled frame events, capture result and delayed hashing; no GPU claim',outcomes},null,2));
if (outcomes.some(r => r.status === 'failed')) process.exitCode = 1;
