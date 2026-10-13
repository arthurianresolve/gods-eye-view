import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = path.join(ROOT, 'scripts', 'capture-scene-performance.mjs');

function invoke(args, { loaderPath = null } = {}) {
  return spawnSync(
    process.execPath,
    [
      ...(loaderPath
        ? ['--experimental-loader', pathToFileURL(loaderPath).href]
        : []),
      SCRIPT,
      ...args,
    ],
    {
      cwd: ROOT,
      encoding: 'utf8',
      timeout: 15_000,
      windowsHide: true,
    },
  );
}

async function withForbiddenCesiumLoader(run) {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), 'gev-capture-no-cesium-'),
  );
  const loaderPath = path.join(directory, 'forbid-cesium-loader.mjs');
  await fs.writeFile(
    loaderPath,
    `export async function resolve(specifier, context, nextResolve) {
      if (specifier === 'cesium') throw new Error('forbidden Cesium import witness');
      return nextResolve(specifier, context);
    }\n`,
  );
  try {
    return await run(loaderPath);
  } finally {
    const resolvedDirectory = path.resolve(directory);
    assert.ok(
      resolvedDirectory.startsWith(path.resolve(os.tmpdir()) + path.sep),
      'temporary loader directory must remain inside the OS temp directory',
    );
    await fs.rm(resolvedDirectory, { recursive: true, force: true });
  }
}

function verifiedFixtureArgs() {
  return [
    '--build-receipt',
    path.join(ROOT, 'package.json'),
    '--app-checkout',
    ROOT,
    '--harness-checkout',
    ROOT,
    '--build-root',
    ROOT,
    '--expected-app-sha',
    'a'.repeat(40),
    '--expected-harness-sha',
    'b'.repeat(40),
    '--served-base-url',
    'http://127.0.0.1:4173',
  ];
}

test('capture CLI recognizes an infrastructure workload before browser startup', () => {
  const result = invoke([
    '--provider-fixture',
    'infrastructure-datacenters',
    '--provider-fixture-time',
    '2026-10-08T12:00:00.000Z',
  ]);
  assert.notEqual(result.status, 0);
  assert.match(
    result.stderr,
    /Comparison fixtures require verified build provenance/,
  );
  assert.doesNotMatch(result.stderr, /Unsupported infrastructure workload/);
  assert.doesNotMatch(
    result.stderr,
    /Browser was not found|Could not find Chrome/,
  );
});

test('capture CLI rejects unsupported infrastructure names and mixed populations', () => {
  const unsupported = invoke(['--provider-fixture', 'infrastructure-unknown']);
  assert.notEqual(unsupported.status, 0);
  assert.match(unsupported.stderr, /Unsupported infrastructure workload/);

  const mixed = invoke([
    '--provider-fixture',
    'infrastructure-dams',
    '--mixed-layers',
  ]);
  assert.notEqual(mixed.status, 0);
  assert.match(mixed.stderr, /cannot use aircraft or --mixed-layers/);
});

