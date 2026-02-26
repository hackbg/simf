extern crate console_error_panic_hook;
use std::{str::FromStr, sync::Arc};
use wasm_bindgen::prelude::*;
#[allow(unused)] use js_sys::*;
#[allow(unused)] use bitcoin_hashes::Hash;
#[allow(unused)] use simplicityhl::{
    CompiledProgram, SatisfiedProgram, TemplateProgram,
    Arguments, Parameters, Value, WitnessTypes, WitnessValues,
    debug::DebugSymbols,
    str::WitnessName,
    tracker::{DefaultTracker, TrackerLogLevel},
    simplicity::{
        Amr, BitIter, BitMachine, Cmr, CommitNode, Cost, Ihr, RedeemNode,
        Value as SimValue,
        leaf_version,
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
        secp256k1_zkp::{self as secp256k1, SECP256K1, XOnlyPublicKey},
        schnorr::UntweakedPublicKey,
        taproot::{ControlBlock, LeafVersion, TaprootBuilder, TaprootSpendInfo},
    }
};

// A generous helping of utility macros, to make writing things less annoying.
// When defined here, they are available in all subsequent modules.
// Feel free to skip reading them for now.

/// Log to JS console.
#[allow(unused)] macro_rules! log(($msg:literal $(, $expr:expr)*) => {
    web_sys::console::log_1(&format!($msg $(, $expr)*).into())
});

/// Log to JS console verbosely.
#[allow(unused)] macro_rules! debug(($msg:literal $(, $expr:expr)*) => {
    web_sys::console::debug_1(&format!($msg $(, $expr)*).into())
});

/// Log a warning to the JS console.
#[allow(unused)] macro_rules! warn(($msg:literal $(, $expr:expr)*) => {
    web_sys::console::warn_1(&format!($msg $(, $expr)*).into())
});

/// Construct throwable error
macro_rules! err(($msg:literal $(, $expr:expr)*) => {
    Err(JsError::new(&format!($msg $(, $expr)*)))
});

/// Return [JsError] if expression evaluates to false:
macro_rules! asserted(($expr:expr) => {
    if !$expr { return err!("assertion failed: {}", stringify!($expr)) }
});

/// Map `Err` to friendly [JsError].
macro_rules! expected(($msg:literal: $expr:expr) => {
    $expr.map_err(|_e|JsError::new(&format!("failed: {}", $msg)))
});

/// Map `Err` to detailed friendly [JsError] if it implements [Debug].
#[allow(unused)] macro_rules! expected_debug(($msg:literal: $expr:expr) => {
    $expr.map_err(|e|JsError::new(&format!("failed: {}: {:?}", $msg, e)))
});

/// Map `Err` to detailed friendly [JsError] if it implements [Display].
macro_rules! expected_display(($msg:literal: $expr:expr) => {
    $expr.map_err(|e|JsError::new(&format!("failed: {}: {}", $msg, e)))
});

/// Map `None` to friendly [JsError].
macro_rules! required(
    ($expr:expr) => {
        $expr.ok_or(JsError::new(&format!("{}: not found", stringify!($expr))))
    };
    ($msg:literal: $expr:expr) => {
        $expr.ok_or(JsError::new(&format!("{}: {}", stringify!($expr), $msg)))
    }
);

/// Get property of JS object
macro_rules! get(
    ($obj:expr, $key:expr) => {
        Reflect::get(&$obj, &JsString::from($key).into())
            .map_err(|_e|JsError::new(&format!("failed to get property {}", $key)))?
    };
    ($obj:expr, $key:expr, $fn:expr) => {
        ($fn)(Reflect::get(&$obj, &JsString::from($key).into())
            .map_err(|_e|JsError::new(&format!("failed to get property {}", $key)))?)
    };
);

/// Set property of JS object
macro_rules! set(($obj:expr, $key:expr, $value:expr) => {{
    let value = $value;
    Reflect::set(&$obj, &JsString::from($key).into(), &value.clone().into())
        .map_err(|_e|JsError::new(&format!("failed to set property: {}", $key)))?;
    value
}});

