export const WEBGL_PIXEL_MODES = Object.freeze(['static', 'animated']);

/** Return the shader's bounded cyan-channel uniform for one animation frame. */
export function pixelUniformValue(mode, elapsedMs) {
  if (!WEBGL_PIXEL_MODES.includes(mode)) {
    throw new RangeError(`Unsupported pixel mode: ${String(mode)}`);
  }
  if (!Number.isFinite(elapsedMs) || elapsedMs < 0) {
    throw new RangeError(
      'Pixel animation time must be finite and nonnegative.',
    );
  }
  if (mode === 'static') return 1;
  return 0.5 + 0.5 * Math.sin((elapsedMs / 1000) * Math.PI * 2);
}

export function webglReportFilename(report) {
  const preservation =
    report.preserveDrawingBufferRequested === null
      ? 'na'
      : String(report.preserveDrawingBufferRequested);
  return `webgl-frame-delivery-${report.appCommit?.slice(0, 7) || 'local'}-${report.mode}-pixels-${report.pixelMode || 'na'}-preserve-${preservation}-delay-${report.preparation?.requestedDelayMs ?? 0}.json`;
}
