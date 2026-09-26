'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { PoweredByPanta } from './PoweredByPanta';

export interface LiveStats {
  markets: number; open: number; matched: number; resolved: number;
  btMarkets: number; btCalls: number; btHits: number;
  agentOpen: number; agentClosed: number; agentWon: number; agentRuns: number; updatedAt: number | null;
}

const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : '—');

export function Deck({ live }: { live: LiveStats }) {
  const slides = buildSlides(live);
  const [i, setI] = useState(0);
  const [ready, setReady] = useState(false);
  const go = useCallback((n: number) => setI(Math.max(0, Math.min(slides.length - 1, n))), [slides.length]);

  useEffect(() => {
    const h = Number(window.location.hash.replace('#', ''));
    if (h >= 1 && h <= slides.length) setI(h - 1);
    setReady(true);
  }, [slides.length]);
  useEffect(() => { if (ready) window.history.replaceState(null, '', `#${i + 1}`); }, [i, ready]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (['ArrowRight', ' ', 'PageDown', 'j'].includes(e.key)) { e.preventDefault(); go(i + 1); }
      if (['ArrowLeft', 'PageUp', 'k'].includes(e.key)) { e.preventDefault(); go(i - 1); }
      if (e.key === 'Home') go(0);
      if (e.key === 'End') go(slides.length - 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [i, go, slides.length]);

  return (
    <div className="deck">
      {slides.map((s, k) => (
        <section key={k} className={`slide ${k === i ? 'is-active' : ''}`} aria-hidden={k !== i} data-n={k + 1}>
          <div className="slide-inner">{s}</div>
          <footer className="slide-foot">
            <span className="flex items-center gap-2"><span className="ping-dot" aria-hidden /> Sonar for Panta · Crypto World&apos;s Fair 2026 · Solana track · Superteam Nigeria</span>
            <span className="flex items-center gap-3"><PoweredByPanta compact /><span className="mono">{k + 1}/{slides.length}</span></span>
          </footer>
        </section>
      ))}
      <nav className="deck-nav" aria-label="Slides">
        <button onClick={() => go(i - 1)} disabled={i === 0} aria-label="Previous slide" className="btn h-8 px-3">‹</button>
        <span className="mono text-xs text-fog-2">{i + 1} / {slides.length} · ← → keys · <Link href="/">open the app</Link></span>
        <button onClick={() => go(i + 1)} disabled={i === slides.length - 1} aria-label="Next slide" className="btn h-8 px-3">›</button>
      </nav>
    </div>
  );
}

function Big({ children }: { children: React.ReactNode }) { return <h1 className="text-4xl font-semibold leading-tight tracking-tight sm:text-6xl">{children}</h1>; }
function H({ children, kicker }: { children: React.ReactNode; kicker?: string }) {
  return (<div className="mb-6">{kicker && <div className="mb-2 text-xs uppercase tracking-[0.2em] text-ping">{kicker}</div>}<h2 className="text-3xl font-semibold tracking-tight sm:text-5xl">{children}</h2></div>);
}
function Stat({ v, l, tone }: { v: string; l: string; tone?: 'yes' | 'no' | 'ping' }) {
  return (<div className="panel px-5 py-4"><div className={`mono text-3xl font-semibold sm:text-4xl ${tone === 'yes' ? 'text-yes' : tone === 'no' ? 'text-no' : tone === 'ping' ? 'text-ping' : ''}`}>{v}</div><div className="mt-1 text-xs uppercase tracking-wide text-fog-2">{l}</div></div>);
}
function Shot({ src, alt }: { src: string; alt: string }) {
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt={alt} className="w-full rounded-lg border border-line shadow-2xl shadow-black/40" loading="lazy" />;
}
function Li({ children }: { children: React.ReactNode }) { return <li className="flex gap-3 text-base leading-relaxed text-fog sm:text-lg"><span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-ping" aria-hidden /><span>{children}</span></li>; }
function Src({ children }: { children: React.ReactNode }) { return <p className="mt-6 text-[11px] leading-relaxed text-fog-2">{children}</p>; }

function buildSlides(live: LiveStats): React.ReactNode[] {
  return [
    // 1 — title
    <div key="t" className="flex h-full flex-col justify-center">
      <div className="mb-6 flex items-center gap-3 text-sm text-fog"><span className="ping-dot" aria-hidden /> GreYat Labs · Lagos, Nigeria</div>
      <Big>Sonar <span className="text-fog-2">for</span> Panta</Big>
      <p className="mt-6 max-w-3xl text-xl leading-relaxed text-fog sm:text-2xl">The intelligence layer for on-chain prediction markets. Behavioural signals, cross-venue pricing and one-click non-custodial trading, built on the Panta API on Solana.</p>
      <div className="mt-10 flex flex-wrap gap-2 text-xs">
        {['Colosseum Crypto World’s Fair 2026', 'Solana ecosystem track', 'Superteam Nigeria track', 'Panta API side track', 'MIT licensed'].map((c) => <span key={c} className="chip border border-line bg-ink-2 text-fog">{c}</span>)}
      </div>
    </div>,

    // 2 — problem
    <div key="p">
      <H kicker="Problem">An API gives you prices. It does not give you a read.</H>
      <div className="grid gap-8 lg:grid-cols-2">
        <ul className="space-y-4">
          <Li>Prediction markets became infrastructure in 2026: Kalshi and Polymarket cleared <strong className="text-paper">$44.8B in a single month</strong> (June). Almost all of it off-chain, US-centric, permissioned.</Li>
          <Li>Panta puts permissionless market creation and trading on Solana behind a clean API. But an integrator gets a price and a tape, not history, not analytics, not a view of whether a Panta market is cheap or rich versus the rest of the world.</Li>
          <Li>Traders, creators and bots on Panta fly blind. Thin catalogs stay thin because nobody can see where the edge is.</Li>
          <Li>Nigeria has <strong className="text-paper">~60M active bettors</strong> and a <strong className="text-paper">$3.6B</strong> betting market, football-first and 83% mobile, and <strong className="text-paper">zero</strong> on-chain markets about Nigerian events.</Li>
        </ul>
        <div className="grid grid-cols-2 gap-3 self-start">
          <Stat v="$44.8B" l="Kalshi + Polymarket, June 2026" />
          <Stat v="0" l="price-history endpoints on Panta" tone="no" />
          <Stat v="60M" l="active bettors in Nigeria" />
          <Stat v="0" l="Nigerian markets on Panta today" tone="no" />
        </div>
      </div>
      <Src>Sources: TRM Labs and CoinLaw prediction-market volume trackers (June 2026); GeoPoll “Betting in Africa 2026”; NAN / BusinessDay Nigeria betting market reports (2026). Panta API observations from docs/PANTA-API-FEEDBACK.md.</Src>
    </div>,

    // 3 — product
    <div key="pr">
      <H kicker="Product">One screen from signal to settlement.</H>
      <div className="grid items-start gap-6 lg:grid-cols-5">
        <div className="lg:col-span-3"><Shot src="/screens/radar.png" alt="Sonar radar: every Panta market scored from its tape and priced against Polymarket and Kalshi" /></div>
        <ul className="space-y-3 lg:col-span-2">
          <Li><strong className="text-paper">Radar.</strong> Every market Panta exposes, scored from its own trade tape and priced against Polymarket and Kalshi.</Li>
          <Li><strong className="text-paper">Market.</strong> The read with reasons, our own price history, cross-venue gap, resolution rule, full tape.</Li>
          <Li><strong className="text-paper">Trade.</strong> Quote, sign in your wallet, broadcast, attribute. Non-custodial end to end.</Li>
          <Li><strong className="text-paper">Portfolio.</strong> Positions marked to live prices, one-click claims.</Li>
          <Li><strong className="text-paper">Create.</strong> Headline to resolvable market, Claude drafting the rule, Nigeria starter boards.</Li>
          <Li><strong className="text-paper">Agent.</strong> Unattended paper (or live) trading on every call, settled against Panta&apos;s resolutions.</Li>
        </ul>
      </div>
    </div>,

    // 4 — how the signal works
    <div key="s">
      <H kicker="How it works">The read is built from the tape, not from vibes.</H>
      <div className="grid gap-8 lg:grid-cols-2">
        <ul className="space-y-3">
          <Li><strong className="text-paper">Flow imbalance</strong>: YES minus NO share flow over the last 24h (or last 20 prints when thin).</Li>
          <Li><strong className="text-paper">Momentum</strong>: YES price now vs our oldest snapshot inside 24h. Panta has no history endpoint, so Sonar records one every 10 minutes.</Li>
          <Li><strong className="text-paper">Whale share and concentration</strong>: how much of the tape is one print or one wallet (HHI).</Li>
          <Li><strong className="text-paper">Cross-venue gap</strong>: the same question&apos;s YES price on Polymarket or Kalshi minus Panta&apos;s.</Li>
          <Li>Composite in −100..100: <span className="mono text-paper">0.45·gap + 0.25·flow + 0.2·momentum + 0.1·whale</span>, discounted for thin, stale or single-wallet tape, zero after close.</Li>
        </ul>
        <div className="panel p-5">
          <div className="text-xs uppercase tracking-wide text-fog-2">Two calls from the Panta replay</div>
          <p className="mt-3 text-base leading-relaxed text-paper">“Will Jannik Sinner win the Wimbledon 2026 Championship?”</p>
          <p className="mt-1 text-sm text-fog">Sonar after the 4th of 38 prints: <span className="chip bg-yes/15 text-yes">YES 12</span> at 52¢. Outcome: <span className="text-yes">YES</span>. Hit. All 38 prints decoded from the program log; Panta&apos;s API returned none.</p>
          <p className="mt-4 text-base leading-relaxed text-paper">“Will France win the FIFA World Cup 2026?”</p>
          <p className="mt-1 text-sm text-fog">Sonar after the 6th of 21 prints: <span className="chip bg-no/15 text-no">NO 12</span> with NO at 56¢. Outcome: <span className="text-no">NO</span>. Hit. Same rule the agent runs live, replayed with no look-ahead.</p>
          <p className="mt-4 text-xs text-fog-2">The matcher only pairs questions that share a subject (a name, a ticker, a specific number). No match is reported rather than a wrong one.</p>
        </div>
      </div>
    </div>,

    // 5 — execution
    <div key="e">
      <H kicker="Execution">Non-custodial, attributed, on mainnet.</H>
      <ol className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {[['quote', 'POST /primaryorderquote'], ['build', 'POST /primaryorderbuild'], ['sign', 'user wallet (Phantom, Solflare)'], ['broadcast', 'our RPC, confirmed'], ['submit', 'POST /primaryordersubmit'], ['report', 'POST /trades (attribution)']].map(([k, v], n) => (
          <li key={k} className="panel p-4"><div className="mono text-xs text-ping">0{n + 1}</div><div className="mt-1 text-lg font-medium">{k}</div><div className="mono mt-1 text-[11px] text-fog-2">{v}</div></li>
        ))}
      </ol>
      <div className="mt-8 grid gap-6 lg:grid-cols-2">
        <ul className="space-y-3">
          <Li>Same pattern for claims (<span className="mono">/claim/build</span>) and market creation (<span className="mono">/markets/create/quote → build → register</span>).</Li>
          <Li>14 Panta endpoints integrated behind a typed, rate-limited server client. The API key never reaches the browser.</Li>
          <Li>Stable Panta error codes map to plain-language UI: stale quote, expired quote, market left primary, insufficient USDC.</Li>
          <Li><strong className="text-paper">Sandbox switch.</strong> The same flows run against Panta&apos;s <span className="mono">pk_test_</span> fixtures with an empty wallet, so the product can be demonstrated, tested in CI and taught with zero spend.</Li>
        </ul>
        <Shot src="/screens/market.png" alt="Market page with the Sonar read, cross-venue block and trade panel" />
      </div>
    </div>,

    // 6 — traction (live)
    <div key="tr">
      <H kicker="Traction">A track record, not a promise.</H>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat v="672" l="resolved Sonar signals, Kalshi + Polymarket" />
        <Stat v="57.7%" l="Sonar 30-day win rate off-chain" tone="yes" />
        <Stat v={`${live.btHits}/${live.btCalls}`} l={`replay hits on ${live.btMarkets} resolved Panta markets`} tone="ping" />
        <Stat v={String(live.agentRuns)} l="autonomous agent runs on Panta" />
        <Stat v={String(live.markets)} l="Panta markets on the radar now" />
        <Stat v={String(live.matched)} l="matched to Polymarket / Kalshi" />
        <Stat v={String(live.agentOpen + live.agentClosed)} l={`agent positions (${live.agentWon} won of ${live.agentClosed} settled)`} />
        <Stat v="17" l="Panta API issues documented for the team" />
      </div>
      <ul className="mt-8 space-y-3">
        <Li>Sonar has run live on Kalshi and Polymarket since mid-2026 (sonar.nodalytics.xyz). This build ports the engine to Panta&apos;s on-chain tape and adds what Panta does not expose.</Li>
        <Li>The Panta replay walks every resolved market print by print and opens on the first non-flat read at the price the chain logged then ({pct(live.btHits, live.btCalls)} hit rate, no look-ahead). Panta&apos;s API returns no prints for most of these markets, so Sonar decodes the tape from the program log on chain. Panta&apos;s catalog is young, so the sample is small and reported as-is. The agent has been paper-trading every call since 19 September and settles against Panta&apos;s own resolutions.</Li>
      </ul>
      <Src>Live numbers above are read from the running radar {live.updatedAt ? `(last scan ${new Date(live.updatedAt * 1000).toUTCString()})` : ''}.</Src>
    </div>,

    // 7 — why Nigeria
    <div key="ng">
      <H kicker="Impact · Nigeria">The first Nigerian prediction markets, on Solana, priced honestly.</H>
      <div className="grid gap-8 lg:grid-cols-2">
        <ul className="space-y-4">
          <Li>Nigerians already price everything: CBN rate decisions, the NBS inflation print, the naira, NGX, Super Eagles fixtures, fuel prices. Today that happens on bookmakers with a 10–20% overround and in naira that loses value while the bet is open.</Li>
          <Li>Panta markets are USDC-settled, parimutuel, permissionless and 2-hour resolvable. Sonar&apos;s Create page ships Nigeria starter boards so a creator can list the week&apos;s questions in minutes and earn a share of every trade.</Li>
          <Li>Sonar then does what no bookmaker does: shows the crowd where each market is mispriced against the global tape, and lets them act on it from their own wallet.</Li>
          <Li>Distribution: Superteam Nigeria&apos;s builder and trader community, Solana Mobile, and the university communities where the author teaches and studies.</Li>
        </ul>
        <Shot src="/screens/create.png" alt="Create page with Nigeria starter boards and the drafted market" />
      </div>
    </div>,

    // 8 — business model
    <div key="b">
      <H kicker="Business model">Three revenue lines, one engine.</H>
      <div className="grid gap-4 lg:grid-cols-3">
        {[
          ['Creator fees', 'Sonar creates and seeds the markets its signals say the world is missing (starting with Nigeria) and earns Panta creator fees on every trade they attract.', 'live on Panta today'],
          ['Attribution and order flow', 'Every trade routed through Sonar is reported to Panta with attribution. Panta partners share in the activity they bring; Sonar is built to be the integration that brings it.', 'Panta partner terms'],
          ['Sonar Pro', 'The signal and cross-venue feed as a paid API and embeddable widget for bots, creators and other Panta integrations; later, a managed agent vault.', 'Q1 2027'],
        ].map(([t, d, w]) => (
          <div key={t} className="panel p-5"><div className="text-lg font-medium">{t}</div><p className="mt-2 text-sm leading-relaxed text-fog">{d}</p><div className="mono mt-4 text-[11px] uppercase tracking-wide text-ping">{w}</div></div>
        ))}
      </div>
      <ul className="mt-8 space-y-3">
        <Li>Costs are near zero: one Vercel deployment, one Redis, a scheduled job. The signal engine is deterministic; Claude is used only for drafting.</Li>
        <Li>Venue-neutral by design: the same engine already runs on Kalshi and Polymarket, so Sonar is also the bridge that shows off-chain traders where Solana is mispriced.</Li>
      </ul>
    </div>,

    // 9 — roadmap
    <div key="r">
      <H kicker="Roadmap">Next 90 days.</H>
      <div className="grid gap-4 lg:grid-cols-3">
        {[
          ['October', ['Live agent capital on primary windows', 'Nigeria board: 10 markets live, weekly cadence', 'Panta API feedback loop with the Panta team']],
          ['November', ['Secondary-market trading when Panta ships the endpoints', 'Embeddable Radar widget for creators and communities', 'Telegram alerts on new calls and primary windows']],
          ['December', ['Sonar Pro API (signals + cross-venue feed)', 'Mobile-first PWA for Nigerian traders', 'Colosseum accelerator or Solana Foundation grant milestone plan']],
        ].map(([m, items]) => (
          <div key={m as string} className="panel p-5"><div className="mono text-xs uppercase tracking-wide text-ping">{m}</div><ul className="mt-3 space-y-2">{(items as string[]).map((x) => <li key={x} className="text-sm text-fog">· {x}</li>)}</ul></div>
        ))}
      </div>
    </div>,

    // 10 — team + ask
    <div key="tm" className="flex h-full flex-col justify-center">
      <H kicker="Team">Great Ojietohamen · GreYat Labs, Lagos</H>
      <ul className="space-y-3">
        <Li>Solo founder-engineer. Ships trading infrastructure on Solana: onchain-rbac (Solana Foundation grant), smart-tx-stack, worldcup-match-vault (trustless TxLINE settlement), GroupStage.</Li>
        <Li>Runs Sonar, a live behavioural-signal engine on Kalshi and Polymarket with a public track record.</Li>
        <Li>Everything in this repository was written during the hackathon window against the Panta API. MIT licensed. Signal design carried over from the author&apos;s off-chain product and disclosed.</Li>
      </ul>
      <div className="mt-10 flex flex-wrap items-center gap-4 text-sm">
        <Link href="/" className="btn btn-primary no-underline">Open the live app</Link>
        <a href="https://github.com/G-ojies/sonar-panta" className="btn no-underline" target="_blank" rel="noopener noreferrer">GitHub</a>
        <span className="text-fog-2">sonar.nodalytics.xyz · @G-ojies</span>
      </div>
    </div>,
  ];
}
