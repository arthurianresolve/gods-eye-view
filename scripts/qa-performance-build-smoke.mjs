#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { createReadStream, readFileSync } from 'node:fs';
import {
  lstat,
  mkdtemp,
  readFile,
  realpath,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import puppeteer from 'puppeteer';
import {
  cleanupFixturePageDiagnostics,
  prepareFixturePage,
} from './qa-application-fixtures.mjs';
import { createLocalBuildReceipt } from './performance/buildProvenance.mjs';
import { beginCaptureBuildProvenance } from './performance/captureBuildProvenance.mjs';
import {
  auditReceiptedCodeRequests,
  createApplicationCodeRequestAudit,
  respondToWorkerPreflight,
  runSameOriginWorkerPreflight,
  waitForPreflightWorkerTargetsClosed,
} from './performance/buildSmokeContract.mjs';
import {
  describeObservedRoute,
  observeCommonScene,
} from './performance/commonSceneObserver.mjs';
import {
  cleanupEarlyCesiumRendererProbeWithEvidence,
  installEarlyCesiumRendererProbe,
  removeEarlyCesiumRendererProbeRegistrationWithEvidence,
} from './performance/earlyCesiumRendererProbe.mjs';
import {
  createFlightFixtureDeliveryObserver,
  createProductionFlightFixture,
  installHeldMonotonicWallClock,
  respondToProductionFlightFixture,
} from './performance/productionFlightFixture.mjs';
import {
  deriveCesiumEmbeddedWorkerContract,
  installCesiumWorkerBlobAudit,
  MAX_WORKER_TARGETS,
  restoreCesiumWorkerBlobAudit,
  summarizeCesiumWorkerBlobEvidence,
  validateCesiumWorkerBlobs,
} from './performance/cesiumWorkerBlobContract.mjs';
import {
  boundCaptureReportEvidence,
  MAX_CAPTURE_FAILURE_REPORT_BYTES,
} from './performance/captureFailureReport.mjs';
import {
  createObservedDenseComparisonContract,
  createObservedInfrastructureComparisonContract,
  createCaptureDocumentTopology,
  getCaptureComparisonIneligibilityReasons,
} from './performance/captureComparisonContract.mjs';
import {
  createInfrastructureWorkloadFixture,
  INFRASTRUCTURE_WORKLOAD_IDS,
} from './performance/infrastructureWorkloadFixture.mjs';

const BASELINE_SHA = 'eb8c6828d0d03e1c04bda94c8c4fb99915a577b7';
const ROOT = await realpath(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'),
);
const DEFAULT_BUDGET_MS = 12 * 60 * 1000;
const BUILD_COMMAND_TIMEOUT_MS = 150 * 1000;
const CAPTURE_CLI_TIMEOUT_MS = 180 * 1000;
const SHA1 = /^[a-f0-9]{40}$/;
const MIME_TYPES = {
  '.css': 'text/css; charset=utf-8',
  '.gif': 'image/gif',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.wasm': 'application/wasm',
  '.webp': 'image/webp',
};

const OPTION_KEYS = new Map([
  ['--candidate-sha', 'candidateSha'],
  ['--out', 'out'],
  ['--capture-worker-audit-mode', 'captureWorkerAuditMode'],
  ['--provider-fixture', 'providerFixture'],
  ['--capture-scene-frame-diagnostics', 'sceneFrameDiagnostics'],
  ['--capture-first-motion-cpu-profile', 'firstMotionCpuProfile'],
]);

const PROVIDER_CPU_PROFILE_TARGETS = Object.freeze([
  { scenario: 'idle', run: 1 },
  { scenario: 'idle', run: 2 },
  { scenario: 'scripted-motion', run: 1 },
]);

function providerCpuProfileKey(target) {
  return target.scenario === 'idle'
    ? `provider-idle-${target.run}`
    : `provider-scripted-motion-${target.run}`;
}

function sameProviderCpuProfileTarget(left, right) {
  const fields = [
    'scenario',
    'run',
    'captureOrdinal',
    'documentRole',
    'documentId',
  ];
  return (
    left !== null &&
    typeof left === 'object' &&
    !Array.isArray(left) &&
    right !== null &&
    typeof right === 'object' &&
    !Array.isArray(right) &&
    Object.keys(left).sort().join(',') === fields.slice().sort().join(',') &&
    Object.keys(right).sort().join(',') === fields.slice().sort().join(',') &&
    fields.every((field) => left[field] === right[field])
  );
}

function validateProviderCpuProfileWindow(window, target, sample) {
  assert.equal(window?.schema, 'gev-provider-sample-cpu-profile-window/v1');
  assert.equal(window?.targetScenario, target.scenario);
  assert.equal(window?.targetRun, target.run);
  assert.ok(Number.isSafeInteger(sample?.captureOrdinal));
  assert.ok(sample.captureOrdinal >= 0);
  assert.equal(window?.captureOrdinal, sample.captureOrdinal);
  assert.equal(window?.documentRole, sample.documentRole);
  assert.equal(window?.documentId, sample.documentId);
  assert.equal(window?.profilerStarted, true);
  assert.equal(window?.performanceAcceptanceEligible, false);
  assert.ok(['complete', 'incomplete'].includes(window?.status));
  const ref = window.profile;
  const key = providerCpuProfileKey(target);
  assert.equal(ref?.schema, 'gev-render-boundary-cpu-profile-ref/v1');
  assert.equal(ref?.performanceAcceptanceEligible, false);
  assert.equal(
    sameProviderCpuProfileTarget(ref?.target, {
      scenario: target.scenario,
      run: target.run,
      captureOrdinal: sample.captureOrdinal,
      documentRole: sample.documentRole,
      documentId: sample.documentId,
    }),
    true,
  );
  assert.equal(ref?.fileName, `${key}-cpu-profile.json`);
  assert.equal(ref?.performanceAcceptanceEligible, false);
  assert.ok(Array.isArray(ref?.profilerErrors));
  assert.equal(ref.profilerErrors.length, 0);
  assert.ok(Number.isFinite(ref?.profileWindowMs) && ref.profileWindowMs >= 0);
  assert.ok(Number.isFinite(ref?.stopOverrunMs) && ref.stopOverrunMs >= 0);
  assert.ok(ref.profileWindowMs <= 62_000);
  assert.ok(ref.stopOverrunMs <= 2_000);
  assert.equal(ref.stopOverrunMs, Math.max(0, ref.profileWindowMs - 60_000));
  assert.ok(
    (ref.status === 'complete' &&
      ref.windowCapReached === false &&
      ref.windowCapMs === null &&
      ref.stopOverrunMs === 0) ||
      (ref.status === 'incomplete' &&
        ((ref.windowCapReached === true && ref.windowCapMs === 60_000) ||
          (ref.windowCapReached === false &&
            ref.windowCapMs === null &&
            ref.stopOverrunMs > 0))),
  );
  assert.equal(window.status, ref.status);
  assert.equal(window.windowCapReached, ref.windowCapReached);
  assert.equal(window.windowCapMs, ref.windowCapMs);
  assert.equal(window.profileWindowMs, ref.profileWindowMs);
  assert.equal(window.stopOverrunMs, ref.stopOverrunMs);
  assert.match(ref.sha256 || '', /^[a-f0-9]{64}$/);
  assert.ok(
    Number.isInteger(ref.byteLength) &&
      ref.byteLength > 0 &&
      ref.byteLength <= 8 * 1024 * 1024,
  );
}

export async function readProviderCpuProfileIndexSet(directory) {
  const profiles = [];
  let invalidIndexCount = 0;
  for (const target of PROVIDER_CPU_PROFILE_TARGETS) {
    const key = providerCpuProfileKey(target);
    const indexPath = path.join(directory, `${key}-cpu-profile-ref.json`);
    let bytes;
    try {
      bytes = await readFile(indexPath);
    } catch (error) {
      if (error?.code === 'ENOENT') continue;
      invalidIndexCount += 1;
      continue;
    }
    try {
      if (bytes.byteLength > 16 * 1024) {
        invalidIndexCount += 1;
        continue;
      }
      const index = JSON.parse(bytes.toString('utf8'));
      if (
        index?.schema !== 'gev-provider-sample-cpu-profile-index/v1' ||
        index?.performanceAcceptanceEligible !== false ||
        index.target?.scenario !== target.scenario ||
        index.target?.run !== target.run ||
        !Number.isSafeInteger(index.target?.captureOrdinal) ||
        index.target.captureOrdinal < 0 ||
        typeof index.target?.documentRole !== 'string' ||
        index.target.documentRole.length < 1 ||
        index.target.documentRole.length > 80 ||
        typeof index.target?.documentId !== 'string' ||
        index.target.documentId.length < 1 ||
        index.target.documentId.length > 160 ||
        index.profile?.schema !== 'gev-render-boundary-cpu-profile-ref/v1' ||
        index.profile?.performanceAcceptanceEligible !== false ||
        !['complete', 'incomplete'].includes(index.profile?.status) ||
        !Array.isArray(index.profile?.profilerErrors) ||
        index.profile.profilerErrors.length !== 0 ||
        !sameProviderCpuProfileTarget(index.profile?.target, index.target) ||
        index.profile?.fileName !== `${key}-cpu-profile.json` ||
        !/^[a-f0-9]{64}$/.test(index.profile?.sha256 || '') ||
        !Number.isSafeInteger(index.profile?.byteLength) ||
        index.profile.byteLength < 1 ||
        index.profile.byteLength > 8 * 1024 * 1024
      ) {
        invalidIndexCount += 1;
        continue;
      }
      const profileBytes = await readFile(
        path.join(directory, index.profile.fileName),
      );
      if (
        profileBytes.byteLength !== index.profile.byteLength ||
        profileBytes.byteLength > 8 * 1024 * 1024 ||
        createHash('sha256').update(profileBytes).digest('hex') !==
          index.profile.sha256
      ) {
        invalidIndexCount += 1;
        continue;
      }
      profiles.push({ ...index, artifactVerified: true });
    } catch {
      invalidIndexCount += 1;
    }
  }
  return {
    schema: 'gev-provider-sample-cpu-profile-index-set/v1',
    performanceAcceptanceEligible: false,
    expectedTargets: PROVIDER_CPU_PROFILE_TARGETS,
    status:
      profiles.length === PROVIDER_CPU_PROFILE_TARGETS.length &&
      invalidIndexCount === 0
        ? 'all-targets-recorded'
        : 'partial',
    invalidIndexCount,
    profiles,
  };
}

export function parseSmokeArguments(argv) {
  const output = {};
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const key = OPTION_KEYS.get(flag);
    if (!key) throw new TypeError(`Unknown option: ${flag}`);
    const value = argv[++index];
    if (!value || value.startsWith('--'))
      throw new TypeError(`Missing value for ${flag}`);
    if (
      flag === '--capture-worker-audit-mode' &&
      !['diagnostic', 'prewarm'].includes(value)
    )
      throw new TypeError('Worker audit mode must be diagnostic or prewarm.');
    if (
      flag === '--provider-fixture' &&
      value !== 'dense-investigation' &&
      !INFRASTRUCTURE_WORKLOAD_IDS.includes(value)
    )
      throw new TypeError('Provider fixture must be a registered workload.');
    if (
      flag === '--capture-scene-frame-diagnostics' &&
      !['enabled', 'disabled'].includes(value)
    )
      throw new TypeError(
        'Scene frame diagnostics must be enabled or disabled.',
      );
    if (
      flag === '--capture-first-motion-cpu-profile' &&
      !['enabled', 'disabled'].includes(value)
    )
      throw new TypeError(
        'First-motion CPU profile must be enabled or disabled.',
      );
    output[key] = value;
  }
  if (
    output.providerFixture?.startsWith('infrastructure') &&
    output.captureWorkerAuditMode === 'prewarm'
  )
    throw new TypeError(
      'Infrastructure provider fixtures support diagnostic worker auditing only.',
    );
  if (
    output.sceneFrameDiagnostics === 'enabled' &&
    output.providerFixture &&
    output.providerFixture !== 'dense-investigation'
  )
    throw new TypeError(
      'Scene frame diagnostics require the dense investigation fixture.',
    );
  if (output.sceneFrameDiagnostics)
    output.sceneFrameDiagnostics = output.sceneFrameDiagnostics === 'enabled';
  if (output.firstMotionCpuProfile)
    output.firstMotionCpuProfile = output.firstMotionCpuProfile === 'enabled';
  if (
    output.firstMotionCpuProfile &&
    output.providerFixture &&
    output.providerFixture !== 'dense-investigation'
  )
    throw new TypeError(
      'First-motion CPU profiling requires the dense investigation fixture.',
    );
  return output;
}

