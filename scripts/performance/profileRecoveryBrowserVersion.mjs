import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

const EXACT_CHROME_VERSION = /^\d+\.\d+\.\d+\.\d+$/;

export function validateProfileRecoveryBrowserSelection({
  version,
  eventName,
  validationMode,
  runner,
  platform,
}) {
  if (version === '' || version == null) return null;
  assert.equal(typeof version, 'string', 'Chrome version must be a string.');
  assert.match(
    version,
    EXACT_CHROME_VERSION,
    'Chrome version must be four numeric dot-separated components.',
  );
  assert.equal(
    eventName,
    'workflow_dispatch',
    'Alternate Chrome is only available on manual workflow dispatch.',
  );
  assert.equal(
    validationMode,
    'windows-profile-recovery',
    'Alternate Chrome is only available for Windows profile recovery.',
  );
  assert.equal(
    runner,
    'windows-latest',
    'Alternate Chrome requires the free standard windows-latest runner.',
  );
  assert.equal(platform, 'win32', 'Alternate Chrome install requires Windows.');
  return version;
}

export function parseWindowsFileVersionOutput(output) {
  assert.equal(typeof output, 'string');
  const version = output.trim();
  assert.match(
    version,
    EXACT_CHROME_VERSION,
    'Windows executable metadata did not contain an exact four-part version.',
  );
  return version;
}

export function readWindowsExecutableFileVersion(
  executablePath,
  { platform = process.platform, runPowerShell = null } = {},
) {
  assert.equal(
    platform,
    'win32',
    'Windows executable metadata requires Windows.',
  );
  assert.equal(typeof executablePath, 'string');
  assert.ok(executablePath.length > 0 && executablePath.length <= 2048);
  const execute =
    runPowerShell ||
    ((filePath) =>
      execFileSync(
        'powershell.exe',
        [
          '-NoLogo',
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          '$ErrorActionPreference = "Stop"; $info = [System.Diagnostics.FileVersionInfo]::GetVersionInfo($env:GEV_PROFILE_RECOVERY_EXE); "{0}.{1}.{2}.{3}" -f $info.FileMajorPart, $info.FileMinorPart, $info.FileBuildPart, $info.FilePrivatePart',
        ],
        {
          encoding: 'utf8',
          timeout: 10_000,
          windowsHide: true,
          maxBuffer: 4096,
          env: {
            ...process.env,
            GEV_PROFILE_RECOVERY_EXE: filePath,
          },
        },
      ));
  return parseWindowsFileVersionOutput(execute(executablePath));
}

export function assertSelectedChromeVersion(expectedVersion, observedVersion) {
  assert.match(expectedVersion, EXACT_CHROME_VERSION);
  assert.equal(typeof observedVersion, 'string');
  const match = observedVersion.match(
    /^(?:Headless)?Chrome\/(\d+\.\d+\.\d+\.\d+)$/,
  );
  const actualVersion = match?.[1] || null;
  assert.equal(
    actualVersion,
    expectedVersion,
    `Selected Chrome version mismatch: expected ${expectedVersion}, observed ${actualVersion || 'unrecognized'}.`,
  );
  return actualVersion;
}

export async function installSelectedProfileRecoveryBrowser({
  selection,
  cacheDir,
  installBrowser,
  probeVersion,
  publishEnvironment,
}) {
  assert.ok(
    selection,
    'A validated exact Chrome version selection is required.',
  );
  assert.equal(typeof cacheDir, 'string');
  assert.equal(typeof installBrowser, 'function');
  assert.equal(typeof probeVersion, 'function');
  assert.equal(typeof publishEnvironment, 'function');

  const installed = await installBrowser({
    browser: 'chrome',
    buildId: selection,
    cacheDir,
    platform: 'win64',
  });
  assert.equal(installed?.buildId, selection);
  assert.equal(typeof installed?.executablePath, 'string');
  const executablePath = installed.executablePath;
  const actualVersion = await probeVersion(executablePath);
  assert.match(
    actualVersion,
    EXACT_CHROME_VERSION,
    'Installed executable metadata did not contain an exact version.',
  );
  assert.equal(
    actualVersion,
    selection,
    `Installed Chrome version mismatch: expected ${selection}, observed ${actualVersion}.`,
  );
  await publishEnvironment({
    PUPPETEER_EXECUTABLE_PATH: executablePath,
    GEV_QA_PROFILE_RECOVERY_CHROME_VERSION: selection,
  });
  return { expectedVersion: selection, actualVersion, status: 'verified' };
}
