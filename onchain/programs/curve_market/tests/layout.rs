//! Pins the byte offsets the program reads against the official DBC IDL.
//! The IDL types are walked field by field (Borsh order, no padding beyond
//! what the IDL declares) and every offset the program hard-codes must match.
//! Also covers the pure decision and payout functions.

mod common;

use {
    common::*,
    curve_market::{dbc, decide, payout_for, Side},
    solana_pubkey::Pubkey,
};

#[test]
fn dbc_program_id_matches_idl() {
    let idl = Idl::load();
    assert_eq!(idl.address(), dbc::DBC_PROGRAM_ID);
}

#[test]
fn discriminators_match_idl() {
    let idl = Idl::load();
    assert_eq!(idl.discriminator("VirtualPool"), dbc::VIRTUAL_POOL_DISCRIMINATOR.to_vec());
    assert_eq!(idl.discriminator("PoolConfig"), dbc::POOL_CONFIG_DISCRIMINATOR.to_vec());
    assert_eq!(
        idl.discriminator("TransferHookPool"),
        dbc::TRANSFER_HOOK_POOL_DISCRIMINATOR.to_vec()
    );
    assert_eq!(
        idl.discriminator("ConfigWithTransferHook"),
        dbc::CONFIG_WITH_TRANSFER_HOOK_DISCRIMINATOR.to_vec()
    );
}

#[test]
fn account_lengths_match_idl() {
    let idl = Idl::load();
    assert_eq!(idl.account_len("VirtualPool"), dbc::VIRTUAL_POOL_LEN);
    assert_eq!(idl.account_len("PoolConfig"), dbc::POOL_CONFIG_LEN);
    assert_eq!(idl.account_len("TransferHookPool"), dbc::TRANSFER_HOOK_POOL_LEN);
    assert_eq!(idl.account_len("ConfigWithTransferHook"), dbc::CONFIG_WITH_TRANSFER_HOOK_LEN);
    assert_eq!(idl.struct_size("VolatilityTracker"), 64);
    assert_eq!(idl.struct_size("PoolMetrics"), 32);
}

#[test]
fn virtual_pool_offsets_match_idl() {
    use dbc::pool_offsets as o;
    let idl = Idl::load();
    let expect = [
        ("volatility_tracker", o::VOLATILITY_TRACKER),
        ("config", o::CONFIG),
        ("creator", o::CREATOR),
        ("base_mint", o::BASE_MINT),
        ("base_vault", o::BASE_VAULT),
        ("quote_vault", o::QUOTE_VAULT),
        ("base_reserve", o::BASE_RESERVE),
        ("quote_reserve", o::QUOTE_RESERVE),
        ("protocol_base_fee", o::PROTOCOL_BASE_FEE),
        ("protocol_quote_fee", o::PROTOCOL_QUOTE_FEE),
        ("partner_base_fee", o::PARTNER_BASE_FEE),
        ("partner_quote_fee", o::PARTNER_QUOTE_FEE),
        ("sqrt_price", o::SQRT_PRICE),
        ("activation_point", o::ACTIVATION_POINT),
        ("pool_type", o::POOL_TYPE),
        ("is_migrated", o::IS_MIGRATED),
        ("is_partner_withdraw_surplus", o::IS_PARTNER_WITHDRAW_SURPLUS),
        ("is_protocol_withdraw_surplus", o::IS_PROTOCOL_WITHDRAW_SURPLUS),
        ("migration_progress", o::MIGRATION_PROGRESS),
        ("is_withdraw_leftover", o::IS_WITHDRAW_LEFTOVER),
        ("is_creator_withdraw_surplus", o::IS_CREATOR_WITHDRAW_SURPLUS),
        ("migration_fee_withdraw_status", o::MIGRATION_FEE_WITHDRAW_STATUS),
        ("metrics", o::METRICS),
        ("finish_curve_timestamp", o::FINISH_CURVE_TIMESTAMP),
    ];
    // Both pool kinds wrap the same PoolState, so one table serves both.
    for account in ["VirtualPool", "TransferHookPool"] {
        for (name, off) in expect {
            assert_eq!(idl.offset(account, name), off, "{account}.{name}");
        }
    }
}

