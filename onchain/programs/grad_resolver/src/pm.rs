//! The slice of pm-AMM this program uses: four instructions and two accounts.
//!
//! Hand-rolled, like the DBC reads in `curve_market::dbc`: discriminators and
//! offsets come from pm-AMM's IDL (`onchain/pm-amm-idl.json`) and
//! `tests/pm_layout.rs` checks every constant against it.

use anchor_lang::prelude::*;
use anchor_lang::solana_program::instruction::{AccountMeta, Instruction};

use crate::ResolverError;

pub const PM_AMM_PROGRAM_ID: Pubkey = pubkey!("GV1FMGHRYBjQLaghE5fnGuYCuCcpdt3GD5xEX3TwN16y");
pub const TOKEN_METADATA_PROGRAM_ID: Pubkey = pubkey!("metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s");

pub const INITIALIZE_MARKET_DISCRIMINATOR: [u8; 8] = [35, 35, 189, 193, 155, 48, 170, 203];
pub const DEPOSIT_LIQUIDITY_DISCRIMINATOR: [u8; 8] = [245, 99, 59, 25, 151, 71, 233, 249];
pub const WITHDRAW_LIQUIDITY_DISCRIMINATOR: [u8; 8] = [149, 158, 33, 185, 47, 243, 253, 31];
pub const RESOLVE_MARKET_DISCRIMINATOR: [u8; 8] = [155, 23, 80, 173, 46, 74, 23, 239];
pub const CLAIM_WINNINGS_DISCRIMINATOR: [u8; 8] = [161, 215, 24, 59, 14, 236, 242, 221];

pub const MARKET_DISCRIMINATOR: [u8; 8] = [219, 190, 213, 55, 0, 227, 198, 154];
pub const LP_POSITION_DISCRIMINATOR: [u8; 8] = [105, 241, 37, 200, 224, 2, 252, 90];

/// Byte offsets inside a pm-AMM `Market`, discriminator included.
pub mod market_offsets {
    pub const AUTHORITY: usize = 8;
    pub const MARKET_ID: usize = 40;
    pub const COLLATERAL_MINT: usize = 48;
    pub const YES_MINT: usize = 80;
    pub const NO_MINT: usize = 112;
    pub const VAULT: usize = 144;
    pub const END: usize = 176;
}

/// Byte offsets inside a pm-AMM `LpPosition`, discriminator included.
pub mod lp_offsets {
    pub const OWNER: usize = 8;
    pub const MARKET: usize = 40;
    pub const SHARES: usize = 72;
    pub const END: usize = 88;
}

/// pm-AMM `Side`: Borsh enum index.
pub const SIDE_YES: u8 = 0;
pub const SIDE_NO: u8 = 1;

/// The fields of a pm-AMM `Market` this program checks.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct MarketView {
    pub authority: Pubkey,
    pub market_id: u64,
    pub collateral_mint: Pubkey,
    pub yes_mint: Pubkey,
    pub no_mint: Pubkey,
    pub vault: Pubkey,
}

/// The fields of a pm-AMM `LpPosition` this program uses.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct LpView {
    pub owner: Pubkey,
    pub market: Pubkey,
    pub shares: u128,
}

fn pubkey_at(data: &[u8], offset: usize) -> Pubkey {
    let mut b = [0u8; 32];
    b.copy_from_slice(&data[offset..offset + 32]);
    Pubkey::new_from_array(b)
}

pub fn parse_market(data: &[u8]) -> Result<MarketView> {
    require!(
        data.len() >= market_offsets::END && data[..8] == MARKET_DISCRIMINATOR,
        ResolverError::NotPmAmmAccount
    );
    let mut id = [0u8; 8];
    id.copy_from_slice(&data[market_offsets::MARKET_ID..market_offsets::MARKET_ID + 8]);
    Ok(MarketView {
        authority: pubkey_at(data, market_offsets::AUTHORITY),
        market_id: u64::from_le_bytes(id),
        collateral_mint: pubkey_at(data, market_offsets::COLLATERAL_MINT),
        yes_mint: pubkey_at(data, market_offsets::YES_MINT),
        no_mint: pubkey_at(data, market_offsets::NO_MINT),
        vault: pubkey_at(data, market_offsets::VAULT),
    })
}

pub fn parse_lp_position(data: &[u8]) -> Result<LpView> {
    require!(
        data.len() >= lp_offsets::END && data[..8] == LP_POSITION_DISCRIMINATOR,
        ResolverError::NotPmAmmAccount
    );
    let mut s = [0u8; 16];
    s.copy_from_slice(&data[lp_offsets::SHARES..lp_offsets::SHARES + 16]);
    Ok(LpView {
        owner: pubkey_at(data, lp_offsets::OWNER),
        market: pubkey_at(data, lp_offsets::MARKET),
        shares: u128::from_le_bytes(s),
    })
}

