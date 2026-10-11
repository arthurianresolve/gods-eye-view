# Large imported geometry: browser wake comparison

The 256-coordinate chunking experiment at
`df63fc432a7164778583c20ced4db87bc3d6d350` passes correctness in
[run 38164503656](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38164503656),
but **is not accepted as a production optimization**. Both chunked arms exceed
the 10% completion-time regression threshold in four of five pairs for both
geometry types, and their measured active spans still exceed the 4 ms target.
Production coordinate preparation and scheduling remain unchanged.

## Controlled comparison

Five groups rotate three arms: current whole-feature preparation with timer
wakes, 256-coordinate preparation with timer wakes, and the same chunking with
owned MessageChannel wakes. Every arm loads one 50,000-position line and one
50,000-position polygon (25,000 outer positions plus a 25,000-position hole).
Each arm receives a fresh page and Cesium viewer within one shared browser
process. This is not five fresh-browser pairs or a full application benchmark.

The viewer uses Cesium 1.138.0, a fixed camera and 2025-01-01 clock, ellipsoid
terrain, no imagery, a 960 x 640 drawing buffer, resolution scale one,
antialiasing, four MSAA samples and framebuffer preservation. The actual scene
renderer is recorded after timing. It reports Apple paravirtual Metal on a free
hosted macOS runner (Apple M1 Virtual, three logical CPUs, 7 GiB RAM,
Chrome 152). This supplies supplemental evidence, not physical Windows coverage.

## Result

Percentages below are medians of the five paired percentage changes, not ratios
of pooled samples or ratios of medians. Positive load changes are regressions.

| Geometry | Candidate | Paired load change | Pairs >10% slower | Paired maximum active-span change |
| --- | --- | ---: | ---: | ---: |
| Line | Chunked timer | +142.5% | 4/5 | -60.3% |
| Line | Chunked MessageChannel | +121.8% | 4/5 | -66.0% |
| Polygon | Chunked timer | +67.0% | 4/5 | -62.0% |
| Polygon | Chunked MessageChannel | +100.8% | 4/5 | -50.0% |

The medians of run-level maximum active spans are 23.2/10.7/10.9 ms for
whole/timer/MessageChannel line preparation and 12.3/5.0/5.4 ms for polygons.
Chunking reduces typical uninterrupted spans, but total measured active time
also regresses in the median paired comparison. The report separates active
callback time, initial active time, wake delay and total completion time.
Readiness waits, image encoding and cancellation controls are outside load
timing. These measurements do not isolate JIT, allocation, GC or render-loop
interference, so no specific cause is claimed for the regressions.

The next experiment must address that active-work overhead and attribute the
remaining over-budget spans before trying another wake strategy. Repeating
these unchanged arms or selecting only their best pair would not justify a
production change. S59's large-feature batching requirement remains open.

## Independent review

Root decoded all 30 PNGs and recomputed their RGBA hashes. All 15 line images
are byte-identical; all 15 polygon images are byte-identical. The two image
witnesses are retained in `decoded-review/`. All native picks resolve to their
expected import IDs. Full coordinate hashes and ring sizes match across arms;
the complete coordinate arrays are not retained for independent offline
reconstruction.

Eight tracked source hashes match the exact Git revision, and their final
hashes match their starting values. Both source and harness are recorded clean
and unchanged. All thirty timed samples release their feature, pending jobs,
context record and scheduler task. The separately labeled synthetic-clock
cancellation controls each abort an actually queued task and clear ownership.
All fifteen pages close; the browser exits naturally in 931.9 ms without forced
termination, and the fixture server exits. There are no recorded page/render
errors. The frozen report validator also passes.

- [Original downloaded report](report.json), SHA-256
  `3c4e3eeb4aac1a181cf366cd9488a0d9c51d5c96b2a9191303343817e9b03730`.
- [Independent review](independent-review.json), with individual pairs,
  decoded-image inventory and recalculated timing summaries.
- [Review script](independent-review.mjs), runnable against a fresh copy of the
  report directory from a checkout containing the frozen Git revision and
  `sharp`. It refuses to overwrite generated evidence.
- [Completed workflow record](ci-run.json), bound to the exact tested commit.

The benchmark code remains on `qa/s59-geometry-wake-browser` for reproduction.
It is not merged into production merely because its correctness checks pass.
This result does not establish interaction latency, full-scene motion,
retained-heap stability or completion of S47-S60.

## Ordinary inner-loop follow-up

[Run 38165281098](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38165281098)
tests `844edfc901c1307c494e64c404b453443379d9b5`. The sole runtime change
moves coordinate conversion into an ordinary `fillPositionRange` loop, leaving
the generator responsible only for the same 256-coordinate chunk boundaries.
The whole-feature control, fixture, scheduler and validator are unchanged.
This tests a narrow overhead hypothesis; the separate run is not a paired
comparison against the earlier chunking implementation.

The change is also rejected. Compared with the control within this run:

| Geometry | Candidate | Median paired load change | Pairs >10% slower | Median run maximum active span |
| --- | --- | ---: | ---: | ---: |
| Line | Chunked timer | +175.3% | 5/5 | 10.7 ms |
| Line | Chunked MessageChannel | +112.2% | 5/5 | 10.7 ms |
| Polygon | Chunked timer | +110.6% | 4/5 | 6.7 ms |
| Polygon | Chunked MessageChannel | +83.0% | 4/5 | 7.3 ms |

Root independently decoded another thirty PNGs; both image groups match the
first run exactly. All source hashes, pick IDs, queued cancellation controls and
cleanup assertions pass. Browser close is natural, taking 649.1 ms. Eighteen
runtime tests and changed-file formatting also pass. These correctness results
do not justify promoting either chunked renderer. Ordinary-loop conversion
alone is insufficient; a separate diagnostic profile must identify the active
cost and over-budget stages before another runtime optimization is selected.

- [Unchanged downloaded report](inner-loop/report.json), SHA-256
  `342acf8a4b136e81a2ceaf3b04a12df25199501a914608e1b19650a06e486ba7`.
- [Independent review](inner-loop/independent-review.json) and
  [exact workflow record](inner-loop/ci-run.json).
- Reproduce the offline review with the shared `independent-review.mjs`, a fresh
  copy of that report directory as its first argument, and the complete
  `844edfc9` commit SHA above as its second argument.

The follow-up remains on `qa/s59-chunk-inner-loop`; production still uses its
original preparation and scheduling defaults. Large-feature batching remains
an implementation gap, with two measured approaches rejected.
