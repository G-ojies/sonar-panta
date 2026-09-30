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
  /** YES price right after this print (0..1). Known for prints decoded from the program log; the API does not send it. */
  price?: number | null;
  /** Where the print came from: Panta's trades endpoint, or the program's own log on chain. */
  source?: 'api' | 'chain';
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
  /** resolved, with a complete tape: the row is final and later scans carry it over untouched */
  settled?: boolean;
}

export interface Snapshot {
  marketId: string;
  ts: number;
  yesPrice: number | null;
  volumeUsdc: number;
  trades: number;
}

/** State of the live tape stream, as /api/health and the market page show it. Times are unix seconds. */
export interface StreamHealth {
  enabled: boolean;
  /** Subscribed and receiving: the socket is open and the node confirmed the log subscription. */
  connected: boolean;
  /** Who carries the stream: RPC Fast, Solami, a custom RPC, or the public mainnet endpoint. */
  provider: 'rpcfast' | 'solami' | 'custom' | 'public';
  host: string;
  /** A provider is configured but refused the stream, so the fallback endpoint carries it. */
  fallback: boolean;
  startedAt: number | null;
  connectedAt: number | null;
  /** Last frame or pong from the node: proof the socket is alive on a quiet program. */
  lastAliveAt: number | null;
  /** Last program transaction the node pushed. */
  lastEventAt: number | null;
  /** Slot of the newest program transaction seen, live or while closing a gap. */
  lastSlot: number | null;
  lastPrintAt: number | null;
  /** Program transactions pushed since start, and the prints decoded from them. */
  events: number;
  prints: number;
  /** Prints recovered by the catch-up after a reconnect or restart. */
  recovered: number;
  /** Orders whose market could not be identified; the next scan picks them up. */
  unmapped: number;
  reconnects: number;
  note: string | null;
}

/** Which provider each chain path is on right now: the RPC that rebuilds tapes, and the live stream. */
export interface ChainHealth {
  rpc: { provider: StreamHealth['provider']; host: string; /** A provider is configured but refused the key, so the fallback answers. */ fallback: boolean };
  stream: StreamHealth;
  /** The same in words, for example "RPC: RPC Fast, stream: RPC Fast". */
  paths: string;
}
