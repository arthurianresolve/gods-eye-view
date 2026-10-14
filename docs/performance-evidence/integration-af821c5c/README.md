# Standard integration passes at af821c5c

[Run 38404263173](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38404263173)
passes all seven selected jobs at exact source
`af821c5ce9080ce726e258248135105d3a510945`:

- Node 24.14.0 and Node 26.x: locked install, setup policy, formatting, boundaries,
  capture lint, full unit suites and production builds.
- Windows onboarding: actual Pinokio install path, formatting, boundaries,
  focused onboarding tests and production build.
- Windows, macOS and Linux installation/update recovery: disposable Git updates,
  rejected incomplete artifacts and actual persisted browser profile recovery.
- Browser gate: Street Level fixtures, first-use lifecycle, evidence references
  and profile transfer, accessibility/reflow, effective visual settings, workspace
  conflicts, mixed-use smoke, sharing, evidence panel and portable panel.

The [unmodified terminal run summary](run-summary.json) retains every job and
step result, job URL and tested revision: 24,240 bytes, SHA-256
`a63241a9d7e960d48b776721f707d305dba0fd1e6013ae79ed3d7592b91234e5`.
Optional native/soak jobs were not selected in this standard run.

The separate [native map run](../s47-map-streaming/native-38404611321/README.md)
at the same revision remains failed for missing imagery coverage, even though its
baseline camera/journey validation completes. Standard CI success does not
override that result or establish hardware performance, retained-resource
stability, candidate publication readiness or complete S47-S60 acceptance.
Later corpus changes need their own exact-commit checks.
