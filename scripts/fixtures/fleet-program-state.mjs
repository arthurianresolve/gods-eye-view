import * as Cesium from 'cesium';

const DEFAULT_LIMITS = Object.freeze({
  commands: 512,
  models: 256,
  collectionDepth: 8,
  programs: 32,
  uniformsPerProgram: 128,
  shaderCharsPerStage: 1_000_000,
  harmonicCoefficients: 16,
  computeCommandsPerManager: 64,
});

function scalar(value) {
  return Number.isFinite(value) ? value : String(value);
}

function vector(value) {
  return value ? [scalar(value.x), scalar(value.y), scalar(value.z)] : null;
}

function matrix(value) {
  return value ? Array.from(value, scalar) : null;
}

function color(value) {
  return value
    ? [
        scalar(value.red),
        scalar(value.green),
        scalar(value.blue),
        scalar(value.alpha),
      ]
    : null;
}

function serializeId(value) {
  if (typeof value === 'string' || typeof value === 'number') return value;
  if (typeof value === 'boolean' || value == null) return value ?? null;
  return {
    type: value.constructor?.name || 'object',
    keys: Object.keys(value).slice(0, 16),
  };
}

function julianDate(value) {
  if (!value) return null;
  return {
    dayNumber: scalar(value.dayNumber),
    secondsOfDay: scalar(value.secondsOfDay),
  };
}

function fixtureModelId(value, expectedIds, entityToFixtureId) {
  if (typeof value === 'string' || typeof value === 'number') {
    const id = String(value);
    return { id, identityKind: 'scalar' };
  }
  if (value instanceof Cesium.Entity) {
    const mapped = entityToFixtureId.get(value);
    if (typeof mapped === 'string' && expectedIds.has(mapped))
      return { id: mapped, identityKind: 'entity-map' };
    const entityId = String(value.id);
    if (expectedIds.has(entityId))
      return { id: entityId, identityKind: 'entity-id' };
    return { id: null, identityKind: 'unmapped-entity' };
  }
  return { id: null, identityKind: value == null ? 'missing' : 'unsupported' };
}

/**
 * Read only the readiness barrier fields used by the fleet fixture. Unlike the
 * full program-state diagnostic, this does not inspect GL, shaders, uniforms,
 * lighting, or environment-map compute state and is safe to call per completed
 * frame while waiting for cold model activation.
 *
 * `entityToFixtureId` is only needed if a Cesium.Model uses an Entity object as
 * its pick id. The map lets the fixture normalize that object to one of its
 * declared source ICAOs without serializing arbitrary Entity properties.
 */
export function snapshotFleetModelReadiness(
  viewer,
  {
    expectedIds = [],
    entityToFixtureId = new Map(),
    maxModels = DEFAULT_LIMITS.models,
    maxCollectionDepth = DEFAULT_LIMITS.collectionDepth,
  } = {},
) {
  if (!viewer?.scene?.primitives)
    throw new TypeError('Cesium viewer scene primitives required');
  if (!Number.isInteger(maxModels) || maxModels < 0)
    throw new TypeError('Invalid maxModels limit');
  if (!Number.isInteger(maxCollectionDepth) || maxCollectionDepth < 0)
    throw new TypeError('Invalid maxCollectionDepth limit');
  if (!(entityToFixtureId instanceof Map))
    throw new TypeError('entityToFixtureId must be a Map');

  const knownIds = new Set(expectedIds.map(String));
  const visited = new Set();
  const items = [];
  let truncated = false;

  function visit(collection, path, depth, ancestorsShown) {
    if (!collection || visited.has(collection)) return;
    visited.add(collection);
    if (!(collection instanceof Cesium.PrimitiveCollection)) return;
    if (depth > maxCollectionDepth) {
      truncated = true;
      return;
    }
    const shown = ancestorsShown && collection.show !== false;
    for (let index = 0; index < collection.length; index++) {
      const primitive = collection.get(index);
      if (primitive instanceof Cesium.Model) {
        if (items.length >= maxModels) {
          truncated = true;
          continue;
        }
        const identity = fixtureModelId(
          primitive.id,
          knownIds,
          entityToFixtureId,
        );
        items.push({
          id: identity.id,
          identityKind: identity.identityKind,
          collectionPath: [...path, index],
          ready: primitive.ready === true,
          show: primitive.show === true,
          effectiveShow: Boolean(shown && primitive.show === true),
          modelMatrix: matrix(primitive.modelMatrix),
        });
      } else if (primitive instanceof Cesium.PrimitiveCollection) {
        visit(primitive, [...path, index], depth + 1, shown);
      }
    }
  }

  visit(viewer.scene.primitives, [], 0, true);
  return { items, truncated };
}

