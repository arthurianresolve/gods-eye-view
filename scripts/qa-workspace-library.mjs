#!/usr/bin/env node
/** Browser acceptance for durable workspace library controls and conflict recovery. */
import assert from 'node:assert/strict';
import {
  cleanupFixturePageDiagnostics,
  launchFixtureBrowser,
  prepareFixturePage,
} from './qa-application-fixtures.mjs';

const args = process.argv.slice(2);
const urlIndex = args.indexOf('--url');
const url = urlIndex >= 0 ? args[urlIndex + 1] : 'http://localhost:4173';
const browser = await launchFixtureBrowser();
const pages = [];
const fixtures = [];
try {
  const openFixturePage = async () => {
    const page = await browser.newPage();
    pages.push(page);
    const fixture = await prepareFixturePage(browser, url, { page });
    fixtures.push(fixture);
    page.setDefaultTimeout(30000);
    page.setDefaultNavigationTimeout(90_000);
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(
      () => window.__godsEyeView?.workspaceLibraryPanel,
      { timeout: 90000 },
    );
    await fixture.verifyNetwork();
    await page.waitForSelector('.workspace-library [data-workspace-select]');
    return page;
  };
  const page = await openFixturePage();
  const click = async (selector) =>
    page.evaluate(
      (target) => document.querySelector(target)?.click(),
      selector,
    );
  await page.evaluate(() => {
    window.__gevPromptQueue = ['Workspace QA'];
    window.prompt = () => window.__gevPromptQueue.shift() ?? 'Workspace QA';
    window.confirm = () => true;
  });
  await page.evaluate(() => {
    const panel = document.getElementById('scene-panel');
    if (panel.classList.contains('collapsed'))
      panel
        .querySelector(
          '.panel-collapse-btn[data-collapse-target="scene-panel"]',
        )
        .click();
    panel.classList.remove('collapsed');
  });
  await click('.workspace-library summary');
  await click('.workspace-library [data-action="save-as"]');
  await page.waitForFunction(
    () =>
      document.querySelectorAll(
        '.workspace-library [data-workspace-select] option',
      ).length >= 2,
  );
  const id = await page.$eval(
    '.workspace-library [data-workspace-select]',
    (select) => select.value,
  );
  assert.ok(id, 'Save as selects the durable workspace');
  const first = await page.evaluate(
    (workspaceId) =>
      window.__godsEyeView.workspaceStorage.getWorkspace(workspaceId),
    id,
  );
  assert.equal(first.saved, true, 'the visible save completed in IndexedDB');
  assert.equal(first.manifest.revision, 1);

  await click('.workspace-library [data-action="duplicate"]');
  await page.waitForFunction(
    () =>
      document.querySelectorAll(
        '.workspace-library [data-workspace-select] option',
      ).length >= 3,
  );
  await page.waitForFunction(() =>
    document
      .querySelector('.workspace-library [data-status]')
      ?.textContent.startsWith('Created'),
  );
  await page.select('.workspace-library [data-workspace-select]', id);
  await click('.workspace-library [data-action="open"]');
  await page.waitForFunction(
    () => {
      const text =
        document.querySelector('.workspace-library [data-status]')
          ?.textContent || '';
      return !text.startsWith('Ready') && !text.startsWith('Opening');
    },
    { timeout: 12_000 },
  );
  const openStatus = await page.$eval(
    '.workspace-library [data-status]',
    (node) => node.textContent,
  );
  assert.match(openStatus, /Opened/, `workspace open failed: ${openStatus}`);

  // Exercise keyboard discovery and the complete staged geographic import path.
  await click('.gev-command-trigger');
  await page.waitForFunction(
    () => document.querySelector('.gev-command-palette')?.open,
  );
  await page.type('#gev-command-search', 'save workspace');
  const commandResults = await page.$$eval('.gev-command-option', (nodes) =>
    nodes.map((node) => node.textContent),
  );
  assert.ok(
    commandResults.some((text) => /Save workspace/i.test(text)),
    'command palette filters to the requested operation',
  );
  await page.keyboard.press('Escape');
  await page.waitForFunction(
    () => !document.querySelector('.gev-command-palette')?.open,
    { timeout: 5_000 },
  );

  await page.evaluate(() => {
    const file = new File(
      [
        JSON.stringify({
          type: 'FeatureCollection',
          features: [
            {
              type: 'Feature',
              id: 'qa-point',
              properties: { name: 'QA import point' },
              geometry: { type: 'Point', coordinates: [-73.9, 40.7] },
            },
          ],
        }),
      ],
      'workspace-qa.geojson',
      { type: 'application/geo+json' },
    );
    const transfer = new DataTransfer();
    transfer.items.add(file);
    const input = document.querySelector('.workspace-library [data-geo-file]');
    input.files = transfer.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.waitForFunction(() =>
    document
      .querySelector('.workspace-library [data-import-summary]')
      ?.textContent.includes('1 accepted'),
  );
  assert.equal(
    await page.$eval(
      '.workspace-library [data-action="apply-import"]',
      (button) => button.disabled,
    ),
    false,
    'a valid preview can be explicitly applied to the open workspace',
  );
  await click('.workspace-library [data-action="apply-import"]');
  await page.waitForFunction(() =>
    document
      .querySelector('.workspace-library [data-import-status]')
      ?.textContent.includes('Imported 1 features'),
  );
  await page.waitForFunction(
    () =>
      window.__godsEyeView?.importedGeometryLayer?.getState().featureCount ===
      1,
    { timeout: 5_000 },
  );
  const imported = await page.evaluate(async (workspaceId) => {
    const stored =
      await window.__godsEyeView.workspaceStorage.getWorkspace(workspaceId);
    return {
      kind: stored.chunks.imports[0].kind,
      count: stored.chunks.imports[0].records.length,
      drawn: window.__godsEyeView.importedGeometryLayer.getState().featureCount,
    };
  }, id);
  assert.deepEqual(
    { kind: imported.kind, count: imported.count, drawn: imported.drawn },
    { kind: 'geojson', count: 1, drawn: 1 },
  );

  // Open the same durable workspace in a second page, which has an independent
  // application/library client but shares this browser's IndexedDB origin.
  const conflictPage = await openFixturePage();
  await conflictPage.waitForFunction(
    (workspaceId) =>
      [
        ...document.querySelectorAll(
          '.workspace-library [data-workspace-select] option',
        ),
      ].some((option) => option.value === workspaceId),
    { timeout: 12000 },
    id,
  );
  await conflictPage.select('.workspace-library [data-workspace-select]', id);
  await conflictPage.evaluate(() => {
    window.confirm = () => true;
  });
  await conflictPage.evaluate(() => {
    const panel = document.querySelector('.workspace-library');
    if (!panel.open) panel.querySelector('summary')?.click();
  });
  await conflictPage.evaluate(() =>
    document.querySelector('.workspace-library [data-action="open"]')?.click(),
  );
  await conflictPage.waitForFunction(
    () =>
      document
        .querySelector('.workspace-library [data-status]')
        ?.textContent.includes('Opened'),
    { timeout: 12000 },
  );
  const beforeExternalSave = await page.evaluate(
    (workspaceId) =>
      window.__godsEyeView.workspaceStorage.getWorkspace(workspaceId),
    id,
  );
  await conflictPage.evaluate(() =>
    document.querySelector('.workspace-library [data-action="save"]')?.click(),
  );
  await conflictPage.waitForFunction(
    () =>
      document
        .querySelector('.workspace-library [data-status]')
        ?.textContent.includes('complete revision'),
    { timeout: 12000 },
  );
  const afterExternalSave = await page.evaluate(
    (workspaceId) =>
      window.__godsEyeView.workspaceStorage.getWorkspace(workspaceId),
    id,
  );
  assert.ok(
    afterExternalSave.manifest.revision > beforeExternalSave.manifest.revision,
    'the second browser page committed a newer IndexedDB revision',
  );
  assert.deepEqual(
    afterExternalSave.chunks,
    beforeExternalSave.chunks,
    'the second page Save preserved all stored chunks exactly',
  );
  await page.bringToFront();
  await click('.workspace-library [data-action="save"]');
  await page.waitForFunction(() =>
    document
      .querySelector('.workspace-library [data-status]')
      ?.textContent.includes('newer revision'),
  );
  const afterStaleSave = await page.evaluate(
    (workspaceId) =>
      window.__godsEyeView.workspaceStorage.getWorkspace(workspaceId),
    id,
  );
  assert.equal(
    afterStaleSave.manifest.revision,
    afterExternalSave.manifest.revision,
    'the stale first-page save did not advance the competing revision',
  );
  assert.deepEqual(
    afterStaleSave.document,
    afterExternalSave.document,
    'the stale first-page save did not replace the competing document',
  );
  assert.deepEqual(
    afterStaleSave.chunks,
    afterExternalSave.chunks,
    'the stale first-page save did not replace the competing chunks',
  );

  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__godsEyeView?.workspaceLibraryPanel);
  await page.waitForFunction(
    () =>
      document.querySelectorAll(
        '.workspace-library [data-workspace-select] option',
      ).length >= 3,
  );
  await page.select('.workspace-library [data-workspace-select]', id);
  await click('.workspace-library [data-action="open"]');
  await page.waitForFunction(() =>
    document
      .querySelector('.workspace-library [data-status]')
      ?.textContent.includes('Opened'),
  );
  const reopenedImports = await page.evaluate(async (workspaceId) => {
    const stored =
      await window.__godsEyeView.workspaceStorage.getWorkspace(workspaceId);
    return {
      count: stored.chunks.imports?.[0]?.records?.length || 0,
      drawn: window.__godsEyeView.importedGeometryLayer.getState().featureCount,
    };
  }, id);
  assert.deepEqual(reopenedImports, { count: 1, drawn: 1 });
  await click('.workspace-library [data-action="synthetic-demo"]');
  await page.waitForFunction(() =>
    document
      .querySelector('.workspace-library [data-status]')
      ?.textContent.includes('not live observations'),
  );
  const demo = await page.evaluate(async () => {
    const workspaceId = document.querySelector(
      '.workspace-library [data-workspace-select]',
    ).value;
    const record =
      await window.__godsEyeView.workspaceStorage.getWorkspace(workspaceId);
    return {
      kind: record.chunks.imports[0].kind,
      count: record.chunks.imports[0].records.length,
      drawn: window.__godsEyeView.importedGeometryLayer.getState().featureCount,
    };
  });
  assert.deepEqual(demo, { kind: 'synthetic-demo', count: 3, drawn: 3 });
  await page.evaluate(() => {
    const panel = document.getElementById('scene-panel');
    if (panel.classList.contains('collapsed'))
      panel
        .querySelector(
          '.panel-collapse-btn[data-collapse-target="scene-panel"]',
        )
        .click();
    panel.classList.remove('collapsed');
  });
  await click('.workspace-library summary');
  await page.select('.workspace-library [data-workspace-select]', id);
  await click('.workspace-library [data-action="open"]');
  await page.waitForFunction(
    () => {
      const text =
        document.querySelector('.workspace-library [data-status]')
          ?.textContent || '';
      return !text.startsWith('Ready') && !text.startsWith('Opening');
    },
    { timeout: 12_000 },
  );
  assert.deepEqual(
    fixtures.flatMap((fixture) => fixture.errors),
    [],
    'the workspace UI has no uncaught browser errors',
  );
  console.log('PASS workspace Save as creates a durable revision');
  console.log('PASS duplicate and open restore a saved workspace');
  console.log('PASS stale two-tab save is reported without overwriting');
  console.log('PASS reload retains and reopens the workspace');
  console.log('PASS command palette search and Escape dismissal');
  console.log(
    'PASS GeoJSON preview, explicit apply, save and reload rendering',
  );
  console.log(
    'PASS offline demo is clearly synthetic and saved as its own workspace',
  );
  console.log(
    'PASS a separate same-origin browser page commits IndexedDB revision and stale UI Save surfaces the conflict',
  );
} finally {
  try {
    for (const page of pages) await cleanupFixturePageDiagnostics(page);
  } finally {
    await browser.close();
  }
}
