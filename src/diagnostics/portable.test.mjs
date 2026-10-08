import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createDiagnosticsReport,
  createSettingsBackup,
  parseSettingsBackup,
  sanitizeDiagnosticText,
} from './portable.js';

test('settings backups keep only allowlisted preferences and migrate prototype version zero', () => {
  const backup = createSettingsBackup({
    units: { distance: 'mi', speed: 'knots', temperature: 'f' },
    visualPreferences: { style: 'normal', bloom: true },
    sourceSelections: ['flights', 'earthquakes'],
    credentialsPresent: { openAi: true },
    apiKey: 'must-not-be-exported',
  });
  assert.equal('apiKey' in backup, false);
  assert.equal(JSON.stringify(backup).includes('must-not-be-exported'), false);
  assert.equal(
    parseSettingsBackup(JSON.stringify(backup)).units.distance,
    'mi',
  );
  assert.equal(
    parseSettingsBackup({
      version: 0,
      units: { distance: 'km' },
      sourceSelections: [],
    }).version,
    1,
  );
});

test('invalid secrets, URLs, and partial settings are rejected before application', () => {
  assert.throws(
    () =>
      parseSettingsBackup({ ...createSettingsBackup(), apiKey: 'sk-secret' }),
    /unsupported field/,
  );
  assert.throws(
    () =>
      createSettingsBackup({
        sourceSelections: ['https://user:pass@example.test'],
      }),
    /identifiers/,
  );
  assert.throws(
    () => createSettingsBackup({ units: { distance: 'parsec' } }),
    /units/,
  );
});

test('diagnostics redact secret canaries and local paths and expose bounded operational fields only', () => {
  assert.equal(
    sanitizeDiagnosticText(
      'failed with api_key=canary-secret C:\\Users\\Alice\\private.txt',
    ),
    'failed with [redacted] [local path]',
  );
  const report = createDiagnosticsReport({
    generatedAt: 1,
    appVersion: '0.2.1',
    renderer: 'WebGL2',
    capabilities: { webgl2: true },
    storage: { usageBytes: 12, quotaBytes: 100, availability: 'indexeddb' },
    feeds: [
      {
        id: 'flights',
        enabled: true,
        state: 'stale',
        source: 'OpenSky',
        error: 'Bearer secret-token',
      },
    ],
    errors: [
      {
        timestamp: '2026-01-01',
        source: 'voice',
        message: 'apiKey=secret-canary and C:\\Users\\A\\file',
      },
    ],
    transcript: 'private transcript',
  });
  const text = JSON.stringify(report);
  assert.equal(text.includes('secret-token'), false);
  assert.equal(text.includes('secret-canary'), false);
  assert.equal(text.includes('transcript'), false);
  assert.match(text, /\[local path\]/);
  assert.equal(report.feeds[0].state, 'stale');
});
