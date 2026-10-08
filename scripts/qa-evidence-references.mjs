#!/usr/bin/env node
/** Real inspector -> pin -> IndexedDB -> bundle -> fresh browser profile journey. */
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer';
const at = process.argv.indexOf('--url');
const base = at >= 0 ? process.argv[at + 1] : 'http://localhost:4174';
const browser = await puppeteer.launch({
  headless: true,
  executablePath:
    process.env.PUPPETEER_EXECUTABLE_PATH || (await puppeteer.executablePath()),
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});
let archiveCalls = 0;
let delayArchive = false;
const archiveAt = Date.parse('2020-01-01T12:00:00Z');
async function prepare(page) {
  await page.setViewport({ width: 1440, height: 1000 });
  await page.setRequestInterception(true);
  page.on('request', async (request) => {
    const url = new URL(request.url());
    if (url.pathname === '/api/evidence/archive-lookup') {
      archiveCalls++;
      const input = JSON.parse(request.postData());
      if (delayArchive)
        await new Promise((resolve) => setTimeout(resolve, 250));
      await request
        .respond({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            state: 'available',
            requestedUrl: input.url,
            reference: {
              kind: 'archive',
              title: 'Fixture archive capture',
              url: 'https://web.archive.org/web/20200101120000/' + input.url,
              originalUrl: input.url,
              archiveAt,
              lookedUpAt: Date.now(),
            },
          }),
        })
        .catch(() => {});
    } else if (
      url.origin !== new URL(base).origin &&
      ['http:', 'https:'].includes(url.protocol)
    ) {
      await request.abort().catch(() => {});
    } else if (url.pathname.startsWith('/api/')) {
      // No local proxy may reach a live provider during this journey.
      await request
        .respond({
          status: 503,
          contentType: 'application/json',
          body: '{"error":"fixture-offline"}',
        })
        .catch(() => {});
    } else await request.continue().catch(() => {});
  });
  await page.goto(base + '/?welcome=0', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(
    () => window.__godsEyeView?.workspaceLibraryPanel,
    { timeout: 90_000 },
  );
}
const click = (page, selector) =>
  page.evaluate((target) => document.querySelector(target).click(), selector);