/**
 * Find the actual Cesium billboard used as the camera-framing fallback for a
 * tracked fleet entity. The Entity's `gevTrackedId` is application-owned
 * identity; its BillboardVisualizer has already resolved CallbackProperties
 * into this primitive's current color/show fields. Reading those fields avoids
 * evaluating the callback (which can itself consult or mutate runtime state).
 */
export function snapshotFleetTrackedBillboards(
  viewer,
  {
    maxPrimitives = 8192,
    maxCollectionDepth = DEFAULT_LIMITS.collectionDepth,
  } = {},
) {
  if (!viewer?.scene?.primitives)
    throw new TypeError('Cesium viewer scene primitives required');
  if (!Number.isInteger(maxPrimitives) || maxPrimitives < 0)
    throw new TypeError('Invalid maxPrimitives limit');
  if (!Number.isInteger(maxCollectionDepth) || maxCollectionDepth < 0)
    throw new TypeError('Invalid maxCollectionDepth limit');

  const visited = new Set();
  const items = [];
  let visitedPrimitives = 0;
  let truncated = false;

  function visit(collection, path, depth, ancestorsShown) {
    if (!collection || visited.has(collection)) return;
    visited.add(collection);
    if (!(collection instanceof Cesium.PrimitiveCollection)) return;
    if (depth > maxCollectionDepth) {
      truncated = true;
      return;
    }
    const shown = ancestorsShown && collection.show !== false;
    for (let index = 0; index < collection.length; index++) {
      if (visitedPrimitives >= maxPrimitives) {
        truncated = true;
        return;
      }
      visitedPrimitives++;
      const primitive = collection.get(index);
      const childPath = [...path, index];
      if (primitive instanceof Cesium.BillboardCollection) {
        const billboardCount = primitive.length;
        for (
          let billboardIndex = 0;
          billboardIndex < billboardCount;
          billboardIndex++
        ) {
          if (visitedPrimitives >= maxPrimitives) {
            truncated = true;
            return;
          }
          visitedPrimitives++;
          const billboard = primitive.get(billboardIndex);
          const identity = billboard?.id?.gevTrackedId;
          if (typeof identity !== 'string') continue;
          const match = /^(flights|military):([a-f0-9]{6})$/.exec(identity);
          if (!match) continue;
          const [, layer, id] = match;
          const alpha = billboard.color?.alpha;
          items.push({
            id,
            layer,
            ready: billboard.ready === true,
            collectionReady: primitive.ready === true,
            show: billboard.show === true,
            collectionShow: primitive.show !== false,
            effectiveShow: Boolean(
              shown && primitive.show !== false && billboard.show === true,
            ),
            alpha: Number.isFinite(alpha) ? alpha : null,
            collectionPath: childPath,
            billboardIndex,
          });
        }
      } else if (primitive instanceof Cesium.PrimitiveCollection) {
        visit(primitive, childPath, depth + 1, shown);
      }
    }
  }

  visit(viewer.scene.primitives, [], 0, true);
  return { items, truncated, visitedPrimitives };
}

function coefficients(values, limit) {
  if (!Array.isArray(values)) return null;
  return {
    count: values.length,
    values: values.slice(0, limit).map(vector),
    truncated: values.length > limit,
  };
}

