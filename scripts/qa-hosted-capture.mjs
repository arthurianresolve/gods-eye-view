import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import puppeteer from 'puppeteer';
import {
  classifyRenderer,
  readBrowserGraphicsInfo,
  readHostEnvironment,
} from './performance/rendererEvidence.mjs';
import { createRenderedSoakDriver } from './qa-rendered-soak-driver.mjs';
import { runMixedUseSoak } from './qa-mixed-use-soak.mjs';
import { validateInfrastructureCollectionReport } from './performance/infrastructureCollectionExperiment.mjs';

if (process.env.GITHUB_ACTIONS !== 'true')
  throw new Error(
    'Run this hosted-renderer probe in GitHub Actions. Local Chrome validation uses the visible fixture.',
  );
const commit = process.env.GITHUB_SHA;
if (!/^[a-f0-9]{40}$/.test(commit || ''))
  throw new Error('Exact source revision required');
const server = spawn(
  process.execPath,
  [
    'node_modules/vite/bin/vite.js',
    '--host',
    '127.0.0.1',
    '--port',
    '4184',
    '--strictPort',
  ],
  {
    env: { ...process.env, GEV_APP_COMMIT: commit },
    stdio: ['ignore', 'ignore', 'ignore'],
  },
);
let serverError = null;
server.on('error', (error) => {
  serverError = error;
});
const url = 'http://127.0.0.1:4184/scripts/fixtures/capture-matrix.html';
let browser;
const report = {
  schema: 'gev-hosted-native-renderer/v1',
  commit,
  platform: process.platform,
  timestamp: new Date().toISOString(),
  status: 'pending',
  hardwareRenderingAvailable: false,
  captureMatrix: null,
  environment: readHostEnvironment(),
};
try {
  const deadline = Date.now() + 90_000;
  for (;;) {
    if (serverError) throw serverError;
    if (server.exitCode !== null)
      throw new Error(`Fixture server exited ${server.exitCode}`);
    if (
      await fetch(url)
        .then((response) => response.ok)
        .catch(() => false)
    )
      break;
    if (Date.now() > deadline) throw new Error('Fixture server timeout');
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox'],
    timeout: 30_000,
  });
  const page = await browser.newPage();
  await page.goto(url, { waitUntil: 'networkidle0' });
  report.webglAvailable = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2');
    const available = Boolean(gl);
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
    return available;
  });
  if (!report.webglAvailable) {
    report.reason =
      'Standard runner exposes no WebGL 2 context; hardware evidence remains pending.';
  } else {
    await page.click('#run');
    await page.waitForFunction(
      () => document.querySelector('#result')?.textContent,
      { timeout: 30_000 },
    );
    const matrix = await page.$eval('#result', (element) =>
      JSON.parse(element.textContent),
    );
    if (matrix.applicationCommit !== commit)
      throw new Error('Capture matrix served wrong revision');
    report.captureMatrix = matrix;
    if (
      matrix.status !== 'passed' ||
      matrix.checks?.length !== 12 ||
      matrix.checks.some((check) => check.status !== 'passed')
    )
      throw new Error(
        `Capture correctness failed: ${matrix.error || 'incomplete checks'}`,
      );
    const renderers =
      matrix.environments?.map((environment) => environment.renderer) || [];
    report.graphics = await readBrowserGraphicsInfo(browser);
    report.renderingEvidence = renderers.map((renderer) =>
      classifyRenderer(renderer, report.graphics),
    );
    report.hardwareRenderingAvailable =
      renderers.length === 2 &&
      report.renderingEvidence.every((item) => item.accelerationVerified);
    report.status = report.hardwareRenderingAvailable
      ? matrix.status
      : 'pending';
    report.reason = report.hardwareRenderingAvailable
      ? 'Chrome confirms acceleration; hosted and paravirtual results do not establish physical desktop coverage.'
      : 'Standard runner did not expose verified acceleration. Hardware acceptance remains pending.';
    await page.goto(url.replace('capture-matrix.html', 'import-batches.html'), {
      waitUntil: 'networkidle0',
    });
    await page.click('#run');
    await page.waitForFunction(
      () => document.querySelector('#result')?.textContent,
      { timeout: 120_000 },
    );
    report.importBatches = await page.$eval('#result', (element) =>
      JSON.parse(element.textContent),
    );
    if (
      report.importBatches.applicationCommit !== commit ||
      report.importBatches.status !== 'passed' ||
      report.importBatches.samples?.length !== 10 ||
      report.importBatches.checks?.length !== 2
    )
      throw new Error(
        `Import comparison failed: ${report.importBatches.error || 'incomplete checks'}`,
      );
    if (
      process.argv.includes('--collections') &&
      report.hardwareRenderingAvailable
    ) {
      await page.goto(
        url.replace('capture-matrix.html', 'point-collections.html'),
        {
          waitUntil: 'networkidle0',
        },
      );
      await page.click('#run');
      await page.waitForFunction(
        () => document.querySelector('#result')?.textContent,
        { timeout: 360_000 },
      );
      report.pointCollections = await page.$eval('#result', (element) =>
        JSON.parse(element.textContent),
      );
      if (
        report.pointCollections.applicationCommit !== commit ||
        report.pointCollections.status !== 'passed' ||
        report.pointCollections.samples?.length !== 10
      )
        throw new Error(
          `Collection diagnostic failed: ${report.pointCollections.error || 'incomplete samples'}`,
        );
    }
    if (
      process.argv.includes('--infrastructure') &&
      report.hardwareRenderingAvailable
    ) {
      await page.setViewport({
        width: 1200,
        height: 960,
        deviceScaleFactor: 1,
      });
      await page.goto(
        url.replace('capture-matrix.html', 'infrastructure-collections.html'),
        { waitUntil: 'networkidle0' },
      );
      await page.click('#run');
      await page.waitForFunction(
        () => document.querySelector('#result')?.textContent,
        { timeout: 360_000, polling: 100 },
      );
      report.infrastructureCollections = await page.$eval(
        '#result',
        (element) => JSON.parse(element.textContent),
      );
      report.infrastructureGraphics = await readBrowserGraphicsInfo(browser);
      report.infrastructureRenderingEvidence = classifyRenderer(
        report.infrastructureCollections.environment?.renderer,
        report.infrastructureGraphics,
      );
      if (!report.infrastructureRenderingEvidence.accelerationVerified)
        throw new Error(
          'Infrastructure viewer did not retain verified acceleration',
        );
      validateInfrastructureCollectionReport(report.infrastructureCollections, {
        expectedCommit: commit,
      });
    }
    if (process.argv.includes('--wind') && report.hardwareRenderingAvailable) {
      await page.goto(
        url.replace('capture-matrix.html', 'wind-restores.html'),
        {
          waitUntil: 'networkidle0',
        },
      );
      await page.click('#run');
      await page.waitForFunction(
        () => document.querySelector('#result')?.textContent,
        { timeout: 90_000, polling: 100 },
      );
      report.windRestores = await page.$eval('#result', (element) =>
        JSON.parse(element.textContent),
      );
      if (
        report.windRestores.applicationCommit !== commit ||
        report.windRestores.status !== 'passed' ||
        report.windRestores.checks?.length !== 3
      )
        throw new Error(
          `Wind image comparison failed: ${report.windRestores.error || 'incomplete checks'}`,
        );
    }
    if (process.argv.includes('--soak') && report.hardwareRenderingAvailable) {
      await browser.close();
      browser = null;
      const driver = await createRenderedSoakDriver('http://127.0.0.1:4184', {
        expectedCommit: commit,
      });
      try {
        if (!driver.hardwareRenderingValidated)
          throw new Error('Soak browser did not retain verified acceleration');
        report.soak = await runMixedUseSoak({
          driver,
          progress: (value) => console.log(JSON.stringify(value)),
        });
        report.soak.candidateCommit = commit;
        if (!report.soak.fullSoak || report.soak.stability.status !== 'passed')
          throw new Error(
            'Hosted accelerated soak did not pass stability acceptance',
          );
      } catch (error) {
        if (error.soakReport) report.soak = error.soakReport;
        throw error;
      } finally {
        await driver.close();
      }
    }
  }
} catch (error) {
  report.status = 'failed';
  report.reason = `Native renderer probe failed: ${error.message}`;
  process.exitCode = 1;
} finally {
  await browser?.close().catch((error) => {
    report.status = 'failed';
    report.cleanupError = error.message;
    process.exitCode = 1;
  });
  server.kill();
  if (process.argv.includes('--infrastructure')) {
    await mkdir('qa-artifacts', { recursive: true });
    await writeFile(
      'qa-artifacts/hosted-native-renderer.json',
      `${JSON.stringify(report, null, 2)}\n`,
    );
  }
  console.log('QA_EVIDENCE_BEGIN hosted-native-renderer');
  console.log(JSON.stringify(report));
  console.log('QA_EVIDENCE_END hosted-native-renderer');
}
