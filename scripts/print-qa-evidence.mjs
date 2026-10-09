import { readFileSync, existsSync, statSync } from 'node:fs';
// CI logs do not consume artifact-storage allowance. Only explicit fixture
// reports are printed; never dump the worktree, environment or provider logs.
for (const file of process.argv.slice(2)) {
  if (!existsSync(file)) {
    console.log(`QA evidence missing: ${file}`);
    continue;
  }
  if (statSync(file).size > 2 * 1024 * 1024)
    throw new Error('QA report exceeds log limit');
  const report = JSON.parse(readFileSync(file, 'utf8'));
  console.log(`QA_EVIDENCE_BEGIN ${file}`);
  console.log(JSON.stringify(report));
  console.log(`QA_EVIDENCE_END ${file}`);
}
