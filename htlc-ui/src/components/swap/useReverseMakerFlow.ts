/**
 * Reverse maker flow — USDC → ADA direction.
 *
 * The maker holds native Midnight USDC and wants Cardano ADA. They deposit
 * USDC on Midnight first (bound to the counterparty's Midnight credentials),
 * then wait for the counterparty to lock ADA on Cardano bound to the maker's
 * PKH, then claim that ADA on Cardano by revealing the preimage — which the
 * counterparty reads from the Cardano tx redeemer to claim USDC on Midnight.
 *
 * This is the mirror image of `useMakerFlow`. The preimage still moves the
 * same way; only which chain each party locks on is swapped.
 */

import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { useSwapContext } from '../../hooks';
import { useToast } from '../../hooks/useToast';
import { bytesToHex, hexToBytes, userEither } from '../../api/key-encoding';
import { watchForCardanoLock, type CardanoHTLCInfo } from '../../api/cardano-watcher';

export interface ReverseMakerLockParams {
  readonly adaAmount: bigint;
  readonly usdcAmount: bigint;
  readonly deadlineMin: number;
  /** Counterparty's Midnight shielded coin public key as 64-hex (decoded bytes). */
  readonly counterpartyCpkBytes: Uint8Array;
  /** Counterparty's Midnight unshielded address as 64-hex (decoded bytes). */
  readonly counterpartyUnshieldedBytes: Uint8Array;
}

export type ReverseMakerStep =
  | { kind: 'idle' }
  | { kind: 'depositing' }
  | {
      kind: 'deposited';
      hashHex: string;
      preimageHex: string;
      midnightDeadlineMs: bigint;
      adaAmount: bigint;
      usdcAmount: bigint;
    }
  | {
      kind: 'waiting-cardano';
      hashHex: string;
      preimageHex: string;
      midnightDeadlineMs: bigint;
      adaAmount: bigint;
      usdcAmount: bigint;
    }
  | {
      kind: 'claim-ready';
      hashHex: string;
      preimageHex: string;
      midnightDeadlineMs: bigint;
      adaAmount: bigint;
      usdcAmount: bigint;
      cardanoHtlc: CardanoHTLCInfo;
    }
  | {
      kind: 'claiming';
      hashHex: string;
      preimageHex: string;
      midnightDeadlineMs: bigint;
      adaAmount: bigint;
      usdcAmount: bigint;
      cardanoHtlc: CardanoHTLCInfo;
    }
  | {
      kind: 'done';
      hashHex: string;
      adaAmount: bigint;
      usdcAmount: bigint;
      claimTxHash: string;
    }
  | { kind: 'error'; message: string };

type Action =
  | { t: 'to-depositing' }
  | { t: 'deposited'; payload: Extract<ReverseMakerStep, { kind: 'deposited' }> }
  | { t: 'restore'; payload: Extract<ReverseMakerStep, { kind: 'waiting-cardano' }> }
  | { t: 'to-waiting' }
  | { t: 'cardano-seen'; cardanoHtlc: CardanoHTLCInfo }
  | { t: 'to-claiming' }
  | { t: 'to-done'; claimTxHash: string }
  | { t: 'error'; message: string }
  | { t: 'reset' };

const reducer = (state: ReverseMakerStep, action: Action): ReverseMakerStep => {
  switch (action.t) {
    case 'to-depositing':
      return { kind: 'depositing' };
    case 'deposited':
      return action.payload;
    case 'restore':
      return action.payload;
    case 'to-waiting':
      return state.kind === 'deposited' ? { ...state, kind: 'waiting-cardano' } : state;
    case 'cardano-seen':
      return state.kind === 'waiting-cardano'
        ? { ...state, kind: 'claim-ready', cardanoHtlc: action.cardanoHtlc }
        : state;
    case 'to-claiming':
      return state.kind === 'claim-ready' ? { ...state, kind: 'claiming' } : state;
    case 'to-done':
      return state.kind === 'claiming' || state.kind === 'claim-ready'
        ? {
            kind: 'done',
            hashHex: state.hashHex,
            adaAmount: state.adaAmount,
            usdcAmount: state.usdcAmount,
            claimTxHash: action.claimTxHash,
          }
        : state;
    case 'error':
      return { kind: 'error', message: action.message };
    case 'reset':
      return { kind: 'idle' };
    default:
      return state;
  }
};

