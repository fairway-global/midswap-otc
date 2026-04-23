/**
 * /browse — open offer marketplace. Lists every open swap in the orchestrator
 * DB with filters for "targets your wallet" vs "any wallet". Each row is an
 * offer card with the amounts, deadline, and a Take button.
 *
 * IMPORTANT: Each Cardano HTLC is locked on-chain to a specific receiver PKH
 * the maker chose. An offer targeting a different PKH than yours cannot be
 * claimed by you — we surface that up-front rather than letting you try.
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
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
} from '@mui/material';
import RefreshIcon from '@mui/icons-material/Refresh';
import SwapHorizIcon from '@mui/icons-material/SwapHoriz';
import AccessTimeIcon from '@mui/icons-material/AccessTime';
import InboxIcon from '@mui/icons-material/Inbox';
import { alpha, useTheme } from '@mui/material/styles';
import { useNavigate } from 'react-router-dom';
import { orchestratorClient, type Swap } from '../api/orchestrator-client';
import { useSwapContext } from '../hooks';
import { limits } from '../config/limits';
import { TokenBadge } from './swap/TokenBadge';
import { ADA, USDC } from './swap/tokens';

const formatRemaining = (deadlineMs: number): string => {
  const remSecs = Math.floor((deadlineMs - Date.now()) / 1000);
  if (remSecs <= 0) return 'expired';
  const mins = Math.floor(remSecs / 60);
  if (mins < 60) return `${mins}m left`;
  const hours = Math.floor(mins / 60);
  return `${hours}h ${mins % 60}m left`;
};

type Filter = 'mine' | 'all';

export const Browse: React.FC = () => {
  const navigate = useNavigate();
  const theme = useTheme();
  const { cardano, session } = useSwapContext();
  const [swaps, setSwaps] = useState<Swap[] | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState<Filter>('all');

  const myPkh = cardano?.paymentKeyHash?.toLowerCase();
  const myCpk = session?.bootstrap.coinPublicKeyHex?.toLowerCase();

  const refresh = useCallback(async () => {
    setError(undefined);
    setLoading(true);
    try {
      const { swaps: list } = await orchestratorClient.listSwaps('open');
      setSwaps(list);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const id = setInterval(() => void refresh(), 10_000);
    return () => clearInterval(id);
  }, [refresh]);

  const { visible, ownCount } = useMemo(() => {
    if (!swaps) return { visible: undefined as Swap[] | undefined, ownCount: 0 };
    const notMine = swaps.filter((s) => !myCpk || s.aliceCpk.toLowerCase() !== myCpk);
    const own = swaps.length - notMine.length;
    let list = notMine;
    if (filter === 'mine' && myPkh) {
      list = notMine.filter((s) => s.bobPkh?.toLowerCase() === myPkh);
    }
    return { visible: list, ownCount: own };
  }, [swaps, myCpk, myPkh, filter]);

  const onTake = useCallback(
    (swap: Swap) => {
      const params = new URLSearchParams({
        role: 'bob',
        hash: swap.hash,
        aliceCpk: swap.aliceCpk,
        aliceUnshielded: swap.aliceUnshielded,
        cardanoDeadlineMs: swap.cardanoDeadlineMs.toString(),
        adaAmount: swap.adaAmount,
        usdcAmount: swap.usdcAmount,
      });
      navigate(`/?${params.toString()}`);
    },
    [navigate],
  );

  return (
    <Stack spacing={3} sx={{ width: '100%', maxWidth: 860, mx: 'auto' }}>
      <Stack direction="row" spacing={2} alignItems="center" flexWrap="wrap" useFlexGap>
        <Stack spacing={0.25} sx={{ flex: 1, minWidth: 200 }}>
          <Typography variant="h4">Open offers</Typography>
          <Typography variant="body2" sx={{ color: theme.custom.textSecondary }}>
            Locks posted by makers, waiting for a taker to accept.
          </Typography>
        </Stack>
        <ToggleButtonGroup
          size="small"
          value={filter}
          exclusive
          onChange={(_, v: Filter | null) => v && setFilter(v)}
          sx={{
            bgcolor: theme.custom.surface2,
            borderRadius: 999,
            p: 0.5,
            '& .MuiToggleButton-root': {
              border: 0,
              borderRadius: '999px !important',
              px: 1.75,
              py: 0.5,
              color: theme.custom.textSecondary,
              fontWeight: 500,
              textTransform: 'none',
              '&.Mui-selected': {
                bgcolor: theme.custom.surface3,
                color: theme.custom.textPrimary,
              },
            },
          }}
        >
          <ToggleButton value="all">All</ToggleButton>
          <ToggleButton value="mine" disabled={!myPkh}>
            For my wallet
          </ToggleButton>
        </ToggleButtonGroup>
        <Tooltip title="Refresh">
          <IconButton onClick={() => void refresh()} disabled={loading}>
            <RefreshIcon />
          </IconButton>
        </Tooltip>
      </Stack>

      {!cardano && (
        <Alert severity="info">
          Connect your Cardano wallet so Midswap can tell you which offers target your PKH.
        </Alert>
      )}

      {error && (
        <Alert severity="error">
          Orchestrator unreachable: {error}
          <Typography variant="caption" component="div" sx={{ mt: 0.5, opacity: 0.7 }}>
            Start it: <code>cd htlc-orchestrator &amp;&amp; npm run dev</code>
          </Typography>
        </Alert>
      )}

      {ownCount > 0 && (
        <Alert severity="info" sx={{ bgcolor: alpha(theme.custom.cardanoBlue, 0.08) }}>
          {ownCount === 1
            ? 'Your own open offer is hidden — manage it on the Swap page.'
            : `${ownCount} of your own open offers are hidden — manage them on the Swap page.`}
        </Alert>
      )}

      {loading && !swaps && (
        <Stack spacing={1.5}>
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} variant="rounded" height={118} sx={{ borderRadius: 4 }} />
          ))}
        </Stack>
      )}

      {visible && visible.length === 0 && (
        <Box
          sx={{
            p: 6,
            borderRadius: 4,
            border: `1px dashed ${theme.custom.borderSubtle}`,
            bgcolor: theme.custom.surface1,
            textAlign: 'center',
          }}
        >
          <InboxIcon sx={{ fontSize: 44, color: theme.custom.textMuted, mb: 1 }} />
          <Typography sx={{ fontWeight: 600, mb: 0.5 }}>
            {filter === 'mine' ? 'No offers addressed to your wallet' : 'No open offers right now'}
          </Typography>
          <Typography variant="body2" sx={{ color: theme.custom.textSecondary, mb: 2 }}>
            Offers expire fast on preprod — check back in a minute, or make one yourself.
          </Typography>
          <Button variant="contained" color="primary" onClick={() => navigate('/')}>
            Make an offer
          </Button>
        </Box>
      )}

      <Stack spacing={1.5}>
        {visible?.map((swap) => (
          <OfferCard key={swap.hash} swap={swap} myPkh={myPkh} onTake={onTake} />
        ))}
      </Stack>
    </Stack>
  );
};

const OfferCard: React.FC<{ swap: Swap; myPkh?: string; onTake: (s: Swap) => void }> = ({ swap, myPkh, onTake }) => {
  const theme = useTheme();
  const remaining = swap.cardanoDeadlineMs - Date.now();
  const expired = remaining <= 0;
  const unsafe = !expired && remaining < limits.browseMinRemainingSecs * 1000;
  const targetPkh = swap.bobPkh?.toLowerCase();
  const missingPkh = !targetPkh;
  const walletMismatch = !!(myPkh && targetPkh && myPkh !== targetPkh);
  const walletMatches = !!(myPkh && targetPkh && myPkh === targetPkh);
  const canTake = walletMatches && !expired && !unsafe;

  return (
    <Box
      sx={{
        p: 2.5,
        borderRadius: 4,
        border: `1px solid ${walletMatches ? alpha(theme.custom.cardanoBlue, 0.3) : theme.custom.borderSubtle}`,
        bgcolor: walletMatches ? alpha(theme.custom.cardanoBlue, 0.04) : theme.custom.surface1,
        transition: 'border-color 140ms ease',
      }}
    >
      <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} alignItems={{ md: 'center' }}>
        <Stack direction="row" spacing={1.5} alignItems="center" sx={{ flex: 1 }}>
          <Stack direction="row" spacing={-0.75}>
            <TokenBadge token={ADA} size={34} />
            <Box sx={{ transform: 'translateX(-10px)' }}>
              <TokenBadge token={USDC} size={34} />
            </Box>
          </Stack>
          <Stack>
            <Stack direction="row" spacing={1} alignItems="center">
              <Typography sx={{ fontWeight: 600 }}>
                {swap.adaAmount} ADA → {swap.usdcAmount} USDC
              </Typography>
            </Stack>
            <Stack direction="row" spacing={0.75} alignItems="center" sx={{ mt: 0.25 }}>
              <AccessTimeIcon sx={{ fontSize: 13, color: theme.custom.textMuted }} />
              <Typography variant="caption" sx={{ color: theme.custom.textSecondary }}>
                {expired ? 'expired' : formatRemaining(swap.cardanoDeadlineMs)} ·{' '}
                {new Date(swap.cardanoDeadlineMs).toLocaleString()}
              </Typography>
            </Stack>
          </Stack>
        </Stack>

        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
          {expired && <Chip size="small" color="error" label="Expired" />}
          {!expired && unsafe && <Chip size="small" color="warning" label="Too little time" />}
          {walletMatches && <Chip size="small" color="success" label="Your wallet" />}
          {walletMismatch && <Chip size="small" color="error" label="Different wallet" />}
          {missingPkh && <Chip size="small" color="warning" label="Legacy — no PKH" />}
        </Stack>

        <Button
          variant="contained"
          color="primary"
          disabled={!canTake}
          onClick={() => onTake(swap)}
          sx={{ minWidth: 120 }}
        >
          <SwapHorizIcon fontSize="small" sx={{ mr: 0.75 }} />
          {!myPkh
            ? 'Connect to take'
            : walletMismatch
              ? 'Not you'
              : expired
                ? 'Expired'
                : unsafe
                  ? 'Too late'
                  : 'Take offer'}
        </Button>
      </Stack>

      {walletMismatch && (
        <Alert severity="warning" sx={{ mt: 1.5 }}>
          This offer is locked on-chain to a different Cardano wallet. Only that wallet can claim the ADA. Ask the maker
          to re-post with your PKH.
        </Alert>
      )}
      {missingPkh && !walletMismatch && (
        <Alert severity="info" sx={{ mt: 1.5 }}>
          Legacy offer — no intended receiver PKH recorded. Use the maker&apos;s share URL instead.
        </Alert>
      )}

      <Typography
        variant="caption"
        sx={{
          display: 'block',
          mt: 1.5,
          fontFamily: 'JetBrains Mono, monospace',
          fontSize: 11,
          color: theme.custom.textMuted,
          wordBreak: 'break-all',
        }}
      >
        Hash: {swap.hash}
      </Typography>
    </Box>
  );
};
