// End-to-end cross-chain atomic swap test: Midnight <-> Cardano
//
// Key insight: Midnight's persistentHash(Bytes<32>, preimage) produces
// identical output to SHA-256(preimage). Both chains verify the SAME hash
// for the SAME preimage, enabling trustless cross-chain atomic swaps.

import { HTLCFTSimulator } from "./htlc-ft-simulator.js";
import { CardanoHTLCSimulator } from "./cardano-htlc-simulator.js";
import {
  persistentHash,
  Bytes32Descriptor,
} from "@midnight-ntwrk/compact-runtime";
import { createHash } from "node:crypto";
import { describe, it, expect } from "vitest";
import { randomBytes } from "./utils.js";

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function sha256(data: Uint8Array): Uint8Array {
  return new Uint8Array(createHash("sha256").update(data).digest());
}

const NOW = Math.floor(Date.now() / 1000);
const ONE_HOUR = 3600;

function createMidnight(coinPublicKey: string): HTLCFTSimulator {
  return new HTLCFTSimulator(coinPublicKey, "SwapToken", "SWAP", 6n, NOW);
}

describe("Cross-chain atomic swap: Midnight <-> Cardano", () => {
  it("proves persistentHash(Bytes<32>) and SHA-256 produce identical output", () => {
    for (let i = 0; i < 10; i++) {
      const preimage = randomBytes(32);
      const midnightHash = persistentHash(Bytes32Descriptor, preimage);
      const cardanoHash = sha256(preimage);

      expect(midnightHash).toEqual(cardanoHash);
      expect(midnightHash.length).toBe(32);
    }
  });

  it("completes a full atomic swap: Alice (Midnight tokens) <-> Bob (Cardano tokens)", () => {
    const aliceMidnightKey = toHex(randomBytes(32));
    const bobMidnightKey = toHex(randomBytes(32));
    const aliceCardano = "alice_cardano_pkh";
    const bobCardano = "bob_cardano_pkh";

    const preimage = randomBytes(32);
    const hashLock = sha256(preimage);

    // Initialize Midnight (FungibleToken HTLC)
    const midnight = createMidnight(aliceMidnightKey);
    midnight.switchUser(bobMidnightKey);
    const bobMidnightAddr = midnight.myAddr();
    midnight.switchUser(aliceMidnightKey);

    // Initialize Cardano simulator
    const cardano = new CardanoHTLCSimulator(bobCardano, NOW);

    // === Mint tokens on both chains ===
    const aliceAddr = midnight.callerAddress();
    midnight.mint(aliceAddr, 1000n);
    cardano.mintToken("SWAP", 500n);

    // === Alice deposits on Midnight (initiator, longer timeout) ===
    const midnightExpiry = BigInt(NOW + ONE_HOUR * 2);
    midnight.deposit(1000n, hashLock, midnightExpiry, bobMidnightAddr);

    expect(midnight.isSwapActive(hashLock)).toBe(true);
    expect(midnight.getSwapAmount(hashLock)).toBe(1000n);

    // === Bob verifies Midnight deposit, then deposits on Cardano ===
    const cardanoDeadline = NOW + ONE_HOUR;
    cardano.deposit(hashLock, aliceCardano, 500n, "SWAP", cardanoDeadline);

    expect(cardano.getHTLC().active).toBe(true);
    expect(cardano.getHTLC().amount).toBe(500n);

    // === Alice claims on Cardano by revealing the preimage ===
    cardano.switchUser(aliceCardano);
    cardano.withdraw(preimage);

    expect(cardano.getHTLC().active).toBe(false);
    expect(cardano.getBalance(aliceCardano, "SWAP")).toBe(500n);

    // === Bob observes the preimage from Cardano, claims on Midnight ===
    midnight.switchUser(bobMidnightKey);
    midnight.withdraw(preimage);

    expect(midnight.isSwapActive(hashLock)).toBe(false);
    expect(midnight.getSwapAmount(hashLock)).toBe(0n);
  });

  it("allows both parties to reclaim if nobody claims (timeout path)", () => {
    const aliceMidnightKey = toHex(randomBytes(32));
    const bobMidnightKey = toHex(randomBytes(32));
    const aliceCardano = "alice_cardano_pkh";
    const bobCardano = "bob_cardano_pkh";

    const preimage = randomBytes(32);
    const hashLock = sha256(preimage);

    const midnight = createMidnight(aliceMidnightKey);
    midnight.switchUser(bobMidnightKey);
    const bobMidnightAddr = midnight.myAddr();
    midnight.switchUser(aliceMidnightKey);

    const cardano = new CardanoHTLCSimulator(bobCardano, NOW);

    // Mint and deposit on both chains
    const aliceAddr = midnight.callerAddress();
    midnight.mint(aliceAddr, 1000n);
    cardano.mintToken("SWAP", 500n);

    midnight.deposit(1000n, hashLock, BigInt(NOW + ONE_HOUR * 2), bobMidnightAddr);
    cardano.deposit(hashLock, aliceCardano, 500n, "SWAP", NOW + ONE_HOUR);

    // --- Nobody claims. Time passes. ---

    // Cardano HTLC expires first (shorter deadline). Bob reclaims.
    cardano.setTime(NOW + ONE_HOUR + 1);
    cardano.switchUser(bobCardano);
    cardano.reclaim();

    expect(cardano.getHTLC().active).toBe(false);
    expect(cardano.getBalance(bobCardano, "SWAP")).toBe(500n);

    // Midnight HTLC expires later. Alice reclaims.
    midnight.setBlockTime(NOW + ONE_HOUR * 2 + 1);
    midnight.switchUser(aliceMidnightKey);
    midnight.reclaim(hashLock);

    expect(midnight.isSwapActive(hashLock)).toBe(false);
  });

  it("prevents Bob from claiming on Midnight without the preimage", () => {
    const aliceMidnightKey = toHex(randomBytes(32));
    const bobMidnightKey = toHex(randomBytes(32));

    const preimage = randomBytes(32);
    const hashLock = sha256(preimage);

    const midnight = createMidnight(aliceMidnightKey);
    midnight.switchUser(bobMidnightKey);
    const bobAddr = midnight.myAddr();
    midnight.switchUser(aliceMidnightKey);

    const aliceAddr = midnight.callerAddress();
    midnight.mint(aliceAddr, 1000n);
    midnight.deposit(1000n, hashLock, BigInt(NOW + ONE_HOUR), bobAddr);

    // Wrong preimage → wrong hash → no matching swap
    midnight.switchUser(bobMidnightKey);
    expect(() => midnight.withdraw(randomBytes(32))).toThrow(
      "No active HTLC",
    );
  });

  it("prevents Alice from claiming on Cardano without the preimage", () => {
    const aliceCardano = "alice_cardano_pkh";
    const bobCardano = "bob_cardano_pkh";

    const preimage = randomBytes(32);
    const hashLock = sha256(preimage);

    const cardano = new CardanoHTLCSimulator(bobCardano, NOW);
    cardano.mintToken("SWAP", 500n);
    cardano.deposit(hashLock, aliceCardano, 500n, "SWAP", NOW + ONE_HOUR);

    cardano.switchUser(aliceCardano);
    expect(() => cardano.withdraw(randomBytes(32))).toThrow("Invalid preimage");
  });

  it("prevents third party from claiming on either chain", () => {
    const aliceMidnightKey = toHex(randomBytes(32));
    const bobMidnightKey = toHex(randomBytes(32));
    const attackerMidnightKey = toHex(randomBytes(32));
    const aliceCardano = "alice_cardano_pkh";
    const bobCardano = "bob_cardano_pkh";
    const attackerCardano = "attacker_cardano_pkh";

    const preimage = randomBytes(32);
    const hashLock = sha256(preimage);

    // Midnight side
    const midnight = createMidnight(aliceMidnightKey);
    midnight.switchUser(bobMidnightKey);
    const bobAddr = midnight.myAddr();
    midnight.switchUser(aliceMidnightKey);

    const aliceAddr = midnight.callerAddress();
    midnight.mint(aliceAddr, 1000n);
    midnight.deposit(1000n, hashLock, BigInt(NOW + ONE_HOUR), bobAddr);

    // Attacker tries on Midnight (even with correct preimage)
    midnight.switchUser(attackerMidnightKey);
    expect(() => midnight.withdraw(preimage)).toThrow(
      "Only designated receiver can withdraw",
    );

    // Cardano side
    const cardano = new CardanoHTLCSimulator(bobCardano, NOW);
    cardano.mintToken("SWAP", 500n);
    cardano.deposit(hashLock, aliceCardano, 500n, "SWAP", NOW + ONE_HOUR);

    cardano.switchUser(attackerCardano);
    expect(() => cardano.withdraw(preimage)).toThrow(
      "Only receiver can withdraw",
    );
  });

  it("enforces correct timeout ordering (Cardano shorter, Midnight longer)", () => {
    const aliceMidnightKey = toHex(randomBytes(32));
    const bobMidnightKey = toHex(randomBytes(32));
    const aliceCardano = "alice_cardano_pkh";
    const bobCardano = "bob_cardano_pkh";

    const preimage = randomBytes(32);
    const hashLock = sha256(preimage);

    const midnight = createMidnight(aliceMidnightKey);
    midnight.switchUser(bobMidnightKey);
    const bobAddr = midnight.myAddr();
    midnight.switchUser(aliceMidnightKey);

    const cardano = new CardanoHTLCSimulator(bobCardano, NOW);

    const aliceAddr = midnight.callerAddress();
    midnight.mint(aliceAddr, 1000n);
    cardano.mintToken("SWAP", 500n);

    // Midnight: 2-hour expiry. Cardano: 1-hour expiry.
    midnight.deposit(1000n, hashLock, BigInt(NOW + ONE_HOUR * 2), bobAddr);
    cardano.deposit(hashLock, aliceCardano, 500n, "SWAP", NOW + ONE_HOUR);

    // Alice claims on Cardano right at the deadline boundary
    cardano.setTime(NOW + ONE_HOUR);
    cardano.switchUser(aliceCardano);
    cardano.withdraw(preimage);

    // Bob still has a full hour to claim on Midnight
    midnight.setBlockTime(NOW + ONE_HOUR);
    midnight.switchUser(bobMidnightKey);
    midnight.withdraw(preimage);

    expect(midnight.isSwapActive(hashLock)).toBe(false);
    expect(cardano.getHTLC().active).toBe(false);
  });

  it("prevents receiver from claiming after expiry on Cardano", () => {
    const aliceCardano = "alice_cardano_pkh";
    const bobCardano = "bob_cardano_pkh";

    const preimage = randomBytes(32);
    const hashLock = sha256(preimage);

    const cardano = new CardanoHTLCSimulator(bobCardano, NOW);
    cardano.mintToken("SWAP", 500n);
    cardano.deposit(hashLock, aliceCardano, 500n, "SWAP", NOW + ONE_HOUR);

    cardano.setTime(NOW + ONE_HOUR + 1);
    cardano.switchUser(aliceCardano);
    expect(() => cardano.withdraw(preimage)).toThrow("HTLC has expired");
  });

  it("prevents sender from reclaiming before expiry on Cardano", () => {
    const aliceCardano = "alice_cardano_pkh";
    const bobCardano = "bob_cardano_pkh";

    const preimage = randomBytes(32);
    const hashLock = sha256(preimage);

    const cardano = new CardanoHTLCSimulator(bobCardano, NOW);
    cardano.mintToken("SWAP", 500n);
    cardano.deposit(hashLock, aliceCardano, 500n, "SWAP", NOW + ONE_HOUR);

    expect(() => cardano.reclaim()).toThrow("HTLC has not expired yet");
  });

  it("supports re-use after a completed swap (new round)", () => {
    const aliceMidnightKey = toHex(randomBytes(32));
    const bobMidnightKey = toHex(randomBytes(32));
    const aliceCardano = "alice_cardano_pkh";
    const bobCardano = "bob_cardano_pkh";

    // --- Round 1 ---
    const preimage1 = randomBytes(32);
    const hash1 = sha256(preimage1);

    const midnight = createMidnight(aliceMidnightKey);
    midnight.switchUser(bobMidnightKey);
    const bobAddr = midnight.myAddr();
    midnight.switchUser(aliceMidnightKey);

    const cardano = new CardanoHTLCSimulator(bobCardano, NOW);

    const aliceAddr = midnight.callerAddress();
    midnight.mint(aliceAddr, 500n);
    cardano.mintToken("SWAP", 300n);

    midnight.deposit(500n, hash1, BigInt(NOW + ONE_HOUR * 2), bobAddr);
    cardano.deposit(hash1, aliceCardano, 300n, "SWAP", NOW + ONE_HOUR);

    cardano.switchUser(aliceCardano);
    cardano.withdraw(preimage1);
    midnight.switchUser(bobMidnightKey);
    midnight.withdraw(preimage1);

    expect(midnight.isSwapActive(hash1)).toBe(false);
    expect(cardano.getHTLC().active).toBe(false);

    // --- Round 2: new preimage, new deposit ---
    const preimage2 = randomBytes(32);
    const hash2 = sha256(preimage2);

    midnight.switchUser(aliceMidnightKey);
    midnight.mint(aliceAddr, 700n);
    cardano.switchUser(bobCardano);
    cardano.mintToken("SWAP", 400n);

    midnight.deposit(700n, hash2, BigInt(NOW + ONE_HOUR * 2), bobAddr);
    cardano.deposit(hash2, aliceCardano, 400n, "SWAP", NOW + ONE_HOUR);

    cardano.switchUser(aliceCardano);
    cardano.withdraw(preimage2);
    midnight.switchUser(bobMidnightKey);
    midnight.withdraw(preimage2);

    expect(midnight.isSwapActive(hash2)).toBe(false);
    expect(cardano.getBalance(aliceCardano, "SWAP")).toBe(700n);
  });
});
