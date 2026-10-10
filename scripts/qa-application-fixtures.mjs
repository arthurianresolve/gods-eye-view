/** Shared hermetic full-application journeys. No provider traffic leaves Chrome. */
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer';
import { interceptFixtureSession } from './performance/fixtureInterception.mjs';
import { createFixtureNetworkProbe } from './performance/fixtureNetworkProbe.mjs';
import { PROFILE_RECOVERY_WORKSPACE_ASSET_TEXT } from './performance/profileRecoveryFixtureContract.mjs';
import { clickAndWaitForWorkspaceOpen } from './performance/workspaceOpenProbe.mjs';
import {
  cleanupStartupHeartbeat,
  installStartupHeartbeat,
  parseWebglDiagnosticMarker,
  sanitizeDiagnosticText,
} from './performance/startupDiagnostics.mjs';

const fixtureDiagnostics = new WeakMap();

export function fixtureBrowserArgs({
  softwareRendering = process.env.GEV_QA_SOFTWARE_RENDERING === '1',
  webglOnly = process.env.GEV_QA_SWIFTSHADER_WEBGL_ONLY === '1',
} = {}) {
  const softwareRendererArgs = webglOnly
    ? [
        '--use-gl=angle',
        '--use-angle=swiftshader-webgl',
        '--enable-unsafe-swiftshader',
      ]
    : ['--use-gl=angle', '--use-angle=swiftshader'];
  return [
    '--no-sandbox',
    '--disable-dev-shm-usage',
    ...(softwareRendering ? softwareRendererArgs : []),
  ];
}

export async function launchFixtureBrowser(options = {}) {
  return puppeteer.launch({
    headless: true,
    executablePath:
      process.env.PUPPETEER_EXECUTABLE_PATH ||
      (await puppeteer.executablePath()),
    // Explicit fixture-only opt-in for GPU-less hosted recovery runners.
    // Hardware measurement callers keep their original renderer selection.
    args: fixtureBrowserArgs(),
    ...options,
  });
}

