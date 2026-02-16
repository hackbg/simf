use crate::*;

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
    #[wasm_bindgen(js_name = "signSchnorr")]
    pub fn sign_schnorr (&self, message: Uint8Array) -> Uint8Array {
        let mut bytes = [0u8;32];
        message.copy_to(&mut bytes);
        let result = Uint8Array::new_with_length(64);
        result.copy_from(&self.0.sign_schnorr(secp256k1::Message::from_digest(bytes)).serialize());
        result
    }
    #[wasm_bindgen(js_name = "xOnlyPublicKey")]
    pub fn xonly_public_key (&self) -> Uint8Array {
        let result = Uint8Array::new_with_length(32);
        result.copy_from(&self.0.x_only_public_key().0.serialize());
        result
    }
}

/// Compile a SimplicityHL [Program].
#[wasm_bindgen] pub fn compile (source: JsString, options: Object) -> Maybe<Program> {
    console_error_panic_hook::set_once();
    let source = source.as_string().unwrap_or_default();
    let mut chain = String::from("elementsregtest");
    let mut args  = Arguments::default();
    if options.is_object() {
        args = get!(options, "args",  Input::args)?;
        let chain_val = get!(options, "chain");
        if JsString::is_type_of(&chain_val) {
            chain = required!("chain selector must be string": chain_val.as_string())?
        } else {
            return err!("invalid chain: {chain_val:?}; try elementsregtest, liqudtestnet")
        };
    }
    Program::new(chain.as_str(), &source, args)
}

/// A valid compiled SimplicityHL program.
#[wasm_bindgen(inspectable)] pub struct Program {
    pub(crate) args:     Arguments,
    pub(crate) commit:   Arc<CommitNode<Elements>>,
    pub(crate) compiled: CompiledProgram,
    pub(crate) p2tr:     Address,
    pub(crate) script:   Script,
    pub(crate) source:   Arc<str>,
}

#[wasm_bindgen] impl Program {

    /// Internal constructor.
    fn new (chain: &str, source: &str, args: Arguments) -> Maybe<Self> {
        let compiled = CompiledProgram::new(source, args.clone(), true);
        let compiled = expected_display!("compile failed": compiled)?;
        let commit = compiled.commit();
        let source = source.into();
        let script = Script::from(commit.cmr().to_byte_array().to_vec());
        let tap = script_to_taproot(script.clone())?;
        let p2tr = Address::p2tr(
            SECP256K1,
            tap.internal_key(),
            tap.merkle_root(),
            None,
            match chain {
                "liquidtestnet"   => &AddressParams::LIQUID_TESTNET,
                "elementsregtest" => &AddressParams::ELEMENTS,
                _ => return err!("invalid chain: {chain}; try elementsregtest, liqudtestnet")
            }
        );
        Ok(Self { source, p2tr, args, compiled, commit, script, })
    }

    /// Use this in JS to get the properties of the compiled program.
    #[wasm_bindgen(js_name = toJSON)]
    pub fn to_json (&self) -> Object {
        Output::program(&self).unwrap_or_else(|e|JsValue::from(e).into())
    }

    /// Programs stringify to their P2TR addresses.
    #[wasm_bindgen(js_name = toString)]
    pub fn to_string (&self) -> String {
        format!("{}", &self.p2tr)
    }

    /// Generate a transaction to fund the program's P2TR address.
    #[wasm_bindgen(js_name = commitTx)]
    pub fn commit_tx (&self, options: Object) -> Maybe<Object> {
        asserted!(options.is_object());
        let from = get!(options, "from", Input::address)?;
        let (prev, _, asset_id, balance, amount, fee) = Input::context(&options, &from)?;
        let output = send(&from, &self.p2tr, asset_id, balance, amount, fee)?;
        Output::tx(&transaction(output, vec![tx_input(prev)]))
    }

    /// Output the hash which must be signed by the witness for the spend to be valid.
    #[wasm_bindgen(js_name = redeemSighash)]
    pub fn redeem_sighash (&self, options: Object) -> Maybe<String> {
        let Program { compiled, script, p2tr, .. } = self;
        let (_tx, env) = redeem_context(&options, &compiled, &script, &p2tr)?;
        Ok(format!("{}", env.c_tx_env().sighash_all()))
    }

    /// Generate a transaction to spend funds from the program's P2TR address.
    #[wasm_bindgen(js_name = redeemTx)]
    pub fn redeem_tx (&self, options: Object) -> Maybe<Object> {
        let Program { compiled, script, p2tr, .. } = self;
        debug!("REDEEM: p2tr={p2tr:?}\n   script={script:?}");
        let (tx, env) = redeem_context(&options, &compiled, &script, &p2tr)?;
        let witnessed = get!(options, "witness", Input::witness)?;
        let pset = redeem_pset(&env, compiled, &witnessed, tx, script)?;
        Output::tx(&expected!("extract final tx": pset.extract_tx())?)
    }
}

