//! End-to-end tests over LiteSVM with crafted DBC accounts. No network.

mod common;

use {
    anchor_lang::{InstructionData, ToAccountMetas},
    common::*,
    curve_market::{CurveError, Market, MarketState, Position, Side, MIN_STAKE},
    solana_keypair::Keypair,
    solana_pubkey::Pubkey,
    solana_signer::Signer,
};

const NOW: i64 = 1_800_000_000;
const DAY: i64 = 86_400;
const THRESHOLD: u64 = 85_000_000_000;
const SOL: u64 = 1_000_000_000;

struct Fx {
    svm: litesvm::LiteSVM,
    pid: Pubkey,
    token_program: Pubkey,
    mint: Pubkey,
    pool: Pubkey,
    config: Pubkey,
    creator: Keypair,
    deadline: i64,
    market: Pubkey,
    vault: Pubkey,
}

impl Fx {
    fn new(token_program: Pubkey) -> Self {
        let (mut svm, pid) = load_program();
        set_time(&mut svm, NOW);
        let mint = set_mint(&mut svm, token_program);
        let pool = Pubkey::new_unique();
        let config = Pubkey::new_unique();
        set_config(&mut svm, config, mint, THRESHOLD);
        set_pool(&mut svm, pool, &PoolSpec::open(config));
        let creator = fund(&mut svm);
        let deadline = NOW + DAY;
        let market = market_pda(&pid, &pool, deadline);
        let vault = vault_pda(&pid, &market);
        Fx { svm, pid, token_program, mint, pool, config, creator, deadline, market, vault }
    }

    fn set_pool(&mut self, spec: PoolSpec) {
        set_pool(&mut self.svm, self.pool, &spec);
    }

    fn time(&mut self, t: i64) {
        set_time(&mut self.svm, t);
    }

    fn create(&mut self) -> Result<(), String> {
        self.create_with(self.deadline, self.pool, self.config, self.mint)
    }

    fn create_with(
        &mut self,
        deadline: i64,
        pool: Pubkey,
        config: Pubkey,
        mint: Pubkey,
    ) -> Result<(), String> {
        let market = market_pda(&self.pid, &pool, deadline);
        let vault = vault_pda(&self.pid, &market);
        let creator = self.creator.insecure_clone();
        send(
            &mut self.svm,
            self.pid,
            curve_market::instruction::CreateMarket { deadline_ts: deadline }.data(),
            curve_market::accounts::CreateMarket {
                creator: creator.pubkey(),
                pool,
                config,
                quote_mint: mint,
                market,
                vault,
                token_program: self.token_program,
                system_program: system_program(),
            }
            .to_account_metas(None),
            &[&creator],
        )
    }

    /// A funded trader with a token account holding `balance`.
    fn trader(&mut self, balance: u64) -> (Keypair, Pubkey) {
        let kp = fund(&mut self.svm);
        let ata = set_token_account(&mut self.svm, self.token_program, self.mint, kp.pubkey(), balance);
        (kp, ata)
    }

    fn stake(&mut self, user: &Keypair, user_token: Pubkey, side: Side, amount: u64) -> Result<(), String> {
        let position = position_pda(&self.pid, &self.market, &user.pubkey());
        send(
            &mut self.svm,
            self.pid,
            curve_market::instruction::Stake { side, amount }.data(),
            curve_market::accounts::Stake {
                user: user.pubkey(),
                market: self.market,
                position,
                quote_mint: self.mint,
                user_token,
                vault: self.vault,
                token_program: self.token_program,
                system_program: system_program(),
            }
            .to_account_metas(None),
            &[user],
        )
    }

    fn resolve(&mut self) -> Result<(), String> {
        let payer = fund(&mut self.svm);
        send(
            &mut self.svm,
            self.pid,
            curve_market::instruction::Resolve {}.data(),
            curve_market::accounts::Resolve { market: self.market, pool: self.pool, config: self.config }
                .to_account_metas(None),
            &[&payer],
        )
    }

