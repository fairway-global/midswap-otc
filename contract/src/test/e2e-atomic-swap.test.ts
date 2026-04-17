// End-to-end cross-chain atomic swap test: Midnight <-> Cardano
//
// Key insight: Midnight's persistentHash(Bytes<32>, preimage) produces
// identical output to SHA-256(preimage). Both chains verify the SAME hash
// for the SAME preimage, enabling trustless cross-chain atomic swaps.

import { HTLCSimulator } from "./htlc-simulator.js";
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

describe("Cross-chain atomic swap: Midnight <-> Cardano", () => {
  it("proves persistentHash(Bytes<32>) and SHA-256 produce identical output", () => {
    // This is the foundational property that makes the cross-chain swap work.
    // Midnight's persistentHash on Bytes<32> IS SHA-256.
    for (let i = 0; i < 10; i++) {
      const preimage = randomBytes(32);
      const midnightHash = persistentHash(Bytes32Descriptor, preimage);
      const cardanoHash = sha256(preimage);

      expect(midnightHash).toEqual(cardanoHash);
      expect(midnightHash.length).toBe(32);
    }
  });

  it("completes a full atomic swap: Alice (Midnight tokens) <-> Bob (Cardano tokens)", () => {
    // === SETUP ===
    // Alice holds tokens on Midnight, wants Bob's tokens on Cardano.
    // Bob holds tokens on Cardano, wants Alice's tokens on Midnight.
    const aliceMidnightKey = toHex(randomBytes(32));
    const bobMidnightKey = toHex(randomBytes(32));
    const aliceCardano = "alice_cardano_pkh";
    const bobCardano = "bob_cardano_pkh";

    // Alice generates a secret preimage
    const preimage = randomBytes(32);
    // Same hash on both chains (persistentHash == SHA-256)
    const hashLock = sha256(preimage);

    // Initialize Midnight simulator (Alice is sender)
    const midnight = new HTLCSimulator(aliceMidnightKey, NOW);
    midnight.switchUser(bobMidnightKey);
    const bobMidnightAddr = midnight.myAddr();
    midnight.switchUser(aliceMidnightKey);

    // Initialize Cardano simulator (Bob is sender)
    const cardano = new CardanoHTLCSimulator(bobCardano, NOW);

    // === STEP 1: Mint tokens on both chains ===

    // Alice mints 1000 tokens on Midnight
    const aliceCoin = midnight.mintQualifiedCoin(
      randomBytes(32),
      1000n,
      randomBytes(32),
    );

    // Bob mints 500 SWAP tokens on Cardano
    cardano.mintToken("SWAP", 500n);

    // === STEP 2: Alice deposits on Midnight (initiator, longer timeout) ===
    const midnightExpiry = BigInt(NOW + ONE_HOUR * 2);
    midnight.deposit(aliceCoin, hashLock, midnightExpiry, bobMidnightAddr);

    const midnightState = midnight.getLedger();
    expect(midnightState.htlcActive).toBe(true);
    expect(midnightState.htlcHash).toEqual(hashLock);

    const lockedCoinMtIndex =
      midnight.circuitContext.currentZswapLocalState.currentIndex - 1n;

    // === STEP 3: Bob verifies Midnight deposit, then deposits on Cardano ===
    // (shorter timeout — critical for atomic swap safety)
    const cardanoDeadline = NOW + ONE_HOUR;
    cardano.deposit(hashLock, aliceCardano, 500n, "SWAP", cardanoDeadline);

    expect(cardano.getHTLC().active).toBe(true);
    expect(cardano.getHTLC().amount).toBe(500n);

    // === STEP 4: Alice claims on Cardano by revealing the preimage ===
    // This is where the preimage becomes public on-chain.
    cardano.switchUser(aliceCardano);
    cardano.withdraw(preimage);

    expect(cardano.getHTLC().active).toBe(false);
    expect(cardano.getBalance(aliceCardano, "SWAP")).toBe(500n);

    // === STEP 5: Bob observes the preimage from Cardano, claims on Midnight ===
    midnight.switchUser(bobMidnightKey);
    midnight.withdraw(preimage, lockedCoinMtIndex);

    const finalState = midnight.getLedger();
    expect(finalState.htlcActive).toBe(false);
    expect(finalState.htlcCoinValue).toBe(0n);
  });

  it("allows both parties to reclaim if nobody claims (timeout path)", () => {
    const aliceMidnightKey = toHex(randomBytes(32));
    const bobMidnightKey = toHex(randomBytes(32));
    const aliceCardano = "alice_cardano_pkh";
    const bobCardano = "bob_cardano_pkh";

    const preimage = randomBytes(32);
    const hashLock = sha256(preimage);

    // Setup
    const midnight = new HTLCSimulator(aliceMidnightKey, NOW);
    midnight.switchUser(bobMidnightKey);
    const bobMidnightAddr = midnight.myAddr();
    midnight.switchUser(aliceMidnightKey);

    const cardano = new CardanoHTLCSimulator(bobCardano, NOW);

    // Mint and deposit on both chains
    const coin = midnight.mintQualifiedCoin(
      randomBytes(32),
      1000n,
      randomBytes(32),
    );
    cardano.mintToken("SWAP", 500n);

    midnight.deposit(
      coin,
      hashLock,
      BigInt(NOW + ONE_HOUR * 2),
      bobMidnightAddr,
    );
    const lockedMtIndex =
      midnight.circuitContext.currentZswapLocalState.currentIndex - 1n;

    cardano.deposit(hashLock, aliceCardano, 500n, "SWAP", NOW + ONE_HOUR);

    // --- Nobody claims. Time passes. ---

    // Cardano HTLC expires first (shorter deadline).
    // Bob reclaims his Cardano tokens.
    cardano.setTime(NOW + ONE_HOUR + 1);
    cardano.switchUser(bobCardano);
    cardano.reclaim();

    expect(cardano.getHTLC().active).toBe(false);
    expect(cardano.getBalance(bobCardano, "SWAP")).toBe(500n);

    // Midnight HTLC expires later.
    // Alice reclaims her Midnight tokens.
    midnight.setBlockTime(NOW + ONE_HOUR * 2 + 1);
    midnight.switchUser(aliceMidnightKey);
    midnight.reclaim(lockedMtIndex);

    expect(midnight.getLedger().htlcActive).toBe(false);
  });

  it("prevents Bob from claiming on Midnight without the preimage", () => {
    const aliceMidnightKey = toHex(randomBytes(32));
    const bobMidnightKey = toHex(randomBytes(32));

    const preimage = randomBytes(32);
    const hashLock = sha256(preimage);

    const midnight = new HTLCSimulator(aliceMidnightKey, NOW);
    midnight.switchUser(bobMidnightKey);
    const bobAddr = midnight.myAddr();
    midnight.switchUser(aliceMidnightKey);

    const coin = midnight.mintQualifiedCoin(
      randomBytes(32),
      1000n,
      randomBytes(32),
    );
    midnight.deposit(coin, hashLock, BigInt(NOW + ONE_HOUR), bobAddr);
    const mtIndex =
      midnight.circuitContext.currentZswapLocalState.currentIndex - 1n;

    // Bob tries to claim with a wrong preimage
    midnight.switchUser(bobMidnightKey);
    expect(() => midnight.withdraw(randomBytes(32), mtIndex)).toThrow(
      "Invalid preimage",
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

    // Alice tries with wrong preimage
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
    const midnight = new HTLCSimulator(aliceMidnightKey, NOW);
    midnight.switchUser(bobMidnightKey);
    const bobAddr = midnight.myAddr();
    midnight.switchUser(aliceMidnightKey);

    const coin = midnight.mintQualifiedCoin(
      randomBytes(32),
      1000n,
      randomBytes(32),
    );
    midnight.deposit(coin, hashLock, BigInt(NOW + ONE_HOUR), bobAddr);
    const mtIndex =
      midnight.circuitContext.currentZswapLocalState.currentIndex - 1n;

    // Attacker tries on Midnight (even with correct preimage)
    midnight.switchUser(attackerMidnightKey);
    expect(() => midnight.withdraw(preimage, mtIndex)).toThrow(
      "Only designated receiver can withdraw",
    );

    // Cardano side
    const cardano = new CardanoHTLCSimulator(bobCardano, NOW);
    cardano.mintToken("SWAP", 500n);
    cardano.deposit(hashLock, aliceCardano, 500n, "SWAP", NOW + ONE_HOUR);

    // Attacker tries on Cardano
    cardano.switchUser(attackerCardano);
    expect(() => cardano.withdraw(preimage)).toThrow(
      "Only receiver can withdraw",
    );
  });

  it("enforces correct timeout ordering (Cardano shorter, Midnight longer)", () => {
    // Critical safety property: the responder's (Cardano) deadline MUST be
    // shorter than the initiator's (Midnight). If Alice claims on Cardano
    // at the last second, Bob still has time to claim on Midnight.
    const aliceMidnightKey = toHex(randomBytes(32));
    const bobMidnightKey = toHex(randomBytes(32));
    const aliceCardano = "alice_cardano_pkh";
    const bobCardano = "bob_cardano_pkh";

    const preimage = randomBytes(32);
    const hashLock = sha256(preimage);

    const midnight = new HTLCSimulator(aliceMidnightKey, NOW);
    midnight.switchUser(bobMidnightKey);
    const bobAddr = midnight.myAddr();
    midnight.switchUser(aliceMidnightKey);

    const cardano = new CardanoHTLCSimulator(bobCardano, NOW);

    const coin = midnight.mintQualifiedCoin(
      randomBytes(32),
      1000n,
      randomBytes(32),
    );
    cardano.mintToken("SWAP", 500n);

    // Midnight: 2-hour expiry. Cardano: 1-hour expiry.
    midnight.deposit(
      coin,
      hashLock,
      BigInt(NOW + ONE_HOUR * 2),
      bobAddr,
    );
    const mtIndex =
      midnight.circuitContext.currentZswapLocalState.currentIndex - 1n;

    cardano.deposit(hashLock, aliceCardano, 500n, "SWAP", NOW + ONE_HOUR);

    // Alice claims on Cardano right at the deadline boundary
    cardano.setTime(NOW + ONE_HOUR);
    cardano.switchUser(aliceCardano);
    cardano.withdraw(preimage);

    // Bob still has a full hour to claim on Midnight
    midnight.setBlockTime(NOW + ONE_HOUR);
    midnight.switchUser(bobMidnightKey);
    midnight.withdraw(preimage, mtIndex);

    expect(midnight.getLedger().htlcActive).toBe(false);
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

    // Time passes beyond deadline
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

    // Bob tries to reclaim before deadline
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

    const midnight = new HTLCSimulator(aliceMidnightKey, NOW);
    midnight.switchUser(bobMidnightKey);
    const bobAddr = midnight.myAddr();
    midnight.switchUser(aliceMidnightKey);

    const cardano = new CardanoHTLCSimulator(bobCardano, NOW);

    const coin1 = midnight.mintQualifiedCoin(
      randomBytes(32),
      500n,
      randomBytes(32),
    );
    cardano.mintToken("SWAP", 300n);

    midnight.deposit(coin1, hash1, BigInt(NOW + ONE_HOUR * 2), bobAddr);
    const mt1 =
      midnight.circuitContext.currentZswapLocalState.currentIndex - 1n;
    cardano.deposit(hash1, aliceCardano, 300n, "SWAP", NOW + ONE_HOUR);

    cardano.switchUser(aliceCardano);
    cardano.withdraw(preimage1);
    midnight.switchUser(bobMidnightKey);
    midnight.withdraw(preimage1, mt1);

    expect(midnight.getLedger().htlcActive).toBe(false);
    expect(cardano.getHTLC().active).toBe(false);

    // --- Round 2: new preimage, new deposit ---
    const preimage2 = randomBytes(32);
    const hash2 = sha256(preimage2);

    midnight.switchUser(aliceMidnightKey);
    const coin2 = midnight.mintQualifiedCoin(
      randomBytes(32),
      700n,
      randomBytes(32),
    );
    cardano.switchUser(bobCardano);
    cardano.mintToken("SWAP", 400n);

    midnight.deposit(coin2, hash2, BigInt(NOW + ONE_HOUR * 2), bobAddr);
    const mt2 =
      midnight.circuitContext.currentZswapLocalState.currentIndex - 1n;
    cardano.deposit(hash2, aliceCardano, 400n, "SWAP", NOW + ONE_HOUR);

    cardano.switchUser(aliceCardano);
    cardano.withdraw(preimage2);
    midnight.switchUser(bobMidnightKey);
    midnight.withdraw(preimage2, mt2);

    expect(midnight.getLedger().htlcActive).toBe(false);
    expect(cardano.getBalance(aliceCardano, "SWAP")).toBe(700n);
  });
});
