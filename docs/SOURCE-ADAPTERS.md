# Source adapter starter kit

The package export `gods-eye-view/sources/adapter-starter` contains a small
contract wrapper, a conformance runner, and a keyless synthetic example. It is
an authoring aid; it does not load plugins or register executable code at
runtime. Keep acquisition, normalized observations, rendering and UI in their
existing owners.

## Contract

An adapter declares a stable lowercase `id`, a label, attribution, supported
`capabilities.temporalModes`, and explicit retention permissions. Unknown
retention permission remains disabled. `createSourceAdapter` wraps one
`acquire({ signal })` function and returns a `read({ signal })` method. Reads
must honor cancellation before and after acquisition, return at most 5,000
observations, and include a coverage statement. Each normalized observation
has a stable id, WGS84 `lat`/`lon`, optional epoch-millisecond `observedAt`,
bounded plain properties, and a versioned evidence envelope. Receipt time and
observation time remain separate.

The wrapper does not make network requests, persist data, infer complete
coverage, or authorize retention. The caller owns transport policy and must
check the source's terms before enabling recording or export. Never put secrets
in browser source modules, URLs, evidence, tests or fixtures.

## Example

```js
import { createSyntheticSourceAdapter } from 'gods-eye-view/sources/adapter-starter';
import { runSourceAdapterConformance } from 'gods-eye-view/sources/adapter-starter';

const source = createSyntheticSourceAdapter();
const report = await runSourceAdapterConformance(source);
const { observations } = await source.read({ signal });
```

The example is conspicuously synthetic and is intended for local tests. A real
layer can use the same contract at its source boundary without making Cesium a
dependency of the adapter. Allocate a layer-state token through the reservation
script before registering a new layer; update [DATA_SOURCES.md](../DATA_SOURCES.md)
with attribution and separate display, retention and export permissions.

## Contributor checks

Run `node --test src/sources/adapterContract.test.mjs` and `npm run
check:boundaries`. Extend conformance fixtures for normalized domain fields,
stale/cached states and provider-specific coverage. The candidate browser
matrix should then exercise enable, inspect, query and disable through the
normal layer factory. Do not add runtime discovery or load third-party adapter
code from a URL.
