/**
 * One-time contract setup: deploy USDC + HTLC, mint native USDC coins to
 * each participant's wallet.
 *
 * USDC is a native unshielded token (Zswap coin). After minting, coins
 * live directly in user wallets and transfer at the Zswap layer — no
 * internal balance map. The HTLC is a pure color-parametric escrow.
 *
 * Both addresses and the USDC token color are saved to swap-state.json
 * for use by alice-swap / bob-swap / execute-swap.
 *
 * Usage:
 *   npx tsx src/setup-contract.ts
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
import { getMidnightEnv, applyMidnightNetwork, getMidnightNetwork } from './config';
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
import { ledger as usdcLedger } from '../../contract/src/managed/usdc/contract/index.js';
import {
  type Either,
  type ContractAddress as CompactContractAddress,
  type UserAddress,
} from '../../contract/src/managed/usdc/contract/index.js';

// @ts-expect-error: Needed for WebSocket usage through apollo
globalThis.WebSocket = WebSocket;

const scriptDir = path.resolve(new URL(import.meta.url).pathname, '..');

const env: EnvironmentConfiguration = getMidnightEnv();

const TOKEN_NAME = 'USD Coin';
const TOKEN_SYMBOL = 'USDC';
const TOKEN_DECIMALS = 6n;
const DOMAIN_SEP_SOURCE = 'midnight-usdc-v1';
const MINT_PER_PARTICIPANT = 10_000n; // 10,000 USDC each

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) out[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  return out;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function userEither(userAddrHex: string): Either<CompactContractAddress, UserAddress> {
  return {
    is_left: false,
    left: { bytes: new Uint8Array(32) },
    right: { bytes: hexToBytes(userAddrHex) },
  };
}

function buildHtlcProviders(wp: MidnightWalletProvider, seed: string): HTLCProviders {
  const zkConfigPath = path.resolve(scriptDir, '..', '..', 'contract', 'src', 'managed', 'htlc');
  const zk = new NodeZkConfigProvider<HTLCCircuitKeys>(zkConfigPath);
  return {
    privateStateProvider: levelPrivateStateProvider<HTLCPrivateStateId, HTLCEmpty>({
      privateStateStoreName: 'htlc-setup',
      signingKeyStoreName: 'htlc-setup-keys',
      privateStoragePasswordProvider: () => 'Htlc-Setup-Admin-2026!',
      accountId: seed,
    }),
    publicDataProvider: indexerPublicDataProvider(env.indexer, env.indexerWS),
    zkConfigProvider: zk,
    proofProvider: httpClientProofProvider(env.proofServer, zk),
    walletProvider: wp,
    midnightProvider: wp,
  };
}

function buildUsdcProviders(wp: MidnightWalletProvider, seed: string): USDCProviders {
  const zkConfigPath = path.resolve(scriptDir, '..', '..', 'contract', 'src', 'managed', 'usdc');
  const zk = new NodeZkConfigProvider<USDCCircuitKeys>(zkConfigPath);
  return {
    privateStateProvider: levelPrivateStateProvider<USDCPrivateStateId, USDCEmpty>({
      privateStateStoreName: 'usdc-setup',
      signingKeyStoreName: 'usdc-setup-keys',
      privateStoragePasswordProvider: () => 'Usdc-Setup-Admin-2026!',
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

  const addressPath = path.resolve(scriptDir, '..', 'address.json');
  const addresses = JSON.parse(fs.readFileSync(addressPath, 'utf-8'));
  const adminSeed = addresses.alice.midnight.seed; // Alice acts as admin

  const logDir = path.resolve(scriptDir, '..', 'logs', 'setup', `${new Date().toISOString()}.log`);
  const logger = await createLogger(logDir);

  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║     Contract Setup — USDC + HTLC (split) on Midnight    ║');
  console.log('╚══════════════════════════════════════════════════════════╝\n');

  // Admin wallet
  console.log('Building admin wallet (Alice)...');
  const wp = await MidnightWalletProvider.build(logger, env, adminSeed);
  await wp.start();
  const unshielded = await waitForUnshieldedFunds(logger, wp.wallet, env, unshieldedToken());

  console.log('Generating dust...');
  await generateDust(logger, adminSeed, unshielded, wp.wallet);

  // Deploy USDC
  const domainSep = new Uint8Array(
    crypto.createHash('sha256').update(DOMAIN_SEP_SOURCE).digest(),
  );
  console.log(`\nDeploying USDC (${TOKEN_NAME} / ${TOKEN_SYMBOL})...`);
  const usdcProviders = buildUsdcProviders(wp, adminSeed);
  const usdc = await deployContract(usdcProviders, {
    compiledContract: CompiledUSDCContract,
    privateStateId: usdcPrivateStateKey,
    initialPrivateState: {} as USDCEmpty,
    args: [TOKEN_NAME, TOKEN_SYMBOL, TOKEN_DECIMALS, domainSep],
  });
  const usdcAddr = usdc.deployTxData.public.contractAddress;
  console.log(`  USDC @ ${usdcAddr}`);

  // Mint USDC to each participant
  for (const [name, wallets] of Object.entries(addresses) as [string, any][]) {
    const userAddrHex = wallets.midnight.unshieldedAddressHex;
    const recipient = userEither(userAddrHex);
    console.log(`Minting ${MINT_PER_PARTICIPANT} USDC to ${name}...`);
    await usdc.callTx.mint(recipient, MINT_PER_PARTICIPANT);
  }

  // Read color from USDC state
  await syncWallet(logger, wp.wallet);
  const usdcState = await usdcProviders.publicDataProvider.queryContractState(usdcAddr);
  if (!usdcState) throw new Error('USDC state not found after mint');
  const usdcLed = usdcLedger(usdcState.data);
  const usdcColor = bytesToHex(usdcLed._color);
  console.log(`  USDC color: ${usdcColor}`);

  // Deploy HTLC (no constructor args)
  console.log('\nDeploying HTLC (pure escrow)...');
  const htlcProviders = buildHtlcProviders(wp, adminSeed);
  const htlc = await deployContract(htlcProviders, {
    compiledContract: CompiledHTLCContract,
    privateStateId: htlcPrivateStateKey,
    initialPrivateState: {} as HTLCEmpty,
  });
  const htlcAddr = htlc.deployTxData.public.contractAddress;
  console.log(`  HTLC @ ${htlcAddr}`);

  // Save swap state
  const swapStatePath = path.resolve(scriptDir, '..', 'swap-state.json');
  const swapState = {
    htlcContractAddress: htlcAddr,
    usdcContractAddress: usdcAddr,
    usdcColor,
    tokenName: TOKEN_NAME,
    tokenSymbol: TOKEN_SYMBOL,
    tokenDecimals: Number(TOKEN_DECIMALS),
    domainSepHex: bytesToHex(domainSep),
    deployedAt: new Date().toISOString(),
    network: getMidnightNetwork(),
  };
  fs.writeFileSync(swapStatePath, JSON.stringify(swapState, null, 2) + '\n');
  console.log(`\nSaved contract state to swap-state.json`);

  console.log('\n╔══════════════════════════════════════════════════════════╗');
  console.log('║                    SETUP COMPLETE                       ║');
  console.log('╠══════════════════════════════════════════════════════════╣');
  console.log(`║  HTLC:   ${htlcAddr.slice(0, 20)}...`);
  console.log(`║  USDC:   ${usdcAddr.slice(0, 20)}...`);
  console.log(`║  Color:  ${usdcColor.slice(0, 20)}...`);
  console.log(`║  Token:  ${TOKEN_NAME} (${TOKEN_SYMBOL})`);
  console.log(`║  Minted: ${MINT_PER_PARTICIPANT} USDC to each participant`);
  console.log('╠══════════════════════════════════════════════════════════╣');
  console.log('║  Next: npm run swap:alice  /  npm run swap:bob          ║');
  console.log('╚══════════════════════════════════════════════════════════╝');

  await wp.stop();
  process.exit(0);
}

main().catch((e) => {
  console.error('Setup failed:', e);
  process.exit(1);
});
