const hash = (digit) => digit.repeat(64);

export function makeRun(representation) {
  const entity = representation === 'entity';
  const pointState = {
    available: true,
    renderer: representation,
    expectedCount: 5000,
    entityCount: 5000,
    visualizerItemCount: entity ? 5000 : 0,
    primitiveCount: 5000,
    blendOption: 2,
    entityOrderAndStateSha256: hash('1'),
    entityToPrimitiveAssignmentSha256: hash('2'),
    primitiveDrawOrderAndStateSha256: hash('3'),
    nativePickWitness: {
      tested: 1,
      importedHits: 1,
      rows: [
        {
          targetId: 'gev-import:fixture:0',
          screen: [100, 100],
          pickedEntityId: 'gev-import:fixture:0',
        },
      ],
    },
  };
  const samples = [];
  for (let pair = 0; pair < 5; pair++)
    for (const mode of ['synchronous', 'cooperative'])
      samples.push({
        pair,
        mode,
        features: 5000,
        pixelSha256: hash('a'),
        pixelPngDataUrl: 'data:image/png;base64,AA==',
        pointVisualState: structuredClone(pointState),
      });
  return {
    schema: 'gev-hosted-native-renderer/v1',
    status: 'passed',
    hardwareRenderingAvailable: true,
    renderingEvidence: [
      { accelerationVerified: true },
      { accelerationVerified: true },
    ],
    captureMatrix: { status: 'passed' },
    importBatches: {
      schema: 'gev-import-batches/v2',
      status: 'passed',
      applicationCommit: 'a'.repeat(40),
      harnessCommit: 'a'.repeat(40),
      fixture: 'synthetic-5000-import-points/v1',
      pointRepresentation: representation,
      mixedGeometryParityRequested: true,
      featureLimit: 5000,
      workload: 'paired',
      captureMode: 'pixels',
      viewerConstruction: 'application-wrapper',
      environment: {
        appCommit: 'a'.repeat(40),
        harnessCommit: 'a'.repeat(40),
        renderer: 'test-renderer',
        viewport: { width: 960, height: 640, dpr: 1 },
        drawingBuffer: { width: 960, height: 640 },
      },
      renderConfiguration: {
        pointRepresentation: representation,
        viewerConstruction: 'application-wrapper',
        captureMode: 'pixels',
        preserveDrawingBuffer: true,
        renderDemand: false,
        msaaSamplesRequested: 4,
        antialias: true,
        msaaSupported: true,
        webglContextAttributes: { antialias: true },
        sceneMode: 3,
        canvas: {
          cssWidth: 960,
          cssHeight: 640,
          drawingBufferWidth: 960,
          drawingBufferHeight: 640,
        },
        camera: { position: [1, 2, 3], direction: [0, 0, -1], up: [0, 1, 0] },
      },
      warmedResources: {
        importedFeatureCount: 5000,
        pointPrimitiveCount: 5000,
        entities: entity ? 5000 : 0,
      },
      samples,
      mixedGeometryParity: {
        schema: 'gev-import-mixed-geometry-parity/v1',
        status: 'passed',
        renderer: representation,
        renderSettings: {
          priorGlobeShow: false,
          globeShow: true,
          terrainProvider: 'EllipsoidTerrainProvider',
          imageryLayerCount: 0,
          baseLayer: false,
        },
        load: { drawn: 3, omitted: 0 },
        entityIds: [
          'gev-import:mixed-parity:mixed-parity:line',
          'gev-import:mixed-parity:mixed-parity:point',
          'gev-import:mixed-parity:mixed-parity:polygon',
        ],
        rows: [
          {
            id: 'line',
            geometry: [
              [1, 2, 3],
              [4, 5, 6],
            ],
          },
          { id: 'point', position: [7, 8, 9], style: [9, 0, 1] },
          {
            id: 'polygon',
            geometry: [
              [
                [10, 11, 12],
                [13, 14, 15],
              ],
            ],
          },
        ],
        rowsSha256: hash('4'),
        nativePicks: ['point', 'line', 'polygon'].map((shape, index) => ({
          shape,
          screen: [100 + index, 200 + index],
          onCanvas: true,
          expectedEntityId: `gev-import:mixed-parity:mixed-parity:${shape}`,
          pickedEntityId: `gev-import:mixed-parity:mixed-parity:${shape}`,
        })),
        nativePicksSha256: hash('5'),
        capture: {
          pixelSha256: hash('6'),
          width: 960,
          height: 640,
          pngDataUrl: 'data:image/png;base64,AA==',
        },
        readiness: {
          status: 'passed',
          timeoutMs: 10_000,
          elapsedMs: 24,
          attempts: 2,
          nativePicks: ['point', 'line', 'polygon'].map((shape, index) => ({
            shape,
            screen: [100 + index, 200 + index],
            onCanvas: true,
            expectedEntityId: `gev-import:mixed-parity:mixed-parity:${shape}`,
            pickedEntityId: `gev-import:mixed-parity:mixed-parity:${shape}`,
          })),
          observations: [
            {
              atMs: 24,
              ready: true,
              nativePicks: ['point', 'line', 'polygon'].map((shape, index) => ({
                shape,
                screen: [100 + index, 200 + index],
                onCanvas: true,
                expectedEntityId: `gev-import:mixed-parity:mixed-parity:${shape}`,
                pickedEntityId: `gev-import:mixed-parity:mixed-parity:${shape}`,
              })),
            },
          ],
        },
      },
      largeGeometry: {
        exactOutputParity: true,
        synchronous: { rows: [{ id: 'line', geometrySha256: hash('b') }] },
        cooperative: { rows: [{ id: 'line', geometrySha256: hash('b') }] },
      },
      cancellation: {
        attempted: 12,
        abortErrors: 12,
        pendingJobsAfter: 0,
        featureCountAfter: 0,
        pointPrimitiveCountAfter: 0,
        ownershipReleased: true,
      },
    },
  };
}
