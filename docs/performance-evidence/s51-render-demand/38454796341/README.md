# Empty-fleet observation and timestamp-validation failure

[Run 38454796341](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38454796341)
tests clean application/harness `c716093fdb0f20d571c70ea2f666ead98b7e6e79`
on hosted Linux with SwiftShader. Both the mixed-use smoke and durable workspace
journeys pass. The render-demand probe remains failed; no final qualification
or accepted optimization follows from this report.

The corrected profile reaches a ten-second observation: **22 completed renders**,
with continuous `flights` and `military` holds despite zero records in both layers.
The camera, visual settings, enabled populations and settled tile queues remain
unchanged in the recorded snapshots; all 185 map attempts are intercepted and no
new map attempts occur during the observation. The simulated document visibility
handler stops the loop and produces a new frame on resume. This verifies that
handler only, not physical browser visibility. OSM content is intentionally
blocked for this demand diagnostic, not validated as rendered imagery.

The `end-snapshot` validator then incorrectly compares every statistics field for
strict equality, including military `lastUpdate`. The original log shows that
field advancing from `1791460821053` to `1791460836057` while all other statistics
remain equal. The readsb source adapter derives observation time from receipt
clock minus the feed-age header; normal successful polling with fixture age zero
therefore advances it. Payload `now` does not override that adapter contract.
The harness needs separate bounded timestamp validation while preserving strict
population, health, identity and visual checks. The failure stops before terminal
teardown validation and source-finish verification; those remain unvalidated.

Artifact **11843105185** has verified ZIP SHA-256
`da63388ce27479cdf8eae76ffe6416d08e85b248447f5d235e42f58ab0454394`.
All six entry names were checked before selective extraction. Raw logs retain
the full assertion and timestamp values; the existing redacted projection omits
those fields. [files.json](files.json) binds all ten retained raw/report files.
No deadline, frame limit or production behavior has been changed in this packet.
