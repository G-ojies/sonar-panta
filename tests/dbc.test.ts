import { test } from 'node:test';
import assert from 'node:assert/strict';
import bs58 from 'bs58';
import {
  CONFIG_WITH_TRANSFER_HOOK_SIZE, DBC_PROGRAM, EVENT_ALIASES, EVENT_IX_TAG, POOL_CONFIG_SIZE, TRANSFER_HOOK_POOL_SIZE, VIRTUAL_POOL_SIZE,
  accountDiscriminator, curveStatus, decodeConfig, decodeEvent, decodePool, decodePoolConfig, decodeTransferHookPool, decodeVirtualPool,
  eventsFromTx, offsetOf, poolKind, priceFromSqrt, printsFromTx, progressPct, sizeOf, type DbcTx,
} from '../src/lib/dbc';
import idl from '../src/lib/dbc-idl.json';
import realHookPools from '../onchain/programs/curve_market/tests/fixtures/transfer_hook_pools.json';

// ---- a small Borsh writer, so fixtures are built from the IDL layouts rather than pasted bytes ----

const POOL = '5fxtBTo166qPbeo829j21zG5XbYCARgUzqQuaC3RS5Th';
const CONFIG = 'CF1wnTecGRSAn8eaeUXN3rgFSGExKNSm6F5RYZpzLSqK';
const CREATOR = 'Gj1j6jzSfZTugBndhsdy7rqWYXWhM3n3ix1DTkTACwDT';
const MINT = 'DN5YSS8WqibzeuVNcdhSgNbPwXBm3zBvASDhNry1jups';
const SOL = 'So11111111111111111111111111111111111111112';

const u8 = (n: number) => Buffer.from([n]);
const u16 = (n: number) => { const b = Buffer.alloc(2); b.writeUInt16LE(n); return b; };
const u32 = (n: number) => { const b = Buffer.alloc(4); b.writeUInt32LE(n); return b; };
const u64 = (n: bigint | number) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(n)); return b; };
const u128 = (n: bigint) => Buffer.concat([u64(n & ((1n << 64n) - 1n)), u64(n >> 64n)]);
const key = (s: string) => Buffer.from(bs58.decode(s));
const disc = (name: string) => Buffer.from((idl.events as { name: string; discriminator: number[] }[]).find((e) => e.name === name)!.discriminator);

const SQRT = 1_234_567_890_123_456_789_012n; // some Q64.64 sqrt price
const initEvent = (name = 'EvtInitializePool') => Buffer.concat([disc(name), key(POOL), key(CONFIG), key(CREATOR), key(MINT), u8(0), u64(123_456)]);
const swap2Event = (dir: number, quoteReserve = 40_000_000_000n, name = 'EvtSwap2') => Buffer.concat([
  disc(name), key(POOL), key(CONFIG), u8(dir), u8(0),
  u64(1_000_000_000n), u64(0), u8(0), // swap_parameters: amount_0, amount_1, swap_mode
  u64(1_000_000_000n), u64(990_000_000n), u64(0), u64(5_000_000_000_000n), u128(SQRT), u64(10_000_000n), u64(2_000_000n), u64(0), // swap_result
  u64(quoteReserve), u64(85_000_000_000n), u64(1_790_000_000n),
]);
const swapEvent = (dir: number) => Buffer.concat([
  disc('EvtSwap'), key(POOL), key(CONFIG), u8(dir), u8(0),
  u64(500_000_000n), u64(0), // params
  u64(500_000_000n), u64(2_000_000_000_000n), u128(SQRT), u64(5_000_000n), u64(1_000_000n), u64(0), // swap_result
  u64(500_000_000n), u64(1_790_000_000n),
]);
const completeEvent = (name = 'EvtCurveComplete') => Buffer.concat([disc(name), key(POOL), key(CONFIG), u64(200_000_000_000_000n), u64(85_000_000_000n)]);

/** A transaction whose DBC inner instructions carry the given events, the way emit_cpi writes them. */
function txWith(events: Buffer[], opts: { err?: unknown; logs?: string[]; otherProgram?: boolean } = {}): DbcTx {
  const keys = ['PAYER1111111111111111111111111111111111111', 'EVTAUTH', opts.otherProgram ? 'OtherProgram1111111111111111111111111111111' : DBC_PROGRAM];
  return {
    blockTime: 1_790_000_000, meta: {
      err: opts.err ?? null, logMessages: opts.logs ?? ['Program dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN invoke [1]', 'Program log: Instruction: Swap2'],
      innerInstructions: [{ index: 0, instructions: events.map((e) => ({ programIdIndex: 2, accounts: [1], data: bs58.encode(Buffer.concat([EVENT_IX_TAG, e])) })) }],
    },
    transaction: { message: { accountKeys: keys } },
  };
}

