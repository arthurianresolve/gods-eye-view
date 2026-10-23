# Candidate map fault page controls

Reviewed QA `b7dcd673` adds the serialized page owner for the three declared
Esri metadata fault scenarios. It invokes the production map controller, fixes
Manual/Dense density at 75%, and records actual provider classes, terrain and tile
readiness, camera pose, renderer settings and completed-render sequence numbers.
Missing or corrupt metadata must produce OSM fallback followed by explicit Esri
recovery. A delayed response must remain pending when the newer OSM switch starts;
a completed frame after the old Esri operation settles must still belong to OSM.

Review corrections require the current `preserveDrawingBuffer: true` default,
bind the final observation to the last transition, and reject non-increasing
render sequences. Disposal retires the page listener and timer; a pending switch
cannot be reported as disposed and requires the outer context to close.

Root independently passes all 94 focused page, delivery and existing smoke unit
checks, capture lint on 25 files, package boundaries and changed JavaScript
formatting. [The review and original test log](review.json) record exact commits,
counts, scope and the log hash. The console wrapper encountered an encoding error
after saving Node's complete passing output; that separate printing failure is
recorded rather than hidden.

The fresh-document outer runner and its hung-evaluation/context-close regression
remain under implementation. No rendered fault journey has run at this revision.
These checks do not complete M3, S47 or S57, and are not performance evidence.
