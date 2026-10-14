# Windows fresh-frame failure at d0f463a8

The visible JSON report was copied from the local datacenter fixture on 2026-10-14, with `frame-failure-diagnostic=1`. Application and harness were both clean commit `d0f463a87f338de36d39fa8bbbac66a70ed41214`. This is failure attribution, not hardware performance acceptance.

The browser reported Intel UHD 620 through ANGLE D3D11 on Windows, Chrome 154. Two initial completed frames arrived. The first default Entity lifetime then failed: the unchanged 400 ms fresh-frame deadline expired at 401.1 ms with no postRender event. The document reported visible and focused before and after. The candidate collection renderer was never activated, so this result cannot establish a regression from that representation. Layer and viewer cleanup completed.

Visible/focused does not establish desktop occlusion status. The viewport was 1280 by 593 at DPR 2; the fixture drawing buffer was 960 by 640. No Chrome internal GPU page, browser trace, driver diagnostic, or 60-minute stability evidence was collected. The missing frame's cause remains unresolved; scene update/render and browser scheduling need separate attribution.

An earlier uncontrolled attempt at this same commit was triggered by Vite reconnecting an already-open tab. It failed during initial display warmup with no renderer lifetime or environment recorded. Its full report was not retained; it is disclosed here and excluded from controlled comparisons. Subsequent server restarts must close the old fixture tab first. The prior controlled failure at 011f6e5a remains in the adjacent evidence packet.
