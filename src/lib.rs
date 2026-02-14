// Crate-wide imports:

extern crate console_error_panic_hook;
pub(crate) use std::{str::FromStr, sync::Arc};
pub(crate) use wasm_bindgen::prelude::*;
#[allow(unused)] pub(crate) use web_sys::console::{log_1, debug_1, warn_1};
#[allow(unused)] pub(crate) use js_sys::{
    Array, BigInt, Boolean, Error, JSON, JsString, Number, Object, Reflect, Uint8Array,
};
#[allow(unused)] pub(crate) use bitcoin_hashes::Hash;
#[allow(unused)] pub(crate) use simplicityhl::{
    Arguments, CompiledProgram, SatisfiedProgram, Value, WitnessValues,
    debug::DebugSymbols,
    str::WitnessName,
    tracker::{DefaultTracker, TrackerLogLevel},
    simplicity::{
        Amr, BitIter, BitMachine, Cmr, CommitNode, Ihr, leaf_version,
        human_encoding::Forest,
        jet::{Elements, elements::{ElementsEnv, ElementsUtxo}},
    },
    elements::{
        self,
        Address, AddressParams, AssetId, AssetIssuance, LockTime, OutPoint, Script, Sequence,
        Transaction, Txid, TxIn, TxInWitness, TxOut, TxOutWitness,
        confidential::{Asset, Nonce, Value as TxValue},
        encode::deserialize as deserialize_tx,
        hash_types::BlockHash,
        pset::{PartiallySignedTransaction, serialize::Serialize,},
        secp256k1_zkp as secp256k1,
        schnorr::UntweakedPublicKey,
        taproot::{ControlBlock, LeafVersion, TaprootBuilder, TaprootSpendInfo},
    }
};

// A generous helping of utility macros,
// to make writing things less annoying:

/// Log to JS console.
#[allow(unused)] macro_rules! log(($msg:literal $(, $expr:expr)*) => {
    log_1(&format!($msg $(, $expr)*).into())});
/// Log to JS console verbosely.
#[allow(unused)] macro_rules! debug(($msg:literal $(, $expr:expr)*) => {
    debug_1(&format!($msg $(, $expr)*).into())});
/// Log a warning to the JS console.
#[allow(unused)] macro_rules! warn(($msg:literal $(, $expr:expr)*) => {
    warn_1(&format!($msg $(, $expr)*).into())});
/// Construct throwable error
macro_rules! err(($msg:literal $(, $expr:expr)*) => {
    Err(JsError::new(&format!($msg $(, $expr)*))) });
/// Return [JsError] if expression evaluates to false:
macro_rules! asserted(($expr:expr) => {
    if !$expr { return err!("assertion failed: {}", stringify!($expr)) } });
/// Map `Err` to friendly [JsError].
macro_rules! expected(($msg:literal: $expr:expr) => {
    $expr.map_err(|_e|JsError::new(&format!("failed: {}", $msg))) });
/// Map `Err` to detailed friendly [JsError] if it implements [Debug].
macro_rules! expected_debug(($msg:literal: $expr:expr) => {
    $expr.map_err(|e|JsError::new(&format!("failed: {}: {:?}", $msg, e))) });
/// Map `Err` to detailed friendly [JsError] if it implements [Display].
macro_rules! expected_display(($msg:literal: $expr:expr) => {
    $expr.map_err(|e|JsError::new(&format!("failed: {}: {}", $msg, e))) });
/// Map `None` to friendly [JsError].
macro_rules! required(
    ($expr:expr) => {
        $expr.ok_or(JsError::new(&format!("{}: not found", stringify!($expr)))) };
    ($msg:literal: $expr:expr) => {
        $expr.ok_or(JsError::new(&format!("{}: {}", stringify!($expr), $msg))) });
/// Get property of JS object
macro_rules! get(
    ($obj:expr, $key:expr) => {
        Reflect::get(&$obj, &JsString::from($key).into())
            .map_err(|_e|JsError::new(&format!("failed to get property {}", $key)))? };
    ($obj:expr, $key:expr, $fn:expr) => {
        ($fn)(Reflect::get(&$obj, &JsString::from($key).into())
            .map_err(|_e|JsError::new(&format!("failed to get property {}", $key)))?) };);
/// Set property of JS object
macro_rules! set(($obj:expr, $key:expr, $value:expr) => {{
    let value = $value;
    Reflect::set(&$obj, &JsString::from($key).into(), &value.clone().into())
        .map_err(|_e|JsError::new(&format!("failed to set property: {}", $key)))?;
    value }});
