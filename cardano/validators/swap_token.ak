/// One-shot minting policy for swap tokens.
/// Parameterized by a UTxO reference — can only mint when that specific
/// UTxO is consumed, ensuring tokens can only be minted once.

use aiken/collection/list
use cardano/transaction.{OutputReference, Transaction}

validator swap_token(utxo_ref: OutputReference) {
  mint(_redeemer: Data, _policy_id: ByteArray, self: Transaction) {
    // The parameterized UTxO must be consumed in this transaction.
    // Since UTxOs can only be spent once, this guarantees one-shot minting.
    list.any(
      self.inputs,
      fn(input) { input.output_reference == utxo_ref },
    )
  }

  else(_) {
    fail
  }
}
