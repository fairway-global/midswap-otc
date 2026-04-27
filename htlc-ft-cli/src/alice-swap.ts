/**
 * Alice's Cross-Chain Atomic Swap (Initiator).
 *
 * Alice trades ADA for native USDC on Midnight:
 *   1. Generate preimage + hash.
 *   2. Lock ADA on Cardano HTLC.
 *   3. Watch Midnight for Bob's USDC deposit (same hash).
 *   4. Withdraw USDC on Midnight via withdrawWithPreimage — this also
 *      reveals the preimage in the HTLC's revealedPreimages map, which
 *      Bob reads to claim the ADA.
 *
 * Usage:
 *   npx tsx src/alice-swap.ts
 */

import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as readline from 'node:readline/promises';
import { WebSocket } from 'ws';
import { createHash } from 'node:crypto';
import { createLogger } from './logger-utils.js';
import { MidnightWalletProvider } from './midnight-wallet-provider';
import { waitForUnshieldedFunds } from './wallet-utils';
import { generateDust } from './generate-dust';
import { watchForHTLCDeposit } from './midnight-watcher';
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
  CompiledHTLCContract,
  htlcPrivateStateKey,
  type HTLCProviders,
  type HTLCPrivateStateId,
  type EmptyPrivateState,
  type HTLCCircuitKeys,
} from '../../contract/src/htlc-contract';

// @ts-expect-error: Needed for WebSocket usage through apollo
globalThis.WebSocket = WebSocket;

const scriptDir = path.resolve(new URL(import.meta.url).pathname, '..');

const env: EnvironmentConfiguration = getMidnightEnv();

