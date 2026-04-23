/**
 * Browser port of `htlc-ft-cli/src/cardano-htlc.ts`.
 *
 * Node-only calls replaced with browser equivalents:
 *   - `fs.readFileSync(blueprintPath)` → `fetch('/plutus.json').json()`
 *   - `createHash('sha256')`           → `crypto.subtle.digest('SHA-256', ...)`
 *   - `selectWallet.fromSeed`          → `selectWallet.fromAPI(cip30Api)`
 *
 * Uses Eternl (CIP-30) as the default Cardano wallet; any CIP-30 provider
 * (Nami, Lace-Cardano, Flint, Typhon) works with `selectWalletFromCIP30`.
 */

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
import type { Logger } from 'pino';

export interface CardanoHTLCBrowserConfig {
  blockfrostUrl: string;
  blockfrostApiKey: string;
  network: Network;
  /** URL the Aiken blueprint is served from (defaults to /plutus.json). */
  blueprintUrl?: string;
}

interface HTLCDatum {
  preimageHash: string; // hex, 32 bytes
  sender: string; // hex, 28 bytes (payment key hash)
  receiver: string; // hex, 28 bytes (payment key hash)
  deadline: bigint; // POSIX ms
}

const encodeDatum = (d: HTLCDatum): string =>
  Data.to(new Constr(0, [d.preimageHash, d.sender, d.receiver, d.deadline]));

const decodeDatum = (cbor: string): HTLCDatum => {
  const parsed = Data.from(cbor);
  const fields = (parsed as { fields: unknown[] }).fields;
  return {
    preimageHash: fields[0] as string,
    sender: fields[1] as string,
    receiver: fields[2] as string,
    deadline: fields[3] as bigint,
  };
};

const withdrawRedeemer = (preimageHex: string): string => Data.to(new Constr(0, [preimageHex]));

const reclaimRedeemer = (): string => Data.to(new Constr(1, []));

/** Minimal CIP-30 API shape, enough for `lucid.selectWallet.fromAPI(api)`. */
export interface CIP30Api {
  getNetworkId(): Promise<number>;
  getUtxos(amount?: string, paginate?: unknown): Promise<string[] | null>;
  getCollateral?(params?: unknown): Promise<string[]>;
  getBalance(): Promise<string>;
  getUsedAddresses(paginate?: unknown): Promise<string[]>;
  getUnusedAddresses(): Promise<string[]>;
  getChangeAddress(): Promise<string>;
  getRewardAddresses(): Promise<string[]>;
  signTx(tx: string, partialSign?: boolean): Promise<string>;
  signData(addr: string, payload: string): Promise<{ signature: string; key: string }>;
  submitTx(tx: string): Promise<string>;
}

export interface CIP30Wallet {
  apiVersion?: string;
  name?: string;
  icon?: string;
  enable(): Promise<CIP30Api>;
  isEnabled?(): Promise<boolean>;
}

const sha256Hex = async (hexData: string): Promise<string> => {
  const bytes = hexToBytes(hexData);
  const digest = await crypto.subtle.digest('SHA-256', bytes as BufferSource);
  return bytesToHex(new Uint8Array(digest));
};

const hexToBytes = (hex: string): Uint8Array => {
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
};

const bytesToHex = (bytes: Uint8Array): string => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

export class CardanoHTLCBrowser {
  private constructor(
    readonly lucid: LucidEvolution,
    readonly validator: SpendingValidator,
    readonly scriptAddress: string,
    readonly logger: Logger,
    readonly blockfrostUrl: string,
    readonly blockfrostApiKey: string,
  ) {}

  static async init(config: CardanoHTLCBrowserConfig, logger: Logger): Promise<CardanoHTLCBrowser> {
    const blueprintUrl = config.blueprintUrl ?? '/plutus.json';
    const res = await fetch(blueprintUrl);
    if (!res.ok) throw new Error(`Failed to fetch blueprint from ${blueprintUrl}: ${res.status}`);
    const blueprint = (await res.json()) as { validators: Array<{ title: string; compiledCode: string }> };

    const htlcValidator = blueprint.validators.find((v) => v.title === 'htlc.htlc.spend');
    if (!htlcValidator) throw new Error('HTLC spend validator not found in blueprint');

    const validator: SpendingValidator = {
      type: 'PlutusV3',
      script: htlcValidator.compiledCode,
    };

    const provider = new Blockfrost(config.blockfrostUrl, config.blockfrostApiKey);
    const lucid = await Lucid(provider, config.network);

    const scriptAddress = validatorToAddress(config.network, validator);
    logger.info({ scriptAddress }, 'CardanoHTLC browser: script address');

    return new CardanoHTLCBrowser(
      lucid,
      validator,
      scriptAddress,
      logger,
      config.blockfrostUrl,
      config.blockfrostApiKey,
    );
  }

