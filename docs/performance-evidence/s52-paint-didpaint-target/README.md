# Conditional-paint allocation diagnostic

Five alternating paired runs compare the unpublished named-field prototype
`233d6269…` with corrected paint-outcome prototype `2cf2d2c0…`. They do **not**
compare against production or establish performance acceptance.

| Workload | Candidates / painted | Median paired allocation change | Pair range |
| --- | --- | --- | --- |
| Infrastructure | 320 / 192 | -13.84% | -13.84% to -3.81% |
| Submarine cables | 160 / 96 | -15.59% | -15.59% in all five pairs |

The revised prototype preserves each item's actual paint outcome and compares
the keyhole's geometry and opacity once per canvas. This removes duplicate
per-item keyhole-opacity calculation during snapshot capture and comparison.
It also contains the independently verified callback-lifecycle guard described
in [the regression evidence](../s52-paint-callback-regressions/README.md).

The independent review compares all 296 source-graph files between sides,
allowing only the hash-bound renderer to differ. It verifies all 20 raw worker
logs, sample conditions, ten chunk values per run, medians, maxima and unchanged
candidate/painted/source populations. Runs use Node 24.16.0 on Windows, 3,000
warmup frames, six stabilization chunks and ten measured chunks of 48 frames.
These GC-bracketed heap deltas are not browser CPU, GPU or motion measurements.

The raw report's `focused.summary` is empty because its display formatter
expected a different test reporter. The raw TAP file independently proves
69 tests passed with zero failures or skips; the runner checked the TAP counts
before starting allocation workers. `review.json` records the correction and
artifact hashes while preserving the original report bytes.

Both source snapshots are retained: [reference](../s52-paint-scalar-diagnostics/reference-worldOverlay.js.txt)
and [corrected prototype](../s52-paint-callback-regressions/prototype-02-worldOverlay.js.txt).
The archived runner and full test file document the experiment. A transplant
onto the current production renderer, full allocation budgets, native pixel
comparisons, CPU comparisons and integration checks remain separate gates.

The first current-base transplant `d0f6ed53…` subsequently passes 12 of 13
allocation rows, failing only rocket-mission overlays at 6,081 bytes/frame
against the unchanged 6,000-byte budget. Its [raw TAP](current-base-allocation-failed.tap.txt),
[renderer snapshot](current-base-worldOverlay.js.txt) and
[rejection record](current-base-rejection.json) preserve that result. It is not
promoted. The prototype gains above do not override this production-base gate.
