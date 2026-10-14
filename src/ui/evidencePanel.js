import {
  normalizeEvidence,
  safeEvidenceUrl,
  safePeeringDbFacilityUrl,
  safeReferenceUrl,
} from '../evidence/evidence.js';
import { createArchiveLookup } from '../evidence/archiveLookup.js';

const SELECTED = 'gev:awareness-subject-selected';
const CLEARED = 'gev:awareness-subject-cleared';
const PINNED = 'gev:evidence-result-pinned';
const RECORD_OPENED = 'gev:evidence-record-opened';
const ENTITY_SELECTED = 'gev:entity-selected';
const ENTITY_CLEARED = 'gev:entity-selection-cleared';

function formatTime(value) {
  return Number.isFinite(value)
    ? `${new Date(value).toISOString()} UTC`
    : 'Not provided by source';
}

function formatAge(value, now = Date.now()) {
  if (!Number.isFinite(value)) return 'Unknown';
  const seconds = Math.max(0, Math.floor((now - value) / 1000));
  if (seconds < 60) return `${seconds}s old`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m old`;
  return `${Math.floor(seconds / 3600)}h old`;
}

/** Source-time inspector for a selected, stable entity reference. */
export class EvidencePanel {
  constructor({
    panel,
    closeButton,
    openPanel,
    hidePanel,
    windowRef = window,
    archiveLookup = createArchiveLookup(),
  }) {
    this.panel = panel;
    this.closeButton = closeButton;
    this.openPanel = openPanel;
    this.hidePanel = hidePanel;
    this.windowRef = windowRef;
    this.archiveLookup = archiveLookup;
    this.currentDetail = null;
    this.currentEvidence = null;
    this.returnFocusTarget = null;
    this.pinned = false;
    this.rows = new Map();
    this._buildRows();
    this._onSelected = (event) => {
      if (this.pinned) return;
      if (!event.detail?.evidence) this.clear();
      else this.show(event.detail);
    };
    this._onCleared = () => {
      if (!this.pinned) this.clear();
    };
    this._onEntitySelected = (event) => {
      if (this.pinned) return;
      if (!event.detail?.evidence) this.clear();
      else this.show(event.detail);
    };
    this._onPinned = (event) => {
      if (!event.detail?.evidence) return;
      this.returnFocusTarget = null;
      this.show(event.detail, { pinned: true });
    };
    this._onRecordOpened = (event) => {
      if (!event.detail?.evidence) return;
      this.show(event.detail, { pinned: true });
    };
    this._onCameraHealth = (event) => {
      const detail = event.detail;
      if (
        this.pinned ||
        this.currentEvidence?.entityRef.layerKey !== 'cctv' ||
        this.currentEvidence.entityRef.id !== detail?.evidence?.entityRef.id
      )
        return;
      this.currentEvidence = normalizeEvidence({
        ...detail.evidence,
        references: this.currentEvidence.references,
      });
      this.currentDetail = {
        ...this.currentDetail,
        ...detail,
        evidence: this.currentEvidence,
      };
      this._showEvidenceFacts(this.currentEvidence, detail.cameraState);
      this._publishEvidence(this.currentDetail);
    };
    windowRef.addEventListener(
      'gev:camera-health-updated',
      this._onCameraHealth,
    );
    this._onClose = () => this.clear({ restoreFocus: true });
    windowRef.addEventListener(SELECTED, this._onSelected);
    windowRef.addEventListener(CLEARED, this._onCleared);
    windowRef.addEventListener(ENTITY_SELECTED, this._onEntitySelected);
    windowRef.addEventListener(ENTITY_CLEARED, this._onCleared);
    windowRef.addEventListener(PINNED, this._onPinned);
    windowRef.addEventListener(RECORD_OPENED, this._onRecordOpened);
    closeButton?.addEventListener('click', this._onClose);
  }

  _buildRows() {
    const fields = [
      ['subject', 'Selected object'],
      ['layer', 'Layer'],
      ['source', 'Source'],
      ['health', 'Camera health'],
      ['delivery', 'Delivery and decode'],
      ['fallback', 'Fallback state'],
      ['observed', 'Observed at'],
      ['age', 'Source age'],
      ['received', 'Received locally'],
      ['feed-state', 'Feed state'],
      ['display', 'Displayed position'],
      ['element-epoch', 'Orbital element epoch'],
      ['source-record', 'Source record'],
      ['snapshot', 'Feed snapshot time'],
      ['issued', 'Forecast issued at'],
      ['validity', 'Forecast valid from'],
      ['display-time', 'Position evaluated at'],
      ['method', 'Source method'],
      ['coverage', 'Coverage'],
      ['uncertainty', 'Uncertainty'],
      ['license', 'License'],
      ['limitations', 'Limitations'],
      ['references', 'Public references'],
    ];
    const primary = this.panel?.querySelector('[data-evidence-fields]');
    const technical = this.panel?.querySelector(
      '[data-evidence-technical-fields]',
    );
    if (!primary || !technical) return;
    for (const [key, label] of fields) {
      const row = document.createElement('div');
      row.className = 'evidence-panel-row';
      const term = document.createElement('dt');
      term.textContent = label;
      const value = document.createElement('dd');
      value.dataset.evidenceValue = key;
      row.append(term, value);
      ([
        'source-record',
        'health',
        'delivery',
        'fallback',
        'snapshot',
        'issued',
        'validity',
        'display-time',
        'element-epoch',
        'method',
        'coverage',
        'uncertainty',
        'license',
        'limitations',
        'references',
      ].includes(key)
        ? technical
        : primary
      ).append(row);
      this.rows.set(key, value);
    }
  }

  _set(key, value) {
    const node = this.rows.get(key);
    if (!node) return;
    node.replaceChildren();
    if (value && typeof value === 'object' && value.href) {
      const link = document.createElement('a');
      link.href = value.href;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.textContent = value.text || value.href;
      node.append(link);
      return;
    }
    node.textContent =
      value == null || value === '' ? 'Unknown' : String(value);
  }

  _publishEvidence(detail) {
    const EventCtor = this.windowRef?.CustomEvent || globalThis.CustomEvent;
    if (!EventCtor || !this.windowRef?.dispatchEvent) return;
    this.windowRef.dispatchEvent(
      new EventCtor('gev:evidence-updated', { detail }),
    );
  }

  _replaceReferences(references) {
    const detail = {
      ...this.currentDetail,
      evidence: normalizeEvidence({ ...this.currentEvidence, references }),
    };
    this.show(detail, { pinned: this.pinned });
    this._publishEvidence(detail);
    this.rows.get('references')?.querySelector('button, input, a')?.focus();
  }

  _showCameraHealth(cameraState) {
    for (const key of ['health', 'delivery', 'fallback'])
      if (this.rows.get(key)?.parentElement)
        this.rows.get(key).parentElement.hidden = !cameraState;
    this._set(
      'health',
      cameraState
        ? `${cameraState.healthReason || 'unknown'} (${cameraState.sourceStatus || 'unknown'})`
        : null,
    );
    this._set(
      'delivery',
      cameraState
        ? [
            'Attempted: ' + formatTime(cameraState.healthAttemptedAt),
            'Last source delivery: ' +
              formatTime(cameraState.healthLastSuccessAt),
            'Decode: ' + (cameraState.decodeStatus || 'unknown'),
            'Last decoded: ' + formatTime(cameraState.decodeLastSuccessAt),
          ].join(' | ')
        : null,
    );
    this._set(
      'fallback',
      !cameraState
        ? null
        : cameraState.sourceKind === 'synthetic'
          ? 'Synthetic placeholder'
          : cameraState.sourceKind === 'streetview'
            ? 'Street View fallback'
            : cameraState.videoFallback
              ? 'Still image fallback'
              : cameraState.healthLastSuccessAt
                ? 'Source delivery'
                : 'No verified source delivery',
    );
  }

  _showEvidenceFacts(evidence, cameraState) {
    const sourceUrl = safeEvidenceUrl(evidence.sourceUrl);
    this._set(
      'source',
      sourceUrl
        ? {
            href: sourceUrl,
            text: evidence.sourceId || new URL(sourceUrl).host,
          }
        : evidence.sourceId,
    );
    this._set('source-record', evidence.sourceRecordId);
    this._showCameraHealth(cameraState || evidence.cameraHealth);
    this._set('observed', formatTime(evidence.observedAt));
    this._set('age', formatAge(evidence.observedAt));
    this._set('snapshot', formatTime(evidence.snapshotAt));
    this._set('issued', formatTime(evidence.issuedAt));
    this._set('validity', formatTime(evidence.validFrom));
    this._set('display-time', formatTime(evidence.displayTime));
    this._set('element-epoch', formatTime(evidence.elementEpoch));
    this._set('received', formatTime(evidence.receivedAt));
    this._set('feed-state', evidence.feedState.toUpperCase());
    this._set('method', evidence.method);
    this._set('display', evidence.displayMethod);
    this._set(
      'coverage',
      [
        evidence.coverage.area,
        evidence.coverage.completeness,
        evidence.coverage.truncated ? 'truncated' : null,
        evidence.coverage.reason,
      ]
        .filter(Boolean)
        .join(' · ') || 'Unknown',
    );
    this._set(
      'uncertainty',
      evidence.uncertainty.value == null
        ? 'Not provided'
        : `${evidence.uncertainty.value} ${evidence.uncertainty.unit || ''} ${evidence.uncertainty.kind || ''}`.trim(),
    );
    this._set('license', evidence.licenseRef || 'Not provided');
    this._set(
      'limitations',
      evidence.limitations.join(' · ') || 'No additional limitations provided',
    );
  }

  _renderReferences(evidence) {
    const container = this.rows.get('references');
    if (!container) return;
    container.replaceChildren();
    const signal = this.lookupController.signal;
    const makeButton = (text, action) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'panel-surface-control';
      button.textContent = text;
      button.addEventListener('click', action);
      return button;
    };
    const appendLookup = (url, parent) => {
      const target = safeReferenceUrl(url);
      if (!target || evidence.references.length >= 8) return;
      const preview = document.createElement('div');
      preview.textContent = 'Archive lookup URL: ' + target;
      const status = document.createElement('div');
      status.setAttribute('role', 'status');
      // A source observation can suggest a requested date, never a capture date.
      const requestedAt = evidence.observedAt ?? evidence.snapshotAt;
      const timestamp = Number.isFinite(requestedAt)
        ? new Date(requestedAt).toISOString().replace(/\D/g, '').slice(0, 14)
        : undefined;
      const requested = document.createElement('div');
      requested.textContent = timestamp
        ? 'Requested date: ' + formatTime(requestedAt)
        : 'Requested date: latest available';
      const button = makeButton('Find archived copy', async () => {
        button.disabled = true;
        status.textContent = 'Looking up archive…';
        try {
          const result = await this.archiveLookup.lookup({
            url: target,
            timestamp,
            signal,
          });
          if (signal.aborted) return;
          if (result.state !== 'available' || !result.reference) {
            status.textContent = 'No archived copy found.';
            return;
          }
          const reference = normalizeEvidence({
            references: [result.reference],
          }).references[0];
          if (!reference || reference.kind !== 'archive')
            throw new Error('Malformed archive result');
          status.textContent =
            'Closest archive capture: ' +
            formatTime(reference.archiveAt) +
            '. This may differ from the requested date and does not prove the underlying event. ';
          const attach = makeButton('Attach archived reference', () => {
            if (signal.aborted) return;
            this._replaceReferences([...evidence.references, reference]);
          });
          status.append(attach);
          attach.focus();
        } catch (error) {
          if (signal.aborted) return;
          const message =
            error.code === 'rate-limited'
              ? 'Archive lookup rate limited. Try again later.'
              : error.state === 'malformed'
                ? 'Archive returned malformed data.'
                : 'Archive lookup failed. You can try again.';
          status.textContent = message;
        } finally {
          if (!signal.aborted) button.disabled = false;
        }
      });
      button.dataset.archiveUrl = target;
      parent.append(preview, requested, button, status);
    };
    const seen = new Set();
    for (const [index, reference] of evidence.references.entries()) {
      const row = document.createElement('div');
      row.className = 'evidence-reference';
      const link = document.createElement('a');
      link.href = reference.url;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.textContent = reference.title || reference.kind;
      const remove = makeButton('Remove', () =>
        this._replaceReferences(
          evidence.references.filter((_, i) => i !== index),
        ),
      );
      remove.setAttribute(
        'aria-label',
        'Remove reference: ' + link.textContent,
      );
      row.append(link, document.createTextNode(' '), remove);
      if (reference.kind === 'archive') {
        const date = document.createElement('div');
        date.textContent =
          'Archive capture: ' +
          formatTime(reference.archiveAt) +
          ' · Looked up: ' +
          formatTime(reference.lookedUpAt) +
          '. Capture time is separate from source observation time.';
        row.append(date);
      } else {
        seen.add(reference.url);
        appendLookup(reference.url, row);
      }
      container.append(row);
    }
    if (evidence.sourceUrl && !seen.has(evidence.sourceUrl))
      appendLookup(evidence.sourceUrl, container);
    if (!evidence.references.length) {
      const empty = document.createElement('div');
      empty.textContent = 'None attached';
      container.prepend(empty);
    }
    const facility = evidence.entityRef.layerKey === 'local-datacenters';
    for (const isFacility of facility ? [false, true] : [false]) {
      const form = document.createElement('div');
      form.className = 'evidence-reference-attach';
      const input = document.createElement('input');
      input.type = 'url';
      input.maxLength = 4096;
      input.placeholder = isFacility
        ? 'https://www.peeringdb.com/fac/…'
        : 'https://…';
      input.setAttribute(
        'aria-label',
        isFacility ? 'PeeringDB facility URL' : 'Public reference URL',
      );
      const status = document.createElement('span');
      status.setAttribute('role', 'status');
      const button = makeButton(
        isFacility ? 'Attach facility' : 'Attach public reference',
        () => {
          const url = isFacility
            ? safePeeringDbFacilityUrl(input.value)
            : safeReferenceUrl(input.value);
          if (!url) {
            status.textContent = isFacility
              ? 'Use a public PeeringDB /fac/{id} URL.'
              : 'Use a public HTTPS URL without credentials.';
            return;
          }
          if (evidence.references.length >= 8) {
            status.textContent = 'Maximum of 8 references reached.';
            return;
          }
          if (evidence.references.some((reference) => reference.url === url)) {
            status.textContent = 'This reference is already attached.';
            return;
          }
          this._replaceReferences([
            ...evidence.references,
            {
              kind: 'user-linked',
              url,
              title: isFacility ? 'PeeringDB facility (user-linked)' : url,
            },
          ]);
        },
      );
      form.append(input, button, status);
      container.append(form);
    }
    const hint = document.createElement('div');
    hint.textContent =
      'Pin this evidence in a workspace to save its references.';
    container.append(hint);
  }

  show(detail = {}, { pinned = false } = {}) {
    if (!this.panel) return;
    this.lookupController?.abort();
    this.lookupController = new AbortController();
    if (!this.returnFocusTarget && !this.panel.contains(document.activeElement))
      this.returnFocusTarget = document.activeElement;
    this.pinned = pinned;
    this.panel.dataset.pinned = String(pinned);
    const title = this.panel.querySelector('[data-evidence-title]');
    if (title)
      title.textContent =
        detail.kind === 'forecast'
          ? 'FORECAST EVIDENCE'
          : pinned
            ? 'PINNED RESULT EVIDENCE'
            : 'EVIDENCE';
    const evidence = normalizeEvidence(detail.evidence || {});
    this.currentDetail = detail;
    this.currentEvidence = evidence;
    const name = String(
      detail.label || evidence.entityRef.id || 'Selected object',
    );
    const announcement = this.panel.querySelector('[data-evidence-status]');
    if (announcement)
      announcement.textContent =
        'Evidence for ' +
        name +
        '. ' +
        evidence.references.length +
        ' public references.';
    this._set('subject', name);
    this._set('layer', evidence.entityRef.layerKey);
    this._showEvidenceFacts(evidence, detail.cameraState);
    this._renderReferences(evidence);
    this.panel.hidden = false;
    this.openPanel?.();
  }

  clear({ restoreFocus = false } = {}) {
    this.lookupController?.abort();
    this.currentDetail = null;
    this.currentEvidence = null;
    if (!this.panel) return;
    this.pinned = false;
    this.panel.dataset.pinned = 'false';
    const title = this.panel.querySelector('[data-evidence-title]');
    if (title) title.textContent = 'EVIDENCE';
    if (this.panel.hidden) return;
    const shouldRestore = restoreFocus;
    this.panel.hidden = true;
    this.hidePanel?.();
    if (shouldRestore) {
      const target = this.returnFocusTarget;
      if (target?.isConnected && !target.closest?.('[hidden]'))
        target.focus?.();
      else this.panel.querySelector('[data-panel-header]')?.focus?.();
    }
    this.returnFocusTarget = null;
  }

  destroy() {
    this.lookupController?.abort();
    this.windowRef.removeEventListener(
      'gev:camera-health-updated',
      this._onCameraHealth,
    );
    this.windowRef.removeEventListener(SELECTED, this._onSelected);
    this.windowRef.removeEventListener(CLEARED, this._onCleared);
    this.windowRef.removeEventListener(ENTITY_SELECTED, this._onEntitySelected);
    this.windowRef.removeEventListener(ENTITY_CLEARED, this._onCleared);
    this.windowRef.removeEventListener(PINNED, this._onPinned);
    this.windowRef.removeEventListener(RECORD_OPENED, this._onRecordOpened);
    this.closeButton?.removeEventListener('click', this._onClose);
  }
}
