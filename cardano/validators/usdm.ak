/// USDM minting policy — permissionless dollar-pegged stablecoin on Cardano.
///
/// Mirrors Midnight's USDC (`usdc.compact`), which also has no access control
/// on its `mint()` circuit. This keeps the demo symmetric: both sides of the
/// swap are anyone-can-mint stablecoins, so no price feed is needed. The
/// policyId is the hash of this script, giving USDM a single global asset
/// class. Asset name is `USDM` (ASCII 0x5553444d) — see cardano-usdm.ts.
///
/// Production deployments MUST gate this (e.g. whitelisted minter signatories
/// or a one-shot policy parameterized by a seed UTxO).

use cardano/transaction.{Transaction}

validator usdm {
  mint(_redeemer: Data, _policy_id: ByteArray, _self: Transaction) {
    True
  }

  else(_) {
    fail
  }
}