/** Run an owned CLI process with bounded output and process-tree cleanup. */
export function runBoundedChild(
  command,
  args,
  { timeoutMs, maxOutputBytes = 64 * 1024, ownedPidFile = null } = {},
) {
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1)
    throw new TypeError('Child timeout must be a positive integer.');
  if (!Number.isInteger(maxOutputBytes) || maxOutputBytes < 1024)
    throw new TypeError('Child output bound must be at least 1024 bytes.');
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: ROOT,
      detached: process.platform !== 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    const chunks = { stdout: [], stderr: [] };
    const outputChunks = [];
    let capturedBytes = 0;
    let stopReason = null;
    let stopTimer = null;
    let finalTimer = null;
    let timeoutTimer = null;
    let settled = false;
    let ownedBrowserPid = null;

    const rememberOwnedBrowserPid = () => {
      if (!ownedPidFile) return;
      try {
        const value = Number(readFileSync(ownedPidFile, 'utf8').trim());
        if (Number.isSafeInteger(value) && value > 0) ownedBrowserPid = value;
      } catch {
        // The CLI may not have launched Chromium yet, or may have cleaned up.
      }
    };
    const terminatePid = (pid, signal) => {
      if (!Number.isSafeInteger(pid) || pid < 1) return false;
      if (process.platform === 'win32') {
        const result = spawnSync(
          'taskkill',
          ['/PID', String(pid), '/T', '/F'],
          {
            encoding: 'utf8',
            stdio: 'ignore',
            timeout: 1500,
            windowsHide: true,
          },
        );
        if (result.error) return false;
        return result.status === 0;
      }
      try {
        process.kill(pid, signal);
        return true;
      } catch (error) {
        if (error.code === 'ESRCH') return true;
        return false;
      }
    };

    const signalOwnedTree = (signal) => {
      if (!child.pid) return;
      rememberOwnedBrowserPid();
      if (process.platform === 'win32') {
        terminatePid(child.pid, signal);
      } else {
        try {
          process.kill(-child.pid, signal);
        } catch (error) {
          if (error.code !== 'ESRCH') throw error;
        }
      }
      if (ownedBrowserPid && ownedBrowserPid !== child.pid) {
        if (process.platform === 'win32') {
          terminatePid(ownedBrowserPid, signal);
        } else {
          try {
            process.kill(-ownedBrowserPid, signal);
          } catch (error) {
            if (error.code === 'ESRCH') terminatePid(ownedBrowserPid, signal);
            else throw error;
          }
        }
      }
    };
    const isProcessPresent = (pid, group) => {
      if (!Number.isSafeInteger(pid) || pid < 1) return false;
      if (process.platform === 'win32') {
        const result = spawnSync(
          'tasklist',
          ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'],
          {
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'ignore'],
            timeout: 1000,
            windowsHide: true,
          },
        );
        if (result.error || result.status !== 0) return null;
        return result.stdout.includes(`"${pid}"`);
      }
      try {
        process.kill(group ? -pid : pid, 0);
        return true;
      } catch (error) {
        return error.code === 'ESRCH' ? false : null;
      }
    };
    const waitForProcessExit = async (pid, group) => {
      for (let attempt = 0; attempt < 20; attempt += 1) {
        const present = isProcessPresent(pid, group);
        if (present === false) return true;
        if (present === null) return false;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      return false;
    };
    const cleanupTimers = () => {
      clearTimeout(timeoutTimer);
      clearTimeout(stopTimer);
      clearTimeout(finalTimer);
    };
    const childDiagnostics = () => {
      const allOutputLines = Buffer.concat(outputChunks)
        .toString('utf8')
        .split(/\r?\n/)
        .filter(Boolean);
      const progress = allOutputLines.filter((line) =>
        line.includes('[performance]'),
      );
      return {
        stderrLines: Buffer.concat(chunks.stderr)
          .toString('utf8')
          .split(/\r?\n/)
          .filter(Boolean)
          .slice(0, 4)
          .map((line) => sanitizeError(line).slice(0, 200)),
        progressLines: (progress.length ? progress : allOutputLines)
          .slice(-4)
          .map((line) =>
            sanitizeError(line.replace(/(\d+)\/(\d+)/g, '$1 of $2')).slice(
              0,
              200,
            ),
          ),
      };
    };
    const rejectAfterStop = (reason) => {
      if (stopReason) return;
      stopReason = reason;
      try {
        signalOwnedTree('SIGTERM');
      } catch {
        // The child may have exited between the event and signal.
      }
      stopTimer = setTimeout(() => {
        try {
          signalOwnedTree('SIGKILL');
        } catch {
          // The child tree may already be gone.
        }
        finalTimer = setTimeout(() => {
          if (settled) return;
          settled = true;
          cleanupTimers();
          child.stdout?.destroy();
          child.stderr?.destroy();
          child.stdin?.destroy();
          child.unref();
          const error = new Error(
            `Child process ${stopReason}; cleanup unconfirmed; pipes released.`,
          );
          error.childDiagnostics = childDiagnostics();
          reject(error);
        }, 2000);
      }, 5000);
    };
    const append = (stream, chunk) => {
      capturedBytes += chunk.length;
      if (capturedBytes <= maxOutputBytes) {
        chunks[stream].push(chunk);
        outputChunks.push(chunk);
      } else rejectAfterStop('output limit exceeded');
    };
    child.stdout.on('data', (chunk) => append('stdout', chunk));
    child.stderr.on('data', (chunk) => append('stderr', chunk));
    child.once('error', (error) => {
      if (settled) return;
      settled = true;
      cleanupTimers();
      reject(
        new Error(`Child process could not start: ${sanitizeError(error)}`),
      );
    });
    child.once('close', async (code, signal) => {
      if (settled) return;
      rememberOwnedBrowserPid();
      if (stopReason || code !== 0 || ownedBrowserPid) {
        try {
          signalOwnedTree('SIGKILL');
        } catch {
          // The owned process group may already have exited.
        }
      }
      cleanupTimers();
      const output = {
        code,
        signal,
        stdout: Buffer.concat(chunks.stdout).toString('utf8'),
        stderr: Buffer.concat(chunks.stderr).toString('utf8'),
      };
      if (stopReason || code !== 0 || ownedBrowserPid) {
        const ownedTargets = [
          ...(process.platform !== 'win32'
            ? [{ pid: child.pid, group: true }]
            : [{ pid: child.pid, group: false }]),
          ...(ownedBrowserPid ? [{ pid: ownedBrowserPid, group: true }] : []),
        ];
        let cleanupConfirmed = true;
        for (const target of ownedTargets) {
          if (!(await waitForProcessExit(target.pid, target.group)))
            cleanupConfirmed = false;
        }
        settled = true;
        const diagnostics = childDiagnostics();
        const detail = diagnostics.stderrLines.join(' ').slice(0, 500);
        const error = new Error(
          `Child process ${stopReason || `exited ${code}`}; ${detail || diagnostics.progressLines.join(' | ') || 'no child diagnostics'}; cleanup ${cleanupConfirmed ? 'confirmed' : 'unconfirmed'} (${signal || code}).`,
        );
        error.childDiagnostics = diagnostics;
        reject(error);
      } else {
        settled = true;
        resolve(output);
      }
    });
    timeoutTimer = setTimeout(() => rejectAfterStop('timed out'), timeoutMs);
  });
}

function assertCaptureFrameAndSettingsEvidence(sample, scenario) {
  assert.ok(
    Number.isInteger(sample.frameCount) && sample.frameCount >= 0,
    `${scenario} run ${sample.run}: frame count is missing or invalid.`,
  );
  assert.ok(
    Number.isInteger(sample.renderedFrameCount) &&
      sample.renderedFrameCount >= 0,
    `${scenario} run ${sample.run}: rendered-frame count is missing or invalid.`,
  );
  assert.equal(
    sample.frameCount,
    Math.max(0, sample.renderedFrameCount - 1),
    `${scenario} run ${sample.run}: rendered-frame and interval counts disagree.`,
  );
  const frameIntervals = sample.frameIntervalMs;
  assert.ok(
    Number.isInteger(frameIntervals?.samples) &&
      frameIntervals.samples === sample.frameCount,
    `${scenario} run ${sample.run}: frame interval samples do not match rendered-frame intervals.`,
  );
  if (scenario === 'idle') {
    if (sample.frameCount === 0)
      assert.equal(
        frameIntervals.p95,
        null,
        `idle run ${sample.run}: zero-frame timing must remain unavailable.`,
      );
    else
      assert.ok(
        Number.isFinite(frameIntervals.p95) && frameIntervals.p95 > 0,
        `idle run ${sample.run}: frame interval p95 is missing or invalid.`,
      );
  } else {
    assert.ok(
      sample.renderedFrameCount >= 2,
      `${scenario} run ${sample.run}: expected at least two rendered frames.`,
    );
    assert.ok(
      Number.isFinite(frameIntervals.p95) && frameIntervals.p95 > 0,
      `${scenario} run ${sample.run}: frame interval p95 is missing or invalid.`,
    );
  }
  assert.equal(sample.settings?.before?.qualityMode, 'manual');
  assert.equal(sample.settings?.before?.densityPct, 75);
  assert.equal(sample.settings?.before?.detectionMode, 'DENSE');
  assert.equal(sample.settings?.after?.qualityMode, 'manual');
  assert.equal(sample.settings?.after?.densityPct, 75);
  assert.equal(sample.settings?.after?.detectionMode, 'DENSE');
}