/// Construct an object
macro_rules! obj(($($id:literal = $val:expr),+ $(,)?) => {{
    let object = Object::new();
    $(set!(object, $id, JsValue::from($val));)+
    object }});

// The above macros are available in all subsequent modules:

mod simf; pub use self::simf::*;

mod simf_parse; pub use self::simf_parse::*;

// And so are the below definitions:

/// Concrete type of [ElementsEnv] used.
pub type Env = simplicityhl::simplicity::jet::elements::ElementsEnv<Arc<Transaction>>;

/// Standard result type
pub(crate) type Maybe<T> = Result<T, JsError>;

/// Create SimplicityHL P2TR address from a [Cmr]
/// (Commitment Merkle root), such as that of a
/// compiled Simplicity program.
#[wasm_bindgen] pub fn cmr_to_p2tr (cmr: JsValue) -> Maybe<JsString> {
    console_error_panic_hook::set_once();
    Ok(format!("{}", script_to_p2tr(Script::from(Input::bytes(cmr)?))?).into())
}

/// Generate P2TR (pay-to-taproot) [Address] from a [Script]'s [Cmr].
pub(crate) fn script_to_p2tr (script: Script) -> Maybe<Address> {
    Ok(taproot_to_p2tr(&script_to_taproot(script)?))
}

/// Generate P2TR (pay-to-taproot) [Address] from [TaprootSpendInfo].
pub(crate) fn taproot_to_p2tr (
    tap: &TaprootSpendInfo,
    /* TODO: kind: Option<AddressParams> - vary by chain mode? */
) -> Address {
    let key  = tap.internal_key();
    let root = tap.merkle_root();
    Address::p2tr(secp256k1::SECP256K1, key, root, None, &AddressParams::LIQUID_TESTNET)
}

/// Generate [TaprootSpendInfo] for a given [Script].
pub(crate) fn script_to_taproot (script: Script) -> Maybe<TaprootSpendInfo> {
    let tap = TaprootBuilder::new();
    let ver = expected!("use constant leaf version": LeafVersion::from_u8(0xbe))?;
    let tap = expected!("taproot: add leaf": tap.add_leaf_with_ver(0, script, ver))?;
    let tap = expected!("taproot: finalize": tap.finalize(&secp256k1::SECP256K1, unspendable()?))?;
    Ok(tap)
}

/// FIXME: Magic constant - unspendable key.
///
/// Taken from `SY:?`, whereas `SC:?` seems to use deployer's key.
pub(crate) fn unspendable () -> Maybe<UntweakedPublicKey> {
    expected!("unspendable key": UntweakedPublicKey::from_slice(
        &expected!("unspendable key": hex::decode(
            "50929b74c1a04954b78b4b6035e97a5e078a5a0f28ec96d547bfee9ace803ac0"
        ))?
    ))
}

/// Construct [Transaction] from [TxOut]s and [TxIn]s.
pub(crate) fn transaction (output: Vec<TxOut>, input: Vec<TxIn>) -> Transaction {
    Transaction { version: 2, lock_time: LockTime::ZERO, output, input }
}

/// Construct [TxIn] from [OutPoint].
///
/// TODO: Pass witness?
pub(crate) fn tx_input (previous_output: OutPoint) -> TxIn {
    TxIn {
        previous_output,
        is_pegin:        false,
        script_sig:      Script::new(),
        sequence:        Sequence::MAX,
        asset_issuance:  AssetIssuance::null(),
        witness:         TxInWitness {
            amount_rangeproof:         None,
            inflation_keys_rangeproof: None,
            script_witness:            Vec::new(),
            pegin_witness:             Vec::new(),
        },
    }
}

/// Construct [TxOut].
pub(crate) fn tx_output (asset_id: AssetId, to: Address, value: u64) -> TxOut {
    TxOut {
        script_pubkey: to.script_pubkey(),
        value:   TxValue::Explicit(value),
        asset:   Asset::Explicit(asset_id),
        nonce:   Nonce::Null,
        witness: TxOutWitness::default(),
    }
}

/// Construct [ElementsUtxo] from [TxOut].
pub(crate) fn elements_utxo (utxo: &TxOut) -> ElementsUtxo {
    ElementsUtxo {
        script_pubkey: utxo.script_pubkey.clone(),
        asset:         utxo.asset,
        value:         utxo.value
    }
}

