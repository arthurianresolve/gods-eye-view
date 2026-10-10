/** Disable optional app diagnostics for one capture document, if supported. */
export function disableOptionalPerformanceDiagnostics(
  app = globalThis.window?.__godsEyeView,
) {
  const setter = app?.setPerformanceDiagnosticsEnabled;
  if (typeof setter !== 'function')
    return {
      requested: true,
      hookAvailable: false,
      disabled: false,
    };
  setter.call(app, false);
  return {
    requested: true,
    hookAvailable: true,
    disabled: true,
  };
}
