//! End-to-end tests over LiteSVM with the real pm-AMM and Metaplex Token
//! Metadata programs (dumped from mainnet by `scripts/fetch-test-programs.sh`)
//! and crafted DBC pool accounts. No network.

#[allow(dead_code)]
#[path = "../../curve_market/tests/common/mod.rs"]
mod common;

use {
    anchor_lang::{
        solana_program::instruction::AccountMeta, AccountDeserialize, InstructionData,
        ToAccountMetas,
    },
    common::*,
    grad_resolver::{market_id_for, pm, Binding},
    litesvm::LiteSVM,
    solana_keypair::Keypair,
    solana_pubkey::Pubkey,
    solana_signer::Signer,
};

const NOW: i64 = 1_800_000_000;
const DAY: i64 = 86_400;
const THRESHOLD: u64 = 85_000_000_000;
const UNIT: u64 = 1_000_000_000;
const SEED: u64 = 1_000 * UNIT;

const PM: Pubkey = pm::PM_AMM_PROGRAM_ID;
const MPL: Pubkey = pm::TOKEN_METADATA_PROGRAM_ID;
const PROTOCOL_DAO: Pubkey = Pubkey::from_str_const("4qXyczAr5DuBVaHUwmZT5Xt6hgQ6RwqBYcFGtrv8QEph");
const SWAP_DISCRIMINATOR: [u8; 8] = [248, 198, 158, 145, 225, 117, 135, 200];
const USDC_TO_YES: u8 = 0;
const PM_IDL: &str = include_str!("../../../pm-amm-idl.json");

/// `common::send` with a compute budget in front: opening a market runs
/// pm-AMM and Metaplex underneath and needs more than the default 200k units.
fn send(
    svm: &mut LiteSVM,
    program_id: Pubkey,
    data: Vec<u8>,
    metas: Vec<AccountMeta>,
    signers: &[&Keypair],
) -> Result<(), String> {
    use {
        anchor_lang::solana_program::instruction::Instruction,
        solana_message::{Message, VersionedMessage},
        solana_transaction::versioned::VersionedTransaction,
    };
    let mut budget = vec![2u8];
    budget.extend_from_slice(&1_400_000u32.to_le_bytes());
    let cb = Instruction {
        program_id: Pubkey::from_str_const("ComputeBudget111111111111111111111111111111"),
        accounts: vec![],
        data: budget,
    };
    let ix = Instruction { program_id, accounts: metas, data };
    svm.expire_blockhash();
    let blockhash = svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[cb, ix], Some(&signers[0].pubkey()), &blockhash);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), signers).map_err(|e| e.to_string())?;
    match svm.send_transaction(tx) {
        Ok(meta) => {
            if std::env::var_os("CURVE_CU").is_some() {
                eprintln!("compute units: {}", meta.compute_units_consumed);
            }
            Ok(())
        }
        Err(e) => Err(format!("{:?} | {}", e.err, e.meta.logs.join(" / "))),
    }
}

fn pda(seeds: &[&[u8]], program: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(seeds, program).0
}

struct Fx {
    svm: LiteSVM,
    pid: Pubkey,
    mint: Pubkey,
    pool: Pubkey,
    config: Pubkey,
    opener: Keypair,
    opener_tok: Pubkey,
    deadline: i64,
    binding: Pubkey,
    authority: Pubkey,
    collateral: Pubkey,
    pm_market: Pubkey,
    yes_mint: Pubkey,
    no_mint: Pubkey,
    pm_vault: Pubkey,
    lp_position: Pubkey,
    auth_yes: Pubkey,
    auth_no: Pubkey,
}

impl Fx {
    fn new() -> Self {
        Self::with_deadline(NOW + DAY)
    }

