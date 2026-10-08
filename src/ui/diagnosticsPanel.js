import {
  createDiagnosticsReport,
  createSettingsBackup,
  parseSettingsBackup,
} from '../diagnostics/portable.js';

function download(name, value) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }),
  );
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/** On-demand report and allowlisted settings backup UI; never sends telemetry. */
export function createDiagnosticsPanel({
  container,
  collect,
  getSettings,
  applySettings,
} = {}) {
  if (
    !container ||
    typeof collect !== 'function' ||
    typeof getSettings !== 'function' ||
    typeof applySettings !== 'function'
  )
    throw new TypeError('Diagnostics panel dependencies are required.');
  const root = document.createElement('details');
  root.className = 'gev-diagnostics';
  root.innerHTML = `
    <summary>DIAGNOSTICS &amp; SETTINGS</summary>
    <div class="gev-diagnostics-body">
      <p>Reports are created on demand and stay on this device until you download them. Credentials, transcripts, headers and local paths are excluded.</p>
      <div class="workspace-library-actions">
        <button type="button" data-action="preview-report">PREVIEW DIAGNOSTICS</button>
        <button type="button" data-action="export-report" disabled>DOWNLOAD REPORT</button>
        <button type="button" data-action="export-settings">EXPORT SETTINGS</button>
      </div>
      <label>Import settings backup <input data-settings-file type="file" accept="application/json,.json" /></label>
      <div data-settings-review hidden>
        <p data-settings-summary></p>
        <button type="button" data-action="apply-settings" disabled>APPLY SETTINGS</button>
        <button type="button" data-action="cancel-settings">CANCEL</button>
      </div>
      <p data-status role="status" aria-live="polite">No diagnostic report has been collected.</p>
      <pre data-preview hidden aria-label="Sanitized diagnostics preview"></pre>
    </div>`;
  container.append(root);
  const status = root.querySelector('[data-status]');
  const preview = root.querySelector('[data-preview]');
  const reportButton = root.querySelector('[data-action="export-report"]');
  const settingsInput = root.querySelector('[data-settings-file]');
  const settingsReview = root.querySelector('[data-settings-review]');
  const settingsSummary = root.querySelector('[data-settings-summary]');
  const applyButton = root.querySelector('[data-action="apply-settings"]');
  let report = null;
  let stagedSettings = null;
  let disposed = false;

  async function act(action) {
    try {
      if (action === 'preview-report') {
        report = createDiagnosticsReport(await collect());
        preview.textContent = JSON.stringify(report, null, 2);
        preview.hidden = false;
        reportButton.disabled = false;
        status.textContent = 'Sanitized local diagnostics are ready to review.';
      } else if (action === 'export-report') {
        if (!report) return;
        download('gev-diagnostics.json', report);
        status.textContent = 'Downloaded the previewed diagnostics report.';
      } else if (action === 'export-settings') {
        download(
          'gev-settings.json',
          createSettingsBackup(await getSettings()),
        );
        status.textContent =
          'Downloaded allowlisted preferences. Workspace data is a separate export.';
      } else if (action === 'apply-settings') {
        if (!stagedSettings) return;
        await applySettings(stagedSettings);
        stagedSettings = null;
        settingsReview.hidden = true;
        settingsInput.value = '';
        status.textContent =
          'Settings were applied after full-file validation.';
      } else if (action === 'cancel-settings') {
        stagedSettings = null;
        settingsReview.hidden = true;
        settingsInput.value = '';
        status.textContent =
          'Settings import cancelled; current settings were not changed.';
      }
    } catch (error) {
      status.textContent = `${action === 'apply-settings' ? 'Settings were not applied' : 'Action failed'}: ${error.message}`;
    }
  }

  root.addEventListener('click', (event) => {
    const button = event.target.closest('[data-action]');
    if (button) void act(button.dataset.action);
  });
  settingsInput.addEventListener('change', async () => {
    const file = settingsInput.files?.[0];
    if (!file) return;
    stagedSettings = null;
    settingsReview.hidden = true;
    applyButton.disabled = true;
    try {
      if (file.size > 128 * 1024)
        throw new RangeError('Settings backup exceeds 128 KiB.');
      stagedSettings = parseSettingsBackup(await file.text());
      const sourceCount = stagedSettings.sourceSelections.length;
      settingsSummary.textContent = `Validated version ${stagedSettings.version}: ${sourceCount} source selections, ${Object.keys(stagedSettings.visualPreferences).length} visual preferences, ${stagedSettings.units.distance}/${stagedSettings.units.speed}/${stagedSettings.units.temperature} units. Applying replaces only these settings.`;
      settingsReview.hidden = false;
      applyButton.disabled = false;
      status.textContent =
        'Review the allowlisted settings, then explicitly apply or cancel.';
    } catch (error) {
      settingsInput.value = '';
      status.textContent = `Settings backup rejected without changes: ${error.message}`;
    }
  });
  return Object.freeze({
    root,
    destroy() {
      if (disposed) return;
      disposed = true;
      report = null;
      stagedSettings = null;
      root.remove();
    },
  });
}
