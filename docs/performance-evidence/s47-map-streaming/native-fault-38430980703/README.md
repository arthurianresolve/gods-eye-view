# First native fault-document run: navigation defect

[Run 38430980703](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38430980703)
at `c7c47245f96e4839312983e8bcbba1da57948b4e` remains **failed**. It used the free
standard hosted macOS runner with ANGLE Metal / Apple Paravirtual rendering.
It is diagnostic integration evidence, not physical Windows qualification.

The healthy baseline and candidate each completed photoreal → Esri → OSM →
photoreal with ready providers. Baseline delivery acknowledged all 223 requests;
candidate acknowledged all 236. Both had zero pending/error observations and
confirmed cleanup. The candidate capture CLI completed four samples with passing
integrity. Neither fact changes the failed overall outcome.

The first independent fault document failed at application navigation. The static
server supplies a base URL ending in `/`; the new runner appended `/?welcome=0`,
producing a doubled root slash. The static request parser rejects that path, so
the application never initialized. Fault injection count is zero. The owned
browser context closed and interception cleanup was confirmed. This new harness
defect does not implicate the reviewed main merge or a rendered provider failure.

Reviewed fix `48efbf405dc4658294aee9bd2616f133fb9d532b` (source
`7e07f4739c7188ce809afd6ffb13d07ec69621e9`) constructs the entry through `URL`
resolution and adds a trailing-slash producer regression. Non-success HTTP status
rejection remains; its error now includes the status. Root passes all **98/98**
affected page, delivery and smoke tests after the fix. No timing or acceptance
limit changed. A fresh rendered run is still required.

Original artifact `11830867557` is preserved without reformatting:

| File | Bytes | SHA-256 |
| --- | ---: | --- |
| [Outer report](performance-build-smoke.json) | 359110 | `9669464f1b350b90673b3e60fa14c29b1ed1fe85bc32f1a7097b9bf9a769ef3c` |
| [Candidate CLI report](performance-build-smoke.json.capture-cli-report-candidate.json) | 380167 | `4004e4cc4c57948449476a0e44f6a5ece7dca5a5e4aa898bc6b4ab229663e426` |
| [Fix test log](fix-focused-tests.log) | 9595 | `bb3b015d792c22450a8ba3904375eb9bebaea9371aed45be33d3ba7f65fe1ad8` |