    fn claim(&mut self, user: &Keypair, user_token: Pubkey) -> Result<(), String> {
        let position = position_pda(&self.pid, &self.market, &user.pubkey());
        send(
            &mut self.svm,
            self.pid,
            curve_market::instruction::Claim {}.data(),
            curve_market::accounts::Claim {
                user: user.pubkey(),
                market: self.market,
                position,
                quote_mint: self.mint,
                user_token,
                vault: self.vault,
                token_program: self.token_program,
            }
            .to_account_metas(None),
            &[user],
        )
    }

    fn market(&self) -> Market {
        read(&self.svm, &self.market)
    }

    fn position(&self, user: &Pubkey) -> Option<Position> {
        let key = position_pda(&self.pid, &self.market, user);
        let acct = self.svm.get_account(&key)?;
        if acct.data.is_empty() {
            return None;
        }
        Some(read(&self.svm, &key))
    }

    fn balance(&self, token_account: &Pubkey) -> u64 {
        token_balance(&self.svm, token_account)
    }
}

fn market_pda(pid: &Pubkey, pool: &Pubkey, deadline: i64) -> Pubkey {
    Pubkey::find_program_address(
        &[curve_market::MARKET_SEED, pool.as_ref(), &deadline.to_le_bytes()],
        pid,
    )
    .0
}

fn vault_pda(pid: &Pubkey, market: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(&[curve_market::VAULT_SEED, market.as_ref()], pid).0
}

fn position_pda(pid: &Pubkey, market: &Pubkey, user: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(
        &[curve_market::POSITION_SEED, market.as_ref(), user.as_ref()],
        pid,
    )
    .0
}

// ---------------------------------------------------------------------------
// create_market
// ---------------------------------------------------------------------------

#[test]
fn create_market_stores_fields() {
    let mut fx = Fx::new(TOKEN_PROGRAM);
    fx.create().expect("create");
    let m = fx.market();
    assert_eq!(m.pool, fx.pool);
    assert_eq!(m.config, fx.config);
    assert_eq!(m.quote_mint, fx.mint);
    assert_eq!(m.token_program, TOKEN_PROGRAM);
    assert_eq!(m.vault, fx.vault);
    assert_eq!(m.creator, fx.creator.pubkey());
    assert_eq!(m.deadline_ts, fx.deadline);
    assert_eq!(m.migration_quote_threshold, THRESHOLD);
    assert_eq!(m.yes_total, 0);
    assert_eq!(m.no_total, 0);
    assert_eq!(m.state, MarketState::Open);
    assert_eq!(fx.balance(&fx.vault), 0);
}

#[test]
fn create_market_allows_several_deadlines_per_pool() {
    let mut fx = Fx::new(TOKEN_PROGRAM);
    fx.create().expect("first");
    let (pool, config, mint) = (fx.pool, fx.config, fx.mint);
    fx.create_with(fx.deadline + DAY, pool, config, mint).expect("second deadline");
    // Same deadline twice is a duplicate PDA and fails.
    assert!(fx.create().is_err());
}

#[test]
fn create_rejects_pool_with_wrong_owner() {
    let mut fx = Fx::new(TOKEN_PROGRAM);
    let bytes = pool_bytes(&PoolSpec::open(fx.config));
    set_account(&mut fx.svm, fx.pool, Pubkey::new_unique(), bytes);
    assert_err(fx.create(), CurveError::PoolNotOwnedByDbc);
}

#[test]
fn create_rejects_pool_with_wrong_discriminator() {
    let mut fx = Fx::new(TOKEN_PROGRAM);
    let mut bytes = pool_bytes(&PoolSpec::open(fx.config));
    bytes[..8].copy_from_slice(&curve_market::dbc::POOL_CONFIG_DISCRIMINATOR);
    set_account(&mut fx.svm, fx.pool, curve_market::dbc::DBC_PROGRAM_ID, bytes);
    assert_err(fx.create(), CurveError::PoolDiscriminator);
}