    fn with_deadline(deadline: i64) -> Self {
        let pid = grad_resolver::id();
        let mut svm = LiteSVM::new();
        let dir = concat!(env!("CARGO_MANIFEST_DIR"), "/tests/fixtures");
        svm.add_program(pid, include_bytes!(concat!(env!("CARGO_TARGET_TMPDIR"), "/../deploy/grad_resolver.so")))
            .unwrap();
        svm.add_program_from_file(PM, format!("{dir}/pm_amm.so")).expect("run scripts/fetch-test-programs.sh");
        svm.add_program_from_file(MPL, format!("{dir}/mpl_token_metadata.so")).unwrap();
        set_time(&mut svm, NOW);

        let mint = set_mint(&mut svm, TOKEN_PROGRAM);
        let pool = Pubkey::new_unique();
        let config = Pubkey::new_unique();
        // The pool's own quote mint does not matter here; the market trades in `mint`.
        set_config(&mut svm, config, Pubkey::new_unique(), THRESHOLD);
        set_pool(&mut svm, pool, &PoolSpec::open(config));
        let opener = fund(&mut svm);
        let opener_tok = set_token_account(&mut svm, TOKEN_PROGRAM, mint, opener.pubkey(), 10 * SEED);

        let binding = pda(&[grad_resolver::BINDING_SEED, pool.as_ref(), &deadline.to_le_bytes()], &pid);
        let authority = pda(&[grad_resolver::AUTHORITY_SEED, binding.as_ref()], &pid);
        let collateral = pda(&[grad_resolver::COLLATERAL_SEED, binding.as_ref()], &pid);
        let pm_market = pda(&[b"market", &market_id_for(&binding).to_le_bytes()], &PM);
        let yes_mint = pda(&[b"yes_mint", pm_market.as_ref()], &PM);
        let no_mint = pda(&[b"no_mint", pm_market.as_ref()], &PM);
        let pm_vault = pda(&[b"vault", pm_market.as_ref()], &PM);
        let lp_position = pda(&[b"lp", pm_market.as_ref(), authority.as_ref()], &PM);
        let auth_yes = pda(&[grad_resolver::YES_SEED, binding.as_ref()], &pid);
        let auth_no = pda(&[grad_resolver::NO_SEED, binding.as_ref()], &pid);
        Fx {
            svm, pid, mint, pool, config, opener, opener_tok, deadline, binding, authority, collateral,
            pm_market, yes_mint, no_mint, pm_vault, lp_position, auth_yes, auth_no,
        }
    }

    fn time(&mut self, t: i64) {
        set_time(&mut self.svm, t);
    }

    fn set_pool(&mut self, spec: PoolSpec) {
        set_pool(&mut self.svm, self.pool, &spec);
    }

    fn open(&mut self) -> Result<(), String> {
        let (deadline, seed) = (self.deadline, SEED);
        let metadata = |mint: &Pubkey| pda(&[b"metadata", MPL.as_ref(), mint.as_ref()], &MPL);
        let opener = self.opener.insecure_clone();
        send(
            &mut self.svm,
            self.pid,
            grad_resolver::instruction::OpenMarket {
                deadline_ts: deadline,
                initial_price_bps: 5_000,
                seed_amount: seed,
                name: "Graduates by tomorrow?".into(),
            }
            .data(),
            grad_resolver::accounts::OpenMarket {
                opener: opener.pubkey(),
                pool: self.pool,
                config: self.config,
                binding: self.binding,
                authority: self.authority,
                collateral_mint: self.mint,
                opener_collateral: self.opener_tok,
                authority_collateral: self.collateral,
                pm_market: self.pm_market,
                yes_mint: self.yes_mint,
                no_mint: self.no_mint,
                pm_vault: self.pm_vault,
                yes_metadata: metadata(&self.yes_mint),
                no_metadata: metadata(&self.no_mint),
                lp_position: self.lp_position,
                pm_amm_program: PM,
                token_metadata_program: MPL,
                token_program: TOKEN_PROGRAM,
                system_program: system_program(),
                rent: Pubkey::from_str_const("SysvarRent111111111111111111111111111111111"),
            }
            .to_account_metas(None),
            &[&opener],
        )
    }

    fn halt(&mut self) -> Result<(), String> {
        let caller = fund(&mut self.svm);
        send(
            &mut self.svm,
            self.pid,
            grad_resolver::instruction::Halt {}.data(),
            grad_resolver::accounts::Halt {
                caller: caller.pubkey(),
                binding: self.binding,
                pool: self.pool,
                config: self.config,
                authority: self.authority,
                pm_market: self.pm_market,
                collateral_mint: self.mint,
                yes_mint: self.yes_mint,
                no_mint: self.no_mint,
                lp_position: self.lp_position,
                authority_yes: self.auth_yes,
                authority_no: self.auth_no,
                pm_amm_program: PM,
                token_program: TOKEN_PROGRAM,
                system_program: system_program(),
            }
            .to_account_metas(None),
            &[&caller],
        )
    }

