import React from 'react';
import { Box } from '@mui/material';
import { alpha, useTheme } from '@mui/material/styles';
import type { RfqStatus, QuoteStatus } from '../../api/orchestrator-client';

const RFQ_TONE: Record<RfqStatus, 'active' | 'pending' | 'sync' | 'done' | 'failed' | 'muted'> = {
  OpenForQuotes: 'active',
  Negotiating: 'pending',
  QuoteSelected: 'active',
  Settling: 'sync',
  Settled: 'done',
  Expired: 'muted',
  Cancelled: 'failed',
};

const RFQ_LABEL: Record<RfqStatus, string> = {
  OpenForQuotes: 'Open',
  Negotiating: 'Negotiating',
  QuoteSelected: 'Selected',
  Settling: 'Settling',
  Settled: 'Settled',
  Expired: 'Expired',
  Cancelled: 'Cancelled',
};

const QUOTE_TONE: Record<QuoteStatus, 'active' | 'pending' | 'sync' | 'done' | 'failed' | 'muted'> = {
  Submitted: 'active',
  Countered: 'pending',
  Accepted: 'done',
  Rejected: 'failed',
  Expired: 'muted',
};

const useToneColor = (tone: 'active' | 'pending' | 'sync' | 'done' | 'failed' | 'muted'): { bg: string; fg: string } => {
  const theme = useTheme();
  switch (tone) {
    case 'active':  return { bg: alpha(theme.custom.teal,        0.16), fg: theme.custom.teal };
    case 'pending': return { bg: alpha(theme.custom.warning,     0.16), fg: theme.custom.warning };
    case 'sync':    return { bg: alpha(theme.custom.bridgeCyan,  0.18), fg: theme.custom.bridgeCyan };
    case 'done':    return { bg: alpha(theme.custom.success,     0.18), fg: theme.custom.success };
    case 'failed':  return { bg: alpha(theme.custom.danger,      0.16), fg: theme.custom.danger };
    case 'muted':   return { bg: alpha('#FFFFFF',                0.05), fg: theme.custom.textMuted };
  }
};

export const RfqStatusChip: React.FC<{ status: RfqStatus }> = ({ status }) => {
  const { bg, fg } = useToneColor(RFQ_TONE[status]);
  return (
    <Box
      sx={{
        display: 'inline-block',
        px: 0.75,
        py: 0.25,
        borderRadius: 0.75,
        bgcolor: bg,
        color: fg,
        fontFamily: 'JetBrains Mono, monospace',
        fontSize: '0.6rem',
        letterSpacing: '0.12em',
        textTransform: 'uppercase',
        fontWeight: 600,
      }}
    >
      {RFQ_LABEL[status]}
    </Box>
  );
};

export const QuoteStatusChip: React.FC<{ status: QuoteStatus }> = ({ status }) => {
  const { bg, fg } = useToneColor(QUOTE_TONE[status]);
  return (
    <Box
      sx={{
        display: 'inline-block',
        px: 0.75,
        py: 0.25,
        borderRadius: 0.75,
        bgcolor: bg,
        color: fg,
        fontFamily: 'JetBrains Mono, monospace',
        fontSize: '0.6rem',
        letterSpacing: '0.12em',
        textTransform: 'uppercase',
        fontWeight: 600,
      }}
    >
      {status}
    </Box>
  );
};