export async function prepareFixturePage(
  browser,
  base,
  {
    respond,
    viewport = { width: 1440, height: 1000 },
    startupDiagnostics = null,
    page: existingPage = null,
    onFulfilled = null,
  } = {},
) {
  const page = existingPage || (await browser.newPage());
  const errors = [];
  const networkProbe = createFixtureNetworkProbe(base);
  const startupMessages = [];
  const pageDiagnostics = {
    errors,
    startupMessages,
    startupDiagnostics,
    listeners: [],
  };
  fixtureDiagnostics.set(page, pageDiagnostics);
  page.on('console', (message) => {
    if (startupDiagnostics && message.type() === 'info') {
      const marker = parseWebglDiagnosticMarker(message.text());
      if (marker) startupDiagnostics.recordRendererPhase(marker);
      if (marker) return;
    }
    if (!['error', 'warn'].includes(message.type())) return;
    // Local fixture evidence only: strip URL values and bound diagnostics.
    startupMessages.push(
      message
        .text()
        .replace(/https?:\/\/[^\s"'<>]+/g, '[url]')
        .slice(0, 500),
    );
    if (startupMessages.length > 12) startupMessages.shift();
  });
  page.on('pageerror', (error) => errors.push(error.message));
  if (startupDiagnostics) {
    const onResponse = (response) => {
      if (response.status() < 400) return;
      const request = response.request();
      startupDiagnostics.recordRequest({
        url: request.url(),
        status: response.status(),
        method: request.method(),
        resourceType: request.resourceType(),
      });
    };
    const onRequestFailed = (request) => {
      startupDiagnostics.recordRequest({
        url: request.url(),
        method: request.method(),
        resourceType: request.resourceType(),
        failure: request.failure()?.errorText,
      });
    };
    page.on('response', onResponse);
    page.on('requestfailed', onRequestFailed);
    pageDiagnostics.listeners.push(
      ['response', onResponse],
      ['requestfailed', onRequestFailed],
    );
    pageDiagnostics.heartbeatScriptIdentifier = await installStartupHeartbeat(
      page,
      startupDiagnostics,
    );
  }
  page.setDefaultTimeout(30000);
  page.setDefaultNavigationTimeout(90000);
  await page.setViewport(viewport);
  const onError = (error) => {
    if (
      !page.isClosed() &&
      !/Target closed|Session closed|Invalid session/i.test(error.message)
    )
      errors.push(error.message);
  };
  // The high-level interceptor can leave module-worker requests paused while
  // waiting for a Network event that never arrives. The page target receives
  // worker Fetch events too; Chromium worker targets do not expose Fetch.enable.
  // The soak preflight checks local/external worker interception before use.
  await interceptFixtureSession(
    await page.createCDPSession(),
    base,
    (url, request) => networkProbe.respond(url) ?? respond?.(url, request),
    onError,
    onFulfilled ? { onFulfilled } : undefined,
  );
  return { page, errors, verifyNetwork: () => networkProbe.verify(page) };
}

export async function cleanupFixturePageDiagnostics(page) {
  const diagnostics = fixtureDiagnostics.get(page);
  if (!diagnostics) return;
  for (const [event, listener] of diagnostics.listeners)
    page.off(event, listener);
  if (diagnostics.startupDiagnostics)
    await cleanupStartupHeartbeat(
      page,
      diagnostics.heartbeatScriptIdentifier,
      1000,
    );
  fixtureDiagnostics.delete(page);
}

export function readFixturePageDiagnostics(page) {
  const diagnostics = fixtureDiagnostics.get(page);
  return diagnostics
    ? {
        errors: diagnostics.errors
          .slice(-8)
          .map((error) => sanitizeDiagnosticText(error, 240)),
        messages: diagnostics.startupMessages.slice(-12),
      }
    : { errors: [], messages: [] };
}

export async function bootFixturePage(
  page,
  base,
  { onProgress = () => {}, hash = '' } = {},
) {
  onProgress('navigation');
  await page.goto(base + '/?welcome=0' + hash, {
    waitUntil: 'domcontentloaded',
  });
  try {
    onProgress('application-ready');
    await page.waitForFunction(
      () => window.__godsEyeView?.workspaceLibraryPanel,
      // This is an application-state gate, not a rendered-frame gate. Chromium
      // can defer animation callbacks while an otherwise responsive software
      // renderer is busy; timer polling keeps the same condition and deadline.
      { timeout: 90000, polling: 100 },
    );
  } catch (error) {
    const diagnostics = fixtureDiagnostics.get(page);
    if (diagnostics?.startupDiagnostics) throw error;
    const state = await page
      .evaluate(() => ({
        readyState: document.readyState,
        applicationPresent: Boolean(window.__godsEyeView),
        workspacePanelPresent: Boolean(
          window.__godsEyeView?.workspaceLibraryPanel,
        ),
        visibility: document.visibilityState,
        focused: document.hasFocus(),
        canvasCount: document.querySelectorAll('canvas').length,
        cesiumError:
          document
            .querySelector('.cesium-widget-errorPanel')
            ?.textContent?.slice(0, 500) || null,
      }))
      .catch(() => null);
    error.message +=
      '; startup diagnostics: ' +
      JSON.stringify({
        state,
        errors: diagnostics?.errors?.slice(-5),
        messages: diagnostics?.startupMessages,
      });
    throw error;
  }
  onProgress('initial-view-restore');
  await page.evaluate(async () => {
    let timeout;
    try {
      await Promise.race([
        window.__godsEyeView.styleManager.initialRestorePromise,
        new Promise((_, reject) => {
          timeout = setTimeout(
            () =>
              reject(
                new Error(
                  'Initial view restore did not settle within 90 seconds.',
                ),
              ),
            90000,
          );
        }),
      ]);
      window.prompt = () => 'Persistent recovery investigation';
      window.confirm = () => true;
    } finally {
      clearTimeout(timeout);
    }
  });
  onProgress('ready');
}

export const clickControl = (page, selector) =>
  page.evaluate((target) => {
    const element = document.querySelector(target);
    if (!element || element.disabled)
      throw new Error('Unavailable control: ' + target);
    element.click();
  }, selector);

export async function openWorkspace(page, id) {
  await page.waitForFunction(
    (key) =>
      [
        ...document.querySelectorAll(
          '.workspace-library [data-workspace-select] option',
        ),
      ].some((option) => option.value === key),
    {},
    id,
  );
  await page.select('.workspace-library [data-workspace-select]', id);
  try {
    await page.evaluate(clickAndWaitForWorkspaceOpen);
  } catch (error) {
    const diagnostics = await page.evaluate(() => {
      const app = window.__godsEyeView;
      const layers = [...(app?.dataManager?.layers?.entries?.() || [])].map(
        ([id, entry]) => ({
          id,
          enabled: entry.enabled,
          lifecycleState: entry.lifecycleState,
          uncertain: entry.lifecycleUncertain,
          intentEpoch: entry.visibilityIntentEpoch,
          intentEnabled: entry.visibilityIntentEnabled,
          queuedIntent: entry.latestQueuedAbsoluteIntent || null,
        }),
      );
      return {
        status: document.querySelector('.workspace-library [data-status]')
          ?.textContent,
        restore: app?.workspaceLibraryPanel?.restore.getState(),
        workers: window.__gevSoakWorkers?.snapshot() || null,
        viewer: {
          entities: app?.viewer?.entities?.values?.length ?? null,
          dataSources: app?.viewer?.dataSources?.length ?? null,
          primitives: app?.viewer?.scene?.primitives?.length ?? null,
          groundPrimitives:
            app?.viewer?.scene?.groundPrimitives?.length ?? null,
        },
        performance: app?.getPerformanceSnapshot?.() || null,
        layers,
      };
    });
    error.message += `; workspace diagnostics: ${JSON.stringify(diagnostics)}`;
    throw error;
  }
}

export async function importFixtureGeometry(page, name = 'Persistent fixture') {
  await page.waitForSelector('.workspace-library [data-geo-file]', {
    visible: true,
  });
  await page.evaluate((label) => {
    const input = document.querySelector('.workspace-library [data-geo-file]');
    if (!input) throw new Error('Import file control is unavailable');
    input.value = '';
    const file = new File(
      [
        JSON.stringify({
          type: 'FeatureCollection',
          features: [
            {
              type: 'Feature',
              id: 'fixture-point',
              properties: { name: label },
              geometry: { type: 'Point', coordinates: [-73.9, 40.7] },
            },
          ],
        }),
      ],
      `fixture-${Date.now()}.geojson`,
      { type: 'application/geo+json' },
    );
    const transfer = new DataTransfer();
    transfer.items.add(file);
    input.files = transfer.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }, name);
  await page.waitForFunction(() =>
    document
      .querySelector('.workspace-library [data-import-summary]')
      ?.textContent.includes('1 accepted'),
  );
  await clickControl(page, '.workspace-library [data-action="apply-import"]');
  await page.waitForFunction(() =>
    document
      .querySelector('.workspace-library [data-import-status]')
      ?.textContent.includes('Imported 1 features'),
  );
  await page.waitForFunction(
    () =>
      window.__godsEyeView.importedGeometryLayer.getState().featureCount >= 1,
  );
}

export async function seedPersistentWorkspace(page) {
  await clickControl(page, '.workspace-library [data-action="save-as"]');
  await page.waitForFunction(
    () =>
      document.querySelector('.workspace-library [data-workspace-select]')
        .value,
  );
  await importFixtureGeometry(page);
  return page.evaluate(async (workspaceAssetText) => {
    const app = window.__godsEyeView;
    const id = document.querySelector(
      '.workspace-library [data-workspace-select]',
    ).value;
    const library = app.workspaceLibraryPanel.library;
    const record = await library.getWorkspace(id);
    const asset = new TextEncoder().encode(workspaceAssetText);
    const sha256 = [
      ...new Uint8Array(await crypto.subtle.digest('SHA-256', asset)),
    ]
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('');
    await library.save(
      {
        ...record.document,
        chunks: record.chunks,
        assets: { 'notes.txt': asset },
        assetRefs: [{ id: 'notes.txt', sha256, byteLength: asset.length }],
      },
      { id, expectedRevision: record.manifest.revision },
    );
    // This is an actual supported setting consumed during startup.
    localStorage.setItem('gev:detection-allocation:v1', 'ELASTIC');
    return {
      id,
      sha256,
      bundle: await library.exportBackup(id),
      settings: { 'gev:detection-allocation:v1': 'ELASTIC' },
    };
  }, PROFILE_RECOVERY_WORKSPACE_ASSET_TEXT);
}

export async function assertPersistentWorkspace(page, expected) {
  await openWorkspace(page, expected.id);
  const actual = await page.evaluate(async (id) => {
    const app = window.__godsEyeView;
    const record = await app.workspaceLibraryPanel.library.getWorkspace(id);
    const bytes = record.assets['notes.txt'];
    const sha256 = [
      ...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)),
    ]
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('');
    return {
      saved: record.saved,
      version: record.document.version,
      sha256,
      bundle: await app.workspaceLibraryPanel.library.exportBackup(id),
      drawn: app.importedGeometryLayer.getState().featureCount,
      settings: {
        'gev:detection-allocation:v1': localStorage.getItem(
          'gev:detection-allocation:v1',
        ),
      },
    };
  }, expected.id);
  assert.equal(
    actual.saved,
    true,
    'workspace must come from durable IndexedDB',
  );
  assert.equal(
    actual.sha256,
    expected.sha256,
    'asset bytes changed across update/recovery',
  );
  assert.deepEqual(
    JSON.parse(actual.bundle),
    JSON.parse(expected.bundle),
    'workspace, chunks or asset export changed',
  );
  assert.equal(
    actual.drawn,
    1,
    'persisted geometry must reopen in the renderer',
  );
  assert.deepEqual(actual.settings, expected.settings);
  return {
    assetSha256: actual.sha256,
    renderedFeatures: actual.drawn,
    settingsMatch: true,
    workspaceBundleMatches: true,
  };
}
