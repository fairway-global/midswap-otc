// Full cross-chain end-to-end test: Midnight (compact-runtime) + Cardano (Plutus CEK machine)
//
// NOTHING is mocked:
//   - Midnight HTLC: executed through the compiled Compact contract via compact-runtime WASM
//   - Cardano HTLC:  executed through the compiled Aiken UPLC via @harmoniclabs/plutus-machine
//
// Both sides share the same 32-byte preimage and verify SHA-256(preimage) == stored hash.

import { HTLCFTSimulator } from "./htlc-ft-simulator.js";
import { PlutusHTLCEvaluator } from "./plutus-htlc-evaluator.js";
import {
  persistentHash,
  Bytes32Descriptor,
} from "@midnight-ntwrk/compact-runtime";
import { createHash } from "node:crypto";
import { describe, it, expect, beforeAll } from "vitest";
import { randomBytes } from "./utils.js";

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function sha256(data: Uint8Array): Uint8Array {
  return new Uint8Array(createHash("sha256").update(data).digest());
}

// Shared 32-byte preimage: "HelloMidnightCardanoAtomicSwap!!"
const SHARED_PREIMAGE = new Uint8Array(
  Buffer.from(
    "48656c6c6f4d69646e6967687443617264616e6f41746f6d6963537761702121",
    "hex",
  ),
);

const NOW = Math.floor(Date.now() / 1000);
const ONE_HOUR = 3600;

// Cardano uses milliseconds for POSIX time
const NOW_MS = BigInt(NOW) * 1000n;
const ONE_HOUR_MS = BigInt(ONE_HOUR) * 1000n;

const SENDER_PKH = new Uint8Array(
  Buffer.from("aabb0011aabb0011aabb0011aabb0011aabb0011aabb0011aabb0011", "hex"),
);
const RECEIVER_PKH = new Uint8Array(
  Buffer.from("ccdd2233ccdd2233ccdd2233ccdd2233ccdd2233ccdd2233ccdd2233", "hex"),
);

function createMidnight(coinPublicKey: string): HTLCFTSimulator {
  return new HTLCFTSimulator(coinPublicKey, "SwapToken", "SWAP", 6n, NOW);
}

