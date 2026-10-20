import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const PRIOR_SEED_LEDGER_SOURCE = Object.freeze({
  commit: '6b896e2a8277fba12bc9577ad7772005a71e13c7',
  file: 'src/ui/workspaceLibrary.js',
  sha256: 'ba1d8d954233af96e13d8c3baf6dd60210f650571270a3f15ef58dac3d3925bc',
  maximumEvents: 32,
});
const hash = (value) => createHash('sha256').update(value).digest('hex');

export function instrumentPriorWorkspaceLibrarySource(original) {
  assert.equal(
    hash(original),
    PRIOR_SEED_LEDGER_SOURCE.sha256,
    'Exact prior source required',
  );
  let source = original;
  const changes = [];
  const replaceOnce = (name, before, after) => {
    assert.equal(
      source.split(before).length - 1,
      1,
      'Unique source anchor: ' + name,
    );
    source = source.replace(before, after);
    changes.push(name);
  };
  replaceOnce(
    'bounded-redacted-ledger',
    '  let disposed = false;\n',
    `  let disposed = false;
  // Diagnostic-only source addition in a disposable prior installation.
  const priorSeedLedger = { schema: 'gev-prior-seed-apply-ledger/v1', maximumEvents: 32, dropped: 0, events: [] };
  window.__gevPriorSeedApplyLedger = priorSeedLedger;
  let priorSeedRefreshSequence = 0;
  const recordPriorSeedLedger = (phase, details = {}) => {
    if (priorSeedLedger.events.length >= 32) { priorSeedLedger.dropped++; return; }
    priorSeedLedger.events.push({ phase, atMs: performance.now(), activePresent: !!active, selectedPresent: !!select.value, selectedMatchesActive: !!active && active.id === select.value, accepted: Number.isSafeInteger(stagedPreview?.accepted) ? stagedPreview.accepted : null, buttonDisabled: applyImportButton.disabled, applying, disposed, ...details });
  };
`,
  );
  replaceOnce(
    'delegated-apply-dispatch',
    `    if (button) void act(button.dataset.action);`,
    `    if (button) {
      if (button.dataset.action === 'apply-import') recordPriorSeedLedger('delegated-apply-click', { sameApplyButton: button === applyImportButton, connected: button.isConnected });
      void act(button.dataset.action);
    }`,
  );
  replaceOnce(
    'action-entry',
    '  async function act(action) {\n',
    `  async function act(action) {
    if (action === 'apply-import') recordPriorSeedLedger('act-apply-entry');
`,
  );
  replaceOnce(
    'selected-workspace-guard',
    `    if (action === 'pin-query-result') return pinQueryResult();
    if (!select.value)
      return setStatus('Choose an investigation first.', 'warning');`,
    `    if (action === 'pin-query-result') return pinQueryResult();
    if (!select.value) {
      if (action === 'apply-import') recordPriorSeedLedger('select-guard-return');
      return setStatus('Choose an investigation first.', 'warning');
    }`,
  );
  replaceOnce(
    'preview-publication',
    `    applyImportButton.disabled = !active || preview.accepted === 0;`,
    `    applyImportButton.disabled = !active || preview.accepted === 0;
    recordPriorSeedLedger('preview-published');`,
  );
  const begin = source.indexOf('  async function applyStagedImport() {');
  const end = source.indexOf('\n  function cancelStagedImport()', begin);
  assert.ok(begin >= 0 && end > begin);
  const applyBefore = source.slice(begin, end);
  let apply = applyBefore.replace(
    `    if (!active || !stagedPreview?.accepted) return;`,
    `    recordPriorSeedLedger('apply-entry');
    if (!active || !stagedPreview?.accepted) { recordPriorSeedLedger('apply-guard-return'); return; }`,
  );
  assert.notEqual(apply, applyBefore);
  apply = apply.replace(
    '      const result = await library.save(',
    `      recordPriorSeedLedger('apply-save-start');
      const result = await library.save(`,
  );
  apply = apply.replace(
    '      active.revision = result.manifest.revision;',
    `      recordPriorSeedLedger('apply-save-resolved');
      active.revision = result.manifest.revision;`,
  );
  apply = apply.replace(
    '      await refresh();',
    `      recordPriorSeedLedger('apply-refresh-start');
      await refresh();
      recordPriorSeedLedger('apply-refresh-resolved');`,
  );
  apply = apply.replace(
    '    } catch (error) {',
    `    } catch (error) {
      recordPriorSeedLedger('apply-rejected', { errorName: typeof error?.name === 'string' ? error.name.slice(0, 64) : null, errorCode: typeof error?.code === 'string' ? error.code.slice(0, 64) : null });`,
  );
  replaceOnce('apply-guard-and-original-await-boundaries', applyBefore, apply);
  replaceOnce(
    'refresh-entry',
    `  async function refresh() {
    if (disposed) return;`,
    `  async function refresh() {
    const priorSeedRefreshId = ++priorSeedRefreshSequence;
    recordPriorSeedLedger('refresh-entry', { refreshId: priorSeedRefreshId });
    try {
    if (disposed) { recordPriorSeedLedger('refresh-disposed-return', { refreshId: priorSeedRefreshId }); return; }`,
  );
  replaceOnce(
    'refresh-resolution',
    `    lastAuthoredSignature = authoredSignature();
  }

  async function save(`,
    `    lastAuthoredSignature = authoredSignature();
    recordPriorSeedLedger('refresh-resolved', { refreshId: priorSeedRefreshId });
    } catch (error) {
      recordPriorSeedLedger('refresh-rejected', { refreshId: priorSeedRefreshId, errorName: typeof error?.name === 'string' ? error.name.slice(0, 64) : null, errorCode: typeof error?.code === 'string' ? error.code.slice(0, 64) : null });
      throw error;
    }
  }

  async function save(`,
  );
  for (const token of [
    /\bawait\b/g,
    /addEventListener\s*\(/g,
    /setTimeout\s*\(/g,
    /setInterval\s*\(/g,
  ])
    assert.equal(
      (source.match(token) || []).length,
      (original.match(token) || []).length,
      'Original async/listener/timer count: ' + token,
    );
  return {
    source,
    originalSha256: hash(original),
    instrumentedSha256: hash(source),
    changes,
  };
}

export async function instrumentPriorWorkspaceLibrary({
  installation,
  priorCommit,
}) {
  assert.equal(process.platform, 'darwin', 'Diagnostic is scoped to macOS');
  assert.equal(priorCommit, PRIOR_SEED_LEDGER_SOURCE.commit);
  const file = path.join(installation, PRIOR_SEED_LEDGER_SOURCE.file);
  const original = await readFile(file, 'utf8');
  const result = instrumentPriorWorkspaceLibrarySource(original);
  await writeFile(file, result.source);
  return {
    schema: 'gev-prior-seed-source-instrumentation/v1',
    status: 'instrumented-diagnostic-only',
    base: PRIOR_SEED_LEDGER_SOURCE,
    originalBytes: Buffer.byteLength(original),
    instrumentedBytes: Buffer.byteLength(result.source),
    originalSha256: result.originalSha256,
    instrumentedSha256: result.instrumentedSha256,
    changes: result.changes,
    applicationSourceChanged: true,
    acceptanceEligible: false,
    note: 'Known diagnostic source additions before the existing prior Vite build; not a byte-identical6b application and never acceptance evidence.',
  };
}

// Self-contained in the actual installed page; no replacement application module.
export function readPriorWorkspaceApplyLedgerInPage() {
  const ledger = window.__gevPriorSeedApplyLedger;
  if (!ledger || ledger.schema !== 'gev-prior-seed-apply-ledger/v1')
    return { status: 'unavailable', reason: 'source-ledger-missing' };
  return {
    schema: ledger.schema,
    maximumEvents: ledger.maximumEvents,
    dropped: ledger.dropped,
    events: ledger.events.slice(0, 32).map((row) => ({ ...row })),
    status: ledger.dropped ? 'truncated' : 'complete-bounded-ledger',
    scope:
      'Guard and original-await observations only; no import payloads, filenames, URLs, workspace IDs, added timers, clicks or retries.',
  };
}
