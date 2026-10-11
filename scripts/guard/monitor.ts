/**
 * Post-deploy monitor. Run by the GitLab pipeline after a deploy and on a schedule.
 *   GUARD_BASE_URL     the site to check (required)
 *   GUARD_EXPECT_COMMIT  wait until /api/health reports this commit before checking (the deploy job sets it)
 *   GUARD_WAIT_SECONDS   how long to wait for that commit (default 900: a free Render build takes several minutes)
 *   GUARD_PREV          path to the last good report, for the record-kept check (optional)
 * Writes guard-report.json and guard-report.md, exits 1 when any check fails.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { evaluate, toMarkdown, type GuardReport, type GuardSnapshot } from '../../src/lib/guard';

const base = (process.env.GUARD_BASE_URL ?? '').replace(/\/$/, '');
if (!base) { console.error('GUARD_BASE_URL is not set'); process.exit(2); }
const expect = process.env.GUARD_EXPECT_COMMIT || null;
const waitS = Number(process.env.GUARD_WAIT_SECONDS ?? 900);
const prevPath = process.env.GUARD_PREV;

async function getJson(path: string): Promise<{ status: string; body: unknown }> {
  try {
    const r = await fetch(base + path, { headers: { 'cache-control': 'no-store' }, signal: AbortSignal.timeout(30_000) });
    return { status: String(r.status), body: r.ok ? await r.json() : null };
  } catch (e) { return { status: `error: ${(e as Error).message}`, body: null }; }
}

async function snapshot(): Promise<GuardSnapshot> {
  const [h, a] = await Promise.all([getJson('/api/health'), getJson('/api/agent')]);
  return { at: Date.now(), health: h.body as GuardSnapshot['health'], agent: a.body as GuardSnapshot['agent'], status: { health: h.status, agent: a.status } };
}

async function main() {
  let snap = await snapshot();
  if (expect) {
    const until = Date.now() + waitS * 1000;
    while (!snap.health?.commit?.startsWith(expect.slice(0, 7)) && Date.now() < until) {
      console.log(`waiting for ${expect.slice(0, 7)}; live is ${snap.health?.commit ?? snap.status.health}`);
      await new Promise((r) => setTimeout(r, 20_000));
      snap = await snapshot();
    }
  }
  const prev: GuardReport | null = prevPath && existsSync(prevPath) ? JSON.parse(readFileSync(prevPath, 'utf8')) : null;
  const report = evaluate(snap, base, expect, prev);
  writeFileSync('guard-report.json', JSON.stringify(report, null, 2));
  writeFileSync('guard-report.md', toMarkdown(report));
  console.log(toMarkdown(report));
  process.exit(report.ok ? 0 : 1);
}
main();
