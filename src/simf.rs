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
    /// Internal constructor.
    fn new (source: &str, args: Arguments, debug: bool, prune: bool) -> Maybe<Self> {
        let compiled = CompiledProgram::new(source, args.clone(), debug);
        let compiled = expected_display!("compile failed": compiled)?;
        let commit   = compiled.commit();
        let script   = Script::from(commit.cmr().to_byte_array().to_vec());
        let source   = source.into();
        let p2tr     = script_to_p2tr(script.clone())?;
        Ok(Self { source, p2tr, debug, prune, args, compiled, commit, script, })
    }
    /// Use this in JS to get the properties of the compiled program.
    #[wasm_bindgen(js_name = toJSON)] pub fn to_json (&self) -> Object {
        Output::program(&self).unwrap_or_else(|e|JsValue::from(e).into())
    }
    /// Programs stringify to their P2TR addresses.
    #[wasm_bindgen(js_name = toString)] pub fn to_string (&self) -> String {
        format!("{}", &self.p2tr)
    }
    /// Generate a transaction funding the program's P2TR address.
    #[wasm_bindgen] pub fn tx_fund (&self, options: Object) -> Maybe<Object> {
        asserted!(options.is_object());
        let tx_in  = get!(options, "tx",     Input::tx)?;
        let from   = get!(options, "from",   Input::address)?;
        let amount = get!(options, "amount", Input::sats)?;
        let fee    = get!(options, "fee",    Input::sats)?;
        let (previous_output, utxo) = find_utxo(&tx_in, &from)?;
        let asset_id = required!("utxo: asset cloaked": utxo.asset.explicit())?;
        let balance  = required!("utxo: value cloaked": utxo.value.explicit())?;
        let input = vec![TxIn {
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
        }];
        let output = tx_out_split(from.clone(), self.p2tr.clone(), asset_id, balance, amount, fee)?;
        tx_json(&tx_in, &Transaction { version: 2, lock_time: LockTime::ZERO, input, output, })
    }
    /// Generate a transaction spending funds from the program's P2TR address.
    #[wasm_bindgen] pub fn tx_spend (&self, options: Object) -> Maybe<Object> {
        asserted!(options.is_object());
        let tx_in   = get!(options, "tx",      Input::tx)?;
        let to      = get!(options, "to",      Input::address)?;
        let amount  = get!(options, "amount",  Input::sats)?;
        let fee     = get!(options, "fee",     Input::sats)?;
        let witness = get!(options, "witness", Input::witness)?;
        let (previous_output, utxo) = find_utxo(&tx_in, &self.p2tr)?;
        let asset_id = required!("utxo: asset cloaked": utxo.asset.explicit())?;
        let balance  = required!("utxo: value cloaked": utxo.value.explicit())?;
        let output   = tx_out_split(self.p2tr.clone(), to, asset_id, balance, amount, fee)?;
        let tx_out   = Arc::new(Transaction {
            version: 2, lock_time: LockTime::ZERO, output,
            input: vec![TxIn {
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
            }],
        });
        let mut pset = PartiallySignedTransaction::from_tx(tx_out.as_ref().clone());
        //debug!("txin={tx_in:#?}");
        //debug!("txou={tx_out:#?}");
        //debug!("pset={pset:#?}");
        //debug!("  inputs={:#?}", pset.inputs());
        let cmr  = self.compiled.commit().cmr();
        let ctrl = ControlBlock::from_slice(&script_control_block(&self.script)?)?;
        // FIXME: allow non-elementsregtest
        let hash = BlockHash::from_str("0f9188f13cb7b2c71f2a335e3a4fc328bf5beb436012afca590b1a11466e2206")?;
        let scr  = utxo.script_pubkey.clone();
        let ins  = vec![ElementsUtxo { script_pubkey: scr, asset: utxo.asset, value: utxo.value }];
        let env  = ElementsEnv::new(tx_out, ins, 0, cmr, ctrl, None, hash);
        let ctrl = script_control_block(&self.script)?;
        let scr  = self.script.clone().into_bytes();
        let sat  = expected_debug!("satisfy": self.compiled.satisfy_with_env(witness, Some(&env)));
        pset.inputs_mut()[0].final_script_witness = Some(final_script_witness(ctrl, scr, sat?)?);
        tx_json(&tx_in, &expected!("extract final tx": pset.extract_tx())?)
    }
}
/// Generate transaction output for spending part or all of the funds at an address.
pub(crate) fn tx_out_split (
    owner: Address, spender: Address, asset_id: AssetId, balance: u64, amount: u64, fee: u64,
) -> Maybe<Vec<TxOut>> {
    asserted!(amount + fee <= balance);
    let spent = tx_script_out(asset_id, spender, amount);
    Ok(if amount + fee == balance {
        debug!("Will spend {amount} + {fee} = {balance}");
        vec![TxOut::new_fee(fee, asset_id), spent]
    } else {
        let remain = balance - (amount + fee);
        debug!("Will spend {amount} + {fee} = {balance} - {remain}");
        let remain = tx_script_out(asset_id, owner, remain);
        vec![TxOut::new_fee(fee, asset_id), spent, remain]
    })
}
fn tx_script_out (asset_id: AssetId, to: Address, value: u64) -> TxOut {
    TxOut {
        script_pubkey: to.script_pubkey(),
        value:   TxValue::Explicit(value),
        asset:   Asset::Explicit(asset_id),
        nonce:   Nonce::Null,
        witness: TxOutWitness::default(),
    }
}
/// Wrap transaction info returned to JS-land.
pub(crate) fn tx_json (tx_in: &Transaction, tx_out: &Transaction) -> Maybe<Object> {
    let bytes = tx_out.serialize();
    Ok(obj! {
        "tx_in"  = format!("{tx_in:?}"),
        "tx_out" = format!("{tx_out:?}"),
        "bytes"  = Output::u8a(&bytes),
        "hex"    = hex::encode(&bytes),
    })
}
pub fn find_utxo (tx: &Transaction, address: &Address) -> Maybe<(OutPoint, TxOut)> {
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
pub fn final_script_witness (
    control: Vec<u8>, script: Vec<u8>, satisfied: SatisfiedProgram,
) -> Maybe<Vec<Vec<u8>>> {
    let redeem = satisfied.redeem();
    let bounds = redeem.bounds();
    asserted!(bounds.cost.is_consensus_valid());
    let (program, witness) = redeem.encode_to_vec();
    let mut final_script_witness = vec![witness, program, script, control];
    // Add padding to the script witness if budget is exceeded
    if let Some(padding_bytes) = bounds.cost.get_padding(&final_script_witness) {
        // Annex has to be removed from the stack
        // https://github.com/ElementsProject/elements/blob/9748c00c3344b815d75c4b5c251b341fb34fa80f/src/script/interpreter.cpp#L3275
        final_script_witness.push(padding_bytes);
    } else {
        //println!("No padding needed");
    }
    asserted!(bounds.cost.is_budget_valid(&final_script_witness));
    Ok(final_script_witness)
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

        //let json = expected!("convert to json": JSON::parse(&serde_json::to_string(&tx)?))?;
        //let input_utxos = pset
            //.inputs()
            //.iter()
            //.enumerate()
            //.map(|(n, input)| match input.witness_utxo {
              //Some(ref utxo) => Ok(ElementsUtxo {
                //script_pubkey: utxo.script_pubkey.clone(),
                //asset: utxo.asset,
                //value: utxo.value,
              //}),
              //None => Err(PsetError::MissingWitnessUtxo(n)),
            //})
            //.collect::<Result<Vec<_>, _>>()?;
        //let tx = Arc::new(pset.extract_tx().map_err(PsetError::PsetExtract)?);
        //let ins = pset.inputs().iter().enumerate().map(|(n, input)| match input.witness_utxo {
            //Some(ref utxo) => Ok(ElementsUtxo {
                //script_pubkey: utxo.script_pubkey.clone(),
                //asset: utxo.asset,
                //value: utxo.value,
            //}),
            //None => Err(PsetError::MissingWitnessUtxo(n)),
        //}).collect::<Result<Vec<_>, _>>()?
        //Ok(ElementsEnv::new(
            //tx,
            //ins,
            //input,
            //cmr,
            //control_block.clone(),
            //None,
            //match genesis_hash {
                //Some(s) => s.parse().map_err(PsetError::GenesisHashParse)?,
                //None => elements::BlockHash::from_byte_array([
                    //// copied out of simplicity-webide source
                    //0xc1, 0xb1, 0x6a, 0xe2, 0x4f, 0x24, 0x23, 0xae,
                    //0xa2, 0xea, 0x34, 0x55, 0x22, 0x92, 0x79, 0x3b,
                    //0x5b, 0x5e, 0x82, 0x99, 0x9a, 0x1e, 0xed, 0x81,
                    //0xd5, 0x6a, 0xee, 0x52, 0x8e, 0xda, 0x71, 0xa7,
                //]),
            //},
        //))
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

