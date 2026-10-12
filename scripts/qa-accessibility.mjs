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
import { createAccessibilityFocusProbe } from './accessibilityFocusDiagnostics.mjs';
const option = (name, fallback) => {
  const index = process.argv.indexOf(name);
  return index < 0 ? fallback : process.argv[index + 1];
};
const base = option('--url', 'http://localhost:4174');
const out = option('--out', 'qa-artifacts/accessibility.json');
const browser = await launchFixtureBrowser();
let lastControl = null;
let surface = null;
let activePhase = 'launch-browser';
let page = null;
let client = null;
let pageErrors = [];
let focusProbeInstalled = false;
const markPhase = async (phase, control = null) => {
  activePhase = phase;
  if (control) lastControl = control;
  if (!page) return;
  await page
    .evaluate(
      ({ nextPhase, nextControl }) => {
        const probe = window.__qaAccessibilityFocus;
        probe?.markPhase(nextPhase);
        if (nextControl) probe?.markControl(nextControl);
      },
      { nextPhase: phase, nextControl: control },
    )
    .catch(() => {});
};
const readFocusDiagnostics = async () => {
  if (!page) return { unavailable: true, reason: 'page-not-created' };
  let timer;
  try {
    return await Promise.race([
      page.evaluate(() => window.__qaAccessibilityFocus?.snapshot() || null),
      new Promise((resolve) => {
        timer = setTimeout(
          () => resolve({ unavailable: true, reason: 'snapshot-timeout' }),
          1200,
        );
      }),
    ]);
  } catch {
    return { unavailable: true, reason: 'snapshot-failed' };
  } finally {
    clearTimeout(timer);
  }
};
try {
  const prepared = await prepareFixturePage(browser, base);
  page = prepared.page;
  pageErrors = prepared.errors;
  try {
    await page.evaluateOnNewDocument(createAccessibilityFocusProbe);
    focusProbeInstalled = true;
  } catch {
    // The probe is diagnostic-only; it must not change the accessibility gate.
  }
  await markPhase('boot-fixture');
  await bootFixturePage(page, base);
  await markPhase('open-command-palette', '.gev-command-trigger + Enter');
  await page.focus('.gev-command-trigger');
  await page.keyboard.press('Enter');
  await markPhase('wait-command-search-focus');
  await page.waitForFunction(
    () => document.activeElement?.id === 'gev-command-search',
  );
  await markPhase('navigate-command-options', 'type + ArrowDown');
  await page.type('#gev-command-search', 'save workspace');
  await page.keyboard.press('ArrowDown');
  assert.equal(
    await page.evaluate(() =>
      document.activeElement.matches('.gev-command-option'),
    ),
    true,
  );
  await markPhase('restore-command-trigger-focus', 'Escape command palette');
  await page.keyboard.press('Escape');
  await page.waitForFunction(() =>
    document.activeElement?.matches('.gev-command-trigger'),
  );
  await markPhase('open-evidence-inspector', 'dispatch entity-selected');
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
  await markPhase('focus-evidence-close-control', '#evidence-panel-close');
  await page.waitForSelector('#evidence-panel-close', { visible: true });
  await page.focus('#evidence-panel-close');
  await markPhase(
    'verify-delayed-native-palette-close',
    'palette close then inspector focus before queued close event',
  );
  const delayedCloseKeptInspectorFocus = await page.evaluate(async () => {
    const palette = document.querySelector('.gev-command-palette');
    const trigger = document.querySelector('.gev-command-trigger');
    const inspectorClose = document.querySelector('#evidence-panel-close');
    if (!palette || !trigger || !inspectorClose || palette.open)
      throw new Error('Delayed-close focus fixture was not ready');
    let closeTimer;
    let onClose;
    const closed = new Promise((resolve, reject) => {
      closeTimer = setTimeout(
        () => reject(new Error('Native command-palette close event timed out')),
        1000,
      );
      onClose = () => resolve();
      palette.addEventListener('close', onClose, { once: true });
    });
    try {
      trigger.focus();
      trigger.click();
      if (!palette.open)
        throw new Error('Command-palette trigger did not open the dialog');
      palette.close();
      inspectorClose.focus();
      await closed;
      return document.activeElement === inspectorClose;
    } finally {
      clearTimeout(closeTimer);
      palette.removeEventListener('close', onClose);
    }
  });
  assert.equal(
    delayedCloseKeptInspectorFocus,
    true,
    'A delayed command-palette close event stole inspector focus',
  );
  await page.keyboard.press('Enter');
  await markPhase('wait-evidence-focus-restoration');
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
  client = await page.createCDPSession();
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
  await markPhase('inspect-evidence-controls');
  await inspectSurface('#evidence-panel');
  await markPhase('open-scene-panel');
  await openPanel('scene-panel');
  await page.evaluate(() => {
    const library = document.querySelector('.workspace-library');
    if (!library.open) library.querySelector('summary').click();
  });
  await markPhase('inspect-workspace-library-controls');
  await inspectSurface('.workspace-library');
  await markPhase('open-data-panel');
  await openPanel('data-panel');
  await markPhase('inspect-timeline-controls');
  await inspectSurface('.investigation-timeline');
  await client.detach();
  client = null;
  assert.ok(
    names.length >= 12,
    'Accessibility fixture did not expose enough controls',
  );
  assert.ok(
    announcements >= 2,
    'Async operations need scoped status announcements',
  );
  await page.setViewport({ width: 720, height: 500, deviceScaleFactor: 2 });
  await markPhase(
    'open-command-palette-for-reflow',
    '.gev-command-trigger + Enter',
  );
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
  assert.deepEqual(pageErrors, []);
  activePhase = 'write-success-report';
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
    accessibilityFocusProbeInstalled: focusProbeInstalled,
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
    phase: activePhase,
    surface,
    lastControl,
    focusDiagnostics: await readFocusDiagnostics(),
    accessibilityFocusProbeInstalled: focusProbeInstalled,
    humanReviewValidated: false,
    pageErrorCount: pageErrors.length,
  };
  await writeFile(out, JSON.stringify(report, null, 2) + '\n');
  console.error(JSON.stringify(report, null, 2));
  throw error;
} finally {
  if (client) await client.detach().catch(() => {});
  if (page) {
    let timer;
    try {
      await Promise.race([
        page.evaluate(() => window.__qaAccessibilityFocus?.dispose()),
        new Promise((resolve) => {
          timer = setTimeout(resolve, 1000);
        }),
      ]);
    } catch {
      // Closing the owned browser below also drops any page-local listeners.
    } finally {
      clearTimeout(timer);
    }
  }
  await browser.close();
}
