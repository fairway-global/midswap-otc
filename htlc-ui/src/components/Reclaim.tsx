/**
 * Reclaim panel — two independent sections.
 *   • Alice's ADA reclaim on Cardano after her deadline (port of reclaim-ada.ts).
 *   • Bob's USDC reclaim on Midnight after his deadline (port of reclaim-usdc.ts).
 *
 * Each section does a pre-flight state check (matching UTxO exists on Cardano,
 * or htlcAmounts[hash] != 0 on Midnight) and blocks the button until the
 * deadline has passed.
 */

import React, { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  CardContent,
  CircularProgress,
  Divider,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { useSearchParams } from 'react-router-dom';
import { firstValueFrom } from 'rxjs';
import { useSwapContext } from '../hooks';
import { WalletConnect } from './WalletConnect';
import { bytesToHex, hexToBytes } from '../api/key-encoding';

type AdaStatus =
  | { kind: 'idle' }
  | { kind: 'inspecting' }
  | { kind: 'not-found' }
  | { kind: 'found'; lovelace: bigint; deadlineMs: bigint; expired: boolean }
  | { kind: 'reclaiming' }
  | { kind: 'done'; txHash: string; lovelace: bigint }
  | { kind: 'error'; message: string };

type UsdcStatus =
  | { kind: 'idle' }
  | { kind: 'inspecting' }
  | { kind: 'not-found' }
  | { kind: 'already-completed' }
  | { kind: 'found'; amount: bigint; color: string; expiryMs: number; expired: boolean }
  | { kind: 'reclaiming' }
  | { kind: 'done'; amount: bigint }
  | { kind: 'error'; message: string };

export const Reclaim: React.FC = () => {
  const [searchParams] = useSearchParams();
  const { session, cardano } = useSwapContext();
  const [hashInput, setHashInput] = useState<string>(() => (searchParams.get('hash') ?? '').trim().toLowerCase());

  const [adaStatus, setAdaStatus] = useState<AdaStatus>({ kind: 'idle' });
  const [usdcStatus, setUsdcStatus] = useState<UsdcStatus>({ kind: 'idle' });

  const hashValid = /^[0-9a-f]{64}$/.test(hashInput);

  // --- Cardano ADA reclaim ----------------------------------------------------

  const inspectAda = useCallback(async () => {
    if (!cardano || !hashValid) return;
    setAdaStatus({ kind: 'inspecting' });
    try {
      const utxo = await cardano.cardanoHtlc.findHTLCUtxo(hashInput);
      if (!utxo) {
        setAdaStatus({ kind: 'not-found' });
        return;
      }
      const htlcs = await cardano.cardanoHtlc.listHTLCs();
      const found = htlcs.find((h) => h.datum.preimageHash === hashInput);
      if (!found) {
        setAdaStatus({ kind: 'not-found' });
        return;
      }
      const deadlineMs = found.datum.deadline;
      const expired = Date.now() >= Number(deadlineMs);
      setAdaStatus({
        kind: 'found',
        lovelace: utxo.assets.lovelace ?? 0n,
        deadlineMs,
        expired,
      });
    } catch (e) {
      setAdaStatus({ kind: 'error', message: e instanceof Error ? e.message : String(e) });
    }
  }, [cardano, hashInput, hashValid]);

  const reclaimAda = useCallback(async () => {
    if (!cardano || !hashValid) return;
    if (adaStatus.kind !== 'found' || !adaStatus.expired) return;
    const lovelace = adaStatus.lovelace;
    setAdaStatus({ kind: 'reclaiming' });
    try {
      const txHash = await cardano.cardanoHtlc.reclaim(hashInput);
      setAdaStatus({ kind: 'done', txHash, lovelace });
    } catch (e) {
      setAdaStatus({ kind: 'error', message: e instanceof Error ? e.message : String(e) });
    }
  }, [cardano, hashInput, hashValid, adaStatus]);

  // --- Midnight USDC reclaim --------------------------------------------------

  const inspectUsdc = useCallback(async () => {
    if (!session || !hashValid) return;
    setUsdcStatus({ kind: 'inspecting' });
    try {
      const state = await firstValueFrom(session.htlcApi.state$);
      const entry = state.entries.get(hashInput);
      if (!entry) {
        setUsdcStatus({ kind: 'not-found' });
        return;
      }
      if (entry.amount === 0n) {
        setUsdcStatus({ kind: 'already-completed' });
        return;
      }
      const expiryMs = Number(entry.expirySecs) * 1000;
      const expired = Date.now() >= expiryMs;
      setUsdcStatus({
        kind: 'found',
        amount: entry.amount,
        color: bytesToHex(entry.color),
        expiryMs,
        expired,
      });
    } catch (e) {
      setUsdcStatus({ kind: 'error', message: e instanceof Error ? e.message : String(e) });
    }
  }, [session, hashInput, hashValid]);

  const reclaimUsdc = useCallback(async () => {
    if (!session || !hashValid) return;
    if (usdcStatus.kind !== 'found' || !usdcStatus.expired) return;
    const amount = usdcStatus.amount;
    setUsdcStatus({ kind: 'reclaiming' });
    try {
      await session.htlcApi.reclaimAfterExpiry(hexToBytes(hashInput));
      setUsdcStatus({ kind: 'done', amount });
    } catch (e) {
      setUsdcStatus({ kind: 'error', message: e instanceof Error ? e.message : String(e) });
    }
  }, [session, hashInput, hashValid, usdcStatus]);

  // Reset pre-flight results when the hash input changes.
  useEffect(() => {
    setAdaStatus({ kind: 'idle' });
    setUsdcStatus({ kind: 'idle' });
  }, [hashInput]);

  return (
    <Stack spacing={3} sx={{ width: '100%', maxWidth: 720 }}>
      <Typography variant="h4" sx={{ color: '#fff' }}>
        Reclaim stuck funds
      </Typography>

      <Alert severity="info">
        Use this page after a swap times out. Alice reclaims ADA on Cardano; Bob reclaims USDC on Midnight. Each reclaim
        is gated on the relevant deadline having passed, and must be done from the same wallet that created the original
        deposit.
      </Alert>

      <WalletConnect />

      <Card>
        <CardContent>
          <Stack spacing={2}>
            <Typography variant="h6">Swap hash</Typography>
            <TextField
              value={hashInput}
              onChange={(e) => setHashInput(e.target.value.trim().toLowerCase())}
              placeholder="64 hex characters"
              fullWidth
              error={!!hashInput && !hashValid}
              helperText={
                !hashInput ? 'Prefilled from URL if available' : hashValid ? '' : 'Must be exactly 64 hex chars'
              }
            />
          </Stack>
        </CardContent>
      </Card>

      <Card>
        <CardContent>
          <Stack spacing={2}>
            <Typography variant="h6">Alice — reclaim ADA on Cardano</Typography>
            <Button
              variant="outlined"
              onClick={inspectAda}
              disabled={!cardano || !hashValid || adaStatus.kind === 'inspecting' || adaStatus.kind === 'reclaiming'}
            >
              Check Cardano HTLC
            </Button>
            {adaStatus.kind === 'inspecting' && (
              <Stack direction="row" spacing={2} alignItems="center">
                <CircularProgress size={20} />
                <Typography>Querying Blockfrost…</Typography>
              </Stack>
            )}
            {adaStatus.kind === 'not-found' && (
              <Alert severity="warning">
                No Cardano HTLC UTxO found for this hash. It may already have been claimed or reclaimed.
              </Alert>
            )}
            {adaStatus.kind === 'found' && (
              <Stack spacing={1}>
                <Typography>Amount locked: {(Number(adaStatus.lovelace) / 1e6).toString()} ADA</Typography>
                <Typography>Deadline: {new Date(Number(adaStatus.deadlineMs)).toISOString()}</Typography>
                {adaStatus.expired ? (
                  <Alert severity="success">Deadline has passed — eligible for reclaim.</Alert>
                ) : (
                  <Alert severity="warning">
                    Deadline has not yet passed ({Math.ceil((Number(adaStatus.deadlineMs) - Date.now()) / 60000)} min
                    remaining).
                  </Alert>
                )}
                <Button variant="contained" color="warning" onClick={reclaimAda} disabled={!adaStatus.expired}>
                  Reclaim ADA
                </Button>
              </Stack>
            )}
            {adaStatus.kind === 'reclaiming' && (
              <Stack direction="row" spacing={2} alignItems="center">
                <CircularProgress size={20} />
                <Typography>Submitting reclaim. Please sign in Eternl.</Typography>
              </Stack>
            )}
            {adaStatus.kind === 'done' && (
              <Alert severity="success">
                Reclaimed {(Number(adaStatus.lovelace) / 1e6).toString()} ADA. Tx: {adaStatus.txHash.slice(0, 32)}…
              </Alert>
            )}
            {adaStatus.kind === 'error' && <Alert severity="error">{adaStatus.message}</Alert>}
          </Stack>
        </CardContent>
      </Card>

      <Divider />

      <Card>
        <CardContent>
          <Stack spacing={2}>
            <Typography variant="h6">Bob — reclaim USDC on Midnight</Typography>
            <Button
              variant="outlined"
              onClick={inspectUsdc}
              disabled={!session || !hashValid || usdcStatus.kind === 'inspecting' || usdcStatus.kind === 'reclaiming'}
            >
              Check Midnight HTLC
            </Button>
            {usdcStatus.kind === 'inspecting' && (
              <Stack direction="row" spacing={2} alignItems="center">
                <CircularProgress size={20} />
                <Typography>Reading contract state…</Typography>
              </Stack>
            )}
            {usdcStatus.kind === 'not-found' && <Alert severity="warning">No HTLC entry for this hash.</Alert>}
            {usdcStatus.kind === 'already-completed' && (
              <Alert severity="info">
                This swap has already completed (htlcAmounts sentinel is 0). Nothing to reclaim.
              </Alert>
            )}
            {usdcStatus.kind === 'found' && (
              <Stack spacing={1}>
                <Typography>Amount locked: {usdcStatus.amount.toString()}</Typography>
                <Typography variant="caption" sx={{ wordBreak: 'break-all' }}>
                  Color: {usdcStatus.color}
                </Typography>
                <Typography>Deadline: {new Date(usdcStatus.expiryMs).toISOString()}</Typography>
                {usdcStatus.expired ? (
                  <Alert severity="success">Deadline has passed — eligible for reclaim.</Alert>
                ) : (
                  <Alert severity="warning">
                    Deadline has not yet passed ({Math.ceil((usdcStatus.expiryMs - Date.now()) / 60000)} min remaining).
                  </Alert>
                )}
                <Button variant="contained" color="warning" onClick={reclaimUsdc} disabled={!usdcStatus.expired}>
                  Reclaim USDC
                </Button>
              </Stack>
            )}
            {usdcStatus.kind === 'reclaiming' && (
              <Stack direction="row" spacing={2} alignItems="center">
                <CircularProgress size={20} />
                <Typography>Submitting reclaim. Please sign in Lace.</Typography>
              </Stack>
            )}
            {usdcStatus.kind === 'done' && (
              <Alert severity="success">Reclaimed {usdcStatus.amount.toString()} USDC.</Alert>
            )}
            {usdcStatus.kind === 'error' && <Alert severity="error">{usdcStatus.message}</Alert>}
          </Stack>
        </CardContent>
      </Card>
    </Stack>
  );
};
