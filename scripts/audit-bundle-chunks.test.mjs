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
    await writeFile(path.join(root, 'voice-b.js'), 'export const b = true;');
    await writeFile(
      path.join(root, 'shared.js'),
      'export const shared = true;',
    );
    await writeFile(path.join(root, 'style.css'), 'body{}');
    await writeFile(
      path.join(root, '.vite/manifest.json'),
      JSON.stringify({
        'src/main.js': {
          file: 'index.js',
          isEntry: true,
          imports: ['src/assets.js'],
          dynamicImports: ['src/voice/realtime.js'],
        },
        'src/assets.js': { file: 'assets.js' },
        'src/voice/realtime.js': {
          file: 'voice-lazy.js',
          dynamicImports: ['src/voice/b.js'],
          imports: ['src/style.css'],
        },
        'src/voice/b.js': { file: 'voice-b.js', imports: ['src/shared.js'] },
        'src/shared.js': { file: 'shared.js' },
        'src/style.css': { file: 'style.css' },
      }),
    );
    await writeFile(
      path.join(root, 'diagnostic-chunk-modules.json'),
      JSON.stringify({
        chunks: [
          {
            file: 'voice-lazy.js',
            modules: { 'src/voice/realtime.js': { renderedLength: 27 } },
          },
        ],
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
      Buffer.byteLength('export const realtime = true;') +
        Buffer.byteLength('export const b = true;') +
        Buffer.byteLength('export const shared = true;'),
    );
    assert.ok(report.initial.gzipBytes > 0);
    assert.ok(report.initial.brotliBytes > 0);
    assert.deepEqual(
      report.dynamic.chunks.map((chunk) => chunk.file),
      ['shared.js', 'voice-b.js', 'voice-lazy.js'],
    );
    assert.deepEqual(report.dynamic.chunks[2].modules, [
      { id: 'src/voice/realtime.js', renderedBytes: 27 },
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('bundle audit fails closed when a manifest graph key is missing', async () => {
  const root = await mkdtemp(
    path.join(os.tmpdir(), 'gev-bundle-audit-missing-'),
  );
  try {
    await mkdir(path.join(root, '.vite'), { recursive: true });
    await writeFile(path.join(root, 'index.js'), 'export const app = true;');
    await writeFile(
      path.join(root, '.vite/manifest.json'),
      JSON.stringify({
        'src/main.js': {
          file: 'index.js',
          isEntry: true,
          imports: ['missing.js'],
        },
      }),
    );
    await assert.rejects(
      auditBundle({ root }),
      /manifest import key is missing/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
