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
let lastControl = null;
let surface = null;
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
  // Inspect each surface through its disclosure owner. Forcing several panel
  // CSS classes open bypasses preferred-panel state; the next layout pass can
  // auto-collapse a surface while its controls are being inspected.
  await page.evaluate(() => {
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
  let announcements = 0;
  const inspectSurface = async (selector) => {
    surface = selector;
    const before = names.length;
    const controls = await page.$$(
      `${selector} button, ${selector} input, ${selector} select`,
    );
    for (const control of controls) {
      if (!(await control.isVisible())) continue;
      const backendNodeId = await control.backendNodeId();
      const { nodes } = await client.send('Accessibility.getPartialAXTree', {
        backendNodeId,
        fetchRelatives: false,
      });
      const node = nodes.find((row) => row.backendDOMNodeId === backendNodeId);
      const markup = await control.evaluate((element) => {
        const panel = element.closest('[data-panel-id]');
        return {
          outerHTML: element.outerHTML.slice(0, 1200),
          connected: element.isConnected,
          panelId: panel?.id || null,
          panelCollapsed: panel?.classList.contains('collapsed') || false,
          hiddenAncestor: Boolean(
            element.closest('[aria-hidden="true"], [inert]'),
          ),
        };
      });
      lastControl = {
        surface,
        backendNodeId,
        ...markup,
        axNodePresent: Boolean(node),
        ignored: node?.ignored ?? null,
        ignoredReasons: node?.ignoredReasons || [],
        role: node?.role?.value || null,
        name: node?.name?.value || null,
      };
      assert.ok(
        markup.connected && !markup.panelCollapsed && !markup.hiddenAncestor,
        'Review surface became hidden during accessibility inspection: ' +
          markup.outerHTML,
      );
      // The browser's computed AX name is authoritative. Raw aria-labelledby
      // IDs are not names and must not mask a missing or ignored AX node.
      const accessibleName = !node?.ignored && node?.name?.value?.trim();
      assert.ok(
        accessibleName,
        'Visible control lacks an accessible name: ' + markup.outerHTML,
      );
      names.push({ surface, role: node.role?.value, name: accessibleName });
      await control.dispose();
    }
    assert.ok(
      names.length > before,
      `No accessible controls inspected in ${selector}`,
    );
    announcements += await page.$$eval(
      `${selector} [role="status"]`,
      (nodes) => nodes.length,
    );
  };
  const openPanel = async (panelId) => {
    await page.evaluate((id) => {
      const panel = document.getElementById(id);
      const disclosure = panel?.querySelector(
        `.panel-collapse-btn[data-collapse-target="${id}"]`,
      );
      if (!disclosure) throw new Error(`Missing panel disclosure: ${id}`);
      // Establish an explicit open request even if a previous fixture action
      // left this panel expanded without updating its disclosure owner.
      if (!panel.classList.contains('collapsed')) disclosure.click();
      disclosure.click();
    }, panelId);
    await page.waitForFunction(
      (id) => {
        const panel = document.getElementById(id);
        return (
          panel &&
          !panel.classList.contains('collapsed') &&
          panel.getAttribute('aria-hidden') !== 'true'
        );
      },
      {},
      panelId,
    );
  };
  await inspectSurface('#evidence-panel');
  await openPanel('scene-panel');
  await page.evaluate(() => {
    const library = document.querySelector('.workspace-library');
    if (!library.open) library.querySelector('summary').click();
  });
  await inspectSurface('.workspace-library');
  await openPanel('data-panel');
  await inspectSurface('.investigation-timeline');
  await client.detach();
  assert.ok(
    names.length >= 12,
    'Accessibility fixture did not expose enough controls',
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
} catch (error) {
  await mkdir(path.dirname(out), { recursive: true });
  const report = {
    scope: 'automated-keyboard-ax-reflow',
    status: 'failed',
    browser: await browser.version(),
    timestamp: new Date().toISOString(),
    failure: String(error?.message || error),
    surface,
    lastControl,
    humanReviewValidated: false,
  };
  await writeFile(out, JSON.stringify(report, null, 2) + '\n');
  console.error(JSON.stringify(report, null, 2));
  throw error;
} finally {
  await browser.close();
}
