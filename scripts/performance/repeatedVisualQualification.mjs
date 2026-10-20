import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  FINAL_VISUAL_STATES,
  inspectRepeatedVisualPairEvidence,
  readScreenshotBoundaryHudState,
} from './finalVisualQualification.mjs';
import {
  REPEATED_VISUAL_POLICY,
  validateRepeatedFullImageControls,
} from './repeatedFullImageControls.mjs';
import { assertVisualPaintSignature } from './visualPaintSignature.mjs';
import {
  CANONICAL_POINTER_HISTORY,
  readCanonicalPointerMutationSequence,
} from './canonicalPointerHistory.mjs';
import {
  FULL_EXTENT_POINTER_SWEEP_POLICY,
  createFullExtentPointerSweepPlan,
  readFullExtentPointerSweepMutationSequence,
} from './fullExtentPointerSweep.mjs';
import {
  DECORATION_QUANTIZATION_POLICY,
  DECORATION_SOURCE_FILES,
  createDecorationQuantizationPlan,
  assertDecorationBoundaryPair,
  validateDecorationImageControls,
} from './decorationQuantization.mjs';

export const REPEATED_VISUAL_SCHEMA = 'gev-repeated-visual-qualification/v1';
export const REPEATED_VISUAL_ORDER = Object.freeze([
  'baseline',
  'candidate',
  'baseline',
  'candidate',
  'baseline',
  'candidate',
]);
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');

export function createRepeatedVisualPlan(
  options,
  { legacyAcquisition = false } = {},
) {
  const application = {
    baselineSha: options['baseline-app-sha'],
    candidateSha: options['candidate-app-sha'],
  };
  for (const sha of Object.values(application))
    assert.match(sha || '', /^[a-f0-9]{40}$/);
  assert.notEqual(application.baselineSha, application.candidateSha);
  assert.match(options['visual-harness-sha'] || '', /^[a-f0-9]{40}$/);
  const decoration =
    options['raster-policy'] === DECORATION_QUANTIZATION_POLICY;
  assert.ok(
    options['raster-policy'] === undefined ||
      options['raster-policy'] === REPEATED_VISUAL_POLICY ||
      decoration,
    'Unsupported prospective raster policy',
  );
  assert.ok(
    !decoration || !legacyAcquisition,
    'Decoration policy requires full pointer acquisition',
  );
  return {
    schema: REPEATED_VISUAL_SCHEMA,
    policy: decoration
      ? DECORATION_QUANTIZATION_POLICY
      : REPEATED_VISUAL_POLICY,
    application,
    visualHarnessCommit: options['visual-harness-sha'],
    ...(!legacyAcquisition
      ? { fullExtentPointerSweep: createFullExtentPointerSweepPlan() }
      : {}),
    roleOrder: REPEATED_VISUAL_ORDER,
    states: FINAL_VISUAL_STATES,
    freshDocumentsPerBuild: 3,
    pngCount: 24,
    masks: [],
    imageSelection: decoration
      ? 'all-six-images-all-unordered-pairs-no-fallback'
      : 'all-declared-controls-required-bidirectional-whole-image-support',
    ...(decoration
      ? {
          decorationQuantization: createDecorationQuantizationPlan(),
        }
      : {
          smallVariance: {
            maximumPixels: 10,
            maximumRgbChannelDelta: 10,
            alphaChangesAllowed: false,
            bothValuesMustOccurInBothBuilds: true,
          },
        }),
  };
}