export function validateCaptureCliReport(report, expected) {
  if (expected.providerFixture?.startsWith('infrastructure'))
    return validateInfrastructureCaptureCliReport(report, expected);
  assert.equal(report?.schema, 'gev-performance-capture/v1');
  const workerAuditMode = expected.workerAuditMode || 'diagnostic';
  assert.equal(report.workerAuditMode, workerAuditMode);
  assert.equal(report.comparisonEligible, false);
  if (expected.firstMotionCpuProfile) {
    const profileEvidence = report.providerSampleCpuProfiles;
    const targets = PROVIDER_CPU_PROFILE_TARGETS;
    assert.equal(profileEvidence?.enabled, true);
    assert.deepEqual(profileEvidence?.targets, targets);
    assert.equal(profileEvidence?.performanceAcceptanceEligible, false);
    assert.equal(
      profileEvidence?.scope,
      'first two idle samples and first scripted-motion sample, each from immediately before warmup through its measurement-boundary completion or failure; sampled main-thread stacks include idle and garbage collection, and are not precise CPU execution or GPU timing',
    );
    assert.ok(['complete', 'incomplete'].includes(profileEvidence?.status));
    assert.equal(profileEvidence?.profiles?.length, targets.length);
    const samples = new Map(
      (report.captures || []).map((sample) => [
        `${sample.scenario}:${sample.run}`,
        sample,
      ]),
    );
    for (let index = 0; index < targets.length; index += 1) {
      const target = targets[index];
      const window = profileEvidence.profiles[index];
      const sample = samples.get(`${target.scenario}:${target.run}`);
      assert.ok(sample, 'profile target capture sample is missing');
      assert.equal(
        sample.captureOrdinal,
        report.captures.indexOf(sample),
        'sample capture ordinal must match its position in the actual capture sequence',
      );
      validateProviderCpuProfileWindow(window, target, sample);
      assert.deepEqual(sample.providerSampleCpuProfile, window);
    }
    assert.equal(
      profileEvidence.status,
      profileEvidence.profiles.every((window) => window.status === 'complete')
        ? 'complete'
        : 'incomplete',
    );
    assert.equal(
      report.comparisonReadiness?.reasons?.includes(
        'provider-sample-cpu-profile-instrumentation-is-enabled',
      ),
      true,
    );
  } else assert.equal(report.providerSampleCpuProfiles, undefined);
  if (expected.sceneFrameDiagnostics) {
    assert.deepEqual(report.sceneFrameDiagnostics, {
      status: 'completed',
      targetScenario: 'scripted-motion',
      targetRun: 1,
      eligibleForComparison: false,
    });
    assert.equal(report.sceneFrameDiagnostics?.status, 'completed');
    assert.equal(report.sceneFrameDiagnostics?.eligibleForComparison, false);
    assert.equal(
      report.comparisonReadiness?.reasons?.includes(
        'scene-frame-attribution-instrumentation-is-enabled',
      ),
      true,
    );
    const targets = report.captures?.filter(
      (sample) => sample.scenario === 'scripted-motion' && sample.run === 1,
    );
    assert.equal(targets?.length, 1);
    const target = targets[0];
    const evidence = target?.sceneFrameAttribution;
    assert.ok(
      evidence && typeof evidence === 'object' && !Array.isArray(evidence),
    );
    assert.ok(
      Object.keys(evidence).every((key) =>
        [
          'schema',
          'status',
          'scope',
          'eligibleForComparison',
          'observerOriginPerformanceNowMs',
          'measurementWindowRelativeMs',
          'observation',
          'cleanup',
          'stopReason',
          'error',
        ].includes(key),
      ),
    );
    assert.equal(evidence.schema, 'gev-scene-frame-attribution/v1');
    assert.equal(evidence?.status, 'completed');
    assert.equal(evidence?.cleanup, 'confirmed');
    assert.equal(evidence?.eligibleForComparison, false);
    assert.ok(Number.isFinite(evidence?.observerOriginPerformanceNowMs));
    assert.ok(
      Number.isFinite(evidence?.measurementWindowRelativeMs?.startMs) &&
        Number.isFinite(evidence?.measurementWindowRelativeMs?.timerFiredMs) &&
        evidence.measurementWindowRelativeMs.timerFiredMs >=
          evidence.measurementWindowRelativeMs.startMs &&
        evidence.measurementWindowRelativeMs.timerFiredMs <=
          evidence.observation?.elapsedMs,
    );
    assert.deepEqual(Object.keys(evidence.measurementWindowRelativeMs).sort(), [
      'startMs',
      'timerFiredMs',
    ]);
    const observation = evidence.observation;
    assert.ok(
      observation &&
        Number.isFinite(observation.elapsedMs) &&
        observation.elapsedMs >= 0 &&
        observation.elapsedMs <= 120_000,
    );
    assert.deepEqual(Object.keys(observation.spans || {}).sort(), [
      'render',
      'update',
    ]);
    assert.deepEqual(Object.keys(observation).sort(), [
      'cleanupComplete',
      'cleanupErrors',
      'counts',
      'elapsedMs',
      'entries',
      'observerErrors',
      'originPerformanceNowMs',
      'overflow',
      'sceneEventAvailability',
      'scope',
      'spans',
    ]);
    assert.ok(
      Number.isFinite(observation.originPerformanceNowMs) &&
        observation.originPerformanceNowMs ===
          evidence.observerOriginPerformanceNowMs,
    );
    assert.equal(observation.sceneEventAvailability?.update, true);
    assert.equal(observation.sceneEventAvailability?.render, true);
    assert.ok(
      Array.isArray(observation.cleanupErrors) &&
        observation.cleanupErrors.length === 0,
    );
    assert.equal(observation.cleanupComplete, true);
    assert.deepEqual(Object.keys(observation.counts || {}).sort(), [
      'render',
      'update',
    ]);
    assert.deepEqual(Object.keys(observation.overflow || {}).sort(), [
      'render',
      'update',
    ]);
    assert.deepEqual(Object.keys(observation.entries || {}).sort(), [
      'long-animation-frame',
      'longtask',
    ]);
    for (const kind of ['update', 'render']) {
      assert.ok(Array.isArray(observation.spans[kind]));
      assert.ok(observation.spans[kind].length <= 32);
      for (const span of observation.spans[kind]) {
        assert.deepEqual(Object.keys(span).sort(), ['durationMs', 'startMs']);
        assert.ok(Number.isFinite(span.startMs) && span.startMs >= 0);
        assert.ok(
          Number.isFinite(span.durationMs) &&
            span.durationMs >= 0 &&
            span.durationMs <= observation.elapsedMs,
        );
        assert.ok(span.startMs <= observation.elapsedMs);
      }
    }
    for (const kind of ['update', 'render']) {
      assert.ok(
        Number.isInteger(observation.counts?.[kind]) &&
          observation.counts[kind] >= observation.spans[kind].length &&
          observation.counts[kind] <= 1_000_000,
      );
      assert.equal(typeof observation.overflow?.[kind], 'boolean');
      if (observation.counts[kind] > 32)
        assert.equal(observation.overflow[kind], true);
    }
    assert.ok(Array.isArray(observation.observerErrors));
    assert.ok(observation.observerErrors.length <= 3);
    assert.ok(
      observation.observerErrors.every((type) =>
        ['longtask', 'long-animation-frame'].includes(type),
      ),
    );
    for (const key of ['longtask', 'long-animation-frame']) {
      const entries = observation.entries?.[key];
      assert.ok(
        entries === null || (Array.isArray(entries) && entries.length <= 32),
      );
      if (entries === null) continue;
      for (const entry of entries) {
        assert.deepEqual(
          Object.keys(entry).sort(),
          key === 'longtask'
            ? ['durationMs', 'startMs']
            : [
                'blockingDuration',
                'durationMs',
                'renderStart',
                'scripts',
                'startMs',
                'styleAndLayoutStart',
              ],
        );
        assert.ok(Number.isFinite(entry.startMs) && entry.startMs >= 0);
        assert.ok(
          Number.isFinite(entry.durationMs) &&
            entry.durationMs >= 0 &&
            entry.startMs + entry.durationMs <= observation.elapsedMs + 1,
        );
        if (key === 'long-animation-frame') {
          for (const metric of [
            'blockingDuration',
            'renderStart',
            'styleAndLayoutStart',
          ])
            assert.ok(
              entry[metric] === null ||
                (Number.isFinite(entry[metric]) && entry[metric] >= 0),
            );
          assert.ok(Array.isArray(entry.scripts) && entry.scripts.length <= 8);
          for (const script of entry.scripts) {
            assert.deepEqual(Object.keys(script).sort(), [
              'durationMs',
              'forcedStyleAndLayoutDurationMs',
              'invokerType',
            ]);
            assert.ok(
              script.durationMs === null ||
                (Number.isFinite(script.durationMs) &&
                  script.durationMs >= 0 &&
                  script.durationMs <= entry.durationMs),
            );
            assert.ok(
              [
                'classic-script',
                'module-script',
                'event-listener',
                'user-callback',
                'resolve-promise',
                'reject-promise',
                'unknown',
              ].includes(script.invokerType),
            );
            assert.ok(
              script.forcedStyleAndLayoutDurationMs === null ||
                (Number.isFinite(script.forcedStyleAndLayoutDurationMs) &&
                  script.forcedStyleAndLayoutDurationMs >= 0 &&
                  script.forcedStyleAndLayoutDurationMs <= entry.durationMs),
            );
          }
        }
      }
    }
    assert.equal(JSON.stringify(evidence).includes('sourceURL'), false);
  } else {
    assert.equal(report.sceneFrameDiagnostics, undefined);
  }
  assert.deepEqual(report.integrity, { status: 'passed', sampleCount: 6 });
  assert.equal(report.source?.appCommit, expected.appSha);
  assert.equal(report.source?.harnessCommit, expected.harnessSha);
  assert.equal(
    report.source?.provenanceStatus,
    'verified-local-build-and-served-assets-before-and-after',
  );
  assert.equal(
    report.source?.buildProvenance?.receiptSha256,
    expected.receiptSha256,
  );
  const pageAudit = report.source?.buildProvenance?.pageAssetAudit;
  assert.equal(pageAudit?.workerAuditMode, workerAuditMode);
  assert.ok(
    Number.isInteger(pageAudit?.scriptRequestCount) &&
      pageAudit.scriptRequestCount > 0,
  );
  assert.ok(pageAudit.loadedAssetPaths?.length > 0);
  assert.deepEqual(pageAudit.unexpectedAssetPaths, []);
  for (const workerAudit of pageAudit.cesiumWorkerBlobAudits || [])
    assert.equal(workerAudit.status, 'receipt-derived-worker-blobs-validated');
  assert.ok(pageAudit.cesiumWorkerBlobAudits?.length >= 6);
  assert.equal(report.workload?.warmupMs, 1000);
  assert.equal(report.workload?.durationPerSampleMs, 1000);
  assert.equal(report.workload?.runsPerScenario, 2);
  assert.equal(report.workload?.startupRuns, 1);
  assert.equal(report.environment?.startup?.runCount, 1);
  assert.equal(
    report.environment?.startup?.measurement,
    'cache-disabled fresh browser contexts',
  );
  assert.deepEqual(report.workload?.scenarios, [
    'idle',
    'scripted-motion',
    'selected-aircraft-tracking',
  ]);
  const diagnosticDocuments = report.performanceDiagnostics?.documents;
  const expectedDiagnosticCount =
    report.workload.startupRuns + 1 + report.captures.length;
  assert.ok(Array.isArray(diagnosticDocuments));
  assert.equal(diagnosticDocuments.length, expectedDiagnosticCount);
  const expectedRoles = [
    ...Array.from(
      { length: report.workload.startupRuns },
      (_, index) => `startup-${index + 1}`,
    ),
    'main-setup',
    ...Array.from(
      { length: report.captures.length },
      (_, index) => `provider-sample-${index + 1}`,
    ),
  ].sort();
  assert.deepEqual(
    diagnosticDocuments.map((entry) => entry.documentRole).sort(),
    expectedRoles,
  );
  const workerAuditDocuments = pageAudit.workerAuditDocuments;
  assert.ok(Array.isArray(workerAuditDocuments));
  assert.deepEqual(
    workerAuditDocuments.map((entry) => entry.documentRole).sort(),
    expectedRoles,
  );
  for (const entry of workerAuditDocuments) {
    const measuredProviderDocument =
      entry.documentRole.startsWith('provider-sample-');
    assert.equal(
      entry.mode,
      workerAuditMode === 'prewarm' && measuredProviderDocument
        ? 'prewarm'
        : 'diagnostic',
    );
    assert.equal(entry.restoration?.nativeCreateObjectURLRestored, true);
    assert.equal(entry.restoration?.registryEmpty, true);
    assert.equal(entry.restoration.overflowCountAtRestore, 0);
    assert.equal(
      entry.restoration.createdScriptBlobCountAtRestore,
      entry.restoration.auditedCreatedScriptBlobCount,
    );
    if (entry.validation === null) {
      assert.equal(entry.restoration.auditedCreatedScriptBlobCount, 0);
      assert.equal(entry.observedWorkerTargetCount, 0);
      assert.equal(entry.observedBlobRequestCount, 0);
      assert.equal(entry.restoration.createdScriptBlobCountAtRestore, 0);
    } else {
      assert.equal(
        entry.validation.status,
        'receipt-derived-worker-blobs-validated',
      );
    }
    if (workerAuditMode === 'prewarm' && measuredProviderDocument) {
      assert.equal(entry.validation.auditMode, 'prewarm');
      assert.equal(
        entry.lateUseCheck?.status,
        'observed-late-code-paths-within-prewarm-inventory',
      );
      assert.equal(entry.lateUseCheck?.unusedLateBlobCreationObservable, false);
    } else if (entry.validation) {
      assert.equal(entry.validation.auditMode, 'diagnostic');
    }
  }
  for (const entry of diagnosticDocuments) {
    assert.equal(entry.requested, true);
    if (expected.appSha === BASELINE_SHA) {
      assert.equal(entry.hookAvailable, false);
      assert.equal(entry.disabled, false);
    } else {
      assert.equal(entry.hookAvailable, true);
      assert.equal(entry.disabled, true);
    }
  }
  const observedComparisonContract = createObservedDenseComparisonContract({
    fixture: report.workload.fixture,
    fixtureDelivery: report.fixtureDelivery,
    environment: report.environment,
    captures: report.captures,
    scenarios: report.workload.scenarios,
  });
  assert.deepEqual(report.comparisonContract, observedComparisonContract);
  const observedReadinessReasons = getCaptureComparisonIneligibilityReasons({
    contract: observedComparisonContract,
    fixture: report.workload.fixture,
    fixtureDelivery: report.fixtureDelivery,
    source: report.source,
    environment: report.environment,
    workload: report.workload,
    captures: report.captures,
    diagnosticsDocuments: diagnosticDocuments,
    workerBlobAuditInstrumented: true,
    workerBlobAuditMode: workerAuditMode,
    hardwareRequired: false,
  });
  if (expected.sceneFrameDiagnostics)
    observedReadinessReasons.push(
      'scene-frame-attribution-instrumentation-is-enabled',
    );
  if (expected.firstMotionCpuProfile)
    observedReadinessReasons.push(
      'provider-sample-cpu-profile-instrumentation-is-enabled',
    );
  assert.equal(report.comparisonReadiness?.status, 'not-ready');
  assert.deepEqual(
    report.comparisonReadiness?.reasons,
    observedReadinessReasons,
  );
  assert.ok(
    observedReadinessReasons.includes(
      'latency-comparison-remains-disabled-pending-uninstrumented-capture',
    ),
  );
  assert.match(report.environment?.renderer || '', /swiftshader/i);
  assert.equal(report.environment?.hardwareEligible, false);
  assert.equal(report.captures?.length, 6);
  assert.equal(report.fixtureDelivery?.status, 'observed');
  assert.equal(report.fixtureDelivery?.fixtureSha256, expected.fixtureSha256);
  assert.equal(report.fixtureDelivery?.observedFlightsCount, 2500);
  assert.ok(report.fixtureDelivery.fulfilledResponseCount >= 1);
  for (const scenario of report.workload.scenarios) {
    const samples = report.captures.filter(
      (sample) => sample.scenario === scenario,
    );
    assert.equal(samples.length, 2, `Expected two ${scenario} captures.`);
    assert.deepEqual(samples.map((sample) => sample.run).sort(), [1, 2]);
    for (const sample of samples) {
      assert.equal(sample.fixtureClock?.freshBrowserContext, true);
      assert.equal(sample.fixtureClock?.start?.startCount, 1);
      assert.equal(sample.fixtureClock?.sourceFreshness, 'current');
      assert.ok(sample.fixtureClock?.actualWarmupElapsedMs >= 1000);
      assert.ok(sample.fixtureClock?.measuredWindowElapsedMs >= 1000);
      assert.ok(sample.fixtureClock?.ageAtMeasurementStartMs >= 0);
      assert.ok(sample.fixtureClock?.ageAtEndMs <= 120_000);
      assert.equal(sample.fixtureDelivery?.status, 'observed');
      assert.equal(
        sample.fixtureDelivery?.fixtureSha256,
        expected.fixtureSha256,
      );
      assert.equal(sample.fixtureDelivery?.observedFlightsCount, 2500);
      assert.ok(sample.fixtureDelivery?.fulfilledResponseCount >= 1);
      const population = Object.fromEntries(
        (sample.layers || [])
          .filter((layer) =>
            ['flights', 'local-datacenters', 'local-dams'].includes(layer.id),
          )
          .map((layer) => [
            layer.id,
            { enabled: layer.enabled, count: layer.count },
          ]),
      );
      assert.deepEqual(population, {
        flights: { enabled: true, count: 2500 },
        'local-datacenters': { enabled: true, count: 4362 },
        'local-dams': { enabled: true, count: 716 },
      });
      assert.equal(sample.conditions?.before?.visible, true);
      assert.equal(sample.conditions?.before?.focused, true);
      assert.equal(sample.conditions?.after?.visible, true);
      assert.equal(sample.conditions?.after?.focused, true);
      assert.equal(sample.foregroundThroughout, true);
      assertCaptureFrameAndSettingsEvidence(sample, scenario);
      if (scenario === 'selected-aircraft-tracking')
        assert.equal(sample.trackedAircraftId, 'flights:000001');
    }
  }
  return {
    schema: report.schema,
    status: 'passed',
    comparisonEligible: false,
    renderer: report.environment.renderer,
    fixtureSha256: report.fixtureDelivery.fixtureSha256,
    captureCount: report.captures.length,
    scenarios: report.workload.scenarios,
    captures: report.captures.map((sample) => ({
      scenario: sample.scenario,
      run: sample.run,
      fixtureDelivery: sample.fixtureDelivery,
      fixtureClock: sample.fixtureClock,
      layers: sample.layers,
      conditions: sample.conditions,
    })),
    rawReport: report,
    limitations: [
      'Hosted software-rendering CLI integration only; not hardware or paired performance evidence.',
      'The static production flight fixture verifies source delivery and populations, not a complete moving trajectory contract.',
    ],
  };
}

