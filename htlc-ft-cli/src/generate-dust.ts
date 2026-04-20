import { type WalletFacade } from '@midnight-ntwrk/wallet-sdk-facade';
import { createKeystore, UnshieldedWalletState } from '@midnight-ntwrk/wallet-sdk-unshielded-wallet';
import { Logger } from 'pino';
import { HDWallet, Roles } from '@midnight-ntwrk/wallet-sdk-hd';
import { getNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import { nativeToken } from '@midnight-ntwrk/ledger-v8';
import { MidnightBech32m, DustAddress } from '@midnight-ntwrk/wallet-sdk-address-format';
import * as rx from 'rxjs';

export const getUnshieldedSeed = (seed: string): Uint8Array<ArrayBufferLike> => {
  const seedBuffer = Buffer.from(seed, 'hex');
  const hdWalletResult = HDWallet.fromSeed(seedBuffer);

  const { hdWallet } = hdWalletResult as {
    type: 'seedOk';
    hdWallet: HDWallet;
  };

  const derivationResult = hdWallet.selectAccount(0).selectRole(Roles.NightExternal).deriveKeyAt(0);

  if (derivationResult.type === 'keyOutOfBounds') {
    throw new Error('Key derivation out of bounds');
  }

  return derivationResult.key;
};

export const generateDust = async (
  logger: Logger,
  walletSeed: string,
  unshieldedState: UnshieldedWalletState,
  walletFacade: WalletFacade,
) => {
  const fmtProgress = (s: any): string => {
    const d = s.dust.state.progress;
    const u = s.unshielded.progress;
    return (
      `dust[applied=${d.appliedIndex}/rel=${d.highestRelevantIndex}/relWallet=${d.highestRelevantWalletIndex}` +
      `/max=${d.highestIndex}/conn=${d.isConnected}/strict=${d.isStrictlyComplete()}] ` +
      `unshielded[applied=${u.appliedIndex}/rel=${u.highestRelevantIndex}/max=${u.highestIndex}` +
      `/conn=${u.isConnected}/strict=${u.isStrictlyComplete()}]`
    );
  };

  // Bypass walletFacade.dust.waitForSyncedState() — on preprod from-genesis, dust
  // strict-complete sync takes too long. DustAddress is derived from the public key
  // (deterministic from wallet keys), so plucking the current facade state is enough.
  const facadeState = await rx.firstValueFrom(walletFacade.state());
  const dustAddress = facadeState.dust.address;
  const networkId = getNetworkId();
  logger.info(`[dust-probe] resolved networkId=${networkId}`);
  logger.info(`[dust-probe] initial ${fmtProgress(facadeState)}`);
  const unshieldedKeystore = createKeystore(getUnshieldedSeed(walletSeed), networkId);
  const nightTokenType = nativeToken().raw;
  let dustAddressBech = '<unencodable>';
  try {
    dustAddressBech = MidnightBech32m.encode(networkId, dustAddress as DustAddress).toString();
  } catch (e) {
    dustAddressBech = `<encode-failed: ${(e as Error).message}>`;
  }
  logger.info(`[dust-probe] nightTokenType=${nightTokenType}`);
  logger.info(`[dust-probe] dustAddress(bech32m)=${dustAddressBech}`);
  logger.info(`[dust-probe] availableCoins.length=${unshieldedState.availableCoins.length}`);
  for (const c of unshieldedState.availableCoins) {
    logger.info(
      `[dust-probe] utxo type=${c.utxo.type} value=${c.utxo.value} registered=${c.meta.registeredForDustGeneration} ctime=${c.meta.ctime.toISOString()}`,
    );
  }
  const allNight = unshieldedState.availableCoins.filter((c) => c.utxo.type === nightTokenType);
  const unregisteredNight = allNight.filter((c) => !c.meta.registeredForDustGeneration);
  logger.info(
    `[dust-probe] NIGHT UTXOs: total=${allNight.length} unregistered=${unregisteredNight.length}`,
  );

  if (allNight.length === 0) {
    throw new Error(
      'No NIGHT UTXOs available — fund the wallet via the faucet before calling generateDust.',
    );
  }

  // Only unregistered UTXOs can fund their own registration fee. The SDK
  // (wallet-sdk-dust-wallet/dist/v1/Transacting.js:70-72) filters registered
  // UTXOs out of `allowFeePayment`, and a registered UTXO has no accrued
  // `generatedNow` to contribute anyway — its dust stream is flowing to the
  // dust address named at registration time. So on a zero-dust wallet, only
  // a fresh (unregistered) UTXO can bootstrap.
  if (unregisteredNight.length > 0) {
    logger.info(
      `[dust-probe] registering ${unregisteredNight.length} unregistered UTXO(s)...`,
    );
    const recipe = await walletFacade.registerNightUtxosForDustGeneration(
      unregisteredNight,
      unshieldedKeystore.getPublicKey(),
      (payload) => unshieldedKeystore.signData(payload),
      dustAddress,
    );
    const transaction = await walletFacade.finalizeRecipe(recipe);
    const txId = await walletFacade.submitTransaction(transaction);
    logger.info(`[dust-probe] submitTransaction returned: ${txId}`);

    const dustBalance = await rx.firstValueFrom(
      walletFacade.state().pipe(
        rx.throttleTime(5_000),
        rx.tap((s) => {
          const bal = s.dust.balance(new Date());
          logger.info(`[dust-probe] post-tx tick balance=${bal} ${fmtProgress(s)}`);
        }),
        rx.filter(
          (s) =>
            s.dust.balance(new Date()) > 0n &&
            s.dust.state.progress.isStrictlyComplete() &&
            s.unshielded.progress.isStrictlyComplete(),
        ),
        rx.map((s) => s.dust.balance(new Date())),
      ),
    );
    logger.info(`Dust generation transaction submitted with txId: ${txId}`);
    logger.info(`Receiver dust balance after generation: ${dustBalance}`);
    return txId;
  }

  // All NIGHT UTXOs are already registered. Two sub-cases:
  //   (a) happy: registration targets this wallet's dust address → balance
  //       will appear shortly as the wallet syncs the dust tree.
  //   (b) trapped: registration targets a foreign dust address (prior run
  //       with different SDK version / derivation path). Balance stays 0
  //       forever, and the wallet cannot recover: dereg has
  //       `allowFeePayment=0` by construction, and any re-register call
  //       can only sum `generatedNow` from unregistered UTXOs (we have
  //       none) — both tx paths get rejected as "Custom error: 138"
  //       (insufficient fees to cover registration fee allowance).
  // Distinguish the two by waiting briefly; surface an actionable error
  // if still stuck after TRAP_DETECTION_MS.
  // Preprod: FluentWalletBuilder has no persistence, so each process rebuilds
  // the dust tree from scratch. A fresh preprod wallet needs ~20 min to apply
  // ~180K historical events before the registered NIGHT UTXO's dust balance
  // becomes visible. Size the timeout well above that to avoid false positives.
  const DUST_WAIT_MS = 145 * 60 * 1000;
  logger.info(
    `[dust-probe] all NIGHT UTXOs already registered; waiting up to ${DUST_WAIT_MS / 1000}s for dust balance to appear...`,
  );
  try {
    const dustBalance = await rx.firstValueFrom(
      walletFacade.state().pipe(
        rx.throttleTime(5_000),
        rx.tap((s) => {
          const bal = s.dust.balance(new Date());
          logger.info(`[dust-probe] tick balance=${bal} ${fmtProgress(s)}`);
        }),
        rx.filter(
          (s) =>
            s.dust.balance(new Date()) > 0n &&
            s.dust.state.progress.isStrictlyComplete() &&
            s.unshielded.progress.isStrictlyComplete(),
        ),
        rx.map((s) => s.dust.balance(new Date())),
        rx.timeout(DUST_WAIT_MS),
      ),
    );
    logger.info(`Dust balance from prior registration: ${dustBalance}`);
    return;
  } catch {
    const finalState = await rx.firstValueFrom(walletFacade.state());
    const progress = finalState.dust.state.progress;
    const applied = progress.appliedIndex;
    const relWallet = progress.highestRelevantWalletIndex;
    // Trap signature is relWallet=0 (indexer has no events keyed to this wallet's dust key).
    // `highestIndex` stays 0 in this SDK version so the old check was always firing.
    const diagnosis = relWallet === 0n
      ? `Zero-fee-bootstrap trap: no on-chain dust events exist for this wallet's dust key after ${DUST_WAIT_MS / 1000}s. Existing NIGHT registration(s) target a different dust address (prior run, different SDK/path). This wallet cannot dereg (dust=0 → tx has no fee source, rejected as "Custom error: 138") or re-register (SDK excludes already-registered UTXOs from allowFeePayment — same rejection). Fix: request more NIGHT from the faucet to ${dustAddressBech}. The new UTXO will arrive unregistered and self-fund its own registration.`
      : applied < relWallet
      ? `Dust tree still catching up after ${DUST_WAIT_MS / 1000}s (applied=${applied}/relWallet=${relWallet}). Raise DUST_WAIT_MS or add dust-tree persistence between runs.`
      : `Dust tree fully synced (applied=${applied}=relWallet=${relWallet}) but balance stayed 0. Unexpected — ${fmtProgress(finalState)}.`;
    throw new Error(`Dust balance did not appear. ${diagnosis}`);
  }
};