/** Hash-bound raw acquisition evidence; diagnostic summaries are never inputs. */
export async function validateRepeatedVisualQualification({
  planBytes,
  pairs,
  decodePng,
} = {}) {
  assert.ok(Buffer.isBuffer(planBytes), 'Raw predeclared plan bytes required');
  const plan = JSON.parse(planBytes.toString('utf8'));
  assert.deepEqual(
    plan,
    createRepeatedVisualPlan(
      {
        'baseline-app-sha': plan.application?.baselineSha,
        'candidate-app-sha': plan.application?.candidateSha,
        'visual-harness-sha': plan.visualHarnessCommit,
        ...(plan.policy === DECORATION_QUANTIZATION_POLICY
          ? { 'raster-policy': plan.policy }
          : {}),
      },
      { legacyAcquisition: plan.fullExtentPointerSweep === undefined },
    ),
    'Repeated visual plan differs from the fixed policy',
  );
  assert.ok(
    Array.isArray(pairs) && pairs.length === 3,
    'All three raw pairs required',
  );
  const planSha256 = digest(planBytes);
  const inspected = [];
  const reports = [];
  const hashes = [];
  const browserPids = new Set();
  for (const [index, pair] of pairs.entries()) {
    assert.ok(Buffer.isBuffer(pair.bytes), 'Raw pair bytes required');
    assert.ok(
      pair.bytes.length <= 16 * 1024 * 1024,
      'Pair report exceeds bound',
    );
    const report = JSON.parse(pair.bytes.toString('utf8'));
    assert.equal(report.rasterPolicy, plan.policy);
    if (plan.policy === DECORATION_QUANTIZATION_POLICY) {
      assert.deepEqual(
        report.decorationQuantization,
        plan.decorationQuantization,
      );
      for (const side of ['baseline', 'candidate'])
        assert.deepEqual(
          report.decorationSourceFiles?.[side],
          DECORATION_SOURCE_FILES,
          'Decoration source closure changed',
        );
    } else {
      assert.equal(
        report.decorationQuantization,
        undefined,
        'Legacy reports cannot acquire a decoration allowance',
      );
    }
    assert.equal(
      report.fullExtentPointerSweepPolicy,
      plan.fullExtentPointerSweep?.policy,
      'Pair pointer acquisition differs from the predeclared plan',
    );
    assert.equal(report.comparisonEligible, false);
    assert.equal(report.evidenceScope, 'repeated-control-acquisition-only');
    assert.deepEqual(
      report.repeatedControlPlan,
      {
        policy: plan.policy,
        planSha256,
        pairOrdinal: index + 1,
      },
      'Pair was not captured for this predeclared batch',
    );
    assert.deepEqual(report.application, plan.application);
    assert.equal(report.harness?.visualHarnessCommit, plan.visualHarnessCommit);
    for (const side of ['baseline', 'candidate']) {
      const pid = report.environment?.browserPid?.[side];
      assert.ok(
        !browserPids.has(pid),
        'Repeated controls must use independently owned fresh browsers',
      );
      browserPids.add(pid);
    }
    inspected.push(
      await inspectRepeatedVisualPairEvidence(report, {
        evidenceRoot: pair.evidenceRoot,
        decodePng,
      }),
    );
    reports.push(report);
    hashes.push(digest(pair.bytes));
  }
  for (const report of reports.slice(1))
    for (const field of ['application', 'harness', 'receipts', 'fixture'])
      assert.deepEqual(
        report[field],
        reports[0][field],
        `Repeated ${field} differs`,
      );

  const comparisons = [];
  for (const [stateIndex, id] of FINAL_VISUAL_STATES.entries()) {
    let semantic;
    let paint;
    let decoration;
    const images = { baseline: [], candidate: [] };
    for (const [pairIndex, report] of reports.entries()) {
      const state = report.states[stateIndex];
      for (const side of ['baseline', 'candidate']) {
        const signature = state.paint?.[side];
        const capturedAttempts = state.presentation?.[side]?.attempts?.filter(
          (attempt) => attempt.image,
        );
        assert.ok(
          capturedAttempts?.length === 1 &&
            capturedAttempts[0].accepted === true &&
            capturedAttempts[0].image.sha256 === state[side].sha256,
          'Every captured PNG must be retained as the declared control; image selection is forbidden',
        );
        assertVisualPaintSignature(signature?.before);
        assertVisualPaintSignature(signature?.after);
        assert.deepEqual(
          signature.before,
          signature.after,
          `${id} paint changed during capture`,
        );
        paint ??= signature.before;
        assert.deepEqual(
          signature.before,
          paint,
          `${id} paint differs between controls`,
        );
        if (plan.policy === DECORATION_QUANTIZATION_POLICY) {
          const proof = state.decoration?.[side];
          assert.deepEqual(
            capturedAttempts[0].decoration,
            proof,
            'Decoration proof is not bound to the retained screenshot attempt',
          );
          assertDecorationBoundaryPair(proof, signature);
          decoration ??= proof;
          assert.deepEqual(
            proof,
            decoration,
            `${id} decoration inputs/fonts differ between controls`,
          );
        }
        // Event sequence counters prove that each document received fresh input;
        // their numeric values are not paint inputs and may differ by document.
        const gaze = { ...state.presentation[side].before.gaze };
        delete gaze.pointerMoveSequence;
        delete gaze.resetSequence;
        const current = {
          fullExtentPointerMutations:
            report.fullExtentPointerSweepPolicy ===
            FULL_EXTENT_POINTER_SWEEP_POLICY
              ? readFullExtentPointerSweepMutationSequence(
                  state.fullExtentPointerSweep?.[side]?.acquisition,
                )
              : null,
          canonicalPointerMutations:
            report.pointerHistoryPolicy === CANONICAL_POINTER_HISTORY
              ? readCanonicalPointerMutationSequence(
                  state.pointerHistory?.[side]?.acquisition,
                )
              : null,
          renderer: report.environment.renderer,
          profile: state.nativeSharpnessProfileByRevision[side],
          camera: state.cameraByRevision[side],
          settings: state.settings[side],
          populations: state.populations[side],
          timestamp: state.timestampMs[side],
          hud: readScreenshotBoundaryHudState(state, side),
          summary: state.presentation[side].before.summary,
          gaze,
          activeElement: state.presentation[side].before.activeElement,
          scrollContainers: state.presentation[side].before.scrollContainers,
        };
        semantic ??= current;
        assert.deepEqual(
          current,
          semantic,
          `${id} semantic inputs differ between controls`,
        );
        images[side].push({
          id: `pair-${pairIndex + 1}-${side}-${id}`,
          pixels: inspected[pairIndex].decoded.get(id)[side],
        });
      }
    }
    comparisons.push({
      id,
      ...(plan.policy === DECORATION_QUANTIZATION_POLICY
        ? validateDecorationImageControls(images, decoration.before)
        : validateRepeatedFullImageControls(images, {
            exact: id === 'hud-hidden',
          })),
    });
  }
  return {
    schema: REPEATED_VISUAL_SCHEMA,
    status: 'passed',
    policy: plan.policy,
    planSha256,
    pairReportSha256: hashes,
    pngCount: 24,
    comparisons,
    historicalSinglePairResultsSuperseded: false,
    scope:
      'prospective repeated visual controls only; no timing or cadence acceptance',
  };
}

export async function reviewRepeatedVisualQualification(
  evidenceRoot,
  { decodePng } = {},
) {
  const root = path.resolve(evidenceRoot);
  const planBytes = await fs.readFile(path.join(root, 'plan.json'));
  const pairs = await Promise.all(
    [1, 2, 3].map(async (ordinal) => {
      const pairRoot = path.join(root, `pair-${ordinal}`);
      return {
        evidenceRoot: pairRoot,
        bytes: await fs.readFile(
          path.join(pairRoot, 'final-visual-qualification.json'),
        ),
      };
    }),
  );
  return validateRepeatedVisualQualification({ planBytes, pairs, decodePng });
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  assert.ok(
    process.argv[2],
    'Usage: node repeatedVisualQualification.mjs EVIDENCE_ROOT',
  );
  console.log(
    JSON.stringify(await reviewRepeatedVisualQualification(process.argv[2])),
  );
}
