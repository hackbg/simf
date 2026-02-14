// Bits and pieces.

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
