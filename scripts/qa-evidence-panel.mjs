#!/usr/bin/env node
/** Browser acceptance for the synthetic, selected-aircraft evidence panel. */
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer';

const args = process.argv.slice(2);
const at = args.indexOf('--url');
const url = at >= 0 ? args[at + 1] : 'http://localhost:4173';
const browser = await puppeteer.launch({
  headless: true,
  executablePath:
    process.env.PUPPETEER_EXECUTABLE_PATH || (await puppeteer.executablePath()),
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});

try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.setViewport({ width: 1440, height: 900 });
  await page.goto(`${url}/?welcome=0`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(
    () =>
      !!window.__godsEyeView?.styleManager &&
      !!document.getElementById('evidence-panel'),
    { timeout: 60_000 },
  );
  await page.waitForFunction(
    () =>
      document.getElementById('loading-screen')?.classList.contains('hidden'),
    { timeout: 60_000 },
  );
  await page.evaluate(() => {
    const focus = document.createElement('button');
    focus.id = 'qa-evidence-focus-return';
    focus.textContent = 'Focus return target';
    document.body.append(focus);
    focus.focus();
    window.dispatchEvent(
      new CustomEvent('gev:awareness-subject-selected', {
        detail: {
          layerId: 'flights',
          id: 'abc123',
          label: 'Synthetic TEST123',
          evidence: {
            version: 1,
            entityRef: { layerKey: 'flights', id: 'abc123' },
            sourceId: 'Synthetic source',
            sourceUrl: 'https://example.test/records?token=secret',
            observedAt: Date.UTC(2026, 0, 15, 12),
            receivedAt: Date.UTC(2026, 0, 15, 12, 0, 2),
            snapshotAt: Date.UTC(2026, 0, 15, 12, 0, 1),
            method: 'observed',
            displayMethod: 'interpolated',
            coverage: { area: 'Austin · fixture', completeness: 'partial' },
            limitations: ['Synthetic fixture only'],
          },
        },
      }),
    );
  });
  await page.waitForFunction(
    () => !document.getElementById('evidence-panel').hidden,
  );
  const first = await page.evaluate(() => {
    const panel = document.getElementById('evidence-panel');
    const value = (name) =>
      panel.querySelector(`[data-evidence-value="${name}"]`)?.textContent;
    return {
      expanded: !panel.classList.contains('collapsed'),
      subject: value('subject'),
      observed: value('observed'),
      received: value('received'),
      display: value('display'),
      coverage: value('coverage'),
      sourceUrl: panel.querySelector('[data-evidence-value="source"] a')?.href,
      technical: panel.querySelector('.evidence-panel-technical')?.open,
      secretVisible: panel.textContent.includes('secret'),
    };
  });
  assert.equal(first.expanded, true);
  assert.equal(first.subject, 'Synthetic TEST123');
  assert.match(first.observed, /2026-01-15T12:00:00/);
  assert.match(first.received, /2026-01-15T12:00:02/);
  assert.equal(first.display, 'interpolated');
  assert.match(first.coverage, /partial/);
  assert.equal(first.sourceUrl, 'https://example.test/records');
  assert.equal(first.secretVisible, false);

  await page.evaluate(() => {
    const panel = document.getElementById('evidence-panel');
    const body = panel.querySelector('[data-panel-body]');
    const technical = panel.querySelector('.evidence-panel-technical');
    body.style.maxHeight = '120px';
    body.style.overflow = 'auto';
    technical.open = true;
    body.scrollTop = 17;
    window.dispatchEvent(
      new CustomEvent('gev:awareness-subject-selected', {
        detail: {
          label: 'Synthetic TEST123 refreshed',
          evidence: {
            entityRef: { layerKey: 'flights', id: 'abc123' },
            sourceId: 'Synthetic source',
            observedAt: Date.UTC(2026, 0, 15, 12),
            receivedAt: Date.UTC(2026, 0, 15, 12, 0, 3),
            method: 'observed',
            displayMethod: 'predicted',
          },
        },
      }),
    );
  });
  const retained = await page.evaluate(() => ({
    expandedTechnical: document.querySelector('.evidence-panel-technical').open,
    scrollTop: document.querySelector('#evidence-panel [data-panel-body]')
      .scrollTop,
    label: document.querySelector('[data-evidence-value="subject"]')
      .textContent,
  }));
  assert.equal(retained.expandedTechnical, true);
  assert.equal(retained.scrollTop, 17);
  assert.equal(retained.label, 'Synthetic TEST123 refreshed');

  await page.click('#evidence-panel-close');
  const closed = await page.evaluate(() => ({
    hidden: document.getElementById('evidence-panel').hidden,
    focus: document.activeElement?.id,
  }));
  assert.equal(closed.hidden, true);
  assert.equal(closed.focus, 'qa-evidence-focus-return');

  await page.evaluate(() =>
    window.dispatchEvent(
      new CustomEvent('gev:awareness-subject-selected', {
        detail: {
          layerId: 'ais-live-vessels',
          id: '367123456',
          label: 'Unsupported synthetic vessel',
        },
      }),
    ),
  );
  assert.equal(
    await page.$eval('#evidence-panel', (node) => node.hidden),
    true,
  );
  assert.deepEqual(errors, []);
  console.log(
    'PASS: aircraft evidence, safe source link, refresh state, focus return and unsupported selection handling',
  );
} finally {
  await browser.close();
}
