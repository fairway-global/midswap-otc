/**
 * Maker flow hook — lock USDM on Cardano, watch Midnight for the taker's USDC
 * deposit, claim USDC (revealing the preimage).
 *
 * Extracted 1:1 from the original AliceSwap component. The reducer / effects /
 * localStorage persistence are identical to the CLI reference behaviour. Only
 * the presentation layer has been removed from this file.
 */

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { firstValueFrom } from 'rxjs';
import { useSwapContext } from '../../hooks';
import { useToast } from '../../hooks/useToast';
import { bytesToHex, hexToBytes } from '../../api/key-encoding';
import { watchForPreimageReveal } from '../../api/midnight-watcher';
import { orchestratorClient, tryOrchestrator } from '../../api/orchestrator-client';

export interface MakerLockParams {
  readonly usdmAmount: bigint;
  readonly usdcAmount: bigint;
  readonly deadlineMin: number;
  readonly counterpartyPkh: string;
}

export type MakerStep =
  | { kind: 'idle' }
  | { kind: 'locking' }
  | {
      kind: 'locked';
      hashHex: string;
      preimageHex: string;
      lockTxHash: string;
      deadlineMs: bigint;
      usdmAmount: bigint;
      usdcAmount: bigint;
    }
  | {
      kind: 'waiting-deposit';
      hashHex: string;
      preimageHex: string;
      lockTxHash: string;
      deadlineMs: bigint;
      usdmAmount: bigint;
      usdcAmount: bigint;
    }
  | {
      kind: 'claim-ready';
      hashHex: string;
      preimageHex: string;
      lockTxHash: string;
      deadlineMs: bigint;
      usdmAmount: bigint;
      usdcAmount: bigint;
      depositAmount: bigint;
      depositColorHex: string;
    }
  | {
      kind: 'claiming';
      hashHex: string;
      preimageHex: string;
      lockTxHash: string;
      deadlineMs: bigint;
      usdmAmount: bigint;
      usdcAmount: bigint;
      depositAmount: bigint;
      depositColorHex: string;
    }
  | { kind: 'done'; hashHex: string; lockTxHash: string; usdmAmount: bigint; depositAmount: bigint }
  | { kind: 'error'; message: string };

type MakerAction =
  | { t: 'to-locking' }
  | { t: 'locked'; payload: Extract<MakerStep, { kind: 'locked' }> }
  | { t: 'restore'; payload: Extract<MakerStep, { kind: 'waiting-deposit' }> }
  | { t: 'to-waiting' }
  | { t: 'deposit-seen'; depositAmount: bigint; depositColorHex: string }
  | { t: 'to-claiming' }
  | { t: 'to-done'; depositAmount: bigint }
  | { t: 'error'; message: string }
  | { t: 'reset' };

