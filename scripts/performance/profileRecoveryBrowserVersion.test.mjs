import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertSelectedChromeVersion,
  installSelectedProfileRecoveryBrowser,
  parseChromeVersionOutput,
  validateProfileRecoveryBrowserSelection,
} from './profileRecoveryBrowserVersion.mjs';

const selectedContext = {
  version: '155.0.8059.39',
  eventName: 'workflow_dispatch',
  validationMode: 'windows-profile-recovery',
  runner: 'windows-latest',
  platform: 'win32',
};

test('alternate browser selection is exact and limited to manual Windows profile recovery', () => {
  assert.equal(
    validateProfileRecoveryBrowserSelection(selectedContext),
    selectedContext.version,
  );
  assert.equal(
    validateProfileRecoveryBrowserSelection({
      ...selectedContext,
      version: '',
    }),
    null,
  );
  for (const [key, value] of [
    ['version', '155.0.8059'],
    ['version', 'stable'],
    ['eventName', 'push'],
    ['validationMode', 'standard'],
    ['runner', 'ubuntu-latest'],
    ['platform', 'linux'],
  ]) {
    assert.throws(
      () =>
        validateProfileRecoveryBrowserSelection({
          ...selectedContext,
          [key]: value,
        }),
      /Chrome version|manual workflow|Windows profile recovery|windows-latest|requires Windows/,
    );
  }
});

test('exact Chrome version parser and recovery runtime guard reject mismatches', () => {
  assert.equal(
    parseChromeVersionOutput('Google Chrome for Testing 155.0.8059.39\n'),
    '155.0.8059.39',
  );
  assert.equal(
    assertSelectedChromeVersion('155.0.8059.39', 'Chrome/155.0.8059.39'),
    '155.0.8059.39',
  );
  assert.equal(
    assertSelectedChromeVersion(
      '155.0.8059.39',
      'HeadlessChrome/155.0.8059.39',
    ),
    '155.0.8059.39',
  );
  assert.throws(
    () => assertSelectedChromeVersion('155.0.8059.39', 'Chrome/152.0.7977.75'),
    /expected 155\.0\.8059\.39, observed 152\.0\.7977\.75/,
  );
});

test('version installer validates before install and publishes only an exact verified executable', async () => {
  let installCalls = 0;
  let probeCalls = 0;
  let environment = null;
  await assert.rejects(
    installSelectedProfileRecoveryBrowser({
      selection: null,
      cacheDir: 'cache',
      installBrowser: async () => {
        installCalls += 1;
      },
      probeVersion: async () => {
        probeCalls += 1;
      },
      publishEnvironment: async () => {},
    }),
    /validated exact Chrome version selection/,
  );
  assert.equal(installCalls, 0);

  const result = await installSelectedProfileRecoveryBrowser({
    selection: '155.0.8059.39',
    cacheDir: 'cache',
    installBrowser: async (options) => {
      installCalls += 1;
      assert.deepEqual(options, {
        browser: 'chrome',
        buildId: '155.0.8059.39',
        cacheDir: 'cache',
        platform: 'win64',
      });
      return {
        buildId: options.buildId,
        executablePath: 'C:\\hostedtoolcache\\chrome.exe',
      };
    },
    probeVersion: async (path) => {
      probeCalls += 1;
      assert.equal(path, 'C:\\hostedtoolcache\\chrome.exe');
      return 'Google Chrome for Testing 155.0.8059.39';
    },
    publishEnvironment: async (values) => {
      environment = values;
    },
  });
  assert.deepEqual(result, {
    expectedVersion: '155.0.8059.39',
    actualVersion: '155.0.8059.39',
    status: 'verified',
  });
  assert.equal(installCalls, 1);
  assert.equal(probeCalls, 1);
  assert.deepEqual(environment, {
    PUPPETEER_EXECUTABLE_PATH: 'C:\\hostedtoolcache\\chrome.exe',
    GEV_QA_PROFILE_RECOVERY_CHROME_VERSION: '155.0.8059.39',
  });
});

test('version installer rejects a mismatched installed binary without publishing a launch path', async () => {
  let published = false;
  await assert.rejects(
    installSelectedProfileRecoveryBrowser({
      selection: '155.0.8059.39',
      cacheDir: 'cache',
      installBrowser: async ({ buildId }) => ({
        buildId,
        executablePath: 'C:\\hostedtoolcache\\chrome.exe',
      }),
      probeVersion: async () => 'Google Chrome for Testing 152.0.7977.75',
      publishEnvironment: async () => {
        published = true;
      },
    }),
    /expected 155\.0\.8059\.39, observed 152\.0\.7977\.75/,
  );
  assert.equal(published, false);
});
