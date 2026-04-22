/**
 * Reclaim panel — list-driven, powered by the orchestrator DB.
 *
 *   • "Reclaim ADA"  — open/bob_deposited swaps where you are Alice (sender
 *                      of the Cardano lock) AND the Cardano deadline has
 *                      passed. One-click per row — calls Cardano reclaim.
 *   • "Reclaim USDC" — bob_deposited swaps where you are Bob AND the Midnight
 *                      deadline has passed. One-click per row — calls the
 *                      HTLC `reclaimAfterExpiry` circuit.
 *
 * A manual "by hash" fallback remains for swaps that never hit the DB (e.g.
 * CLI-only runs), hidden behind a toggle so the common case is zero-input.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Collapse,
  Divider,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import RefreshIcon from '@mui/icons-material/Refresh';
import { useSearchParams } from 'react-router-dom';
import { firstValueFrom } from 'rxjs';
import { useSwapContext } from '../hooks';
import { WalletConnect } from './WalletConnect';
import { hexToBytes } from '../api/key-encoding';
import { orchestratorClient, type Swap } from '../api/orchestrator-client';

type RowStatus =
  | { kind: 'idle' }
  | { kind: 'submitting' }
  | { kind: 'done'; detail?: string }
  | { kind: 'error'; message: string };

type ManualAdaStatus =
  | { kind: 'idle' }
  | { kind: 'inspecting' }
  | { kind: 'not-found' }
  | { kind: 'found'; lovelace: bigint; deadlineMs: bigint; expired: boolean }
  | { kind: 'reclaiming' }
  | { kind: 'done'; txHash: string; lovelace: bigint }
  | { kind: 'error'; message: string };

type ManualUsdcStatus =
  | { kind: 'idle' }
  | { kind: 'inspecting' }
  | { kind: 'not-found' }
  | { kind: 'already-completed' }
  | { kind: 'found'; amount: bigint; expiryMs: number; expired: boolean }
  | { kind: 'reclaiming' }
  | { kind: 'done'; amount: bigint }
  | { kind: 'error'; message: string };

const formatAgo = (deadlineMs: number): string => {
  const diff = Math.floor((Date.now() - deadlineMs) / 1000);
  if (diff < 60) return `${diff}s ago`;
  const mins = Math.floor(diff / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  return `${hours}h ${mins % 60}m ago`;
};

export const Reclaim: React.FC = () => {
  const [searchParams] = useSearchParams();
  const { session, cardano } = useSwapContext();
  const [swaps, setSwaps] = useState<Swap[] | undefined>(undefined);
  const [listError, setListError] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState(false);
  const [nowMs, setNowMs] = useState(Date.now());
  const [rowStatuses, setRowStatuses] = useState<Map<string, RowStatus>>(new Map());
  const [showManual, setShowManual] = useState(false);

  const myCpk = session?.bootstrap.coinPublicKeyHex?.toLowerCase();
  const myPkh = cardano?.paymentKeyHash?.toLowerCase();

  const setRow = useCallback((hash: string, s: RowStatus): void => {
    setRowStatuses((prev) => {
      const next = new Map(prev);
      next.set(hash, s);
      return next;
    });
  }, []);

  const refresh = useCallback(async (): Promise<void> => {
    setListError(undefined);
    setLoading(true);
    try {
      const { swaps: list } = await orchestratorClient.listSwaps();
      setSwaps(list);
    } catch (e) {
      setListError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const id = setInterval(() => void refresh(), 10_000);
    return () => clearInterval(id);
  }, [refresh]);

  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 5_000);
    return () => clearInterval(id);
  }, []);

  const { adaReclaimable, usdcReclaimable } = useMemo(() => {
    if (!swaps) return { adaReclaimable: [] as Swap[], usdcReclaimable: [] as Swap[] };
    const ada = swaps.filter(
      (s) =>
        (s.status === 'open' || s.status === 'bob_deposited') &&
        s.cardanoDeadlineMs < nowMs &&
        (!myCpk || s.aliceCpk.toLowerCase() === myCpk),
    );
    const usdc = swaps.filter(
      (s) =>
        s.status === 'bob_deposited' &&
        s.midnightDeadlineMs !== null &&
        s.midnightDeadlineMs < nowMs &&
        (!myCpk || s.bobCpk?.toLowerCase() === myCpk),
    );
    return { adaReclaimable: ada, usdcReclaimable: usdc };
  }, [swaps, nowMs, myCpk]);

  const reclaimAdaRow = useCallback(
    async (swap: Swap): Promise<void> => {
      if (!cardano) {
        setRow(swap.hash, { kind: 'error', message: 'Connect Eternl first.' });
        return;
      }
      setRow(swap.hash, { kind: 'submitting' });
      try {
        const txHash = await cardano.cardanoHtlc.reclaim(swap.hash);
        setRow(swap.hash, { kind: 'done', detail: `Tx: ${txHash.slice(0, 32)}…` });
        void refresh();
      } catch (e) {
        setRow(swap.hash, { kind: 'error', message: e instanceof Error ? e.message : String(e) });
      }
    },
    [cardano, refresh, setRow],
  );

  const reclaimUsdcRow = useCallback(
    async (swap: Swap): Promise<void> => {
      if (!session) {
        setRow(swap.hash, { kind: 'error', message: 'Connect Lace first.' });
        return;
      }
      setRow(swap.hash, { kind: 'submitting' });
      try {
        await session.htlcApi.reclaimAfterExpiry(hexToBytes(swap.hash));
        setRow(swap.hash, { kind: 'done', detail: `Reclaimed ${swap.usdcAmount} USDC` });
        void refresh();
      } catch (e) {
        setRow(swap.hash, { kind: 'error', message: e instanceof Error ? e.message : String(e) });
      }
    },
    [session, refresh, setRow],
  );

  // --- Manual "by hash" fallback (legacy flow, kept for CLI-only swaps) -----

  const prefillHash = (searchParams.get('hash') ?? '').trim().toLowerCase();
  const [hashInput, setHashInput] = useState<string>(prefillHash);
  const hashValid = /^[0-9a-f]{64}$/.test(hashInput);
  const [adaStatus, setAdaStatus] = useState<ManualAdaStatus>({ kind: 'idle' });
  const [usdcStatus, setUsdcStatus] = useState<ManualUsdcStatus>({ kind: 'idle' });

  useEffect(() => {
    setAdaStatus({ kind: 'idle' });
    setUsdcStatus({ kind: 'idle' });
  }, [hashInput]);

  // Auto-expand manual panel if the URL has a ?hash= param.
  useEffect(() => {
    if (prefillHash) setShowManual(true);
  }, [prefillHash]);

  const manualInspectAda = useCallback(async () => {
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
      setAdaStatus({
        kind: 'found',
        lovelace: utxo.assets.lovelace ?? 0n,
        deadlineMs: found.datum.deadline,
        expired: Date.now() >= Number(found.datum.deadline),
      });
    } catch (e) {
      setAdaStatus({ kind: 'error', message: e instanceof Error ? e.message : String(e) });
    }
  }, [cardano, hashInput, hashValid]);

  const manualReclaimAda = useCallback(async () => {
    if (!cardano || adaStatus.kind !== 'found' || !adaStatus.expired) return;
    const lovelace = adaStatus.lovelace;
    setAdaStatus({ kind: 'reclaiming' });
    try {
      const txHash = await cardano.cardanoHtlc.reclaim(hashInput);
      setAdaStatus({ kind: 'done', txHash, lovelace });
      void refresh();
    } catch (e) {
      setAdaStatus({ kind: 'error', message: e instanceof Error ? e.message : String(e) });
    }
  }, [cardano, hashInput, adaStatus, refresh]);

  const manualInspectUsdc = useCallback(async () => {
    if (!session || !hashValid) return;
    setUsdcStatus({ kind: 'inspecting' });
    try {
      const state = await firstValueFrom(session.htlcApi.state$);
      const entry = state.entries.get(hashInput);
      if (!entry) return setUsdcStatus({ kind: 'not-found' });
      if (entry.amount === 0n) return setUsdcStatus({ kind: 'already-completed' });
      const expiryMs = Number(entry.expirySecs) * 1000;
      setUsdcStatus({
        kind: 'found',
        amount: entry.amount,
        expiryMs,
        expired: Date.now() >= expiryMs,
      });
    } catch (e) {
      setUsdcStatus({ kind: 'error', message: e instanceof Error ? e.message : String(e) });
    }
  }, [session, hashInput, hashValid]);

  const manualReclaimUsdc = useCallback(async () => {
    if (!session || usdcStatus.kind !== 'found' || !usdcStatus.expired) return;
    const amount = usdcStatus.amount;
    setUsdcStatus({ kind: 'reclaiming' });
    try {
      await session.htlcApi.reclaimAfterExpiry(hexToBytes(hashInput));
      setUsdcStatus({ kind: 'done', amount });
      void refresh();
    } catch (e) {
      setUsdcStatus({ kind: 'error', message: e instanceof Error ? e.message : String(e) });
    }
  }, [session, hashInput, usdcStatus, refresh]);

  // --- render ---------------------------------------------------------------

  const needsLace = !session;
  const needsEternl = !cardano;

  const renderRowActionAda = (swap: Swap): React.ReactNode => {
    const rs = rowStatuses.get(swap.hash) ?? { kind: 'idle' };
    if (rs.kind === 'submitting') {
      return (
        <Stack direction="row" spacing={1} alignItems="center">
          <CircularProgress size={16} />
          <Typography variant="body2">Submitting. Please sign in Eternl.</Typography>
        </Stack>
      );
    }
    if (rs.kind === 'done') {
      return <Alert severity="success">Reclaim submitted. {rs.detail ?? ''}</Alert>;
    }
    if (rs.kind === 'error') {
      return <Alert severity="error">{rs.message}</Alert>;
    }
    return (
      <Button
        variant="contained"
        color="warning"
        onClick={() => void reclaimAdaRow(swap)}
        disabled={!cardano}
      >
        Reclaim ADA
      </Button>
    );
  };

  const renderRowActionUsdc = (swap: Swap): React.ReactNode => {
    const rs = rowStatuses.get(swap.hash) ?? { kind: 'idle' };
    if (rs.kind === 'submitting') {
      return (
        <Stack direction="row" spacing={1} alignItems="center">
          <CircularProgress size={16} />
          <Typography variant="body2">Submitting. Please sign in Lace.</Typography>
        </Stack>
      );
    }
    if (rs.kind === 'done') {
      return <Alert severity="success">{rs.detail ?? 'Reclaim submitted.'}</Alert>;
    }
    if (rs.kind === 'error') {
      return <Alert severity="error">{rs.message}</Alert>;
    }
    return (
      <Button
        variant="contained"
        color="warning"
        onClick={() => void reclaimUsdcRow(swap)}
        disabled={!session}
      >
        Reclaim USDC
      </Button>
    );
  };

  return (
    <Stack spacing={3} sx={{ width: '100%', maxWidth: 780 }}>
      <Stack direction="row" spacing={2} alignItems="center">
        <Typography variant="h4" sx={{ color: '#fff', flex: 1 }}>
          Reclaim stuck funds
        </Typography>
        <Button variant="outlined" startIcon={<RefreshIcon />} onClick={() => void refresh()} disabled={loading}>
          Refresh
        </Button>
      </Stack>

      <Alert severity="info">
        Swaps are loaded from the orchestrator. Anything below is already past its deadline and eligible for reclaim by
        your connected wallet. Alice reclaims ADA on Cardano; Bob reclaims USDC on Midnight.
      </Alert>

      <WalletConnect />

      {(needsLace || needsEternl) && (
        <Alert severity="warning">
          Connect {needsLace && 'Lace'}
          {needsLace && needsEternl && ' and '}
          {needsEternl && 'Eternl'} to identify swaps you can reclaim.
        </Alert>
      )}

      {listError && (
        <Alert severity="error">
          Orchestrator unreachable: {listError}
          <Box sx={{ mt: 1 }}>
            <Typography variant="caption">
              Is it running? <code>cd htlc-orchestrator &amp;&amp; npm run dev</code>
            </Typography>
          </Box>
        </Alert>
      )}

      {/* --- Alice: reclaim ADA --------------------------------------------- */}
      <Card>
        <CardContent>
          <Stack spacing={2}>
            <Stack direction="row" alignItems="center" spacing={1}>
              <Typography variant="h6">Alice — reclaim ADA on Cardano</Typography>
              <Chip size="small" label={`${adaReclaimable.length} eligible`} />
            </Stack>

            {!session && <Typography variant="body2">Connect Lace to see your Alice-role swaps.</Typography>}

            {session && adaReclaimable.length === 0 && !loading && (
              <Typography variant="body2" sx={{ opacity: 0.7 }}>
                No expired ADA locks waiting on you.
              </Typography>
            )}

            {adaReclaimable.map((swap) => (
              <Card key={swap.hash} variant="outlined">
                <CardContent>
                  <Stack spacing={1}>
                    <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
                      <Typography variant="subtitle1">
                        {swap.adaAmount} ADA ⇄ {swap.usdcAmount} USDC
                      </Typography>
                      <Chip size="small" color="error" label={`expired ${formatAgo(swap.cardanoDeadlineMs)}`} />
                      <Chip size="small" variant="outlined" label={swap.status} />
                    </Stack>
                    <Typography variant="caption" sx={{ wordBreak: 'break-all' }}>
                      Hash: {swap.hash.slice(0, 32)}…
                    </Typography>
                    <Typography variant="caption">
                      Cardano deadline: {new Date(swap.cardanoDeadlineMs).toISOString()}
                    </Typography>
                    {myPkh && swap.bobPkh && swap.bobPkh.toLowerCase() === myPkh && (
                      <Typography variant="caption" sx={{ opacity: 0.6 }}>
                        (self-test: bobPkh matches your own PKH)
                      </Typography>
                    )}
                    <Box sx={{ mt: 1 }}>{renderRowActionAda(swap)}</Box>
                  </Stack>
                </CardContent>
              </Card>
            ))}
          </Stack>
        </CardContent>
      </Card>

      {/* --- Bob: reclaim USDC ---------------------------------------------- */}
      <Card>
        <CardContent>
          <Stack spacing={2}>
            <Stack direction="row" alignItems="center" spacing={1}>
              <Typography variant="h6">Bob — reclaim USDC on Midnight</Typography>
              <Chip size="small" label={`${usdcReclaimable.length} eligible`} />
            </Stack>

            {!session && <Typography variant="body2">Connect Lace to see your Bob-role swaps.</Typography>}

            {session && usdcReclaimable.length === 0 && !loading && (
              <Typography variant="body2" sx={{ opacity: 0.7 }}>
                No expired USDC deposits waiting on you.
              </Typography>
            )}

            {usdcReclaimable.map((swap) => (
              <Card key={swap.hash} variant="outlined">
                <CardContent>
                  <Stack spacing={1}>
                    <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
                      <Typography variant="subtitle1">
                        {swap.usdcAmount} USDC ⇄ {swap.adaAmount} ADA
                      </Typography>
                      <Chip
                        size="small"
                        color="error"
                        label={`expired ${formatAgo(swap.midnightDeadlineMs ?? 0)}`}
                      />
                      <Chip size="small" variant="outlined" label={swap.status} />
                    </Stack>
                    <Typography variant="caption" sx={{ wordBreak: 'break-all' }}>
                      Hash: {swap.hash.slice(0, 32)}…
                    </Typography>
                    <Typography variant="caption">
                      Midnight deadline: {new Date(swap.midnightDeadlineMs ?? 0).toISOString()}
                    </Typography>
                    <Box sx={{ mt: 1 }}>{renderRowActionUsdc(swap)}</Box>
                  </Stack>
                </CardContent>
              </Card>
            ))}
          </Stack>
        </CardContent>
      </Card>

      {/* --- Manual fallback ------------------------------------------------ */}
      <Divider />
      <Button variant="text" onClick={() => setShowManual((v) => !v)} sx={{ alignSelf: 'flex-start' }}>
        {showManual ? 'Hide' : 'Show'} manual reclaim by hash (advanced)
      </Button>
      <Collapse in={showManual}>
        <Stack spacing={2}>
          <Alert severity="info">
            Use this only for swaps not tracked by the orchestrator (e.g., CLI-only runs). Paste the 32-byte swap hash
            as 64 hex chars.
          </Alert>

          <Card>
            <CardContent>
              <TextField
                label="Swap hash"
                value={hashInput}
                onChange={(e) => setHashInput(e.target.value.trim().toLowerCase())}
                placeholder="64 hex characters"
                fullWidth
                error={!!hashInput && !hashValid}
                helperText={!hashInput ? '' : hashValid ? '' : 'Must be exactly 64 hex chars'}
              />
            </CardContent>
          </Card>

          <Card>
            <CardContent>
              <Stack spacing={2}>
                <Typography variant="h6">Alice — reclaim ADA on Cardano</Typography>
                <Button
                  variant="outlined"
                  onClick={() => void manualInspectAda()}
                  disabled={
                    !cardano || !hashValid || adaStatus.kind === 'inspecting' || adaStatus.kind === 'reclaiming'
                  }
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
                    <Button
                      variant="contained"
                      color="warning"
                      onClick={() => void manualReclaimAda()}
                      disabled={!adaStatus.expired}
                    >
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

          <Card>
            <CardContent>
              <Stack spacing={2}>
                <Typography variant="h6">Bob — reclaim USDC on Midnight</Typography>
                <Button
                  variant="outlined"
                  onClick={() => void manualInspectUsdc()}
                  disabled={
                    !session || !hashValid || usdcStatus.kind === 'inspecting' || usdcStatus.kind === 'reclaiming'
                  }
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
                    <Typography>Deadline: {new Date(usdcStatus.expiryMs).toISOString()}</Typography>
                    {usdcStatus.expired ? (
                      <Alert severity="success">Deadline has passed — eligible for reclaim.</Alert>
                    ) : (
                      <Alert severity="warning">
                        Deadline has not yet passed ({Math.ceil((usdcStatus.expiryMs - Date.now()) / 60000)} min
                        remaining).
                      </Alert>
                    )}
                    <Button
                      variant="contained"
                      color="warning"
                      onClick={() => void manualReclaimUsdc()}
                      disabled={!usdcStatus.expired}
                    >
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
      </Collapse>
    </Stack>
  );
};
