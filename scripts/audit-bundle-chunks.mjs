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

const VOICE_OR_LOCALE = /(?:voice|realtime|i18n[\\/]|locales[\\/](?:es|ru))/i;

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
  const byFile = new Map(
    records.map(([key, value]) => [value.file, { key, ...value }]),
  );
  const entries = records.filter(([, value]) => value.isEntry);
  const initial = new Set();
  const dynamic = new Set();
  const visit = (record, target) => {
    if (!record || target.has(record.file)) return;
    target.add(record.file);
    for (const imported of record.imports || [])
      visit(byFile.get(imported), target);
  };
  for (const [, entry] of entries) {
    visit(entry, initial);
    for (const imported of entry.dynamicImports || [])
      visit(byFile.get(imported), dynamic);
  }
  for (const file of initial) dynamic.delete(file);
  async function describe(file) {
    const bytes = await readFile(path.join(absoluteRoot, file));
    return {
      file,
      bytes: bytes.byteLength,
      voiceOrLocale:
        VOICE_OR_LOCALE.test(file) ||
        VOICE_OR_LOCALE.test(bytes.toString('utf8')),
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
    initial: { bytes: sum(initialChunks), chunks: initialChunks },
    dynamic: { bytes: sum(dynamicChunks), chunks: dynamicChunks },
    scope:
      'uncompressed emitted JavaScript bytes; static entry imports are initial, dynamic imports are separate; CSS/assets excluded',
  };
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
