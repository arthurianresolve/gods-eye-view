import test from 'node:test';
import assert from 'node:assert/strict';
import { createLayerCapabilityRegistry } from './capabilities.js';
import { createInvestigationWeatherAdapter } from './weatherAdapter.js';

function clocks() {
  const frames = ['2026-10-08T10:00:00.000Z', '2026-10-08T10:05:00.000Z'];
  const weatherListeners = new Set();
  const investigationListeners = new Set();
  let weatherMode = 'latest';
  let weatherTarget = null;
  let weatherPlaying = true;
  let investigation = { mode: 'live', timeMs: null };
  let targetChanges = 0;
  let latestReturns = 0;
  const selected = (time) => {
    const target = Date.parse(time);
    const candidate = [...frames]
      .reverse()
      .find((frame) => Date.parse(frame) <= target);
    return candidate && target - Date.parse(candidate) <= 90_000
      ? candidate
      : null;
  };
  const weatherClock = {
    getState() {
      return {
        mode: weatherMode,
        target: weatherTarget,
        playing: weatherPlaying,
        products: [
          {
            id: 'weather-radar',
            selected:
              weatherMode === 'latest'
                ? frames.at(-1)
                : weatherTarget
                  ? selected(weatherTarget)
                  : null,
          },
        ],
      };
    },
    getProductTimes: () => frames,
    getTimeline: () => frames,
    selectFor: (_id, target) => selected(target),
    subscribe(listener) {
      weatherListeners.add(listener);
      return () => weatherListeners.delete(listener);
    },
    pause() {
      weatherPlaying = false;
    },
    async setTarget(target) {
      targetChanges++;
      weatherMode = 'history';
      weatherTarget = target;
      for (const listener of [...weatherListeners]) listener();
      return true;
    },
    async latest() {
      latestReturns++;
      weatherMode = 'latest';
      weatherTarget = null;
      for (const listener of [...weatherListeners]) listener();
      return true;
    },
  };
  const investigationTime = {
    getState: () => investigation,
    subscribe(listener) {
      investigationListeners.add(listener);
      listener(investigation);
      return () => investigationListeners.delete(listener);
    },
    seek(timeMs) {
      investigation = { mode: 'paused', timeMs };
      for (const listener of [...investigationListeners])
        listener(investigation);
    },
    advance(timeMs) {
      investigation = { mode: 'replay', timeMs };
      for (const listener of [...investigationListeners])
        listener(investigation);
    },
    returnLive() {
      investigation = { mode: 'live', timeMs: null };
      for (const listener of [...investigationListeners])
        listener(investigation);
    },
  };
  return {
    weatherClock,
    investigationTime,
    changes: () => targetChanges,
    latestReturns: () => latestReturns,
  };
}

test('investigation time selects eligible observed weather frames without tick-rate refetches', async (t) => {
  const state = clocks();
  const capabilities = createLayerCapabilityRegistry();
  const adapter = createInvestigationWeatherAdapter({
    ...state,
    capabilities,
  });
  t.after(() => {
    adapter.destroy();
    capabilities.destroy();
  });

  state.investigationTime.seek(Date.parse('2026-10-08T10:01:00.000Z'));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(state.changes(), 1);
  assert.equal(state.weatherClock.getState().mode, 'history');
  assert.equal(state.weatherClock.getState().playing, false);

  state.investigationTime.advance(Date.parse('2026-10-08T10:01:30.000Z'));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(
    state.changes(),
    1,
    'same frame is not fetched again each clock tick',
  );

  const result = await capabilities.resolveAt(
    'weather-radar',
    '2026-10-08T10:01:30.000Z',
  );
  assert.equal(result.status, 'available');
  assert.equal(result.mode, 'provider-history');
  assert.equal(result.sampleTimeMs, Date.parse('2026-10-08T10:00:00.000Z'));
  assert.equal(result.timeBasis, 'observed-frame');
});

test('weather adapter reports missing frames and returns to latest with live time', async (t) => {
  const state = clocks();
  const capabilities = createLayerCapabilityRegistry();
  const adapter = createInvestigationWeatherAdapter({
    ...state,
    capabilities,
  });
  t.after(() => {
    adapter.destroy();
    capabilities.destroy();
  });
  state.investigationTime.seek(Date.parse('2026-10-08T10:03:00.000Z'));
  await new Promise((resolve) => setImmediate(resolve));
  const gap = await capabilities.resolveAt(
    'weather-radar',
    '2026-10-08T10:03:00.000Z',
  );
  assert.equal(gap.status, 'no-sample');

  state.investigationTime.returnLive();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(state.weatherClock.getState().mode, 'latest');
  assert.equal(state.latestReturns(), 1);
});
