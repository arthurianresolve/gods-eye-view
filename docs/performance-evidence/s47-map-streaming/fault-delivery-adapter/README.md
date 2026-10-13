# Bounded map fault delivery adapter

Reviewed QA `c05d973a` adds three explicit, candidate-only controls: one Esri
metadata 404, one invalid-JSON metadata response, and one held valid metadata
response for supersession. The fixture's original bytes remain immutable.
Healthy delivery validation rejects every intentionally faulted report.

Interception carries the actual CDP request identity through response preparation
and acknowledgment. A later same-URL request or unrelated asset cannot consume
the targeted acknowledgment. Reports retain the observed method, status, byte
length and digest; the validator independently derives expected bytes from the
fixture. Negative counts, undeclared faults, missing acknowledgments, altered
digests, unexpected errors and request-limit violations fail. The existing
512-request cap is unchanged. A held response lasts at most 30 seconds, only one
waiter is allowed, and cancellation/disposal settles owned pending work.

Root's expanded ten-suite run initially passed 177 of 178 checks; a smoke test
producer omitted the newly required request ID. The reviewed correction updates
that producer and tightens artifact bounds. All 63 affected delivery/smoke checks
then pass without skips; the other eight suites are unchanged. Capture lint,
package boundaries and changed-file formatting pass. [Review and raw log hashes](review.json)
preserve the original failure and corrected result separately.

This is adapter and report-validation coverage. Page-level production switching,
fresh-document orchestration and actual rendered fault/recovery validation remain
pending. It is not a GPU measurement or slice-completion claim. The earlier
healthy-route native pass remains bound to `4b60f453`.
