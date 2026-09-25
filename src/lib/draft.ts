/**
 * "Headline → market": turn a news line or URL into a well-formed Panta market spec.
 * Uses Claude when ANTHROPIC_API_KEY is set; otherwise a deterministic template so the
 * flow always works.
 */
import Anthropic from '@anthropic-ai/sdk';

export interface Draft {
  question: string; title: string; description: string; resolutionRule: string; sourcesOfTruth: string[];
  category: string; endTime: number; resolutionTime: number; marketType: 'standard' | 'breaking'; rationale: string; via: 'claude' | 'template';
}

const CATS = ['sports', 'crypto', 'politics', 'entertainment', 'finance', 'science', 'world', 'other'];

export function templateDraft(input: string, now = Date.now() / 1000): Draft {
  const text = input.trim().replace(/\s+/g, ' ');
  const isUrl = /^https?:\/\//i.test(text);
  const subject = isUrl ? text.replace(/^https?:\/\/(www\.)?/, '').split(/[/?#]/)[0] : text;
  const cat = /bitcoin|btc|eth|solana|sol\b|token|crypto|defi/i.test(text) ? 'crypto' : /election|president|senate|parliament|minister|vote/i.test(text) ? 'politics' : /match|league|cup|goal|nba|nfl|f1|grand prix|win the/i.test(text) ? 'sports' : /stock|nasdaq|earnings|fed|rate|inflation|gdp|cpi/i.test(text) ? 'finance' : 'other';
  const end = now + 7 * 86400;
  const q = /\?$/.test(text) ? text : `Will ${subject.replace(/^will\s+/i, '')} happen by ${new Date(end * 1000).toISOString().slice(0, 10)}?`;
  return {
    question: q.slice(0, 500), title: q.slice(0, 80), description: `Drafted by Sonar from: ${text.slice(0, 200)}`,
    resolutionRule: `Resolves YES if the event described in the question is confirmed by the listed source of truth before the end time (UTC). Otherwise resolves NO.`,
    sourcesOfTruth: isUrl ? [text] : ['https://www.reuters.com'], category: cat, endTime: Math.floor(end), resolutionTime: Math.floor(end + 3600),
    marketType: 'standard', rationale: 'Template draft (no ANTHROPIC_API_KEY set). Edit the question and rule before quoting.', via: 'template',
  };
}

export async function draftMarket(input: string, now = Date.now() / 1000): Promise<Draft> {
  if (!process.env.ANTHROPIC_API_KEY) return templateDraft(input, now);
  const client = new Anthropic();
  const today = new Date(now * 1000).toISOString();
  let res: Awaited<ReturnType<typeof client.messages.create>>;
  try {
    res = await client.messages.create({
    model: 'claude-sonnet-5',
    max_tokens: 1200,
    system: `You draft binary prediction markets for Panta (Solana). Output only JSON matching the schema. Rules: the question must be a single, objectively verifiable YES/NO event with a fixed deadline; the resolutionRule must name the exact data source and the precise condition, timezone UTC; sourcesOfTruth are 1-3 public URLs; category is one of ${CATS.join(', ')}; endTime and resolutionTime are unix seconds, endTime at least 2 hours after now (${today}) and resolutionTime >= endTime; marketType is "breaking" only if the event resolves within 48 hours. Keep the title under 80 chars.`,
    messages: [{ role: 'user', content: `Draft one market from this input:\n\n${input}\n\nReturn JSON with keys: question, title, description, resolutionRule, sourcesOfTruth, category, endTime, resolutionTime, marketType, rationale.` }],
    });
  } catch { return templateDraft(input, now); } // bad or missing key, network, rate limit: the template still works
  if (!('content' in res)) return templateDraft(input, now);
  const text = res.content.map((c) => (c.type === 'text' ? c.text : '')).join('');
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return templateDraft(input, now);
  try {
    const j = JSON.parse(m[0]) as Partial<Draft>;
    const end = Math.max(Number(j.endTime) || 0, now + 7200);
    return {
      question: String(j.question ?? '').slice(0, 500), title: String(j.title ?? j.question ?? '').slice(0, 80), description: String(j.description ?? ''),
      resolutionRule: String(j.resolutionRule ?? '').slice(0, 2000), sourcesOfTruth: (j.sourcesOfTruth ?? []).filter((s) => /^https?:\/\//.test(String(s))).slice(0, 20).map(String),
      category: CATS.includes(String(j.category)) ? String(j.category) : 'other', endTime: Math.floor(end), resolutionTime: Math.floor(Math.max(Number(j.resolutionTime) || 0, end)),
      marketType: j.marketType === 'breaking' ? 'breaking' : 'standard', rationale: String(j.rationale ?? ''), via: 'claude',
    };
  } catch { return templateDraft(input, now); }
}
