# Native imagery dependency coverage in v4

Reviewed correction `ec71877a2021e0fff95e63aa2db025a8481b08b4` (Luna source
`27a82c7b52ffe3486b777525e222177037d6e57b`) adds the 21 OSM imagery skeleton and
parent dependencies established by the [v3 CPU replay](../native-imagery-dependencies-v3/README.md).
It does not widen route bounds, change terrain geometry, adjust visual settings
or hide missing requests. Route-bbox coverage and native dependency coverage have
separate manifest fields. Generation and validation recompute the finite
skeleton set through the pinned Cesium implementation.

The v4 manifest has 599 assets and 4,013,691 served bytes, below the unchanged
640-asset and 5 MiB limits; the document request limit stays 512. Its SHA-256 is
`0d739d9e4830faff2751d40945870eb7b56b9b76dc65e8cd64cb7deb5cb9b033`.
The generator source SHA-256 is
`55a6270abae383e82d31277c149484fb0b69e844a2a6441211fa647dc5c669c2`.
Pinned high-LOD imagery and 3D Tiles corpus files are unchanged.

Root passes 108 focused tests across the fixture, delivery, capture,
failure-report, build-smoke contract and outer smoke suites. Root independently
compares every prior asset: all 578 byte buffers are unchanged. The 21 additions
exactly match the CPU replay and all 1,376,256 decoded new pixels match the
original seed formula, palette and opacity. Imagery route, terrain and tileset
coverage remain equal. The [independent review](independent-review.json) is
578 bytes, SHA-256 `b203ca31147d544c7e3ddeb9906e311dd2ff80d1fc4d3ba0f27f51859efcc24d`.

The live capture accepts v4 only. Historical v1/v2/v3 failed envelopes remain
readable as failed diagnostic evidence. Negative tests reject missing/extra
dependency metadata and removed/corrupt image assets even after rehashing the
manifest. Upsampled descendants are explicitly not separately enumerated; the
next native browser run still has to verify both revisions' actual requests.
Three missing browser path identities from the old bounded report remain unknown.

This is a fixture correction with automatic/component evidence. Cross-platform
integration and native baseline/candidate execution remain pending. No physical
Windows, matched performance or complete S47/S57/S60 acceptance is claimed.
