/**
 * Fund Alice, Bob, and Charlie's Midnight wallets with tNight from the
 * local-dev genesis wallet (seed 0...01).
 *
 * Also patches address.json with the correct unshielded addresses.
 *
 * Usage:
 *   node --loader ts-node/esm src/mint-tnight.ts
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { createLogger } from './logger-utils.js';
import { MidnightWalletProvider } from './midnight-wallet-provider';
import { syncWallet, waitForUnshieldedFunds } from './wallet-utils';
import { UnshieldedAddress, MidnightBech32m } from '@midnight-ntwrk/wallet-sdk-address-format';
import { unshieldedToken, ZswapSecretKeys, DustSecretKey } from '@midnight-ntwrk/ledger-v8';
import { setNetworkId, getNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import { ttlOneHour } from '@midnight-ntwrk/midnight-js-utils';
import { type EnvironmentConfiguration } from '@midnight-ntwrk/testkit-js';
import { type CombinedTokenTransfer } from '@midnight-ntwrk/wallet-sdk-facade';
import { HDWallet, Roles } from '@midnight-ntwrk/wallet-sdk-hd';
import { createKeystore } from '@midnight-ntwrk/wallet-sdk-unshielded-wallet';

const scriptDir = path.resolve(new URL(import.meta.url).pathname, '..');

const GENESIS_SEED = '0000000000000000000000000000000000000000000000000000000000000001';
const AMOUNT_PER_WALLET = 1_000_000_000n;

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

/** Derive the unshielded seed (NightExternal role) from a master seed. */
function getUnshieldedSeed(masterSeedHex: string): Uint8Array {
  const seedBuffer = Buffer.from(masterSeedHex, 'hex');
  const result = HDWallet.fromSeed(seedBuffer) as { type: string; hdWallet: HDWallet };
  const derivation = result.hdWallet.selectAccount(0).selectRole(Roles.NightExternal).deriveKeyAt(0);
  if ((derivation as any).type === 'keyOutOfBounds') throw new Error('HD key derivation out of bounds');
  return (derivation as any).key as Uint8Array;
}

/** Get the correct unshielded bech32 address for a master seed. */
function getUnshieldedAddress(masterSeedHex: string, networkId: string): { bech32: string; hex: string } {
  const unshieldedSeed = getUnshieldedSeed(masterSeedHex);
  const keystore = createKeystore(unshieldedSeed, networkId);
  const bech32 = keystore.getBech32Address().toString();
  const hex = keystore.getAddress();
  return { bech32, hex };
}

async function main() {
  setNetworkId('undeployed');

  const addressPath = path.resolve(scriptDir, '..', 'address.json');
  const addresses = JSON.parse(fs.readFileSync(addressPath, 'utf-8'));

  const logDir = path.resolve(scriptDir, '..', 'logs', 'mint-tnight', `${new Date().toISOString()}.log`);
  const logger = await createLogger(logDir);

  // Derive correct unshielded addresses and update address.json
  console.log('Deriving correct unshielded wallet addresses...\n');
  const recipients: { name: string; address: UnshieldedAddress; bech32: string }[] = [];

  for (const [name, wallets] of Object.entries(addresses) as [string, any][]) {
    const seed = wallets.midnight.seed;
    const undeployed = getUnshieldedAddress(seed, 'undeployed');
    const preprod = getUnshieldedAddress(seed, 'preprod');

    // Patch address.json with correct addresses
    wallets.midnight.undeployedAddress = undeployed.bech32;
    wallets.midnight.preprodAddress = preprod.bech32;
    wallets.midnight.unshieldedAddressHex = undeployed.hex;

    // Parse for transfer
    const parsed = MidnightBech32m.parse(undeployed.bech32);
    const addr = UnshieldedAddress.codec.decode(getNetworkId(), parsed);
    recipients.push({ name, address: addr, bech32: undeployed.bech32 });

    console.log(`  ${name}: ${undeployed.bech32}`);
  }

  // Save updated address.json
  fs.writeFileSync(addressPath, JSON.stringify(addresses, null, 2) + '\n');
  console.log('\nUpdated address.json with correct unshielded addresses.');

  // Build genesis wallet
  console.log('\nBuilding genesis wallet...');
  const walletProvider = await MidnightWalletProvider.build(logger, env, GENESIS_SEED);

  console.log('Starting genesis wallet and syncing...');
  await walletProvider.start();
  const state = await waitForUnshieldedFunds(logger, walletProvider.wallet, env, unshieldedToken());
  const balance = state.balances[unshieldedToken().raw] ?? 0n;
  console.log(`Genesis wallet balance: ${balance} tNight\n`);

  // Build transfer
  const tokenType = unshieldedToken().raw;
  const outputs: CombinedTokenTransfer[] = [
    {
      type: 'unshielded' as const,
      outputs: recipients.map((r) => ({
        type: tokenType,
        receiverAddress: r.address,
        amount: AMOUNT_PER_WALLET,
      })),
    },
  ];

  console.log(`Transferring ${AMOUNT_PER_WALLET} tNight to each of ${recipients.length} wallets...`);

  const recipe = await walletProvider.wallet.transferTransaction(
    outputs,
    {
      shieldedSecretKeys: walletProvider.zswapSecretKeys,
      dustSecretKey: walletProvider.dustSecretKey,
    },
    { ttl: ttlOneHour(), payFees: true },
  );

  const signedRecipe = await walletProvider.wallet.signRecipe(
    recipe,
    (payload) => walletProvider.unshieldedKeystore.signData(payload),
  );
  const finalized = await walletProvider.wallet.finalizeRecipe(signedRecipe);
  const txId = await walletProvider.wallet.submitTransaction(finalized);
  console.log(`Transfer tx submitted: ${txId}`);

  console.log('Waiting for confirmation...');
  await syncWallet(logger, walletProvider.wallet);

  const newState = await walletProvider.wallet.unshielded.waitForSyncedState();
  const newBalance = newState.balances[unshieldedToken().raw] ?? 0n;
  console.log(`\nGenesis wallet remaining balance: ${newBalance} tNight`);
  console.log('Done! Run check-midnight-balance.ts to verify.');

  await walletProvider.stop();
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