test('decodeEvent: EvtInitializePool fields read back from the IDL layout', () => {
  const ev = decodeEvent(initEvent());
  assert.equal(ev?.name, 'EvtInitializePool');
  assert.deepEqual(ev?.data, { pool: POOL, config: CONFIG, creator: CREATOR, base_mint: MINT, pool_type: 0, activation_point: 123_456n });
});

test('decodeEvent: EvtSwap2 nested structs and u128 sqrt price', () => {
  const ev = decodeEvent(swap2Event(1));
  assert.equal(ev?.name, 'EvtSwap2');
  const d = ev!.data as { swap_result: { next_sqrt_price: bigint; output_amount: bigint }; quote_reserve_amount: bigint; migration_threshold: bigint; trade_direction: number };
  assert.equal(d.trade_direction, 1);
  assert.equal(d.swap_result.next_sqrt_price, SQRT);
  assert.equal(d.swap_result.output_amount, 5_000_000_000_000n);
  assert.equal(d.quote_reserve_amount, 40_000_000_000n);
  assert.equal(d.migration_threshold, 85_000_000_000n);
});

test('decodeEvent: EvtCurveComplete, and unknown or short bytes are null', () => {
  assert.deepEqual(decodeEvent(completeEvent()), { name: 'EvtCurveComplete', idlName: 'EvtCurveComplete', data: { pool: POOL, config: CONFIG, base_reserve: 200_000_000_000_000n, quote_reserve: 85_000_000_000n } });
  assert.equal(decodeEvent(Buffer.alloc(8, 1)), null);
  assert.equal(decodeEvent(Buffer.alloc(3)), null);
  assert.equal(decodeEvent(initEvent().subarray(0, 60)), null); // truncated body
});

test('eventsFromTx: reads emit_cpi inner instructions in order, only from the DBC program, only on success', () => {
  const names = eventsFromTx(txWith([swapEvent(1), swap2Event(1)])).map((e) => e.name);
  assert.deepEqual(names, ['EvtSwap', 'EvtSwap2']);
  assert.deepEqual(eventsFromTx(txWith([swap2Event(1)], { err: { InstructionError: [0, 'Custom'] } })), []);
  assert.deepEqual(eventsFromTx(txWith([swap2Event(1)], { otherProgram: true })), []);
});

test('eventsFromTx: a Program data log line (emit!) is decoded too', () => {
  const tx = txWith([], { logs: [`Program data: ${initEvent().toString('base64')}`] });
  assert.deepEqual(eventsFromTx(tx).map((e) => e.name), ['EvtInitializePool']);
});

test('printsFromTx: a swap2 is one print; the legacy EvtSwap it also emits is not a second one', () => {
  const prints = printsFromTx('SIG', txWith([swapEvent(1), swap2Event(1)]));
  assert.equal(prints.length, 1);
  const p = prints[0];
  assert.equal(p.id, 'SIG');
  assert.equal(p.pool, POOL);
  assert.equal(p.side, 'buy');
  assert.equal(p.wallet, 'PAYER1111111111111111111111111111111111111');
  assert.equal(p.quoteRaw, '1000000000'); // fee included, what the trader paid
  assert.equal(p.baseRaw, '5000000000000');
  assert.equal(p.sqrtPriceAfter, String(SQRT));
  assert.equal(p.quoteReserveAfter, '40000000000');
  assert.equal(p.migrationThreshold, '85000000000');
  assert.equal(p.blockTime, 1_790_000_000);
});

test('printsFromTx: a sell swaps the amounts round; two swaps in one transaction get distinct ids', () => {
  const prints = printsFromTx('SIG', txWith([swap2Event(0), swap2Event(1)]));
  assert.deepEqual(prints.map((p) => p.id), ['SIG', 'SIG:1']);
  assert.equal(prints[0].side, 'sell');
  assert.equal(prints[0].quoteRaw, '5000000000000'); // output on a sell is quote
  assert.equal(prints[0].baseRaw, '1000000000');
});

