/**
 * Settings drawer — deadline (minutes until the Cardano HTLC expires) and a
 * read-only summary of the safety-buffer math. Cardano deadline is the only
 * value the maker actually controls; the Midnight deadline is derived from
 * it in the taker flow.
 */

import React from 'react';
import {
  Box,
  Button,
  Dialog,
  DialogContent,
  DialogTitle,
  IconButton,
  InputAdornment,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import { limits } from '../../config/limits';
import { useTheme } from '@mui/material/styles';

interface Props {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly deadlineMin: string;
  readonly onDeadlineMinChange: (v: string) => void;
}

const PRESETS = [30, 60, 120, 240];

export const SettingsDialog: React.FC<Props> = ({ open, onClose, deadlineMin, onDeadlineMinChange }) => {
  const theme = useTheme();
  const parsed = parseInt(deadlineMin, 10);
  const ok = Number.isFinite(parsed) && parsed >= limits.aliceMinDeadlineMin;

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1, pb: 1 }}>
        <Box sx={{ flex: 1, fontWeight: 600 }}>Settings</Box>
        <IconButton onClick={onClose} size="small">
          <CloseIcon fontSize="small" />
        </IconButton>
      </DialogTitle>
      <DialogContent>
        <Stack spacing={2.5} sx={{ pt: 0.5 }}>
          <Stack spacing={1}>
            <Typography variant="subtitle2" sx={{ color: theme.custom.textSecondary }}>
              Cardano deadline
            </Typography>
            <Typography variant="caption" sx={{ color: theme.custom.textMuted }}>
              How long the USDM lock stays open. The counterparty&apos;s Midnight deadline is nested strictly inside with
              a {limits.bobSafetyBufferSecs}s safety buffer.
            </Typography>
            <Stack direction="row" spacing={1}>
              {PRESETS.map((p) => (
                <Button
                  key={p}
                  size="small"
                  variant={parsed === p ? 'contained' : 'outlined'}
                  color={parsed === p ? 'primary' : 'inherit'}
                  onClick={() => onDeadlineMinChange(String(p))}
                  sx={{ flex: 1, minWidth: 0 }}
                >
                  {p < 60 ? `${p}m` : `${p / 60}h`}
                </Button>
              ))}
            </Stack>
            <TextField
              value={deadlineMin}
              onChange={(e) => onDeadlineMinChange(e.target.value)}
              type="number"
              size="small"
              error={!ok && deadlineMin.trim().length > 0}
              helperText={
                ok
                  ? 'Custom deadline in minutes.'
                  : `Minimum ${limits.aliceMinDeadlineMin} minutes (so the counterparty has a safe window).`
              }
              InputProps={{
                endAdornment: <InputAdornment position="end">min</InputAdornment>,
              }}
            />
          </Stack>

          <Box
            sx={{
              p: 1.5,
              borderRadius: 2,
              border: `1px solid ${theme.custom.borderSubtle}`,
              bgcolor: theme.custom.surface2,
            }}
          >
            <Typography variant="caption" sx={{ color: theme.custom.textMuted, display: 'block' }}>
              Protocol safety windows
            </Typography>
            <Stack spacing={0.25} sx={{ mt: 0.5 }}>
              <Row k="Counterparty minimum window" v={`${Math.round(limits.bobMinCardanoWindowSecs / 60)} min`} />
              <Row k="Midnight safety buffer" v={`${limits.bobSafetyBufferSecs} s`} />
              <Row k="Minimum Midnight TTL" v={`${limits.bobMinDepositTtlSecs} s`} />
            </Stack>
            {/* <Typography variant="caption" sx={{ color: theme.custom.textMuted, mt: 1, display: 'block' }}>
              Override via <code>VITE_*</code> env vars — do not edit in code.
            </Typography> */}
          </Box>
        </Stack>
      </DialogContent>
    </Dialog>
  );
};

const Row: React.FC<{ k: string; v: string }> = ({ k, v }) => {
  const theme = useTheme();
  return (
    <Stack direction="row">
      <Typography variant="caption" sx={{ color: theme.custom.textSecondary, flex: 1 }}>
        {k}
      </Typography>
      <Typography variant="caption" sx={{ color: theme.custom.textPrimary, fontWeight: 500 }}>
        {v}
      </Typography>
    </Stack>
  );
};
