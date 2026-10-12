import { readFileSync, existsSync, statSync, createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
// CI logs do not consume artifact-storage allowance. Only explicit fixture
// reports are printed; never dump the worktree, environment or provider logs.
const args = process.argv.slice(2);
const artifactOnly = args[0] === '--artifact-only';
for (const file of artifactOnly ? args.slice(1) : args) {
  if (!existsSync(file)) {
    console.log(`QA evidence missing: ${file}`);
    continue;
  }
  if (artifactOnly) {
    // Large reports are uploaded intact by the workflow. Hash incrementally so
    // logging needs neither their payload nor an increased memory/log budget.
    const hash = createHash('sha256');
    let bytes = 0;
    for await (const chunk of createReadStream(file)) {
      hash.update(chunk);
      bytes += chunk.length;
    }
    console.log(
      `QA_ARTIFACT ${JSON.stringify({ file, bytes, sha256: hash.digest('hex'), scope: 'artifact identity only; no validation result inferred' })}`,
    );
    continue;
  }
  if (statSync(file).size > 2 * 1024 * 1024)
    throw new Error('QA report exceeds log limit');
  const report = JSON.parse(readFileSync(file, 'utf8'));
  console.log(`QA_EVIDENCE_BEGIN ${file}`);
  console.log(JSON.stringify(report));
  console.log(`QA_EVIDENCE_END ${file}`);
}
