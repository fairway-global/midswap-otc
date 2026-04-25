/**
 * SubmitQuoteModal — submit a fresh quote OR counter an existing quote.
 *
 * Per-deal wallet binding: at the moment of submit/counter, the actor must
 * have the wallet connected for the chain THEY will RECEIVE on. The modal
 * picks the right wallet based on (rfq.side, role), shows a guided
 * connect-wallet pill if it's not already connected, and snapshots the
 * connected wallet onto the quote. The originator's later lock/deposit
 * pre-fills counterparty inputs from this snapshot — no paste needed.
 */

import React, { useCallback, useMemo, useState } from 'react';
import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { alpha, useTheme, type Theme } from '@mui/material/styles';
import {
  otcApi,
  type Quote,
  type Rfq,
  type WalletSnapshot,
} from '../../api/orchestrator-client';
import { useAuth, useSwapContext } from '../../hooks';
import { useToast } from '../../hooks/useToast';

interface Props {
  open: boolean;
  onClose: () => void;
  rfq: Rfq;
  /** When set, this is a counter to a specific quote. */
  parentQuote?: Quote;
  onSubmitted: (quote: Quote) => void;
}

const sellSym = (rfq: Rfq) => (rfq.side === 'sell-usdm' ? 'USDM' : 'USDC');
const buySym = (rfq: Rfq) => (rfq.side === 'sell-usdm' ? 'USDC' : 'USDM');

/**
 * Which chain the actor receives on, given their role on this RFQ.
 *   originator on sell-usdm: receives USDC on Midnight
 *   originator on sell-usdc: receives USDM on Cardano
 *   counterparty on sell-usdm: receives USDM on Cardano
 *   counterparty on sell-usdc: receives USDC on Midnight
 */
const receiveChainFor = (
  side: Rfq['side'],
  role: 'originator' | 'counterparty',
): 'midnight' | 'cardano' => {
  if (role === 'originator') return side === 'sell-usdm' ? 'midnight' : 'cardano';
  return side === 'sell-usdm' ? 'cardano' : 'midnight';
};

const short = (s: string, head = 8, tail = 4): string =>
  s.length <= head + tail + 1 ? s : `${s.slice(0, head)}…${s.slice(-tail)}`;

