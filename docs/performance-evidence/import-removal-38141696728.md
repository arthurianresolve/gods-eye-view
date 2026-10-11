# Import removal browser correctness failure

Hosted native-renderer run `38141696728` at application commit
`81fba13c07bcae64757c09892c773b27aba66e17` failed the strict same-population
pixel-equality check. The report contains only pair 0: synchronous and
cooperative modes each had 5,000 entities and captured one fresh post-render
frame at 640 x 360, but their SHA-256 values differed:

- Synchronous: `de653e384b0f87cc74bb742fa0e0bea46bcfce733a89e7524971793f91a71d56`
- Cooperative: `4d634316ec8e49ab475ecacf6ef53b7ed1d55d71750756b45280bbff35c8a279`

The fixture waited 20 ms after each import and then captured one completed
frame. It did not retain PNGs or locate differing pixels, so this failure does
not yet establish whether the mismatch was transient readiness or a stable
visual difference. The raw hosted report is
[`import-removal-38141696728-failed.json`](import-removal-38141696728-failed.json),
SHA-256 `eae2c085ffc9b89568cc5e32c597f479fe7d602a3df5a4421ba0e06547d2b0ed`.

The fixture follow-up adds failure-only, bounded before/after PNG snapshots and
up to 24 exact differing-pixel samples. It does not add a readiness delay,
change the pixel comparison, or alter the runtime. This failure remains a
visual-fidelity blocker; the EntityCollection timing comparison alone is not
acceptance for the import change.
