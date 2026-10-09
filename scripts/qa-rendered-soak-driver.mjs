import assert from 'node:assert/strict';
import {
  launchFixtureBrowser,
  prepareFixturePage,
  bootFixturePage,
  clickControl,
  openWorkspace,
  importFixtureGeometry,
} from './qa-application-fixtures.mjs';

/** Exercise the actual application, renderer, layer lifecycle and UI controllers. */
/** Chromium renderer strings that do not qualify as hardware evidence. */
export function isSoftwareRenderer(renderer) {
  return /swiftshader|software|llvmpipe|basic render|warp/i.test(
    String(renderer || ''),
  );
}

export async function createRenderedSoakDriver(
  base,
  { browserOptions = {}, expectedCommit } = {},
) {
  const browser = await launchFixtureBrowser(browserOptions);
  let cameraFailure = true;
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
    const { page, errors } = await prepareFixturePage(browser, base, {
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
                  coordinates: [-73.9 + n * 0.002, 40.7],
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
              lat: 40.7,
              lon: -73.9 + n * 0.001,
              feedType: 'image',
              headingDeg: 90,
              fovDeg: 60,
              rangeM: 145,
            })),
          });
        if (url.pathname === '/api/cctv/health')
          return json({
            cameras: [0, 1].map((n) => ({
              id: 'fixture-camera-' + n,
              sourceKind: 'configured',
              status: cameraFailure && n === 0 ? 'unavailable' : 'ok',
              reasonCode:
                cameraFailure && n === 0 ? 'upstream-http-error' : 'delivered',
              transportStatus: cameraFailure && n === 0 ? 'failed' : 'ok',
              attemptedAt: Date.now(),
              lastSuccessAt: cameraFailure && n === 0 ? null : Date.now(),
              updatedAt: Date.now(),
              refreshIntervalMs: 10000,
            })),
          });
        if (url.pathname.startsWith('/api/cctv/frame/')) {
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
              url: 'https://web.archive.org/web/20200101120000/' + originalUrl,
              originalUrl,
              archiveAt: Date.parse('2020-01-01T12:00:00Z'),
              lookedUpAt: Date.now(),
            },
          });
        }
      },
    });
    console.log('SOAK boot application');
    await bootFixturePage(page, base);
    console.log('SOAK application ready');
    const applicationCommit = await page.evaluate(
      () =>
        window.__godsEyeView.getPerformanceEnvironment?.()?.appCommit || null,
    );
    if (expectedCommit && applicationCommit !== expectedCommit)
      throw new Error(
        `Soak application commit mismatch: expected ${expectedCommit}, received ${applicationCommit}`,
      );
    const workerPreflight = await page.evaluate(async () => {
      const { runCesiumWorkerProbe } =
        await import('/scripts/fixtures/cesium-worker-probe.js');
      return runCesiumWorkerProbe();
    });
    console.log('SOAK worker completion preflight passed');
    // Seed only synthetic observations through the real application recorder.
    await page.evaluate(async () => {
      const app = window.__godsEyeView;
      const { createSyntheticAircraftFrames } =
        await import('/src/recording/index.js');
      const startAt = Date.now();
      await app.aircraftRecording.start({
        id: 'recording-rendered-soak',
        sourceId: 'synthetic-fixture',
        region: { center: { latitude: 0, longitude: 179.7 }, radiusKm: 25 },
      });
      for (const frame of createSyntheticAircraftFrames({
        startAt,
        sampleCount: 4,
        intervalMs: 1000,
      }))
        await app.aircraftRecording.ingest(frame);
      await app.aircraftRecording.stop('fixture-ready');
    });
    console.log('SOAK boot application');
    await bootFixturePage(page, base);
    console.log('SOAK application ready');
    await clickControl(page, '.workspace-library [data-action="save-as"]');
    await page.waitForFunction(
      () =>
        document.querySelector('.workspace-library [data-workspace-select]')
          .value,
    );
    const firstId = await page.$eval(
      '.workspace-library [data-workspace-select]',
      (node) => node.value,
    );
    await clickControl(page, '.workspace-library [data-action="duplicate"]');
    await page.waitForFunction(
      (id) =>
        document.querySelector('.workspace-library [data-workspace-select]')
          .value !== id,
      {},
      firstId,
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
    let previousFrames = 0;
    let cycleNumber = 0;
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
      await openWorkspace(page, id);
      await importFixtureGeometry(page, 'Rendered soak ' + iteration);
      await page.evaluate(async () => {
        const app = window.__godsEyeView;
        for (const enabled of [false, true])
          await app.dataManager.setEnabled('local-datacenters', enabled);
        const { getContextStore, selectEntityContext } =
          await import('/src/data/contextStore.js');
        const record = [...getContextStore().entities.values()].find(
          (row) => row.layerId === 'local-datacenters',
        );
        if (!record?.evidence) throw new Error('Infrastructure was not loaded');
        selectEntityContext(record.entity);
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
      await page.waitForFunction(() =>
        document
          .querySelector('#evidence-panel')
          .textContent.includes('Archive lookup failed'),
      );
      archiveFailure = false;
      await clickControl(page, '[data-archive-url]');
      await page.waitForFunction(() =>
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
      await page.evaluate(async () => {
        const app = window.__godsEyeView;
        await app.dataManager.setEnabled('cctv', true);
        const destination = app.viewer.camera.position.constructor.fromDegrees(
          -73.9,
          40.7,
          1000,
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
      });
      await page.waitForFunction(
        async () => {
          const layer =
            window.__godsEyeView.dataManager.layers.get('cctv').module;
          await layer.update();
          return (
            layer
              .getUIState()
              .cameras.find((row) => row.id === 'fixture-camera-0')
              ?.healthReason === 'upstream-http-error'
          );
        },
        { polling: 300, timeout: 20000 },
      );
      await page.evaluate(() => {
        const layer =
          window.__godsEyeView.dataManager.layers.get('cctv').module;
        if (!layer.selectCamera('fixture-camera-0'))
          throw new Error('Manual failed camera selection lost');
      });
      await page.waitForFunction(() =>
        document
          .querySelector('#evidence-panel')
          .textContent.includes('upstream-http-error'),
      );
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
      await page.waitForFunction(
        async () => {
          const layer =
            window.__godsEyeView.dataManager.layers.get('cctv').module;
          await layer.update();
          return (
            layer
              .getUIState()
              .cameras.find((row) => row.id === 'fixture-camera-0')
              ?.healthReason === 'delivered'
          );
        },
        { polling: 300, timeout: 20000 },
      );
      await page.evaluate(() =>
        window.__godsEyeView.dataManager.layers
          .get('cctv')
          .module.selectCamera('fixture-camera-0'),
      );
      await page.waitForFunction(
        () =>
          window.__godsEyeView.dataManager.layers
            .get('cctv')
            .module.getUIState().activeCamera?.decodeStatus === 'ok',
        { timeout: 20000 },
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
      await openWorkspace(page, id);
      assert.deepEqual(errors, []);
      return {
        sourceToggles: 4,
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
      workerPreflight,
      applicationCommit,
      renderer,
      hardwareRenderingValidated:
        Boolean(renderer?.renderer) && !isSoftwareRenderer(renderer.renderer),
      browserVersion: await browser.version(),
      runCycle: cycle,
      metrics: () => page.metrics(),
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
              }
            : null;
        });
        return {
          ...(await page.metrics()),
          ...(await session.send('Memory.getDOMCounters')),
          application,
          renderedFrames: previousFrames,
        };
      },
      async close() {
        await browser.close();
      },
    };
  } catch (error) {
    await browser.close();
    throw error;
  }
}
