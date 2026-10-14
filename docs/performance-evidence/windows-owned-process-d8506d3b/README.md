# Windows cleanup test fixture ownership correction

The clean-source `e53df518` local full suite failed one assertion: it expected
two `taskkill` invocations, but observed one. The first tree kill had already
terminated the fixture's supposed separately owned browser process because the
fixture spawned it inside the CLI process tree. The later PID-presence check
correctly found it absent and confirmed cleanup. This was a fixture ownership
race, not a failed production cleanup or an exceeded shutdown deadline.

Test-only commit `d8506d3bf4509bb6c5ac2eb61d070abbc35340f1` starts the separately
owned process from the test runner, waits for its spawn and records its PID
before starting the timed CLI. The production helper is byte-identical. The
200 ms deadline, output cap, independent-process cleanup assertions and retry
policy are unchanged.

Six focused checks pass. The clean-source full Windows Node 24.16.0 suite then
passes 7,832 ordinary tests with ten skips, followed by all fourteen serialized
allocation checks. HEAD and working-tree cleanliness remain unchanged from
start to finish. The failed and passing raw logs and run metadata are retained,
with hashes in [files.json](files.json).

This explains the reproduced test assertion only. It does not establish the
cause of earlier intermittent Windows browser recovery timeouts, nor a hardware
rendering, frame-capture or full soak result.
