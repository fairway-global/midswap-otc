// Cardano HTLC off-chain module using Lucid Evolution.
// Reads the Aiken-compiled HTLC validator and builds lock/claim/reclaim transactions
// against Cardano preview testnet via Blockfrost.

import {
  Lucid,
  Blockfrost,
  Data,
  Constr,
  validatorToAddress,
  getAddressDetails,
  type LucidEvolution,
  type SpendingValidator,
  type UTxO,
  type Network,
} from '@lucid-evolution/lucid';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { type Logger } from 'pino';

// ─────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────

export interface CardanoHTLCConfig {
  blockfrostUrl: string;
  blockfrostApiKey: string;
  network: Network;
  blueprintPath: string;
}

interface HTLCDatum {
  preimageHash: string;  // hex, 32 bytes
  sender: string;        // hex, 28 bytes (payment key hash)
  receiver: string;      // hex, 28 bytes (payment key hash)
  deadline: bigint;      // POSIX ms
}

// ─────────────────────────────────────────────────────────────────────
// Datum/Redeemer serialization
// ─────────────────────────────────────────────────────────────────────

function encodeDatum(d: HTLCDatum): string {
  return Data.to(new Constr(0, [d.preimageHash, d.sender, d.receiver, d.deadline]));
}

function decodeDatum(cbor: string): HTLCDatum {
  const constr = Data.from(cbor) as Constr<string | bigint>;
  return {
    preimageHash: constr.fields[0] as string,
    sender: constr.fields[1] as string,
    receiver: constr.fields[2] as string,
    deadline: constr.fields[3] as bigint,
  };
}

function withdrawRedeemer(preimageHex: string): string {
  return Data.to(new Constr(0, [preimageHex]));
}

function reclaimRedeemer(): string {
  return Data.to(new Constr(1, []));
}

// ─────────────────────────────────────────────────────────────────────
// CardanoHTLC class
// ─────────────────────────────────────────────────────────────────────

export class CardanoHTLC {
  readonly lucid: LucidEvolution;
  readonly validator: SpendingValidator;
  readonly scriptAddress: string;
  readonly logger: Logger;

  private constructor(lucid: LucidEvolution, validator: SpendingValidator, scriptAddress: string, logger: Logger) {
    this.lucid = lucid;
    this.validator = validator;
    this.scriptAddress = scriptAddress;
    this.logger = logger;
  }

  static async init(config: CardanoHTLCConfig, logger: Logger): Promise<CardanoHTLC> {
    // Load Aiken blueprint
    const blueprint = JSON.parse(fs.readFileSync(config.blueprintPath, 'utf-8'));
    const htlcValidator = blueprint.validators.find(
      (v: { title: string }) => v.title === 'htlc.htlc.spend',
    );
    if (!htlcValidator) throw new Error('HTLC spend validator not found in blueprint');

    const validator: SpendingValidator = {
      type: 'PlutusV3',
      script: htlcValidator.compiledCode,
    };

    // Initialize Lucid with Blockfrost
    const provider = new Blockfrost(config.blockfrostUrl, config.blockfrostApiKey);
    const lucid = await Lucid(provider, config.network);

    const scriptAddress = validatorToAddress(config.network, validator);
    logger.info(`HTLC script address: ${scriptAddress}`);

    return new CardanoHTLC(lucid, validator, scriptAddress, logger);
  }

  /** Load wallet from a BIP-39 mnemonic seed phrase. */
  selectWalletFromSeed(seed: string): void {
    this.lucid.selectWallet.fromSeed(seed);
  }

  /** Get the wallet's payment key hash (28 bytes hex). */
  async getPaymentKeyHash(): Promise<string> {
    const addr = await this.lucid.wallet().address();
    const details = this.getAddrDetails(addr);
    if (!details.paymentCredential) throw new Error('No payment credential in wallet address');
    return details.paymentCredential.hash;
  }

  /** Get the wallet's address. */
  async getWalletAddress(): Promise<string> {
    return this.lucid.wallet().address();
  }

  /** Get wallet ADA balance. */
  async getBalance(): Promise<bigint> {
    const utxos = await this.lucid.wallet().getUtxos();
    let total = 0n;
    for (const utxo of utxos) {
      total += utxo.assets.lovelace ?? 0n;
    }
    return total;
  }

  // ── Lock (Deposit) ──────────────────────────────────────────────────