function validateInfrastructureCaptureCliReport(report, expected) {
  assert.equal(report?.schema, 'gev-performance-capture/v1');
  assert.equal(expected.workerAuditMode || 'diagnostic', 'diagnostic');
  assert.equal(report.workerAuditMode, 'diagnostic');
  assert.equal(report.comparisonEligible, false);
  assert.deepEqual(report.integrity, { status: 'passed', sampleCount: 4 });
  assert.equal(report.source?.appCommit, expected.appSha);
  assert.equal(report.source?.harnessCommit, expected.harnessSha);
  assert.equal(
    report.source?.provenanceStatus,
    'verified-local-build-and-served-assets-before-and-after',
  );
  assert.equal(
    report.source?.buildProvenance?.receiptSha256,
    expected.receiptSha256,
  );
  const pageAudit = report.source?.buildProvenance?.pageAssetAudit;
  assert.equal(pageAudit?.workerAuditMode, 'diagnostic');
  assert.ok(
    Number.isInteger(pageAudit?.scriptRequestCount) &&
      pageAudit.scriptRequestCount > 0,
  );
  assert.ok(pageAudit.loadedAssetPaths?.length > 0);
  assert.deepEqual(pageAudit.unexpectedAssetPaths, []);
  const blobAudits = pageAudit.cesiumWorkerBlobAudits;
  assert.ok(Array.isArray(blobAudits));
  for (const audit of blobAudits)
    assert.equal(audit.status, 'receipt-derived-worker-blobs-validated');

  const fixture = createInfrastructureWorkloadFixture(
    expected.providerFixture,
    expected.fixedTime,
  );
  assert.equal(report.workload?.providerFixture, expected.providerFixture);
  assert.equal(report.workload?.fixtureId, fixture.id);
  assert.equal(
    report.workload?.infrastructureFixtureLifecycle
      ?.freshBrowserContextPerSample,
    false,
  );
  assert.equal(report.workload?.warmupMs, 1000);
  assert.equal(report.workload?.durationPerSampleMs, 1000);
  assert.equal(report.workload?.runsPerScenario, 2);
  assert.equal(report.workload?.startupRuns, 1);
  assert.deepEqual(report.workload?.scenarios, ['idle', 'scripted-motion']);
  assert.equal(report.environment?.startup?.runCount, 1);
  assert.equal(
    report.environment?.startup?.measurement,
    'one measured app document; cache disabled before navigation',
  );
  const observedContract = createObservedInfrastructureComparisonContract({
    fixture: report.workload.fixture,
    fixtureDelivery: report.fixtureDelivery,
    environment: report.environment,
    captures: report.captures,
    scenarios: report.workload.scenarios,
  });
  assert.deepEqual(report.workload.fixture, fixture);
  assert.deepEqual(report.comparisonContract, observedContract);
  const diagnostics = report.performanceDiagnostics?.documents;
  assert.ok(Array.isArray(diagnostics));
  const topology = createCaptureDocumentTopology({
    infrastructure: true,
    startupRuns: report.workload.startupRuns,
    captureCount: report.captures.length,
  });
  assert.equal(diagnostics.length, topology.diagnostics.length);
  assert.deepEqual(
    diagnostics.map(({ documentRole, documentId }) => ({
      documentRole,
      documentId,
    })),
    topology.diagnostics,
  );
  for (const entry of diagnostics) {
    assert.equal(entry.requested, true);
    assert.equal(entry.disabled, true);
  }
  const workerDocuments = pageAudit.workerAuditDocuments;
  assert.ok(Array.isArray(workerDocuments));
  assert.deepEqual(
    workerDocuments.map(({ documentRole, documentId }) => ({
      documentRole,
      documentId,
    })),
    topology.workerAudits,
  );
  for (const entry of workerDocuments) {
    assert.equal(entry.mode, 'diagnostic');
    assert.equal(entry.restoration?.nativeCreateObjectURLRestored, true);
    assert.equal(entry.restoration?.registryEmpty, true);
    assert.equal(entry.restoration?.overflowCountAtRestore, 0);
    assert.equal(
      entry.restoration?.createdScriptBlobCountAtRestore,
      entry.restoration?.auditedCreatedScriptBlobCount,
    );
    if (entry.validation === null) {
      assert.equal(entry.observedWorkerTargetCount, 0);
      assert.equal(entry.observedBlobRequestCount, 0);
      assert.equal(entry.restoration?.createdScriptBlobCountAtRestore, 0);
    } else {
      assert.equal(entry.validation?.schema, 'gev-cesium-worker-blob-audit/v1');
      assert.equal(
        entry.validation?.status,
        'receipt-derived-worker-blobs-validated',
      );
      assert.equal(entry.validation?.auditMode, 'diagnostic');
      assert.match(
        entry.validation?.embeddedWorkerSourceSha256 || '',
        /^[a-f0-9]{64}$/,
      );
    }
  }
  const auditsByRole = new Map(
    workerDocuments.map((entry) => [entry.documentRole, entry]),
  );
  assert.equal(
    auditsByRole.get('main-measured')?.validation?.status,
    'receipt-derived-worker-blobs-validated',
    'Missing receipt-derived worker audit for main-measured',
  );
  const startupDiagnostic = diagnostics.find(
    (entry) => entry.documentRole === 'startup-1',
  );
  const mainDiagnostic = diagnostics.find(
    (entry) => entry.documentRole === 'main-setup',
  );
  const startupAudit = auditsByRole.get('startup-1');
  const mainAudit = auditsByRole.get('main-measured');
  assert.ok(startupDiagnostic?.documentId);
  assert.ok(mainDiagnostic?.documentId);
  assert.notEqual(startupDiagnostic.documentId, mainDiagnostic.documentId);
  assert.equal(startupAudit.documentId, startupDiagnostic.documentId);
  assert.equal(mainAudit.documentId, mainDiagnostic.documentId);
  assert.deepEqual(
    report.captures.map(({ documentRole, documentId }) => ({
      documentRole,
      documentId,
    })),
    topology.samples,
  );
  assert.equal(mainDiagnostic.documentId, topology.samples[0]?.documentId);
  const validatedDocumentCount = workerDocuments.filter(
    (entry) =>
      entry.validation?.status === 'receipt-derived-worker-blobs-validated',
  ).length;
  assert.equal(
    blobAudits.length,
    validatedDocumentCount,
    'Worker blob observations must correspond one-to-one with validated document audits',
  );
  assert.deepEqual(
    blobAudits,
    workerDocuments
      .filter(
        (entry) =>
          entry.validation?.status === 'receipt-derived-worker-blobs-validated',
      )
      .map((entry) => entry.validation),
    'Worker blob observations must preserve each document validation in order',
  );
  const workerSourceHashes = new Set(
    workerDocuments
      .filter((entry) => entry.validation)
      .map((entry) => entry.validation.embeddedWorkerSourceSha256),
  );
  assert.equal(workerSourceHashes.size, 1);
  for (const audit of blobAudits) {
    assert.equal(audit?.schema, 'gev-cesium-worker-blob-audit/v1');
    assert.equal(audit?.auditMode, 'diagnostic');
    assert.ok(workerSourceHashes.has(audit?.embeddedWorkerSourceSha256));
  }
  const readinessReasons = getCaptureComparisonIneligibilityReasons({
    contract: observedContract,
    fixture,
    fixtureDelivery: report.fixtureDelivery,
    source: report.source,
    environment: report.environment,
    workload: report.workload,
    captures: report.captures,
    diagnosticsDocuments: diagnostics,
    workerBlobAuditInstrumented: true,
    workerBlobAuditMode: 'diagnostic',
    hardwareRequired: false,
  });
  assert.equal(report.comparisonReadiness?.status, 'not-ready');
  assert.deepEqual(report.comparisonReadiness?.reasons, readinessReasons);
  assert.ok(
    readinessReasons.includes(
      'latency-comparison-remains-disabled-pending-uninstrumented-capture',
    ),
  );
  assert.match(report.environment?.renderer || '', /swiftshader/i);
  assert.equal(report.environment?.hardwareEligible, false);
  assert.equal(report.captures?.length, 4);
  for (const scenario of report.workload.scenarios) {
    const samples = report.captures.filter(
      (sample) => sample.scenario === scenario,
    );
    assert.equal(samples.length, 2);
    assert.deepEqual(samples.map((sample) => sample.run).sort(), [1, 2]);
    for (const sample of samples) {
      const expectedLayers = Object.entries(fixture.expectedLayerCounts)
        .map(([id, count]) => ({ id, enabled: true, count }))
        .sort((left, right) => left.id.localeCompare(right.id));
      const observedLayers = (sample.layers || [])
        .filter((layer) => Object.hasOwn(fixture.expectedLayerCounts, layer.id))
        .map(({ id, enabled, count }) => ({ id, enabled, count }))
        .sort((left, right) => left.id.localeCompare(right.id));
      assert.deepEqual(observedLayers, expectedLayers);
      assert.equal(sample.fixtureDelivery?.fixtureSha256, fixture.sha256);
      assert.equal(sample.settings?.before?.qualityMode, 'manual');
      assert.deepEqual(sample.settings?.before, sample.settings?.after);
      assert.equal(sample.conditions?.before?.visible, true);
      assert.equal(sample.conditions?.after?.visible, true);
      assert.equal(sample.conditions?.before?.focused, true);
      assert.equal(sample.conditions?.after?.focused, true);
      assert.equal(sample.foregroundThroughout, true);
      assert.ok(sample.cameraPath?.id);
      assertCaptureFrameAndSettingsEvidence(sample, scenario);
    }
  }
  return {
    schema: report.schema,
    status: 'passed',
    comparisonEligible: false,
    providerFixture: expected.providerFixture,
    fixtureSha256: fixture.sha256,
    renderer: report.environment.renderer,
    captureCount: report.captures.length,
    scenarios: report.workload.scenarios,
    rawReport: report,
    limitations: [
      'Hosted software-rendering infrastructure capture only; not hardware or paired performance evidence.',
      'Infrastructure capture is diagnostic and does not establish baseline/candidate visual parity.',
    ],
  };
}

