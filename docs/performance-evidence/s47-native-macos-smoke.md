# Hosted native macOS smoke backend

The performance build smoke keeps `swiftshader` as its default renderer. A
workflow dispatch may select `macos-native-diagnostic`; that option runs only
on a GitHub Actions macOS runner and launches Chrome without SwiftShader flags.
The capture child receives a separate native-diagnostic flag and applies the
same host check before launching its browser.

Both the smoke page and capture child record the observed WebGL renderer and
the bounded Chromium GPU feature-status fields. The diagnostic proceeds only
when WebGL acceleration is reported enabled and the observed renderer is
classified as native or Apple paravirtual Metal. Unknown and software fallback
are failures. Reports always mark this mode ineligible for comparison and
performance acceptance. Hosted Metal can be paravirtualized; this is a
full-fixture reachability diagnostic, not physical desktop GPU acceptance or
a causal comparison with the Linux SwiftShader runner. OS, browser, and runner
differences require same-host controls before drawing causal conclusions.

The mode does not change app settings, fixture populations, routes, quality,
warmup, capture deadlines, or the software-rendering default. It is intended to
show whether the complete fixture can progress on the hosted accelerated
renderer after the current SwiftShader-backed capture fails its readiness
deadline.