const PENDING_KEY_PREFIX = 'htlc-ui:reverse-maker-pending-swap:';

interface PersistedSwap {
  hashHex: string;
  preimageHex: string;
  midnightDeadlineMs: string;
  adaAmount: string;
  usdcAmount: string;
}

const savePending = (cpk: string, swap: PersistedSwap): void => {
  try {
    localStorage.setItem(PENDING_KEY_PREFIX + cpk, JSON.stringify(swap));
  } catch (e) {
    console.warn('[useReverseMakerFlow] localStorage save failed', e);
  }
};

const loadPending = (cpk: string): PersistedSwap | undefined => {
  try {
    const raw = localStorage.getItem(PENDING_KEY_PREFIX + cpk);
    return raw ? (JSON.parse(raw) as PersistedSwap) : undefined;
  } catch {
    return undefined;
  }
};

const clearPending = (cpk: string): void => {
  try {
    localStorage.removeItem(PENDING_KEY_PREFIX + cpk);
  } catch {
    /* ignore */
  }
};

const sha256 = async (bytes: Uint8Array): Promise<Uint8Array> => {
  const digest = await crypto.subtle.digest('SHA-256', bytes as BufferSource);
  return new Uint8Array(digest);
};

const randomBytes32 = (): Uint8Array => crypto.getRandomValues(new Uint8Array(32));

const describeError = (e: unknown): string => {
  if (e instanceof Error) {
    const msg = e.message?.trim();
    return msg && msg !== 'Unknown error:' ? msg : 'Unknown error';
  }
  try {
    return JSON.stringify(e);
  } catch {
    return String(e);
  }
};

export interface UseReverseMakerFlow {
  state: ReverseMakerStep;
  restoreNotice: string | undefined;
  shareUrl: string | undefined;
  deposit: (params: ReverseMakerLockParams) => Promise<void>;
  claim: () => Promise<void>;
  forgetPending: () => void;
  reset: () => void;
}

