/**
 * Cross-Chain Atomic Swap: Alice's ADA ↔ Bob's native USDC.
 *
 * Flow:
 *   0. Bob deploys USDC (native unshielded token) + HTLC (pure escrow).
 *   1. Bob mints USDC to himself.
 *   2. Alice generates preimage and locks USDM on Cardano HTLC.
 *   3. Bob sees the lock, deposits native USDC on Midnight HTLC (same hash).
 *   4. Alice claims USDC on Midnight via withdrawWithPreimage — reveals preimage.
 *   5. Bob reads the preimage from Midnight state and claims USDM on Cardano.
 *
 * Usage:
 *   npx tsx src/execute-swap.ts
 */

import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { WebSocket } from 'ws';
import { createHash } from 'node:crypto';
import { createLogger } from './logger-utils.js';
import { MidnightWalletProvider } from './midnight-wallet-provider';
import { syncWallet, waitForUnshieldedFunds } from './wallet-utils';
import { NodeZkConfigProvider } from '@midnight-ntwrk/midnight-js-node-zk-config-provider';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { httpClientProofProvider } from '@midnight-ntwrk/midnight-js-http-client-proof-provider';
import { levelPrivateStateProvider } from '@midnight-ntwrk/midnight-js-level-private-state-provider';
import { deployContract, findDeployedContract } from '@midnight-ntwrk/midnight-js-contracts';
import { unshieldedToken } from '@midnight-ntwrk/ledger-v8';
import { type EnvironmentConfiguration } from '@midnight-ntwrk/testkit-js';
import { getMidnightEnv, applyMidnightNetwork } from './config';
import { type ContractAddress } from '@midnight-ntwrk/compact-runtime';
import { generateDust } from './generate-dust';
import {
  CompiledHTLCContract,
  htlcPrivateStateKey,
  type HTLCProviders,
  type HTLCPrivateStateId,
  type EmptyPrivateState as HTLCEmpty,
  type HTLCCircuitKeys,
} from '../../contract/src/htlc-contract';
import {
  CompiledUSDCContract,
  usdcPrivateStateKey,
  type USDCProviders,
  type USDCPrivateStateId,
  type EmptyPrivateState as USDCEmpty,
  type USDCCircuitKeys,
} from '../../contract/src/usdc-contract';
import { ledger as htlcLedger } from '../../contract/src/managed/htlc/contract/index.js';
import { ledger as usdcLedger } from '../../contract/src/managed/usdc/contract/index.js';
import {
  type Either,
  type ContractAddress as CompactContractAddress,
  type UserAddress,
} from '../../contract/src/managed/htlc/contract/index.js';

// @ts-expect-error: Needed for WebSocket usage through apollo
globalThis.WebSocket = WebSocket;

// ─────────────────────────────────────────────────────────────────────
// Config
// ─────────────────────────────────────────────────────────────────────

const SWAP_AMOUNT_USDM = 10n;
const SWAP_AMOUNT_USDC = 10n;
const MINT_AMOUNT = 100n;
const CARDANO_DEADLINE_MIN = 120;
const MIDNIGHT_DEADLINE_MIN = 60;
const TOKEN_NAME = 'USD Coin';
const TOKEN_SYMBOL = 'USDC';
const TOKEN_DECIMALS = 6n;
const DOMAIN_SEP_SOURCE = 'midnight-usdc-swap-v1';

const scriptDir = path.resolve(new URL(import.meta.url).pathname, '..');

const env: EnvironmentConfiguration = getMidnightEnv();

// ─────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────

function sha256(data: Uint8Array): Uint8Array {
  return new Uint8Array(createHash('sha256').update(data).digest());
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) out[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  return out;
}

function userEither(userAddrHex: string): Either<CompactContractAddress, UserAddress> {
  return {
    is_left: false,
    left: { bytes: new Uint8Array(32) },
    right: { bytes: hexToBytes(userAddrHex) },
  };
}

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

function banner(step: string): void {
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`  ${step}`);
  console.log(`${'═'.repeat(60)}\n`);
}

// ─────────────────────────────────────────────────────────────────────
// Providers
// ─────────────────────────────────────────────────────────────────────