export function compactCaptureCliFailure(report) {
  if (!report || typeof report !== 'object') return null;
  let preservedRawReport;
  let rawReportTruncated = false;
  let rawReportUnavailable = 'CLI report was not a recognized capture schema.';
  try {
    if (
      report.schema === 'gev-performance-capture-failure/v1' &&
      report.status === 'failed'
    ) {
      const serialized = `${JSON.stringify(report, null, 2)}\n`;
      if (
        Buffer.byteLength(serialized, 'utf8') <=
        MAX_CAPTURE_FAILURE_REPORT_BYTES
      )
        preservedRawReport = report;
      else
        rawReportUnavailable =
          'Failure report exceeded the bounded artifact limit.';
    } else if (report.schema === 'gev-performance-capture/v1') {
      const bounded = boundCaptureReportEvidence(report);
      const serialized = `${JSON.stringify(bounded.value, null, 2)}\n`;
      if (
        bounded.value?.schema === 'gev-performance-capture/v1' &&
        Buffer.byteLength(serialized, 'utf8') <=
          MAX_CAPTURE_FAILURE_REPORT_BYTES
      ) {
        preservedRawReport = bounded.value;
        rawReportTruncated = bounded.truncated;
      } else
        rawReportUnavailable =
          'Completed report exceeded the bounded artifact limit.';
    } else if (report.schema === 'gev-performance-capture-failure/v1') {
      rawReportUnavailable = 'Failure report was not marked failed.';
    }
  } catch {
    rawReportUnavailable = 'CLI report could not be safely bounded.';
  }
  return {
    schema: 'gev-smoke-capture-cli-failure/v1',
    summary: {
      reportSchema: report.schema || null,
      status: report.status || null,
      failure: report.failure
        ? {
            message: sanitizeError(report.failure.message || 'Capture failed.'),
            phase: report.failure.phase || null,
            scenario: report.failure.scenario || null,
            run: Number.isInteger(report.failure.run)
              ? report.failure.run
              : null,
            operator: report.failure.operator || null,
            actual: report.failure.actual ?? null,
            expected: report.failure.expected ?? null,
          }
        : null,
      source: {
        appCommit: report.source?.appCommit || null,
        harnessCommit: report.source?.harnessCommit || null,
        provenanceStatus: report.source?.provenanceStatus || null,
      },
      fixtureDelivery: report.fixtureDelivery
        ? {
            status: report.fixtureDelivery.status,
            fixtureSha256: report.fixtureDelivery.fixtureSha256,
            observedFlightsCount: report.fixtureDelivery.observedFlightsCount,
            fulfilledResponseCount:
              report.fixtureDelivery.fulfilledResponseCount,
          }
        : null,
      fixtureInterceptionErrors: Array.isArray(report.fixtureInterceptionErrors)
        ? report.fixtureInterceptionErrors.slice(0, 8).map((entry) => ({
            message: sanitizeError(entry?.message || 'Interception failed.'),
            phase: entry?.phase || null,
            documentRole: entry?.documentRole || null,
            documentId: entry?.documentId || null,
            sessionOrdinal: Number.isSafeInteger(entry?.sessionOrdinal)
              ? entry.sessionOrdinal
              : null,
            lifecycleStage: entry?.lifecycleStage || null,
          }))
        : [],
      completedSampleCount:
        report.progress?.completedSampleCount ?? report.captures?.length ?? 0,
      completedSamplesRetained:
        report.progress?.completedSamplesRetained ??
        report.progress?.completedSamples?.length ??
        report.captures?.length ??
        0,
      evidenceTruncated: report.evidenceTruncated ?? null,
    },
    ...(preservedRawReport
      ? { rawReport: preservedRawReport, rawReportTruncated }
      : { rawReportUnavailable }),
  };
}

function git(args) {
  return execFileSync('git', ['-C', ROOT, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
    windowsHide: true,
    timeout: 15_000,
    maxBuffer: 64 * 1024,
  }).trim();
}

function sanitizeError(error) {
  return String(error?.message || error)
    .replace(/https?:\/\/[^\s"'<>]+/gi, '[url]')
    .replace(/(?:[A-Za-z]:\\|\/)(?:[^\s"'<>]+[\\/])*[^\s"'<>]*/g, '[path]')
    .replace(/[\r\n\t]+/g, ' ')
    .slice(0, 400);
}

function withTimeout(operation, timeoutMs, label) {
  let timer;
  return Promise.race([
    operation,
    new Promise((_, reject) => {
      timer = setTimeout(
        () => reject(new Error(`${label} timed out.`)),
        timeoutMs,
      );
    }),
  ]).finally(() => clearTimeout(timer));
}

function assertSha(value, label) {
  if (typeof value !== 'string' || !SHA1.test(value))
    throw new TypeError(`${label} must be a full lowercase Git SHA.`);
}

function assertInside(parent, child) {
  const relative = path.relative(parent, child);
  return (
    relative === '' ||
    (relative !== '..' &&
      !relative.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relative))
  );
}

async function createOwnedTempRoot() {
  const parent = await realpath(process.env.RUNNER_TEMP || os.tmpdir());
  const created = await mkdtemp(
    path.join(parent, 'gev-performance-build-smoke-'),
  );
  const canonical = await realpath(created);
  if (
    !assertInside(parent, canonical) ||
    path.dirname(canonical) !== parent ||
    !path.basename(canonical).startsWith('gev-performance-build-smoke-')
  )
    throw new Error('Generated smoke directory escaped its task-owned root.');
  return { parent, root: canonical };
}

async function writeReport(report, outputPath) {
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`);
}

async function addWorktree(tempRoot, label, commit) {
  const checkout = path.join(tempRoot, `source-${label}`);
  execFileSync(
    'git',
    ['-C', ROOT, 'worktree', 'add', '--detach', checkout, commit],
    {
      encoding: 'utf8',
      stdio: ['ignore', 'ignore', 'ignore'],
      windowsHide: true,
      timeout: 30_000,
    },
  );
  const canonical = await realpath(checkout);
  if (!assertInside(tempRoot, canonical) || canonical === tempRoot)
    throw new Error('Generated source worktree escaped its task-owned root.');
  return canonical;
}

function startStaticServer(root) {
  const server = createServer(async (request, response) => {
    try {
      if (!['GET', 'HEAD'].includes(request.method || '')) {
        response.writeHead(405).end();
        return;
      }
      const parsed = new URL(request.url || '/', 'http://127.0.0.1');
      let pathname;
      try {
        pathname = decodeURIComponent(parsed.pathname);
      } catch {
        response.writeHead(400).end();
        return;
      }
      const relative = pathname === '/' ? 'index.html' : pathname.slice(1);
      if (
        !relative ||
        relative.includes('\\') ||
        relative
          .split('/')
          .some((part) => !part || part === '.' || part === '..')
      ) {
        response.writeHead(400).end();
        return;
      }
      const absolute = path.resolve(root, ...relative.split('/'));
      if (!assertInside(root, absolute)) {
        response.writeHead(403).end();
        return;
      }
      const info = await stat(absolute);
      if (!info.isFile()) {
        response.writeHead(404).end();
        return;
      }
      response.writeHead(200, {
        'cache-control': 'no-store',
        'content-length': info.size,
        'content-type':
          MIME_TYPES[path.extname(absolute)] || 'application/octet-stream',
        'x-content-type-options': 'nosniff',
      });
      if (request.method === 'HEAD') response.end();
      else createReadStream(absolute).pipe(response);
    } catch {
      response.writeHead(404).end();
    }
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      const address = server.address();
      resolve({ server, baseUrl: `http://127.0.0.1:${address.port}/` });
    });
  });
}

async function closeServer(server) {
  if (!server?.listening) return;
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      server.closeAllConnections();
      reject(
        new Error('Static server did not close within its cleanup bound.'),
      );
    }, 5000);
    timer.unref();
    server.close((error) => {
      clearTimeout(timer);
      if (error) reject(error);
      else resolve();
    });
  });
}

function simplifyObservation(observed) {
  return {
    environment: {
      appCommit: observed.environment.appCommit,
      renderer: observed.environment.renderer,
      vendor: observed.environment.vendor,
      viewport: observed.environment.viewport,
      drawingBuffer: observed.environment.drawingBuffer,
      layers: observed.environment.layers,
      totalObjects: observed.environment.totalObjects,
      focused: observed.environment.focused,
      visible: observed.environment.visible,
    },
    settings: {
      qualityMode: observed.settings.qualityMode,
      densityPct: observed.settings.densityPct,
      detectionMode: observed.settings.detectionMode,
      resolutionScale: observed.settings.resolutionScale,
      antialias: observed.settings.antialias,
      msaaSamples: observed.settings.msaaSamples,
      fxaa: observed.settings.fxaa,
      bloom: observed.settings.bloom,
      bloomIntensity: observed.settings.bloomIntensity,
      sharpen: observed.settings.sharpen,
      sharpenIntensity: observed.settings.sharpenIntensity,
    },
    camera: observed.camera,
  };
}