export const SubmitQuoteModal: React.FC<Props> = ({
  open,
  onClose,
  rfq,
  parentQuote,
  onSubmitted,
}) => {
  const theme = useTheme();
  const toast = useToast();
  const { user } = useAuth();
  const { session, cardano, connecting, cardanoConnecting, connect, connectCardano } =
    useSwapContext();

  const isCounter = !!parentQuote;
  const [price, setPrice] = useState(parentQuote?.price ?? '1');
  const [buyAmount, setBuyAmount] = useState(parentQuote?.buyAmount ?? rfq.indicativeBuyAmount);
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const role: 'originator' | 'counterparty' =
    user && user.id === rfq.originatorId ? 'originator' : 'counterparty';
  const receiveChain = receiveChainFor(rfq.side, role);

  // Build the snapshot from whatever's connected RIGHT NOW. The modal
  // disables submit until the relevant wallet is present, so by the time
  // we read these in onConfirm, they exist.
  const walletSnapshot: WalletSnapshot | null = useMemo(() => {
    if (receiveChain === 'midnight') {
      if (!session) return null;
      return {
        midnightCpkBytes: session.bootstrap.coinPublicKeyHex,
        midnightUnshieldedBytes: session.bootstrap.unshieldedAddressHex,
        midnightCpkBech32: session.bootstrap.coinPublicKeyBech32m,
        midnightUnshieldedBech32: session.bootstrap.unshieldedAddressBech32m,
      };
    }
    if (!cardano) return null;
    return {
      cardanoPkh: cardano.paymentKeyHash,
      cardanoAddress: cardano.address,
    };
  }, [receiveChain, session, cardano]);

  const walletReady = !!walletSnapshot;
  const valid =
    /^\d+(\.\d+)?$/.test(price) &&
    /^\d+$/.test(buyAmount) &&
    BigInt(buyAmount) > 0n &&
    walletReady;

  const onConnectReceive = useCallback(async () => {
    try {
      if (receiveChain === 'midnight') await connect();
      else await connectCardano();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  }, [receiveChain, connect, connectCardano, toast]);

  const onConfirm = useCallback(async () => {
    if (!valid || !walletSnapshot || submitting) return;
    setSubmitting(true);
    try {
      const result = isCounter
        ? await otcApi.counterQuote({
            rfqId: rfq.id,
            parentQuoteId: parentQuote!.id,
            price,
            buyAmount,
            walletSnapshot,
            note: note || undefined,
          })
        : await otcApi.submitQuote({
            rfqId: rfq.id,
            price,
            buyAmount,
            walletSnapshot,
            note: note || undefined,
          });
      onSubmitted(result);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to submit');
    } finally {
      setSubmitting(false);
    }
  }, [valid, walletSnapshot, submitting, isCounter, rfq.id, parentQuote, price, buyAmount, note, onSubmitted, toast]);

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle
        sx={{
          fontFamily: 'JetBrains Mono, monospace',
          fontSize: '0.74rem',
          letterSpacing: '0.24em',
          textTransform: 'uppercase',
          color: theme.custom.textMuted,
          borderBottom: `1px solid ${theme.custom.borderSubtle}`,
          py: 2,
        }}
      >
        {isCounter ? `Counter · ${rfq.reference}` : `Submit quote · ${rfq.reference}`}
      </DialogTitle>
      <DialogContent sx={{ pt: 3 }}>
        <Stack spacing={2.5} sx={{ pt: 1 }}>
          <Box
            sx={{
              p: 2,
              border: `1px solid ${theme.custom.borderSubtle}`,
              borderRadius: 1.5,
              bgcolor: '#000',
            }}
          >
            <Typography
              sx={{
                fontFamily: 'JetBrains Mono, monospace',
                fontSize: '0.62rem',
                color: theme.custom.textMuted,
                letterSpacing: '0.16em',
                textTransform: 'uppercase',
              }}
            >
              {role === 'originator' ? 'Counter your own RFQ' : 'Originator wants'}
            </Typography>
            <Typography sx={{ mt: 0.5, fontFamily: 'JetBrains Mono, monospace', fontSize: '0.86rem' }}>
              Sell {rfq.sellAmount} {sellSym(rfq)} → ~{rfq.indicativeBuyAmount} {buySym(rfq)}
            </Typography>
          </Box>

          {/* Receive-wallet picker — required to capture the snapshot. */}
          <ReceiveWalletPicker
            theme={theme}
            chain={receiveChain}
            ready={walletReady}
            connecting={receiveChain === 'midnight' ? connecting : cardanoConnecting}
            displayAddress={
              receiveChain === 'midnight'
                ? session?.bootstrap.unshieldedAddressBech32m ?? ''
                : cardano?.address ?? ''
            }
            onConnect={() => void onConnectReceive()}
          />

          <Field label={`Price (${buySym(rfq)} per ${sellSym(rfq)})`}>
            <TextField fullWidth value={price} onChange={(e) => setPrice(e.target.value)} />
          </Field>
          <Field label={`You provide (${buySym(rfq)})`}>
            <TextField fullWidth value={buyAmount} onChange={(e) => setBuyAmount(e.target.value)} />
            <Typography
              sx={{
                mt: 0.5,
                fontSize: '0.66rem',
                color: theme.custom.textMuted,
                fontFamily: 'JetBrains Mono, monospace',
              }}
            >
              At settlement you will lock {buyAmount} {buySym(rfq)} and receive {rfq.sellAmount}{' '}
              {sellSym(rfq)}.
            </Typography>
          </Field>
          <Field label="Note (optional)">
            <TextField
              fullWidth
              multiline
              minRows={2}
              maxRows={4}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Any context for the counterparty…"
            />
          </Field>
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2.5 }}>
        <Button onClick={onClose}>Cancel</Button>
        <Button
          variant="contained"
          color="primary"
          disabled={!valid || submitting}
          onClick={() => void onConfirm()}
        >
          {submitting ? 'Submitting…' : isCounter ? 'Send counter' : 'Submit quote'}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

