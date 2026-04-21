/**
 * Alice role — locks ADA, generates a shareable URL for Bob, waits for
 * Bob's USDC deposit, claims USDC (revealing preimage).
 *
 * Faithful port of `htlc-ft-cli/src/alice-swap.ts`.
 */

import React, { useCallback, useEffect, useMemo, useReducer, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  CircularProgress,
  Divider,
  IconButton,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import { useSwapContext } from '../hooks';
import { WalletConnect } from './WalletConnect';
import { bytesToHex, hexToBytes } from '../api/key-encoding';

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

const sha256 = async (bytes: Uint8Array): Promise<Uint8Array> => {
  const digest = await crypto.subtle.digest('SHA-256', bytes as BufferSource);
  return new Uint8Array(digest);
};

const randomBytes32 = (): Uint8Array => crypto.getRandomValues(new Uint8Array(32));

export const AliceSwap: React.FC = () => {
  const { session, cardano, swapState } = useSwapContext();
  const [state, dispatch] = useReducer(reducer, { kind: 'connect' as const });

  // Form inputs.
  const [adaAmount, setAdaAmount] = useState<string>('1');
  const [usdcAmount, setUsdcAmount] = useState<string>('1');
  const [deadlineMin, setDeadlineMin] = useState<string>('120');
  const [bobPkh, setBobPkh] = useState<string>('');
  const [formError, setFormError] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (session && cardano && state.kind === 'connect') {
      dispatch({ t: 'to-params' });
    }
  }, [session, cardano, state.kind]);

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
    const bobPkhHex = bobPkh.trim().toLowerCase();
    if (!/^[0-9a-f]{56}$/.test(bobPkhHex)) {
      setFormError('Bob PKH must be 56 hex characters (28 bytes).');
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
      dispatch({ t: 'error', message: e instanceof Error ? e.message : String(e) });
    }
  }, [session, cardano, adaAmount, usdcAmount, deadlineMin, bobPkh]);

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
      dispatch({ t: 'to-done', depositAmount: state.depositAmount });
    } catch (e) {
      dispatch({ t: 'error', message: e instanceof Error ? e.message : String(e) });
    }
  }, [state, session]);

  const onCopy = useCallback(async () => {
    if (!shareUrl) return;
    await navigator.clipboard.writeText(shareUrl);
  }, [shareUrl]);

  return (
    <Stack spacing={3} sx={{ width: '100%', maxWidth: 720 }}>
      <Typography variant="h4" sx={{ color: '#fff' }}>
        Alice — lock ADA, claim USDC
      </Typography>

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
                label="Bob Cardano PKH (28 bytes hex)"
                value={bobPkh}
                onChange={(e) => setBobPkh(e.target.value)}
                size="small"
              />
              {formError && <Alert severity="error">{formError}</Alert>}
              <Button variant="contained" onClick={onLock}>
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
