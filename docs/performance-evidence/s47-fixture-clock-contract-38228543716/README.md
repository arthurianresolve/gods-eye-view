# S47 phased-clock repair and recurring setup retirement failure

The [exact-commit run](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38228543716)
at `e3f7e096098ec2bf3c9499ce499c44951268a5a6` **fails** before reaching the
repaired clock validator. Baseline smoke passes. Candidate static observations
have the expected 2,500 aircraft, 4,362 datacenters and 716 dams, but its capture
CLI fails when retiring the main setup document before its first sample. No
measured samples or CPU profiles complete in this run.

The main-setup retirement evaluation exceeds the unchanged one-second deadline
at 1,000.158 ms. Its late result at 1,019.103 ms is `Target closed`; no page-side
execution duration or completed render-loop retirement can be verified. Startup
cleanup and the separate outer candidate smoke cleanup pass. The original
timeout remains a failure even though harness/browser cleanup is confirmed.

This recurrence means that stopping rendering inside the final cleanup callback
is not yet a demonstrated remedy for delayed callback delivery. Unlike the
preceding run, this callback never returns usable page-local evidence. It does
not invalidate the separately reproduced clock-contract bug or prove a new
application regression. The clock repair's 70 focused checks and six-clock
artifact replay remain narrow evidence; full integration remains incomplete.

Source review identifies a lifecycle ordering to correct next: provider-document
replacement currently performs the worker audit, removes the progress binding,
and disables/detaches fixture interception before retiring the viewer/probe.
All observations have ended by that point. The next isolated candidate will
retire the document before those teardown operations, retaining fixture
protection during retirement. Existing audits, failure conditions and deadlines
must remain intact. This is a proposed ownership correction, not an established
explanation for the timeout; the failed run will not be retried unchanged.

- [Original failed report](report.json): 53,372 bytes, SHA-256
  `4c280502ea681b06ab7960300ba83fe02ad93479defda82d89d41851e99fa000`.
- [Terminal workflow metadata](ci-run.json).
- [Separate standard dev CI](standard-ci-dev-38227328030.json) passes all seven
  jobs at `4562e8ecf952708260fb5496f5d9dba5f74e3648`: Node 24 and 26 suites/builds,
  Windows onboarding, browser journeys, and real installation/profile recovery
  on Windows, macOS and Linux. That does not validate this isolated capture branch.

No production setting, GPU flag, application detail, timeout, VM or deployment
changed. S47 and the final performance candidate remain incomplete.
