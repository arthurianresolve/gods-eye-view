# Import trace flow-event semantics

The import diagnostic records V8 GC flow events (`s`, `t`, and `f`) as bounded
identity-bearing observations. They are not duration events and are never
included in GC overlap calculations. The report lists retained flow records,
observed phase counts, dropped-record counts, invalid identities, and
unmatched starts, steps, and ends. Unmatched phases describe only the captured
trace window; they do not imply that a flow is causally incomplete outside the
window. Sequence summaries are conservatively grouped by process, category,
event name, and identity. Cross-process links are retained as raw observations
but are not reconstructed into a sequence.

Flow identity and phase semantics follow the pinned Chromium DevTools trace
types at revision
[`b88894b14f63f84c460f66cff8918b2b4d079eae`](https://chromium.googlesource.com/devtools/devtools-frontend/+/b88894b14f63f84c460f66cff8918b2b4d079eae/front_end/models/trace/types/TraceEvents.ts).
That source distinguishes flow phases from complete (`X`) events carrying a
duration and defines flow identity fields. The collector retains scalar
`id`/`bind_id`/`id2` identity fields with bounded strings. Validators enforce
the exact retained identity schema, scalar types and length bounds, and reject
unknown keys; overlong categories are retained as invalid records. Malformed,
missing, or overflowed observations keep the attribution incomplete.

The earlier run `38168887546` remains a failed diagnostic. Its report retained
only phase counters for two flow events and discarded their identities, so it
cannot be retroactively considered complete under this contract.
