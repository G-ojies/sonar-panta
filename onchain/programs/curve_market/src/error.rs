use anchor_lang::prelude::*;

#[error_code]
pub enum CurveError {
    #[msg("The pool account is not owned by the DBC program")]
    PoolNotOwnedByDbc,
    #[msg("The pool account is not a VirtualPool or TransferHookPool")]
    PoolDiscriminator,
    #[msg("The pool account is shorter than the DBC pool layout")]
    PoolLayout,
    #[msg("The config account is not owned by the DBC program")]
    ConfigNotOwnedByDbc,
    #[msg("The config account is not a PoolConfig or ConfigWithTransferHook")]
    ConfigDiscriminator,
    #[msg("The config account is shorter than the DBC config layout")]
    ConfigLayout,
    #[msg("The config account does not match the pool's config field")]
    ConfigMismatch,
    #[msg("The quote mint does not match the config's quote_mint field")]
    QuoteMintMismatch,
    #[msg("The quote mint is not owned by the given token program")]
    QuoteMintOwner,
    #[msg("The pool has already graduated or finished its curve")]
    PoolAlreadyComplete,
    #[msg("The deadline is not in the future")]
    DeadlineInPast,
    #[msg("The deadline is more than 180 days away")]
    DeadlineTooFar,
    #[msg("The market is no longer open")]
    MarketNotOpen,
    #[msg("The deadline has passed; the market cannot take new stakes")]
    DeadlinePassed,
    #[msg("The stake is below the minimum")]
    StakeTooSmall,
    #[msg("The pool has not graduated and the deadline has not passed")]
    NotYet,
    #[msg("The market has not been resolved")]
    NotResolved,
    #[msg("The position belongs to a different market")]
    PositionMarketMismatch,
    #[msg("The position has already been claimed")]
    AlreadyClaimed,
    #[msg("Arithmetic overflow")]
    Overflow,
    #[msg("The vault does not match the market")]
    VaultMismatch,
    #[msg("The pool does not match the market")]
    PoolMismatch,
    #[msg("The pool and config are different DBC kinds")]
    PoolKindMismatch,
}