    fn resolve_with(&mut self, pool: Pubkey) -> Result<(), String> {
        let caller = fund(&mut self.svm);
        send(
            &mut self.svm,
            self.pid,
            grad_resolver::instruction::Resolve {}.data(),
            grad_resolver::accounts::Resolve {
                binding: self.binding,
                pool,
                config: self.config,
                authority: self.authority,
                pm_market: self.pm_market,
                pm_amm_program: PM,
            }
            .to_account_metas(None),
            &[&caller],
        )
    }

    fn resolve(&mut self) -> Result<(), String> {
        self.resolve_with(self.pool)
    }

    fn settle(&mut self) -> Result<(), String> {
        let caller = fund(&mut self.svm);
        send(
            &mut self.svm,
            self.pid,
            grad_resolver::instruction::Settle {}.data(),
            grad_resolver::accounts::Settle {
                binding: self.binding,
                authority: self.authority,
                pm_market: self.pm_market,
                collateral_mint: self.mint,
                yes_mint: self.yes_mint,
                no_mint: self.no_mint,
                pm_vault: self.pm_vault,
                authority_collateral: self.collateral,
                authority_yes: self.auth_yes,
                authority_no: self.auth_no,
                opener_collateral: self.opener_tok,
                pm_amm_program: PM,
                token_program: TOKEN_PROGRAM,
            }
            .to_account_metas(None),
            &[&caller],
        )
    }

    /// A trader buying YES with `amount` collateral straight through pm-AMM.
    fn buy_yes(&mut self, amount: u64) -> Result<(), String> {
        let trader = fund(&mut self.svm);
        let user_col = set_token_account(&mut self.svm, TOKEN_PROGRAM, self.mint, trader.pubkey(), amount);
        let user_yes = set_token_account(&mut self.svm, TOKEN_PROGRAM, self.yes_mint, trader.pubkey(), 0);
        let user_no = set_token_account(&mut self.svm, TOKEN_PROGRAM, self.no_mint, trader.pubkey(), 0);
        let dao = set_token_account(&mut self.svm, TOKEN_PROGRAM, self.mint, PROTOCOL_DAO, 0);
        let mut data = SWAP_DISCRIMINATOR.to_vec();
        data.push(USDC_TO_YES);
        data.extend_from_slice(&amount.to_le_bytes());
        data.extend_from_slice(&0u64.to_le_bytes());
        let metas = vec![
            AccountMeta::new(trader.pubkey(), true),
            AccountMeta::new(self.pm_market, false),
            AccountMeta::new_readonly(self.mint, false),
            AccountMeta::new(self.yes_mint, false),
            AccountMeta::new(self.no_mint, false),
            AccountMeta::new(self.pm_vault, false),
            AccountMeta::new(user_col, false),
            AccountMeta::new(user_yes, false),
            AccountMeta::new(user_no, false),
            AccountMeta::new(dao, false),
            AccountMeta::new(self.collateral, false),
            AccountMeta::new_readonly(TOKEN_PROGRAM, false),
        ];
        send(&mut self.svm, PM, data, metas, &[&trader])
    }

    fn binding(&self) -> Binding {
        let acc = self.svm.get_account(&self.binding).expect("binding");
        Binding::try_deserialize(&mut acc.data.as_slice()).unwrap()
    }

    fn pm_market_data(&self) -> Vec<u8> {
        self.svm.get_account(&self.pm_market).expect("pm market").data
    }

    /// The PDA's LP shares; zero once pm-AMM has closed the position.
    fn lp_shares(&self) -> u128 {
        match self.svm.get_account(&self.lp_position) {
            Some(acc) if acc.lamports > 0 && !acc.data.is_empty() => pm::parse_lp_position(&acc.data).unwrap().shares,
            _ => 0,
        }
    }

    fn balance(&self, key: &Pubkey) -> u64 {
        token_balance(&self.svm, key)
    }
}

fn assert_fails_with(res: Result<(), String>, needle: &str) {
    match res {
        Ok(()) => panic!("expected failure containing {needle:?}, but the transaction succeeded"),
        Err(e) => assert!(e.contains(needle), "expected {needle:?} in: {e}"),
    }
}

