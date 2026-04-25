/**
 * KAAMOS wordmark — uses the aurora logo image asset.
 *
 * Shows the full KAAMOS aurora logo (compact = icon only)
 * with "KAAMOS" text beside it.
 */

import React from 'react';
import { Box, Typography } from '@mui/material';
import { useTheme } from '@mui/material/styles';

export const Logo: React.FC<{ compact?: boolean }> = ({ compact }) => {
  const theme = useTheme();
  return (
    <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 1, userSelect: 'none' }}>
      <Box
        component="img"
        src="/kaamos-logo.png"
        alt="KAAMOS"
        sx={{
          height: compact ? 28 : 34,
          width: 'auto',
          objectFit: 'contain',
          flexShrink: 0,
        }}
      />
      {!compact && (
        <Typography
          component="span"
          sx={{
            fontWeight: 700,
            fontSize: '0.82rem',
            letterSpacing: '0.16em',
            color: theme.custom.textPrimary,
            textTransform: 'uppercase',
            fontFamily: "'Inter', sans-serif",
          }}
        >
          KAAMOS
        </Typography>
      )}
    </Box>
  );
};
