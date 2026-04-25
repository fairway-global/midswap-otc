/**
 * Reverse maker flow — USDC → USDM direction.
 *
 * The maker holds native Midnight USDC and wants Cardano USDM. They deposit
 * USDC on Midnight first (bound to the counterparty's Midnight credentials),
 * then wait for the counterparty to lock USDM on Cardano bound to the maker's
 * PKH, then claim that USDM on Cardano by revealing the preimage — which the
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
import { watchForHTLCDeposit } from '../../api/midnight-watcher';
import { orchestratorClient, tryOrchestrator } from '../../api/orchestrator-client';

export interface ReverseMakerLockParams {
  readonly usdmAmount: bigint;
  readonly usdcAmount: bigint;
  readonly deadlineMin: number;
  /** Counterparty's Midnight shielded coin public key as 64-hex (decoded bytes). */
  readonly counterpartyCpkBytes: Uint8Array;
  /** Counterparty's Midnight unshielded address as 64-hex (decoded bytes). */
  readonly counterpartyUnshieldedBytes: Uint8Array;
  /** OTC bridge link — when present, the orchestrator stamps the RFQ as Settling. */
  readonly rfqId?: string;
}

export type ReverseMakerStep =
  | { kind: 'idle' }
  | { kind: 'depositing' }
  | {
      kind: 'deposited';
      hashHex: string;
      preimageHex: string;
      midnightDeadlineMs: bigint;
      usdmAmount: bigint;
      usdcAmount: bigint;
    }
  | {
      kind: 'waiting-cardano';
      hashHex: string;
      preimageHex: string;
      midnightDeadlineMs: bigint;
      usdmAmount: bigint;
      usdcAmount: bigint;
    }
  | {
      kind: 'claim-ready';
      hashHex: string;
      preimageHex: string;
      midnightDeadlineMs: bigint;
      usdmAmount: bigint;
      usdcAmount: bigint;
      cardanoHtlc: CardanoHTLCInfo;
    }
  | {
      kind: 'claiming';
      hashHex: string;
      preimageHex: string;
      midnightDeadlineMs: bigint;
      usdmAmount: bigint;
      usdcAmount: bigint;
      cardanoHtlc: CardanoHTLCInfo;
    }
  | {
      kind: 'done';
      hashHex: string;
      usdmAmount: bigint;
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
            usdmAmount: state.usdmAmount,
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
  usdmAmount: string;
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
        // Legacy restore: pre-USDM records stored the amount as `adaAmount`.
        usdmAmount: BigInt(pending.usdmAmount ?? (pending as unknown as { adaAmount: string }).adaAmount),
        usdcAmount: BigInt(pending.usdcAmount),
      },
    });
    setRestoreNotice(
      `Resumed pending USDC→USDM swap ${pending.hashHex.slice(0, 12)}… — watching Cardano for the counterparty lock.`,
    );
  }, [session]);

  // Auto-transition deposited → waiting-cardano so the Cardano watcher fires.
  useEffect(() => {
    if (state.kind === 'deposited') dispatch({ t: 'to-waiting' });
  }, [state.kind]);

  // Watch Cardano for the counterparty's lock bound to our own PKH. We race
  // Blockfrost (authoritative) against an orchestrator poll (fast-path) —
  // whichever surfaces the lock first wins. Orchestrator is typically a few
  // seconds ahead because its cardano-watcher is already polling in a hot loop.
  useEffect(() => {
    if (state.kind !== 'waiting-cardano' || !cardano) return;
    const controller = new AbortController();
    let fired = false;

    const finishBlockfrost = (htlcInfo: CardanoHTLCInfo): void => {
      if (fired) return;
      fired = true;
      controller.abort();
      dispatch({ t: 'cardano-seen', cardanoHtlc: htlcInfo });
    };

    void (async () => {
      try {
        const htlcInfo = await watchForCardanoLock(
          cardano.cardanoHtlc,
          cardano.usdmPolicy.unit,
          cardano.paymentKeyHash,
          10_000,
          state.hashHex,
          controller.signal,
        );
        finishBlockfrost(htlcInfo);
      } catch (e) {
        if (controller.signal.aborted) return;
        dispatch({ t: 'error', message: describeError(e) });
      }
    })();

    const pollOrchestrator = async (): Promise<void> => {
      if (fired) return;
      const dbSwap = await orchestratorClient.getSwap(state.hashHex).catch(() => undefined);
      if (!dbSwap || fired) return;
      if (
        (dbSwap.status === 'bob_deposited' || dbSwap.status === 'alice_claimed' || dbSwap.status === 'completed') &&
        dbSwap.cardanoLockTx &&
        dbSwap.cardanoDeadlineMs !== null
      ) {
        // The orchestrator knows the taker locked, but Blockfrost's UTxO
        // index may still lag the submit by 20-30s. If we transition to
        // claim-ready before Blockfrost can see the UTxO, `findHTLCUtxo`
        // returns empty and the subsequent claim fails with "No HTLC UTxO
        // found for hash ...". Verify Blockfrost visibility before firing.
        const utxoVisible = await cardano.cardanoHtlc.findHTLCUtxo(state.hashHex).catch(() => undefined);
        if (!utxoVisible) {
          // Blockfrost hasn't indexed the lock yet — wait for the next poll.
          return;
        }
        finishBlockfrost({
          hashHex: state.hashHex,
          amountUsdm: utxoVisible.assets[cardano.usdmPolicy.unit] ?? state.usdmAmount,
          amountLovelace: utxoVisible.assets.lovelace ?? 2_000_000n,
          deadlineMs: BigInt(dbSwap.cardanoDeadlineMs),
          senderPkh: dbSwap.bobPkh ?? '',
          receiverPkh: cardano.paymentKeyHash,
        });
      }
    };
    void pollOrchestrator();
    const pollTimer = setInterval(() => void pollOrchestrator(), 2000);

    return () => {
      controller.abort();
      clearInterval(pollTimer);
    };
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
    url.searchParams.set('direction', 'usdc-usdm');
    url.searchParams.set('hash', state.hashHex);
    url.searchParams.set('makerPkh', cardano.paymentKeyHash);
    url.searchParams.set('midnightDeadlineMs', state.midnightDeadlineMs.toString());
    url.searchParams.set('usdmAmount', state.usdmAmount.toString());
    url.searchParams.set('usdcAmount', state.usdcAmount.toString());
    return url.toString();
  })();

  const deposit = useCallback(
    async (params: ReverseMakerLockParams): Promise<void> => {
      if (!session || !cardano) {
        throw new Error('Connect both wallets before depositing.');
      }
      dispatch({ t: 'to-depositing' });

      const preimage = randomBytes32();
      const hashLock = await sha256(preimage);
      const hashHex = bytesToHex(hashLock);
      const preimageHex = bytesToHex(preimage);
      const midnightDeadlineMs = BigInt(Date.now() + params.deadlineMin * 60 * 1000);
      const midnightDeadlineSecs = midnightDeadlineMs / 1000n;
      const usdcColor = hexToBytes(swapState.usdcColor);

      // The Lace dApp-connector API sometimes surfaces a generic
      // "Transaction submission error" even when the tx actually lands
      // on-chain (the submit promise rejects after a retry-race with the
      // indexer). Before trusting an exception, verify the HTLC entry
      // appeared on-chain for our hash — if it did, proceed as if the submit
      // succeeded. Only dispatch a true error state if the entry is missing
      // after a short grace period.
      let depositTxHash: string | undefined;
      let submitError: unknown;
      try {
        depositTxHash = await session.htlcApi.deposit({
          color: usdcColor,
          amount: params.usdcAmount,
          hash: hashLock,
          expirySecs: midnightDeadlineSecs,
          receiverAuth: params.counterpartyCpkBytes,
          receiverPayout: userEither(params.counterpartyUnshieldedBytes),
          senderPayout: userEither(session.bootstrap.unshieldedAddressBytes),
        });
      } catch (e) {
        submitError = e;
        console.warn('[useReverseMakerFlow:deposit] submit surfaced error; verifying on-chain', e);
      }

      if (!depositTxHash) {
        // Verify via the indexer within a 60-second window. If the deposit
        // lands, treat as success; otherwise surface the real submit error.
        try {
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), 60_000);
          await watchForHTLCDeposit(
            session.bootstrap.htlcProviders.publicDataProvider,
            session.htlcApi.deployedContractAddress,
            hashLock,
            5_000,
            controller.signal,
          );
          clearTimeout(timer);
          toast.info('Wallet returned an error but the deposit landed on-chain — continuing.');
        } catch {
          const msg = describeError(submitError ?? new Error('Deposit timed out before landing.'));
          toast.error(`Deposit failed: ${msg}`);
          dispatch({ t: 'error', message: msg });
          return;
        }
      }

      savePending(session.bootstrap.coinPublicKeyHex, {
        hashHex,
        preimageHex,
        midnightDeadlineMs: midnightDeadlineMs.toString(),
        usdmAmount: params.usdmAmount.toString(),
        usdcAmount: params.usdcAmount.toString(),
      });

      // Register the reverse swap with the orchestrator. bobPkh is the
      // MAKER's own Cardano PKH — the receiver that the future taker lock
      // will bind to. bobCpk/bobUnshielded are the TAKER's Midnight keys
      // (known via the paste-bundle we just used as receiverAuth/payout).
      // When the submit-wrapper failed, we don't have the deposit tx hash,
      // but the on-chain entry is what matters — pass a hash-derived stand-in
      // so the orchestrator record still exists for the taker to key on.
      void tryOrchestrator(
        () =>
          orchestratorClient.createSwap({
            hash: hashHex,
            direction: 'usdc-usdm',
            aliceCpk: session.bootstrap.coinPublicKeyHex,
            aliceUnshielded: session.bootstrap.unshieldedAddressHex,
            usdmAmount: params.usdmAmount.toString(),
            usdcAmount: params.usdcAmount.toString(),
            midnightDeadlineMs: Number(midnightDeadlineMs),
            midnightDepositTx: depositTxHash ?? `pending:${hashHex}`,
            bobCpk: bytesToHex(params.counterpartyCpkBytes),
            bobUnshielded: bytesToHex(params.counterpartyUnshieldedBytes),
            bobPkh: cardano.paymentKeyHash,
            rfqId: params.rfqId,
          }),
        'createSwap reverse',
      );

      dispatch({
        t: 'deposited',
        payload: {
          kind: 'deposited',
          hashHex,
          preimageHex,
          midnightDeadlineMs,
          usdmAmount: params.usdmAmount,
          usdcAmount: params.usdcAmount,
        },
      });
    },
    [session, cardano, swapState.usdcColor, toast],
  );

  const claim = useCallback(async (): Promise<void> => {
    if (state.kind !== 'claim-ready' || !cardano || !session) return;
    dispatch({ t: 'to-claiming' });
    try {
      // Claiming USDM on Cardano with the preimage reveals it via the
      // transaction redeemer. PATCH the orchestrator so the taker's fast-path
      // picks up the preimage instantly instead of polling Blockfrost redeemer
      // endpoints for several seconds.
      const claimTxHash = await cardano.cardanoHtlc.claim(state.preimageHex);
      void tryOrchestrator(
        () =>
          orchestratorClient.patchSwap(state.hashHex, {
            status: 'alice_claimed',
            cardanoClaimTx: claimTxHash,
            midnightPreimage: state.preimageHex,
          }),
        'patchSwap reverse alice_claimed',
      );
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
