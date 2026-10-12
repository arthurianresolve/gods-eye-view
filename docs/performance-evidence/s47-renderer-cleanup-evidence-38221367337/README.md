# Renderer probe cleanup: late registration acknowledgement

[Run 38221367337](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38221367337)
tests harness and candidate commit
`4f3f8de8eb6fb904a551f2f29609983f44b31068`. It **fails** during baseline
cleanup before the candidate or CPU profiles run. The full run takes 53,775 ms.
There are no reported page or fixture-interception errors.

The diagnostic preserves the original document-cleanup-then-registration-removal
order and shared 1,000-ms bound. It separates exceptions from timeouts, retains
bounded redacted error details and late completion, and verifies document state
instead of reusing confirmation from an older document in the same Page. Recent
cleanup records are bounded with an omitted count. Root independently passes 84
focused tests; the agent's final focused, formatting (1,566 files), boundary,
syntax and whitespace checks pass. No application runtime or quality changes
are included.

The returned evidence identifies the failing phase:

| Phase                                | Observed result                                                                                                       |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------- |
| Document cleanup                     | Confirmed after 869.320 ms. Native hook restored, both owned listeners removed, probe state deleted.                  |
| Future-document registration removal | Timed out after 130.480 ms, consuming the remainder of the shared bound. Acknowledgement subsequently completed late. |
| Overall cleanup                      | Failed at 1,000.064 ms. Late acknowledgement does not turn the timeout into a pass.                                   |

Puppeteer's resolved removal call acknowledges its registration operation; its
implementation suppresses individual per-frame protocol-removal errors. The
report states that limitation and does not claim independent browser-side absence.

The prior boolean helper obscured this distinction. The new evidence establishes
that this run's failure is the serial retirement of the probe's document and
future-navigation registration within the shared cleanup budget. It does not
establish a driver defect, the historical Windows frame-failure cause, or a leak.

The next correction moves future-document registration removal to immediately
after its one required navigation, before dense activation and measurement.
Removing that registration leaves the already-installed current-document hook
and context-loss listeners intact. Those listeners must remain through the last
observation, and final document cleanup remains required. Early-removal failures
must still fail the run; the existing deadlines and visual settings stay fixed.
This is an ownership-lifetime correction to implement and validate, not an
accepted performance result.

The [raw report](report.json) is 3,202 bytes, SHA-256
`7231414a71ef06c3a3b4882752d07f3b2ca00a8955aa1c69e6163589b3c5fbe8`.
[Terminal CI metadata](ci-run.json) preserves the failure. No completed dense
capture, latency improvement or hardware acceptance is claimed.