  /**
   * Lock ADA at the HTLC script address.
   * @param amountLovelace  Amount in lovelace (1 ADA = 1_000_000 lovelace)
   * @param preimageHash    SHA-256 hash of the preimage (32 bytes hex)
   * @param receiverPkh     Receiver's payment key hash (28 bytes hex)
   * @param deadlineMs      POSIX deadline in milliseconds
   */
  async lock(amountLovelace: bigint, preimageHash: string, receiverPkh: string, deadlineMs: bigint): Promise<string> {
    const senderPkh = await this.getPaymentKeyHash();

    const datum = encodeDatum({
      preimageHash,
      sender: senderPkh,
      receiver: receiverPkh,
      deadline: deadlineMs,
    });

    this.logger.info(`Locking ${amountLovelace} lovelace at HTLC script...`);
    this.logger.info(`  Hash lock: ${preimageHash}`);
    this.logger.info(`  Sender PKH: ${senderPkh}`);
    this.logger.info(`  Receiver PKH: ${receiverPkh}`);
    this.logger.info(`  Deadline: ${new Date(Number(deadlineMs)).toISOString()}`);

    const tx = await this.lucid
      .newTx()
      .pay.ToContract(
        this.scriptAddress,
        { kind: 'inline', value: datum },
        { lovelace: amountLovelace },
      )
      .complete();

    const signed = await tx.sign.withWallet().complete();
    const txHash = await signed.submit();
    this.logger.info(`Lock tx submitted: ${txHash}`);
    return txHash;
  }

  // ── Claim (Withdraw with preimage) ──────────────────────────────────

  /**
   * Claim locked ADA by revealing the preimage.
   * @param preimageHex  The secret preimage (32 bytes hex)
   */
  async claim(preimageHex: string): Promise<string> {
    const hashHex = sha256Hex(preimageHex);
    const utxo = await this.findHTLCUtxo(hashHex);
    if (!utxo) throw new Error(`No HTLC UTxO found for hash ${hashHex}`);

    const datum = decodeDatum(utxo.datum!);
    const walletAddr = await this.getWalletAddress();

    this.logger.info(`Claiming HTLC with preimage...`);
    this.logger.info(`  Hash lock: ${hashHex}`);
    this.logger.info(`  Amount: ${utxo.assets.lovelace} lovelace`);
    this.logger.info(`  Deadline: ${new Date(Number(datum.deadline)).toISOString()}`);

    const redeemer = withdrawRedeemer(preimageHex);

    const tx = await this.lucid
      .newTx()
      .collectFrom([utxo], redeemer)
      .attach.SpendingValidator(this.validator)
      .addSigner(walletAddr)
      .validTo(Number(datum.deadline) - 60_000) // 1 min before deadline
      .complete({ localUPLCEval: false });

    const signed = await tx.sign.withWallet().complete();
    const txHash = await signed.submit();
    this.logger.info(`Claim tx submitted: ${txHash}`);
    return txHash;
  }

  // ── Reclaim (Refund after deadline) ─────────────────────────────────

  /**
   * Reclaim locked ADA after the deadline has passed.
   * @param preimageHash  The hash lock (32 bytes hex) identifying the HTLC
   */
  async reclaim(preimageHash: string): Promise<string> {
    const utxo = await this.findHTLCUtxo(preimageHash);
    if (!utxo) throw new Error(`No HTLC UTxO found for hash ${preimageHash}`);

    const datum = decodeDatum(utxo.datum!);
    const walletAddr = await this.getWalletAddress();

    this.logger.info(`Reclaiming HTLC after deadline...`);
    this.logger.info(`  Hash lock: ${preimageHash}`);
    this.logger.info(`  Amount: ${utxo.assets.lovelace} lovelace`);

    const redeemer = reclaimRedeemer();

    const tx = await this.lucid
      .newTx()
      .collectFrom([utxo], redeemer)
      .attach.SpendingValidator(this.validator)
      .addSigner(walletAddr)
      .validFrom(Number(datum.deadline) + 1)
      .complete({ localUPLCEval: false });

    const signed = await tx.sign.withWallet().complete();
    const txHash = await signed.submit();
    this.logger.info(`Reclaim tx submitted: ${txHash}`);
    return txHash;
  }

  // ── Query ───────────────────────────────────────────────────────────

  /** Find a HTLC UTxO at the script address matching the given preimage hash. */
  async findHTLCUtxo(preimageHash: string): Promise<UTxO | undefined> {
    const utxos = await this.lucid.utxosAt(this.scriptAddress);
    for (const utxo of utxos) {
      if (!utxo.datum) continue;
      try {
        const datum = decodeDatum(utxo.datum);
        if (datum.preimageHash === preimageHash) return utxo;
      } catch {
        // Skip UTxOs with unparseable datums
      }
    }
    return undefined;
  }

  /** List all HTLC UTxOs at the script address. */
  async listHTLCs(): Promise<Array<{ utxo: UTxO; datum: HTLCDatum }>> {
    const utxos = await this.lucid.utxosAt(this.scriptAddress);
    const results: Array<{ utxo: UTxO; datum: HTLCDatum }> = [];
    for (const utxo of utxos) {
      if (!utxo.datum) continue;
      try {
        const datum = decodeDatum(utxo.datum);
        results.push({ utxo, datum });
      } catch {
        // Skip
      }
    }
    return results;
  }

  // ── Helpers ─────────────────────────────────────────────────────────

  private getAddrDetails(address: string) {
    return getAddressDetails(address);
  }
}

// ─────────────────────────────────────────────────────────────────────
// Utility
// ─────────────────────────────────────────────────────────────────────

function sha256Hex(hexData: string): string {
  const bytes = Buffer.from(hexData, 'hex');
  return createHash('sha256').update(bytes).digest('hex');
}
