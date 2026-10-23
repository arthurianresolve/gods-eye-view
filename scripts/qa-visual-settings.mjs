#!/usr/bin/env node
/** Effective density, its controls and status must agree across real restores. */
import assert from 'node:assert/strict';
import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import {
  launchFixtureBrowser,
  prepareFixturePage,
  bootFixturePage,
  clickControl,
  openWorkspace,
} from './qa-application-fixtures.mjs';

const option = (name, fallback) => {
  const index = process.argv.indexOf(name);
  return index < 0 ? fallback : process.argv[index + 1];
};
const base = option('--url', 'http://localhost:4174');
const out = option('--out', 'qa-artifacts/visual-settings.json');
const browser = await launchFixtureBrowser();
const checks = [];
let report;
let commit = null;
try {
  const { page, errors } = await prepareFixturePage(browser, base);
  await bootFixturePage(page, base, {
    hash: '#v=2&lat=30.2738&lon=-97.7371&alt=85000&heading=0&pitch=-90&roll=0&style=normal&dm=SPARSE&dd=25&map=esri-imagery&l=',
  });
  commit = await page.evaluate(
    () => window.__godsEyeView.getPerformanceEnvironment().appCommit,
  );
  assert.match(commit, /^[a-f0-9]{40}$/);
  const read = () =>
    page.evaluate(() => {
      const app = window.__godsEyeView;
      return {
        mode: document.querySelector('#presentation-quality-mode').value,
        slider: Number(
          document.querySelector('#detection-density-slider').value,
        ),
        label: document.querySelector('#detection-density-value').textContent,
        status: document.querySelector('#presentation-quality-status')
          .textContent,
        effective: app.getPerformanceSnapshot().settings.densityPct,
      };
    });
  const check = async (id, mode, value) => {
    const actual = await read();
    const result = { id, status: 'failed', actual };
    checks.push(result);
    assert.equal(actual.mode, mode, id);
    assert.equal(actual.slider, value, id);
    assert.equal(actual.effective, value, id);
    assert.equal(actual.label, `${value}%`, id);
    assert.equal(actual.status, `${mode.toUpperCase()} · ${value}%`, id);
    result.status = 'passed';
  };
  const density = (value) =>
    page.evaluate((next) => {
      const input = document.querySelector('#detection-density-slider');
      input.value = String(next);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }, value);
  await check('initial-share-link', 'manual', 25);
  await density(75);
  await check('manual-slider', 'manual', 75);
  await clickControl(page, '.workspace-library [data-action="save-as"]');
  await page.waitForFunction(
    () =>
      document.querySelector('.workspace-library [data-workspace-select]')
        .value,
    { polling: 100 },
  );
  const firstId = await page.$eval(
    '.workspace-library [data-workspace-select]',
    (node) => node.value,
  );
  await clickControl(page, '.workspace-library [data-action="save-as"]');
  await page.waitForFunction(
    (id) =>
      document.querySelector('.workspace-library [data-workspace-select]')
        .value !== id,
    { polling: 100 },
    firstId,
  );
  await density(25);
  await page.select('#presentation-quality-mode', 'quality');
  await check('quality-profile', 'quality', 75);
  await page.select('#presentation-quality-mode', 'performance');
  await check('performance-profile', 'performance', 25);
  await page.select('#presentation-quality-mode', 'manual');
  await check('manual-profile-restores-choice', 'manual', 25);
  await openWorkspace(page, firstId);
  await check('workspace-restore', 'manual', 75);
  assert.deepEqual(errors, []);
  report = {
    schema: 'gev-visual-settings-journey/v1',
    commit,
    status: 'passed',
    checks,
  };
} catch (error) {
  report = {
    schema: 'gev-visual-settings-journey/v1',
    status: 'failed',
    checks,
    commit,
    error: error.message,
  };
  process.exitCode = 1;
} finally {
  await browser.close();
  await mkdir(path.dirname(out), { recursive: true });
  await writeFile(out, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report));
}
