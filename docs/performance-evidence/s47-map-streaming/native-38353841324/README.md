# Native map visual-observer failure

[Run 38353841324](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38353841324)
fails at application/harness `495f0a71821de28a3a06f7cc257c20f2b89ac052`.
The baseline is `eb8c6828d0d03e1c04bda94c8c4fb99915a577b7`.

The baseline passes the former dense-population setup boundary and reaches
`native-map-streaming-journey`, then reports `Native common visual settings
are incomplete.` Candidate execution and the route do not complete. This is
a failed functional smoke on Linux SwiftShader, not hardware evidence.

The raw [report](performance-build-smoke.json) is 5,896 bytes, SHA-256
`c29046b14dde1b5087542d73e210e88f9d93c55315a56138aad5be62425d43c9`.
GitHub artifact `11792405390` has archive digest
`2c8051788781b1cb3c0fb217816d8b73aa8701efa1e05d77e650a7d0a2a13952`.

Renderer-probe cleanup, context closure and interception release are confirmed.
There are zero pending commands, preparations, abort subscriptions and late
requests after drain. The additional missing-credit-kind delivery error remains
recorded: the journey stopped before proving all required asset delivery. No
missing kind is accepted as delivered.

Source review identifies invalid harness reads of `style.bloomIntensity` and
`style.sharpenIntensity`. Neither is a `ShellFacade` property; both values are
provided by `getVisualState()`. The older common observer also omitted these
scalar values, although its nested visual snapshot retained them. This finding
does not establish a rendering defect in upstream or dev.

Correction `02151a21ccf9b635727e775a865d596eae6fb777`, integrated at
`aab428904c286383b30fd250df8c3f451ff167b4`, consumes the existing visual snapshot
in both observers. Independent validation passes 65 focused tests, explicit
lint of all four changed files and the integrated 25-file no-undef gate.
Root also invokes the actual `ShellFacade.getVisualState()` and
`VisualSettings.getVisualState()` prototype methods with a cached-scene seam:
the old observer emits undefined scalars, while the correction emits bloom
200 and sharpen 49 with the nested visual state unchanged. No setting, scale,
rendering default or timeout changes. A fresh browser result is still required.
