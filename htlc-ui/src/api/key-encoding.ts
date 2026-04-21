/**
 * bech32m ⇄ raw Bytes<32> helpers.
 *
 * Landmine #1 (see CLAUDE.md "Known Incidents & Fixes"): Lace / dapp-connector-api
 * returns shielded coin public keys and unshielded addresses as bech32m strings,
 * but the HTLC contract's `receiverAuth: Bytes<32>` and payout bytes fields need
 * raw 32-byte arrays. Passing the bech32m string directly causes Alice's
 * `withdrawWithPreimage` to fail the `Only designated receiver` assertion because
 * `ownPublicKey().bytes` inside the circuit is the raw 32-byte Zswap coin key,
 * never the bech32m envelope.
 *
 * We use `@midnight-ntwrk/wallet-sdk-address-format` to strip the envelope.
 */

import { MidnightBech32m, ShieldedCoinPublicKey, UnshieldedAddress } from '@midnight-ntwrk/wallet-sdk-address-format';
import type { NetworkId } from '@midnight-ntwrk/midnight-js-network-id';

export const decodeShieldedCoinPublicKey = (bech32: string, networkId: NetworkId): Uint8Array => {
  const parsed = MidnightBech32m.parse(bech32);
  const decoded = ShieldedCoinPublicKey.codec.decode(networkId, parsed);
  const bytes = new Uint8Array(decoded.data);
  if (bytes.length !== 32) {
    throw new Error(`ShieldedCoinPublicKey must be 32 bytes, got ${bytes.length}`);
  }
  return bytes;
};

export const decodeUnshieldedAddress = (bech32: string, networkId: NetworkId): Uint8Array => {
  const parsed = MidnightBech32m.parse(bech32);
  const decoded = UnshieldedAddress.codec.decode(networkId, parsed);
  const bytes = new Uint8Array(decoded.data);
  if (bytes.length !== 32) {
    throw new Error(`UnshieldedAddress must be 32 bytes, got ${bytes.length}`);
  }
  return bytes;
};

export const bytesToHex = (bytes: Uint8Array): string =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

export const hexToBytes = (hex: string): Uint8Array => {
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
  if (clean.length % 2 !== 0) throw new Error('hex string must have even length');
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
};

/**
 * Either<ContractAddress, UserAddress> helper — right-side (user) payout.
 * Mirrors `htlc-ft-cli/src/bob-swap.ts:68` `userEither`.
 */
export const userEither = (addrBytes: Uint8Array) => ({
  is_left: false,
  left: { bytes: new Uint8Array(32) },
  right: { bytes: addrBytes },
});
