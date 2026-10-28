//! Sonar Graduation Markets: pm-AMM YES/NO markets on whether a Meteora Dynamic
//! Bonding Curve pool graduates before a deadline, with no resolver key.
//!
//! pm-AMM prices the market. This program is the market's authority, through a
//! PDA per market, so nobody holds the key that picks the winner:
//!
//! - `open_market` checks the DBC pool, creates the pm-AMM market with the PDA
//!   as authority and seeds its liquidity from the opener.
//! - `halt` is permissionless. Once the pool account shows the outcome, it
//!   withdraws the PDA's whole LP position. pm-AMM refuses swaps when the
//!   market has no liquidity, so trading stops as soon as the answer is public
//!   instead of letting informed traders drain the LP until `end_ts`.
//! - `resolve` is permissionless after the deadline and resolves with the side
//!   the pool account decides, using `curve_market::decide`.
//!
//! The PDA is the pm-AMM market creator, so the creator half of the swap fee
//! lands in its collateral account.

#![allow(unexpected_cfgs)]

use anchor_lang::prelude::*;
use anchor_lang::solana_program::program::invoke_signed;
use anchor_lang::system_program;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer};
use curve_market::{dbc, decide, Side};

pub mod pm;

declare_id!("73G7X9FKEgTtNQMBWGsCGZfHHBpvVxsJ9kqvV6mvubJH");

pub const BINDING_SEED: &[u8] = b"binding";
pub const AUTHORITY_SEED: &[u8] = b"authority";
pub const COLLATERAL_SEED: &[u8] = b"collateral";
pub const YES_SEED: &[u8] = b"yes";
pub const NO_SEED: &[u8] = b"no";

/// SOL moved from the opener to the market authority PDA so it can pay rent for
/// the accounts pm-AMM creates (market, two mints, vault, two metadata
/// accounts, LP position). What is left stays with the PDA.
pub const AUTHORITY_FUNDING_LAMPORTS: u64 = 60_000_000;

/// pm-AMM refuses markets shorter than five minutes.
pub const MIN_DURATION_SECS: i64 = 300;

/// Same cap as `curve_market`: bounds exposure to a DBC layout change.
pub const MAX_DEADLINE_SECS: i64 = curve_market::MAX_DEADLINE_SECS;

/// pm-AMM keeps the name in a 64-byte field.
pub const MAX_NAME_LEN: usize = 64;

/// The pm-AMM `market_id` for a binding: the first eight bytes of its address.
/// Deterministic, so the pm-AMM market address follows from the binding.
pub fn market_id_for(binding: &Pubkey) -> u64 {
    let b = binding.to_bytes();
    u64::from_le_bytes([b[0], b[1], b[2], b[3], b[4], b[5], b[6], b[7]])
}

fn pm_side(side: Side) -> u8 {
    match side {
        Side::Yes => pm::SIDE_YES,
        Side::No => pm::SIDE_NO,
    }
}

#[error_code]
pub enum ResolverError {
    #[msg("The deadline must be at least five minutes away")]
    DeadlineTooSoon,
    #[msg("The deadline is more than 180 days away")]
    DeadlineTooFar,
    #[msg("The pool has already graduated or finished its curve")]
    PoolAlreadyComplete,
    #[msg("The market name is longer than 64 bytes")]
    NameTooLong,
    #[msg("The outcome is not known yet")]
    NotYet,
    #[msg("The market has already been halted")]
    AlreadyHalted,
    #[msg("The market has already been resolved")]
    AlreadyResolved,
    #[msg("The pm-AMM market does not belong to this binding")]
    MarketMismatch,
    #[msg("The account is not a pm-AMM account of the expected type")]
    NotPmAmmAccount,
}

#[account]
#[derive(InitSpace, Debug)]
pub struct Binding {
    /// The DBC pool the question is about.
    pub pool: Pubkey,
    /// The DBC config the pool points at.
    pub config: Pubkey,
    /// The pm-AMM market this binding is the authority of.
    pub pm_market: Pubkey,
    /// Who opened the market and seeded its liquidity.
    pub opener: Pubkey,
    pub collateral_mint: Pubkey,
    /// Unix time. YES wins if the curve finishes at or before it. Also the
    /// pm-AMM `end_ts`.
    pub deadline_ts: i64,
    /// `migration_quote_threshold` read from the config at opening.
    pub migration_quote_threshold: u64,
    pub market_id: u64,
    /// Collateral the opener seeded as liquidity.
    pub seed_amount: u64,
    /// Liquidity withdrawn because the outcome became known.
    pub halted: bool,
    pub resolved: bool,
    pub bump: u8,
    pub authority_bump: u8,
}

