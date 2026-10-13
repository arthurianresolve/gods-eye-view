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
  createProductionFlightFixture,
  createProductionMilitaryFixture,
  installFixtureWallClockOnPage,
  respondToProductionFlightFixture,
  respondToProductionMilitaryFixture,
} from './performance/productionFlightFixture.mjs';

const args = process.argv.slice(2);
const urlIndex = args.indexOf('--url');
const url = urlIndex >= 0 ? args[urlIndex + 1] : 'http://localhost:4173';

async function runRenderDemandDiagnostic(browser) {
  const fixedTime = DEFAULT_FLIGHT_FIXTURE_TIME;
  const fixedTimeMs = Date.parse(fixedTime);
  const flights = createProductionFlightFixture({ count: 0, fixedTime });
  const military = createProductionMilitaryFixture({ fixedTime });
  const delivered = { flights: 0, military: 0 };
  const routeAttempts = { flights: 0, military: 0 };
  const otherApiPaths = new Set();
  let externalRequestCount = 0;
  let invalidFixtureRouteCount = 0;
  let otherApiRequestCount = 0;
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
        if (requestUrl.hostname !== 'fixture-network.invalid')
          externalRequestCount += 1;
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
        // Record only bounded pathnames: never query strings, URLs, or bodies.
        otherApiRequestCount += 1;
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
    onFulfilled({ url: requestUrl, method, status, bodyBase64 }) {
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

  let terminal = null;
  let networkProbe = null;
  try {
    await installFixtureWallClockOnPage(fixturePage, fixedTimeMs);
    await bootFixturePage(fixturePage, url);
    networkProbe = await verifyNetwork();
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

    const deliveryDeadline = Date.now() + 30_000;
    while (
      (delivered.flights < 1 || delivered.military < 1) &&
      Date.now() < deliveryDeadline
    )
      await new Promise((resolve) => setTimeout(resolve, 50));

    const start = await fixturePage.evaluate(() => {
      const app = window.__godsEyeView;
      const viewer = app?.viewer;
      if (!app || !viewer?.scene)
        throw new Error('Application viewer is unavailable for observation.');
      const stats = Object.fromEntries(
        ['flights', 'military'].map((id) => [
          id,
          {
            enabled: app.dataManager.isEnabled(id),
            ...app.dataManager.layers.get(id)?.module?.getStats?.(),
          },
        ]),
      );
      return {
        fixtureEpochMs: Date.now(),
        visibilityState: document.visibilityState,
        focused: document.hasFocus(),
        frameNumber: viewer.scene.frameState?.frameNumber ?? null,
        stats,
        governor: app.getRenderGovernorDiagnostics(),
      };
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

    // Chromium CDP has no setPageVisibilityState command in the installed
    // protocol. Exercise only the app handler by simulating document properties
    // and dispatching the DOM event; this is not OS/browser visibility evidence.
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

    const destroy = await fixturePage.evaluate(async () => {
      const app = window.__godsEyeView;
      const application = window.__qaApplication;
      const teardown = await application.destroy();
      document.dispatchEvent(new Event('visibilitychange'));
      window.dispatchEvent(new Event('resize'));
      app.requestRender('after-render-demand-destroy');
      await new Promise((resolve) => setTimeout(resolve, 100));
      return {
        status: application.getState().status,
        viewerDestroyed: app.viewer.isDestroyed(),
        layers: app.dataManager.layers.size,
        governor: app.getRenderGovernorDiagnostics(),
        handleRemoved: !window.__godsEyeView && !window.__qaApplication,
        teardownErrors: Array.isArray(teardown?.errors)
          ? teardown.errors.length
          : 0,
      };
    });
    await fixturePage.close();
    const interceptionRelease = await interception.releaseSession({
      targetClosed: true,
    });
    await cleanupFixturePageDiagnostics(fixturePage);
    terminal = {
      schema: 'gev-application-render-demand-diagnostic/v1',
      status:
        staticObservation.foregroundUninterrupted &&
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
        destroy.handleRemoved &&
        destroy.teardownErrors === 0 &&
        routeAttempts.flights > 0 &&
        routeAttempts.military > 0 &&
        invalidFixtureRouteCount === 0 &&
        otherApiPaths.size === 0 &&
        !otherApiPathOverflow &&
        otherApiRequestCount === 0 &&
        externalRequestCount === 0 &&
        errors.length === 0 &&
        interceptionRelease.confirmed
          ? 'passed'
          : 'failed',
      scope:
        'full application with enabled-empty civil and military source layers; diagnostic, not hardware qualification',
      fixture: {
        fixedTime,
        wallElapsedAtObservationMs: fixtureWallElapsedMs,
        flightsId: flights.id,
        flightsSha256: flights.sha256,
        flightsBytes: flights.byteLength,
        militaryId: military.id,
        militarySha256: military.sha256,
        militaryBytes: military.byteLength,
        populations: {
          flights: start.stats.flights.count,
          military: start.stats.military.count,
        },
      },
      delivery: { routeAttempts, acknowledged: delivered },
      otherApiPaths: [...otherApiPaths].slice(0, 8),
      otherApiRequestCount,
      otherApiPathOverflow,
      invalidFixtureRouteCount,
      externalRequestCount,
      networkProbe,
      foreground: staticObservation,
      foregroundFrameMaximum: 2,
      visibilityControl,
      teardown: {
        ...destroy,
        interceptionRelease: interceptionRelease.interception,
      },
      pageErrors: errors.slice(0, 8),
    };
    console.log(JSON.stringify(terminal, null, 2));
    assert.equal(
      terminal.status,
      'passed',
      'Application render-demand diagnostic failed.',
    );
  } finally {
    if (!page.isClosed()) await page.close();
    const release = await interception.releaseSession({ targetClosed: true });
    await cleanupFixturePageDiagnostics(fixturePage);
    if (terminal?.status === 'passed')
      assert.equal(
        release.confirmed,
        true,
        'Fixture interception teardown failed.',
      );
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