#[test]
fn create_rejects_short_pool_account() {
    let mut fx = Fx::new(TOKEN_PROGRAM);
    let bytes = pool_bytes(&PoolSpec::open(fx.config))[..300].to_vec();
    set_account(&mut fx.svm, fx.pool, curve_market::dbc::DBC_PROGRAM_ID, bytes);
    assert_err(fx.create(), CurveError::PoolLayout);
}

#[test]
fn create_rejects_migrated_or_finished_pool() {
    let mut fx = Fx::new(TOKEN_PROGRAM);
    fx.set_pool(PoolSpec { is_migrated: 1, ..PoolSpec::open(fx.config) });
    assert_err(fx.create(), CurveError::PoolAlreadyComplete);

    fx.set_pool(PoolSpec { finish_curve_timestamp: NOW as u64 - 1, ..PoolSpec::open(fx.config) });
    assert_err(fx.create(), CurveError::PoolAlreadyComplete);

    fx.set_pool(PoolSpec { quote_reserve: THRESHOLD, ..PoolSpec::open(fx.config) });
    assert_err(fx.create(), CurveError::PoolAlreadyComplete);
}

#[test]
fn create_rejects_config_and_mint_mismatch() {
    let mut fx = Fx::new(TOKEN_PROGRAM);
    // A config the pool does not point at.
    let other_config = Pubkey::new_unique();
    set_config(&mut fx.svm, other_config, fx.mint, THRESHOLD);
    let (deadline, pool, mint) = (fx.deadline, fx.pool, fx.mint);
    assert_err(fx.create_with(deadline, pool, other_config, mint), CurveError::ConfigMismatch);

    // A config owned by someone else.
    set_account(&mut fx.svm, fx.config, Pubkey::new_unique(), config_bytes(fx.mint, THRESHOLD));
    assert_err(fx.create(), CurveError::ConfigNotOwnedByDbc);
    set_config(&mut fx.svm, fx.config, fx.mint, THRESHOLD);

    // A mint that is not the config's quote mint.
    let other_mint = set_mint(&mut fx.svm, TOKEN_PROGRAM);
    let config = fx.config;
    assert_err(fx.create_with(deadline, pool, config, other_mint), CurveError::QuoteMintMismatch);
}

#[test]
fn create_rejects_bad_deadlines() {
    let mut fx = Fx::new(TOKEN_PROGRAM);
    let (pool, config, mint) = (fx.pool, fx.config, fx.mint);
    assert_err(fx.create_with(NOW, pool, config, mint), CurveError::DeadlineInPast);
    assert_err(fx.create_with(NOW - 1, pool, config, mint), CurveError::DeadlineInPast);
    assert_err(fx.create_with(NOW + 181 * DAY, pool, config, mint), CurveError::DeadlineTooFar);
    fx.create_with(NOW + 180 * DAY, pool, config, mint).expect("180 days is allowed");
    fx.create_with(NOW + 1, pool, config, mint).expect("one second ahead is allowed");
}

// ---------------------------------------------------------------------------
// stake
// ---------------------------------------------------------------------------

#[test]
fn stake_both_sides_moves_tokens_and_updates_totals() {
    let mut fx = Fx::new(TOKEN_PROGRAM);
    fx.create().unwrap();
    let (a, a_tok) = fx.trader(10 * SOL);
    let (b, b_tok) = fx.trader(10 * SOL);

    fx.stake(&a, a_tok, Side::Yes, 2 * SOL).expect("a yes");
    fx.stake(&a, a_tok, Side::No, SOL).expect("a also no");
    fx.stake(&b, b_tok, Side::No, 3 * SOL).expect("b no");

    assert_eq!(fx.balance(&a_tok), 7 * SOL);
    assert_eq!(fx.balance(&b_tok), 7 * SOL);
    assert_eq!(fx.balance(&fx.vault), 6 * SOL);

    let m = fx.market();
    assert_eq!(m.yes_total, 2 * SOL);
    assert_eq!(m.no_total, 4 * SOL);

    let pa = fx.position(&a.pubkey()).unwrap();
    assert_eq!((pa.yes_amount, pa.no_amount), (2 * SOL, SOL));
    assert_eq!(pa.market, fx.market);
    assert_eq!(pa.owner, a.pubkey());
    let pb = fx.position(&b.pubkey()).unwrap();
    assert_eq!((pb.yes_amount, pb.no_amount), (0, 3 * SOL));
}

