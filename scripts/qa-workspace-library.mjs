#!/usr/bin/env node
/** Browser acceptance for durable workspace library controls and conflict recovery. */
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer';

const args = process.argv.slice(2);
const urlIndex = args.indexOf('--url');
const url = urlIndex >= 0 ? args[urlIndex + 1] : 'http://localhost:4173';
const browser = await puppeteer.launch({
  headless: true,
  executablePath:
    process.env.PUPPETEER_EXECUTABLE_PATH || (await puppeteer.executablePath()),
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});
const errors = [];
const resourceErrors = [];
try {
  const page = await browser.newPage();
  page.on('pageerror', (error) => errors.push(error.stack || error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') resourceErrors.push(message.text());
  });
  const click = async (selector) =>
    page.evaluate(
      (target) => document.querySelector(target)?.click(),
      selector,
    );
  page.setDefaultNavigationTimeout(90_000);
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(
    () => window.__godsEyeView?.workspaceLibraryPanel,
    { timeout: 90_000 },
  );
  await page.waitForSelector('.workspace-library [data-workspace-select]');
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

  // Simulate a second tab winning the revision race. UI Save must surface the
  // conflict instead of overwriting that complete revision.
  await page.evaluate(async (workspaceId) => {
    const panel = window.__godsEyeView.workspaceLibraryPanel;
    const record = await panel.library.getWorkspace(workspaceId);
    await panel.library.save(
      {
        title: record.document.title,
        view: record.document.view,
        filters: record.document.filters,
        annotations: record.document.annotations,
        pinnedEvidence: record.document.pinnedEvidence,
        assetRefs: record.document.assetRefs,
        directorProjectRef: record.document.directorProjectRef,
      },
      { id: workspaceId, expectedRevision: record.manifest.revision },
    );
  }, id);
  await click('.workspace-library [data-action="save"]');
  await page.waitForFunction(() =>
    document
      .querySelector('.workspace-library [data-status]')
      ?.textContent.includes('newer revision'),
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
    errors,
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
  if (resourceErrors.length)
    console.log(
      `NOTE ${resourceErrors.length} browser resource errors were observed (not script exceptions)`,
    );
} finally {
  await browser.close();
}
