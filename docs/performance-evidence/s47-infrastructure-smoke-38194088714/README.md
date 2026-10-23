# Cable capture workload check

[Run 38194088714](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38194088714)
passes at exact application and harness commit
`c21b3f21a8fd7933dc0e52698e2b1175165ef7db`. Both baseline and candidate
build/integration checks pass; the candidate cable capture completes two idle
and two scripted-motion samples in one measured document.

The [downloaded report](report.json) has SHA-256
`2a2dd039434dffbbfe4e79650aa37c83db51299e53dd58aa354e77ca0e491a98`.
[Independent review](review.json) reruns that revision's validator against the
complete raw report successfully. The fixture preserves 712 cable features and
1,917 landing points (2,629 records), bundled asset hashes, the fixed clock,
Manual/Dense 75%, and the same visual settings throughout every sample.

This short, instrumented SwiftShader check is not performance or hardware
acceptance. Comparison eligibility remains false. It does not validate the
separate S54 collection-rendering experiment or override its visual failure.
