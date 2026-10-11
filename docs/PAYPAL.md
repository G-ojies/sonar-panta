# Sonar Desk: PayPal AI Hackathon entry

Live (PayPal sandbox): https://sonar-desk.onrender.com/desk
Code: https://github.com/G-ojies/sonar-panta (branch `paypal`, MIT)
Deadline: 12 Nov 2026, 12:00 PT. Submit by 11 Nov.

## Devpost fields (draft)

**Name:** Sonar Desk

**Tagline:** Market signals you only pay for when they are right, bought by an AI agent that cannot spend without you.

**Inspiration**
Paid trading signals are sold on trust. A Telegram group charges a monthly fee whether its calls are right or wrong.
Sonar already publishes a public, walk-forward record of its prediction-market calls. We wanted to put money behind it:
if a call is wrong, the buyer gets refunded automatically. And because people increasingly delegate research to AI agents,
we wanted an agent that can buy these signals for you, inside a budget you set, without ever moving money on its own.

**What it does**
- Every open market on Sonar where it has a call sells a **Signal Brief** for $1.99 through PayPal (JS SDK v6 button).
  Buying freezes Sonar's call at that moment (side, score, price). An AI model writes the brief from Sonar's own numbers
  only: the trade tape, the price path and other venues.
- **Accuracy guarantee:** when the market resolves against the frozen call, or is cancelled, Sonar refunds the capture
  through the PayPal Refunds API automatically. The guarantee's record (right / refunded) is public on /desk.
- **Shopping agent** on /desk: you set a mandate (budget, categories, least call strength) and chat. The agent searches
  Sonar's radar, opens a PayPal order for each brief that fits, and stops: every order waits for you to approve it in
  PayPal. The budget and limits are enforced in code on every purchase, not by the model. It can then read and summarise
  the briefs you paid for.
- **Sonar Pro** ($7.99/month, PayPal Subscriptions): every brief included, no checkout per brief.
- **Webhooks:** signature-verified. If you approve and close the tab, the webhook still captures your order and unlocks
  the brief; refunds and subscription changes update the record.

**How we built it**
Next.js 14 on Render. PayPal: Orders v2 (create/capture), Refunds, Subscriptions (product, plan, subscription),
Webhooks with signature verification, JS SDK v6 one-time payment session, and the **PayPal Agent Toolkit**
(`@paypal/agent-toolkit/ai-sdk`, read-only `get_order`) inside the agent. AI: Vercel AI SDK with gpt-oss-120b on Groq
for the agent (tool calling) and the brief writer, with a deterministic template fallback. Data: Sonar's existing radar
(Panta prediction markets on Solana) read from the shared Upstash store; the Desk deployment is read-only so it can never
write the radar.

**What changed since 1 Oct (Sonar existed before the hackathon)**
Everything PayPal and everything agentic is new: the brief checkout and writer, the accuracy guarantee and refund sweep,
the shopping agent and mandate gate, Sonar Pro, webhooks, the /desk pages, and the read-only deployment mode.
Branch `paypal`: about 3,500 lines across 36 files, 14 new tests (143 total).

**Challenges**
- Making the agent safe with money: the model never gets a tool that pays. It opens orders; a person approves in
  PayPal; capture happens on our server only after approval. Budget checks live in `src/lib/mandate.ts`.
- Refunds must never happen twice: PayPal-Request-Id keys every create, capture and refund, so a retried sweep returns
  the first result.
- v6 `presentationMode: 'auto'` fails in some tabs (Payment Request); we use the popup and keep an approve-link fallback.
- Groq retired the Llama model mid-build; moved to gpt-oss-120b and made tool schemas accept null for optional fields.

**Accomplishments**
A refund guarantee that actually runs, end to end in the PayPal sandbox, and an agent that shops but cannot spend.

**What's next**
Partial refunds scaled to how wrong the call was; Pro members credited for missed calls; the agent running on a
schedule against a standing mandate; going live with a PayPal business account.

**Built with:** paypal, paypal-agent-toolkit, paypal-subscriptions, paypal-webhooks, nextjs, typescript, vercel-ai-sdk,
groq, render, upstash, solana

**Test access for judges:** open https://sonar-desk.onrender.com/desk. PayPal sandbox buyer: shown in the submission's
private testing field (sandbox personal account). The free Render instance may take ~50 s to wake.

## Demo video script (under 3 minutes)

1. **0:00 Hook (15 s).** "Trading signals are sold on trust. Sonar Desk sells them with a guarantee: wrong call, money back,
   automatically, through PayPal." Show /desk masthead and the guarantee record.
2. **0:15 Buy a brief (40 s).** Open a market, point at Sonar's call, click Pay with PayPal, approve in the popup with the
   sandbox buyer, the brief appears with "Guarantee open".
3. **0:55 The agent (50 s).** On /desk set budget $4, crypto, strength 20. Type "Find the strongest calls and buy their
   briefs." Show the tool steps (searched Sonar, opened a PayPal order) and the approval card. Ask it to buy the same brief
   again: refused by the server. Approve in PayPal, land on the brief.
4. **1:45 The guarantee (35 s).** Show a settled market: the sweep refunded the wrong call through PayPal (refund id), the
   right one kept. Show the webhook log with verified signatures.
5. **2:20 Sonar Pro (20 s).** Subscribe in PayPal, return, "Sonar Pro is active", read a brief with no checkout.
6. **2:40 Close (15 s).** Stack: PayPal Orders, Refunds, Subscriptions, Webhooks, JS SDK v6, Agent Toolkit; AI SDK + Groq.
   "An agent that shops, but can't spend without you."

Record at 1440x900, no music (or licensed only), upload public to YouTube.
