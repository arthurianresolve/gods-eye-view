# S48 capture lifecycle and raw-artifact follow-up

[Run 38257168750](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38257168750)
fails at exact application/harness `5441b0386e318d4cd1e57800cfd0f163f6a15461`.
The prior cleanup scope error is repaired: active page and document ownership
remain accessible to the finalizer and follow provider-page replacement.
An independent [old-code CLI regression](negative-lifecycle-test.txt) fails
with the original `ReferenceError`; the [candidate control](candidate-lifecycle-test.txt)
preserves the deliberately injected page-creation error and witnesses browser
closure. [All 175 focused tests pass](focused-tests.txt).

The new run stops during startup before any sample or CPU profile. Future-document
renderer-hook removal exceeds its unchanged 1,000 ms deadline (observed
1,000.491 ms); its acknowledgement arrives later. The original timing failure
is retained. Final document cleanup confirms restoration of the hook, removal
of both listeners and deletion of observer state in 249.884 ms of host time;
reported page execution is zero at the available timer resolution. The parent
reports child cleanup confirmed. This is not a successful capture or proof of
a GPU/driver fault.

The new raw artifact survives the failure:

- [Original main report](performance-build-smoke.json).
- [Original capture report](performance-build-smoke.json.capture-cli-report-candidate.json):
  6,890 bytes, SHA-256 `9fd3076ce19b27045e669f8e94803ff983696542da35708233636881da235da1`.
- [Independent review](review.json) verifies exact bytes, SHA-256 and equality
  with the inline failed report; both the child and outer result remain failed.
- [Terminal workflow state](run.json).

Raw reports have a separate 8 MiB artifact bound and are uploaded before the
temporary checkout is removed. The inline failure limit remains 256 KiB.
Logging includes bounded metadata instead of raw report bodies. Tests cover
missing, malformed and oversized files, and a child that fails after writing
a completed-schema report. This run verifies retention of a real failure
artifact; successful full capture validation remains outstanding.

The next investigation concerns registration removal during startup: distinguish
its ownership requirement from the document observer's lifetime, and establish
a safe removal boundary before changing scheduling. Preserve the same cleanup
deadline and record any revised boundary explicitly. No unchanged retry or
performance acceptance is justified. This QA branch remains outside `dev`.
