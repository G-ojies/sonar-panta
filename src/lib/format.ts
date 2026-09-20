export const cents = (p: number | null | undefined) => (p === null || p === undefined ? '--' : `${Math.round(p * 100)}¢`);
export const pct = (x: number, d = 0) => `${(x * 100).toFixed(d)}%`;
export const usd = (x: number | string | null | undefined, d = 2) => {
  const n = Number(x ?? 0);
  if (!Number.isFinite(n)) return '--';
  if (Math.abs(n) >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (Math.abs(n) >= 1e4) return `$${(n / 1e3).toFixed(1)}k`;
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d })}`;
};
export function ago(sec: number | null | undefined): string {
  if (sec === null || sec === undefined) return 'never';
  const s = Math.max(0, Math.round(sec));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.round(s / 60)}m`;
  if (s < 86400) return `${Math.round(s / 3600)}h`;
  return `${Math.round(s / 86400)}d`;
}
export function untilText(sec: number): string {
  if (sec <= 0) return `ended ${ago(-sec)} ago`;
  return `closes in ${ago(sec)}`;
}
export const short = (a: string, n = 4) => (a.length > 2 * n + 1 ? `${a.slice(0, n)}…${a.slice(-n)}` : a);
export const dateShort = (unix: number) => new Date(unix * 1000).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
