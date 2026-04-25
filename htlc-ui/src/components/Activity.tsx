/**
 * /activity — settlement monitor. Read-only view of every swap the orchestrator
 * has indexed, aggregated into top-line metrics and a per-row table with
 * transaction deep-links on both chains.
 *
 * Chain state is authoritative; this page is a convenience view.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
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
  totalUsdm: bigint;
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

// 1AM explorer for Midnight (https://explorer.1am.xyz/tx/<hash>?network=preprod);
// CardanoScan for the Cardano leg.
const TX_SCAN_BASE: Record<string, (hash: string) => string> = {
  midnight: (h) => `https://explorer.1am.xyz/tx/${h}?network=preprod`,
  cardano: (h) => `https://preprod.cardanoscan.io/transaction/${h}`,
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
    let totalUsdm = 0n;
    let totalUsdc = 0n;
    let stuck = 0;
    for (const s of swaps) {
      byStatus[s.status]++;
      try {
        totalUsdm += BigInt(s.usdmAmount);
        totalUsdc += BigInt(s.usdcAmount);
      } catch {
        /* ignore */
      }
      const cardanoExpired = s.cardanoDeadlineMs !== null && s.cardanoDeadlineMs < nowMs;
      const midnightExpired = s.midnightDeadlineMs !== null && s.midnightDeadlineMs < nowMs;
      // "Stuck" here = past any of the relevant deadlines with no resolution.
      // The specific deadline that matters depends on direction; a conservative
      // OR across both flags is fine for a dashboard summary.
      const isStuck =
        (s.status === 'open' && (cardanoExpired || midnightExpired)) ||
        (s.status === 'bob_deposited' && (cardanoExpired || midnightExpired)) ||
        (s.status === 'alice_claimed' && (cardanoExpired || midnightExpired));
      if (isStuck) stuck++;
    }
    return { total: swaps.length, byStatus, totalUsdm, totalUsdc, stuck };
  }, [swaps, nowMs]);

  const txLink = (chain: 'midnight' | 'cardano', hash: string | null): React.ReactNode => {
    if (!hash)
      return (
        <Typography sx={{ color: theme.custom.textMuted, fontSize: '0.68rem' }}>
          —
        </Typography>
      );
    return (
      <a
        href={TX_SCAN_BASE[chain](hash)}
        target="_blank"
        rel="noopener noreferrer"
        style={{ color: theme.custom.cardanoBlue, textDecoration: 'none', fontSize: '0.68rem' }}
      >
        <code style={{ fontSize: '0.68rem' }}>{shortHash(hash)}</code>
        <OpenInNewIcon fontSize="inherit" sx={{ verticalAlign: 'text-bottom', ml: 0.25 }} />
      </a>
    );
  };

  return (
    <Stack spacing={2} sx={{ width: '100%' }}>
      {/* Page header — ContraClear panel style */}
      <Box
        sx={{
          borderRadius: 2,
          border: `1px solid ${theme.custom.borderSubtle}`,
          bgcolor: theme.custom.surface1,
          overflow: 'hidden',
        }}
      >
        <Stack
          direction="row"
          alignItems="center"
          spacing={1}
          sx={{
            px: 2,
            py: 1.5,
            borderBottom: `1px solid ${theme.custom.borderSubtle}`,
          }}
        >
          <Typography
            sx={{
              fontSize: '0.68rem',
              fontWeight: 600,
              textTransform: 'uppercase',
              letterSpacing: '0.06em',
              color: theme.custom.textMuted,
            }}
          >
            Settlement Monitor
          </Typography>
          <Box sx={{ flex: 1 }} />
          <Tooltip title="Refresh">
            <IconButton onClick={() => void refresh()} disabled={loading} size="small">
              <RefreshIcon sx={{ fontSize: 16 }} />
            </IconButton>
          </Tooltip>
        </Stack>

        <Box sx={{ p: 2 }}>
          <Typography sx={{ fontSize: '0.78rem', color: theme.custom.textSecondary }}>
            Every swap the orchestrator has indexed. Chain state is authoritative.
          </Typography>
        </Box>
      </Box>

      {error && (
        <Alert severity="error">
          Orchestrator unreachable: {error}
          <Typography variant="caption" component="div" sx={{ mt: 0.5, opacity: 0.75 }}>
            Start it: <code>cd htlc-orchestrator &amp;&amp; npm run dev</code>
          </Typography>
        </Alert>
      )}

      {loading && !swaps && (
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5}>
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} variant="rounded" height={100} sx={{ borderRadius: 2, flex: 1 }} />
          ))}
        </Stack>
      )}

      {aggregate && (
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: { xs: '1fr 1fr', md: '1fr 1fr 1fr 1fr' },
            gap: 1.5,
          }}
        >
          <MetricCard
            label="Total tracked"
            value={aggregate.total.toString()}
            hint={`${aggregate.totalUsdm.toString()} USDM · ${aggregate.totalUsdc.toString()} USDC`}
          />
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
            value={(
              aggregate.byStatus.open +
              aggregate.byStatus.bob_deposited +
              aggregate.byStatus.alice_claimed
            ).toString()}
            tone="primary"
            hint="open · deposited · claimed"
          />
          <MetricCard
            label="Needs reclaim"
            value={aggregate.stuck.toString()}
            tone={aggregate.stuck > 0 ? 'warning' : 'muted'}
            hint="deadline passed"
          />
        </Box>
      )}

      {aggregate && (
        <Box
          sx={{
            p: 1.5,
            borderRadius: 2,
            border: `1px solid ${theme.custom.borderSubtle}`,
            bgcolor: theme.custom.surface1,
          }}
        >
          <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap>
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
            borderRadius: 2,
            border: `1px solid ${theme.custom.borderSubtle}`,
            bgcolor: theme.custom.surface1,
            overflowX: 'auto',
          }}
        >
          <Table size="small" sx={{ minWidth: 1000 }}>
            <TableHead>
              <TableRow>
                <TableCell>Hash</TableCell>
                <TableCell>Dir</TableCell>
                <TableCell>Status</TableCell>
                <TableCell align="right">USDM</TableCell>
                <TableCell align="right">USDC</TableCell>
                <TableCell>Age</TableCell>
                <TableCell>Deadlines</TableCell>
                <TableCell>Cardano Lock</TableCell>
                <TableCell>Cardano Claim</TableCell>
                <TableCell>Midnight Deposit</TableCell>
                <TableCell>Midnight Claim</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {swaps.map((s) => (
                <TableRow key={s.hash} hover>
                  <TableCell>
                    <Typography sx={{ fontSize: '0.68rem' }}>
                      {shortHash(s.hash)}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <Chip size="small" variant="outlined" label={s.direction === 'usdm-usdc' ? 'M→U' : 'U→M'} />
                  </TableCell>
                  <TableCell>
                    <SwapStatusChip status={s.status} />
                  </TableCell>
                  <TableCell align="right">{s.usdmAmount}</TableCell>
                  <TableCell align="right">{s.usdcAmount}</TableCell>
                  <TableCell>{formatAge(s.createdAt)}</TableCell>
                  <TableCell>
                    <Stack spacing={0.25}>
                      {s.cardanoDeadlineMs !== null && (
                        <Typography sx={{ fontSize: '0.68rem' }}>
                          C:{' '}
                          {new Date(s.cardanoDeadlineMs).toLocaleString([], {
                            month: 'short',
                            day: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </Typography>
                      )}
                      {s.midnightDeadlineMs !== null && (
                        <Typography sx={{ fontSize: '0.68rem' }}>
                          M:{' '}
                          {new Date(s.midnightDeadlineMs).toLocaleString([], {
                            month: 'short',
                            day: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </Typography>
                      )}
                    </Stack>
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
            p: 5,
            borderRadius: 2,
            border: `1px dashed ${theme.custom.borderSubtle}`,
            textAlign: 'center',
            bgcolor: theme.custom.surface1,
          }}
        >
          <DatasetLinkedIcon sx={{ fontSize: 36, color: theme.custom.textMuted, mb: 1 }} />
          <Typography sx={{ fontWeight: 600, fontSize: '0.84rem', mb: 0.5 }}>No swaps tracked yet</Typography>
          <Typography sx={{ color: theme.custom.textSecondary, fontSize: '0.72rem' }}>
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
        p: 2,
        borderRadius: 2,
        border: `1px solid ${theme.custom.borderSubtle}`,
        bgcolor: theme.custom.surface1,
      }}
    >
      <Typography
        sx={{
          color: theme.custom.textMuted,
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
          fontWeight: 600,
          fontSize: '0.62rem',
        }}
      >
        {label}
      </Typography>
      <Typography sx={{ fontSize: '1.6rem', fontWeight: 600, color, lineHeight: 1.1, mt: 0.5 }}>{value}</Typography>
      {hint && (
        <Typography sx={{ color: theme.custom.textMuted, fontSize: '0.62rem', display: 'block', mt: 0.5 }}>
          {hint}
        </Typography>
      )}
    </Box>
  );
};
