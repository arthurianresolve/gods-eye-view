# S47 infrastructure smoke: clock adapter failure

[Run 38188605428](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38188605428)
tests application and harness revision `87fad3fd3aa8f83a6e53d6a9cc0fd734b56bac69`
with the new `infrastructure-datacenters` candidate capture selector.
The ordinary baseline smoke passes. Candidate dense setup observes the expected
2,500 aircraft, 4,362 datacenters and 716 dams. The additional infrastructure
capture enables exactly 4,362 datacenters but fails before its first sample:
`Infrastructure document wall clock did not remain at the fixture epoch.`

Source inspection establishes a fixture adapter mismatch: the new infrastructure
setup calls `installFixedWallClock`, whose existing implementation returns the
fixture epoch plus elapsed `performance.now()` time. The new static contract
requires the wall epoch to remain constant. The misleading helper name does not
change its existing moving-fixture semantics.

The repair must use a frozen/held adapter for static infrastructure, preserve
the dense flight fixture's advancing clock and leave performance timers and
animation scheduling untouched. Exact timestamp validation must remain strict.
The raw failed report is preserved in `report.json`; `review.json` records its
digest and attribution. There are zero completed infrastructure timing samples.
This Linux SwiftShader setup failure does not identify the Windows hardware
frame-delivery cause or supply performance acceptance evidence.
