/**
 * Reverse taker flow — USDC → USDM direction.
 *
 * The taker holds Cardano USDM. They open the maker's share URL, verify the
 * maker's Midnight USDC deposit is bound to the taker's own Midnight
 * credentials, lock USDM on Cardano bound to the maker's PKH, wait for the
 * maker to claim USDM (which reveals the preimage via the tx redeemer), read
 * the preimage back via Blockfrost, then claim USDC on Midnight.
 *
 * Mirror of `useTakerFlow`.
 */

import { useCallback, useEffect, useReducer } from 'react';
import { useSwapContext } from '../../hooks';
import { useToast } from '../../hooks/useToast';
import { watchForHTLCDeposit, watchForPreimageReveal, type HTLCDepositInfo } from '../../api/midnight-watcher';
import { bytesToHex, hexToBytes } from '../../api/key-encoding';
import { limits } from '../../config/limits';
import { orchestratorClient, tryOrchestrator } from '../../api/orchestrator-client';

export interface ReverseURLInputs {
  readonly hashHex: string;
  /** Maker's Cardano payment key hash — the taker binds the Cardano lock to them. */
  readonly makerPkh: string;
  /** Maker's Midnight HTLC deadline (ms). The taker's Cardano deadline nests inside this. */
  readonly midnightDeadlineMs: bigint;
  readonly usdmAmount: bigint;
  readonly usdcAmount: bigint;
}

export type ReverseTakerStep =
  | { kind: 'idle' }
  | { kind: 'verifying-midnight'; url: ReverseURLInputs }
  | { kind: 'mismatch'; url: ReverseURLInputs; reason: string }
  | {
      kind: 'confirm';
      url: ReverseURLInputs;
      midnightInfo: HTLCDepositInfo;
      takerDeadlineMs: bigint;
      truncated: boolean;
    }
  | { kind: 'unsafe-deadline'; url: ReverseURLInputs; reason: string }
  | {
      kind: 'locking';
      url: ReverseURLInputs;
      midnightInfo: HTLCDepositInfo;
      takerDeadlineMs: bigint;
    }
  | {
      kind: 'waiting-preimage';
      url: ReverseURLInputs;
      midnightInfo: HTLCDepositInfo;
      takerDeadlineMs: bigint;
      lockTxHash: string;
    }
  | {
      kind: 'claim-ready';
      url: ReverseURLInputs;
      midnightInfo: HTLCDepositInfo;
      lockTxHash: string;
      preimageHex: string;
    }
  | {
      kind: 'claiming';
      url: ReverseURLInputs;
      midnightInfo: HTLCDepositInfo;
      lockTxHash: string;
      preimageHex: string;
    }
  | {
      kind: 'done';
      url: ReverseURLInputs;
      midnightInfo: HTLCDepositInfo;
      lockTxHash: string;
    }
  | { kind: 'error'; message: string; url?: ReverseURLInputs };

type Action =
  | { t: 'start'; url: ReverseURLInputs }
  | { t: 'mismatch'; reason: string }
  | { t: 'confirm'; midnightInfo: HTLCDepositInfo; takerDeadlineMs: bigint; truncated: boolean }
  | { t: 'unsafe'; reason: string }
  | { t: 'to-locking' }
  | { t: 'locked'; lockTxHash: string }
  | { t: 'preimage-seen'; preimageHex: string }
  | { t: 'to-claiming' }
  | { t: 'to-done' }
  | { t: 'error'; message: string }
  | { t: 'reset' }
  // Resume paths — on page reload, skip ahead if on-chain state is already
  // past `locking` so we don't re-prompt the taker to lock again.
  | {
      t: 'resume-to-waiting-preimage';
      midnightInfo: HTLCDepositInfo;
      takerDeadlineMs: bigint;
      lockTxHash: string;
    }
  | {
      t: 'resume-to-claim-ready';
      midnightInfo: HTLCDepositInfo;
      lockTxHash: string;
      preimageHex: string;
    };

