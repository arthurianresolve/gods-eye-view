import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertSelectedChromeVersion,
  installSelectedProfileRecoveryBrowser,
  parseWindowsFileVersionOutput,
  readWindowsExecutableFileVersion,
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

test('Windows metadata version parser and recovery runtime guard reject mismatches', () => {
  assert.equal(
    parseWindowsFileVersionOutput('155.0.8059.39\r\n'),
    '155.0.8059.39',
  );
  assert.throws(
    () => parseWindowsFileVersionOutput('Google Chrome 155.0.8059.39'),
    /exact four-part version/,
  );
  assert.throws(
    () => parseWindowsFileVersionOutput(''),
    /exact four-part version/,
  );
  let queriedPath = null;
  assert.equal(
    readWindowsExecutableFileVersion('C:\\hostedtoolcache\\chrome.exe', {
      platform: 'win32',
      runPowerShell: (path) => {
        queriedPath = path;
        return '155.0.8059.39\r\n';
      },
    }),
    '155.0.8059.39',
  );
  assert.equal(queriedPath, 'C:\\hostedtoolcache\\chrome.exe');
  assert.throws(
    () =>
      readWindowsExecutableFileVersion('C:\\chrome.exe', {
        platform: 'win32',
        runPowerShell: () => 'unknown',
      }),
    /exact four-part version/,
  );
  assert.throws(
    () => readWindowsExecutableFileVersion('chrome.exe', { platform: 'linux' }),
    /requires Windows/,
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

test(
  'Windows file-version probe reads an existing executable without launching it',
  {
    skip: process.platform !== 'win32',
  },
  () => {
    const version = readWindowsExecutableFileVersion(process.execPath);
    assert.match(version, /^\d+\.\d+\.\d+\.\d+$/);
    assert.throws(
      () => assertSelectedChromeVersion('0.0.0.0', `Chrome/${version}`),
      /expected 0\.0\.0\.0, observed/,
    );
  },
);

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
      return '155.0.8059.39';
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
      probeVersion: async () => '152.0.7977.75',
      publishEnvironment: async () => {
        published = true;
      },
    }),
    /expected 155\.0\.8059\.39, observed 152\.0\.7977\.75/,
  );
  assert.equal(published, false);
});
