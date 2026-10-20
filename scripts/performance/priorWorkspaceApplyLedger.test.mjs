import assert from 'node:assert/strict';
import fs from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import test from 'node:test';
import {
  instrumentPriorWorkspaceLibrarySource,
  PRIOR_SEED_LEDGER_SOURCE,
  readPriorWorkspaceApplyLedgerInPage,
} from './priorWorkspaceApplyLedger.mjs';

const original = execFileSync(
  'git',
  [
    'show',
    PRIOR_SEED_LEDGER_SOURCE.commit + ':' + PRIOR_SEED_LEDGER_SOURCE.file,
  ],
  { encoding: 'utf8' },
);
const patch = instrumentPriorWorkspaceLibrarySource(original);
const functionSource = (name, next) => {
  const begin = patch.source.indexOf('  async function ' + name + '(');
  const end = patch.source.indexOf('\n  ' + next, begin);
  assert.ok(begin >= 0 && end > begin);
  return patch.source.slice(begin, end).trim();
};

function applyFixture({ active = true, save, refresh } = {}) {
  const phases = [],
    states = {
      status:
        'Review counts, bounds, time interpretation, and attribution, then choose Apply to save this layer.',
      features: 0,
    };
  const importStatus = {
    get textContent() {
      return states.status;
    },
    set textContent(value) {
      states.status = value;
    },
  };
  const bindings = {
    active: active
      ? { id: 'test-workspace', title: 'fixture', revision: 1, chunks: {} }
      : null,
    stagedPreview: {
      kind: 'geojson',
      accepted: 1,
      rejected: 0,
      rejectedRows: [],
      records: [{ id: 'point' }],
    },
    stagedFile: { name: 'fixture.geojson' },
    stagedText: 'fixed fixture',
    now: () => 42,
    library: { save: save ?? (async () => ({ manifest: { revision: 2 } })) },
    snapshot: () => ({}),
    refresh: refresh ?? (async () => {}),
    onImportedData: () => states.features++,
    importStatus,
    importReview: { hidden: false },
    geoFile: { value: 'fixture' },
    recordPriorSeedLedger: (phase, details) => phases.push({ phase, details }),
  };
  const apply = new Function(
    ...Object.keys(bindings),
    'return (' +
      functionSource('applyStagedImport', 'function cancelStagedImport') +
      ');',
  )(...Object.values(bindings));
  return { apply, phases, states, bindings };
}

test('only exact6b source is instrumented, with unchanged await/listener/timer counts and valid module syntax', () => {
  assert.equal(patch.originalSha256, PRIOR_SEED_LEDGER_SOURCE.sha256);
  assert.equal(patch.changes.length, 8);
  assert.notEqual(patch.instrumentedSha256, patch.originalSha256);
  assert.throws(
    () => instrumentPriorWorkspaceLibrarySource(original + '\n'),
    /Exact prior source/,
  );
  const syntax = spawnSync(
    process.execPath,
    ['--input-type=module', '--check'],
    { input: patch.source, encoding: 'utf8' },
  );
  assert.equal(syntax.status, 0, syntax.stderr);
});

test('actual prior apply guard records a silent no-op without calling persistence', async () => {
  let saves = 0;
  const f = applyFixture({
    active: false,
    save: async () => {
      saves++;
    },
  });
  await f.apply();
  assert.deepEqual(
    f.phases.map((row) => row.phase),
    ['apply-entry', 'apply-guard-return'],
  );
  assert.equal(saves, 0);
  assert.equal(f.states.features, 0);
  assert.match(f.states.status, /^Review/);
});

test('actual prior apply keeps Review UI and zero features while admitted save or subsequent refresh is pending', async () => {
  let resolveSave, resolveRefresh;
  const f = applyFixture({
    save: () =>
      new Promise((resolve) => {
        resolveSave = resolve;
      }),
    refresh: () =>
      new Promise((resolve) => {
        resolveRefresh = resolve;
      }),
  });
  const work = f.apply();
  assert.deepEqual(
    f.phases.map((row) => row.phase),
    ['apply-entry', 'apply-save-start'],
  );
  assert.match(f.states.status, /^Review/);
  assert.equal(f.states.features, 0);
  resolveSave({ manifest: { revision: 2 } });
  await Promise.resolve();
  assert.deepEqual(
    f.phases.map((row) => row.phase),
    [
      'apply-entry',
      'apply-save-start',
      'apply-save-resolved',
      'apply-refresh-start',
    ],
  );
  assert.match(f.states.status, /^Review/);
  assert.equal(f.states.features, 0);
  resolveRefresh();
  await work;
  assert.equal(f.phases.at(-1).phase, 'apply-refresh-resolved');
  assert.match(f.states.status, /Imported 1 features/);
  assert.equal(f.states.features, 1);
});