/// pm-AMM stores the winner as 1 for YES and 2 for NO (0 while open).
const PM_WON_YES: u8 = 1;
const PM_WON_NO: u8 = 2;

/// pm-AMM's `resolved` and `winning_side` fields, by IDL offset.
fn pm_resolution(data: &[u8]) -> (bool, u8) {
    let idl = PmIdl::load();
    (data[idl.offset("Market", "resolved")] == 1, data[idl.offset("Market", "winning_side")])
}

// ---------------------------------------------------------------------------
// open_market
// ---------------------------------------------------------------------------

#[test]
fn open_creates_pm_market_owned_by_the_binding_pda() {
    let mut fx = Fx::new();
    fx.open().expect("open");

    let view = pm::parse_market(&fx.pm_market_data()).unwrap();
    assert_eq!(view.authority, fx.authority);
    assert_eq!(view.market_id, market_id_for(&fx.binding));
    assert_eq!(view.collateral_mint, fx.mint);
    assert_eq!((view.yes_mint, view.no_mint, view.vault), (fx.yes_mint, fx.no_mint, fx.pm_vault));

    let b = fx.binding();
    assert_eq!((b.pool, b.config, b.pm_market, b.opener), (fx.pool, fx.config, fx.pm_market, fx.opener.pubkey()));
    assert_eq!((b.deadline_ts, b.migration_quote_threshold, b.seed_amount), (fx.deadline, THRESHOLD, SEED));
    assert!(!b.halted && !b.resolved);

    // The seed went from the opener into pm-AMM's vault as the PDA's LP position.
    assert_eq!(fx.balance(&fx.opener_tok), 9 * SEED);
    assert_eq!(fx.balance(&fx.pm_vault), SEED);
    assert!(fx.lp_shares() > 0);
}

#[test]
fn open_rejects_a_finished_pool_and_bad_deadlines() {
    let mut fx = Fx::new();
    fx.set_pool(PoolSpec { is_migrated: 1, ..PoolSpec::open(fx.config) });
    assert_fails_with(fx.open(), "PoolAlreadyComplete");

    let mut fx = Fx::new();
    fx.set_pool(PoolSpec { quote_reserve: THRESHOLD, ..PoolSpec::open(fx.config) });
    assert_fails_with(fx.open(), "PoolAlreadyComplete");

    let mut fx = Fx::with_deadline(NOW + 299);
    assert_fails_with(fx.open(), "DeadlineTooSoon");
    let mut fx = Fx::with_deadline(NOW + 181 * DAY);
    assert_fails_with(fx.open(), "DeadlineTooFar");
}

#[test]
fn open_twice_for_the_same_pool_and_deadline_fails() {
    let mut fx = Fx::new();
    fx.open().expect("open");
    assert!(fx.open().is_err());
}

// ---------------------------------------------------------------------------
// halt
// ---------------------------------------------------------------------------

#[test]
fn trading_works_until_graduation_then_halt_stops_it() {
    let mut fx = Fx::new();
    fx.open().unwrap();
    fx.buy_yes(10 * UNIT).expect("trading is open");
    // The PDA, as creator, got its half of the 2% fee on the USDC leg.
    assert_eq!(fx.balance(&fx.collateral), UNIT / 10);

    // While the question is open, halt is refused.
    assert_fails_with(fx.halt(), "NotYet");

    // The pool graduates. Before the halt, the market would still trade.
    fx.set_pool(PoolSpec { is_migrated: 1, ..PoolSpec::open(fx.config) });
    fx.halt().expect("halt");
    assert!(fx.binding().halted);
    assert_eq!(fx.lp_shares(), 0);
    assert!(fx.balance(&fx.auth_yes) + fx.balance(&fx.auth_no) > 0, "the LP's outcome tokens came back");

    // With no liquidity left, pm-AMM refuses the informed trade.
    assert_fails_with(fx.buy_yes(900 * UNIT), "InsufficientLiquidity");
    assert_fails_with(fx.halt(), "AlreadyHalted");
}