test('printsFromTx: a legacy swap without a swap2 becomes a print with no reserve figures', () => {
  const prints = printsFromTx('SIG', txWith([swapEvent(1)]));
  assert.equal(prints.length, 1);
  assert.equal(prints[0].quoteRaw, '500000000');
  assert.equal(prints[0].quoteReserveAfter, '');
});

// ---- the transfer-hook pool's events ----

type IdlTypes = { name: string; type: { fields?: unknown[] } }[];
const idlType = (name: string) => (idl.types as unknown as IdlTypes).find((t) => t.name === name)!.type;

test('EVENT_ALIASES: each transfer-hook event has the same body as the plain one it is read as', () => {
  assert.deepEqual(Object.keys(EVENT_ALIASES).sort(), ['EvtCurveCompleteWithTransferHook', 'EvtInitializePoolWithTransferHook', 'EvtSwap2WithTransferHook']);
  for (const [hook, plain] of Object.entries(EVENT_ALIASES)) {
    assert.deepEqual(idlType(hook), idlType(plain), `${hook} mirrors ${plain}`);
    assert.notDeepEqual(disc(hook), disc(plain));
  }
  // every event in the IDL whose name mentions the hook is covered
  const hookEvents = (idl.events as { name: string }[]).map((e) => e.name).filter((n) => n.endsWith('WithTransferHook') && !n.startsWith('EvtCreateConfig'));
  assert.deepEqual(hookEvents.sort(), Object.keys(EVENT_ALIASES).sort());
});

test('decodeEvent: transfer-hook events come back under the plain name, with the IDL name kept', () => {
  const swap = decodeEvent(swap2Event(1, 40_000_000_000n, 'EvtSwap2WithTransferHook'));
  assert.equal(swap?.name, 'EvtSwap2');
  assert.equal(swap?.idlName, 'EvtSwap2WithTransferHook');
  assert.deepEqual(swap?.data, decodeEvent(swap2Event(1))?.data);
  const init = decodeEvent(initEvent('EvtInitializePoolWithTransferHook'));
  assert.deepEqual(init, { name: 'EvtInitializePool', idlName: 'EvtInitializePoolWithTransferHook', data: decodeEvent(initEvent())!.data });
  const done = decodeEvent(completeEvent('EvtCurveCompleteWithTransferHook'));
  assert.equal(done?.name, 'EvtCurveComplete');
  assert.equal(done?.idlName, 'EvtCurveCompleteWithTransferHook');
});

test('printsFromTx: a swap2_with_transfer_hook is a print like any swap2', () => {
  const tx = txWith([swap2Event(0, 41_000_000_000n, 'EvtSwap2WithTransferHook'), completeEvent('EvtCurveCompleteWithTransferHook')]);
  assert.deepEqual(eventsFromTx(tx).map((e) => e.idlName), ['EvtSwap2WithTransferHook', 'EvtCurveCompleteWithTransferHook']);
  const prints = printsFromTx('HOOK', tx);
  assert.equal(prints.length, 1);
  assert.equal(prints[0].side, 'sell');
  assert.equal(prints[0].quoteRaw, '5000000000000');
  assert.equal(prints[0].quoteReserveAfter, '41000000000');
  assert.equal(prints[0].migrationThreshold, '85000000000');
  // a legacy EvtSwap beside a hook swap2 is the duplicate, as with a plain swap2
  assert.equal(printsFromTx('HOOK', txWith([swapEvent(1), swap2Event(1, 1n, 'EvtSwap2WithTransferHook')])).length, 1);
});

// ---- accounts ----

/** The IDL says what the account sizes must be; the live accounts were checked against these numbers (see docs/CURVE.md). */
test('account sizes computed from the IDL match the constants', () => {
  assert.equal(8 + sizeOf({ defined: { name: 'VirtualPool' } }), VIRTUAL_POOL_SIZE);
  assert.equal(8 + sizeOf({ defined: { name: 'PoolConfig' } }), POOL_CONFIG_SIZE);
  assert.equal(8 + sizeOf({ defined: { name: 'TransferHookPool' } }), TRANSFER_HOOK_POOL_SIZE);
  assert.equal(8 + sizeOf({ defined: { name: 'ConfigWithTransferHook' } }), CONFIG_WITH_TRANSFER_HOOK_SIZE);
});