function computeCommandSnapshot(command) {
  if (!command) return null;
  return {
    canceled: typeof command.canceled === 'boolean' ? command.canceled : null,
    persists: typeof command.persists === 'boolean' ? command.persists : null,
    pass: command.pass ?? null,
    ownerType: command.owner?.constructor?.name || null,
    shaderProgramId: command.shaderProgram?.id ?? null,
    hasPreExecute: typeof command.preExecute === 'function',
    hasPostExecute: typeof command.postExecute === 'function',
    hasOutputTexture: Boolean(command.outputTexture),
  };
}

function pendingCommands(commands, limit) {
  if (!Array.isArray(commands))
    return {
      status: 'unavailable',
      slots: null,
      pendingCount: null,
      items: [],
    };
  const items = [];
  let pendingCount = 0;
  for (let index = 0; index < commands.length; index++) {
    const command = commands[index];
    if (!command) continue;
    pendingCount++;
    if (items.length < limit) {
      items.push({ index, ...computeCommandSnapshot(command) });
    }
  }
  return {
    status: 'read',
    slots: commands.length,
    pendingCount,
    truncated: pendingCount > items.length,
    items,
  };
}

function managerSnapshot(manager, limits) {
  if (!manager) return null;
  const lastTime = manager._lastTime;
  return {
    enabled: manager.enabled ?? null,
    shouldUpdate: manager.shouldUpdate ?? null,
    position: vector(manager._position),
    lastTime: julianDate(lastTime),
    sphericalHarmonicCoefficients: coefficients(
      manager.sphericalHarmonicCoefficients,
      limits.harmonicCoefficients,
    ),
    dirty: {
      radianceMap: manager._radianceMapDirty ?? null,
      radianceCommands: manager._radianceCommandsDirty ?? null,
      convolutionsCommands: manager._convolutionsCommandsDirty ?? null,
      irradianceCommand: manager._irradianceCommandDirty ?? null,
      irradianceTexture: manager._irradianceTextureDirty ?? null,
      sphericalHarmonics: manager._sphericalHarmonicCoefficientsDirty ?? null,
      regenerateShaders: manager._shouldRegenerateShaders ?? null,
      reset: manager._shouldReset ?? null,
    },
    pendingComputeCommands: {
      radiance: pendingCommands(
        manager._radianceMapComputeCommands,
        limits.computeCommandsPerManager,
      ),
      convolution: pendingCommands(
        manager._convolutionComputeCommands,
        limits.computeCommandsPerManager,
      ),
      irradiance: manager._irradianceComputeCommand
        ? {
            status: 'read',
            pendingCount: 1,
            item: computeCommandSnapshot(manager._irradianceComputeCommand),
          }
        : { status: 'read', pendingCount: 0, item: null },
    },
  };
}

function modelSnapshot(model, modelIndex, path, ancestorsShown, limits) {
  const ibl = model.imageBasedLighting;
  const factor = ibl?.imageBasedLightingFactor;
  const manager = model.environmentMapManager;
  // Model.boundingSphere and sceneGraph state are not meaningful until the
  // asynchronous glTF load has reached Cesium's ready state.
  const boundingSphere = model.ready ? model.boundingSphere : null;
  return {
    modelIndex,
    collectionPath: path,
    id: serializeId(model.id),
    ready: model.ready,
    show: model.show,
    ancestorsShown,
    effectiveShow: Boolean(model.show && ancestorsShown),
    modelMatrix: matrix(model.modelMatrix),
    computedSceneGraphMatrix: matrix(
      model.ready ? model.sceneGraph?.computedModelMatrix : null,
    ),
    boundingSphere: boundingSphere
      ? {
          center: vector(boundingSphere.center),
          radius: scalar(boundingSphere.radius),
        }
      : null,
    scale: scalar(model.scale),
    minimumPixelSize: scalar(model.minimumPixelSize),
    maximumScale: scalar(model.maximumScale),
    color: color(model.color),
    colorBlendMode: model.colorBlendMode ?? null,
    colorBlendAmount: scalar(model.colorBlendAmount),
    silhouetteSize: scalar(model.silhouetteSize),
    silhouetteColor: color(model.silhouetteColor),
    backFaceCulling: model.backFaceCulling ?? null,
    shadows: model.shadows ?? null,
    cull: model.cull ?? null,
    lightColor: vector(model.lightColor),
    imageBasedLighting: ibl
      ? {
          imageBasedLightingFactor: factor
            ? [scalar(factor.x), scalar(factor.y)]
            : null,
          sphericalHarmonicCoefficients: coefficients(
            ibl.sphericalHarmonicCoefficients,
            limits.harmonicCoefficients,
          ),
          specularEnvironmentMaps: serializeId(ibl.specularEnvironmentMaps),
        }
      : null,
    environmentMapManager: managerSnapshot(manager, limits),
  };
}