#[test]
fn stake_rejects_dust_and_insufficient_balance() {
    let mut fx = Fx::new(TOKEN_PROGRAM);
    fx.create().unwrap();
    let (a, a_tok) = fx.trader(SOL);
    assert_err(fx.stake(&a, a_tok, Side::Yes, MIN_STAKE - 1), CurveError::StakeTooSmall);
    assert!(fx.stake(&a, a_tok, Side::Yes, 2 * SOL).is_err(), "token program rejects");
    fx.stake(&a, a_tok, Side::Yes, MIN_STAKE).expect("minimum is accepted");
}

#[test]
fn stake_rejects_after_deadline() {
    let mut fx = Fx::new(TOKEN_PROGRAM);
    fx.create().unwrap();
    let (a, a_tok) = fx.trader(SOL);
    fx.time(fx.deadline);
    fx.stake(&a, a_tok, Side::Yes, SOL / 2).expect("at the deadline is still open");
    fx.time(fx.deadline + 1);
    assert_err(fx.stake(&a, a_tok, Side::Yes, SOL / 2), CurveError::DeadlinePassed);
}

#[test]
fn stake_rejects_wrong_vault_or_mint() {
    let mut fx = Fx::new(TOKEN_PROGRAM);
    fx.create().unwrap();
    let (a, a_tok) = fx.trader(SOL);
    // A token account of another mint cannot be staked.
    let other_mint = set_mint(&mut fx.svm, TOKEN_PROGRAM);
    let other_tok = set_token_account(&mut fx.svm, TOKEN_PROGRAM, other_mint, a.pubkey(), SOL);
    assert!(fx.stake(&a, other_tok, Side::Yes, SOL / 2).is_err());
    // A token account owned by someone else cannot be staked by `a`.
    let (b, b_tok) = fx.trader(SOL);
    assert!(fx.stake(&a, b_tok, Side::Yes, SOL / 2).is_err());
    fx.stake(&b, b_tok, Side::Yes, SOL / 2).expect("owner can");
    let _ = a_tok;
}

// ---------------------------------------------------------------------------
// resolve
// ---------------------------------------------------------------------------

fn two_sided(fx: &mut Fx) -> ((Keypair, Pubkey), (Keypair, Pubkey)) {
    let a = fx.trader(10 * SOL);
    let b = fx.trader(10 * SOL);
    fx.stake(&a.0, a.1, Side::Yes, SOL).unwrap();
    fx.stake(&b.0, b.1, Side::No, SOL).unwrap();
    (a, b)
}

#[test]
fn resolve_not_yet_before_deadline() {
    let mut fx = Fx::new(TOKEN_PROGRAM);
    fx.create().unwrap();
    two_sided(&mut fx);
    assert_err(fx.resolve(), CurveError::NotYet);
    fx.time(fx.deadline);
    assert_err(fx.resolve(), CurveError::NotYet);
    assert_eq!(fx.market().state, MarketState::Open);
}

#[test]
fn resolve_yes_via_is_migrated() {
    let mut fx = Fx::new(TOKEN_PROGRAM);
    fx.create().unwrap();
    two_sided(&mut fx);
    fx.set_pool(PoolSpec { is_migrated: 1, ..PoolSpec::open(fx.config) });
    fx.resolve().expect("resolve");
    let m = fx.market();
    assert_eq!(m.state, MarketState::ResolvedYes);
    assert_eq!(m.resolved_at, NOW);
    // Second resolve is rejected.
    assert_err(fx.resolve(), CurveError::MarketNotOpen);
}

