/**
 * SwapStatusChip — terminal-style uppercase status indicator.
 * Direction-neutral vocabulary (no Alice/Bob).
 */

import React from 'react';
import { Chip } from '@mui/material';
import type { SwapStatus } from '../api/orchestrator-client';

const LABELS: Record<SwapStatus, string> = {
  open: 'Open',
  bob_deposited: 'Deposited',
  alice_claimed: 'Claimed',
  completed: 'Completed',
  alice_reclaimed: 'Maker reclaimed',
  bob_reclaimed: 'Taker reclaimed',
  expired: 'Expired',
};

const COLORS: Record<SwapStatus, 'primary' | 'success' | 'error' | 'warning' | 'info' | 'default'> = {
  open: 'info',
  bob_deposited: 'primary',
  alice_claimed: 'warning',
  completed: 'success',
  alice_reclaimed: 'error',
  bob_reclaimed: 'error',
  expired: 'default',
};

export const statusLabel = (s: SwapStatus): string => LABELS[s] ?? s;

export const SwapStatusChip: React.FC<{ status: SwapStatus }> = ({ status }) => (
  <Chip
    size="small"
    label={statusLabel(status)}
    color={COLORS[status] ?? 'default'}
    variant="filled"
  />
);
