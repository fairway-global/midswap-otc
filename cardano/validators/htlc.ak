
/// HTLC (Hash Time-Locked Contract) validator for the Cardano side of a
/// Midnight<->Cardano atomic swap.
///
/// Uses SHA-256 for preimage hashing, which is identical to Midnight's
/// persistentHash on Bytes<32> — enabling trustless cross-chain swaps
/// with a single shared preimage.

use aiken/interval.{Finite}
use cardano/transaction.{OutputReference, Transaction}
use htlc/types.{HTLCDatum, HTLCRedeemer, Reclaim, Withdraw}
use htlc/validation.{validate_reclaim, validate_withdraw}

validator htlc {
  spend(
    datum: Option<HTLCDatum>,
    redeemer: HTLCRedeemer,
    _input: OutputReference,
    self: Transaction,
  ) {
    expect Some(d) = datum

    when redeemer is {
      Withdraw { preimage } -> {
        let upper =
          when self.validity_range.upper_bound.bound_type is {
            Finite(u) -> Some(u)
            _ -> None
          }
        validate_withdraw(d, preimage, self.extra_signatories, upper)
      }
      Reclaim -> {
        let lower =
          when self.validity_range.lower_bound.bound_type is {
            Finite(l) -> Some(l)
            _ -> None
          }
        validate_reclaim(d, self.extra_signatories, lower)
      }
    }
  }

  else(_) {
    fail
  }
}
