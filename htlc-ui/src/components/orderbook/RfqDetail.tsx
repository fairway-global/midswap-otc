/**
 * RfqDetail — full surface for one OTC order.
 *
 *   - Polls /api/rfqs/:id + /api/quotes/:rfqId + /api/activity/:rfqId every
 *     2s while the order is in an active state, 5s while Settling, stops at
 *     terminal states (Settled/Cancelled/Expired). Visibility-aware.
 *   - Per-viewer action set, derived from (rfq.originatorId, latest quote
 *     submitter, current user):
 *       * originator viewing a Submitted/Countered quote → Counter / Reject / Accept
 *       * any other signed-in user → Submit Quote panel
 *       * a quoter viewing the originator's counter on their own thread → Counter
 *   - When status === 'QuoteSelected' or 'Settling', a Settlement panel
 *     surfaces the accepted terms (Sell / Indicative / Offer), the
 *     counterparty's receive address, and an explicit "Lock" / "Deposit"
 *     button. NO auto-redirect to /swap — the originator and LP both stay
 *     on this page until they click through, so they can verify the deal
 *     before signing.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Box, Button, Stack, Typography } from '@mui/material';
import { alpha, useTheme } from '@mui/material/styles';
import { useNavigate, useParams } from 'react-router-dom';
import {
  otcApi,
  orchestratorClient,
  type Activity,
  type Quote,
  type Rfq,
} from '../../api/orchestrator-client';
import { composeShareUrlParams } from '../../api/swap-bridge';
import { useAuth } from '../../hooks';
import { useToast } from '../../hooks/useToast';
import { Panel, PanelHeader } from '../ui';
import { ChainPair } from './ChainPair';
import { RfqStatusChip, QuoteStatusChip } from './RfqStatusChip';
import { SubmitQuoteModal } from './SubmitQuoteModal';

const sellSym = (r: Rfq) => (r.side === 'sell-usdm' ? 'USDM' : 'USDC');
const buySym = (r: Rfq) => (r.side === 'sell-usdm' ? 'USDC' : 'USDM');

const pollIntervalForStatus = (status: Rfq['status'] | undefined): number | null => {
  if (!status) return null;
  if (['Settled', 'Cancelled', 'Expired'].includes(status)) return null;
  if (status === 'Settling') return 5000;
  return 2000;
};

const formatAge = (ts: number): string => {
  const ms = Date.now() - ts;
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m ago`;
};

export const RfqDetail: React.FC = () => {
  const theme = useTheme();
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const toast = useToast();
  const { user } = useAuth();
  const [rfq, setRfq] = useState<Rfq | null>(null);
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [activity, setActivity] = useState<Activity[]>([]);
  const [counterTarget, setCounterTarget] = useState<Quote | null>(null);
  const [submitOpen, setSubmitOpen] = useState(false);

  const isOriginator = !!(user && rfq && user.id === rfq.originatorId);
  const isSelectedProvider = !!(user && rfq && user.id === rfq.selectedProviderId);

  const fetchAll = useCallback(async () => {
    if (!id) return;
    try {
      const [r, qs, acts] = await Promise.all([
        otcApi.getRfq(id),
        otcApi.listQuotes(id),
        otcApi.listActivity(id),
      ]);
      setRfq(r);
      setQuotes(qs.quotes);
      setActivity(acts.activities);
    } catch (err) {
      console.warn('[rfq-detail] fetch failed', err);
    }
  }, [id]);

  useEffect(() => {
    void fetchAll();
  }, [fetchAll]);

  // Visibility-aware polling, interval depends on status.
  useEffect(() => {
    const interval = pollIntervalForStatus(rfq?.status);
    if (!interval) return;
    let active = document.visibilityState === 'visible';
    const tick = (): void => {
      if (active) void fetchAll();
    };
    const id = window.setInterval(tick, interval);
    const visListener = (): void => {
      active = document.visibilityState === 'visible';
      if (active) void fetchAll();
    };
    document.addEventListener('visibilitychange', visListener);
    return () => {
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', visListener);
    };
  }, [rfq?.status, fetchAll]);

  // Manual settlement actions — replaces previous auto-redirects.
  // Originator clicks "Lock" → navigate to /swap?rfqId=…
  // LP clicks "Deposit" → fetch swap, compose share URL, navigate to /app
  // (so the existing taker reducer hydrates from URL params as before).
  const onOriginatorLock = useCallback(() => {
    if (!rfq) return;
    void navigate(`/swap?rfqId=${rfq.id}`);
  }, [rfq, navigate]);

  const onLpDeposit = useCallback(async () => {
    if (!rfq?.swapHash) return;
    try {
      const swap = await orchestratorClient.getSwap(rfq.swapHash);
      const params = composeShareUrlParams(rfq, swap);
      void navigate(`/app?${params.toString()}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not load swap row');
    }
  }, [rfq, navigate, toast]);

  const canRecoverSettlement =
    !!rfq &&
    ((isOriginator && (rfq.status === 'QuoteSelected' || rfq.status === 'Settling')) ||
      (isSelectedProvider && rfq.status === 'Settling' && !!rfq.swapHash));

  const onRecoverSettlement = useCallback(() => {
    if (!rfq) return;
    if (isOriginator) {
      onOriginatorLock();
      return;
    }
    if (isSelectedProvider && rfq.swapHash) {
      void onLpDeposit();
    }
  }, [rfq, isOriginator, isSelectedProvider, onOriginatorLock, onLpDeposit]);

  const onAccept = useCallback(
    async (quote: Quote) => {
      if (!rfq) return;
      try {
        await otcApi.acceptQuote(rfq.id, quote.id);
        toast.success('Quote accepted — preparing settlement…');
        await fetchAll();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Accept failed');
      }
    },
    [rfq, toast, fetchAll],
  );

  const onReject = useCallback(
    async (quote: Quote) => {
      if (!rfq) return;
      try {
        await otcApi.rejectQuote(rfq.id, quote.id);
        toast.info('Quote rejected');
        await fetchAll();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Reject failed');
      }
    },
    [rfq, toast, fetchAll],
  );

  const onCancelOrder = useCallback(async () => {
    if (!rfq) return;
    try {
      await otcApi.cancelRfq(rfq.id);
      toast.info('Order cancelled');
      await fetchAll();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Cancel failed');
    }
  }, [rfq, toast, fetchAll]);

  // Group quotes into threads — one thread per provider, ordered by version chain.
  const threadsByProvider = useMemo(() => {
    const map = new Map<string, Quote[]>();
    for (const q of quotes) {
      if (!map.has(q.providerId)) map.set(q.providerId, []);
      map.get(q.providerId)!.push(q);
    }
    for (const arr of map.values()) arr.sort((a, b) => a.version - b.version);
    return map;
  }, [quotes]);

  const myThread = user ? threadsByProvider.get(user.id) : undefined;
  const myActiveQuote = myThread?.findLast?.((q) =>
    !['Accepted', 'Rejected', 'Expired'].includes(q.status),
  ) ?? (myThread ? [...myThread].reverse().find((q) =>
    !['Accepted', 'Rejected', 'Expired'].includes(q.status),
  ) : undefined);

  const canSubmitQuote =
    !!user &&
    !isOriginator &&
    !!rfq &&
    ['OpenForQuotes', 'Negotiating'].includes(rfq.status) &&
    !myActiveQuote;

  if (!rfq) {
    return (
      <Box sx={{ mx: 'auto', maxWidth: 1100, px: 2, py: 6, color: theme.custom.textMuted }}>
        Loading order…
      </Box>
    );
  }

  return (
    <Box
      sx={{
        mx: 'auto',
        maxWidth: 1180,
        px: { xs: 2, md: 3 },
        py: { xs: 4, md: 6 },
        display: 'grid',
        gap: 3,
        gridTemplateColumns: { xs: '1fr', lg: 'minmax(0, 1fr) 320px' },
      }}
    >
      <Stack spacing={3}>
        {/* RFQ header */}
        <Panel>
          <Box sx={{ p: 3 }}>
            <Stack direction="row" alignItems="center" spacing={1.25}>
              <Typography
                sx={{
                  fontFamily: 'JetBrains Mono, monospace',
                  fontSize: '0.7rem',
                  letterSpacing: '0.24em',
                  textTransform: 'uppercase',
                  color: theme.custom.textMuted,
                }}
              >
                {rfq.reference}
              </Typography>
              <RfqStatusChip status={rfq.status} />
              <Box sx={{ flex: 1 }} />
              {canRecoverSettlement && (
                <Button size="small" variant="outlined" color="primary" onClick={onRecoverSettlement}>
                  Resume settlement
                </Button>
              )}
              {isOriginator && ['OpenForQuotes', 'Negotiating'].includes(rfq.status) && (
                <Button
                  size="small"
                  onClick={() => void onCancelOrder()}
                  sx={{ color: theme.custom.textMuted, '&:hover': { color: theme.custom.danger } }}
                >
                  Cancel order
                </Button>
              )}
            </Stack>

            <Stack direction="row" spacing={2} alignItems="center" sx={{ mt: 2 }}>
              <ChainPair side={rfq.side} />
              <Typography variant="h5" sx={{ fontFamily: 'Inter, sans-serif' }}>
                {rfq.sellAmount} {sellSym(rfq)} → ~{rfq.indicativeBuyAmount} {buySym(rfq)}
              </Typography>
            </Stack>

            <Stack direction="row" spacing={3} sx={{ mt: 3, color: theme.custom.textMuted }}>
              <Stat label="Originator" value={rfq.originatorName} />
              <Stat label="Provider" value={rfq.selectedProviderName ?? '—'} />
              <Stat label="Accepted price" value={rfq.acceptedPrice ?? '—'} />
            </Stack>
          </Box>
        </Panel>

        {/* Quotes */}
        <Panel>
          <PanelHeader title="Quotes" subtitle={`${quotes.length} version${quotes.length === 1 ? '' : 's'}`}>
            {canSubmitQuote && (
              <Button variant="contained" color="primary" size="small" onClick={() => setSubmitOpen(true)}>
                Submit quote
              </Button>
            )}
          </PanelHeader>
          <Stack divider={<Box sx={{ borderTop: `1px solid ${theme.custom.borderSubtle}` }} />}>
            {quotes.length === 0 ? (
              <Box sx={{ p: 4, textAlign: 'center', color: theme.custom.textMuted, fontFamily: 'JetBrains Mono, monospace', fontSize: '0.78rem' }}>
                {isOriginator
                  ? 'No quotes yet. Counterparties will appear here as they respond.'
                  : 'Be the first to quote on this order.'}
              </Box>
            ) : (
              [...threadsByProvider.entries()].map(([providerId, thread]) => {
                const latest = thread[thread.length - 1];
                const myThread = user?.id === providerId;
                return (
                  <Box key={providerId} sx={{ p: 2 }}>
                    <Stack direction="row" alignItems="center" spacing={1.5} sx={{ mb: 1 }}>
                      <Typography sx={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '0.84rem', fontWeight: 600 }}>
                        {latest.providerName}
                      </Typography>
                      {myThread && (
                        <Box
                          sx={{
                            fontSize: '0.55rem',
                            letterSpacing: '0.12em',
                            textTransform: 'uppercase',
                            color: theme.custom.teal,
                            border: `1px solid ${alpha(theme.custom.teal, 0.4)}`,
                            borderRadius: 0.5,
                            px: 0.5,
                          }}
                        >
                          you
                        </Box>
                      )}
                      <Box sx={{ flex: 1 }} />
                      <QuoteStatusChip status={latest.status} />
                    </Stack>

                    {/* Version chain */}
                    <Stack spacing={1} sx={{ pl: 0 }}>
                      {thread.map((q) => (
                        <Box
                          key={q.id}
                          sx={{
                            border: `1px solid ${theme.custom.borderSubtle}`,
                            borderRadius: 1.5,
                            p: 1.5,
                            bgcolor: q.id === latest.id ? alpha(theme.custom.teal, 0.04) : 'transparent',
                          }}
                        >
                          <Stack direction="row" alignItems="center" spacing={1.5}>
                            <Typography sx={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '0.6rem', color: theme.custom.textMuted, letterSpacing: '0.12em' }}>
                              v{q.version}
                            </Typography>
                            <Typography sx={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '0.78rem', flex: 1 }}>
                              {q.buyAmount} {buySym(rfq)}{' '}
                              <Box component="span" sx={{ color: theme.custom.textMuted }}>
                                @ {q.price}
                              </Box>
                            </Typography>
                            <Typography sx={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '0.6rem', color: theme.custom.textMuted }}>
                              {q.submittedByName}
                            </Typography>
                            <Typography sx={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '0.6rem', color: theme.custom.textMuted }}>
                              {formatAge(q.createdAt)}
                            </Typography>
                          </Stack>
                          {q.note && (
                            <Typography sx={{ mt: 0.75, fontSize: '0.7rem', color: theme.custom.textSecondary, fontStyle: 'italic' }}>
                              "{q.note}"
                            </Typography>
                          )}
                        </Box>
                      ))}
                    </Stack>

                    {/* Action row for the latest quote in this thread */}
                    {latest.status === 'Submitted' || latest.status === 'Countered' ? (
                      <Stack direction="row" spacing={1} sx={{ mt: 1.5, justifyContent: 'flex-end' }}>
                        {/* Originator can counter / reject / accept any quote */}
                        {isOriginator && (
                          <>
                            <Button size="small" onClick={() => void onReject(latest)} sx={{ color: theme.custom.textMuted, '&:hover': { color: theme.custom.danger } }}>
                              Reject
                            </Button>
                            <Button size="small" variant="outlined" onClick={() => setCounterTarget(latest)}>
                              Counter
                            </Button>
                            <Button size="small" variant="contained" color="primary" onClick={() => void onAccept(latest)}>
                              Accept
                            </Button>
                          </>
                        )}
                        {/* The quoter on their own thread can counter the originator's response */}
                        {!isOriginator && myThread && latest.submittedByUserId !== user?.id && (
                          <Button size="small" variant="outlined" onClick={() => setCounterTarget(latest)}>
                            Counter
                          </Button>
                        )}
                      </Stack>
                    ) : null}
                  </Box>
                );
              })
            )}
          </Stack>
        </Panel>

        {/* Settlement panel — visible from QuoteSelected through Settling.
            Shows the accepted terms, the counterparty's receive address, and
            a single explicit action (Lock / Deposit) so the user signs only
            after they've eyeballed the deal. */}
        {(rfq.status === 'QuoteSelected' || rfq.status === 'Settling') && (
          <SettlementPanel
            rfq={rfq}
            quotes={quotes}
            isOriginator={isOriginator}
            isSelectedProvider={isSelectedProvider}
            onLock={onOriginatorLock}
            onDeposit={onLpDeposit}
          />
        )}
      </Stack>

      {/* Activity sidebar */}
      <Panel>
        <PanelHeader title="Activity" />
        <Stack divider={<Box sx={{ borderTop: `1px solid ${theme.custom.borderSubtle}` }} />}>
          {activity.length === 0 ? (
            <Box sx={{ p: 3, color: theme.custom.textMuted, fontSize: '0.74rem', fontFamily: 'JetBrains Mono, monospace' }}>
              No activity yet.
            </Box>
          ) : (
            [...activity].reverse().map((a) => (
              <Box key={a.id} sx={{ p: 2 }}>
                <Typography sx={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '0.6rem', letterSpacing: '0.12em', textTransform: 'uppercase', color: theme.custom.teal }}>
                  {a.type.replace(/_/g, ' ')}
                </Typography>
                <Typography sx={{ mt: 0.5, fontSize: '0.74rem', color: theme.custom.textPrimary, fontFamily: 'JetBrains Mono, monospace' }}>
                  {a.summary}
                </Typography>
                <Typography sx={{ mt: 0.25, fontSize: '0.6rem', color: theme.custom.textMuted, fontFamily: 'JetBrains Mono, monospace' }}>
                  {a.actorName} · {formatAge(a.createdAt)}
                </Typography>
              </Box>
            ))
          )}
        </Stack>
      </Panel>

      <SubmitQuoteModal
        open={submitOpen}
        onClose={() => setSubmitOpen(false)}
        rfq={rfq}
        onSubmitted={(q) => {
          setSubmitOpen(false);
          toast.success(`Quote v${q.version} submitted`);
          void fetchAll();
        }}
      />
      <SubmitQuoteModal
        open={!!counterTarget}
        onClose={() => setCounterTarget(null)}
        rfq={rfq}
        parentQuote={counterTarget ?? undefined}
        onSubmitted={(q) => {
          setCounterTarget(null);
          toast.success(`Counter v${q.version} sent`);
          void fetchAll();
        }}
      />
    </Box>
  );
};

