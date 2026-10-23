#!/usr/bin/env node
/** Prove standalone startup and terminal resource ownership in a real browser. */
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer';
import {
  bootFixturePage,
  cleanupFixturePageDiagnostics,
  prepareFixturePage,
} from './qa-application-fixtures.mjs';
import {
  DEFAULT_FLIGHT_FIXTURE_TIME,
  RENDER_DEMAND_PROFILE,
  RENDER_DEMAND_PROFILE_SHA256,
  normalizeRenderDemandAngleDegrees,
  assessRenderDemandMapProviderTraffic,
  assessRenderDemandSnapshotStability,
  classifyRenderDemandRequest,
  respondToRenderDemandApiFixture,
  createRenderDemandFailureReport,
  createProductionFlightFixture,
  createProductionMilitaryFixture,
  installFixtureWallClockOnPage,
  respondToProductionFlightFixture,
  respondToProductionMilitaryFixture,
} from './performance/productionFlightFixture.mjs';
import {
  assessHostedSourceFinish,
  assessHostedSourceStart,
  inspectTrackedWorktree,
} from './performance/hostedSourceProvenance.mjs';
import { createDeterministicMapStreamingFixture } from './performance/mapStreamingFixture.mjs';
import {
  assertMapStreamingDeliveryHealthy,
  createMapStreamingFixtureDelivery,
} from './performance/mapStreamingFixtureDelivery.mjs';

const args = process.argv.slice(2);
const urlIndex = args.indexOf('--url');
const url = urlIndex >= 0 ? args[urlIndex + 1] : 'http://localhost:4173';

async function runRenderDemandDiagnostic(browser) {
  const reportState = { stage: 'fixture-setup', observations: [] };
  try {
    await runRenderDemandDiagnosticInner(browser, reportState);
  } catch (error) {
    console.log(
      JSON.stringify(
        createRenderDemandFailureReport({
          stage: reportState.stage,
          error,
          observations: reportState.observations,
          delivery: reportState.delivery || null,
          traffic: reportState.traffic || null,
          fixture: reportState.fixture || null,
          terminal: reportState.terminal || null,
          source: reportState.source || null,
          sourceFinish: reportState.sourceFinish || null,
        }),
        null,
        2,
      ),
    );
    throw error;
  }
}