/// Construct an object
macro_rules! obj(($($id:literal = $val:expr),+ $(,)?) => {{
    let object = Object::new();
    $(set!(object, $id, JsValue::from($val));)+
    object
}});

// Okay, with that out of the way:

/// Concrete type of [ElementsEnv] used.
pub type Env = simplicityhl::simplicity::jet::elements::ElementsEnv<Arc<Transaction>>;

/// Standard result type
type Maybe<T> = Result<T, JsError>;

/// Create [secp256k1] keypair from 32-byte secret.
#[wasm_bindgen] pub fn keypair (secret: Uint8Array) -> Maybe<Keypair> {
    console_error_panic_hook::set_once();
    let mut bytes = vec![0u8;32];
    secret.copy_to(&mut bytes);
    let keypair = secp256k1::Keypair::from_seckey_slice(secp256k1::SECP256K1, &bytes)?;
    Ok(Keypair(keypair))
}

/// [secp256k1] keypair callable from JS.
#[wasm_bindgen] pub struct Keypair (secp256k1::Keypair);

#[wasm_bindgen] impl Keypair {

    /// Perform Schnorr signing (for witnesses).
    #[wasm_bindgen(js_name = "signSchnorr")]
    pub fn sign_schnorr (&self, message: Uint8Array) -> Uint8Array {
        let mut bytes = [0u8;32];
        message.copy_to(&mut bytes);
        let result = Uint8Array::new_with_length(64);
        result.copy_from(&self.0.sign_schnorr(secp256k1::Message::from_digest(bytes)).serialize());
        result
    }

    /// Tweaked public key for authenticating in programs.
    #[wasm_bindgen(js_name = "xOnlyPublicKey")]
    pub fn xonly_public_key (&self) -> Uint8Array {
        let result = Uint8Array::new_with_length(32);
        result.copy_from(&self.0.x_only_public_key().0.serialize());
        result
    }

}

/// Create compiler, providing chain constants.
#[wasm_bindgen] pub fn compiler (options: JsValue) -> Maybe<Compiler> {
    Ok(Compiler {
        genesis: Arc::new(
             BlockHash::from_str(&get!(options, "genesis", arg_string)?)?
        ),
        chain: get!(options, "chain", |input|if JsString::is_type_of(&input) {
            Ok(input.as_string().unwrap())
        } else {
            err!("chain not string")
        })?.into(),
    })
}

#[wasm_bindgen] pub struct Compiler {
    genesis: Arc<BlockHash>,
    chain: Arc<str>,
}

#[wasm_bindgen] impl Compiler {

    /// Compile a SimplicityHL [Program].
    #[wasm_bindgen] pub fn compile (&self, source: JsString, options: Object) -> Maybe<Program> {
        console_error_panic_hook::set_once();
        let source = source.as_string().unwrap_or_default();
        let mut args = Arguments::default();
        if options.is_object() {
            args = get!(options, "args", arg_args)?;
        }
        let template = expected_display!("parse error":
            TemplateProgram::new(source.clone()))?;
        let compiled = expected_display!("compile error":
            CompiledProgram::new(source.clone(), args.clone(), true))?;
        Ok(Program {
            source:  source.clone().into(),
            params:  template.parameters().clone(),
            witness: template.witness_types().clone(),
            genesis: self.genesis.clone(),
            chain:   self.chain.clone(),
            args,
            compiled,
        })
    }

}

/// A valid compiled SimplicityHL program.
#[wasm_bindgen(inspectable)] pub struct Program {
    pub(crate) chain:    Arc<str>,
    pub(crate) genesis:  Arc<BlockHash>,
    pub(crate) source:   Arc<str>,
    pub(crate) args:     Arguments,
    pub(crate) compiled: CompiledProgram,
    pub(crate) params:   Parameters,
    pub(crate) witness:  WitnessTypes,
}

