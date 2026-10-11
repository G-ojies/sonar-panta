// Release notes for a GitLab Release, from the pipeline's own evidence: commits since the last tag,
// the live checks that passed, and the curve_market hash and test summary when the program was built.
import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';

const sh = (c) => { try { return execSync(c, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { return ''; } };
const last = sh('git describe --tags --abbrev=0');
const commits = sh(`git log --no-merges --format="- %s (%h)" ${last ? `${last}..HEAD` : '-20'}`) || '- no new commits';
const out = [`## What changed${last ? ` since ${last}` : ''}`, '', commits, ''];

if (existsSync('guard-report.json')) {
  const r = JSON.parse(readFileSync('guard-report.json', 'utf8'));
  out.push('## Live checks', '', ...r.checks.map((c) => `- ${c.ok ? 'pass' : 'FAIL'}: ${c.id}, ${c.detail}`), '');
}
if (existsSync('curve_market.sha256')) {
  out.push('## curve_market', '', `SHA-256 of the built program: \`${readFileSync('curve_market.sha256', 'utf8').split(/\s+/)[0]}\``);
  const t = existsSync('program-tests.txt') ? readFileSync('program-tests.txt', 'utf8') : '';
  const passed = [...t.matchAll(/test result: ok\. (\d+) passed/g)].reduce((n, m) => n + Number(m[1]), 0);
  if (passed) out.push(`Program tests passed: ${passed}`);
  out.push('', 'Built and hashed only. The on-chain program is not deployed by this pipeline; upgrades stay a manual, human step.', '');
}
console.log(out.join('\n'));