test('invalid infrastructure CLI requests reject before importing Cesium', async () => {
  await withForbiddenCesiumLoader((loaderPath) => {
    const unsupported = invoke(
      ['--provider-fixture', 'infrastructure-unknown'],
      { loaderPath },
    );
    assert.equal(unsupported.status, 1, unsupported.stderr);
    assert.match(
      unsupported.stderr,
      /Unsupported infrastructure workload: infrastructure-unknown/,
    );
    assert.doesNotMatch(unsupported.stderr, /forbidden Cesium import witness/);

    const missingProvenance = invoke(
      ['--provider-fixture', 'infrastructure-datacenters'],
      { loaderPath },
    );
    assert.equal(missingProvenance.status, 1, missingProvenance.stderr);
    assert.match(
      missingProvenance.stderr,
      /Comparison fixtures require verified build provenance options/,
    );
    assert.doesNotMatch(
      missingProvenance.stderr,
      /forbidden Cesium import witness/,
    );

    const partialProvenance = invoke(
      [
        '--provider-fixture',
        'infrastructure-datacenters',
        '--build-receipt',
        path.join(ROOT, 'package.json'),
      ],
      { loaderPath },
    );
    assert.equal(partialProvenance.status, 1, partialProvenance.stderr);
    assert.match(
      partialProvenance.stderr,
      /Verified capture requires .* together/,
    );
    assert.doesNotMatch(
      partialProvenance.stderr,
      /forbidden Cesium import witness/,
    );

    const currentHarnessSha = execFileSync(
      'git',
      ['-C', ROOT, 'rev-parse', 'HEAD'],
      { encoding: 'utf8' },
    ).trim();
    const invalidReceipt = invoke(
      [
        '--provider-fixture',
        'infrastructure-datacenters',
        '--build-receipt',
        path.join(ROOT, 'package.json'),
        '--app-checkout',
        ROOT,
        '--harness-checkout',
        ROOT,
        '--build-root',
        ROOT,
        '--expected-app-sha',
        'a'.repeat(40),
        '--expected-harness-sha',
        currentHarnessSha,
        '--served-base-url',
        'http://127.0.0.1:4173',
      ],
      { loaderPath },
    );
    assert.equal(invalidReceipt.status, 1, invalidReceipt.stderr);
    assert.match(invalidReceipt.stderr, /AssertionError/);
    assert.doesNotMatch(
      invalidReceipt.stderr,
      /forbidden Cesium import witness/,
    );

    const incompatiblePopulation = invoke(
      ['--provider-fixture', 'infrastructure-dams', '--mixed-layers'],
      { loaderPath },
    );
    assert.equal(
      incompatiblePopulation.status,
      1,
      incompatiblePopulation.stderr,
    );
    assert.match(
      incompatiblePopulation.stderr,
      /cannot use aircraft or --mixed-layers/,
    );
    assert.doesNotMatch(
      incompatiblePopulation.stderr,
      /forbidden Cesium import witness/,
    );
  });
});

test('first-motion profiling rejects unsupported workload before browser startup', () => {
  const wrongFixture = invoke([
    ...verifiedFixtureArgs(),
    '--provider-fixture',
    'infrastructure-datacenters',
    '--first-motion-cpu-profile',
    '--cpu-profile-artifact-directory',
    'unused-profile-output',
  ]);
  assert.notEqual(wrongFixture.status, 0);
  assert.match(
    wrongFixture.stderr,
    /requires --provider-fixture dense-investigation/,
  );
  assert.doesNotMatch(
    wrongFixture.stderr,
    /Browser was not found|Could not find Chrome/,
  );

  const missingDirectory = invoke([
    ...verifiedFixtureArgs(),
    '--provider-fixture',
    'dense-investigation',
    '--mixed-layers',
    '--first-motion-cpu-profile',
  ]);
  assert.notEqual(missingDirectory.status, 0);
  assert.match(
    missingDirectory.stderr,
    /requires --cpu-profile-artifact-directory/,
  );
  assert.doesNotMatch(
    missingDirectory.stderr,
    /Browser was not found|Could not find Chrome/,
  );
});

test('shader program attribution is opt-in only for the dense capture fixture', () => {
  const missingFixture = invoke([
    ...verifiedFixtureArgs(),
    '--shader-program-attribution',
  ]);
  assert.notEqual(missingFixture.status, 0);
  assert.match(
    missingFixture.stderr,
    /requires --provider-fixture dense-investigation/,
  );
  assert.doesNotMatch(
    missingFixture.stderr,
    /Browser was not found|Could not find Chrome/,
  );

  const wrongFixture = invoke([
    ...verifiedFixtureArgs(),
    '--provider-fixture',
    'infrastructure-datacenters',
    '--shader-program-attribution',
  ]);
  assert.notEqual(wrongFixture.status, 0);
  assert.match(
    wrongFixture.stderr,
    /requires --provider-fixture dense-investigation/,
  );
  assert.doesNotMatch(
    wrongFixture.stderr,
    /Browser was not found|Could not find Chrome/,
  );
});