/** A pool account (VirtualPool by default, or TransferHookPool) built field by field from the IDL order. */
function virtualPool(over: { quoteReserve?: bigint; sqrtPrice?: bigint; isMigrated?: number; finished?: bigint; account?: 'VirtualPool' | 'TransferHookPool' } = {}): Buffer {
  const vt = Buffer.concat([u64(1), Buffer.alloc(8), u128(0n), u128(0n), u128(0n)]); // volatility_tracker
  const metrics = Buffer.concat([u64(1), u64(2), u64(3), u64(4)]);
  const body = Buffer.concat([
    vt, key(CONFIG), key(CREATOR), key(MINT), key('11111111111111111111111111111111'), key('11111111111111111111111111111111'),
    u64(700_000_000_000_000n), u64(over.quoteReserve ?? 42_500_000_000n), u64(0), u64(0), u64(0), u64(0),
    u128(over.sqrtPrice ?? SQRT), u64(1_790_000_000n),
    u8(0), u8(over.isMigrated ?? 0), u8(0), u8(0), u8(0), u8(0), u8(0), u8(0),
    metrics, u64(over.finished ?? 0n), u64(0), u64(0), u8(0), u8(0), u8(1), Buffer.alloc(5), u16(0), Buffer.alloc(6), u64(0), u64(0), Buffer.alloc(24),
  ]);
  const data = Buffer.concat([accountDiscriminator(over.account ?? 'VirtualPool'), body]);
  assert.equal(data.length, VIRTUAL_POOL_SIZE);
  return data;
}
const hookPool = (over: Parameters<typeof virtualPool>[0] = {}) => virtualPool({ ...over, account: 'TransferHookPool' });

test('decodeVirtualPool: reserves, sqrt price and flags read from the right offsets', () => {
  const p = decodeVirtualPool(virtualPool());
  assert.equal(p.config, CONFIG);
  assert.equal(p.creator, CREATOR);
  assert.equal(p.base_mint, MINT);
  assert.equal(p.base_reserve, 700_000_000_000_000n);
  assert.equal(p.quote_reserve, 42_500_000_000n);
  assert.equal(p.sqrt_price, SQRT);
  assert.equal(p.activation_point, 1_790_000_000n);
  assert.equal(p.is_migrated, 0);
  assert.equal(p.finish_curve_timestamp, 0n);
  assert.equal(p.has_swap, 1);
  assert.deepEqual(p.metrics, { total_protocol_base_fee: 1n, total_protocol_quote_fee: 2n, total_trading_base_fee: 3n, total_trading_quote_fee: 4n });
  assert.throws(() => decodeVirtualPool(Buffer.alloc(VIRTUAL_POOL_SIZE)), /not a VirtualPool/);
  assert.throws(() => decodeVirtualPool(virtualPool().subarray(0, 100)), /expected 424/);
});

test('decodePoolConfig: quote mint, decimals and threshold', () => {
  const body = Buffer.alloc(POOL_CONFIG_SIZE - 8);
  key(SOL).copy(body, 0); // quote_mint
  body[offsetOf('PoolConfig', 'token_decimal')] = 6;
  u64(85_000_000_000n).copy(body, offsetOf('PoolConfig', 'migration_quote_threshold'));
  u128(SQRT).copy(body, offsetOf('PoolConfig', 'migration_sqrt_price'));
  const data = Buffer.concat([accountDiscriminator('PoolConfig'), body]);
  const c = decodePoolConfig(data);
  assert.equal(c.quote_mint, SOL);
  assert.equal(c.token_decimal, 6);
  assert.equal(c.migration_quote_threshold, 85_000_000_000n);
  assert.equal(c.migration_sqrt_price, SQRT);
  assert.equal(c.curve.length, 20);
  assert.throws(() => decodePoolConfig(virtualPool()), /not a PoolConfig/);
});

