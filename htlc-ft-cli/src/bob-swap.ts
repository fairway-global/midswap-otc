/**
 * Bob's Cross-Chain Atomic Swap (Responder).
 *
 * Bob trades native USDC on Midnight for ADA:
 *   1. Watch Cardano for Alice's ADA lock (learn the hash).
 *   2. Deposit native USDC on Midnight HTLC (same hash, shorter deadline
 *      than Alice's Cardano deadline).
 *   3. Watch Midnight for the preimage reveal (Alice claims USDC, writing
 *      the preimage into revealedPreimages).
 *   4. Claim ADA on Cardano using the revealed preimage.
 *
 * Usage:
 *   npx tsx src/bob-swap.ts
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as readline from 'node:readline/promises';
import { WebSocket } from 'ws';
import { createLogger } from './logger-utils.js';
import { MidnightWalletProvider } from './midnight-wallet-provider';
import { syncWallet, waitForUnshieldedFunds } from './wallet-utils';
import { generateDust } from './generate-dust';
import { watchForCardanoLock } from './cardano-watcher';
import { watchForPreimageReveal } from './midnight-watcher';
import { NodeZkConfigProvider } from '@midnight-ntwrk/midnight-js-node-zk-config-provider';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { httpClientProofProvider } from '@midnight-ntwrk/midnight-js-http-client-proof-provider';
import { levelPrivateStateProvider } from '@midnight-ntwrk/midnight-js-level-private-state-provider';
import { findDeployedContract } from '@midnight-ntwrk/midnight-js-contracts';
import { unshieldedToken } from '@midnight-ntwrk/ledger-v8';
import { setNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import { type EnvironmentConfiguration } from '@midnight-ntwrk/testkit-js';
import { type ContractAddress } from '@midnight-ntwrk/compact-runtime';
import {
  CompiledHTLCContract,
  htlcPrivateStateKey,
  type HTLCProviders,
  type HTLCPrivateStateId,
  type EmptyPrivateState,
  type HTLCCircuitKeys,
} from '../../contract/src/htlc-contract';
import {
  type Either,
  type ContractAddress as CompactContractAddress,
  type UserAddress,
} from '../../contract/src/managed/htlc/contract/index.js';

// @ts-expect-error: Needed for WebSocket usage through apollo
globalThis.WebSocket = WebSocket;

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

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  }
  return bytes;
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

function buildHtlcProviders(walletProvider: MidnightWalletProvider, seed: string): HTLCProviders {
  const zkConfigPath = path.resolve(scriptDir, '..', '..', 'contract', 'src', 'managed', 'htlc');
  const zkConfig = new NodeZkConfigProvider<HTLCCircuitKeys>(zkConfigPath);
  return {
    privateStateProvider: levelPrivateStateProvider<HTLCPrivateStateId, EmptyPrivateState>({
      privateStateStoreName: 'htlc-bob',
      signingKeyStoreName: 'htlc-bob-signing-keys',
      privateStoragePasswordProvider: () => 'Htlc-Bob-Swap-2026!',
      accountId: seed,
    }),
    publicDataProvider: indexerPublicDataProvider(env.indexer, env.indexerWS),
    zkConfigProvider: zkConfig,
    proofProvider: httpClientProofProvider(env.proofServer, zkConfig),
    walletProvider: walletProvider,
    midnightProvider: walletProvider,
  };
}

async function main() {
  loadEnv();
  setNetworkId('undeployed');

  // Non-interactive mode: `--yes` flag or BOB_ACCEPT_ALL=1 env var auto-accepts the
  // swap and uses the default USDC amount (floor of ADA locked). Needed for two-
  // terminal tests driven from tmux/CI where stdin isn't a TTY.
  const autoAccept = process.argv.includes('--yes') || process.env.BOB_ACCEPT_ALL === '1';
  const rli = autoAccept
    ? null
    : readline.createInterface({ input: process.stdin, output: process.stdout });

  const addresses = JSON.parse(fs.readFileSync(path.resolve(scriptDir, '..', 'address.json'), 'utf-8'));
  const swapStatePath = path.resolve(scriptDir, '..', 'swap-state.json');
  if (!fs.existsSync(swapStatePath)) {
    console.error('ERROR: swap-state.json not found. Run setup-contract.ts first.');
    process.exit(1);
  }
  const swapState = JSON.parse(fs.readFileSync(swapStatePath, 'utf-8'));

  const blockfrostApiKey = process.env.BLOCKFROST_API_KEY;
  if (!blockfrostApiKey) {
    console.error('ERROR: Set BLOCKFROST_API_KEY in .env');
    process.exit(1);
  }

  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║          BOB — Cross-Chain Swap (Responder)             ║');
  console.log('║          USDC (Midnight, native) → ADA (Cardano)        ║');
  console.log('╚══════════════════════════════════════════════════════════╝\n');
  console.log(`HTLC Contract: ${swapState.htlcContractAddress}`);
  console.log(`USDC Contract: ${swapState.usdcContractAddress}`);
  console.log(`USDC Color:    ${swapState.usdcColor}\n`);

  const logDir = path.resolve(scriptDir, '..', 'logs', 'bob-swap', `${new Date().toISOString()}.log`);
  const logger = await createLogger(logDir);

  // ── Build wallets ──
  console.log('── Building wallets ──');

  console.log('Building Midnight wallet...');
  const bobSeed = addresses.bob.midnight.seed;
  const walletProvider = await MidnightWalletProvider.build(logger, env, bobSeed);
  await walletProvider.start();
  const unshielded = await waitForUnshieldedFunds(logger, walletProvider.wallet, env, unshieldedToken());
  const dustTx = await generateDust(logger, bobSeed, unshielded, walletProvider.wallet);
  if (dustTx) await syncWallet(logger, walletProvider.wallet);

  console.log('Joining HTLC contract on Midnight...');
  const providers = buildHtlcProviders(walletProvider, bobSeed);
  const contract = await findDeployedContract(providers, {
    contractAddress: swapState.htlcContractAddress as ContractAddress,
    compiledContract: CompiledHTLCContract,
    privateStateId: htlcPrivateStateKey,
    initialPrivateState: {} as EmptyPrivateState,
  });
  console.log('Joined HTLC contract.');

  console.log('Building Cardano wallet...');
  const { CardanoHTLC: CardanoHTLCClass } = await import('./cardano-htlc');
  const bobCardano = await CardanoHTLCClass.init({
    blockfrostUrl: 'https://cardano-preprod.blockfrost.io/api/v0',
    blockfrostApiKey,
    network: 'Preprod' as const,
    blueprintPath: path.resolve(scriptDir, '..', '..', 'cardano', 'plutus.json'),
  }, logger);
  bobCardano.selectWalletFromSeed(addresses.bob.cardano.mnemonic);
  const adaBal = await bobCardano.getBalance();
  console.log(`Cardano balance: ${Number(adaBal) / 1e6} ADA\n`);

  // ── Watch Cardano for Alice's ADA lock ──
  console.log("── Watching Cardano for Alice's HTLC lock ──");
  console.log('(Alice should run alice-swap.ts now)\n');

  const bobPkh = addresses.bob.cardano.paymentKeyHash;
  const htlcInfo = await watchForCardanoLock(bobCardano, bobPkh);

  const adaLocked = Number(htlcInfo.amountLovelace) / 1_000_000;
  const deadlineDate = new Date(Number(htlcInfo.deadlineMs));

  console.log(`\n  Alice locked ${adaLocked} ADA for you.`);
  console.log(`  Deadline: ${deadlineDate.toISOString()}`);

  const defaultUsdc = String(Math.floor(adaLocked));
  let usdcAmountStr: string;
  if (autoAccept) {
    console.log('  Auto-accepting swap (--yes).');
    console.log(`  USDC amount to deposit: ${defaultUsdc} (default)`);
    usdcAmountStr = defaultUsdc;
  } else {
    const accept = (await rli!.question('\n  Accept this swap? [Y/n]: ')) || 'y';
    if (accept.toLowerCase() !== 'y') {
      console.log('Swap rejected. Exiting.');
      process.exit(0);
    }
    usdcAmountStr =
      (await rli!.question(`  USDC amount to deposit [${defaultUsdc}]: `)) || defaultUsdc;
  }
  const usdcAmount = BigInt(usdcAmountStr);

  // ── Deposit USDC on Midnight HTLC ──
  console.log('\n── Depositing native USDC on Midnight HTLC ──');

  const hashLock = hexToBytes(htlcInfo.hashHex);

  // Bob's Midnight deadline MUST be shorter than Alice's Cardano deadline by a
  // safety margin large enough to cover: (a) Alice claiming USDC on Midnight
  // before Bob's deadline, (b) the preimage reveal appearing in the Midnight
  // indexer, (c) Bob observing it, (d) Bob building + submitting a Cardano
  // claim tx, and (e) Cardano confirming it — all before the Cardano deadline.
  const SAFETY_BUFFER_SECS = 600; // 10 min; Preprod slot finality + build + submit.
  const MIN_CARDANO_DEADLINE_WINDOW_SECS = 1800; // 30 min; refuse if Alice lowballed.
  const bobDeadlineMin = 60;

  const nowSecs = Math.floor(Date.now() / 1000);
  const cardanoDeadlineSecs = Number(htlcInfo.deadlineMs) / 1000;
  const cardanoRemaining = cardanoDeadlineSecs - nowSecs;

  if (cardanoRemaining < MIN_CARDANO_DEADLINE_WINDOW_SECS) {
    console.error(
      `\n✗ Alice's Cardano deadline is only ${Math.round(cardanoRemaining / 60)} min away — ` +
        `at least ${MIN_CARDANO_DEADLINE_WINDOW_SECS / 60} min is required to safely execute the swap.`,
    );
    console.error('  Aborting: unsafe to deposit, counterparty could race the reclaim.');
    process.exit(1);
  }

  const maxBobDeadlineSecs = cardanoDeadlineSecs - SAFETY_BUFFER_SECS;
  const desiredBobDeadlineSecs = nowSecs + bobDeadlineMin * 60;
  const bobDeadlineSecs = Math.min(desiredBobDeadlineSecs, maxBobDeadlineSecs);

  if (bobDeadlineSecs <= nowSecs + 120) {
    console.error(
      `\n✗ Cannot pick a safe Midnight deadline: ` +
        `cardano=${new Date(cardanoDeadlineSecs * 1000).toISOString()}, ` +
        `safety buffer=${SAFETY_BUFFER_SECS}s leaves < 2 min for Bob to operate.`,
    );
    process.exit(1);
  }

  if (bobDeadlineSecs < desiredBobDeadlineSecs) {
    console.log(
      `  Note: truncating Midnight deadline from ${bobDeadlineMin}min to ` +
        `${Math.round((bobDeadlineSecs - nowSecs) / 60)}min to stay ${SAFETY_BUFFER_SECS / 60}min inside Cardano deadline.`,
    );
  }

  const bobDeadlineUnix = BigInt(bobDeadlineSecs);

  // Auth = Alice's ZswapCoinPublicKey bytes (to gate withdrawWithPreimage).
  const aliceAuthBytes = hexToBytes(addresses.alice.midnight.coinPublicKey);
  // Payout = Alice's UserAddress (where sendUnshielded delivers the coins).
  const aliceRecipient = userEither(addresses.alice.midnight.unshieldedAddressHex);
  // Sender payout = Bob's UserAddress (where reclaim would return coins).
  const bobSenderPayout = userEither(addresses.bob.midnight.unshieldedAddressHex);
  // Color comes from the USDC contract state, recorded at setup.
  const usdcColor = hexToBytes(swapState.usdcColor);

  console.log(`Depositing ${usdcAmount} USDC (native unshielded)...`);
  console.log(`  Hash:     ${htlcInfo.hashHex.slice(0, 32)}...`);
  console.log(`  Color:    ${swapState.usdcColor.slice(0, 20)}...`);
  const actualBobMin = Math.round((bobDeadlineSecs - nowSecs) / 60);
  console.log(`  Deadline: ${new Date(Number(bobDeadlineUnix) * 1000).toISOString()} (${actualBobMin}min)`);
  console.log(`  Receiver: Alice`);

  await contract.callTx.deposit(
    usdcColor,
    usdcAmount,
    hashLock,
    bobDeadlineUnix,
    aliceAuthBytes,
    aliceRecipient,
    bobSenderPayout,
  );
  console.log('USDC deposited on Midnight HTLC!');

  // ── Watch Midnight for preimage reveal ──
  console.log('\n── Watching Midnight for preimage reveal ──');
  console.log('(Waiting for Alice to claim USDC — this reveals the preimage on-chain)\n');

  const preimage = await watchForPreimageReveal(
    providers.publicDataProvider,
    swapState.htlcContractAddress as ContractAddress,
    hashLock,
  );

  const preimageHex = bytesToHex(preimage);
  console.log(`\nPreimage discovered on Midnight: ${preimageHex}`);

  // ── Claim ADA on Cardano ──
  console.log('\n── Claiming ADA on Cardano ──');
  console.log(`Claiming ${adaLocked} ADA with preimage...`);

  const claimTxHash = await bobCardano.claim(preimageHex);
  console.log(`Claim tx: ${claimTxHash}`);

  console.log('Waiting for Cardano confirmation...');
  await new Promise((r) => setTimeout(r, 30_000));

  const newBal = await bobCardano.getBalance();
  console.log(`New Cardano balance: ${Number(newBal) / 1e6} ADA`);

  // ── Summary ──
  console.log('\n╔══════════════════════════════════════════════════════════╗');
  console.log('║               BOB SWAP COMPLETE                         ║');
  console.log('╠══════════════════════════════════════════════════════════╣');
  console.log(`║  Sent:     ${usdcAmount} USDC on Midnight (native)`);
  console.log(`║  Received: ${adaLocked} ADA on Cardano`);
  console.log(`║  Hash:     ${htlcInfo.hashHex.slice(0, 32)}...`);
  console.log(`║  Preimage: ${preimageHex.slice(0, 32)}... (from on-chain)`);
  console.log('╚══════════════════════════════════════════════════════════╝');

  rli?.close();
  await walletProvider.stop();
  process.exit(0);
}

main().catch((e) => {
  console.error('Bob swap failed:', e);
  process.exit(1);
});
