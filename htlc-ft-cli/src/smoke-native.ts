/**
 * Smoke test for native unshielded token flow on the split htlc + usdc
 * contracts. Validates the critical unknown: does midnight-js-contracts
 * auto-attach unshielded coin inputs when a circuit calls receiveUnshielded?
 *
 * Flow (Alice only, no Cardano):
 *   1. Deploy USDC, mint N USDC to Alice.
 *   2. Deploy HTLC.
 *   3. Alice calls htlc.deposit (color=USDC, amount=N, receiver=Alice,
 *      sender=Alice, expiry=short).
 *   4. Wait past expiry.
 *   5. Alice calls htlc.reclaimAfterExpiry(hash).
 *   6. Check htlcAmounts[hash] == 0 (sentinel completed).
 *
 * If step 3 fails with a coin-selection error, midnight-js-contracts does
 * NOT auto-attach unshielded inputs for receiveUnshielded, and Mirror
 * Cardano is blocked until we plumb coin selection through the provider.
 *
 * Usage: npx tsx src/smoke-native.ts
 */

import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { WebSocket } from 'ws';
import { createLogger } from './logger-utils.js';
import { MidnightWalletProvider } from './midnight-wallet-provider';
import { syncWallet, waitForUnshieldedFunds } from './wallet-utils';
import { generateDust } from './generate-dust';
import { NodeZkConfigProvider } from '@midnight-ntwrk/midnight-js-node-zk-config-provider';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { httpClientProofProvider } from '@midnight-ntwrk/midnight-js-http-client-proof-provider';
import { levelPrivateStateProvider } from '@midnight-ntwrk/midnight-js-level-private-state-provider';
import { deployContract } from '@midnight-ntwrk/midnight-js-contracts';
import { unshieldedToken } from '@midnight-ntwrk/ledger-v8';
import { type EnvironmentConfiguration } from '@midnight-ntwrk/testkit-js';
import { getMidnightEnv, applyMidnightNetwork } from './config';
import {
  CompiledUSDCContract,
  usdcPrivateStateKey,
  type USDCProviders,
  type USDCPrivateStateId,
  type EmptyPrivateState as USDCEmpty,
  type USDCCircuitKeys,
} from '../../contract/src/usdc-contract';
import {
  CompiledHTLCContract,
  htlcPrivateStateKey,
  type HTLCProviders,
  type HTLCPrivateStateId,
  type EmptyPrivateState as HTLCEmpty,
  type HTLCCircuitKeys,
} from '../../contract/src/htlc-contract';
import { ledger as usdcLedger } from '../../contract/src/managed/usdc/contract/index.js';
import { ledger as htlcLedger } from '../../contract/src/managed/htlc/contract/index.js';
import {
  type Either,
  type ContractAddress as CompactContractAddress,
  type UserAddress,
} from '../../contract/src/managed/htlc/contract/index.js';

// @ts-expect-error: Needed for WebSocket usage through apollo
globalThis.WebSocket = WebSocket;

const scriptDir = path.resolve(new URL(import.meta.url).pathname, '..');

const env: EnvironmentConfiguration = getMidnightEnv();