  /**
   * Reverse-flow helper — when the maker (of a USDC→ADA swap) claims ADA on
   * Cardano they reveal the preimage via the tx redeemer. The taker reads it
   * back here so they can claim USDC on Midnight.
   *
   * Walks recent transactions at the script address, finds the one that spent
   * an HTLC UTxO whose datum held our target hash, and decodes the redeemer.
   * Aiken `Withdraw { preimage }` is encoded as `Constr 0 [preimage]` (CBOR);
   * `Reclaim` is `Constr 1 []`. Returns the preimage hex on a match.
   */
  async findClaimPreimage(preimageHash: string): Promise<string | undefined> {
    const headers = { project_id: this.blockfrostApiKey };
    const txsRes = await fetch(
      `${this.blockfrostUrl}/addresses/${this.scriptAddress}/transactions?count=100&order=desc`,
      { headers },
    );
    if (!txsRes.ok) return undefined;
    const txs = (await txsRes.json()) as Array<{ tx_hash: string }>;

    for (const { tx_hash } of txs) {
      try {
        const utxosRes = await fetch(`${this.blockfrostUrl}/txs/${tx_hash}/utxos`, { headers });
        if (!utxosRes.ok) continue;
        const txu = (await utxosRes.json()) as {
          inputs: Array<{ address: string; inline_datum?: string | null; data_hash?: string | null }>;
        };
        const scriptInput = txu.inputs.find((i) => {
          if (i.address !== this.scriptAddress || !i.inline_datum) return false;
          try {
            return decodeDatum(i.inline_datum).preimageHash === preimageHash;
          } catch {
            return false;
          }
        });
        if (!scriptInput) continue;

        const redeemersRes = await fetch(`${this.blockfrostUrl}/txs/${tx_hash}/redeemers`, { headers });
        if (!redeemersRes.ok) continue;
        const redeemers = (await redeemersRes.json()) as Array<{
          purpose: string;
          redeemer_data_hash?: string;
          script_hash?: string;
        }>;
        const spend = redeemers.find((r) => r.purpose === 'spend');
        if (!spend?.redeemer_data_hash) continue;

        const datumRes = await fetch(`${this.blockfrostUrl}/scripts/datum/${spend.redeemer_data_hash}/cbor`, {
          headers,
        });
        if (!datumRes.ok) continue;
        const datum = (await datumRes.json()) as { cbor: string };
        const parsed = Data.from(datum.cbor);
        if (typeof parsed !== 'object' || parsed === null) continue;
        const constr = parsed as { index?: bigint | number; fields?: unknown[] };
        if (Number(constr.index) !== 0) continue; // not a Withdraw
        const preimageHex = constr.fields?.[0];
        if (typeof preimageHex !== 'string') continue;
        const candidate = await sha256Hex(preimageHex);
        if (candidate === preimageHash) return preimageHex;
      } catch (e) {
        this.logger.trace({ err: e, tx_hash }, 'findClaimPreimage: skipping tx');
      }
    }
    return undefined;
  }

  selectWalletFromCIP30(api: CIP30Api): void {
    // Lucid Evolution CIP-30 shape matches 1-1.
    this.lucid.selectWallet.fromAPI(api as unknown as Parameters<typeof this.lucid.selectWallet.fromAPI>[0]);
  }

  async getPaymentKeyHash(): Promise<string> {
    const addr = await this.lucid.wallet().address();
    const details = getAddressDetails(addr);
    if (!details.paymentCredential) throw new Error('No payment credential in wallet address');
    return details.paymentCredential.hash;
  }

  async getWalletAddress(): Promise<string> {
    return this.lucid.wallet().address();
  }

  async getBalance(): Promise<bigint> {
    const utxos = await this.lucid.wallet().getUtxos();
    let total = 0n;
    for (const utxo of utxos) total += utxo.assets.lovelace ?? 0n;
    return total;
  }

