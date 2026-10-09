/** Shared hermetic full-application journeys. No provider traffic leaves Chrome. */
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer';
import { interceptFixtureSession } from './performance/fixtureInterception.mjs';
import { createFixtureNetworkProbe } from './performance/fixtureNetworkProbe.mjs';

const fixtureDiagnostics = new WeakMap();

export async function launchFixtureBrowser(options = {}) {
  return puppeteer.launch({
    headless: true,
    executablePath:
      process.env.PUPPETEER_EXECUTABLE_PATH ||
      (await puppeteer.executablePath()),
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
    ...options,
  });
}

export async function prepareFixturePage(browser, base, { respond } = {}) {
  const page = await browser.newPage();
  const errors = [];
  const networkProbe = createFixtureNetworkProbe(base);
  const startupMessages = [];
  fixtureDiagnostics.set(page, { errors, startupMessages });
  page.on('console', (message) => {
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
  page.setDefaultTimeout(30000);
  page.setDefaultNavigationTimeout(90000);
  await page.setViewport({ width: 1440, height: 1000 });
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
  );
  return { page, errors, verifyNetwork: () => networkProbe.verify(page) };
}

export async function bootFixturePage(page, base) {
  await page.goto(base + '/?welcome=0', { waitUntil: 'domcontentloaded' });
  try {
    await page.waitForFunction(
      () => window.__godsEyeView?.workspaceLibraryPanel,
      { timeout: 90000 },
    );
  } catch (error) {
    const state = await page
      .evaluate(() => ({
        readyState: document.readyState,
        applicationPresent: Boolean(window.__godsEyeView),
        canvasCount: document.querySelectorAll('canvas').length,
        cesiumError:
          document
            .querySelector('.cesium-widget-errorPanel')
            ?.textContent?.slice(0, 500) || null,
      }))
      .catch(() => null);
    const diagnostics = fixtureDiagnostics.get(page);
    error.message +=
      '; startup diagnostics: ' +
      JSON.stringify({
        state,
        errors: diagnostics?.errors?.slice(-5),
        messages: diagnostics?.startupMessages,
      });
    throw error;
  }
  await page.evaluate(async () => {
    await window.__godsEyeView.styleManager.initialRestorePromise;
    window.prompt = () => 'Persistent recovery investigation';
    window.confirm = () => true;
  });
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
  await clickControl(page, '.workspace-library [data-action="open"]');
  try {
    await page.waitForFunction(() =>
      document
        .querySelector('.workspace-library [data-status]')
        ?.textContent.startsWith('Opened'),
    );
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
  return page.evaluate(async () => {
    const app = window.__godsEyeView;
    const id = document.querySelector(
      '.workspace-library [data-workspace-select]',
    ).value;
    const library = app.workspaceLibraryPanel.library;
    const record = await library.getWorkspace(id);
    const asset = new TextEncoder().encode(
      'Persisted public investigation notes\n',
    );
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
  });
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
  return { assetSha256: actual.sha256, renderedFeatures: actual.drawn };
}
