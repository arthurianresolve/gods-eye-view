# S47 early renderer identity: observer cost reduced, capture failed

Frozen application/harness: 681e704ad090b43386e65e8dc369dcf0ad0ea174, both clean. Original report.json bytes are preserved.

Four samples complete (two idle and two motion). In-page observer read totals are 0.7-1.4 ms, compared with 2.1-4.1 seconds in the prior diagnostic. These single-run observations establish avoided synchronous identity queries, not repeatable full-scene performance acceptance. The workload remains 7,578 objects, 1440 by 900, Manual 75% / Dense, with SwiftShader.

The parent terminates the child at the unchanged 180-second limit while it prepares the first tracking document. The resulting detached-frame error is secondary to that timeout. Five probe documents confirm listener/hook cleanup; the sixth does not. Parent process cleanup is confirmed, which does not turn missing natural probe cleanup into a pass. The bounded raw failure report explicitly flags truncation.

Review of the capture callback also finds frame and long-task observation continuing through the final endpoint/settling frame after timed measurement. A separate follow-up isolates the timed interval and preserves final-frame work outside it; previously recorded durations and frame statistics remain historical. No complete comparison, tracking, hardware or capture acceptance is claimed.

[Hosted run](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38170201283).

Original report SHA-256: 8dcca4d799b5dba53bf063c4889cc80bfdd03fb99b07e7ae70a77694ce505337