test('decodePool: either pool kind, the same fields, the kind recorded; anything else refused', () => {
  const v = decodePool(virtualPool());
  const h = decodePool(hookPool());
  assert.equal(v.kind, 'virtual');
  assert.equal(h.kind, 'transferHook');
  const { kind: _v, ...vFields } = v;
  const { kind: _h, ...hFields } = h;
  assert.deepEqual(hFields, vFields);
  assert.deepEqual(decodeTransferHookPool(hookPool()), decodeVirtualPool(virtualPool()));
  assert.equal(poolKind(virtualPool()), 'virtual');
  assert.equal(poolKind(hookPool()), 'transferHook');
  assert.equal(poolKind(Buffer.alloc(VIRTUAL_POOL_SIZE)), null);
  assert.throws(() => decodeVirtualPool(hookPool()), /not a VirtualPool/);
  assert.throws(() => decodeTransferHookPool(virtualPool()), /not a TransferHookPool/);
  assert.throws(() => decodePool(Buffer.alloc(VIRTUAL_POOL_SIZE)), /not a VirtualPool or TransferHookPool/);
  assert.throws(() => decodePool(hookPool().subarray(0, 300)), /expected 424/);
  assert.throws(() => decodePool(configWithTransferHook()), /not a VirtualPool or TransferHookPool/);
});

/** A ConfigWithTransferHook: a PoolConfig body, then the hook program and [u64; 6] of padding. */
const HOOK_PROGRAM = 'HooKe1VRa7Pw9ENhHnoTG6aVfLL9cBzxEfKa7hhDuDkE';
function configWithTransferHook(): Buffer {
  const cfg = Buffer.alloc(POOL_CONFIG_SIZE - 8);
  key(SOL).copy(cfg, offsetOf('PoolConfig', 'quote_mint'));
  cfg[offsetOf('PoolConfig', 'token_decimal')] = 9;
  u64(11_510_000_000n).copy(cfg, offsetOf('PoolConfig', 'migration_quote_threshold'));
  const data = Buffer.concat([accountDiscriminator('ConfigWithTransferHook'), cfg, key(HOOK_PROGRAM), Buffer.alloc(48, 0xee)]);
  assert.equal(data.length, CONFIG_WITH_TRANSFER_HOOK_SIZE);
  return data;
}

test('decodeConfig: a PoolConfig or a ConfigWithTransferHook, with the hook program for the latter', () => {
  const h = decodeConfig(configWithTransferHook());
  assert.equal(h.kind, 'transferHook');
  assert.equal(h.transfer_hook_program, HOOK_PROGRAM);
  assert.equal(h.quote_mint, SOL);
  assert.equal(h.token_decimal, 9);
  assert.equal(h.migration_quote_threshold, 11_510_000_000n);
  assert.equal(h.curve.length, 20);

  const body = Buffer.alloc(POOL_CONFIG_SIZE - 8);
  key(SOL).copy(body, 0);
  u64(85_000_000_000n).copy(body, offsetOf('PoolConfig', 'migration_quote_threshold'));
  const v = decodeConfig(Buffer.concat([accountDiscriminator('PoolConfig'), body]));
  assert.equal(v.kind, 'virtual');
  assert.equal(v.transfer_hook_program, null);
  assert.equal(v.migration_quote_threshold, 85_000_000_000n);

  assert.throws(() => decodePoolConfig(configWithTransferHook()), /not a PoolConfig/);
  assert.throws(() => decodeConfig(configWithTransferHook().subarray(0, POOL_CONFIG_SIZE)), /expected 1128/);
  assert.throws(() => decodeConfig(hookPool()), /not a PoolConfig or ConfigWithTransferHook/);
});

