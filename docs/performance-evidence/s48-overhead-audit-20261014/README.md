# Current overlay instrumentation audit: inconclusive comparison

The existing CPU-attribution command completes at clean source `acbb4894` on
Windows Node 24.16.0. [Raw output](report.json) is retained with source and
artifact hashes in [review.json](review.json). The run uses a mock Canvas2D
context and no forced GC, WebGL rendering or browser profiling.

Reported on/off median ratios are -6.2% generic, +2.1% infrastructure, +1.7%
radio and +28.9% detection. These are **not accepted overhead estimates**:
source review finds that each trial advances the same frame/time cursor rather
than replaying identical inputs. The radio trial paints between 396 and 411
entries. Detection reads the unrelated overlay counters as zero instead of
recording its actual detection population. A timing difference cannot be
attributed solely to instrumentation under these conditions.

The next control must use matched fresh lifetimes, route/time/warmup and
population witnesses, with a versioned report. Keep the failed comparison
assumption visible; do not repeatedly run unchanged samples or relax a gate.
This audit concerns the CPU attribution mode only. It does not invalidate the
separate allocation test mode or establish a runtime rendering regression.
S48 engineering and its final diagnostic/hardware matrix remain open.