const clickText = (page, text) =>
  page.evaluate((label) => {
    const button = [
      ...document.querySelectorAll('#evidence-panel button'),
    ].find((node) => node.textContent === label);
    if (!button) throw new Error('Missing button: ' + label);
    button.click();
  }, text);
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await prepare(page);
  await page.evaluate(async () => {
    window.prompt = () => 'Archive reference QA';
    window.confirm = () => true;
    const app = window.__godsEyeView;
    await app.styleManager.initialRestorePromise;
    await app.dataManager.setEnabled('local-datacenters', true);
    const { getContextStore, selectEntityContext } =
      await import('/src/data/contextStore.js');
    const record = [...getContextStore().entities.values()].find(
      (item) => item.layerId === 'local-datacenters',
    );
    if (!record?.evidence)
      throw new Error('Selected infrastructure has no evidence envelope');
    window.__qaSelected = record;
    selectEntityContext(record.entity);
    document.querySelector('.evidence-panel-technical').open = true;
    window.addEventListener('gev:evidence-updated', (event) => {
      window.__qaEvidence = event.detail.evidence;
    });
  });
  assert.equal(
    archiveCalls,
    0,
    'selection must not trigger a background lookup',
  );
  const source = 'https://www.openstreetmap.org/';
  const selector = '[data-archive-url="' + source + '"]';
  const targetText = await page.$eval(
    '[data-evidence-value="references"]',
    (node) => node.textContent,
  );
  assert.ok(targetText.includes('Archive lookup URL: ' + source));
  assert.ok(targetText.includes('Requested date: latest available'));
  await click(page, selector);
  await page.waitForFunction(() =>
    [...document.querySelectorAll('#evidence-panel button')].some(
      (node) => node.textContent === 'Attach archived reference',
    ),
  );
  assert.equal(
    await page.evaluate(
      () =>
        window.__qaEvidence?.references.some((ref) => ref.kind === 'archive') ||
        false,
    ),
    false,
    'lookup only previews; attachment requires its own user action',
  );
  await clickText(page, 'Attach archived reference');
  await page.type(
    '[aria-label="PeeringDB facility URL"]',
    'https://www.peeringdb.com/fac/123?ignored=1',
  );
  await clickText(page, 'Attach facility');
  const refs = await page.evaluate(() => window.__qaEvidence.references);
  assert.ok(
    refs.some((ref) => ref.kind === 'archive' && ref.archiveAt === archiveAt),
  );
  assert.ok(
    refs.some(
      (ref) =>
        ref.kind === 'user-linked' &&
        ref.url === 'https://www.peeringdb.com/fac/123',
    ),
  );
  assert.equal(
    await page.$eval(
      '[data-evidence-value="observed"]',
      (node) => node.textContent,
    ),
    'Not provided by source',
  );
  assert.match(
    await page.$eval(
      '[data-evidence-value="references"]',
      (node) => node.textContent,
    ),
    /Capture time is separate/,
  );

  await click(page, '.workspace-library [data-action="save-as"]');
  await page.waitForFunction(
    () =>
      document.querySelector('.workspace-library [data-workspace-select]')
        .value,
  );
  await click(page, '.workspace-library [data-action="pin-a"]');
  await page.waitForFunction(() =>
    document
      .querySelector('.workspace-library [data-status]')
      .textContent.startsWith('Pinned evidence A'),
  );
  const saved = await page.evaluate(async () => {
    const id = document.querySelector(
      '.workspace-library [data-workspace-select]',
    ).value;
    const library = window.__godsEyeView.workspaceLibraryPanel.library;
    return { id, bundle: await library.exportBackup(id) };
  });
  const storedRefs = JSON.parse(saved.bundle).document.pinnedEvidence[0]
    .snapshot.records[0].record.references;
  assert.deepEqual(storedRefs, refs);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(
    () => window.__godsEyeView?.workspaceLibraryPanel,
    { timeout: 90_000 },
  );
  const reloaded = await page.evaluate(async (id) => {
    const record = await window.__godsEyeView.workspaceStorage.getWorkspace(id);
    return record.document.pinnedEvidence[0].snapshot.records[0].record
      .references;
  }, saved.id);
  assert.deepEqual(reloaded, refs);

  const fresh = await browser.createBrowserContext();
  const other = await fresh.newPage();
  await prepare(other);
  const transferred = await other.evaluate(async (bundle) => {
    const library = window.__godsEyeView.workspaceLibraryPanel.library;
    const imported = await library.importBackup(bundle);
    const record = await library.getWorkspace(imported.document.id);
    return record.document.pinnedEvidence[0].snapshot.records[0].record
      .references;
  }, saved.bundle);
  assert.deepEqual(transferred, refs);
  await fresh.close();

  // A late response for A must never overwrite a newly selected object B.
  delayArchive = true;
  await page.evaluate(() => {
    window.dispatchEvent(
      new CustomEvent('gev:entity-selected', {
        detail: {
          label: 'Late A',
          evidence: {
            entityRef: { layerKey: 'fixture', id: 'a' },
            sourceUrl: 'https://example.test/late',
          },
        },
      }),
    );
    document.querySelector('.evidence-panel-technical').open = true;
  });
  await click(page, '[data-archive-url="https://example.test/late"]');
  await page.evaluate(() =>
    window.dispatchEvent(
      new CustomEvent('gev:entity-selected', {
        detail: {
          label: 'Current B',
          evidence: { entityRef: { layerKey: 'fixture', id: 'b' } },
        },
      }),
    ),
  );
  await new Promise((resolve) => setTimeout(resolve, 400));
  assert.equal(
    await page.$eval(
      '[data-evidence-value="subject"]',
      (node) => node.textContent,
    ),
    'Current B',
  );
  assert.equal(
    await page.$$eval(
      '[data-evidence-value="references"] a',
      (nodes) => nodes.length,
    ),
    0,
  );
  assert.deepEqual(errors, []);
  console.log(
    'PASS selected datacenter provenance, explicit archive attachment, PeeringDB, pin/save/reload/profile transfer and late-response isolation',
  );
} finally {
  await browser.close();
}
