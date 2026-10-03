//! Sonar Curve: parimutuel YES/NO markets on whether a Meteora Dynamic Bonding
//! Curve pool graduates before a deadline.
//!
//! No admin key, no fees, no pause. Resolution reads the DBC pool account
//! directly, so there is no oracle to trust.

#![allow(unexpected_cfgs)]

use anchor_lang::prelude::*;
use anchor_spl::token_interface::{
    self, Mint, TokenAccount, TokenInterface, TransferChecked,
};

pub mod dbc;
pub mod error;
pub mod state;

pub use error::CurveError;
pub use state::*;

declare_id!("DPsFa2nxH568WZdeAgmdaxBrS3Je4UK4K7axxzCYAqjp");

// ---------------------------------------------------------------------------
// Pure logic. Kept free of accounts so it can be unit tested on the host.
// ---------------------------------------------------------------------------

/// Decide a market from a pool snapshot, the config threshold, the deadline
/// and the current time. Returns `None` while the question is still open.
///
/// Order of precedence:
/// 1. `finish_curve_timestamp` is the authoritative time the curve finished.
///    YES if it is at or before the deadline, NO otherwise (even if migrated).
/// 2. `is_migrated == 1` with no timestamp (pools older than the field) is YES.
/// 3. `quote_reserve >= migration_quote_threshold` observed at or before the
///    deadline is YES; the curve is complete now, so it completed in time.
/// 4. Past the deadline with none of the above is NO.
pub fn decide(pool: &dbc::PoolView, threshold: u64, deadline_ts: i64, now: i64) -> Option<Side> {
    if pool.finish_curve_timestamp > 0 {
        let finished = i64::try_from(pool.finish_curve_timestamp).unwrap_or(i64::MAX);
        return Some(if finished <= deadline_ts { Side::Yes } else { Side::No });
    }
    if pool.is_migrated == 1 {
        return Some(Side::Yes);
    }
    if pool.quote_reserve >= threshold && now <= deadline_ts {
        return Some(Side::Yes);
    }
    if now > deadline_ts {
        return Some(Side::No);
    }
    None
}

