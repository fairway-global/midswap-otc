/**
 * CreateRfqModal — originator picks side + amounts + expiry, posts an order.
 *
 * Visual layout mirrors `SwapCard`'s pay/receive layout: two `TokenRow`s with
 * a flip button between them, so the "post an order" surface looks the same
 * as the "settle an order" surface. The submit still posts the same RFQ
 * shape (`{side, sellAmount, indicativeBuyAmount, expiresInSeconds}`).
 */

import React, { useState } from 'react';
import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  MenuItem,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import SwapVertIcon from '@mui/icons-material/SwapVert';
import { alpha, useTheme } from '@mui/material/styles';
import { otcApi, type Rfq, type RfqSide } from '../../api/orchestrator-client';
import { useToast } from '../../hooks/useToast';
import { TokenRow } from '../swap/TokenRow';
import { USDC, USDM } from '../swap/tokens';

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

  const onFlip = () => {
    setSide((s) => (s === 'sell-usdm' ? 'sell-usdc' : 'sell-usdm'));
    // Swap the two amount fields so the numbers follow the visual flip.
    setSellAmount(indicativeBuyAmount);
    setIndicativeBuyAmount(sellAmount);
  };

  const sellToken = side === 'sell-usdm' ? USDM : USDC;
  const buyToken  = side === 'sell-usdm' ? USDC : USDM;
  const directionBadge = side === 'sell-usdm' ? 'USDM → USDC' : 'USDC → USDM';

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
        <Stack direction="row" alignItems="center" spacing={1.25}>
          <Box>New Order</Box>
          <Box
            sx={{
              borderRadius: 1,
              border: `1px solid ${alpha(theme.custom.cardanoBlue, 0.3)}`,
              bgcolor: alpha(theme.custom.cardanoBlue, 0.1),
              px: 1,
              py: 0.25,
              fontSize: '0.6rem',
              fontWeight: 500,
              letterSpacing: '0.06em',
              color: theme.custom.cardanoBlue,
            }}
          >
            {directionBadge}
          </Box>
        </Stack>
      </DialogTitle>
      <DialogContent sx={{ pt: 3 }}>
        <Stack spacing={2.5} sx={{ pt: 1 }}>
          {/* Pay / Receive rows mirroring SwapCard. */}
          <Box sx={{ position: 'relative' }}>
            <Stack spacing={0.5}>
              <TokenRow
                label="You sell"
                value={sellAmount}
                onChange={setSellAmount}
                token={sellToken}
                helper={`Counterparty receives this ${sellToken.symbol} when they claim.`}
                autoFocus
              />
              <TokenRow
                label="You want (indicative)"
                value={indicativeBuyAmount}
                onChange={setIndicativeBuyAmount}
                token={buyToken}
                helper="Counterparties may quote above or below this number."
              />
            </Stack>

            <Tooltip title={side === 'sell-usdm' ? 'Flip to sell USDC' : 'Flip to sell USDM'}>
              <IconButton
                onClick={onFlip}
                aria-label="Flip side"
                sx={{
                  position: 'absolute',
                  top: '50%',
                  left: '50%',
                  transform: 'translate(-50%, -50%)',
                  zIndex: 2,
                  width: 36,
                  height: 36,
                  borderRadius: 1,
                  bgcolor: theme.custom.surface2,
                  border: `3px solid ${theme.custom.surface1}`,
                  '&:hover': { bgcolor: theme.custom.surface3 },
                }}
              >
                <SwapVertIcon sx={{ fontSize: 16, color: theme.custom.textPrimary }} />
              </IconButton>
            </Tooltip>
          </Box>

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
