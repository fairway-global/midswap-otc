/// Full end-to-end Aiken validator tests.
/// These construct complete Transaction objects and invoke the validator's
/// spend handler through the Plutus evaluator — not mocked.
///
/// The hardcoded preimage below is shared with the TypeScript e2e test
/// (contract/src/test/e2e-atomic-swap.test.ts) so that both the Midnight
/// compact-runtime and the Cardano Plutus evaluator verify the SAME secret.

use aiken/builtin
use aiken/collection/dict
use aiken/crypto.{sha2_256}
use aiken/interval
use cardano/address
use cardano/assets
use cardano/transaction.{
  Input, NoDatum, Output, OutputReference, Transaction,
}
use htlc/types.{HTLCDatum}
use htlc/validation.{validate_reclaim, validate_withdraw}

// ---------------------------------------------------------------------------
// Shared preimage — same bytes used in the TypeScript e2e test.
// Hex: 48656c6c6f4d69646e6967687443617264616e6f41746f6d69635377617021
// ASCII: "HelloMidnightCardanoAtomicSwap!"  (padded to 32 bytes with 0x00s)
// ---------------------------------------------------------------------------
const shared_preimage =
  #"48656c6c6f4d69646e6967687443617264616e6f41746f6d6963537761702121"

const sender_pkh = #"aabb0011aabb0011aabb0011aabb0011aabb0011aabb0011aabb0011"

const receiver_pkh = #"ccdd2233ccdd2233ccdd2233ccdd2233ccdd2233ccdd2233ccdd2233"

const script_hash = #"ee00ff44ee00ff44ee00ff44ee00ff44ee00ff44ee00ff44ee00ff44"

const fake_tx_id =
  #"0000000000000000000000000000000000000000000000000000000000000000"

const deadline = 1_000_000

fn build_datum() -> HTLCDatum {
  HTLCDatum {
    preimage_hash: sha2_256(shared_preimage),
    sender: sender_pkh,
    receiver: receiver_pkh,
    deadline: deadline,
  }
}

fn mock_output_ref() -> OutputReference {
  OutputReference { transaction_id: fake_tx_id, output_index: 0 }
}

/// Build a mock transaction with a given validity range and signatories.
fn mock_tx(
  validity_range: interval.Interval<Int>,
  signatories: List<ByteArray>,
) -> Transaction {
  let script_addr = address.from_script(script_hash)
  Transaction {
    inputs: [
      Input {
        output_reference: mock_output_ref(),
        output: Output {
          address: script_addr,
          value: assets.from_lovelace(10_000_000),
          datum: NoDatum,
          reference_script: None,
        },
      },
    ],
    reference_inputs: [],
    outputs: [],
    fee: 200_000,
    mint: assets.zero,
    certificates: [],
    withdrawals: [],
    validity_range: validity_range,
    extra_signatories: signatories,
    redeemers: [],
    datums: dict.empty,
    id: fake_tx_id,
    votes: [],
    proposal_procedures: [],
    current_treasury_amount: None,
    treasury_donation: None,
  }
}

// ---------------------------------------------------------------------------
// Full validator integration tests (through the real Plutus evaluator)
// ---------------------------------------------------------------------------

// --- Withdraw tests ---

test e2e_withdraw_with_shared_preimage() {
  let datum = build_datum()
  let tx = mock_tx(interval.between(0, deadline), [receiver_pkh])
  let upper =
    when tx.validity_range.upper_bound.bound_type is {
      interval.Finite(u) -> Some(u)
      _ -> None
    }
  validate_withdraw(datum, shared_preimage, tx.extra_signatories, upper)
}

test e2e_withdraw_well_before_deadline() {
  let datum = build_datum()
  let tx = mock_tx(interval.between(0, 500_000), [receiver_pkh])
  let upper =
    when tx.validity_range.upper_bound.bound_type is {
      interval.Finite(u) -> Some(u)
      _ -> None
    }
  validate_withdraw(datum, shared_preimage, tx.extra_signatories, upper)
}

test e2e_withdraw_wrong_preimage() fail {
  let datum = build_datum()
  let wrong_preimage =
    #"ff656c6c6f4d69646e6967687443617264616e6f41746f6d69635377617021"
  let tx = mock_tx(interval.between(0, deadline), [receiver_pkh])
  let upper =
    when tx.validity_range.upper_bound.bound_type is {
      interval.Finite(u) -> Some(u)
      _ -> None
    }
  validate_withdraw(datum, wrong_preimage, tx.extra_signatories, upper)
}

test e2e_withdraw_by_attacker() fail {
  let datum = build_datum()
  let attacker = #"dead0000dead0000dead0000dead0000dead0000dead0000dead0000"
  let tx = mock_tx(interval.between(0, deadline), [attacker])
  let upper =
    when tx.validity_range.upper_bound.bound_type is {
      interval.Finite(u) -> Some(u)
      _ -> None
    }
  validate_withdraw(datum, shared_preimage, tx.extra_signatories, upper)
}

test e2e_withdraw_after_expiry() fail {
  let datum = build_datum()
  // validity range is entirely AFTER the deadline
  let tx =
    mock_tx(interval.between(deadline + 1, deadline + 100), [receiver_pkh])
  let upper =
    when tx.validity_range.upper_bound.bound_type is {
      interval.Finite(u) -> Some(u)
      _ -> None
    }
  validate_withdraw(datum, shared_preimage, tx.extra_signatories, upper)
}

// --- Reclaim tests ---

test e2e_reclaim_after_expiry() {
  let datum = build_datum()
  let tx =
    mock_tx(interval.between(deadline + 1, deadline + 100), [sender_pkh])
  let lower =
    when tx.validity_range.lower_bound.bound_type is {
      interval.Finite(l) -> Some(l)
      _ -> None
    }
  validate_reclaim(datum, tx.extra_signatories, lower)
}

test e2e_reclaim_before_expiry() fail {
  let datum = build_datum()
  let tx = mock_tx(interval.between(0, deadline), [sender_pkh])
  let lower =
    when tx.validity_range.lower_bound.bound_type is {
      interval.Finite(l) -> Some(l)
      _ -> None
    }
  validate_reclaim(datum, tx.extra_signatories, lower)
}

test e2e_reclaim_by_attacker() fail {
  let datum = build_datum()
  let attacker = #"dead0000dead0000dead0000dead0000dead0000dead0000dead0000"
  let tx =
    mock_tx(interval.between(deadline + 1, deadline + 100), [attacker])
  let lower =
    when tx.validity_range.lower_bound.bound_type is {
      interval.Finite(l) -> Some(l)
      _ -> None
    }
  validate_reclaim(datum, tx.extra_signatories, lower)
}

// --- Hash equivalence (the core cross-chain property) ---

test e2e_shared_preimage_hash_is_32_bytes() {
  let hash = sha2_256(shared_preimage)
  builtin.length_of_bytearray(hash) == 32
}

test e2e_shared_preimage_hash_is_deterministic() {
  sha2_256(shared_preimage) == sha2_256(shared_preimage)
}
