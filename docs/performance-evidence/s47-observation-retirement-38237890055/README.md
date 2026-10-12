# S47 terminal observation: cleanup passes, later warmup misses host deadline

The [exact-commit diagnostic](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38237890055)
at `fda1cb883cf07d322559c15c63bf059c93e6b391` **fails** during scripted-motion
run 2 warmup. Baseline smoke passes. The candidate completes idle runs 1-2 and
scripted-motion run 1; tracking is not reached. This is instrumented SwiftShader
integration evidence, not a physical GPU or paired performance result.

GPT-6 Luna moved disposable viewer retirement into the same page task as the
final startup/population observation, or into the final measurement postRender
callback. Warmup and shared nonprovider documents remain active. Root review
found a browser-serialization boundary in the first draft: a
function passed as an evaluate argument would be lost. Luna corrected it: the final implementation
composes trusted helper sources on the host and sends JSON-safe arguments; its
regression exercises the real tracking helper. Root also applied scoped formatting.
Seventy-four focused tests, full formatting (1,570 files), package boundaries and
diff checks pass. The candidate remains isolated from `dev`.

Both outer smoke observations confirm retirement. In the capture child, startup,
main setup and all three completed samples confirm true-to-false render-loop
transitions. Their five reached document cleanup gates pass: host document-stage
times are 22.401, 5.534, 1.907, 1.862 and 8.742 ms. The page cleanup callbacks take
0.1-0.2 ms. All three CPU profiles now complete with no profiler teardown errors;
the previous first-motion diagnostic cleanup failure does not recur in this run.
This is limited evidence for the new ownership boundary, not proof that every
intermittent cleanup or rendering failure is fixed.

The later failure has distinct timing evidence. Host dispatch begins after
0.291 ms, but the page-entry acknowledgement is received after 2,990.139 ms.
The page observes postRender after 3,121.1 ms and settles after 3,121.3 ms, with
its listener and timer removed. Its five-second page timer does not fire.
The response arrives after the unchanged six-second host observation deadline;
the recorded host elapsed time is 6,113.857 ms. It remains a failure even though
the late page result says `settled`. Warmup does not retire rendering.
The failed document's progress binding is removed in 121.058 ms, and outer child
cleanup is confirmed.

The three profiles cover the completed documents, not this failed fourth
document. They cannot attribute its dispatch/frame delay. The next controlled
investigation should examine the separate warmup-clock hold and render-observer
dispatch boundaries while preserving the declared warmup, observation budgets
and required completed frame. No unchanged retry or deadline increase is a fix.
Independent S50 revision work continues while this integration remains failed.

- [Original bounded report](report.json): 192,038 bytes, SHA-256
  `de012dbc33b50ee7b7df4c6e98b8465e465d59c0ff3279d15465174e5b0a0b9f`.
- [Independent hash, retirement and timing review](review.json).
- [CPU profiles and reference files](cpu-profiles), copied byte-for-byte and
  verified against their embedded lengths and hashes.
- [Terminal workflow metadata](ci-run.json).

The raw failure projection explicitly reports `evidenceTruncated`; retained
observations do not establish anything about omitted data. S47 remains partial.
