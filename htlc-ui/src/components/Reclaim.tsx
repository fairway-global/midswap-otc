/**
 * /reclaim — list-driven refund panel powered by the orchestrator.
 *
 *   • Reclaim ADA on Cardano — for swaps where you locked ADA and the maker
 *     deadline has passed. Handles open + bob_deposited states.
 *   • Reclaim USDC on Midnight — for swaps where you deposited USDC and the
 *     taker deadline has passed.
 *
 * A manual "by hash" fallback is provided for swaps not tracked by the
 * orchestrator (e.g. CLI runs), hidden behind a toggle.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Collapse,
  Divider,
  IconButton,
  Skeleton,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import RefreshIcon from '@mui/icons-material/Refresh';
import PaidIcon from '@mui/icons-material/Paid';
import { alpha, useTheme } from '@mui/material/styles';
import { useSearchParams } from 'react-router-dom';
import { firstValueFrom } from 'rxjs';
import { useSwapContext } from '../hooks';
import { hexToBytes } from '../api/key-encoding';
import { orchestratorClient, type Swap } from '../api/orchestrator-client';
import { SwapStatusChip } from './SwapStatusChip';
import { TokenBadge } from './swap/TokenBadge';
import { ADA, USDC } from './swap/tokens';

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
  const theme = useTheme();
  const { session, cardano } = useSwapContext();
  const [swaps, setSwaps] = useState<Swap[] | undefined>(undefined);
  const [listError, setListError] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState(false);
  const [nowMs, setNowMs] = useState(Date.now());
  const [rowStatuses, setRowStatuses] = useState<Map<string, RowStatus>>(new Map());
  const [showManual, setShowManual] = useState(false);

  const myCpk = session?.bootstrap.coinPublicKeyHex?.toLowerCase();

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
        setRow(swap.hash, { kind: 'error', message: 'Connect your Cardano wallet first.' });
        return;
      }
      setRow(swap.hash, { kind: 'submitting' });
      try {
        const txHash = await cardano.cardanoHtlc.reclaim(swap.hash);
        setRow(swap.hash, { kind: 'done', detail: `Tx ${txHash.slice(0, 16)}…` });
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
        setRow(swap.hash, { kind: 'error', message: 'Connect your Midnight wallet first.' });
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

  // --- Manual "by hash" fallback (for CLI-only swaps) ---------------------

  const prefillHash = (searchParams.get('hash') ?? '').trim().toLowerCase();
  const [hashInput, setHashInput] = useState<string>(prefillHash);
  const hashValid = /^[0-9a-f]{64}$/.test(hashInput);
  const [adaStatus, setAdaStatus] = useState<ManualAdaStatus>({ kind: 'idle' });
  const [usdcStatus, setUsdcStatus] = useState<ManualUsdcStatus>({ kind: 'idle' });

  useEffect(() => {
    setAdaStatus({ kind: 'idle' });
    setUsdcStatus({ kind: 'idle' });
  }, [hashInput]);

  useEffect(() => {
    if (prefillHash) setShowManual(true);
  }, [prefillHash]);

  const manualInspectAda = useCallback(async () => {
    if (!cardano || !hashValid) return;
    setAdaStatus({ kind: 'inspecting' });
    try {
      const utxo = await cardano.cardanoHtlc.findHTLCUtxo(hashInput);
      if (!utxo) return setAdaStatus({ kind: 'not-found' });
      const htlcs = await cardano.cardanoHtlc.listHTLCs();
      const found = htlcs.find((h) => h.datum.preimageHash === hashInput);
      if (!found) return setAdaStatus({ kind: 'not-found' });
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

  const totalReclaimable = adaReclaimable.length + usdcReclaimable.length;

  return (
    <Stack spacing={3} sx={{ width: '100%', maxWidth: 860, mx: 'auto' }}>
      <Stack direction="row" spacing={2} alignItems="center" flexWrap="wrap" useFlexGap>
        <Stack spacing={0.25} sx={{ flex: 1, minWidth: 220 }}>
          <Typography variant="h4">Reclaim</Typography>
          <Typography variant="body2" sx={{ color: theme.custom.textSecondary }}>
            Swaps past their deadline that your connected wallet can refund.
          </Typography>
        </Stack>
        <Tooltip title="Refresh">
          <IconButton onClick={() => void refresh()} disabled={loading}>
            <RefreshIcon />
          </IconButton>
        </Tooltip>
      </Stack>

      {!(session || cardano) && (
        <Alert severity="info">Connect at least one wallet — Midswap uses your wallet to identify refunds.</Alert>
      )}

      {listError && (
        <Alert severity="error">
          Orchestrator unreachable: {listError}
          <Typography variant="caption" component="div" sx={{ mt: 0.5, opacity: 0.75 }}>
            Start it: <code>cd htlc-orchestrator &amp;&amp; npm run dev</code>
          </Typography>
        </Alert>
      )}

      {loading && !swaps && (
        <Stack spacing={1.5}>
          {[0, 1].map((i) => (
            <Skeleton key={i} variant="rounded" height={100} sx={{ borderRadius: 4 }} />
          ))}
        </Stack>
      )}

      {swaps && totalReclaimable === 0 && !loading && (
        <Box
          sx={{
            p: 6,
            borderRadius: 4,
            border: `1px dashed ${theme.custom.borderSubtle}`,
            bgcolor: theme.custom.surface1,
            textAlign: 'center',
          }}
        >
          <PaidIcon sx={{ fontSize: 44, color: theme.custom.success, mb: 1 }} />
          <Typography sx={{ fontWeight: 600, mb: 0.5 }}>Nothing to reclaim</Typography>
          <Typography variant="body2" sx={{ color: theme.custom.textSecondary }}>
            No swaps of yours have expired. You&apos;re good.
          </Typography>
        </Box>
      )}

      {/* ADA reclaim section */}
      {adaReclaimable.length > 0 && (
        <Section
          icon={<TokenBadge token={ADA} size={28} />}
          title="Refund ADA on Cardano"
          subtitle="Locks you made whose maker-side deadline has elapsed."
          count={adaReclaimable.length}
        >
          {adaReclaimable.map((swap) => (
            <ReclaimRow
              key={swap.hash}
              swap={swap}
              rowStatus={rowStatuses.get(swap.hash) ?? { kind: 'idle' }}
              side="ada"
              onReclaim={() => void reclaimAdaRow(swap)}
              disabled={!cardano}
              disabledReason="Connect Cardano wallet"
            />
          ))}
        </Section>
      )}

      {/* USDC reclaim section */}
      {usdcReclaimable.length > 0 && (
        <Section
          icon={<TokenBadge token={USDC} size={28} />}
          title="Refund USDC on Midnight"
          subtitle="Deposits you made whose taker-side deadline has elapsed."
          count={usdcReclaimable.length}
        >
          {usdcReclaimable.map((swap) => (
            <ReclaimRow
              key={swap.hash}
              swap={swap}
              rowStatus={rowStatuses.get(swap.hash) ?? { kind: 'idle' }}
              side="usdc"
              onReclaim={() => void reclaimUsdcRow(swap)}
              disabled={!session}
              disabledReason="Connect Midnight wallet"
            />
          ))}
        </Section>
      )}

      {/* Manual fallback */}
      <Divider sx={{ my: 1 }} />
      <Button variant="text" onClick={() => setShowManual((v) => !v)} sx={{ alignSelf: 'flex-start' }}>
        {showManual ? 'Hide' : 'Show'} manual reclaim by hash
      </Button>
      <Collapse in={showManual}>
        <Stack spacing={2}>
          <Alert severity="info">
            For swaps not tracked by the orchestrator (e.g. CLI-only runs). Paste the 32-byte hash as 64 hex chars.
          </Alert>

          <Box
            sx={{
              p: 2.5,
              borderRadius: 4,
              border: `1px solid ${theme.custom.borderSubtle}`,
              bgcolor: theme.custom.surface1,
            }}
          >
            <TextField
              label="Swap hash"
              value={hashInput}
              onChange={(e) => setHashInput(e.target.value.trim().toLowerCase())}
              placeholder="64 hex characters"
              fullWidth
              error={!!hashInput && !hashValid}
              helperText={!hashInput ? '' : hashValid ? '' : 'Must be exactly 64 hex chars'}
            />
          </Box>

          <ManualChainPanel
            title="Cardano HTLC — refund ADA"
            onInspect={() => void manualInspectAda()}
            onReclaim={() => void manualReclaimAda()}
            disabledInspect={!cardano || !hashValid || adaStatus.kind === 'inspecting' || adaStatus.kind === 'reclaiming'}
            body={
              <>
                {adaStatus.kind === 'inspecting' && <InlineBusy label="Querying Blockfrost…" />}
                {adaStatus.kind === 'not-found' && (
                  <Alert severity="warning">No Cardano HTLC UTxO for this hash. It may already have settled.</Alert>
                )}
                {adaStatus.kind === 'found' && (
                  <Stack spacing={0.5}>
                    <Typography>Amount locked: {(Number(adaStatus.lovelace) / 1e6).toString()} ADA</Typography>
                    <Typography>Deadline: {new Date(Number(adaStatus.deadlineMs)).toLocaleString()}</Typography>
                    {adaStatus.expired ? (
                      <Alert severity="success">Deadline has passed — eligible for reclaim.</Alert>
                    ) : (
                      <Alert severity="warning">
                        Deadline not yet reached (~
                        {Math.ceil((Number(adaStatus.deadlineMs) - Date.now()) / 60000)} min remaining).
                      </Alert>
                    )}
                  </Stack>
                )}
                {adaStatus.kind === 'reclaiming' && <InlineBusy label="Submitting reclaim. Sign in Cardano wallet." />}
                {adaStatus.kind === 'done' && (
                  <Alert severity="success">
                    Reclaimed {(Number(adaStatus.lovelace) / 1e6).toString()} ADA. Tx {adaStatus.txHash.slice(0, 24)}…
                  </Alert>
                )}
                {adaStatus.kind === 'error' && <Alert severity="error">{adaStatus.message}</Alert>}
              </>
            }
            canReclaim={adaStatus.kind === 'found' && adaStatus.expired}
          />

          <ManualChainPanel
            title="Midnight HTLC — refund USDC"
            onInspect={() => void manualInspectUsdc()}
            onReclaim={() => void manualReclaimUsdc()}
            disabledInspect={!session || !hashValid || usdcStatus.kind === 'inspecting' || usdcStatus.kind === 'reclaiming'}
            body={
              <>
                {usdcStatus.kind === 'inspecting' && <InlineBusy label="Reading contract state…" />}
                {usdcStatus.kind === 'not-found' && <Alert severity="warning">No HTLC entry for this hash.</Alert>}
                {usdcStatus.kind === 'already-completed' && (
                  <Alert severity="info">Swap already completed — nothing to reclaim.</Alert>
                )}
                {usdcStatus.kind === 'found' && (
                  <Stack spacing={0.5}>
                    <Typography>Amount locked: {usdcStatus.amount.toString()}</Typography>
                    <Typography>Deadline: {new Date(usdcStatus.expiryMs).toLocaleString()}</Typography>
                    {usdcStatus.expired ? (
                      <Alert severity="success">Deadline has passed — eligible for reclaim.</Alert>
                    ) : (
                      <Alert severity="warning">
                        Deadline not yet reached (~
                        {Math.ceil((usdcStatus.expiryMs - Date.now()) / 60000)} min remaining).
                      </Alert>
                    )}
                  </Stack>
                )}
                {usdcStatus.kind === 'reclaiming' && <InlineBusy label="Submitting reclaim. Sign in Midnight wallet." />}
                {usdcStatus.kind === 'done' && (
                  <Alert severity="success">Reclaimed {usdcStatus.amount.toString()} USDC.</Alert>
                )}
                {usdcStatus.kind === 'error' && <Alert severity="error">{usdcStatus.message}</Alert>}
              </>
            }
            canReclaim={usdcStatus.kind === 'found' && usdcStatus.expired}
          />
        </Stack>
      </Collapse>
    </Stack>
  );
};