function collectModels(scene, programLimits) {
  const models = [];
  const modelByObject = new Map();
  const visited = new Set();
  let truncated = false;

  function visit(collection, path, depth, ancestorsShown) {
    if (!collection || visited.has(collection)) return;
    visited.add(collection);
    if (depth > programLimits.collectionDepth) {
      truncated = true;
      return;
    }
    if (!(collection instanceof Cesium.PrimitiveCollection)) return;
    const shown = ancestorsShown && collection.show !== false;
    for (let i = 0; i < collection.length; i++) {
      const primitive = collection.get(i);
      const childPath = [...path, i];
      if (primitive instanceof Cesium.Model) {
        if (models.length >= programLimits.models) {
          truncated = true;
          continue;
        }
        const index = models.length;
        modelByObject.set(primitive, index);
        models.push(
          modelSnapshot(primitive, index, childPath, shown, programLimits),
        );
      } else if (primitive instanceof Cesium.PrimitiveCollection) {
        visit(primitive, childPath, depth + 1, shown);
      }
    }
  }

  visit(scene.primitives, [], 0, true);
  return { models, modelByObject, truncated };
}

/** Read-only cold-resource drain witness for the pinned Cesium version. */
export function snapshotFleetEnvironmentReadiness(viewer) {
  if (!viewer?.scene) throw new TypeError('Cesium viewer scene required');
  const collected = collectModels(viewer.scene, DEFAULT_LIMITS);
  const manager = Cesium.DynamicEnvironmentMapManager;
  return {
    cesiumVersion: Cesium.VERSION,
    truncated: collected.truncated,
    globalQueue: {
      active: manager?._activeComputeCommandCount ?? null,
      queued: manager?._nextFrameCommandQueue?.length ?? null,
      maximumActive: manager?._maximumComputeCommandCount ?? null,
    },
    items: collected.models.map((model) => {
      const state = model.environmentMapManager;
      return {
        id: model.id,
        enabled: state?.enabled ?? null,
        shouldUpdate: state?.shouldUpdate ?? null,
        dirty: state?.dirty ?? null,
        pending: state
          ? Object.fromEntries(
              Object.entries(state.pendingComputeCommands).map(
                ([key, value]) => [
                  key,
                  value.status === 'read' ? value.pendingCount : null,
                ],
              ),
            )
          : null,
      };
    }),
  };
}