async function runRenderDemandDiagnosticInner(browser, reportState) {
  const sourceStartSnapshot = inspectTrackedWorktree();
  const expectedCommit = sourceStartSnapshot.head;
  const sourceStart = assessHostedSourceStart(
    sourceStartSnapshot,
    expectedCommit,
  );
  reportState.observations.push({
    stage: 'fixture-setup',
    state: {
      sourceCommit: sourceStart.harnessCommit,
      sourceDirtyAtStart: sourceStart.harnessDirtyAtStart,
      sourceIdentityValid: sourceStart.valid,
    },
  });
  reportState.source = {
    commit: sourceStart.harnessCommit,
    dirtyAtStart: sourceStart.harnessDirtyAtStart,
    identityValid: sourceStart.valid,
  };
  assert.equal(
    sourceStart.valid,
    true,
    'Tracked source identity is not clean at diagnostic start.',
  );
  const fixedTime = DEFAULT_FLIGHT_FIXTURE_TIME;
  const fixedTimeMs = Date.parse(fixedTime);
  const flights = createProductionFlightFixture({ count: 0, fixedTime });
  const military = createProductionMilitaryFixture({ fixedTime });
  const mapStreamingFixture = await createDeterministicMapStreamingFixture();
  const mapStreamingDelivery = createMapStreamingFixtureDelivery(
    mapStreamingFixture,
    { appOrigin: new URL(url).origin },
  );
  let mapStreamingDeliverySummary = null;
  reportState.fixture = {
    profileId: RENDER_DEMAND_PROFILE.id,
    profileSha256: RENDER_DEMAND_PROFILE_SHA256,
    fixedTime,
    flightsId: flights.id,
    flightsSha256: flights.sha256,
    flightsBytes: flights.byteLength,
    militaryId: military.id,
    militarySha256: military.sha256,
    militaryBytes: military.byteLength,
    mapStreamingId: mapStreamingFixture.id,
    mapStreamingManifestSha256: mapStreamingFixture.manifestSha256,
  };
  const delivered = { flights: 0, military: 0 };
  const routeAttempts = { flights: 0, military: 0 };
  const otherApiPaths = new Set();
  let expectedBootstrapApiCount = 0;
  let expectedRenderDemandApiCount = 0;
  let expectedBlockedStaticFontCount = 0;
  let expectedBlockedMapProviderCount = 0;
  let unexpectedExternalCount = 0;
  let observedMapProviderRequestCount = 0;
  let mapProviderRequestTrackingOverflow = false;
  const pendingMapProviderRequests = new Set();
  let invalidFixtureRouteCount = 0;
  let unexpectedApiCount = 0;
  let otherApiPathOverflow = false;
  const page = await browser.newPage();
  const {
    page: fixturePage,
    errors,
    interception,
    verifyNetwork,
  } = await prepareFixturePage(browser, url, {
    page,
    respond(requestUrl, request) {
      let response;
      if (requestUrl.origin !== new URL(url).origin) {
        const classification = classifyRenderDemandRequest({
          url: requestUrl.href,
          origin: new URL(url).origin,
          method: request?.method?.(),
          resourceType: request?.resourceType?.(),
        });
        if (classification === 'expected-blocked-map-provider') {
          expectedBlockedMapProviderCount += 1;
          return mapStreamingDelivery.respond(requestUrl, request);
        } else if (classification === 'expected-blocked-static-font')
          expectedBlockedStaticFontCount += 1;
        else if (
          classification === 'unexpected-external' &&
          requestUrl.hostname !== 'fixture-network.invalid'
        )
          unexpectedExternalCount += 1;
        return undefined;
      }
      if (requestUrl.pathname === '/api/flights') {
        routeAttempts.flights += 1;
        response = respondToProductionFlightFixture(
          requestUrl,
          request,
          flights,
          url,
        );
        if (!response) invalidFixtureRouteCount += 1;
      } else if (requestUrl.pathname === '/api/military') {
        routeAttempts.military += 1;
        response = respondToProductionMilitaryFixture(
          requestUrl,
          request,
          military,
          url,
        );
        if (!response) invalidFixtureRouteCount += 1;
      } else if (requestUrl.pathname.startsWith('/api/')) {
        const classification = classifyRenderDemandRequest({
          url: requestUrl.href,
          origin: new URL(url).origin,
          method: request?.method?.(),
        });
        if (classification === 'expected-bootstrap-api') {
          expectedBootstrapApiCount += 1;
          return undefined;
        }
        if (classification === 'expected-render-demand-api') {
          expectedRenderDemandApiCount += 1;
          return respondToRenderDemandApiFixture(requestUrl, request, url);
        }
        unexpectedApiCount += 1;
        // Record only bounded pathnames: never query strings, URLs, or bodies.
        if (otherApiPaths.size < 8)
          otherApiPaths.add(
            /^\/api\/[a-z0-9/_-]{1,96}$/i.test(requestUrl.pathname)
              ? requestUrl.pathname
              : '[other-api-path]',
          );
        else otherApiPathOverflow = true;
      }
      return response;
    },
    onFulfilled(event) {
      mapStreamingDelivery.onFulfilled(event);
      const { url: requestUrl, method, status, bodyBase64 } = event;
      const parsed = new URL(requestUrl);
      if (
        parsed.origin !== new URL(url).origin ||
        method !== 'GET' ||
        status !== 200
      )
        return;
      const expectedFlights = Buffer.from(flights.body).toString('base64');
      const expectedMilitary = Buffer.from(military.body).toString('base64');
      if (parsed.pathname === '/api/flights' && bodyBase64 === expectedFlights)
        delivered.flights += 1;
      if (
        parsed.pathname === '/api/military' &&
        bodyBase64 === expectedMilitary
      )
        delivered.military += 1;
    },
  });

  const observeMapProviderRequest = (request) => {
    const requestUrl = request.url();
    const requestOrigin = new URL(url).origin;
    const classification = classifyRenderDemandRequest({
      url: requestUrl,
      origin: requestOrigin,
      method: request.method(),
      resourceType: request.resourceType(),
    });
    if (classification !== 'expected-blocked-map-provider') return;
    observedMapProviderRequestCount += 1;
    if (pendingMapProviderRequests.size >= 4096) {
      mapProviderRequestTrackingOverflow = true;
      return;
    }
    pendingMapProviderRequests.add(request);
  };
  const finishMapProviderRequest = (request) => {
    pendingMapProviderRequests.delete(request);
  };
  fixturePage.on('request', observeMapProviderRequest);
  fixturePage.on('requestfinished', finishMapProviderRequest);
  fixturePage.on('requestfailed', finishMapProviderRequest);

  let terminal = null;
  let networkProbe = null;
  let ownerCleanupCompleted = false;
  try {
    reportState.stage = 'fixture-setup';
    await installFixtureWallClockOnPage(fixturePage, fixedTimeMs);
    await bootFixturePage(fixturePage, url, {
      hash: RENDER_DEMAND_PROFILE.hash,
    });
    networkProbe = await verifyNetwork();
    reportState.observations.push({
      stage: 'fixture-setup',
      state: {
        networkProbePassed: networkProbe?.status === 'passed',
        pageErrorCount: errors.length,
        pageErrors: errors.slice(-4),
      },
    });
    reportState.stage = 'application-start';
    await fixturePage.evaluate(async () => {
      const entry = [...document.scripts].find((script) =>
        /\/src\/main\.js(?:\?|$)/.test(script.src),
      );
      if (!entry) throw new Error('Application entry script is unavailable.');
      const { application } = await import(entry.src);
      window.__qaApplication = application;
      await application.start();
      await window.__godsEyeView.styleManager.initialRestorePromise;
      await window.__godsEyeView.dataManager.setEnabled('flights', true, {
        origin: 'qa-render-demand',
      });
      await window.__godsEyeView.dataManager.setEnabled('military', true, {
        origin: 'qa-render-demand',
      });
    });
    const environment = await fixturePage.evaluate(() => {
      const app = window.__godsEyeView;
      const performanceEnvironment = app.getPerformanceEnvironment();
      const renderer = String(performanceEnvironment.renderer || '');
      const userAgent = navigator.userAgent;
      return {
        appCommit: performanceEnvironment.appCommit,
        browser: {
          family: /Chrome\//.test(userAgent) ? 'chromium' : 'other',
          version: userAgent.match(/Chrome\/([0-9.]+)/)?.[1] || null,
          rendererClass: /swiftshader/i.test(renderer)
            ? 'swiftshader'
            : /llvmpipe|softpipe/i.test(renderer)
              ? 'software-other'
              : renderer
                ? 'hardware-or-unknown'
                : 'unavailable',
          viewport: performanceEnvironment.viewport,
          drawingBuffer: performanceEnvironment.drawingBuffer,
        },
      };
    });
    reportState.observations.push({
      stage: 'application-start',
      state: {
        applicationStartResolved: true,
        environment,
        pageErrorCount: errors.length,
        pageErrors: errors.slice(-4),
      },
    });

    reportState.stage = 'fixture-delivery';
    const deliveryDeadline = Date.now() + 30_000;
    while (
      (delivered.flights < 1 || delivered.military < 1) &&
      Date.now() < deliveryDeadline
    )
      await new Promise((resolve) => setTimeout(resolve, 50));

    reportState.delivery = { routeAttempts, acknowledged: delivered };
    reportState.traffic = {
      expectedBootstrapApiCount,
      expectedRenderDemandApiCount,
      expectedBlockedStaticFontCount,
      expectedBlockedMapProviderCount,
      observedMapProviderRequestCount,
      pendingMapProviderRequestCount: pendingMapProviderRequests.size,
      mapProviderRequestTrackingOverflow,
      unexpectedApiCount,
      unexpectedExternalCount,
    };
    reportState.observations.push({
      stage: 'fixture-delivery',
      state: {
        routeAttempts: { ...routeAttempts },
        acknowledged: { ...delivered },
        pageErrorCount: errors.length,
        pageErrors: errors.slice(-4),
      },
    });

    reportState.stage = 'scene-settle';
    const settled = await fixturePage.evaluate(async () => {
      const app = window.__godsEyeView;
      const viewer = app?.viewer;
      const startedAt = performance.now();
      let previous = null;
      let stableCount = 0;
      let latest = null;
      let previousTileDemand = null;
      let stableTileDemandCount = 0;
      // A cold development-server compilation can consume most of the old
      // 20-second window before the scene first becomes ready. Keep the gate
      // bounded, but leave enough time to collect the four consecutive state
      // samples that the acceptance contract actually requires.
      while (performance.now() - startedAt < 30_000) {
        const map = app.mapStackController.getState();
        const cartographic = viewer.camera.positionCartographic;
        if (!cartographic)
          throw new Error('Camera cartographic position is unavailable.');
        const degrees = (radians) => (radians * 180) / Math.PI;
        const angleDegrees = (radians) => {
          const degreesValue = degrees(radians);
          // Keep camera angular readbacks comparable across the 0/360 seam.
          return ((((degreesValue + 180) % 360) + 360) % 360) - 180;
        };
        const camera = {
          longitude: degrees(cartographic.longitude),
          latitude: degrees(cartographic.latitude),
          height: cartographic.height,
          heading: angleDegrees(viewer.camera.heading),
          pitch: angleDegrees(viewer.camera.pitch),
          roll: angleDegrees(viewer.camera.roll),
        };
        const enabledLayerIds = app.dataManager
          .getAll()
          .filter((layer) => layer.enabled)
          .map((layer) => layer.id)
          .sort();
        const globe = viewer.scene.globe;
        // Cesium 1.138 exposes tilesLoaded publicly. Its quadtree work queues
        // are private read-only diagnostics; never mutate them or infer that
        // a stable empty queue means imagery content itself loaded.
        const surface = globe?._surface;
        const tileQueues = {
          high: Array.isArray(surface?._tileLoadQueueHigh)
            ? surface._tileLoadQueueHigh.length
            : null,
          medium: Array.isArray(surface?._tileLoadQueueMedium)
            ? surface._tileLoadQueueMedium.length
            : null,
          low: Array.isArray(surface?._tileLoadQueueLow)
            ? surface._tileLoadQueueLow.length
            : null,
        };
        const tileQueueCount =
          tileQueues.high === null ||
          tileQueues.medium === null ||
          tileQueues.low === null
            ? null
            : tileQueues.high + tileQueues.medium + tileQueues.low;
        const tileDemand = {
          globeTilesLoaded:
            typeof globe?.tilesLoaded === 'boolean' ? globe.tilesLoaded : null,
          tileQueues,
          tileQueueCount,
        };
        const cameraInAustinBounds =
          camera.longitude >= -98 &&
          camera.longitude <= -97 &&
          camera.latitude >= 30 &&
          camera.latitude <= 31 &&
          camera.height >= 300 &&
          camera.height <= 1000 &&
          camera.heading >= 10 &&
          camera.heading <= 20 &&
          camera.pitch >= -40 &&
          camera.pitch <= -20 &&
          Math.abs(camera.roll) <= 2;
        const ready =
          window.__qaApplication.getState().status === 'ready' &&
          map.status === 'ready' &&
          map.activeId === 'osm' &&
          // Cesium.SceneMode.SCENE3D is 3 in the pinned 1.138 public enum.
          viewer.scene.mode === 3 &&
          JSON.stringify(enabledLayerIds) === '["flights","military"]' &&
          cameraInAustinBounds &&
          typeof tileDemand.globeTilesLoaded === 'boolean' &&
          tileDemand.tileQueueCount === 0;
        const sameTileDemand =
          previousTileDemand &&
          previousTileDemand.globeTilesLoaded === tileDemand.globeTilesLoaded &&
          previousTileDemand.tileQueueCount === tileDemand.tileQueueCount &&
          JSON.stringify(previousTileDemand.tileQueues) ===
            JSON.stringify(tileDemand.tileQueues);
        stableTileDemandCount =
          ready && sameTileDemand ? stableTileDemandCount + 1 : ready ? 1 : 0;
        const samePose =
          previous &&
          Math.abs(previous.longitude - camera.longitude) < 0.00002 &&
          Math.abs(previous.latitude - camera.latitude) < 0.00002 &&
          Math.abs(previous.height - camera.height) < 2 &&
          Math.abs(previous.heading - camera.heading) < 0.2 &&
          Math.abs(previous.pitch - camera.pitch) < 0.2 &&
          Math.abs(previous.roll - camera.roll) < 0.2;
        stableCount = ready && samePose ? stableCount + 1 : ready ? 1 : 0;
        latest = {
          mapStatus: map.status,
          activeMapId: map.activeId,
          camera,
          enabledLayerIds,
          globeTilesLoaded: tileDemand.globeTilesLoaded,
          tileQueues: tileDemand.tileQueues,
          tileQueueCount: tileDemand.tileQueueCount,
          stableTileDemandCount,
        };
        previous = ready ? camera : null;
        previousTileDemand = ready ? tileDemand : null;
        if (stableCount >= 4 && stableTileDemandCount >= 4)
          return {
            settled: true,
            demandMeaning:
              'no queued globe tile work; tilesLoaded state and queue counts stable across consecutive samples',
            elapsedMs: performance.now() - startedAt,
            tileQueueStableSamples: stableTileDemandCount,
            sample: latest,
          };
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
      return {
        settled: false,
        elapsedMs: performance.now() - startedAt,
        tileQueueStableSamples: stableTileDemandCount,
        sample: latest,
      };
    });
    reportState.observations.push({ stage: 'scene-settle', state: settled });
    reportState.traffic = {
      expectedBootstrapApiCount,
      expectedRenderDemandApiCount,
      expectedBlockedStaticFontCount,
      expectedBlockedMapProviderCount,
      observedMapProviderRequestCount,
      pendingMapProviderRequestCount: pendingMapProviderRequests.size,
      mapProviderRequestTrackingOverflow,
      unexpectedApiCount,
      unexpectedExternalCount,
    };
    assert.equal(
      settled.settled,
      true,
      'Application scene did not settle inside the bounded startup window.',
    );
    assert.equal(mapProviderRequestTrackingOverflow, false);
    assert.equal(pendingMapProviderRequests.size, 0);
    assert.equal(
      observedMapProviderRequestCount,
      expectedBlockedMapProviderCount,
      'Observed map provider requests did not match the intercepted request count.',
    );

    reportState.stage = 'start-snapshot';
    const start = await fixturePage.evaluate((expectedCommit) => {
      const app = window.__godsEyeView;
      const viewer = app?.viewer;
      if (!app || !viewer?.scene)
        throw new Error('Application viewer is unavailable for observation.');
      const cartographic = viewer.camera.positionCartographic;
      if (!cartographic)
        throw new Error('Camera cartographic position is unavailable.');
      const stats = Object.fromEntries(
        ['flights', 'military'].map((id) => [
          id,
          {
            enabled: app.dataManager.isEnabled(id),
            lifecycleState:
              app.dataManager.getAll().find((layer) => layer.id === id)
                ?.lifecycleState ?? null,
            lifecycleUncertain:
              app.dataManager.getAll().find((layer) => layer.id === id)
                ?.lifecycleUncertain ?? null,
            ...app.dataManager.layers.get(id)?.module?.getStats?.(),
          },
        ]),
      );
      const surface = viewer.scene.globe?._surface;
      const tileQueues = {
        high: Array.isArray(surface?._tileLoadQueueHigh)
          ? surface._tileLoadQueueHigh.length
          : null,
        medium: Array.isArray(surface?._tileLoadQueueMedium)
          ? surface._tileLoadQueueMedium.length
          : null,
        low: Array.isArray(surface?._tileLoadQueueLow)
          ? surface._tileLoadQueueLow.length
          : null,
      };
      const tileQueueCount =
        tileQueues.high === null ||
        tileQueues.medium === null ||
        tileQueues.low === null
          ? null
          : tileQueues.high + tileQueues.medium + tileQueues.low;
      const degrees = (radians) => (radians * 180) / Math.PI;
      const angleDegrees = (radians) => {
        const degreesValue = degrees(radians);
        return ((((degreesValue + 180) % 360) + 360) % 360) - 180;
      };
      const visual = app.styleManager.getVisualState();
      const detection = app.styleManager.services?.getDetectionTuning?.() || {};
      return {
        applicationStatus: window.__qaApplication.getState().status,
        source: {
          appCommit: app.getPerformanceEnvironment().appCommit,
          expectedCommit,
          matchesHarnessHead:
            app.getPerformanceEnvironment().appCommit === expectedCommit,
        },
        browser: (() => {
          const environment = app.getPerformanceEnvironment();
          const userAgent = navigator.userAgent;
          const renderer = String(environment.renderer || '');
          return {
            family: /Chrome\//.test(userAgent) ? 'chromium' : 'other',
            version: userAgent.match(/Chrome\/([0-9.]+)/)?.[1] || null,
            rendererClass: /swiftshader/i.test(renderer)
              ? 'swiftshader'
              : /llvmpipe|softpipe/i.test(renderer)
                ? 'software-other'
                : renderer
                  ? 'hardware-or-unknown'
                  : 'unavailable',
            renderer: renderer.replace(/[\u0000-\u001f]/g, '').slice(0, 240),
            viewport: environment.viewport,
            drawingBuffer: environment.drawingBuffer,
          };
        })(),
        fixtureEpochMs: Date.now(),
        camera: {
          latitude: degrees(cartographic.latitude),
          longitude: degrees(cartographic.longitude),
          altitudeMeters: cartographic.height,
          headingDegrees: angleDegrees(viewer.camera.heading),
          pitchDegrees: angleDegrees(viewer.camera.pitch),
          rollDegrees: angleDegrees(viewer.camera.roll),
        },
        visibilityState: document.visibilityState,
        focused: document.hasFocus(),
        frameNumber: viewer.scene.frameState?.frameNumber ?? null,
        stats,
        map: {
          status: app.mapStackController.getState().status,
          activeId: app.mapStackController.getActiveId(),
        },
        mapDemand: {
          globeTilesLoaded:
            typeof viewer.scene.globe?.tilesLoaded === 'boolean'
              ? viewer.scene.globe.tilesLoaded
              : null,
          tileQueues,
          tileQueueCount,
        },
        enabledLayerIds: app.dataManager
          .getAll()
          .filter((layer) => layer.enabled)
          .map((layer) => layer.id)
          .sort(),
        settings: (() => {
          const gl = viewer.scene.context?._gl;
          const attributes = gl?.getContextAttributes?.() || {};
          return {
            msaaSamples: viewer.scene.msaaSamples ?? null,
            preserveDrawingBuffer: attributes.preserveDrawingBuffer ?? null,
            antialias: attributes.antialias ?? null,
            fxaaEnabled: viewer.scene.postProcessStages?.fxaa?.enabled ?? null,
            resolutionScale: viewer.resolutionScale ?? null,
            canvasWidth: viewer.scene.canvas?.width ?? null,
            canvasHeight: viewer.scene.canvas?.height ?? null,
            bloomIntensity: visual?.bloom?.intensity ?? null,
            bloomEnabled: visual?.bloom?.enabled ?? null,
            bloomVersion: visual?.bloom?.version ?? null,
            sharpenIntensity: visual?.sharpen?.intensity ?? null,
            sharpenEnabled: visual?.sharpen?.enabled ?? null,
            style: visual?.style ?? null,
            hudVisible: visual?.hud?.visible ?? null,
            hudVariant: visual?.hud?.variant ?? null,
            detectionMode: visual?.detection?.mode ?? null,
            allocation: visual?.detection?.allocation ?? null,
            qualityMode: app.styleManager._adaptiveQuality?.getMode?.() ?? null,
            densityPct: Number.isFinite(detection.densityPct)
              ? detection.densityPct
              : null,
            visualDensityPct: Number.isFinite(visual?.detection?.density)
              ? visual.detection.density
              : null,
          };
        })(),
        governor: app.getRenderGovernorDiagnostics(),
      };
    }, expectedCommit);
    reportState.observations.push({
      stage: 'start-snapshot',
      state: {
        ...start,
        mapDemand: {
          ...start.mapDemand,
          tileQueueStableSamples: settled.tileQueueStableSamples,
          observedProviderRequests: observedMapProviderRequestCount,
          interceptedProviderRequests: expectedBlockedMapProviderCount,
          pendingProviderRequests: pendingMapProviderRequests.size,
          requestTrackingOverflow: mapProviderRequestTrackingOverflow,
        },
        pageErrors: errors.slice(-4),
      },
    });
    const fixtureWallElapsedMs = start.fixtureEpochMs - fixedTimeMs;
    assert.ok(
      Number.isFinite(fixtureWallElapsedMs) &&
        fixtureWallElapsedMs >= 0 &&
        fixtureWallElapsedMs < 90_000,
      'Application fixture wall clock drifted outside the startup boundary.',
    );
    assert.equal(start.stats.flights.enabled, true);
    assert.equal(start.stats.military.enabled, true);
    assert.equal(start.stats.flights.count, 0);
    assert.equal(start.stats.military.count, 0);
    assert.equal(start.stats.flights.status, 200);
    assert.equal(start.stats.military.status, 200);
    assert.equal(start.stats.flights.stale, false);
    assert.equal(start.stats.military.stale, false);
    assert.equal(start.stats.flights.lifecycleState, 'enabled');
    assert.equal(start.stats.military.lifecycleState, 'enabled');
    assert.equal(start.stats.flights.lifecycleUncertain, false);
    assert.equal(start.stats.military.lifecycleUncertain, false);
    assert.deepEqual(start.enabledLayerIds, ['flights', 'military']);
    assert.equal(start.map.status, 'ready');
    assert.ok(['esri-imagery', 'osm'].includes(start.map.activeId));
    assert.equal(
      start.mapDemand.tileQueueCount,
      0,
      'Globe tile work must remain drained at the actual start snapshot.',
    );
    assert.deepEqual(
      start.mapDemand.tileQueues,
      settled.sample?.tileQueues,
      'The live start queue sample must match the settled queue observation.',
    );
    assert.equal(
      start.mapDemand.globeTilesLoaded,
      settled.sample?.globeTilesLoaded,
      'The live start tile-loaded state must match the settled observation.',
    );
    const expected = RENDER_DEMAND_PROFILE.expected;
    assert.deepEqual(start.enabledLayerIds, expected.enabledLayerIds);
    assert.equal(start.map.activeId, expected.mapStack);
    assert.deepEqual(
      {
        msaaSamples: start.settings.msaaSamples,
        preserveDrawingBuffer: start.settings.preserveDrawingBuffer,
        antialias: start.settings.antialias,
        fxaaEnabled: start.settings.fxaaEnabled,
        resolutionScale: start.settings.resolutionScale,
        canvasWidth: start.settings.canvasWidth,
        canvasHeight: start.settings.canvasHeight,
      },
      expected.renderer,
    );
    assert.equal(start.settings.style, expected.style);
    assert.deepEqual(
      {
        enabled: start.settings.bloomEnabled,
        intensity: start.settings.bloomIntensity,
        version: start.settings.bloomVersion,
      },
      expected.bloom,
    );
    assert.deepEqual(
      {
        enabled: start.settings.sharpenEnabled,
        intensity: start.settings.sharpenIntensity,
      },
      expected.sharpen,
    );
    assert.deepEqual(
      {
        visible: start.settings.hudVisible,
        variant: start.settings.hudVariant,
      },
      expected.hud,
    );
    assert.equal(start.settings.detectionMode, expected.detection.mode);
    assert.equal(start.settings.densityPct, expected.detection.densityPct);
    assert.equal(
      start.settings.visualDensityPct,
      expected.detection.densityPct,
      'The visible density control must match effective detection density.',
    );
    assert.equal(start.settings.allocation, expected.detection.allocation);
    assert.equal(start.settings.qualityMode, 'manual');
    for (const [field, expectedValue, tolerance] of [
      ['latitude', expected.camera.latitude, 0.0002],
      ['longitude', expected.camera.longitude, 0.0002],
      ['altitudeMeters', expected.camera.altitudeMeters, 2],
      ['headingDegrees', expected.camera.headingDegrees, 0.2],
      ['pitchDegrees', expected.camera.pitchDegrees, 0.2],
      ['rollDegrees', expected.camera.rollDegrees, 0.2],
    ]) {
      const difference = [
        'headingDegrees',
        'pitchDegrees',
        'rollDegrees',
      ].includes(field)
        ? normalizeRenderDemandAngleDegrees(start.camera[field] - expectedValue)
        : start.camera[field] - expectedValue;
      assert.ok(
        Number.isFinite(start.camera[field]) &&
          Number.isFinite(difference) &&
          Math.abs(difference) <= tolerance,
        `Render-demand start camera ${field} differs from the controlled profile.`,
      );
    }
    assert.equal(
      delivered.flights > 0,
      true,
      'OpenSky fixture was acknowledged.',
    );
    assert.equal(
      delivered.military > 0,
      true,
      'readsb fixture was acknowledged.',
    );

    await fixturePage.bringToFront();
    reportState.stage = 'foreground-observation';
    const providerRequestsBeforeForeground = observedMapProviderRequestCount;
    const interceptedRequestsBeforeForeground = expectedBlockedMapProviderCount;
    const staticObservation = await fixturePage.evaluate(async () => {
      const viewer = window.__godsEyeView.viewer;
      const scene = viewer.scene;
      const startedAt = performance.now();
      const before = {
        visibilityState: document.visibilityState,
        focused: document.hasFocus(),
        frameNumber: scene.frameState?.frameNumber ?? null,
      };
      let completedPostRenderCount = 0;
      let eventOverflow = false;
      let foregroundUninterrupted =
        before.visibilityState === 'visible' && before.focused;
      const events = [];
      const onPostRender = () => {
        completedPostRenderCount += 1;
        if (completedPostRenderCount > 100_000) eventOverflow = true;
      };
      const onForegroundEvent = (event) => {
        const state = {
          type: event.type,
          visibilityState: document.visibilityState,
          focused: document.hasFocus(),
        };
        if (state.visibilityState !== 'visible' || !state.focused)
          foregroundUninterrupted = false;
        if (events.length < 8) events.push(state);
        else eventOverflow = true;
      };
      scene.postRender.addEventListener(onPostRender);
      document.addEventListener('visibilitychange', onForegroundEvent);
      window.addEventListener('blur', onForegroundEvent);
      window.addEventListener('focus', onForegroundEvent);
      try {
        await new Promise((resolve) => setTimeout(resolve, 10_000));
      } finally {
        scene.postRender.removeEventListener(onPostRender);
        document.removeEventListener('visibilitychange', onForegroundEvent);
        window.removeEventListener('blur', onForegroundEvent);
        window.removeEventListener('focus', onForegroundEvent);
      }
      const after = {
        visibilityState: document.visibilityState,
        focused: document.hasFocus(),
        frameNumber: scene.frameState?.frameNumber ?? null,
      };
      if (after.visibilityState !== 'visible' || !after.focused)
        foregroundUninterrupted = false;
      return {
        durationMs: performance.now() - startedAt,
        before,
        after,
        completedPostRenderCount,
        eventOverflow,
        foregroundUninterrupted,
        events,
      };
    });
    const providerRequestsAfterForeground = observedMapProviderRequestCount;
    const interceptedRequestsAfterForeground = expectedBlockedMapProviderCount;
    // Fixture-blocked OSM content can issue one bounded retry when an allowed
    // final render wakes Cesium's globe traversal. Requiring a literal zero
    // request delta made the idle-render assertion depend on whether that
    // retry landed just before or just after the observation boundary. Tie the
    // retry allowance to completed renders instead: a request storm still
    // fails, while the two-frame idle contract remains the controlling bound.
    staticObservation.mapProviderTraffic = assessRenderDemandMapProviderTraffic(
      {
        observedBefore: providerRequestsBeforeForeground,
        observedAfter: providerRequestsAfterForeground,
        interceptedBefore: interceptedRequestsBeforeForeground,
        interceptedAfter: interceptedRequestsAfterForeground,
        completedPostRenderCount: staticObservation.completedPostRenderCount,
        pendingAfter: pendingMapProviderRequests.size,
        trackingOverflow: mapProviderRequestTrackingOverflow,
      },
    );
    reportState.traffic = {
      expectedBootstrapApiCount,
      expectedRenderDemandApiCount,
      expectedBlockedStaticFontCount,
      expectedBlockedMapProviderCount,
      observedMapProviderRequestCount,
      pendingMapProviderRequestCount: pendingMapProviderRequests.size,
      mapProviderRequestTrackingOverflow,
      mapProviderRequestsBeforeForeground: providerRequestsBeforeForeground,
      mapProviderRequestsAfterForeground: providerRequestsAfterForeground,
      mapProviderTrafficStable: staticObservation.mapProviderTraffic.stable,
      unexpectedApiCount,
      unexpectedExternalCount,
    };
    reportState.observations.push({
      stage: 'foreground-observation',
      state: { ...staticObservation, pageErrors: errors.slice(-4) },
    });

    // Chromium CDP has no setPageVisibilityState command in the installed
    // protocol. Exercise only the app handler by simulating document properties
    // and dispatching the DOM event; this is not OS/browser visibility evidence.
    reportState.stage = 'visibility-control';
    const visibilityControl = await fixturePage.evaluate(async () => {
      const documentObject = document;
      const hiddenDescriptor = Object.getOwnPropertyDescriptor(
        documentObject,
        'hidden',
      );
      const stateDescriptor = Object.getOwnPropertyDescriptor(
        documentObject,
        'visibilityState',
      );
      const viewer = window.__godsEyeView.viewer;
      const beforeFrame = viewer.scene.frameState?.frameNumber ?? null;
      const setVisibility = (hidden) => {
        Object.defineProperty(documentObject, 'hidden', {
          configurable: true,
          value: hidden,
        });
        Object.defineProperty(documentObject, 'visibilityState', {
          configurable: true,
          value: hidden ? 'hidden' : 'visible',
        });
        documentObject.dispatchEvent(new Event('visibilitychange'));
      };
      try {
        setVisibility(true);
        const loopStopped = viewer.useDefaultRenderLoop === false;
        setVisibility(false);
        const resumedFrame = await new Promise((resolve, reject) => {
          let remove = null;
          const timer = setTimeout(() => {
            remove?.();
            reject(new Error('Visible-state render did not complete.'));
          }, 5000);
          remove = viewer.scene.postRender.addEventListener(() => {
            clearTimeout(timer);
            remove?.();
            resolve(viewer.scene.frameState?.frameNumber ?? null);
          });
        });
        return {
          mode: 'simulated-document-hidden-property',
          loopStopped,
          resumedFrame,
          resumedFrameAfterPrior: Number.isFinite(beforeFrame)
            ? Number.isFinite(resumedFrame) && resumedFrame > beforeFrame
            : null,
        };
      } finally {
        if (hiddenDescriptor)
          Object.defineProperty(documentObject, 'hidden', hiddenDescriptor);
        else delete documentObject.hidden;
        if (stateDescriptor)
          Object.defineProperty(
            documentObject,
            'visibilityState',
            stateDescriptor,
          );
        else delete documentObject.visibilityState;
        documentObject.dispatchEvent(new Event('visibilitychange'));
      }
    });
    reportState.observations.push({
      stage: 'visibility-control',
      state: { ...visibilityControl, pageErrors: errors.slice(-4) },
    });

    reportState.stage = 'end-snapshot';
    const end = await fixturePage.evaluate((expectedCommit) => {
      const app = window.__godsEyeView;
      const viewer = app.viewer;
      const gl = viewer.scene.context?._gl;
      const attributes = gl?.getContextAttributes?.() || {};
      const visual = app.styleManager.getVisualState();
      const detection = app.styleManager.services?.getDetectionTuning?.() || {};
      const stats = Object.fromEntries(
        ['flights', 'military'].map((id) => {
          const layer = app.dataManager
            .getAll()
            .find((entry) => entry.id === id);
          return [
            id,
            {
              enabled: layer?.enabled === true,
              lifecycleState: layer?.lifecycleState ?? null,
              lifecycleUncertain: layer?.lifecycleUncertain ?? null,
              ...app.dataManager.layers.get(id)?.module?.getStats?.(),
            },
          ];
        }),
      );
      const globe = viewer.scene.globe;
      const surface = globe?._surface;
      const tileQueues = {
        high: Array.isArray(surface?._tileLoadQueueHigh)
          ? surface._tileLoadQueueHigh.length
          : null,
        medium: Array.isArray(surface?._tileLoadQueueMedium)
          ? surface._tileLoadQueueMedium.length
          : null,
        low: Array.isArray(surface?._tileLoadQueueLow)
          ? surface._tileLoadQueueLow.length
          : null,
      };
      const tileQueueCount =
        tileQueues.high === null ||
        tileQueues.medium === null ||
        tileQueues.low === null
          ? null
          : tileQueues.high + tileQueues.medium + tileQueues.low;
      return {
        applicationStatus: window.__qaApplication.getState().status,
        source: {
          appCommit: app.getPerformanceEnvironment().appCommit,
          expectedCommit,
          matchesHarnessHead:
            app.getPerformanceEnvironment().appCommit === expectedCommit,
        },
        browser: (() => {
          const environment = app.getPerformanceEnvironment();
          const userAgent = navigator.userAgent;
          const renderer = String(environment.renderer || '');
          return {
            family: /Chrome\//.test(userAgent) ? 'chromium' : 'other',
            version: userAgent.match(/Chrome\/([0-9.]+)/)?.[1] || null,
            rendererClass: /swiftshader/i.test(renderer)
              ? 'swiftshader'
              : /llvmpipe|softpipe/i.test(renderer)
                ? 'software-other'
                : renderer
                  ? 'hardware-or-unknown'
                  : 'unavailable',
            renderer: renderer.replace(/[\u0000-\u001f]/g, '').slice(0, 240),
            viewport: environment.viewport,
            drawingBuffer: environment.drawingBuffer,
          };
        })(),
        fixtureEpochMs: Date.now(),
        camera: (() => {
          const cartographic = viewer.camera.positionCartographic;
          if (!cartographic)
            throw new Error('Camera cartographic position is unavailable.');
          const degrees = (radians) => (radians * 180) / Math.PI;
          const angleDegrees = (radians) => {
            const degreesValue = degrees(radians);
            return ((((degreesValue + 180) % 360) + 360) % 360) - 180;
          };
          return {
            latitude: degrees(cartographic.latitude),
            longitude: degrees(cartographic.longitude),
            altitudeMeters: cartographic.height,
            headingDegrees: angleDegrees(viewer.camera.heading),
            pitchDegrees: angleDegrees(viewer.camera.pitch),
            rollDegrees: angleDegrees(viewer.camera.roll),
          };
        })(),
        visibilityState: document.visibilityState,
        focused: document.hasFocus(),
        frameNumber: viewer.scene.frameState?.frameNumber ?? null,
        stats,
        enabledLayerIds: app.dataManager
          .getAll()
          .filter((layer) => layer.enabled)
          .map((layer) => layer.id)
          .sort(),
        map: {
          status: app.mapStackController.getState().status,
          activeId: app.mapStackController.getActiveId(),
        },
        mapDemand: {
          globeTilesLoaded:
            typeof globe?.tilesLoaded === 'boolean' ? globe.tilesLoaded : null,
          tileQueues,
          tileQueueCount,
        },
        settings: {
          msaaSamples: viewer.scene.msaaSamples ?? null,
          preserveDrawingBuffer: attributes.preserveDrawingBuffer ?? null,
          antialias: attributes.antialias ?? null,
          fxaaEnabled: viewer.scene.postProcessStages?.fxaa?.enabled ?? null,
          resolutionScale: viewer.resolutionScale ?? null,
          canvasWidth: viewer.scene.canvas?.width ?? null,
          canvasHeight: viewer.scene.canvas?.height ?? null,
          bloomIntensity: visual?.bloom?.intensity ?? null,
          bloomEnabled: visual?.bloom?.enabled ?? null,
          bloomVersion: visual?.bloom?.version ?? null,
          sharpenIntensity: visual?.sharpen?.intensity ?? null,
          sharpenEnabled: visual?.sharpen?.enabled ?? null,
          style: visual?.style ?? null,
          hudVisible: visual?.hud?.visible ?? null,
          hudVariant: visual?.hud?.variant ?? null,
          detectionMode: visual?.detection?.mode ?? null,
          allocation: visual?.detection?.allocation ?? null,
          qualityMode: app.styleManager._adaptiveQuality?.getMode?.() ?? null,
          densityPct: Number.isFinite(detection.densityPct)
            ? detection.densityPct
            : null,
          visualDensityPct: Number.isFinite(visual?.detection?.density)
            ? visual.detection.density
            : null,
        },
        governor: app.getRenderGovernorDiagnostics(),
      };
    }, expectedCommit);
    const statsStability = assessRenderDemandSnapshotStability(start, end, {
      expectedFlightReceiptMs: flights.fixedTimeMs,
    });
    const endObservation = { ...end, statsStability };
    reportState.observations.push({
      stage: 'end-snapshot',
      state: {
        ...endObservation,
        mapDemand: {
          ...end.mapDemand,
          tileQueueStableSamples: settled.tileQueueStableSamples,
          observedProviderRequests: providerRequestsAfterForeground,
          interceptedProviderRequests: interceptedRequestsAfterForeground,
          pendingProviderRequests: pendingMapProviderRequests.size,
          requestTrackingOverflow: mapProviderRequestTrackingOverflow,
        },
        pageErrors: errors.slice(-4),
      },
    });
    assert.deepEqual(end.enabledLayerIds, start.enabledLayerIds);
    assert.equal(statsStability.stableHealthAndPopulation, true);
    assert.equal(statsStability.receiptTimestampsValid, true);
    assert.deepEqual(end.settings, start.settings);
    assert.deepEqual(end.map, start.map);
    assert.deepEqual(end.browser, start.browser);
    assert.deepEqual(end.camera, start.camera);
    assert.equal(
      end.mapDemand.globeTilesLoaded,
      start.mapDemand.globeTilesLoaded,
      'Globe tile-load state changed during the static observation.',
    );
    assert.deepEqual(
      end.mapDemand.tileQueues,
      start.mapDemand.tileQueues,
      'Globe tile work queues changed during the static observation.',
    );
    assert.equal(end.mapDemand.tileQueueCount, 0);
    assert.equal(end.applicationStatus, 'ready');
    assert.equal(end.source.appCommit, start.source.appCommit);
    assert.equal(end.source.matchesHarnessHead, true);
    assert.equal(start.applicationStatus, 'ready');
    assert.equal(start.source.matchesHarnessHead, true);
    assert.match(start.source.appCommit || '', /^[a-f0-9]{40}$/);
    assert.equal(start.browser.family, 'chromium');
    assert.match(start.browser.version || '', /^\d+(?:\.\d+){3}$/);
    assert.ok(
      start.browser.renderer.length > 0 &&
        start.browser.rendererClass !== 'unavailable',
      'A browser renderer string must be retained for review.',
    );
    assert.deepEqual(start.browser.viewport, {
      width: 1440,
      height: 1000,
      dpr: 1,
    });
    assert.deepEqual(start.browser.drawingBuffer, {
      width: 1440,
      height: 1000,
    });
    const sourceFinish = assessHostedSourceFinish(
      sourceStartSnapshot,
      inspectTrackedWorktree(),
    );
    reportState.sourceFinish = sourceFinish;
    reportState.observations.push({
      stage: 'end-snapshot',
      state: {
        sourceChangedDuringRun: sourceFinish.sourceChangedDuringRun,
        sourceIdentityError: sourceFinish.error,
      },
    });
    assert.equal(sourceFinish.sourceChangedDuringRun, false);

    reportState.stage = 'application-destroy';
    const destroy = await fixturePage.evaluate(async () => {
      const app = window.__godsEyeView;
      const application = window.__qaApplication;
      const viewerCanvas = app.viewer.scene.canvas;
      const worldOverlayCanvas = document.getElementById(
        'world-overlay-canvas',
      );
      const hostCctvCanvas = document.getElementById('cctv-video');
      const hostCctvMarkupMatches =
        hostCctvCanvas?.matches(
          '#cctv-panel #cctv-frame-wrap > canvas#cctv-video.cctv-frame[hidden]',
        ) === true;
      const hostCctvDimensionsBefore = hostCctvCanvas
        ? { width: hostCctvCanvas.width, height: hostCctvCanvas.height }
        : null;
      const describeCanvases = () => {
        const canvases = Array.from(document.querySelectorAll('canvas'));
        return {
          count: canvases.length,
          truncated: canvases.length > 8,
          entries: canvases.slice(0, 8).map((canvas) => ({
            role:
              canvas === viewerCanvas
                ? 'viewer-scene'
                : canvas === worldOverlayCanvas
                  ? 'world-overlay-host'
                  : canvas === hostCctvCanvas
                    ? 'cctv-template-host'
                    : 'other',
            width:
              Number.isSafeInteger(canvas.width) && canvas.width >= 0
                ? canvas.width
                : null,
            height:
              Number.isSafeInteger(canvas.height) && canvas.height >= 0
                ? canvas.height
                : null,
            hidden: canvas.hidden === true,
          })),
        };
      };
      const resourcesBefore = {
        postRenderListeners:
          app.viewer.scene.postRender.numberOfListeners ?? null,
        primitives: app.viewer.scene.primitives.length,
        imageryLayers: app.viewer.imageryLayers.length,
        viewerCanvasPresent: Boolean(viewerCanvas?.isConnected),
        worldOverlayCanvasPresent: Boolean(worldOverlayCanvas?.isConnected),
        hostCctvMarkupMatches: hostCctvMarkupMatches,
        canvasInventory: describeCanvases(),
      };
      const postRenderEvent = app.viewer.scene.postRender;
      const teardown = await application.destroy();
      const hostCctvMarkupMatchesAfter =
        hostCctvCanvas?.matches(
          '#cctv-panel #cctv-frame-wrap > canvas#cctv-video.cctv-frame[hidden]',
        ) === true;
      const productionHandlesRemoved =
        !window.__godsEyeView &&
        !window.__gevVoiceCommands &&
        !window.__gevAnnotations;
      delete window.__qaApplication;
      document.dispatchEvent(new Event('visibilitychange'));
      window.dispatchEvent(new Event('resize'));
      app.requestRender('after-render-demand-destroy');
      await new Promise((resolve) => setTimeout(resolve, 100));
      return {
        status: application.getState().status,
        viewerDestroyed: app.viewer.isDestroyed(),
        layers: app.dataManager.layers.size,
        productionHandlesRemoved,
        testAliasRemoved: !window.__qaApplication,
        resourcesBefore,
        resourcesAfter: {
          canvasInventory: describeCanvases(),
          viewerCanvasRemoved: !Array.from(
            document.querySelectorAll('canvas'),
          ).includes(viewerCanvas),
          worldOverlayCanvasRemoved:
            worldOverlayCanvas === null ||
            !Array.from(document.querySelectorAll('canvas')).includes(
              worldOverlayCanvas,
            ),
          hostCctvMarkupMatches: hostCctvMarkupMatchesAfter,
          hostCctvReferenceRetained:
            hostCctvMarkupMatchesAfter &&
            document.getElementById('cctv-video') === hostCctvCanvas &&
            hostCctvCanvas.isConnected,
          hostCctvDimensionsUnchanged:
            hostCctvCanvas !== null &&
            hostCctvCanvas.width === hostCctvDimensionsBefore?.width &&
            hostCctvCanvas.height === hostCctvDimensionsBefore?.height &&
            hostCctvCanvas.hidden,
          onlyHostCctvCanvasRemains: (() => {
            const canvases = Array.from(document.querySelectorAll('canvas'));
            return (
              canvases.length === 1 &&
              canvases[0] === hostCctvCanvas &&
              hostCctvMarkupMatchesAfter
            );
          })(),
          credits: document.querySelectorAll('#cesium-credits').length,
          dataLayers: app.dataManager.layers.size,
          postRenderListeners: postRenderEvent.numberOfListeners ?? null,
        },
        governor: app.getRenderGovernorDiagnostics(),
        applicationRenderOwnersReleased: (() => {
          const governor = app.getRenderGovernorDiagnostics();
          return (
            governor.installed === false &&
            governor.holds.length === 0 &&
            governor.scheduledUpdates.length === 0
          );
        })(),
        teardownErrors: Array.isArray(teardown?.errors)
          ? teardown.errors.length
          : 0,
      };
    });
    reportState.observations.push({
      stage: 'application-destroy',
      state: { ...destroy, pageErrors: errors.slice(-4) },
    });
    await fixturePage.close();
    const interceptionRelease = await interception.releaseSession({
      targetClosed: true,
    });
    await cleanupFixturePageDiagnostics(fixturePage);
    mapStreamingDeliverySummary = mapStreamingDelivery.dispose();
    assertMapStreamingDeliveryHealthy(mapStreamingDelivery);
    ownerCleanupCompleted = interceptionRelease.confirmed;
    terminal = {
      schema: 'gev-application-render-demand-diagnostic/v1',
      status:
        staticObservation.foregroundUninterrupted &&
        staticObservation.mapProviderTraffic.stable &&
        settled.settled &&
        statsStability.stableHealthAndPopulation &&
        statsStability.receiptTimestampsValid &&
        settled.sample?.tileQueueCount === 0 &&
        end.mapDemand.tileQueueCount === 0 &&
        end.mapDemand.globeTilesLoaded === settled.sample?.globeTilesLoaded &&
        settled.tileQueueStableSamples >= 4 &&
        observedMapProviderRequestCount === expectedBlockedMapProviderCount &&
        mapStreamingDeliverySummary.cleanupConfirmed &&
        mapStreamingDeliverySummary.requestedCount > 0 &&
        mapStreamingDeliverySummary.cancelledCount === 0 &&
        mapStreamingDeliverySummary.pendingCount === 0 &&
        expectedBlockedStaticFontCount === 2 &&
        pendingMapProviderRequests.size === 0 &&
        !mapProviderRequestTrackingOverflow &&
        !staticObservation.eventOverflow &&
        staticObservation.durationMs >= 10_000 &&
        staticObservation.completedPostRenderCount <= 2 &&
        visibilityControl.loopStopped &&
        visibilityControl.resumedFrameAfterPrior === true &&
        destroy.status === 'destroyed' &&
        destroy.viewerDestroyed &&
        destroy.layers === 0 &&
        !destroy.governor.installed &&
        destroy.governor.holds.length === 0 &&
        destroy.productionHandlesRemoved &&
        destroy.testAliasRemoved &&
        destroy.resourcesAfter.onlyHostCctvCanvasRemains &&
        destroy.resourcesAfter.viewerCanvasRemoved &&
        destroy.resourcesAfter.worldOverlayCanvasRemoved &&
        destroy.resourcesAfter.hostCctvReferenceRetained &&
        destroy.resourcesAfter.hostCctvDimensionsUnchanged &&
        destroy.resourcesBefore.viewerCanvasPresent &&
        destroy.resourcesBefore.worldOverlayCanvasPresent &&
        destroy.resourcesBefore.hostCctvMarkupMatches &&
        destroy.resourcesBefore.canvasInventory.count ===
          destroy.resourcesBefore.canvasInventory.entries.length &&
        destroy.resourcesBefore.canvasInventory.entries.filter(
          ({ role }) => role === 'viewer-scene',
        ).length === 1 &&
        destroy.resourcesBefore.canvasInventory.entries.filter(
          ({ role }) => role === 'world-overlay-host',
        ).length === 1 &&
        destroy.resourcesBefore.canvasInventory.entries.filter(
          ({ role }) => role === 'cctv-template-host',
        ).length === 1 &&
        !destroy.resourcesBefore.canvasInventory.truncated &&
        !destroy.resourcesAfter.canvasInventory.truncated &&
        destroy.resourcesAfter.canvasInventory.count ===
          destroy.resourcesAfter.canvasInventory.entries.length &&
        destroy.resourcesAfter.credits === 0 &&
        destroy.resourcesAfter.dataLayers === 0 &&
        destroy.applicationRenderOwnersReleased &&
        destroy.teardownErrors === 0 &&
        routeAttempts.flights > 0 &&
        routeAttempts.military > 0 &&
        invalidFixtureRouteCount === 0 &&
        otherApiPaths.size === 0 &&
        !otherApiPathOverflow &&
        unexpectedApiCount === 0 &&
        unexpectedExternalCount === 0 &&
        networkProbe?.status === 'passed' &&
        errors.length === 0 &&
        interceptionRelease.confirmed
          ? 'passed'
          : 'failed',
      scope:
        'full application with enabled-empty civil and military source layers and deterministic Austin map fixtures; diagnostic, not content or hardware qualification',
      fixture: {
        profileId: RENDER_DEMAND_PROFILE.id,
        profileSha256: RENDER_DEMAND_PROFILE_SHA256,
        fixedTime,
        wallElapsedAtObservationMs: fixtureWallElapsedMs,
        flightsId: flights.id,
        flightsSha256: flights.sha256,
        flightsBytes: flights.byteLength,
        militaryId: military.id,
        militarySha256: military.sha256,
        militaryBytes: military.byteLength,
        mapStreamingId: mapStreamingFixture.id,
        mapStreamingManifestSha256: mapStreamingFixture.manifestSha256,
        populations: {
          flights: start.stats.flights.count,
          military: start.stats.military.count,
        },
      },
      delivery: { routeAttempts, acknowledged: delivered },
      otherApiPaths: [...otherApiPaths].slice(0, 8),
      expectedBootstrapApiCount,
      expectedRenderDemandApiCount,
      expectedBlockedStaticFontCount,
      expectedBlockedMapProviderCount,
      unexpectedApiCount,
      unexpectedExternalCount,
      otherApiPathOverflow,
      invalidFixtureRouteCount,
      networkProbe,
      foreground: staticObservation,
      foregroundFrameMaximum: 2,
      mapDemand: {
        settled: settled.settled,
        contentReadiness: 'deterministic-fixture',
        meaning: settled.demandMeaning ?? null,
        globeTilesLoaded: end.mapDemand.globeTilesLoaded,
        settledGlobeTilesLoaded: settled.sample?.globeTilesLoaded ?? null,
        pendingTileQueueCount: end.mapDemand.tileQueueCount,
        settledPendingTileQueueCount: settled.sample?.tileQueueCount ?? null,
        tileQueueStableSamples: settled.tileQueueStableSamples,
        providerRequestsBefore: providerRequestsBeforeForeground,
        providerRequestsAfter: providerRequestsAfterForeground,
        interceptedProviderRequests: interceptedRequestsAfterForeground,
        pendingProviderRequests: pendingMapProviderRequests.size,
        requestTrackingOverflow: mapProviderRequestTrackingOverflow,
        delivery: mapStreamingDeliverySummary,
      },
      statsStability,
      visibilityControl,
      teardown: {
        ...destroy,
        interceptionRelease: interceptionRelease.interception,
      },
      pageErrors: errors.slice(0, 8),
      start,
      end: endObservation,
      observations: reportState.observations,
    };
    reportState.terminal = terminal;
    if (terminal.status !== 'passed')
      throw new Error(
        'Application render-demand acceptance conditions failed.',
      );
    console.log(JSON.stringify(terminal, null, 2));
  } catch (error) {
    reportState.originalFailure = error;
    reportState.stage = reportState.stage || 'fixture-setup';
    reportState.delivery ||= { routeAttempts, acknowledged: delivered };
    reportState.traffic = {
      expectedBootstrapApiCount,
      expectedRenderDemandApiCount,
      expectedBlockedStaticFontCount,
      expectedBlockedMapProviderCount,
      observedMapProviderRequestCount,
      pendingMapProviderRequestCount: pendingMapProviderRequests.size,
      mapProviderRequestTrackingOverflow,
      unexpectedApiCount,
      unexpectedExternalCount,
      invalidFixtureRouteCount,
      otherApiPaths: [...otherApiPaths].slice(0, 8),
      otherApiPathOverflow,
    };
    throw error;
  } finally {
    fixturePage.off('request', observeMapProviderRequest);
    fixturePage.off('requestfinished', finishMapProviderRequest);
    fixturePage.off('requestfailed', finishMapProviderRequest);
    if (!mapStreamingDeliverySummary)
      mapStreamingDeliverySummary = mapStreamingDelivery.dispose();
    if (!ownerCleanupCompleted) {
      const cleanupErrors = [];
      try {
        if (!page.isClosed()) await page.close();
      } catch (error) {
        cleanupErrors.push(error);
      }
      try {
        const release = await interception.releaseSession({
          targetClosed: true,
        });
        if (terminal?.status === 'passed' && !release.confirmed)
          cleanupErrors.push(
            new Error('Fixture interception teardown failed.'),
          );
      } catch (error) {
        cleanupErrors.push(error);
      }
      try {
        await cleanupFixturePageDiagnostics(fixturePage);
      } catch (error) {
        cleanupErrors.push(error);
      }
      if (cleanupErrors.length) {
        reportState.observations.push({
          stage: 'fixture-cleanup',
          state: {
            cleanupErrorCount: cleanupErrors.length,
            cleanupErrors: cleanupErrors
              .slice(0, 3)
              .map((error) => error.message),
          },
        });
        if (!reportState.originalFailure) {
          reportState.stage = 'fixture-cleanup';
          throw cleanupErrors[0];
        }
      }
    }
  }
}

async function runOriginalLifecycle(browser) {
  const page = await browser.newPage();
  const errors = [];
  page.on('console', (message) => {
    if (
      message.type() === 'warn' &&
      /^\[Data\].*(?:destroy|disable) error:/.test(message.text())
    ) {
      console.log(message.text());
    }
  });
  page.on('pageerror', (error) => errors.push(error.stack || error.message));
  await page.goto(`${url}/?welcome=1`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__godsEyeView?.voiceCommands, {
    timeout: 60_000,
  });
  const before = await page.evaluate(async () => {
    const entry = [...document.scripts].find((script) =>
      /\/src\/main\.js(?:\?|$)/.test(script.src),
    );
    const { application } = await import(entry.src);
    window.__qaApplication = application;
    const app = window.__godsEyeView;
    window.__qaComponents = app;
    await application.start();
    await app.styleManager.initialRestorePromise;
    const enabled = await app.dataManager.setEnabled('local-datacenters', true);
    const annotation = await app.annotations.annotate([
      {
        type: 'pin',
        longitude: -97.74,
        latitude: 30.27,
        label: 'Lifecycle check',
      },
    ]);
    return {
      status: application.getState().status,
      enabled,
      layers: app.dataManager.layers.size,
      annotationCount: annotation.drawn,
      viewerAlive: !app.viewer.isDestroyed(),
      credits: Boolean(document.querySelector('#cesium-credits')),
    };
  });
  assert.equal(before.status, 'ready');
  assert.equal(before.enabled, true);
  assert.ok(before.layers >= 16);
  assert.equal(before.annotationCount, 1);
  assert.equal(before.viewerAlive, true);
  assert.equal(before.credits, true);
  console.log(
    'PASS: startup, data registration, annotations and visible attribution',
  );

  const after = await page.evaluate(async () => {
    const application = window.__qaApplication;
    const app = window.__qaComponents;
    const first = application.destroy();
    const samePromise = first === application.destroy();
    await first.catch((error) => {
      const describe = (failure) =>
        failure.errors?.map(describe).join('; ') || failure.message;
      throw new Error(describe(error));
    });
    document.dispatchEvent(new Event('visibilitychange'));
    window.dispatchEvent(new Event('resize'));
    app.requestRender('after-destroy');
    await new Promise((resolve) => setTimeout(resolve, 1400));
    return {
      status: application.getState().status,
      samePromise,
      viewerDestroyed: app.viewer.isDestroyed(),
      layers: app.dataManager.layers.size,
      annotations: app.annotations.count(),
      governor: app.getRenderGovernorDiagnostics(),
      handlesRemoved:
        !window.__godsEyeView &&
        !window.__gevVoiceCommands &&
        !window.__gevAnnotations,
      creditsRemoved: !document.querySelector('#cesium-credits'),
      welcomeHidden: !document.querySelector('#first-run-launcher.visible'),
      settingsRemoved: !document.querySelector('#key-setup'),
    };
  });
  assert.equal(after.status, 'destroyed');
  assert.equal(after.samePromise, true);
  assert.equal(after.viewerDestroyed, true);
  assert.equal(after.layers, 0);
  assert.equal(after.annotations, 0);
  assert.equal(after.governor.installed, false);
  assert.deepEqual(after.governor.holds, []);
  assert.equal(after.handlesRemoved, true);
  assert.equal(after.creditsRemoved, true);
  assert.equal(after.welcomeHidden, true);
  assert.equal(after.settingsRemoved, true);
  assert.deepEqual(errors, []);
  console.log(
    'PASS: terminal teardown releases runtime owners without late browser errors',
  );
}

const browser = await puppeteer.launch({
  headless: true,
  executablePath:
    process.env.PUPPETEER_EXECUTABLE_PATH || (await puppeteer.executablePath()),
  args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader'],
});
try {
  if (args.includes('--render-demand'))
    await runRenderDemandDiagnostic(browser);
  else await runOriginalLifecycle(browser);
} finally {
  await browser.close();
}