#[event]
pub struct MarketOpened {
    pub binding: Pubkey,
    pub pool: Pubkey,
    pub pm_market: Pubkey,
    pub opener: Pubkey,
    pub deadline_ts: i64,
    pub seed_amount: u64,
    pub initial_price_bps: u16,
}

#[event]
pub struct MarketHalted {
    pub binding: Pubkey,
    pub pm_market: Pubkey,
    pub outcome: Side,
    pub shares_withdrawn: u128,
    pub at: i64,
}

#[event]
pub struct MarketResolved {
    pub binding: Pubkey,
    pub pm_market: Pubkey,
    pub outcome: Side,
    pub at: i64,
}

#[program]
pub mod grad_resolver {
    use super::*;

    /// Open a pm-AMM market on "does `pool` finish its curve at or before
    /// `deadline_ts`?" and seed it with `seed_amount` of the opener's collateral.
    pub fn open_market(
        ctx: Context<OpenMarket>,
        deadline_ts: i64,
        initial_price_bps: u16,
        seed_amount: u64,
        name: String,
    ) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        require!(
            deadline_ts >= now.checked_add(MIN_DURATION_SECS).ok_or(ResolverError::DeadlineTooFar)?,
            ResolverError::DeadlineTooSoon
        );
        require!(
            deadline_ts <= now.checked_add(MAX_DEADLINE_SECS).ok_or(ResolverError::DeadlineTooFar)?,
            ResolverError::DeadlineTooFar
        );
        require!(name.len() <= MAX_NAME_LEN, ResolverError::NameTooLong);

        let (pool, config) = dbc::read_pool_and_config(&ctx.accounts.pool, &ctx.accounts.config)?;
        require!(
            !pool.curve_complete(config.migration_quote_threshold),
            ResolverError::PoolAlreadyComplete
        );

        let binding_key = ctx.accounts.binding.key();
        let market_id = market_id_for(&binding_key);
        let authority_bump = ctx.bumps.authority;
        let signer_seeds: &[&[u8]] = &[AUTHORITY_SEED, binding_key.as_ref(), &[authority_bump]];