#[test]
fn halt_works_on_each_completion_signal_and_after_the_deadline() {
    let specs = |config| {
        vec![
            PoolSpec { finish_curve_timestamp: NOW as u64 - 1, ..PoolSpec::open(config) },
            PoolSpec { quote_reserve: THRESHOLD, ..PoolSpec::open(config) },
        ]
    };
    for i in 0..2 {
        let mut fx = Fx::new();
        fx.open().unwrap();
        let spec = specs(fx.config).remove(i);
        fx.set_pool(spec);
        fx.halt().expect("halt on completion");
    }
    let mut fx = Fx::new();
    fx.open().unwrap();
    fx.time(fx.deadline + 1);
    fx.halt().expect("halt once the deadline has passed");
}

#[test]
fn halt_rejects_a_foreign_pool_or_market() {
    let mut fx = Fx::new();
    fx.open().unwrap();
    let decoy = Pubkey::new_unique();
    set_pool(&mut fx.svm, decoy, &PoolSpec { is_migrated: 1, ..PoolSpec::open(fx.config) });
    let real = fx.pool;
    fx.pool = decoy;
    assert_fails_with(fx.halt(), "MarketMismatch");
    fx.pool = real;
    fx.pm_market = Pubkey::new_unique();
    assert_fails_with(fx.halt(), "MarketMismatch");
}

// ---------------------------------------------------------------------------
// resolve
// ---------------------------------------------------------------------------

#[test]
fn resolve_yes_waits_for_pm_end_then_settles_from_the_pool() {
    let mut fx = Fx::new();
    fx.open().unwrap();
    fx.set_pool(PoolSpec { finish_curve_timestamp: (NOW + 60) as u64, ..PoolSpec::open(fx.config) });
    fx.time(NOW + 120);
    assert_fails_with(fx.resolve(), "NotHalted");
    fx.halt().unwrap();
    // The outcome is known, but pm-AMM only resolves at its end_ts.
    assert_fails_with(fx.resolve(), "MarketNotExpired");

    fx.time(fx.deadline);
    fx.resolve().expect("resolve");
    assert!(fx.binding().resolved);
    assert_eq!(pm_resolution(&fx.pm_market_data()), (true, PM_WON_YES));
    assert_fails_with(fx.resolve(), "AlreadyResolved");
}

#[test]
fn resolve_no_when_the_deadline_passes_first() {
    let mut fx = Fx::new();
    fx.open().unwrap();
    assert_fails_with(fx.halt(), "NotYet");
    // At the deadline itself the curve can still finish in time.
    fx.time(fx.deadline);
    assert_fails_with(fx.halt(), "NotYet");
    fx.time(fx.deadline + 1);
    fx.halt().unwrap();
    fx.resolve().expect("resolve");
    assert_eq!(pm_resolution(&fx.pm_market_data()), (true, PM_WON_NO));
}

#[test]
fn resolve_rejects_a_foreign_pool() {
    let mut fx = Fx::new();
    fx.open().unwrap();
    fx.time(fx.deadline + 1);
    let decoy = Pubkey::new_unique();
    set_pool(&mut fx.svm, decoy, &PoolSpec { is_migrated: 1, ..PoolSpec::open(fx.config) });
    assert_fails_with(fx.resolve_with(decoy), "MarketMismatch");
}

// ---------------------------------------------------------------------------
// settle
// ---------------------------------------------------------------------------

#[test]
fn settle_returns_the_lp_and_creator_fees_to_the_opener() {
    let mut fx = Fx::new();
    fx.open().unwrap();
    fx.buy_yes(10 * UNIT).unwrap();
    let fee = fx.balance(&fx.collateral);
    assert!(fee > 0);

    fx.set_pool(PoolSpec { is_migrated: 1, ..PoolSpec::open(fx.config) });
    fx.halt().unwrap();
    assert_fails_with(fx.settle(), "NotResolved");
    fx.time(fx.deadline);
    fx.resolve().unwrap();

    let before = fx.balance(&fx.opener_tok);
    fx.settle().expect("settle");
    let back = fx.balance(&fx.opener_tok) - before;
    // The LP sold YES to the trader, so it holds mostly NO and gets back less
    // than its seed, plus the fee. It never gets more than the vault held.
    assert!(back > fee, "opener got {back}, fee alone was {fee}");
    assert!(back <= SEED + 10 * UNIT, "opener got {back}");
    assert_eq!(fx.balance(&fx.collateral), 0);
    assert!(fx.binding().settled);
    // pm-AMM closes the claimed outcome-token accounts, so a second settle
    // fails on those accounts even before the `AlreadySettled` check.
    assert!(fx.settle().is_err());
}

