extern crate console_error_panic_hook;

use std::{str::FromStr, sync::Arc};
use wasm_bindgen::prelude::*;
#[allow(unused)] use js_sys::*;
#[allow(unused)] use bitcoin_hashes::Hash;
#[allow(unused)] use elements_miniscript::psbt::PsbtExt;
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
        Address, AddressParams, AssetId, AssetIssuance, EcdsaSighashType, LockTime, OutPoint,
        Script, Sequence, Transaction, Txid, TxIn, TxInWitness, TxOut, TxOutWitness,
        confidential::{Asset, Nonce, Value as TxValue},
        encode::deserialize as deserialize_tx,
        hash_types::BlockHash,
        pset::{PartiallySignedTransaction, Input, Output, serialize::Serialize},
        secp256k1_zkp::{self as secp256k1, ecdsa, SECP256K1, XOnlyPublicKey},
        sighash::SighashCache,
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
#[allow(unused)] macro_rules! asserted(($expr:expr) => {
    if !$expr { return err!("assertion failed: {}", stringify!($expr)) }
});

/// Map `Err` to friendly [JsError].
macro_rules! try_(($msg:literal: $expr:expr) => {
    $expr.map_err(|_e|JsError::new(&format!("failed: {}", $msg)))
});

/// Map `Err` to detailed friendly [JsError] if it implements [Debug].
#[allow(unused)] macro_rules! try_debug(($msg:literal: $expr:expr) => {
    $expr.map_err(|e|JsError::new(&format!("failed: {}: {:?}", $msg, e)))
});