const TOKEN_NAME = 'USD Coin';
const TOKEN_SYMBOL = 'USDC';
const TOKEN_DECIMALS = 6n;
const MINT_AMOUNT = 100n;
const DEPOSIT_AMOUNT = 50n;
const EXPIRY_SECS = 20; // short so we can reclaim during the same run

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) out[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  return out;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function userAddrEither(userAddrHex: string): Either<CompactContractAddress, UserAddress> {
  return {
    is_left: false,
    left: { bytes: new Uint8Array(32) },
    right: { bytes: hexToBytes(userAddrHex) },
  };
}

function buildUsdcProviders(wp: MidnightWalletProvider, seed: string): USDCProviders {
  const zkConfigPath = path.resolve(scriptDir, '..', '..', 'contract', 'src', 'managed', 'usdc');
  const zk = new NodeZkConfigProvider<USDCCircuitKeys>(zkConfigPath);
  return {
    privateStateProvider: levelPrivateStateProvider<USDCPrivateStateId, USDCEmpty>({
      privateStateStoreName: 'usdc-smoke',
      signingKeyStoreName: 'usdc-smoke-keys',
      privateStoragePasswordProvider: () => 'Usdc-Smoke-Test-2026!',
      accountId: seed,
    }),
    publicDataProvider: indexerPublicDataProvider(env.indexer, env.indexerWS),
    zkConfigProvider: zk,
    proofProvider: httpClientProofProvider(env.proofServer, zk),
    walletProvider: wp,
    midnightProvider: wp,
  };
}

function buildHtlcProviders(wp: MidnightWalletProvider, seed: string): HTLCProviders {
  const zkConfigPath = path.resolve(scriptDir, '..', '..', 'contract', 'src', 'managed', 'htlc');
  const zk = new NodeZkConfigProvider<HTLCCircuitKeys>(zkConfigPath);
  return {
    privateStateProvider: levelPrivateStateProvider<HTLCPrivateStateId, HTLCEmpty>({
      privateStateStoreName: 'htlc-smoke',
      signingKeyStoreName: 'htlc-smoke-keys',
      privateStoragePasswordProvider: () => 'Htlc-Smoke-Test-2026!',
      accountId: seed,
    }),
    publicDataProvider: indexerPublicDataProvider(env.indexer, env.indexerWS),
    zkConfigProvider: zk,
    proofProvider: httpClientProofProvider(env.proofServer, zk),
    walletProvider: wp,
    midnightProvider: wp,
  };
}

async function main() {
  applyMidnightNetwork();

  const addresses = JSON.parse(
    fs.readFileSync(path.resolve(scriptDir, '..', 'address.json'), 'utf-8'),
  );
  const aliceSeed = addresses.alice.midnight.seed;
  const aliceUserAddrHex = addresses.alice.midnight.unshieldedAddressHex;

  const logDir = path.resolve(
    scriptDir,
    '..',
    'logs',
    'smoke-native',
    `${new Date().toISOString()}.log`,
  );
  const logger = await createLogger(logDir);

  console.log('▶ Smoke test: native unshielded token flow through split contracts\n');

  // Wallet
  console.log('Building Alice wallet…');
  const wp = await MidnightWalletProvider.build(logger, env, aliceSeed);
  await wp.start();
  const unshielded = await waitForUnshieldedFunds(logger, wp.wallet, env, unshieldedToken());
  await generateDust(logger, aliceSeed, unshielded, wp.wallet);

  // Per-run domain separator: Midnight contract addresses are deterministic
  // from constructor args + domainSep, so reusing the same seed across runs
  // collides with any prior deploy (ledger rejects as ContractAlreadyDeployed,
  // which surfaces as Substrate Custom error: 170).
  const domainSep = new Uint8Array(
    crypto.createHash('sha256').update(`midnight-usdc-smoke-v1-${Date.now()}`).digest(),
  );

  // Deploy USDC
  console.log('Deploying USDC…');
  const usdcProviders = buildUsdcProviders(wp, aliceSeed);
  const usdc = await deployContract(usdcProviders, {
    compiledContract: CompiledUSDCContract,
    privateStateId: usdcPrivateStateKey,
    initialPrivateState: {} as USDCEmpty,
    args: [TOKEN_NAME, TOKEN_SYMBOL, TOKEN_DECIMALS, domainSep],
  });
  const usdcAddr = usdc.deployTxData.public.contractAddress;
  console.log(`  USDC @ ${usdcAddr}`);

  // Mint to Alice
  const aliceEither = userAddrEither(aliceUserAddrHex);
  console.log(`Minting ${MINT_AMOUNT} USDC to Alice…`);
  await usdc.callTx.mint(aliceEither, MINT_AMOUNT);

  // Re-sync to make coins visible
  await syncWallet(logger, wp.wallet);

  // Read color from USDC state
  const usdcState = await usdcProviders.publicDataProvider.queryContractState(usdcAddr);
  if (!usdcState) throw new Error('USDC state not found');
  const usdcLed = usdcLedger(usdcState.data);
  const colorBytes = usdcLed._color;
  console.log(`  USDC color: ${bytesToHex(colorBytes)}`);

  // Deploy HTLC
  console.log('Deploying HTLC…');
  const htlcProviders = buildHtlcProviders(wp, aliceSeed);
  const htlc = await deployContract(htlcProviders, {
    compiledContract: CompiledHTLCContract,
    privateStateId: htlcPrivateStateKey,
    initialPrivateState: {} as HTLCEmpty,
  });
  const htlcAddr = htlc.deployTxData.public.contractAddress;
  console.log(`  HTLC @ ${htlcAddr}`);

  // Deposit: Alice locks USDC to herself with a short expiry
  const preimage = crypto.randomBytes(32);
  const hash = new Uint8Array(crypto.createHash('sha256').update(preimage).digest());
  const expiry = BigInt(Math.floor(Date.now() / 1000) + EXPIRY_SECS);
  const aliceAuth = hexToBytes(addresses.alice.midnight.coinPublicKey);

  console.log(`Depositing ${DEPOSIT_AMOUNT} USDC on HTLC (expiry in ${EXPIRY_SECS}s)…`);
  console.log(`  hash=${bytesToHex(hash).slice(0, 16)}…`);
  try {
    await htlc.callTx.deposit(
      colorBytes,
      DEPOSIT_AMOUNT as bigint,
      hash,
      expiry,
      aliceAuth,
      aliceEither,
      aliceEither,
    );
    console.log('  deposit OK — coin selection worked.');
  } catch (e) {
    console.error('\n✗ deposit FAILED:', (e as Error).message);
    console.error('\nThis likely means midnight-js-contracts does not auto-attach');
    console.error('unshielded coins for receiveUnshielded. Approach needs adjustment.');
    throw e;
  }

  // Wait past expiry then reclaim
  const waitMs = (EXPIRY_SECS + 5) * 1000;
  console.log(`Waiting ${waitMs / 1000}s for expiry…`);
  await new Promise((r) => setTimeout(r, waitMs));

  console.log('Reclaiming after expiry…');
  await htlc.callTx.reclaimAfterExpiry(hash);
  console.log('  reclaim OK.');

  // Verify sentinel
  const htlcState = await htlcProviders.publicDataProvider.queryContractState(htlcAddr);
  if (!htlcState) throw new Error('HTLC state not found');
  const htlcLed = htlcLedger(htlcState.data);
  const remaining = htlcLed.htlcAmounts.member(hash) ? htlcLed.htlcAmounts.lookup(hash) : -1n;
  console.log(`  htlcAmounts[hash] = ${remaining} (expected 0)`);
  if (remaining !== 0n) throw new Error(`Sentinel mismatch: got ${remaining}`);

  console.log('\n✓ Smoke test passed — native I/O works end-to-end.');

  await wp.stop();
  process.exit(0);
}

main().catch((e) => {
  console.error('\nSmoke test FAILED:', e);
  process.exit(1);
});
