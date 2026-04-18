/**
 * Cross-Chain Atomic Swap: Alice's ADA ↔ Bob's SWAP tokens
 *
 * Flow:
 *   1. Bob deploys HTLC-FT contract on Midnight, mints SWAP tokens
 *   2. Alice generates preimage, locks ADA on Cardano HTLC
 *   3. Bob sees the lock, deposits SWAP tokens on Midnight HTLC (same hash)
 *   4. Alice claims SWAP tokens on Midnight (reveals preimage)
 *   5. Bob sees preimage, claims ADA on Cardano
 *
 * Usage:
 *   node --loader ts-node/esm src/execute-swap.ts
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
import { encodeCoinPublicKey, unshieldedToken } from '@midnight-ntwrk/ledger-v8';
import { setNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import { type EnvironmentConfiguration } from '@midnight-ntwrk/testkit-js';
import { generateDust } from './generate-dust';
import {
  CompiledHTLCFTContract,
  htlcFtPrivateStateKey,
  type HTLCFTProviders,
  type HTLCFTPrivateStateId,
  type EmptyPrivateState,
  type HTLCFTCircuitKeys,
} from '../../contract/src/htlc-ft-contract';
import {
  ledger,
  type Either,
  type ZswapCoinPublicKey,
  type ContractAddress as CompactContractAddress,
} from '../../contract/src/managed/htlc-ft/contract/index.js';
import { type ContractAddress } from '@midnight-ntwrk/compact-runtime';
import { currentDir } from './config.js';

// @ts-expect-error: Needed for WebSocket usage through apollo
globalThis.WebSocket = WebSocket;

// ─────────────────────────────────────────────────────────────────────
// Config
// ─────────────────────────────────────────────────────────────────────

const SWAP_AMOUNT_ADA = 10n;                           // 10 ADA
const SWAP_AMOUNT_LOVELACE = SWAP_AMOUNT_ADA * 1_000_000n; // 10,000,000 lovelace
const SWAP_AMOUNT_TOKENS = 10n;                        // 10 SWAP tokens
const MINT_AMOUNT = 100n;                              // Bob mints 100 total
const CARDANO_DEADLINE_MIN = 120;                      // Alice's Cardano lock: 2 hours
const MIDNIGHT_DEADLINE_MIN = 60;                      // Bob's Midnight lock: 1 hour (must be < Cardano)

const scriptDir = path.resolve(new URL(import.meta.url).pathname, '..');
const zkConfigPath = path.resolve(scriptDir, '..', '..', 'contract', 'src', 'managed', 'htlc-ft');

const env: EnvironmentConfiguration = {
  walletNetworkId: 'undeployed',
  networkId: 'undeployed',
  indexer: 'http://127.0.0.1:8088/api/v3/graphql',
  indexerWS: 'ws://127.0.0.1:8088/api/v3/graphql/ws',
  node: 'http://127.0.0.1:9944',
  nodeWS: 'ws://127.0.0.1:9944',
  faucet: '',
  proofServer: 'http://127.0.0.1:6300',
};

// ─────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────

function sha256(data: Uint8Array): Uint8Array {
  return new Uint8Array(createHash('sha256').update(data).digest());
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function callerAddr(addrBytes: Uint8Array): Either<ZswapCoinPublicKey, CompactContractAddress> {
  return { is_left: true, left: { bytes: addrBytes }, right: { bytes: new Uint8Array(32) } };
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
// Build providers for a participant
// ─────────────────────────────────────────────────────────────────────

function buildProviders(
  walletProvider: MidnightWalletProvider,
  storeName: string,
  seed: string,
): HTLCFTProviders {
  const zkConfig = new NodeZkConfigProvider<HTLCFTCircuitKeys>(zkConfigPath);
  return {
    privateStateProvider: levelPrivateStateProvider<HTLCFTPrivateStateId, EmptyPrivateState>({
      privateStateStoreName: storeName,
      signingKeyStoreName: `${storeName}-signing-keys`,
      privateStoragePasswordProvider: () => 'HtlcFt-Test-2026!',
      accountId: seed,
    }),
    publicDataProvider: indexerPublicDataProvider(env.indexer, env.indexerWS),
    zkConfigProvider: zkConfig,
    proofProvider: httpClientProofProvider(env.proofServer, zkConfig),
    walletProvider: walletProvider,
    midnightProvider: walletProvider,
  };
}

// ─────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────

async function main() {
  loadEnv();
  setNetworkId('undeployed');

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

  // ── Midnight wallets ──
  console.log('Building Alice Midnight wallet...');
  const aliceWallet = await MidnightWalletProvider.build(logger, env, addresses.alice.midnight.seed);
  await aliceWallet.start();
  console.log('Syncing Alice...');
  const aliceUnshielded = await waitForUnshieldedFunds(logger, aliceWallet.wallet, env, unshieldedToken());

  console.log('Registering Alice for dust generation...');
  const aliceDustTx = await generateDust(logger, addresses.alice.midnight.seed, aliceUnshielded, aliceWallet.wallet);
  if (aliceDustTx) {
    console.log(`Alice dust registration tx: ${aliceDustTx}`);
    await syncWallet(logger, aliceWallet.wallet);
  }

  const aliceCoinPubKey = aliceWallet.getCoinPublicKey();
  const aliceAddrBytes = encodeCoinPublicKey(aliceCoinPubKey);
  const aliceAddr = callerAddr(aliceAddrBytes);
  console.log(`Alice Midnight address: ${aliceCoinPubKey}`);

  console.log('Building Bob Midnight wallet...');
  const bobWallet = await MidnightWalletProvider.build(logger, env, addresses.bob.midnight.seed);
  await bobWallet.start();
  console.log('Syncing Bob...');
  const bobUnshielded = await waitForUnshieldedFunds(logger, bobWallet.wallet, env, unshieldedToken());

  console.log('Registering Bob for dust generation...');
  const bobDustTx = await generateDust(logger, addresses.bob.midnight.seed, bobUnshielded, bobWallet.wallet);
  if (bobDustTx) {
    console.log(`Bob dust registration tx: ${bobDustTx}`);
    await syncWallet(logger, bobWallet.wallet);
  }

  const bobCoinPubKey = bobWallet.getCoinPublicKey();
  const bobAddrBytes = encodeCoinPublicKey(bobCoinPubKey);
  const bobAddr = callerAddr(bobAddrBytes);
  console.log(`Bob Midnight address: ${bobCoinPubKey}`);

  // ── Cardano wallets (dynamic import to avoid libsodium ESM issues) ──
  console.log('Initializing Cardano wallets...');
  const { CardanoHTLC: CardanoHTLCClass } = await import('./cardano-htlc');
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

  // ══════════════════════════════════════════════════════════════════
  // STEP 1: Bob deploys HTLC-FT contract and mints SWAP tokens
  // ══════════════════════════════════════════════════════════════════

  banner('STEP 1: Bob deploys contract & mints SWAP tokens');

  const bobProviders = buildProviders(bobWallet, 'htlc-ft-swap-bob', addresses.bob.midnight.seed);

  console.log('Deploying HTLC-FT contract...');
  const bobContract = await deployContract(bobProviders, {
    compiledContract: CompiledHTLCFTContract,
    privateStateId: htlcFtPrivateStateKey,
    initialPrivateState: {} as EmptyPrivateState,
    args: ['SwapToken', 'SWAP', 6n],
  });
  const contractAddress = bobContract.deployTxData.public.contractAddress;
  console.log(`Contract deployed at: ${contractAddress}`);

  console.log(`Minting ${MINT_AMOUNT} SWAP tokens to Bob...`);
  await bobContract.callTx.mint(bobAddr, MINT_AMOUNT);
  console.log('Minted successfully.');

  // ══════════════════════════════════════════════════════════════════
  // STEP 2: Alice generates preimage & locks ADA on Cardano
  // ══════════════════════════════════════════════════════════════════

  banner('STEP 2: Alice locks ADA on Cardano');

  // Generate the atomic swap secret
  const preimage = crypto.randomBytes(32);
  const hashLock = sha256(preimage);
  const preimageHex = bytesToHex(preimage);
  const hashHex = bytesToHex(hashLock);

  console.log(`Preimage (SECRET):  ${preimageHex}`);
  console.log(`Hash lock (PUBLIC): ${hashHex}`);

  const cardanoDeadlineMs = BigInt(Date.now() + CARDANO_DEADLINE_MIN * 60 * 1000);
  console.log(`Deadline: ${new Date(Number(cardanoDeadlineMs)).toISOString()} (${CARDANO_DEADLINE_MIN} min)`);
  console.log(`Locking ${SWAP_AMOUNT_ADA} ADA for Bob (PKH: ${addresses.bob.cardano.paymentKeyHash})...`);

  const lockTxHash = await aliceCardano.lock(
    SWAP_AMOUNT_LOVELACE,
    hashHex,
    addresses.bob.cardano.paymentKeyHash,
    cardanoDeadlineMs,
  );
  console.log(`Cardano HTLC lock tx: ${lockTxHash}`);
  console.log('Waiting for Cardano confirmation...');

  // Poll until Bob can see the UTxO
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
  // STEP 3: Bob sees the lock, deposits SWAP tokens on Midnight
  // ══════════════════════════════════════════════════════════════════

  banner('STEP 3: Bob deposits SWAP tokens on Midnight HTLC');

  const midnightExpiryUnix = BigInt(Math.floor(Date.now() / 1000) + MIDNIGHT_DEADLINE_MIN * 60);
  console.log(`Midnight HTLC expiry: ${new Date(Number(midnightExpiryUnix) * 1000).toISOString()} (${MIDNIGHT_DEADLINE_MIN} min)`);
  console.log(`Depositing ${SWAP_AMOUNT_TOKENS} SWAP tokens with hash lock ${hashHex}...`);
  console.log(`Receiver: Alice (${aliceCoinPubKey})`);

  await bobContract.callTx.depositWithHashTimeLock(
    SWAP_AMOUNT_TOKENS,
    hashLock,           // 32-byte hash
    midnightExpiryUnix, // unix timestamp
    aliceAddrBytes,     // Alice's coin public key bytes
  );
  console.log('Midnight HTLC deposit confirmed!');

  // Verify on-chain state
  const state1 = await bobProviders.publicDataProvider.queryContractState(contractAddress);
  if (state1) {
    const l = ledger(state1.data);
    const escrowed = l.htlcAmounts.lookup(hashLock);
    console.log(`On-chain: ${escrowed} SWAP tokens escrowed under hash ${hashHex}`);
  }

  // ══════════════════════════════════════════════════════════════════
  // STEP 4: Alice claims SWAP tokens on Midnight (reveals preimage)
  // ══════════════════════════════════════════════════════════════════

  banner('STEP 4: Alice claims SWAP tokens on Midnight');

  // Alice joins the contract
  const aliceProviders = buildProviders(aliceWallet, 'htlc-ft-swap-alice', addresses.alice.midnight.seed);
  console.log('Alice joining the contract...');
  const aliceContract = await findDeployedContract(aliceProviders, {
    contractAddress: contractAddress as ContractAddress,
    compiledContract: CompiledHTLCFTContract,
    privateStateId: htlcFtPrivateStateKey,
    initialPrivateState: {} as EmptyPrivateState,
  });
  console.log('Alice joined.');

  console.log(`Revealing preimage: ${preimageHex}`);
  console.log('Withdrawing SWAP tokens...');
  await aliceContract.callTx.withdrawWithPreimage(preimage);
  console.log('Alice claimed SWAP tokens on Midnight!');

  // ══════════════════════════════════════════════════════════════════
  // STEP 5: Bob sees preimage, claims ADA on Cardano
  // ══════════════════════════════════════════════════════════════════

  banner('STEP 5: Bob claims ADA on Cardano');

  // In a real scenario, Bob would watch the Midnight chain for the preimage.
  // Here we simulate that by passing the preimage directly.
  console.log(`Bob observed preimage on Midnight: ${preimageHex}`);
  console.log('Bob claiming ADA from Cardano HTLC...');

  const claimTxHash = await bobCardano.claim(preimageHex);
  console.log(`Cardano HTLC claim tx: ${claimTxHash}`);

  // Wait for Cardano confirmation
  console.log('Waiting for Cardano confirmation...');
  await new Promise((r) => setTimeout(r, 30000));

  // ══════════════════════════════════════════════════════════════════
  // STEP 6: Verify final balances
  // ══════════════════════════════════════════════════════════════════

  banner('STEP 6: Final balances');

  // Cardano
  const aliceAdaFinal = await aliceCardano.getBalance();
  const bobAdaFinal = await bobCardano.getBalance();
  console.log('── Cardano ──');
  console.log(`  Alice: ${Number(aliceAdaBal) / 1e6} ADA → ${Number(aliceAdaFinal) / 1e6} ADA  (sent ${Number(SWAP_AMOUNT_ADA)} ADA)`);
  console.log(`  Bob:   ${Number(bobAdaBal) / 1e6} ADA → ${Number(bobAdaFinal) / 1e6} ADA  (received ~${Number(SWAP_AMOUNT_ADA)} ADA)`);

  // Midnight
  console.log('── Midnight ──');
  await aliceContract.callTx.balanceOf(aliceAddr);
  await bobContract.callTx.balanceOf(bobAddr);

  const state2 = await aliceProviders.publicDataProvider.queryContractState(contractAddress);
  if (state2) {
    const l = ledger(state2.data);
    const htlcActive = l.htlcAmounts.member(hashLock) && l.htlcAmounts.lookup(hashLock) > 0n;
    console.log(`  HTLC status: ${htlcActive ? 'STILL ACTIVE (unexpected)' : 'COMPLETED'}`);
  }

  banner('CROSS-CHAIN ATOMIC SWAP COMPLETE');
  console.log(`  Alice gave:     ${SWAP_AMOUNT_ADA} ADA on Cardano`);
  console.log(`  Alice received: ${SWAP_AMOUNT_TOKENS} SWAP tokens on Midnight`);
  console.log(`  Bob gave:       ${SWAP_AMOUNT_TOKENS} SWAP tokens on Midnight`);
  console.log(`  Bob received:   ${SWAP_AMOUNT_ADA} ADA on Cardano`);
  console.log();

  // Cleanup
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
