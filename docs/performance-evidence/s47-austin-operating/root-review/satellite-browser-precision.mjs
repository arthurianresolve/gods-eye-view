// Visible Chrome control, using local pinned data and native production modules.
// node <this-file> <immutable-checkout> <new-output-directory>
import assert from 'node:assert/strict';
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
const Cesium = requireFromRoot('cesium');
const orbital = requireFromRoot('satellite.js');
const { parseTleText, decodeTleCatalogNumber } = await import(
  pathToFileURL(path.join(root, 'src/sources/tle.js'))
);
const { CATALOG_GROUPS } = await import(
  pathToFileURL(path.join(root, 'src/layers/satellites/policy.js'))
);
const { installPhasedMonotonicWallClock } = await import(
  pathToFileURL(
    path.join(root, 'scripts/performance/productionFlightFixture.mjs'),
  )
);
const paths = [
  'src/layers/satellites/rendering.js',
  'src/layers/satellites/controls.js',
  'src/layers/satellites/orbits.js',
  'src/layers/satellites/policy.js',
  'src/sources/tle.js',
  'scripts/performance/productionFlightFixture.mjs',
  'package-lock.json',
  ...CATALOG_GROUPS.map(
    (group) => `src/data/fixtures/austin-operating-v1/tle/${group.path}.tle`,
  ),
];
const sourceSha256 = Object.fromEntries(
  paths.map((file) => [file, hash(fs.readFileSync(path.join(root, file)))]),
);
const catalogs = CATALOG_GROUPS.map((group) => ({
  ...group,
  text: fs.readFileSync(
    path.join(
      root,
      `src/data/fixtures/austin-operating-v1/tle/${group.path}.tle`,
    ),
    'utf8',
  ),
}));
const commit = execFileSync('git', ['rev-parse', 'HEAD'], {
  cwd: root,
  encoding: 'utf8',
}).trim();
const fixed = Date.parse('2026-10-12T18:00:00Z');
const reference = new Map();
for (const group of catalogs)
  for (const row of parseTleText(group.text)) {
    const satrec = orbital.twoline2satrec(row.line1, row.line2);
    const id = decodeTleCatalogNumber(satrec.satnum);
    if (id !== null && satrec.error === 0 && !reference.has(id))
      reference.set(id, satrec);
  }
assert.equal(reference.size, 828);
function expectedPosition(id, epochMs) {
  const date = new Date(epochMs);
  const result = orbital.propagate(reference.get(id), date);
  assert.ok(result.position && typeof result.position === 'object');
  const geo = orbital.eciToGeodetic(result.position, orbital.gstime(date));
  return Cesium.Cartesian3.fromDegrees(
    orbital.degreesLong(geo.longitude),
    orbital.degreesLat(geo.latitude),
    geo.height * 1000,
  );
}
const toCartesian = (row) =>
  Cesium.Cartesian3.fromDegrees(row.longitude, row.latitude, row.altitudeM);
