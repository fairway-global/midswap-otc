/**
 * Taker flow hook — watch Cardano for the maker's lock, deposit USDC on
 * Midnight, wait for the preimage reveal, claim USDM on Cardano.
 *
 * Extracted 1:1 from the original BobSwap component. Safety checks against
 * CLAUDE.md §11 (bech32m decoding, `watchForCardanoLock` filter signature,
 * deadline truncation floors) are preserved verbatim.
 */

import { useCallback, useEffect, useReducer } from 'react';
import { firstValueFrom } from 'rxjs';
import { useSwapContext } from '../../hooks';
import { useToast } from '../../hooks/useToast';
import { watchForCardanoLock, type CardanoHTLCInfo } from '../../api/cardano-watcher';
import { watchForHTLCDeposit, watchForPreimageReveal } from '../../api/midnight-watcher';
import { bytesToHex, hexToBytes, userEither } from '../../api/key-encoding';
import { orchestratorClient, tryOrchestrator } from '../../api/orchestrator-client';
import { limits } from '../../config/limits';

export interface URLInputs {
  readonly hashHex: string;
  readonly aliceCpkHex: string;
  readonly aliceUnshieldedHex: string;
  readonly cardanoDeadlineMs: bigint;
  readonly usdmAmount: bigint;
  readonly usdcAmount: bigint;
}

export type TakerStep =
  | { kind: 'idle' }
  | { kind: 'watching-cardano'; url: URLInputs }
  | { kind: 'confirm'; url: URLInputs; htlcInfo: CardanoHTLCInfo; bobDeadlineSecs: bigint; truncated: boolean }
  | { kind: 'unsafe-deadline'; url: URLInputs; htlcInfo: CardanoHTLCInfo; reason: string }
  | { kind: 'depositing'; url: URLInputs; htlcInfo: CardanoHTLCInfo; bobDeadlineSecs: bigint }
  | { kind: 'waiting-preimage'; url: URLInputs; htlcInfo: CardanoHTLCInfo; depositTxHash?: string }
  | { kind: 'claim-ready'; url: URLInputs; htlcInfo: CardanoHTLCInfo; preimageHex: string; depositTxHash?: string }
  | { kind: 'claiming'; url: URLInputs; htlcInfo: CardanoHTLCInfo; preimageHex: string; depositTxHash?: string }
  | { kind: 'done'; url: URLInputs; htlcInfo: CardanoHTLCInfo; claimTxHash: string; depositTxHash?: string }
  | { kind: 'error'; message: string; url?: URLInputs };

type TakerAction =
  | { t: 'start'; url: URLInputs }
  | { t: 'lock-seen'; htlcInfo: CardanoHTLCInfo; bobDeadlineSecs: bigint; truncated: boolean }
  | { t: 'unsafe'; reason: string; htlcInfo: CardanoHTLCInfo }
  | { t: 'to-depositing' }
  | { t: 'to-waiting-preimage'; depositTxHash?: string }
  | { t: 'preimage-seen'; preimageHex: string }
  | { t: 'to-claiming' }
  | { t: 'to-done'; claimTxHash: string }
  | { t: 'error'; message: string }
  | { t: 'reset' }
  // Resume paths — on page reload, if on-chain state is ahead of the UI
  // state, jump straight to the right step instead of re-prompting the user
  // to deposit again.
  | { t: 'resume-to-waiting-preimage'; htlcInfo: CardanoHTLCInfo }
  | { t: 'resume-to-claim-ready'; htlcInfo: CardanoHTLCInfo; preimageHex: string };

