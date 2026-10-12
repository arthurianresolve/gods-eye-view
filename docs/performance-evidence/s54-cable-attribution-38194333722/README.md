# Cable classification and visual mismatch attribution

[Run 38194333722](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38194333722)
tests exact application/harness commit
`12b2b6c9b17b8fca383f66444e47c4ba54c6aa6b` on the free hosted Apple
paravirtual Metal renderer. The result is **failed**, at cross-mode comparison.
Both lifetimes finish their readiness checks and capture ten images each.

The complete [raw report](report.json) has SHA-256
`0871247e8908a58eeffb9a3c26a6b503415b468f9324be486a8560e8f3d764f2`.
The [independent review](review.json) decodes all twenty PNGs, validates their
RGBA hashes and compares all ten pairs. Five default-view pairs match exactly.
All five camera-change pairs differ by 114 pixels and have different geometry
hashes despite matching final camera hashes. Four representative PNGs are
retained in [images](images); every original image remains embedded in the raw
report. The final-settling changes therefore do not close visual acceptance.

The map-classification probe confirms that each photoreal/terrain transition
changes the classification of all 1,913 ground-line Entities and replaces the
ground-polyline owner. Both rendering modes retain owner 1 for the notification
control, then replace it with owners 2 and 3 on classification changes. The
control does not replace a provider, and its elapsed time includes the initial
geometry build; it is not a warmed no-op timing comparison. These observations
attribute rebuild ownership, not the camera-view pixel mismatch or an engine
worker defect.

Page errors, interception errors and external request counts are zero. Both
lifetimes release their data sources, collections and listeners. Browser exit
completes naturally. Hosted acceleration is supplemental evidence, not physical
Windows/macOS coverage, and no speedup or release acceptance is claimed.