const Field: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => {
  const theme = useTheme();
  return (
    <Box>
      <Typography
        sx={{
          mb: 0.75,
          fontFamily: 'JetBrains Mono, monospace',
          fontSize: '0.62rem',
          letterSpacing: '0.16em',
          textTransform: 'uppercase',
          color: theme.custom.textMuted,
        }}
      >
        {label}
      </Typography>
      {children}
    </Box>
  );
};

const ReceiveWalletPicker: React.FC<{
  theme: Theme;
  chain: 'midnight' | 'cardano';
  ready: boolean;
  connecting: boolean;
  displayAddress: string;
  onConnect: () => void;
}> = ({ theme, chain, ready, connecting, displayAddress, onConnect }) => {
  const walletName = chain === 'midnight' ? '1AM' : 'Lace';
  const tokenName = chain === 'midnight' ? 'USDC' : 'USDM';
  const accent = chain === 'midnight' ? theme.custom.teal : theme.custom.bridgeCyan;
  return (
    <Box
      sx={{
        p: 2,
        borderRadius: 1.5,
        border: `1px solid ${ready ? alpha(accent, 0.4) : alpha(theme.custom.warning, 0.4)}`,
        bgcolor: ready ? alpha(accent, 0.06) : alpha(theme.custom.warning, 0.04),
      }}
    >
      <Stack direction="row" alignItems="center" spacing={1.25}>
        <Box
          sx={{
            width: 8,
            height: 8,
            borderRadius: '50%',
            bgcolor: ready ? accent : theme.custom.warning,
            boxShadow: ready ? `0 0 8px ${alpha(accent, 0.6)}` : undefined,
          }}
        />
        <Typography
          sx={{
            flex: 1,
            fontFamily: 'JetBrains Mono, monospace',
            fontSize: '0.62rem',
            letterSpacing: '0.16em',
            textTransform: 'uppercase',
            color: ready ? accent : theme.custom.warning,
          }}
        >
          {ready ? `${walletName} · receive ${tokenName}` : `Connect ${walletName} to receive ${tokenName}`}
        </Typography>
        {!ready && (
          <Button
            size="small"
            variant="outlined"
            disabled={connecting}
            onClick={onConnect}
            sx={{
              borderColor: alpha(theme.custom.warning, 0.5),
              color: theme.custom.warning,
              fontSize: '0.66rem',
              height: 26,
              '&:hover': {
                borderColor: theme.custom.warning,
                bgcolor: alpha(theme.custom.warning, 0.08),
              },
            }}
          >
            {connecting ? 'Connecting…' : `Connect ${walletName}`}
          </Button>
        )}
      </Stack>
      {ready && (
        <Typography
          sx={{
            mt: 1,
            fontFamily: 'JetBrains Mono, monospace',
            fontSize: '0.74rem',
            color: theme.custom.textPrimary,
            wordBreak: 'break-all',
          }}
        >
          {short(displayAddress, 14, 8)}
        </Typography>
      )}
      <Typography
        sx={{
          mt: 1,
          fontFamily: 'JetBrains Mono, monospace',
          fontSize: '0.62rem',
          color: theme.custom.textMuted,
          lineHeight: 1.5,
        }}
      >
        This is the wallet your {tokenName} will land in. The counterparty's lock binds to it.
        Use any wallet you like — it commits with this quote, not your account.
      </Typography>
    </Box>
  );
};