function renderStateSnapshot(state) {
  if (!state) return null;
  const rect = (value) =>
    value
      ? {
          x: scalar(value.x),
          y: scalar(value.y),
          width: scalar(value.width),
          height: scalar(value.height),
        }
      : null;
  const operation = (value) =>
    value ? { fail: value.fail, zFail: value.zFail, zPass: value.zPass } : null;
  const stencil = state.stencilTest;
  const blending = state.blending;
  return {
    id: state.id ?? null,
    frontFace: state.frontFace ?? null,
    lineWidth: scalar(state.lineWidth),
    depthMask: state.depthMask ?? null,
    depthTest: state.depthTest
      ? { enabled: state.depthTest.enabled, func: state.depthTest.func }
      : null,
    blending: blending
      ? {
          enabled: blending.enabled,
          equationRgb: blending.equationRgb,
          equationAlpha: blending.equationAlpha,
          functionSourceRgb: blending.functionSourceRgb,
          functionSourceAlpha: blending.functionSourceAlpha,
          functionDestinationRgb: blending.functionDestinationRgb,
          functionDestinationAlpha: blending.functionDestinationAlpha,
          color: color(blending.color),
        }
      : null,
    cull: state.cull
      ? { enabled: state.cull.enabled, face: state.cull.face }
      : null,
    colorMask: state.colorMask
      ? {
          red: state.colorMask.red,
          green: state.colorMask.green,
          blue: state.colorMask.blue,
          alpha: state.colorMask.alpha,
        }
      : null,
    polygonOffset: state.polygonOffset
      ? {
          enabled: state.polygonOffset.enabled,
          factor: scalar(state.polygonOffset.factor),
          units: scalar(state.polygonOffset.units),
        }
      : null,
    scissorTest: state.scissorTest
      ? {
          enabled: state.scissorTest.enabled,
          rectangle: rect(state.scissorTest.rectangle),
        }
      : null,
    stencilTest: stencil
      ? {
          enabled: stencil.enabled,
          frontFunction: stencil.frontFunction,
          backFunction: stencil.backFunction,
          reference: stencil.reference,
          mask: stencil.mask,
          frontOperation: operation(stencil.frontOperation),
          backOperation: operation(stencil.backOperation),
        }
      : null,
    sampleCoverage: state.sampleCoverage
      ? {
          enabled: state.sampleCoverage.enabled,
          value: scalar(state.sampleCoverage.value),
          invert: state.sampleCoverage.invert,
        }
      : null,
    viewport: rect(state.viewport),
  };
}

function boundingVolumeSnapshot(volume) {
  if (!volume) return null;
  const type = volume.constructor?.name || 'unknown';
  if (volume.center && Number.isFinite(volume.radius))
    return {
      type,
      center: vector(volume.center),
      radius: scalar(volume.radius),
    };
  if (volume.center && volume.halfAxes)
    return {
      type,
      center: vector(volume.center),
      halfAxes: matrix(volume.halfAxes),
    };
  return { type, unavailable: 'unsupported-bounding-volume-shape' };
}

function sourceText(program, kind, maxChars) {
  const source =
    kind === 'vertex'
      ? program?._vertexShaderText
      : program?._fragmentShaderText;
  if (typeof source !== 'string')
    return { text: null, length: null, truncated: false };
  return {
    text: source.slice(0, maxChars),
    length: source.length,
    truncated: source.length > maxChars,
  };
}

function programRecord(shader, programs, limits) {
  if (!shader) return null;
  const id = shader.id ?? null;
  if (!programs.has(id) && programs.size < limits.programs) {
    const vertex = sourceText(shader, 'vertex', limits.shaderCharsPerStage);
    const fragment = sourceText(shader, 'fragment', limits.shaderCharsPerStage);
    const toDefines = (value) =>
      Array.isArray(value?.defines) ? value.defines.map(String) : null;
    programs.set(id, {
      id,
      vertexDefines: toDefines(shader.vertexShaderSource),
      fragmentDefines: toDefines(shader.fragmentShaderSource),
      vertexSource: vertex.text,
      vertexSourceLength: vertex.length,
      vertexSourceTruncated: vertex.truncated,
      fragmentSource: fragment.text,
      fragmentSourceLength: fragment.length,
      fragmentSourceTruncated: fragment.truncated,
      uniforms: null,
      _shader: shader,
    });
  }
  return id;
}

function passName(pass) {
  for (const name of ['OPAQUE', 'TRANSLUCENT'])
    if (Cesium.Pass?.[name] === pass) return name;
  return `pass-${pass}`;
}

