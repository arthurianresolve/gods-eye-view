# S57 real streamed tiles - first rendered diagnostic

The [exact-commit hosted run](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38230236414)
at `bd347221bb89d793e05cb87b89dd7707af88343f` **fails** in the streamed-content
supersession phase. The candidate adds a fixed local HTTP 3D Tiles 1.1 manifest
and GLB, browser/server request observations, cached-object switch checks and
bounded ownership evidence. It changes no production rendering code or settings.
Root passed 26 focused checks; the executor also passed adopted formatting,
package boundaries and syntax checks. This hosted run uses Apple paravirtual
Metal and is supplemental component evidence, not physical Windows acceptance.

The preceding terrain cycles and native selection/re-enable cases complete.
The late tileset factory is cached without replacing the newer flat-map owner.
The fixture then activates that tileset and pauses its first GLB request before
the local server receives it. Switching back to flat succeeds and hides the
tileset. Chrome reports the pending request as failed, with no content request
at the HTTP server. The fixture incorrectly continues to demand delivery and
times out after the unchanged ten seconds. No warmed streamed-tile pair completes.

The report records only a generic browser loading-failed flag; it cannot prove
whether the request was cancelled. The installed Cesium source supplies an
expected alternative: `Cesium3DTileset.cancelOutOfViewRequests` cancels a loading
tile after it is no longer touched, and `Cesium3DTile.cancelRequests` cancels its
owned request. The new fixture must distinguish observed superseded cancellation
from transport failure, then verify real content delivery after reactivation.
Generic loading failures must still fail; no provider error may be relabeled as
successful cancellation without evidence.

A second reporting race is visible before content activation: `fromUrl` has
completed and the server has finished the manifest, but the immediately requested
browser Network snapshot still has zero completed responses. The next candidate
will await the existing bounded independent HTTP observation before recording
that checkpoint. It must not infer browser completion from server state.

All four tileset listeners are removed, the controller destroys its tileset,
both network/server observer cleanups are confirmed, and Chrome exits naturally.
These cleanup observations do not convert the failed lifecycle into a pass.

- [Unmodified raw report](report.json): 3,245,240 bytes, SHA-256
  `7e2629e6a4e6014da317050db1ead30600d7a503821118a6245c46f9090b07c8`.
- [Terminal workflow metadata](ci-run.json).
- Fixture manifest SHA-256:
  `9d09c0121b01956e83b8c24139d42def6c98aa1460f3b8a5cc92ffd3590f7c9a`.
- GLB SHA-256:
  `81bded5feb11e86993e187d8b265d8e12fbdc57613a9ceb98b8c70e39bd7622c`.

The frozen candidate remains isolated. No timeout increase, unchanged retry,
production default change, hardware performance claim or full S57 completion
follows from this run.