/// Read a pm-AMM market account, checking its owner.
pub fn read_market(info: &AccountInfo) -> Result<MarketView> {
    require_keys_eq!(*info.owner, PM_AMM_PROGRAM_ID, ResolverError::NotPmAmmAccount);
    parse_market(&info.try_borrow_data()?)
}

/// Read a pm-AMM LP position account, checking its owner.
pub fn read_lp_position(info: &AccountInfo) -> Result<LpView> {
    require_keys_eq!(*info.owner, PM_AMM_PROGRAM_ID, ResolverError::NotPmAmmAccount);
    parse_lp_position(&info.try_borrow_data()?)
}

fn meta(info: &AccountInfo, writable: bool, signer: bool) -> AccountMeta {
    if writable {
        AccountMeta::new(info.key(), signer)
    } else {
        AccountMeta::new_readonly(info.key(), signer)
    }
}

pub fn encode_initialize_market(market_id: u64, end_ts: i64, name: &str, initial_price_bps: u16) -> Vec<u8> {
    let mut data = INITIALIZE_MARKET_DISCRIMINATOR.to_vec();
    data.extend_from_slice(&market_id.to_le_bytes());
    data.extend_from_slice(&end_ts.to_le_bytes());
    data.extend_from_slice(&(name.len() as u32).to_le_bytes());
    data.extend_from_slice(name.as_bytes());
    data.extend_from_slice(&initial_price_bps.to_le_bytes());
    data
}

/// Accounts in IDL order: authority (w, s), market (w), collateral_mint,
/// yes_mint (w), no_mint (w), vault (w), yes_metadata (w), no_metadata (w),
/// token_metadata_program, system_program, token_program, rent.
pub fn initialize_market_ix(accounts: &[AccountInfo; 12], data: Vec<u8>) -> Instruction {
    let w = [true, true, false, true, true, true, true, true, false, false, false, false];
    Instruction {
        program_id: PM_AMM_PROGRAM_ID,
        accounts: accounts.iter().zip(w).enumerate().map(|(i, (a, w))| meta(a, w, i == 0)).collect(),
        data,
    }
}

/// Accounts in IDL order: signer (w, s), market (w), collateral_mint, vault (w),
/// user_collateral (w), lp_position (w), system_program, token_program.
pub fn deposit_liquidity_ix(accounts: &[AccountInfo; 8], amount: u64) -> Instruction {
    let w = [true, true, false, true, true, true, false, false];
    let mut data = DEPOSIT_LIQUIDITY_DISCRIMINATOR.to_vec();
    data.extend_from_slice(&amount.to_le_bytes());
    Instruction {
        program_id: PM_AMM_PROGRAM_ID,
        accounts: accounts.iter().zip(w).enumerate().map(|(i, (a, w))| meta(a, w, i == 0)).collect(),
        data,
    }
}

/// Accounts in IDL order: signer (w, s), market (w), collateral_mint,
/// yes_mint (w), no_mint (w), lp_position (w), user_yes (w), user_no (w),
/// token_program.
pub fn withdraw_liquidity_ix(accounts: &[AccountInfo; 9], shares: u128) -> Instruction {
    let w = [true, true, false, true, true, true, true, true, false];
    let mut data = WITHDRAW_LIQUIDITY_DISCRIMINATOR.to_vec();
    data.extend_from_slice(&shares.to_le_bytes());
    Instruction {
        program_id: PM_AMM_PROGRAM_ID,
        accounts: accounts.iter().zip(w).enumerate().map(|(i, (a, w))| meta(a, w, i == 0)).collect(),
        data,
    }
}

/// Accounts in IDL order: signer (s), market (w).
pub fn resolve_market_ix(signer: &AccountInfo, market: &AccountInfo, side: u8) -> Instruction {
    let mut data = RESOLVE_MARKET_DISCRIMINATOR.to_vec();
    data.push(side);
    Instruction {
        program_id: PM_AMM_PROGRAM_ID,
        accounts: vec![meta(signer, false, true), meta(market, true, false)],
        data,
    }
}

/// Accounts in IDL order: signer (w, s), market, collateral_mint, yes_mint (w),
/// no_mint (w), vault (w), user_yes (w), user_no (w), user_collateral (w),
/// token_program. pm-AMM ignores `amount` and claims the whole winning balance.
pub fn claim_winnings_ix(accounts: &[AccountInfo; 10]) -> Instruction {
    let w = [true, false, false, true, true, true, true, true, true, false];
    let mut data = CLAIM_WINNINGS_DISCRIMINATOR.to_vec();
    data.extend_from_slice(&0u64.to_le_bytes());
    Instruction {
        program_id: PM_AMM_PROGRAM_ID,
        accounts: accounts.iter().zip(w).enumerate().map(|(i, (a, w))| meta(a, w, i == 0)).collect(),
        data,
    }
}