#[test]
fn settle_with_no_trades_returns_the_whole_seed() {
    let mut fx = Fx::new();
    fx.open().unwrap();
    fx.time(fx.deadline + 1);
    fx.halt().unwrap();
    fx.resolve().unwrap();
    fx.settle().expect("settle");
    // pm-AMM rounds in its own favour; allow a few base units of dust.
    let got = fx.balance(&fx.opener_tok);
    assert!(got <= 10 * SEED && got + 1_000 >= 10 * SEED, "opener has {got}");
}

// ---------------------------------------------------------------------------
// pm-AMM layout pinned against its IDL
// ---------------------------------------------------------------------------

struct PmIdl(serde_json::Value);

impl PmIdl {
    fn load() -> Self {
        PmIdl(serde_json::from_str(PM_IDL).unwrap())
    }

    fn size(ty: &serde_json::Value) -> usize {
        match ty.as_str() {
            Some("pubkey") => 32,
            Some("u128" | "i128") => 16,
            Some("u64" | "i64") => 8,
            Some("u32" | "i32") => 4,
            Some("u16" | "i16") => 2,
            Some("u8" | "i8" | "bool") => 1,
            _ => {
                let arr = &ty["array"];
                Self::size(&arr[0]) * arr[1].as_u64().unwrap() as usize
            }
        }
    }

    fn offset(&self, account: &str, field: &str) -> usize {
        let ty = self.0["types"].as_array().unwrap().iter().find(|t| t["name"] == account).unwrap();
        let mut off = 8;
        for f in ty["type"]["fields"].as_array().unwrap() {
            if f["name"] == field {
                return off;
            }
            off += Self::size(&f["type"]);
        }
        panic!("no field {field} in {account}");
    }

    fn discriminator(&self, kind: &str, name: &str) -> Vec<u8> {
        let item = self.0[kind].as_array().unwrap().iter().find(|i| i["name"] == name).unwrap();
        item["discriminator"].as_array().unwrap().iter().map(|b| b.as_u64().unwrap() as u8).collect()
    }
}

#[test]
fn pm_offsets_and_discriminators_match_idl() {
    let idl = PmIdl::load();
    assert_eq!(idl.0["address"], PM.to_string());
    use pm::market_offsets as m;
    assert_eq!(idl.offset("Market", "authority"), m::AUTHORITY);
    assert_eq!(idl.offset("Market", "market_id"), m::MARKET_ID);
    assert_eq!(idl.offset("Market", "collateral_mint"), m::COLLATERAL_MINT);
    assert_eq!(idl.offset("Market", "yes_mint"), m::YES_MINT);
    assert_eq!(idl.offset("Market", "no_mint"), m::NO_MINT);
    assert_eq!(idl.offset("Market", "vault"), m::VAULT);
    use pm::lp_offsets as l;
    assert_eq!(idl.offset("LpPosition", "owner"), l::OWNER);
    assert_eq!(idl.offset("LpPosition", "market"), l::MARKET);
    assert_eq!(idl.offset("LpPosition", "shares"), l::SHARES);
    assert_eq!(idl.offset("LpPosition", "collateral_deposited"), l::END);

    assert_eq!(idl.discriminator("accounts", "Market"), pm::MARKET_DISCRIMINATOR);
    assert_eq!(idl.discriminator("accounts", "LpPosition"), pm::LP_POSITION_DISCRIMINATOR);
    assert_eq!(idl.discriminator("instructions", "initialize_market"), pm::INITIALIZE_MARKET_DISCRIMINATOR);
    assert_eq!(idl.discriminator("instructions", "deposit_liquidity"), pm::DEPOSIT_LIQUIDITY_DISCRIMINATOR);
    assert_eq!(idl.discriminator("instructions", "withdraw_liquidity"), pm::WITHDRAW_LIQUIDITY_DISCRIMINATOR);
    assert_eq!(idl.discriminator("instructions", "resolve_market"), pm::RESOLVE_MARKET_DISCRIMINATOR);
    assert_eq!(idl.discriminator("instructions", "swap"), SWAP_DISCRIMINATOR);
}