const reducer = (state: ReverseTakerStep, action: Action): ReverseTakerStep => {
  switch (action.t) {
    case 'start':
      return { kind: 'verifying-midnight', url: action.url };
    case 'mismatch':
      return state.kind === 'verifying-midnight' ? { kind: 'mismatch', url: state.url, reason: action.reason } : state;
    case 'confirm':
      return state.kind === 'verifying-midnight'
        ? {
            kind: 'confirm',
            url: state.url,
            midnightInfo: action.midnightInfo,
            takerDeadlineMs: action.takerDeadlineMs,
            truncated: action.truncated,
          }
        : state;
    case 'unsafe':
      return state.kind === 'verifying-midnight'
        ? { kind: 'unsafe-deadline', url: state.url, reason: action.reason }
        : state;
    case 'to-locking':
      return state.kind === 'confirm'
        ? {
            kind: 'locking',
            url: state.url,
            midnightInfo: state.midnightInfo,
            takerDeadlineMs: state.takerDeadlineMs,
          }
        : state;
    case 'locked':
      return state.kind === 'locking'
        ? {
            kind: 'waiting-preimage',
            url: state.url,
            midnightInfo: state.midnightInfo,
            takerDeadlineMs: state.takerDeadlineMs,
            lockTxHash: action.lockTxHash,
          }
        : state;
    case 'preimage-seen':
      return state.kind === 'waiting-preimage'
        ? {
            kind: 'claim-ready',
            url: state.url,
            midnightInfo: state.midnightInfo,
            lockTxHash: state.lockTxHash,
            preimageHex: action.preimageHex,
          }
        : state;
    case 'to-claiming':
      return state.kind === 'claim-ready'
        ? {
            kind: 'claiming',
            url: state.url,
            midnightInfo: state.midnightInfo,
            lockTxHash: state.lockTxHash,
            preimageHex: state.preimageHex,
          }
        : state;
    case 'to-done':
      return state.kind === 'claiming'
        ? {
            kind: 'done',
            url: state.url,
            midnightInfo: state.midnightInfo,
            lockTxHash: state.lockTxHash,
          }
        : state;
    case 'error':
      return { kind: 'error', message: action.message, url: 'url' in state ? state.url : undefined };
    case 'reset':
      return { kind: 'idle' };
    case 'resume-to-waiting-preimage':
      return state.kind === 'verifying-midnight'
        ? {
            kind: 'waiting-preimage',
            url: state.url,
            midnightInfo: action.midnightInfo,
            takerDeadlineMs: action.takerDeadlineMs,
            lockTxHash: action.lockTxHash,
          }
        : state;
    case 'resume-to-claim-ready':
      return state.kind === 'verifying-midnight'
        ? {
            kind: 'claim-ready',
            url: state.url,
            midnightInfo: action.midnightInfo,
            lockTxHash: action.lockTxHash,
            preimageHex: action.preimageHex,
          }
        : state;
    default:
      return state;
  }
};

export const parseReverseUrl = (params: URLSearchParams): ReverseURLInputs | { error: string } => {
  const hashHex = (params.get('hash') ?? '').trim().toLowerCase();
  const makerPkh = (params.get('makerPkh') ?? '').trim().toLowerCase();
  const midnightDeadlineMs = params.get('midnightDeadlineMs');
  // Read-side alias: older URLs carry `adaAmount` — accept as fallback.
  const usdmAmount = params.get('usdmAmount') ?? params.get('adaAmount');
  const usdcAmount = params.get('usdcAmount');
  if (!/^[0-9a-f]{64}$/.test(hashHex)) return { error: 'Missing or invalid hash (64 hex).' };
  if (!/^[0-9a-f]{56}$/.test(makerPkh)) return { error: 'Missing or invalid maker Cardano PKH (56 hex).' };
  if (!midnightDeadlineMs || !usdmAmount || !usdcAmount)
    return { error: 'Missing midnightDeadlineMs / usdmAmount / usdcAmount.' };
  return {
    hashHex,
    makerPkh,
    midnightDeadlineMs: BigInt(midnightDeadlineMs),
    usdmAmount: BigInt(usdmAmount),
    usdcAmount: BigInt(usdcAmount),
  };
};

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

export interface UseReverseTakerFlow {
  state: ReverseTakerStep;
  start: (url: ReverseURLInputs) => void;
  accept: () => void;
  claim: () => Promise<void>;
  reset: () => void;
}

