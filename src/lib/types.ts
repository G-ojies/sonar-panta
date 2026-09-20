export type Phase = 'primary' | 'secondary' | 'resolved' | 'cancelled';
export type MarketType = 'standard' | 'breaking';

/** Row from GET /markets/ (list) — titles are often blank on list rows. */
export interface MarketRow {
  marketId: string;
  category: string;
  title: string;
  description: string;
  images: string[];
  phase: Phase;
  marketType: MarketType;
  startTime: number;
  endTime: number;
  resolutionTime: number;
  region: string;
  resolved: boolean;
  status: string;
  volumeUsdc: string | null;
  totalVolumeUsdc?: string | null;
  campaignId: string | null;
  createdByPartner: boolean;
  yesPrice: string | null;
  noPrice: string | null;
  primaryYesPrice: string | null;
  primaryNoPrice: string | null;
  secondaryYesPrice: string | null;
  secondaryNoPrice: string | null;
}

export interface OnChainState {
  creator?: string;
  question?: string;
  createdAt?: number;
  resolvedAt?: number;
  totalYesShares?: string;
  totalNoShares?: string;
  lastYesPrice?: string;
  totalVolume?: string;
  totalYesVolume?: string;
  totalNoVolume?: string;
  totalTrades?: string;
  isActive?: boolean;
  isGraduated?: boolean;
  isResolved?: boolean;
  isCancelled?: boolean;
  yesWins?: boolean;
  primaryPhaseEndTime?: number;
  flashAcquisitionEnd?: number;
  graduationThreshold?: string;
  primaryPoolLamports?: string;
  resolutionRule?: string;
  sources?: string[];
  oracleResultSubmitted?: boolean;
  oracleProposedYesWins?: boolean;
  currentSkewBps?: string;
  [k: string]: unknown;
}

/** GET /markets/{id}/ — the rich row. */
export interface MarketDetail extends MarketRow {
  creatorAddress?: string;
  oracle?: string;
  programId?: string;
  question?: string;
  resolutionRule?: string;
  sources?: string[];
  isGraduated?: boolean;
  totalTrades?: string;
  createdAt?: number;
  resolvedAt?: number;
  priceSource?: string;
  valuationStatus?: string;
  onChain?: OnChainState | null;
}

export interface Trade {
  id: string;
  marketId: string;
  wallet: string;
  isPrimary: boolean;
  kind: 'buy' | 'claim' | string;
  side: 'yes' | 'no' | string;
  shares: string;
  sharesBase?: string;
  yesAmount: number | string;
  noAmount: number | string;
  feePaid: number | string;
  amountUsdc: string | null;
  blockTime: number | null;
  signature: string;
  quoteAsset: string;
}

export interface Position {
  marketId: string;
  category: string | null;
  side: 'yes' | 'no';
  shares: string;
  phase: Phase;
  claimable: boolean;
  claimed: boolean;
  outcome: 'yes' | 'no' | null;
}

export interface PositionsResponse {
  wallet: string;
  positions: Position[];
  summary?: {
    currentValueUsdc: string;
    primaryContributedUsdc: string;
    valuedPositions: number;
    unvaluedPositions: number;
  };
}

export interface BuyQuote {
  quoteId: string;
  marketId: string;
  side: string;
  amountUsdc: string;
  shares: string;
  avgPrice?: string;
  feeUsdc: string;
  expiresAt: string;
}

export interface BuiltInstruction {
  programId: string;
  data: string; // base64
  accounts: { pubkey: string; isSigner: boolean; isWritable: boolean }[];
}

export interface BuyBuild {
  orderId: string;
  quoteId: string;
  wallet: string;
  marketId: string;
  side: string;
  instructions: BuiltInstruction[];
  expectedShares?: string;
  recentBlockhash: string;
  lastValidBlockHeight?: number;
}

export interface CreateQuote {
  createId: string;
  expectedEventPda: string;
  paymentUsdc: string;
  liquidityInjectionUsdc: string;
  platformRevenueUsdc: string;
  marketType: MarketType;
  expiresAt: string;
}

export interface CreateBuild {
  createId: string;
  expectedEventPda: string;
  transaction: string; // base64 VersionedTransaction
  recentBlockhash: string;
  lastValidBlockHeight: number;
  paymentUsdc: string;
}

export interface PantaError {
  code: string;
  message?: string;
  field?: string;
  fields?: Record<string, string[]>;
}

/** Sonar-computed view of a market. */
export interface SignalSet {
  /** -1..1, positive = YES flow dominates recent tape */
  flowImbalance: number;
  /** yes price change vs previous snapshot (fraction, e.g. +0.04) */
  momentum: number | null;
  /** 0..1, share of tape volume from the single largest print */
  whaleShare: number;
  /** Herfindahl index of wallet volume, 0..1 (1 = one wallet) */
  concentration: number;
  /** trades per hour over the last 6h */
  velocity: number;
  /** seconds since last trade, null if no trades */
  staleness: number | null;
  /** seconds to endTime (negative if ended) */
  timeToClose: number;
  /** venue yes price minus panta yes price, null if unmatched */
  crossVenueGap: number | null;
  /** composite -100..100; sign is the favoured side */
  score: number;
  side: 'YES' | 'NO' | 'FLAT';
  confidence: 'high' | 'medium' | 'low';
  reasons: string[];
}

export interface VenueMatch {
  venue: 'polymarket' | 'kalshi';
  id: string;
  question: string;
  url: string;
  yesPrice: number;
  volume24h: number | null;
  endDate: string | null;
  similarity: number;
}

export interface RadarMarket {
  detail: MarketDetail;
  yesPrice: number | null;
  tape: Trade[];
  signals: SignalSet;
  venue: VenueMatch | null;
  tradable: boolean;
  updatedAt: number;
}

export interface Snapshot {
  marketId: string;
  ts: number;
  yesPrice: number | null;
  volumeUsdc: number;
  trades: number;
}
