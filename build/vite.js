import { applicationHtmlPlugin } from './application-html.js';
import cesium from 'vite-plugin-cesium';
import { DEFAULT_ALLOWED_HOSTS, hostCheckPlugin } from './allowedHosts.js';
import { embedFramingPlugin } from './embed-framing.js';
import { panelBuildPlugin } from './panel.js';
import { cesiumDependencyIdentityPlugin } from './cesium-dependencies.js';
import { BROWSER_HEADERS } from './securityHeaders.js';
import {
  assetDistributionPlugin,
  computeCesiumDistributionDigestSync,
} from './assetDistribution.js';

/**
 * Content-Security-Policy for every document the dev/preview server serves.
 * No inline script is permitted, and the only foreign script origins are the
 * three that the Bhote Koshi event's embedded media needs (YouTube, Facebook
 * and X), which frame-src matches for their players and posts. 'unsafe-eval' is
 * required: Knockout (bundled inside @cesium/widgets) resolves the global
 * object with `(0, eval)("this")` at module load, and without it the Cesium
 * widget never initializes (verified in headless Chrome). It also covers
 * Cesium's WASM decoders. `blob:` is required in the built app: Cesium's
 * bundled workers bootstrap through `importScripts(blob:...)`, which a worker
 * checks against script-src (the dev server loads them by URL instead).
 * Widen any other directive only for a real violation.
 */
export const BROWSER_CSP = BROWSER_HEADERS['Content-Security-Policy'];

/** API routes return data, not documents, including on direct navigation. */
export const API_CSP = "default-src 'none'; sandbox";

export const API_HEADERS = Object.freeze({
  'Content-Security-Policy': API_CSP,
  'X-Content-Type-Options': 'nosniff',
});

/** Match the same /api mount spellings the router may accept. */
function isApiPath(url) {
  const raw = String(url || '/');
  const target = raw
    .trim()
    .split(/[?#]/, 1)[0]
    .replace(/\\/g, '/')
    .replace(/^[a-z][a-z0-9+.-]*:(?:\/\/[^/]*)?/i, '');
  let parsed = '';
  try {
    parsed = new URL(raw, 'http://localhost').pathname;
  } catch {
    /* The unparsed paths still decide. */
  }
  return [raw.split(/[?#]/, 1)[0], target, parsed].some((path) =>
    /^\/api(?:$|[/.])/i.test(path),
  );
}

/**
 * Vite plugin that sets API_HEADERS on every API response before any other
 * middleware runs, so success, error, partial, refused and unknown-route
 * answers all carry them. Vite's `server.headers` and `preview.headers` only
 * reach the documents and assets Vite serves itself. A route may still add
 * headers; a route's own Content-Security-Policy is sent as an additional
 * policy, which can only restrict further, never replace this one.
 */
export function apiResponseHeadersPlugin() {
  const install = (server) => {
    server.middlewares.use((req, res, next) => {
      if (!isApiPath(req.url)) return next();
      for (const [name, value] of Object.entries(API_HEADERS))
        res.setHeader(name, value);
      const setHeader = res.setHeader.bind(res);
      res.setHeader = (name, value) =>
        String(name).toLowerCase() === 'content-security-policy' &&
        String(value) !== API_CSP
          ? setHeader(name, `${API_CSP}, ${value}`)
          : setHeader(name, value);
      next();
    });
  };
  return {
    name: 'api-response-headers',
    enforce: 'pre',
    configureServer: install,
    configurePreviewServer: install,
  };
}

/** Build browser assets with explicit inputs; never load environment or providers. */
export function createBrowserViteConfig({
  plugins = [],
  publicDir,
  googleApiKey,
  cesiumToken,
  mapillaryToken,
  appCommit,
  host = 'localhost',
  port = 4173,
  allowedHosts = DEFAULT_ALLOWED_HOSTS,
  command,
  root = process.cwd(),
} = {}) {
  let cesiumBaseUrl = '/cesium/';
  let cesiumDigest = null;
  if (command === 'build') {
    try {
      cesiumDigest = computeCesiumDistributionDigestSync({ root });
      cesiumBaseUrl = `/${cesiumDigest.path}/`;
    } catch (error) {
      throw new Error(
        'Cannot digest the patched Cesium distribution before build. Run npm ci and apply the pinned Cesium patches in this checkout.',
        { cause: error },
      );
    }
  }
  return {
    plugins: [
      // First, so every API response, including a Host refusal, carries them.
      apiResponseHeadersPlugin(),
      // Next, so no provider route answers a Host the server does not allow.
      hostCheckPlugin(),
      cesiumDependencyIdentityPlugin(),
      cesium({ cesiumBaseUrl }),
      applicationHtmlPlugin(),
      ...plugins,
      embedFramingPlugin(),
      panelBuildPlugin(),
      ...(command === 'build'
        ? [assetDistributionPlugin({ cesiumDigest: cesiumDigest.digest })]
        : []),
    ],
    ...(publicDir === undefined ? {} : { publicDir }),
    // A production build must not clean the dependency cache a running dev
    // server is still serving optimized module URLs from.
    ...(command === 'build' ? { cacheDir: 'node_modules/.vite-build' } : {}),
    optimizeDeps: {
      // First reached through the SDR worker or a dynamic import. Pre-bundle
      // them at startup so first use cannot invalidate already-transformed
      // URLs with Vite's "Outdated Optimize Dep" 504 response.
      include: [
        '@jtarrio/signals/demod/demodulator.js',
        '@jtarrio/signals/demod/modes.js',
        '@jtarrio/webrtlsdr/rtlsdr.js',
        'egm96-universal',
        // Loaded on demand when the first street-level image opens.
        'mapillary-js',
      ],
    },
    server: {
      host: host || 'localhost',
      port: parseInt(port, 10) || 4173,
      // A wildcard bind only chooses interfaces; it never disables Vite's
      // Host-header check. LAN hostnames are added explicitly (see
      // build/allowedHosts.js); IP addresses are always accepted.
      allowedHosts: [...allowedHosts],
      fs: {
        deny: ['.env', '.env.*', '*.{crt,pem}', '**/.git/**', '**/ENVIRONMENT'],
      },
      // These headers protect the document containing Provider Settings and
      // give the whole page a real Content-Security-Policy (BROWSER_CSP).
      // Embed-mode documents are framable instead: embed-framing.js rewrites
      // only the frame-ancestors directive and keeps the rest of the policy.
      headers: BROWSER_HEADERS,
    },
    // The preview server serves the same documents, so it carries the same
    // framing + CSP hardening (one constant, no drift).
    preview: {
      allowedHosts: [...allowedHosts],
      headers: BROWSER_HEADERS,
    },
    define: {
      'import.meta.env.GOOGLE_MAPS_API_KEY': JSON.stringify(googleApiKey),
      'import.meta.env.CESIUM_ION_TOKEN': JSON.stringify(cesiumToken),
      // Mapillary client tokens are public by design (see SECURITY.md).
      'import.meta.env.MAPILLARY_CLIENT_TOKEN': JSON.stringify(
        mapillaryToken ?? '',
      ),
      // A commit is diagnostic metadata only; never use it for authorization.
      // The harness can require this value to match the revision under test.
      __GEV_APP_COMMIT__: JSON.stringify(appCommit || null),
    },
    build: { chunkSizeWarningLimit: 1500 },
  };
}