  async lock(amountLovelace: bigint, preimageHash: string, receiverPkh: string, deadlineMs: bigint): Promise<string> {
    const senderPkh = await this.getPaymentKeyHash();
    const datum = encodeDatum({ preimageHash, sender: senderPkh, receiver: receiverPkh, deadline: deadlineMs });

    this.logger.info({ amountLovelace, preimageHash, senderPkh, receiverPkh, deadlineMs }, 'CardanoHTLC: lock');

    const tx = await this.lucid
      .newTx()
      .pay.ToContract(this.scriptAddress, { kind: 'inline', value: datum }, { lovelace: amountLovelace })
      .complete();

    const signed = await tx.sign.withWallet().complete();
    const txHash = await signed.submit();
    this.logger.info({ txHash }, 'CardanoHTLC: lock tx submitted');
    return txHash;
  }

  async claim(preimageHex: string): Promise<string> {
    const hashHex = await sha256Hex(preimageHex);
    const utxo = await this.findHTLCUtxo(hashHex);
    if (!utxo) throw new Error(`No HTLC UTxO found for hash ${hashHex}`);

    const datum = decodeDatum(utxo.datum!);
    const walletAddr = await this.getWalletAddress();

    this.logger.info({ hashHex, amountLovelace: utxo.assets.lovelace }, 'CardanoHTLC: claim');

    const redeemer = withdrawRedeemer(preimageHex);
    const tx = await this.lucid
      .newTx()
      .collectFrom([utxo], redeemer)
      .attach.SpendingValidator(this.validator)
      .addSigner(walletAddr)
      .validTo(Number(datum.deadline) - 60_000)
      .complete({ localUPLCEval: false });

    const signed = await tx.sign.withWallet().complete();
    const txHash = await signed.submit();
    this.logger.info({ txHash }, 'CardanoHTLC: claim tx submitted');
    return txHash;
  }

  async reclaim(preimageHash: string): Promise<string> {
    const utxo = await this.findHTLCUtxo(preimageHash);
    if (!utxo) throw new Error(`No HTLC UTxO found for hash ${preimageHash}`);

    const datum = decodeDatum(utxo.datum!);
    const walletAddr = await this.getWalletAddress();

    this.logger.info({ preimageHash, amountLovelace: utxo.assets.lovelace }, 'CardanoHTLC: reclaim');

    const redeemer = reclaimRedeemer();
    // +1s slot offset — see CLI comment in htlc-ft-cli/src/cardano-htlc.ts.
    const tx = await this.lucid
      .newTx()
      .collectFrom([utxo], redeemer)
      .attach.SpendingValidator(this.validator)
      .addSigner(walletAddr)
      .validFrom(Number(datum.deadline) + 1000)
      .complete({ localUPLCEval: false });

    const signed = await tx.sign.withWallet().complete();
    const txHash = await signed.submit();
    this.logger.info({ txHash }, 'CardanoHTLC: reclaim tx submitted');
    return txHash;
  }

  async findHTLCUtxo(preimageHash: string): Promise<UTxO | undefined> {
    const utxos = await this.lucid.utxosAt(this.scriptAddress);
    for (const utxo of utxos) {
      if (!utxo.datum) continue;
      try {
        const datum = decodeDatum(utxo.datum);
        if (datum.preimageHash === preimageHash) return utxo;
      } catch {
        /* skip unparseable */
      }
    }
    return undefined;
  }

  async listHTLCs(): Promise<Array<{ utxo: UTxO; datum: HTLCDatum }>> {
    const utxos = await this.lucid.utxosAt(this.scriptAddress);
    const results: Array<{ utxo: UTxO; datum: HTLCDatum }> = [];
    for (const utxo of utxos) {
      if (!utxo.datum) continue;
      try {
        const datum = decodeDatum(utxo.datum);
        results.push({ utxo, datum });
      } catch {
        /* skip unparseable */
      }
    }
    return results;
  }
}

/** Resolve the first Eternl CIP-30 provider, or a named fallback. */
export const resolveCIP30Wallet = (preferred?: string): CIP30Wallet | undefined => {
  const cardano = (window as unknown as { cardano?: Record<string, CIP30Wallet> }).cardano;
  if (!cardano) return undefined;
  if (preferred && cardano[preferred]) return cardano[preferred];
  return cardano.eternl ?? cardano.lace ?? cardano.nami ?? cardano.flint ?? cardano.typhon;
};

export { sha256Hex as sha256HexOfHexString };
