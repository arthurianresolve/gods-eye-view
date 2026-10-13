# Canonical native 3D Tiles corpus

Reviewed implementation `da75e90c` (source `7b0387b9`) pins the 21 GLBs and
tileset JSON whose generation produced different bytes on Windows/Linux and
macOS. The 22 files total 66,887 bytes and preserve the verified Windows/Linux
v1 corpus exactly. Their source revision is
`7fbbf1fa56fe3d9c746827be0b501b7b31cfb87e`, with originating manifest
`36eb2997bb092b029a541b810f92d7c19d982010e763129948acb438c18a277f`.
The old raw reports and macOS corpus identity remain historical evidence.

Current generation is explicitly `austin-map-streaming-synthetic-v2`, schema
`gev-map-streaming-fixture/v2`, generator version `2.0.0`. The canonical asset
directory retains its v1 name to identify the pinned bytes' origin. The v2
descriptor includes that origin and the exact pinned inventory. Missing files,
altered bytes, wrong lengths, duplicate identities and unrecognized inventory
entries fail validation; recomputing a manifest hash cannot legitimize altered
canonical assets. Git attributes preserve the exact JSON and binary file bytes.

Root independently compared the old Windows v1 generator and the v2 producer:
all 72 asset buffers, geometry metadata, coverage and route bounds are identical.
The total remains 1,949,945 bytes, under the existing 5 MiB limit. Terrain and
imagery generation is unchanged. The deliberately versioned descriptor and
source provenance produce a new full manifest SHA-256:
`31f63be4f0d20864e909134f44a319c2af72e2e1f724ab4996bbd8f5a12fae7c`.
Generator source SHA-256 is
`0bdfece681d0f4e198758ee57bb389ae86494569a79fa06aa2a4632833527369`.

Root passes 106 distinct focused checks: 96 map capture, fixture, delivery,
failure-report and smoke tests, plus 10 build-smoke contract tests. These include
pinned Cesium parser/geometry checks and actual interception byte comparisons.
Historical failed v1 envelopes preserve their original fixture identity and
well-formed hash through compaction/reprojection; live validation remains bound
to the actual v2 fixture and does not accept v1 as a current pass.

The existing installation/recovery jobs now run the fixture suite on Windows,
macOS and Linux Node 24.14. The normal Node 24/26 Linux suites also include it.
Those checks assert the same full expected manifest hash; no new runner or paid
hardware is required. Cross-platform results for this exact implementation are
pending, and the original floating-point difference's cause is not claimed to
be established.

This fixes corpus reproducibility by construction; it does not fix the separate
[level-15 imagery coverage failure](../native-38404611321/README.md). Native
baseline/candidate completion, physical Windows and S47/S60 acceptance remain open.