#[wasm_bindgen] impl Program {
    /// Produce JSON description of program object.
    #[wasm_bindgen(js_name = toJSON)]
    pub fn to_json (&self) -> Object {
        ret_program(&self).unwrap_or_else(|e|JsValue::from(e).into())
    }
    /// Produce JSON dict of compile-time parameter types.
    #[wasm_bindgen(js_name = parameterTypes)]
    pub fn parameter_types (&self) -> Maybe<Object> {
        let result = Object::new();
        for (k, v) in self.params.iter() {
            expected!("set": Reflect::set(&result, &format!("{k}").into(), &format!("{v}").into()))?;
        }
        Ok(result)
    }
    /// Produce JSON dict of run-time parameter types.
    #[wasm_bindgen(js_name = witnessTypes)]
    pub fn witness_types (&self) -> Maybe<Object> {
        let result = Object::new();
        for (k, v) in self.witness.iter() {
            expected!("set": Reflect::set(&result, &format!("{k}").into(), &format!("{v}").into()))?;
        }
        Ok(result)
    }
    /// Partially-signed redeem transaction without witnesses.
    /// For extremely manual signing.
    #[wasm_bindgen(js_name = redeemPsbt)]
    pub fn redeem_psbt (&self, options: &JsValue) -> Maybe<JsValue> {
        let (psbt, _) = self.redeem_psbt_utxo(options)?;
        match JSON::parse(serde_json::to_string(&psbt)?.as_str()) {
            Ok(psbt) => Ok(psbt),
            Err(_)   => err!("failed to deserialize interim psbt")
        }
    }

    fn redeem_psbt_utxo (&self, options: &JsValue) -> Maybe<(PartiallySignedTransaction, TxOut)> {
        let previous  = get!(options, "previous",  arg_tx)?;
        let recipient = get!(options, "recipient", arg_address)?;
        let amount    = get!(options, "amount",    arg_sats)?;
        let fee       = get!(options, "fee",       arg_sats)?;
        let (previous_output, utxo) = self.utxo(&previous)?;
        let asset = utxo.asset.explicit().unwrap();
        let in_0  = tx_input(previous_output);
        let out_0 = tx_output(asset, recipient, amount);
        let out_1 = elements::TxOut::new_fee(fee, asset);
        let psbt = PartiallySignedTransaction::from_tx(transaction(vec![in_0], vec![out_0, out_1]));
        Ok((psbt, utxo))
    }

    fn utxo (&self, previous: &Transaction) -> Maybe<(OutPoint, TxOut)> {
        find_utxo(&previous, &self.p2tr()?)
    }

    /// SIGHASH_ALL of redeem transaction.
    /// Sign this to provide witness data.
    #[wasm_bindgen(js_name = redeemSighash)]
    pub fn redeem_sighash (&self, options: JsValue) -> Maybe<Uint8Array> {
        let (psbt, utxo) = self.redeem_psbt_utxo(&options)?;
        let env = self.env(&psbt, vec![ElementsUtxo::from(utxo)])?;
        let all = env.c_tx_env().sighash_all().to_byte_array();
        let u8a = Uint8Array::new_with_length(all.len() as u32);
        u8a.copy_from(&all);
        Ok(u8a)
    }

    /// Signed redeem transaction.
    /// Broadcast it to redeem funds.
    #[wasm_bindgen(js_name = redeemTx)]
    pub fn redeem_tx (&self, options: JsValue) -> Maybe<Object> {
        let wit = get!(options, "witness", arg_witness)?;
        let (mut psbt, utxo) = self.redeem_psbt_utxo(&options)?;
        let env = self.env(&psbt, vec![ElementsUtxo::from(utxo)])?;
        let sat = expected!("satisfy": self.compiled.satisfy_with_env(wit, Some(&env)))?;
        let (program_bytes, witness_bytes) = sat.redeem().encode_to_vec();
        psbt.inputs_mut()[0].final_script_witness = Some(vec![
            witness_bytes,
            program_bytes,
            self.cmr_vec(),
            self.control_block()?.serialize(),
        ]);
        let tx = expected!("extract final tx:": psbt.extract_tx())?;
        ret_tx(&tx)
    }

    fn env (&self, psbt: &PartiallySignedTransaction, ins: Vec<ElementsUtxo>) -> Maybe<Env> {
        let tx = Arc::new(expected!("extract preliminary tx:": psbt.extract_tx())?);
        Ok(Env::new(
            tx.clone(), ins, 0, self.cmr(), self.control_block()?, None, self.genesis.as_ref().clone()
        ))
    }

    fn cmr (&self) -> Cmr {
        self.compiled.commit().cmr()
    }

    fn cmr_vec (&self) -> Vec<u8> {
        self.compiled.commit().cmr().as_ref().to_vec()
    }

    fn script (&self) -> Script {
        Script::from(self.cmr_vec())
    }

    fn control_block (&self) -> Maybe<ControlBlock> {
        let block = required!("control block": self.tap()?.control_block(&(self.script(), leaf_version())))?;
        // (control[0] & TAPROOT_LEAF_MASK) == TAPROOT_LEAF_TAPSIMPLICITY)
        if block.serialize()[0] & 0xfe != 0xbe {
            return err!("fatal: invalid control block")
        }
        Ok(block)
    }

    /// Generate [TaprootSpendInfo] for the program's [Commit] [Script].
    fn tap (&self) -> Maybe<TaprootSpendInfo> {
        let scr = self.script();
        let tap = TaprootBuilder::new();
        let tap = expected!("taproot: add leaf": tap.add_leaf_with_ver(0, scr, leaf_version()))?;
        let tap = expected!("taproot: finalize": tap.finalize(&SECP256K1, unspendable()?))?;
        Ok(tap)
    }

    fn p2tr (&self) -> Maybe<Address> {
        let tap = self.tap()?;
        let key = tap.internal_key();
        let root = tap.merkle_root();
        Ok(Address::p2tr(SECP256K1, key, root, None, match self.chain.as_ref() {
            "liquidtestnet"   => &AddressParams::LIQUID_TESTNET,
            "elementsregtest" => &AddressParams::ELEMENTS,
            _ => return err!("invalid chain: {}; try elementsregtest, liqudtestnet", &self.chain)
        }))
    }

}

