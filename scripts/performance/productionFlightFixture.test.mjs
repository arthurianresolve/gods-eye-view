import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import {
  DENSE_FLIGHT_FIXTURE_COUNT,
  createFlightFixtureDeliveryObserver,
  createProductionFlightFixture,
  installFixedWallClock,
  installHeldMonotonicWallClock,
  installPhasedMonotonicWallClock,
  assertObservedTrackingRoute,
  respondToProductionFlightFixture,
} from './productionFlightFixture.mjs';
import { interceptFixtureSession } from './fixtureInterception.mjs';
import { createFlightSource } from '../../src/sources/live/standalone.js';

const BASE = 'http://127.0.0.1:4173/';

test('production flight fixture is deterministic, bounded OpenSky payload data', () => {
  const options = { count: 2500, fixedTime: '2026-10-08T12:00:00.000Z' };
  const first = createProductionFlightFixture(options);
  const second = createProductionFlightFixture(options);
  assert.equal(first.sha256, second.sha256);
  assert.equal(first.body, second.body);
  const payload = JSON.parse(first.body);
  assert.equal(payload.states.length, 2500);
  assert.equal(payload.states[0][0], '000001');
  assert.equal(payload.states[0][3], payload.time);
  assert.equal(payload.states[0][4], payload.time);
  assert.ok(first.byteLength < 4 * 1024 * 1024);
  assert.notEqual(
    first.sha256,
    createProductionFlightFixture({
      ...options,
      fixedTime: '2026-10-08T12:00:01.000Z',
    }).sha256,
  );
});

test('production fixture rejects subsecond epochs that OpenSky rows cannot represent', () => {
  assert.throws(
    () =>
      createProductionFlightFixture({
        fixedTime: '2026-10-08T12:00:00.001Z',
      }),
    /whole second/,
  );
});

test('real flight source accepts all generated vectors and applies its freshness window', async () => {
  const fixture = createProductionFlightFixture();
  const payload = JSON.parse(fixture.body);
  const sourceAtFixtureTime = createFlightSource({
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      headers: { get: () => null },
      json: async () => payload,
    }),
    now: () => fixture.fixedTimeMs,
  });
  const snapshot = await sourceAtFixtureTime.getSnapshot();
  assert.equal(snapshot.records.length, DENSE_FLIGHT_FIXTURE_COUNT);
  assert.equal(snapshot.complete, true);
  assert.equal(snapshot.rejectedCount, 0);
  assert.equal(snapshot.records[0].id, '000001');
  assert.equal(snapshot.records.at(-1).id, '0009c4');
  assert.equal(snapshot.records[0].positionTimeMs, fixture.fixedTimeMs);
  assert.equal(snapshot.records[0].latitude, payload.states[0][6]);
  assert.equal(snapshot.records[0].longitude, payload.states[0][5]);
  assert.equal(snapshot.freshness, 'current');

  const sourceNearMeasurementEnd = createFlightSource({
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      headers: { get: () => null },
      json: async () => payload,
    }),
    now: () => fixture.fixedTimeMs + 90_000,
  });
  const lateSnapshot = await sourceNearMeasurementEnd.getSnapshot();
  assert.equal(lateSnapshot.ageMs, 90_000);
  assert.equal(lateSnapshot.freshness, 'current');
  assert.equal(lateSnapshot.records[0].positionTimeMs, fixture.fixedTimeMs);

  const sourceAfterFreshnessWindow = createFlightSource({
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      headers: { get: () => null },
      json: async () => payload,
    }),
    now: () => fixture.fixedTimeMs + 120_001,
  });
  const staleSnapshot = await sourceAfterFreshnessWindow.getSnapshot();
  assert.equal(staleSnapshot.records.length, DENSE_FLIGHT_FIXTURE_COUNT);
  assert.equal(staleSnapshot.freshness, 'stale');
});

test('flight fixture response is restricted to same-origin GET /api/flights', () => {
  const fixture = createProductionFlightFixture({ count: 3 });
  const request = { method: () => 'GET' };
  assert.equal(
    respondToProductionFlightFixture(
      new URL('/api/flights?lat=30&lon=-97', BASE),
      request,
      fixture,
      BASE,
    ).body,
    fixture.body,
  );
  for (const [url, method] of [
    ['https://provider.example/api/flights', 'GET'],
    ['http://127.0.0.1:4173/api/flights/track', 'GET'],
    ['http://127.0.0.1:4173/api/flights', 'POST'],
  ])
    assert.equal(
      respondToProductionFlightFixture(
        new URL(url),
        { method: () => method },
        fixture,
        BASE,
      ),
      undefined,
    );
});

