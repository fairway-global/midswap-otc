/**
 * Regenerate ONLY the Midnight seeds + addresses in address.json, preserving
 * Cardano entries. Uses the same derivation the runtime wallet uses internally
 * (wallet-sdk-unshielded-wallet createKeystore with Roles.NightExternal).
 *
 * Usage:
 *   npx tsx src/regenerate-midnight-keys.ts                 # regenerate all seeds
 *   npx tsx src/regenerate-midnight-keys.ts --only <name>   # regenerate just one participant
 *   npx tsx src/regenerate-midnight-keys.ts --verify <seedHex> <expectedBech32>
 *     # verify the derivation against a known seed/address pair (sanity check)
 */

import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { HDWallet, Roles } from '@midnight-ntwrk/wallet-sdk-hd';
import { createKeystore } from '@midnight-ntwrk/wallet-sdk-unshielded-wallet';

const scriptDir = path.resolve(new URL(import.meta.url).pathname, '..');

function getUnshieldedSeed(seedHex: string): Uint8Array {
  const seedBuffer = Buffer.from(seedHex, 'hex');
  const result = HDWallet.fromSeed(seedBuffer) as { type: string; hdWallet: HDWallet };
  const derivation = result.hdWallet.selectAccount(0).selectRole(Roles.NightExternal).deriveKeyAt(0);
  if ((derivation as any).type === 'keyOutOfBounds') throw new Error('HD key derivation out of bounds');
  return (derivation as any).key as Uint8Array;
}

function deriveMidnightBundle(seedHex: string) {
  const secretKey = getUnshieldedSeed(seedHex);
  const preprodKS = createKeystore(secretKey, 'preprod');
  const undeployedKS = createKeystore(secretKey, 'undeployed');
  return {
    coinPublicKey: preprodKS.getPublicKey(),
    undeployedAddress: undeployedKS.getBech32Address().asString(),
    preprodAddress: preprodKS.getBech32Address().asString(),
    unshieldedAddressHex: preprodKS.getAddress(),
  };
}

function verifyMode(seedHex: string, expectedBech32: string): void {
  const bundle = deriveMidnightBundle(seedHex);
  console.log(`seed:           ${seedHex}`);
  console.log(`derived preprod: ${bundle.preprodAddress}`);
  console.log(`expected:        ${expectedBech32}`);
  console.log(`unshieldedHex:   ${bundle.unshieldedAddressHex}`);
  console.log(`coinPublicKey:   ${bundle.coinPublicKey}`);
  if (bundle.preprodAddress === expectedBech32) {
    console.log('\nMATCH — derivation is correct.');
    process.exit(0);
  } else {
    console.log('\nMISMATCH — derivation does NOT match the wallet.');
    process.exit(1);
  }
}

function main(): void {
  const args = process.argv.slice(2);
  if (args[0] === '--verify' && args.length === 3) {
    verifyMode(args[1], args[2]);
    return;
  }

  let only: string | undefined;
  const onlyIdx = args.indexOf('--only');
  if (onlyIdx !== -1) {
    only = args[onlyIdx + 1]?.toLowerCase();
    if (!only) {
      console.error('--only requires a participant name (e.g. alice, bob, charlie)');
      process.exit(1);
    }
  }

  const addressPath = path.resolve(scriptDir, '..', 'address.json');
  const addresses = JSON.parse(fs.readFileSync(addressPath, 'utf-8'));

  const targets = only ? [only] : Object.keys(addresses);
  if (only && !(only in addresses)) {
    console.error(`Participant "${only}" not found in ${addressPath}. Known: ${Object.keys(addresses).join(', ')}`);
    process.exit(1);
  }

  for (const name of targets) {
    const oldSeed = addresses[name]?.midnight?.seed ?? '<none>';
    const newSeed = crypto.randomBytes(32).toString('hex');
    const bundle = deriveMidnightBundle(newSeed);
    addresses[name].midnight = { seed: newSeed, ...bundle };

    console.log(`${name.toUpperCase()}`);
    console.log(`  old seed: ${oldSeed}`);
    console.log(`  new seed: ${newSeed}`);
    console.log(`  preprod:  ${bundle.preprodAddress}`);
    console.log();
  }

  fs.writeFileSync(addressPath, JSON.stringify(addresses, null, 2) + '\n');
  console.log(`Written to ${addressPath}`);
  console.log('\n=== Faucet NIGHT to these NEW preprod addresses ===');
  for (const name of targets) {
    console.log(`  ${name}: ${addresses[name].midnight.preprodAddress}`);
  }
  console.log('\nFaucet URL: https://faucet.preprod.midnight.network/');
}

main();
