# Rejected native-map invocation

[Run 38404224101](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38404224101)
fails input validation at exact candidate/harness
`af821c5ce9080ce726e258248135105d3a510945`.

The invocation incorrectly combines `austin-map-streaming-v1` with
`capture_worker_audit_mode=receipt-only`. Receipt-only mode is supported only for
the Austin operating fixture. The CLI correctly rejects this configuration
before building either application revision or launching a browser. This is an
agent dispatch mistake, not a native journey or camera-patch result.

The [unmodified failure artifact](performance-build-smoke.json) has SHA-256
`e901d9b86b470303323eefff391bda19248057de76986d85675c1caaa6abc43f`.
It remains failed. Replacement [run 38404611321](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38404611321)
uses supported `capture_worker_audit_mode=diagnostic` with the same exact source,
map fixture and `macos-native-diagnostic` backend. That changed invocation is
independent evidence; its result must be read before making a validation claim.
