/**
 * Mint native USDC (Zswap unshielded) coins to a participant's wallet.
 *
 * Usage:
 *   npx tsx src/mint-usdc.ts
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as readline from 'node:readline/promises';
import { WebSocket } from 'ws';
import { createLogger } from './logger-utils.js';
import { MidnightWalletProvider } from './midnight-wallet-provider';
import { waitForUnshieldedFunds } from './wallet-utils';
import { generateDust } from './generate-dust';
import { NodeZkConfigProvider } from '@midnight-ntwrk/midnight-js-node-zk-config-provider';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { httpClientProofProvider } from '@midnight-ntwrk/midnight-js-http-client-proof-provider';
import { levelPrivateStateProvider } from '@midnight-ntwrk/midnight-js-level-private-state-provider';
import { findDeployedContract } from '@midnight-ntwrk/midnight-js-contracts';
import { unshieldedToken } from '@midnight-ntwrk/ledger-v8';
import { type EnvironmentConfiguration } from '@midnight-ntwrk/testkit-js';
import { getMidnightEnv, applyMidnightNetwork } from './config';
import { type ContractAddress } from '@midnight-ntwrk/compact-runtime';
import {
  CompiledUSDCContract,
  usdcPrivateStateKey,
  type USDCProviders,
  type USDCPrivateStateId,
  type EmptyPrivateState,
  type USDCCircuitKeys,
} from '../../contract/src/usdc-contract';
import {
  type Either,
  type ContractAddress as CompactContractAddress,
  type UserAddress,
} from '../../contract/src/managed/usdc/contract/index.js';

// @ts-expect-error: Needed for WebSocket usage through apollo
globalThis.WebSocket = WebSocket;

const scriptDir = path.resolve(new URL(import.meta.url).pathname, '..');

const env: EnvironmentConfiguration = getMidnightEnv();

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

async function main() {
  applyMidnightNetwork();

  const rli = readline.createInterface({ input: process.stdin, output: process.stdout });

  const addresses = JSON.parse(fs.readFileSync(path.resolve(scriptDir, '..', 'address.json'), 'utf-8'));
  const swapStatePath = path.resolve(scriptDir, '..', 'swap-state.json');
  if (!fs.existsSync(swapStatePath)) {
    console.error('ERROR: swap-state.json not found. Run setup-contract.ts first.');
    process.exit(1);
  }
  const swapState = JSON.parse(fs.readFileSync(swapStatePath, 'utf-8'));

  console.log(`USDC Contract: ${swapState.usdcContractAddress}`);
  console.log(`Token:         ${swapState.tokenName} (${swapState.tokenSymbol})\n`);

  const participants = Object.keys(addresses);
  console.log('Available participants:');
  participants.forEach((p, i) => console.log(`  ${i + 1}. ${p}`));
  const minterIdx = parseInt(await rli.question('\nMint as (number): ') || '1') - 1;
  const minterName = participants[minterIdx];

  const recipientIdx = parseInt(await rli.question('Mint to (number): ') || String(minterIdx + 1)) - 1;
  const recipientName = participants[recipientIdx];

  const amount = BigInt(await rli.question('Amount to mint: ') || '10000');

  const logDir = path.resolve(scriptDir, '..', 'logs', 'mint-usdc', `${new Date().toISOString()}.log`);
  const logger = await createLogger(logDir);

  const minterSeed = addresses[minterName].midnight.seed;
  const walletProvider = await MidnightWalletProvider.build(logger, env, minterSeed);
  await walletProvider.start();
  const unshielded = await waitForUnshieldedFunds(logger, walletProvider.wallet, env, unshieldedToken());
  await generateDust(logger, minterSeed, unshielded, walletProvider.wallet);

  const zkConfigPath = path.resolve(scriptDir, '..', '..', 'contract', 'src', 'managed', 'usdc');
  const zkConfig = new NodeZkConfigProvider<USDCCircuitKeys>(zkConfigPath);
  const providers: USDCProviders = {
    privateStateProvider: levelPrivateStateProvider<USDCPrivateStateId, EmptyPrivateState>({
      privateStateStoreName: `usdc-mint-${minterName}`,
      signingKeyStoreName: `usdc-mint-${minterName}-keys`,
      privateStoragePasswordProvider: () => 'Usdc-Mint-Helper-2026!',
      accountId: minterSeed,
    }),
    publicDataProvider: indexerPublicDataProvider(env.indexer, env.indexerWS),
    zkConfigProvider: zkConfig,
    proofProvider: httpClientProofProvider(env.proofServer, zkConfig),
    walletProvider: walletProvider,
    midnightProvider: walletProvider,
  };

  const contract = await findDeployedContract(providers, {
    contractAddress: swapState.usdcContractAddress as ContractAddress,
    compiledContract: CompiledUSDCContract,
    privateStateId: usdcPrivateStateKey,
    initialPrivateState: {} as EmptyPrivateState,
  });

  const recipient = userEither(addresses[recipientName].midnight.unshieldedAddressHex);
  console.log(`\nMinting ${amount} ${swapState.tokenSymbol} to ${recipientName}...`);
  await contract.callTx.mint(recipient, amount);
  console.log('Done!');

  rli.close();
  await walletProvider.stop();
  process.exit(0);
}

main().catch((e) => {
  console.error('Mint failed:', e);
  process.exit(1);
});
