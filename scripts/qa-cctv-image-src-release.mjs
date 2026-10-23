#!/usr/bin/env node
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer';
import { setTimeout as delay } from 'node:timers/promises';

const executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;
assert.ok(
  executablePath,
  'Set PUPPETEER_EXECUTABLE_PATH to the isolated Chrome executable to test.',
);
const expectedVersion = process.env.CCTV_IMAGE_RETENTION_CHROME_VERSION;
const count = 24;
const result = {
  schema: 'gev-cctv-image-src-release/v1',
  diagnosticOnly: true,
  acceptanceEligible: false,
  startedAt: new Date().toISOString(),
  countPerMode: count,
  modes: ['remove-attribute', 'empty-src', 'strong-control'],
};
let browser;
let session;

try {
  browser = await puppeteer.launch({
    headless: process.argv.includes('--headless'),
    executablePath,
  });
  result.browserVersion = await browser.version();
  if (expectedVersion)
    assert.equal(
      result.browserVersion,
      `Chrome/${expectedVersion}`,
      'The browser version differs from the declared diagnostic target.',
    );
  const page = await browser.newPage();
  await page.goto('about:blank');
  session = await page.createCDPSession();
  await session.send('HeapProfiler.enable');
  await page.evaluate(async (imagesPerMode) => {
    const source = 'data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=';
    const probe = (window.__cctvImageSrcRelease = {
      weak: Object.create(null),
      strong: [],
    });
    for (const mode of ['remove-attribute', 'empty-src', 'strong-control']) {
      const references = (probe.weak[mode] = []);
      for (let index = 0; index < imagesPerMode; index += 1) {
        const image = new Image();
        image.src = source;
        await image.decode();
        references.push(new WeakRef(image));
        image.onload = null;
        image.onerror = null;
        if (mode === 'remove-attribute') image.removeAttribute('src');
        if (mode === 'empty-src') image.src = '';
        if (mode === 'strong-control') probe.strong.push(image);
      }
    }
  }, count);
  const checkpoints = [];
  for (const pauseMs of [100, 1_000, 3_000]) {
    await delay(pauseMs);
    await session.send('HeapProfiler.collectGarbage');
    await delay(100);
    await session.send('HeapProfiler.collectGarbage');
    checkpoints.push(
      await page.evaluate(() => ({
        alive: Object.fromEntries(
          Object.entries(window.__cctvImageSrcRelease.weak).map(
            ([mode, references]) => [
              mode,
              references.filter((reference) => reference.deref()).length,
            ],
          ),
        ),
      })),
    );
  }
  result.checkpoints = checkpoints;
  const finalAlive = checkpoints.at(-1).alive;
  assert.equal(
    finalAlive['empty-src'],
    0,
    'Images with cleared src should be collectable after forced GC.',
  );
  assert.equal(
    finalAlive['strong-control'],
    count,
    'Strong controls verify that the WeakRef probe detects retained images.',
  );
  result.originalRetentionReproduced =
    finalAlive['remove-attribute'] > finalAlive['empty-src'];
  result.status = 'completed';
} catch (error) {
  result.status = 'failed';
  result.error = String(error?.message || error).slice(0, 500);
  process.exitCode = 1;
} finally {
  if (session) {
    try {
      await session.detach();
      result.sessionDetached = true;
    } catch (error) {
      result.sessionDetachError = String(error?.message || error).slice(0, 300);
      process.exitCode = 1;
    }
  }
  if (browser) {
    try {
      await browser.close();
      result.browserClosed = true;
    } catch (error) {
      result.browserCloseError = String(error?.message || error).slice(0, 300);
      process.exitCode = 1;
    }
  }
  result.completedAt = new Date().toISOString();
  console.log(JSON.stringify(result, null, 2));
}
