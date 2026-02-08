use crate::*;

#[wasm_bindgen] impl Program {
    /// Generate a transaction spending funds from the program's P2TR address.
    #[wasm_bindgen] pub fn spend (&self, options: Object) -> Maybe<Object> {
        asserted!(options.is_object());
        let tx_in   = get!(options, "tx",      Input::tx)?;
        let to      = get!(options, "to",      Input::address)?;
        let value   = get!(options, "value",   Input::sats)?;
        let fee     = get!(options, "fee",     Input::sats)?;
        let witness = get!(options, "witness", Input::witness)?;
        let (input, asset_id, balance) = self.tx_ins(&tx_in)?;
        let tx_out  = Arc::new(Transaction {
            version: 2, lock_time: LockTime::ZERO, input,
            output: self.tx_outs(to, asset_id, balance, value, fee)?
        });
        let mut pset = PartiallySignedTransaction::from_tx(tx_out.as_ref().clone());
        pset.inputs_mut()[0].final_script_witness = Some(final_script_witness(
            script_control_block(&self.script)?,
            self.script.clone().into_bytes(),
            expected!("satisfy": self.compiled.satisfy_with_env(
                witness,
                Some(&ElementsEnv::new(
                    tx_out,
                    vec![ElementsUtxo { // FIXME: take from pset inputs:
                        script_pubkey: self.script.clone(),
                        asset: Asset::Explicit(asset_id),
                        value: TxValue::Explicit(value),
                    }],
                    0,
                    self.compiled.commit().cmr(),
                    ControlBlock::from_slice(&script_control_block(&self.script)?)?,
                    None,
                    // FIXME: allow non-elementsregtest
                    BlockHash::from_str(
                        "0f9188f13cb7b2c71f2a335e3a4fc328bf5beb436012afca590b1a11466e2206"
                    )?,
                ))
            ))?)?
        );
        tx_json(&tx_in, &expected!("extract final tx": pset.extract_tx())?)
    }
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