/// Map `Err` to detailed friendly [JsError] if it implements [Display].
macro_rules! try_display(($msg:literal: $expr:expr) => {
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

/// PSET/PSBT (partially-signed transaction = PST), paired with corresponding prevouts.
pub type Signable = (PartiallySignedTransaction, Vec<TxOut>);

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

    /// Tweaked public key for authenticating in programs.
    #[wasm_bindgen(js_name = "publicKey")]
    pub fn public_key (&self) -> Uint8Array {
        let result = Uint8Array::new_with_length(33);
        result.copy_from(&self.0.public_key().serialize());
        result
    }

    /// Tweaked public key for authenticating in programs.
    #[wasm_bindgen(js_name = "xOnlyPublicKey")]
    pub fn xonly_public_key (&self) -> Uint8Array {
        let result = Uint8Array::new_with_length(32);
        result.copy_from(&self.0.x_only_public_key().0.serialize());
        result
    }

    /// Perform Schnorr signing (for taproot/witnesses).
    #[wasm_bindgen(js_name = "signSchnorr")]
    pub fn sign_schnorr (&self, message: Uint8Array) -> Uint8Array {
        let mut bytes = [0u8;32];
        message.copy_to(&mut bytes);
        let message = secp256k1::Message::from_digest(bytes);
        let result = Uint8Array::new_with_length(64);
        result.copy_from(&self.0.sign_schnorr(message).serialize());
        result
    }

    /// Perform ECDSA signing (for simple transactions).
    #[wasm_bindgen(js_name = "signEcdsa")]
    pub fn sign_ecdsa (&self, message: Uint8Array) -> Uint8Array {
        let mut bytes = [0u8;32];
        message.copy_to(&mut bytes);
        let message = secp256k1::Message::from_digest(bytes);
        let result = Uint8Array::new_with_length(64);
        result.copy_from(
            &secp256k1::SECP256K1.sign_ecdsa(&message, &self.0.secret_key()).serialize_der()
        );
        result
    }
}

#[wasm_bindgen(js_name = splitSigned)]
pub fn split_psbt_signed (signer: &Keypair, options: &JsValue) -> Maybe<String> {
    let (mut psbt, utxo) = split_psbt_wrap(options, None, None)?;
    psbt.inputs_mut()[0].witness_utxo = Some(utxo[0].clone());
    Pst(psbt).to_signed_hex(signer)
}

#[wasm_bindgen(js_name = splitMultiSigned)]
pub fn split_psbt_multi_signed (signer: &Keypair, options: &JsValue) -> Maybe<String> {
    let (mut psbt, utxos) = split_psbt_multi_wrap(options, None, None)?;
    Pst(psbt).add_signatures(&utxos).to_signed_hex(signer)
}

#[wasm_bindgen(js_name = splitMulti)]
pub fn split_psbt_multi_inspect (options: &JsValue) -> Maybe<JsValue> {
    let (mut psbt, utxos) = split_psbt_multi_wrap(options, None, None)?;
    let psbt = Pst(psbt).add_signatures(&utxos).0;
    try_!("interim ser/de failed": JSON::parse(serde_json::to_string(&psbt)?.as_str()))
}

#[wasm_bindgen(js_name = split)]
pub fn split_psbt (options: &JsValue) -> Maybe<JsValue> {
    let (psbt, _) = split_psbt_wrap(options, None, None)?;
    let bytes = try_!("extract final tx:": psbt.extract_tx())?.serialize();
    match JSON::parse(serde_json::to_string(&psbt)?.as_str()) {
        Err(_) => err!("failed to deserialize interim split psbt"),
        Ok(psbt) => {
            set!(psbt, "bytes", ret_u8a(&bytes));
            set!(psbt, "hex",   hex::encode(&bytes));
            Ok(psbt)
        }
    }
}

fn split_psbt_wrap (options: &JsValue, sender: Option<Address>, receiv: Option<Address>)
    -> Maybe<Signable>
{
    let previous = get!(options, "previous",  arg_tx)?;
    let sender = match sender { Some(s) => s, None => get!(options, "sender",    arg_address)? };
    let receiv = match receiv { Some(r) => r, None => get!(options, "recipient", arg_address)? };
    let amount = get!(options, "amount", arg_sats)?;
    let fee = get!(options, "fee", arg_sats)?;
    split_psbt_impl(&previous, &sender, &receiv, amount, fee)
}

fn split_psbt_impl (
    previous: &Transaction, sender: &Address, recipient: &Address, amount: u64, fee: u64
) -> Maybe<Signable> {
    let (outpoint, utxo) = find_utxo(&previous, &sender)?;
    if let Some(value) = utxo.value.explicit() {
        let asset = utxo.asset.explicit().unwrap();
        let inputs = vec![tx_input(outpoint)];
        let mut outputs = vec![tx_output(recipient.script_pubkey(), asset, amount)];
        let charged = amount + fee;
        if charged < value {
            let change = value - charged;
            outputs.push(tx_output(sender.script_pubkey(), asset, change));
        }
        outputs.push(elements::TxOut::new_fee(fee, asset));
        Ok((PartiallySignedTransaction::from_tx(transaction(inputs, outputs)), vec![utxo]))
    } else {
        err!("need explicit utxo")
    }
}

fn split_psbt_multi_wrap (
    options: &JsValue, sender: Option<Address>, receiv: Option<Address>,
) -> Maybe<Signable> {
    let asset  = get!(options, "asset",  arg_asset_id)?;
    let utxos  = get!(options, "utxos",  arg_utxos)?;
    let amount = get!(options, "amount", arg_sats)?;
    let fee    = get!(options, "fee",    arg_sats)?;
    let sender = match sender { Some(s) => s, None => get!(options, "sender",    arg_address)? };
    let receiv = match receiv { Some(r) => r, None => get!(options, "recipient", arg_address)? };
    split_psbt_multi_impl(asset, &utxos, &sender, &receiv, amount, fee)
}

fn split_psbt_multi_impl (
    asset_id:  AssetId,
    utxos_in:  &[(OutPoint, TxOut)],
    sender:    &Address,
    recipient: &Address,
    amount:    u64,
    fee:       u64
) -> Maybe<Signable> {
    let mut total = 0;
    let mut inputs = vec![];
    let mut utxos  = vec![];
    for (index, (outpoint, utxo)) in utxos_in.iter().enumerate() {
        if let Some(explicit_asset) = utxo.asset.explicit() {
            if explicit_asset == asset_id {
                if let Some(explicit_value) = utxo.value.explicit() {
                    total += explicit_value;
                    inputs.push(outpoint);
                    utxos.push(utxo.clone());
                } else {
                    return err!("non-explicit value in utxo #{index}")
                }
            } else {
                return err!("unexpected explicit asset in utxo #{index}: {explicit_asset:?}")
            }
        } else {
            return err!("non-explicit asset in utxo #{index}")
        }
    }
    let inputs = inputs.into_iter().map(|o|tx_input(*o)).collect::<Vec<_>>();
    let charged = amount + fee;
    if charged > total {
        return err!("amount {amount} + fee {fee} > total {total}")
    }
    let mut outputs = vec![tx_output(recipient.script_pubkey(), asset_id, amount)];
    if charged < total {
        let change = total - charged;
        outputs.push(tx_output(sender.script_pubkey(), asset_id, change));
    }
    outputs.push(elements::TxOut::new_fee(fee, asset_id));
    Ok((PartiallySignedTransaction::from_tx(transaction(inputs, outputs)), utxos))
}

fn find_utxo (tx: &Transaction, address: &Address) -> Maybe<(OutPoint, TxOut)> {
    let mut outpoint: Option<OutPoint> = Default::default();
    let mut tx_out:   Option<TxOut>    = Default::default();
    for (index, output) in tx.output.iter().enumerate() {
        if output.script_pubkey == address.script_pubkey() {
            outpoint = Some(OutPoint::new(tx.txid(), index as u32));
            tx_out   = Some(output.clone());
            break;
        }
    }
    Ok((required!(outpoint)?, required!(tx_out)?))
}

#[wasm_bindgen(js_name = pst)]
pub fn pst (arg: Object) -> Maybe<Pst> {
    let mut pset = PartiallySignedTransaction::new_v2();
    for input  in get!(arg, "inputs", arg_pset_ins)?   { pset.add_input(input.clone());   }
    for output in get!(arg, "outputs", arg_pset_outs)? { pset.add_output(output.clone()); }
    Ok(Pst(pset))
}

#[wasm_bindgen] pub struct Pst (PartiallySignedTransaction);

#[wasm_bindgen] impl Pst {
    /// Show [PartiallySignedTransaction]
    #[wasm_bindgen(js_name = toPset)] pub fn to_pset (&self) -> Maybe<JsValue> {
        ret_pset(&self.0)
    }
    /// Show inner [Transaction].
    #[wasm_bindgen(js_name = toTx)]
    pub fn to_tx (&self) -> Maybe<Object> {
        ret_tx(&self.tx()?)
    }
    /// Simplified sign procedure.
    #[wasm_bindgen(js_name = toSignedHex)]
    pub fn to_signed_hex (&self, keypair: &Keypair) -> Maybe<String> {
      let mut pset = self.0.clone();
      let tx = extract_tx(&pset)?;
      let mut sighash_cache = SighashCache::new(&tx);
      let genesis_hash = BlockHash::all_zeros(); // not used at all for sighash calculation (?)
      let msgs = pset.inputs().iter().enumerate().map(|(index, _input)|Ok(
          pset.sighash_msg(index, &mut sighash_cache, None, genesis_hash)?.to_secp_msg()
      )).collect::<Maybe<Vec<_>>>()?;
      for (i, input) in pset.inputs_mut().iter_mut().enumerate() {
          let sig = secp256k1::SECP256K1.sign_ecdsa(&msgs[i], &keypair.0.secret_key());
          let sig = sig.serialize_der();
          let mut sig = Vec::from(&sig[..]);
          sig.push(EcdsaSighashType::All as u8);
          input.partial_sigs.insert(keypair.0.public_key().into(), sig);
      }
      pset_to_hex(&pset)
    }
    fn tx (&self) -> Maybe<Transaction> {
        extract_tx(&self.0)
    }
    fn add_signatures (mut self, utxos: &[TxOut]) -> Self {
        for (index, utxo) in utxos.into_iter().enumerate() {
            self.0.inputs_mut()[index].witness_utxo = Some(utxo.clone());
        }
        self
    }
}

