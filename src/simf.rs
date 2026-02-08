use crate::*;
/// [ElementsEnv] for satisfying some Simplicity programs.
pub type Env = simplicityhl::simplicity::jet::elements::ElementsEnv<Arc<Transaction>>;
/// Create SimplicityHL P2TR address from a [Cmr]
/// (Commitment Merkle root), such as that of a
/// compiled Simplicity program.
#[wasm_bindgen]
pub fn cmr_to_p2tr (cmr: JsValue) -> Maybe<JsString> {
    console_error_panic_hook::set_once();
    Ok(format!("{}", script_to_p2tr(Script::from(Input::bytes(cmr)?))?).into())
}
/// Compile a SimplicityHL program.
#[wasm_bindgen] pub fn compile (source: JsString, options: Object) -> Maybe<Program> {
    console_error_panic_hook::set_once();
    let source = source.as_string().unwrap_or_default();
    let mut debug = false;
    let mut prune = false;
    let mut args  = Arguments::default();
    if options.is_object() {
        debug = get!(options, "debug", Input::flag);
        prune = get!(options, "prune", Input::flag);
        args  = get!(options, "args",  Input::args)?;
    }
    Program::new(&source, args, debug, prune)
}
/// A valid compiled SimplicityHL program.
#[wasm_bindgen(inspectable)] pub struct Program {
    pub(crate) args:     Arguments,
    pub(crate) commit:   Arc<CommitNode<Elements>>,
    pub(crate) compiled: CompiledProgram,
    pub(crate) debug:    bool,
    pub(crate) p2tr:     Address,
    pub(crate) prune:    bool,
    pub(crate) script:   Script,
    pub(crate) source:   Arc<str>,
}
#[wasm_bindgen] impl Program {
    /// Use this in JS to get the properties of the compiled program.
    #[wasm_bindgen(js_name = toJSON)] pub fn to_json (&self) -> Object {
        Output::program(&self).unwrap_or_else(|e|JsValue::from(e).into())
    }
    /// Programs stringify to their P2TR addresses.
    #[wasm_bindgen(js_name = toString)] pub fn to_string (&self) -> String {
        format!("{}", &self.p2tr)
    }
    /// Internal constructor.
    fn new (source: &str, args: Arguments, debug: bool, prune: bool) -> Maybe<Self> {
        let compiled = CompiledProgram::new(source, args.clone(), debug);
        let compiled = expected!("compile failed": compiled)?;
        let commit   = compiled.commit();
        let script   = Script::from(commit.cmr().to_byte_array().to_vec());
        let source   = source.into();
        let p2tr     = taproot_to_p2tr(&script_to_taproot(script.clone())?);
        Ok(Self { source, p2tr, debug, prune, args, compiled, commit, script, })
    }
    pub(crate) fn tx_ins (&self, input: &Transaction) -> Maybe<(Vec<TxIn>, AssetId, u64)> {
        let (previous, utxo) = find_utxo(input, &self.p2tr)?;
        let asset_id = required!("utxo: asset cloaked": utxo.asset.explicit())?;
        let balance  = required!("utxo: value cloaked": utxo.value.explicit())?;
        Ok((tx_script_ins(previous), asset_id, balance))
    }
    pub(crate) fn tx_outs (&self, to: Address, asset_id: AssetId, balance: u64, value: u64, fee: u64) -> Maybe<Vec<TxOut>> {
        tx_script_outs(&self.p2tr, to, asset_id, balance, value, fee)
    }
}
pub(crate) fn tx_json (tx_in: &Transaction, tx_out: &Transaction) -> Maybe<Object> {
    let bytes = tx_out.serialize();
    Ok(obj! {
        "tx_in"  = format!("{tx_in:?}"),
        "tx_out" = format!("{tx_out:?}"),
        "bytes"  = Output::u8a(&bytes),
        "hex"    = hex::encode(&bytes),
    })
}
pub fn tx_script_ins (previous_output: OutPoint) -> Vec<TxIn> {
    vec![TxIn {
        previous_output,
        is_pegin:       false,
        script_sig:     Script::new(),
        sequence:       Sequence::MAX,
        asset_issuance: AssetIssuance::null(),
        witness:        TxInWitness::empty(),
    }]
}
pub fn tx_script_outs (
    program:  &Address,
    spender:  Address,
    asset_id: AssetId,
    balance:  u64,
    value:    u64,
    cost:     u64,
) -> Maybe<Vec<TxOut>> {
    asserted!(value + cost <= balance);
    let fee = TxOut::new_fee(cost, asset_id);
    let spent = tx_script_out(asset_id, spender, value);
    Ok(if value + cost == balance {
        log!("Will spend {value} + {cost} = {balance}");
        vec![fee, spent]
    } else {
        let remain = balance - (value + cost);
        log!("Will spend {value} + {cost} = {balance} - {remain}");
        let remain = tx_script_out(asset_id, program.clone(), remain);
        vec![fee, spent, remain]
    })
}
/// Generate P2TR (pay-to-taproot) [Address] from a [Script]'s [Cmr].
pub fn script_to_p2tr (script: Script) -> Maybe<Address> {
    Ok(taproot_to_p2tr(&script_to_taproot(script)?))
}
/// Generate P2TR (pay-to-taproot) [Address] from [TaprootSpendInfo].
pub fn taproot_to_p2tr (tap: &TaprootSpendInfo, /* TODO: kind: Option<AddressParams>*/) -> Address {
    let key = tap.internal_key();
    let root = tap.merkle_root();
    Address::p2tr(secp256k1::SECP256K1, key, root, None, &AddressParams::LIQUID_TESTNET)
}
/// Generate [TaprootSpendInfo] for a given [Script].
pub fn script_to_taproot (script: Script) -> Maybe<TaprootSpendInfo> {
    let tap = TaprootBuilder::new();
    let ver = expected!("use constant leaf version": LeafVersion::from_u8(0xbe))?;
    let key = expected!("parse unspendable key": hex::decode(
        // FIXME: Magic constant (unspendable key)
        "50929b74c1a04954b78b4b6035e97a5e078a5a0f28ec96d547bfee9ace803ac0"
    ))?;
    let key = expected!("parse unspendable key": secp256k1::XOnlyPublicKey::from_slice(&key))?;
    let tap = expected!("taproot: add leaf": tap.add_leaf_with_ver(0, script, ver))?;
    let tap = expected!("taproot: finalize": tap.finalize(&secp256k1::SECP256K1, key))?;
    Ok(tap)
}
pub fn tx_script_out (asset_id: AssetId, to: Address, value: u64) -> TxOut {
    TxOut {
        script_pubkey: to.script_pubkey(),
        value:   TxValue::Explicit(value),
        asset:   Asset::Explicit(asset_id),
        nonce:   Nonce::Null,
        witness: TxOutWitness::default(),
    }
}
pub fn find_utxo (tx: &Transaction, p2tr: &Address) -> Maybe<(OutPoint, TxOut)> {
    let mut previous: Option<OutPoint> = Default::default();
    let mut utxo:     Option<TxOut>    = Default::default();
    for (vout, output) in tx.output.iter().enumerate() {
        debug!("vout={vout} output={output:?} value={:?}", &output.value);
        if output.script_pubkey == p2tr.script_pubkey() {
            previous = Some(OutPoint::new(tx.txid(), vout as u32));
            utxo     = Some(output.clone());
            break;
        }
    }
    Ok((required!(previous)?, required!(utxo)?))
}
pub fn script_control_block (script: &Script) -> Maybe<Vec<u8>> {
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

//#[wasm_bindgen]
//pub fn compile (source: JsString, options: Object) -> Maybe<Object> {
    //console_error_panic_hook::set_once();
    //let result         = Object::new();
    //let source         = source.as_string().unwrap_or_default();
    //let (debug, prune) = set_build_options(&result, &options)?;
    //let arguments      = set_build_arguments(&result, &options)?;
    //let compiled       = attempt!(CompiledProgram::new(source, arguments, debug));
    //let commit  = compiled.commit();
    //set!(result, "commit", format!("{}", hex::encode(&commit.to_vec_without_witness())));
    //let (cmr, amr, ihr) = (commit.cmr(), commit.amr(), commit.ihr());
    //set!(result, "cmr", format!("{}", hex::encode(&cmr.to_byte_array())));
    //set!(result, "amr", format!("{}", hex::encode(&amr.map(|x|x.to_byte_array()).unwrap_or_default())));
    //set!(result, "ihr", format!("{}", hex::encode(&ihr.map(|x|x.to_byte_array()).unwrap_or_default())));
    //let tap = TaprootBuilder::new();
    //let tap = attempt!(tap.add_leaf_with_ver(
        //0,
        //Script::from(cmr.to_byte_array().to_vec()),
        //LeafVersion::from_u8(0xbe).expect("constant leaf version")
    //));
    //let tap = attempt!(tap.finalize(
        //&secp256k1::SECP256K1,
        //attempt!(secp256k1::XOnlyPublicKey::from_slice(&hex::decode(UNSPENDABLE).unwrap())
    //)));
    //let p2tr = cmr_to_p2tr_impl(&cmr.to_byte_array());
    //set!(result, "p2tr", format!("{p2tr}"));
    //Ok(result)
    ////unimplemented!();
    ////let witness        = set_build_witness(&result, &options)?;
    ////let program_bytes  = set_build_bytes(&result, &compiled, &witness, prune)?;
    ////let _assembly      = set_build_assembly(&result, program_bytes)?;
    ////Ok(result)
//}


//fn set_build_source (result: &Object, source: &JsString) -> Maybe<String> {
    //let source = source.as_string().unwrap_or_default();
    //set!(result, "source", JsString::from(source.clone()));
    //Ok(source)
//}

//fn set_build_options (result: &Object, options: &Object) -> Maybe<(bool, bool)> {
    //let debug = get!(options, "debug").is_truthy();
    //set!(result, "debug", Boolean::from(debug));
    //let prune = get!(options, "prune").is_truthy();
    //set!(result, "prune", Boolean::from(prune));
    //Ok((debug, prune))
//}

//fn set_build_arguments (result: &Object, options: &Object) -> Maybe<Arguments> {
    //let arguments = get!(options, "arguments");
    //let arguments: Option<Arguments> = if arguments.is_object() {
        //set!(result, "arguments", arguments.clone());
        //if let Some(s) = JSON::stringify(&arguments)?.as_string() {
            //Some(attempt!(serde_json::from_str(&s)))
        //} else {
            //None
        //}
    //} else {
        //None
    //};
    //Ok(arguments.unwrap_or_default())
//}

////fn set_build_witness (result: &Object, options: &Object) -> Maybe<Option<WitnessValues>> {
    ////let witness = get!(options, "witness");
    ////Ok(if witness.is_object() {
        ////set!(result, "witness", witness.clone());
        ////if let Some(s) = JSON::stringify(&witness)?.as_string() {
            ////Some(attempt!(serde_json::from_str(&s)))
        ////} else {
            ////None
        ////}
    ////} else {
        ////None
    ////})
////}

////fn set_build_bytes (
    ////result:   &Object,
    ////compiled: &CompiledProgram,
    ////witness:  &Option<WitnessValues>,
    ////prune:    bool
////) -> Maybe<Vec<u8>> {
    //////let program_bytes = vec![];
    ////let program_bytes = if let Some(witness) = witness {
        ////let satisfied = attempt!(if prune {
            ////let env = dummy_env::dummy();
            ////compiled.satisfy_with_env(witness.clone(), Some(&env))
        ////} else {
            ////compiled.satisfy(witness.clone())
        ////});
        ////let node = satisfied.redeem();
        ////let (program_bytes, witness_bytes) = node.encode_to_vec();
        ////let bounds = node.bounds();
        ////set!(result, "witness", witness_bytes.clone());
        ////set!(result, "bounds", {
            ////let object = Object::new();
            ////set!(object, "extra_cells",  bounds.extra_cells);
            ////set!(object, "extra_frames", bounds.extra_frames);
            ////set!(object, "cost",         format!("{}", bounds.cost));
            ////object
        ////});
        ////let padding = node.bounds().cost.get_padding(&vec![
            ////witness_bytes.clone(),
            ////program_bytes.clone()
        ////]);
        ////set!(result, "padding", padding.unwrap_or_default().len());
        ////program_bytes
    ////} else {
        ////compiled.commit().encode_to_vec()
    ////};
    ////set!(result, "program", program_bytes.clone());
    ////Ok(program_bytes)
////}

////fn set_build_assembly (
    ////result: &Object,
    ////program_bytes: Vec<u8>
////) -> Maybe<Forest<Elements>> {
    ////let decoded = attempt!(CommitNode::decode(BitIter::from(program_bytes.into_iter())));
    ////let assembly = Forest::<Elements>::from_program(decoded);
    ////set!(result, "assembly", assembly.string_serialize());
    ////Ok(assembly)
////}

