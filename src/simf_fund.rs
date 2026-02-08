use crate::*;
#[wasm_bindgen] impl Program {
    /// Generate a transaction funding the program's P2TR address.
    #[wasm_bindgen] pub fn fund (&self, options: Object) -> Maybe<Object> {
        asserted!(options.is_object());
        let tx_in  = get!(options, "tx",    Input::tx)?;
        let to     = get!(options, "to",    Input::address)?;
        let value  = get!(options, "value", Input::sats)?;
        let fee    = get!(options, "fee",   Input::sats)?;
        let (input, asset_id, balance) = self.tx_ins(&tx_in)?;
        tx_json(&tx_in, &Transaction {
            version: 2, lock_time: LockTime::ZERO, input,
            output: self.tx_outs(to, asset_id, balance, value, fee)?,
        })
    }
}
