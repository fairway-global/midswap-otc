import React from 'react';
import { Box, Stack } from '@mui/material';
import { alpha, useTheme } from '@mui/material/styles';
import type { RfqSide } from '../../api/orchestrator-client';

/**
 * Visual chip pair representing the chain flow direction of an order.
 * sell-usdm → USDM (Cardano) → USDC (Midnight).
 * sell-usdc → USDC (Midnight) → USDM (Cardano).
 */
export const ChainPair: React.FC<{ side: RfqSide }> = ({ side }) => {
  const theme = useTheme();
  const left = side === 'sell-usdm' ? 'USDM' : 'USDC';
  const right = side === 'sell-usdm' ? 'USDC' : 'USDM';
  const leftColor = left === 'USDM' ? theme.custom.bridgeCyan : theme.custom.teal;
  const rightColor = right === 'USDM' ? theme.custom.bridgeCyan : theme.custom.teal;
  return (
    <Stack direction="row" spacing={0.5} alignItems="center">
      <TokenSlot label={left} color={leftColor} />
      <Box sx={{ color: theme.custom.textMuted, fontSize: '0.7rem', mx: 0.25 }}>→</Box>
      <TokenSlot label={right} color={rightColor} />
    </Stack>
  );
};

const TokenSlot: React.FC<{ label: string; color: string }> = ({ label, color }) => (
  <Box
    sx={{
      px: 0.75,
      py: 0.25,
      borderRadius: 0.75,
      border: `1px solid ${alpha(color, 0.4)}`,
      bgcolor: alpha(color, 0.08),
      color,
      fontFamily: 'JetBrains Mono, monospace',
      fontSize: '0.62rem',
      fontWeight: 600,
      letterSpacing: '0.04em',
    }}
  >
    {label}
  </Box>
);
