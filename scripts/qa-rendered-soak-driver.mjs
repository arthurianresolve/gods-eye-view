import assert from 'node:assert/strict';
import {
  classifyRenderer,
  readBrowserGraphicsInfo,
  readHostEnvironment,
} from './performance/rendererEvidence.mjs';
export { isSoftwareRenderer } from './performance/rendererEvidence.mjs';
import { installWorkerDiagnostics } from './performance/workerDiagnostics.mjs';
import { createOwnedSoakCloser } from './performance/hostedSoakSession.mjs';
import {
  launchFixtureBrowser,
  prepareFixturePage,
  cleanupFixturePageDiagnostics,
  bootFixturePage,
  clickControl,
  openWorkspace,
  importFixtureGeometry,
  runWorkspaceFixturePhase,
} from './qa-application-fixtures.mjs';
import { closeTargetBeforeFixtureInterceptionRelease } from './performance/fixtureInterception.mjs';
import { runCesiumWorkerProbeInPage } from './performance/cesiumWorkerProbeInPage.mjs';
import { createSyntheticAircraftFrames } from '../src/recording/syntheticFixture.js';
import { createRecordingBundle } from '../src/recording/bundle.js';

const RENDERED_WORKSPACE_TIMEOUT_MS = 120_000;
const DEFAULT_SOAK_LOCATION = Object.freeze({
  latitude: 40.7,
  longitude: -73.9,
  altitude: 1000,
});

/** Normalize the fixture's geographic center so soak evidence names its view. */
export function resolveRenderedSoakLocation(location = {}) {
  const normalized = {
    latitude: Number(location.latitude ?? DEFAULT_SOAK_LOCATION.latitude),
    longitude: Number(location.longitude ?? DEFAULT_SOAK_LOCATION.longitude),
    altitude: Number(location.altitude ?? DEFAULT_SOAK_LOCATION.altitude),
  };
  if (
    !Number.isFinite(normalized.latitude) ||
    normalized.latitude < -90 ||
    normalized.latitude > 90 ||
    !Number.isFinite(normalized.longitude) ||
    normalized.longitude < -180 ||
    normalized.longitude > 180 ||
    !Number.isFinite(normalized.altitude) ||
    normalized.altitude <= 0
  )
    throw new TypeError('Rendered soak location is invalid.');
  return normalized;
}

export function isRecoverableApplicationPrewarmFailure(error) {
  const state = error?.fixtureStartupDiagnostics?.state;
  return Boolean(
    /timeout/i.test(error?.name || error?.message || '') &&
    state &&
    ['interactive', 'complete'].includes(state.readyState) &&
    state.applicationPresent === false &&
    state.workspacePanelPresent === false,
  );
}

async function prewarmRenderedApplication(browser, base) {
  const startedAt = Date.now();
  let fixture;
  let outcome = { status: 'passed' };
  try {
    fixture = await prepareFixturePage(browser, base);
    await bootFixturePage(fixture.page, base);
  } catch (error) {
    if (!isRecoverableApplicationPrewarmFailure(error)) throw error;
    outcome = {
      status: 'timed-out',
      reason: 'cold-module-graph-application-not-ready',
      diagnostics: error.fixtureStartupDiagnostics,
    };
  } finally {
    if (fixture) {
      await cleanupFixturePageDiagnostics(fixture.page);
      const cleanup = await closeTargetBeforeFixtureInterceptionRelease(
        fixture.page,
        fixture.interception,
      );
      if (!cleanup.confirmed) {
        const error =
          cleanup.error || new Error('Application prewarm cleanup failed.');
        error.message +=
          '; prewarm cleanup: ' +
          JSON.stringify({
            targetClosed: cleanup.targetClosed,
            release: cleanup.release,
          });
        throw error;
      }
    }
  }
  return { ...outcome, durationMs: Date.now() - startedAt };
}

