/**
 * Alice role — locks ADA, generates a shareable URL for Bob, waits for
 * Bob's USDC deposit, claims USDC (revealing preimage).
 *
 * Faithful port of `htlc-ft-cli/src/alice-swap.ts`.
 */

import React, { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  CircularProgress,
  Divider,
  IconButton,
  Link,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import { getAddressDetails } from '@lucid-evolution/lucid';
import { useSwapContext } from '../hooks';
import { WalletConnect } from './WalletConnect';
import { bytesToHex, hexToBytes } from '../api/key-encoding';
import { orchestratorClient, tryOrchestrator } from '../api/orchestrator-client';

const resolveBobPkh = (input: string): string | undefined => {
  const trimmed = input.trim();
  if (/^[0-9a-fA-F]{56}$/.test(trimmed)) return trimmed.toLowerCase();
  if (trimmed.startsWith('addr') || trimmed.startsWith('addr_test')) {
    try {
      const details = getAddressDetails(trimmed);
      return details.paymentCredential?.hash?.toLowerCase();
    } catch {
      return undefined;
    }
  }
  return undefined;
};

type Step =
  | { kind: 'connect' }
  | { kind: 'params' }
  | { kind: 'locking' }
  | {
      kind: 'locked';
      hashHex: string;
      preimageHex: string;
      lockTxHash: string;
      deadlineMs: bigint;
      adaAmount: bigint;
      usdcAmount: bigint;
    }
  | {
      kind: 'waiting-deposit';
      hashHex: string;
      preimageHex: string;
      lockTxHash: string;
      deadlineMs: bigint;
      adaAmount: bigint;
      usdcAmount: bigint;
    }
  | {
      kind: 'claim-ready';
      hashHex: string;
      preimageHex: string;
      lockTxHash: string;
      deadlineMs: bigint;
      adaAmount: bigint;
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
      adaAmount: bigint;
      usdcAmount: bigint;
      depositAmount: bigint;
      depositColorHex: string;
    }
  | { kind: 'done'; hashHex: string; lockTxHash: string; adaAmount: bigint; depositAmount: bigint }
  | { kind: 'error'; message: string };

type Action =
  | { t: 'to-params' }
  | { t: 'to-locking' }
  | { t: 'locked'; payload: Extract<Step, { kind: 'locked' }> }
  | { t: 'restore'; payload: Extract<Step, { kind: 'waiting-deposit' }> }
  | { t: 'to-waiting' }
  | { t: 'deposit-seen'; depositAmount: bigint; depositColorHex: string }
  | { t: 'to-claiming' }
  | { t: 'to-done'; depositAmount: bigint }
  | { t: 'error'; message: string }
  | { t: 'reset' };

const reducer = (state: Step, action: Action): Step => {
  switch (action.t) {
    case 'to-params':
      return { kind: 'params' };
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
            adaAmount: state.adaAmount,
            depositAmount: action.depositAmount,
          }
        : state;
    case 'error':
      return { kind: 'error', message: action.message };
    case 'reset':
      return { kind: 'connect' };
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
  adaAmount: string;
  usdcAmount: string;
}

const savePending = (aliceCpk: string, swap: PersistedSwap): void => {
  try {
    localStorage.setItem(PENDING_KEY_PREFIX + aliceCpk, JSON.stringify(swap));
  } catch (e) {
    console.warn('[AliceSwap] localStorage save failed', e);
  }
};

const loadPending = (aliceCpk: string): PersistedSwap | undefined => {
  try {
    const raw = localStorage.getItem(PENDING_KEY_PREFIX + aliceCpk);
    return raw ? (JSON.parse(raw) as PersistedSwap) : undefined;
  } catch {
    return undefined;
  }
};

const clearPending = (aliceCpk: string): void => {
  try {
    localStorage.removeItem(PENDING_KEY_PREFIX + aliceCpk);
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

export const AliceSwap: React.FC = () => {
  const { session, cardano, swapState } = useSwapContext();
  const [state, dispatch] = useReducer(reducer, { kind: 'connect' as const });
  const restoreAttemptedRef = useRef(false);
  const [restoreNotice, setRestoreNotice] = useState<string | undefined>(undefined);

  // Form inputs.
  const [adaAmount, setAdaAmount] = useState<string>('1');
  const [usdcAmount, setUsdcAmount] = useState<string>('1');
  const [deadlineMin, setDeadlineMin] = useState<string>('120');
  const [bobPkh, setBobPkh] = useState<string>('');
  const [formError, setFormError] = useState<string | undefined>(undefined);
  const resolvedBobPkh = useMemo(() => resolveBobPkh(bobPkh), [bobPkh]);

  useEffect(() => {
    if (session && cardano && state.kind === 'connect') {
      dispatch({ t: 'to-params' });
    }
  }, [session, cardano, state.kind]);

  // Resume a pending swap stored in localStorage (survives browser close).
  // Only the preimage needs to be local; everything else is in the orchestrator.
  useEffect(() => {
    if (!session || restoreAttemptedRef.current) return;
    restoreAttemptedRef.current = true;
    const aliceCpk = session.bootstrap.coinPublicKeyHex;
    const pending = loadPending(aliceCpk);
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
        clearPending(aliceCpk);
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
          adaAmount: BigInt(pending.adaAmount),
          usdcAmount: BigInt(pending.usdcAmount),
        },
      });
      setRestoreNotice(`Resumed pending swap ${pending.hashHex.slice(0, 12)}… — watching for Bob's deposit.`);
    })();
  }, [session]);

  const shareUrl = useMemo(() => {
    if (
      !session ||
      (state.kind !== 'locked' &&
        state.kind !== 'waiting-deposit' &&
        state.kind !== 'claim-ready' &&
        state.kind !== 'claiming' &&
        state.kind !== 'done')
    ) {
      return undefined;
    }
    if (state.kind === 'done') return undefined;
    const url = new URL(window.location.origin);
    url.pathname = '/bob';
    url.searchParams.set('role', 'bob');
    url.searchParams.set('hash', state.hashHex);
    url.searchParams.set('aliceCpk', session.bootstrap.coinPublicKeyHex);
    url.searchParams.set('aliceUnshielded', session.bootstrap.unshieldedAddressHex);
    url.searchParams.set('cardanoDeadlineMs', state.deadlineMs.toString());
    url.searchParams.set('adaAmount', state.adaAmount.toString());
    url.searchParams.set('usdcAmount', state.usdcAmount.toString());
    return url.toString();
  }, [session, state]);

  const onLock = useCallback(async () => {
    setFormError(undefined);
    if (!session || !cardano) return;
    const ada = BigInt(adaAmount);
    const usdc = BigInt(usdcAmount);
    const min = parseInt(deadlineMin, 10);
    if (!Number.isFinite(min) || min < 60) {
      setFormError('Deadline must be ≥ 60 minutes (Bob needs ≥ 30min + dust-sync time).');
      return;
    }
    if (ada <= 0n || usdc <= 0n) {
      setFormError('ADA and USDC amounts must be positive integers.');
      return;
    }
    const bobPkhHex = resolvedBobPkh;
    if (!bobPkhHex) {
      setFormError("Bob's receiver: paste a Cardano bech32 address (addr_test1…) or 56-hex PKH.");
      return;
    }

    dispatch({ t: 'to-locking' });
    try {
      const preimage = randomBytes32();
      const hashLock = await sha256(preimage);
      const hashHex = bytesToHex(hashLock);
      const preimageHex = bytesToHex(preimage);
      const deadlineMs = BigInt(Date.now() + min * 60 * 1000);
      const lovelace = ada * 1_000_000n;

      const lockTxHash = await cardano.cardanoHtlc.lock(lovelace, hashHex, bobPkhHex, deadlineMs);

      savePending(session.bootstrap.coinPublicKeyHex, {
        hashHex,
        preimageHex,
        lockTxHash,
        deadlineMs: deadlineMs.toString(),
        adaAmount: ada.toString(),
        usdcAmount: usdc.toString(),
      });

      void tryOrchestrator(
        () =>
          orchestratorClient.createSwap({
            hash: hashHex,
            aliceCpk: session.bootstrap.coinPublicKeyHex,
            aliceUnshielded: session.bootstrap.unshieldedAddressHex,
            adaAmount: ada.toString(),
            usdcAmount: usdc.toString(),
            cardanoDeadlineMs: Number(deadlineMs),
            cardanoLockTx: lockTxHash,
            bobPkh: bobPkhHex,
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
          adaAmount: ada,
          usdcAmount: usdc,
        },
      });
    } catch (e) {
      console.error('[AliceSwap:lock]', e);
      dispatch({ t: 'error', message: describeError(e) });
    }
  }, [session, cardano, adaAmount, usdcAmount, deadlineMin, resolvedBobPkh]);

  const startWaiting = useCallback(() => {
    dispatch({ t: 'to-waiting' });
  }, []);

  // When waiting-deposit, subscribe to htlcApi.state$ and match on hashHex.
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

  const onClaim = useCallback(async () => {
    if (state.kind !== 'claim-ready' || !session) return;
    dispatch({ t: 'to-claiming' });
    try {
      const preimage = hexToBytes(state.preimageHex);
      await session.htlcApi.withdrawWithPreimage(preimage);
      void tryOrchestrator(
        () => orchestratorClient.patchSwap(state.hashHex, { status: 'alice_claimed' }),
        'patchSwap alice_claimed',
      );
      clearPending(session.bootstrap.coinPublicKeyHex);
      dispatch({ t: 'to-done', depositAmount: state.depositAmount });
    } catch (e) {
      console.error('[AliceSwap:claim]', e);
      dispatch({ t: 'error', message: describeError(e) });
    }
  }, [state, session]);

  const onForgetPending = useCallback(() => {
    if (!session) return;
    clearPending(session.bootstrap.coinPublicKeyHex);
    setRestoreNotice(undefined);
    dispatch({ t: 'to-params' });
  }, [session]);

  const onCopy = useCallback(async () => {
    if (!shareUrl) return;
    await navigator.clipboard.writeText(shareUrl);
  }, [shareUrl]);

  return (
    <Stack spacing={3} sx={{ width: '100%', maxWidth: 720 }}>
      <Typography variant="h4" sx={{ color: '#fff' }}>
        Alice — lock ADA, claim USDC
      </Typography>

      {restoreNotice && (
        <Alert severity="info">
          {restoreNotice}{' '}
          <Link component="button" underline="hover" onClick={onForgetPending} sx={{ ml: 1 }}>
            Forget stored swap
          </Link>
        </Alert>
      )}

      {state.kind === 'connect' && (
        <>
          <Alert severity="info">Connect both wallets to start.</Alert>
          <WalletConnect />
        </>
      )}

      {state.kind === 'params' && (
        <Card>
          <CardContent>
            <Stack spacing={2}>
              <Typography variant="h6">1. Swap parameters</Typography>
              <TextField
                label="ADA to lock"
                value={adaAmount}
                onChange={(e) => setAdaAmount(e.target.value)}
                type="number"
                size="small"
              />
              <TextField
                label="USDC expected back"
                value={usdcAmount}
                onChange={(e) => setUsdcAmount(e.target.value)}
                type="number"
                size="small"
              />
              <TextField
                label="Cardano deadline (minutes, ≥ 60)"
                value={deadlineMin}
                onChange={(e) => setDeadlineMin(e.target.value)}
                type="number"
                size="small"
              />
              <TextField
                label="Bob's Cardano address or PKH"
                value={bobPkh}
                onChange={(e) => setBobPkh(e.target.value)}
                size="small"
                error={bobPkh.trim().length > 0 && !resolvedBobPkh}
                helperText={
                  bobPkh.trim().length === 0
                    ? "Paste Bob's bech32 address (addr_test1…) from his Eternl 'Receive' screen, or his 56-hex PKH."
                    : resolvedBobPkh
                      ? `✓ PKH: ${resolvedBobPkh}`
                      : 'Not a valid Cardano address or 56-hex PKH.'
                }
              />
              {formError && <Alert severity="error">{formError}</Alert>}
              <Button variant="contained" onClick={onLock} disabled={!resolvedBobPkh}>
                Lock ADA
              </Button>
            </Stack>
          </CardContent>
        </Card>
      )}

      {state.kind === 'locking' && (
        <Card>
          <CardContent>
            <Stack spacing={2} alignItems="center">
              <CircularProgress />
              <Typography>Locking ADA on Cardano. Please sign in Eternl.</Typography>
            </Stack>
          </CardContent>
        </Card>
      )}

      {(state.kind === 'locked' ||
        state.kind === 'waiting-deposit' ||
        state.kind === 'claim-ready' ||
        state.kind === 'claiming') && (
        <Card>
          <CardContent>
            <Stack spacing={2}>
              <Typography variant="h6">2. Locked on Cardano</Typography>
              <Typography variant="body2" sx={{ wordBreak: 'break-all' }}>
                Hash: {state.hashHex}
              </Typography>
              <Typography variant="body2" sx={{ wordBreak: 'break-all' }}>
                Lock tx: {state.lockTxHash}
              </Typography>
              <Typography variant="body2">Deadline: {new Date(Number(state.deadlineMs)).toISOString()}</Typography>

              <Divider />
              <Typography variant="h6">3. Send this URL to Bob</Typography>
              <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
                <TextField fullWidth value={shareUrl ?? ''} size="small" InputProps={{ readOnly: true }} />
                <IconButton onClick={onCopy}>
                  <ContentCopyIcon />
                </IconButton>
              </Box>

              {state.kind === 'locked' && (
                <Button variant="contained" onClick={startWaiting}>
                  Watch Midnight for Bob&apos;s deposit
                </Button>
              )}
              {state.kind === 'waiting-deposit' && (
                <Stack direction="row" spacing={2} alignItems="center">
                  <CircularProgress size={20} />
                  <Typography>Waiting for Bob&apos;s USDC deposit…</Typography>
                </Stack>
              )}
              {state.kind === 'claim-ready' && (
                <>
                  <Alert severity="success">
                    Bob deposited {state.depositAmount.toString()} USDC (color {state.depositColorHex.slice(0, 16)}…
                    {state.depositColorHex !== swapState.usdcColor && ' — MISMATCH vs expected USDC color!'})
                  </Alert>
                  <Button variant="contained" color="success" onClick={onClaim}>
                    Claim USDC
                  </Button>
                </>
              )}
              {state.kind === 'claiming' && (
                <Stack direction="row" spacing={2} alignItems="center">
                  <CircularProgress size={20} />
                  <Typography>Withdrawing USDC on Midnight (reveals preimage)…</Typography>
                </Stack>
              )}
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
              <Typography>Sent: {state.adaAmount.toString()} ADA</Typography>
              <Typography>Received: {state.depositAmount.toString()} USDC</Typography>
              <Typography variant="caption" sx={{ wordBreak: 'break-all' }}>
                Hash: {state.hashHex}
              </Typography>
              <Typography variant="caption" sx={{ wordBreak: 'break-all' }}>
                Cardano lock tx: {state.lockTxHash}
              </Typography>
            </Stack>
          </CardContent>
        </Card>
      )}

      {state.kind === 'error' && (
        <Alert severity="error">
          {state.message}
          <Box sx={{ mt: 1 }}>
            <Button size="small" onClick={() => dispatch({ t: 'reset' })}>
              Reset
            </Button>
          </Box>
        </Alert>
      )}
    </Stack>
  );
};