/// Generate transaction output for spending part or all of the funds at an address.
fn send (
    owner: Address, spender: Address, asset_id: AssetId, balance: u64, amount: u64, fee: u64,
) -> Maybe<Vec<TxOut>> {
    asserted!(amount + fee <= balance);
    let spent = tx_output(asset_id, spender, amount);
    Ok(if amount + fee == balance {
        debug!("send: spend {amount} + {fee} = {balance}");
        vec![TxOut::new_fee(fee, asset_id), spent]
    } else {
        let remain = balance - (amount + fee);
        debug!("send: {amount} + {fee} = {balance} - {remain}");
        let remain = tx_output(asset_id, owner, remain);
        vec![TxOut::new_fee(fee, asset_id), spent, remain]
    })
}

/// FIXME: Magic constant - genesis hash. Should vary by `-chain` mode.
///
/// Variants in `SY:?` and `SC:?` as well as `simplicity-webide` (TODO add reference).
pub(crate) fn genesis () -> Maybe<BlockHash> {
    expected!("genesis hash": BlockHash::from_str(
        "0f9188f13cb7b2c71f2a335e3a4fc328bf5beb436012afca590b1a11466e2206"
    ))
    //BlockHash::from_byte_array([
        //0x21, 0xca, 0xb1, 0xe5, 0xda, 0x47, 0x18, 0xea, 0x14,
        //0x0d, 0x97, 0x16, 0x93, 0x17, 0x02, 0x42, 0x2f, 0x0e,
        //0x6a, 0xd9, 0x15, 0xc8, 0xd9, 0xb5, 0x83, 0xca, 0xc2,
        //0x70, 0x6b, 0x2a, 0x90, 0x00,
    //])
    //None => elements::BlockHash::from_byte_array([
        //// copied out of simplicity-webide source
        //0xc1, 0xb1, 0x6a, 0xe2, 0x4f, 0x24, 0x23, 0xae,
        //0xa2, 0xea, 0x34, 0x55, 0x22, 0x92, 0x79, 0x3b,
        //0x5b, 0x5e, 0x82, 0x99, 0x9a, 0x1e, 0xed, 0x81,
        //0xd5, 0x6a, 0xee, 0x52, 0x8e, 0xda, 0x71, 0xa7,
    //]),
}

pub(crate) fn control_block (script: &Script) -> Maybe<Vec<u8>> {
    let tap = script_to_taproot(script.clone())?;
    let ver = expected!("leaf version mismatch": LeafVersion::from_u8(0xbe))?;
    let block = required!("control block": tap.control_block(&(script.clone(), ver)))?;
    let bytes = block.serialize();
    // (control[0] & TAPROOT_LEAF_MASK) == TAPROOT_LEAF_TAPSIMPLICITY)
    assert_eq!(bytes[0] & 0xfe, 0xbe);
    Ok(bytes)
        // FIXME? take control block from matching tap_scripts of input:
        //for (cb, script_ver) in &input.tap_scripts {
            //if script_ver.1 == leaf_version() && &script_ver.0[..] == cmr.as_ref() {
                //control_block_leaf = Some((cb.clone(), script_ver.0.clone()));
            //}
        //}
        // FIXME? why was this control block hardcoded in simply?
        //let ctrl = expected!("env: control block fail": ControlBlock::from_slice(&[
            //0xc0, 0xeb, 0x04, 0xb6, 0x8e, 0x9a, 0x26, 0xd1,
            //0x16, 0x04, 0x6c, 0x76, 0xe8, 0xff, 0x47, 0x33,
            //0x2f, 0xb7, 0x1d, 0xda, 0x90, 0xff, 0x4b, 0xef,
            //0x53, 0x70, 0xf2, 0x52, 0x26, 0xd3, 0xbc, 0x09, 0xfc
        //]))?;
}

pub(crate) fn tracker (symbols: &DebugSymbols) -> DefaultTracker<'_> {
    DefaultTracker::new(symbols)
        .with_log_level(TrackerLogLevel::Debug)
        .with_debug_sink(       |a, b|debug!("=> SimplicityHL DEBUG {a} {b}"))
        .with_jet_trace_sink(|a, b, c|debug!("=> SimplicityHL JET   {a} {b:?} {c:?}"))
        .with_warning_sink(        |w|debug!("=> SimplicityHL WARN  {w}"))
}