function commandSnapshot(command, programs, limits) {
  return {
    programId: programRecord(command?.shaderProgram, programs, limits),
    count: Number.isFinite(command?.count) ? command.count : null,
    instanceCount: Number.isFinite(command?.instanceCount)
      ? command.instanceCount
      : null,
    primitiveType: command?.primitiveType ?? null,
    modelMatrix: matrix(command?.modelMatrix),
    boundingVolume: boundingVolumeSnapshot(command?.boundingVolume),
    renderState: renderStateSnapshot(command?.renderState),
  };
}

function listModelCommands(scene, models, programs, limits) {
  const frustums = scene.frustumCommandsList;
  const passes = [Cesium.Pass?.OPAQUE, Cesium.Pass?.TRANSLUCENT];
  if (!Array.isArray(frustums) || passes.some((pass) => pass == null))
    return {
      commands: [],
      totalMatching: null,
      truncated: false,
      status: 'unavailable',
    };

  const commands = [];
  let totalMatching = 0;
  const visibleCommandCounts = new Map();
  for (let frustumIndex = 0; frustumIndex < frustums.length; frustumIndex++) {
    const frustum = frustums[frustumIndex];
    for (const pass of passes) {
      const list = frustum.commands?.[pass];
      const count = frustum.indices?.[pass];
      if (!Array.isArray(list) || !Number.isInteger(count) || count < 0)
        continue;
      for (
        let commandIndex = 0;
        commandIndex < Math.min(count, list.length);
        commandIndex++
      ) {
        const command = list[commandIndex];
        if (!(command?.owner instanceof Cesium.Model)) continue;
        totalMatching++;
        visibleCommandCounts.set(
          command.owner,
          (visibleCommandCounts.get(command.owner) || 0) + 1,
        );
        if (commands.length >= limits.commands) continue;

        const modelIndex = models.modelByObject.get(command.owner) ?? null;
        const base = commandSnapshot(command, programs, limits);
        let drawCommand = command;
        let logDepthProgramId = null;
        let hdrProgramId = null;
        if (
          scene.frameState?.useLogDepth &&
          drawCommand.derivedCommands?.logDepth?.command
        ) {
          drawCommand = drawCommand.derivedCommands.logDepth.command;
          logDepthProgramId = programRecord(
            drawCommand.shaderProgram,
            programs,
            limits,
          );
        }
        if (scene._hdr && drawCommand.derivedCommands?.hdr?.command) {
          drawCommand = drawCommand.derivedCommands.hdr.command;
          hdrProgramId = programRecord(
            drawCommand.shaderProgram,
            programs,
            limits,
          );
        }
        const oitDerived =
          pass === Cesium.Pass.TRANSLUCENT &&
          scene._environmentState?.useOIT === true
            ? drawCommand.derivedCommands?.oit
            : null;
        const oit = oitDerived
          ? {
              translucent: oitDerived.translucentCommand
                ? commandSnapshot(
                    oitDerived.translucentCommand,
                    programs,
                    limits,
                  )
                : null,
              alpha: oitDerived.alphaCommand
                ? commandSnapshot(oitDerived.alphaCommand, programs, limits)
                : null,
              shadows: oitDerived.shadows
                ? {
                    translucent: oitDerived.shadows.translucentCommand
                      ? commandSnapshot(
                          oitDerived.shadows.translucentCommand,
                          programs,
                          limits,
                        )
                      : null,
                    alpha: oitDerived.shadows.alphaCommand
                      ? commandSnapshot(
                          oitDerived.shadows.alphaCommand,
                          programs,
                          limits,
                        )
                      : null,
                  }
                : null,
            }
          : null;

        commands.push({
          frustumIndex,
          frustumNear: scalar(frustum.near),
          frustumFar: scalar(frustum.far),
          pass: passName(pass),
          commandIndex,
          ownerModelId: serializeId(command.owner.id),
          modelIndex,
          ownerFoundInSceneCollection: modelIndex !== null,
          cull: command.cull,
          occlude: command.occlude,
          receiveShadows: command.receiveShadows,
          base,
          logDepthProgramId,
          hdrProgramId,
          oit,
        });
      }
    }
  }
  return {
    commands,
    totalMatching,
    truncated: totalMatching > commands.length,
    status: 'read',
    visibleCommandCounts,
  };
}

