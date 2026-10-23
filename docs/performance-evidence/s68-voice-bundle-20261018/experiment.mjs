import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { buildAndAudit } from '../../../scripts/audit-bundle-build.mjs';
const root = process.cwd();
const sourceFile = path.join(root, 'src/voice/realtimeConnection.js');
const helperFile = path.join(root, 'src/voice/realtimeTransportExperiment.js');
if (fs.existsSync(helperFile))
  throw new Error('experiment helper already exists');
const before = fs.readFileSync(sourceFile, 'utf8');
if (
  createHash('sha256').update(before).digest('hex') !==
  '0a53d92d665af58276b2091631f597d289a8981def36876e43b3d0e19ee434d7'
)
  throw new Error('experiment requires the recorded connection source');
const start = before.indexOf('  async start({ pushToTalk = false } = {}) {');
const end = before.indexOf('  // Returns true (and tears down', start);
const bodyStart = before.indexOf('    let localStream = null;', start);
if (start < 0 || end < 0 || bodyStart < 0)
  throw new Error('source shape differs');
const body = before.slice(bodyStart, end).trimEnd();
if (!body.endsWith('  }')) throw new Error('unexpected method end');
const releaseHelper = before.slice(
  before.indexOf('function releaseStartResources'),
  before.indexOf('/** Own connection'),
);
const helper =
  "import { t } from '../i18n/index.js';\n" +
  releaseHelper +
  'export async function connectRealtimeTransport({epoch, signal}) {\n' +
  body.slice(0, -3) +
  '}\n';
const replacement =
  before.slice(start, bodyStart) +
  String.raw`
    try {
      const { connectRealtimeTransport } = await import('./realtimeTransportExperiment.js');
      if (this.abandonStart(epoch, {})) return;
      return await connectRealtimeTransport.call(this, { epoch, signal });
    } catch (error) {
      if (epoch !== this.startEpoch) return;
      const diagnostics = this.connectionDiagnostics();
      this.stop({ preserveStatus: true });
      this.reportError('Realtime connection', error, diagnostics);
    }
  }

`;
const after = before.slice(0, start) + replacement + before.slice(end);
const resultDir = path.join(
  root,
  'qa-artifacts/s68-transport-experiment-20261018',
);
fs.mkdirSync(resultDir);
fs.writeFileSync(path.join(resultDir, 'realtimeConnection.before.js'), before);
fs.writeFileSync(
  path.join(resultDir, 'realtimeConnection.experiment.js'),
  after,
);
fs.writeFileSync(
  path.join(resultDir, 'realtimeTransportExperiment.js'),
  helper,
);
const baseline = await buildAndAudit({
  root,
  outDir: 'qa-artifacts/s68-transport-control-dist',
});
let candidate;
try {
  fs.writeFileSync(sourceFile, after);
  fs.writeFileSync(helperFile, helper);
  candidate = await buildAndAudit({
    root,
    outDir: 'qa-artifacts/s68-transport-experiment-dist',
  });
} finally {
  fs.writeFileSync(sourceFile, before);
  if (fs.existsSync(helperFile)) fs.unlinkSync(helperFile);
}
const result = {
  schemaVersion: 1,
  experiment: 'connection-only async transport continuation',
  sourceSha256: createHash('sha256').update(before).digest('hex'),
  restored: fs.readFileSync(sourceFile, 'utf8') === before,
  baseline,
  candidate,
  acceptance: 'size experiment only; runtime not adopted',
};
fs.writeFileSync(
  path.join(resultDir, 'comparison.json'),
  JSON.stringify(result, null, 2),
);
console.log(
  JSON.stringify(
    {
      restored: result.restored,
      baseline: {
        bytes: baseline.initial.bytes,
        gzipBytes: baseline.initial.gzipBytes,
        brotliBytes: baseline.initial.brotliBytes,
      },
      candidate: {
        bytes: candidate.initial.bytes,
        gzipBytes: candidate.initial.gzipBytes,
        brotliBytes: candidate.initial.brotliBytes,
      },
    },
    null,
    2,
  ),
);
