//! Read-only views over Meteora Dynamic Bonding Curve (DBC) accounts.
//!
//! The program never deserialises the whole DBC account. It checks the owner,
//! the discriminator and the length, then reads a handful of fields at fixed
//! byte offsets. The offsets are derived from the official IDL
//! (`onchain/dbc-idl.json`, program version 0.2.1) and are pinned by the unit
//! tests in `tests/layout.rs`, which rebuild both accounts from the IDL types.

use anchor_lang::prelude::*;

use crate::error::CurveError;

/// The DBC program id. It is the same on devnet and mainnet.
pub const DBC_PROGRAM_ID: Pubkey = pubkey!("dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN");

/// Anchor discriminator of the `VirtualPool` account.
pub const VIRTUAL_POOL_DISCRIMINATOR: [u8; 8] = [213, 224, 5, 209, 98, 69, 119, 92];
/// Anchor discriminator of the `PoolConfig` account.
pub const POOL_CONFIG_DISCRIMINATOR: [u8; 8] = [26, 108, 14, 123, 116, 230, 129, 43];

/// Full serialised length of a `VirtualPool` account, discriminator included.
pub const VIRTUAL_POOL_LEN: usize = 424;
/// Full serialised length of a `PoolConfig` account, discriminator included.
pub const POOL_CONFIG_LEN: usize = 1048;

/// Byte offsets inside `VirtualPool` (discriminator at 0..8, then `PoolState`).
pub mod pool_offsets {
    /// `volatility_tracker`: 64 bytes (u64, [u8; 8], u128, u128, u128).
    pub const VOLATILITY_TRACKER: usize = 8;
    pub const CONFIG: usize = 72;
    pub const CREATOR: usize = 104;
    pub const BASE_MINT: usize = 136;
    pub const BASE_VAULT: usize = 168;
    pub const QUOTE_VAULT: usize = 200;
    pub const BASE_RESERVE: usize = 232;
    pub const QUOTE_RESERVE: usize = 240;
    pub const PROTOCOL_BASE_FEE: usize = 248;
    pub const PROTOCOL_QUOTE_FEE: usize = 256;
    pub const PARTNER_BASE_FEE: usize = 264;
    pub const PARTNER_QUOTE_FEE: usize = 272;
    pub const SQRT_PRICE: usize = 280;
    pub const ACTIVATION_POINT: usize = 296;
    pub const POOL_TYPE: usize = 304;
    pub const IS_MIGRATED: usize = 305;
    pub const IS_PARTNER_WITHDRAW_SURPLUS: usize = 306;
    pub const IS_PROTOCOL_WITHDRAW_SURPLUS: usize = 307;
    pub const MIGRATION_PROGRESS: usize = 308;
    pub const IS_WITHDRAW_LEFTOVER: usize = 309;
    pub const IS_CREATOR_WITHDRAW_SURPLUS: usize = 310;
    pub const MIGRATION_FEE_WITHDRAW_STATUS: usize = 311;
    /// `metrics`: 32 bytes (four u64).
    pub const METRICS: usize = 312;
    pub const FINISH_CURVE_TIMESTAMP: usize = 344;
}

/// Byte offsets inside `PoolConfig` (discriminator at 0..8).
pub mod config_offsets {
    pub const QUOTE_MINT: usize = 8;
    pub const FEE_CLAIMER: usize = 40;
    pub const LEFTOVER_RECEIVER: usize = 72;
    pub const POOL_FEES: usize = 104;
    pub const SWAP_BASE_AMOUNT: usize = 256;
    pub const MIGRATION_QUOTE_THRESHOLD: usize = 264;
    pub const MIGRATION_BASE_THRESHOLD: usize = 272;
}

/// The fields of a `VirtualPool` the market cares about.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct PoolView {
    pub config: Pubkey,
    pub quote_reserve: u64,
    pub is_migrated: u8,
    pub migration_progress: u8,
    pub finish_curve_timestamp: u64,
}

/// The fields of a `PoolConfig` the market cares about.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ConfigView {
    pub quote_mint: Pubkey,
    pub migration_quote_threshold: u64,
}

fn read_u64(data: &[u8], offset: usize) -> Result<u64> {
    let bytes: [u8; 8] = data
        .get(offset..offset + 8)
        .and_then(|s| s.try_into().ok())
        .ok_or(CurveError::PoolLayout)?;
    Ok(u64::from_le_bytes(bytes))
}

fn read_pubkey(data: &[u8], offset: usize) -> Result<Pubkey> {
    let bytes: [u8; 32] = data
        .get(offset..offset + 32)
        .and_then(|s| s.try_into().ok())
        .ok_or(CurveError::PoolLayout)?;
    Ok(Pubkey::new_from_array(bytes))
}

fn read_u8(data: &[u8], offset: usize) -> Result<u8> {
    data.get(offset).copied().ok_or_else(|| CurveError::PoolLayout.into())
}

/// Validate and read a `VirtualPool` account.
pub fn read_pool(info: &AccountInfo) -> Result<PoolView> {
    require_keys_eq!(*info.owner, DBC_PROGRAM_ID, CurveError::PoolNotOwnedByDbc);
    let data = info.try_borrow_data()?;
    parse_pool(&data)
}

/// Parse `VirtualPool` bytes. Separated from the account check for tests.
pub fn parse_pool(data: &[u8]) -> Result<PoolView> {
    require!(data.len() >= VIRTUAL_POOL_LEN, CurveError::PoolLayout);
    require!(
        data[..8] == VIRTUAL_POOL_DISCRIMINATOR,
        CurveError::PoolDiscriminator
    );
    Ok(PoolView {
        config: read_pubkey(data, pool_offsets::CONFIG)?,
        quote_reserve: read_u64(data, pool_offsets::QUOTE_RESERVE)?,
        is_migrated: read_u8(data, pool_offsets::IS_MIGRATED)?,
        migration_progress: read_u8(data, pool_offsets::MIGRATION_PROGRESS)?,
        finish_curve_timestamp: read_u64(data, pool_offsets::FINISH_CURVE_TIMESTAMP)?,
    })
}

/// Validate and read a `PoolConfig` account.
pub fn read_config(info: &AccountInfo) -> Result<ConfigView> {
    require_keys_eq!(*info.owner, DBC_PROGRAM_ID, CurveError::ConfigNotOwnedByDbc);
    let data = info.try_borrow_data()?;
    parse_config(&data)
}

/// Parse `PoolConfig` bytes. Separated from the account check for tests.
pub fn parse_config(data: &[u8]) -> Result<ConfigView> {
    require!(data.len() >= POOL_CONFIG_LEN, CurveError::ConfigLayout);
    require!(
        data[..8] == POOL_CONFIG_DISCRIMINATOR,
        CurveError::ConfigDiscriminator
    );
    Ok(ConfigView {
        quote_mint: read_pubkey(data, config_offsets::QUOTE_MINT)?,
        migration_quote_threshold: read_u64(data, config_offsets::MIGRATION_QUOTE_THRESHOLD)?,
    })
}

impl PoolView {
    /// True once the pool has left the curve: migrated, or the curve finished.
    pub fn curve_complete(&self, threshold: u64) -> bool {
        self.is_migrated == 1 || self.finish_curve_timestamp > 0 || self.quote_reserve >= threshold
    }
}
