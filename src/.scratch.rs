
    // /// Output the hash which must be signed by the witness for the spend to be valid.
    // #[wasm_bindgen(js_name = redeemSighash)]
    // pub fn redeem_sighash (&self, options: Object) -> Maybe<String> {
    //     let Program { compiled, commit, p2tr, .. } = self;
    //     let (_tx, env) = redeem_context(&options, &compiled, &commit, &p2tr)?;
    //     Ok(format!("{}", env.c_tx_env().sighash_all()))
    // }

    // /// Generate a transaction to spend funds from the program's P2TR address.
    // #[wasm_bindgen(js_name = redeemTx)]
    // pub fn redeem_tx (&self, options: Object) -> Maybe<Object> {
    //     let Program { compiled, commit, p2tr, .. } = self;
    //     debug!("REDEEM: p2tr={p2tr:?}\n   script={commit:?}");
    //     let (tx, env) = redeem_context(&options, &compiled, &commit, &p2tr)?;
    //     let witnessed = get!(options, "witness", Input::witness)?;
    //     let pset = redeem_pset(&env, compiled, &witnessed, tx, commit)?;
    //     Output::tx(&expected!("extract final tx": pset.extract_tx())?)
    // }


    /// Generate a transaction to fund the program's P2TR address.
    #[wasm_bindgen(js_name = commitTx)]
    pub fn commit_tx (&self, options: Object) -> Maybe<Object> {
        asserted!(options.is_object());
        let from = get!(options, "from", Input::address)?;
        let (prev, _, asset_id, balance, amount, fee) = Input::context(&options, &from)?;
        let output = send(&from, &self.p2tr, asset_id, balance, amount, fee)?;
        Output::tx(&transaction(output, vec![tx_input(prev)]))
    }