#[test]
fn resolve_yes_via_finish_curve_timestamp() {
    let mut fx = Fx::new(TOKEN_PROGRAM);
    fx.create().unwrap();
    two_sided(&mut fx);
    fx.set_pool(PoolSpec {
        finish_curve_timestamp: (fx.deadline - 60) as u64,
        ..PoolSpec::open(fx.config)
    });
    // Resolving long after the deadline still gives YES: the timestamp decides.
    fx.time(fx.deadline + 30 * DAY);
    fx.resolve().expect("resolve");
    assert_eq!(fx.market().state, MarketState::ResolvedYes);
}

#[test]
fn resolve_yes_via_quote_reserve_at_threshold_before_deadline() {
    let mut fx = Fx::new(TOKEN_PROGRAM);
    fx.create().unwrap();
    two_sided(&mut fx);
    fx.set_pool(PoolSpec { quote_reserve: THRESHOLD, ..PoolSpec::open(fx.config) });
    fx.resolve().expect("resolve");
    assert_eq!(fx.market().state, MarketState::ResolvedYes);
}

#[test]
fn resolve_no_after_deadline() {
    let mut fx = Fx::new(TOKEN_PROGRAM);
    fx.create().unwrap();
    two_sided(&mut fx);
    fx.time(fx.deadline + 1);
    fx.resolve().expect("resolve");
    let m = fx.market();
    assert_eq!(m.state, MarketState::ResolvedNo);
    assert_eq!(m.resolved_at, fx.deadline + 1);
}

#[test]
fn resolve_no_when_curve_finished_after_deadline() {
    let mut fx = Fx::new(TOKEN_PROGRAM);
    fx.create().unwrap();
    two_sided(&mut fx);
    fx.set_pool(PoolSpec {
        is_migrated: 1,
        finish_curve_timestamp: (fx.deadline + 1) as u64,
        ..PoolSpec::open(fx.config)
    });
    fx.time(fx.deadline + DAY);
    fx.resolve().expect("resolve");
    assert_eq!(fx.market().state, MarketState::ResolvedNo);
}

#[test]
fn resolve_rejects_foreign_pool_or_config() {
    let mut fx = Fx::new(TOKEN_PROGRAM);
    fx.create().unwrap();
    two_sided(&mut fx);
    // A different pool account, even a valid migrated one, is rejected.
    let other_pool = Pubkey::new_unique();
    set_pool(&mut fx.svm, other_pool, &PoolSpec { is_migrated: 1, ..PoolSpec::open(fx.config) });
    let real = fx.pool;
    fx.pool = other_pool;
    assert_err(fx.resolve(), CurveError::PoolMismatch);
    fx.pool = real;
    // The pool rewritten to point at another config is rejected.
    fx.set_pool(PoolSpec { is_migrated: 1, ..PoolSpec::open(Pubkey::new_unique()) });
    assert_err(fx.resolve(), CurveError::ConfigMismatch);
}

// ---------------------------------------------------------------------------
// claim
// ---------------------------------------------------------------------------

#[test]
fn claim_even_sides_pays_winner_double_and_loser_nothing() {
    let mut fx = Fx::new(TOKEN_PROGRAM);
    fx.create().unwrap();
    let ((a, a_tok), (b, b_tok)) = two_sided(&mut fx);
    fx.set_pool(PoolSpec { is_migrated: 1, ..PoolSpec::open(fx.config) });
    fx.resolve().unwrap();

    let a_lamports_before = fx.svm.get_balance(&a.pubkey()).unwrap();
    fx.claim(&a, a_tok).expect("winner claims");
    assert_eq!(fx.balance(&a_tok), 11 * SOL);
    assert!(fx.position(&a.pubkey()).is_none(), "position closed");
    assert!(fx.svm.get_balance(&a.pubkey()).unwrap() > a_lamports_before, "rent returned");

    fx.claim(&b, b_tok).expect("loser closes position");
    assert_eq!(fx.balance(&b_tok), 9 * SOL);
    assert!(fx.position(&b.pubkey()).is_none());

    let m = fx.market();
    assert_eq!(m.paid_out, 2 * SOL);
    assert_eq!(fx.balance(&fx.vault), 0);
}

