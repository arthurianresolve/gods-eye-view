#!/usr/bin/env node
/** Build an isolated Vite output with diagnostic Rollup module lengths, then audit it. */
import { build } from 'vite';
import { createBrowserViteConfig } from '../build/vite.js';
import { auditBundle } from './audit-bundle-chunks.mjs';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

export function diagnosticChunkMetadataPlugin() {
  return {
    name: 'gev-diagnostic-chunk-metadata',
    generateBundle(_options, bundle) {
      const chunks = Object.values(bundle)
        .filter((item) => item.type === 'chunk')
        .sort((a, b) => a.fileName.localeCompare(b.fileName))
        .map((chunk) => ({
          file: chunk.fileName,
          modules: Object.fromEntries(
            Object.entries(chunk.modules)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([id, info]) => [
                id,
                { renderedLength: info.renderedLength },
              ]),
          ),
        }));
      this.emitFile({
        type: 'asset',
        fileName: 'diagnostic-chunk-modules.json',
        source: JSON.stringify({ chunks }, null, 2),
      });
    },
  };
}

export async function buildAndAudit({ root, outDir }) {
  const outputRoot = path.resolve(root, outDir);
  const absoluteRoot = path.resolve(root);
  const qaRoot = path.resolve(absoluteRoot, 'qa-artifacts');
  if (outputRoot !== qaRoot && !outputRoot.startsWith(`${qaRoot}${path.sep}`))
    throw new Error('audit output must remain under qa-artifacts');
  try {
    if ((await readdir(outputRoot)).length)
      throw new Error(
        `audit output must be a fresh empty directory: ${outputRoot}`,
      );
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const config = createBrowserViteConfig({
    root: absoluteRoot,
    command: 'build',
  });
  await build({
    ...config,
    root: absoluteRoot,
    configFile: false,
    envFile: false,
    plugins: [...(config.plugins || []), diagnosticChunkMetadataPlugin()],
    build: {
      ...config.build,
      manifest: 'manifest.json',
      outDir: outputRoot,
      emptyOutDir: true,
    },
  });
  return auditBundle({ root: outputRoot, manifestPath: 'manifest.json' });
}

if (
  import.meta.url === pathToFileURL(path.resolve(process.argv[1] || '')).href
) {
  const [root = process.cwd(), outDir = 'qa-artifacts/bundle-audit-dist'] =
    process.argv.slice(2);
  try {
    console.log(JSON.stringify(await buildAndAudit({ root, outDir }), null, 2));
  } catch (error) {
    console.error(`bundle diagnostic build failed: ${error.message}`);
    process.exitCode = 1;
  }
}