describe("Full cross-chain e2e: Midnight compact-runtime + Cardano Plutus CEK machine", () => {
  let plutus: PlutusHTLCEvaluator;

  beforeAll(() => {
    plutus = new PlutusHTLCEvaluator();
  });

  // ─────────────────────────────────────────────────────────────────────
  // Foundation: prove the hash functions are identical
  // ─────────────────────────────────────────────────────────────────────

  it("proves persistentHash(Bytes<32>) === SHA-256 for the shared preimage", () => {
    expect(SHARED_PREIMAGE.length).toBe(32);
    const midnightHash = persistentHash(Bytes32Descriptor, SHARED_PREIMAGE);
    const cardanoHash = sha256(SHARED_PREIMAGE);
    expect(midnightHash).toEqual(cardanoHash);
  });

  // ─────────────────────────────────────────────────────────────────────
  // Cardano validator: real Plutus CEK machine evaluation
  // ─────────────────────────────────────────────────────────────────────

  it("Plutus CEK: accepts withdraw with correct preimage", () => {
    const hash = sha256(SHARED_PREIMAGE);
    const result = plutus.evaluateWithdraw(
      SHARED_PREIMAGE,
      hash,
      SENDER_PKH,
      RECEIVER_PKH,
      NOW_MS + ONE_HOUR_MS,
      [RECEIVER_PKH],
      0n,
      NOW_MS,
    );
    expect(result.accepted).toBe(true);
    expect(result.cpuSteps).toBeGreaterThan(0n);
  });

  it("Plutus CEK: rejects withdraw with wrong preimage", () => {
    const hash = sha256(SHARED_PREIMAGE);
    const wrongPreimage = randomBytes(32);
    const result = plutus.evaluateWithdraw(
      wrongPreimage,
      hash,
      SENDER_PKH,
      RECEIVER_PKH,
      NOW_MS + ONE_HOUR_MS,
      [RECEIVER_PKH],
      0n,
      NOW_MS,
    );
    expect(result.accepted).toBe(false);
  });

  it("Plutus CEK: rejects withdraw by non-receiver", () => {
    const hash = sha256(SHARED_PREIMAGE);
    const attacker = randomBytes(28);
    const result = plutus.evaluateWithdraw(
      SHARED_PREIMAGE,
      hash,
      SENDER_PKH,
      RECEIVER_PKH,
      NOW_MS + ONE_HOUR_MS,
      [attacker],
      0n,
      NOW_MS,
    );
    expect(result.accepted).toBe(false);
  });

  it("Plutus CEK: rejects withdraw after deadline", () => {
    const hash = sha256(SHARED_PREIMAGE);
    const deadline = NOW_MS + ONE_HOUR_MS;
    const result = plutus.evaluateWithdraw(
      SHARED_PREIMAGE,
      hash,
      SENDER_PKH,
      RECEIVER_PKH,
      deadline,
      [RECEIVER_PKH],
      0n,
      deadline + 1000n,
    );
    expect(result.accepted).toBe(false);
  });

  it("Plutus CEK: accepts reclaim after deadline", () => {
    const hash = sha256(SHARED_PREIMAGE);
    const deadline = NOW_MS + ONE_HOUR_MS;
    const result = plutus.evaluateReclaim(
      hash,
      SENDER_PKH,
      RECEIVER_PKH,
      deadline,
      [SENDER_PKH],
      deadline + 1000n,
      null,
    );
    expect(result.accepted).toBe(true);
  });

  it("Plutus CEK: rejects reclaim before deadline", () => {
    const hash = sha256(SHARED_PREIMAGE);
    const deadline = NOW_MS + ONE_HOUR_MS;
    const result = plutus.evaluateReclaim(
      hash,
      SENDER_PKH,
      RECEIVER_PKH,
      deadline,
      [SENDER_PKH],
      NOW_MS,
      null,
    );
    expect(result.accepted).toBe(false);
  });

  // ─────────────────────────────────────────────────────────────────────
  // Full atomic swap: BOTH real runtimes, one shared preimage
  // ─────────────────────────────────────────────────────────────────────

  it("completes full atomic swap through BOTH real runtimes", () => {
    const hashLock = sha256(SHARED_PREIMAGE);

    // ──── MIDNIGHT: real compact-runtime (WASM ZK circuit execution) ────

    const aliceMidnightKey = toHex(randomBytes(32));
    const bobMidnightKey = toHex(randomBytes(32));

    const midnight = createMidnight(aliceMidnightKey);
    midnight.switchUser(bobMidnightKey);
    const bobMidnightAddr = midnight.myAddr();
    midnight.switchUser(aliceMidnightKey);

    // Alice mints FungibleTokens & deposits on Midnight (initiator, 2hr timeout)
    const aliceAddr = midnight.callerAddress();
    midnight.mint(aliceAddr, 1000n);
    midnight.deposit(1000n, hashLock, BigInt(NOW + ONE_HOUR * 2), bobMidnightAddr);

    expect(midnight.isSwapActive(hashLock)).toBe(true);
    expect(midnight.getSwapAmount(hashLock)).toBe(1000n);

    // ──── CARDANO: real Plutus CEK machine (compiled UPLC execution) ────

    const cardanoDeadline = NOW_MS + ONE_HOUR_MS;

    // Verify Bob's deposit is valid (validator would accept reclaim later)
    const depositCheck = plutus.evaluateReclaim(
      hashLock,
      SENDER_PKH,
      RECEIVER_PKH,
      cardanoDeadline,
      [SENDER_PKH],
      cardanoDeadline + 1000n,
      null,
    );
    expect(depositCheck.accepted).toBe(true);

    // ──── SWAP EXECUTION ────

    // Step 1: Alice claims on Cardano by revealing the preimage
    const aliceClaim = plutus.evaluateWithdraw(
      SHARED_PREIMAGE,
      hashLock,
      SENDER_PKH,
      RECEIVER_PKH,
      cardanoDeadline,
      [RECEIVER_PKH],
      0n,
      NOW_MS + ONE_HOUR_MS / 2n,
    );
    expect(aliceClaim.accepted).toBe(true);

    // Step 2: Bob observes the preimage on Cardano, claims on Midnight
    midnight.switchUser(bobMidnightKey);
    midnight.withdraw(SHARED_PREIMAGE);

    expect(midnight.isSwapActive(hashLock)).toBe(false);
    expect(midnight.getSwapAmount(hashLock)).toBe(0n);

    // ──── BOTH RUNTIMES VERIFIED THE SAME PREIMAGE ────
    // Midnight: persistentHash(preimage) == stored hash  (compact-runtime WASM)
    // Cardano:  sha2_256(preimage) == stored hash        (Plutus CEK machine)
  });

  it("refund path: both sides reclaim through their real runtimes", () => {
    const hashLock = sha256(SHARED_PREIMAGE);

    // ──── MIDNIGHT: deposit ────
    const aliceMidnightKey = toHex(randomBytes(32));
    const bobMidnightKey = toHex(randomBytes(32));

    const midnight = createMidnight(aliceMidnightKey);
    midnight.switchUser(bobMidnightKey);
    const bobMidnightAddr = midnight.myAddr();
    midnight.switchUser(aliceMidnightKey);

    const aliceAddr = midnight.callerAddress();
    midnight.mint(aliceAddr, 1000n);
    midnight.deposit(1000n, hashLock, BigInt(NOW + ONE_HOUR * 2), bobMidnightAddr);

    // ──── NOBODY CLAIMS — TIME PASSES ────

    // Cardano deadline expires first (1hr). Bob reclaims via Plutus CEK.
    const cardanoDeadline = NOW_MS + ONE_HOUR_MS;
    const bobReclaim = plutus.evaluateReclaim(
      hashLock,
      SENDER_PKH,
      RECEIVER_PKH,
      cardanoDeadline,
      [SENDER_PKH],
      cardanoDeadline + 1000n,
      null,
    );
    expect(bobReclaim.accepted).toBe(true);

    // Midnight deadline expires later (2hr). Alice reclaims via compact-runtime.
    midnight.setBlockTime(NOW + ONE_HOUR * 2 + 1);
    midnight.switchUser(aliceMidnightKey);
    midnight.reclaim(hashLock);
    expect(midnight.isSwapActive(hashLock)).toBe(false);
  });

  it("attack prevention: wrong preimage rejected by BOTH real runtimes", () => {
    const hashLock = sha256(SHARED_PREIMAGE);
    const wrongPreimage = randomBytes(32);

    // ──── Cardano rejects (Plutus CEK machine) ────
    const cardanoResult = plutus.evaluateWithdraw(
      wrongPreimage,
      hashLock,
      SENDER_PKH,
      RECEIVER_PKH,
      NOW_MS + ONE_HOUR_MS,
      [RECEIVER_PKH],
      0n,
      NOW_MS,
    );
    expect(cardanoResult.accepted).toBe(false);

    // ──── Midnight rejects (compact-runtime WASM) ────
    const aliceKey = toHex(randomBytes(32));
    const bobKey = toHex(randomBytes(32));

    const midnight = createMidnight(aliceKey);
    midnight.switchUser(bobKey);
    const bobAddr = midnight.myAddr();
    midnight.switchUser(aliceKey);

    const aliceAddr = midnight.callerAddress();
    midnight.mint(aliceAddr, 1000n);
    midnight.deposit(1000n, hashLock, BigInt(NOW + ONE_HOUR), bobAddr);

    // Wrong preimage → wrong hash → no matching swap in the Map
    midnight.switchUser(bobKey);
    expect(() => midnight.withdraw(wrongPreimage)).toThrow(
      "No active HTLC",
    );
  });
});
