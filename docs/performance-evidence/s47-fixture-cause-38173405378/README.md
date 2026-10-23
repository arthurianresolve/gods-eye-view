# S47 fixture protocol ownership race

[Original CI run](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38173405378). The original artifact bytes are preserved in performance-build-smoke.json.

The preserved cause is Fetch.continueRequest after Fetch has been disabled during fresh-document preparation. A queued handler from the discarded document could report into the next document because the interception helper had no disposable owner. Fix c9447d40 marks that owner inactive and removes its handler before disabling Fetch, rejects late publication, and preserves active-session failures.

Fifty-six focused checks pass, including delayed responder, in-flight protocol send, and genuine active-session errors. Exact smoke 38173706259 is pending. No performance gate is relaxed and this failed report remains failed.