fn redeem_context (
    options: &Object, compiled: &CompiledProgram, script: &Script, p2tr: &Address
) -> Maybe<(Arc<Transaction>, Env)> {
    let (prev, utxo, asset_id, balance, amount, fee) = Input::context(options, p2tr)?;
    let to = get!(options, "to", Input::address)?;
    let output = send(p2tr, &to, asset_id, balance, amount, fee)?;
    let tx = Arc::new(transaction(output, vec![tx_input(prev)]));
    tx.verify_tx_amt_proofs(secp256k1::SECP256K1, &[utxo.clone()])?;
    let cmr = compiled.commit().cmr();
    let control = ControlBlock::from_slice(&control_block(&script)?)?;
    let inputs = vec![elements_utxo(&utxo)];
    Ok((tx.clone(), ElementsEnv::new(tx, inputs, 0, cmr, control, None, genesis()?)))
}

fn redeem_pset (
    env:       &Env,
    program:   &CompiledProgram,
    witnessed: &WitnessValues,
    tx:        Arc<Transaction>,
    script:    &Script,
) -> Maybe<PartiallySignedTransaction> {
    let (_result, redeem, cost) = evaluate(env, program, witnessed, )?;
    let (program, witness) = redeem.encode_to_vec();
    let control = control_block(script)?;
    let mut script_witness = vec![witness, program, script.as_bytes().into(), control];
    if let Some(padding_bytes) = cost.get_padding(&script_witness) {
        //// SY: Annex has to be removed from the stack (?)
        //// https://github.com/ElementsProject/elements/blob/9748c00c3344b815d75c4b5c251b341fb34fa80f/src/script/interpreter.cpp#L3275
        script_witness.push(padding_bytes);
    }
    asserted!(cost.is_budget_valid(&script_witness));
    let mut tx = Arc::unwrap_or_clone(tx);
    tx.input[0].witness = TxInWitness {
        script_witness: script_witness.clone(),
        ..Default::default()
    };
    //Output::tx(&tx)
    let mut pset = PartiallySignedTransaction::from_tx(tx);
    // Add padding to the script witness if budget is exceeded
    pset.inputs_mut()[0].final_script_witness = Some(script_witness);
    Ok(pset)
}

fn evaluate (
    env:     &Env,
    program: &CompiledProgram,
    witness: &WitnessValues,
) -> Maybe<(SimValue, Arc<RedeemNode<Elements>>, Cost)> {
    debug!("EXEC: Witness:   {witness:?}");
    let program = expected_debug!("satisfy": program.satisfy(witness.clone()))?;
    debug!("EXEC: Satisfied: {program:?}");
    let mut tracker = tracker(program.debug_symbols());
    let redeem = program.redeem().prune_with_tracker(&env, &mut tracker)?;
    let bounds = redeem.bounds();
    debug!("EXEC: Redeem:    {redeem:?}\n    Bounds {bounds:?}");
    asserted!(bounds.cost.is_consensus_valid());
    let mut machine = BitMachine::for_program(&redeem)?;
    let result = expected_debug!("exec": machine.exec_with_tracker(&redeem, &env, &mut tracker))?;
    debug!("REDEEM: result={result:?}");
    Ok((result, redeem, bounds.cost))
}

fn tracker (symbols: &DebugSymbols) -> DefaultTracker<'_> {
    DefaultTracker::new(symbols)
        .with_log_level(TrackerLogLevel::Debug)
        .with_debug_sink(       |a, b|debug!("=> SimplicityHL DEBUG {a} {b}"))
        .with_jet_trace_sink(|a, b, c|debug!("=> SimplicityHL JET   {a} {b:?} {c:?}"))
        .with_warning_sink(        |w|debug!("=> SimplicityHL WARN  {w}"))
}
