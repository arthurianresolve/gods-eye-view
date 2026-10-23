import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import {
  createAustinOperatingWorkloadFixture,
  createAustinOperatingFixtureDelivery,
} from "../../../../scripts/performance/austinOperatingWorkloadFixture.mjs";
import { createInstallationSource } from "../../../../src/layers/installations/source.js";
import { createModel } from "../../../../src/layers/installations/model.js";
import { createIngestion } from "../../../../src/layers/installations/ingestion.js";
import { createControls } from "../../../../src/layers/installations/controls.js";

const root = new URL("../../../../", import.meta.url);
const paths = [
  "scripts/performance/austinOperatingWorkloadFixture.mjs",
  "src/layers/installations/source.js",
  "src/layers/installations/model.js",
  "src/layers/installations/viewport.js",
  "src/layers/installations/ingestion.js",
  "src/layers/installations/controls.js",
];
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const hashes = () =>
  Object.fromEntries(
    paths.map((path) => [path, hash(readFileSync(new URL(path, root)))]),
  );
const before = hashes();
const route = JSON.parse(
  readFileSync(new URL("native-source-route-audit.json", import.meta.url)),
);
const fixture = createAustinOperatingWorkloadFixture();
const base = "https://fixture.example.test/";
const delivery = createAustinOperatingFixtureDelivery(fixture, base);
const responses = [];
const source = createInstallationSource({
  fetchImpl: async (input, options = {}) => {
    const url = new URL(input, base).href;
    const method = options.method || "GET";
    const response = await delivery.respond(url, { method });
    assert.ok(response);
    delivery.onFulfilled({
      url,
      method,
      status: response.status,
      bodyBase64: response.body.toString("base64"),
    });
    responses.push({
      sha256: hash(response.body),
      byteLength: response.body.length,
    });
    return new Response(response.body, {
      status: response.status,
      headers: { "content-type": response.contentType },
    });
  },
});
const model = createModel({ state: {}, services: {}, parts: {}, source });
const checkpoints = [];
const layerState = { enabled: true, viewer: {}, records: [] };
let currentBox;
let renderNotifications = 0;
const parts = {
  model,
  viewport: {
    loadArea: () => ({ box: currentBox, coverage: { kind: "viewport" } }),
    clearUnavailableRetry() {},
    scheduleUnavailableRetry() {
      throw new Error("Native installation load unexpectedly requested retry");
    },
  },
  rendering: {
    renderRecords() {
      renderNotifications++;
    },
    warmInstallationFloors() {},
  },
};
const services = {
  render: { governorRequestRender() {} },
  ground: { resolveGroundFloorCellsBounded: async () => {} },
};
const ingestion = createIngestion({
  state: layerState,
  services,
  parts,
  source,
});
const controls = createControls({ state: layerState, services, parts, source });
const identityHash = (rows) =>
  hash(
    rows
      .map((row) => String(row.id))
      .sort()
      .join("\n"),
  );
for (const checkpoint of route.samples) {
  const payload = await source.getMappedSites(checkpoint.installationBox);
  assert.equal(payload.saturated, false);
  const inView = payload.records.filter((record) =>
    model.installationWithinViewport(record, checkpoint.installationBox),
  );
  const ids = inView.map((record) => record.id).sort();
  assert.ok(
    ids.length > 0 &&
      ids.length < fixture.expectedLayerCounts["military-installations"],
  );
  assert.equal(new Set(ids).size, ids.length);
  currentBox = checkpoint.installationBox;
  await ingestion.loadInstallations();
  assert.equal(layerState.error, null);
  assert.equal(layerState.loading, false);
  assert.equal(layerState.status, "ready");
  const analystRows = controls.methods.getAnalystRecords(1000);
  const stats = controls.methods.getStats();
  assert.equal(analystRows.length, inView.length);
  assert.equal(stats.count, inView.length);
  assert.deepEqual(
    analystRows.map((row) => row.id).sort(),
    inView.map((row) => row.name || row.id).sort(),
  );
  assert.notEqual(identityHash(analystRows), identityHash(inView));
  checkpoints.push({
    elapsedMs: checkpoint.elapsedMs,
    viewport: checkpoint.installationBox,
    normalizedResponseCount: payload.records.length,
    nativeViewportCount: ids.length,
    sortedIdsSha256: hash(JSON.stringify(ids)),
    nativeAnalystCount: analystRows.length,
    nativeStatsCount: stats.count,
    nativeAnalystIdsSha256: identityHash(analystRows),
    sourceIdsSha256: identityHash(inView),
    nativeAnalystIdProjection: "record.name || record.id",
    response: responses.at(-1),
  });
}
const after = hashes();
assert.deepEqual(after, before);
assert.equal(renderNotifications, route.samples.length);
layerState.abort?.abort();
delivery.dispose();
const report = {
  schema: "gev-independent-austin-installation-population-audit/v1",
  checkedAt: new Date().toISOString(),
  scope:
    "Native source normalization, ingestion, controls and viewport filtering at previously sampled Cesium Camera poses. Rendering and ground services are no-op fixtures; no browser delivery, rendered population, or performance acceptance.",
  fixtureSha256: fixture.sha256,
  sourceCatalogCount: fixture.expectedLayerCounts["military-installations"],
  sourceHashesBefore: before,
  sourceHashesAfter: after,
  checkpoints,
  limitation:
    "Browser must independently confirm the same pose, viewport, completed native load, and IDs. Camera-change debounce can temporarily retain the preceding source population.",
};
writeFileSync(
  new URL("installation-population-audit.json", import.meta.url),
  JSON.stringify(report, null, 2) + "\n",
);
console.log(
  JSON.stringify({
    sourceCatalogCount: report.sourceCatalogCount,
    checkpoints: checkpoints.map(
      ({ elapsedMs, normalizedResponseCount, nativeViewportCount }) => ({
        elapsedMs,
        normalizedResponseCount,
        nativeViewportCount,
      }),
    ),
    sourceUnchanged: true,
  }),
);