#[test]
fn pool_config_offsets_match_idl() {
    use dbc::config_offsets as o;
    let idl = Idl::load();
    let expect = [
        ("quote_mint", o::QUOTE_MINT),
        ("fee_claimer", o::FEE_CLAIMER),
        ("leftover_receiver", o::LEFTOVER_RECEIVER),
        ("pool_fees", o::POOL_FEES),
        ("swap_base_amount", o::SWAP_BASE_AMOUNT),
        ("migration_quote_threshold", o::MIGRATION_QUOTE_THRESHOLD),
        ("migration_base_threshold", o::MIGRATION_BASE_THRESHOLD),
    ];
    for (name, off) in expect {
        assert_eq!(idl.offset("PoolConfig", name), off, "PoolConfig.{name}");
        // ConfigWithTransferHook starts with a whole PoolConfig.
        assert_eq!(
            idl.nested_offset("ConfigWithTransferHook", "config", name),
            off,
            "ConfigWithTransferHook.config.{name}"
        );
    }
    assert_eq!(idl.offset("ConfigWithTransferHook", "config"), 8);
    assert_eq!(idl.offset("ConfigWithTransferHook", "transfer_hook_program"), dbc::POOL_CONFIG_LEN);
}

/// Build a pool buffer purely from the IDL walk (not from the program's
/// constants), fill each field with a recognisable pattern, and check the
/// parser reads the right bytes.
fn parse_pool_from_idl(account: &str, kind: dbc::PoolKind) {
    let idl = Idl::load();
    let mut buf = vec![0u8; idl.account_len(account)];
    buf[..8].copy_from_slice(&idl.discriminator(account));
    let config = Pubkey::new_unique();
    for f in idl.account_fields(account) {
        let slot = &mut buf[f.offset..f.offset + f.size];
        match f.name.as_str() {
            "config" => slot.copy_from_slice(config.as_ref()),
            "quote_reserve" => slot.copy_from_slice(&0x1122_3344_5566_7788u64.to_le_bytes()),
            "is_migrated" => slot[0] = 1,
            "migration_progress" => slot[0] = 3,
            "finish_curve_timestamp" => slot.copy_from_slice(&1_700_000_000u64.to_le_bytes()),
            // Everything else gets a noisy pattern so a wrong offset shows up.
            _ => slot.fill(0xAB),
        }
    }
    let view = dbc::parse_pool(&buf).unwrap();
    assert_eq!(view.kind, kind);
    assert_eq!(view.config, config);
    assert_eq!(view.quote_reserve, 0x1122_3344_5566_7788);
    assert_eq!(view.is_migrated, 1);
    assert_eq!(view.migration_progress, 3);
    assert_eq!(view.finish_curve_timestamp, 1_700_000_000);
}

#[test]
fn parse_pool_reads_fields_laid_out_by_idl() {
    parse_pool_from_idl("VirtualPool", dbc::PoolKind::Virtual);
}

#[test]
fn parse_transfer_hook_pool_reads_fields_laid_out_by_idl() {
    parse_pool_from_idl("TransferHookPool", dbc::PoolKind::TransferHook);
}

#[test]
fn parse_config_reads_fields_laid_out_by_idl() {
    let idl = Idl::load();
    let mut buf = vec![0u8; idl.account_len("PoolConfig")];
    buf[..8].copy_from_slice(&idl.discriminator("PoolConfig"));
    let quote_mint = Pubkey::new_unique();
    for f in idl.account_fields("PoolConfig") {
        let slot = &mut buf[f.offset..f.offset + f.size];
        match f.name.as_str() {
            "quote_mint" => slot.copy_from_slice(quote_mint.as_ref()),
            "migration_quote_threshold" => slot.copy_from_slice(&85_000_000_000u64.to_le_bytes()),
            _ => slot.fill(0xCD),
        }
    }
    let view = dbc::parse_config(&buf).unwrap();
    assert_eq!(view.kind, dbc::PoolKind::Virtual);
    assert_eq!(view.quote_mint, quote_mint);
    assert_eq!(view.migration_quote_threshold, 85_000_000_000);
}

/// ConfigWithTransferHook: the embedded PoolConfig laid out by the IDL from
/// the wrapper's own `config` field offset, then the hook program and padding.
#[test]
fn parse_config_with_transfer_hook_reads_fields_laid_out_by_idl() {
    let idl = Idl::load();
    let mut buf = vec![0u8; idl.account_len("ConfigWithTransferHook")];
    buf[..8].copy_from_slice(&idl.discriminator("ConfigWithTransferHook"));
    let quote_mint = Pubkey::new_unique();
    let base = idl.offset("ConfigWithTransferHook", "config");
    for f in idl.fields("PoolConfig", base) {
        let slot = &mut buf[f.offset..f.offset + f.size];
        match f.name.as_str() {
            "quote_mint" => slot.copy_from_slice(quote_mint.as_ref()),
            "migration_quote_threshold" => slot.copy_from_slice(&11_510_000_000u64.to_le_bytes()),
            _ => slot.fill(0xCD),
        }
    }
    for f in idl.account_fields("ConfigWithTransferHook") {
        if f.name != "config" {
            buf[f.offset..f.offset + f.size].fill(0xEF);
        }
    }
    let view = dbc::parse_config(&buf).unwrap();
    assert_eq!(view.kind, dbc::PoolKind::TransferHook);
    assert_eq!(view.quote_mint, quote_mint);
    assert_eq!(view.migration_quote_threshold, 11_510_000_000);
}

