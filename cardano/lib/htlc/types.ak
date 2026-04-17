/// Types for the HTLC atomic swap validator.

/// Datum attached to the locked UTxO at the script address.
pub type HTLCDatum {
  /// SHA-256 hash of the secret preimage (32 bytes).
  /// Identical to Midnight's persistentHash(Bytes<32>, preimage).
  preimage_hash: ByteArray,
  /// Verification key hash of the sender who deposited funds
  sender: ByteArray,
  /// Verification key hash of the receiver who can claim with preimage
  receiver: ByteArray,
  /// POSIX deadline in milliseconds — receiver must claim before this
  deadline: Int,
}

/// Redeemer specifying which action to perform on the HTLC.
pub type HTLCRedeemer {
  /// Receiver reveals the preimage to claim the locked funds
  Withdraw { preimage: ByteArray }
  /// Sender reclaims the locked funds after the deadline passes
  Reclaim
}