function sha256(data: Uint8Array): Uint8Array {
  return new Uint8Array(createHash('sha256').update(data).digest());
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
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
      privateStateStoreName: 'htlc-alice',
      signingKeyStoreName: 'htlc-alice-signing-keys',
      privateStoragePasswordProvider: () => 'Htlc-Alice-Swap-2026!',
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
  applyMidnightNetwork();

  // Non-interactive mode: `--yes` flag or ALICE_ACCEPT_ALL=1 env var uses defaults
  // for ADA/USDC amount + deadline, and aborts on warnings (safe default).
  // Needed for two-terminal tests where stdin isn't a TTY.
  const autoAccept = process.argv.includes('--yes') || process.env.ALICE_ACCEPT_ALL === '1';
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
  console.log('║          ALICE — Cross-Chain Swap (Initiator)           ║');
  console.log('║          USDM (Cardano) → USDC (Midnight, native)       ║');
  console.log('╚══════════════════════════════════════════════════════════╝\n');
  console.log(`HTLC Contract: ${swapState.htlcContractAddress}`);
  console.log(`USDC Contract: ${swapState.usdcContractAddress}`);
  console.log(`USDC Color:    ${swapState.usdcColor}\n`);

  let usdmAmountStr: string;
  let usdcAmount: bigint;
  let deadlineMinStr: string;
  if (autoAccept) {
    usdmAmountStr = process.env.ALICE_USDM ?? process.env.ALICE_ADA ?? '10';
    usdcAmount = BigInt(process.env.ALICE_USDC ?? usdmAmountStr);
    deadlineMinStr = process.env.ALICE_DEADLINE_MIN ?? '120';
    console.log(`Auto-accept: usdm=${usdmAmountStr}, usdc=${usdcAmount}, deadline=${deadlineMinStr}min`);
  } else {
    usdmAmountStr = (await rli!.question('USDM amount to swap [10]: ')) || '10';
    usdcAmount = BigInt((await rli!.question(`USDC amount to receive [${usdmAmountStr}]: `)) || usdmAmountStr);
    deadlineMinStr = (await rli!.question('Cardano deadline in minutes [120]: ')) || '120';
  }
  const usdmAmount = BigInt(usdmAmountStr);
  const deadlineMin = parseInt(deadlineMinStr);

  // Bob's safety gate rejects anything under 30 min; on preprod he also spends
  // ~15 min on dust sync before he can even check, so require a healthy floor.
  const MIN_DEADLINE_MIN = 60;
  if (!Number.isFinite(deadlineMin) || deadlineMin < MIN_DEADLINE_MIN) {
    console.error(
      `ERROR: deadline=${deadlineMin}min is below the ${MIN_DEADLINE_MIN}-min floor. ` +
        `Bob needs ≥30min window + preprod sync time. Re-run with a larger value.`,
    );
    process.exit(1);
  }

  const logDir = path.resolve(scriptDir, '..', 'logs', 'alice-swap', `${new Date().toISOString()}.log`);
  const logger = await createLogger(logDir);

  // ── Build wallets ──
  console.log('\n── Building wallets ──');

  console.log('Building Midnight wallet...');
  const aliceSeed = addresses.alice.midnight.seed;
  const walletProvider = await MidnightWalletProvider.build(logger, env, aliceSeed);
  await walletProvider.start();
  const unshielded = await waitForUnshieldedFunds(logger, walletProvider.wallet, env, unshieldedToken());
  await generateDust(logger, aliceSeed, unshielded, walletProvider.wallet);

  // Capture Alice's runtime coinPublicKey. The stored value in address.json is
  // derived offline and in practice diverges from what the wallet reports at
  // runtime (debug showed 8520... stored vs b432... runtime for the same seed),
  // and `ownPublicKey().bytes` in the Compact runtime is the runtime value.
  // Publish this so Bob's deposit stores the correct receiver auth.
  const aliceCoinPublicKey = walletProvider.getCoinPublicKey();
  const storedCoinPublicKey: string | undefined = addresses.alice.midnight.coinPublicKey;
  console.log(`Alice coinPublicKey (runtime): ${aliceCoinPublicKey}`);
  if (storedCoinPublicKey && storedCoinPublicKey !== aliceCoinPublicKey) {
    console.warn(
      `  NOTE: address.json stores ${storedCoinPublicKey} — runtime value differs and will override.`,
    );
  }

  console.log('Joining HTLC contract on Midnight...');
  const providers = buildHtlcProviders(walletProvider, aliceSeed);
  const contract = await findDeployedContract(providers, {
    contractAddress: swapState.htlcContractAddress as ContractAddress,
    compiledContract: CompiledHTLCContract,
    privateStateId: htlcPrivateStateKey,
    initialPrivateState: {} as EmptyPrivateState,
  });
  console.log('Joined HTLC contract.');

  console.log('Building Cardano wallet...');
  const { CardanoHTLC: CardanoHTLCClass, loadUsdmPolicy } = await import('./cardano-htlc');
  const blueprintPath = path.resolve(scriptDir, '..', '..', 'cardano', 'plutus.json');
  const aliceCardano = await CardanoHTLCClass.init({
    blockfrostUrl: 'https://cardano-preprod.blockfrost.io/api/v0',
    blockfrostApiKey,
    network: 'Preprod' as const,
    blueprintPath,
  }, logger);
  aliceCardano.selectWalletFromSeed(addresses.alice.cardano.mnemonic);
  const usdmPolicy = loadUsdmPolicy(blueprintPath);
  const adaBal = await aliceCardano.getBalance();
  console.log(`Cardano balance: ${Number(adaBal) / 1e6} ADA (for fees & min-UTxO)`);
  console.log(`USDM policyId: ${usdmPolicy.policyId}`);

  // ── Lock USDM on Cardano ──
  console.log('\n── Locking USDM on Cardano ──');

  const preimage = crypto.randomBytes(32);
  const hashLock = sha256(preimage);
  const preimageHex = bytesToHex(preimage);
  const hashHex = bytesToHex(hashLock);

  console.log(`Preimage (SECRET): ${preimageHex}`);
  console.log(`Hash lock:         ${hashHex}`);

  const deadlineMs = BigInt(Date.now() + deadlineMin * 60 * 1000);
  const bobPkh = addresses.bob.cardano.paymentKeyHash;

  console.log(`Locking ${usdmAmount} USDM for Bob (deadline: ${deadlineMin}min)...`);
  const lockTxHash = await aliceCardano.lock(usdmAmount, usdmPolicy.unit, hashHex, bobPkh, deadlineMs);
  console.log(`Lock tx: ${lockTxHash}`);

  // Publish the hash so Bob's watcher can lock onto this specific HTLC instead
  // of latching onto the first lock with a matching receiver PKH — which can
  // be wrong when the script address holds concurrent locks from other runs.
  const pendingSwapPath = path.resolve(scriptDir, '..', 'pending-swap.json');
  fs.writeFileSync(
    pendingSwapPath,
    JSON.stringify(
      {
        hashHex,
        lockTxHash,
        usdmAmount: usdmAmount.toString(),
        deadlineMs: deadlineMs.toString(),
        aliceCoinPublicKey,
        createdAt: new Date().toISOString(),
      },
      null,
      2,
    ),
  );
  console.log(`Published hash to ${path.relative(process.cwd(), pendingSwapPath)}`);

  // ── Wait for Bob's USDC deposit on Midnight ──
  console.log('\n── Waiting for Bob to deposit USDC on Midnight ──');
  console.log('(Bob should run bob-swap.ts now)\n');

  const deposit = await watchForHTLCDeposit(
    providers.publicDataProvider,
    swapState.htlcContractAddress as ContractAddress,
    hashLock,
  );
  console.log(`\nBob deposited ${deposit.amount} USDC on Midnight!`);
  console.log(`  Color:  ${bytesToHex(deposit.color)}`);
  console.log(`  Expiry: ${new Date(Number(deposit.expiry) * 1000).toISOString()}`);

  // Verify it's the expected token color
  if (bytesToHex(deposit.color) !== swapState.usdcColor) {
    console.error(`WARNING: Deposit color ${bytesToHex(deposit.color)} differs from expected ${swapState.usdcColor}.`);
    if (autoAccept) {
      console.log('Auto-accept: aborting on color mismatch (safe default). ADA reclaimable after deadline.');
      process.exit(0);
    }
    const proceed = await rli!.question('Continue anyway? [y/N]: ');
    if (proceed.toLowerCase() !== 'y') {
      console.log('Aborting. ADA will be reclaimable after deadline.');
      process.exit(0);
    }
  }

  if (deposit.amount < usdcAmount) {
    console.error(`WARNING: Bob deposited ${deposit.amount} USDC but expected ${usdcAmount}.`);
    if (autoAccept) {
      console.log('Auto-accept: aborting on short deposit (safe default). ADA reclaimable after deadline.');
      process.exit(0);
    }
    const proceed = await rli!.question('Continue anyway? [y/N]: ');
    if (proceed.toLowerCase() !== 'y') {
      console.log('Aborting. ADA will be reclaimable after deadline.');
      process.exit(0);
    }
  }

  // ── Claim USDC on Midnight (reveals preimage) ──
  console.log('\n── Claiming USDC on Midnight ──');
  console.log('Revealing preimage and withdrawing...');
  await contract.callTx.withdrawWithPreimage(preimage);
  console.log('USDC claimed on Midnight!');
  console.log('(Preimage is now in revealedPreimages for Bob to claim ADA)');

  // ── Summary ──
  console.log('\n╔══════════════════════════════════════════════════════════╗');
  console.log('║              ALICE SWAP COMPLETE                        ║');
  console.log('╠══════════════════════════════════════════════════════════╣');
  console.log(`║  Sent:     ${usdmAmount} ADA on Cardano`);
  console.log(`║  Received: ${deposit.amount} USDC on Midnight (native)`);
  console.log(`║  Hash:     ${hashHex.slice(0, 32)}...`);
  console.log('╚══════════════════════════════════════════════════════════╝');

  rli?.close();
  await walletProvider.stop();
  process.exit(0);
}

main().catch((e) => {
  console.error('Alice swap failed:', e);
  process.exit(1);
});
