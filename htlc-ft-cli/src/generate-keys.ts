/**
 * Generate address.json with Alice, Bob, Charlie wallets for both chains.
 *
 * Cardano Preview:       BIP-39 mnemonics → Lucid address derivation via Blockfrost.
 * Midnight (undeployed): 32-byte hex seeds → HD derivation → CoinPublicKey → bech32m address.
 * Midnight (preprod):    Same seed, re-encoded with preprod network prefix.
 *
 * Usage:
 *   node --loader ts-node/esm src/generate-keys.ts
 *   (reads BLOCKFROST_API_KEY from .env)
 */

import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import bip39 from 'bip39';
import { HDWallet, Roles } from '@midnight-ntwrk/wallet-sdk-hd';
import { ZswapSecretKeys, encodeCoinPublicKey } from '@midnight-ntwrk/ledger-v8';
import { UnshieldedAddress } from '@midnight-ntwrk/wallet-sdk-address-format';

const scriptDir = path.resolve(new URL(import.meta.url).pathname, '..');

// Load .env
function loadEnv(): void {
  const envPath = path.resolve(scriptDir, '..', '.env');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf-8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const value = trimmed.slice(eqIdx + 1).trim();
    if (!process.env[key]) process.env[key] = value;
  }
}

const PARTICIPANTS = ['alice', 'bob', 'charlie'] as const;

/** Derive the shielded seed from a master seed using the same HD path as FluentWalletBuilder. */
function deriveShieldedSeed(masterSeedHex: string): Uint8Array {
  const seedBuffer = Buffer.from(masterSeedHex, 'hex');
  const result = HDWallet.fromSeed(seedBuffer) as { type: string; hdWallet: HDWallet };
  const derivation = result.hdWallet.selectAccount(0).selectRole(Roles.Zswap).deriveKeyAt(0);
  if ((derivation as any).type === 'keyOutOfBounds') throw new Error('HD key derivation out of bounds');
  return (derivation as any).key as Uint8Array;
}

/** Derive Midnight bech32m address for a given network from a master seed. */
function deriveMidnightAddress(masterSeedHex: string, networkId: string): string {
  const shieldedSeed = deriveShieldedSeed(masterSeedHex);
  const zswapKeys = ZswapSecretKeys.fromSeed(shieldedSeed);
  const coinPubKeyBytes = encodeCoinPublicKey(zswapKeys.coinPublicKey);
  // encodeCoinPublicKey returns 35 bytes (3-byte prefix + 32-byte key).
  // UnshieldedAddress expects the raw 32-byte public key.
  const rawKey = coinPubKeyBytes.length === 35 ? coinPubKeyBytes.slice(3) : coinPubKeyBytes;
  const addr = new UnshieldedAddress(Buffer.from(rawKey));
  return UnshieldedAddress.codec.encode(networkId, addr).toString();
}

/** Get the hex coin public key from a master seed. */
function deriveCoinPublicKey(masterSeedHex: string): string {
  const shieldedSeed = deriveShieldedSeed(masterSeedHex);
  const zswapKeys = ZswapSecretKeys.fromSeed(shieldedSeed);
  return zswapKeys.coinPublicKey as string;
}

async function main() {
  loadEnv();

  const blockfrostApiKey = process.env.BLOCKFROST_API_KEY;
  if (!blockfrostApiKey) {
    console.error('ERROR: Set BLOCKFROST_API_KEY in .env or as env var');
    process.exit(1);
  }

  console.log('Generating wallets for Alice, Bob, and Charlie...\n');

  // Dynamic import for Lucid (avoids libsodium ESM issues at top level)
  const { Lucid, Blockfrost, getAddressDetails } = await import('@lucid-evolution/lucid');

  const provider = new Blockfrost('https://cardano-preprod.blockfrost.io/api/v0', blockfrostApiKey);
  const lucid = await Lucid(provider, 'Preprod');

  const result: Record<string, unknown> = {};

  for (const name of PARTICIPANTS) {
    // ── Cardano Preview ──
    const mnemonic = bip39.generateMnemonic(256);
    lucid.selectWallet.fromSeed(mnemonic);
    const cardanoAddr = await lucid.wallet().address();
    const details = getAddressDetails(cardanoAddr);
    const pkh = details.paymentCredential?.hash ?? '';

    // ── Midnight ──
    const midSeed = crypto.randomBytes(32).toString('hex');
    const coinPubKey = deriveCoinPublicKey(midSeed);
    const undeployedAddr = deriveMidnightAddress(midSeed, 'undeployed');
    const preprodAddr = deriveMidnightAddress(midSeed, 'preprod');

    result[name] = {
      cardano: {
        mnemonic,
        address: cardanoAddr,
        paymentKeyHash: pkh,
      },
      midnight: {
        seed: midSeed,
        coinPublicKey: coinPubKey,
        undeployedAddress: undeployedAddr,
        preprodAddress: preprodAddr,
      },
    };

    console.log(`${name.toUpperCase()}`);
    console.log(`  Cardano address:       ${cardanoAddr}`);
    console.log(`  Cardano PKH:           ${pkh}`);
    console.log(`  Midnight seed:         ${midSeed}`);
    console.log(`  Midnight coinPubKey:   ${coinPubKey}`);
    console.log(`  Midnight (undeployed): ${undeployedAddr}`);
    console.log(`  Midnight (preprod):    ${preprodAddr}`);
    console.log();
  }

  const outPath = path.resolve(scriptDir, '..', 'address.json');
  fs.writeFileSync(outPath, JSON.stringify(result, null, 2) + '\n');
  console.log(`Written to ${outPath}`);

  console.log('\n=== Fund these Cardano Preview addresses from the faucet ===');
  for (const name of PARTICIPANTS) {
    console.log(`  ${name}: ${(result[name] as any).cardano.address}`);
  }

  console.log('\n=== Mint Midnight tokens for these addresses (local dev) ===');
  for (const name of PARTICIPANTS) {
    console.log(`  ${name}: ${(result[name] as any).midnight.undeployedAddress}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