const Section: React.FC<{
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  count: number;
  children: React.ReactNode;
}> = ({ icon, title, subtitle, count, children }) => {
  const theme = useTheme();
  return (
    <Box
      sx={{
        p: 2.5,
        borderRadius: 4,
        border: `1px solid ${theme.custom.borderSubtle}`,
        bgcolor: theme.custom.surface1,
      }}
    >
      <Stack direction="row" spacing={1.5} alignItems="center" sx={{ mb: 1.5 }}>
        {icon}
        <Stack>
          <Typography sx={{ fontWeight: 600 }}>{title}</Typography>
          <Typography variant="caption" sx={{ color: theme.custom.textSecondary }}>
            {subtitle}
          </Typography>
        </Stack>
        <Box sx={{ flex: 1 }} />
        <Chip size="small" label={`${count} eligible`} color="warning" />
      </Stack>
      <Stack spacing={1}>{children}</Stack>
    </Box>
  );
};

const ReclaimRow: React.FC<{
  swap: Swap;
  rowStatus: RowStatus;
  side: 'ada' | 'usdc';
  onReclaim: () => void;
  disabled?: boolean;
  disabledReason?: string;
}> = ({ swap, rowStatus, side, onReclaim, disabled, disabledReason }) => {
  const theme = useTheme();
  const deadlineMs = side === 'ada' ? swap.cardanoDeadlineMs : swap.midnightDeadlineMs ?? 0;

  return (
    <Box
      sx={{
        p: 2,
        borderRadius: 3,
        border: `1px solid ${alpha(theme.custom.warning, 0.28)}`,
        bgcolor: alpha(theme.custom.warning, 0.05),
      }}
    >
      <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5} alignItems={{ md: 'center' }}>
        <Stack sx={{ flex: 1 }}>
          <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
            <Typography sx={{ fontWeight: 600 }}>
              {side === 'ada'
                ? `${swap.adaAmount} ADA → ${swap.usdcAmount} USDC`
                : `${swap.usdcAmount} USDC → ${swap.adaAmount} ADA`}
            </Typography>
            <Chip size="small" color="error" label={`expired ${formatAgo(deadlineMs)}`} />
            <SwapStatusChip status={swap.status} />
          </Stack>
          <Typography variant="caption" sx={{ color: theme.custom.textMuted, mt: 0.25 }}>
            {new Date(deadlineMs).toLocaleString()} · {swap.hash.slice(0, 16)}…
          </Typography>
        </Stack>
        <Box sx={{ minWidth: 160 }}>
          {rowStatus.kind === 'submitting' ? (
            <Stack direction="row" spacing={1} alignItems="center">
              <CircularProgress size={14} />
              <Typography variant="caption">Submitting…</Typography>
            </Stack>
          ) : rowStatus.kind === 'done' ? (
            <Chip size="small" color="success" label={rowStatus.detail ?? 'Submitted'} />
          ) : rowStatus.kind === 'error' ? (
            <Typography variant="caption" sx={{ color: theme.custom.danger }}>
              {rowStatus.message}
            </Typography>
          ) : (
            <Tooltip title={disabled ? disabledReason ?? '' : ''}>
              <span>
                <Button
                  variant="contained"
                  color="warning"
                  onClick={onReclaim}
                  disabled={disabled}
                  sx={{ whiteSpace: 'nowrap' }}
                >
                  Reclaim {side === 'ada' ? 'ADA' : 'USDC'}
                </Button>
              </span>
            </Tooltip>
          )}
        </Box>
      </Stack>
    </Box>
  );
};

