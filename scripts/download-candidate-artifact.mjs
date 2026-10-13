#!/usr/bin/env node
import { createHash } from 'node:crypto';
import {
  closeSync,
  mkdirSync,
  openSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { createReadStream } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const SHA256 = /^sha256:([a-f0-9]{64})$/;
const SHA1 = /^[a-f0-9]{40}$/;
const POSITIVE_INTEGER = /^[1-9][0-9]*$/;

function requirePositiveInteger(value, label) {
  const text = String(value ?? '');
  if (!POSITIVE_INTEGER.test(text) || !Number.isSafeInteger(Number(text)))
    throw new TypeError(`${label} must be a positive integer.`);
  return Number(text);
}

function requireSha256(value, label) {
  const match = SHA256.exec(String(value ?? ''));
  if (!match) throw new TypeError(`${label} must be a sha256 digest.`);
  return match[1];
}

export function validateCandidateArtifactMetadata(metadata, expected) {
  const artifactId = requirePositiveInteger(
    expected?.artifactId,
    'Artifact ID',
  );
  const runId = requirePositiveInteger(expected?.runId, 'Workflow run ID');
  const repositoryId = requirePositiveInteger(
    expected?.repositoryId,
    'Repository ID',
  );
  if (!SHA1.test(expected?.sourceCommit || ''))
    throw new TypeError('Expected source commit must be a full SHA.');
  if (!SHA1.test(expected?.candidateCommit || ''))
    throw new TypeError('Candidate commit must be a full SHA.');
  if (!/^gev-candidate-[a-f0-9]{40}$/.test(expected?.artifactName || ''))
    throw new TypeError('Expected artifact name is invalid.');
  if (metadata?.id !== artifactId)
    throw new Error('Artifact metadata ID does not match the uploaded ID.');
  if (metadata?.name !== expected.artifactName)
    throw new Error('Artifact metadata name does not match this candidate.');
  if (metadata?.expired !== false)
    throw new Error('Candidate artifact is expired or has unknown expiry.');
  if (
    !Number.isSafeInteger(metadata?.size_in_bytes) ||
    metadata.size_in_bytes <= 0
  )
    throw new Error('Artifact metadata size is invalid.');
  const run = metadata?.workflow_run;
  if (!run || run.id !== runId)
    throw new Error('Artifact metadata belongs to a different workflow run.');
  if (
    run.repository_id !== repositoryId ||
    run.head_repository_id !== repositoryId
  )
    throw new Error('Artifact metadata belongs to a different repository.');
  if (run.head_sha !== expected.sourceCommit)
    throw new Error('Artifact metadata source commit does not match this run.');
  const metadataDigest = requireSha256(
    metadata.digest,
    'Artifact metadata digest',
  );
  const uploadDigest = requireSha256(expected.uploadDigest, 'Upload digest');
  if (metadataDigest !== uploadDigest)
    throw new Error('Upload and REST artifact digests do not match.');
  return {
    artifactId,
    runId,
    repositoryId,
    name: expected.artifactName,
    sizeInBytes: metadata.size_in_bytes,
    digest: metadataDigest,
    sourceCommit: run.head_sha,
  };
}

export function validateCandidateArtifactZip({
  metadataSize,
  metadataDigest,
  uploadDigest,
  zipBytes,
}) {
  if (!Buffer.isBuffer(zipBytes) || zipBytes.length === 0)
    throw new TypeError('Downloaded artifact ZIP is empty or unavailable.');
  if (zipBytes.length !== metadataSize)
    throw new Error('Downloaded ZIP size differs from artifact metadata.');
  const restDigest = requireSha256(metadataDigest, 'Artifact metadata digest');
  const publishedDigest = requireSha256(uploadDigest, 'Upload digest');
  if (restDigest !== publishedDigest)
    throw new Error('Upload and REST artifact digests do not match.');
  const actualDigest = createHash('sha256').update(zipBytes).digest('hex');
  if (actualDigest !== restDigest)
    throw new Error('Downloaded ZIP digest differs from artifact metadata.');
  return actualDigest;
}

export function validateCandidateArchiveEntries(entries, archiveName) {
  if (!/^gods-eye-view-[a-f0-9]{40}\.tar\.gz$/.test(archiveName || ''))
    throw new TypeError('Candidate archive name is invalid.');
  if (!Array.isArray(entries))
    throw new TypeError('Artifact archive entry list is unavailable.');
  const expected = [archiveName, `${archiveName}.sha256`].sort();
  const actual = entries.map((entry) => String(entry)).sort();
  if (
    actual.length !== expected.length ||
    actual.some((entry, index) => entry !== expected[index])
  )
    throw new Error(
      'Artifact ZIP must contain only the candidate archive and checksum.',
    );
  return expected;
}

async function digestFile(filePath) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest('hex');
}