#[test]
fn parse_rejects_bad_discriminator_and_short_buffers() {
    let mut buf = pool_bytes(&PoolSpec::open(Pubkey::new_unique()));
    buf[0] ^= 1;
    assert!(dbc::parse_pool(&buf).is_err());
    let short = &pool_bytes(&PoolSpec::open(Pubkey::new_unique()))[..100];
    assert!(dbc::parse_pool(short).is_err());

    let mut cfg = config_bytes(Pubkey::new_unique(), 1);
    cfg[7] ^= 1;
    assert!(dbc::parse_config(&cfg).is_err());
    assert!(dbc::parse_config(&cfg[..500]).is_err());
    assert!(dbc::parse_pool(&[]).is_err());
    assert!(dbc::parse_config(&[1, 2, 3]).is_err());
}

#[test]
fn parse_transfer_hook_kinds_reject_bad_discriminator_and_short_buffers() {
    use dbc::PoolKind::TransferHook;
    let mut buf = pool_bytes(&PoolSpec::open_kind(Pubkey::new_unique(), TransferHook));
    assert_eq!(dbc::parse_pool(&buf).unwrap().kind, TransferHook);
    assert!(dbc::parse_pool(&buf[..dbc::TRANSFER_HOOK_POOL_LEN - 1]).is_err());
    buf[3] ^= 1;
    assert!(dbc::parse_pool(&buf).is_err());

    let cfg = config_bytes_kind(TransferHook, Pubkey::new_unique(), 1);
    assert_eq!(dbc::parse_config(&cfg).unwrap().kind, TransferHook);
    // A ConfigWithTransferHook cut to PoolConfig length is too short for its kind.
    assert!(dbc::parse_config(&cfg[..dbc::POOL_CONFIG_LEN]).is_err());
    assert!(dbc::parse_config(&cfg[..dbc::CONFIG_WITH_TRANSFER_HOOK_LEN - 1]).is_err());
}

/// Real mainnet TransferHookPool and ConfigWithTransferHook bytes parse to
/// the values the chain showed when they were read (reserve, flags, config
/// link, quote mint, threshold).
#[test]
fn parse_real_transfer_hook_pool_snapshots() {
    let real = real_transfer_hook_pools();
    let sol: Pubkey = "So11111111111111111111111111111111111111112".parse().unwrap();
    let usdc: Pubkey = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v".parse().unwrap();

    let trading = &real[0];
    assert_eq!(trading.pool_data.len(), dbc::TRANSFER_HOOK_POOL_LEN);
    assert_eq!(trading.config_data.len(), dbc::CONFIG_WITH_TRANSFER_HOOK_LEN);
    let p = dbc::parse_pool(&trading.pool_data).unwrap();
    let c = dbc::parse_config(&trading.config_data).unwrap();
    assert_eq!((p.kind, c.kind), (dbc::PoolKind::TransferHook, dbc::PoolKind::TransferHook));
    assert_eq!(p.config, trading.config);
    assert_eq!(p.quote_reserve, 11_569_203_035);
    assert_eq!((p.is_migrated, p.finish_curve_timestamp), (0, 0));
    assert_eq!(c.quote_mint, sol);
    assert_eq!(c.migration_quote_threshold, 6_469_811_299_045);
    assert!(!p.curve_complete(c.migration_quote_threshold));

    let migrated = &real[1];
    let p = dbc::parse_pool(&migrated.pool_data).unwrap();
    let c = dbc::parse_config(&migrated.config_data).unwrap();
    assert_eq!(p.kind, dbc::PoolKind::TransferHook);
    assert_eq!(p.config, migrated.config);
    assert_eq!((p.is_migrated, p.finish_curve_timestamp), (1, 1_790_520_753));
    assert_eq!(c.quote_mint, usdc);
    assert!(p.quote_reserve >= c.migration_quote_threshold);
    assert!(p.curve_complete(c.migration_quote_threshold));
}

