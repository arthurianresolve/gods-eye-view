import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { auditBundle } from './audit-bundle-chunks.mjs';

test('bundle audit separates static initial imports from dynamic voice/locale chunks', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'gev-bundle-audit-'));
  try {
    await mkdir(path.join(root, '.vite'), { recursive: true });
    await writeFile(path.join(root, 'index.js'), 'import "./assets.js";');
    await writeFile(path.join(root, 'assets.js'), 'export const app = true;');
    await writeFile(
      path.join(root, 'voice-lazy.js'),
      'export const realtime = true;',
    );
    await writeFile(
      path.join(root, '.vite/manifest.json'),
      JSON.stringify({
        'src/main.js': {
          file: 'index.js',
          isEntry: true,
          imports: ['assets.js'],
          dynamicImports: ['voice-lazy.js'],
        },
        'src/assets.js': { file: 'assets.js' },
        'src/voice/realtime.js': { file: 'voice-lazy.js' },
      }),
    );
    const report = await auditBundle({ root });
    assert.equal(
      report.initial.bytes,
      Buffer.byteLength('import "./assets.js";') +
        Buffer.byteLength('export const app = true;'),
    );
    assert.equal(
      report.dynamic.bytes,
      Buffer.byteLength('export const realtime = true;'),
    );
    assert.equal(
      report.initial.chunks.some((chunk) => chunk.voiceOrLocale),
      false,
    );
    assert.equal(
      report.dynamic.chunks.some((chunk) => chunk.voiceOrLocale),
      true,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