function parseInputs(args) {
  const values = new Map();
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index];
    if (!['--out'].includes(flag) || !args[index + 1])
      throw new TypeError('Expected --out <directory>.');
    if (values.has(flag)) throw new TypeError('Duplicate command option.');
    values.set(flag, args[index + 1]);
  }
  return Object.fromEntries(values);
}

function requestMetadata(repository, artifactId) {
  const endpoint = `repos/${repository}/actions/artifacts/${artifactId}`;
  try {
    const text = execFileSync('gh', ['api', endpoint], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 1024 * 1024,
    });
    return JSON.parse(text);
  } catch {
    throw new Error('GitHub artifact metadata request or JSON parsing failed.');
  }
}

function downloadArtifactZip(repository, artifactId, outputPath) {
  const endpoint = `repos/${repository}/actions/artifacts/${artifactId}/zip`;
  const descriptor = openSync(outputPath, 'wx');
  try {
    execFileSync(
      'gh',
      ['api', '-H', 'Accept: application/vnd.github+json', endpoint],
      {
        stdio: ['ignore', descriptor, 'pipe'],
        maxBuffer: 1024 * 1024,
      },
    );
  } catch {
    throw new Error('GitHub artifact ZIP download by ID failed.');
  } finally {
    closeSync(descriptor);
  }
}

function extractArchiveEntry(zipPath, entry, outputPath) {
  const descriptor = openSync(outputPath, 'wx');
  try {
    execFileSync('unzip', ['-p', zipPath, entry], {
      stdio: ['ignore', descriptor, 'pipe'],
      maxBuffer: 1024 * 1024,
    });
  } catch {
    try {
      unlinkSync(outputPath);
    } catch {
      // Preserve the original extraction failure.
    }
    throw new Error('Candidate artifact entry extraction failed.');
  } finally {
    closeSync(descriptor);
  }
}

async function main() {
  const { '--out': outputDirectory } = parseInputs(process.argv.slice(2));
  const repository = process.env.GITHUB_REPOSITORY || '';
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository))
    throw new TypeError('GitHub repository identity is invalid.');
  const repositoryId = requirePositiveInteger(
    process.env.GITHUB_REPOSITORY_ID,
    'Repository ID',
  );
  const artifactId = requirePositiveInteger(
    process.env.ARTIFACT_ID,
    'Artifact ID',
  );
  const runId = requirePositiveInteger(
    process.env.GITHUB_RUN_ID,
    'Workflow run ID',
  );
  const candidateCommit = process.env.GITHUB_SHA || '';
  const sourceCommit = process.env.EXPECTED_SOURCE_COMMIT || '';
  const artifactName = `gev-candidate-${candidateCommit}`;
  const uploadDigest = process.env.UPLOAD_ARTIFACT_DIGEST || '';
  if (!process.env.GH_TOKEN)
    throw new Error('GitHub API token is unavailable.');
  const metadata = requestMetadata(repository, artifactId);
  const verifiedMetadata = validateCandidateArtifactMetadata(metadata, {
    artifactId,
    runId,
    repositoryId,
    artifactName,
    sourceCommit,
    candidateCommit,
    uploadDigest,
  });

  const archiveName = `gods-eye-view-${candidateCommit}.tar.gz`;
  const directory = path.resolve(outputDirectory);
  mkdirSync(directory, { recursive: true });
  const zipPath = path.join(directory, `${archiveName}.artifact.zip`);
  downloadArtifactZip(repository, artifactId, zipPath);
  const zipStat = statSync(zipPath);
  if (zipStat.size !== verifiedMetadata.sizeInBytes)
    throw new Error('Downloaded ZIP size differs from artifact metadata.');
  const zipDigest = await digestFile(zipPath);
  if (zipDigest !== verifiedMetadata.digest)
    throw new Error('Downloaded ZIP digest differs from artifact metadata.');
  const entryText = execFileSync('unzip', ['-Z1', zipPath], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 64 * 1024,
  });
  validateCandidateArchiveEntries(
    entryText.split(/\r?\n/).filter(Boolean),
    archiveName,
  );
  const archivePath = path.join(directory, archiveName);
  const checksumPath = `${archivePath}.sha256`;
  extractArchiveEntry(zipPath, archiveName, archivePath);
  extractArchiveEntry(zipPath, `${archiveName}.sha256`, checksumPath);
  unlinkSync(zipPath);
  writeFileSync(
    path.join(directory, 'artifact-rest-metadata.json'),
    `${JSON.stringify(
      {
        schema: 'gev-release-artifact-rest-metadata/v1',
        ...verifiedMetadata,
        repository,
      },
      null,
      2,
    )}\n`,
  );
  process.stdout.write(
    `Verified artifact ${artifactId} from run ${runId}; SHA-256 ${zipDigest}.\n`,
  );
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  main().catch((error) => {
    process.stderr.write(
      `Candidate artifact handoff failed: ${error.message}\n`,
    );
    process.exitCode = 1;
  });
}
