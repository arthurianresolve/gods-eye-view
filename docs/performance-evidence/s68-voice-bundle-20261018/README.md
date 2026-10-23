# S68 voice transport split decision

The connection-only lazy split is rejected. Two isolated VM105 builds saved
940 bytes of gzip transfer (0.087%) or 610 bytes of Brotli transfer (0.073%)
from the initial JavaScript. That saving does not justify introducing another
request and failure/cancellation boundary when voice is first activated.

| Initial JavaScript | Control | Experimental split | Saved |
| --- | ---: | ---: | ---: |
| Raw bytes | 3,471,395 | 3,468,195 | 3,200 |
| Gzip bytes | 1,076,099 | 1,075,159 | 940 |
| Brotli bytes | 834,508 | 833,898 | 610 |

The new deferred transport chunk was 3,872 raw bytes. The audit sums each
emitted JavaScript file's compressed size separately. CSS, Cesium's external
distribution and source-map sizes are outside this comparison.

The experiment moved the connection negotiation body behind a dynamic import,
keeping synchronous session ownership, input state, cost preparation and status
updates eager. It checked the connection generation after the import. The
shared runner, control shell and their public interfaces were unchanged.
This was a size experiment; microphone, permission, push-to-talk, cancellation
and latency acceptance were not run for the rejected prototype. The production
connection source was restored byte for byte, and the temporary module removed.

The broader voice graph contains shared presentation and action behavior. Its
522,760 Rollup rendered bytes cannot all be counted as removable startup
payload. A larger controller redesign has not been implemented or qualified.
Existing dynamic locale loading remains in place.

`comparison.json` records the source commit, source identity check, emitted
chunk names and the full artifact's hash and VM location. All 1,226 checked
runtime/build/server/lockfile inputs matched the recorded commit after the
experiment. These diagnostic builds use no environment discovery and do not
claim to be deployable, attested application artifacts.

To reproduce in a disposable checkout with locked dependencies, run from the
repository root:

```sh
node docs/performance-evidence/s68-voice-bundle-20261018/experiment.mjs
```

The script requires the recorded connection source hash and fresh output
directories. It preserves the original source in its evidence directory and
restores it in a `finally` block. Use an isolated checkout: a process killed
outside JavaScript cleanup may leave the experimental source in that checkout.
