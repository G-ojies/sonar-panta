//! Shared helpers: an IDL layout walker, crafted DBC accounts, raw SPL token
//! accounts and a thin transaction sender over LiteSVM.

#![allow(dead_code)]

use {
    anchor_lang::{
        solana_program::instruction::{AccountMeta, Instruction},
        AccountDeserialize,
    },
    curve_market::dbc,
    litesvm::LiteSVM,
    solana_account::Account,
    solana_clock::Clock,
    solana_keypair::Keypair,
    solana_message::{Message, VersionedMessage},
    solana_pubkey::Pubkey,
    solana_signer::Signer,
    solana_transaction::versioned::VersionedTransaction,
    std::collections::HashMap,
};

pub const DBC_IDL: &str = include_str!("../../../../dbc-idl.json");
/// Real mainnet TransferHookPool accounts and their configs (hex), read once
/// with getMultipleAccounts; see the file's `slot`.
pub const TRANSFER_HOOK_FIXTURE: &str = include_str!("../fixtures/transfer_hook_pools.json");

pub const TOKEN_PROGRAM: Pubkey =
    Pubkey::from_str_const("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
pub const TOKEN_2022_PROGRAM: Pubkey =
    Pubkey::from_str_const("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");

pub fn system_program() -> Pubkey {
    Pubkey::default()
}

// ---------------------------------------------------------------------------
// IDL layout walker
// ---------------------------------------------------------------------------

/// A field laid out by walking the IDL: name, byte offset in the account
/// (discriminator included) and byte size.
#[derive(Debug, Clone)]
pub struct Field {
    pub name: String,
    pub offset: usize,
    pub size: usize,
}

pub struct Idl {
    types: HashMap<String, serde_json::Value>,
    accounts: HashMap<String, Vec<u8>>,
}

impl Idl {
    pub fn load() -> Self {
        let v: serde_json::Value = serde_json::from_str(DBC_IDL).expect("idl json");
        let mut types = HashMap::new();
        for t in v["types"].as_array().expect("types") {
            types.insert(t["name"].as_str().unwrap().to_string(), t["type"].clone());
        }
        let mut accounts = HashMap::new();
        for a in v["accounts"].as_array().expect("accounts") {
            let disc = a["discriminator"]
                .as_array()
                .unwrap()
                .iter()
                .map(|x| x.as_u64().unwrap() as u8)
                .collect();
            accounts.insert(a["name"].as_str().unwrap().to_string(), disc);
        }
        Self { types, accounts }
    }

    pub fn address(&self) -> Pubkey {
        let v: serde_json::Value = serde_json::from_str(DBC_IDL).unwrap();
        v["address"].as_str().unwrap().parse().unwrap()
    }

    pub fn discriminator(&self, account: &str) -> Vec<u8> {
        self.accounts[account].clone()
    }

    /// Every account type the IDL declares, sorted.
    pub fn account_names(&self) -> Vec<String> {
        let mut names: Vec<String> = self.accounts.keys().cloned().collect();
        names.sort();
        names
    }

    fn size_of(&self, ty: &serde_json::Value) -> usize {
        if let Some(s) = ty.as_str() {
            return match s {
                "u8" | "i8" | "bool" => 1,
                "u16" | "i16" => 2,
                "u32" | "i32" => 4,
                "u64" | "i64" => 8,
                "u128" | "i128" => 16,
                "pubkey" => 32,
                other => panic!("unsupported primitive {other}"),
            };
        }
        if let Some(arr) = ty.get("array") {
            let inner = &arr[0];
            let n = arr[1].as_u64().unwrap() as usize;
            return self.size_of(inner) * n;
        }
        if let Some(d) = ty.get("defined") {
            let name = d["name"].as_str().unwrap();
            return self.struct_size(name);
        }
        panic!("unsupported type {ty}");
    }

    pub fn struct_size(&self, name: &str) -> usize {
        let t = &self.types[name];
        assert_eq!(t["kind"], "struct", "{name} is not a struct");
        t["fields"]
            .as_array()
            .unwrap()
            .iter()
            .map(|f| self.size_of(&f["type"]))
            .sum()
    }

    /// Top-level fields of `name`, offset from `base`.
    pub fn fields(&self, name: &str, base: usize) -> Vec<Field> {
        let t = &self.types[name];
        let mut off = base;
        let mut out = Vec::new();
        for f in t["fields"].as_array().unwrap() {
            let size = self.size_of(&f["type"]);
            out.push(Field { name: f["name"].as_str().unwrap().to_string(), offset: off, size });
            off += size;
        }
        out
    }

    /// Fields of an account, discriminator included. `VirtualPool` wraps a
    /// single `PoolState`, so its fields are flattened.
    pub fn account_fields(&self, account: &str) -> Vec<Field> {
        let fields = self.fields(account, 8);
        if fields.len() == 1 {
            if let Some(d) = self.types[account]["fields"][0]["type"].get("defined") {
                return self.fields(d["name"].as_str().unwrap(), 8);
            }
        }
        fields
    }

    /// Offset of `field` inside the struct-typed field `outer` of `account`,
    /// for wrappers with more than one field (`ConfigWithTransferHook.config`).
    pub fn nested_offset(&self, account: &str, outer: &str, field: &str) -> usize {
        let base = self.fields(account, 8).into_iter().find(|f| f.name == outer).expect("outer field");
        let t = self.types[account]["fields"]
            .as_array()
            .unwrap()
            .iter()
            .find(|f| f["name"] == outer)
            .unwrap()["type"]["defined"]["name"]
            .as_str()
            .unwrap()
            .to_string();
        self.fields(&t, base.offset)
            .into_iter()
            .find(|f| f.name == field)
            .unwrap_or_else(|| panic!("{account}.{outer}.{field} not in idl"))
            .offset
    }

    pub fn account_len(&self, account: &str) -> usize {
        8 + self.struct_size(account)
    }

    pub fn offset(&self, account: &str, field: &str) -> usize {
        self.account_fields(account)
            .into_iter()
            .find(|f| f.name == field)
            .unwrap_or_else(|| panic!("{account}.{field} not in idl"))
            .offset
    }
}

// ---------------------------------------------------------------------------
// Real DBC accounts
// ---------------------------------------------------------------------------

/// One snapshotted pool and its config, as raw account data.
pub struct RealPool {
    pub pool: Pubkey,
    pub pool_data: Vec<u8>,
    pub config: Pubkey,
    pub config_data: Vec<u8>,
}

fn unhex(s: &str) -> Vec<u8> {
    (0..s.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(&s[i..i + 2], 16).expect("hex"))
        .collect()
}

/// The snapshotted mainnet TransferHookPools, in file order.
pub fn real_transfer_hook_pools() -> Vec<RealPool> {
    let v: serde_json::Value = serde_json::from_str(TRANSFER_HOOK_FIXTURE).expect("fixture json");
    v["accounts"]
        .as_array()
        .unwrap()
        .iter()
        .map(|a| RealPool {
            pool: a["pool"].as_str().unwrap().parse().unwrap(),
            pool_data: unhex(a["poolData"].as_str().unwrap()),
            config: a["config"].as_str().unwrap().parse().unwrap(),
            config_data: unhex(a["configData"].as_str().unwrap()),
        })
        .collect()
}

// ---------------------------------------------------------------------------
// Crafted DBC accounts
// ---------------------------------------------------------------------------

#[derive(Clone, Copy, Debug)]
pub struct PoolSpec {
    pub kind: dbc::PoolKind,
    pub config: Pubkey,
    pub quote_reserve: u64,
    pub is_migrated: u8,
    pub finish_curve_timestamp: u64,
}

impl PoolSpec {
    pub fn open(config: Pubkey) -> Self {
        Self::open_kind(config, dbc::PoolKind::Virtual)
    }

    pub fn open_kind(config: Pubkey, kind: dbc::PoolKind) -> Self {
        Self { kind, config, quote_reserve: 1_000, is_migrated: 0, finish_curve_timestamp: 0 }
    }
}

/// Discriminator and full length of a pool account of `kind`.
pub fn pool_layout(kind: dbc::PoolKind) -> ([u8; 8], usize) {
    match kind {
        dbc::PoolKind::Virtual => (dbc::VIRTUAL_POOL_DISCRIMINATOR, dbc::VIRTUAL_POOL_LEN),
        dbc::PoolKind::TransferHook => {
            (dbc::TRANSFER_HOOK_POOL_DISCRIMINATOR, dbc::TRANSFER_HOOK_POOL_LEN)
        }
    }
}

/// Discriminator and full length of a config account of `kind`.
pub fn config_layout(kind: dbc::PoolKind) -> ([u8; 8], usize) {
    match kind {
        dbc::PoolKind::Virtual => (dbc::POOL_CONFIG_DISCRIMINATOR, dbc::POOL_CONFIG_LEN),
        dbc::PoolKind::TransferHook => {
            (dbc::CONFIG_WITH_TRANSFER_HOOK_DISCRIMINATOR, dbc::CONFIG_WITH_TRANSFER_HOOK_LEN)
        }
    }
}

pub fn pool_bytes(spec: &PoolSpec) -> Vec<u8> {
    let (disc, len) = pool_layout(spec.kind);
    let mut d = vec![0u8; len];
    d[..8].copy_from_slice(&disc);
    d[dbc::pool_offsets::CONFIG..dbc::pool_offsets::CONFIG + 32]
        .copy_from_slice(spec.config.as_ref());
    d[dbc::pool_offsets::QUOTE_RESERVE..dbc::pool_offsets::QUOTE_RESERVE + 8]
        .copy_from_slice(&spec.quote_reserve.to_le_bytes());
    d[dbc::pool_offsets::IS_MIGRATED] = spec.is_migrated;
    d[dbc::pool_offsets::FINISH_CURVE_TIMESTAMP..dbc::pool_offsets::FINISH_CURVE_TIMESTAMP + 8]
        .copy_from_slice(&spec.finish_curve_timestamp.to_le_bytes());
    d
}

pub fn config_bytes(quote_mint: Pubkey, threshold: u64) -> Vec<u8> {
    config_bytes_kind(dbc::PoolKind::Virtual, quote_mint, threshold)
}

pub fn config_bytes_kind(kind: dbc::PoolKind, quote_mint: Pubkey, threshold: u64) -> Vec<u8> {
    let (disc, len) = config_layout(kind);
    let mut d = vec![0u8; len];
    d[..8].copy_from_slice(&disc);
    d[dbc::config_offsets::QUOTE_MINT..dbc::config_offsets::QUOTE_MINT + 32]
        .copy_from_slice(quote_mint.as_ref());
    d[dbc::config_offsets::MIGRATION_QUOTE_THRESHOLD
        ..dbc::config_offsets::MIGRATION_QUOTE_THRESHOLD + 8]
        .copy_from_slice(&threshold.to_le_bytes());
    if kind == dbc::PoolKind::TransferHook {
        // transfer_hook_program follows the embedded PoolConfig; a non-zero
        // key so a parser reading past the PoolConfig would notice.
        d[dbc::POOL_CONFIG_LEN..dbc::POOL_CONFIG_LEN + 32].fill(0xEE);
    }
    d
}

pub fn set_account(svm: &mut LiteSVM, key: Pubkey, owner: Pubkey, data: Vec<u8>) {
    svm.set_account(
        key,
        Account { lamports: 10_000_000_000, data, owner, executable: false, rent_epoch: 0 },
    )
    .unwrap();
}

pub fn set_pool(svm: &mut LiteSVM, key: Pubkey, spec: &PoolSpec) {
    set_account(svm, key, dbc::DBC_PROGRAM_ID, pool_bytes(spec));
}

pub fn set_config(svm: &mut LiteSVM, key: Pubkey, quote_mint: Pubkey, threshold: u64) {
    set_config_kind(svm, key, dbc::PoolKind::Virtual, quote_mint, threshold);
}

pub fn set_config_kind(
    svm: &mut LiteSVM,
    key: Pubkey,
    kind: dbc::PoolKind,
    quote_mint: Pubkey,
    threshold: u64,
) {
    set_account(svm, key, dbc::DBC_PROGRAM_ID, config_bytes_kind(kind, quote_mint, threshold));
}

// ---------------------------------------------------------------------------
// Raw SPL token accounts (same base layout for Token and Token-2022)
// ---------------------------------------------------------------------------

pub const MINT_LEN: usize = 82;
pub const TOKEN_ACCOUNT_LEN: usize = 165;
pub const DECIMALS: u8 = 9;

pub fn mint_bytes(decimals: u8) -> Vec<u8> {
    let mut d = vec![0u8; MINT_LEN];
    // mint_authority: COption::None (tag 0, 32 zero bytes)
    // supply at 36
    d[36..44].copy_from_slice(&u64::MAX.to_le_bytes());
    d[44] = decimals;
    d[45] = 1; // is_initialized
    d
}

pub fn token_account_bytes(mint: Pubkey, owner: Pubkey, amount: u64) -> Vec<u8> {
    let mut d = vec![0u8; TOKEN_ACCOUNT_LEN];
    d[0..32].copy_from_slice(mint.as_ref());
    d[32..64].copy_from_slice(owner.as_ref());
    d[64..72].copy_from_slice(&amount.to_le_bytes());
    d[108] = 1; // state: Initialized
    d
}

pub fn token_balance(svm: &LiteSVM, key: &Pubkey) -> u64 {
    let acct = svm.get_account(key).expect("token account");
    u64::from_le_bytes(acct.data[64..72].try_into().unwrap())
}

pub fn set_mint(svm: &mut LiteSVM, token_program: Pubkey) -> Pubkey {
    let mint = Pubkey::new_unique();
    set_account(svm, mint, token_program, mint_bytes(DECIMALS));
    mint
}

pub fn set_token_account(
    svm: &mut LiteSVM,
    token_program: Pubkey,
    mint: Pubkey,
    owner: Pubkey,
    amount: u64,
) -> Pubkey {
    let key = Pubkey::new_unique();
    set_account(svm, key, token_program, token_account_bytes(mint, owner, amount));
    key
}

// ---------------------------------------------------------------------------
// Transactions and clock
// ---------------------------------------------------------------------------

pub fn load_program() -> (LiteSVM, Pubkey) {
    let program_id = curve_market::id();
    let mut svm = LiteSVM::new();
    let bytes = include_bytes!(concat!(env!("CARGO_TARGET_TMPDIR"), "/../deploy/curve_market.so"));
    svm.add_program(program_id, bytes).unwrap();
    (svm, program_id)
}

pub fn set_time(svm: &mut LiteSVM, unix_timestamp: i64) {
    let mut clock: Clock = svm.get_sysvar();
    clock.unix_timestamp = unix_timestamp;
    svm.set_sysvar(&clock);
}

pub fn fund(svm: &mut LiteSVM) -> Keypair {
    let kp = Keypair::new();
    svm.airdrop(&kp.pubkey(), 10_000_000_000).unwrap();
    kp
}

pub fn send(
    svm: &mut LiteSVM,
    program_id: Pubkey,
    data: Vec<u8>,
    metas: Vec<AccountMeta>,
    signers: &[&Keypair],
) -> Result<(), String> {
    let ix = Instruction { program_id, accounts: metas, data };
    // A fresh blockhash so identical transactions are not deduplicated.
    svm.expire_blockhash();
    let blockhash = svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[ix], Some(&signers[0].pubkey()), &blockhash);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), signers)
        .map_err(|e| e.to_string())?;
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

/// Assert that a failed send carries this program's error code.
pub fn assert_err(res: Result<(), String>, err: curve_market::CurveError) {
    let code = u32::from(err);
    match res {
        Ok(()) => panic!("expected error {err:?} ({code}) but the transaction succeeded"),
        Err(e) => assert!(
            e.contains(&format!("Custom({code})")),
            "expected error {err:?} ({code}), got: {e}"
        ),
    }
}

pub fn read<T: AccountDeserialize>(svm: &LiteSVM, key: &Pubkey) -> T {
    let acct = svm.get_account(key).expect("account");
    T::try_deserialize(&mut &acct.data[..]).unwrap()
}
