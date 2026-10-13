# Local Windows validation at 688619f5

Frozen source `688619f5d1159fb9119a90e0eeeefae1e30ac7c1` passes
`node scripts/run-unit-tests.mjs` on the local Windows machine, Node 24.16.0.
The source remained unchanged throughout the run. Ordinary tests report
7,809 passed, zero failed and ten skipped out of 7,819; the two separately
serialized allocation groups pass 1/1 and 13/13. See [run.json](run.json) and
the unchanged compressed [full output](full-node24.log.gz).

## Reviewed changes

Commits `164d935e` and `8d73da96` remove redundant Windows process termination
and verification after successful owned-tree termination and confirmed child
closure. Separately owned browser processes still require verification.
Confirmation belongs to the exact PID and resets if that ownership changes;
failed termination retains presence checks and conditional cleanup. Regression
tests exercise both processes, failed termination and PID replacement.

The map-fault budget regression now controls its clock through fixture setup.
It distinguishes the journey's own timeout from exhausted outer-run budget and
checks cleanup in both cases. Production deadlines and the existing five-second
child cleanup test limit are unchanged. The [focused review](focused.log) passes
all six selected budget/cleanup cases before the full suite.

Commits `35a8ce0f` and `688619f5` improve the concurrent panel-key repair test's
safe fallback diagnostics without changing key-repair runtime behavior. The
earlier malformed-key concurrency failure did not recur in this full run.
Its cause remains unresolved; diagnostic coverage is not a claim of remediation.

## Scope

The earlier local suite at `9a2517af` remains failed with three failures and its
original output preserved in the [S51 packet](../s51-render-demand/dense-cadence-9a2517af/README.md).
Removing duplicate cleanup calls is a demonstrated ownership improvement; it
does not prove the cause of that earlier 8.3-second cleanup outlier. This pass
establishes the current unit/allocation result, not a Windows browser recovery,
GPU performance, capture or sixty-minute retention pass. Both-base hosted
results at `175f2cf3` predate these three changed test/harness files.

[files.json](files.json) binds the retained logs and run metadata by SHA-256.
