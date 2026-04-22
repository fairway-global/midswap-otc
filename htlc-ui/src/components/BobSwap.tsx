/**
 * Bob role — watches Cardano for Alice's lock, deposits USDC on Midnight,
 * watches Midnight for the preimage reveal, claims ADA on Cardano.
 *
 * Faithful port of `htlc-ft-cli/src/bob-swap.ts`.
 *
 * Coordination: parameters (hash, Alice's coinPublicKey, her unshielded addr,
 * the Cardano deadline, ADA/USDC amounts) arrive via URL query params that
 * Alice generates in her `/alice` page.
 */

import React, { useCallback, useEffect, useMemo, useReducer } from 'react';
import { Alert, Button, Card, CardContent, CircularProgress, Divider, Stack, Typography } from '@mui/material';
import { useSearchParams } from 'react-router-dom';
import { useSwapContext } from '../hooks';
import { WalletConnect } from './WalletConnect';
import { watchForCardanoLock, type CardanoHTLCInfo } from '../api/cardano-watcher';
import { watchForPreimageReveal } from '../api/midnight-watcher';
import { bytesToHex, hexToBytes, userEither } from '../api/key-encoding';
import { orchestratorClient, tryOrchestrator } from '../api/orchestrator-client';

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

const SAFETY_BUFFER_SECS = 60; // 10 min
const MIN_CARDANO_DEADLINE_WINDOW_SECS = 180; // 30 min
const BOB_DEADLINE_MIN = 2;

interface URLInputs {
  hashHex: string;
  aliceCpkHex: string;
  aliceUnshieldedHex: string;
  cardanoDeadlineMs: bigint;
  adaAmount: bigint;
  usdcAmount: bigint;
}

type Step =
  | { kind: 'need-url' }
  | { kind: 'connect'; url: URLInputs }
  | { kind: 'watching-cardano'; url: URLInputs }
  | { kind: 'confirm'; url: URLInputs; htlcInfo: CardanoHTLCInfo; bobDeadlineSecs: bigint; truncated: boolean }
  | { kind: 'unsafe-deadline'; url: URLInputs; htlcInfo: CardanoHTLCInfo; reason: string }
  | { kind: 'depositing'; url: URLInputs; htlcInfo: CardanoHTLCInfo; bobDeadlineSecs: bigint }
  | { kind: 'waiting-preimage'; url: URLInputs; htlcInfo: CardanoHTLCInfo }
  | { kind: 'claim-ready'; url: URLInputs; htlcInfo: CardanoHTLCInfo; preimageHex: string }
  | { kind: 'claiming'; url: URLInputs; htlcInfo: CardanoHTLCInfo; preimageHex: string }
  | { kind: 'done'; url: URLInputs; htlcInfo: CardanoHTLCInfo; claimTxHash: string }
  | { kind: 'error'; message: string };

type Action =
  | { t: 'set-url'; url: URLInputs }
  | { t: 'watching-cardano' }
  | { t: 'lock-seen'; htlcInfo: CardanoHTLCInfo; bobDeadlineSecs: bigint; truncated: boolean }
  | { t: 'unsafe'; reason: string; htlcInfo: CardanoHTLCInfo }
  | { t: 'to-depositing' }
  | { t: 'to-waiting-preimage' }
  | { t: 'preimage-seen'; preimageHex: string }
  | { t: 'to-claiming' }
  | { t: 'to-done'; claimTxHash: string }
  | { t: 'error'; message: string };

const reducer = (state: Step, action: Action): Step => {
  switch (action.t) {
    case 'set-url':
      return { kind: 'connect', url: action.url };
    case 'watching-cardano':
      return state.kind === 'connect' ? { kind: 'watching-cardano', url: state.url } : state;
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
        ? { kind: 'waiting-preimage', url: state.url, htlcInfo: state.htlcInfo }
        : state;
    case 'preimage-seen':
      return state.kind === 'waiting-preimage'
        ? { kind: 'claim-ready', url: state.url, htlcInfo: state.htlcInfo, preimageHex: action.preimageHex }
        : state;
    case 'to-claiming':
      return state.kind === 'claim-ready'
        ? { kind: 'claiming', url: state.url, htlcInfo: state.htlcInfo, preimageHex: state.preimageHex }
        : state;
    case 'to-done':
      return state.kind === 'claiming'
        ? { kind: 'done', url: state.url, htlcInfo: state.htlcInfo, claimTxHash: action.claimTxHash }
        : state;
    case 'error':
      return { kind: 'error', message: action.message };
    default:
      return state;
  }
};