#[test]
fn claim_uneven_sides_is_pro_rata_and_never_overpays() {
    let mut fx = Fx::new(TOKEN_PROGRAM);
    fx.create().unwrap();
    let (a, a_tok) = fx.trader(10 * SOL);
    let (c, c_tok) = fx.trader(10 * SOL);
    let (b, b_tok) = fx.trader(10 * SOL);
    // YES: a 1 SOL, c 2 SOL. NO: b 1 SOL. Pool 4 SOL, YES total 3 SOL.
    fx.stake(&a, a_tok, Side::Yes, SOL).unwrap();
    fx.stake(&c, c_tok, Side::Yes, 2 * SOL).unwrap();
    fx.stake(&b, b_tok, Side::No, SOL).unwrap();
    fx.set_pool(PoolSpec { is_migrated: 1, ..PoolSpec::open(fx.config) });
    fx.resolve().unwrap();

    fx.claim(&a, a_tok).unwrap();
    fx.claim(&c, c_tok).unwrap();
    fx.claim(&b, b_tok).unwrap();
    let a_pay = fx.balance(&a_tok) - 9 * SOL;
    let c_pay = fx.balance(&c_tok) - 8 * SOL;
    assert_eq!(a_pay, 4 * SOL / 3); // floor(1 * 4 / 3) in base units
    assert_eq!(c_pay, 2 * 4 * SOL / 3);
    assert_eq!(fx.balance(&b_tok), 9 * SOL);
    assert!(a_pay + c_pay <= 4 * SOL);
    assert_eq!(fx.balance(&fx.vault), 4 * SOL - a_pay - c_pay);
    assert_eq!(fx.market().paid_out, a_pay + c_pay);
}

#[test]
fn claim_single_winner_takes_whole_pool() {
    let mut fx = Fx::new(TOKEN_PROGRAM);
    fx.create().unwrap();
    let (a, a_tok) = fx.trader(10 * SOL);
    let (b, b_tok) = fx.trader(10 * SOL);
    let (c, c_tok) = fx.trader(10 * SOL);
    fx.stake(&a, a_tok, Side::No, SOL).unwrap();
    fx.stake(&b, b_tok, Side::Yes, 3 * SOL).unwrap();
    fx.stake(&c, c_tok, Side::Yes, 5 * SOL).unwrap();
    fx.time(fx.deadline + 1);
    fx.resolve().unwrap();
    assert_eq!(fx.market().state, MarketState::ResolvedNo);

    fx.claim(&a, a_tok).unwrap();
    assert_eq!(fx.balance(&a_tok), 18 * SOL);
    assert_eq!(fx.balance(&fx.vault), 0);
}

#[test]
fn claim_refund_returns_both_sides() {
    let mut fx = Fx::new(TOKEN_PROGRAM);
    fx.create().unwrap();
    let (a, a_tok) = fx.trader(10 * SOL);
    let (b, b_tok) = fx.trader(10 * SOL);
    fx.stake(&a, a_tok, Side::Yes, SOL).unwrap();
    fx.stake(&b, b_tok, Side::Yes, 2 * SOL).unwrap();
    // Nobody took NO, so YES winning would have nothing to win.
    fx.set_pool(PoolSpec { is_migrated: 1, ..PoolSpec::open(fx.config) });
    fx.resolve().unwrap();
    assert_eq!(fx.market().state, MarketState::Refund);

    fx.claim(&a, a_tok).unwrap();
    fx.claim(&b, b_tok).unwrap();
    assert_eq!(fx.balance(&a_tok), 10 * SOL);
    assert_eq!(fx.balance(&b_tok), 10 * SOL);
    assert_eq!(fx.balance(&fx.vault), 0);
}

#[test]
fn claim_refund_when_only_losers_exist() {
    let mut fx = Fx::new(TOKEN_PROGRAM);
    fx.create().unwrap();
    let (a, a_tok) = fx.trader(10 * SOL);
    fx.stake(&a, a_tok, Side::Yes, SOL).unwrap();
    fx.stake(&a, a_tok, Side::No, SOL).unwrap();
    // Deadline passes with NO winning, but YES total is non-zero and NO total
    // is non-zero here, so this is a real NO resolution for a who holds both.
    fx.time(fx.deadline + 1);
    fx.resolve().unwrap();
    assert_eq!(fx.market().state, MarketState::ResolvedNo);
    fx.claim(&a, a_tok).unwrap();
    assert_eq!(fx.balance(&a_tok), 10 * SOL);
}

