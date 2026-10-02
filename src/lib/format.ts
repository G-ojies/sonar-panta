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

/** A curve price in quote per token: tiny numbers with the zeros counted ("0.0₆364 SOL" is 0.000000364), bigger ones to four figures. */
export function fmtPrice(p: number | null | undefined): string {
  if (p === null || p === undefined || !Number.isFinite(p)) return '--';
  if (p === 0) return '0';
  if (p >= 0.01) return Number(p.toPrecision(4)).toString();
  const zeros = Math.ceil(-Math.log10(p)) - 1; // zeros between the point and the first figure
  const digits = Math.round(p * 10 ** (zeros + 4)).toString().replace(/0+$/, '') || '0';
  const SUB = '₀₁₂₃₄₅₆₇₈₉';
  return zeros >= 3 ? `0.0${String(zeros).split('').map((c) => SUB[Number(c)]).join('')}${digits}` : `0.${'0'.repeat(zeros)}${digits}`;
}

/** A quote amount with its symbol, to a precision that suits its size. */
export function fmtQuote(n: number | null | undefined, symbol: string): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '--';
  const a = Math.abs(n);
  const d = a >= 1000 ? 0 : a >= 100 ? 1 : a >= 1 ? 2 : a >= 0.01 ? 3 : 4;
  return `${n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d })} ${symbol}`;
}

/** A token amount: whole numbers with thousands separators, or k, M, B above. */
export function fmtBase(n: number): string {
  const a = Math.abs(n);
  if (a >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (a >= 1e4) return `${(n / 1e3).toFixed(1)}k`;
  return n.toLocaleString('en-US', { maximumFractionDigits: a >= 1 ? 0 : 4 });
}
