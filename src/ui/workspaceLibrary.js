import { createWorkspaceLibrary } from '../workspaces/library.js';
import { createWorkspaceHistory } from '../workspaces/history.js';
import {
  ANALYST_LAYERS,
  analystFieldType,
  analystFieldsFor,
} from '../data/analystEngine.js';
import { parseSavedQuery, parseSavedQueryList } from '../data/savedQueries.js';
import { createWorkspaceRestoreCoordinator } from '../workspaces/restore.js';
import {
  compareEvidenceSnapshots,
  createEvidenceSnapshot,
  exportEvidenceComparison,
} from '../evidence/comparison.js';
import {
  IMPORT_LIMITS,
  parseCsv,
  previewCSV,
  previewGeoJSON,
  previewGPX,
  previewKML,
} from '../imports/index.js';
import {
  createWorkspaceImportReadOwner,
  readOwnedWorkspaceFile,
} from './workspaceImportRead.js';

const safeJson = (value) => JSON.stringify(value ?? null);

function downloadText(name, text, type = 'application/json') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/** Mount a keyboard-friendly workspace library into the Director panel. */
export function createWorkspaceLibraryPanel({
  container,
  storage,
  shareLinkManager,
  shareRestoration,
  navigation,
  analystEngine = null,
  onImportedData = () => {},
  now = () => Date.now(),
} = {}) {
  if (!container || !storage || !shareLinkManager)
    throw new TypeError('Workspace panel dependencies are required.');
  const library = createWorkspaceLibrary({ storage, now });
  const history = createWorkspaceHistory();
  const root = document.createElement('details');
  root.className = 'workspace-library';
  root.innerHTML = `
    <summary>WORKSPACES</summary>
    <div class="workspace-library-body">
      <details class="gev-first-task-guide" open>
        <summary>START HERE · SELECT → INSPECT → SAVE</summary>
        <ol>
          <li>Choose a live object, or start the clearly marked offline demo.</li>
          <li>Select a record and open its evidence inspector to review source and time.</li>
          <li>Save the workspace to reopen this view and its permitted local data.</li>
        </ol>
      </details>
      <label>Investigation <select data-workspace-select aria-label="Saved investigation"><option value="">No saved investigations</option></select></label>
      <div class="workspace-library-actions">
        <button type="button" data-action="save">SAVE</button>
        <button type="button" data-action="save-as">SAVE AS</button>
        <button type="button" data-action="open">OPEN</button>
        <button type="button" data-action="duplicate">DUPLICATE</button>
        <button type="button" data-action="export">EXPORT</button>
        <button type="button" data-action="recover">RECOVER</button>
        <button type="button" data-action="delete">DELETE</button>
        <button type="button" data-action="synthetic-demo">SHOW SYNTHETIC OFFLINE DEMO</button>
        <button type="button" data-action="undo" aria-label="Undo authored change">UNDO</button>
        <button type="button" data-action="redo" aria-label="Redo authored change">REDO</button>
      </div>
      <label>Recovery point <select data-revision-select aria-label="Prior complete revision"><option value="">No prior revision</option></select></label>
      <label>Import backup <input data-import type="file" accept="application/json,.json" /></label>
      <fieldset data-saved-queries>
        <legend>Saved queries</legend>
        <label>Name <input data-query-name type="text" maxlength="100" value="New query" /></label>
        <label>Layers <select data-query-layers multiple size="5" aria-label="Query data layers"></select></label>
        <label>Scope <select data-query-scope aria-label="Query geographic scope"><option value="anywhere">All loaded data</option><option value="view">Around current view centre</option></select></label>
        <label>Filter field <select data-query-field aria-label="Optional filter field"><option value="">No filter</option></select></label>
        <label>Filter operator <select data-query-operator aria-label="Filter operator"><option value="eq">equals</option><option value="contains">contains</option><option value="gt">greater than</option><option value="gte">at least</option><option value="lt">less than</option><option value="lte">at most</option><option value="neq">not equal</option></select></label>
        <label>Filter value <input data-query-value type="text" maxlength="160" /></label>
        <label>Order by <select data-query-sort aria-label="Result ordering"><option value="">Default ordering</option></select></label>
        <label>Direction <select data-query-direction><option value="asc">Ascending</option><option value="desc">Descending</option></select></label>
        <label>Maximum listed <input data-query-limit type="number" min="1" max="500" step="1" value="50" /></label>
        <label>Saved query <select data-query-saved aria-label="Saved query"><option value="">No saved queries</option></select></label>
        <div class="workspace-library-actions">
          <button type="button" data-action="save-query">SAVE QUERY</button>
          <button type="button" data-action="load-query">LOAD QUERY</button>
          <button type="button" data-action="run-query">RUN AT SELECTED TIME</button>
          <button type="button" data-action="pin-query-result">PIN RESULT</button>
        </div>
        <p data-query-status role="status" aria-live="polite">Queries inspect records already loaded by their source layers.</p>
        <div data-query-result role="region" aria-label="Inspectable query result" aria-live="polite"></div>
      </fieldset>
      <fieldset data-geo-import>
        <legend>Import geographic file</legend>
        <label>File <input data-geo-file type="file" accept=".geojson,.json,.csv,.kml,.gpx,application/geo+json,text/csv,application/vnd.google-earth.kml+xml,application/gpx+xml" /></label>
        <div data-csv-mapping hidden>
          <label>Latitude <select data-column="latitude"></select></label>
          <label>Longitude <select data-column="longitude"></select></label>
          <label>ID (optional) <select data-column="id"></select></label>
          <label>Time (optional) <select data-column="time"></select></label>
          <button type="button" data-action="preview-import">PREVIEW CSV</button>
        </div>
        <label>Attribution <input data-attribution type="text" maxlength="500" placeholder="Source or license, if known" /></label>
        <p data-import-status role="status" aria-live="polite">Choose a GeoJSON, CSV, KML, or GPX file to preview.</p>
        <div data-import-review hidden>
          <p data-import-summary></p>
          <button type="button" data-action="apply-import" disabled>APPLY TO WORKSPACE</button>
          <button type="button" data-action="cancel-import">CANCEL</button>
        </div>
      </fieldset>
      <p data-usage></p>
      <p data-status role="status" aria-live="polite">Ready. Save an investigation to reopen this view later.</p>
      <fieldset data-comparison>
        <legend>Evidence comparison</legend>
        <p data-comparison-source>No selected evidence to pin yet. Select a record and inspect its evidence.</p>
        <div class="workspace-library-actions">
          <button type="button" data-action="pin-a">PIN AS A</button>
          <button type="button" data-action="pin-b">PIN AS B</button>
          <button type="button" data-action="compare">COMPARE A / B</button>
          <button type="button" data-action="report-json">JSON</button>
          <button type="button" data-action="report-csv">CSV</button>
          <button type="button" data-action="report-markdown">MARKDOWN</button>
        </div>
        <div data-comparison-results role="region" aria-label="Evidence comparison results" aria-live="polite"></div>
      </fieldset>
    </div>`;
  container.prepend(root);
  const select = root.querySelector('[data-workspace-select]');
  const revisions = root.querySelector('[data-revision-select]');
  const status = root.querySelector('[data-status]');
  const usage = root.querySelector('[data-usage]');
  const geoFile = root.querySelector('[data-geo-file]');
  const importReview = root.querySelector('[data-import-review]');
  const importStatus = root.querySelector('[data-import-status]');
  const importSummary = root.querySelector('[data-import-summary]');
  const applyImportButton = root.querySelector('[data-action="apply-import"]');
  const csvMapping = root.querySelector('[data-csv-mapping]');
  const queryLayers = root.querySelector('[data-query-layers]');
  const queryField = root.querySelector('[data-query-field]');
  const querySort = root.querySelector('[data-query-sort]');
  const savedQuerySelect = root.querySelector('[data-query-saved]');
  const queryStatus = root.querySelector('[data-query-status]');
  const queryResultHost = root.querySelector('[data-query-result]');
  let active = null;
  let applying = false;
  let latestEvidence = null;
  let latestComparison = null;
  let latestQueryResult = null;
  let queryController = null;
  let queryGeneration = 0;
  let stagedFile = null;
  let stagedText = null;
  let stagedPreview = null;
  const importReadOwner = createWorkspaceImportReadOwner();
  let stagedImportOwner = null;
  let importInputGeneration = 0;
  let importController = null;
  let applyingImport = false;
  let renderController = null;
  let openGeneration = 0;
  let autosaveTimer = null;
  let historyTimer = null;
  let pendingHistoryView = null;
  let lastAuthoredSignature = '';
  let disposed = false;
  function cancelImportRendering() {
    renderController?.abort();
    renderController = null;
  }
  function importOwnerIsCurrent(owner = stagedImportOwner) {
    return importReadOwner.isCurrent(owner, {
      workspaceId: active?.id ?? null,
      workspaceGeneration: openGeneration,
      disposed,
    });
  }
  function resetStagedImport({ status = null, clearFile = false } = {}) {
    importInputGeneration++;
    importReadOwner.invalidate();
    stagedImportOwner = null;
    importController?.abort('import-input-invalidated');
    importController = null;
    stagedFile = null;
    stagedText = null;
    stagedPreview = null;
    importReview.hidden = true;
    importSummary.textContent = '';
    applyImportButton.disabled = true;
    csvMapping.hidden = true;
    if (clearFile) geoFile.value = '';
    if (status) importStatus.textContent = status;
    syncImportApplyButton();
  }
  function invalidateWorkspaceOwnedPendingImport() {
    if (
      !stagedImportOwner ||
      stagedPreview ||
      stagedImportOwner.workspaceId == null
    )
      return;
    if (importOwnerIsCurrent()) return;
    resetStagedImport({
      status: 'Import preview cancelled because its workspace changed.',
      clearFile: true,
    });
  }
  function syncImportApplyButton() {
    applyImportButton.disabled =
      applyingImport || !active || !stagedPreview?.accepted;
  }
  async function renderImportedData(imports, options) {
    cancelImportRendering();
    if (disposed || options.workspaceId !== (active?.id ?? null)) return false;
    const controller = new AbortController();
    renderController = controller;
    try {
      await onImportedData(imports, { ...options, signal: controller.signal });
      return !disposed && !controller.signal.aborted;
    } catch (error) {
      if (controller.signal.aborted) return false;
      setStatus(
        `Imported geometry could not be opened: ${error.message}`,
        'error',
      );
      return false;
    } finally {
      if (renderController === controller) renderController = null;
    }
  }
  const navTokenIsCurrent = (token) =>
    token == null || navigation?._navigationGeneration === token;

  for (const key of Object.keys(ANALYST_LAYERS)) {
    const option = document.createElement('option');
    option.value = key;
    option.textContent = key;
    option.selected = key === 'flights';
    queryLayers.append(option);
  }
  function updateQueryFields() {
    const layers = [...queryLayers.selectedOptions].map(
      (option) => option.value,
    );
    const fields = layers.length ? analystFieldsFor(layers) : [];
    const previousField = queryField.value;
    const previousSort = querySort.value;
    queryField.replaceChildren(new Option('No filter', ''));
    querySort.replaceChildren(new Option('Default ordering', ''));
    for (const field of fields) {
      queryField.append(new Option(field, field));
      querySort.append(new Option(field, field));
    }
    if (fields.includes(previousField)) queryField.value = previousField;
    if (fields.includes(previousSort)) querySort.value = previousSort;
  }
  queryLayers.addEventListener('change', updateQueryFields);
  updateQueryFields();
  function readQueryIntent() {
    const layers = [...queryLayers.selectedOptions].map(
      (option) => option.value,
    );
    if (!layers.length) throw new TypeError('Choose at least one query layer.');
    const filters = [];
    if (queryField.value) {
      const type = analystFieldType(layers, queryField.value);
      const raw = root.querySelector('[data-query-value]').value.trim();
      if (!raw)
        throw new TypeError('Enter a value for the selected filter field.');
      const value =
        type === 'number'
          ? Number(raw)
          : type === 'flag'
            ? raw.toLowerCase() === 'true'
            : raw;
      if (type === 'number' && !Number.isFinite(value))
        throw new TypeError('Numeric filter values must be valid numbers.');
      if (type === 'flag' && !['true', 'false'].includes(raw.toLowerCase()))
        throw new TypeError('Boolean filter values must be true or false.');
      filters.push({
        field: queryField.value,
        op: root.querySelector('[data-query-operator]').value,
        value,
      });
    }
    return {
      layers,
      scope: { kind: root.querySelector('[data-query-scope]').value },
      filters,
      sortBy: querySort.value || null,
      sortDir: root.querySelector('[data-query-direction]').value,
      limit: Number(root.querySelector('[data-query-limit]').value),
    };
  }
  function renderSavedQueries() {
    const values = parseSavedQueryList(active?.chunks?.savedQueries || []);
    savedQuerySelect.replaceChildren(
      new Option(
        values.length ? 'Choose a saved query' : 'No saved queries',
        '',
      ),
    );
    for (const item of values)
      savedQuerySelect.append(new Option(item.name, item.id));
  }
  async function persistWorkspace({
    chunks,
    pinnedEvidence = active?.pinnedEvidence,
  } = {}) {
    if (!active) throw new Error('Save or open a workspace first.');
    const owner = active;
    const saved = await library.save(
      snapshot(owner.title, { chunks, pinnedEvidence }),
      {
        id: owner.id,
        expectedRevision: owner.revision,
      },
    );
    if (active?.id === owner.id) {
      active.revision = saved.manifest.revision;
      active.chunks = saved.chunks || chunks || active.chunks;
      if (pinnedEvidence) active.pinnedEvidence = pinnedEvidence;
      await refresh();
    }
    return saved;
  }

  async function saveQuery() {
    try {
      if (!active)
        throw new Error('Save or open a workspace before saving query intent.');
      const existing = parseSavedQueryList(active.chunks?.savedQueries || []);
      const id = savedQuerySelect.value || `query-${now()}`;
      const query = parseSavedQuery({
        version: 1,
        id,
        name: root.querySelector('[data-query-name]').value,
        updatedAt: now(),
        query: readQueryIntent(),
      });
      const savedQueries = [
        ...existing.filter((item) => item.id !== id),
        query,
      ];
      const chunks = { ...active.chunks, savedQueries };
      await persistWorkspace({ chunks });
      savedQuerySelect.value = id;
      queryStatus.textContent = `Saved query “${query.name}” with explicit layer, filter, order and time intent.`;
    } catch (error) {
      queryStatus.textContent = `Query was not saved: ${error.message}`;
    }
  }

  function loadQuery() {
    const item = parseSavedQueryList(active?.chunks?.savedQueries || []).find(
      (query) => query.id === savedQuerySelect.value,
    );
    if (!item) {
      queryStatus.textContent = 'Choose a saved query to load.';
      return;
    }
    queryLayers.querySelectorAll('option').forEach((option) => {
      option.selected = item.query.layers.includes(option.value);
    });
    updateQueryFields();
    root.querySelector('[data-query-name]').value = item.name;
    root.querySelector('[data-query-scope]').value = item.query.scope.kind;
    queryField.value = item.query.filters[0]?.field || '';
    root.querySelector('[data-query-operator]').value =
      item.query.filters[0]?.op || 'eq';
    root.querySelector('[data-query-value]').value =
      item.query.filters[0]?.value ?? '';
    querySort.value = item.query.sortBy || '';
    root.querySelector('[data-query-direction]').value = item.query.sortDir;
    root.querySelector('[data-query-limit]').value = String(item.query.limit);
    queryStatus.textContent = `Loaded “${item.name}”. Review and edit the query before running.`;
  }

  function renderQueryResult(result, query) {
    queryResultHost.replaceChildren();
    if (!result?.ok) {
      queryStatus.textContent = result?.error || 'Query could not run.';
      return;
    }
    const metadata = result.resultMetadata || {};
    const coverage = metadata.records || {};
    const summary = document.createElement('p');
    summary.textContent = `${result.complete === false ? 'At least ' : ''}${result.count} matched; ${coverage.returned ?? 'unknown'} loaded records returned for inspection${coverage.truncated ? ' (source data was truncated)' : ''}. Scope: ${result.scopeLabel}. Time mode: ${metadata.sourceMode || 'unknown'} at ${metadata.investigationTime?.timeMs ? new Date(metadata.investigationTime.timeMs).toISOString() : 'unknown'}.`;
    queryResultHost.append(summary);
    const table = document.createElement('table');
    const head = document.createElement('thead');
    const header = document.createElement('tr');
    for (const label of [
      'Layer',
      'Record',
      'Coordinates',
      'Time',
      'Evidence',
    ]) {
      const cell = document.createElement('th');
      cell.textContent = label;
      header.append(cell);
    }
    head.append(header);
    table.append(head);
    const body = document.createElement('tbody');
    for (const record of result.items || []) {
      const row = document.createElement('tr');
      const values = [
        record.layerKey || '',
        record.id == null ? '' : String(record.id),
        Number.isFinite(record.lat) && Number.isFinite(record.lon)
          ? `${record.lat}, ${record.lon}`
          : 'not supplied',
        record.time || record.observedAt || 'unknown',
        record.evidence?.sourceId || 'record reference only',
      ];
      for (let index = 0; index < values.length; index++) {
        const cell = document.createElement('td');
        if (index === 4 && record.evidence?.entityRef?.id != null) {
          const inspect = document.createElement('button');
          inspect.type = 'button';
          inspect.textContent = 'INSPECT';
          inspect.setAttribute(
            'aria-label',
            `Inspect evidence for ${record.id}`,
          );
          inspect.addEventListener('click', () => {
            window.dispatchEvent(
              new CustomEvent('gev:evidence-record-opened', {
                detail: { evidence: record.evidence, record },
              }),
            );
          });
          cell.append(inspect, document.createTextNode(` ${values[index]}`));
        } else cell.textContent = values[index];
        row.append(cell);
      }
      body.append(row);
    }
    table.append(body);
    queryResultHost.append(table);
    const layers = document.createElement('p');
    layers.textContent = `Queried layers: ${(metadata.includedLayers || []).map((layer) => `${layer.layerKey} (${layer.status})`).join(', ') || query.layers.join(', ')}.`;
    queryResultHost.append(layers);
    queryStatus.textContent =
      'This result is a fixed snapshot. Editing the form does not change it; run again to capture a new result.';
  }

  async function runQuery() {
    if (!analystEngine) {
      queryStatus.textContent = 'The local query engine is unavailable.';
      return;
    }
    queryController?.abort('superseded-query');
    queryController = new AbortController();
    const controller = queryController;
    const generation = ++queryGeneration;
    try {
      const parsed = parseSavedQuery({
        version: 1,
        id: 'query-run',
        name: root.querySelector('[data-query-name]').value || 'Unsaved query',
        updatedAt: now(),
        query: readQueryIntent(),
      });
      queryStatus.textContent = 'Querying loaded records…';
      const result = await analystEngine.query(parsed.query, {
        signal: controller.signal,
      });
      if (controller.signal.aborted || generation !== queryGeneration) return;
      latestQueryResult = { result, query: parsed };
      renderQueryResult(result, parsed.query);
      if (!result.ok)
        queryStatus.textContent = result.error || 'Query unavailable.';
    } catch (error) {
      if (!controller.signal.aborted)
        queryStatus.textContent = `Query was not run: ${error.message}`;
    }
  }

  async function pinQueryResult() {
    if (!active || !latestQueryResult?.result?.ok) {
      queryStatus.textContent =
        'Run a successful query and save a workspace before pinning its result.';
      return;
    }
    const { result, query } = latestQueryResult;
    const metadata = result.resultMetadata || {};
    const captured = createEvidenceSnapshot({
      id: `${active.id}-query-${now()}`,
      title: `Query · ${query.name}`,
      capturedAt: metadata.investigationTime?.timeMs || now(),
      temporal: metadata.investigationTime,
      scope: query.query.scope,
      coverage: result.coverage,
      records: result.items,
      limitations: [
        ...(result.complete === false
          ? ['The source record set was truncated; count is a lower bound.']
          : []),
        'Query results describe the records held by the selected source layers at capture time.',
      ],
    });
    try {
      const pinnedEvidence = [
        ...(active.pinnedEvidence || []),
        {
          id: captured.id,
          sourceId: 'analyst_query',
          capturedAt: captured.capturedAt,
          snapshot: captured,
        },
      ];
      await persistWorkspace({ pinnedEvidence });
      queryStatus.textContent = `Pinned ${captured.records.length} query result records as an immutable evidence snapshot.`;
    } catch (error) {
      queryStatus.textContent = `Could not pin query result: ${error.message}`;
    }
  }

  async function showOfflineDemo() {
    const generation = ++openGeneration;
    invalidateWorkspaceOwnedPendingImport();
    restore.cancel('synthetic-demo');
    cancelImportRendering();
    applying = false;
    try {
      const view = shareLinkManager.getCurrentView();
      if (!view) throw new Error('Wait for the globe to finish loading.');
      const lat = Number.isFinite(view.camera?.lat) ? view.camera.lat : 0;
      const lon = Number.isFinite(view.camera?.lon) ? view.camera.lon : 0;
      const imports = [
        {
          id: 'synthetic-offline-demo',
          kind: 'synthetic-demo',
          sourceName: 'Generated in this browser; no live provider is used',
          attribution: 'Locally generated synthetic demonstration data.',
          coordinateReference: 'WGS84 longitude, latitude',
          accepted: 3,
          rejected: 0,
          records: [
            {
              id: 'demo-point-a',
              properties: { name: 'SYNTHETIC DEMO A', status: 'NOT LIVE' },
              geometry: { type: 'Point', coordinates: [lon, lat] },
            },
            {
              id: 'demo-point-b',
              properties: { name: 'SYNTHETIC DEMO B', status: 'NOT LIVE' },
              geometry: {
                type: 'Point',
                coordinates: [
                  Math.max(-179.9, Math.min(179.9, lon + 0.08)),
                  Math.max(-89.9, Math.min(89.9, lat + 0.05)),
                ],
              },
            },
            {
              id: 'demo-route',
              properties: { name: 'SYNTHETIC ROUTE · NOT LIVE' },
              geometry: {
                type: 'LineString',
                coordinates: [
                  [lon, lat],
                  [
                    Math.max(-179.9, Math.min(179.9, lon + 0.08)),
                    Math.max(-89.9, Math.min(89.9, lat + 0.05)),
                  ],
                ],
              },
            },
          ],
        },
      ];
      const saved = await library.save(
        snapshot('Synthetic offline demo', { chunks: { imports } }),
      );
      if (disposed || generation !== openGeneration) return;
      active = {
        id: saved.document.id,
        title: saved.document.title,
        revision: saved.manifest.revision,
        pinnedEvidence: [],
        chunks: { imports },
      };
      const owner = active;
      select.value = owner.id;
      await refresh();
      if (disposed || generation !== openGeneration || active?.id !== owner.id)
        return;
      if (!(await renderImportedData(imports, { workspaceId: owner.id })))
        return;
      setStatus(
        'Opened a local synthetic demo. These marks are generated examples, not live observations.',
        'warning',
      );
    } catch (error) {
      setStatus(`Offline demo could not start: ${error.message}`, 'error');
    }
  }
  const restore = createWorkspaceRestoreCoordinator({
    storage,
    inspectAvailability: async (document, { stored }) => {
      const missingAssets = (document.assetRefs || []).filter(
        (ref) => !stored.assets?.[ref.id],
      );
      const temporal = document.view.temporal;
      const missingRecording =
        temporal?.source === 'recording'
          ? !(await storage.getWorkspace(temporal.recordingId))
          : false;
      return [
        ...(missingAssets.length
          ? [{ kind: 'missing-assets', count: missingAssets.length }]
          : []),
        ...(missingRecording
          ? [{ kind: 'missing-recording', id: temporal.recordingId }]
          : []),
      ];
    },
    prepare: (document) => document,
    captureCurrent: async () => shareLinkManager.getCurrentView(),
    apply: async (document, { signal, availability, navigationToken }) => {
      signal?.throwIfAborted();
      const result = await shareLinkManager.applyView(document.view, {
        navigationToken,
      });
      if (signal?.aborted) throw signal.reason;
      const layers = await shareRestoration?.restoreWorkspaceView?.(
        document.view,
        { signal },
      );
      return { result, layers, availability };
    },
    rollback: async (view) => {
      if (view) {
        await shareLinkManager.applyView(view);
        await shareRestoration?.restoreWorkspaceView?.(view);
      }
    },
    isCurrent: (token) => navTokenIsCurrent(token),
  });

  function snapshot(
    title,
    {
      pinnedEvidence = active?.pinnedEvidence || [],
      chunks = active?.chunks || {},
    } = {},
  ) {
    const view = shareLinkManager.getCurrentView();
    if (!view) throw new Error('The current globe view is not ready to save.');
    return {
      title:
        title ||
        active?.title ||
        `Investigation ${new Date(now()).toLocaleDateString()}`,
      view,
      filters: {},
      annotations: [...view.annotations],
      pinnedEvidence,
      assetRefs: [],
      directorProjectRef: 'director-project-v1',
      chunks,
    };
  }

  function authoredSignature(view = shareLinkManager.getCurrentView()) {
    if (!view) return '';
    const { camera, ...authored } = view;
    return safeJson(authored);
  }

  function setStatus(message, state = 'info') {
    status.textContent = message;
    status.dataset.state = state;
  }

  function refreshHistoryControls() {
    root.querySelector('[data-action="undo"]').disabled = !history.canUndo();
    root.querySelector('[data-action="redo"]').disabled = !history.canRedo();
  }

  function queueHistory(view) {
    pendingHistoryView = view;
    clearTimeout(historyTimer);
    historyTimer = setTimeout(() => {
      historyTimer = null;
      if (!disposed && active && pendingHistoryView) {
        history.record(pendingHistoryView);
        refreshHistoryControls();
      }
      pendingHistoryView = null;
    }, 350);
  }

  async function travelHistory(direction) {
    if (!active)
      return setStatus(
        'Save or open a workspace before undo or redo.',
        'warning',
      );
    clearTimeout(historyTimer);
    clearTimeout(autosaveTimer);
    historyTimer = null;
    pendingHistoryView = null;
    const target = direction === 'undo' ? history.undo() : history.redo();
    if (!target) return;
    const currentView = shareLinkManager.getCurrentView();
    const owner = active;
    applying = true;
    try {
      await shareLinkManager.applyView({
        ...target,
        camera: currentView?.camera,
      });
      await shareRestoration?.restoreWorkspaceView?.(target);
      lastAuthoredSignature = authoredSignature();
      const saved = await library.save(snapshot(owner.title), {
        id: owner.id,
        expectedRevision: owner.revision,
      });
      if (active?.id === owner.id) {
        active.revision = saved.manifest.revision;
        await refresh();
      }
      setStatus(
        `${direction === 'undo' ? 'Undid' : 'Redid'} the authored change and saved revision ${saved.manifest.revision}.`,
        'saved',
      );
    } catch (error) {
      setStatus(
        `Could not ${direction} authored change: ${error.message}`,
        'error',
      );
    } finally {
      applying = false;
      refreshHistoryControls();
    }
  }

  async function refresh() {
    if (disposed) return;
    const rows = await library.list();
    const prior = active?.id || select.value;
    select.replaceChildren();
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = rows.length
      ? 'Choose an investigation'
      : 'No saved investigations';
    select.append(placeholder);
    for (const row of rows) {
      const option = document.createElement('option');
      option.value = row.id;
      option.textContent = `${row.title} · r${row.revision}`;
      select.append(option);
    }
    if (rows.some((row) => row.id === prior)) select.value = prior;
    const row = rows.find((item) => item.id === select.value);
    const stored = row ? await library.getWorkspace(row.id) : null;
    active = row
      ? {
          ...row,
          pinnedEvidence: stored?.document?.pinnedEvidence || [],
          chunks: stored?.chunks || {},
        }
      : null;
    invalidateWorkspaceOwnedPendingImport();
    syncImportApplyButton();
    history.bindWorkspace(active?.id, shareLinkManager.getCurrentView());
    refreshHistoryControls();
    renderSavedQueries();
    const points = active ? await library.history(active.id) : [];
    revisions.replaceChildren();
    const noRevision = document.createElement('option');
    noRevision.value = '';
    noRevision.textContent = points.length
      ? 'Choose a complete prior revision'
      : 'No prior revision';
    revisions.append(noRevision);
    for (const point of points) {
      const option = document.createElement('option');
      option.value = String(point.revision);
      option.textContent = `r${point.revision} · ${new Date(point.updatedAt).toLocaleString()}`;
      revisions.append(option);
    }
    const estimate = await library.estimate();
    usage.textContent =
      estimate?.usage != null && estimate?.quota != null
        ? `Local storage: ${Math.round(estimate.usage / 1024 / 1024)} MiB used of ${Math.round(estimate.quota / 1024 / 1024)} MiB.`
        : 'Local storage usage is unavailable in this browser.';
    lastAuthoredSignature = authoredSignature();
  }

  async function save({ as = false } = {}) {
    const title = as
      ? window.prompt('Name this investigation', active?.title || '')
      : active?.title ||
        window.prompt('Name this investigation', 'New investigation');
    if (title == null) return;
    applying = true;
    try {
      const saved = await library.save(
        snapshot(title),
        active && !as
          ? { id: active.id, expectedRevision: active.revision }
          : {},
      );
      active = {
        id: saved.document.id,
        title: saved.document.title,
        revision: saved.manifest.revision,
        pinnedEvidence: saved.document.pinnedEvidence,
        chunks: saved.chunks || {},
      };
      invalidateWorkspaceOwnedPendingImport();
      syncImportApplyButton();
      select.value = active.id;
      await refresh();
      setStatus(
        saved.saved
          ? `Saved “${active.title}” as complete revision ${active.revision}.`
          : `Saved in this session only. Browser storage is unavailable; export a backup before closing.`,
        saved.saved ? 'saved' : 'warning',
      );
    } catch (error) {
      if (error.code === 'revision-conflict')
        setStatus(
          'Another tab saved a newer revision. Open it again or use Save as to keep both versions.',
          'conflict',
        );
      else setStatus(`Save failed: ${error.message}`, 'error');
    } finally {
      applying = false;
    }
  }

  async function openSelected(revision = null) {
    const generation = ++openGeneration;
    invalidateWorkspaceOwnedPendingImport();
    const workspaceId = select.value;
    cancelImportRendering();
    if (!select.value)
      return setStatus('Choose an investigation first.', 'warning');
    setStatus('Opening investigation…');
    applying = true;
    const token = navigation?._beginDeferredNavigation?.('workspace restore', {
      cancelPendingSelection: false,
    });
    let result;
    try {
      result =
        revision == null
          ? await restore.restore(select.value, { navigationToken: token })
          : await (async () => {
              const record = await library.getWorkspace(select.value, {
                revision,
              });
              if (!record) return { status: 'missing' };
              const tempId = record.document.id;
              const current = await library.getWorkspace(tempId);
              if (!current) return { status: 'missing' };
              // Recovery writes a new current revision from the selected complete snapshot.
              const recovered = await library.recover(tempId, revision, {
                expectedRevision: current.manifest.revision,
              });
              return recovered
                ? restore.restore(tempId, { navigationToken: token })
                : { status: 'missing' };
            })();
    } finally {
      if (generation === openGeneration) applying = false;
    }
    if (
      disposed ||
      generation !== openGeneration ||
      select.value !== workspaceId
    )
      return;
    if (result.status === 'applied') {
      const row = (await library.list()).find(
        (item) => item.id === select.value,
      );
      const stored = row ? await library.getWorkspace(row.id) : null;
      if (
        disposed ||
        generation !== openGeneration ||
        select.value !== workspaceId
      )
        return;
      active = row
        ? {
            ...row,
            pinnedEvidence: stored?.document?.pinnedEvidence || [],
            chunks: stored?.chunks || {},
          }
        : active;
      invalidateWorkspaceOwnedPendingImport();
      syncImportApplyButton();
      if (
        disposed ||
        generation !== openGeneration ||
        select.value !== workspaceId
      )
        return;
      if (
        stored &&
        !(await renderImportedData(stored.chunks?.imports || [], {
          workspaceId,
        }))
      )
        return;
      history.reset(shareLinkManager.getCurrentView());
      refreshHistoryControls();
      lastAuthoredSignature = authoredSignature();
      const missing = result.availability?.map((item) => item.kind).join(', ');
      setStatus(
        missing
          ? `Opened with unavailable references: ${missing}.`
          : `Opened “${active?.title || 'investigation'}”.`,
      );
    } else
      setStatus(
        result.error?.message ||
          `Could not open investigation (${result.status}).`,
        'error',
      );
  }

  async function act(action) {
    if (action === 'save') return save();
    if (action === 'save-as') return save({ as: true });
    if (action === 'open') return openSelected();
    if (action === 'undo' || action === 'redo') return travelHistory(action);
    if (action === 'synthetic-demo') return showOfflineDemo();
    if (action === 'save-query') return saveQuery();
    if (action === 'load-query') return loadQuery();
    if (action === 'run-query') return runQuery();
    if (action === 'pin-query-result') return pinQueryResult();
    if (!select.value)
      return setStatus('Choose an investigation first.', 'warning');
    if (action === 'duplicate') {
      const generation = ++openGeneration;
      restore.cancel('workspace-duplicate');
      cancelImportRendering();
      applying = false;
      const copy = await library.duplicate(select.value);
      if (disposed || generation !== openGeneration) return;
      if (copy) {
        active = {
          id: copy.document.id,
          title: copy.document.title,
          revision: 1,
        };
        invalidateWorkspaceOwnedPendingImport();
        syncImportApplyButton();
        const owner = active;
        await refresh();
        if (
          disposed ||
          generation !== openGeneration ||
          active?.id !== owner.id
        )
          return;
        select.value = owner.id;
        const stored = await library.getWorkspace(owner.id);
        if (
          disposed ||
          generation !== openGeneration ||
          active?.id !== owner.id
        )
          return;
        active.chunks = stored?.chunks || {};
        if (
          !(await renderImportedData(active.chunks.imports || [], {
            workspaceId: active.id,
          }))
        )
          return;
        setStatus(`Created “${active.title}”.`);
      }
    } else if (action === 'delete') {
      if (
        !window.confirm(
          'Delete this saved investigation and its workspace-owned assets? This cannot be undone.',
        )
      )
        return;
      await library.remove(select.value, {
        expectedRevision: active?.revision,
      });
      history.forget(select.value);
      history.bindWorkspace(null);
      active = null;
      invalidateWorkspaceOwnedPendingImport();
      syncImportApplyButton();
      await refresh();
      if (!(await renderImportedData([], { workspaceId: null }))) return;
      setStatus('Investigation deleted.');
    } else if (action === 'export') {
      const backup = await library.exportBackup(select.value);
      if (backup)
        downloadText(
          `${active?.title || 'investigation'}.gev-workspace.json`,
          backup,
        );
    } else if (action === 'recover') {
      if (!revisions.value)
        return setStatus('Choose a complete prior revision first.', 'warning');
      await openSelected(Number(revisions.value));
      setStatus(
        'Recovered the selected complete revision as a new current revision.',
      );
    } else if (action === 'pin-a' || action === 'pin-b') {
      await pinEvidence(action === 'pin-a' ? 'A' : 'B');
    } else if (action === 'compare') {
      showComparison();
    } else if (action.startsWith('report-')) {
      const format = action.slice('report-'.length);
      if (!latestComparison) showComparison();
      if (latestComparison) {
        const content = exportEvidenceComparison(latestComparison, { format });
        const extension = format === 'markdown' ? 'md' : format;
        const type =
          format === 'csv'
            ? 'text/csv'
            : format === 'markdown'
              ? 'text/markdown'
              : 'application/json';
        downloadText(`evidence-comparison.${extension}`, content, type);
      }
    } else if (action === 'preview-import') {
      await previewStagedImport();
    } else if (action === 'apply-import') {
      await applyStagedImport();
    } else if (action === 'cancel-import') {
      cancelStagedImport();
    }
  }

  function selectedCsvMapping() {
    const result = {};
    for (const field of ['latitude', 'longitude', 'id', 'time']) {
      const value = root.querySelector(`[data-column="${field}"]`).value;
      if (value) result[field] = value;
    }
    return result;
  }

  function showPreview(preview, owner) {
    if (!importOwnerIsCurrent(owner)) return;
    // Once file contents have been previewed, they belong to the import form,
    // not to the workspace that happened to be open when the file was read.
    stagedImportOwner = importReadOwner.begin(owner.file);
    stagedPreview = preview;
    importReview.hidden = false;
    const bounds =
      preview.bounds?.map((value) => Number(value.toFixed(4))).join(', ') ||
      'none';
    const rejected = preview.rejectedRows.length
      ? ` First rejected row: ${preview.rejectedRows[0].row} — ${preview.rejectedRows[0].reason}`
      : '';
    const timeRange = preview.timeRange
      ? ` Time range: ${new Date(preview.timeRange[0]).toISOString()} — ${new Date(preview.timeRange[1]).toISOString()}.`
      : '';
    const warnings = preview.warnings?.length
      ? ` Notes: ${preview.warnings.join(' ')}`
      : '';
    importSummary.textContent = `${preview.accepted} accepted, ${preview.rejected} rejected. Bounds [west, south, east, north]: ${bounds}. ${preview.timeInterpretation}${timeRange}${warnings}${rejected}`;
    syncImportApplyButton();
    importStatus.textContent = active
      ? 'Review counts, bounds, time interpretation, and attribution, then choose Apply to save this layer.'
      : 'Preview ready. Open or save a workspace before applying the import.';
  }

  async function previewStagedImport() {
    const owner = stagedImportOwner;
    if (
      !stagedText ||
      !stagedFile ||
      !owner ||
      owner.file !== stagedFile ||
      !importOwnerIsCurrent(owner)
    )
      return;
    const text = stagedText;
    const file = stagedFile;
    stagedPreview = null;
    importReview.hidden = true;
    importSummary.textContent = '';
    syncImportApplyButton();
    importStatus.textContent = 'Preparing import preview…';
    importController?.abort('superseded-preview');
    importController = new AbortController();
    const signal = importController.signal;
    const attribution = root.querySelector('[data-attribution]').value;
    try {
      const extension = file.name.split('.').at(-1).toLowerCase();
      const preview =
        extension === 'csv'
          ? await previewCSV(text, {
              signal,
              attribution,
              mapping: selectedCsvMapping(),
            })
          : extension === 'kml'
            ? await previewKML(text, { signal, attribution })
            : extension === 'gpx'
              ? await previewGPX(text, { signal, attribution })
              : await previewGeoJSON(text, { signal, attribution });
      if (!signal.aborted && importOwnerIsCurrent(owner))
        showPreview(preview, owner);
    } catch (error) {
      if (signal.aborted || !importOwnerIsCurrent(owner)) return;
      importStatus.textContent = `Preview failed: ${error.message}`;
      stagedPreview = null;
      importReview.hidden = true;
      syncImportApplyButton();
    }
  }

  async function applyStagedImport() {
    if (!active || !stagedPreview?.accepted || applyingImport) return;
    applyingImport = true;
    applyImportButton.disabled = true;
    const cancelButton = root.querySelector('[data-action="cancel-import"]');
    cancelButton.disabled = true;
    const previewOwner = stagedPreview;
    const inputOwner = stagedImportOwner;
    const inputGeneration = importInputGeneration;
    const owner = active;
    const generation = openGeneration;
    const current = () =>
      !disposed && generation === openGeneration && active?.id === owner.id;
    const entry = {
      id: `import-${now()}`,
      kind: stagedPreview.kind,
      sourceName: stagedFile?.name || 'local file',
      attribution: stagedPreview.attribution,
      coordinateReference: stagedPreview.coordinateReference,
      timeField: stagedPreview.timeField,
      timeInterpretation: stagedPreview.timeInterpretation,
      accepted: stagedPreview.accepted,
      rejected: stagedPreview.rejected,
      rejectedRows: stagedPreview.rejectedRows,
      bounds: stagedPreview.bounds,
      timeRange: stagedPreview.timeRange,
      records: stagedPreview.records,
    };
    const chunks = {
      ...(active.chunks || {}),
      imports: [...(active.chunks?.imports || []), entry],
    };
    try {
      const result = await library.save(snapshot(active.title, { chunks }), {
        id: active.id,
        expectedRevision: active.revision,
      });
      if (!current()) return;
      active.revision = result.manifest.revision;
      active.chunks = chunks;
      const stillOwnsInput =
        stagedImportOwner === inputOwner && stagedPreview === previewOwner;
      let completionGeneration = inputGeneration;
      if (stillOwnsInput) {
        importReview.hidden = true;
        geoFile.value = '';
        stagedFile = stagedText = stagedPreview = null;
        stagedImportOwner = null;
        importReadOwner.invalidate();
        completionGeneration = ++importInputGeneration;
      }
      await refresh();
      if (!current()) return;
      if (
        !(await renderImportedData(chunks.imports, { workspaceId: owner.id }))
      )
        return;
      if (!current()) return;
      if (stillOwnsInput && importInputGeneration === completionGeneration)
        importStatus.textContent = `Imported ${entry.accepted} features in workspace revision ${active.revision}.`;
    } catch (error) {
      if (!current()) return;
      if (
        stagedImportOwner === inputOwner &&
        importInputGeneration === inputGeneration
      )
        importStatus.textContent =
          error.code === 'revision-conflict'
            ? 'Import was not applied because another tab saved a newer revision. Reopen the workspace and preview again.'
            : `Import was not applied: ${error.message}`;
    } finally {
      applyingImport = false;
      cancelButton.disabled = false;
      syncImportApplyButton();
    }
  }

  function cancelStagedImport() {
    if (applyingImport) return;
    resetStagedImport({
      status: 'Import cancelled. The workspace was not changed.',
      clearFile: true,
    });
  }

  geoFile.addEventListener('change', async () => {
    const file = geoFile.files?.[0];
    resetStagedImport({ clearFile: !file });
    if (!file) {
      importStatus.textContent = '';
      return;
    }
    if (file.size > IMPORT_LIMITS.bytes) {
      importStatus.textContent = `Import files are limited to ${IMPORT_LIMITS.bytes / 1024 / 1024} MiB.`;
      return;
    }
    const owner = importReadOwner.begin(file, {
      workspaceId: active?.id ?? null,
      workspaceGeneration: openGeneration,
    });
    stagedImportOwner = owner;
    stagedFile = file;
    importStatus.textContent = 'Reading import file…';
    try {
      const read = await readOwnedWorkspaceFile(file, () =>
        importOwnerIsCurrent(owner),
      );
      if (read.status === 'superseded') return;
      if (read.status === 'failed') throw read.error;
      if (!importOwnerIsCurrent(owner)) return;
      stagedText = read.text;
      const extension = owner.file.name.split('.').at(-1).toLowerCase();
      if (extension === 'csv') {
        const { headers } = parseCsv(read.text);
        if (!importOwnerIsCurrent(owner)) return;
        for (const field of ['latitude', 'longitude', 'id', 'time']) {
          const selectColumn = root.querySelector(`[data-column="${field}"]`);
          selectColumn.replaceChildren();
          const blank = document.createElement('option');
          blank.value = '';
          blank.textContent =
            field === 'latitude' || field === 'longitude'
              ? 'Choose a column'
              : 'No mapping';
          selectColumn.append(blank);
          for (const header of headers) {
            const option = document.createElement('option');
            option.value = header;
            option.textContent = header;
            selectColumn.append(option);
          }
          const lower = headers.map((header) => header.trim().toLowerCase());
          const preferred =
            field === 'latitude'
              ? ['latitude', 'lat']
              : field === 'longitude'
                ? ['longitude', 'lon', 'lng']
                : field === 'id'
                  ? ['id', 'identifier']
                  : ['time', 'timestamp', 'observed_at', 'datetime'];
          const match = preferred
            .map((name) => lower.indexOf(name))
            .find((index) => index >= 0);
          if (match >= 0) selectColumn.value = headers[match];
        }
        csvMapping.hidden = false;
        importStatus.textContent =
          'Map latitude and longitude columns explicitly, then preview. Dates must include a UTC offset.';
      } else {
        csvMapping.hidden = true;
        await previewStagedImport();
      }
    } catch (error) {
      if (!importOwnerIsCurrent(owner)) return;
      resetStagedImport({
        status: `Could not read file: ${error.message}`,
      });
    }
  });

  async function pinEvidence(slot) {
    if (!active)
      return setStatus(
        'Save or open a workspace before pinning comparison evidence.',
        'warning',
      );
    if (
      !latestEvidence?.entityRef?.layerKey ||
      latestEvidence.entityRef.id == null
    )
      return setStatus(
        'Select a record with an evidence reference first.',
        'warning',
      );
    try {
      const view = shareLinkManager.getCurrentView();
      const captured = createEvidenceSnapshot({
        id: `${active.id}-comparison-${slot}-${now()}`,
        title: `${slot} · ${latestEvidence.entityRef.layerKey}:${latestEvidence.entityRef.id}`,
        capturedAt: now(),
        temporal: view?.temporal,
        scope: { layers: view?.layers || [], map: view?.map || null },
        coverage: latestEvidence.coverage,
        records: [latestEvidence],
        sourceLinks: [latestEvidence.sourceUrl].filter(Boolean),
        limitations: latestEvidence.limitations,
      });
      const pinnedEvidence = (active.pinnedEvidence || []).filter(
        (item) => item.slot !== slot,
      );
      pinnedEvidence.push({
        id: `comparison-${slot}`,
        slot,
        sourceId: latestEvidence.sourceId || latestEvidence.entityRef.layerKey,
        capturedAt: captured.capturedAt,
        snapshot: captured,
      });
      const saved = await library.save(
        snapshot(active.title, { pinnedEvidence }),
        {
          id: active.id,
          expectedRevision: active.revision,
        },
      );
      active.revision = saved.manifest.revision;
      active.pinnedEvidence = pinnedEvidence;
      await refresh();
      root.querySelector('[data-comparison-source]').textContent =
        `Pinned selected evidence as ${slot}.`;
      setStatus(
        `Pinned evidence ${slot} in workspace revision ${active.revision}.`,
        'saved',
      );
    } catch (error) {
      setStatus(`Could not pin evidence: ${error.message}`, 'error');
    }
  }

  function showComparison() {
    const a = active?.pinnedEvidence?.find(
      (item) => item.slot === 'A',
    )?.snapshot;
    const b = active?.pinnedEvidence?.find(
      (item) => item.slot === 'B',
    )?.snapshot;
    if (!a || !b) {
      setStatus(
        'Pin evidence A and B from selected records before comparing.',
        'warning',
      );
      return;
    }
    latestComparison = compareEvidenceSnapshots(a, b);
    const host = root.querySelector('[data-comparison-results]');
    host.replaceChildren();
    const table = document.createElement('table');
    table.innerHTML =
      '<thead><tr><th>Change</th><th>Entity</th><th>Interpretation</th></tr></thead>';
    const body = document.createElement('tbody');
    for (const row of latestComparison.rows) {
      const tr = document.createElement('tr');
      for (const value of [row.status, row.key, row.explanation || '']) {
        const td = document.createElement('td');
        td.textContent = value;
        tr.append(td);
      }
      body.append(tr);
    }
    table.append(body);
    host.append(table);
    setStatus(
      `Compared ${latestComparison.rows.length} evidence records. Uncovered absence is labeled not observed.`,
      'saved',
    );
  }

  root.addEventListener('click', (event) => {
    const button = event.target.closest('[data-action]');
    if (button) void act(button.dataset.action);
  });
  select.addEventListener('change', () => {
    openGeneration++;
    restore.cancel('workspace-selection-changed');
    cancelImportRendering();
    applying = false;
    active = null;
    invalidateWorkspaceOwnedPendingImport();
    syncImportApplyButton();
    lastAuthoredSignature = authoredSignature();
  });
  root
    .querySelector('[data-import]')
    .addEventListener('change', async (event) => {
      const file = event.target.files?.[0];
      if (!file) return;
      try {
        if (file.size > 50 * 1024 * 1024)
          throw new Error('Backup exceeds the 50 MiB limit.');
        const imported = await library.importBackup(await file.text());
        await refresh();
        select.value = imported.document.id;
        setStatus(`Imported “${imported.document.title}”.`);
      } catch (error) {
        setStatus(`Import failed: ${error.message}`, 'error');
      } finally {
        event.target.value = '';
      }
    });
  const unsubscribe = shareLinkManager.subscribeViewChanges((view) => {
    if (disposed || applying || !active) return;
    const signature = authoredSignature(view);
    if (!signature || signature === lastAuthoredSignature) return;
    lastAuthoredSignature = signature;
    queueHistory(view);
    clearTimeout(autosaveTimer);
    autosaveTimer = setTimeout(async () => {
      if (disposed || applying || !active) return;
      const owner = active;
      try {
        const saved = await library.save(snapshot(owner.title), {
          id: owner.id,
          expectedRevision: owner.revision,
        });
        if (active?.id !== owner.id) return;
        active.revision = saved.manifest.revision;
        await refresh();
        setStatus(
          saved.saved
            ? `Autosaved revision ${active.revision}.`
            : 'Changes are only in this session; export a backup before closing.',
          saved.saved ? 'saved' : 'warning',
        );
      } catch (error) {
        setStatus(
          error.code === 'revision-conflict'
            ? 'Autosave paused because another tab saved a newer revision. Open it again or use Save as.'
            : `Autosave failed: ${error.message}`,
          error.code === 'revision-conflict' ? 'conflict' : 'error',
        );
      }
    }, 1_000);
  });
  const onEvidence = (event) => {
    const evidence =
      event.detail?.evidence || event.detail?.record?.evidence || event.detail;
    if (!evidence?.entityRef?.layerKey) return;
    latestEvidence = evidence;
    root.querySelector('[data-comparison-source]').textContent =
      `Selected evidence: ${evidence.entityRef.layerKey}:${evidence.entityRef.id}.`;
  };
  const evidenceEvents = [
    'gev:evidence-updated',
    'gev:evidence-result-pinned',
    'gev:evidence-record-opened',
    'gev:entity-selected',
  ];
  for (const name of evidenceEvents) window.addEventListener(name, onEvidence);
  const onHistoryShortcut = (event) => {
    if (
      !(event.ctrlKey || event.metaKey) ||
      !['z', 'y'].includes(event.key.toLowerCase())
    )
      return;
    if (
      event.target?.matches?.('input,textarea,select,[contenteditable="true"]')
    )
      return;
    const direction =
      event.key.toLowerCase() === 'y' || event.shiftKey ? 'redo' : 'undo';
    if (direction === 'undo' ? !history.canUndo() : !history.canRedo()) return;
    event.preventDefault();
    void travelHistory(direction);
  };
  document.addEventListener('keydown', onHistoryShortcut);
  void refresh().catch((error) =>
    setStatus(`Workspace library unavailable: ${error.message}`, 'error'),
  );

  return Object.freeze({
    library,
    restore,
    refresh,
    saveCurrent: () => save(),
    undo: () => travelHistory('undo'),
    redo: () => travelHistory('redo'),
    canUndo: () => history.canUndo(),
    canRedo: () => history.canRedo(),
    showOfflineDemo,
    openLibrary() {
      root.open = true;
      root.querySelector('summary').focus();
    },
    destroy() {
      if (disposed) return;
      disposed = true;
      openGeneration++;
      cancelImportRendering();
      resetStagedImport({ clearFile: true });
      clearTimeout(autosaveTimer);
      clearTimeout(historyTimer);
      queryController?.abort('panel-destroyed');
      unsubscribe();
      document.removeEventListener('keydown', onHistoryShortcut);
      for (const name of evidenceEvents)
        window.removeEventListener(name, onEvidence);
      restore.destroy();
      root.remove();
    },
  });
}