#[test]
fn claim_rejects_double_claim() {
    let mut fx = Fx::new(TOKEN_PROGRAM);
    fx.create().unwrap();
    let ((a, a_tok), _) = two_sided(&mut fx);
    fx.set_pool(PoolSpec { is_migrated: 1, ..PoolSpec::open(fx.config) });
    fx.resolve().unwrap();
    fx.claim(&a, a_tok).unwrap();
    assert!(fx.claim(&a, a_tok).is_err(), "position is gone");
    assert_eq!(fx.balance(&a_tok), 11 * SOL);
}

#[test]
fn claim_rejects_before_resolution_and_other_users_position() {
    let mut fx = Fx::new(TOKEN_PROGRAM);
    fx.create().unwrap();
    let ((a, a_tok), (b, b_tok)) = two_sided(&mut fx);
    assert_err(fx.claim(&a, a_tok), CurveError::NotResolved);
    fx.set_pool(PoolSpec { is_migrated: 1, ..PoolSpec::open(fx.config) });
    fx.resolve().unwrap();
    // b signing for a's position: the PDA is derived from the signer, so the
    // account passed does not match and Anchor rejects it.
    let a_position = position_pda(&fx.pid, &fx.market, &a.pubkey());
    let res = send(
        &mut fx.svm,
        fx.pid,
        curve_market::instruction::Claim {}.data(),
        curve_market::accounts::Claim {
            user: b.pubkey(),
            market: fx.market,
            position: a_position,
            quote_mint: fx.mint,
            user_token: b_tok,
            vault: fx.vault,
            token_program: fx.token_program,
        }
        .to_account_metas(None),
        &[&b],
    );
    assert!(res.is_err());
    assert_eq!(fx.balance(&b_tok), 9 * SOL);
}

#[test]
fn stake_rejects_after_resolve() {
    let mut fx = Fx::new(TOKEN_PROGRAM);
    fx.create().unwrap();
    let ((a, a_tok), _) = two_sided(&mut fx);
    fx.set_pool(PoolSpec { is_migrated: 1, ..PoolSpec::open(fx.config) });
    fx.resolve().unwrap();
    // Still before the deadline, but the market is closed.
    assert_err(fx.stake(&a, a_tok, Side::Yes, SOL), CurveError::MarketNotOpen);
}

// ---------------------------------------------------------------------------
// Token-2022
// ---------------------------------------------------------------------------

#[test]
fn token_2022_quote_mint_round_trip() {
    let mut fx = Fx::new(TOKEN_2022_PROGRAM);
    fx.create().expect("create with token-2022 mint");
    assert_eq!(fx.market().token_program, TOKEN_2022_PROGRAM);
    let ((a, a_tok), (b, b_tok)) = two_sided(&mut fx);
    assert_eq!(fx.balance(&fx.vault), 2 * SOL);
    fx.time(fx.deadline + 1);
    fx.resolve().unwrap();
    fx.claim(&b, b_tok).unwrap();
    fx.claim(&a, a_tok).unwrap();
    assert_eq!(fx.balance(&b_tok), 11 * SOL);
    assert_eq!(fx.balance(&a_tok), 9 * SOL);
}

#[test]
fn create_rejects_mint_owned_by_other_token_program() {
    let mut fx = Fx::new(TOKEN_PROGRAM);
    // The config says this mint, but the mint is a Token-2022 mint while the
    // instruction passes the classic token program.
    let mint = set_mint(&mut fx.svm, TOKEN_2022_PROGRAM);
    set_config(&mut fx.svm, fx.config, mint, THRESHOLD);
    let (deadline, pool, config) = (fx.deadline, fx.pool, fx.config);
    assert!(fx.create_with(deadline, pool, config, mint).is_err());
}
