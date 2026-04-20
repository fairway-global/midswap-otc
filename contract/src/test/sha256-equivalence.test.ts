// Proves that Compact's `persistentHash<Bytes<32>>` in the HTLC contract
// produces the same bytes as Node's `createHash('sha256')`. This is the
// load-bearing invariant of the cross-chain atomic swap: Alice hashes the
// preimage in Node, locks funds on Cardano (which uses SHA-256 via Aiken's
// `sha2_256`), and on Midnight (which uses `persistentHash<Bytes<32>>` in
// the HTLC circuit). If these diverge, swaps break silently.

import { describe, it, expect } from 'vitest';
import { createHash, randomBytes } from 'node:crypto';
import { persistentHash, CompactTypeBytes } from '@midnight-ntwrk/compact-runtime';

const Bytes32 = new CompactTypeBytes(32);

function sha256(bytes: Uint8Array): Uint8Array {
  return new Uint8Array(createHash('sha256').update(bytes).digest());
}

function compactHash(bytes: Uint8Array): Uint8Array {
  return persistentHash(Bytes32, bytes);
}

describe('SHA-256 equivalence: Node createHash vs Compact persistentHash<Bytes<32>>', () => {
  it('agrees on the zero preimage', () => {
    const preimage = new Uint8Array(32);
    expect(compactHash(preimage)).toEqual(sha256(preimage));
  });

  it('agrees on the all-ones preimage', () => {
    const preimage = new Uint8Array(32).fill(0xff);
    expect(compactHash(preimage)).toEqual(sha256(preimage));
  });

  it('agrees on a fixed sample used in the swap tests', () => {
    // Same byte pattern as validation.ak's sample_preimage.
    const preimage = new Uint8Array(
      Array.from({ length: 32 }, (_, i) => i + 1),
    );
    const expectedHex =
      'ae216c2ef5247a3782c135efa279a3e4cdc61094270f5d2be58c6204b7a612c9';
    const expected = Uint8Array.from(Buffer.from(expectedHex, 'hex'));
    expect(sha256(preimage)).toEqual(expected);
    expect(compactHash(preimage)).toEqual(expected);
  });

  it('agrees on 32 random preimages (fuzz)', () => {
    for (let i = 0; i < 32; i++) {
      const preimage = new Uint8Array(randomBytes(32));
      expect(compactHash(preimage)).toEqual(sha256(preimage));
    }
  });
});