/// Pro-rata payout for a winning stake. Floors, so the sum over all winners
/// never exceeds `total_pool`.
pub fn payout_for(winning_stake: u64, winning_total: u64, total_pool: u64) -> Result<u64> {
    if winning_stake == 0 {
        return Ok(0);
    }
    require!(winning_total > 0, CurveError::Overflow);
    let payout = (winning_stake as u128)
        .checked_mul(total_pool as u128)
        .ok_or(CurveError::Overflow)?
        .checked_div(winning_total as u128)
        .ok_or(CurveError::Overflow)?;
    u64::try_from(payout).map_err(|_| CurveError::Overflow.into())
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

#[event]
pub struct MarketCreated {
    pub market: Pubkey,
    pub pool: Pubkey,
    pub config: Pubkey,
    pub quote_mint: Pubkey,
    pub creator: Pubkey,
    pub deadline_ts: i64,
    pub migration_quote_threshold: u64,
}

#[event]
pub struct Staked {
    pub market: Pubkey,
    pub user: Pubkey,
    pub side: Side,
    pub amount: u64,
    pub yes_total: u64,
    pub no_total: u64,
}

#[event]
pub struct Resolved {
    pub market: Pubkey,
    pub state: MarketState,
    pub yes_total: u64,
    pub no_total: u64,
    pub resolved_at: i64,
    pub is_migrated: u8,
    pub finish_curve_timestamp: u64,
    pub quote_reserve: u64,
}

#[event]
pub struct Claimed {
    pub market: Pubkey,
    pub user: Pubkey,
    pub state: MarketState,
    pub yes_amount: u64,
    pub no_amount: u64,
    pub payout: u64,
}

// ---------------------------------------------------------------------------
// Instructions
// ---------------------------------------------------------------------------

#[program]
pub mod curve_market {
    use super::*;

    /// Open a market on `pool` with the question "does the curve finish at or
    /// before `deadline_ts`?". Anyone can create one; the creator gets nothing
    /// beyond a market to trade in.
    pub fn create_market(ctx: Context<CreateMarket>, deadline_ts: i64) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        require!(deadline_ts > now, CurveError::DeadlineInPast);
        let max_deadline = now.checked_add(MAX_DEADLINE_SECS).ok_or(CurveError::Overflow)?;
        require!(deadline_ts <= max_deadline, CurveError::DeadlineTooFar);

        let (pool, config) = dbc::read_pool_and_config(&ctx.accounts.pool, &ctx.accounts.config)?;
        require_keys_eq!(
            config.quote_mint,
            ctx.accounts.quote_mint.key(),
            CurveError::QuoteMintMismatch
        );
        require!(
            !pool.curve_complete(config.migration_quote_threshold),
            CurveError::PoolAlreadyComplete
        );

        let market = &mut ctx.accounts.market;
        market.pool = ctx.accounts.pool.key();
        market.config = ctx.accounts.config.key();
        market.quote_mint = ctx.accounts.quote_mint.key();
        market.token_program = ctx.accounts.token_program.key();
        market.vault = ctx.accounts.vault.key();
        market.creator = ctx.accounts.creator.key();
        market.deadline_ts = deadline_ts;
        market.migration_quote_threshold = config.migration_quote_threshold;
        market.yes_total = 0;
        market.no_total = 0;
        market.paid_out = 0;
        market.state = MarketState::Open;
        market.resolved_at = 0;
        market.bump = ctx.bumps.market;
        market.vault_bump = ctx.bumps.vault;

        emit!(MarketCreated {
            market: market.key(),
            pool: market.pool,
            config: market.config,
            quote_mint: market.quote_mint,
            creator: market.creator,
            deadline_ts,
            migration_quote_threshold: config.migration_quote_threshold,
        });
        Ok(())
    }

    /// Move `amount` of the quote token into the vault on `side`. The amount
    /// credited is what the vault actually received, so a Token-2022 transfer
    /// fee cannot inflate a position.
    pub fn stake(ctx: Context<Stake>, side: Side, amount: u64) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let market = &mut ctx.accounts.market;
        require!(market.is_open(), CurveError::MarketNotOpen);
        require!(now <= market.deadline_ts, CurveError::DeadlinePassed);
        require!(amount >= MIN_STAKE, CurveError::StakeTooSmall);

        let before = ctx.accounts.vault.amount;
        token_interface::transfer_checked(
            CpiContext::new(
                ctx.accounts.token_program.key(),
                TransferChecked {
                    from: ctx.accounts.user_token.to_account_info(),
                    mint: ctx.accounts.quote_mint.to_account_info(),
                    to: ctx.accounts.vault.to_account_info(),
                    authority: ctx.accounts.user.to_account_info(),
                },
            ),
            amount,
            ctx.accounts.quote_mint.decimals,
        )?;
        ctx.accounts.vault.reload()?;
        let received = ctx
            .accounts
            .vault
            .amount
            .checked_sub(before)
            .ok_or(CurveError::Overflow)?;
        require!(received >= MIN_STAKE, CurveError::StakeTooSmall);

        let position = &mut ctx.accounts.position;
        if position.owner == Pubkey::default() {
            position.market = market.key();
            position.owner = ctx.accounts.user.key();
            position.yes_amount = 0;
            position.no_amount = 0;
            position.claimed = false;
            position.bump = ctx.bumps.position;
        }
        require_keys_eq!(position.market, market.key(), CurveError::PositionMarketMismatch);

        match side {
            Side::Yes => {
                position.yes_amount = position
                    .yes_amount
                    .checked_add(received)
                    .ok_or(CurveError::Overflow)?;
                market.yes_total = market
                    .yes_total
                    .checked_add(received)
                    .ok_or(CurveError::Overflow)?;
            }
            Side::No => {
                position.no_amount = position
                    .no_amount
                    .checked_add(received)
                    .ok_or(CurveError::Overflow)?;
                market.no_total = market
                    .no_total
                    .checked_add(received)
                    .ok_or(CurveError::Overflow)?;
            }
        }
        // The pool total must always fit in a u64.
        market.total_pool().ok_or(CurveError::Overflow)?;

        emit!(Staked {
            market: market.key(),
            user: ctx.accounts.user.key(),
            side,
            amount: received,
            yes_total: market.yes_total,
            no_total: market.no_total,
        });
        Ok(())
    }

    /// Settle the market from the pool account. Anyone can call it.
    pub fn resolve(ctx: Context<Resolve>) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let market = &mut ctx.accounts.market;
        require!(market.is_open(), CurveError::MarketNotOpen);

        // `has_one` already tied `pool` and `config` to the keys stored at
        // creation; this re-checks the pool still names that config.
        let (pool, config) = dbc::read_pool_and_config(&ctx.accounts.pool, &ctx.accounts.config)?;

        let winner = decide(&pool, config.migration_quote_threshold, market.deadline_ts, now)
            .ok_or(CurveError::NotYet)?;

        market.state = if market.yes_total == 0 || market.no_total == 0 {
            MarketState::Refund
        } else {
            match winner {
                Side::Yes => MarketState::ResolvedYes,
                Side::No => MarketState::ResolvedNo,
            }
        };
        market.resolved_at = now;

        emit!(Resolved {
            market: market.key(),
            state: market.state,
            yes_total: market.yes_total,
            no_total: market.no_total,
            resolved_at: now,
            is_migrated: pool.is_migrated,
            finish_curve_timestamp: pool.finish_curve_timestamp,
            quote_reserve: pool.quote_reserve,
        });
        Ok(())
    }

    /// Pay out a position and close it to its owner. Winners get their stake
    /// plus a pro-rata share of the losing side. Refund markets return both
    /// sides. Losers get nothing but their rent back.
    pub fn claim(ctx: Context<Claim>) -> Result<()> {
        let market = &mut ctx.accounts.market;
        let position = &mut ctx.accounts.position;
        require!(!market.is_open(), CurveError::NotResolved);
        require!(!position.claimed, CurveError::AlreadyClaimed);

        let total_pool = market.total_pool().ok_or(CurveError::Overflow)?;
        let payout = match market.state {
            MarketState::ResolvedYes => {
                payout_for(position.yes_amount, market.yes_total, total_pool)?
            }
            MarketState::ResolvedNo => {
                payout_for(position.no_amount, market.no_total, total_pool)?
            }
            MarketState::Refund => position
                .yes_amount
                .checked_add(position.no_amount)
                .ok_or(CurveError::Overflow)?,
            MarketState::Open => return Err(CurveError::NotResolved.into()),
        };

        position.claimed = true;

        if payout > 0 {
            let deadline_bytes = market.deadline_ts.to_le_bytes();
            let seeds: &[&[u8]] = &[
                MARKET_SEED,
                market.pool.as_ref(),
                &deadline_bytes,
                &[market.bump],
            ];
            token_interface::transfer_checked(
                CpiContext::new_with_signer(
                    ctx.accounts.token_program.key(),
                    TransferChecked {
                        from: ctx.accounts.vault.to_account_info(),
                        mint: ctx.accounts.quote_mint.to_account_info(),
                        to: ctx.accounts.user_token.to_account_info(),
                        authority: market.to_account_info(),
                    },
                    &[seeds],
                ),
                payout,
                ctx.accounts.quote_mint.decimals,
            )?;
            market.paid_out = market
                .paid_out
                .checked_add(payout)
                .ok_or(CurveError::Overflow)?;
            require!(market.paid_out <= total_pool, CurveError::Overflow);
        }

        emit!(Claimed {
            market: market.key(),
            user: ctx.accounts.user.key(),
            state: market.state,
            yes_amount: position.yes_amount,
            no_amount: position.no_amount,
            payout,
        });
        Ok(())
    }
}