/** Exercise the actual application, renderer, layer lifecycle and UI controllers. */
export async function createRenderedSoakDriver(
  base,
  {
    browserOptions = {},
    expectedCommit,
    prewarmApplication = false,
    location,
  } = {},
) {
  const soakLocation = resolveRenderedSoakLocation(location);
  const browser = await launchFixtureBrowser(browserOptions);
  const closeBrowser = createOwnedSoakCloser(browser);
  let startupPrewarm = null;
  let cameraFailure = true;
  let cameraHealthCalls = 0;
  let cameraFrameCalls = 0;
  const cameraHealthHistory = [];
  let archiveFailure = true;
  let archiveCalls = 0;
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=',
    'base64',
  );
  const json = (payload, status = 200) => ({
    status,
    contentType: 'application/json',
    body: JSON.stringify(payload),
  });
  try {
    if (prewarmApplication) {
      console.log('SOAK prewarm application');
      startupPrewarm = await prewarmRenderedApplication(browser, base);
      console.log(`SOAK prewarm ${startupPrewarm.status}`);
    }
    const { page, errors, verifyNetwork } = await prepareFixturePage(
      browser,
      base,
      {
        respond(url, request) {
          if (url.hostname === 'terrain.reearth.land')
            return {
              status: 404,
              contentType: 'text/plain',
              body: 'fixture terrain unavailable',
            };
          // Keep the hermetic soak representative of the real infrastructure
          // layer while bounding Cesium's data-source lifecycle. The production
          // file is several thousand features and is covered by the layer's
          // focused tests; the mixed-use soak must measure retained resources
          // from repeated journeys rather than fixture volume.
          if (url.pathname.endsWith('/datacenters.geojsonl'))
            return {
              status: 200,
              contentType: 'application/x-ndjson',
              body: Array.from({ length: 8 }, (_, n) =>
                JSON.stringify({
                  type: 'Feature',
                  id: 'way/' + (n + 1),
                  properties: { name: 'Synthetic datacenter ' + n },
                  geometry: {
                    type: 'Point',
                    coordinates: [
                      soakLocation.longitude + n * 0.002,
                      soakLocation.latitude,
                    ],
                  },
                }),
              ).join('\n'),
            };
          if (url.pathname === '/api/cctv/sources')
            return json({
              sources: [0, 1].map((n) => ({
                id: 'fixture-camera-' + n,
                name: 'Synthetic agency camera ' + n,
                provider: 'Synthetic public-agency fixture',
                sourceKind: 'configured',
                url: 'https://example.test/frame',
                credit: 'https://example.test/camera',
                lat: soakLocation.latitude,
                lon: soakLocation.longitude + n * 0.001,
                feedType: 'image',
                headingDeg: 90,
                fovDeg: 60,
                rangeM: 145,
              })),
            });
          if (url.pathname === '/api/cctv/health') {
            cameraHealthCalls++;
            cameraHealthHistory.push({
              at: Date.now(),
              cameraFailure,
            });
            if (cameraHealthHistory.length > 16) cameraHealthHistory.shift();
          }
          if (url.pathname === '/api/cctv/health')
            return json({
              cameras: [0, 1].map((n) => ({
                id: 'fixture-camera-' + n,
                sourceKind: 'configured',
                status: cameraFailure && n === 0 ? 'unavailable' : 'ok',
                reasonCode:
                  cameraFailure && n === 0
                    ? 'upstream-http-error'
                    : 'delivered',
                transportStatus: cameraFailure && n === 0 ? 'failed' : 'ok',
                attemptedAt: Date.now(),
                lastSuccessAt: cameraFailure && n === 0 ? null : Date.now(),
                updatedAt: Date.now(),
                // Match a realistic public still-camera provider cadence. The
                // production freshness policy still expires this after three
                // declared intervals; the fixture result remains valid while
                // a slow hardware-rendered cycle opens and verifies evidence.
                refreshIntervalMs: 60_000,
              })),
            });
          if (url.pathname.startsWith('/api/cctv/frame/')) {
            cameraFrameCalls++;
            if (cameraFailure && url.pathname.endsWith('fixture-camera-0'))
              return json({ error: 'fixture-outage' }, 503);
            return { status: 200, contentType: 'image/png', body: png };
          }
          if (url.pathname === '/api/evidence/archive-lookup') {
            archiveCalls++;
            if (archiveFailure)
              return json({ state: 'failed', error: 'fixture-outage' }, 502);
            const { url: originalUrl } = JSON.parse(request.postData());
            return json({
              state: 'available',
              requestedUrl: originalUrl,
              reference: {
                kind: 'archive',
                title: 'Synthetic archive fixture',
                url:
                  'https://web.archive.org/web/20200101120000/' + originalUrl,
                originalUrl,
                archiveAt: Date.parse('2020-01-01T12:00:00Z'),
                lookedUpAt: Date.now(),
              },
            });
          }
        },
      },
    );
    await page.evaluateOnNewDocument(installWorkerDiagnostics);
    // Save-as uses a native prompt in production. The application normally
    // replaces window.prompt during fixture boot, but keep the soak setup
    // deterministic if a browser/renderer leaves the native dialog in place.
    page.on('dialog', async (dialog) => {
      if (dialog.type() === 'prompt')
        await dialog.accept('Rendered soak workspace');
      else await dialog.accept();
    });
    console.log('SOAK boot application');
    await bootFixturePage(page, base, {
      // A cold Vite development graph can take more than 90 seconds to compile
      // on the primary UHD 620 qualification host. This remains a bounded cold
      // activation allowance outside the measured soak interval; ordinary
      // browser gates retain the stricter shared default.
      applicationReadyTimeoutMs: 180_000,
    });
    console.log('SOAK application ready');
    const applicationCommit = await page.evaluate(
      () =>
        window.__godsEyeView.getPerformanceEnvironment?.()?.appCommit || null,
    );
    if (expectedCommit && applicationCommit !== expectedCommit)
      throw new Error(
        `Soak application commit mismatch: expected ${expectedCommit}, received ${applicationCommit}`,
      );
    const networkPreflight = await verifyNetwork();
    console.log('SOAK worker network interception preflight passed');
    let workerPreflight;
    try {
      workerPreflight = await page.evaluate(runCesiumWorkerProbeInPage);
    } catch (error) {
      const diagnostics = await page
        .evaluate(() => window.__gevSoakWorkers?.snapshot?.() || null)
        .catch(() => null);
      error.message += '; worker diagnostics: ' + JSON.stringify(diagnostics);
      throw error;
    }
    workerPreflight.network = networkPreflight;
    console.log('SOAK worker completion preflight passed');
    // Seed only synthetic observations through the real application recorder.
    const recordingStartAt = await page.evaluate(() => Date.now());
    const recordingFrames = createSyntheticAircraftFrames({
      startAt: recordingStartAt,
      sampleCount: 4,
      intervalMs: 1000,
    });
    await page.evaluate(async (frames) => {
      const app = window.__godsEyeView;
      await app.aircraftRecording.start({
        id: 'recording-rendered-soak',
        sourceId: 'synthetic-fixture',
        region: { center: { latitude: 0, longitude: 179.7 }, radiusKm: 25 },
      });
      for (const frame of frames) await app.aircraftRecording.ingest(frame);
      await app.aircraftRecording.stop('fixture-ready');
    }, recordingFrames);
    console.log('SOAK boot application');
    await bootFixturePage(page, base);
    console.log('SOAK application ready');
    const soakPhase = (phase, operation, diagnosticContext) =>
      runWorkspaceFixturePhase(page, phase, operation, {
        diagnosticContext,
        onProgress: (progress) => console.log(`SOAK ${progress}`),
      });
    await soakPhase('workspace-save-as-click', () =>
      clickControl(page, '.workspace-library [data-action="save-as"]'),
    );
    await soakPhase('workspace-save-as-selection', () =>
      page.waitForFunction(
        () =>
          document.querySelector('.workspace-library [data-workspace-select]')
            ?.value,
        { polling: 100, timeout: 30000 },
      ),
    );
    const firstId = await soakPhase('workspace-first-id-read', () =>
      page.$eval(
        '.workspace-library [data-workspace-select]',
        (node) => node.value,
      ),
    );
    await soakPhase(
      'workspace-duplicate-click',
      () => clickControl(page, '.workspace-library [data-action="duplicate"]'),
      { targetWorkspaceId: firstId },
    );
    await soakPhase(
      'workspace-duplicate-status',
      () =>
        page.waitForFunction(
          () =>
            document
              .querySelector('.workspace-library [data-status]')
              ?.textContent.startsWith('Created'),
          { polling: 100, timeout: 30000 },
        ),
      { targetWorkspaceId: firstId },
    );
    await soakPhase(
      'workspace-duplicate-selection',
      () =>
        page.waitForFunction(
          (id) =>
            document.querySelector('.workspace-library [data-workspace-select]')
              ?.value !== id,
          { polling: 100, timeout: 30000 },
          firstId,
        ),
      { targetWorkspaceId: firstId },
    );
    const secondId = await page.$eval(
      '.workspace-library [data-workspace-select]',
      (node) => node.value,
    );
    const ids = [firstId, secondId];
    const session = await page.createCDPSession();
    await page.evaluate(() => {
      window.__soakRenderedFrames = 0;
      window.__godsEyeView.viewer.scene.postRender.addEventListener(
        () => window.__soakRenderedFrames++,
      );
    });
    const renderer = await page.evaluate(() => {
      const canvas = window.__godsEyeView.viewer.scene.canvas;
      const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
      const info = gl.getExtension('WEBGL_debug_renderer_info');
      return {
        vendor: gl.getParameter(info?.UNMASKED_VENDOR_WEBGL || gl.VENDOR),
        renderer: gl.getParameter(info?.UNMASKED_RENDERER_WEBGL || gl.RENDERER),
        version: gl.getParameter(gl.VERSION),
      };
    });
    const graphics = await readBrowserGraphicsInfo(browser);
    const renderingEvidence = classifyRenderer(renderer.renderer, graphics);
    let previousFrames = 0;
    let cycleNumber = 0;
    async function waitForArchiveState(phase, predicate) {
      try {
        // Network/DOM state is independent of Cesium's animation cadence.
        // Keep the existing deadline and assertion, using timer-based polling.
        await page.waitForFunction(predicate, { polling: 100, timeout: 30000 });
      } catch (error) {
        const state = await page
          .evaluate(() => ({
            text: document
              .querySelector('#evidence-panel')
              ?.textContent?.slice(-1600),
            buttons: [
              ...document.querySelectorAll('#evidence-panel button'),
            ].map((button) => ({
              text: button.textContent,
              disabled: button.disabled,
            })),
            visible: !document.hidden,
            focused: document.hasFocus(),
            renderedFrames: window.__soakRenderedFrames,
            renderLoop: window.__godsEyeView?.viewer?.useDefaultRenderLoop,
            contextLost:
              window.__godsEyeView?.viewer?.scene?.context?._gl?.isContextLost?.(),
          }))
          .catch(() => null);
        error.message +=
          '; archive fixture: ' +
          JSON.stringify({
            phase,
            cycle: cycleNumber - 1,
            archiveCalls,
            archiveFailure,
            state,
          });
        throw error;
      }
    }
    async function waitForCameraState(phase, predicate, timeout = 30_000) {
      const startedAt = Date.now();
      let terminal = false;
      let evaluationError = null;
      while (Date.now() - startedAt < timeout) {
        try {
          terminal = Boolean(await page.evaluate(predicate));
          evaluationError = null;
        } catch (error) {
          evaluationError = error;
        }
        if (terminal) {
          console.log('SOAK camera ' + phase + ' confirmed');
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, 300));
      }
      try {
        terminal = Boolean(await page.evaluate(predicate));
        evaluationError = null;
      } catch (error) {
        evaluationError = error;
      }
      if (terminal) {
        console.log('SOAK camera ' + phase + ' confirmed at deadline');
        return;
      }
      {
        const error =
          evaluationError ||
          new Error(`Camera ${phase} exceeded ${timeout}ms.`);
        const state = await page
          .evaluate(() => {
            const layer =
              window.__godsEyeView?.dataManager?.layers?.get('cctv')?.module;
            const ui = layer?.getUIState?.();
            const compact = (row) =>
              row
                ? {
                    id: row.id,
                    healthReason: row.healthReason,
                    sourceStatus: row.sourceStatus,
                    decodeStatus: row.decodeStatus,
                    decodeReason: row.decodeReason,
                    attemptedAt: row.attemptedAt,
                    lastSuccessAt: row.lastSuccessAt,
                    decodeAttemptedAt: row.decodeAttemptedAt,
                    decodeLastSuccessAt: row.decodeLastSuccessAt,
                  }
                : null;
            return {
              enabled:
                window.__godsEyeView?.dataManager?.isEnabled?.('cctv') || false,
              activeCamera: compact(ui?.activeCamera),
              cameras: (ui?.cameras || []).map(compact).slice(0, 8),
              visible: !document.hidden,
              focused: document.hasFocus(),
              browserNow: Date.now(),
              renderedFrames: window.__soakRenderedFrames,
              inspector: (() => {
                const panel = document.querySelector('#evidence-panel');
                return panel
                  ? {
                      hidden: panel.hidden,
                      pinned: panel.dataset.pinned,
                      text: panel.textContent?.slice(-800),
                    }
                  : null;
              })(),
            };
          })
          .catch(() => null);
        error.message +=
          '; camera fixture: ' +
          JSON.stringify({
            phase,
            cycle: cycleNumber - 1,
            cameraFailure,
            cameraHealthCalls,
            cameraFrameCalls,
            cameraHealthHistory,
            state,
          });
        throw error;
      }
    }
    async function refreshCameraHealthAtBoundary(phase, timeout = 15_000) {
      const before = cameraHealthCalls;
      const startedAt = Date.now();
      while (Date.now() - startedAt < timeout) {
        // refreshLayer() is the application's public, serialized update
        // boundary. CCTV deliberately rate-limits health reads, so retry the
        // update until this boundary owns a new provider response instead of
        // assuming that a visibility toggle refreshes network state.
        await page.evaluate(() =>
          window.__godsEyeView.dataManager.refreshLayer('cctv'),
        );
        if (cameraHealthCalls > before) {
          console.log('SOAK camera ' + phase + ' provider refresh confirmed');
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, 350));
      }
      throw new Error(
        `Camera ${phase} provider refresh exceeded ${timeout}ms; calls remained ${cameraHealthCalls} after ${before}.`,
      );
    }
    async function cycle() {
      const iteration = cycleNumber++;
      assert.deepEqual(errors, []);
      console.log('SOAK cycle ' + iteration + ' workspace/import');
      const id = ids[iteration % 2];
      // Bound fixture size while still committing, opening and rendering real imports.
      await page.evaluate(async (key) => {
        const library = window.__godsEyeView.workspaceLibraryPanel.library;
        const record = await library.getWorkspace(key);
        await library.save(
          {
            ...record.document,
            chunks: { ...record.chunks, imports: [] },
            pinnedEvidence: [],
          },
          { id: key, expectedRevision: record.manifest.revision },
        );
      }, id);
      const onWorkspacePhase = (phase) =>
        console.log('SOAK phase ' + iteration + ' ' + phase);
      await openWorkspace(page, id, {
        timeoutMs: RENDERED_WORKSPACE_TIMEOUT_MS,
        onProgress: onWorkspacePhase,
      });
      await importFixtureGeometry(page, 'Rendered soak ' + iteration, {
        onProgress: onWorkspacePhase,
      });
      await page.evaluate(async () => {
        const app = window.__godsEyeView;
        for (const enabled of [false, true])
          await app.dataManager.setEnabled('local-datacenters', enabled);
        const record = app.dataManager.layers
          .get('local-datacenters')
          ?.module?.getAnalystRecords?.()
          ?.find((row) => row.evidence);
        if (!record?.evidence) throw new Error('Infrastructure was not loaded');
        window.dispatchEvent(
          new CustomEvent('gev:entity-selected', {
            detail: { label: record.name, evidence: record.evidence },
          }),
        );
        document.querySelector('.evidence-panel-technical').open = true;
      });
      // A unique public reference prevents a cache hit from hiding failure/recovery.
      await page.evaluate((index) => {
        window.dispatchEvent(
          new CustomEvent('gev:entity-selected', {
            detail: {
              label: 'Public reference fixture',
              evidence: {
                entityRef: { layerKey: 'fixture', id: 'reference-' + index },
                sourceUrl: 'https://example.test/soak/' + index,
              },
            },
          }),
        );
        document.querySelector('.evidence-panel-technical').open = true;
      }, iteration);
      console.log('SOAK archive failure/recovery');
      archiveFailure = true;
      const before = archiveCalls;
      await clickControl(page, '[data-archive-url]');
      await waitForArchiveState('failed lookup shown', () =>
        document
          .querySelector('#evidence-panel')
          .textContent.includes('Archive lookup failed'),
      );
      archiveFailure = false;
      await clickControl(page, '[data-archive-url]');
      await waitForArchiveState('recovered lookup attachable', () =>
        [...document.querySelectorAll('#evidence-panel button')].some(
          (node) => node.textContent === 'Attach archived reference',
        ),
      );
      await page.evaluate(() =>
        [...document.querySelectorAll('#evidence-panel button')]
          .find((node) => node.textContent === 'Attach archived reference')
          .click(),
      );
      await clickControl(page, '.workspace-library [data-action="pin-a"]');
      await page.waitForFunction(() =>
        document
          .querySelector('.workspace-library [data-status]')
          .textContent.startsWith('Pinned evidence A'),
      );
      const bundle = await page.evaluate(
        (key) =>
          window.__godsEyeView.workspaceLibraryPanel.library.exportBackup(key),
        id,
      );
      assert.ok(
        JSON.parse(
          bundle,
        ).document.pinnedEvidence[0].snapshot.records[0].record.references.some(
          (ref) => ref.kind === 'archive',
        ),
      );
      assert.equal(archiveCalls - before, 2);
      // Pin A intentionally locks the inspector to the archived evidence.
      // Close it before the camera journey so the subsequent user selection
      // can open a fresh, unpinned camera evidence view.
      await clickControl(page, '#evidence-panel-close');
      console.log('SOAK replay');
      await page.select(
        '.investigation-timeline-aircraft-select',
        'recording-rendered-soak',
      );
      await page.waitForFunction(
        () =>
          window.__godsEyeView.aircraftSource.getState().mode === 'recorded',
      );
      await page.evaluate(async (index) => {
        const app = window.__godsEyeView;
        const slider = document.querySelector(
          '.investigation-timeline-slider-control',
        );
        slider.value = index % 2 ? slider.min : slider.max;
        slider.dispatchEvent(new Event('input', { bubbles: true }));
        await app.dataManager.setEnabled('flights', true);
        await app.dataManager.refreshLayer('flights');
        if (!(await app.aircraftSource.getSnapshot()).records.length)
          throw new Error('Replay lost observations');
      }, iteration);
      await page.waitForFunction(
        () =>
          window.__godsEyeView.dataManager.layers
            .get('flights')
            .module.getStats().count > 0,
      );
      // Real proxy-shaped health, image delivery/decoding and automatic alternative.
      console.log('SOAK camera outage');
      cameraFailure = true;
      await page.evaluate(async (location) => {
        const app = window.__godsEyeView;
        await app.dataManager.setEnabled('cctv', true);
        const destination = app.viewer.camera.position.constructor.fromDegrees(
          location.longitude,
          location.latitude,
          location.altitude,
        );
        const current = app.viewer.camera.position;
        // Reapplying an identical Cesium view starts another terrain quadtree
        // build even though the operator did not move. Keep the fixture's
        // camera journey representative without manufacturing unbounded work.
        if (
          Math.abs(current.x - destination.x) > 1 ||
          Math.abs(current.y - destination.y) > 1 ||
          Math.abs(current.z - destination.z) > 1
        )
          app.viewer.camera.setView({ destination });
        app.dataManager.layers
          .get('cctv')
          .module.setParams({ autoHop: false, showProjection: true });
      }, soakLocation);
      // Exercise the real visibility lifecycle, then cross the serialized
      // refresh boundary so the assertion observes a provider response made
      // after the fixture changed state.
      await page.evaluate(async () => {
        const manager = window.__godsEyeView.dataManager;
        await manager.setEnabled('cctv', false);
        await manager.setEnabled('cctv', true);
        manager.layers
          .get('cctv')
          .module.setParams({ autoHop: false, showProjection: true });
      });
      await refreshCameraHealthAtBoundary('outage');
      await waitForCameraState('outage-health', () => {
        const layer =
          window.__godsEyeView.dataManager.layers.get('cctv').module;
        return (
          layer
            .getUIState()
            .cameras.find((row) => row.id === 'fixture-camera-0')
            ?.healthReason === 'upstream-http-error'
        );
      });
      const cameraSelection = await page.evaluate(() => {
        // Workspace pinning and replay can legitimately leave the inspector
        // locked. Clear it at the ownership boundary immediately before the
        // camera selection that must populate the inspector.
        document.querySelector('#evidence-panel-close')?.click();
        const layer =
          window.__godsEyeView.dataManager.layers.get('cctv').module;
        let selected = null;
        const onSelected = (event) => {
          if (
            event.detail?.layerId === 'cctv' &&
            event.detail?.id === 'fixture-camera-0'
          )
            selected = {
              id: event.detail.id,
              healthReason: event.detail.cameraState?.healthReason,
              sourceStatus: event.detail.cameraState?.sourceStatus,
            };
        };
        window.addEventListener('gev:entity-selected', onSelected);
        if (!layer.selectCamera('fixture-camera-0'))
          throw new Error('Manual failed camera selection lost');
        window.removeEventListener('gev:entity-selected', onSelected);
        const panel = document.querySelector('#evidence-panel');
        return {
          selected,
          inspector: {
            hidden: panel?.hidden,
            pinned: panel?.dataset.pinned,
            text: panel?.textContent || '',
          },
        };
      });
      assert.deepEqual(cameraSelection.selected, {
        id: 'fixture-camera-0',
        healthReason: 'upstream-http-error',
        sourceStatus: 'unavailable',
      });
      assert.equal(cameraSelection.inspector.hidden, false);
      assert.equal(cameraSelection.inspector.pinned, 'false');
      assert.match(cameraSelection.inspector.text, /upstream-http-error/);
      assert.equal(
        await page.evaluate(() =>
          window.__godsEyeView.dataManager.layers
            .get('cctv')
            .module.focusNearest({ focus: false }),
        ),
        'fixture-camera-1',
      );
      console.log('SOAK camera recovery');
      cameraFailure = false;
      await page.evaluate(async () => {
        const manager = window.__godsEyeView.dataManager;
        await manager.setEnabled('cctv', false);
        await manager.setEnabled('cctv', true);
        manager.layers
          .get('cctv')
          .module.setParams({ autoHop: false, showProjection: true });
      });
      await refreshCameraHealthAtBoundary('recovery');
      await waitForCameraState('recovery-health', () => {
        const layer =
          window.__godsEyeView.dataManager.layers.get('cctv').module;
        return (
          layer
            .getUIState()
            .cameras.find((row) => row.id === 'fixture-camera-0')
            ?.healthReason === 'delivered'
        );
      });
      await page.evaluate(() =>
        window.__godsEyeView.dataManager.layers
          .get('cctv')
          .module.selectCamera('fixture-camera-0'),
      );
      await waitForCameraState(
        'recovery-decode',
        () =>
          window.__godsEyeView.dataManager.layers
            .get('cctv')
            .module.getUIState().activeCamera?.decodeStatus === 'ok',
      );
      assert.equal(
        await page.evaluate(() =>
          window.__godsEyeView.dataManager.layers
            .get('cctv')
            .module.focusNearest({ focus: false }),
        ),
        'fixture-camera-0',
      );
      const frameState = await page.evaluate(async () => {
        const app = window.__godsEyeView;
        const viewer = app.viewer;
        if (viewer.isDestroyed() || viewer.scene.context.isDestroyed())
          throw new Error('Renderer destroyed');
        viewer.resize();
        for (let n = 0; n < 3; n++) {
          viewer.scene.requestRender();
          viewer.render();
          await new Promise((resolve) => setTimeout(resolve, 20));
        }
        const canvas = viewer.scene.canvas;
        const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
        if (
          gl.isContextLost() ||
          gl.drawingBufferWidth < 1 ||
          gl.drawingBufferHeight < 1
        )
          throw new Error('Renderer lost its framebuffer');
        await app.dataManager.setEnabled('cctv', false);
        document
          .querySelector('.investigation-timeline-controls button:last-child')
          .click();
        return {
          frames: window.__soakRenderedFrames,
          frameNumber: viewer.scene.frameState?.frameNumber ?? null,
          requestRenderMode: viewer.scene.requestRenderMode,
          renderRequested: viewer.scene._renderRequested ?? null,
          canRender: viewer._cesiumWidget?._canRender ?? null,
          canvas: {
            clientWidth: canvas.clientWidth,
            clientHeight: canvas.clientHeight,
            width: canvas.width,
            height: canvas.height,
          },
        };
      });
      assert.ok(
        frameState.frames > previousFrames,
        `no rendered frames during mixed-use cycle: ${JSON.stringify(frameState)}`,
      );
      previousFrames = frameState.frames;
      await page.waitForFunction(
        () => window.__godsEyeView.aircraftSource.getState().mode === 'live',
      );
      await openWorkspace(page, id, {
        timeoutMs: RENDERED_WORKSPACE_TIMEOUT_MS,
      });
      assert.deepEqual(errors, []);
      return {
        sourceToggles: 8,
        replaySeeks: 1,
        imports: 1,
        workspaceReloads: 2,
        archiveFailures: 1,
        cameraRecoveries: 1,
      };
    }
    return {
      page,
      warmupIterations: 2,
      scope: 'rendered-application-fixtures',
      location: soakLocation,
      workerPreflight,
      applicationCommit,
      renderer,
      graphics,
      renderingEvidence,
      startupPrewarm,
      environment: readHostEnvironment(),
      hardwareRenderingValidated: renderingEvidence.accelerationVerified,
      browserVersion: await browser.version(),
      runCycle: cycle,
      metrics: () => page.metrics(),
      /**
       * Export the synthetic recording used by the soak as a portable bundle.
       * The rendered soak runs in an isolated browser context, so a share URL
       * containing only `ir=recording-rendered-soak` cannot be reopened from
       * the operator's normal Chrome profile unless this bundle is transferred.
       */
      async exportRecordingBundle(id = 'recording-rendered-soak') {
        const recording = await page.evaluate(async (recordingId) => {
          const app = window.__godsEyeView;
          const exported =
            await app?.aircraftRecording?.exportRecording?.(recordingId);
          if (!exported) return null;
          return {
            ...exported,
            chunks:
              exported.chunks instanceof Map
                ? Object.fromEntries(exported.chunks)
                : exported.chunks,
          };
        }, id);
        return recording ? createRecordingBundle(recording) : null;
      },
      async retainedMetrics() {
        await session.send('HeapProfiler.collectGarbage');
        const application = await page.evaluate(() => {
          const app = window.__godsEyeView;
          const snapshot = app?.getPerformanceSnapshot?.();
          return snapshot
            ? {
                resources: snapshot.resources || null,
                scene: snapshot.scene || null,
                timings: snapshot.timings || null,
                workers: window.__gevSoakWorkers?.snapshot() || null,
              }
            : null;
        });
        return {
          ...(await page.metrics()),
          ...(await session.send('Memory.getDOMCounters')),
          application,
          renderedFrames: previousFrames,
          garbageCollection: {
            status: 'completed',
            method: 'HeapProfiler.collectGarbage',
          },
        };
      },
      close: closeBrowser,
    };
  } catch (error) {
    try {
      error.browserClose = await closeBrowser();
    } catch (cleanupError) {
      error.browserClose = cleanupError.browserClose || {
        closeCompleted: false,
      };
      error.cleanupError = 'Application soak browser did not close normally.';
    }
    throw error;
  }
}