test('decodePool / decodeConfig: real mainnet TransferHookPool snapshots read back the values the chain showed', () => {
  assert.equal(realHookPools.owner, DBC_PROGRAM);
  const [trading, migrated] = realHookPools.accounts.map((a) => ({
    ...a, state: decodePool(Buffer.from(a.poolData, 'hex')), cfg: decodeConfig(Buffer.from(a.configData, 'hex')),
  }));
  for (const r of [trading, migrated]) {
    assert.equal(r.state.kind, 'transferHook');
    assert.equal(r.cfg.kind, 'transferHook');
    assert.equal(r.state.config, r.config);
    assert.ok(r.cfg.transfer_hook_program && r.cfg.transfer_hook_program !== '11111111111111111111111111111111');
    // the price sits on the curve: between the config's start and migration sqrt prices
    assert.ok(r.state.sqrt_price >= r.cfg.sqrt_start_price && r.state.sqrt_price <= r.cfg.migration_sqrt_price);
  }
  assert.equal(trading.cfg.quote_mint, SOL);
  assert.equal(trading.cfg.token_decimal, 6);
  assert.equal(trading.state.quote_reserve, 11_569_203_035n);
  assert.equal(trading.cfg.migration_quote_threshold, 6_469_811_299_045n);
  assert.equal(curveStatus(trading.state), 'trading');
  assert.equal(progressPct(trading.state.quote_reserve, trading.cfg.migration_quote_threshold), 0.17);
  assert.equal(migrated.cfg.quote_mint, 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
  assert.equal(migrated.state.finish_curve_timestamp, 1_790_520_753n);
  assert.equal(curveStatus(migrated.state), 'migrated');
  assert.equal(progressPct(migrated.state.quote_reserve, migrated.cfg.migration_quote_threshold), 100);
});

// ---- math ----

test('priceFromSqrt: a sqrt price of exactly 2^64 is a raw price of 1, scaled by the decimals', () => {
  const one = 1n << 64n;
  assert.equal(priceFromSqrt(one, 9, 9), 1);
  assert.equal(priceFromSqrt(one, 6, 9), 1e-3); // 6-decimal base, SOL quote: one base unit is 1000 lamports' worth
  assert.equal(priceFromSqrt(String(one * 2n), 6, 6), 4); // doubling the sqrt price quadruples the price
  assert.ok(Math.abs(priceFromSqrt(SQRT, 6, 9) - 4.479) < 1e-3); // (1.2346e21 / 1.8447e19)^2 * 1e-3
});

test('progressPct: quote held over the threshold, capped at 100, null with no threshold', () => {
  assert.equal(progressPct(42_500_000_000n, 85_000_000_000n), 50);
  assert.equal(progressPct('1', '3'), 33.33);
  assert.equal(progressPct(84_999_999_999n, 85_000_000_000n), 99.99);
  assert.equal(progressPct(90_000_000_000n, 85_000_000_000n), 100);
  assert.equal(progressPct(1n, 0n), null);
  assert.equal(progressPct('', ''), null);
});

test('offsetOf: the pool account offsets a program would read, in bytes after the discriminator', () => {
  assert.equal(offsetOf('VirtualPool', 'pool_state.config'), 64);
  assert.equal(offsetOf('VirtualPool', 'pool_state.quote_reserve'), 232);
  assert.equal(offsetOf('VirtualPool', 'pool_state.sqrt_price'), 272);
  assert.equal(offsetOf('VirtualPool', 'pool_state.is_migrated'), 297);
  assert.equal(offsetOf('VirtualPool', 'pool_state.finish_curve_timestamp'), 336);
  assert.equal(offsetOf('PoolConfig', 'quote_mint'), 0);
  assert.equal(offsetOf('PoolConfig', 'migration_quote_threshold'), 256);
  assert.throws(() => offsetOf('PoolConfig', 'nothing'), /no field/);
});

test('offsetOf: a TransferHookPool and a ConfigWithTransferHook put the graduation fields where the plain accounts do', () => {
  for (const f of ['config', 'quote_reserve', 'sqrt_price', 'is_migrated', 'finish_curve_timestamp']) {
    assert.equal(offsetOf('TransferHookPool', `pool_state.${f}`), offsetOf('VirtualPool', `pool_state.${f}`), f);
  }
  for (const f of ['quote_mint', 'token_decimal', 'migration_quote_threshold']) {
    assert.equal(offsetOf('ConfigWithTransferHook', `config.${f}`), offsetOf('PoolConfig', f), f);
  }
  assert.equal(offsetOf('ConfigWithTransferHook', 'transfer_hook_program'), POOL_CONFIG_SIZE - 8);
});

test('curveStatus: trading until the curve finishes, complete until migrated', () => {
  assert.equal(curveStatus(decodeVirtualPool(virtualPool())), 'trading');
  assert.equal(curveStatus(decodeVirtualPool(virtualPool({ finished: 1_790_000_100n }))), 'complete');
  assert.equal(curveStatus(decodeVirtualPool(virtualPool({ finished: 1_790_000_100n, isMigrated: 1 }))), 'migrated');
  assert.equal(curveStatus(decodePool(hookPool())), 'trading');
  assert.equal(curveStatus(decodePool(hookPool({ finished: 1_790_000_100n }))), 'complete');
  assert.equal(curveStatus(decodePool(hookPool({ finished: 1_790_000_100n, isMigrated: 1 }))), 'migrated');
});