/// BIP-0341's NUMS key (magic unspendable key).
///
/// Taken from `SY:?`, whereas `SC:?` seems to use deployer's key.
///
fn unspendable () -> Maybe<XOnlyPublicKey> {
    expected!("constant failed to deserialize: unspendable key": XOnlyPublicKey::from_str(
        "50929b74c1a04954b78b4b6035e97a5e078a5a0f28ec96d547bfee9ace803ac0"
    ))
}

/// Construct [Transaction] from [TxOut]s and [TxIn]s.
fn transaction (input: Vec<TxIn>, output: Vec<TxOut>) -> Transaction {
    Transaction { version: 2, lock_time: LockTime::ZERO, input, output }
}

/// Construct [TxIn] from [OutPoint].
fn tx_input (previous_output: OutPoint) -> TxIn {
    TxIn {
        previous_output,
        is_pegin:       false,
        script_sig:     Script::new(),
        sequence:       Sequence::MAX,
        asset_issuance: AssetIssuance::null(),
        witness:        TxInWitness::empty(),
    }
}

/// Construct [TxOut].
fn tx_output (asset_id: AssetId, recipient: Address, value: u64) -> TxOut {
    TxOut {
        script_pubkey: recipient.script_pubkey(),
        value: TxValue::Explicit(value),
        asset: Asset::Explicit(asset_id),
        nonce: Nonce::Null,
        witness: TxOutWitness::default(),
    }
}

