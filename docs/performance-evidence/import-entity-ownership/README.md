# Imported Entity ownership repair

Accepted correctness component: `82e2b0b1da8ac517710cdbdd8468cc3b502330c4`,
based on current dev `031b7e8269652fc5c1afb55bbd1fb8f6541971d9`.

Previously the import layer kept only Entity IDs. If another owner replaced an
imported Entity using its ID, clearing the import deleted that replacement. The
layer now retains the exact Entity instances and removes an item only when the
current collection entry is that owned instance. Existing per-Entity removal
order and externally suspended collection events remain unchanged.

Three actual-Cesium regressions cover removal order, external entities and event
suspension, and replacement of an imported ID. The focused import suites pass
15 checks. Formatting, both package-boundary checks and the production build pass.

[CI run 38156256415](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38156256415)
passes all seven standard jobs at the exact implementation commit: Node 24/26,
Windows onboarding, browser journeys and installation/update recovery on Windows,
Linux and macOS. The three raw recovery reports are extracted from their completed
job logs, removing only runner timestamp prefixes. All 15 recovery stages preserve
settings, workspace contents and the imported asset. Each closes the owned browser
without force; Windows close times are 435.8-1421.2 ms. The review manifest records
source identity, job scope and artifact hashes.

This fixes ownership correctness. It does not change the production Entity
renderer, cooperative scheduler or coordinate preparation, and establishes no
performance improvement. Hosted software-rendered recovery does not replace
physical Windows GPU evidence. Earlier intermittent browser shutdown failures
remain unresolved; a later successful exit is separate evidence. The optional
point-renderer experiment stays on its QA branch pending current-dev comparison.

Files: [review](review.json), [CI](ci-run.json),
[Windows recovery](windows-recovery.json), [Linux recovery](ubuntu-recovery.json),
and [macOS recovery](macos-recovery.json).
