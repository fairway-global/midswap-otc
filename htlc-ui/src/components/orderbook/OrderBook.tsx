/**
 * OrderBook — public surface listing all OTC RFQs.
 *
 *   Polls /api/rfqs every 3s while the tab is visible (document.visibilityState).
 *   "New Order" CTA opens CreateRfqModal — gated on logged-in + wallets bound.
 *   Anyone can browse; signed-out users still see the book and can sign in to act.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Box, Button, Stack, Tab, Tabs, Typography } from '@mui/material';
import { alpha, useTheme, type Theme } from '@mui/material/styles';
import { useNavigate } from 'react-router-dom';
import {
  otcApi,
  type Rfq,
  type RfqSide,
  type RfqStatus,
} from '../../api/orchestrator-client';
import { useAuth } from '../../hooks';
import { useToast } from '../../hooks/useToast';
import { CreateRfqModal } from './CreateRfqModal';
import { Panel, PanelHeader } from '../ui';
import { RfqStatusChip } from './RfqStatusChip';
import { ChainPair } from './ChainPair';

const POLL_MS = 3000;

const sideLabel = (s: RfqSide) => (s === 'sell-usdm' ? 'Sell USDM' : 'Sell USDC');
const formatRelative = (ts: number, now: number): string => {
  const dt = ts - now;
  const abs = Math.abs(dt);
  const s = Math.floor(abs / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  const d = Math.floor(h / 24);
  if (d > 0) return dt < 0 ? `${d}d ago` : `${d}d`;
  if (h > 0) return dt < 0 ? `${h}h ago` : `${h}h ${m % 60}m`;
  if (m > 0) return dt < 0 ? `${m}m ago` : `${m}m`;
  return dt < 0 ? `${s}s ago` : `${s}s`;
};

type Tab = 'open' | 'mine' | 'completed';

export const OrderBook: React.FC = () => {
  const theme = useTheme();
  const navigate = useNavigate();
  const toast = useToast();
  const { user } = useAuth();
  const [rfqs, setRfqs] = useState<Rfq[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>('open');
  const [createOpen, setCreateOpen] = useState(false);

  const fetchRfqs = useCallback(async (): Promise<void> => {
    try {
      const filter: { status?: RfqStatus; mine?: boolean } = {};
      if (tab === 'completed') filter.status = 'Settled';
      if (tab === 'mine') filter.mine = true;
      const { rfqs: next } = await otcApi.listRfqs(filter);
      setRfqs(next);
      setLoading(false);
    } catch (err) {
      console.warn('[orderbook] fetch failed', err);
      setLoading(false);
    }
  }, [tab]);

  useEffect(() => {
    void fetchRfqs();
    let active = document.visibilityState === 'visible';
    const tick = (): void => {
      if (active) void fetchRfqs();
    };
    const id = window.setInterval(tick, POLL_MS);
    const visListener = (): void => {
      active = document.visibilityState === 'visible';
      if (active) void fetchRfqs();
    };
    document.addEventListener('visibilitychange', visListener);
    return () => {
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', visListener);
    };
  }, [fetchRfqs]);

  const filtered = useMemo(() => {
    if (tab === 'open') {
      return rfqs.filter((r) => ['OpenForQuotes', 'Negotiating', 'QuoteSelected'].includes(r.status));
    }
    return rfqs;
  }, [rfqs, tab]);

  const onCreate = useCallback(() => {
    if (!user) {
      toast.info('Sign in to post an order.');
      void navigate('/login');
      return;
    }
    // No global wallet binding required — originator commits to a wallet
    // when they sign the lock/deposit on /swap. RFQ-create is just intent.
    setCreateOpen(true);
  }, [user, toast, navigate]);

  const now = Date.now();

  return (
    <Box sx={{ mx: 'auto', maxWidth: 1200, px: { xs: 2, md: 3 }, py: { xs: 4, md: 6 } }}>
      <Panel>
        <PanelHeader title="Order Book">
          <Button variant="contained" color="primary" size="small" onClick={onCreate}>
            New order
          </Button>
        </PanelHeader>

        <Tabs
          value={tab}
          onChange={(_e, v) => setTab(v as Tab)}
          sx={{
            px: 2,
            borderBottom: `1px solid ${theme.custom.borderSubtle}`,
            minHeight: 40,
            '.MuiTab-root': {
              fontFamily: 'JetBrains Mono, monospace',
              fontSize: '0.7rem',
              letterSpacing: '0.16em',
              textTransform: 'uppercase',
              minHeight: 40,
              py: 0.5,
              color: theme.custom.textMuted,
            },
            '.Mui-selected': { color: `${theme.custom.teal} !important` },
            '.MuiTabs-indicator': { bgcolor: theme.custom.teal, height: 2 },
          }}
        >
          <Tab value="open" label="Active" />
          <Tab value="mine" label="My orders" disabled={!user} />
          <Tab value="completed" label="Settled" />
        </Tabs>

        <Box sx={{ p: 0 }}>
          {loading ? (
            <EmptyRow text="Loading…" />
          ) : filtered.length === 0 ? (
            <EmptyRow text={tab === 'mine' ? 'You haven’t posted an order yet.' : 'No orders match this view.'} />
          ) : (
            <Box component="table" sx={tableSx(theme)}>
              <Box component="thead">
                <Box component="tr">
                  <Box component="th">Reference</Box>
                  <Box component="th">Pair</Box>
                  <Box component="th">Side</Box>
                  <Box component="th" sx={{ textAlign: 'right' }}>Sell</Box>
                  <Box component="th" sx={{ textAlign: 'right' }}>Indicative</Box>
                  <Box component="th">Originator</Box>
                  <Box component="th">Status</Box>
                  <Box component="th">Expires</Box>
                </Box>
              </Box>
              <Box component="tbody">
                {filtered.map((r) => (
                  <Box
                    key={r.id}
                    component="tr"
                    onClick={() => void navigate(`/rfq/${r.id}`)}
                    sx={{
                      cursor: 'pointer',
                      '&:hover': { bgcolor: alpha(theme.custom.teal, 0.04) },
                    }}
                  >
                    <Box component="td">
                      <Stack direction="row" spacing={1} alignItems="center">
                        <Typography sx={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '0.78rem' }}>
                          {r.reference}
                        </Typography>
                        {user?.id === r.originatorId && (
                          <Box
                            sx={{
                              fontSize: '0.55rem',
                              letterSpacing: '0.12em',
                              textTransform: 'uppercase',
                              color: theme.custom.teal,
                              border: `1px solid ${alpha(theme.custom.teal, 0.4)}`,
                              borderRadius: 0.5,
                              px: 0.5,
                              py: 0.1,
                            }}
                          >
                            yours
                          </Box>
                        )}
                      </Stack>
                    </Box>
                    <Box component="td"><ChainPair side={r.side} /></Box>
                    <Box component="td"><Typography sx={cellMonoSx}>{sideLabel(r.side)}</Typography></Box>
                    <Box component="td" sx={{ textAlign: 'right' }}>
                      <Typography sx={cellMonoSx}>{r.sellAmount}</Typography>
                    </Box>
                    <Box component="td" sx={{ textAlign: 'right' }}>
                      <Typography sx={cellMonoSx}>{r.indicativeBuyAmount}</Typography>
                    </Box>
                    <Box component="td">
                      <Typography sx={{ ...cellMonoSx, color: theme.custom.textSecondary }}>
                        {r.originatorName}
                      </Typography>
                    </Box>
                    <Box component="td"><RfqStatusChip status={r.status} /></Box>
                    <Box component="td">
                      <Typography sx={{ ...cellMonoSx, color: r.expiresAt < now ? theme.custom.danger : theme.custom.textMuted }}>
                        {formatRelative(r.expiresAt, now)}
                      </Typography>
                    </Box>
                  </Box>
                ))}
              </Box>
            </Box>
          )}
        </Box>
      </Panel>

      <CreateRfqModal open={createOpen} onClose={() => setCreateOpen(false)} onCreated={(rfq) => {
        setCreateOpen(false);
        toast.success(`Posted ${rfq.reference}`);
        void navigate(`/rfq/${rfq.id}`);
      }} />
    </Box>
  );
};

const cellMonoSx = {
  fontFamily: 'JetBrains Mono, monospace',
  fontSize: '0.78rem',
} as const;

const tableSx = (theme: Theme) => ({
  width: '100%',
  borderCollapse: 'collapse' as const,
  'th, td': {
    textAlign: 'left' as const,
    px: 2,
    py: 1.25,
    borderBottom: `1px solid ${theme.custom.borderSubtle}`,
  },
  th: {
    fontFamily: 'JetBrains Mono, monospace',
    fontSize: '0.6rem',
    letterSpacing: '0.16em',
    textTransform: 'uppercase' as const,
    color: theme.custom.textMuted,
    fontWeight: 600,
    py: 1,
  },
  'tbody tr:last-of-type td': { borderBottom: 'none' },
});

const EmptyRow: React.FC<{ text: string }> = ({ text }) => {
  const theme = useTheme();
  return (
    <Stack sx={{ py: 8, alignItems: 'center', gap: 1 }}>
      <Typography sx={{ fontFamily: 'JetBrains Mono, monospace', color: theme.custom.textMuted, fontSize: '0.78rem' }}>
        {text}
      </Typography>
    </Stack>
  );
};