test('fixture delivery is recorded only after CDP fulfillment acknowledgement', async () => {
  const fixture = createProductionFlightFixture({ count: 3 });
  const observer = createFlightFixtureDeliveryObserver(fixture, BASE);
  assert.throws(() => observer.summarize(3), /No flight fixture fulfillment/);
  let pausedHandler;
  let fulfilled = false;
  const client = new EventEmitter();
  client.send = async (method, params) => {
    if (method === 'Fetch.enable') return;
    assert.equal(method, 'Fetch.fulfillRequest');
    assert.equal(params.responseCode, 200);
    fulfilled = true;
  };
  const originalOn = client.on.bind(client);
  client.on = (event, handler) => {
    if (event === 'Fetch.requestPaused') pausedHandler = handler;
    else originalOn(event, handler);
    return client;
  };
  await interceptFixtureSession(
    client,
    BASE,
    (url, request) =>
      respondToProductionFlightFixture(url, request, fixture, BASE),
    (error) => {
      throw error;
    },
    {
      onFulfilled: (event) => {
        assert.equal(fulfilled, true);
        observer.onFulfilled(event);
      },
    },
  );
  await pausedHandler({
    requestId: 'request-1',
    request: { url: `${BASE}api/flights`, method: 'GET', postData: null },
  });
  assert.deepEqual(observer.summarize(3), {
    schema: 'gev-fixture-delivery-observation/v1',
    status: 'observed',
    scope:
      'static-count integration smoke only; not a paired timing fixture or performance acceptance',
    method:
      'same-origin /api/flights response acknowledged by CDP Fetch.fulfillRequest',
    fixtureSha256: fixture.sha256,
    fixedTime: fixture.fixedTime,
    fulfilledResponseCount: 1,
    observedFlightsCount: 3,
  });
});

test('fixture delivery rejects acknowledged bytes that differ from the fixture', () => {
  const fixture = createProductionFlightFixture({ count: 3 });
  const observer = createFlightFixtureDeliveryObserver(fixture, BASE);
  observer.onFulfilled({
    url: `${BASE}api/flights`,
    method: 'GET',
    status: 200,
    bodyBase64: Buffer.from('{"states":[]}', 'utf8').toString('base64'),
  });
  assert.throws(
    () => observer.summarize(3),
    /body differs from expected bytes/,
  );
});

test('failed CDP fulfillment acknowledgement never counts as delivered', async () => {
  const fixture = createProductionFlightFixture({ count: 3 });
  const observer = createFlightFixtureDeliveryObserver(fixture, BASE);
  let pausedHandler;
  const client = new EventEmitter();
  client.send = async (method) => {
    if (method === 'Fetch.enable') return;
    throw new Error('controlled fulfillment failure');
  };
  const originalOn = client.on.bind(client);
  client.on = (event, handler) => {
    if (event === 'Fetch.requestPaused') pausedHandler = handler;
    else originalOn(event, handler);
    return client;
  };
  const errors = [];
  await interceptFixtureSession(
    client,
    BASE,
    (url, request) =>
      respondToProductionFlightFixture(url, request, fixture, BASE),
    (error) => errors.push(error.message),
    { onFulfilled: observer.onFulfilled },
  );
  await pausedHandler({
    requestId: 'request-failed',
    request: { url: `${BASE}api/flights`, method: 'GET', postData: null },
  });
  assert.deepEqual(errors, ['controlled fulfillment failure']);
  assert.throws(() => observer.summarize(3), /No flight fixture fulfillment/);
});

test('fixed page clock changes Date wall time without replacing performance time', () => {
  let performanceTime = 123.5;
  const target = {
    Date,
    performance: { now: () => performanceTime },
  };
  const fixed = Date.parse('2026-10-08T12:00:00.000Z');
  installFixedWallClock(fixed, target);
  assert.equal(target.Date.now(), fixed);
  assert.equal(new target.Date().getTime(), fixed);
  assert.equal(new target.Date(0).getTime(), 0);
  assert.equal(target.Date(), new Date(fixed).toString());
  assert.equal(target.Date(0), new Date(fixed).toString());
  assert.equal(target.Date.parse('1970-01-01T00:00:00.000Z'), 0);
  assert.equal(target.Date.UTC(1970, 0, 1), 0);
  performanceTime += 1500;
  assert.equal(target.Date.now(), fixed + 1500);
  assert.equal(Number.isInteger(target.Date.now()), true);
  assert.equal(new target.Date().getTime(), fixed + 1500);
  assert.equal(target.performance.now(), 1623.5);
});

