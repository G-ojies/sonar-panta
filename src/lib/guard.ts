/**
 * Sonar Guard: the post-deploy checks the GitLab pipeline runs against a live Sonar.
 * Pure: takes what /api/health and /api/agent returned (plus the last good report) and says what is wrong.
 * The CLI in scripts/guard/monitor.ts does the fetching; the Watch flow reads the report it writes.
 */

export interface HealthBody {
  ok?: boolean; store?: string; panta?: string; radarUpdatedAt?: number | null; radarMarkets?: number; commit?: string | null;
}
export interface AgentBody {
  backtest?: { ranAt?: number; markets?: number; calls?: number; hits?: number; errors?: string[] } | null;
}
export interface GuardSnapshot {
  at: number; health: HealthBody | null; agent: AgentBody | null;
  /** HTTP status or the fetch error, per endpoint */
  status: { health: string; agent: string };
}
export interface GuardCheck { id: string; ok: boolean; detail: string }
export interface GuardReport {
  ok: boolean; at: number; baseUrl: string; commit: string | null; checks: GuardCheck[];
  /** the numbers the next run compares against */
  record: { markets: number; calls: number; hits: number; radarMarkets: number } | null;
}
export interface GuardLimits {
  /** the radar is refreshed about every 20 minutes; older than this means the tick stopped */
  maxRadarAgeMin: number;
  /** a scan that keeps fewer markets than this is a broken scan, not a quiet market */
  minRadarMarkets: number;
  /** the walk-forward record only grows; losing more than this share of its markets means data was lost */
  maxRecordDrop: number;
}
export const DEFAULT_LIMITS: GuardLimits = { maxRadarAgeMin: 75, minRadarMarkets: 20, maxRecordDrop: 0.05 };

export function evaluate(snap: GuardSnapshot, baseUrl: string, expectCommit: string | null, prev: GuardReport | null, lim: GuardLimits = DEFAULT_LIMITS): GuardReport {
  const checks: GuardCheck[] = [];
  const add = (id: string, ok: boolean, detail: string) => checks.push({ id, ok, detail });
  const h = snap.health, bt = snap.agent?.backtest ?? null;

  add('health', snap.status.health === '200' && h?.ok === true, `GET /api/health -> ${snap.status.health}${h ? `, ok=${h.ok}` : ''}`);
  if (expectCommit) {
    const live = h?.commit ?? null;
    add('commit', !!live && live.startsWith(expectCommit.slice(0, 7)), `live ${live ?? 'unknown'}, expected ${expectCommit.slice(0, 12)}`);
  }
  add('store', h?.store === 'redis', `store=${h?.store ?? 'unknown'} (memory means no database is configured and nothing persists)`);

  // the refresh log stores unix seconds; accept milliseconds too
  const ts = h?.radarUpdatedAt ? (h.radarUpdatedAt < 1e12 ? h.radarUpdatedAt * 1000 : h.radarUpdatedAt) : 0;
  const age = ts ? (snap.at - ts) / 60_000 : Infinity;
  add('radar-fresh', age <= lim.maxRadarAgeMin, Number.isFinite(age) ? `radar updated ${age.toFixed(0)} min ago (limit ${lim.maxRadarAgeMin})` : 'radar has never been updated');
  add('radar-size', (h?.radarMarkets ?? 0) >= lim.minRadarMarkets, `radar kept ${h?.radarMarkets ?? 0} markets (minimum ${lim.minRadarMarkets})`);

  add('record', snap.status.agent === '200' && !!bt && (bt.markets ?? 0) > 0, bt ? `walk-forward: ${bt.markets} markets, ${bt.calls} calls, ${bt.hits} hits` : `GET /api/agent -> ${snap.status.agent}, no backtest`);
  if (bt && prev?.record) {
    const floor = Math.floor(prev.record.markets * (1 - lim.maxRecordDrop));
    add('record-kept', (bt.markets ?? 0) >= floor, `markets ${prev.record.markets} -> ${bt.markets} (floor ${floor})`);
  }

  const record = bt ? { markets: bt.markets ?? 0, calls: bt.calls ?? 0, hits: bt.hits ?? 0, radarMarkets: h?.radarMarkets ?? 0 } : prev?.record ?? null;
  return { ok: checks.every((c) => c.ok), at: snap.at, baseUrl, commit: h?.commit ?? null, checks, record };
}

/** The report as a short Markdown block: what the Watch flow pastes into an incident issue. */
export function toMarkdown(r: GuardReport): string {
  const rows = r.checks.map((c) => `| ${c.ok ? 'pass' : '**FAIL**'} | ${c.id} | ${c.detail} |`).join('\n');
  return `**Sonar Guard: ${r.ok ? 'all checks passed' : 'checks failed'}** on ${r.baseUrl} at ${new Date(r.at).toISOString()} (commit ${r.commit ?? 'unknown'})\n\n| result | check | detail |\n| --- | --- | --- |\n${rows}\n`;
}