test('actual prior persistence rejection remains failed and records only redacted name/code', async () => {
  const error = Object.assign(
    new Error('private payload must not enter ledger'),
    { name: 'StorageError', code: 'test-failure' },
  );
  const f = applyFixture({
    save: async () => {
      throw error;
    },
  });
  await f.apply();
  assert.equal(f.phases.at(-1).phase, 'apply-rejected');
  assert.deepEqual(f.phases.at(-1).details, {
    errorName: 'StorageError',
    errorCode: 'test-failure',
  });
  assert.ok(!JSON.stringify(f.phases).includes(error.message));
  assert.equal(f.states.features, 0);
  assert.match(f.states.status, /Import was not applied/);
});

test('actual delegated event invokes act once; selected-workspace guard is distinguished from import guard', async () => {
  const phases = [];
  let applyCalls = 0;
  const act = new Function(
    'select',
    'setStatus',
    'recordPriorSeedLedger',
    'applyStagedImport',
    'return (' + functionSource('act', 'function selectedCsvMapping') + ');',
  )(
    { value: '' },
    () => {},
    (phase) => phases.push(phase),
    async () => {
      applyCalls++;
    },
  );
  await act('apply-import');
  assert.deepEqual(phases, ['act-apply-entry', 'select-guard-return']);
  assert.equal(applyCalls, 0);
  const begin = patch.source.indexOf(
    "  root.addEventListener('click', (event) => {",
  );
  const end = patch.source.indexOf(
    "\n  select.addEventListener('change'",
    begin,
  );
  const button = { dataset: { action: 'apply-import' }, isConnected: true };
  let callback,
    actCalls = 0;
  new Function(
    'root',
    'recordPriorSeedLedger',
    'applyImportButton',
    'act',
    patch.source.slice(begin, end),
  )(
    {
      addEventListener(name, fn) {
        assert.equal(name, 'click');
        callback = fn;
      },
    },
    (phase) => phases.push(phase),
    button,
    (action) => {
      assert.equal(action, 'apply-import');
      actCalls++;
    },
  );
  callback({ target: { closest: () => button } });
  assert.equal(actCalls, 1);
  assert.equal(phases.at(-1), 'delegated-apply-click');
});

test('source-executed recorder retains only32 primitive/redacted records and explicitly counts truncation', () => {
  const begin = patch.source.indexOf('  const priorSeedLedger =');
  const end = patch.source.indexOf(
    '\n\n  for (const key of Object.keys(ANALYST_LAYERS))',
    begin,
  );
  assert.ok(begin >= 0 && end > begin);
  const window = {};
  const record = new Function(
    'window',
    'performance',
    'active',
    'select',
    'stagedPreview',
    'applyImportButton',
    'applying',
    'disposed',
    patch.source.slice(begin, end) + ';return recordPriorSeedLedger;',
  )(
    window,
    { now: () => 1 },
    { id: 'private-id' },
    { value: 'private-id' },
    { accepted: 1 },
    { disabled: false },
    false,
    false,
  );
  for (let i = 0; i < 40; i++) record('test-phase');
  assert.equal(window.__gevPriorSeedApplyLedger.events.length, 32);
  assert.equal(window.__gevPriorSeedApplyLedger.dropped, 8);
  assert.ok(
    !JSON.stringify(window.__gevPriorSeedApplyLedger).includes('private-id'),
  );
  const read = new Function(
    'window',
    'return (' + readPriorWorkspaceApplyLedgerInPage.toString() + ')();',
  )(window);
  assert.equal(read.status, 'truncated');
  assert.equal(read.events.length, 32);
});

test('seed-only harness catches only its unique completion sentinel and leaves original fixture/waits untouched', () => {
  const harness = fs.readFileSync(
    new URL('../qa-profile-recovery.mjs', import.meta.url),
    'utf8',
  );
  assert.match(harness, /error !== priorSeedScopeComplete/);
  assert.match(
    harness,
    /if \(priorSeedLedgerDiagnostic\) throw priorSeedScopeComplete/,
  );
  assert.equal(
    (harness.match(/await seedPersistentWorkspace\(page\)/g) || []).length,
    1,
  );
  assert.ok(
    harness.indexOf('throw priorSeedScopeComplete') <
      harness.indexOf("['scripts/pinokio-update.mjs']"),
  );
  assert.match(harness, /priorSeedInstrumentation/);
  assert.match(harness, /completed-diagnostic-only/);
  const fixture = execFileSync(
    'git',
    ['show', 'HEAD:scripts/qa-application-fixtures.mjs'],
    { encoding: 'utf8' },
  );
  assert.match(fixture, /element\.click\(\)/);
  assert.match(fixture, /import-apply-status-wait/);
});
