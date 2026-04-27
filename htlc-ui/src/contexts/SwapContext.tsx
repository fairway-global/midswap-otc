/**
 * Top-level swap context: lazily connects Lace + joins both Midnight contracts
 * and (separately) connects Eternl + initializes the Cardano HTLC browser client.
 */

import React, { createContext, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Logger } from 'pino';
import { BrowserHtlcManager, type SwapBootstrap } from './BrowserHtlcManager';
import { HtlcAPI } from '../api/htlc-api';
import { UsdcAPI } from '../api/usdc-api';
import {
  CardanoHTLCBrowser,
  resolveCIP30Wallet,
  type CIP30Api,
  type CardanoHTLCBrowserConfig,
} from '../api/cardano-htlc-browser';
import { loadUsdmPolicy, type UsdmPolicy } from '../api/cardano-usdm';
import swapState from '../../swap-state.json';

export interface SwapState {
  readonly htlcContractAddress: string;
  readonly usdcContractAddress: string;
  readonly usdcColor: string;
  readonly tokenName: string;
  readonly tokenSymbol: string;
  readonly tokenDecimals: number;
  readonly domainSepHex: string;
  readonly deployedAt: string;
  readonly network: string;
}

export interface SwapSession {
  readonly bootstrap: SwapBootstrap;
  readonly htlcApi: HtlcAPI;
  readonly usdcApi: UsdcAPI;
}

export interface CardanoSession {
  readonly cardanoHtlc: CardanoHTLCBrowser;
  readonly usdmPolicy: UsdmPolicy;
  readonly paymentKeyHash: string;
  readonly address: string;
  readonly api: CIP30Api;
}

export interface SwapContextValue {
  readonly swapState: SwapState;
  readonly session: SwapSession | undefined;
  readonly cardano: CardanoSession | undefined;
  readonly connecting: boolean;
  readonly cardanoConnecting: boolean;
  readonly error: Error | undefined;
  readonly cardanoError: Error | undefined;
  connect: () => Promise<SwapSession>;
  connectCardano: (walletName?: string) => Promise<CardanoSession>;
  /** Forget the local session AND clear the silent-reconnect flag. Wallet
   *  permission stays with the extension; user revokes there if they want. */
  disconnect: () => void;
}

// Silent reconnect: remember which wallets were connected last time so a
// page reload restores them without a click. Wallet extensions (Lace,
// Eternl) honor `enable()` silently when permission was previously granted.
const RECONNECT_KEY = 'kaamos:wallets-prev';
type ReconnectFlags = { midnight?: boolean; cardano?: boolean };
const readReconnect = (): ReconnectFlags => {
  try {
    return JSON.parse(window.localStorage.getItem(RECONNECT_KEY) ?? '{}') as ReconnectFlags;
  } catch {
    return {};
  }
};
const writeReconnect = (next: ReconnectFlags): void => {
  try {
    window.localStorage.setItem(RECONNECT_KEY, JSON.stringify(next));
  } catch {
    /* ignore */
  }
};

export const SwapContext = createContext<SwapContextValue | undefined>(undefined);

const BLOCKFROST_URL = 'https://cardano-preprod.blockfrost.io/api/v0';

const cardanoConfigFromEnv = (): CardanoHTLCBrowserConfig => ({
  blockfrostUrl: BLOCKFROST_URL,
  blockfrostApiKey: (import.meta.env.VITE_BLOCKFROST_API_KEY as string | undefined) ?? '',
  network: 'Preprod',
  blueprintUrl: '/plutus.json',
});

interface Props {
  readonly logger: Logger;
  readonly children: React.ReactNode;
}

