/// Core HTLC validation logic, extracted for testability.
/// The validator delegates to these functions so that unit tests and
/// property-based tests can run without constructing full Transaction objects.

use aiken/collection/list
use aiken/crypto.{sha2_256}
use aiken/fuzz
use htlc/types.{HTLCDatum}

/// Validate a withdrawal attempt.
/// Returns True iff:
///   1. sha2_256(preimage) == datum.preimage_hash
///   2. The receiver signed the transaction
///   3. The transaction's upper validity bound is at or before the deadline
pub fn validate_withdraw(
  datum: HTLCDatum,
  preimage: ByteArray,
  signatories: List<ByteArray>,
  tx_upper_bound: Option<Int>,
) -> Bool {
  let computed_hash = sha2_256(preimage)
  and {
    computed_hash == datum.preimage_hash,
    list.has(signatories, datum.receiver),
    when tx_upper_bound is {
      Some(upper) -> upper <= datum.deadline
      None -> False
    },
  }
}

/// Validate a reclaim attempt.
/// Returns True iff:
///   1. The sender signed the transaction
///   2. The transaction's lower validity bound is strictly after the deadline
pub fn validate_reclaim(
  datum: HTLCDatum,
  signatories: List<ByteArray>,
  tx_lower_bound: Option<Int>,
) -> Bool {
  and {
    list.has(signatories, datum.sender),
    when tx_lower_bound is {
      Some(lower) -> lower > datum.deadline
      None -> False
    },
  }
}

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

const sender_pkh = #"aabbccdd"

const receiver_pkh = #"11223344"

const sample_preimage =
  #"0102030405060708091011121314151617181920212223242526272829303132"

fn sample_datum() -> HTLCDatum {
  HTLCDatum {
    preimage_hash: sha2_256(sample_preimage),
    sender: sender_pkh,
    receiver: receiver_pkh,
    deadline: 1_000_000,
  }
}

// ---------------------------------------------------------------------------
// Unit tests — withdraw
// ---------------------------------------------------------------------------

test withdraw_correct_preimage() {
  validate_withdraw(sample_datum(), sample_preimage, [receiver_pkh], Some(999_999))
}

test withdraw_at_deadline_boundary() {
  // upper bound exactly at deadline: upper <= deadline → True
  validate_withdraw(
    sample_datum(),
    sample_preimage,
    [receiver_pkh],
    Some(1_000_000),
  )
}

test withdraw_wrong_preimage() fail {
  let wrong =
    #"ff02030405060708091011121314151617181920212223242526272829303132"
  validate_withdraw(sample_datum(), wrong, [receiver_pkh], Some(999_999))
}

test withdraw_by_wrong_party() fail {
  let attacker = #"deadbeef"
  validate_withdraw(
    sample_datum(),
    sample_preimage,
    [attacker],
    Some(999_999),
  )
}

test withdraw_after_deadline() fail {
  // upper bound past the deadline
  validate_withdraw(
    sample_datum(),
    sample_preimage,
    [receiver_pkh],
    Some(1_000_001),
  )
}

test withdraw_without_upper_bound() fail {
  validate_withdraw(sample_datum(), sample_preimage, [receiver_pkh], None)
}

test withdraw_unsigned() fail {
  // correct preimage but no signatories at all
  validate_withdraw(sample_datum(), sample_preimage, [], Some(999_999))
}

// ---------------------------------------------------------------------------
// Unit tests — reclaim
// ---------------------------------------------------------------------------

test reclaim_after_deadline() {
  validate_reclaim(sample_datum(), [sender_pkh], Some(1_000_001))
}

test reclaim_before_deadline() fail {
  validate_reclaim(sample_datum(), [sender_pkh], Some(999_999))
}

test reclaim_at_deadline_boundary() fail {
  // lower bound at exactly deadline: lower > deadline → False
  validate_reclaim(sample_datum(), [sender_pkh], Some(1_000_000))
}

test reclaim_by_wrong_party() fail {
  let attacker = #"deadbeef"
  validate_reclaim(sample_datum(), [attacker], Some(1_000_001))
}

test reclaim_without_lower_bound() fail {
  validate_reclaim(sample_datum(), [sender_pkh], None)
}

test reclaim_unsigned() fail {
  validate_reclaim(sample_datum(), [], Some(1_000_001))
}

// ---------------------------------------------------------------------------
// Property-based (fuzz) tests
// ---------------------------------------------------------------------------

test prop_correct_preimage_always_validates(preimage via fuzz.bytearray()) {
  let datum =
    HTLCDatum {
      preimage_hash: sha2_256(preimage),
      sender: sender_pkh,
      receiver: receiver_pkh,
      deadline: 1_000_000,
    }
  validate_withdraw(datum, preimage, [receiver_pkh], Some(999_999))
}

test prop_wrong_preimage_never_validates(
  pair via fuzz.both(fuzz.bytearray(), fuzz.bytearray()),
) {
  let (preimage, other) = pair
  if preimage == other {
    // Skip — same value isn't "wrong"
    True
  } else {
    let datum =
      HTLCDatum {
        preimage_hash: sha2_256(preimage),
        sender: sender_pkh,
        receiver: receiver_pkh,
        deadline: 1_000_000,
      }
    !validate_withdraw(datum, other, [receiver_pkh], Some(999_999))
  }
}

test prop_reclaim_requires_expiry(time via fuzz.int_between(0, 2_000_000)) {
  let deadline = 1_000_000
  let datum =
    HTLCDatum {
      preimage_hash: #"",
      sender: sender_pkh,
      receiver: receiver_pkh,
      deadline: deadline,
    }
  let result = validate_reclaim(datum, [sender_pkh], Some(time))
  if time > deadline {
    result == True
  } else {
    result == False
  }
}

test prop_withdraw_respects_deadline(time via fuzz.int_between(0, 2_000_000)) {
  let deadline = 1_000_000
  let datum =
    HTLCDatum {
      preimage_hash: sha2_256(sample_preimage),
      sender: sender_pkh,
      receiver: receiver_pkh,
      deadline: deadline,
    }
  let result =
    validate_withdraw(datum, sample_preimage, [receiver_pkh], Some(time))
  if time <= deadline {
    result == True
  } else {
    result == False
  }
}
