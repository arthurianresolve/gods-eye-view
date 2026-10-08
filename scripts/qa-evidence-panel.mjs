#!/usr/bin/env node
/** Browser acceptance for the synthetic, selected-aircraft evidence panel. */
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer';

const args = process.argv.slice(2);
const at = args.indexOf('--url');
const url = at >= 0 ? args[at + 1] : 'http://localhost:4173';
const browser = await puppeteer.launch({
  headless: true,
  executablePath:
    process.env.PUPPETEER_EXECUTABLE_PATH || (await puppeteer.executablePath()),
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});

try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.setViewport({ width: 1440, height: 900 });
  await page.goto(`${url}/?welcome=0`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(
    () =>
      !!window.__godsEyeView?.styleManager &&
      !!document.getElementById('evidence-panel'),
    { timeout: 60_000 },
  );
  await page.waitForFunction(
    () =>
      document.getElementById('loading-screen')?.classList.contains('hidden'),
    { timeout: 60_000 },
  );
  await page.waitForFunction(
    () => typeof window.__gevVoiceCommands?.voiceCard?.handle === 'function',
    { timeout: 60_000 },
  );
  await page.evaluate(() => {
    const focus = document.createElement('button');
    focus.id = 'qa-evidence-focus-return';
    focus.textContent = 'Focus return target';
    document.body.append(focus);
    focus.focus();
    window.dispatchEvent(
      new CustomEvent('gev:awareness-subject-selected', {
        detail: {
          layerId: 'flights',
          id: 'abc123',
          label: 'Synthetic TEST123',
          evidence: {
            version: 1,
            entityRef: { layerKey: 'flights', id: 'abc123' },
            sourceId: 'Synthetic source',
            sourceUrl: 'https://example.test/records?token=secret',
            observedAt: Date.UTC(2026, 0, 15, 12),
            receivedAt: Date.UTC(2026, 0, 15, 12, 0, 2),
            snapshotAt: Date.UTC(2026, 0, 15, 12, 0, 1),
            method: 'observed',
            displayMethod: 'interpolated',
            coverage: { area: 'Austin · fixture', completeness: 'partial' },
            limitations: ['Synthetic fixture only'],
          },
        },
      }),
    );
  });
  await page.waitForFunction(
    () => !document.getElementById('evidence-panel').hidden,
  );
  const first = await page.evaluate(() => {
    const panel = document.getElementById('evidence-panel');
    const value = (name) =>
      panel.querySelector(`[data-evidence-value="${name}"]`)?.textContent;
    return {
      expanded: !panel.classList.contains('collapsed'),
      subject: value('subject'),
      observed: value('observed'),
      received: value('received'),
      display: value('display'),
      coverage: value('coverage'),
      sourceUrl: panel.querySelector('[data-evidence-value="source"] a')?.href,
      technical: panel.querySelector('.evidence-panel-technical')?.open,
      secretVisible: panel.textContent.includes('secret'),
    };
  });
  assert.equal(first.expanded, true);
  assert.equal(first.subject, 'Synthetic TEST123');
  assert.match(first.observed, /2026-01-15T12:00:00/);
  assert.match(first.received, /2026-01-15T12:00:02/);
  assert.equal(first.display, 'interpolated');
  assert.match(first.coverage, /partial/);
  assert.equal(first.sourceUrl, 'https://example.test/records');
  assert.equal(first.secretVisible, false);

  await page.evaluate(() => {
    const panel = document.getElementById('evidence-panel');
    const body = panel.querySelector('[data-panel-body]');
    const technical = panel.querySelector('.evidence-panel-technical');
    body.style.maxHeight = '120px';
    body.style.overflow = 'auto';
    technical.open = true;
    body.scrollTop = 17;
    window.dispatchEvent(
      new CustomEvent('gev:awareness-subject-selected', {
        detail: {
          label: 'Synthetic TEST123 refreshed',
          evidence: {
            entityRef: { layerKey: 'flights', id: 'abc123' },
            sourceId: 'Synthetic source',
            observedAt: Date.UTC(2026, 0, 15, 12),
            receivedAt: Date.UTC(2026, 0, 15, 12, 0, 3),
            method: 'observed',
            displayMethod: 'predicted',
          },
        },
      }),
    );
  });
  const retained = await page.evaluate(() => ({
    expandedTechnical: document.querySelector('.evidence-panel-technical').open,
    scrollTop: document.querySelector('#evidence-panel [data-panel-body]')
      .scrollTop,
    label: document.querySelector('[data-evidence-value="subject"]')
      .textContent,
  }));
  assert.equal(retained.expandedTechnical, true);
  assert.equal(retained.scrollTop, 17);
  assert.equal(retained.label, 'Synthetic TEST123 refreshed');

  await page.click('#evidence-panel-close');
  const closed = await page.evaluate(() => ({
    hidden: document.getElementById('evidence-panel').hidden,
    focus: document.activeElement?.id,
  }));
  assert.equal(closed.hidden, true);
  assert.equal(closed.focus, 'qa-evidence-focus-return');

  await page.evaluate(() => {
    const card = window.__gevVoiceCommands.voiceCard;
    card.handle({ type: 'interruption' });
    card.handle({
      type: 'action-call',
      name: 'analyst_query',
      callId: 'qa-analyst',
    });
    card.handle({
      type: 'action-result',
      name: 'analyst_query',
      callId: 'qa-analyst',
      result: {
        ok: true,
        count: 1,
        complete: true,
        scopeLabel: 'in the current view',
        coverage: {
          layersQueried: [{ layerKey: 'flights', source: 'Synthetic source' }],
        },
        items: [
          {
            icao24: 'abc123',
            layerKey: 'flights',
            callsign: 'TEST123',
            evidence: {
              entityRef: { layerKey: 'flights', id: 'abc123' },
              sourceId: 'Synthetic source',
              observedAt: Date.UTC(2026, 0, 15, 12),
              receivedAt: Date.UTC(2026, 0, 15, 12, 0, 4),
            },
          },
        ],
      },
    });
  });
  const analystCard = await page.evaluate(() => {
    const card = document.getElementById('gev-voice-card');
    const rect = card.getBoundingClientRect();
    return {
      visible: !card.hidden,
      title: card.querySelector('#gev-voice-card-result-title')?.textContent,
      left: rect.left,
      right: rect.right,
      inspectButtons: card.querySelectorAll('.gev-voice-card-referent-inspect')
        .length,
    };
  });
  assert.equal(analystCard.visible, true);
  assert.equal(analystCard.title, '1 aircraft in the current view');
  assert.equal(analystCard.inspectButtons, 1);
  assert.ok(analystCard.left >= 0 && analystCard.right <= 1440);
  await page.focus('#gev-voice-card .gev-voice-card-referent-inspect');
  await page.keyboard.press('Enter');
  await page.waitForFunction(
    () => document.getElementById('evidence-panel')?.dataset.pinned === 'true',
  );
  await page.evaluate(() =>
    window.dispatchEvent(
      new CustomEvent('gev:awareness-subject-selected', {
        detail: {
          label: 'New live selection',
          evidence: {
            entityRef: { layerKey: 'flights', id: 'def456' },
            observedAt: Date.UTC(2026, 0, 16, 12),
          },
        },
      }),
    ),
  );
  const pinned = await page.evaluate(() => ({
    title: document.querySelector('[data-evidence-title]')?.textContent,
    subject: document.querySelector('[data-evidence-value="subject"]')
      ?.textContent,
    observed: document.querySelector('[data-evidence-value="observed"]')
      ?.textContent,
  }));
  assert.equal(pinned.title, 'PINNED RESULT EVIDENCE');
  assert.equal(pinned.subject, 'TEST123');
  assert.match(pinned.observed, /2026-01-15T12:00:00/);
  await page.setViewport({ width: 390, height: 844 });
  const narrowPinned = await page.$eval('#evidence-panel', (node) => {
    const rect = node.getBoundingClientRect();
    return { left: rect.left, right: rect.right };
  });
  assert.ok(narrowPinned.left >= 0 && narrowPinned.right <= 390);
  await page.focus('#evidence-panel-close');
  await page.keyboard.press('Enter');
  assert.ok(
    await page.$eval(':focus', (node) =>
      node.classList.contains('gev-voice-card-referent-inspect'),
    ),
    'closing pinned evidence returns focus to its Inspect evidence button',
  );

  await page.evaluate(() => {
    const trigger = document.createElement('button');
    trigger.id = 'qa-forecast-evidence-focus-return';
    trigger.textContent = 'Inspect forecast evidence';
    document.body.append(trigger);
    trigger.focus();
    window.dispatchEvent(
      new CustomEvent('gev:evidence-record-opened', {
        detail: {
          kind: 'forecast',
          label: 'Wind forecast at 30.27N 97.74W',
          evidence: {
            entityRef: { layerKey: 'wind', id: 'gfs:30.27,-97.74' },
            sourceId: 'NOAA GFS',
            sourceUrl:
              'https://www.ncei.noaa.gov/products/weather-climate-models/global-forecast',
            receivedAt: Date.UTC(2026, 0, 16, 12, 0, 5),
            issuedAt: Date.UTC(2026, 0, 16, 6),
            validFrom: Date.UTC(2026, 0, 16, 12),
            displayTime: Date.UTC(2026, 0, 16, 12),
            method: 'predicted',
            displayMethod: 'interpolated',
            feedState: 'nominal',
            coverage: {
              area: 'Global forecast grid at approximately 1° resolution',
              completeness: 'unknown',
            },
            limitations: ['Forecast output, not a direct observation.'],
          },
        },
      }),
    );
  });
  await page.waitForFunction(
    () =>
      document.querySelector('[data-evidence-title]')?.textContent ===
      'FORECAST EVIDENCE',
  );
  const forecast = await page.evaluate(() => ({
    subject: document.querySelector('[data-evidence-value="subject"]')
      ?.textContent,
    source: document.querySelector('[data-evidence-value="source"]')
      ?.textContent,
    observed: document.querySelector('[data-evidence-value="observed"]')
      ?.textContent,
    issued: document.querySelector('[data-evidence-value="issued"]')
      ?.textContent,
    valid: document.querySelector('[data-evidence-value="validity"]')
      ?.textContent,
  }));
  assert.equal(forecast.subject, 'Wind forecast at 30.27N 97.74W');
  assert.equal(forecast.source, 'NOAA GFS');
  assert.equal(forecast.observed, 'Not provided by source');
  assert.match(forecast.issued, /2026-01-16T06:00:00/);
  assert.match(forecast.valid, /2026-01-16T12:00:00/);
  await page.click('#evidence-panel-close');
  assert.equal(
    await page.$eval(':focus', (node) => node.id),
    'qa-forecast-evidence-focus-return',
    'closing forecast evidence restores focus to its Inspect action',
  );

  await page.evaluate(() =>
    window.dispatchEvent(
      new CustomEvent('gev:entity-selected', {
        detail: {
          id: 'ais-367123456',
          layerId: 'ais-live-vessels',
          label: 'Synthetic AIS vessel',
          evidence: {
            entityRef: { layerKey: 'ais-live-vessels', id: '367123456' },
            sourceId: 'AISStream',
            sourceUrl: 'https://aisstream.io/',
            sourceRecordId: '367123456',
            observedAt: Date.UTC(2026, 0, 15, 12),
            receivedAt: Date.UTC(2026, 0, 15, 12, 0, 5),
            method: 'observed',
            coverage: {
              area: 'Received AIS positions',
              completeness: 'partial',
              reason: 'Sparse reports do not establish geographic absence.',
            },
            limitations: ['AIS reports are sparse.'],
          },
        },
      }),
    ),
  );
  await page.waitForFunction(
    () => !document.getElementById('evidence-panel')?.hidden,
  );
  const vessel = await page.evaluate(() => ({
    subject: document.querySelector('[data-evidence-value="subject"]')
      ?.textContent,
    layer: document.querySelector('[data-evidence-value="layer"]')?.textContent,
    coverage: document.querySelector('[data-evidence-value="coverage"]')
      ?.textContent,
  }));
  assert.equal(vessel.subject, 'Synthetic AIS vessel');
  assert.equal(vessel.layer, 'ais-live-vessels');
  assert.match(vessel.coverage, /partial/);
  await page.click('#evidence-panel-close');

  await page.evaluate(() =>
    window.dispatchEvent(
      new CustomEvent('gev:awareness-subject-selected', {
        detail: {
          layerId: 'satellites',
          id: '25544',
          label: 'ISS (ZARYA)',
          evidence: {
            entityRef: { layerKey: 'satellites', id: '25544' },
            sourceId: 'CelesTrak',
            sourceUrl: 'https://celestrak.org/',
            sourceRecordId: '25544',
            displayTime: Date.parse('2026-10-08T00:00:00Z'),
            elementEpoch: Date.parse('2008-09-20T12:25:40.104Z'),
            method: 'predicted',
            displayMethod: 'predicted',
            coverage: {
              area: 'CelesTrak stations orbital elements',
              completeness: 'partial',
            },
            limitations: [
              'The element epoch is not a direct position observation.',
            ],
          },
        },
      }),
    ),
  );
  const satellite = await page.evaluate(() => ({
    epoch: document.querySelector('[data-evidence-value="element-epoch"]')
      ?.textContent,
    displayTime: document.querySelector('[data-evidence-value="display-time"]')
      ?.textContent,
    observed: document.querySelector('[data-evidence-value="observed"]')
      ?.textContent,
    method: document.querySelector('[data-evidence-value="method"]')
      ?.textContent,
  }));
  assert.match(satellite.epoch, /2008-09-20T12:25:40/);
  assert.match(satellite.displayTime, /2026-10-08T00:00:00/);
  assert.equal(satellite.observed, 'Not provided by source');
  assert.equal(satellite.method, 'predicted');
  await page.setViewport({ width: 390, height: 844 });
  const narrow = await page.$eval('#evidence-panel', (node) => {
    const rect = node.getBoundingClientRect();
    return { left: rect.left, right: rect.right, width: rect.width };
  });
  assert.ok(narrow.left >= 0, `panel starts off-screen: ${narrow.left}`);
  assert.ok(
    narrow.right <= 390,
    `panel ends off-screen: ${narrow.right} (width ${narrow.width})`,
  );
  await page.click('#evidence-panel-close');

  await page.evaluate(() =>
    window.dispatchEvent(
      new CustomEvent('gev:awareness-subject-selected', {
        detail: {
          layerId: 'ais-live-vessels',
          id: '367123456',
          label: 'Unsupported synthetic vessel',
        },
      }),
    ),
  );
  assert.equal(
    await page.$eval('#evidence-panel', (node) => node.hidden),
    true,
  );
  await page.evaluate(async () => {
    await window.__godsEyeView.styleManager.dispose();
    window.dispatchEvent(
      new CustomEvent('gev:awareness-subject-selected', {
        detail: {
          layerId: 'flights',
          id: 'after-dispose',
          label: 'Selection after teardown',
          evidence: {
            entityRef: { layerKey: 'flights', id: 'after-dispose' },
            sourceId: 'Synthetic source',
          },
        },
      }),
    );
  });
  assert.equal(
    await page.$eval('#evidence-panel', (node) => node.hidden),
    true,
    'a destroyed inspector no longer responds to selection events',
  );
  assert.deepEqual(errors, []);
  console.log(
    'PASS: aircraft, AIS, orbital-epoch and forecast evidence, analyst-card keyboard pinning, immutable snapshots, desktop/narrow layout, safe source links, keyboard focus return, unsupported selection and teardown',
  );
} finally {
  await browser.close();
}
