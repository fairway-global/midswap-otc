/**
 * Unified status chip for orchestrator swap statuses.
 *
 * Labels are direction-neutral — the same state name has a matching semantic
 * in both `ada-usdc` and `usdc-ada` flows (e.g. `alice_claimed` = "Preimage
 * revealed" regardless of which chain did the revealing).
 */

import React from 'react';
import { Chip, type ChipProps } from '@mui/material';
import type { SwapStatus } from '../api/orchestrator-client';

type ChipColor = NonNullable<ChipProps['color']>;

interface StatusMeta {
  label: string;
  color: ChipColor;
  description: string;
}

const META: Record<SwapStatus, StatusMeta> = {
  open: { label: 'Open', color: 'info', description: 'Maker has locked — waiting for counterparty.' },
  bob_deposited: {
    label: 'Counterparty locked',
    color: 'primary',
    description: 'Both sides locked — waiting for the maker to claim.',
  },
  alice_claimed: {
    label: 'Preimage revealed',
    color: 'primary',
    description: 'Maker claimed — preimage is public. Taker can now claim.',
  },
  completed: { label: 'Completed', color: 'success', description: 'Swap finished.' },
  alice_reclaimed: {
    label: 'Maker reclaimed',
    color: 'warning',
    description: 'Maker refunded their initial lock after the deadline passed.',
  },
  bob_reclaimed: {
    label: 'Taker reclaimed',
    color: 'warning',
    description: 'Taker refunded their lock after the deadline passed.',
  },
  expired: { label: 'Expired', color: 'error', description: 'Past deadline — needs manual reclaim.' },
};

export const statusLabel = (s: SwapStatus): string => META[s].label;
export const statusDescription = (s: SwapStatus): string => META[s].description;

interface Props {
  status: SwapStatus;
  size?: ChipProps['size'];
  variant?: ChipProps['variant'];
}

export const SwapStatusChip: React.FC<Props> = ({ status, size = 'small', variant = 'filled' }) => {
  const meta = META[status];
  return <Chip size={size} variant={variant} color={meta.color} label={meta.label} title={meta.description} />;
};
