// HTLC CLI: Cross-chain atomic swap on Midnight + Cardano.
//
// The HTLC contract is a pure, color-parametric escrow over native
// Midnight unshielded tokens. Token issuance (e.g. USDC) lives on a
// separate contract; use `npm run setup` and `npm run mint-usdc` for
// initial deployment + minting, and `npm run swap:alice` / `swap:bob`
// for the full two-party flow. This interactive menu covers the
// primitive HTLC operations plus the Cardano side.

import { createInterface, type Interface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { WebSocket } from 'ws';
import { type WalletFacade } from '@midnight-ntwrk/wallet-sdk-facade';
import { NodeZkConfigProvider } from '@midnight-ntwrk/midnight-js-node-zk-config-provider';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { httpClientProofProvider } from '@midnight-ntwrk/midnight-js-http-client-proof-provider';
import { type Logger } from 'pino';
import { type Config } from './config.js';
import { levelPrivateStateProvider } from '@midnight-ntwrk/midnight-js-level-private-state-provider';
import { type ContractAddress } from '@midnight-ntwrk/compact-runtime';
import { TestEnvironment } from '@midnight-ntwrk/testkit-js';
import { MidnightWalletProvider } from './midnight-wallet-provider';
import { unshieldedToken } from '@midnight-ntwrk/ledger-v8';
import { waitForUnshieldedFunds } from './wallet-utils';
import { generateDust } from './generate-dust';
import { deployContract, findDeployedContract } from '@midnight-ntwrk/midnight-js-contracts';
import {
  CompiledHTLCContract,
  htlcPrivateStateKey,
  type HTLCProviders,
  type HTLCPrivateStateId,
  type EmptyPrivateState,
  type DeployedHTLCContract,
  type HTLCContract,
  type HTLCCircuitKeys,
} from '../../contract/src/htlc-contract';
import {
  ledger,
  type Ledger,
  type Either,
  type ContractAddress as CompactContractAddress,
  type UserAddress,
} from '../../contract/src/managed/htlc/contract/index.js';
import { MidnightBech32m, UnshieldedAddress } from '@midnight-ntwrk/wallet-sdk-address-format';
import { getNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import { createHash } from 'node:crypto';
type CardanoHTLC = import('./cardano-htlc').CardanoHTLC;

// @ts-expect-error: It's needed to enable WebSocket usage through apollo
globalThis.WebSocket = WebSocket;

// ─────────────────────────────────────────────────────────────────────
// Hex / address helpers
// ─────────────────────────────────────────────────────────────────────

function parseAddress(input: string): Uint8Array {
  const trimmed = input.trim();
  if (trimmed.startsWith('mn_')) {
    const parsed = MidnightBech32m.parse(trimmed);
    const addr = UnshieldedAddress.codec.decode(getNetworkId(), parsed);
    return new Uint8Array(addr.data);
  }
  return hexToBytes(trimmed);
}

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
  if (clean.length % 2 !== 0) throw new Error('Invalid hex string (odd length)');
  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < clean.length; i += 2) {
    bytes[i / 2] = parseInt(clean.substring(i, i + 2), 16);
  }
  return bytes;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function sha256(data: Uint8Array): Uint8Array {
  return new Uint8Array(createHash('sha256').update(data).digest());
}

function randomBytes(n: number): Uint8Array {
  const bytes = new Uint8Array(n);
  crypto.getRandomValues(bytes);
  return bytes;
}

function userEither(userAddrBytes: Uint8Array): Either<CompactContractAddress, UserAddress> {
  return {
    is_left: false,
    left: { bytes: new Uint8Array(32) },
    right: { bytes: userAddrBytes },
  };
}

// ─────────────────────────────────────────────────────────────────────
// Contract interaction helpers
// ─────────────────────────────────────────────────────────────────────

const getLedgerState = async (
  providers: HTLCProviders,
  contractAddress: ContractAddress,
): Promise<Ledger | null> => {
  const contractState = await providers.publicDataProvider.queryContractState(contractAddress);
  return contractState != null ? ledger(contractState.data) : null;
};

// ─────────────────────────────────────────────────────────────────────
// Deploy or Join
// ─────────────────────────────────────────────────────────────────────

const DEPLOY_OR_JOIN_QUESTION = `
You can do one of the following:
  1. Deploy a new HTLC contract
  2. Join an existing HTLC contract
  3. Exit
Which would you like to do? `;

const deployOrJoin = async (
  providers: HTLCProviders,
  rli: Interface,
  logger: Logger,
): Promise<DeployedHTLCContract | null> => {
  while (true) {
    const choice = await rli.question(DEPLOY_OR_JOIN_QUESTION);
    switch (choice) {
      case '1': {
        logger.info('Deploying HTLC contract (pure escrow)...');
        const deployed = await deployContract(providers, {
          compiledContract: CompiledHTLCContract,
          privateStateId: htlcPrivateStateKey,
          initialPrivateState: {} as EmptyPrivateState,
        });
        const addr = deployed.deployTxData.public.contractAddress;
        logger.info(`Contract deployed at: ${addr}`);
        return deployed;
      }
      case '2': {
        const addr = await rli.question('Contract address (hex): ');
        logger.info(`Joining contract at ${addr}...`);
        const deployed = await findDeployedContract<HTLCContract>(providers, {
          contractAddress: addr as ContractAddress,
          compiledContract: CompiledHTLCContract,
          privateStateId: htlcPrivateStateKey,
          initialPrivateState: {} as EmptyPrivateState,
        });
        logger.info(`Joined contract at: ${deployed.deployTxData.public.contractAddress}`);
        return deployed;
      }
      case '3':
        logger.info('Exiting...');
        return null;
      default:
        logger.error(`Invalid choice: ${choice}`);
    }
  }
};

// ─────────────────────────────────────────────────────────────────────
// Main loop
// ─────────────────────────────────────────────────────────────────────

const MAIN_MENU = `
=== HTLC Cross-Chain Atomic Swap ===
 ── Midnight HTLC ──
  1. Deposit (lock native tokens under hash lock)
  2. Withdraw (claim with preimage — reveals it on-chain)
  3. Reclaim (refund after expiry)
  4. Check swap status by hash
  5. Generate new preimage + hash
  6. Display contract address
 ── Cardano ──
  7. Cardano: Lock ADA (create HTLC)
  8. Cardano: Claim with preimage
  9. Cardano: Reclaim after deadline
  10. Cardano: List HTLCs at script
  11. Cardano: Wallet info
 ── System ──
  12. Exit
Which would you like to do? `;

const mainLoop = async (
  providers: HTLCProviders,
  contract: DeployedHTLCContract,
  myCoinPubKey: Uint8Array,
  myUnshieldedAddr: Uint8Array,
  cardano: CardanoHTLC | null,
  rli: Interface,
  logger: Logger,
): Promise<void> => {
  const contractAddress = contract.deployTxData.public.contractAddress;

  while (true) {
    const choice = await rli.question(MAIN_MENU);
    try {
      switch (choice) {
        // ── Deposit ──
        case '1': {
          const colorHex = await rli.question('Token color (64 hex chars): ');
          const color = hexToBytes(colorHex);
          if (color.length !== 32) { logger.error('Color must be 32 bytes.'); break; }

          const amountStr = await rli.question('Amount to escrow: ');
          const amount = BigInt(amountStr);

          const preimageChoice = await rli.question('Use (1) existing preimage hex or (2) generate new? ');
          let preimage: Uint8Array;
          if (preimageChoice === '1') {
            const preimageHex = await rli.question('Preimage (64 hex chars): ');
            preimage = hexToBytes(preimageHex);
          } else {
            preimage = randomBytes(32);
            logger.info(`Generated preimage: ${bytesToHex(preimage)}`);
            logger.info('SAVE THIS PREIMAGE! You need it to claim on the other chain.');
          }
          if (preimage.length !== 32) { logger.error('Preimage must be 32 bytes.'); break; }

          const hashLock = sha256(preimage);
          logger.info(`Hash lock: ${bytesToHex(hashLock)}`);

          const receiverAuthHex = await rli.question("Receiver's ZswapCoinPublicKey (64 hex chars): ");
          const receiverAuth = hexToBytes(receiverAuthHex);
          if (receiverAuth.length !== 32) { logger.error('Auth key must be 32 bytes.'); break; }

          const receiverAddrInput = await rli.question("Receiver's unshielded address (hex or mn_addr_...): ");
          const receiverAddr = parseAddress(receiverAddrInput);

          const expiryMinutes = await rli.question('Expiry in minutes from now [60]: ');
          const minutes = parseInt(expiryMinutes || '60', 10);
          const expiryTime = BigInt(Math.floor(Date.now() / 1000) + minutes * 60);
          logger.info(`Expiry: ${new Date(Number(expiryTime) * 1000).toISOString()}`);

          logger.info(`Depositing ${amount} of color ${bytesToHex(color).slice(0, 16)}... under hash lock...`);
          await contract.callTx.deposit(
            color,
            amount,
            hashLock,
            expiryTime,
            receiverAuth,
            userEither(receiverAddr),
            userEither(myUnshieldedAddr),
          );
          logger.info('Deposit successful! HTLC created.');
          logger.info(`Hash lock: ${bytesToHex(hashLock)}`);
          break;
        }

        // ── Withdraw ──
        case '2': {
          const preimageHex = await rli.question('Preimage (64 hex chars): ');
          const preimage = hexToBytes(preimageHex);
          if (preimage.length !== 32) { logger.error('Preimage must be 32 bytes.'); break; }
          const hash = sha256(preimage);
          logger.info(`Computed hash: ${bytesToHex(hash)}`);
          logger.info('Withdrawing and revealing preimage on-chain...');
          await contract.callTx.withdrawWithPreimage(preimage);
          logger.info('Withdraw successful! Native tokens sent to your wallet.');
          break;
        }

        // ── Reclaim ──
        case '3': {
          const hashHex = await rli.question('Hash lock of swap to reclaim (64 hex chars): ');
          const hash = hexToBytes(hashHex);
          if (hash.length !== 32) { logger.error('Hash must be 32 bytes.'); break; }
          logger.info('Reclaiming after expiry...');
          await contract.callTx.reclaimAfterExpiry(hash);
          logger.info('Reclaim successful!');
          break;
        }

        // ── Check status ──
        case '4': {
          const hashHex = await rli.question('Hash lock (64 hex chars): ');
          if (!hashHex.trim()) { logger.error('Hash cannot be empty.'); break; }
          const hash = hexToBytes(hashHex);
          const state = await getLedgerState(providers, contractAddress);
          if (!state) { logger.info('Could not fetch contract state.'); break; }
          if (!state.htlcAmounts.member(hash)) {
            logger.info('No swap found for this hash.');
          } else {
            const amount = state.htlcAmounts.lookup(hash);
            const active = amount > 0n;
            logger.info(`Escrowed amount: ${amount}`);
            if (active) {
              const expiry = state.htlcExpiries.lookup(hash);
              const color = state.htlcColors.lookup(hash);
              const senderAuth = state.htlcSenderAuth.lookup(hash);
              const receiverAuth = state.htlcReceiverAuth.lookup(hash);
              logger.info(`Color:    ${bytesToHex(color)}`);
              logger.info(`Expiry:   ${new Date(Number(expiry) * 1000).toISOString()}`);
              logger.info(`Sender:   ${bytesToHex(senderAuth)}`);
              logger.info(`Receiver: ${bytesToHex(receiverAuth)}`);
              const now = Math.floor(Date.now() / 1000);
              if (now > Number(expiry)) {
                logger.info('Status: EXPIRED (sender can reclaim)');
              } else {
                const mins = Math.floor((Number(expiry) - now) / 60);
                logger.info(`Status: ACTIVE (${mins} minutes remaining)`);
              }
            } else {
              logger.info('Status: COMPLETED');
              if (state.revealedPreimages.member(hash)) {
                logger.info(`Revealed preimage: ${bytesToHex(state.revealedPreimages.lookup(hash))}`);
              }
            }
          }
          break;
        }

        // ── Generate preimage ──
        case '5': {
          const preimage = randomBytes(32);
          const hash = sha256(preimage);
          logger.info(`Preimage: ${bytesToHex(preimage)}`);
          logger.info(`Hash:     ${bytesToHex(hash)}`);
          break;
        }

        // ── Contract address ──
        case '6': {
          logger.info(`Contract address: ${contractAddress}`);
          logger.info(`My coin pub key:  ${bytesToHex(myCoinPubKey)}`);
          logger.info(`My unshielded:    ${bytesToHex(myUnshieldedAddr)}`);
          break;
        }

        // ── Cardano: Lock ──
        case '7': {
          if (!cardano) { logger.error('Cardano not configured.'); break; }
          const { loadUsdmPolicy } = await import('./cardano-htlc');
          const path = await import('node:path');
          const scriptDir = path.resolve(new URL(import.meta.url).pathname, '..');
          const blueprintPath = path.resolve(scriptDir, '..', '..', 'cardano', 'plutus.json');
          const usdmPolicy = loadUsdmPolicy(blueprintPath);
          const usdmStr = await rli.question('Amount in USDM to lock (integer): ');
          const usdmQty = BigInt(usdmStr);

          const hashHex = await rli.question('Hash lock (64 hex chars): ');
          if (hashHex.length !== 64) { logger.error('Hash lock must be 64 hex chars.'); break; }

          const receiverPkh = await rli.question('Receiver payment key hash (56 hex chars): ');
          if (receiverPkh.length !== 56) { logger.error('PKH must be 56 hex chars.'); break; }

          const deadlineMin = await rli.question('Deadline in minutes from now [60]: ');
          const mins = parseInt(deadlineMin || '60', 10);
          const deadlineMs = BigInt(Date.now() + mins * 60 * 1000);
          logger.info(`Deadline: ${new Date(Number(deadlineMs)).toISOString()}`);

          const txHash = await cardano.lock(usdmQty, usdmPolicy.unit, hashHex, receiverPkh, deadlineMs);
          logger.info(`Cardano HTLC created! Tx: ${txHash}`);
          break;
        }

        // ── Cardano: Claim ──
        case '8': {
          if (!cardano) { logger.error('Cardano not configured.'); break; }
          const preimageHex = await rli.question('Preimage (64 hex chars): ');
          if (preimageHex.length !== 64) { logger.error('Preimage must be 64 hex chars.'); break; }
          const txHash = await cardano.claim(preimageHex);
          logger.info(`Cardano HTLC claimed! Tx: ${txHash}`);
          break;
        }

        // ── Cardano: Reclaim ──
        case '9': {
          if (!cardano) { logger.error('Cardano not configured.'); break; }
          const hashForReclaim = await rli.question('Hash lock to reclaim (64 hex chars): ');
          if (hashForReclaim.length !== 64) { logger.error('Hash lock must be 64 hex chars.'); break; }
          const txHash = await cardano.reclaim(hashForReclaim);
          logger.info(`Cardano HTLC reclaimed! Tx: ${txHash}`);
          break;
        }

        // ── Cardano: List ──
        case '10': {
          if (!cardano) { logger.error('Cardano not configured.'); break; }
          logger.info(`Script address: ${cardano.scriptAddress}`);
          const htlcs = await cardano.listHTLCs();
          if (htlcs.length === 0) {
            logger.info('No HTLCs found at script address.');
          } else {
            for (const { utxo, datum } of htlcs) {
              const active = Date.now() < Number(datum.deadline);
              logger.info(`─── HTLC ───`);
              logger.info(`  TxHash:    ${utxo.txHash}#${utxo.outputIndex}`);
              logger.info(`  Amount:    ${utxo.assets.lovelace} lovelace (${Number(utxo.assets.lovelace) / 1_000_000} ADA)`);
              logger.info(`  Hash lock: ${datum.preimageHash}`);
              logger.info(`  Sender:    ${datum.sender}`);
              logger.info(`  Receiver:  ${datum.receiver}`);
              logger.info(`  Deadline:  ${new Date(Number(datum.deadline)).toISOString()}`);
              logger.info(`  Status:    ${active ? 'ACTIVE' : 'EXPIRED'}`);
            }
          }
          break;
        }

        // ── Cardano: Wallet info ──
        case '11': {
          if (!cardano) { logger.error('Cardano not configured.'); break; }
          const addr = await cardano.getWalletAddress();
          const pkh = await cardano.getPaymentKeyHash();
          const balance = await cardano.getBalance();
          logger.info(`Cardano address:  ${addr}`);
          logger.info(`Payment key hash: ${pkh}`);
          logger.info(`Balance: ${balance} lovelace (${Number(balance) / 1_000_000} ADA)`);
          break;
        }

        // ── Exit ──
        case '12':
          logger.info('Exiting...');
          return;

        default:
          logger.error(`Invalid choice: ${choice}`);
      }
    } catch (e) {
      logError(logger, e);
      logger.info('Returning to main menu...');
    }
  }
};

// ─────────────────────────────────────────────────────────────────────
// Wallet setup
// ─────────────────────────────────────────────────────────────────────

const WALLET_QUESTION = `
You can do one of the following:
  1. Build a fresh wallet
  2. Build wallet from a seed
  3. Exit
Which would you like to do? `;

const buildWallet = async (rli: Interface, logger: Logger): Promise<string | undefined> => {
  while (true) {
    const choice = await rli.question(WALLET_QUESTION);
    switch (choice) {
      case '1':
        return bytesToHex(randomBytes(32));
      case '2':
        return await rli.question('Enter your wallet seed: ');
      case '3':
        logger.info('Exiting...');
        return undefined;
      default:
        logger.error(`Invalid choice: ${choice}`);
    }
  }
};

// ─────────────────────────────────────────────────────────────────────
// Main entry point
// ─────────────────────────────────────────────────────────────────────

export const run = async (config: Config, testEnv: TestEnvironment, logger: Logger): Promise<void> => {
  const rli = createInterface({ input, output, terminal: true });
  const providersToBeStopped: MidnightWalletProvider[] = [];
  try {
    logger.info('Starting HTLC CLI for cross-chain atomic swaps...');
    const envConfiguration = await testEnv.start();
    logger.info(`Environment started with configuration: ${JSON.stringify(envConfiguration)}`);

    const seed = await buildWallet(rli, logger);
    if (seed === undefined) return;

    const walletProvider = await MidnightWalletProvider.build(logger, envConfiguration, seed);
    providersToBeStopped.push(walletProvider);
    const walletFacade: WalletFacade = walletProvider.wallet;

    await walletProvider.start();

    const unshieldedState = await waitForUnshieldedFunds(
      logger,
      walletFacade,
      envConfiguration,
      unshieldedToken(),
      config.requestFaucetTokens,
    );
    const nightBalance = unshieldedState.balances[unshieldedToken().raw];
    if (nightBalance === undefined) {
      logger.info('No funds received, exiting...');
      return;
    }
    logger.info(`Your NIGHT wallet balance is: ${nightBalance}`);

    if (config.generateDust) {
      const dustGeneration = await generateDust(logger, seed, unshieldedState, walletFacade);
      if (dustGeneration) {
        logger.info(`Submitted dust generation registration transaction: ${dustGeneration}`);
      }
    }

    const coinPubKey = walletProvider.getCoinPublicKey();
    const myCoinPubKey = hexToBytes(coinPubKey);
    const myUnshieldedAddr = new Uint8Array(unshieldedState.address.data);

    const zkConfigProvider = new NodeZkConfigProvider<HTLCCircuitKeys>(config.zkConfigPath);
    const providers: HTLCProviders = {
      privateStateProvider: levelPrivateStateProvider<HTLCPrivateStateId, EmptyPrivateState>({
        privateStateStoreName: config.privateStateStoreName,
        signingKeyStoreName: `${config.privateStateStoreName}-signing-keys`,
        privateStoragePasswordProvider: () => 'Htlc-Interactive-Cli-2026!',
        accountId: seed,
      }),
      publicDataProvider: indexerPublicDataProvider(envConfiguration.indexer, envConfiguration.indexerWS),
      zkConfigProvider: zkConfigProvider,
      proofProvider: httpClientProofProvider(envConfiguration.proofServer, zkConfigProvider),
      walletProvider: walletProvider,
      midnightProvider: walletProvider,
    };

    let cardano: CardanoHTLC | null = null;
    if (config.cardano && config.cardano.blockfrostApiKey) {
      logger.info('Initializing Cardano HTLC...');
      const { CardanoHTLC: CardanoHTLCClass } = await import('./cardano-htlc');
      cardano = await CardanoHTLCClass.init(
        {
          blockfrostUrl: config.cardano.blockfrostUrl,
          blockfrostApiKey: config.cardano.blockfrostApiKey,
          network: config.cardano.cardanoNetwork,
          blueprintPath: config.cardano.blueprintPath,
        },
        logger,
      );
      const cardanoSeed = await rli.question('Enter Cardano wallet mnemonic (24 words): ');
      cardano.selectWalletFromSeed(cardanoSeed.trim());
      const cardanoAddr = await cardano.getWalletAddress();
      const cardanoBalance = await cardano.getBalance();
      logger.info(`Cardano wallet: ${cardanoAddr}`);
      logger.info(`Cardano balance: ${cardanoBalance} lovelace (${Number(cardanoBalance) / 1_000_000} ADA)`);
    } else {
      logger.info('Cardano not configured (set BLOCKFROST_API_KEY env var to enable).');
    }

    const contract = await deployOrJoin(providers, rli, logger);
    if (contract === null) return;

    await mainLoop(providers, contract, myCoinPubKey, myUnshieldedAddr, cardano, rli, logger);
  } catch (e) {
    logError(logger, e);
    logger.info('Exiting...');
  } finally {
    try {
      rli.close();
      rli.removeAllListeners();
    } catch (e) {
      logError(logger, e);
    } finally {
      try {
        for (const wallet of providersToBeStopped) {
          logger.info('Stopping wallet...');
          await wallet.stop();
        }
        if (testEnv) {
          logger.info('Stopping test environment...');
          await testEnv.shutdown();
        }
      } catch (e) {
        logError(logger, e);
      }
    }
  }
};

function logError(logger: Logger, e: unknown) {
  if (e instanceof Error) {
    logger.error(`Found error '${e.message}'`);
    logger.error(`Stack: ${e.stack}`);
    if (e.cause) logger.error(`Cause: ${e.cause}`);
  } else {
    logger.error(`Found error (unknown type): ${JSON.stringify(e)}`);
  }
}