fn arg_address (x: JsValue) -> Maybe<Address> {
    let address = required!("addr: not string": x.as_string())?;
    let address = expected!("addr: not parsed": Address::from_str(&address))?;
    Ok(address)
}

fn arg_tx (bytes: JsValue) -> Maybe<Transaction> {
    let bytes = required!("tx bytes: not string": bytes.as_string())?;
    let bytes = expected!("tx bytes: not base16": hex::decode(bytes.trim()))?;
    let tx    = expected!("tx bytes: not parsed": deserialize_tx(&bytes))?;
    Ok(tx)
}

fn arg_string (input: JsValue) -> Maybe<String> {
    if JsString::is_type_of(&input) {
        required!("decode input": input.as_string())
    } else {
        err!("invalid chain: {input:?}; try elementsregtest, liqudtestnet")
    }
}

fn arg_sats (input: JsValue) -> Maybe<u64> {
    if BigInt::is_type_of(&input) {
        expected!("bigint->u64": u64::try_from(input))
    } else if Number::is_type_of(&input) {
        warn!("number->u64: *10^8, use bigint to avoid precision issues");
        expected!("number->u64": f64::try_from(input).map(|x|(x * 100000000.0) as u64))
    } else if JsString::is_type_of(&input) {
        warn!("string->u64: use bigint to avoid typing issues");
        expected!("string->u64": u64::try_from(input))
    } else {
        return err!("received {:?}: need integer", input.js_typeof())
    }
}

fn arg_args (args: JsValue) -> Maybe<Arguments> {
    if args.is_truthy() {
        if !args.is_object() {
            return err!("args: must be object")
        }
        if let Some(s) = JSON::stringify(&args)
            .map_err(|e|JsError::new(&format!("failed to stringify args: {e:?}")))?
            .as_string()
        {
            return Ok(serde_json::from_str(&s)?);
        }
    }
    Ok(Arguments::default())
}

fn arg_witness (wits: JsValue) -> Maybe<WitnessValues> {
    if wits.is_truthy() {
        if !wits.is_object() { return err!("wits: must be object") }
        let wits = expected!("wits: failed to stringify": JSON::stringify(&wits))?;
        if let Some(s) = wits.as_string() { return Ok(serde_json::from_str(&s)?); }
    }
    Ok(WitnessValues::default())
}

fn find_utxo (tx: &Transaction, address: &Address) -> Maybe<(OutPoint, TxOut)> {
    let mut previous: Option<OutPoint> = Default::default();
    let mut utxo:     Option<TxOut>    = Default::default();
    for (index, output) in tx.output.iter().enumerate() {
        //debug!("\nindex={index}\n  output={output:?}\n  value={:?}", &output.value);
        //debug!("  {address:?} {:?} {:?}", &output.script_pubkey, &address.script_pubkey());
        if output.script_pubkey == address.script_pubkey() {
            //debug!("  using utxo #{index}");
            previous = Some(OutPoint::new(tx.txid(), index as u32));
            utxo     = Some(output.clone());
            break;
        }
    }
    Ok((required!(previous)?, required!(utxo)?))
}

fn ret_program (program: &Program) -> Maybe<Object> {
    Ok(obj! {
        "chain"  = program.chain.to_string(),
        "source" = program.source.to_string(),
        "args"   = serde_json::to_string(&program.args)?,
        "p2tr"   = program.p2tr()?.to_string(),
    })
}

fn ret_u8a (bytes: &[u8]) -> Uint8Array {
    let u8a = Uint8Array::new_with_length(bytes.len() as u32);
    u8a.copy_from(bytes);
    u8a
}

/// Wrap transaction info returned to JS-land.
fn ret_tx (tx: &Transaction) -> Maybe<Object> {
    let bytes = tx.serialize();
    Ok(obj! {
        "bytes" = ret_u8a(&bytes),
        "hex"   = hex::encode(&bytes),
        "tx"    = JSON::parse(serde_json::to_string(&tx)?.as_str()).expect("parse own tx"),
    })
}
