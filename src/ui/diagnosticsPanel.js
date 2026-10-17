import {
  createDiagnosticsReport,
  createSettingsBackup,
  parseSettingsBackup,
} from '../diagnostics/portable.js';
import { applyDocumentTranslations } from '../i18n/index.js';
import { t } from '../i18n/index.js';

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
    <summary data-i18n>DIAGNOSTICS &amp; SETTINGS</summary>
    <div class="gev-diagnostics-body">
      <p data-i18n>Reports are created on demand and stay on this device until you download them. Credentials, transcripts, headers and local paths are excluded.</p>
      <div class="workspace-library-actions">
        <button type="button" data-action="preview-report" data-i18n>PREVIEW DIAGNOSTICS</button>
        <button type="button" data-action="export-report" disabled data-i18n>DOWNLOAD REPORT</button>
        <button type="button" data-action="export-settings" data-i18n>EXPORT SETTINGS</button>
      </div>
      <label><span data-i18n>Import settings backup</span> <input data-settings-file type="file" accept="application/json,.json" /></label>
      <div data-settings-review hidden>
        <p data-settings-summary></p>
        <button type="button" data-action="apply-settings" disabled data-i18n>APPLY SETTINGS</button>
        <button type="button" data-action="cancel-settings" data-i18n>CANCEL</button>
      </div>
      <p data-status role="status" aria-live="polite" data-i18n>No diagnostic report has been collected.</p>
      <pre data-preview hidden aria-label="Sanitized diagnostics preview" data-i18n-aria-label></pre>
    </div>`;
  applyDocumentTranslations(root);
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
        status.textContent = t(
          'Sanitized local diagnostics are ready to review.',
        );
      } else if (action === 'export-report') {
        if (!report) return;
        download('gev-diagnostics.json', report);
        status.textContent = t('Downloaded the previewed diagnostics report.');
      } else if (action === 'export-settings') {
        download(
          'gev-settings.json',
          createSettingsBackup(await getSettings()),
        );
        status.textContent = t(
          'Downloaded allowlisted preferences. Workspace data is a separate export.',
        );
      } else if (action === 'apply-settings') {
        if (!stagedSettings) return;
        await applySettings(stagedSettings);
        stagedSettings = null;
        settingsReview.hidden = true;
        settingsInput.value = '';
        status.textContent = t(
          'Settings were applied after full-file validation.',
        );
      } else if (action === 'cancel-settings') {
        stagedSettings = null;
        settingsReview.hidden = true;
        settingsInput.value = '';
        status.textContent = t(
          'Settings import cancelled; current settings were not changed.',
        );
      }
    } catch (error) {
      status.textContent = t('{action}: {error}', {
        action: t(
          action === 'apply-settings'
            ? 'Settings were not applied'
            : 'Action failed',
        ),
        error: error.message,
      });
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
      settingsSummary.textContent = t(
        'Validated version {version}: {sources} source selections, {visuals} visual preferences, {distance}/{speed}/{temperature} units. Applying replaces only these settings.',
        {
          version: stagedSettings.version,
          sources: sourceCount,
          visuals: Object.keys(stagedSettings.visualPreferences).length,
          distance: stagedSettings.units.distance,
          speed: stagedSettings.units.speed,
          temperature: stagedSettings.units.temperature,
        },
      );
      settingsReview.hidden = false;
      applyButton.disabled = false;
      status.textContent = t(
        'Review the allowlisted settings, then explicitly apply or cancel.',
      );
    } catch (error) {
      settingsInput.value = '';
      status.textContent = t(
        'Settings backup rejected without changes: {error}',
        {
          error: error.message,
        },
      );
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