async function runCandidateCaptureCli({
  build,
  checkout,
  commit,
  harnessCommit,
  served,
  tempRoot,
  fixture,
  providerFixture,
  workerAuditMode,
  sceneFrameDiagnostics = false,
  firstMotionCpuProfile = false,
  profileArtifactDirectory = null,
  startedAt,
  budgetMs,
}) {
  const remainingMs = budgetMs - (Date.now() - startedAt);
  if (remainingMs < CAPTURE_CLI_TIMEOUT_MS + 15_000)
    throw new Error(
      'Insufficient outer smoke budget for capture CLI integration.',
    );
  const receiptPath = path.join(tempRoot, 'capture-cli-build-receipt.json');
  const reportPath = path.join(tempRoot, 'capture-cli-report.json');
  const browserPidPath = path.join(tempRoot, 'capture-cli-browser.pid');
  await writeFile(receiptPath, `${JSON.stringify(build.receipt)}\n`, 'utf8');
  const scriptPath = path.join(
    ROOT,
    'scripts',
    'capture-scene-performance.mjs',
  );
  const args = [
    scriptPath,
    '--url',
    served.baseUrl,
    '--provider-fixture',
    providerFixture,
    '--provider-fixture-time',
    fixture.fixedTime,
    '--worker-audit-mode',
    workerAuditMode,
    '--quality-mode',
    'manual',
    '--detection-mode',
    'DENSE',
    '--expected-density',
    '75',
    '--runs',
    '2',
    '--startup-runs',
    '1',
    '--warmup-ms',
    '1000',
    '--seconds',
    '1',
    '--fixture-timeout-ms',
    '60000',
    '--protocol-timeout-ms',
    '120000',
    '--headless',
    '--software-rendering',
    '--hosted-fixture',
    '--owned-browser-pid-file',
    browserPidPath,
    '--build-receipt',
    receiptPath,
    '--app-checkout',
    checkout,
    '--harness-checkout',
    ROOT,
    '--build-root',
    build.buildRoot,
    '--expected-app-sha',
    commit,
    '--expected-harness-sha',
    harnessCommit,
    '--served-base-url',
    served.baseUrl,
    '--out',
    reportPath,
  ];
  if (providerFixture === 'dense-investigation') args.push('--mixed-layers');
  if (sceneFrameDiagnostics) args.push('--scene-frame-diagnostics');
  if (firstMotionCpuProfile) {
    if (typeof profileArtifactDirectory !== 'string')
      throw new TypeError('CPU profile artifact directory is required.');
    args.push(
      '--first-motion-cpu-profile',
      '--cpu-profile-artifact-directory',
      profileArtifactDirectory,
    );
  }
  let captureReport = null;
  try {
    await runBoundedChild(process.execPath, args, {
      timeoutMs: Math.min(CAPTURE_CLI_TIMEOUT_MS, remainingMs - 15_000),
      maxOutputBytes: 64 * 1024,
      ownedPidFile: browserPidPath,
    });
    captureReport = JSON.parse(await readFile(reportPath, 'utf8'));
    const validated = validateCaptureCliReport(captureReport, {
      appSha: commit,
      harnessSha: harnessCommit,
      receiptSha256: build.receipt.receiptSha256,
      fixtureSha256: fixture.sha256,
      providerFixture,
      fixedTime: fixture.fixedTime,
      workerAuditMode,
      sceneFrameDiagnostics,
      firstMotionCpuProfile,
    });
    if (firstMotionCpuProfile) {
      const evidence = captureReport.providerSampleCpuProfiles;
      for (
        let indexPosition = 0;
        indexPosition < evidence.profiles.length;
        indexPosition += 1
      ) {
        const window = evidence.profiles[indexPosition];
        const target = PROVIDER_CPU_PROFILE_TARGETS[indexPosition];
        const key = providerCpuProfileKey(target);
        const indexPath = path.join(
          profileArtifactDirectory,
          `${key}-cpu-profile-ref.json`,
        );
        const index = JSON.parse(await readFile(indexPath, 'utf8'));
        assert.equal(index?.schema, 'gev-provider-sample-cpu-profile-index/v1');
        assert.equal(index?.performanceAcceptanceEligible, false);
        assert.deepEqual(index.target, {
          scenario: target.scenario,
          run: target.run,
          captureOrdinal: window.captureOrdinal,
          documentRole: window.documentRole,
          documentId: window.documentId,
        });
        assert.deepEqual(index.profile, window.profile);
        const profileBytes = await readFile(
          path.join(profileArtifactDirectory, index.profile.fileName),
        );
        assert.ok(profileBytes.byteLength <= 8 * 1024 * 1024);
        assert.equal(profileBytes.byteLength, index.profile.byteLength);
        assert.equal(
          createHash('sha256').update(profileBytes).digest('hex'),
          index.profile.sha256,
        );
      }
    }
    return validated;
  } catch (error) {
    if (!captureReport) {
      try {
        captureReport = JSON.parse(await readFile(reportPath, 'utf8'));
      } catch {
        // Preserve the bounded process error when no report was written.
      }
    }
    const captureCliFailure = compactCaptureCliFailure(captureReport) || {
      diagnostics: error.childDiagnostics || null,
    };
    if (firstMotionCpuProfile) {
      const directory = profileArtifactDirectory || `${reportPath}.cpu-profile`;
      captureCliFailure.cpuProfileArtifacts =
        await readProviderCpuProfileIndexSet(directory);
    }
    error.captureCliFailure = captureCliFailure;
    throw error;
  }
}