const reducer = (state: TakerStep, action: TakerAction): TakerStep => {
  switch (action.t) {
    case 'start':
      return { kind: 'watching-cardano', url: action.url };
    case 'lock-seen':
      return state.kind === 'watching-cardano'
        ? {
            kind: 'confirm',
            url: state.url,
            htlcInfo: action.htlcInfo,
            bobDeadlineSecs: action.bobDeadlineSecs,
            truncated: action.truncated,
          }
        : state;
    case 'unsafe':
      return state.kind === 'watching-cardano'
        ? { kind: 'unsafe-deadline', url: state.url, htlcInfo: action.htlcInfo, reason: action.reason }
        : state;
    case 'to-depositing':
      return state.kind === 'confirm'
        ? { kind: 'depositing', url: state.url, htlcInfo: state.htlcInfo, bobDeadlineSecs: state.bobDeadlineSecs }
        : state;
    case 'to-waiting-preimage':
      return state.kind === 'depositing'
        ? {
            kind: 'waiting-preimage',
            url: state.url,
            htlcInfo: state.htlcInfo,
            depositTxHash: action.depositTxHash,
          }
        : state;
    case 'preimage-seen':
      return state.kind === 'waiting-preimage'
        ? {
            kind: 'claim-ready',
            url: state.url,
            htlcInfo: state.htlcInfo,
            preimageHex: action.preimageHex,
            depositTxHash: state.depositTxHash,
          }
        : state;
    case 'to-claiming':
      return state.kind === 'claim-ready'
        ? {
            kind: 'claiming',
            url: state.url,
            htlcInfo: state.htlcInfo,
            preimageHex: state.preimageHex,
            depositTxHash: state.depositTxHash,
          }
        : state;
    case 'to-done':
      return state.kind === 'claiming'
        ? {
            kind: 'done',
            url: state.url,
            htlcInfo: state.htlcInfo,
            claimTxHash: action.claimTxHash,
            depositTxHash: state.depositTxHash,
          }
        : state;
    case 'error':
      return { kind: 'error', message: action.message, url: 'url' in state ? state.url : undefined };
    case 'reset':
      return { kind: 'idle' };
    case 'resume-to-waiting-preimage':
      return state.kind === 'watching-cardano'
        ? { kind: 'waiting-preimage', url: state.url, htlcInfo: action.htlcInfo }
        : state;
    case 'resume-to-claim-ready':
      return state.kind === 'watching-cardano'
        ? { kind: 'claim-ready', url: state.url, htlcInfo: action.htlcInfo, preimageHex: action.preimageHex }
        : state;
    default:
      return state;
  }
};

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

export const parseUrlInputs = (params: URLSearchParams): URLInputs | { error: string } => {
  const hashHex = (params.get('hash') ?? '').trim().toLowerCase();
  const aliceCpkHex = (params.get('aliceCpk') ?? '').trim().toLowerCase();
  const aliceUnshieldedHex = (params.get('aliceUnshielded') ?? '').trim().toLowerCase();
  const cardanoDeadlineMs = params.get('cardanoDeadlineMs');
  // Read-side alias: older URLs carry `adaAmount` — accept as fallback.
  const usdmAmount = params.get('usdmAmount') ?? params.get('adaAmount');
  const usdcAmount = params.get('usdcAmount');
  if (!hashHex || !/^[0-9a-f]{64}$/.test(hashHex)) return { error: 'Missing or invalid hash (64 hex).' };
  if (!aliceCpkHex || !/^[0-9a-f]{64}$/.test(aliceCpkHex)) return { error: 'Missing or invalid maker key (64 hex).' };
  if (!aliceUnshieldedHex || !/^[0-9a-f]{64}$/.test(aliceUnshieldedHex))
    return { error: 'Missing or invalid maker unshielded address (64 hex).' };
  if (!cardanoDeadlineMs || !usdmAmount || !usdcAmount)
    return { error: 'Missing cardanoDeadlineMs / usdmAmount / usdcAmount.' };
  return {
    hashHex,
    aliceCpkHex,
    aliceUnshieldedHex,
    cardanoDeadlineMs: BigInt(cardanoDeadlineMs),
    usdmAmount: BigInt(usdmAmount),
    usdcAmount: BigInt(usdcAmount),
  };
};

export interface UseTakerFlow {
  state: TakerStep;
  start: (url: URLInputs) => void;
  accept: () => void;
  claim: () => Promise<void>;
  reset: () => void;
}