function buildHtlcProviders(
  walletProvider: MidnightWalletProvider,
  storeName: string,
  seed: string,
): HTLCProviders {
  const zkConfigPath = path.resolve(scriptDir, '..', '..', 'contract', 'src', 'managed', 'htlc');
  const zk = new NodeZkConfigProvider<HTLCCircuitKeys>(zkConfigPath);
  return {
    privateStateProvider: levelPrivateStateProvider<HTLCPrivateStateId, HTLCEmpty>({
      privateStateStoreName: storeName,
      signingKeyStoreName: `${storeName}-keys`,
      privateStoragePasswordProvider: () => 'Htlc-Swap-Regression-2026!',
      accountId: seed,
    }),
    publicDataProvider: indexerPublicDataProvider(env.indexer, env.indexerWS),
    zkConfigProvider: zk,
    proofProvider: httpClientProofProvider(env.proofServer, zk),
    walletProvider: walletProvider,
    midnightProvider: walletProvider,
  };
}

function buildUsdcProviders(
  walletProvider: MidnightWalletProvider,
  storeName: string,
  seed: string,
): USDCProviders {
  const zkConfigPath = path.resolve(scriptDir, '..', '..', 'contract', 'src', 'managed', 'usdc');
  const zk = new NodeZkConfigProvider<USDCCircuitKeys>(zkConfigPath);
  return {
    privateStateProvider: levelPrivateStateProvider<USDCPrivateStateId, USDCEmpty>({
      privateStateStoreName: storeName,
      signingKeyStoreName: `${storeName}-keys`,
      privateStoragePasswordProvider: () => 'Usdc-Swap-Regression-2026!',
      accountId: seed,
    }),
    publicDataProvider: indexerPublicDataProvider(env.indexer, env.indexerWS),
    zkConfigProvider: zk,
    proofProvider: httpClientProofProvider(env.proofServer, zk),
    walletProvider: walletProvider,
    midnightProvider: walletProvider,
  };
}

// ─────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────

