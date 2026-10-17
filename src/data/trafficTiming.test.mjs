import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { readLayerSource } from '../testSupport/readLayerSource.mjs';
import { getTrafficTimingDiagnostics } from './traffic.js';

const run = promisify(execFile);
const SOURCE = readLayerSource(
  new URL('./traffic.js', import.meta.url),
  'utf8',
).replace(/parts\.(?:model|timing)\./g, '');

function functionBody(name) {
  const declaration = `function ${name}(`;
  const start = SOURCE.indexOf(declaration);
  assert.notEqual(start, -1, `${declaration} must exist`);
  const signatureStart = SOURCE.indexOf('(', start);
  let signatureDepth = 0;
  let signatureEnd = -1;
  for (let i = signatureStart; i < SOURCE.length; i++) {
    if (SOURCE[i] === '(') signatureDepth++;
    if (SOURCE[i] === ')' && --signatureDepth === 0) {
      signatureEnd = i;
      break;
    }
  }
  assert.notEqual(signatureEnd, -1, `${name} signature must terminate`);
  const open = SOURCE.indexOf('{', signatureEnd);
  let depth = 0;
  let quote = null;
  let escaped = false;
  let lineComment = false;
  let blockComment = false;
  for (let i = open; i < SOURCE.length; i++) {
    const char = SOURCE[i];
    const next = SOURCE[i + 1];
    if (lineComment) {
      if (char === '\n') lineComment = false;
      continue;
    }
    if (blockComment) {
      if (char === '*' && next === '/') {
        blockComment = false;
        i++;
      }
      continue;
    }
    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === quote) {
        quote = null;
      }
      continue;
    }
    if (char === '/' && next === '/') {
      lineComment = true;
      i++;
      continue;
    }
    if (char === '/' && next === '*') {
      blockComment = true;
      i++;
      continue;
    }
    if (char === "'" || char === '"' || char === '`') {
      quote = char;
      continue;
    }
    if (char === '{') depth++;
    if (char === '}' && --depth === 0) return SOURCE.slice(open + 1, i);
  }
  throw new Error(`unterminated ${name} body`);
}

function canonicalSemanticBody(body) {
  return body
    .replace(/\/\* TRACE_ONLY_BEGIN \*\/[\s\S]*?\/\* TRACE_ONLY_END \*\//g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '')
    .replace(/\s+/g, '')
    .replace(
      'if(!overpassData||!overpassData.elements){return[];}',
      'if(!overpassData||!overpassData.elements)return[];',
    );
}

function traceOnlyBlocks(body) {
  return [
    ...body.matchAll(
      /\/\* TRACE_ONLY_BEGIN \*\/([\s\S]*?)\/\* TRACE_ONLY_END \*\//g,
    ),
  ].map((match) => match[1]);
}

test('traffic timing stays inert when the DEV flag is off under bare Node', () => {
  assert.deepEqual(getTrafficTimingDiagnostics(), {
    enabled: false,
    marksInstalled: 0,
    traceObjectsCreated: 0,
    uncorrelatedTracesDropped: 0,
  });
  assert.equal(
    performance
      .getEntriesByType('mark')
      .filter((entry) => entry.name.startsWith('traffic:')).length,
    0,
  );
});

test('traffic timing pairs real ordering to the scheduling change and guards re-arms', async () => {
  const fixture = fileURLToPath(
    new URL('../../scripts/fixtures/traffic-timing-node.mjs', import.meta.url),
  );
  const cwd = fileURLToPath(new URL('../..', import.meta.url));
  const { stdout, stderr } = await run(process.execPath, [fixture], {
    cwd,
    timeout: 30_000,
    maxBuffer: 1024 * 1024,
  });

  assert.equal(stderr, '');
  assert.deepEqual(JSON.parse(stdout), {
    status: 'passed',
    diagnostics: {
      enabled: true,
      marksInstalled: 1,
      traceObjectsCreated: 2,
      uncorrelatedTracesDropped: 1,
    },
    staleAnchorDropped: true,
    fetchPrecededMoveEnd: true,
  });
});

test('the timed parser stays source-equivalent to the production parser', () => {
  assert.equal(
    canonicalSemanticBody(functionBody('parseRoadsTimed')),
    canonicalSemanticBody(functionBody('parseRoads')),
    'parseRoadsTimed may add only TRACE_ONLY blocks; production operations and order must match',
  );

  const traceBlocks = traceOnlyBlocks(functionBody('parseRoadsTimed'));
  assert.ok(
    traceBlocks.length > 0,
    'parseRoadsTimed must retain explicit trace-only blocks',
  );
  const traceSource = traceBlocks.join('\n');
  // This is deliberately a reasonable lexical tripwire, not an AST proof: it
  // recognizes direct assignments and common mutator calls, but cannot prove
  // safety through aliases or computed properties. Source equivalence above
  // remains the independent operation-order backstop.
  const assignedIdentifiers = [
    ...traceSource.matchAll(
      /\b([A-Za-z_$][\w$]*)\s*(?:\+\+|--|\+=|-=|\*=|\/=|%=|=(?!=|>))/g,
    ),
  ].map((match) => match[1]);
  const mutatedIdentifiers = [
    ...traceSource.matchAll(
      /\b([A-Za-z_$][\w$]*)\.(?:add|delete|clear|set|push|pop|shift|unshift|splice|sort|reverse|copyWithin|fill)\s*\(/g,
    ),
  ].map((match) => match[1]);
  const unsafeWrites = [...assignedIdentifiers, ...mutatedIdentifiers].filter(
    (identifier) =>
      identifier !== 'trace' && !identifier.startsWith('_trafficTiming'),
  );
  assert.deepEqual(
    unsafeWrites,
    [],
    'TRACE_ONLY blocks may write only trace or _trafficTiming* instrumentation state',
  );
  assert.doesNotMatch(
    traceSource,
    /\b(?:roads|coords|waypoints|segmentDist)\s*(?:\.(?:add|delete|clear|set|push|pop|shift|unshift|splice|sort|reverse|copyWithin|fill)\s*\(|\+\+|--|\+=|-=|\*=|\/=|%=|=(?!=|>))/,
    'TRACE_ONLY blocks must not mutate parser production collections',
  );

  assert.doesNotMatch(SOURCE, /function fetchRoadsTimed\s*\(/);
  assert.doesNotMatch(SOURCE, /function renderRoadsForAltitudeTimed\s*\(/);
  const fetchBody = canonicalSemanticBody(functionBody('readRoads'));
  assert.equal(fetchBody.includes('response.text()'), false);
  assert.equal(fetchBody.includes('JSON.parse('), false);
  const okCheck = fetchBody.indexOf('if(!response.ok)');
  const responseJson = fetchBody.indexOf('response.json()');
  assert.notEqual(okCheck, -1);
  assert.notEqual(responseJson, -1);
  assert.ok(okCheck < responseJson);
});
