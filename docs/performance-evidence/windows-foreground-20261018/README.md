# Windows foreground-helper diagnosis — 18 October 2026

The eight-row qualification matrix at application/harness
`9721b20206eed438bdc7299a2ce067e5cebfb1de` stopped during the baseline
operating-view capture, before scripted-motion sample 2. Its 15-second Windows
foreground runner timed out and was terminated. The baseline application was
`e7a878e168bc97ffedddc27e13bf3e69b7ee6256`. This is failed harness evidence,
not a measured application regression or an accepted performance comparison.

Two separate diagnostic runs instrumented the unchanged helper through an
out-of-tree Node loader. Neither run is eligible for performance acceptance.
The first reproduced a 15,199 ms timeout after every native activation and
input-detachment marker had completed, before the process returned its JSON.
It did not reproduce a native activation deadlock.

The second completed 11 activations on Windows with Chrome 152 and the Intel
UHD 620. Its phase timings were:

| Measured interval | Median | Range |
| --- | ---: | ---: |
| Whole fresh PowerShell invocation | 9,237 ms | 6,855–13,695 ms |
| Process launch through completion of `Add-Type` | 6,451 ms | 4,576–10,398 ms |
| Native activation through input detachment, including the 100 ms confirmation wait | 242 ms | 178–561 ms |

The evidence supports eliminating repeated process creation and native-helper
compilation. It does not establish why Windows process startup was slow, or
attribute that delay to the application, VM, GPU driver, or memory pressure.
The proposed persistent helper must still prove the owned browser PID and actual
foreground state for every sample, reject timeouts and malformed/stale replies,
and confirm cleanup. A passing mock test cannot replace parsing and executing
the real PowerShell protocol or completing a new hardware capture.

The traces and their checksums are recorded beside this report. Full failed and
diagnostic captures, hooks and logs are preserved on VM105 under
`/opt/gods-eye-view-validation/s61-s70-20261018/windows-evidence-9721b202/`.
The transfer independently verified all 15 files (3,977,377 bytes) by SHA-256.
The production service was not changed. Exact-commit CI, tracking, signed
packaging and private production-host checks passed at `9721b202`; those results
do not qualify a later helper revision or complete the hardware matrix.