function sceneLightingSnapshot(scene) {
  const light = scene.light;
  const uniformState = scene.context?.uniformState;
  const environment = scene._environmentState;
  const frameState = scene.frameState;
  return {
    mode: frameState?.mode ?? null,
    time: julianDate(frameState?.time),
    hdr: scene._hdr ?? null,
    useLogDepth: frameState?.useLogDepth ?? null,
    light: light
      ? {
          type: light.constructor?.name || 'unknown',
          direction: vector(light.direction),
          color: color(light.color),
          intensity: Number.isFinite(light.intensity) ? light.intensity : null,
        }
      : null,
    renderUniformState: uniformState
      ? {
          lightColor: vector(uniformState.lightColor),
          lightColorHdr: vector(uniformState.lightColorHdr),
          sunPositionWC: vector(uniformState.sunPositionWC),
          cameraPositionWC: vector(uniformState.cameraPositionWC),
        }
      : null,
    environment: environment
      ? {
          useOIT: environment.useOIT,
          useGlobeDepthFramebuffer: environment.useGlobeDepthFramebuffer,
          usePostProcess: environment.usePostProcess,
          isSunVisible: environment.isSunVisible,
          isMoonVisible: environment.isMoonVisible,
          isSkyAtmosphereVisible: environment.isSkyAtmosphereVisible,
        }
      : null,
    sun: scene.sun
      ? { show: scene.sun.show, glowFactor: scalar(scene.sun.glowFactor) }
      : null,
    moon: scene.moon ? { show: scene.moon.show } : null,
    atmosphere: scene.atmosphere
      ? { dynamicLighting: scene.atmosphere.dynamicLighting ?? null }
      : null,
    globe: scene.globe
      ? { show: scene.globe.show, enableLighting: scene.globe.enableLighting }
      : null,
  };
}

function uniformsFor(gl, program, limit) {
  if (!gl || !program?._program)
    return { status: 'unavailable', reason: 'webgl-program-unavailable' };
  try {
    const count = gl.getProgramParameter(program._program, gl.ACTIVE_UNIFORMS);
    if (!Number.isInteger(count) || count < 0)
      return {
        status: 'unavailable',
        reason: 'active-uniform-count-unavailable',
      };
    const uniforms = [];
    for (let i = 0; i < Math.min(count, limit); i++) {
      const info = gl.getActiveUniform(program._program, i);
      if (!info) {
        uniforms.push({ index: i, status: 'unavailable' });
        continue;
      }
      let status = 'read';
      let value;
      try {
        const location = gl.getUniformLocation(program._program, info.name);
        if (location === null) {
          status = 'location-unavailable';
          value = null;
        } else {
          const result = gl.getUniform(program._program, location);
          value =
            ArrayBuffer.isView(result) || Array.isArray(result)
              ? Array.from(result, scalar)
              : typeof result === 'number'
                ? scalar(result)
                : result;
        }
      } catch (error) {
        status = 'read-error';
        value = String(error?.message || error).slice(0, 240);
      }
      uniforms.push({
        name: info.name,
        size: info.size,
        type: Number.isFinite(info.type) ? `0x${info.type.toString(16)}` : null,
        status,
        value,
      });
    }
    return {
      status: 'read',
      activeCount: count,
      truncated: count > uniforms.length,
      uniforms,
      observationScope:
        'program-object values last set; not attributable to a particular frustum draw',
    };
  } catch (error) {
    return {
      status: 'unavailable',
      reason: String(error?.message || error).slice(0, 240),
    };
  }
}