async function runRevision({
  browser,
  checkout,
  commit,
  label,
  harnessCommit,
  tempRoot,
  startedAt,
  budgetMs,
  workerAuditMode,
  providerFixture,
  sceneFrameDiagnostics = false,
  firstMotionCpuProfile = false,
  profileArtifactDirectory = null,
  infrastructureCaptureFixture,
}) {
  const buildRootPath = path.join(tempRoot, `build-${label}`);
  let build;
  let workerContract;
  try {
    build = await createLocalBuildReceipt({
      checkoutRoot: checkout,
      harnessRoot: ROOT,
      buildOutDir: buildRootPath,
      expectedAppCommit: commit,
      expectedHarnessCommit: harnessCommit,
      commandTimeoutMs: BUILD_COMMAND_TIMEOUT_MS,
    });
    const bundlePath = 'cesium/Cesium.js';
    const bundleAsset = build.receipt.assets.find(
      (asset) => asset.path === bundlePath,
    );
    if (!bundleAsset)
      throw new Error('Build receipt is missing the Cesium bundle.');
    const bundleBytes = await readFile(
      path.join(build.buildRoot, ...bundlePath.split('/')),
    );
    workerContract = deriveCesiumEmbeddedWorkerContract({
      bundlePath,
      bundleBytes,
      assets: build.receipt.assets,
    });
  } catch (error) {
    error.smokeDiagnostics = {
      phase: 'clean-source-build',
      pageErrors: [],
      interceptionErrors: [],
    };
    throw error;
  }
  let served;
  try {
    served = await startStaticServer(build.buildRoot);
  } catch (error) {
    error.smokeDiagnostics = {
      phase: 'start-static-server',
      pageErrors: [],
      interceptionErrors: [],
    };
    throw error;
  }
  let context = null;
  let page = null;
  let earlyRendererProbeScriptIdentifier = null;
  let provenance = null;
  let fixturePage = null;
  let workerBlobValidation = null;
  let workerBlobDiagnostics = null;
  let densePopulationObservations = [];
  let finalDenseLayerPopulation = null;
  let phase = 'browser-page-setup';
  const pageErrors = [];
  const cleanupErrors = [];
  const rendererProbeCleanup = [];
  let rendererProbeCleanupOmittedCount = 0;
  const recordRendererProbeCleanup = (evidence) => {
    if (rendererProbeCleanup.length >= 4) {
      rendererProbeCleanup.shift();
      rendererProbeCleanupOmittedCount += 1;
    }
    rendererProbeCleanup.push(evidence);
    return evidence;
  };
  let failure = null;
  let result = null;
  try {
    const captureUrl = served.baseUrl;
    phase = 'verify-served-assets-before';
    provenance = await beginCaptureBuildProvenance({
      receipt: build.receipt,
      checkoutRoot: checkout,
      harnessRoot: ROOT,
      actualHarnessRoot: ROOT,
      buildRoot: build.buildRoot,
      expectedAppCommit: commit,
      expectedHarnessCommit: harnessCommit,
      baseUrl: served.baseUrl,
      captureUrl,
    });
    phase = 'budget-check-before-browser';
    if (Date.now() - startedAt > budgetMs)
      throw new Error('Smoke time budget expired before browser load.');

    context = await browser.createBrowserContext();
    page = await context.newPage();
    await page.setViewport({ width: 1280, height: 900, deviceScaleFactor: 1 });
    await page.setCacheEnabled(false);
    await page.setBypassServiceWorker(true);
    page.setDefaultTimeout(30_000);
    page.setDefaultNavigationTimeout(45_000);
    const preflightPhase = { active: true };
    const requestAudit = createApplicationCodeRequestAudit();
    const workerTargetUrls = new Set();
    let workerTargetOverflowCount = 0;
    const rememberWorkerTarget = (workerUrl) => {
      if (!workerUrl.startsWith('blob:') || workerTargetUrls.has(workerUrl))
        return;
      if (workerTargetUrls.size >= MAX_WORKER_TARGETS)
        workerTargetOverflowCount += 1;
      else workerTargetUrls.add(workerUrl);
    };
    page.on('request', (request) => {
      requestAudit.observeRequest(request.url(), request.resourceType());
    });
    page.on('workercreated', (worker) => {
      if (!preflightPhase.active) requestAudit.observeWorker(worker.url());
      rememberWorkerTarget(worker.url());
    });
    page.on('pageerror', (error) => {
      if (pageErrors.length < 8) pageErrors.push(sanitizeError(error));
    });
    phase = 'worker-aware-provider-interception';
    const flightFixture = createProductionFlightFixture();
    const flightFixtureDelivery = createFlightFixtureDeliveryObserver(
      flightFixture,
      served.baseUrl,
    );
    fixturePage = await prepareFixturePage(browser, served.baseUrl, {
      page,
      viewport: { width: 1280, height: 900 },
      respond: (url, request) =>
        respondToWorkerPreflight(url, served.baseUrl) ??
        respondToProductionFlightFixture(
          url,
          request,
          flightFixture,
          served.baseUrl,
        ),
      onFulfilled: flightFixtureDelivery.onFulfilled,
    });
    const workerNetworkPreflight = await runSameOriginWorkerPreflight({
      page,
      baseUrl: served.baseUrl,
      verifyNetwork: fixturePage.verifyNetwork,
      resetRequestAudit: () => {
        const snapshot = requestAudit.snapshot();
        const discardedAudit = {
          requestCount: snapshot.requestCount,
          codeRequestCount: snapshot.requests.length,
        };
        return discardedAudit;
      },
    });
    phase = 'preflight-worker-target-disposal';
    const preflightTargetDisposal = await waitForPreflightWorkerTargetsClosed({
      getTargets: () =>
        browser.targets().map((target) => ({
          type: target.type(),
          url: target.url(),
        })),
      // The preflight is the only worker-producing action before app navigation.
      // Require every such target to disappear; don't whitelist its blob URL.
      workerUrls: null,
    });
    workerNetworkPreflight.discardedAudit = {
      requestCount: workerNetworkPreflight.discardedAudit?.requestCount ?? 0,
      codeRequestCount:
        workerNetworkPreflight.discardedAudit?.codeRequestCount ?? 0,
    };
    workerNetworkPreflight.targetDisposal = preflightTargetDisposal;
    if (!preflightTargetDisposal.closed)
      throw new Error(
        `Harness preflight worker target remained after termination (${preflightTargetDisposal.remainingCount}).`,
      );
    preflightPhase.active = false;
    workerTargetUrls.clear();
    workerTargetOverflowCount = 0;
    // Ignore preflight-phase events and begin app collection after its settle
    // window, so harness-only requests cannot enter the app code audit.
    requestAudit.begin();
    await page.evaluateOnNewDocument(installCesiumWorkerBlobAudit);
    await page.evaluateOnNewDocument(
      installHeldMonotonicWallClock,
      flightFixture.fixedTimeMs,
    );
    earlyRendererProbeScriptIdentifier =
      await installEarlyCesiumRendererProbe(page);
    phase = 'application-navigation';
    const response = await page.goto(captureUrl, {
      waitUntil: 'domcontentloaded',
      timeout: 45_000,
    });
    const registrationRemoval =
      await removeEarlyCesiumRendererProbeRegistrationWithEvidence(
        page,
        earlyRendererProbeScriptIdentifier,
      );
    registrationRemoval.phase = 'application-navigation';
    recordRendererProbeCleanup(registrationRemoval);
    if (!registrationRemoval.confirmed)
      throw new Error(
        'Early Cesium renderer future-document registration removal was not confirmed.',
      );
    if (response && response.status() >= 400)
      throw new Error(
        `Application entry returned status ${response.status()}.`,
      );
    const finalUrl = new URL(page.url());
    const base = new URL(served.baseUrl);
    if (finalUrl.origin !== base.origin || finalUrl.pathname !== base.pathname)
      throw new Error('Application navigation left the verified entry point.');
    phase = 'application-readiness';
    await page.waitForFunction(() => Boolean(window.__godsEyeView?.viewer), {
      timeout: 60_000,
      polling: 100,
    });
    await page.waitForFunction(
      () => Boolean(window.__godsEyeView?.styleManager?.getVisualState),
      { timeout: 30_000, polling: 100 },
    );
    if (pageErrors.length)
      throw new Error(`Application emitted ${pageErrors.length} page errors.`);
    const serviceWorkerState = await page.evaluate(() => ({
      controlled: Boolean(navigator.serviceWorker?.controller),
    }));
    if (fixturePage.errors.length)
      throw new Error(
        `Fixture interception reported ${fixturePage.errors.length} errors.`,
      );
    if (serviceWorkerState.controlled)
      throw new Error(
        'Application unexpectedly has a controlling service worker.',
      );

    phase = 'production-provider-fixture-population';
    const expectedLayerCounts = {
      flights: flightFixture.count,
      'local-datacenters': 4362,
      'local-dams': 716,
    };
    await page.evaluate(async (layerIds) => {
      const manager = window.__godsEyeView?.dataManager;
      if (!manager) throw new Error('Application data manager is unavailable.');
      for (const id of layerIds) {
        if (!manager.layers?.has(id))
          throw new Error(`Dense fixture layer is missing: ${id}`);
        if (!manager.isEnabled(id)) await manager.setEnabled(id, true);
      }
    }, Object.keys(expectedLayerCounts));
    await page.waitForFunction(
      (counts) =>
        Object.entries(counts).every(([id, expected]) => {
          const layer = window.__godsEyeView?.dataManager
            ?.getAll?.()
            ?.find((entry) => entry.id === id);
          return layer?.enabled === true && layer?.stats?.count === expected;
        }),
      { timeout: 90_000, polling: 100 },
      expectedLayerCounts,
    );
    const readDenseLayerPopulation = () =>
      page.evaluate((layerIds) => {
        const layers = window.__godsEyeView.dataManager.getAll();
        return Object.fromEntries(
          layerIds.map((id) => {
            const layer = layers.find((entry) => entry.id === id);
            return [id, { enabled: layer.enabled, count: layer.stats.count }];
          }),
        );
      }, Object.keys(expectedLayerCounts));
    const denseLayerPopulation = await readDenseLayerPopulation();
    densePopulationObservations.push({
      checkpoint: 'initial',
      layers: denseLayerPopulation,
    });

    phase = 'provider-fixture-clock-start';
    const fixtureClockStart = await page.evaluate(() => {
      const clock = window.__gevHeldMonotonicWallClockV1;
      if (!clock || Date.now() !== clock.snapshot().epochMs)
        throw new Error('Fixture wall clock was not held at the source epoch.');
      return clock.start();
    });

    phase = 'shared-scene-and-route-observation';
    const before = await page.evaluate(observeCommonScene, {
      appCommit: commit,
    });
    const routeStart = before.camera;
    const routeStartMs = await page.evaluate(() => performance.now());
    await new Promise((resolve) => setTimeout(resolve, 250));
    const after = await page.evaluate(observeCommonScene, {
      appCommit: commit,
    });
    const routeEndMs = await page.evaluate(() => performance.now());
    const fixtureClockEnd = await page.evaluate(() => ({
      clock: window.__gevHeldMonotonicWallClockV1?.snapshot?.() ?? null,
      wallTimeMs: Date.now(),
      flightStats:
        window.__godsEyeView?.dataManager?.layers
          ?.get('flights')
          ?.module?.getStats?.() ?? null,
    }));
    const fixtureAgeMs = fixtureClockEnd.wallTimeMs - flightFixture.fixedTimeMs;
    if (
      !fixtureClockEnd.clock?.started ||
      fixtureClockEnd.clock.startCount !== 1 ||
      fixtureClockEnd.clock.elapsedMs < routeEndMs - routeStartMs ||
      fixtureAgeMs < 0 ||
      fixtureAgeMs > 120_000 ||
      fixtureClockEnd.flightStats?.lastUpdate !== flightFixture.fixedTimeMs ||
      fixtureClockEnd.flightStats?.stale !== false ||
      fixtureClockEnd.flightStats?.count !== flightFixture.count
    )
      throw new Error(
        `Provider fixture clock/freshness check failed: ${JSON.stringify({ clock: fixtureClockEnd.clock, fixtureAgeMs, flightStats: fixtureClockEnd.flightStats })}`,
      );
    const route = describeObservedRoute({
      scenario: 'idle',
      start: routeStart,
      durationMs: routeEndMs - routeStartMs,
      measurement: { cameraPath: { id: 'integration-smoke-idle' } },
    });
    const renderer = after.environment.renderer.toLowerCase();
    if (!renderer.includes('swiftshader'))
      throw new Error('Observed renderer does not identify SwiftShader.');
    phase = 'served-assets-postcheck';
    const postVerification = await provenance.verifyAfterCapture();
    phase = 'final-page-health-and-code-path-audit';
    if (pageErrors.length)
      throw new Error(`Application emitted ${pageErrors.length} page errors.`);
    if (fixturePage.errors.length)
      throw new Error(
        `Fixture interception reported ${fixturePage.errors.length} errors.`,
      );
    for (const worker of page.workers())
      requestAudit.observeWorker(worker.url());
    for (const target of browser.targets())
      if (['worker', 'service_worker'].includes(target.type()))
        requestAudit.observeWorker(target.url());
    const finalAuditSnapshot = requestAudit.snapshot();
    if (finalAuditSnapshot.droppedCodeRequestCount > 0)
      throw new Error(
        'Application code request audit exceeded its bounded event capacity.',
      );
    finalDenseLayerPopulation = await readDenseLayerPopulation();
    densePopulationObservations.push({
      checkpoint: 'final-before-code-validation',
      layers: finalDenseLayerPopulation,
    });
    const blobCodeRequests = finalAuditSnapshot.requests
      .filter((request) => request.url.startsWith('blob:'))
      .map((request) => request.url);
    for (const worker of page.workers()) rememberWorkerTarget(worker.url());
    for (const target of browser.targets())
      if (
        ['worker', 'service_worker'].includes(target.type()) &&
        target.url().startsWith('blob:')
      )
        rememberWorkerTarget(target.url());
    if (workerTargetOverflowCount > 0)
      throw new Error(
        'Application worker target audit exceeded its bounded capacity.',
      );
    const workerUrls = [...workerTargetUrls];
    phase = 'cesium-worker-blob-collection';
    const blobAudit = await withTimeout(
      page.evaluate(async (urls) => {
        const audit = window.__gevCesiumWorkerBlobAuditV1;
        if (!audit) throw new Error('Cesium worker blob audit is unavailable.');
        return audit.readWorkerBodies(urls);
      }, workerUrls),
      10_000,
      'Cesium worker blob collection',
    );
    workerBlobDiagnostics = summarizeCesiumWorkerBlobEvidence({
      workerUrls,
      observedBlobUrls: [...new Set([...blobCodeRequests, ...workerUrls])],
      blobAudit,
      requests: finalAuditSnapshot.requests,
    });
    phase = 'cesium-worker-blob-validation';
    workerBlobValidation = validateCesiumWorkerBlobs({
      contract: workerContract,
      baseUrl: served.baseUrl,
      workerUrls,
      observedBlobUrls: [...new Set([...blobCodeRequests, ...workerUrls])],
      blobAudit,
    });
    phase = 'receipted-code-request-audit';
    const finalCodeAudit = auditReceiptedCodeRequests({
      requests: finalAuditSnapshot.requests,
      baseUrl: served.baseUrl,
      assets: build.receipt.assets,
      validatedBlobUrls: workerBlobValidation.acceptedBlobUrls,
    });
    if (pageErrors.length)
      throw new Error(`Application emitted ${pageErrors.length} page errors.`);
    if (fixturePage.errors.length)
      throw new Error(
        `Fixture interception reported ${fixturePage.errors.length} errors.`,
      );
    for (const [id, expected] of Object.entries(expectedLayerCounts)) {
      if (
        denseLayerPopulation[id]?.enabled !== true ||
        denseLayerPopulation[id]?.count !== expected ||
        finalDenseLayerPopulation[id]?.enabled !== true ||
        finalDenseLayerPopulation[id]?.count !== expected
      )
        throw new Error(`Dense fixture population changed for ${id}.`);
    }
    const flightFixtureObservation = flightFixtureDelivery.summarize(
      finalDenseLayerPopulation.flights.count,
    );
    let captureCliDiagnostic = null;
    if (label === 'candidate') {
      phase = 'capture-cli-preparation-cleanup';
      const earlyRendererProbeCleanup = recordRendererProbeCleanup(
        await cleanupEarlyCesiumRendererProbeWithEvidence(
          page,
          earlyRendererProbeScriptIdentifier,
          1_000,
          { retireViewerRenderLoop: true },
        ),
      );
      if (earlyRendererProbeCleanup.confirmed !== true)
        throw new Error(
          'Early renderer probe cleanup before capture CLI was not confirmed.',
        );
      earlyRendererProbeScriptIdentifier = null;
      await withTimeout(
        page.evaluate(restoreCesiumWorkerBlobAudit),
        3000,
        'Cesium worker blob audit cleanup before capture CLI',
      );
      await withTimeout(
        cleanupFixturePageDiagnostics(page),
        3000,
        'Page diagnostic cleanup before capture CLI',
      );
      await withTimeout(
        context.close(),
        5000,
        'Smoke browser context cleanup before capture CLI',
      );
      context = null;
      page = null;
      fixturePage = null;
      phase = 'candidate-capture-cli-integration';
      captureCliDiagnostic = await runCandidateCaptureCli({
        build,
        checkout,
        commit,
        harnessCommit,
        served,
        tempRoot,
        fixture:
          providerFixture === 'dense-investigation'
            ? flightFixture
            : infrastructureCaptureFixture,
        providerFixture,
        workerAuditMode,
        sceneFrameDiagnostics,
        firstMotionCpuProfile,
        profileArtifactDirectory,
        startedAt,
        budgetMs,
      });
    }
    result = {
      revision: commit,
      status: 'passed',
      receiptSha256: build.receipt.receiptSha256,
      assetCount: build.receipt.assetCount,
      totalAssetBytes: build.receipt.totalAssetBytes,
      servedBefore: provenance.source.before,
      servedAfter: postVerification,
      loadedCodePathAudit: {
        status: 'receipt-backed-paths-observed',
        paths: finalCodeAudit.paths,
        externalCodeRequestsObserved: finalCodeAudit.externalCodeRequests,
        validatedWorkerBlobCount: finalCodeAudit.validatedWorkerBlobCount,
        cesiumWorkerBlobs: workerBlobValidation.observation,
        requestCount: finalAuditSnapshot.requestCount,
        coverage:
          'receipt-backed request-path audit with smoke-only Cesium worker blob instrumentation; browser response bytes are not independently attested and the smoke is not performance evidence',
      },
      providerInterception: {
        status: 'worker-aware-external-blocking-probe-passed',
        preflight: workerNetworkPreflight,
        sameOriginOnlyStaticServer: true,
      },
      denseProviderFixture: {
        scope:
          'real production /api/flights source plus bundled infrastructure layers; static-count integration smoke only, not paired timing evidence',
        expectedLayerCounts,
        observedLayerPopulation: finalDenseLayerPopulation,
        flightFixture: flightFixtureObservation,
        captureClock: {
          schema: 'gev-provider-fixture-capture-clock/v1',
          scope:
            'hosted integration smoke only; one short route check, not a performance measurement',
          fixedTime: flightFixture.fixedTime,
          start: fixtureClockStart,
          end: fixtureClockEnd.clock,
          ageAtEndMs: fixtureAgeMs,
          freshnessWindowMs: 120_000,
          sourceFreshness: 'current',
        },
        comparisonEligible: false,
        comparisonIneligibilityReason:
          'This smoke verifies delivered fixture bytes and populations but does not establish the paired fixed-time measurement contract.',
      },
      ...(captureCliDiagnostic ? { captureCliDiagnostic } : {}),
      rendererProbeCleanup,
      rendererProbeCleanupOmittedCount,
      serviceWorker: serviceWorkerState,
      browser: {
        softwareRenderingRequested: true,
        flags: [
          '--use-gl=angle',
          '--use-angle=swiftshader',
          '--enable-unsafe-swiftshader',
        ],
        observedRenderer: after.environment.renderer,
        observedVendor: after.environment.vendor,
      },
      route,
      observerBefore: simplifyObservation(before),
      observerAfter: simplifyObservation(after),
      durationMs: Date.now() - startedAt,
    };
  } catch (error) {
    error.smokeDiagnostics = {
      phase,
      pageErrors: pageErrors.slice(0, 4),
      interceptionErrors: (fixturePage?.errors || [])
        .slice(0, 4)
        .map(sanitizeError),
      ...(workerBlobDiagnostics ? { workerBlobDiagnostics } : {}),
      ...(phase === 'cesium-worker-blob-validation'
        ? { workerBlobValidationFailure: sanitizeError(error) }
        : {}),
      ...(error.captureCliFailure
        ? { captureCliFailure: error.captureCliFailure }
        : {}),
      rendererProbeCleanup,
      rendererProbeCleanupOmittedCount,
      densePopulationObservations,
    };
    failure = error;
  } finally {
    if (page) {
      try {
        const earlyRendererProbeCleanup = recordRendererProbeCleanup(
          await cleanupEarlyCesiumRendererProbeWithEvidence(
            page,
            earlyRendererProbeScriptIdentifier,
            1_000,
            { retireViewerRenderLoop: true },
          ),
        );
        if (earlyRendererProbeCleanup.confirmed !== true)
          cleanupErrors.push(
            sanitizeError(
              new Error(
                'Retired smoke document render-loop and probe cleanup was not confirmed.',
              ),
            ),
          );
      } catch (error) {
        cleanupErrors.push(sanitizeError(error));
      }
      try {
        await withTimeout(
          page.evaluate(restoreCesiumWorkerBlobAudit),
          3000,
          'Cesium worker blob audit cleanup',
        );
      } catch (error) {
        cleanupErrors.push(sanitizeError(error));
      }
    }
    if (fixturePage?.page) {
      try {
        await withTimeout(
          cleanupFixturePageDiagnostics(fixturePage.page),
          3000,
          'Page diagnostic cleanup',
        );
      } catch (error) {
        cleanupErrors.push(sanitizeError(error));
      }
    }
    if (context) {
      try {
        await withTimeout(context.close(), 5000, 'Browser context cleanup');
      } catch (error) {
        cleanupErrors.push(sanitizeError(error));
      }
    }
    try {
      await closeServer(served.server);
    } catch (error) {
      cleanupErrors.push(sanitizeError(error));
    }
  }
  if (cleanupErrors.length) {
    if (!failure) {
      failure = new Error('Smoke cleanup failed.');
      failure.smokeDiagnostics = {
        phase: 'cleanup',
        pageErrors: pageErrors.slice(0, 4),
        interceptionErrors: (fixturePage?.errors || [])
          .slice(0, 4)
          .map(sanitizeError),
      };
    }
    failure.smokeDiagnostics.cleanupErrors = cleanupErrors.slice(0, 3);
    failure.smokeDiagnostics.rendererProbeCleanup = rendererProbeCleanup;
    failure.smokeDiagnostics.rendererProbeCleanupOmittedCount =
      rendererProbeCleanupOmittedCount;
  }
  if (failure) throw failure;
  return result;
}

