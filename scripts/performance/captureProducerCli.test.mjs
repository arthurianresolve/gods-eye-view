import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

test('Windows composition control requires paired diagnostics and headed hardware', () => {
  const diagnostic = '--windows-no-direct-composition-diagnostic';
  const required = [
    '--hardware-required',
    '--frame-trace-out',
    'frames.json',
    '--browser-trace-out',
    'browser.json',
  ];
  for (const args of [
    [diagnostic],
    [diagnostic, '--hardware-required'],
    [diagnostic, ...required, '--headless'],
    [diagnostic, ...required, '--software-rendering'],
    [diagnostic, ...required, '--hosted-fixture'],
    ...(process.platform === 'win32' ? [] : [[diagnostic, ...required]]),
  ]) {
    const result = spawnSync(
      process.execPath,
      [
        fileURLToPath(
          new URL('../capture-scene-performance.mjs', import.meta.url),
        ),
        ...args,
      ],
      {
        encoding: 'utf8',
        windowsHide: true,
        timeout: 30_000,
      },
    );
    assert.equal(result.error, undefined);
    assert.equal(result.status, 1);
    assert.match(
      result.stderr,
      /--windows-no-direct-composition-diagnostic (requires a headed hardware capture|is supported only on Windows)/,
    );
  }
});

test('framebuffer preservation diagnostic is isolated and requires paired hardware traces', () => {
  const diagnostic = '--framebuffer-preservation-diagnostic';
  for (const args of [
    [diagnostic],
    [diagnostic, '--hardware-required'],
    [
      diagnostic,
      '--hardware-required',
      '--frame-trace-out',
      'frames.json',
      '--browser-trace-out',
      'browser.json',
      '--headless',
    ],
    [
      diagnostic,
      '--hardware-required',
      '--frame-trace-out',
      'frames.json',
      '--browser-trace-out',
      'browser.json',
      '--native-rendering-diagnostic',
    ],
  ]) {
    const result = spawnSync(
      process.execPath,
      [
        fileURLToPath(
          new URL('../capture-scene-performance.mjs', import.meta.url),
        ),
        ...args,
      ],
      { encoding: 'utf8', windowsHide: true, timeout: 30_000 },
    );
    assert.equal(result.error, undefined);
    assert.equal(result.status, 1);
    assert.match(
      result.stderr,
      /--framebuffer-preservation-diagnostic requires a headed hardware capture with frame and browser traces|cannot be combined with another renderer diagnostic/,
    );
  }
});

test('capture CLI rejects either half of an explicit build-harness identity before launching a browser', () => {
  for (const args of [
    ['--build-harness-checkout', 'unused-builder-root'],
    ['--expected-build-harness-sha', 'b'.repeat(40)],
  ]) {
    const result = spawnSync(
      process.execPath,
      [
        fileURLToPath(
          new URL('../capture-scene-performance.mjs', import.meta.url),
        ),
        ...args,
      ],
      { encoding: 'utf8', windowsHide: true, timeout: 30_000 },
    );
    assert.equal(result.error, undefined);
    assert.equal(result.status, 1);
    assert.match(
      result.stderr,
      /--build-harness-checkout and --expected-build-harness-sha must be supplied together/,
    );
  }
});

test('startup-only CLI admits Austin identity through to native-evidence validation', () => {
  const common = [
    '--startup-only-shard',
    '--startup-shard-id',
    'austin-startup-control-01',
    '--startup-role',
    'control',
    '--out',
    'unused-startup-shard.json',
  ];
  const run = (providerFixture) =>
    spawnSync(
      process.execPath,
      [
        fileURLToPath(
          new URL('../capture-scene-performance.mjs', import.meta.url),
        ),
        ...common,
        '--provider-fixture',
        providerFixture,
      ],
      { encoding: 'utf8', windowsHide: true, timeout: 30_000 },
    );

  const austin = run('austin-operating-v1');
  assert.equal(austin.error, undefined);
  assert.equal(austin.status, 1);
  assert.match(
    austin.stderr,
    /requires verified, headed native hardware capture/,
  );

  const unsupported = run('infrastructure-cables');
  assert.equal(unsupported.error, undefined);
  assert.equal(unsupported.status, 1);
  assert.match(
    unsupported.stderr,
    /requires --provider-fixture infrastructure-dams or austin-operating-v1/,
  );
});

test('frame trace rejects missing or shared output paths before launching a browser', () => {
  for (const [args, message] of [
    [['--frame-trace-out'], /requires a separate diagnostic output path/],
    [
      ['--frame-trace-out', '--headless'],
      /requires a separate diagnostic output path/,
    ],
    [
      ['--out', 'same.json', '--frame-trace-out', './same.json'],
      /must differ from --out/,
    ],
  ]) {
    const result = spawnSync(
      process.execPath,
      [
        fileURLToPath(
          new URL('../capture-scene-performance.mjs', import.meta.url),
        ),
        ...args,
      ],
      { encoding: 'utf8', windowsHide: true, timeout: 30_000 },
    );
    assert.equal(result.error, undefined);
    assert.equal(result.status, 1);
    assert.match(result.stderr, message);
  }
});

test('browser trace requires the paired frame trace output before launching a browser', () => {
  const result = spawnSync(
    process.execPath,
    [
      fileURLToPath(
        new URL('../capture-scene-performance.mjs', import.meta.url),
      ),
      '--browser-trace-out',
      'browser-trace.json',
      '--headless',
    ],
    { encoding: 'utf8', windowsHide: true, timeout: 30_000 },
  );
  assert.equal(result.error, undefined);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /requires --frame-trace-out/);
});

test('browser trace rejects missing and colliding output paths before launch', () => {
  for (const [args, pattern] of [
    [['--browser-trace-out'], /requires a separate diagnostic output/],
    [
      ['--browser-trace-out', 'same.json', '--out', 'same.json'],
      /must differ from --out/,
    ],
    [
      ['--browser-trace-out', 'same.json', '--frame-trace-out', 'same.json'],
      /must differ from --frame-trace-out/,
    ],
  ]) {
    const result = spawnSync(
      process.execPath,
      [
        fileURLToPath(
          new URL('../capture-scene-performance.mjs', import.meta.url),
        ),
        ...args,
      ],
      { encoding: 'utf8', windowsHide: true, timeout: 30_000 },
    );
    assert.equal(result.error, undefined);
    assert.equal(result.status, 1);
    assert.match(result.stderr, pattern);
  }
});