// ---------------------------------------------------------------------------
// Accounts
// ---------------------------------------------------------------------------

#[derive(Accounts)]
#[instruction(deadline_ts: i64)]
pub struct CreateMarket<'info> {
    #[account(mut)]
    pub creator: Signer<'info>,

    /// A DBC `VirtualPool` or `TransferHookPool`.
    /// CHECK: owner, discriminator and layout are verified in `dbc::read_pool`.
    pub pool: UncheckedAccount<'info>,

    /// A DBC `PoolConfig` or `ConfigWithTransferHook`, of the same kind as the
    /// pool; the key must equal `pool.config`.
    /// CHECK: owner, discriminator and layout are verified in `dbc::read_config`.
    pub config: UncheckedAccount<'info>,

    #[account(
        constraint = quote_mint.to_account_info().owner == &token_program.key() @ CurveError::QuoteMintOwner,
    )]
    pub quote_mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(
        init,
        payer = creator,
        space = 8 + Market::INIT_SPACE,
        seeds = [MARKET_SEED, pool.key().as_ref(), &deadline_ts.to_le_bytes()],
        bump,
    )]
    pub market: Box<Account<'info, Market>>,

    #[account(
        init,
        payer = creator,
        seeds = [VAULT_SEED, market.key().as_ref()],
        bump,
        token::mint = quote_mint,
        token::authority = market,
        token::token_program = token_program,
    )]
    pub vault: Box<InterfaceAccount<'info, TokenAccount>>,

    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Stake<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    #[account(
        mut,
        seeds = [MARKET_SEED, market.pool.as_ref(), &market.deadline_ts.to_le_bytes()],
        bump = market.bump,
        has_one = quote_mint @ CurveError::QuoteMintMismatch,
        has_one = vault @ CurveError::VaultMismatch,
        has_one = token_program @ CurveError::QuoteMintOwner,
    )]
    pub market: Box<Account<'info, Market>>,

    #[account(
        init_if_needed,
        payer = user,
        space = 8 + Position::INIT_SPACE,
        seeds = [POSITION_SEED, market.key().as_ref(), user.key().as_ref()],
        bump,
    )]
    pub position: Box<Account<'info, Position>>,

    pub quote_mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(
        mut,
        token::mint = quote_mint,
        token::authority = user,
        token::token_program = token_program,
    )]
    pub user_token: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(
        mut,
        seeds = [VAULT_SEED, market.key().as_ref()],
        bump = market.vault_bump,
    )]
    pub vault: Box<InterfaceAccount<'info, TokenAccount>>,

    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Resolve<'info> {
    #[account(
        mut,
        seeds = [MARKET_SEED, market.pool.as_ref(), &market.deadline_ts.to_le_bytes()],
        bump = market.bump,
        has_one = pool @ CurveError::PoolMismatch,
        has_one = config @ CurveError::ConfigMismatch,
    )]
    pub market: Box<Account<'info, Market>>,

    /// CHECK: must equal `market.pool`; owner and layout verified in `dbc::read_pool`.
    pub pool: UncheckedAccount<'info>,

    /// CHECK: must equal `market.config`; owner and layout verified in `dbc::read_config`.
    pub config: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct Claim<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    #[account(
        mut,
        seeds = [MARKET_SEED, market.pool.as_ref(), &market.deadline_ts.to_le_bytes()],
        bump = market.bump,
        has_one = quote_mint @ CurveError::QuoteMintMismatch,
        has_one = vault @ CurveError::VaultMismatch,
        has_one = token_program @ CurveError::QuoteMintOwner,
    )]
    pub market: Box<Account<'info, Market>>,

    #[account(
        mut,
        close = user,
        seeds = [POSITION_SEED, market.key().as_ref(), user.key().as_ref()],
        bump = position.bump,
        has_one = market @ CurveError::PositionMarketMismatch,
        constraint = position.owner == user.key() @ CurveError::PositionMarketMismatch,
    )]
    pub position: Box<Account<'info, Position>>,

    pub quote_mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(
        mut,
        token::mint = quote_mint,
        token::token_program = token_program,
    )]
    pub user_token: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(
        mut,
        seeds = [VAULT_SEED, market.key().as_ref()],
        bump = market.vault_bump,
    )]
    pub vault: Box<InterfaceAccount<'info, TokenAccount>>,

    pub token_program: Interface<'info, TokenInterface>,
}