const Stat: React.FC<{ label: string; value: string }> = ({ label, value }) => {
  const theme = useTheme();
  return (
    <Stack>
      <Typography sx={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '0.6rem', letterSpacing: '0.12em', textTransform: 'uppercase', color: theme.custom.textMuted }}>
        {label}
      </Typography>
      <Typography sx={{ mt: 0.25, fontFamily: 'JetBrains Mono, monospace', fontSize: '0.78rem', color: theme.custom.textPrimary }}>
        {value}
      </Typography>
    </Stack>
  );
};

const shortAddr = (s: string, head = 14, tail = 8): string =>
  s.length <= head + tail + 1 ? s : `${s.slice(0, head)}…${s.slice(-tail)}`;

interface SettlementPanelProps {
  rfq: Rfq;
  quotes: Quote[];
  isOriginator: boolean;
  isSelectedProvider: boolean;
  onLock: () => void;
  onDeposit: () => void;
}

const SettlementPanel: React.FC<SettlementPanelProps> = ({
  rfq,
  quotes,
  isOriginator,
  isSelectedProvider,
  onLock,
  onDeposit,
}) => {
  const theme = useTheme();
  const sellSymbol = rfq.side === 'sell-usdm' ? 'USDM' : 'USDC';
  const buySymbol = rfq.side === 'sell-usdm' ? 'USDC' : 'USDM';

  // The accepted offer = the buyAmount on the chosen quote (NOT the indicative).
  // Falls back to indicative if the quote isn't visible to the viewer (e.g. an
  // LP browsing someone else's RFQ has limited quote visibility).
  const acceptedQuote = quotes.find((q) => q.id === rfq.selectedQuoteId);
  const offerAmount = acceptedQuote?.buyAmount ?? rfq.indicativeBuyAmount;

  // The counterparty's RECEIVE address — what the originator's outgoing tokens
  // bind to. Forward (sell-usdm): provider's Cardano address. Reverse
  // (sell-usdc): provider's Midnight unshielded.
  const provider = rfq.providerWalletSnapshot ?? acceptedQuote?.walletSnapshot;
  const receiveChainLabel = rfq.side === 'sell-usdm' ? 'Cardano' : 'Midnight';
  const receiverAddress =
    rfq.side === 'sell-usdm'
      ? provider?.cardanoAddress
      : provider?.midnightUnshieldedBech32;

  const swapReady = rfq.status === 'Settling' && !!rfq.swapHash;

  const heading =
    isOriginator
      ? swapReady
        ? 'Settlement in flight'
        : 'Both parties agreed — your turn to lock'
      : isSelectedProvider
        ? swapReady
          ? 'Maker has locked — your turn to deposit'
          : 'Awaiting maker to lock first'
        : 'Settlement in progress between maker and counterparty';

  return (
    <Panel>
      <Box sx={{ p: 3 }}>
        <Typography
          sx={{
            fontFamily: 'JetBrains Mono, monospace',
            fontSize: '0.66rem',
            letterSpacing: '0.16em',
            textTransform: 'uppercase',
            color: theme.custom.bridgeCyan,
          }}
        >
          Settlement
        </Typography>
        <Typography
          sx={{
            mt: 1,
            fontFamily: 'Inter, sans-serif',
            fontSize: '1rem',
            color: theme.custom.textPrimary,
          }}
        >
          {heading}
        </Typography>

        {/* Accepted terms — three labeled stats so the user can verify before signing. */}
        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          spacing={1.5}
          sx={{ mt: 2.5 }}
        >
          <SettlementStat label="Sell" value={`${rfq.sellAmount} ${sellSymbol}`} />
          <SettlementStat
            label="Indicative"
            value={`${rfq.indicativeBuyAmount} ${buySymbol}`}
            tone="muted"
          />
          <SettlementStat
            label="Offer (accepted)"
            value={`${offerAmount} ${buySymbol}`}
            tone="accent"
          />
        </Stack>

        {/* Counterparty's receive address — auto-filled from the snapshot
            captured at quote-accept time. The originator's lock binds to this. */}
        {(isOriginator || isSelectedProvider) && receiverAddress && (
          <Box
            sx={{
              mt: 2,
              p: 1.5,
              borderRadius: 1.5,
              border: `1px solid ${theme.custom.borderSubtle}`,
              bgcolor: '#000',
            }}
          >
            <Typography
              sx={{
                fontFamily: 'JetBrains Mono, monospace',
                fontSize: '0.6rem',
                letterSpacing: '0.16em',
                textTransform: 'uppercase',
                color: theme.custom.textMuted,
              }}
            >
              {isOriginator
                ? `Receiver — counterparty's ${receiveChainLabel} address`
                : `Your ${receiveChainLabel} address — settlement lands here`}
            </Typography>
            <Typography
              sx={{
                mt: 0.5,
                fontFamily: 'JetBrains Mono, monospace',
                fontSize: '0.78rem',
                color: theme.custom.textPrimary,
                wordBreak: 'break-all',
              }}
            >
              {receiverAddress}
            </Typography>
          </Box>
        )}

        {/* Action button. Lock for originator; Deposit for LP (only after
            maker locks and the swap row exists). Other viewers see no action. */}
        <Stack direction="row" spacing={1} sx={{ mt: 2, alignItems: 'center' }}>
          {isOriginator && rfq.status === 'QuoteSelected' && (
            <Button variant="contained" color="primary" onClick={onLock}>
              Lock {sellSymbol}
            </Button>
          )}
          {isOriginator && rfq.status === 'Settling' && (
            <Button variant="outlined" color="primary" onClick={onLock}>
              Resume locking
            </Button>
          )}
          {isSelectedProvider && rfq.status === 'QuoteSelected' && (
            <Button variant="outlined" disabled>
              Awaiting maker…
            </Button>
          )}
          {isSelectedProvider && swapReady && (
            <Button variant="contained" color="primary" onClick={() => void onDeposit()}>
              Deposit {buySymbol}
            </Button>
          )}

          <Typography
            sx={{
              ml: 'auto',
              fontFamily: 'JetBrains Mono, monospace',
              fontSize: '0.62rem',
              color: theme.custom.textMuted,
            }}
          >
            {isOriginator
              ? 'You sign on Midnight + Cardano · counterparty auto-routes in'
              : isSelectedProvider
                ? 'You sign on Midnight + Cardano · settlement is atomic'
                : ''}
          </Typography>
        </Stack>
      </Box>
    </Panel>
  );
};

const SettlementStat: React.FC<{
  label: string;
  value: string;
  tone?: 'muted' | 'accent';
}> = ({ label, value, tone }) => {
  const theme = useTheme();
  const accent = tone === 'accent';
  const muted = tone === 'muted';
  return (
    <Box
      sx={{
        flex: 1,
        p: 1.5,
        borderRadius: 1.5,
        border: `1px solid ${accent ? alpha(theme.custom.teal, 0.3) : theme.custom.borderSubtle}`,
        bgcolor: accent ? alpha(theme.custom.teal, 0.06) : '#000',
      }}
    >
      <Typography
        sx={{
          fontFamily: 'JetBrains Mono, monospace',
          fontSize: '0.6rem',
          letterSpacing: '0.16em',
          textTransform: 'uppercase',
          color: accent ? theme.custom.teal : theme.custom.textMuted,
        }}
      >
        {label}
      </Typography>
      <Typography
        sx={{
          mt: 0.5,
          fontFamily: 'JetBrains Mono, monospace',
          fontSize: '1rem',
          fontWeight: 600,
          color: muted ? theme.custom.textMuted : theme.custom.textPrimary,
        }}
      >
        {value}
      </Typography>
    </Box>
  );
};
