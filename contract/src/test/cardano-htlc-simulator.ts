// Cardano HTLC simulator for cross-chain atomic swap e2e tests.
// Mirrors the Aiken HTLC validator logic using SHA-256 in TypeScript.

import { createHash } from "node:crypto";

export type CardanoHTLC = {
  active: boolean;
  hash: Uint8Array;
  sender: string;
  receiver: string;
  deadline: number;
  amount: bigint;
  tokenName: string;
};

export class CardanoHTLCSimulator {
  private htlc: CardanoHTLC;
  private currentTime: number;
  private currentUser: string;
  private balances: Map<string, Map<string, bigint>>;

  constructor(initialUser: string, currentTime: number) {
    this.currentUser = initialUser;
    this.currentTime = currentTime;
    this.balances = new Map();
    this.htlc = this.emptyHTLC();
  }

  static sha256(data: Uint8Array): Uint8Array {
    return new Uint8Array(createHash("sha256").update(data).digest());
  }

  switchUser(user: string): void {
    this.currentUser = user;
  }

  setTime(unixSeconds: number): void {
    this.currentTime = unixSeconds;
  }

  mintToken(tokenName: string, amount: bigint): void {
    const userBal = this.getOrCreateBalance(this.currentUser);
    const current = userBal.get(tokenName) ?? 0n;
    userBal.set(tokenName, current + amount);
  }

  getBalance(user: string, tokenName: string): bigint {
    return this.balances.get(user)?.get(tokenName) ?? 0n;
  }

  deposit(
    hash: Uint8Array,
    receiver: string,
    amount: bigint,
    tokenName: string,
    deadline: number,
  ): void {
    if (this.htlc.active) throw new Error("HTLC already active");
    if (deadline <= this.currentTime)
      throw new Error("Deadline must be in the future");

    const userBal = this.getOrCreateBalance(this.currentUser);
    const current = userBal.get(tokenName) ?? 0n;
    if (current < amount) throw new Error("Insufficient balance");

    userBal.set(tokenName, current - amount);

    this.htlc = {
      active: true,
      hash,
      sender: this.currentUser,
      receiver,
      deadline,
      amount,
      tokenName,
    };
  }

  withdraw(preimage: Uint8Array): void {
    if (!this.htlc.active) throw new Error("No active HTLC");
    if (this.currentUser !== this.htlc.receiver)
      throw new Error("Only receiver can withdraw");
    if (this.currentTime > this.htlc.deadline)
      throw new Error("HTLC has expired");

    const computed = CardanoHTLCSimulator.sha256(preimage);
    if (!this.bytesEqual(computed, this.htlc.hash)) {
      throw new Error("Invalid preimage");
    }

    const receiverBal = this.getOrCreateBalance(this.htlc.receiver);
    const current = receiverBal.get(this.htlc.tokenName) ?? 0n;
    receiverBal.set(this.htlc.tokenName, current + this.htlc.amount);

    this.htlc = this.emptyHTLC();
  }

  reclaim(): void {
    if (!this.htlc.active) throw new Error("No active HTLC");
    if (this.currentUser !== this.htlc.sender)
      throw new Error("Only sender can reclaim");
    if (this.currentTime <= this.htlc.deadline)
      throw new Error("HTLC has not expired yet");

    const senderBal = this.getOrCreateBalance(this.htlc.sender);
    const current = senderBal.get(this.htlc.tokenName) ?? 0n;
    senderBal.set(this.htlc.tokenName, current + this.htlc.amount);

    this.htlc = this.emptyHTLC();
  }

  getHTLC(): CardanoHTLC {
    return { ...this.htlc };
  }

  private getOrCreateBalance(user: string): Map<string, bigint> {
    if (!this.balances.has(user)) {
      this.balances.set(user, new Map());
    }
    return this.balances.get(user)!;
  }

  private bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
    if (a.length !== b.length) return false;
    return a.every((byte, i) => byte === b[i]);
  }

  private emptyHTLC(): CardanoHTLC {
    return {
      active: false,
      hash: new Uint8Array(32),
      sender: "",
      receiver: "",
      deadline: 0,
      amount: 0n,
      tokenName: "",
    };
  }
}
