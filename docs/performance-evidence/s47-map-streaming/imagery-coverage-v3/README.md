# Native map imagery coverage through level 15

Reviewed implementation `b91dafa8` (source `223eb55b`) extends the synthetic
Austin map fixture from imagery levels 0-12 to 0-15. It addresses the
[observed missing level-15 requests](../native-38404611321/README.md).
The workload selector remains `austin-map-streaming-v1`; the versioned data is
now `austin-map-streaming-synthetic-v3`, schema `gev-map-streaming-fixture/v3`,
generator `3.0.0`. Historical failed v1 and v2 reports retain their identities
and remain ineligible for performance acceptance.

The 506 new tile identities comprise 30 level-13, 108 level-14 and 368 level-15
tiles. Their 256-by-256 indexed-color pixels follow the existing contour formula
and palette. The 232 required low-byte seeds have 168 distinct pixel patterns
because the contour's palette repeats every 176 seed values. Pinned, compressed
PNG templates avoid runtime compressor variation. Each served tile owns a copy;
mutating one tile cannot poison the template cache or another fixture.

The corpus and index are immutable authorities with checked hashes, lengths,
coverage, seed mappings and byte ranges. Recomputing an altered tile's manifest
does not make it valid. The existing per-document delivery limit stays at 512;
inventory tests use two bounded delivery cohorts to cover all 578 assets.
The separate manifest inventory limit is 640. The materialization limit stays
at 5 MiB; no rendering settings, route, readiness deadline or request limit is
relaxed.

| Item                 |   Bytes | SHA-256                                                            |
| -------------------- | ------: | ------------------------------------------------------------------ |
| PNG template index   |  28,370 | `d7c9b77091f1ac6daff16542fcd972f95cb47ab6f858e650208d0406b28fa764` |
| PNG template corpus  | 225,583 | `f2de5cbdd02f5dfd91de10bedabf55511aceb81538aa083d9908ea3cd9271025` |
| Complete v3 manifest | 148,053 | `fdd277b9107d59a8efd96a151b5f9770e646bbe6598f73ef862b6c5a50cbd6ac` |

Served asset bytes total 2,629,266; assets, manifest and pinned imagery files
together total 3,031,272 bytes. Generator source SHA-256 is
`6c5c3445288ac83ffe577c97024ba91438a2278bd7932fda80df6902ed977c67`.

Root independently passes 107 focused tests: map fixture and actual Cesium
parsers, native interception/delivery, map capture, failure serialization,
build-smoke contract and smoke orchestration. Capture lint passes all 25 files.
Luna's formatting and import/package boundary checks also pass.

The [independent pixel review](independent-pixel-review.json) decodes all 506 new
tiles and compares 33,161,216 pixels against the original unreduced seed formula,
including palette and alpha. Seventy old asset buffers are unchanged. ArcGIS
metadata only adds the three LODs; its transparent missing-tile probe moves from
level 12 to 15 with identical bytes. Existing imagery, terrain, 3D geometry and
route bounds remain unchanged. This review artifact is 1,331 bytes, SHA-256
`f17e49d19f30a2616241879f997cc6c0fdd5ee2e32aaaad140b5cd089a91df9f`.

Code is implemented and focused automatic validation passes.
[Standard integration](../../integration-88420e23/README.md) passes all seven jobs,
including the fixed v3 hash and parser checks on Windows, macOS and Linux.
The [native v3 journey](../native-38409997486/README.md) completes the baseline's
route but fails on eleven missing lower-level imagery assets; the candidate
never runs. Complete rendered baseline/candidate acceptance, physical Windows
captures and final performance/retention acceptance remain pending. Native
validation must use diagnostic worker auditing, not receipt-only auditing.
