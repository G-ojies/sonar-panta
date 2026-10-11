/**
 * Sonar Desk shopping agent. A person gives it a mandate ("crypto calls, score 30+, at most $6"); it searches Sonar's
 * radar, buys the briefs that fit, and reads the ones already paid for. It can open PayPal orders but never pay them:
 * every order waits for the person's approval in PayPal, and the budget is checked in code (mayBuy), not by the model.
 * Model: gpt-oss-120b on Groq through the AI SDK. PayPal: our Orders client for purchases (so the guarantee can track them)
 * and the PayPal Agent Toolkit's get_order so the agent can see which purchases were approved.
 */
import { createGroq } from '@ai-sdk/groq';
import { PayPalAgentToolkit } from '@paypal/agent-toolkit/ai-sdk';
import { generateText, tool, type CoreMessage } from 'ai';
import { z } from 'zod';
import { candidates, committed, mayBuy, type Mandate } from './mandate';
import { openBrief, paypal, readBriefText, sessionBriefs } from './desk';
import { paypalConfig } from './paypal';
import { readRadar } from './radar';

export interface ShopperStep { tool: string; args: unknown; result: unknown }
export interface ShopperReply { text: string; steps: ShopperStep[]; approvals: Array<{ briefId: string; marketId: string; title: string; side: string; approveUrl: string | null; orderId: string }>; spentCents: number; budgetCents: number }

const SYSTEM = (m: Mandate, spent: number) => `You are Sonar Desk's shopping agent. You buy Sonar Signal Briefs ($1.99 each, paid with PayPal) for the user, inside their mandate, and explain what you bought.
Mandate: budget ${(m.maxCents / 100).toFixed(2)} USD (${(spent / 100).toFixed(2)} already committed this session); categories: ${m.categories.length ? m.categories.join(', ') : 'any'}; minimum |score| ${m.minScore}; skip markets closing within ${m.minHoursLeft} hours.
Rules: call find_calls before buying. Buy only markets find_calls returned. buy_brief opens a PayPal order the user must approve; you cannot pay it yourself, so say clearly that each purchase is waiting for their approval. If buy_brief refuses, accept the reason and do not retry the same market. Use check_purchases to see which briefs are paid, and read_brief to summarise paid ones. Every brief is refunded automatically if its call turns out wrong. Be brief and concrete: market, side, score, why. Never invent markets or numbers.`;

export async function runShopper(opts: { session: string; mandate: Mandate; messages: CoreMessage[]; returnUrl: string }): Promise<ShopperReply> {
  const key = process.env.GROQ_API_KEY;
  if (!key) throw new Error('GROQ_API_KEY is not set, so the shopping agent is offline');
  const cfg = paypalConfig();
  if (!cfg) throw new Error('PayPal is not configured');
  const groq = createGroq({ apiKey: key });
  const pp = paypal();
  const radar = await readRadar();
  const markets = radar?.markets ?? [];
  const approvals: ShopperReply['approvals'] = [];
  const startBriefs = await sessionBriefs(opts.session);

  // PayPal's own agent tools; only reading orders, so the model can never move money with them
  const toolkit = new PayPalAgentToolkit({ clientId: cfg.clientId, clientSecret: cfg.clientSecret, configuration: { actions: { orders: { get: true } }, context: { sandbox: cfg.env === 'sandbox' } } });
  const ppTools = toolkit.getTools();

  const tools = {
    find_calls: tool({
      description: "List open markets where Sonar has a call that fits the user's mandate, strongest first.",
      parameters: z.object({ category: z.string().nullish().describe('optional narrower category, e.g. crypto, sports') }),
      execute: async ({ category }) => {
        const m = category ? { ...opts.mandate, categories: [category.toLowerCase()] } : opts.mandate;
        const allowedCats = opts.mandate.categories;
        const list = candidates(markets, m).filter((c) => !allowedCats.length || allowedCats.includes(c.category.toLowerCase()));
        return list.length ? list : { none: 'no open market fits the mandate right now' };
      },
    }),
    buy_brief: tool({
      description: 'Open a $1.99 PayPal order for the brief on one market. The user approves it in PayPal; you cannot pay it.',
      parameters: z.object({ marketId: z.string(), why: z.string().describe('one line: why this call is worth buying') }),
      execute: async ({ marketId, why }) => {
        const market = markets.find((x) => x.detail.marketId === marketId) ?? null;
        const check = mayBuy(market, opts.mandate, await sessionBriefs(opts.session));
        if (!check.ok) return { refused: check.reason };
        const r = await openBrief(marketId, 'agent', pp, market, { session: opts.session, returnUrl: opts.returnUrl });
        approvals.push({ briefId: r.brief.id, marketId, title: r.brief.title, side: r.brief.call.side, approveUrl: r.approveUrl, orderId: r.orderId });
        return { opened: true, orderId: r.orderId, side: r.brief.call.side, price: '$1.99', status: 'waiting for the user to approve in PayPal', why };
      },
    }),
    check_purchases: tool({
      description: 'Briefs bought in this session and whether each is waiting for approval, paid, kept or refunded.',
      parameters: z.object({}),
      execute: async () => (await sessionBriefs(opts.session)).map((b) => ({ briefId: b.id, orderId: b.orderId, title: b.title, side: b.call.side, status: b.status })),
    }),
    read_brief: tool({
      description: 'Read a paid brief from this session.',
      parameters: z.object({ briefId: z.string() }),
      execute: async ({ briefId }) => {
        const b = (await sessionBriefs(opts.session)).find((x) => x.id === briefId);
        if (!b) return { error: 'not a brief from this session' };
        if (b.status === 'pending') return { error: 'not paid yet: the user has to approve it in PayPal first' };
        return { title: b.title, call: b.call, status: b.status, brief: await readBriefText(b.id) };
      },
    }),
    paypal_get_order: ppTools.get_order,
  };

  const res = await generateText({
    model: groq(process.env.GROQ_AGENT_MODEL ?? 'openai/gpt-oss-120b'),
    system: SYSTEM(opts.mandate, committed(startBriefs)),
    messages: opts.messages.slice(-12),
    tools,
    maxSteps: 8,
    temperature: 0.2,
  });

  const steps = res.steps.flatMap((s) => s.toolCalls.map((c, i) => ({ tool: c.toolName, args: c.args, result: (s.toolResults[i] as { result?: unknown } | undefined)?.result })));
  return { text: res.text, steps, approvals, spentCents: committed(await sessionBriefs(opts.session)), budgetCents: opts.mandate.maxCents };
}