const parseUrlInputs = (params: URLSearchParams): URLInputs | { error: string } => {
  const hashHex = (params.get('hash') ?? '').trim().toLowerCase();
  const aliceCpkHex = (params.get('aliceCpk') ?? '').trim().toLowerCase();
  const aliceUnshieldedHex = (params.get('aliceUnshielded') ?? '').trim().toLowerCase();
  const cardanoDeadlineMs = params.get('cardanoDeadlineMs');
  const adaAmount = params.get('adaAmount');
  const usdcAmount = params.get('usdcAmount');
  if (!hashHex || !/^[0-9a-f]{64}$/.test(hashHex)) return { error: 'Missing or invalid hash (64 hex).' };
  if (!aliceCpkHex || !/^[0-9a-f]{64}$/.test(aliceCpkHex)) return { error: 'Missing or invalid aliceCpk (64 hex).' };
  if (!aliceUnshieldedHex || !/^[0-9a-f]{64}$/.test(aliceUnshieldedHex))
    return { error: 'Missing or invalid aliceUnshielded (64 hex).' };
  if (!cardanoDeadlineMs || !adaAmount || !usdcAmount)
    return { error: 'Missing cardanoDeadlineMs / adaAmount / usdcAmount.' };
  return {
    hashHex,
    aliceCpkHex,
    aliceUnshieldedHex,
    cardanoDeadlineMs: BigInt(cardanoDeadlineMs),
    adaAmount: BigInt(adaAmount),
    usdcAmount: BigInt(usdcAmount),
  };
};