export const useTakerFlow = (): UseTakerFlow => {
  const { session, cardano, swapState } = useSwapContext();
  const toast = useToast();
  const [state, dispatch] = useReducer(reducer, { kind: 'idle' as const });

  // Watch Cardano for the maker's lock.
  useEffect(() => {
    if (state.kind !== 'watching-cardano' || !cardano) return;
    const controller = new AbortController();
    void (async () => {
      try {
        const htlcInfo = await watchForCardanoLock(
          cardano.cardanoHtlc,
          cardano.usdmPolicy.unit,
          cardano.paymentKeyHash,
          10_000,
          state.url.hashHex,
          controller.signal,
        );

        // Resume fast-path: if the taker already deposited in a previous
        // session (page reload / tab close), on-chain state is already ahead
        // of the UI. Read the Midnight HTLC entry and jump straight to the
        // right step instead of re-prompting "Deposit USDC".
        //   • revealedPreimage set  → maker already claimed → claim-ready
        //   • amount > 0 (bound to aliceCpk) → deposit landed → waiting-preimage
        //   • otherwise → normal confirm flow
        if (session) {
          try {
            const derived = await firstValueFrom(session.htlcApi.state$);
            if (controller.signal.aborted) return;
            const entry = derived.entries.get(state.url.hashHex);
            if (entry) {
              const receiverCpk = bytesToHex(entry.receiverAuth).toLowerCase();
              const expectedAliceCpk = state.url.aliceCpkHex.toLowerCase();
              if (receiverCpk === expectedAliceCpk) {
                if (entry.revealedPreimage) {
                  dispatch({
                    t: 'resume-to-claim-ready',
                    htlcInfo,
                    preimageHex: bytesToHex(entry.revealedPreimage),
                  });
                  return;
                }
                if (entry.amount > 0n) {
                  dispatch({ t: 'resume-to-waiting-preimage', htlcInfo });
                  return;
                }
              }
            }
          } catch (e) {
            // Non-fatal: fall through to normal confirm flow — the user can
            // still proceed via the verify-on-error deposit path.
            console.warn('[useTakerFlow] resume check failed', e);
          }
        }

        const nowSecs = Math.floor(Date.now() / 1000);
        const cardanoDeadlineSecs = Math.floor(Number(htlcInfo.deadlineMs) / 1000);
        const cardanoRemaining = cardanoDeadlineSecs - nowSecs;
        if (cardanoRemaining < limits.bobMinCardanoWindowSecs) {
          dispatch({
            t: 'unsafe',
            htlcInfo,
            reason: `Cardano deadline only ${Math.round(cardanoRemaining / 60)}min away — need ≥ ${Math.round(limits.bobMinCardanoWindowSecs / 60)}min. Abort.`,
          });
          return;
        }
        const maxBobDeadlineSecs = cardanoDeadlineSecs - limits.bobSafetyBufferSecs;
        const desiredBobDeadlineSecs = nowSecs + limits.bobDeadlineMin * 60;
        const bobDeadlineSecs = Math.min(desiredBobDeadlineSecs, maxBobDeadlineSecs);
        const bobTtlSecs = bobDeadlineSecs - nowSecs;
        if (bobTtlSecs < limits.bobMinDepositTtlSecs) {
          dispatch({
            t: 'unsafe',
            htlcInfo,
            reason: `Cannot pick a safe Midnight deadline: ${Math.max(0, bobTtlSecs)}s remaining after ${limits.bobSafetyBufferSecs}s buffer, need ≥ ${limits.bobMinDepositTtlSecs}s.`,
          });
          return;
        }
        dispatch({
          t: 'lock-seen',
          htlcInfo,
          bobDeadlineSecs: BigInt(bobDeadlineSecs),
          truncated: bobDeadlineSecs < desiredBobDeadlineSecs,
        });
      } catch (e) {
        if (controller.signal.aborted) return;
        console.error('[useTakerFlow] cardano watch failed', e);
        dispatch({ t: 'error', message: describeError(e) });
      }
    })();
    return () => controller.abort();
  }, [state, cardano]);

  // Send the deposit tx when entering `depositing`.
  //
  // Resilience to the Lace dApp-connector quirk where `submitTransaction`
  // surfaces an error even when the tx actually landed on-chain:
  //
  //   1. If deposit() throws, do NOT go straight to error. First verify via
  //      the Midnight indexer whether the HTLC entry already exists for our
  //      hash. If it does AND receiverAuth matches the maker's cpk from the
  //      URL, treat as a successful deposit (an earlier attempt landed).
  //   2. If the error is specifically "HTLC already active for this hash",
  //      that's a strong signal a prior attempt succeeded — verify the entry
  //      belongs to the right swap (our hash, right receiverAuth) and resume.
  useEffect(() => {
    if (state.kind !== 'depositing' || !session) return;
    void (async () => {
      const hashBytes = hexToBytes(state.url.hashHex);
      const aliceAuthBytes = hexToBytes(state.url.aliceCpkHex);
      const aliceUnshieldedBytes = hexToBytes(state.url.aliceUnshieldedHex);
      const bobUnshieldedBytes = session.bootstrap.unshieldedAddressBytes;
      const usdcColor = hexToBytes(swapState.usdcColor);

      let depositTxHash: string | undefined;
      let submitError: unknown;
      try {
        depositTxHash = await session.htlcApi.deposit({
          color: usdcColor,
          amount: state.url.usdcAmount,
          hash: hashBytes,
          expirySecs: state.bobDeadlineSecs,
          receiverAuth: aliceAuthBytes,
          receiverPayout: userEither(aliceUnshieldedBytes),
          senderPayout: userEither(bobUnshieldedBytes),
        });
      } catch (e) {
        submitError = e;
        console.warn('[useTakerFlow] deposit submit surfaced error; verifying on-chain', e);
      }

      if (submitError) {
        // Verify whether an earlier attempt actually landed. Strictly check
        // receiverAuth so we don't misidentify a stranger's deposit as ours.
        let landed = false;
        try {
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), 45_000);
          const info = await watchForHTLCDeposit(
            session.bootstrap.htlcProviders.publicDataProvider,
            session.htlcApi.deployedContractAddress,
            hashBytes,
            5_000,
            controller.signal,
          );
          clearTimeout(timer);
          // Confirm the existing entry is ours by checking receiverAuth matches
          // the maker's cpk from the URL.
          const receiverOk = bytesToHex(info.receiverAuth) === state.url.aliceCpkHex.toLowerCase();
          if (receiverOk) {
            landed = true;
          }
        } catch {
          /* abort = not found within window */
        }

        if (!landed) {
          const msg = describeError(submitError);
          toast.error(`Deposit failed: ${msg}`);
          dispatch({ t: 'error', message: msg });
          return;
        }
        toast.info('Wallet returned an error but the deposit landed on-chain — continuing.');
      }

      void tryOrchestrator(
        () =>
          orchestratorClient.patchSwap(state.url.hashHex, {
            status: 'bob_deposited',
            bobCpk: session.bootstrap.coinPublicKeyHex,
            bobUnshielded: session.bootstrap.unshieldedAddressHex,
            bobPkh: cardano?.paymentKeyHash,
            midnightDeadlineMs: Number(state.bobDeadlineSecs) * 1000,
            ...(depositTxHash ? { midnightDepositTx: depositTxHash } : {}),
          }),
        'patchSwap bob_deposited',
      );
      dispatch({ t: 'to-waiting-preimage', depositTxHash });
    })();
  }, [state, session, cardano, swapState.usdcColor, toast]);

  // Wait for preimage (indexer + orchestrator race).
  useEffect(() => {
    if (state.kind !== 'waiting-preimage' || !session) return;
    const controller = new AbortController();
    let fired = false;
    const finishWith = (preimageHex: string): void => {
      if (fired) return;
      fired = true;
      controller.abort();
      dispatch({ t: 'preimage-seen', preimageHex });
    };

    void (async () => {
      try {
        const hashBytes = hexToBytes(state.url.hashHex);
        const preimage = await watchForPreimageReveal(
          session.bootstrap.htlcProviders.publicDataProvider,
          session.htlcApi.deployedContractAddress,
          hashBytes,
          5_000,
          controller.signal,
        );
        finishWith(bytesToHex(preimage));
      } catch (e) {
        if (controller.signal.aborted) return;
        console.error('[useTakerFlow] preimage watch failed', e);
        dispatch({ t: 'error', message: describeError(e) });
      }
    })();

    const tick = async (): Promise<void> => {
      if (fired) return;
      const dbSwap = await orchestratorClient.getSwap(state.url.hashHex).catch(() => undefined);
      if (!dbSwap) return;
      if (dbSwap.midnightPreimage && /^[0-9a-f]{64}$/.test(dbSwap.midnightPreimage)) {
        finishWith(dbSwap.midnightPreimage);
      }
    };
    void tick();
    const id = setInterval(() => void tick(), 2000);

    return () => {
      controller.abort();
      clearInterval(id);
    };
  }, [state, session]);

  const start = useCallback((url: URLInputs) => {
    dispatch({ t: 'start', url });
  }, []);

  const accept = useCallback(() => {
    dispatch({ t: 'to-depositing' });
  }, []);

  const claim = useCallback(async (): Promise<void> => {
    if (state.kind !== 'claim-ready' || !cardano) return;
    dispatch({ t: 'to-claiming' });
    try {
      const claimTxHash = await cardano.cardanoHtlc.claim(state.preimageHex);
      void tryOrchestrator(
        () =>
          orchestratorClient.patchSwap(state.url.hashHex, {
            status: 'completed',
            cardanoClaimTx: claimTxHash,
          }),
        'patchSwap completed',
      );
      dispatch({ t: 'to-done', claimTxHash });
    } catch (e) {
      console.error('[useTakerFlow] cardano claim failed', e);
      const msg = describeError(e);
      toast.error(`Claim failed: ${msg}`);
      dispatch({ t: 'error', message: msg });
    }
  }, [state, cardano, toast]);

  const reset = useCallback(() => {
    dispatch({ t: 'reset' });
  }, []);

  return { state, start, accept, claim, reset };
};
