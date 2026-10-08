const DENSITY_STEPS = Object.freeze([0, 25, 50, 75, 100]);

function percentile(values, fraction) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[
    Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)
  ];
}

/** Pure opt-in policy for changing nonselected detection-label density. */
export class AdaptiveQualityPolicy {
  constructor({
    windowSize = 45,
    cooldownMs = 4_000,
    slowP95Ms = 25,
    fastP95Ms = 18,
    slowWindows = 2,
    fastWindows = 3,
  } = {}) {
    this.windowSize = windowSize;
    this.cooldownMs = cooldownMs;
    this.slowP95Ms = slowP95Ms;
    this.fastP95Ms = fastP95Ms;
    this.slowWindows = slowWindows;
    this.fastWindows = fastWindows;
    this.reset();
  }

  reset() {
    this.samples = [];
    this.slowCount = 0;
    this.fastCount = 0;
    this.lastChangeAt = -Infinity;
    this.lastP95Ms = null;
  }

  resetWindow() {
    this.samples = [];
    this.slowCount = 0;
    this.fastCount = 0;
  }

  observe(frameMs, nowMs, densityPct) {
    if (!Number.isFinite(frameMs) || frameMs <= 0 || frameMs > 250) return null;
    this.samples.push(frameMs);
    if (this.samples.length < this.windowSize) return null;
    const p95FrameMs = percentile(this.samples, 0.95);
    this.samples = [];
    this.lastP95Ms = p95FrameMs;
    if (p95FrameMs >= this.slowP95Ms) {
      this.slowCount += 1;
      this.fastCount = 0;
    } else if (p95FrameMs <= this.fastP95Ms) {
      this.fastCount += 1;
      this.slowCount = 0;
    } else {
      this.slowCount = 0;
      this.fastCount = 0;
    }
    if (nowMs - this.lastChangeAt < this.cooldownMs) return null;

    const index = DENSITY_STEPS.indexOf(densityPct);
    if (index < 0) return null;
    if (this.slowCount >= this.slowWindows && index > 0) {
      this.lastChangeAt = nowMs;
      this.slowCount = 0;
      return {
        densityPct: DENSITY_STEPS[index - 1],
        p95FrameMs,
        reason: 'frame-time-high',
      };
    }
    if (
      this.fastCount >= this.fastWindows &&
      index < DENSITY_STEPS.length - 1
    ) {
      this.lastChangeAt = nowMs;
      this.fastCount = 0;
      return {
        densityPct: DENSITY_STEPS[index + 1],
        p95FrameMs,
        reason: 'frame-time-headroom',
      };
    }
    return null;
  }
}

/** Browser adapter. Hidden-tab time is excluded and no render loop is held open. */
export class AdaptiveQualityController {
  constructor({
    viewer,
    documentRef = document,
    readDensity,
    applyDensity,
    onState = () => {},
    storage = null,
  }) {
    this.document = documentRef;
    this.readDensity = readDensity;
    this.applyDensity = applyDensity;
    this.onState = onState;
    this.storage = storage;
    this.policy = new AdaptiveQualityPolicy();
    this.mode = 'manual';
    this.lastFrameAt = null;
    this._frame = () => this._onFrame();
    this._visibility = () => {
      this.lastFrameAt = null;
      this.policy.resetWindow();
      this._publish();
    };
    this.frameEvent = viewer?.scene?.postRender || null;
    this.removeFrame = null;
    documentRef.addEventListener('visibilitychange', this._visibility);
    try {
      this.storage ||= globalThis.localStorage;
      const saved = this.storage?.getItem('gev.presentation-quality-mode');
      if (!this.setMode(saved || 'manual', { persist: false }))
        this.setMode('manual', { persist: false });
    } catch {
      this._publish();
    }
  }

  getMode() {
    return this.mode;
  }

  setMode(mode, { persist = true } = {}) {
    if (!['auto', 'quality', 'performance', 'manual'].includes(mode))
      return false;
    this.mode = mode;
    this.policy.reset();
    this.lastFrameAt = null;
    if (mode === 'auto' && !this.removeFrame)
      this.removeFrame = this.frameEvent?.addEventListener(this._frame) || null;
    else if (mode !== 'auto' && this.removeFrame) {
      this.removeFrame();
      this.removeFrame = null;
    }
    if (mode === 'quality') this.applyDensity(75, 'quality-profile');
    else if (mode === 'performance')
      this.applyDensity(25, 'performance-profile');
    if (persist) {
      try {
        this.storage?.setItem('gev.presentation-quality-mode', mode);
      } catch {
        // Settings storage is best-effort; this mode only affects presentation.
      }
    }
    this._publish();
    return true;
  }

  _onFrame() {
    if (this.mode !== 'auto') return;
    const now = globalThis.performance?.now?.();
    if (!Number.isFinite(now)) return;
    if (this.document.hidden) {
      this.lastFrameAt = null;
      this.policy.resetWindow();
      return;
    }
    if (this.lastFrameAt == null) {
      this.lastFrameAt = now;
      return;
    }
    const result = this.policy.observe(
      now - this.lastFrameAt,
      now,
      this.readDensity(),
    );
    this.lastFrameAt = now;
    if (this.mode === 'auto' && result) {
      this.applyDensity(result.densityPct, 'auto-profile');
      this._publish(result);
    }
  }

  _publish(change = null) {
    this.onState({
      mode: this.mode,
      densityPct: this.readDensity(),
      p95FrameMs: this.policy.lastP95Ms,
      change,
    });
  }

  destroy() {
    this.removeFrame?.();
    this.removeFrame = null;
    this.document.removeEventListener('visibilitychange', this._visibility);
    this.policy.reset();
  }
}
