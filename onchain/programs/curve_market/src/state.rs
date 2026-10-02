use anchor_lang::prelude::*;

pub const MARKET_SEED: &[u8] = b"market";
pub const VAULT_SEED: &[u8] = b"vault";
pub const POSITION_SEED: &[u8] = b"position";

/// Smallest stake accepted, in base units of the quote token.
/// 1_000_000 is 0.001 SOL for a 9-decimal mint or 1 USDC for a 6-decimal mint.
pub const MIN_STAKE: u64 = 1_000_000;

/// Longest allowed distance between now and a market deadline.
pub const MAX_DEADLINE_SECS: i64 = 180 * 24 * 60 * 60;

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, PartialEq, Eq, InitSpace)]
pub enum Side {
    Yes,
    No,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, PartialEq, Eq, InitSpace)]
pub enum MarketState {
    /// Taking stakes until the deadline, or until the pool graduates.
    Open,
    /// Resolved YES: the pool graduated before the deadline. YES stakes win.
    ResolvedYes,
    /// Resolved NO: the deadline passed first. NO stakes win.
    ResolvedNo,
    /// One side had no stake at resolution. Everyone takes back what they put in.
    Refund,
}

#[account]
#[derive(InitSpace, Debug)]
pub struct Market {
    /// The DBC `VirtualPool` the market is about.
    pub pool: Pubkey,
    /// The DBC `PoolConfig` the pool points at.
    pub config: Pubkey,
    /// The pool's quote mint. Stakes and payouts are in this token.
    pub quote_mint: Pubkey,
    /// The token program that owns `quote_mint` (Token or Token-2022).
    pub token_program: Pubkey,
    /// The market's token account holding every stake.
    pub vault: Pubkey,
    /// Who created the market. Carries no rights.
    pub creator: Pubkey,
    /// Unix time. YES wins if the curve finishes at or before it.
    pub deadline_ts: i64,
    /// `migration_quote_threshold` read from the config at creation.
    pub migration_quote_threshold: u64,
    /// Sum of YES stakes actually received by the vault.
    pub yes_total: u64,
    /// Sum of NO stakes actually received by the vault.
    pub no_total: u64,
    /// Sum of payouts sent out of the vault so far.
    pub paid_out: u64,
    pub state: MarketState,
    /// Unix time of resolution, zero while open.
    pub resolved_at: i64,
    pub bump: u8,
    pub vault_bump: u8,
}

impl Market {
    pub fn total_pool(&self) -> Option<u64> {
        self.yes_total.checked_add(self.no_total)
    }

    pub fn is_open(&self) -> bool {
        self.state == MarketState::Open
    }
}

#[account]
#[derive(InitSpace, Debug)]
pub struct Position {
    pub market: Pubkey,
    pub owner: Pubkey,
    pub yes_amount: u64,
    pub no_amount: u64,
    pub claimed: bool,
    pub bump: u8,
}
