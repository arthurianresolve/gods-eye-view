#!/usr/bin/env node
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { appendFile } from 'node:fs/promises';
import os from 'node:os';
import puppeteer from 'puppeteer';
import { Browser, BrowserPlatform, install } from '@puppeteer/browsers';
import {
  installSelectedProfileRecoveryBrowser,
  validateProfileRecoveryBrowserSelection,
} from './performance/profileRecoveryBrowserVersion.mjs';

const selection = validateProfileRecoveryBrowserSelection({
  version: process.env.GEV_QA_PROFILE_RECOVERY_CHROME_VERSION,
  eventName: process.env.GITHUB_EVENT_NAME,
  validationMode: process.env.GEV_QA_VALIDATION_MODE,
  runner: process.env.GEV_QA_SELECTED_RUNNER,
  platform: process.platform,
});
assert.ok(
  selection,
  'Set an exact Chrome version before using this installer.',
);
const installed = await installSelectedProfileRecoveryBrowser({
  selection,
  cacheDir: (await puppeteer.configuration()).cacheDirectory,
  installBrowser: ({ buildId, cacheDir }) =>
    install({
      browser: Browser.CHROME,
      buildId,
      cacheDir,
      platform: BrowserPlatform.WIN64,
    }),
  probeVersion: (executablePath) =>
    execFileSync(executablePath, ['--version'], {
      encoding: 'utf8',
      timeout: 10_000,
      windowsHide: true,
      maxBuffer: 4096,
    }),
  publishEnvironment: async (values) => {
    const githubEnv = process.env.GITHUB_ENV;
    assert.ok(githubEnv, 'GitHub Actions environment file is unavailable.');
    for (const [name, value] of Object.entries(values)) {
      assert.equal(typeof value, 'string');
      assert.equal(/[\r\n]/.test(value), false);
      await appendFile(githubEnv, `${name}=${value}${os.EOL}`, 'utf8');
    }
  },
});
console.log(JSON.stringify(installed));
