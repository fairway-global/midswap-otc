/**
 * CreateRfqModal — originator picks side + amounts + expiry, posts an order.
 */

import React, { useState } from 'react';
import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { alpha, useTheme } from '@mui/material/styles';
import { otcApi, type Rfq, type RfqSide } from '../../api/orchestrator-client';
import { useToast } from '../../hooks/useToast';

const EXPIRY_OPTIONS: Array<{ label: string; seconds: number }> = [
  { label: '15 minutes', seconds: 900 },
  { label: '1 hour', seconds: 3600 },
  { label: '4 hours', seconds: 4 * 3600 },
  { label: '12 hours', seconds: 12 * 3600 },
  { label: '24 hours', seconds: 24 * 3600 },
];

interface Props {
  open: boolean;
  onClose: () => void;
  onCreated: (rfq: Rfq) => void;
}

export const CreateRfqModal: React.FC<Props> = ({ open, onClose, onCreated }) => {
  const theme = useTheme();
  const toast = useToast();
  const [side, setSide] = useState<RfqSide>('sell-usdm');
  const [sellAmount, setSellAmount] = useState('100');
  const [indicativeBuyAmount, setIndicativeBuyAmount] = useState('100');
  const [expires, setExpires] = useState('14400'); // 4h default
  const [submitting, setSubmitting] = useState(false);

  const valid =
    /^\d+$/.test(sellAmount) &&
    BigInt(sellAmount) > 0n &&
    /^\d+$/.test(indicativeBuyAmount) &&
    BigInt(indicativeBuyAmount) > 0n;

  const onSubmit = async () => {
    if (!valid || submitting) return;
    setSubmitting(true);
    try {
      const rfq = await otcApi.createRfq({
        side,
        sellAmount,
        indicativeBuyAmount,
        expiresInSeconds: Number(expires),
      });
      onCreated(rfq);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to post order');
    } finally {
      setSubmitting(false);
    }
  };

  const sellSym = side === 'sell-usdm' ? 'USDM' : 'USDC';
  const buySym  = side === 'sell-usdm' ? 'USDC' : 'USDM';

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
        New Order
      </DialogTitle>
      <DialogContent sx={{ pt: 3 }}>
        <Stack spacing={2.5} sx={{ pt: 1 }}>
          <Stack direction="row" spacing={1.5}>
            {(['sell-usdm', 'sell-usdc'] as RfqSide[]).map((s) => {
              const active = s === side;
              const symbol = s === 'sell-usdm' ? 'USDM → USDC' : 'USDC → USDM';
              return (
                <Box
                  key={s}
                  role="button"
                  tabIndex={0}
                  onClick={() => setSide(s)}
                  onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && setSide(s)}
                  sx={{
                    flex: 1,
                    px: 2,
                    py: 1.5,
                    borderRadius: 1.5,
                    border: `1px solid ${active ? theme.custom.teal : theme.custom.borderSubtle}`,
                    bgcolor: active ? alpha(theme.custom.teal, 0.08) : 'transparent',
                    cursor: 'pointer',
                    textAlign: 'center',
                    fontFamily: 'JetBrains Mono, monospace',
                    fontSize: '0.78rem',
                    color: active ? theme.custom.teal : theme.custom.textPrimary,
                    fontWeight: active ? 600 : 400,
                    transition: 'all 140ms ease',
                  }}
                >
                  {symbol}
                </Box>
              );
            })}
          </Stack>

          <Field label={`I sell (${sellSym})`}>
            <TextField
              fullWidth
              value={sellAmount}
              onChange={(e) => setSellAmount(e.target.value)}
              placeholder="100"
            />
          </Field>
          <Field label={`I want (indicative ${buySym})`}>
            <TextField
              fullWidth
              value={indicativeBuyAmount}
              onChange={(e) => setIndicativeBuyAmount(e.target.value)}
              placeholder="100"
            />
            <Typography sx={{ mt: 0.5, fontSize: '0.66rem', color: theme.custom.textMuted, fontFamily: 'JetBrains Mono, monospace' }}>
              Counterparties may quote above or below this number. Final price is what you accept.
            </Typography>
          </Field>
          <Field label="Order expires in">
            <TextField
              select
              fullWidth
              value={expires}
              onChange={(e) => setExpires(e.target.value)}
            >
              {EXPIRY_OPTIONS.map((o) => (
                <MenuItem key={o.seconds} value={String(o.seconds)}>
                  {o.label}
                </MenuItem>
              ))}
            </TextField>
          </Field>
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2.5, pt: 1 }}>
        <Button onClick={onClose}>Cancel</Button>
        <Button
          variant="contained"
          color="primary"
          onClick={() => void onSubmit()}
          disabled={!valid || submitting}
        >
          {submitting ? 'Posting…' : 'Post order'}
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
