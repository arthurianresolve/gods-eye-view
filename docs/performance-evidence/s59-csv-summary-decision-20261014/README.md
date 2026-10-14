# CSV summary experiment disposition

The exact-source five-pair replay at `da7a3308` preserves identical complete
preview hashes. Median totals are 354.7 ms before and 348.0 ms after (-1.9%),
but the candidate is slower in four of five pairs: +1.4%, +2.7%, +4.6%, -25.4%,
+12.8%. No local tests or agent benchmarks overlapped this run; background
Windows/browser activity was not independently controlled. This Node diagnostic
does not establish browser interaction, GPU performance or a repeatable regression.

A repeatable benefit is not demonstrated, so the CSV summary accumulation
experiment is removed. The restored file matches its pre-experiment source
`b641993b975f53d4c396736d1079aa144e67754a4222fec713dde3bf972f492d`.
GeoJSON batching/summary and workspace ownership fixes remain. All 49 affected import/workspace checks pass, including complete preview parity
and cancellation. Earlier timing reports are unchanged.

[Raw report](report.json) and [decision with artifact hash](review.json) retain all
five pairs. The replay driver now pins the experimental candidate commit so it
can reproduce the comparison after runtime removal; it records the executing
harness commit separately. This closes only this optional summary experiment.
Indivisible parse cost and final large-import interaction qualification remain
explicit limitations; this decision does not close S59.