const ManualChainPanel: React.FC<{
  title: string;
  onInspect: () => void;
  onReclaim: () => void;
  disabledInspect: boolean;
  body: React.ReactNode;
  canReclaim: boolean;
}> = ({ title, onInspect, onReclaim, disabledInspect, body, canReclaim }) => {
  const theme = useTheme();
  return (
    <Box
      sx={{
        p: 2.5,
        borderRadius: 4,
        border: `1px solid ${theme.custom.borderSubtle}`,
        bgcolor: theme.custom.surface1,
      }}
    >
      <Typography sx={{ fontWeight: 600, mb: 1.5 }}>{title}</Typography>
      <Stack spacing={1.5}>
        <Stack direction="row" spacing={1}>
          <Button variant="outlined" onClick={onInspect} disabled={disabledInspect}>
            Check state
          </Button>
          <Button variant="contained" color="warning" onClick={onReclaim} disabled={!canReclaim}>
            Reclaim
          </Button>
        </Stack>
        {body}
      </Stack>
    </Box>
  );
};

const InlineBusy: React.FC<{ label: string }> = ({ label }) => (
  <Stack direction="row" spacing={1} alignItems="center">
    <CircularProgress size={14} />
    <Typography variant="body2">{label}</Typography>
  </Stack>
);
