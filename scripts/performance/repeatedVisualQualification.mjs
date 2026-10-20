import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  FINAL_VISUAL_STATES,
  inspectRepeatedVisualPairEvidence,
} from './finalVisualQualification.mjs';
import {
  REPEATED_VISUAL_POLICY,
  validateRepeatedFullImageControls,
} from './repeatedFullImageControls.mjs';
import { assertVisualPaintSignature } from './visualPaintSignature.mjs';

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

export function createRepeatedVisualPlan(options) {
  const application = {
    baselineSha: options['baseline-app-sha'],
    candidateSha: options['candidate-app-sha'],
  };
  for (const sha of Object.values(application))
    assert.match(sha || '', /^[a-f0-9]{40}$/);
  assert.notEqual(application.baselineSha, application.candidateSha);
  assert.match(options['visual-harness-sha'] || '', /^[a-f0-9]{40}$/);
  return {
    schema: REPEATED_VISUAL_SCHEMA,
    policy: REPEATED_VISUAL_POLICY,
    application,
    visualHarnessCommit: options['visual-harness-sha'],
    roleOrder: REPEATED_VISUAL_ORDER,
    states: FINAL_VISUAL_STATES,
    freshDocumentsPerBuild: 3,
    pngCount: 24,
    masks: [],
    imageSelection:
      'all-declared-controls-required-bidirectional-whole-image-support',
    smallVariance: {
      maximumPixels: 10,
      maximumRgbChannelDelta: 10,
      alphaChangesAllowed: false,
      bothValuesMustOccurInBothBuilds: true,
    },
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
    createRepeatedVisualPlan({
      'baseline-app-sha': plan.application?.baselineSha,
      'candidate-app-sha': plan.application?.candidateSha,
      'visual-harness-sha': plan.visualHarnessCommit,
    }),
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
    assert.equal(report.rasterPolicy, REPEATED_VISUAL_POLICY);
    assert.equal(report.comparisonEligible, false);
    assert.equal(report.evidenceScope, 'repeated-control-acquisition-only');
    assert.deepEqual(
      report.repeatedControlPlan,
      {
        policy: REPEATED_VISUAL_POLICY,
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
        // Event sequence counters prove that each document received fresh input;
        // their numeric values are not paint inputs and may differ by document.
        const gaze = { ...state.presentation[side].before.gaze };
        delete gaze.pointerMoveSequence;
        delete gaze.resetSequence;
        const current = {
          renderer: report.environment.renderer,
          profile: state.nativeSharpnessProfileByRevision[side],
          camera: state.cameraByRevision[side],
          settings: state.settings[side],
          populations: state.populations[side],
          timestamp: state.timestampMs[side],
          hud: state.hud[side],
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
      ...validateRepeatedFullImageControls(images, {
        exact: id === 'hud-hidden',
      }),
    });
  }
  return {
    schema: REPEATED_VISUAL_SCHEMA,
    status: 'passed',
    policy: REPEATED_VISUAL_POLICY,
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
