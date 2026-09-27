/**
 * The Nigeria board: this week's questions, drafted as complete Panta market specs.
 *
 * Panta lists no market about Nigeria. These are the six things Nigerians argue about every week
 * (the CBN rate, the NBS inflation print, the naira, the NGX, the Super Eagles, the pump price), each
 * written as a YES/NO question with a rule that names the exact source and condition, so a creator can
 * load one on /create, quote it and sign. No model is needed: the spec is the draft. Figures in
 * `context` are as of the week the board was written and are for the reader, not the rule.
 */
import type { Draft } from './draft';

export interface Board extends Draft {
  id: string;
  /** short chip label */
  label: string;
  /** the number the question hangs on, as it stood when the board was written */
  context: string;
  imageUrl: string;
}

export const BOARD_WEEK = 'week of 28 September 2026';
const IMG = 'https://sonarpanta.xyz/logo.png';
const utc = (s: string) => Math.floor(Date.parse(s) / 1000);

export const BOARDS: Board[] = [
  {
    id: 'cbn', label: 'CBN rate', via: 'board', imageUrl: IMG, category: 'finance', marketType: 'standard',
    question: 'Will the CBN cut the Monetary Policy Rate again at the 23–24 November 2026 MPC meeting?',
    title: 'CBN: another MPR cut in November 2026?',
    description: 'The Central Bank of Nigeria cut the MPR by 350 basis points to 23.00% on 22 September 2026, the largest cut in its history. This market asks whether the next Monetary Policy Committee meeting cuts again.',
    resolutionRule: 'Resolves YES if the communiqué of the 308th Monetary Policy Committee meeting (scheduled 23–24 November 2026), as published on cbn.gov.ng, sets the Monetary Policy Rate strictly below 23.00%. Resolves NO if the rate is held at 23.00% or raised, or if no MPC decision is published on cbn.gov.ng by 30 November 2026 23:59 UTC.',
    sourcesOfTruth: ['https://www.cbn.gov.ng/MonetaryPolicy/decisions.html', 'https://www.cbn.gov.ng/MonetaryPolicy/calendar.html'],
    endTime: utc('2026-11-23T00:00:00Z'), resolutionTime: utc('2026-11-25T00:00:00Z'),
    context: 'MPR 23.00% after the 22 September cut from 26.50%; corridor +50/−300 bps.',
    rationale: 'Board spec: the rule names the CBN communiqué and the exact threshold.',
  },
  {
    id: 'nbs', label: 'NBS inflation', via: 'board', imageUrl: IMG, category: 'finance', marketType: 'standard',
    question: 'Will Nigeria\'s September 2026 headline inflation print below 15.39%?',
    title: 'NBS: September inflation below 15.39%?',
    description: 'The National Bureau of Statistics reported headline inflation of 15.39% year-on-year for August 2026, the third monthly fall in a row. This market asks whether the September print falls again.',
    resolutionRule: 'Resolves YES if the NBS Consumer Price Index report for September 2026, published on nigerianstat.gov.ng, states a headline (all-items) year-on-year inflation rate strictly below 15.39%. Resolves NO if the rate is 15.39% or higher, or if the report is not published by 31 October 2026 23:59 UTC. The first published figure counts; later revisions are ignored.',
    sourcesOfTruth: ['https://www.nigerianstat.gov.ng/'],
    endTime: utc('2026-10-14T12:00:00Z'), resolutionTime: utc('2026-10-31T23:59:00Z'),
    context: 'August 2026: 15.39% headline, 19.57% food, 0.71% month-on-month.',
    rationale: 'Board spec: the rule names the NBS CPI report and the exact threshold.',
  },
  {
    id: 'naira', label: 'Naira', via: 'board', imageUrl: IMG, category: 'finance', marketType: 'standard',
    question: 'Will the naira close stronger than ₦1,330 per US dollar on the official market on 30 October 2026?',
    title: 'Naira: NFEM close under ₦1,330/$ on 30 October?',
    description: 'The official NFEM rate has held between ₦1,322 and ₦1,330 per dollar through September 2026 while reserves rose above $54 billion. This market asks where it closes at the end of October.',
    resolutionRule: 'Resolves YES if the Nigerian Foreign Exchange Market (NFEM) closing rate for Friday 30 October 2026, as published by the Central Bank of Nigeria on cbn.gov.ng, is strictly below 1,330.00 naira per US dollar. Resolves NO if it is 1,330.00 or higher. If 30 October is not a trading day, the last published closing rate before it counts.',
    sourcesOfTruth: ['https://www.cbn.gov.ng/rates/ExchRateByCurrency.asp'],
    endTime: utc('2026-10-30T12:00:00Z'), resolutionTime: utc('2026-10-31T12:00:00Z'),
    context: 'NFEM close ₦1,326.06/$ on 25 September; parallel market ₦1,374–1,380.',
    rationale: 'Board spec: the rule names the CBN rate page and the exact threshold.',
  },
  {
    id: 'ngx', label: 'NGX', via: 'board', imageUrl: IMG, category: 'finance', marketType: 'standard',
    question: 'Will the NGX All-Share Index close October 2026 above 252,113.41 points?',
    title: 'NGX: All-Share Index above 252,113.41 at end of October?',
    description: 'The NGX All-Share Index closed at 252,113.41 on 25 September 2026, up 62% for the year after ten straight sessions of gains. This market asks whether it ends October higher than that.',
    resolutionRule: 'Resolves YES if the official closing value of the NGX All-Share Index on the last trading day of October 2026 (expected Friday 30 October), as published by Nigerian Exchange Limited on ngxgroup.com, is strictly above 252,113.41. Resolves NO otherwise.',
    sourcesOfTruth: ['https://ngxgroup.com/exchange/data/equities-price-list/', 'https://ngxgroup.com/'],
    endTime: utc('2026-10-30T12:00:00Z'), resolutionTime: utc('2026-10-31T12:00:00Z'),
    context: 'ASI 252,113.41 on 25 September; market cap ₦163.66 trillion; +62.01% year to date.',
    rationale: 'Board spec: the rule names the NGX close and the exact threshold.',
  },
  {
    id: 'eagles', label: 'Super Eagles', via: 'board', imageUrl: IMG, category: 'sports', marketType: 'breaking',
    question: 'Will Nigeria beat Guinea-Bissau in their AFCON 2027 qualifier on 29 September 2026?',
    title: 'Super Eagles to beat Guinea-Bissau on 29 September?',
    description: 'Matchday 2 of the CAF Africa Cup of Nations 2027 qualifiers: Nigeria away to Guinea-Bissau on 29 September 2026, after opening at home to Madagascar in Uyo on 25 September.',
    resolutionRule: 'Resolves YES if Nigeria wins the CAF AFCON 2027 qualifying match against Guinea-Bissau scheduled for 29 September 2026 at the end of regulation time (90 minutes plus stoppage), per the official result on cafonline.com. A draw or a Guinea-Bissau win resolves NO. If the match is not completed by 2 October 2026 23:59 UTC, resolves NO.',
    sourcesOfTruth: ['https://www.cafonline.com/', 'https://www.thenff.com/'],
    endTime: utc('2026-09-29T12:00:00Z'), resolutionTime: utc('2026-09-30T00:00:00Z'),
    context: 'AFCON 2027 qualifiers, matchdays 1 and 2 between 24 September and 6 October; matchdays 3 and 4 in November.',
    rationale: 'Board spec: the rule names the CAF result and settles on regulation time.',
  },
  {
    id: 'petrol', label: 'Pump price', via: 'board', imageUrl: IMG, category: 'other', marketType: 'standard',
    question: 'Will Dangote\'s ex-gantry petrol price be below ₦1,300 per litre on 31 October 2026?',
    title: 'Petrol: Dangote gantry price under ₦1,300 by end of October?',
    description: 'Dangote Refinery raised its petrol (PMS) gantry price to ₦1,350 per litre on 12 September 2026 and later trimmed it to ₦1,325. Pump prices in Lagos are around ₦1,385 and in Abuja around ₦1,430. This market asks whether the refinery price falls under ₦1,300 by the end of October.',
    resolutionRule: 'Resolves YES if the Dangote Petroleum Refinery ex-gantry (ex-depot) price for Premium Motor Spirit in force on 31 October 2026, as published by Dangote Industries or reported by the Major Energies Marketers Association of Nigeria (MEMAN), is strictly below ₦1,300 per litre. Resolves NO otherwise. Where the two sources disagree, MEMAN\'s published figure counts.',
    sourcesOfTruth: ['https://www.dangote.com/', 'https://meman.org.ng/'],
    endTime: utc('2026-10-31T00:00:00Z'), resolutionTime: utc('2026-11-01T12:00:00Z'),
    context: 'Dangote gantry ₦1,325/l after the 12 September rise to ₦1,350; Lagos pump ₦1,385, Abuja ₦1,430.',
    rationale: 'Board spec: the rule names Dangote and MEMAN and the exact threshold.',
  },
];

export const boardById = (id: string | null | undefined): Board | null => BOARDS.find((b) => b.id === id) ?? null;
