# Cesium dependency identity guard

Vite now checks that the application, Cesium and widgets resolve one canonical
engine before starting a development server or production build. Package version
equality is insufficient: two installed copies have independent capability
tables. An inconsistent installation now fails with a repair instruction rather
than starting a viewer whose limits may remain zero. This check does not rewrite
dependencies, clear shared caches or override engine limits.

The diagnosis comes from the exact-source Windows infrastructure comparison at
`19b0cb60c47f8161a4c07855d0343d43cccc30c8`. Its mixed installation produced two
engine modules and rendering exceptions. A fresh isolated locked installation
produced one engine and no such exceptions, but still failed a 400 ms frame wait.
[Preserved before/after graphs and reports](https://github.com/arthurianresolve/gods-eye-view/tree/751da30/docs/performance-evidence/s54-production-collections/windows-dependency-graph-19b0cb6)
also include independent WebGL/plain animation controls. This repair does not
claim to solve the remaining Windows graphics scheduling issue or complete GPU
acceptance.

Recovery: create an isolated checkout with a real, unshared `node_modules`, run
`npm ci` there, and rerun the failed check at the recorded commit. Do not run an
installation through a shared dependency junction or discard failure evidence.
The check accepts coherent shared paths but rejects different canonical engine
owners, including same-version nested packages and mixed junctions. Cached
browser bundles are separate artifacts; the recorded recovery used a fresh Vite
cache from the new installation.

[Focused validation](review.json) records 21 passing checks, format/import/package
checks and a production build on Node 24. Full exact-commit integration evidence
must be recorded separately.

All seven ordinary CI jobs passed at `20e7655e969fb5384700bb161a54306715b81e09`: Node 24/26 suites and production builds, the browser journeys, Windows onboarding, and installation/update recovery on Windows, Linux and macOS. [Run 38132827900](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38132827900) and [saved job results](ci-38132827900.json) bind this evidence to that source. These are automatic compatibility checks, not Windows GPU or full performance acceptance.