export const BobSwap: React.FC = () => {
  const [searchParams] = useSearchParams();
  const { session, cardano, swapState } = useSwapContext();
  const [state, dispatch] = useReducer(reducer, { kind: 'need-url' as const });

  useEffect(() => {
    const parsed = parseUrlInputs(searchParams);
    if ('error' in parsed) {
      dispatch({ t: 'error', message: parsed.error });
      return;
    }
    dispatch({ t: 'set-url', url: parsed });
  }, [searchParams]);

  // Auto-move into "watching-cardano" once both wallets + URL are ready.
  useEffect(() => {
    if (state.kind === 'connect' && session && cardano) {
      dispatch({ t: 'watching-cardano' });
    }
  }, [state.kind, session, cardano]);

  // Effect: poll Cardano for Alice's lock.
  useEffect(() => {
    if (state.kind !== 'watching-cardano' || !cardano) return;
    const controller = new AbortController();
    (async () => {
      try {
        const htlcInfo = await watchForCardanoLock(
          cardano.cardanoHtlc,
          cardano.paymentKeyHash,
          10_000,
          state.url.hashHex,
          controller.signal,
        );
        // Compute safety-window + deadline.
        const nowSecs = Math.floor(Date.now() / 1000);
        const cardanoDeadlineSecs = Math.floor(Number(htlcInfo.deadlineMs) / 1000);
        const cardanoRemaining = cardanoDeadlineSecs - nowSecs;
        if (cardanoRemaining < MIN_CARDANO_DEADLINE_WINDOW_SECS) {
          dispatch({
            t: 'unsafe',
            htlcInfo,
            reason: `Cardano deadline only ${Math.round(cardanoRemaining / 60)}min away — need ≥ ${MIN_CARDANO_DEADLINE_WINDOW_SECS / 60}min. Abort.`,
          });
          return;
        }
        const maxBobDeadlineSecs = cardanoDeadlineSecs - SAFETY_BUFFER_SECS;
        const desiredBobDeadlineSecs = nowSecs + BOB_DEADLINE_MIN * 60;
        const bobDeadlineSecs = Math.min(desiredBobDeadlineSecs, maxBobDeadlineSecs);
        if (bobDeadlineSecs <= nowSecs + 120) {
          dispatch({
            t: 'unsafe',
            htlcInfo,
            reason: `Cannot pick a safe Midnight deadline (buffer ${SAFETY_BUFFER_SECS}s leaves < 2min).`,
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
        console.error('[bob] cardano watch failed', e);
        dispatch({ t: 'error', message: describeError(e) });
      }
    })();
    return () => controller.abort();
  }, [state.kind, cardano, state]);

  // Effect: when depositing, send the tx.
  useEffect(() => {
    if (state.kind !== 'depositing' || !session) return;
    (async () => {
      try {
        const hashBytes = hexToBytes(state.url.hashHex);
        const aliceAuthBytes = hexToBytes(state.url.aliceCpkHex);
        const aliceUnshieldedBytes = hexToBytes(state.url.aliceUnshieldedHex);
        const bobUnshieldedBytes = session.bootstrap.unshieldedAddressBytes;
        const usdcColor = hexToBytes(swapState.usdcColor);
        await session.htlcApi.deposit({
          color: usdcColor,
          amount: state.url.usdcAmount,
          hash: hashBytes,
          expirySecs: state.bobDeadlineSecs,
          receiverAuth: aliceAuthBytes,
          receiverPayout: userEither(aliceUnshieldedBytes),
          senderPayout: userEither(bobUnshieldedBytes),
        });
        void tryOrchestrator(
          () =>
            orchestratorClient.patchSwap(state.url.hashHex, {
              status: 'bob_deposited',
              bobCpk: session.bootstrap.coinPublicKeyHex,
              bobUnshielded: session.bootstrap.unshieldedAddressHex,
              bobPkh: cardano?.paymentKeyHash,
              midnightDeadlineMs: Number(state.bobDeadlineSecs) * 1000,
            }),
          'patchSwap bob_deposited',
        );
        dispatch({ t: 'to-waiting-preimage' });
      } catch (e) {
        console.error('[bob] deposit failed', e);
        dispatch({ t: 'error', message: describeError(e) });
      }
    })();
  }, [state, session, cardano, swapState.usdcColor]);

  // Effect: wait for preimage reveal. Race two sources:
  //   (a) Midnight indexer via watchForPreimageReveal (authoritative)
  //   (b) Orchestrator DB — Alice patches `midnightPreimage` the moment her
  //       withdraw tx finalizes, beating the indexer catch-up.
  // Whichever surfaces the preimage first wins. The preimage is self-validating
  // (Bob's Cardano claim sha256-checks it), so trusting the DB is safe.
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

    // Source (a): on-chain indexer.
    (async () => {
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
        console.error('[bob] preimage watch failed', e);
        dispatch({ t: 'error', message: describeError(e) });
      }
    })();

    // Source (b): orchestrator DB.
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

  const onAccept = useCallback(() => {
    dispatch({ t: 'to-depositing' });
  }, []);

  const onClaim = useCallback(async () => {
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
      console.error('[bob] cardano claim failed', e);
      dispatch({ t: 'error', message: describeError(e) });
    }
  }, [state, cardano]);

  const deadlineStr = useMemo(() => {
    if (
      state.kind !== 'confirm' &&
      state.kind !== 'depositing' &&
      state.kind !== 'waiting-preimage' &&
      state.kind !== 'claim-ready' &&
      state.kind !== 'claiming' &&
      state.kind !== 'done'
    )
      return '';
    return new Date(Number(state.htlcInfo.deadlineMs)).toISOString();
  }, [state]);

  return (
    <Stack spacing={3} sx={{ width: '100%', maxWidth: 720 }}>
      <Typography variant="h4" sx={{ color: '#fff' }}>
        Bob — deposit USDC, claim ADA
      </Typography>

      {state.kind === 'need-url' && <Alert severity="warning">Waiting for URL parameters…</Alert>}

      {state.kind === 'connect' && (
        <>
          <Alert severity="info">
            URL accepted. Connect both wallets to continue.
            <br />
            Hash: {state.url.hashHex.slice(0, 32)}…
          </Alert>
          <WalletConnect />
        </>
      )}

      {state.kind === 'watching-cardano' && (
        <Card>
          <CardContent>
            <Stack spacing={2} alignItems="center">
              <CircularProgress />
              <Typography>Watching Cardano for Alice&apos;s HTLC lock…</Typography>
              <Typography variant="caption">
                Filter: hash = {state.url.hashHex.slice(0, 32)}… receiver PKH = {cardano?.paymentKeyHash.slice(0, 16)}…
              </Typography>
            </Stack>
          </CardContent>
        </Card>
      )}

      {state.kind === 'confirm' && (
        <Card>
          <CardContent>
            <Stack spacing={2}>
              <Typography variant="h6">Alice&apos;s HTLC found</Typography>
              <Typography>ADA locked: {(Number(state.htlcInfo.amountLovelace) / 1e6).toString()} ADA</Typography>
              <Typography>Cardano deadline: {deadlineStr}</Typography>
              <Divider />
              <Typography variant="h6">Your Midnight deposit</Typography>
              <Typography>
                USDC: {state.url.usdcAmount.toString()} (native, color {swapState.usdcColor.slice(0, 16)}…)
              </Typography>
              <Typography>Midnight deadline: {new Date(Number(state.bobDeadlineSecs) * 1000).toISOString()}</Typography>
              {state.truncated && (
                <Alert severity="info">
                  Midnight deadline truncated to stay {SAFETY_BUFFER_SECS / 60}min inside Cardano deadline.
                </Alert>
              )}
              <Button variant="contained" onClick={onAccept}>
                Deposit USDC
              </Button>
            </Stack>
          </CardContent>
        </Card>
      )}

      {state.kind === 'unsafe-deadline' && <Alert severity="error">Unsafe: {state.reason}</Alert>}

      {state.kind === 'depositing' && (
        <Card>
          <CardContent>
            <Stack spacing={2} alignItems="center">
              <CircularProgress />
              <Typography>Depositing USDC on Midnight HTLC. Please sign in 1AM.</Typography>
            </Stack>
          </CardContent>
        </Card>
      )}

      {state.kind === 'waiting-preimage' && (
        <Card>
          <CardContent>
            <Stack spacing={2} alignItems="center">
              <CircularProgress />
              <Typography>Waiting for Alice to reveal the preimage on Midnight…</Typography>
            </Stack>
          </CardContent>
        </Card>
      )}

      {state.kind === 'claim-ready' && (
        <Card>
          <CardContent>
            <Stack spacing={2}>
              <Alert severity="success">Preimage revealed: {state.preimageHex.slice(0, 32)}…</Alert>
              <Button variant="contained" color="success" onClick={onClaim}>
                Claim ADA on Cardano
              </Button>
            </Stack>
          </CardContent>
        </Card>
      )}

      {state.kind === 'claiming' && (
        <Card>
          <CardContent>
            <Stack spacing={2} alignItems="center">
              <CircularProgress />
              <Typography>Claiming ADA on Cardano. Please sign in Eternl.</Typography>
            </Stack>
          </CardContent>
        </Card>
      )}

      {state.kind === 'done' && (
        <Card>
          <CardContent>
            <Stack spacing={1}>
              <Typography variant="h5" color="success.main">
                Swap complete!
              </Typography>
              <Typography>Sent: {state.url.usdcAmount.toString()} USDC</Typography>
              <Typography>Received: {(Number(state.htlcInfo.amountLovelace) / 1e6).toString()} ADA</Typography>
              <Typography variant="caption" sx={{ wordBreak: 'break-all' }}>
                Cardano claim tx: {state.claimTxHash}
              </Typography>
              <Typography variant="caption" sx={{ wordBreak: 'break-all' }}>
                Hash: {state.url.hashHex}
              </Typography>
            </Stack>
          </CardContent>
        </Card>
      )}

      {state.kind === 'error' && <Alert severity="error">{state.message}</Alert>}
    </Stack>
  );
};
