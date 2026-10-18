#!/usr/bin/env node
/**
 * Reproducible post-build audit for the voice/locale chunk experiment.
 *
 * Usage: node scripts/audit-bundle-chunks.mjs <dist-root> [manifest.json]
 * The input is Vite's generated manifest; no source checkout or Vite import is
 * required. Entries and their static imports are the measured initial graph;
 * dynamic imports are reported separately so a lazy split cannot be mistaken
 * for initial-load savings.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import { brotliCompressSync, gzipSync } from 'node:zlib';

export async function auditBundle({
  root,
  manifestPath = '.vite/manifest.json',
}) {
  const absoluteRoot = path.resolve(root);
  const manifestFile = path.resolve(absoluteRoot, manifestPath);
  const manifest = JSON.parse(await readFile(manifestFile, 'utf8'));
  const records = Object.entries(manifest).sort(([a], [b]) =>
    a.localeCompare(b),
  );
  const byKey = new Map(
    records.map(([key, value]) => [key, { key, ...value }]),
  );
  const entries = records.filter(([, value]) => value.isEntry);
  const initial = new Set();
  const dynamic = new Set();
  const visit = (record, target) => {
    if (!record || target.has(record.file)) return;
    target.add(record.file);
    for (const imported of record.imports || []) {
      const child = byKey.get(imported);
      if (!child)
        throw new Error(`manifest import key is missing: ${imported}`);
      visit(child, target);
    }
  };
  for (const [, entry] of entries) {
    visit(entry, initial);
    for (const imported of entry.dynamicImports || []) {
      const child = byKey.get(imported);
      if (!child)
        throw new Error(`manifest dynamic import key is missing: ${imported}`);
      visit(child, dynamic);
    }
  }
  for (const file of initial) dynamic.delete(file);
  async function describe(file) {
    const bytes = await readFile(path.join(absoluteRoot, file));
    const record = records
      .map(([, value]) => value)
      .find((value) => value.file === file);
    const modules = Object.entries(record?.modules || {})
      .map(([id, value]) => ({
        id,
        renderedBytes:
          typeof value === 'number'
            ? value
            : (value?.renderedBytes ?? value?.renderedLength ?? null),
      }))
      .sort((a, b) => a.id.localeCompare(b.id));
    return {
      file,
      bytes: bytes.byteLength,
      modules,
    };
  }
  const [initialChunks, dynamicChunks] = await Promise.all([
    Promise.all([...initial].sort().map(describe)),
    Promise.all([...dynamic].sort().map(describe)),
  ]);
  const sum = (chunks) =>
    chunks.reduce((total, chunk) => total + chunk.bytes, 0);
  return {
    manifest: path
      .relative(absoluteRoot, manifestFile)
      .replaceAll(path.sep, '/'),
    entries: entries
      .map(([key, value]) => ({ key, file: value.file }))
      .sort((a, b) => a.key.localeCompare(b.key)),
    initial: {
      bytes: sum(initialChunks),
      gzipBytes: await compressedSize(initialChunks, absoluteRoot, gzipSync),
      brotliBytes: await compressedSize(
        initialChunks,
        absoluteRoot,
        brotliCompressSync,
      ),
      chunks: initialChunks,
    },
    dynamic: { bytes: sum(dynamicChunks), chunks: dynamicChunks },
    attribution:
      'module rendered lengths are reported only when supplied by diagnostic Vite manifest metadata; no source-text attribution is inferred',
    scope:
      'emitted JavaScript bytes only; static entry imports are initial, all dynamic descendants are separate; CSS/assets excluded',
  };
}

async function compressedSize(chunks, root, compressor) {
  const bodies = await Promise.all(
    chunks.map((chunk) => readFile(path.join(root, chunk.file))),
  );
  return compressor(Buffer.concat(bodies)).byteLength;
}

if (
  import.meta.url === pathToFileURL(path.resolve(process.argv[1] || '')).href
) {
  const [root, manifestPath] = process.argv.slice(2);
  if (!root) {
    console.error('usage: audit-bundle-chunks.mjs <dist-root> [manifest.json]');
    process.exitCode = 2;
  } else {
    try {
      console.log(
        JSON.stringify(await auditBundle({ root, manifestPath }), null, 2),
      );
    } catch (error) {
      console.error(`bundle audit failed: ${error.message}`);
      process.exitCode = 1;
    }
  }
}
