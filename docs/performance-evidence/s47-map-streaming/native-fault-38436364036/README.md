# Native missing/corrupt controls pass; held asset assertion fails

[Run 38436364036](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38436364036)
at `fe28df76c28ac97b248921165b6862b7bded801a` remains **failed**. The healthy
baseline/candidate journeys and candidate capture CLI complete. Both the
missing-metadata and corrupt-metadata controls now pass full outer validation,
including the post-positioning frame boundary, fallback/retry, worker/renderer
checks and cleanup. This is hosted native diagnostic evidence only.

The superseded-response control stops while its declared metadata request is
held. The host assertion expects `arcgis/MapServer/index.json`; the real pinned
fixture/delivery adapter reports
`arcgis/rest/services/World_Imagery/MapServer/metadata.json`. The unit-test fake
repeated the incorrect spelling. This is a harness contract mismatch before the
superseding OSM switch and release, not a failed stale-response recovery result.

The fault is injected once and remains unreleased when validation stops. The
owned browser context closes, the pending preparation/abort subscription are
cancelled, and interception confirms zero pending work after drain. Page-owner
retirement is explicitly unconfirmed until context close; it is not called a
successful in-page disposal. The scenario needs a corrected strict asset
identity and a fresh run; no path-pattern relaxation or retry is appropriate.

Reviewed correction `e0710bd5cf3ba7c5d0d5383189b82fd8475ec087` (Luna source
`e5dc52017ff1d8790122e51f5b517c96d74dafe2`) takes the exact held path from the
declared fault scenario and binds the test fake to the fixture manifest. It
keeps the strict equality assertion and all existing counts and deadlines.
Root passes all 100 map capture, delivery and build-smoke tests, capture-harness
lint (29 files), changed-file formatting and the diff check. The original
focused output is in [fix-focused-tests.log](fix-focused-tests.log).
[Fresh native run 38439382587](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38439382587)
tests that exact corrected revision; its outcome is not inferred from local tests.

Original artifact `11833113912` is retained unchanged:

| File                                                                                   |  Bytes | SHA-256                                                            |
| -------------------------------------------------------------------------------------- | -----: | ------------------------------------------------------------------ |
| [Outer report](performance-build-smoke.json)                                           | 645725 | `37152ad70adeb85292976ab36965bba548a12da4c4ba197a5aca69b403065b9b` |
| [Candidate CLI report](performance-build-smoke.json.capture-cli-report-candidate.json) | 377421 | `8c08f2b417a2ef8777f2c3dcb8ecc7bf8fc6fbba91d23de54257890f4c6a2d9d` |
