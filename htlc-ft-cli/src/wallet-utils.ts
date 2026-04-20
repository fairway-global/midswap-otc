import { UnshieldedTokenType } from '@midnight-ntwrk/ledger-v8';
import { type FacadeState, type WalletFacade } from '@midnight-ntwrk/wallet-sdk-facade';
import { type ShieldedWalletAPI, type ShieldedWalletState } from '@midnight-ntwrk/wallet-sdk-shielded';
import { type UnshieldedWalletAPI, type UnshieldedWalletState } from '@midnight-ntwrk/wallet-sdk-unshielded-wallet';
import * as Rx from 'rxjs';

import { FaucetClient, type EnvironmentConfiguration } from '@midnight-ntwrk/testkit-js';
import { Logger } from 'pino';
import { UnshieldedAddress } from '@midnight-ntwrk/wallet-sdk-address-format';
import { getNetworkId } from '@midnight-ntwrk/midnight-js-network-id';

export const getInitialShieldedState = async (
  logger: Logger,
  wallet: ShieldedWalletAPI,
): Promise<ShieldedWalletState> => {
  logger.info('Getting initial state of wallet...');
  return Rx.firstValueFrom(wallet.state);
};

export const getInitialUnshieldedState = async (
  logger: Logger,
  wallet: UnshieldedWalletAPI,
): Promise<UnshieldedWalletState> => {
  logger.info('Getting initial state of wallet...');
  return Rx.firstValueFrom(wallet.state);
};

const isProgressStrictlyComplete = (progress: unknown): boolean => {
  if (!progress || typeof progress !== 'object') {
    return false;
  }
  const candidate = progress as { isStrictlyComplete?: unknown };
  if (typeof candidate.isStrictlyComplete !== 'function') {
    return false;
  }
  return (candidate.isStrictlyComplete as () => boolean)();
};

// Shielded sync is intentionally excluded — this codebase only uses unshielded coins
// (USDC, tNight). On preprod, shielded first-sync from genesis takes too long and
// blocking on it is gratuitous.
const isFacadeStateSynced = (state: FacadeState): boolean =>
  isProgressStrictlyComplete(state.dust.state.progress) &&
  isProgressStrictlyComplete(state.unshielded.progress);

export const syncWallet = (logger: Logger, wallet: WalletFacade, throttleTime = 2_000) => {
  logger.info('Syncing wallet...');

  return Rx.firstValueFrom(
    wallet.state().pipe(
      Rx.throttleTime(throttleTime),
      Rx.tap((state: FacadeState) => {
        const shieldedSynced = isProgressStrictlyComplete(state.shielded.state.progress);
        const unshieldedSynced = isProgressStrictlyComplete(state.unshielded.progress);
        const dustSynced = isProgressStrictlyComplete(state.dust.state.progress);
        const isSynced = shieldedSynced && dustSynced && unshieldedSynced;
        logger.info(
          `Sync progress (complete=${isSynced}): shielded=${shieldedSynced}, unshielded=${unshieldedSynced}, dust=${dustSynced}`,
        );
      }),
      Rx.filter((state: FacadeState) => isFacadeStateSynced(state)),
      Rx.tap(() => logger.info('Sync complete')),
      Rx.tap((state: FacadeState) => {
        const shieldedBalances = state.shielded.balances || {};
        const unshieldedBalances = state.unshielded.balances || {};
        const dustBalances = state.dust.balance(new Date(Date.now())) || 0n;

        logger.info(
          `Wallet balances after sync - Shielded: ${JSON.stringify(shieldedBalances)}, Unshielded: ${JSON.stringify(unshieldedBalances)}, Dust: ${dustBalances}`,
        );
      }),
    ),
  );
};

export const waitForUnshieldedFunds = async (
  logger: Logger,
  wallet: WalletFacade,
  env: EnvironmentConfiguration,
  tokenType: UnshieldedTokenType,
  fundFromFaucet = false,
  throttleTime = 2_000,
): Promise<UnshieldedWalletState> => {
  const initialState = await getInitialUnshieldedState(logger, wallet.unshielded);
  const unshieldedAddress = UnshieldedAddress.codec.encode(getNetworkId(), initialState.address);
  logger.info(`Using unshielded address: ${unshieldedAddress.toString()} waiting for funds...`);
  if (fundFromFaucet && env.faucet) {
    logger.info('Requesting tokens from faucet...');
    await new FaucetClient(env.faucet, logger).requestTokens(unshieldedAddress.toString());
  }
  const initialBalance = initialState.balances[tokenType.raw];
  if (initialBalance === undefined || initialBalance === 0n) {
    logger.info(`Your wallet initial balance is: 0 (not yet initialized)`);
    logger.info(`Waiting to receive tokens...`);
    return Rx.firstValueFrom(
      wallet.state().pipe(
        Rx.throttleTime(throttleTime),
        Rx.tap((state: FacadeState) => {
          const balance = state.unshielded.balances[tokenType.raw] ?? 0n;
          const unshieldedSynced = isProgressStrictlyComplete(state.unshielded.progress);
          logger.info(
            `Waiting for unshielded funds: synced=${unshieldedSynced}, balance=${balance.toString()}`,
          );
        }),
        // Don't require dust here — waitForUnshieldedFunds runs *before* generateDust,
        // so a dust check would deadlock. We only need the unshielded balance to appear.
        Rx.filter(
          (state: FacadeState) =>
            isProgressStrictlyComplete(state.unshielded.progress) &&
            (state.unshielded.balances[tokenType.raw] ?? 0n) > 0n,
        ),
        Rx.tap(() => logger.info('Sync complete')),
        Rx.tap((state: FacadeState) => {
          const shieldedBalances = state.shielded.balances || {};
          const unshieldedBalances = state.unshielded.balances || {};
          const dustBalances = state.dust.balance(new Date(Date.now())) || 0n;

          logger.info(
            `Wallet balances after sync - Shielded: ${JSON.stringify(shieldedBalances)}, Unshielded: ${JSON.stringify(unshieldedBalances)}, Dust: ${dustBalances}`,
          );
        }),
        Rx.map((state: FacadeState) => state.unshielded),
      ),
    );
  }
  return initialState;
};
