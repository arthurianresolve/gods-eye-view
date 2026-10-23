// Browser-controlled native-adapter CORS reproduction. No live provider access.
// node <this-file> <immutable-checkout> <new-output-directory>
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';

const root = path.resolve(process.argv[2]);
const output = path.resolve(process.argv[3]);
fs.mkdirSync(output, { recursive: true });
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const requireFromRoot = createRequire(path.join(root, 'package.json'));
const { build } = requireFromRoot('esbuild');
const {
  createAustinOperatingWorkloadFixture,
  createAustinOperatingFixtureDelivery,
} = await import(
  pathToFileURL(
    path.join(root, 'scripts/performance/austinOperatingWorkloadFixture.mjs'),
  )
);
const fixture = createAustinOperatingWorkloadFixture();
const delivery = createAustinOperatingFixtureDelivery(
  fixture,
  'http://127.0.0.1/',
);
const Cesium = requireFromRoot('cesium');
const { createAlprPresentation } = await import(
  pathToFileURL(path.join(root, 'src/layers/alpr/presentation.js'))
);
const { snapAlprBox } = await import(
  pathToFileURL(path.join(root, 'src/layers/alpr/records.js'))
);
const scene = {
  canvas: { clientWidth: 1440, clientHeight: 900 },
  drawingBufferWidth: 1440,
  drawingBufferHeight: 900,
  ellipsoid: Cesium.Ellipsoid.WGS84,
  globe: { ellipsoid: Cesium.Ellipsoid.WGS84 },
  mapProjection: new Cesium.GeographicProjection(Cesium.Ellipsoid.WGS84),
  mode: Cesium.SceneMode.SCENE3D,
};
const camera = new Cesium.Camera(scene);
const viewer = { scene, camera };
camera.setView({
  destination: Cesium.Cartesian3.fromDegrees(-97.7431, 30.2672, 12000),
  orientation: {
    heading: Cesium.Math.toRadians(20),
    pitch: Cesium.Math.toRadians(-45),
    roll: 0,
  },
});
const presentation = createAlprPresentation({
  state: { viewer, enabled: false, dataSource: { entities: { values: [] } } },
  services: { render: {}, context: {}, groundFloor: {} },
  source: {},
});
const queryBox = snapAlprBox(presentation.viewportBox(viewer));
const requests = [];
let pageOrigin;
const assetServer = http.createServer(async (req, res) => {
  try {
    const requestUrl = new URL(req.url, 'http://127.0.0.1/');
    const mode = requestUrl.searchParams.get('auditMode');
    if (!['original', 'corrected'].includes(mode))
      throw new Error('Unknown mode');
    const originalUrl = `https://tiles.dontgetflocked.com${requestUrl.pathname}`;
    const response = await delivery.respond(originalUrl, {
      method: req.method,
    });
    if (!response) throw new Error('Undeclared fixture request');
    const headers = {
      'content-type': response.contentType,
      'cache-control': 'no-store',
      ...response.headers,
    };
    if (mode === 'corrected')
      headers['access-control-allow-origin'] = pageOrigin;
    requests.push({
      mode,
      pathname: requestUrl.pathname,
      status: response.status,
      byteLength: response.body.length,
      sha256: hash(response.body),
      corsHeader: headers['access-control-allow-origin'] || null,
    });
    res.writeHead(response.status, headers);
    res.end(response.body);
  } catch (error) {
    requests.push({
      rejected: true,
      path: req.url,
      message: String(error.message),
    });
    res.writeHead(500, { 'content-type': 'text/plain' });
    res.end(String(error.message));
  }
});
await new Promise((resolve) => assetServer.listen(0, '127.0.0.1', resolve));
const assetOrigin = `http://127.0.0.1:${assetServer.address().port}`;
const bundled = await build({
  entryPoints: [path.join(root, 'src/layers/alpr/source.js')],
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'browser',
});
const nativeBundle = bundled.outputFiles[0].contents;
const html = `<!doctype html><meta charset="utf-8"><title>Austin ALPR CORS control</title>
<h1>Austin ALPR CORS control</h1><p>Native adapter, pinned bytes, two loopback origins. No GPU or full-scene claim.</p>
<button id="run">Run four controls</button><pre id="result">Ready</pre>
<script type="module">
import { createAlprTileSource } from '/native.js';
document.querySelector('#run').onclick = async () => {
  document.querySelector('#run').disabled = true;
  const cases = [];
  for (const mode of ['original', 'corrected', 'original', 'corrected']) {
    const source = createAlprTileSource({ tileFetchImpl: (href, options) => {
      const u = new URL(href);
      if (u.origin !== 'https://tiles.dontgetflocked.com') throw new Error('Unexpected origin');
      return fetch(${JSON.stringify(assetOrigin)} + u.pathname + '?auditMode=' + mode, options);
    }});
    try {
      const value = await source.fetch(${JSON.stringify(queryBox)});
      cases.push({mode,status:'fulfilled',count:value.records.length,zoom:value.zoom,saturated:value.saturated});
    } catch (error) { cases.push({mode,status:'rejected',error:error.message,cause:error.cause?.message || null}); }
    finally { source.destroy(); }
    document.querySelector('#result').textContent = JSON.stringify(cases,null,2);
  }
  const result = {userAgent:navigator.userAgent,cases};
  const saved = await fetch('/result',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(result)});
  document.querySelector('#result').textContent = JSON.stringify({...result,saved:saved.ok},null,2);
};
</script>`;
const pageServer = http.createServer(async (req, res) => {
  if (req.url === '/native.js') {
    res.writeHead(200, { 'content-type': 'text/javascript' });
    return res.end(nativeBundle);
  }
  if (req.url === '/' && req.method === 'GET') {
    res.writeHead(200, { 'content-type': 'text/html' });
    return res.end(html);
  }
  if (req.url === '/result' && req.method === 'POST') {
    let body = '';
    for await (const chunk of req) {
      body += chunk;
      if (body.length > 16384) {
        res.writeHead(413);
        return res.end();
      }
    }
    const browserResult = JSON.parse(body);
    const report = {
      schema: 'gev-alpr-cors-browser-control/v1',
      scope:
        'Native adapter with unchanged pinned fixture responses; loopback origin remapping; not CDP delivery or full application validation',
      capturedAt: new Date().toISOString(),
      applicationCommit: execFileSync('git', ['rev-parse', 'HEAD'], {
        cwd: root,
        encoding: 'utf8',
      }).trim(),
      fixtureSha256: fixture.sha256,
      bundleSha256: hash(nativeBundle),
      queryBox,
      inputHashes: Object.fromEntries(
        [
          'src/layers/alpr/source.js',
          'src/sources/vectorTiles.js',
          'scripts/performance/austinOperatingWorkloadFixture.mjs',
        ].map((p) => [p, hash(fs.readFileSync(path.join(root, p)))]),
      ),
      browserResult,
      requests,
    };
    fs.writeFileSync(
      path.join(output, 'alpr-cors-browser-control.json'),
      JSON.stringify(report, null, 2) + '\n',
      { flag: 'wx' },
    );
    res.writeHead(200);
    return res.end('saved');
  }
  res.writeHead(404);
  res.end();
});
await new Promise((resolve) => pageServer.listen(0, '127.0.0.1', resolve));
pageOrigin = `http://127.0.0.1:${pageServer.address().port}`;
console.log(JSON.stringify({ pageUrl: pageOrigin, assetOrigin, output }));
const retire = () => {
  delivery.dispose();
  assetServer.close();
  pageServer.close();
};
process.on('SIGINT', retire);
process.on('SIGTERM', retire);
