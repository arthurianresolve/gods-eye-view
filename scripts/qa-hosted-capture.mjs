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
import { validateVesselRenderDemandReport } from './performance/vesselRenderDemand.mjs';
import { validateCctvCalibrationDemandReport } from './performance/cctvCalibrationDemand.mjs';
import { driveNativePointerFixture } from './performance/nativePointerFixture.mjs';
import { interceptFixtureSession } from './performance/fixtureInterception.mjs';
import {
  closeRecoveryBrowser,
  stopOwnedRecoveryProcessTree,
} from './performance/profileRecoveryPageOwnership.mjs';

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
let vesselPage;
let vesselSession;
let calibrationPage;
let calibrationSession;
const closeOwnedBrowser = (ownedBrowser) =>
  closeRecoveryBrowser(ownedBrowser, {
    timeoutMs: 5000,
    forceProcess: () => stopOwnedRecoveryProcessTree(ownedBrowser.process()),
  });
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
  let observingImportPage = false;
  report.importPageErrors = [];
  page.on('pageerror', (error) => {
    if (!observingImportPage) return;
    report.importPageErrors.push(String(error?.message || error).slice(0, 400));
    if (report.importPageErrors.length > 8) report.importPageErrors.shift();
  });
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
    const importUrl = new URL(
      url.replace('capture-matrix.html', 'import-batches.html'),
    );
    if (process.argv.includes('--import-point-collection'))
      importUrl.searchParams.set('point-renderer', 'primitive-collection');
    else if (process.argv.includes('--import-point-entity'))
      importUrl.searchParams.set('point-renderer', 'entity');
    if (process.argv.includes('--import-mixed-parity'))
      importUrl.searchParams.set('mixed-parity', '1');
    if (process.argv.includes('--import-point-benefit-diagnostics'))
      importUrl.searchParams.set('point-benefit', '1');
    observingImportPage = true;
    try {
      await page.goto(importUrl.href, { waitUntil: 'networkidle0' });
      await page.click('#run');
      await page.waitForFunction(
        () => document.querySelector('#result')?.textContent,
        { timeout: 120_000 },
      );
      report.importBatches = await page.$eval('#result', (element) =>
        JSON.parse(element.textContent),
      );
    } catch (error) {
      report.importFixtureFailure = String(error?.message || error).slice(
        0,
        800,
      );
      report.importFixturePartialResult = await page
        .$eval('#result', (element) => element.textContent.slice(0, 16_000))
        .catch(() => null);
      throw error;
    } finally {
      observingImportPage = false;
    }
    if (
      report.importBatches.applicationCommit !== commit ||
      report.importBatches.status !== 'passed' ||
      report.importBatches.samples?.length !== 10 ||
      !Array.isArray(report.importBatches.checks) ||
      report.importBatches.checks.length < 2 ||
      (process.argv.includes('--import-point-entity') &&
        report.importBatches.pointRepresentation !== 'entity') ||
      (process.argv.includes('--import-point-collection') &&
        report.importBatches.pointRepresentation !== 'primitive-collection') ||
      (process.argv.includes('--import-mixed-parity') &&
        report.importBatches.mixedGeometryParity?.status !== 'passed') ||
      (process.argv.includes('--import-point-benefit-diagnostics') &&
        report.importBatches.pointBenefitDiagnosticsRequested !== true)
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
      await page.select('#color-encoding', 'entity-color-attribute-byte');
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
      if (
        report.infrastructureCollections.candidateRepresentation
          ?.stemColorEncoding !== 'entity-color-attribute-byte'
      )
        throw new Error(
          'Infrastructure run did not execute the explicitly selected RGBA8 candidate',
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
    if (
      process.argv.includes('--vessels') &&
      report.hardwareRenderingAvailable
    ) {
      report.vesselPageErrors = [];
      report.vesselInterceptionErrors = [];
      report.vesselExternalRequestCount = 0;
      vesselPage = await browser.newPage();
      vesselPage.on('pageerror', (error) => {
        if (report.vesselPageErrors.length < 20)
          report.vesselPageErrors.push(String(error.message).slice(0, 500));
      });
      await vesselPage.setViewport({
        width: 1200,
        height: 960,
        deviceScaleFactor: 1,
      });
      // Worker requests must not wait for Puppeteer's Fetch/Network pairing.
      vesselSession = await vesselPage.createCDPSession();
      await interceptFixtureSession(
        vesselSession,
        new URL(url).origin,
        (requestUrl) => {
          if (
            ['http:', 'https:'].includes(requestUrl.protocol) &&
            requestUrl.origin !== new URL(url).origin
          )
            report.vesselExternalRequestCount += 1;
        },
        (error) => {
          if (report.vesselInterceptionErrors.length < 20)
            report.vesselInterceptionErrors.push(
              String(error.message).slice(0, 500),
            );
        },
      );
      await vesselPage.goto(
        url.replace('capture-matrix.html', 'vessel-render-demand.html'),
        { waitUntil: 'networkidle0' },
      );
      await vesselPage.click('#run');
      const vesselDeadline = Date.now() + 240_000;
      for (;;) {
        // Short host polls avoid a single long awaitPromise protocol command.
        const result = await vesselPage.$eval('#result', (element) =>
          element.textContent ? JSON.parse(element.textContent) : null,
        );
        if (result) {
          report.vesselRenderDemand = result;
          break;
        }
        if (Date.now() >= vesselDeadline)
          throw new Error('Vessel render-demand fixture timeout');
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
      report.vesselGraphics = await readBrowserGraphicsInfo(browser);
      if (report.vesselRenderDemand.status !== 'passed')
        throw new Error(
          `Vessel fixture failed in ${report.vesselRenderDemand.failedPhase || 'unknown phase'}: ${report.vesselRenderDemand.error || report.vesselRenderDemand.cleanup?.error || 'incomplete checks'}`,
        );
      report.vesselRenderingEvidence = classifyRenderer(
        report.vesselRenderDemand.environment?.renderer,
        report.vesselGraphics,
      );
      if (!report.vesselRenderingEvidence.accelerationVerified)
        throw new Error('Vessel viewer did not retain verified acceleration');
      if (
        report.vesselPageErrors.length ||
        report.vesselInterceptionErrors.length ||
        report.vesselExternalRequestCount
      )
        throw new Error('Vessel fixture had page errors or external requests');
      validateVesselRenderDemandReport(report.vesselRenderDemand, {
        expectedCommit: commit,
      });
    }
    if (
      process.argv.includes('--calibration') &&
      report.hardwareRenderingAvailable
    ) {
      report.calibrationPageErrors = [];
      report.calibrationInterceptionErrors = [];
      report.calibrationExternalRequestCount = 0;
      report.calibrationPointerActions = [];
      calibrationPage = await browser.newPage();
      calibrationPage.on('pageerror', (error) => {
        if (report.calibrationPageErrors.length < 20)
          report.calibrationPageErrors.push(
            String(error.message).slice(0, 500),
          );
      });
      const viewport = { width: 1200, height: 960, deviceScaleFactor: 1 };
      await calibrationPage.setViewport(viewport);
      calibrationSession = await calibrationPage.createCDPSession();
      await interceptFixtureSession(
        calibrationSession,
        new URL(url).origin,
        (requestUrl) => {
          if (
            ['http:', 'https:'].includes(requestUrl.protocol) &&
            requestUrl.origin !== new URL(url).origin
          )
            report.calibrationExternalRequestCount += 1;
        },
        (error) => {
          if (report.calibrationInterceptionErrors.length < 20)
            report.calibrationInterceptionErrors.push(
              String(error.message).slice(0, 500),
            );
        },
      );
      await calibrationPage.goto(
        url.replace('capture-matrix.html', 'cctv-calibration-demand.html'),
        { waitUntil: 'networkidle0' },
      );
      await calibrationPage.click('#run');
      const readJson = (selector) =>
        calibrationPage.$eval(selector, (element) =>
          element.textContent.trim() ? JSON.parse(element.textContent) : null,
        );
      report.calibrationRenderDemand = await driveNativePointerFixture({
        readResult: () => readJson('#result'),
        readInstruction: () => readJson('#pointer-instruction'),
        mouse: calibrationPage.mouse,
        viewport,
        actions: report.calibrationPointerActions,
      });
      report.calibrationGraphics = await readBrowserGraphicsInfo(browser);
      report.calibrationRenderingEvidence = classifyRenderer(
        report.calibrationRenderDemand.environment?.renderer,
        report.calibrationGraphics,
      );
      if (!report.calibrationRenderingEvidence.accelerationVerified)
        throw new Error(
          'Calibration viewer did not retain verified acceleration',
        );
      if (
        report.calibrationPageErrors.length ||
        report.calibrationInterceptionErrors.length ||
        report.calibrationExternalRequestCount
      )
        throw new Error(
          'Calibration fixture had page errors or external requests',
        );
      validateCctvCalibrationDemandReport(report.calibrationRenderDemand, {
        expectedCommit: commit,
      });
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
  if (calibrationPage && !report.calibrationRenderDemand) {
    report.calibrationRenderDemand = await calibrationPage
      .evaluate(() => window.__cctvCalibrationDemandResult || null)
      .catch(() => null);
  }
  if (vesselPage && !report.vesselRenderDemand) {
    report.vesselRenderDemand = await vesselPage
      .evaluate(() => window.__vesselRenderDemandResult || null)
      .catch(() => null);
  }
  report.status = 'failed';
  report.reason = `Native renderer probe failed: ${error.message}`;
  process.exitCode = 1;
} finally {
  if (calibrationSession) {
    await calibrationSession.detach().catch((error) => {
      report.status = 'failed';
      report.calibrationDetachError = error.message;
      process.exitCode = 1;
    });
  }
  if (vesselSession) {
    await vesselSession.detach().catch((error) => {
      report.status = 'failed';
      report.vesselDetachError = error.message;
      process.exitCode = 1;
    });
  }
  if (browser) {
    report.browserClose = await closeOwnedBrowser(browser).catch((error) => ({
      closeCompleted: false,
      error: error.message,
    }));
    if (!report.browserClose.closeCompleted) {
      report.status = 'failed';
      report.cleanupError = 'Owned browser did not close normally';
      process.exitCode = 1;
    }
  }
  server.kill();
  if (
    process.argv.includes('--infrastructure') ||
    process.argv.includes('--vessels') ||
    process.argv.includes('--calibration') ||
    process.argv.includes('--import-point-entity') ||
    process.argv.includes('--import-point-collection')
  ) {
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