/**
 * Snapshot the actual Cesium.Model fleet owners and their commands after a
 * completed render. Reads Model state, known nested PrimitiveCollections,
 * frustum command lists, WebGL program sources, and current program uniforms.
 * It does not mutate Cesium or bind a GL program.
 */
export function snapshotFleetModelProgramState(viewer, options = {}) {
  const limits = {
    commands: options.maxCommands ?? DEFAULT_LIMITS.commands,
    models: options.maxModels ?? DEFAULT_LIMITS.models,
    collectionDepth:
      options.maxCollectionDepth ?? DEFAULT_LIMITS.collectionDepth,
    programs: options.maxPrograms ?? DEFAULT_LIMITS.programs,
    uniformsPerProgram:
      options.maxUniformsPerProgram ?? DEFAULT_LIMITS.uniformsPerProgram,
    shaderCharsPerStage:
      options.maxShaderCharsPerStage ?? DEFAULT_LIMITS.shaderCharsPerStage,
    harmonicCoefficients:
      options.maxHarmonicCoefficients ?? DEFAULT_LIMITS.harmonicCoefficients,
    computeCommandsPerManager:
      options.maxComputeCommandsPerManager ??
      DEFAULT_LIMITS.computeCommandsPerManager,
  };
  for (const [key, value] of Object.entries(limits))
    if (!Number.isInteger(value) || value < 0)
      throw new TypeError(`Invalid ${key} limit`);
  const scene = viewer?.scene;
  if (!scene) throw new TypeError('Cesium viewer scene required');

  const collected = collectModels(scene, limits);
  const programs = new Map();
  const commandEvidence = listModelCommands(scene, collected, programs, limits);
  const gl = scene.context?._gl;
  const programSnapshots = [...programs.values()].map((record) => {
    const shader = record._shader;
    delete record._shader;
    record.uniforms = uniformsFor(gl, shader, limits.uniformsPerProgram);
    return record;
  });
  for (let i = 0; i < collected.models.length; i++) {
    const model = collected.models[i];
    model.frustumCommandCount =
      commandEvidence.visibleCommandCounts?.get(
        getModelByIndex(collected.modelByObject, i),
      ) || 0;
    model.hasFrustumCommand = model.frustumCommandCount > 0;
  }

  const oit = scene._view?.oit;
  return {
    schema: 'gev-fleet-model-program-state/v1',
    cesiumVersion: Cesium.VERSION,
    frameNumber: scene.frameState?.frameNumber ?? null,
    sceneLighting: sceneLightingSnapshot(scene),
    models: {
      status: 'read',
      total: collected.models.length,
      truncated: collected.truncated,
      items: collected.models,
    },
    drawEvidence: {
      status: commandEvidence.status,
      totalMatchingCommands: commandEvidence.totalMatching,
      truncated: commandEvidence.truncated,
      commands: commandEvidence.commands,
    },
    programs: programSnapshots,
    oit: {
      configured: scene.orderIndependentTranslucency ?? null,
      effective: scene._environmentState?.useOIT ?? null,
      supported:
        typeof oit?.isSupported === 'function' ? oit.isSupported() : null,
      mode: oit
        ? oit._translucentMRTSupport === true
          ? 'mrt'
          : oit._translucentMultipassSupport === true
            ? 'multipass'
            : 'unsupported-or-uninitialized'
        : 'unavailable',
    },
    limitations: [
      'Uniform values are program-object state last written by the GPU command path and cannot be assigned to a specific frustum draw.',
      'Only Cesium 1.138 scene PrimitiveCollections, Model owners, frustum command arrays, and known OIT derived-command fields are inspected.',
      'Shader source strings are returned for caller hashing; each stage is capped and reports truncation.',
    ],
  };
}

function getModelByIndex(modelByObject, index) {
  for (const [model, modelIndex] of modelByObject)
    if (modelIndex === index) return model;
  return null;
}