async function main() {
  const {
    candidateSha,
    out,
    captureWorkerAuditMode = 'diagnostic',
    providerFixture = 'dense-investigation',
    sceneFrameDiagnostics = false,
    firstMotionCpuProfile = false,
  } = parseSmokeArguments(process.argv.slice(2));
  const infrastructureCaptureFixture =
    providerFixture === 'dense-investigation'
      ? null
      : createInfrastructureWorkloadFixture(providerFixture);
  const outputPath = path.resolve(
    out ||
      path.join(
        process.env.RUNNER_TEMP || os.tmpdir(),
        'performance-build-smoke.json',
      ),
  );
  if (assertInside(ROOT, outputPath))
    throw new Error(
      'Smoke report must be written outside the harness checkout.',
    );
  assertSha(candidateSha, 'Candidate SHA');
  assert.notEqual(
    candidateSha,
    BASELINE_SHA,
    'Candidate must differ from baseline.',
  );
  assert.equal(git(['status', '--porcelain', '--untracked-files=all']), '');
  const harnessCommit = git(['rev-parse', 'HEAD']);
  assertSha(harnessCommit, 'Harness SHA');
  for (const commit of [BASELINE_SHA, candidateSha])
    git(['cat-file', '-e', `${commit}^{commit}`]);

  const report = {
    schema: 'gev-performance-build-smoke/v1',
    scope:
      'hosted-browser integration smoke only; no hardware performance result or paired acceptance',
    status: 'running',
    baselineSha: BASELINE_SHA,
    candidateSha,
    harnessSha: harnessCommit,
    captureWorkerAuditMode,
    sceneFrameDiagnostics,
    firstMotionCpuProfile,
    ...(firstMotionCpuProfile
      ? {
          cpuProfileArtifactDirectory: path.basename(
            `${outputPath}.cpu-profile`,
          ),
        }
      : {}),
    candidateCaptureProviderFixture: providerFixture,
    startedAt: null,
    variants: [],
    limitations: [
      'Local build receipts are unsigned and do not attest hardware or release provenance.',
      'The browser request audit records code paths; it does not independently attest response bytes.',
      'The production fixture is verified only for acknowledged delivery and static population counts; this smoke is not paired timing evidence.',
      'The candidate provider-fixture selection applies to the additional capture CLI; baseline and candidate build-smoke pages still run the dense integration checks.',
      'Software rendering is explicit SwiftShader and cannot support hardware performance claims.',
    ],
    failure: null,
  };
  const configuredStart = process.env.GEV_PERF_SMOKE_STARTED_AT_MS;
  const startedAt = configuredStart ? Number(configuredStart) : Date.now();
  if (!Number.isSafeInteger(startedAt) || startedAt > Date.now())
    throw new Error('Smoke start clock input is invalid.');
  report.startedAt = new Date(startedAt).toISOString();
  await writeReport(report, outputPath);
  const budgetMs = DEFAULT_BUDGET_MS;
  let temporary = null;
  let browser = null;
  const worktrees = [];
  const cleanupErrors = [];
  try {
    if (Date.now() - startedAt > budgetMs)
      throw new Error('Smoke time budget expired during runner setup.');
    const runnerTemp = await realpath(process.env.RUNNER_TEMP || os.tmpdir());
    temporary = await createOwnedTempRoot();
    assert.equal(temporary.parent, runnerTemp);
    for (const [label, commit] of [
      ['baseline', BASELINE_SHA],
      ['candidate', candidateSha],
    ]) {
      if (Date.now() - startedAt > budgetMs)
        throw new Error('Smoke time budget expired before source checkout.');
      worktrees.push(await addWorktree(temporary.root, label, commit));
    }
    browser = await puppeteer.launch({
      headless: true,
      protocolTimeout: 15_000,
      args: [
        '--no-sandbox',
        '--disable-dev-shm-usage',
        '--use-gl=angle',
        '--use-angle=swiftshader',
        '--enable-unsafe-swiftshader',
      ],
    });
    for (const [index, [label, commit]] of [
      ['baseline', BASELINE_SHA],
      ['candidate', candidateSha],
    ].entries()) {
      if (Date.now() - startedAt > budgetMs)
        throw new Error('Smoke time budget expired before the next build.');
      const variant = {
        revision: commit,
        label,
        status: 'running',
      };
      report.variants.push(variant);
      await writeReport(report, outputPath);
      try {
        const result = await runRevision({
          browser,
          checkout: worktrees[index],
          commit,
          label,
          harnessCommit,
          tempRoot: temporary.root,
          startedAt,
          budgetMs,
          workerAuditMode: captureWorkerAuditMode,
          sceneFrameDiagnostics,
          firstMotionCpuProfile,
          profileArtifactDirectory: firstMotionCpuProfile
            ? path.join(`${outputPath}.cpu-profile`, `candidate-${startedAt}`)
            : null,
          providerFixture,
          infrastructureCaptureFixture,
        });
        Object.assign(variant, result);
      } catch (error) {
        variant.status = 'failed';
        variant.failure = sanitizeError(error);
        variant.failureDetails = error.smokeDiagnostics || {
          phase: 'clean-build-or-server-start',
          pageErrors: [],
          interceptionErrors: [],
        };
        throw error;
      }
      await writeReport(report, outputPath);
    }
    report.status = 'passed';
  } catch (error) {
    report.status = 'failed';
    report.failure = {
      message: sanitizeError(error),
      phase:
        report.variants.find((variant) => variant.status === 'failed')?.label ||
        report.variants.find((variant) => variant.status === 'running')
          ?.label ||
        'setup',
    };
  } finally {
    if (browser) {
      try {
        await withTimeout(browser.close(), 10_000, 'Browser cleanup');
      } catch (error) {
        cleanupErrors.push(sanitizeError(error));
        browser.process()?.kill();
      }
    }
    for (const worktree of worktrees.reverse()) {
      try {
        execFileSync(
          'git',
          ['-C', ROOT, 'worktree', 'remove', '--force', worktree],
          {
            stdio: 'ignore',
            windowsHide: true,
            timeout: 15_000,
          },
        );
      } catch (error) {
        cleanupErrors.push(sanitizeError(error));
      }
    }
    if (temporary) {
      try {
        const canonical = await realpath(temporary.root);
        if (
          canonical !== temporary.root ||
          path.dirname(canonical) !== temporary.parent ||
          !path
            .basename(canonical)
            .startsWith('gev-performance-build-smoke-') ||
          !(await lstat(canonical)).isDirectory()
        )
          throw new Error(
            'Refusing cleanup outside the generated smoke directory.',
          );
        await rm(canonical, { recursive: true, force: false });
      } catch (error) {
        cleanupErrors.push(sanitizeError(error));
      }
    }
    report.finishedAt = new Date().toISOString();
    report.durationMs = Date.now() - startedAt;
    if (cleanupErrors.length) {
      report.cleanupErrors = cleanupErrors.slice(0, 4);
      report.status = 'failed';
    }
    await writeReport(report, outputPath);
  }
  process.stdout.write(
    `${JSON.stringify({ status: report.status, output: path.basename(outputPath) })}\n`,
  );
  if (report.status !== 'passed') process.exitCode = 1;
}

const invoked = process.argv[1]
  ? pathToFileURL(path.resolve(process.argv[1])).href
  : '';
if (import.meta.url === invoked) {
  try {
    await main();
  } catch (error) {
    const argv = process.argv.slice(2);
    const outIndex = argv.indexOf('--out');
    let outputPath = path.resolve(
      outIndex >= 0 && argv[outIndex + 1]
        ? argv[outIndex + 1]
        : path.join(
            process.env.RUNNER_TEMP || os.tmpdir(),
            'performance-build-smoke.json',
          ),
    );
    if (assertInside(ROOT, outputPath))
      outputPath = path.join(
        process.env.RUNNER_TEMP || os.tmpdir(),
        'performance-build-smoke.json',
      );
    const failure = sanitizeError(error);
    let previous = null;
    try {
      previous = JSON.parse(await readFile(outputPath, 'utf8'));
    } catch {
      // Create a minimal bounded failure artifact when setup failed early.
    }
    const report = {
      ...(previous?.schema === 'gev-performance-build-smoke/v1'
        ? previous
        : {}),
      schema: 'gev-performance-build-smoke/v1',
      scope:
        'hosted-browser integration smoke only; no hardware performance result or paired acceptance',
      status: 'failed',
      failure: { phase: 'setup', message: failure },
      finishedAt: new Date().toISOString(),
    };
    await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`).catch(
      () => {},
    );
    process.stderr.write(`${failure}\n`);
    process.exitCode = 1;
  }
}
