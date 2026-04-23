/**
 * Small circular token badge — gradient disc with the first letter of the
 * symbol, a ring in the chain's accent, and optionally a chain label below.
 * Serves as the lightweight "logo" inside token rows and pickers.
 */

import React from 'react';
import { Box, Typography, useTheme } from '@mui/material';
import { alpha } from '@mui/material/styles';
import type { TokenMeta } from './tokens';

interface Props {
  readonly token: TokenMeta;
  readonly size?: number;
  readonly showLabel?: boolean;
}

export const TokenBadge: React.FC<Props> = ({ token, size = 28, showLabel = false }) => {
  const theme = useTheme();
  const letter = token.symbol.charAt(0);
  return (
    <Box sx={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'center', gap: 0.5 }}>
      <Box
        aria-hidden="true"
        sx={{
          width: size,
          height: size,
          borderRadius: '50%',
          background: `linear-gradient(135deg, ${token.monogramFrom}, ${token.monogramTo})`,
          boxShadow: `0 6px 18px ${alpha(token.monogramTo, 0.4)}`,
          border: `1px solid ${alpha('#ffffff', 0.14)}`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: '#ffffff',
          fontWeight: 700,
          fontSize: size * 0.42,
          fontFamily: theme.typography.fontFamily,
          letterSpacing: 0,
        }}
      >
        {letter}
      </Box>
      {showLabel && (
        <Typography variant="caption" sx={{ color: alpha('#ffffff', 0.5), fontSize: '0.65rem' }}>
          {token.chain}
        </Typography>
      )}
    </Box>
  );
};