async function main() {
  loadEnv();
  applyMidnightNetwork();

  const addresses = JSON.parse(
    fs.readFileSync(path.resolve(scriptDir, '..', 'address.json'), 'utf-8'),
  );

  const blockfrostApiKey = process.env.BLOCKFROST_API_KEY;
  if (!blockfrostApiKey) {
    console.error('ERROR: Set BLOCKFROST_API_KEY in .env');
    process.exit(1);
  }

  const logDir = path.resolve(scriptDir, '..', 'logs', 'swap', `${new Date().toISOString()}.log`);
  const logger = await createLogger(logDir);

  // ══════════════════════════════════════════════════════════════════
  // STEP 0: Initialize wallets on both chains
  // ══════════════════════════════════════════════════════════════════

  banner('STEP 0: Initialize wallets');

  console.log('Building Alice Midnight wallet...');
  const aliceWallet = await MidnightWalletProvider.build(logger, env, addresses.alice.midnight.seed);
  await aliceWallet.start();
  console.log('Syncing Alice...');
  const aliceUnshielded = await waitForUnshieldedFunds(logger, aliceWallet.wallet, env, unshieldedToken());

  const aliceDustTx = await generateDust(logger, addresses.alice.midnight.seed, aliceUnshielded, aliceWallet.wallet);
  if (aliceDustTx) console.log(`Alice dust registration tx: ${aliceDustTx}`);

  const aliceUserAddrHex = addresses.alice.midnight.unshieldedAddressHex;
  const aliceCoinPubKey = aliceWallet.getCoinPublicKey();
  const aliceAuthBytes = hexToBytes(addresses.alice.midnight.coinPublicKey);
  console.log(`Alice coin pubkey: ${aliceCoinPubKey}`);

  console.log('Building Bob Midnight wallet...');
  const bobWallet = await MidnightWalletProvider.build(logger, env, addresses.bob.midnight.seed);
  await bobWallet.start();
  console.log('Syncing Bob...');
  const bobUnshielded = await waitForUnshieldedFunds(logger, bobWallet.wallet, env, unshieldedToken());

  const bobDustTx = await generateDust(logger, addresses.bob.midnight.seed, bobUnshielded, bobWallet.wallet);
  if (bobDustTx) console.log(`Bob dust registration tx: ${bobDustTx}`);

  const bobUserAddrHex = addresses.bob.midnight.unshieldedAddressHex;
  const bobCoinPubKey = bobWallet.getCoinPublicKey();
  const bobAuthBytes = hexToBytes(addresses.bob.midnight.coinPublicKey);
  console.log(`Bob coin pubkey: ${bobCoinPubKey}`);

  // Cardano wallets
  console.log('Initializing Cardano wallets...');
  const { CardanoHTLC: CardanoHTLCClass, loadUsdmPolicy } = await import('./cardano-htlc');
  const cardanoConfig = {
    blockfrostUrl: 'https://cardano-preprod.blockfrost.io/api/v0',
    blockfrostApiKey,
    network: 'Preprod' as const,
    blueprintPath: path.resolve(scriptDir, '..', '..', 'cardano', 'plutus.json'),
  };

  const aliceCardano = await CardanoHTLCClass.init(cardanoConfig, logger);
  aliceCardano.selectWalletFromSeed(addresses.alice.cardano.mnemonic);
  const aliceAdaBal = await aliceCardano.getBalance();
  console.log(`Alice Cardano balance: ${Number(aliceAdaBal) / 1_000_000} ADA`);

  const bobCardano = await CardanoHTLCClass.init(cardanoConfig, logger);
  bobCardano.selectWalletFromSeed(addresses.bob.cardano.mnemonic);
  const bobAdaBal = await bobCardano.getBalance();
  console.log(`Bob Cardano balance: ${Number(bobAdaBal) / 1_000_000} ADA`);

  const usdmPolicy = loadUsdmPolicy(cardanoConfig.blueprintPath);
  console.log(`USDM policyId: ${usdmPolicy.policyId}`);

  // ══════════════════════════════════════════════════════════════════
  // STEP 1: Bob deploys USDC + HTLC, mints USDC to himself
  // ══════════════════════════════════════════════════════════════════

  banner('STEP 1: Bob deploys USDC + HTLC & mints USDC');

  const bobUsdcProviders = buildUsdcProviders(bobWallet, 'usdc-swap-bob', addresses.bob.midnight.seed);
  const bobHtlcProviders = buildHtlcProviders(bobWallet, 'htlc-swap-bob', addresses.bob.midnight.seed);

  const domainSep = sha256(new TextEncoder().encode(DOMAIN_SEP_SOURCE));
  console.log('Deploying USDC contract...');
  const bobUsdc = await deployContract(bobUsdcProviders, {
    compiledContract: CompiledUSDCContract,
    privateStateId: usdcPrivateStateKey,
    initialPrivateState: {} as USDCEmpty,
    args: [TOKEN_NAME, TOKEN_SYMBOL, TOKEN_DECIMALS, domainSep],
  });
  const usdcAddress = bobUsdc.deployTxData.public.contractAddress;
  console.log(`USDC deployed at: ${usdcAddress}`);

  console.log(`Minting ${MINT_AMOUNT} USDC to Bob...`);
  const bobRecipient = userEither(bobUserAddrHex);
  await bobUsdc.callTx.mint(bobRecipient, MINT_AMOUNT);
  console.log('Minted successfully.');

  // Sync so Bob's wallet sees the new USDC coins
  await syncWallet(logger, bobWallet.wallet);

  // Read USDC color
  const usdcState = await bobUsdcProviders.publicDataProvider.queryContractState(usdcAddress);
  if (!usdcState) throw new Error('USDC state not found');
  const usdcColor = usdcLedger(usdcState.data)._color;
  console.log(`USDC color: ${bytesToHex(usdcColor)}`);

  console.log('Deploying HTLC contract...');
  const bobHtlc = await deployContract(bobHtlcProviders, {
    compiledContract: CompiledHTLCContract,
    privateStateId: htlcPrivateStateKey,
    initialPrivateState: {} as HTLCEmpty,
  });
  const htlcAddress = bobHtlc.deployTxData.public.contractAddress;
  console.log(`HTLC deployed at: ${htlcAddress}`);

  // ══════════════════════════════════════════════════════════════════
  // STEP 2: Alice generates preimage & locks USDM on Cardano
  // ══════════════════════════════════════════════════════════════════

  banner('STEP 2: Alice locks USDM on Cardano');

  const preimage = crypto.randomBytes(32);
  const hashLock = sha256(preimage);
  const preimageHex = bytesToHex(preimage);
  const hashHex = bytesToHex(hashLock);

  console.log(`Preimage (SECRET):  ${preimageHex}`);
  console.log(`Hash lock (PUBLIC): ${hashHex}`);

  const cardanoDeadlineMs = BigInt(Date.now() + CARDANO_DEADLINE_MIN * 60 * 1000);
  console.log(`Deadline: ${new Date(Number(cardanoDeadlineMs)).toISOString()} (${CARDANO_DEADLINE_MIN} min)`);
  console.log(`Locking ${SWAP_AMOUNT_USDM} USDM for Bob (PKH: ${addresses.bob.cardano.paymentKeyHash})...`);

  const lockTxHash = await aliceCardano.lock(
    SWAP_AMOUNT_USDM,
    usdmPolicy.unit,
    hashHex,
    addresses.bob.cardano.paymentKeyHash,
    cardanoDeadlineMs,
  );
  console.log(`Cardano HTLC lock tx: ${lockTxHash}`);
  console.log('Waiting for Cardano confirmation...');

  let cardanoConfirmed = false;
  for (let i = 0; i < 12; i++) {
    await new Promise((r) => setTimeout(r, 5000));
    const htlcs = await bobCardano.listHTLCs();
    const found = htlcs.find((h) => h.datum.preimageHash === hashHex);
    if (found) {
      console.log(`Confirmed! ${Number(found.utxo.assets.lovelace) / 1_000_000} ADA locked at script.`);
      cardanoConfirmed = true;
      break;
    }
    console.log(`  Waiting... (${(i + 1) * 5}s)`);
  }
  if (!cardanoConfirmed) {
    console.error('Cardano lock not confirmed after 60s. Aborting.');
    process.exit(1);
  }

  // ══════════════════════════════════════════════════════════════════
  // STEP 3: Bob deposits native USDC on Midnight HTLC
  // ══════════════════════════════════════════════════════════════════

  banner('STEP 3: Bob deposits USDC on Midnight HTLC');

  const midnightExpiryUnix = BigInt(Math.floor(Date.now() / 1000) + MIDNIGHT_DEADLINE_MIN * 60);
  console.log(`Midnight HTLC expiry: ${new Date(Number(midnightExpiryUnix) * 1000).toISOString()} (${MIDNIGHT_DEADLINE_MIN} min)`);
  console.log(`Depositing ${SWAP_AMOUNT_USDC} USDC with hash lock ${hashHex}...`);
  console.log(`Receiver: Alice`);

  const aliceRecipient = userEither(aliceUserAddrHex);
  const bobSenderPayout = userEither(bobUserAddrHex);

  await bobHtlc.callTx.deposit(
    usdcColor,
    SWAP_AMOUNT_USDC,
    hashLock,
    midnightExpiryUnix,
    aliceAuthBytes,    // receiverAuth (Alice's ZswapCoinPublicKey for auth)
    aliceRecipient,    // receiverPayout
    bobSenderPayout,   // senderPayout
  );
  console.log('Midnight HTLC deposit confirmed!');

  const state1 = await bobHtlcProviders.publicDataProvider.queryContractState(htlcAddress);
  if (state1) {
    const l = htlcLedger(state1.data);
    const escrowed = l.htlcAmounts.lookup(hashLock);
    console.log(`On-chain: ${escrowed} USDC escrowed under hash ${hashHex}`);
  }

  // ══════════════════════════════════════════════════════════════════
  // STEP 4: Alice claims USDC on Midnight (reveals preimage)
  // ══════════════════════════════════════════════════════════════════

  banner('STEP 4: Alice claims USDC on Midnight');

  const aliceHtlcProviders = buildHtlcProviders(aliceWallet, 'htlc-swap-alice', addresses.alice.midnight.seed);
  console.log('Alice joining the HTLC contract...');
  const aliceHtlc = await findDeployedContract(aliceHtlcProviders, {
    contractAddress: htlcAddress as ContractAddress,
    compiledContract: CompiledHTLCContract,
    privateStateId: htlcPrivateStateKey,
    initialPrivateState: {} as HTLCEmpty,
  });
  console.log('Alice joined.');

  console.log(`Revealing preimage: ${preimageHex}`);
  console.log('Withdrawing USDC...');
  await aliceHtlc.callTx.withdrawWithPreimage(preimage);
  console.log('Alice claimed USDC on Midnight!');

  // ══════════════════════════════════════════════════════════════════
  // STEP 5: Bob reads preimage from Midnight, claims USDM on Cardano
  // ══════════════════════════════════════════════════════════════════

  banner('STEP 5: Bob claims USDM on Cardano');

  // Read the preimage from Midnight contract state (revealedPreimages map).
  const state2 = await bobHtlcProviders.publicDataProvider.queryContractState(htlcAddress);
  if (!state2) throw new Error('HTLC state not found after withdraw');
  const l2 = htlcLedger(state2.data);
  if (!l2.revealedPreimages.member(hashLock)) {
    throw new Error('Preimage was not revealed on-chain — split flow is broken');
  }
  const observedPreimage = l2.revealedPreimages.lookup(hashLock);
  const observedPreimageHex = bytesToHex(observedPreimage);
  console.log(`Bob read preimage from Midnight contract state: ${observedPreimageHex}`);
  if (observedPreimageHex !== preimageHex) {
    throw new Error(`Preimage mismatch: observed ${observedPreimageHex} vs actual ${preimageHex}`);
  }
  console.log('Preimage matches — Bob claiming ADA from Cardano HTLC...');

  const claimTxHash = await bobCardano.claim(observedPreimageHex);
  console.log(`Cardano HTLC claim tx: ${claimTxHash}`);

  console.log('Waiting for Cardano confirmation...');
  await new Promise((r) => setTimeout(r, 30000));

  // ══════════════════════════════════════════════════════════════════
  // STEP 6: Verify final balances
  // ══════════════════════════════════════════════════════════════════

  banner('STEP 6: Final balances');

  const aliceAdaFinal = await aliceCardano.getBalance();
  const bobAdaFinal = await bobCardano.getBalance();
  console.log('── Cardano ──');
  console.log(`  Alice: ${Number(aliceAdaBal) / 1e6} ADA → ${Number(aliceAdaFinal) / 1e6} ADA  (fees + sent ${SWAP_AMOUNT_USDM} USDM)`);
  console.log(`  Bob:   ${Number(bobAdaBal) / 1e6} ADA → ${Number(bobAdaFinal) / 1e6} ADA  (received ${SWAP_AMOUNT_USDM} USDM)`);

  console.log('── Midnight ──');
  const state3 = await aliceHtlcProviders.publicDataProvider.queryContractState(htlcAddress);
  if (state3) {
    const l = htlcLedger(state3.data);
    const htlcActive = l.htlcAmounts.member(hashLock) && l.htlcAmounts.lookup(hashLock) > 0n;
    console.log(`  HTLC status: ${htlcActive ? 'STILL ACTIVE (unexpected)' : 'COMPLETED'}`);
    if (l.revealedPreimages.member(hashLock)) {
      console.log(`  revealedPreimages[hash] = ${bytesToHex(l.revealedPreimages.lookup(hashLock))}`);
    }
  }

  banner('CROSS-CHAIN ATOMIC SWAP COMPLETE');
  console.log(`  Alice gave:     ${SWAP_AMOUNT_USDM} USDM on Cardano`);
  console.log(`  Alice received: ${SWAP_AMOUNT_USDC} USDC on Midnight (native unshielded)`);
  console.log(`  Bob gave:       ${SWAP_AMOUNT_USDC} USDC on Midnight`);
  console.log(`  Bob received:   ${SWAP_AMOUNT_USDM} USDM on Cardano`);
  console.log();

  await aliceWallet.stop();
  await bobWallet.stop();
  process.exit(0);
}

main().catch((e) => {
  console.error('Swap failed:', e);
  if (e instanceof Error && e.stack) console.error(e.stack);
  if (e instanceof Error && e.cause) console.error('Cause:', e.cause);
  process.exit(1);
});