function validateCase(row) {
  assert.ok([16, 33, 120].includes(row.frameStepMs));
  assert.ok(['warmup-held', 'complete'].includes(row.boundary));
  assert.equal(
    row.boundaryEpochMs,
    fixed + (row.boundary === 'warmup-held' ? 30000 : 90000),
  );
  assert.equal(row.records.length, 828);
  assert.equal(new Set(row.records.map((record) => record.id)).size, 828);
  for (const record of row.records) {
    assert.ok(reference.has(record.id));
    assert.ok(
      [record.longitude, record.latitude, record.altitudeM].every(
        Number.isFinite,
      ),
    );
  }
  const iss = row.records.find((record) => record.id === 25544);
  const witness = toCartesian(iss);
  const epochs = [];
  for (
    let epoch = row.boundaryEpochMs - 1000;
    epoch <= row.boundaryEpochMs;
    epoch++
  ) {
    if (
      Cesium.Cartesian3.distance(witness, expectedPosition(25544, epoch)) <=
      0.001
    )
      epochs.push(epoch);
  }
  assert.equal(epochs.length, 1);
  let maximumResidualMeters = 0;
  for (const record of row.records) {
    const residual = Cesium.Cartesian3.distance(
      toCartesian(record),
      expectedPosition(record.id, epochs[0]),
    );
    assert.ok(Number.isFinite(residual) && residual <= 0.001);
    maximumResidualMeters = Math.max(maximumResidualMeters, residual);
  }
  return {
    frameStepMs: row.frameStepMs,
    boundary: row.boundary,
    boundaryEpochMs: row.boundaryEpochMs,
    derivedEpochMs: epochs[0],
    ageMs: row.boundaryEpochMs - epochs[0],
    matchedCount: 828,
    maximumResidualMeters,
    rawPositionSha256: hash(JSON.stringify(row.records)),
  };
}
const entry = `
import * as Cesium from 'cesium';
import {twoline2satrec} from 'satellite.js';
import {createRendering} from './src/layers/satellites/rendering.js';
import {createControls} from './src/layers/satellites/controls.js';
import {createOrbits} from './src/layers/satellites/orbits.js';
import {parseTleText, decodeTleCatalogNumber} from './src/sources/tle.js';
const installPhasedMonotonicWallClock = ${installPhasedMonotonicWallClock.toString()};
const NativeDate=Date;
const fixed=${fixed};
document.querySelector('#run').onclick=async()=>{
 const button=document.querySelector('#run');button.disabled=true;
 const status=document.querySelector('#status');status.textContent='Running native cached-position controls...';
 try {
  const groups=await fetch('/catalogs.json').then(response=>response.json());
  const cases=[];
  for(const frameStepMs of [16,33,120]) {
   let monotonicMs=0;
   const target={Date:NativeDate,performance:{now:()=>monotonicMs}};
   installPhasedMonotonicWallClock(fixed,30000,60000,target);
   const clock=target.__gevPhasedMonotonicWallClockV1;
   const catalog=new Map();
   for(const group of groups)for(const row of parseTleText(group.text)){
    const satrec=twoline2satrec(row.line1,row.line2),id=decodeTleCatalogNumber(satrec.satnum);
    if(id!==null && satrec.error===0 && !catalog.has(id))catalog.set(id,{name:row.name,group:group.tag,satrec});
   }
   const pointCollection=new Cesium.PointPrimitiveCollection();
   const state={_enabled:true,_params:{showPoints:true,showOrbits:false},_trackedNorad:null,_lastPropagation:fixed,_lastFocusUpdate:0,_activeFocusCount:0,_denseIds:[],_catalog:catalog,_points:new Map(),_scratchPropagationCartesian:new Cesium.Cartesian3()};
   const orbits=createOrbits({state,services:{},parts:{},source:{}});
   for(const[id,record]of catalog){
    const position=orbits.propagatePosition(record.satrec,new NativeDate(fixed));
    if(!position)throw new Error('Initial native position unavailable');
    const point=pointCollection.add({id,position:Cesium.Cartesian3.fromDegrees(position.longitude,position.latitude,position.altitude)});
    state._points.set(id,point);
   }
   const rendering=createRendering({state,services:{focus:{focusNowMs:value=>value,getFocusTarget:()=>null,focusPassIsNeeded:()=>false}},parts:{catalog:{_propagateDenseChunk(){}},orbits}});
   const controls=createControls({state,services:{layerState:{}},parts:{},source:{}});
   const advance=duration=>{
    const end=monotonicMs+duration;
    while(monotonicMs+frameStepMs<end){monotonicMs+=frameStepMs;rendering._preRenderTick();}
    monotonicMs=end;rendering._preRenderTick();
   };
   const snapshot=boundary=>cases.push({frameStepMs,boundary,boundaryEpochMs:target.Date.now(),records:controls.methods.getAllPositions(1000).map(({id,longitude,latitude,altitudeM})=>({id,longitude,latitude,altitudeM}))});
   try {
    window.Date=target.Date;
    clock.startWarmup(1);advance(30000);clock.holdWarmupBoundary(1);rendering._preRenderTick();snapshot('warmup-held');
    clock.startMeasurement(1);advance(60000);clock.finishMeasurement(1);rendering._preRenderTick();snapshot('complete');
   }finally{window.Date=NativeDate;pointCollection.destroy();}
  }
  const response=await fetch('/result',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({userAgent:navigator.userAgent,cases})});
  const result=await response.json();if(!response.ok)throw new Error(result.error);
  status.textContent=JSON.stringify(result,null,2);
 }catch(error){window.Date=NativeDate;status.textContent='FAILED: '+String(error);}
};`;
const bundled = await build({
  stdin: {
    contents: entry,
    resolveDir: root,
    sourcefile: 'satellite-browser-precision-entry.js',
  },
  bundle: true,
  format: 'esm',
  platform: 'browser',
  write: false,
});
const bundle = bundled.outputFiles[0].contents;
const html =
  '<!doctype html><meta charset="utf-8"><title>Satellite browser numerical control</title><style>body{font:18px system-ui;max-width:960px;margin:40px auto;background:#101827;color:#e6ecf6}button{font:inherit;padding:12px}pre{white-space:pre-wrap}</style><h1>Satellite browser numerical control</h1><p>Native satellite renderer and Cesium point setters, pinned TLE data, simulated frame cadence. No GPU or full-scene performance claim.</p><button id="run">Run six browser controls</button><pre id="status" aria-live="polite">Ready</pre><script type="module" src="/native.js"></script>';
