# Hosted startup failures at b52c8abb

The immutable source/harness is `b52c8abb279275f9085fefbfa49a9e2ea6f4a2a6`.
These failed diagnostics do not supersede or qualify any previous result.

The [weather run](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38517126989)
again fails at history preflight before a sample is measured. Correcting the public
diagnostic shape did not resolve the full failure. The report does not identify
whether the history-frame count or slider maximum differs. Follow-up `52481201`
records those bounded scalar values and preserves the existing selected-layer and
fixture-delivery snapshot when timeline preparation fails. It changes neither
the required three phases nor their source-time checks or deadlines. All nineteen
focused weather checks and capture lint pass.

The [infrastructure run](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38517129632)
fails at a 30-second navigation timeout before the infrastructure report is read.
Its capture matrix and import fixture completed first; neither establishes that
the datacenter comparison started or completed. No stability or collection result
can be inferred. The artifact confirms hosted Apple paravirtual Metal, not physical
Windows coverage. The next diagnostic must preserve startup state and bounded
request observations before attributing this failure or changing navigation.

Both downloaded diagnostic ZIPs matched GitHub's reported digest. Original artifact
metadata and unmodified JSON are retained, with per-file SHA-256 in `sha256.json`.
No failure is relabeled a pass and no timeout or readiness gate is relaxed.

Separately, S59 CSV summary work is integrated at `15bd1b65`: the second full-record
summary pass is replaced by accumulation in the existing normalization batches.
Root passes 23 import/cooperative/cancellation tests, including empty/invalid data,
unknown time and duplicate-ID controls. The exported preview API is unchanged.
The agent's Node timing diagnostic has matching output hashes; it does not qualify
browser responsiveness or the remaining synchronous decoder.