        // Rent for what pm-AMM creates comes out of the PDA, so fund it first.
        system_program::transfer(
            CpiContext::new(
                ctx.accounts.system_program.key(),
                system_program::Transfer {
                    from: ctx.accounts.opener.to_account_info(),
                    to: ctx.accounts.authority.to_account_info(),
                },
            ),
            AUTHORITY_FUNDING_LAMPORTS,
        )?;

        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.key(),
                Transfer {
                    from: ctx.accounts.opener_collateral.to_account_info(),
                    to: ctx.accounts.authority_collateral.to_account_info(),
                    authority: ctx.accounts.opener.to_account_info(),
                },
            ),
            seed_amount,
        )?;

        let a = &ctx.accounts;
        invoke_signed(
            &pm::initialize_market_ix(
                &[
                    a.authority.to_account_info(),
                    a.pm_market.to_account_info(),
                    a.collateral_mint.to_account_info(),
                    a.yes_mint.to_account_info(),
                    a.no_mint.to_account_info(),
                    a.pm_vault.to_account_info(),
                    a.yes_metadata.to_account_info(),
                    a.no_metadata.to_account_info(),
                    a.token_metadata_program.to_account_info(),
                    a.system_program.to_account_info(),
                    a.token_program.to_account_info(),
                    a.rent.to_account_info(),
                ],
                pm::encode_initialize_market(market_id, deadline_ts, &name, initial_price_bps),
            ),
            &[
                a.authority.to_account_info(),
                a.pm_market.to_account_info(),
                a.collateral_mint.to_account_info(),
                a.yes_mint.to_account_info(),
                a.no_mint.to_account_info(),
                a.pm_vault.to_account_info(),
                a.yes_metadata.to_account_info(),
                a.no_metadata.to_account_info(),
                a.token_metadata_program.to_account_info(),
                a.system_program.to_account_info(),
                a.token_program.to_account_info(),
                a.rent.to_account_info(),
                a.pm_amm_program.to_account_info(),
            ],
            &[signer_seeds],
        )?;

        let deposit_accounts = [
            a.authority.to_account_info(),
            a.pm_market.to_account_info(),
            a.collateral_mint.to_account_info(),
            a.pm_vault.to_account_info(),
            a.authority_collateral.to_account_info(),
            a.lp_position.to_account_info(),
            a.system_program.to_account_info(),
            a.token_program.to_account_info(),
        ];
        invoke_signed(
            &pm::deposit_liquidity_ix(&deposit_accounts, seed_amount),
            &[&deposit_accounts[..], &[a.pm_amm_program.to_account_info()]].concat(),
            &[signer_seeds],
        )?;

        // pm-AMM derived the market from `market_id`; make sure it is ours.
        let view = pm::read_market(&a.pm_market)?;
        require_keys_eq!(view.authority, a.authority.key(), ResolverError::MarketMismatch);
        require!(view.market_id == market_id, ResolverError::MarketMismatch);

        let binding = &mut ctx.accounts.binding;
        binding.pool = ctx.accounts.pool.key();
        binding.config = ctx.accounts.config.key();
        binding.pm_market = ctx.accounts.pm_market.key();
        binding.opener = ctx.accounts.opener.key();
        binding.collateral_mint = ctx.accounts.collateral_mint.key();
        binding.deadline_ts = deadline_ts;
        binding.migration_quote_threshold = config.migration_quote_threshold;
        binding.market_id = market_id;
        binding.seed_amount = seed_amount;
        binding.halted = false;
        binding.resolved = false;
        binding.bump = ctx.bumps.binding;
        binding.authority_bump = authority_bump;

        emit!(MarketOpened {
            binding: binding_key,
            pool: binding.pool,
            pm_market: binding.pm_market,
            opener: binding.opener,
            deadline_ts,
            seed_amount,
            initial_price_bps,
        });
        Ok(())
    }

    /// Withdraw all of the market's liquidity once the pool shows the outcome,
    /// so nobody can trade against it knowing the answer. Anyone can call it.
    pub fn halt(ctx: Context<Halt>) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let binding = &ctx.accounts.binding;
        require!(!binding.halted, ResolverError::AlreadyHalted);
        require!(!binding.resolved, ResolverError::AlreadyResolved);

        let (pool, _) = dbc::read_pool_and_config(&ctx.accounts.pool, &ctx.accounts.config)?;
        let outcome = decide(&pool, binding.migration_quote_threshold, binding.deadline_ts, now)
            .ok_or(ResolverError::NotYet)?;

        let a = &ctx.accounts;
        let view = pm::read_market(&a.pm_market)?;
        require_keys_eq!(view.authority, a.authority.key(), ResolverError::MarketMismatch);
        require_keys_eq!(view.collateral_mint, a.collateral_mint.key(), ResolverError::MarketMismatch);
        require_keys_eq!(view.yes_mint, a.yes_mint.key(), ResolverError::MarketMismatch);
        require_keys_eq!(view.no_mint, a.no_mint.key(), ResolverError::MarketMismatch);
        let lp = pm::read_lp_position(&a.lp_position)?;
        require_keys_eq!(lp.owner, a.authority.key(), ResolverError::MarketMismatch);
        require_keys_eq!(lp.market, a.pm_market.key(), ResolverError::MarketMismatch);

        let shares = lp.shares;
        let binding_key = binding.key();
        let signer_seeds: &[&[u8]] = &[AUTHORITY_SEED, binding_key.as_ref(), &[binding.authority_bump]];

        if shares > 0 {
            let withdraw_accounts = [
                a.authority.to_account_info(),
                a.pm_market.to_account_info(),
                a.collateral_mint.to_account_info(),
                a.yes_mint.to_account_info(),
                a.no_mint.to_account_info(),
                a.lp_position.to_account_info(),
                a.authority_yes.to_account_info(),
                a.authority_no.to_account_info(),
                a.token_program.to_account_info(),
            ];
            invoke_signed(
                &pm::withdraw_liquidity_ix(&withdraw_accounts, shares),
                &[&withdraw_accounts[..], &[a.pm_amm_program.to_account_info()]].concat(),
                &[signer_seeds],
            )?;
        }

        let binding = &mut ctx.accounts.binding;
        binding.halted = true;
        emit!(MarketHalted {
            binding: binding_key,
            pm_market: binding.pm_market,
            outcome,
            shares_withdrawn: shares,
            at: now,
        });
        Ok(())
    }

    /// Resolve the pm-AMM market from the pool account. Anyone can call it once
    /// pm-AMM's `end_ts` (the deadline) has passed.
    pub fn resolve(ctx: Context<Resolve>) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let binding = &ctx.accounts.binding;
        require!(!binding.resolved, ResolverError::AlreadyResolved);

        let (pool, _) = dbc::read_pool_and_config(&ctx.accounts.pool, &ctx.accounts.config)?;
        let outcome = decide(&pool, binding.migration_quote_threshold, binding.deadline_ts, now)
            .ok_or(ResolverError::NotYet)?;

        let binding_key = binding.key();
        let signer_seeds: &[&[u8]] = &[AUTHORITY_SEED, binding_key.as_ref(), &[binding.authority_bump]];
        let a = &ctx.accounts;
        invoke_signed(
            &pm::resolve_market_ix(&a.authority, &a.pm_market, pm_side(outcome)),
            &[a.authority.to_account_info(), a.pm_market.to_account_info(), a.pm_amm_program.to_account_info()],
            &[signer_seeds],
        )?;

        let binding = &mut ctx.accounts.binding;
        binding.resolved = true;
        emit!(MarketResolved {
            binding: binding_key,
            pm_market: binding.pm_market,
            outcome,
            at: now,
        });
        Ok(())
    }
}