export const useReverseMakerFlow = (): UseReverseMakerFlow => {
  const { session, cardano, swapState } = useSwapContext();
  const toast = useToast();
  const [state, dispatch] = useReducer(reducer, { kind: 'idle' as const });
  const restoreAttemptedRef = useRef(false);
  const [restoreNotice, setRestoreNotice] = useState<string | undefined>(undefined);

  // Resume any pending swap from localStorage (survives browser restart).
  useEffect(() => {
    if (!session || restoreAttemptedRef.current) return;
    restoreAttemptedRef.current = true;
    const cpk = session.bootstrap.coinPublicKeyHex;
    const pending = loadPending(cpk);
    if (!pending) return;
    dispatch({
      t: 'restore',
      payload: {
        kind: 'waiting-cardano',
        hashHex: pending.hashHex,
        preimageHex: pending.preimageHex,
        midnightDeadlineMs: BigInt(pending.midnightDeadlineMs),
        adaAmount: BigInt(pending.adaAmount),
        usdcAmount: BigInt(pending.usdcAmount),
      },
    });
    setRestoreNotice(
      `Resumed pending USDC→ADA swap ${pending.hashHex.slice(0, 12)}… — watching Cardano for the counterparty lock.`,
    );
  }, [session]);

  // Auto-transition deposited → waiting-cardano so the Cardano watcher fires.
  useEffect(() => {
    if (state.kind === 'deposited') dispatch({ t: 'to-waiting' });
  }, [state.kind]);

  // Watch Cardano for the counterparty's lock bound to our own PKH.
  useEffect(() => {
    if (state.kind !== 'waiting-cardano' || !cardano) return;
    const controller = new AbortController();
    void (async () => {
      try {
        const htlcInfo = await watchForCardanoLock(
          cardano.cardanoHtlc,
          cardano.paymentKeyHash,
          10_000,
          state.hashHex,
          controller.signal,
        );
        dispatch({ t: 'cardano-seen', cardanoHtlc: htlcInfo });
      } catch (e) {
        if (controller.signal.aborted) return;
        dispatch({ t: 'error', message: describeError(e) });
      }
    })();
    return () => controller.abort();
  }, [state, cardano]);

  // Share URL — this is what the reverse maker gives to the taker.
  // Carries direction=usdc-ada and every field the taker needs (including
  // our PKH so their Cardano lock is bound to us).
  const shareUrl = (() => {
    if (
      state.kind !== 'deposited' &&
      state.kind !== 'waiting-cardano' &&
      state.kind !== 'claim-ready' &&
      state.kind !== 'claiming'
    ) {
      return undefined;
    }
    if (!session || !cardano) return undefined;
    const url = new URL(window.location.origin);
    url.pathname = '/swap';
    url.searchParams.set('direction', 'usdc-ada');
    url.searchParams.set('hash', state.hashHex);
    url.searchParams.set('makerPkh', cardano.paymentKeyHash);
    url.searchParams.set('midnightDeadlineMs', state.midnightDeadlineMs.toString());
    url.searchParams.set('adaAmount', state.adaAmount.toString());
    url.searchParams.set('usdcAmount', state.usdcAmount.toString());
    return url.toString();
  })();

  const deposit = useCallback(
    async (params: ReverseMakerLockParams): Promise<void> => {
      if (!session || !cardano) {
        throw new Error('Connect both wallets before depositing.');
      }
      dispatch({ t: 'to-depositing' });
      try {
        const preimage = randomBytes32();
        const hashLock = await sha256(preimage);
        const hashHex = bytesToHex(hashLock);
        const preimageHex = bytesToHex(preimage);
        const midnightDeadlineMs = BigInt(Date.now() + params.deadlineMin * 60 * 1000);
        const midnightDeadlineSecs = midnightDeadlineMs / 1000n;

        const usdcColor = hexToBytes(swapState.usdcColor);

        await session.htlcApi.deposit({
          color: usdcColor,
          amount: params.usdcAmount,
          hash: hashLock,
          expirySecs: midnightDeadlineSecs,
          receiverAuth: params.counterpartyCpkBytes,
          receiverPayout: userEither(params.counterpartyUnshieldedBytes),
          senderPayout: userEither(session.bootstrap.unshieldedAddressBytes),
        });

        savePending(session.bootstrap.coinPublicKeyHex, {
          hashHex,
          preimageHex,
          midnightDeadlineMs: midnightDeadlineMs.toString(),
          adaAmount: params.adaAmount.toString(),
          usdcAmount: params.usdcAmount.toString(),
        });

        dispatch({
          t: 'deposited',
          payload: {
            kind: 'deposited',
            hashHex,
            preimageHex,
            midnightDeadlineMs,
            adaAmount: params.adaAmount,
            usdcAmount: params.usdcAmount,
          },
        });
      } catch (e) {
        console.error('[useReverseMakerFlow:deposit]', e);
        const msg = describeError(e);
        toast.error(`Deposit failed: ${msg}`);
        dispatch({ t: 'error', message: msg });
      }
    },
    [session, cardano, swapState.usdcColor, toast],
  );

  const claim = useCallback(async (): Promise<void> => {
    if (state.kind !== 'claim-ready' || !cardano || !session) return;
    dispatch({ t: 'to-claiming' });
    try {
      // Claiming ADA on Cardano with the preimage reveals it via the
      // transaction redeemer. The counterparty reads it via Blockfrost
      // (cardano.cardanoHtlc.findClaimPreimage) and claims USDC on Midnight.
      const claimTxHash = await cardano.cardanoHtlc.claim(state.preimageHex);
      clearPending(session.bootstrap.coinPublicKeyHex);
      dispatch({ t: 'to-done', claimTxHash });
    } catch (e) {
      console.error('[useReverseMakerFlow:claim]', e);
      const msg = describeError(e);
      toast.error(`Claim failed: ${msg}`);
      dispatch({ t: 'error', message: msg });
    }
  }, [state, cardano, session, toast]);

  const forgetPending = useCallback(() => {
    if (!session) return;
    clearPending(session.bootstrap.coinPublicKeyHex);
    setRestoreNotice(undefined);
    dispatch({ t: 'reset' });
  }, [session]);

  const reset = useCallback(() => {
    dispatch({ t: 'reset' });
  }, []);

  return { state, restoreNotice, shareUrl, deposit, claim, forgetPending, reset };
};