export const useReverseTakerFlow = (): UseReverseTakerFlow => {
  const { session, cardano, swapState } = useSwapContext();
  const toast = useToast();
  const [state, dispatch] = useReducer(reducer, { kind: 'idle' as const });

  // Verify the maker's Midnight deposit is bound to our cpk, and compute a
  // safe Cardano deadline that nests inside the maker's Midnight deadline.
  useEffect(() => {
    if (state.kind !== 'verifying-midnight' || !session || !cardano) return;
    const controller = new AbortController();
    void (async () => {
      try {
        const hashBytes = hexToBytes(state.url.hashHex);
        const info = await watchForHTLCDeposit(
          session.bootstrap.htlcProviders.publicDataProvider,
          session.htlcApi.deployedContractAddress,
          hashBytes,
          5_000,
          controller.signal,
        );

        // Guardrails: receiverAuth must be our cpk; color must be USDC;
        // amount must match the URL.
        const ourCpk = bytesToHex(session.bootstrap.coinPublicKeyBytes);
        const receiverCpk = bytesToHex(info.receiverAuth);
        if (receiverCpk !== ourCpk) {
          dispatch({
            t: 'mismatch',
            reason: `Midnight deposit is bound to a different shielded key — your wallet cannot claim it. Expected ${ourCpk.slice(0, 12)}…, got ${receiverCpk.slice(0, 12)}…`,
          });
          return;
        }
        const colorHex = bytesToHex(info.color);
        if (colorHex !== swapState.usdcColor) {
          dispatch({
            t: 'mismatch',
            reason: `Midnight deposit color does not match USDC. Expected ${swapState.usdcColor.slice(0, 16)}…, got ${colorHex.slice(0, 16)}…`,
          });
          return;
        }
        if (info.amount !== state.url.usdcAmount) {
          dispatch({
            t: 'mismatch',
            reason: `Midnight deposit amount ${info.amount.toString()} does not match offer ${state.url.usdcAmount.toString()}.`,
          });
          return;
        }

        // Safety-window math (mirror of the forward flow).
        const nowSecs = Math.floor(Date.now() / 1000);
        const midnightDeadlineSecs = Math.floor(Number(state.url.midnightDeadlineMs) / 1000);
        const midnightRemaining = midnightDeadlineSecs - nowSecs;
        if (midnightRemaining < limits.bobMinCardanoWindowSecs) {
          dispatch({
            t: 'unsafe',
            reason: `Midnight deadline only ${Math.round(midnightRemaining / 60)}min away — need ≥ ${Math.round(limits.bobMinCardanoWindowSecs / 60)}min. Abort.`,
          });
          return;
        }
        const maxTakerDeadlineSecs = midnightDeadlineSecs - limits.bobSafetyBufferSecs;
        // Reverse flow's second-chain lock is on Cardano, not Midnight, so we
        // need a deadline generous enough for the maker's Cardano claim tx to
        // propagate before expiry. `reverseTakerDeadlineMin` defaults to 5m.
        const desiredTakerDeadlineSecs = nowSecs + limits.reverseTakerDeadlineMin * 60;
        const takerDeadlineSecs = Math.min(desiredTakerDeadlineSecs, maxTakerDeadlineSecs);
        const takerTtlSecs = takerDeadlineSecs - nowSecs;
        if (takerTtlSecs < limits.bobMinDepositTtlSecs) {
          dispatch({
            t: 'unsafe',
            reason: `Cannot pick a safe Cardano deadline: ${Math.max(0, takerTtlSecs)}s remaining after ${limits.bobSafetyBufferSecs}s buffer, need ≥ ${limits.bobMinDepositTtlSecs}s.`,
          });
          return;
        }
        // Resume fast-path: if we already locked USDM on Cardano in a
        // previous session, on-chain state is ahead of the UI. Check for an
        // existing lock (or its preimage if already claimed) and jump past
        // `confirm`/`locking` so we don't re-prompt the user to lock.
        try {
          // First: has the maker already claimed? If so, preimage is in the
          // Cardano tx redeemer and we go straight to claim-ready.
          const preimageHex = await cardano.cardanoHtlc.findClaimPreimage(state.url.hashHex);
          if (controller.signal.aborted) return;
          if (preimageHex) {
            const dbSwap = await orchestratorClient.getSwap(state.url.hashHex).catch(() => undefined);
            dispatch({
              t: 'resume-to-claim-ready',
              midnightInfo: info,
              lockTxHash: dbSwap?.cardanoLockTx ?? '',
              preimageHex,
            });
            return;
          }
          // Otherwise: is our lock UTxO still sitting at the script address?
          const existingLock = (await cardano.cardanoHtlc.listHTLCs()).find(
            (h) => h.datum.preimageHash === state.url.hashHex,
          );
          if (controller.signal.aborted) return;
          if (existingLock) {
            dispatch({
              t: 'resume-to-waiting-preimage',
              midnightInfo: info,
              takerDeadlineMs: existingLock.datum.deadline,
              lockTxHash: existingLock.utxo.txHash,
            });
            return;
          }
        } catch (e) {
          // Non-fatal — fall through to the normal confirm flow.
          console.warn('[useReverseTakerFlow] resume check failed', e);
        }

        dispatch({
          t: 'confirm',
          midnightInfo: info,
          takerDeadlineMs: BigInt(takerDeadlineSecs * 1000),
          truncated: takerDeadlineSecs < desiredTakerDeadlineSecs,
        });
      } catch (e) {
        if (controller.signal.aborted) return;
        dispatch({ t: 'error', message: describeError(e) });
      }
    })();
    return () => controller.abort();
  }, [state, session, cardano, swapState.usdcColor]);

  // Lock USDM on Cardano bound to the maker's PKH. PATCH the orchestrator with
  // `bob_deposited` so the maker's fast-path picks it up ahead of Blockfrost.
  useEffect(() => {
    if (state.kind !== 'locking' || !cardano) return;
    void (async () => {
      try {
        const txHash = await cardano.cardanoHtlc.lock(
          state.url.usdmAmount,
          cardano.usdmPolicy.unit,
          state.url.hashHex,
          state.url.makerPkh,
          state.takerDeadlineMs,
        );
        void tryOrchestrator(
          () =>
            orchestratorClient.patchSwap(state.url.hashHex, {
              status: 'bob_deposited',
              cardanoLockTx: txHash,
              cardanoDeadlineMs: Number(state.takerDeadlineMs),
              bobPkh: cardano.paymentKeyHash,
            }),
          'patchSwap reverse bob_deposited',
        );
        dispatch({ t: 'locked', lockTxHash: txHash });
      } catch (e) {
        const msg = describeError(e);
        toast.error(`Cardano lock failed: ${msg}`);
        dispatch({ t: 'error', message: msg });
      }
    })();
  }, [state, cardano, toast]);

  // Wait for the maker's Cardano claim. Race two sources:
  //   (a) Blockfrost redeemer reading (authoritative, ~slow)
  //   (b) Orchestrator fast-path — the maker patches `midnightPreimage`
  //       the moment their claim tx finalizes, and the server-side
  //       cardano-watcher also relays the preimage it read itself.
  useEffect(() => {
    if (state.kind !== 'waiting-preimage' || !cardano) return;
    const controller = new AbortController();
    let fired = false;
    const finish = (preimage: string): void => {
      if (fired) return;
      fired = true;
      controller.abort();
      dispatch({ t: 'preimage-seen', preimageHex: preimage });
    };

    void (async () => {
      while (!controller.signal.aborted) {
        try {
          const preimage = await cardano.cardanoHtlc.findClaimPreimage(state.url.hashHex);
          if (preimage) {
            finish(preimage);
            return;
          }
        } catch (e) {
          console.warn('[useReverseTakerFlow] findClaimPreimage transient', e);
        }
        await new Promise<void>((resolve) => setTimeout(resolve, 6_000));
      }
    })();

    const pollOrchestrator = async (): Promise<void> => {
      if (fired) return;
      const dbSwap = await orchestratorClient.getSwap(state.url.hashHex).catch(() => undefined);
      if (dbSwap?.midnightPreimage && /^[0-9a-f]{64}$/.test(dbSwap.midnightPreimage)) {
        finish(dbSwap.midnightPreimage);
      }
    };
    void pollOrchestrator();
    const pollTimer = setInterval(() => void pollOrchestrator(), 2000);

    return () => {
      controller.abort();
      clearInterval(pollTimer);
    };
  }, [state, cardano]);

  const start = useCallback((url: ReverseURLInputs) => {
    dispatch({ t: 'start', url });
  }, []);

  const accept = useCallback(() => {
    dispatch({ t: 'to-locking' });
  }, []);

  const claim = useCallback(async (): Promise<void> => {
    if (state.kind !== 'claim-ready' || !session) return;
    dispatch({ t: 'to-claiming' });
    try {
      const preimage = hexToBytes(state.preimageHex);
      // Verify-on-error for Lace submit timeout — see Landmine #5.
      let submitError: unknown;
      let claimTxHash: string | undefined;
      try {
        claimTxHash = await session.htlcApi.withdrawWithPreimage(preimage);
      } catch (e) {
        submitError = e;
        console.warn('[useReverseTakerFlow:claim] submit surfaced error; verifying on-chain', e);
      }

      if (submitError) {
        let claimed = false;
        try {
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), 60_000);
          await watchForPreimageReveal(
            session.bootstrap.htlcProviders.publicDataProvider,
            session.htlcApi.deployedContractAddress,
            hexToBytes(state.url.hashHex),
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
          toast.error(`Midnight claim failed: ${msg}`);
          dispatch({ t: 'error', message: msg });
          return;
        }
        toast.info('Wallet returned an error but the claim landed on-chain — continuing.');
      }

      void tryOrchestrator(
        () =>
          orchestratorClient.patchSwap(state.url.hashHex, {
            status: 'completed',
            midnightClaimTx: claimTxHash,
          }),
        'patchSwap reverse completed',
      );
      dispatch({ t: 'to-done' });
    } catch (e) {
      const msg = describeError(e);
      toast.error(`Midnight claim failed: ${msg}`);
      dispatch({ t: 'error', message: msg });
    }
  }, [state, session, toast]);

  const reset = useCallback(() => {
    dispatch({ t: 'reset' });
  }, []);

  return { state, start, accept, claim, reset };
};
