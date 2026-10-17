# Dam capture workload check

[Run 38193737422](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38193737422)
passes at exact application and harness commit
`c21b3f21a8fd7933dc0e52698e2b1175165ef7db`, using the repaired infrastructure
capture contract. Both baseline and candidate build/integration checks pass;
the candidate's dam capture completes two idle and two scripted-motion runs.

The [downloaded report](report.json) has SHA-256
`9964bf00c83ec7bf0c643fecdea14a5543f2c8498b3fcd57c783c3b5f46284f1`.
[Independent review](review.json) reruns the exact revision's full validator
against its complete retained raw report successfully. The workload preserves
716 displayed dams from 704 source features, the bundled source SHA-256,
fixed fixture clock, Manual/Dense 75%, 1440x900 buffer, antialiasing and MSAA 4.
All four samples share the measured document. Startup and main worker audits
validate four and eight workers respectively. The [job record](ci-run.json)
preserves the exact revision and outcomes.

This is a short, instrumented SwiftShader integration check, with one-second
warmup/measurement windows and two repeats. Comparison eligibility remains
false. It does not demonstrate a batching benefit, override the earlier S54
dam activation regression, or satisfy hardware/performance/soak acceptance.