export const SwapProvider: React.FC<Props> = ({ logger, children }) => {
  const manager = useMemo(() => new BrowserHtlcManager(logger), [logger]);
  const [session, setSession] = useState<SwapSession | undefined>(undefined);
  const [cardano, setCardano] = useState<CardanoSession | undefined>(undefined);
  const [connecting, setConnecting] = useState(false);
  const [cardanoConnecting, setCardanoConnecting] = useState(false);
  const [error, setError] = useState<Error | undefined>(undefined);
  const [cardanoError, setCardanoError] = useState<Error | undefined>(undefined);
  const [inflight, setInflight] = useState<Promise<SwapSession> | undefined>(undefined);
  const [cardanoInflight, setCardanoInflight] = useState<Promise<CardanoSession> | undefined>(undefined);

  const connect = useCallback(async (): Promise<SwapSession> => {
    if (session) return session;
    if (inflight) return inflight;
    setConnecting(true);
    setError(undefined);
    const promise = (async () => {
      try {
        const bootstrap = await manager.getBootstrap();
        const [htlcApi, usdcApi] = await Promise.all([
          HtlcAPI.join(bootstrap.htlcProviders, swapState.htlcContractAddress, logger),
          UsdcAPI.join(bootstrap.usdcProviders, swapState.usdcContractAddress, logger),
        ]);
        const next: SwapSession = { bootstrap, htlcApi, usdcApi };
        setSession(next);
        writeReconnect({ ...readReconnect(), midnight: true });
        return next;
      } catch (e) {
        const err = e instanceof Error ? e : new Error(String(e));
        setError(err);
        throw err;
      } finally {
        setConnecting(false);
        setInflight(undefined);
      }
    })();
    setInflight(promise);
    return promise;
  }, [manager, logger, session, inflight]);

  const connectCardano = useCallback(
    async (walletName?: string): Promise<CardanoSession> => {
      if (cardano) return cardano;
      if (cardanoInflight) return cardanoInflight;
      setCardanoConnecting(true);
      setCardanoError(undefined);
      const promise = (async () => {
        try {
          const config = cardanoConfigFromEnv();
          if (!config.blockfrostApiKey) {
            throw new Error('Missing VITE_BLOCKFROST_API_KEY in .env.preprod');
          }
          const wallet = resolveCIP30Wallet(walletName);
          if (!wallet) {
            throw new Error('No CIP-30 Cardano wallet found. Install Eternl, Lace, Nami, or Flint and refresh.');
          }
          logger.info({ wallet: wallet.name }, 'Enabling Cardano wallet');
          const api = await wallet.enable();
          const [cardanoHtlc, usdmPolicy] = await Promise.all([
            CardanoHTLCBrowser.init(config, logger),
            loadUsdmPolicy(config.blueprintUrl ?? '/plutus.json'),
          ]);
          cardanoHtlc.selectWalletFromCIP30(api);
          const paymentKeyHash = await cardanoHtlc.getPaymentKeyHash();
          const address = await cardanoHtlc.getWalletAddress();
          logger.info({ paymentKeyHash, address, usdmPolicyId: usdmPolicy.policyId }, 'Cardano wallet ready');
          const next: CardanoSession = { cardanoHtlc, usdmPolicy, paymentKeyHash, address, api };
          setCardano(next);
          writeReconnect({ ...readReconnect(), cardano: true });
          return next;
        } catch (e) {
          const err = e instanceof Error ? e : new Error(String(e));
          setCardanoError(err);
          throw err;
        } finally {
          setCardanoConnecting(false);
          setCardanoInflight(undefined);
        }
      })();
      setCardanoInflight(promise);
      return promise;
    },
    [cardano, cardanoInflight, logger],
  );

  const disconnect = useCallback(() => {
    setSession(undefined);
    setCardano(undefined);
    setError(undefined);
    setCardanoError(undefined);
    writeReconnect({});
  }, []);

  // Silent reconnect on mount — only once. Failures clear the relevant
  // flag so we don't loop. No toast on silent attempts: the user may have
  // revoked permission in the wallet UI, in which case the manual Connect
  // path stays available.
  const reconnectAttempted = useRef(false);
  useEffect(() => {
    if (reconnectAttempted.current) return;
    reconnectAttempted.current = true;
    const prev = readReconnect();
    if (prev.midnight) {
      void connect().catch(() => {
        writeReconnect({ ...readReconnect(), midnight: false });
      });
    }
    if (prev.cardano) {
      void connectCardano().catch(() => {
        writeReconnect({ ...readReconnect(), cardano: false });
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const value = useMemo<SwapContextValue>(
    () => ({
      swapState: swapState as SwapState,
      session,
      cardano,
      connecting,
      cardanoConnecting,
      error,
      cardanoError,
      connect,
      connectCardano,
      disconnect,
    }),
    [session, cardano, connecting, cardanoConnecting, error, cardanoError, connect, connectCardano, disconnect],
  );

  return <SwapContext.Provider value={value}>{children}</SwapContext.Provider>;
};
