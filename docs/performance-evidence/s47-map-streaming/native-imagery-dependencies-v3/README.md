# Native imagery dependency diagnosis for v3

The [unchanged failed native report](../native-38409997486/performance-build-smoke.json)
retains eight of eleven missing imagery paths. A CPU replay using the installed
Cesium engine 22.3.0 reproduces all eight from actual imagery skeleton targets
and their parent chains over the fixture's twenty geographic terrain tiles.
Root independently reran the diagnostic at QA `e5ff5303`; its complete output
matches the executor's output. This is CPU topology evidence, not rendered or
hardware acceptance.

OSM's provider covers the world. Cesium constructs its imagery skeletons using
the full geographic terrain-tile rectangles, while the existing v3 image
inventory covers the declared route rectangle. The complete skeleton/parent
union references 38 imagery identities, 21 absent from the 578-asset fixture.
The actual ArcGIS provider constructed from local fixture metadata references
17 identities and none are missing, because its provider rectangle is bounded
by that metadata. The diagnostic suppresses only ArcGIS's browser-only missing
tile image probe; no image rendering is claimed.

Adding those 21 paths with the existing low-level encoder projects 599 assets
and 4,013,691 served bytes, below the existing 640-asset and 5 MiB limits. The
512-request document limit remains unchanged. This finite dependency inventory
supports a separate v4 correction; it does not recover the three omitted
browser paths or guarantee all future upsampled descendant requests. The next
native run must still validate actual delivery on both revisions.

The [raw CPU report](replay.json) is 17,612 bytes, SHA-256
`f0b289f36a6e7cf1f88f817634288b2e2253ee10cddd5e7eaa3dec202df1f5eb`. It records native source hashes, exact fixture and failed-report identity,
provider rectangles, dependency paths and bounded size projections. Historical
native failure remains failed and ineligible for acceptance.

[Replay script](replay.mjs) must be run with the v3 fixture source/dependencies
from `e5ff5303` (or `88420e23`), passing the historical native report path and an
output path. Later v4 fixture code changes the diagnostic inventory, so a run
on that code is a new comparison rather than reproduction of this v3 report.