#[derive(Accounts)]
#[instruction(deadline_ts: i64)]
pub struct OpenMarket<'info> {
    #[account(mut)]
    pub opener: Signer<'info>,

    /// CHECK: owner, discriminator and layout verified in `dbc::read_pool`.
    pub pool: UncheckedAccount<'info>,

    /// CHECK: verified in `dbc::read_config`; must be the pool's config.
    pub config: UncheckedAccount<'info>,

    #[account(
        init,
        payer = opener,
        space = 8 + Binding::INIT_SPACE,
        seeds = [BINDING_SEED, pool.key().as_ref(), &deadline_ts.to_le_bytes()],
        bump,
    )]
    pub binding: Box<Account<'info, Binding>>,

    /// The pm-AMM market authority for this binding. Holds lamports only.
    #[account(mut, seeds = [AUTHORITY_SEED, binding.key().as_ref()], bump)]
    pub authority: SystemAccount<'info>,

    pub collateral_mint: Box<Account<'info, Mint>>,

    #[account(
        mut,
        token::mint = collateral_mint,
        token::authority = opener,
    )]
    pub opener_collateral: Box<Account<'info, TokenAccount>>,

    /// The authority's collateral account: seeds the LP and receives the
    /// creator half of the swap fee.
    #[account(
        init,
        payer = opener,
        seeds = [COLLATERAL_SEED, binding.key().as_ref()],
        bump,
        token::mint = collateral_mint,
        token::authority = authority,
    )]
    pub authority_collateral: Box<Account<'info, TokenAccount>>,

    /// CHECK: created by pm-AMM at `["market", market_id]`; pm-AMM checks the seeds.
    #[account(mut)]
    pub pm_market: UncheckedAccount<'info>,
    /// CHECK: created by pm-AMM; seeds checked there.
    #[account(mut)]
    pub yes_mint: UncheckedAccount<'info>,
    /// CHECK: created by pm-AMM; seeds checked there.
    #[account(mut)]
    pub no_mint: UncheckedAccount<'info>,
    /// CHECK: created by pm-AMM; seeds checked there.
    #[account(mut)]
    pub pm_vault: UncheckedAccount<'info>,
    /// CHECK: created by Metaplex through pm-AMM.
    #[account(mut)]
    pub yes_metadata: UncheckedAccount<'info>,
    /// CHECK: created by Metaplex through pm-AMM.
    #[account(mut)]
    pub no_metadata: UncheckedAccount<'info>,
    /// CHECK: created by pm-AMM at `["lp", market, authority]`; seeds checked there.
    #[account(mut)]
    pub lp_position: UncheckedAccount<'info>,

    /// CHECK: address pinned.
    #[account(address = pm::PM_AMM_PROGRAM_ID)]
    pub pm_amm_program: UncheckedAccount<'info>,
    /// CHECK: address pinned; pm-AMM checks it too.
    #[account(address = pm::TOKEN_METADATA_PROGRAM_ID)]
    pub token_metadata_program: UncheckedAccount<'info>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
