/**
 * Check Midnight tNight balances for all participants in address.json.
 *
 * Usage:
 *   node --loader ts-node/esm src/check-midnight-balance.ts
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { createLogger } from './logger-utils.js';
import { MidnightWalletProvider } from './midnight-wallet-provider';
import { syncWallet } from './wallet-utils';
import { unshieldedToken } from '@midnight-ntwrk/ledger-v8';
import { setNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import { type EnvironmentConfiguration } from '@midnight-ntwrk/testkit-js';

const scriptDir = path.resolve(new URL(import.meta.url).pathname, '..');

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

async function main() {
  setNetworkId('undeployed');

  const addressPath = path.resolve(scriptDir, '..', 'address.json');
  const addresses = JSON.parse(fs.readFileSync(addressPath, 'utf-8'));

  const logDir = path.resolve(scriptDir, '..', 'logs', 'check-balance', `${new Date().toISOString()}.log`);
  const logger = await createLogger(logDir);

  console.log('=== Midnight (undeployed) tNight Balances ===\n');

  const tokenType = unshieldedToken().raw;

  for (const [name, wallets] of Object.entries(addresses) as [string, any][]) {
    const seed = wallets.midnight.seed;

    const walletProvider = await MidnightWalletProvider.build(logger, env, seed);
    await walletProvider.start();

    // Wait for full blockchain sync before reading balance
    const syncedState = await syncWallet(logger, walletProvider.wallet);
    const balance = syncedState.unshielded.balances[tokenType] ?? 0n;

    console.log(`${name.toUpperCase()}`);
    console.log(`  Address:  ${wallets.midnight.undeployedAddress}`);
    console.log(`  Balance:  ${balance} tNight`);
    console.log();

    await walletProvider.stop();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
