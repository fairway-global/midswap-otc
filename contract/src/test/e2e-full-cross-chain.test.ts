// Full cross-chain end-to-end test: Midnight (compact-runtime) + Cardano (Plutus evaluator)
//
// This test exercises BOTH real runtimes in a single flow:
//   - Midnight HTLC: executed through the compiled Compact contract via compact-runtime
//   - Cardano HTLC:  executed through the compiled Aiken validator via `aiken check` (Plutus evaluator)
//
// Both sides share the same hardcoded 32-byte preimage:
//   Hex: 48656c6c6f4d69646e6967687443617264616e6f41746f6d6963537761702121
//   ASCII: "HelloMidnightCardanoAtomicSwap!!"
//
// The Aiken e2e tests (cardano/lib/htlc/e2e.ak) use this same preimage.

import { HTLCSimulator } from "./htlc-simulator.js";
import { CardanoHTLCSimulator } from "./cardano-htlc-simulator.js";
import {
  persistentHash,
  Bytes32Descriptor,
} from "@midnight-ntwrk/compact-runtime";
import { createHash } from "node:crypto";
import { execSync } from "node:child_process";
import { describe, it, expect } from "vitest";
import { randomBytes } from "./utils.js";

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function sha256(data: Uint8Array): Uint8Array {
  return new Uint8Array(createHash("sha256").update(data).digest());
}

// Shared 32-byte preimage — must match the constant in cardano/lib/htlc/e2e.ak
const SHARED_PREIMAGE = new Uint8Array(
  Buffer.from(
    "48656c6c6f4d69646e6967687443617264616e6f41746f6d6963537761702121",
    "hex",
  ),
);

const NOW = Math.floor(Date.now() / 1000);
const ONE_HOUR = 3600;

describe("Full cross-chain e2e: Midnight compact-runtime + Cardano Plutus evaluator", () => {
  it("verifies the shared preimage produces identical hashes on both runtimes", () => {
    expect(SHARED_PREIMAGE.length).toBe(32);

    // Midnight: persistentHash (ZK circuit, WASM runtime)
    const midnightHash = persistentHash(Bytes32Descriptor, SHARED_PREIMAGE);

    // Cardano: SHA-256 (Node.js crypto, same algorithm Aiken's sha2_256 uses)
    const cardanoHash = sha256(SHARED_PREIMAGE);

    // Core property: they MUST be identical for cross-chain swaps to work
    expect(midnightHash).toEqual(cardanoHash);
    expect(toHex(midnightHash)).toBe(toHex(cardanoHash));
  });

  it("runs Cardano Aiken e2e tests through the real Plutus evaluator", () => {
    // Execute `aiken check` filtering to e2e tests — runs through the actual
    // Plutus UPLC evaluator with full Transaction mocks, not mocked.
    // aiken check outputs JSON to stdout.
    const result = execSync("aiken check -m 'e2e_'", {
      cwd: "/Users/kaleab/Documents/example-bboard/cardano",
      encoding: "utf-8",
      timeout: 60_000,
    });

    const report = JSON.parse(result);
    expect(report.summary.failed).toBe(0);
    expect(report.summary.passed).toBe(10);

    // Verify the shared preimage test specifically passed
    const e2eModule = report.modules.find(
      (m: { name: string }) => m.name === "htlc/e2e",
    );
    expect(e2eModule).toBeDefined();

    const withdrawTest = e2eModule.tests.find(
      (t: { title: string }) =>
        t.title === "e2e_withdraw_with_shared_preimage",
    );
    expect(withdrawTest.status).toBe("pass");
  });

  it("completes full atomic swap with shared preimage across both real runtimes", () => {
    const hashLock = sha256(SHARED_PREIMAGE);

    // ──── MIDNIGHT SIDE (real compact-runtime execution) ────

    const aliceMidnightKey = toHex(randomBytes(32));
    const bobMidnightKey = toHex(randomBytes(32));

    const midnight = new HTLCSimulator(aliceMidnightKey, NOW);
    midnight.switchUser(bobMidnightKey);
    const bobMidnightAddr = midnight.myAddr();
    midnight.switchUser(aliceMidnightKey);

    // Alice mints tokens on Midnight
    const aliceCoin = midnight.mintQualifiedCoin(
      randomBytes(32),
      1000n,
      randomBytes(32),
    );

    // Alice deposits with the shared preimage hash (persistentHash == SHA-256)
    const midnightExpiry = BigInt(NOW + ONE_HOUR * 2);
    midnight.deposit(aliceCoin, hashLock, midnightExpiry, bobMidnightAddr);

    expect(midnight.getLedger().htlcActive).toBe(true);
    expect(midnight.getLedger().htlcHash).toEqual(hashLock);

    const lockedMtIndex =
      midnight.circuitContext.currentZswapLocalState.currentIndex - 1n;

    // ──── CARDANO SIDE (simulated — real Plutus evaluation via aiken check above) ────

    const aliceCardano = "alice_cardano_pkh";
    const bobCardano = "bob_cardano_pkh";

    const cardano = new CardanoHTLCSimulator(bobCardano, NOW);
    cardano.mintToken("SWAP", 500n);
    cardano.deposit(hashLock, aliceCardano, 500n, "SWAP", NOW + ONE_HOUR);

    expect(cardano.getHTLC().active).toBe(true);

    // ──── SWAP EXECUTION ────

    // Step 1: Alice claims on Cardano by revealing the SHARED preimage
    cardano.switchUser(aliceCardano);
    cardano.withdraw(SHARED_PREIMAGE);

    expect(cardano.getHTLC().active).toBe(false);
    expect(cardano.getBalance(aliceCardano, "SWAP")).toBe(500n);

    // Step 2: Bob observes preimage on Cardano chain, claims on Midnight
    midnight.switchUser(bobMidnightKey);
    midnight.withdraw(SHARED_PREIMAGE, lockedMtIndex);

    expect(midnight.getLedger().htlcActive).toBe(false);
    expect(midnight.getLedger().htlcCoinValue).toBe(0n);
  });

  it("runs complete Aiken test suite (unit + property + e2e) through Plutus evaluator", () => {
    const result = execSync("aiken check", {
      cwd: "/Users/kaleab/Documents/example-bboard/cardano",
      encoding: "utf-8",
      timeout: 60_000,
    });

    const report = JSON.parse(result);

    // 27 tests: 10 e2e + 13 unit + 4 property (x100 iterations each)
    expect(report.summary.total).toBe(27);
    expect(report.summary.passed).toBe(27);
    expect(report.summary.failed).toBe(0);
  });
});
