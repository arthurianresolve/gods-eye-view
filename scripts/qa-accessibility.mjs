#!/usr/bin/env node
/** Keyboard/AX names and narrow-viewport reflow. Human assistive-technology review stays separate. */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  launchFixtureBrowser,
  prepareFixturePage,
  bootFixturePage,
} from './qa-application-fixtures.mjs';
const option = (name, fallback) => {
  const index = process.argv.indexOf(name);
  return index < 0 ? fallback : process.argv[index + 1];
};
const base = option('--url', 'http://localhost:4174');
const out = option('--out', 'qa-artifacts/accessibility.json');
const browser = await launchFixtureBrowser();
try {
  const { page, errors } = await prepareFixturePage(browser, base);
  await bootFixturePage(page, base);
  await page.focus('.gev-command-trigger');
  await page.keyboard.press('Enter');
  await page.waitForFunction(
    () => document.activeElement?.id === 'gev-command-search',
  );
  await page.type('#gev-command-search', 'save workspace');
  await page.keyboard.press('ArrowDown');
  assert.equal(
    await page.evaluate(() =>
      document.activeElement.matches('.gev-command-option'),
    ),
    true,
  );
  await page.keyboard.press('Escape');
  await page.waitForFunction(() =>
    document.activeElement?.matches('.gev-command-trigger'),
  );
  await page.evaluate(() => {
    window.dispatchEvent(
      new CustomEvent('gev:entity-selected', {
        detail: {
          label: 'Public reference keyboard fixture',
          evidence: {
            entityRef: {
              layerKey: 'local-datacenters',
              id: 'accessibility-fixture',
            },
            sourceId: 'Synthetic public evidence',
            sourceUrl: 'https://example.test/reference',
          },
        },
      }),
    );
    document.querySelector('.evidence-panel-technical').open = true;
  });
  await page.waitForSelector('#evidence-panel-close', { visible: true });
  await page.focus('#evidence-panel-close');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() =>
    document.activeElement?.matches('.gev-command-trigger'),
  );
  // Open the four review surfaces and inspect Chrome's accessible names.
  await page.evaluate(() => {
    for (const panel of document.querySelectorAll('#scene-panel, #data-panel'))
      panel.classList.remove('collapsed');
    document.querySelector('.workspace-library').open = true;
    window.dispatchEvent(
      new CustomEvent('gev:entity-selected', {
        detail: {
          label: 'Public evidence reflow fixture',
          evidence: {
            entityRef: {
              layerKey: 'local-datacenters',
              id: 'accessibility-fixture',
            },
            sourceUrl: 'https://example.test/reference',
          },
        },
      }),
    );
    document.querySelector('.evidence-panel-technical').open = true;
  });
  const client = await page.createCDPSession();
  const names = [];
  const controls = await page.$$(
    '#evidence-panel button, #evidence-panel input, .workspace-library button, .workspace-library input, .workspace-library select, .investigation-timeline button, .investigation-timeline input, .investigation-timeline select',
  );
  for (const control of controls) {
    if (!(await control.isVisible())) continue;
    const backendNodeId = await control.backendNodeId();
    const { nodes } = await client.send('Accessibility.getPartialAXTree', {
      backendNodeId,
      fetchRelatives: false,
    });
    const node = nodes.find(
      (row) => row.backendDOMNodeId === backendNodeId && !row.ignored,
    );
    const markup = await control.evaluate((element) => ({
      outerHTML: element.outerHTML,
      ariaLabel: element.getAttribute('aria-label'),
      labelledBy: element.getAttribute('aria-labelledby'),
    }));
    const accessibleName =
      node?.name?.value?.trim() ||
      markup.ariaLabel?.trim() ||
      markup.labelledBy?.trim();
    assert.ok(
      accessibleName,
      'Visible control lacks an accessible name: ' + markup.outerHTML,
    );
    names.push({
      role: node?.role?.value || (await control.evaluate((el) => el.tagName)),
      name: accessibleName,
    });
  }
  assert.ok(
    names.length >= 12,
    'Accessibility fixture did not expose enough controls',
  );
  const announcements = await page.$$eval(
    '#evidence-panel [role="status"], .workspace-library [role="status"], .investigation-timeline [role="status"]',
    (nodes) => nodes.length,
  );
  assert.ok(
    announcements >= 2,
    'Async operations need scoped status announcements',
  );
  await page.setViewport({ width: 720, height: 500, deviceScaleFactor: 2 });
  await page.focus('.gev-command-trigger');
  await page.keyboard.press('Enter');
  await page.waitForFunction(
    () => document.activeElement?.id === 'gev-command-search',
  );
  const reflow = await page.$eval('.gev-command-palette', (node) => {
    const bounds = node.getBoundingClientRect();
    return {
      width: bounds.width,
      left: bounds.left,
      right: bounds.right,
      viewport: innerWidth,
      contentWidth: node.scrollWidth,
      clientWidth: node.clientWidth,
    };
  });
  assert.ok(
    reflow.left >= 0 && reflow.right <= reflow.viewport + 1,
    'Command palette escapes the 200%-equivalent viewport',
  );
  assert.ok(
    reflow.contentWidth <= reflow.clientWidth + 1,
    'Command palette clips content horizontally',
  );
  await mkdir(path.dirname(out), { recursive: true });
  await page.screenshot({ path: out + '.reflow.png' });
  await page.keyboard.press('Escape');
  assert.deepEqual(errors, []);
  const report = {
    scope: 'automated-keyboard-ax-reflow',
    browser: await browser.version(),
    timestamp: new Date().toISOString(),
    checks: [
      'palette-keyboard-discovery',
      'palette-focus-restoration',
      'inspector-focus-restoration',
      'visible-control-accessible-names',
      'scoped-status-announcements',
      '720-css-pixel-reflow',
    ],
    accessibleControls: names,
    announcements,
    reflow,
    humanReviewValidated: false,
    limitation:
      '720 CSS pixels at DPR 2 checks layout equivalent to 200% of a 1440px viewport; it is not a human browser-zoom, contrast or screen-reader review.',
  };
  await writeFile(out, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser.close();
}
