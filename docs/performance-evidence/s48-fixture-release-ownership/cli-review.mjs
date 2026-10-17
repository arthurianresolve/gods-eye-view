import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = path.resolve(process.argv[2]);
const temp = await mkdtemp(path.join(os.tmpdir(), 'gev-fixture-cli-root-'));
const results = [];
const sha = 'a'.repeat(40);
try {
  await mkdir(path.join(temp, 'cesium'));
  await writeFile(path.join(temp, 'cesium/Cesium.js'), '// fixture identity stub only');
  await writeFile(path.join(temp, 'receipt.json'), JSON.stringify({ assets: [{ path: 'cesium/Cesium.js' }] }));
  const mockPath = path.join(temp, 'puppeteer.mjs');
  const provenancePath = path.join(temp, 'provenance.mjs');
  const workerPath = path.join(temp, 'workers.mjs');
  const childPath = path.join(temp, 'child-process.mjs');
  await writeFile(provenancePath, `export async function beginCaptureBuildProvenance() { return { source: { status: 'test-stub', appCommit: '${sha}', entryPaths: ['/'], expectedAssetPaths: [] } }; }`);
  const realWorkerUrl = pathToFileURL(path.join(root, 'scripts/performance/cesiumWorkerBlobContract.mjs')).href + '?actual';
  await writeFile(workerPath, `export * from ${JSON.stringify(realWorkerUrl)}; export function deriveCesiumEmbeddedWorkerContract() { return {}; }`);
  await writeFile(childPath, `export * from 'gev:real-child-process'; import { execFileSync as realExec } from 'gev:real-child-process'; export function execFileSync(cmd,args,options) { if(cmd==='git') return args.includes('rev-parse') ? '${sha}\\n' : ''; return realExec(cmd,args,options); }`);
  await writeFile(mockPath, `import { EventEmitter } from 'node:events';
import { appendFileSync } from 'node:fs';
const record = value => appendFileSync(process.env.GEV_ROOT_WITNESS, value+'\\n');
let closed = false;
const client = new EventEmitter();
client.send = async method => { record(method); return {}; };
client.detach = async () => record('session-detach');
const originalOff = client.off.bind(client);
client.off = (...args) => { record('interception-listener-remove'); return originalOff(...args); };
const page = {
 isClosed: () => closed,
 close: async () => { record('target-close'); closed=true; if(process.env.GEV_ROOT_CLOSE_FAILURE==='1') throw new Error('sentinel-close-ack-failure'); },
 createCDPSession: async () => client,
 setViewport: async () => {}, setCacheEnabled: async () => {}, setBypassServiceWorker: async () => {},
 evaluateOnNewDocument: async () => ({ identifier: 'owned-registration' }),
 goto: async () => record('goto'), url: () => 'http://127.0.0.1:4173/',
 waitForFunction: async () => { record('viewer-wait'); throw new Error('sentinel-viewer-wait'); },
 evaluate: async () => { record('probe-cleanup'); return {
  status:'confirmed',statePresent:true,hookRestoreAttempted:true,hookRestored:true,
  listenerCount:2,listenerRemovalAttemptedCount:2,listenerRemovalConfirmedCount:2,listenerRemovalFailedCount:0,
  stateDeleted:true,pageExecutionElapsedMs:0,
  renderLoopRetirement:{requested:true,status:'confirmed',before:true,after:false,confirmed:true,pageExecutionElapsedMs:0}
 }; },
 removeScriptToEvaluateOnNewDocument: async () => record('registration-remove'),
 on: () => {}, off: () => {},
};
export default { executablePath: async () => 'mock-chrome', launch: async () => ({
 createBrowserContext: async () => ({newPage:async()=>page}), newPage:async()=>page,
 close:async()=>record('browser-close')
}) };
`);
  const loaderPath = path.join(temp, 'loader.mjs');
  const maps = {
    puppeteer: pathToFileURL(mockPath).href,
    './performance/captureBuildProvenance.mjs': pathToFileURL(provenancePath).href,
    './performance/cesiumWorkerBlobContract.mjs': pathToFileURL(workerPath).href,
    'node:child_process': pathToFileURL(childPath).href,
    'gev:real-child-process': 'node:child_process',
  };
  await writeFile(loaderPath, `import {registerHooks} from 'node:module'; const maps=${JSON.stringify(maps)}; registerHooks({resolve(s,c,next){return maps[s]?{url:maps[s],shortCircuit:true}:next(s,c);}});`);
  for (const closeFailure of [false, true]) {
    const witness = path.join(temp, `witness-${closeFailure}.txt`);
    const output = path.join(temp, `capture-${closeFailure}.json`);
    const args = ['--import', pathToFileURL(loaderPath).href, path.join(root,'scripts/capture-scene-performance.mjs'),
      '--url','http://127.0.0.1:4173/', '--provider-fixture','dense-investigation','--mixed-layers',
      '--build-receipt',path.join(temp,'receipt.json'), '--app-checkout',root, '--harness-checkout',root,
      '--build-root',temp, '--expected-app-sha',sha,'--expected-harness-sha',sha,'--served-base-url','http://127.0.0.1:4173/',
      '--scene-frame-diagnostics','--runs','1','--startup-runs','1','--warmup-ms','0','--seconds','1','--headless','--out',output];
    const child = spawnSync(process.execPath,args,{encoding:'utf8',timeout:15000,windowsHide:true,
      env:{...process.env,GEV_ROOT_WITNESS:witness,GEV_ROOT_CLOSE_FAILURE:closeFailure?'1':'0'}});
    const result = {closeFailure,exitCode:child.status,stdout:child.stdout,stderr:child.stderr};
    try {
      result.events=(await readFile(witness,'utf8')).trim().split(/\r?\n/);
      result.report=JSON.parse(await readFile(output,'utf8'));
      assert.equal(child.status,1);
      assert.match(result.report.failure.message,/sentinel-viewer-wait/);
      assert.equal(result.events.includes('Fetch.disable'),false);
      assert.ok(result.events.indexOf('probe-cleanup')<result.events.indexOf('target-close'));
      assert.ok(result.events.indexOf('interception-listener-remove')<result.events.indexOf('target-close'));
      assert.equal(result.events.at(-1),'browser-close');
      const release=result.report.workload.fixtureInterceptionReleases[0];
      assert.equal(release.targetClosed,true);
      assert.equal(release.confirmed,!closeFailure);
      if(closeFailure) assert.ok(result.report.fixtureInterceptionErrors.some(error=>error.message.includes('sentinel-close-ack-failure')));
      result.passed=true;
    } catch(error) {result.passed=false;result.error=error.stack;}
    results.push(result);
  }
} finally {
  assert.equal(path.dirname(path.resolve(temp)), path.resolve(os.tmpdir()));
  assert.ok(path.basename(temp).startsWith('gev-fixture-cli-root-'));
  await rm(temp,{recursive:true,force:true});
}
const report = {schema:'gev-fixture-release-cli-root-review/v1',scope:'actual capture CLI and interception; browser, build provenance and git identity stubbed; no browser/network',results,passed:results.every(r=>r.passed)};
if(process.argv[3]) await writeFile(process.argv[3],JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({passed:report.passed,results:results.map(({report,...r})=>r)},null,2));
process.exitCode=report.passed?0:1;
