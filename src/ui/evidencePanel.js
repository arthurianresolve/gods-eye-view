import {
  normalizeEvidence,
  safeEvidenceUrl,
  safePeeringDbFacilityUrl,
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
    this.windowRef.dispatchEvent(new EventCtor(ENTITY_SELECTED, { detail }));
  }

  show(detail = {}, { pinned = false } = {}) {
    if (!this.panel) return;
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
    const sourceUrl = safeEvidenceUrl(evidence.sourceUrl);
    this._set('subject', name);
    this._set('layer', evidence.entityRef.layerKey);
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
    const cameraState = detail.cameraState;
    this._set(
      'health',
      cameraState
        ? `${cameraState.healthReason || 'unknown'} (${cameraState.sourceStatus || 'unknown'})`
        : null,
    );
    this._set(
      'delivery',
      cameraState
        ? `attempted ${formatTime(cameraState.healthAttemptedAt)} · decoded ${cameraState.decodeStatus || 'unknown'}${cameraState.decodeLastSuccessAt != null ? ` · last decode ${formatTime(cameraState.decodeLastSuccessAt)}` : ''}`
        : null,
    );
    this._set(
      'fallback',
      cameraState
        ? cameraState.videoFallback
          ? 'Still image fallback'
          : cameraState.sourceKind === 'synthetic'
            ? 'Synthetic placeholder'
            : cameraState.sourceKind === 'streetview'
              ? 'Street View fallback'
              : 'Source delivery'
        : null,
    );
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
    const references = this.rows.get('references');
    if (references) {
      references.replaceChildren();
      if (!evidence.references.length) references.textContent = 'None attached';
      for (const [index, reference] of evidence.references.entries()) {
        if (index) references.append(document.createTextNode(' · '));
        const link = document.createElement('a');
        link.href = reference.url;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.textContent = reference.title || reference.kind;
        references.append(link);
        if (reference.kind === 'archive') {
          const remove = document.createElement('button');
          remove.type = 'button';
          remove.className = 'panel-surface-control';
          remove.textContent = 'Remove';
          remove.setAttribute('aria-label', 'Remove archived reference');
          remove.addEventListener('click', () => {
            const next = normalizeEvidence({
              ...evidence,
              references: evidence.references.filter(
                (_, referenceIndex) => referenceIndex !== index,
              ),
            });
            this.show(
              { ...this.currentDetail, evidence: next },
              { pinned: this.pinned },
            );
            this._publishEvidence(this.currentDetail);
          });
          references.append(document.createTextNode(' '), remove);
        }
      }
      const archiveTarget =
        evidence.sourceUrl || evidence.references[0]?.originalUrl;
      if (archiveTarget) {
        if (
          evidence.references.some((reference) => reference.kind === 'archive')
        ) {
          references.append(
            document.createTextNode(' · archived copy attached'),
          );
        } else if (evidence.references.length < 8) {
          const button = document.createElement('button');
          button.type = 'button';
          button.className = 'panel-surface-control';
          button.textContent = 'Find archived copy';
          button.addEventListener('click', async () => {
            button.disabled = true;
            button.textContent = 'Looking up archive…';
            try {
              const result = await this.archiveLookup.lookup({
                url: archiveTarget,
                timestamp:
                  evidence.observedAt || evidence.snapshotAt || undefined,
              });
              if (result.state === 'available' && result.reference) {
                const next = normalizeEvidence({
                  ...evidence,
                  references: [...evidence.references, result.reference],
                });
                this.show(
                  { ...this.currentDetail, evidence: next },
                  { pinned: this.pinned },
                );
                this._publishEvidence(this.currentDetail);
              } else {
                button.textContent = 'No archived copy found';
              }
            } catch {
              button.textContent = 'Archive lookup failed';
            } finally {
              button.disabled = false;
            }
          });
          references.append(document.createTextNode(' · '), button);
        }
      }
      if (evidence.entityRef.layerKey === 'local-datacenters') {
        const attach = document.createElement('span');
        attach.className = 'evidence-reference-attach';
        const input = document.createElement('input');
        input.type = 'url';
        input.inputMode = 'url';
        input.placeholder = 'https://www.peeringdb.com/fac/…';
        input.setAttribute('aria-label', 'PeeringDB facility URL');
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'panel-surface-control';
        button.textContent = 'Attach facility';
        const status = document.createElement('span');
        status.setAttribute('role', 'status');
        button.addEventListener('click', () => {
          const url = safePeeringDbFacilityUrl(input.value);
          if (!url) {
            status.textContent = 'Use a public PeeringDB /fac/{id} URL.';
            return;
          }
          if (evidence.references.length >= 8) {
            status.textContent = 'Maximum of 8 references reached.';
            return;
          }
          const next = normalizeEvidence({
            ...evidence,
            references: [
              ...evidence.references,
              {
                kind: 'user-linked',
                url,
                title: 'PeeringDB facility (user-linked)',
              },
            ],
          });
          this.show(
            { ...this.currentDetail, evidence: next },
            { pinned: this.pinned },
          );
          this._publishEvidence(this.currentDetail);
        });
        attach.append(input, button, status);
        references.append(document.createTextNode(' · '), attach);
      }
    }
    this._set(
      'limitations',
      evidence.limitations.join(' · ') || 'No additional limitations provided',
    );
    this.panel.hidden = false;
    this.openPanel?.();
  }

  clear({ restoreFocus = false } = {}) {
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
    this.windowRef.removeEventListener(SELECTED, this._onSelected);
    this.windowRef.removeEventListener(CLEARED, this._onCleared);
    this.windowRef.removeEventListener(ENTITY_SELECTED, this._onEntitySelected);
    this.windowRef.removeEventListener(ENTITY_CLEARED, this._onCleared);
    this.windowRef.removeEventListener(PINNED, this._onPinned);
    this.windowRef.removeEventListener(RECORD_OPENED, this._onRecordOpened);
    this.closeButton?.removeEventListener('click', this._onClose);
  }
}