const reducer = (state: MakerStep, action: MakerAction): MakerStep => {
  switch (action.t) {
    case 'to-locking':
      return { kind: 'locking' };
    case 'locked':
      return action.payload;
    case 'restore':
      return action.payload;
    case 'to-waiting':
      return state.kind === 'locked' ? { ...state, kind: 'waiting-deposit' } : state;
    case 'deposit-seen':
      return state.kind === 'waiting-deposit'
        ? {
            ...state,
            kind: 'claim-ready',
            depositAmount: action.depositAmount,
            depositColorHex: action.depositColorHex,
          }
        : state;
    case 'to-claiming':
      return state.kind === 'claim-ready' ? { ...state, kind: 'claiming' } : state;
    case 'to-done':
      return state.kind === 'claiming' || state.kind === 'claim-ready'
        ? {
            kind: 'done',
            hashHex: state.hashHex,
            lockTxHash: state.lockTxHash,
            usdmAmount: state.usdmAmount,
            depositAmount: action.depositAmount,
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

const PENDING_KEY_PREFIX = 'htlc-ui:alice-pending-swap:';

interface PersistedSwap {
  hashHex: string;
  preimageHex: string;
  lockTxHash: string;
  deadlineMs: string;
  usdmAmount: string;
  usdcAmount: string;
}

const savePending = (cpk: string, swap: PersistedSwap): void => {
  try {
    localStorage.setItem(PENDING_KEY_PREFIX + cpk, JSON.stringify(swap));
  } catch (e) {
    console.warn('[useMakerFlow] localStorage save failed', e);
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
    const cause = (e as Error & { cause?: unknown }).cause;
    const causeStr = cause ? ` (cause: ${typeof cause === 'string' ? cause : JSON.stringify(cause)})` : '';
    if (msg && msg !== 'Unknown error:') return `${msg}${causeStr}`;
    try {
      const own = JSON.stringify(e, Object.getOwnPropertyNames(e));
      return `${msg || 'unknown'} — ${own}${causeStr}`;
    } catch {
      return `${msg || 'unknown error'}${causeStr}`;
    }
  }
  try {
    return JSON.stringify(e);
  } catch {
    return String(e);
  }
};

export interface UseMakerFlow {
  state: MakerStep;
  restoreNotice: string | undefined;
  shareUrl: string | undefined;
  lock: (params: MakerLockParams) => Promise<void>;
  startWaiting: () => void;
  claim: () => Promise<void>;
  forgetPending: () => void;
  reset: () => void;
}

export const useMakerFlow = (): UseMakerFlow => {
  const { session, cardano, swapState } = useSwapContext();
  const toast = useToast();
  const [state, dispatch] = useReducer(reducer, { kind: 'idle' as const });
  const restoreAttemptedRef = useRef(false);
  const [restoreNotice, setRestoreNotice] = useState<string | undefined>(undefined);

  // Resume any pending swap the user had before closing the tab.
  useEffect(() => {
    if (!session || restoreAttemptedRef.current) return;
    restoreAttemptedRef.current = true;
    const cpk = session.bootstrap.coinPublicKeyHex;
    const pending = loadPending(cpk);
    if (!pending) return;
    void (async () => {
      const dbSwap = await orchestratorClient.getSwap(pending.hashHex).catch(() => undefined);
      if (
        dbSwap &&
        (dbSwap.status === 'alice_claimed' ||
          dbSwap.status === 'completed' ||
          dbSwap.status === 'alice_reclaimed' ||
          dbSwap.status === 'expired')
      ) {
        clearPending(cpk);
        return;
      }
      dispatch({
        t: 'restore',
        payload: {
          kind: 'waiting-deposit',
          hashHex: pending.hashHex,
          preimageHex: pending.preimageHex,
          lockTxHash: pending.lockTxHash,
          deadlineMs: BigInt(pending.deadlineMs),
          // Legacy restore: pre-USDM records stored the amount as `adaAmount`.
          usdmAmount: BigInt(pending.usdmAmount ?? (pending as unknown as { adaAmount: string }).adaAmount),
          usdcAmount: BigInt(pending.usdcAmount),
        },
      });
      setRestoreNotice(
        `Resumed pending swap ${pending.hashHex.slice(0, 12)}… — watching for the counterparty deposit.`,
      );
    })();
  }, [session]);

  const shareUrl = useMemo(() => {
    if (
      !session ||
      (state.kind !== 'locked' &&
        state.kind !== 'waiting-deposit' &&
        state.kind !== 'claim-ready' &&
        state.kind !== 'claiming')
    ) {
      return undefined;
    }
    const url = new URL(window.location.origin);
    url.pathname = '/swap';
    url.searchParams.set('role', 'bob');
    url.searchParams.set('hash', state.hashHex);
    url.searchParams.set('aliceCpk', session.bootstrap.coinPublicKeyHex);
    url.searchParams.set('aliceUnshielded', session.bootstrap.unshieldedAddressHex);
    url.searchParams.set('cardanoDeadlineMs', state.deadlineMs.toString());
    url.searchParams.set('usdmAmount', state.usdmAmount.toString());
    url.searchParams.set('usdcAmount', state.usdcAmount.toString());
    return url.toString();
  }, [session, state]);

  const lock = useCallback(
    async (params: MakerLockParams): Promise<void> => {
      if (!session || !cardano) {
        throw new Error('Connect both wallets before locking.');
      }
      dispatch({ t: 'to-locking' });
      try {
        const preimage = randomBytes32();
        const hashLock = await sha256(preimage);
        const hashHex = bytesToHex(hashLock);
        const preimageHex = bytesToHex(preimage);
        const deadlineMs = BigInt(Date.now() + params.deadlineMin * 60 * 1000);

        const lockTxHash = await cardano.cardanoHtlc.lock(
          params.usdmAmount,
          cardano.usdmPolicy.unit,
          hashHex,
          params.counterpartyPkh,
          deadlineMs,
        );

        savePending(session.bootstrap.coinPublicKeyHex, {
          hashHex,
          preimageHex,
          lockTxHash,
          deadlineMs: deadlineMs.toString(),
          usdmAmount: params.usdmAmount.toString(),
          usdcAmount: params.usdcAmount.toString(),
        });

        void tryOrchestrator(
          () =>
            orchestratorClient.createSwap({
              hash: hashHex,
              direction: 'usdm-usdc',
              aliceCpk: session.bootstrap.coinPublicKeyHex,
              aliceUnshielded: session.bootstrap.unshieldedAddressHex,
              usdmAmount: params.usdmAmount.toString(),
              usdcAmount: params.usdcAmount.toString(),
              cardanoDeadlineMs: Number(deadlineMs),
              cardanoLockTx: lockTxHash,
              bobPkh: params.counterpartyPkh,
            }),
          'createSwap',
        );

        dispatch({
          t: 'locked',
          payload: {
            kind: 'locked',
            hashHex,
            preimageHex,
            lockTxHash,
            deadlineMs,
            usdmAmount: params.usdmAmount,
            usdcAmount: params.usdcAmount,
          },
        });
      } catch (e) {
        console.error('[useMakerFlow:lock]', e);
        const msg = describeError(e);
        toast.error(`Lock failed: ${msg}`);
        dispatch({ t: 'error', message: msg });
      }
    },
    [session, cardano, toast],
  );

  const startWaiting = useCallback(() => {
    dispatch({ t: 'to-waiting' });
  }, []);

  // Auto-transition locked -> waiting-deposit. This is a deliberate UX
  // simplification vs the original CLI reference: the share URL is still
  // prominently surfaced inside the progress modal, so requiring an extra
  // "start watching" click didn't add safety. `startWaiting` remains exported
  // in case a caller wants to revert to a click-to-watch gate.
  useEffect(() => {
    if (state.kind === 'locked') {
      dispatch({ t: 'to-waiting' });
    }
  }, [state.kind]);

  // Subscribe to htlcApi.state$ and match on our hash.
  useEffect(() => {
    if (state.kind !== 'waiting-deposit' || !session) return;
    const sub = session.htlcApi.state$.subscribe({
      next: (derived) => {
        const entry = derived.entries.get(state.hashHex);
        if (entry && entry.amount > 0n) {
          void tryOrchestrator(
            () =>
              orchestratorClient.patchSwap(state.hashHex, {
                status: 'bob_deposited',
                bobCpk: bytesToHex(entry.senderAuth),
                midnightDeadlineMs: Number(entry.expirySecs) * 1000,
              }),
            'patchSwap bob_deposited',
          );
          dispatch({
            t: 'deposit-seen',
            depositAmount: entry.amount,
            depositColorHex: bytesToHex(entry.color),
          });
        }
      },
    });
    return () => sub.unsubscribe();
  }, [state, session]);

  // Fast-path: poll orchestrator — the counterparty PATCHes `bob_deposited`
  // as soon as their Midnight tx finalizes, often before the indexer.
  useEffect(() => {
    if (state.kind !== 'waiting-deposit') return;
    let cancelled = false;
    const tick = async (): Promise<void> => {
      const dbSwap = await orchestratorClient.getSwap(state.hashHex).catch(() => undefined);
      if (cancelled) return;
      if (
        dbSwap &&
        (dbSwap.status === 'bob_deposited' || dbSwap.status === 'alice_claimed' || dbSwap.status === 'completed')
      ) {
        dispatch({
          t: 'deposit-seen',
          depositAmount: state.usdcAmount,
          depositColorHex: swapState.usdcColor,
        });
      }
    };
    void tick();
    const id = setInterval(() => void tick(), 2000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [state, swapState.usdcColor]);

  const claim = useCallback(async (): Promise<void> => {
    if (state.kind !== 'claim-ready' || !session) return;
    dispatch({ t: 'to-claiming' });
    try {
      // Pre-flight deadline check. The contract rejects `withdrawWithPreimage`
      // with "HTLC has expired" once `htlcExpiries[hash] <= currentTimeSecs()`.
      // The SDK's own check uses potentially stale state — it can succeed
      // locally while the tx lands past the deadline and reverts as a
      // `SegmentFail`. Read the fresh entry here, bail with a clear message
      // if the window is gone or too tight for tx propagation.
      const derived = await firstValueFrom(session.htlcApi.state$);
      const entry = derived.entries.get(state.hashHex);
      if (entry) {
        const nowSecs = Math.floor(Date.now() / 1000);
        const remaining = Number(entry.expirySecs) - nowSecs;
        if (remaining <= 0) {
          throw new Error(
            `HTLC has already expired on Midnight (${Math.abs(remaining)}s ago). The counterparty can reclaim their USDC; ask them to redeposit with a fresher deadline.`,
          );
        }
        if (remaining < 60) {
          throw new Error(
            `HTLC deadline too close to safely submit (${remaining}s left). Submitting now risks a post-deadline rejection — ask the counterparty to redeposit with a fresher deadline.`,
          );
        }
      }

      const preimage = hexToBytes(state.preimageHex);
      // Lace's submitTransaction sometimes throws "Request timed out" even when
      // the tx lands on-chain (Landmine #5). Before failing, verify the claim
      // by watching `revealedPreimages[hash]` on the Midnight indexer.
      let submitError: unknown;
      try {
        await session.htlcApi.withdrawWithPreimage(preimage);
      } catch (e) {
        submitError = e;
        console.warn('[useMakerFlow:claim] submit surfaced error; verifying on-chain', e);
      }

      if (submitError) {
        let claimed = false;
        try {
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), 60_000);
          await watchForPreimageReveal(
            session.bootstrap.htlcProviders.publicDataProvider,
            session.htlcApi.deployedContractAddress,
            hexToBytes(state.hashHex),
            5_000,
            controller.signal,
          );
          clearTimeout(timer);
          claimed = true;
        } catch {
          /* abort = preimage never surfaced within window */
        }
        if (!claimed) {
          const msg = describeError(submitError);
          toast.error(`Claim failed: ${msg}`);
          dispatch({ t: 'error', message: msg });
          return;
        }
        toast.info('Wallet returned an error but the claim landed on-chain — continuing.');
      }

      void tryOrchestrator(
        () =>
          orchestratorClient.patchSwap(state.hashHex, {
            status: 'alice_claimed',
            midnightPreimage: state.preimageHex,
          }),
        'patchSwap alice_claimed',
      );
      clearPending(session.bootstrap.coinPublicKeyHex);
      dispatch({ t: 'to-done', depositAmount: state.depositAmount });
    } catch (e) {
      console.error('[useMakerFlow:claim]', e);
      const msg = describeError(e);
      toast.error(`Claim failed: ${msg}`);
      dispatch({ t: 'error', message: msg });
    }
  }, [state, session, toast]);

  const forgetPending = useCallback(() => {
    if (!session) return;
    clearPending(session.bootstrap.coinPublicKeyHex);
    setRestoreNotice(undefined);
    dispatch({ t: 'reset' });
  }, [session]);

  const reset = useCallback(() => {
    dispatch({ t: 'reset' });
  }, []);

  return { state, restoreNotice, shareUrl, lock, startWaiting, claim, forgetPending, reset };
};