test('held monotonic wall clock starts once without replacing native timers or monotonic time', () => {
  let performanceTime = 123.5;
  const nativeSetTimeout = () => 'timer';
  const nativeRequestAnimationFrame = () => 'raf';
  const target = {
    Date,
    performance: { now: () => performanceTime },
    setTimeout: nativeSetTimeout,
    requestAnimationFrame: nativeRequestAnimationFrame,
  };
  const fixed = Date.parse('2026-10-08T12:00:00.000Z');
  const clockBeforeStart = installHeldMonotonicWallClock(fixed, target);
  assert.deepEqual(clockBeforeStart, {
    schema: 'gev-held-monotonic-wall-clock/v1',
    started: false,
    startCount: 0,
    epochMs: fixed,
    elapsedMs: null,
  });
  assert.equal(target.Date.now(), fixed);
  performanceTime += 60_000;
  assert.equal(target.Date.now(), fixed, 'the held epoch does not drift');
  const started = target.__gevHeldMonotonicWallClockV1.start();
  assert.equal(started.started, true);
  assert.equal(started.startCount, 1);
  assert.equal(started.epochMs, fixed);
  performanceTime += 90_000;
  assert.equal(target.Date.now(), fixed + 90_000);
  assert.equal(Number.isInteger(target.Date.now()), true);
  assert.throws(
    () => target.__gevHeldMonotonicWallClockV1.start(),
    /only once/,
  );
  assert.equal(target.performance.now(), 150_123.5);
  assert.equal(target.setTimeout, nativeSetTimeout);
  assert.equal(target.requestAnimationFrame, nativeRequestAnimationFrame);
});

test('phased wall clock advances only through declared forward phases and caps boundaries', () => {
  let performanceTime = 10;
  const target = { Date, performance: { now: () => performanceTime } };
  const fixed = Date.parse('2026-10-08T12:00:00.000Z');
  installPhasedMonotonicWallClock(fixed, 1000, 1000, target);
  const clock = target.__gevPhasedMonotonicWallClockV1;
  assert.equal(target.Date.now(), fixed);
  assert.throws(() => clock.startMeasurement(), /warmup boundary/);
  clock.startWarmup();
  assert.throws(() => clock.holdWarmupBoundary(), /too early/);
  performanceTime += 1200;
  assert.equal(target.Date.now(), fixed + 1000);
  const warmup = clock.holdWarmupBoundary();
  assert.equal(warmup.epochMs, fixed + 1000);
  performanceTime += 500;
  assert.equal(target.Date.now(), fixed + 1000, 'warmup hold cannot drift');
  const measure = clock.startMeasurement();
  assert.equal(measure.measurementStartCount, 1);
  assert.throws(() => clock.finishMeasurement(), /too early/);
  performanceTime += 1100;
  assert.equal(target.Date.now(), fixed + 2000);
  const completed = clock.finishMeasurement();
  assert.equal(completed.phase, 'complete');
  assert.equal(completed.epochMs, fixed + 2000);
  performanceTime += 20_000;
  assert.equal(
    target.Date.now(),
    fixed + 2000,
    'completed phase remains capped',
  );
  assert.throws(() => clock.startWarmup(), /only once/);
  assert.throws(() => clock.finishMeasurement(), /only once/);
  assert.equal(target.performance.now(), performanceTime);
});

test('completed-render settling removes its listener on render, timeout, and cancellation', async () => {
  const { settleCompletedRender } =
    await import('./productionFlightFixture.mjs');
  class Event {
    handlers = new Set();
    addEventListener(handler) {
      this.handlers.add(handler);
      return () => this.handlers.delete(handler);
    }
    removeEventListener(handler) {
      this.handlers.delete(handler);
    }
    fire() {
      for (const handler of [...this.handlers]) handler();
    }
  }
  const makeViewer = (render) => {
    const postRender = new Event();
    return {
      scene: {
        postRender,
        requestRender() {
          if (render) queueMicrotask(() => postRender.fire());
        },
      },
    };
  };
  const rendered = makeViewer(true);
  const settled = await settleCompletedRender(rendered, 100);
  assert.ok(
    settled.settleElapsedMs === null ||
      Number.isFinite(settled.settleElapsedMs),
  );
  assert.equal(rendered.scene.postRender.handlers.size, 0);
  const timedOut = makeViewer(false);
  await assert.rejects(settleCompletedRender(timedOut, 5), /did not settle/);
  assert.equal(timedOut.scene.postRender.handlers.size, 0);
  const requestFailed = makeViewer(false);
  requestFailed.scene.requestRender = () => {
    throw new Error('render request failed');
  };
  await assert.rejects(
    settleCompletedRender(requestFailed, 100),
    /render request failed/,
  );
  assert.equal(requestFailed.scene.postRender.handlers.size, 0);
  const cancelled = makeViewer(false);
  const controller = new AbortController();
  const pending = settleCompletedRender(cancelled, 1000, controller.signal);
  controller.abort(new Error('cancel test'));
  await assert.rejects(pending, /cancel test/);
  assert.equal(cancelled.scene.postRender.handlers.size, 0);
});

