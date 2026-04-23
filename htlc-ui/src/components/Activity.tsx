/**
 * /activity — read-only view of every swap the orchestrator has indexed,
 * aggregated into top-line metrics and a per-row table with transaction
 * deep-links on both chains.
 *
 * Chain state is authoritative; this page is a convenience view.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  IconButton,
  Skeleton,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Tooltip,
  Typography,
} from '@mui/material';
import RefreshIcon from '@mui/icons-material/Refresh';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import DatasetLinkedIcon from '@mui/icons-material/DatasetLinked';
import { alpha, useTheme } from '@mui/material/styles';
import { orchestratorClient, type Swap, type SwapStatus } from '../api/orchestrator-client';
import { statusLabel, SwapStatusChip } from './SwapStatusChip';

interface Aggregate {
  total: number;
  byStatus: Record<SwapStatus, number>;
  totalAda: bigint;
  totalUsdc: bigint;
  stuck: number;
}

const ZERO_BY_STATUS: Record<SwapStatus, number> = {
  open: 0,
  bob_deposited: 0,
  alice_claimed: 0,
  completed: 0,
  alice_reclaimed: 0,
  bob_reclaimed: 0,
  expired: 0,
};

const formatAge = (ms: number): string => {
  const diff = Math.max(0, Date.now() - ms);
  const mins = Math.floor(diff / 60_000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
};

const shortHash = (hash: string): string => `${hash.slice(0, 10)}…${hash.slice(-4)}`;

const TX_SCAN_BASE: Record<string, string> = {
  midnight: 'https://indexer.preprod.midnight.network/tx/',
  cardano: 'https://preprod.cardanoscan.io/transaction/',
};

export const Activity: React.FC = () => {
  const theme = useTheme();
  const [swaps, setSwaps] = useState<Swap[] | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState(false);
  const [nowMs, setNowMs] = useState(Date.now());

  const refresh = useCallback(async () => {
    setError(undefined);
    setLoading(true);
    try {
      const { swaps: list } = await orchestratorClient.listSwaps();
      setSwaps(list);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const id = setInterval(() => void refresh(), 15_000);
    return () => clearInterval(id);
  }, [refresh]);

  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 10_000);
    return () => clearInterval(id);
  }, []);

  const aggregate = useMemo<Aggregate | undefined>(() => {
    if (!swaps) return undefined;
    const byStatus: Record<SwapStatus, number> = { ...ZERO_BY_STATUS };
    let totalAda = 0n;
    let totalUsdc = 0n;
    let stuck = 0;
    for (const s of swaps) {
      byStatus[s.status]++;
      try {
        totalAda += BigInt(s.adaAmount);
        totalUsdc += BigInt(s.usdcAmount);
      } catch {
        /* ignore */
      }
      const cardanoExpired = s.cardanoDeadlineMs < nowMs;
      const midnightExpired = s.midnightDeadlineMs !== null && s.midnightDeadlineMs < nowMs;
      const isStuck =
        (s.status === 'open' && cardanoExpired) ||
        (s.status === 'bob_deposited' && (cardanoExpired || midnightExpired)) ||
        (s.status === 'alice_claimed' && cardanoExpired);
      if (isStuck) stuck++;
    }
    return { total: swaps.length, byStatus, totalAda, totalUsdc, stuck };
  }, [swaps, nowMs]);

  const txLink = (chain: 'midnight' | 'cardano', hash: string | null): React.ReactNode => {
    if (!hash) return <Typography variant="caption" sx={{ color: theme.custom.textMuted }}>—</Typography>;
    return (
      <a
        href={`${TX_SCAN_BASE[chain]}${hash}`}
        target="_blank"
        rel="noopener noreferrer"
        style={{ color: theme.custom.cardanoBlue, textDecoration: 'none', fontSize: 12 }}
      >
        <code style={{ fontSize: 12 }}>{shortHash(hash)}</code>
        <OpenInNewIcon fontSize="inherit" sx={{ verticalAlign: 'text-bottom', ml: 0.25 }} />
      </a>
    );
  };

  return (
    <Stack spacing={3} sx={{ width: '100%', maxWidth: 1280, mx: 'auto' }}>
      <Stack direction="row" spacing={2} alignItems="center" flexWrap="wrap" useFlexGap>
        <Stack spacing={0.25} sx={{ flex: 1, minWidth: 200 }}>
          <Typography variant="h4">Activity</Typography>
          <Typography variant="body2" sx={{ color: theme.custom.textSecondary }}>
            Every swap the orchestrator has indexed. Chain state is authoritative.
          </Typography>
        </Stack>
        <Tooltip title="Refresh">
          <IconButton onClick={() => void refresh()} disabled={loading}>
            <RefreshIcon />
          </IconButton>
        </Tooltip>
      </Stack>

      {error && (
        <Alert severity="error">
          Orchestrator unreachable: {error}
          <Typography variant="caption" component="div" sx={{ mt: 0.5, opacity: 0.75 }}>
            Start it: <code>cd htlc-orchestrator &amp;&amp; npm run dev</code>
          </Typography>
        </Alert>
      )}

      {loading && !swaps && (
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} variant="rounded" height={120} sx={{ borderRadius: 4, flex: 1 }} />
          ))}
        </Stack>
      )}

      {aggregate && (
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
          <MetricCard label="Total tracked" value={aggregate.total.toString()} hint={`${aggregate.totalAda.toString()} ADA · ${aggregate.totalUsdc.toString()} USDC`} />
          <MetricCard
            label="Completed"
            value={aggregate.byStatus.completed.toString()}
            tone="success"
            hint={
              aggregate.total > 0
                ? `${Math.round((aggregate.byStatus.completed / aggregate.total) * 100)}% success`
                : 'no swaps yet'
            }
          />
          <MetricCard
            label="In flight"
            value={(aggregate.byStatus.open + aggregate.byStatus.bob_deposited + aggregate.byStatus.alice_claimed).toString()}
            tone="primary"
            hint="open · deposited · claimed"
          />
          <MetricCard
            label="Needs reclaim"
            value={aggregate.stuck.toString()}
            tone={aggregate.stuck > 0 ? 'warning' : 'muted'}
            hint="deadline passed"
          />
        </Stack>
      )}

      {aggregate && (
        <Box
          sx={{
            p: 1.5,
            borderRadius: 3,
            border: `1px solid ${theme.custom.borderSubtle}`,
            bgcolor: theme.custom.surface1,
          }}
        >
          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
            {(Object.keys(aggregate.byStatus) as SwapStatus[]).map((s) => (
              <Chip
                key={s}
                label={`${statusLabel(s)}: ${aggregate.byStatus[s]}`}
                variant={aggregate.byStatus[s] > 0 ? 'filled' : 'outlined'}
                size="small"
              />
            ))}
          </Stack>
        </Box>
      )}

      {swaps && swaps.length > 0 && (
        <Box
          sx={{
            borderRadius: 4,
            border: `1px solid ${theme.custom.borderSubtle}`,
            bgcolor: theme.custom.surface1,
            overflowX: 'auto',
          }}
        >
          <Table size="small" sx={{ minWidth: 900 }}>
            <TableHead>
              <TableRow>
                <TableCell>Hash</TableCell>
                <TableCell>Status</TableCell>
                <TableCell align="right">ADA</TableCell>
                <TableCell align="right">USDC</TableCell>
                <TableCell>Age</TableCell>
                <TableCell>Cardano deadline</TableCell>
                <TableCell>Cardano lock</TableCell>
                <TableCell>Cardano claim</TableCell>
                <TableCell>Midnight deposit</TableCell>
                <TableCell>Midnight claim</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {swaps.map((s) => (
                <TableRow key={s.hash} hover>
                  <TableCell>
                    <Typography variant="caption" sx={{ fontFamily: 'JetBrains Mono, monospace' }}>
                      {shortHash(s.hash)}
                    </Typography>
                  </TableCell>
                  <TableCell><SwapStatusChip status={s.status} /></TableCell>
                  <TableCell align="right">{s.adaAmount}</TableCell>
                  <TableCell align="right">{s.usdcAmount}</TableCell>
                  <TableCell>{formatAge(s.createdAt)}</TableCell>
                  <TableCell>
                    <Typography variant="caption">{new Date(s.cardanoDeadlineMs).toLocaleString([], {
                      month: 'short',
                      day: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}</Typography>
                  </TableCell>
                  <TableCell>{txLink('cardano', s.cardanoLockTx)}</TableCell>
                  <TableCell>{txLink('cardano', s.cardanoClaimTx ?? s.cardanoReclaimTx)}</TableCell>
                  <TableCell>{txLink('midnight', s.midnightDepositTx)}</TableCell>
                  <TableCell>{txLink('midnight', s.midnightClaimTx ?? s.midnightReclaimTx)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Box>
      )}

      {swaps && swaps.length === 0 && (
        <Box
          sx={{
            p: 6,
            borderRadius: 4,
            border: `1px dashed ${theme.custom.borderSubtle}`,
            textAlign: 'center',
            bgcolor: theme.custom.surface1,
          }}
        >
          <DatasetLinkedIcon sx={{ fontSize: 44, color: theme.custom.textMuted, mb: 1 }} />
          <Typography sx={{ fontWeight: 600, mb: 0.5 }}>No swaps tracked yet</Typography>
          <Typography variant="body2" sx={{ color: theme.custom.textSecondary }}>
            Every new offer or accepted swap will show up here automatically.
          </Typography>
        </Box>
      )}
    </Stack>
  );
};

const MetricCard: React.FC<{
  label: string;
  value: string;
  hint?: string;
  tone?: 'success' | 'primary' | 'warning' | 'muted';
}> = ({ label, value, hint, tone }) => {
  const theme = useTheme();
  const color =
    tone === 'success'
      ? theme.custom.success
      : tone === 'primary'
        ? theme.custom.cardanoBlue
        : tone === 'warning'
          ? theme.custom.warning
          : theme.custom.textPrimary;
  return (
    <Box
      sx={{
        flex: 1,
        minWidth: 180,
        p: 2.5,
        borderRadius: 4,
        border: `1px solid ${theme.custom.borderSubtle}`,
        bgcolor: theme.custom.surface1,
      }}
    >
      <Typography
        variant="caption"
        sx={{
          color: theme.custom.textMuted,
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
          fontWeight: 600,
          fontSize: 11,
        }}
      >
        {label}
      </Typography>
      <Typography
        sx={{ fontSize: '2.1rem', fontWeight: 600, color, lineHeight: 1.1, mt: 0.5 }}
      >
        {value}
      </Typography>
      {hint && (
        <Typography variant="caption" sx={{ color: theme.custom.textMuted, display: 'block', mt: 0.5 }}>
          {hint}
        </Typography>
      )}
    </Box>
  );
};