fn extract_tx (pset: &PartiallySignedTransaction) -> Maybe<Transaction> {
    try_!("extract tx from pset:": pset.extract_tx())
}

fn pset_to_hex (pset: &PartiallySignedTransaction) -> Maybe<String> {
  Ok(hex::encode(&extract_tx(&pset)?.serialize()))
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

/// Extract parameter types from SimplicityHL source code.
#[wasm_bindgen(js_name = paramTypes)]
pub fn param_types (source: JsString) -> Maybe<Object> {
    let source: Arc<str> = source.as_string().unwrap_or_default().into();
    let template = try_display!("parse error": TemplateProgram::new(source))?;
    let result   = Object::new();
    for (k, v) in template.parameters().iter() {
        try_!("set": Reflect::set(&result, &format!("{k}").into(), &format!("{v}").into()))?;
    }
    Ok(result)
}

/// Extract witness types from SimplicityHL source code.
#[wasm_bindgen(js_name = witnessTypes)]
pub fn witness_types (source: JsString) -> Maybe<Object> {
    let source: Arc<str> = source.as_string().unwrap_or_default().into();
    let template = try_display!("parse error": TemplateProgram::new(source))?;
    let result   = Object::new();
    for (k, v) in template.witness_types().iter() {
        try_!("set": Reflect::set(&result, &format!("{k}").into(), &format!("{v}").into()))?;
    }
    Ok(result)
}

/// A SimplicityHL compiler, bound to for a particular chain by address config and genesis block.
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
        let template = try_display!("parse error":
            TemplateProgram::new(source.clone()))?;
        let compiled = try_display!("compile error":
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
    #[wasm_bindgen(js_name = paramTypes)]
    pub fn param_types (&self) -> Maybe<Object> {
        let result = Object::new();
        for (k, v) in self.params.iter() {
            try_!("set": Reflect::set(&result, &format!("{k}").into(), &format!("{v}").into()))?;
        }
        Ok(result)
    }

    /// Produce JSON dict of run-time parameter types.
    #[wasm_bindgen(js_name = witnessTypes)]
    pub fn witness_types (&self) -> Maybe<Object> {
        let result = Object::new();
        for (k, v) in self.witness.iter() {
            try_!("set": Reflect::set(&result, &format!("{k}").into(), &format!("{v}").into()))?;
        }
        Ok(result)
    }

    /// Partially-signed commit transaction.
    /// For manual signing.
    #[wasm_bindgen(js_name = commitPsbt)]
    pub fn commit_psbt (&self, options: &JsValue) -> Maybe<JsValue> {
        let (psbt, _) = split_psbt_wrap(options, None, Some(self.p2tr()?))?;
        match JSON::parse(serde_json::to_string(&psbt)?.as_str()) {
            Ok(psbt) => Ok(psbt),
            Err(_)   => err!("failed to deserialize interim commit psbt")
        }
    }

    fn redeem_psbt_utxo (&self, opts: &JsValue) -> Maybe<Signable> {
        split_psbt_wrap(opts, Some(self.p2tr()?), None)
    }

    fn redeem_psbt_utxo_multi (&self, options: &JsValue) -> Maybe<Signable> {
        split_psbt_multi_impl(
            get!(options,  "asset",     arg_asset_id)?,
            &get!(options, "utxos",     arg_utxos)?,
            &self.p2tr()?,
            &get!(options, "recipient", arg_address)?,
            get!(options,  "amount",    arg_sats)?,
            get!(options,  "fee",       arg_sats)?
        )
    }

    /// Partially-signed redeem transaction without witnesses.
    /// For manual signing.
    #[wasm_bindgen(js_name = redeemPsbt)]
    pub fn redeem_psbt (&self, options: &JsValue) -> Maybe<JsValue> {
        let (psbt, _) = self.redeem_psbt_utxo(options)?;
        match JSON::parse(serde_json::to_string(&psbt)?.as_str()) {
            Ok(psbt) => Ok(psbt),
            Err(_)   => err!("failed to deserialize interim redeem psbt")
        }
    }

    /// SIGHASH_ALL of redeem transaction.
    /// Sign this to provide witness data.
    #[wasm_bindgen(js_name = redeemSighash)]
    pub fn redeem_sighash (&self, options: JsValue) -> Maybe<Uint8Array> {
        let (psbt, utxos) = self.redeem_psbt_utxo(&options)?;
        let env = self.env(&psbt, utxos.into_iter().map(ElementsUtxo::from).collect())?;
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
        let (mut psbt, utxos) = self.redeem_psbt_utxo(&options)?;
        let env = self.env(&psbt, utxos.into_iter().map(ElementsUtxo::from).collect())?;
        let sat = try_!("satisfy": self.compiled.satisfy_with_env(wit, Some(&env)))?;
        let (program_bytes, witness_bytes) = sat.redeem().encode_to_vec();
        psbt.inputs_mut()[0].final_script_witness = Some(vec![
            witness_bytes,
            program_bytes,
            self.cmr_vec(),
            self.control_block()?.serialize(),
        ]);
        ret_tx(&try_!("extract final tx:": psbt.extract_tx())?)
    }

    /// Partially-signed redeem transaction without witnesses.
    /// For manual signing.
    #[wasm_bindgen(js_name = redeemPsbtMulti)]
    pub fn redeem_psbt_multi (&self, options: &JsValue) -> Maybe<JsValue> {
        let (psbt, _) = self.redeem_psbt_utxo_multi(options)?;
        match JSON::parse(serde_json::to_string(&psbt)?.as_str()) {
            Ok(psbt) => Ok(psbt),
            Err(_)   => err!("failed to deserialize interim redeem psbt")
        }
    }

    /// SIGHASH_ALL of redeem transaction.
    /// Sign this to provide witness data.
    #[wasm_bindgen(js_name = redeemSighashMulti)]
    pub fn redeem_sighash_multi (&self, options: JsValue) -> Maybe<Uint8Array> {
        let (psbt, utxos) = self.redeem_psbt_utxo_multi(&options)?;
        let env = self.env(&psbt, utxos.into_iter().map(ElementsUtxo::from).collect())?;
        let all = env.c_tx_env().sighash_all().to_byte_array();
        let u8a = Uint8Array::new_with_length(all.len() as u32);
        u8a.copy_from(&all);
        Ok(u8a)
    }

    /// Signed redeem transaction.
    /// Broadcast it to redeem funds.
    #[wasm_bindgen(js_name = redeemTxMulti)]
    pub fn redeem_tx_multi (&self, options: JsValue) -> Maybe<Object> {
        let wit = get!(options, "witness", arg_witness)?;
        let (mut psbt, utxos) = self.redeem_psbt_utxo_multi(&options)?;
        let env = self.env(&psbt, utxos.into_iter().map(ElementsUtxo::from).collect())?;
        let sat = try_!("satisfy": self.compiled.satisfy_with_env(wit, Some(&env)))?;
        let (program_bytes, witness_bytes) = sat.redeem().encode_to_vec();
        psbt.inputs_mut()[0].final_script_witness = Some(vec![
            witness_bytes,
            program_bytes,
            self.cmr_vec(),
            self.control_block()?.serialize(),
        ]);
        ret_tx(&try_!("extract final tx:": psbt.extract_tx())?)
    }

    fn env (&self, psbt: &PartiallySignedTransaction, ins: Vec<ElementsUtxo>) -> Maybe<Env> {
        let tx = Arc::new(try_!("extract preliminary tx:": psbt.extract_tx())?);
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
        let prefix = (self.script(), leaf_version());
        let block = required!("control block": self.tap()?.control_block(&prefix))?;
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
        let tap = try_!("taproot: add leaf": tap.add_leaf_with_ver(0, scr, leaf_version()))?;
        let tap = try_!("taproot: finalize": tap.finalize(&SECP256K1, unspendable()?))?;
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
    try_!("constant failed to deserialize: unspendable key": XOnlyPublicKey::from_str(
        "50929b74c1a04954b78b4b6035e97a5e078a5a0f28ec96d547bfee9ace803ac0"
    ))
}

/// Construct [Transaction] from [TxOut]s and [TxIn]s.
fn transaction (input: Vec<TxIn>, output: Vec<TxOut>) -> Transaction {
    Transaction { version: 2, lock_time: LockTime::ZERO, input, output }
}

/// Construct [TxIn] from [OutPoint].
fn tx_input (outpoint: OutPoint) -> TxIn {
    TxIn {
        previous_output: outpoint,
        is_pegin:        false,
        script_sig:      Script::new(),
        sequence:        Sequence::MAX,
        asset_issuance:  AssetIssuance::null(),
        witness:         TxInWitness::empty(),
    }
}

/// Construct [TxOut].
fn tx_output (script_pubkey: Script, asset_id: AssetId, value: u64) -> TxOut {
    TxOut {
        script_pubkey,
        value:    TxValue::Explicit(value),
        asset:    Asset::Explicit(asset_id),
        nonce:    Nonce::Null,
        witness:  TxOutWitness::default(),
    }
}

fn arg_address (x: JsValue) -> Maybe<Address> {
    let address = required!("addr: not string": x.as_string())?;
    let address = try_!("addr: not parsed": Address::from_str(&address))?;
    Ok(address)
}

fn arg_txid (x: JsValue) -> Maybe<Txid> {
    let address = required!("txid: not string": x.as_string())?;
    let address = try_!("txid: not parsed": Txid::from_str(&address))?;
    Ok(address)
}

fn arg_tx (bytes: JsValue) -> Maybe<Transaction> {
    let bytes = required!("tx bytes: not string": bytes.as_string())?;
    let bytes = try_!("tx bytes: not base16": hex::decode(bytes.trim()))?;
    let tx    = try_!("tx bytes: not parsed": deserialize_tx(&bytes))?;
    Ok(tx)
}

fn arg_tx_ins (array: JsValue) -> Maybe<Vec<TxIn>> {
    let mut inputs = vec![];
    for input in Array::from(&array).iter() {
        let input = try_!("input: couldn't serialize": JSON::stringify(&input))?;
        let input = try_!("input: couldn't deserialize":
            serde_json::from_str(&input.as_string().unwrap_or_default()))?;
        inputs.push(input);
    }
    Ok(inputs)
}

fn arg_tx_outs (array: JsValue) -> Maybe<Vec<TxOut>> {
    let mut outputs = vec![];
    for output in Array::from(&array).iter() {
        let output = try_!("output: couldn't serialize": JSON::stringify(&output))?;
        let output = try_display!("output: couldn't deserialize":
            serde_json::from_str(&output.as_string().unwrap_or_default()))?;
        outputs.push(output);
    }
    Ok(outputs)
}

fn arg_pset_ins (array: JsValue) -> Maybe<Vec<Input>> {
    let mut inputs = vec![];
    for input in Array::from(&array).iter() {
        let input = try_!("input: couldn't serialize": JSON::stringify(&input))?;
        let input = try_!("input: couldn't deserialize":
            serde_json::from_str(&input.as_string().unwrap_or_default()))?;
        inputs.push(input);
    }
    Ok(inputs)
}

fn arg_pset_outs (array: JsValue) -> Maybe<Vec<Output>> {
    let mut outputs = vec![];
    for output in Array::from(&array).iter() {
        let output = try_!("output: couldn't serialize": JSON::stringify(&output))?;
        let output = try_display!("output: couldn't deserialize":
            serde_json::from_str(&output.as_string().unwrap_or_default()))?;
        outputs.push(output);
    }
    Ok(outputs)
}

fn arg_string (input: JsValue) -> Maybe<String> {
    if JsString::is_type_of(&input) {
        required!("decode input": input.as_string())
    } else {
        err!("invalid chain: {input:?}; try elementsregtest, liqudtestnet")
    }
}

fn arg_asset_id (bytes: JsValue) -> Maybe<AssetId> {
    let bytes = required!("asset id: not string": bytes.as_string())?;
    let bytes = try_!("asset id: not base16": hex::decode(bytes.trim()))?;
    let tx    = try_!("asset id: not parsed": AssetId::from_slice(&bytes))?;
    Ok(tx)
}

fn arg_utxos (options: JsValue) -> Maybe<Vec<(OutPoint, TxOut)>> {
    let mut utxos = vec![];
    for utxo in Array::from(&options).iter() {
        utxos.push(arg_utxo(utxo)?);
    }
    Ok(utxos)
}

fn arg_utxo (options: JsValue) -> Maybe<(OutPoint, TxOut)> {
    let txid  = get!(options, "txid",      arg_txid)?;
    let vout  = get!(options, "vout",      arg_vout)?;
    let recip = get!(options, "recipient", arg_address)?;
    let asset = get!(options, "asset",     arg_asset_id)?;
    let value = get!(options, "value",     arg_sats)?;
    Ok((OutPoint { txid, vout }, TxOut {
        script_pubkey: recip.script_pubkey(),
        value: TxValue::Explicit(value),
        asset: Asset::Explicit(asset),
        ..Default::default()
    }))
}

fn arg_vout (input: JsValue) -> Maybe<u32> {
    Ok(if BigInt::is_type_of(&input) {
        try_!("BigInt -> vout (u32)": u64::try_from(input))? as u32
    } else if Number::is_type_of(&input) {
        try_!("Number -> vout (u32)": f64::try_from(input))? as u32
    } else if JsString::is_type_of(&input) {
        try_!("String -> vout (u32)": u64::try_from(input))? as u32
    } else {
        return err!("vout: received {:?}: need integer", input.js_typeof())
    })
}

fn arg_sats (input: JsValue) -> Maybe<u64> {
    if BigInt::is_type_of(&input) {
        try_!("BigInt -> sats (u64)": u64::try_from(input))
    } else if Number::is_type_of(&input) {
        warn!("Number -> sats (u64): * 10^8; use BigInt to avoid precision issues");
        try_!("Number -> sats (u64)": f64::try_from(input).map(|x|(x * 100000000.0) as u64))
    } else if JsString::is_type_of(&input) {
        warn!("String -> sats (u64): use BigInt to avoid typing issues");
        try_debug!("String -> sats (u64)": u64::try_from(input))
    } else {
        return err!("sats: received {:?}: need integer", input.js_typeof())
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
        let wits = try_!("wits: failed to stringify": JSON::stringify(&wits))?;
        if let Some(s) = wits.as_string() { return Ok(serde_json::from_str(&s)?); }
    }
    Ok(WitnessValues::default())
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

fn ret_tx (tx: &Transaction) -> Maybe<Object> {
    let bytes = tx.serialize();
    Ok(obj! {
        "bytes" = ret_u8a(&bytes),
        "hex"   = hex::encode(&bytes),
        "tx"    = JSON::parse(serde_json::to_string(&tx)?.as_str()).expect("parse own tx"),
    })
}

fn ret_pset (tx: &PartiallySignedTransaction) -> Maybe<JsValue> {
    Ok(JSON::parse(serde_json::to_string(&tx)?.as_str()).expect("parse own tx"))
}