/// No other DBC account passes as a pool or a config, and a pool never
/// passes as a config or the other way round.
#[test]
fn parse_rejects_every_other_dbc_account() {
    let idl = Idl::load();
    let pools = ["VirtualPool", "TransferHookPool"];
    let configs = ["PoolConfig", "ConfigWithTransferHook"];
    for name in idl.account_names() {
        let mut buf = vec![0u8; 2048];
        buf[..8].copy_from_slice(&idl.discriminator(&name));
        let name = name.as_str();
        assert_eq!(dbc::parse_pool(&buf).is_ok(), pools.contains(&name), "parse_pool({name})");
        assert_eq!(dbc::parse_config(&buf).is_ok(), configs.contains(&name), "parse_config({name})");
    }
}

// ---------------------------------------------------------------------------
// decide()
// ---------------------------------------------------------------------------

fn pool(quote_reserve: u64, is_migrated: u8, finish_ts: u64) -> dbc::PoolView {
    dbc::PoolView {
        kind: dbc::PoolKind::Virtual,
        config: Pubkey::default(),
        quote_reserve,
        is_migrated,
        migration_progress: 0,
        finish_curve_timestamp: finish_ts,
    }
}

const DEADLINE: i64 = 1_000_000;
const THRESHOLD: u64 = 500;

#[test]
fn decide_timestamp_is_authoritative() {
    // Finished before the deadline: YES, even when read long after.
    assert_eq!(decide(&pool(0, 0, 999_999), THRESHOLD, DEADLINE, DEADLINE + 10_000), Some(Side::Yes));
    assert_eq!(decide(&pool(0, 1, 1_000_000), THRESHOLD, DEADLINE, DEADLINE + 1), Some(Side::Yes));
    // Finished after the deadline: NO, even when migrated.
    assert_eq!(decide(&pool(0, 1, 1_000_001), THRESHOLD, DEADLINE, DEADLINE + 1), Some(Side::No));
    // A timestamp that does not fit i64 is treated as after the deadline.
    assert_eq!(decide(&pool(0, 0, u64::MAX), THRESHOLD, DEADLINE, 1), Some(Side::No));
}

#[test]
fn decide_migrated_without_timestamp_is_yes() {
    assert_eq!(decide(&pool(0, 1, 0), THRESHOLD, DEADLINE, 1), Some(Side::Yes));
    assert_eq!(decide(&pool(0, 1, 0), THRESHOLD, DEADLINE, DEADLINE + 1), Some(Side::Yes));
}

#[test]
fn decide_threshold_reached_only_counts_before_deadline() {
    assert_eq!(decide(&pool(THRESHOLD, 0, 0), THRESHOLD, DEADLINE, DEADLINE), Some(Side::Yes));
    assert_eq!(decide(&pool(THRESHOLD + 1, 0, 0), THRESHOLD, DEADLINE, 1), Some(Side::Yes));
    assert_eq!(decide(&pool(THRESHOLD, 0, 0), THRESHOLD, DEADLINE, DEADLINE + 1), Some(Side::No));
}

#[test]
fn decide_waits_then_resolves_no() {
    assert_eq!(decide(&pool(1, 0, 0), THRESHOLD, DEADLINE, DEADLINE), None);
    assert_eq!(decide(&pool(1, 0, 0), THRESHOLD, DEADLINE, 1), None);
    assert_eq!(decide(&pool(1, 0, 0), THRESHOLD, DEADLINE, DEADLINE + 1), Some(Side::No));
}

// ---------------------------------------------------------------------------
// payout_for()
// ---------------------------------------------------------------------------

#[test]
fn payout_even_sides_doubles() {
    assert_eq!(payout_for(100, 100, 200).unwrap(), 200);
    assert_eq!(payout_for(50, 100, 200).unwrap(), 100);
}

#[test]
fn payout_uneven_sides_floors_and_never_exceeds_pool() {
    // YES 300 (two stakers 100 + 200), NO 100. Pool 400.
    let a = payout_for(100, 300, 400).unwrap();
    let b = payout_for(200, 300, 400).unwrap();
    assert_eq!(a, 133);
    assert_eq!(b, 266);
    assert!(a + b <= 400);
    // Single winner takes the whole pool.
    assert_eq!(payout_for(7, 7, 1_000_007).unwrap(), 1_000_007);
}

#[test]
fn payout_handles_u64_scale_without_overflow() {
    // Values near u64::MAX / 2 on each side would overflow a u64 product.
    let half = u64::MAX / 2;
    let total = half.checked_add(half).unwrap();
    assert_eq!(payout_for(half, half, total).unwrap(), total);
    assert_eq!(payout_for(0, half, total).unwrap(), 0);
}

#[test]
fn payout_rejects_zero_winning_total_for_nonzero_stake() {
    assert!(payout_for(1, 0, 10).is_err());
}