let origin;
let saved = false;
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, origin);
    if (req.method === 'GET' && url.pathname === '/') {
      res.writeHead(200, {
        'content-type': 'text/html',
        'cache-control': 'no-store',
      });
      res.end(html);
      return;
    }
    if (req.method === 'GET' && url.pathname === '/native.js') {
      res.writeHead(200, {
        'content-type': 'text/javascript',
        'cache-control': 'no-store',
      });
      res.end(bundle);
      return;
    }
    if (req.method === 'GET' && url.pathname === '/catalogs.json') {
      res.writeHead(200, {
        'content-type': 'application/json',
        'cache-control': 'no-store',
      });
      res.end(JSON.stringify(catalogs));
      return;
    }
    if (req.method === 'POST' && url.pathname === '/result') {
      assert.equal(req.headers.origin, origin);
      assert.equal(saved, false);
      const chunks = [];
      let length = 0;
      for await (const chunk of req) {
        length += chunk.length;
        if (length > 2 * 1024 * 1024) throw new Error('Body too large');
        chunks.push(chunk);
      }
      const bytes = Buffer.concat(chunks);
      const data = JSON.parse(bytes);
      assert.equal(data.cases.length, 6);
      assert.equal(
        new Set(data.cases.map((row) => row.frameStepMs + ':' + row.boundary))
          .size,
        6,
      );
      const cases = data.cases.map(validateCase);
      for (const file of paths)
        assert.equal(
          hash(fs.readFileSync(path.join(root, file))),
          sourceSha256[file],
        );
      const rawName = 'satellite-browser-precision-raw.json';
      fs.writeFileSync(path.join(output, rawName), bytes, { flag: 'wx' });
      const report = {
        schema: 'gev-satellite-browser-numerical-control/v1',
        recordedAt: new Date().toISOString(),
        commit,
        userAgent: String(data.userAgent).slice(0, 240),
        node: process.version,
        sourceSha256,
        sourceStable: true,
        browserBundleSha256: hash(bundle),
        raw: { file: rawName, byteLength: bytes.length, sha256: hash(bytes) },
        toleranceMeters: 0.001,
        cases,
        scope:
          'Native renderer and Cesium point collection setters in Windows Chrome, simulated frame cadence. Host independently derives sampled epoch and checks all828 public cached positions. No WebGL, frame delivery, whole application or GPU performance acceptance.',
        status: 'passed',
      };
      fs.writeFileSync(
        path.join(output, 'satellite-browser-precision.json'),
        JSON.stringify(report, null, 2) + '\n',
        { flag: 'wx' },
      );
      saved = true;
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ status: 'passed', cases, scope: report.scope }));
      return;
    }
    res.writeHead(404);
    res.end('Not found');
  } catch (error) {
    res.writeHead(400, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: String(error.message).slice(0, 240) }));
  }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
origin = 'http://127.0.0.1:' + server.address().port;
console.log(JSON.stringify({ url: origin, commit, output }));
