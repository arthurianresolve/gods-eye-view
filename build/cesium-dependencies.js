import { realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

/** Capability tables belong to an engine module instance, not its version. */
export function assertCesiumDependencyIdentity(root) {
  const fromRoot = createRequire(path.resolve(root, 'package.json'));
  const packageFile = (resolveFrom, name) =>
    realpathSync(resolveFrom.resolve(`${name}/package.json`));
  let engines;
  try {
    const cesium = createRequire(packageFile(fromRoot, 'cesium'));
    const widgets = createRequire(packageFile(cesium, '@cesium/widgets'));
    const rootWidgets = createRequire(packageFile(fromRoot, '@cesium/widgets'));
    engines = [
      ['application', fromRoot],
      ['cesium', cesium],
      ['cesium widgets', widgets],
      ['application widgets', rootWidgets],
    ].map(([owner, resolveFrom]) => ({
      owner,
      path: packageFile(resolveFrom, '@cesium/engine'),
    }));
  } catch (cause) {
    throw new Error(
      'Cannot verify the Cesium dependency graph. Install the locked dependencies with npm ci in a checkout with its own node_modules directory.',
      { cause },
    );
  }
  if (new Set(engines.map((engine) => engine.path)).size !== 1) {
    throw new Error(
      'Multiple Cesium engine instances resolve from this checkout. This can leave rendering capability limits at zero. Use a clean checkout with its own node_modules and run npm ci; do not install through a shared node_modules junction.\n' +
        engines.map(({ owner, path: file }) => `${owner}: ${file}`).join('\n'),
    );
  }
  return engines;
}

/** Fail before Vite starts serving or bundling an inconsistent engine graph. */
export function cesiumDependencyIdentityPlugin() {
  return {
    name: 'gev-cesium-dependency-identity',
    configResolved(config) {
      assertCesiumDependencyIdentity(config.root);
    },
  };
}