test('entity-follow route requires matching fixture epochs, fresh source, and actual target motion', () => {
  const julian = (epoch) => {
    const value = epoch / 86_400_000 + 2_440_587.5;
    const dayNumber = Math.floor(value);
    return { dayNumber, secondsOfDay: (value - dayNumber) * 86_400 };
  };
  const base = Date.parse('2026-10-08T12:00:00.000Z');
  const route = {
    id: 'entity-follow-v1',
    fixtureId: 'opensky-dense-investigation-v1',
    fixtureSha256: 'a'.repeat(64),
    fixedTime: '2026-10-08T12:00:00.000Z',
    selectedIdentity: 'flights:000001',
    selectedIdentityEnd: 'flights:000001',
    trajectoryId: 'opensky-dense-investigation-v1:flights:000001',
    warmupMs: 30_000,
    measurementMs: 60_000,
    startEpochMs: base + 30_000,
    endEpochMs: base + 90_000,
    cesiumCurrentTimeStart: julian(base),
    cesiumCurrentTimeEnd: julian(base),
    cesiumCurrentTimeStartMs: base,
    cesiumCurrentTimeEndMs: base,
    cesiumClockShouldAnimateStart: false,
    cesiumClockShouldAnimateEnd: false,
    cesiumClockStepStart: 0,
    cesiumClockStepEnd: 0,
    sourceFreshness: { start: 'current', end: 'current' },
    sourceAgeStartMs: 30_000,
    sourceAgeEndMs: 90_000,
    sourceLastUpdateStart: base,
    sourceLastUpdateEnd: base,
    sourceCountStart: 2500,
    sourceCountEnd: 2500,
    targetStart: { longitudeDeg: -97.7, latitudeDeg: 30.2, heightM: 1000 },
    targetEnd: { longitudeDeg: -97.6, latitudeDeg: 30.3, heightM: 1000 },
    start: {
      dateEpochMs: base + 30_000,
      position: { x: 1, y: 2, z: 3 },
      direction: { x: 0, y: 1, z: 0 },
      up: { x: 0, y: 0, z: 1 },
      transform: Array(16).fill(0),
    },
    end: {
      dateEpochMs: base + 90_000,
      position: { x: 4, y: 5, z: 6 },
      direction: { x: 0, y: 1, z: 0 },
      up: { x: 0, y: 0, z: 1 },
      transform: Array(16).fill(0),
    },
  };
  const lat1 = (route.targetStart.latitudeDeg * Math.PI) / 180;
  const lat2 = (route.targetEnd.latitudeDeg * Math.PI) / 180;
  const dLat = lat2 - lat1;
  const dLon =
    ((route.targetEnd.longitudeDeg - route.targetStart.longitudeDeg) *
      Math.PI) /
    180;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  route.motionDistanceM = route.observedTargetDistanceM =
    2 * 6_371_000 * Math.asin(Math.sqrt(h));
  const expected = {
    fixtureId: route.fixtureId,
    fixtureSha256: route.fixtureSha256,
    fixedTime: route.fixedTime,
    warmupMs: 30_000,
    measurementMs: 60_000,
  };
  assert.equal(assertObservedTrackingRoute(route, expected), true);
  for (const mutate of [
    (copy) => {
      copy.selectedIdentity = null;
    },
    (copy) => {
      copy.selectedIdentityEnd = 'flights:000002';
    },
    (copy) => {
      copy.targetEnd = structuredClone(copy.targetStart);
    },
    (copy) => {
      copy.sourceAgeEndMs = 120_001;
    },
    (copy) => {
      copy.sourceAgeEndMs = Number.NaN;
    },
    (copy) => {
      copy.endEpochMs += 1;
    },
    (copy) => {
      copy.targetEnd.latitudeDeg = Number.NaN;
    },
    (copy) => {
      copy.end.transform = null;
    },
  ]) {
    const invalid = structuredClone(route);
    mutate(invalid);
    assert.throws(
      () => assertObservedTrackingRoute(invalid, expected),
      /Invalid entity-follow route/,
    );
  }
});