pub struct Halt<'info> {
    #[account(mut)]
    pub caller: Signer<'info>,

    #[account(
        mut,
        seeds = [BINDING_SEED, binding.pool.as_ref(), &binding.deadline_ts.to_le_bytes()],
        bump = binding.bump,
        has_one = pool @ ResolverError::MarketMismatch,
        has_one = config @ ResolverError::MarketMismatch,
        has_one = pm_market @ ResolverError::MarketMismatch,
        has_one = collateral_mint @ ResolverError::MarketMismatch,
    )]
    pub binding: Box<Account<'info, Binding>>,

    /// CHECK: must equal `binding.pool`; verified in `dbc::read_pool`.
    pub pool: UncheckedAccount<'info>,
    /// CHECK: must equal `binding.config`; verified in `dbc::read_config`.
    pub config: UncheckedAccount<'info>,

    #[account(mut, seeds = [AUTHORITY_SEED, binding.key().as_ref()], bump = binding.authority_bump)]
    pub authority: SystemAccount<'info>,

    /// CHECK: must equal `binding.pm_market`; read with `pm::read_market`.
    #[account(mut)]
    pub pm_market: UncheckedAccount<'info>,
    pub collateral_mint: Box<Account<'info, Mint>>,
    /// Checked against the market in the handler.
    #[account(mut)]
    pub yes_mint: Box<Account<'info, Mint>>,
    /// Checked against the market in the handler.
    #[account(mut)]
    pub no_mint: Box<Account<'info, Mint>>,

    /// CHECK: read with `pm::read_lp_position`; owner and market checked in the handler.
    #[account(mut)]
    pub lp_position: UncheckedAccount<'info>,

    #[account(
        init_if_needed,
        payer = caller,
        seeds = [YES_SEED, binding.key().as_ref()],
        bump,
        token::mint = yes_mint,
        token::authority = authority,
    )]
    pub authority_yes: Box<Account<'info, TokenAccount>>,
    #[account(
        init_if_needed,
        payer = caller,
        seeds = [NO_SEED, binding.key().as_ref()],
        bump,
        token::mint = no_mint,
        token::authority = authority,
    )]
    pub authority_no: Box<Account<'info, TokenAccount>>,

    /// CHECK: address pinned.
    #[account(address = pm::PM_AMM_PROGRAM_ID)]
    pub pm_amm_program: UncheckedAccount<'info>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Resolve<'info> {
    #[account(
        mut,
        seeds = [BINDING_SEED, binding.pool.as_ref(), &binding.deadline_ts.to_le_bytes()],
        bump = binding.bump,
        has_one = pool @ ResolverError::MarketMismatch,
        has_one = config @ ResolverError::MarketMismatch,
        has_one = pm_market @ ResolverError::MarketMismatch,
    )]
    pub binding: Box<Account<'info, Binding>>,

    /// CHECK: must equal `binding.pool`; verified in `dbc::read_pool`.
    pub pool: UncheckedAccount<'info>,
    /// CHECK: must equal `binding.config`; verified in `dbc::read_config`.
    pub config: UncheckedAccount<'info>,

    #[account(seeds = [AUTHORITY_SEED, binding.key().as_ref()], bump = binding.authority_bump)]
    pub authority: SystemAccount<'info>,

    /// CHECK: must equal `binding.pm_market`; pm-AMM checks the authority.
    #[account(mut)]
    pub pm_market: UncheckedAccount<'info>,

    /// CHECK: address pinned.
    #[account(address = pm::PM_AMM_PROGRAM_ID)]
    pub pm_amm_program: UncheckedAccount<'info>,
}
