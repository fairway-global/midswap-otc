// Tests for the FungibleToken-aware HTLC contract with concurrent swap support.
//
// This contract uses OpenZeppelin's FungibleToken module for balance-based
// token management. Multiple HTLCs can be active simultaneously, each keyed
// by its hash lock. The hash is also the swap identifier for withdraw/reclaim.

import { HTLCFTSimulator } from "./htlc-ft-simulator.js";
import {
  persistentHash,
  Bytes32Descriptor,
} from "@midnight-ntwrk/compact-runtime";
import { describe, it, expect } from "vitest";
import { randomBytes } from "./utils.js";

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function hashPreimage(preimage: Uint8Array): Uint8Array {
  return persistentHash(Bytes32Descriptor, preimage);
}

const NOW = Math.floor(Date.now() / 1000);
const ONE_HOUR = 3600;

function createSimulator(
  coinPublicKey: string,
  blockTime?: number,
): HTLCFTSimulator {
  return new HTLCFTSimulator(coinPublicKey, "SwapToken", "SWAP", 6n, blockTime);
}

describe("FungibleToken HTLC contract (concurrent swaps)", () => {
  // ─────────────────────────────────────────────────────────────────────
  // Initialization and FungibleToken basics
  // ─────────────────────────────────────────────────────────────────────

  it("initializes with empty swap maps and zero balances", () => {
    const sim = createSimulator(toHex(randomBytes(32)));
    const state = sim.getLedger();
    expect(state.htlcAmounts.isEmpty()).toBe(true);
    expect(state.htlcExpiries.isEmpty()).toBe(true);
    expect(state.htlcSenders.isEmpty()).toBe(true);
    expect(state.htlcReceivers.isEmpty()).toBe(true);

    const callerAddr = sim.callerAddress();
    expect(sim.balanceOf(callerAddr)).toBe(0n);
    expect(sim.totalSupply()).toBe(0n);
  });

  it("mints tokens and tracks balances correctly", () => {
    const sim = createSimulator(toHex(randomBytes(32)));
    const addr = sim.callerAddress();

    sim.mint(addr, 10_000n);
    expect(sim.balanceOf(addr)).toBe(10_000n);
    expect(sim.totalSupply()).toBe(10_000n);

    sim.mint(addr, 5_000n);
    expect(sim.balanceOf(addr)).toBe(15_000n);
    expect(sim.totalSupply()).toBe(15_000n);
  });

  it("transfers tokens between users", () => {
    const aliceKey = toHex(randomBytes(32));
    const bobKey = toHex(randomBytes(32));
    const sim = createSimulator(aliceKey);

    // Mint to Alice
    const aliceAddr = sim.callerAddress();
    sim.mint(aliceAddr, 1000n);

    // Get Bob's address
    sim.switchUser(bobKey);
    const bobAddr = sim.callerAddress();

    // Transfer from Alice to Bob
    sim.switchUser(aliceKey);
    sim.transfer(bobAddr, 300n);
    expect(sim.balanceOf(aliceAddr)).toBe(700n);
    expect(sim.balanceOf(bobAddr)).toBe(300n);
  });

  // ─────────────────────────────────────────────────────────────────────
  // HTLC Deposit
  // ─────────────────────────────────────────────────────────────────────

  it("deposits tokens into HTLC escrow", () => {
    const senderKey = toHex(randomBytes(32));
    const receiverKey = toHex(randomBytes(32));
    const sim = createSimulator(senderKey, NOW);

    // Mint tokens to sender
    const senderAddr = sim.callerAddress();
    sim.mint(senderAddr, 1000n);

    // Get receiver address
    sim.switchUser(receiverKey);
    const receiverAddrBytes = sim.myAddr();
    sim.switchUser(senderKey);

    // Deposit into HTLC
    const preimage = randomBytes(32);
    const hash = hashPreimage(preimage);
    const expiryTime = BigInt(NOW + ONE_HOUR);
    sim.deposit(500n, hash, expiryTime, receiverAddrBytes);

    // Verify swap state via Maps
    expect(sim.isSwapActive(hash)).toBe(true);
    expect(sim.getSwapAmount(hash)).toBe(500n);
    expect(sim.getSwapExpiry(hash)).toBe(expiryTime);

    // Sender's balance should be reduced
    expect(sim.balanceOf(senderAddr)).toBe(500n);
  });

  it("rejects deposit with duplicate active hash", () => {
    const sim = createSimulator(toHex(randomBytes(32)), NOW);
    const senderAddr = sim.callerAddress();
    sim.mint(senderAddr, 2000n);
    const receiverAddr = randomBytes(32);
    const hash = hashPreimage(randomBytes(32));

    sim.deposit(500n, hash, BigInt(NOW + ONE_HOUR), receiverAddr);
    expect(() =>
      sim.deposit(500n, hash, BigInt(NOW + ONE_HOUR), receiverAddr),
    ).toThrow("HTLC already active for this hash");
  });

  it("rejects deposit with past expiry time", () => {
    const sim = createSimulator(toHex(randomBytes(32)), NOW);
    const senderAddr = sim.callerAddress();
    sim.mint(senderAddr, 1000n);

    expect(() =>
      sim.deposit(500n, hashPreimage(randomBytes(32)), BigInt(NOW - ONE_HOUR), randomBytes(32)),
    ).toThrow("Expiry time must be in the future");
  });

  it("rejects deposit with insufficient balance", () => {
    const sim = createSimulator(toHex(randomBytes(32)), NOW);
    const senderAddr = sim.callerAddress();
    sim.mint(senderAddr, 100n);

    expect(() =>
      sim.deposit(500n, hashPreimage(randomBytes(32)), BigInt(NOW + ONE_HOUR), randomBytes(32)),
    ).toThrow("insufficient balance");
  });

  // ─────────────────────────────────────────────────────────────────────
  // HTLC Withdraw
  // ─────────────────────────────────────────────────────────────────────

  it("allows receiver to withdraw with correct preimage", () => {
    const senderKey = toHex(randomBytes(32));
    const receiverKey = toHex(randomBytes(32));
    const sim = createSimulator(senderKey, NOW);

    // Setup: mint, get addresses, deposit
    const senderAddr = sim.callerAddress();
    sim.mint(senderAddr, 1000n);

    sim.switchUser(receiverKey);
    const receiverAddrBytes = sim.myAddr();
    const receiverAddr = sim.callerAddress();
    sim.switchUser(senderKey);

    const preimage = randomBytes(32);
    const hash = hashPreimage(preimage);
    sim.deposit(1000n, hash, BigInt(NOW + ONE_HOUR), receiverAddrBytes);

    // Receiver withdraws
    sim.switchUser(receiverKey);
    sim.withdraw(preimage);

    // Verify: swap completed, receiver got tokens
    expect(sim.isSwapActive(hash)).toBe(false);
    expect(sim.getSwapAmount(hash)).toBe(0n);
    expect(sim.balanceOf(receiverAddr)).toBe(1000n);
    expect(sim.balanceOf(senderAddr)).toBe(0n);
  });

  it("rejects withdraw with wrong preimage", () => {
    const senderKey = toHex(randomBytes(32));
    const receiverKey = toHex(randomBytes(32));
    const sim = createSimulator(senderKey, NOW);

    const senderAddr = sim.callerAddress();
    sim.mint(senderAddr, 1000n);
    sim.switchUser(receiverKey);
    const receiverAddrBytes = sim.myAddr();
    sim.switchUser(senderKey);

    const preimage = randomBytes(32);
    sim.deposit(1000n, hashPreimage(preimage), BigInt(NOW + ONE_HOUR), receiverAddrBytes);

    // Wrong preimage → wrong hash → no matching swap
    sim.switchUser(receiverKey);
    expect(() => sim.withdraw(randomBytes(32))).toThrow("No active HTLC");
  });

  it("rejects withdraw by non-receiver", () => {
    const senderKey = toHex(randomBytes(32));
    const receiverKey = toHex(randomBytes(32));
    const attackerKey = toHex(randomBytes(32));
    const sim = createSimulator(senderKey, NOW);

    const senderAddr = sim.callerAddress();
    sim.mint(senderAddr, 1000n);
    sim.switchUser(receiverKey);
    const receiverAddrBytes = sim.myAddr();
    sim.switchUser(senderKey);

    const preimage = randomBytes(32);
    sim.deposit(1000n, hashPreimage(preimage), BigInt(NOW + ONE_HOUR), receiverAddrBytes);

    sim.switchUser(attackerKey);
    expect(() => sim.withdraw(preimage)).toThrow(
      "Only designated receiver can withdraw",
    );
  });

  it("rejects withdraw after expiry", () => {
    const senderKey = toHex(randomBytes(32));
    const receiverKey = toHex(randomBytes(32));
    const sim = createSimulator(senderKey, NOW);

    const senderAddr = sim.callerAddress();
    sim.mint(senderAddr, 1000n);
    sim.switchUser(receiverKey);
    const receiverAddrBytes = sim.myAddr();
    sim.switchUser(senderKey);

    const preimage = randomBytes(32);
    sim.deposit(1000n, hashPreimage(preimage), BigInt(NOW + ONE_HOUR), receiverAddrBytes);

    sim.setBlockTime(NOW + ONE_HOUR + 1);
    sim.switchUser(receiverKey);
    expect(() => sim.withdraw(preimage)).toThrow("HTLC has expired");
  });

  // ─────────────────────────────────────────────────────────────────────
  // HTLC Reclaim
  // ─────────────────────────────────────────────────────────────────────

  it("allows sender to reclaim after expiry", () => {
    const senderKey = toHex(randomBytes(32));
    const receiverKey = toHex(randomBytes(32));
    const sim = createSimulator(senderKey, NOW);

    const senderAddr = sim.callerAddress();
    sim.mint(senderAddr, 1000n);
    sim.switchUser(receiverKey);
    const receiverAddrBytes = sim.myAddr();
    sim.switchUser(senderKey);

    const hash = hashPreimage(randomBytes(32));
    sim.deposit(1000n, hash, BigInt(NOW + ONE_HOUR), receiverAddrBytes);
    expect(sim.balanceOf(senderAddr)).toBe(0n);

    sim.setBlockTime(NOW + ONE_HOUR + 1);
    sim.reclaim(hash);

    expect(sim.isSwapActive(hash)).toBe(false);
    expect(sim.balanceOf(senderAddr)).toBe(1000n);
  });

  it("rejects reclaim before expiry", () => {
    const senderKey = toHex(randomBytes(32));
    const sim = createSimulator(senderKey, NOW);

    const senderAddr = sim.callerAddress();
    sim.mint(senderAddr, 1000n);
    const hash = hashPreimage(randomBytes(32));
    sim.deposit(1000n, hash, BigInt(NOW + ONE_HOUR), randomBytes(32));

    expect(() => sim.reclaim(hash)).toThrow("HTLC has not expired yet");
  });

  it("rejects reclaim by non-sender", () => {
    const senderKey = toHex(randomBytes(32));
    const attackerKey = toHex(randomBytes(32));
    const sim = createSimulator(senderKey, NOW);

    const senderAddr = sim.callerAddress();
    sim.mint(senderAddr, 1000n);
    const hash = hashPreimage(randomBytes(32));
    sim.deposit(1000n, hash, BigInt(NOW + ONE_HOUR), randomBytes(32));

    sim.setBlockTime(NOW + ONE_HOUR + 1);
    sim.switchUser(attackerKey);
    expect(() => sim.reclaim(hash)).toThrow("Only original sender can reclaim");
  });

  // ─────────────────────────────────────────────────────────────────────
  // Edge cases
  // ─────────────────────────────────────────────────────────────────────

  it("rejects withdraw/reclaim when no HTLC exists for hash", () => {
    const sim = createSimulator(toHex(randomBytes(32)), NOW);
    expect(() => sim.withdraw(randomBytes(32))).toThrow("No active HTLC");
    expect(() => sim.reclaim(randomBytes(32))).toThrow("No active HTLC");
  });

  it("allows new deposit after successful withdraw", () => {
    const senderKey = toHex(randomBytes(32));
    const receiverKey = toHex(randomBytes(32));
    const sim = createSimulator(senderKey, NOW);

    const senderAddr = sim.callerAddress();
    sim.mint(senderAddr, 2000n);
    sim.switchUser(receiverKey);
    const receiverAddrBytes = sim.myAddr();
    sim.switchUser(senderKey);

    // Round 1: deposit and withdraw
    const preimage1 = randomBytes(32);
    const hash1 = hashPreimage(preimage1);
    sim.deposit(1000n, hash1, BigInt(NOW + ONE_HOUR), receiverAddrBytes);
    sim.switchUser(receiverKey);
    sim.withdraw(preimage1);

    // Round 2: new deposit with different hash succeeds
    sim.switchUser(senderKey);
    const preimage2 = randomBytes(32);
    const hash2 = hashPreimage(preimage2);
    sim.deposit(500n, hash2, BigInt(NOW + ONE_HOUR), receiverAddrBytes);
    expect(sim.isSwapActive(hash2)).toBe(true);
    expect(sim.getSwapAmount(hash2)).toBe(500n);
  });

  it("preserves remaining balance after partial deposit", () => {
    const sim = createSimulator(toHex(randomBytes(32)), NOW);
    const addr = sim.callerAddress();
    sim.mint(addr, 1000n);

    sim.deposit(400n, hashPreimage(randomBytes(32)), BigInt(NOW + ONE_HOUR), randomBytes(32));
    expect(sim.balanceOf(addr)).toBe(600n);
    expect(sim.totalSupply()).toBe(1000n); // total supply unchanged
  });

  // ─────────────────────────────────────────────────────────────────────
  // Concurrent swaps
  // ─────────────────────────────────────────────────────────────────────

  it("supports multiple concurrent deposits with different hashes", () => {
    const senderKey = toHex(randomBytes(32));
    const receiverKey = toHex(randomBytes(32));
    const sim = createSimulator(senderKey, NOW);

    const senderAddr = sim.callerAddress();
    sim.mint(senderAddr, 3000n);
    sim.switchUser(receiverKey);
    const receiverAddrBytes = sim.myAddr();
    sim.switchUser(senderKey);

    const hash1 = hashPreimage(randomBytes(32));
    const hash2 = hashPreimage(randomBytes(32));
    const hash3 = hashPreimage(randomBytes(32));

    sim.deposit(500n, hash1, BigInt(NOW + ONE_HOUR), receiverAddrBytes);
    sim.deposit(700n, hash2, BigInt(NOW + ONE_HOUR * 2), receiverAddrBytes);
    sim.deposit(300n, hash3, BigInt(NOW + ONE_HOUR * 3), receiverAddrBytes);

    // All three are active
    expect(sim.isSwapActive(hash1)).toBe(true);
    expect(sim.isSwapActive(hash2)).toBe(true);
    expect(sim.isSwapActive(hash3)).toBe(true);

    expect(sim.getSwapAmount(hash1)).toBe(500n);
    expect(sim.getSwapAmount(hash2)).toBe(700n);
    expect(sim.getSwapAmount(hash3)).toBe(300n);

    // Sender balance: 3000 - 500 - 700 - 300 = 1500
    expect(sim.balanceOf(senderAddr)).toBe(1500n);
  });

  it("allows independent withdraw of concurrent swaps", () => {
    const senderKey = toHex(randomBytes(32));
    const receiverKey = toHex(randomBytes(32));
    const sim = createSimulator(senderKey, NOW);

    const senderAddr = sim.callerAddress();
    sim.mint(senderAddr, 2000n);
    sim.switchUser(receiverKey);
    const receiverAddrBytes = sim.myAddr();
    const receiverAddr = sim.callerAddress();
    sim.switchUser(senderKey);

    const preimage1 = randomBytes(32);
    const hash1 = hashPreimage(preimage1);
    const preimage2 = randomBytes(32);
    const hash2 = hashPreimage(preimage2);

    sim.deposit(600n, hash1, BigInt(NOW + ONE_HOUR), receiverAddrBytes);
    sim.deposit(400n, hash2, BigInt(NOW + ONE_HOUR), receiverAddrBytes);

    // Withdraw only swap 1
    sim.switchUser(receiverKey);
    sim.withdraw(preimage1);

    expect(sim.isSwapActive(hash1)).toBe(false);
    expect(sim.isSwapActive(hash2)).toBe(true);
    expect(sim.balanceOf(receiverAddr)).toBe(600n);

    // Withdraw swap 2
    sim.withdraw(preimage2);

    expect(sim.isSwapActive(hash2)).toBe(false);
    expect(sim.balanceOf(receiverAddr)).toBe(1000n);
  });

  it("allows independent reclaim of concurrent swaps", () => {
    const senderKey = toHex(randomBytes(32));
    const sim = createSimulator(senderKey, NOW);

    const senderAddr = sim.callerAddress();
    sim.mint(senderAddr, 2000n);

    const hash1 = hashPreimage(randomBytes(32));
    const hash2 = hashPreimage(randomBytes(32));

    sim.deposit(500n, hash1, BigInt(NOW + ONE_HOUR), randomBytes(32));
    sim.deposit(800n, hash2, BigInt(NOW + ONE_HOUR * 2), randomBytes(32));
    expect(sim.balanceOf(senderAddr)).toBe(700n);

    // Expire swap 1, reclaim it
    sim.setBlockTime(NOW + ONE_HOUR + 1);
    sim.reclaim(hash1);

    expect(sim.isSwapActive(hash1)).toBe(false);
    expect(sim.isSwapActive(hash2)).toBe(true);
    expect(sim.balanceOf(senderAddr)).toBe(1200n);

    // Expire swap 2, reclaim it
    sim.setBlockTime(NOW + ONE_HOUR * 2 + 1);
    sim.reclaim(hash2);

    expect(sim.isSwapActive(hash2)).toBe(false);
    expect(sim.balanceOf(senderAddr)).toBe(2000n);
  });

  it("allows reuse of hash after swap completes", () => {
    const senderKey = toHex(randomBytes(32));
    const receiverKey = toHex(randomBytes(32));
    const sim = createSimulator(senderKey, NOW);

    const senderAddr = sim.callerAddress();
    sim.mint(senderAddr, 2000n);
    sim.switchUser(receiverKey);
    const receiverAddrBytes = sim.myAddr();
    sim.switchUser(senderKey);

    // Deposit with a specific hash
    const preimage = randomBytes(32);
    const hash = hashPreimage(preimage);
    sim.deposit(500n, hash, BigInt(NOW + ONE_HOUR), receiverAddrBytes);

    // Withdraw completes the swap (sets amount to 0)
    sim.switchUser(receiverKey);
    sim.withdraw(preimage);
    expect(sim.isSwapActive(hash)).toBe(false);

    // Same hash can be reused for a new deposit
    sim.switchUser(senderKey);
    sim.deposit(300n, hash, BigInt(NOW + ONE_HOUR), receiverAddrBytes);
    expect(sim.isSwapActive(hash)).toBe(true);
    expect(sim.getSwapAmount(hash)).toBe(300n);
  });

  it("mix of withdraw and reclaim across concurrent swaps", () => {
    const senderKey = toHex(randomBytes(32));
    const receiverKey = toHex(randomBytes(32));
    const sim = createSimulator(senderKey, NOW);

    const senderAddr = sim.callerAddress();
    sim.mint(senderAddr, 3000n);
    sim.switchUser(receiverKey);
    const receiverAddrBytes = sim.myAddr();
    const receiverAddr = sim.callerAddress();
    sim.switchUser(senderKey);

    const preimage1 = randomBytes(32);
    const hash1 = hashPreimage(preimage1);
    const hash2 = hashPreimage(randomBytes(32));
    const preimage3 = randomBytes(32);
    const hash3 = hashPreimage(preimage3);

    sim.deposit(500n, hash1, BigInt(NOW + ONE_HOUR), receiverAddrBytes);
    sim.deposit(700n, hash2, BigInt(NOW + ONE_HOUR), receiverAddrBytes);
    sim.deposit(300n, hash3, BigInt(NOW + ONE_HOUR * 2), receiverAddrBytes);

    // Receiver withdraws swap 1
    sim.switchUser(receiverKey);
    sim.withdraw(preimage1);
    expect(sim.balanceOf(receiverAddr)).toBe(500n);

    // Expire swap 2, sender reclaims
    sim.setBlockTime(NOW + ONE_HOUR + 1);
    sim.switchUser(senderKey);
    sim.reclaim(hash2);
    expect(sim.balanceOf(senderAddr)).toBe(2200n); // 3000 - 500 - 700 - 300 + 700

    // Receiver withdraws swap 3 (still within its expiry)
    sim.switchUser(receiverKey);
    sim.withdraw(preimage3);
    expect(sim.balanceOf(receiverAddr)).toBe(800n); // 500 + 300
  });
});
