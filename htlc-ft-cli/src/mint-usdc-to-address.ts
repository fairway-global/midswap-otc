/**
 * One-off: mint native USDC to an arbitrary Midnight unshielded bech32m address.
 *
 * Decodes the bech32m recipient into its 32-byte UserAddress payload and calls
 * the deployed USDC contract's `mint` circuit. Alice is used as the minter
 * (she has funded dust on preprod from prior runs).
 *
 * Usage:
 *   MIDNIGHT_NETWORK=preprod npx tsx src/mint-usdc-to-address.ts
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
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
import {
  MidnightBech32m,
  UnshieldedAddress,
} from '@midnight-ntwrk/wallet-sdk-address-format';
import { getNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
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

const RECIPIENT_ADDRESS =
  'mn_addr_preprod1zyq98pvm6wljtrs2xn3kdc9hm43ersakjq76tjhvegfqqg88mzmqnrkhcw';
const AMOUNT = 10000n;
const MINTER = 'alice';

function toHex(b: Uint8Array): string {
  return Buffer.from(b).toString('hex');
}

function userEither(
  userAddrBytes: Uint8Array,
): Either<CompactContractAddress, UserAddress> {
  return {
    is_left: false,
    left: { bytes: new Uint8Array(32) },
    right: { bytes: userAddrBytes },
  };
}

async function main() {
  applyMidnightNetwork();

  const parsed = MidnightBech32m.parse(RECIPIENT_ADDRESS);
  const addr = UnshieldedAddress.codec.decode(getNetworkId(), parsed);
  const addrBytes = new Uint8Array(addr.data);
  if (addrBytes.length !== 32) {
    throw new Error(
      `Decoded UnshieldedAddress has ${addrBytes.length} bytes, expected 32`,
    );
  }

  const addresses = JSON.parse(
    fs.readFileSync(path.resolve(scriptDir, '..', 'address.json'), 'utf-8'),
  );
  const swapStatePath = path.resolve(scriptDir, '..', 'swap-state.json');
  if (!fs.existsSync(swapStatePath)) {
    console.error('ERROR: swap-state.json not found. Run setup-contract.ts first.');
    process.exit(1);
  }
  const swapState = JSON.parse(fs.readFileSync(swapStatePath, 'utf-8'));

  console.log(`Network:       ${getNetworkId()}`);
  console.log(`Recipient:     ${RECIPIENT_ADDRESS}`);
  console.log(`Recipient hex: ${toHex(addrBytes)}`);
  console.log(`USDC Contract: ${swapState.usdcContractAddress}`);
  console.log(`Token:         ${swapState.tokenName} (${swapState.tokenSymbol})`);
  console.log(`Minter:        ${MINTER}`);
  console.log(`Amount:        ${AMOUNT} ${swapState.tokenSymbol}\n`);

  const logDir = path.resolve(
    scriptDir,
    '..',
    'logs',
    'mint-usdc-to-address',
    `${new Date().toISOString()}.log`,
  );
  const logger = await createLogger(logDir);

  const minterSeed = addresses[MINTER].midnight.seed;
  const walletProvider = await MidnightWalletProvider.build(logger, env, minterSeed);
  await walletProvider.start();
  const unshielded = await waitForUnshieldedFunds(
    logger,
    walletProvider.wallet,
    env,
    unshieldedToken(),
  );
  await generateDust(logger, minterSeed, unshielded, walletProvider.wallet);

  const zkConfigPath = path.resolve(
    scriptDir,
    '..',
    '..',
    'contract',
    'src',
    'managed',
    'usdc',
  );
  const zkConfig = new NodeZkConfigProvider<USDCCircuitKeys>(zkConfigPath);
  const providers: USDCProviders = {
    privateStateProvider: levelPrivateStateProvider<USDCPrivateStateId, EmptyPrivateState>({
      privateStateStoreName: `usdc-mint-custom-${MINTER}`,
      signingKeyStoreName: `usdc-mint-custom-${MINTER}-keys`,
      privateStoragePasswordProvider: () => 'Usdc-Mint-Custom-2026!',
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

  const recipient = userEither(addrBytes);
  console.log(`Minting ${AMOUNT} ${swapState.tokenSymbol} to ${RECIPIENT_ADDRESS}...`);
  const result = await contract.callTx.mint(recipient, AMOUNT);
  const txId = (result as any)?.public?.txId ?? (result as any)?.txId ?? '<submitted>';
  console.log(`Mint submitted. txId: ${txId}`);

  await walletProvider.stop();
  process.exit(0);
}

main().catch((e) => {
  console.error('Mint failed:', e);
  process.exit(1);
});
