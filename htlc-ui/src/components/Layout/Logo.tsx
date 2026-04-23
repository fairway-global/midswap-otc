/**
 * Midswap wordmark. Two interlocking circles — one Cardano-blue,
 * one Midnight-violet — echo the two chains bridged by the protocol.
 */

import React from 'react';
import { Box, Typography } from '@mui/material';
import { alpha, useTheme } from '@mui/material/styles';

export const Logo: React.FC<{ compact?: boolean }> = ({ compact }) => {
  const theme = useTheme();
  return (
    <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 1.25, userSelect: 'none' }}>
      <Box
        aria-hidden="true"
        sx={{
          position: 'relative',
          width: 30,
          height: 26,
          display: 'inline-block',
          flexShrink: 0,
        }}
      >
        <Box
          sx={{
            position: 'absolute',
            left: 0,
            top: 0,
            width: 20,
            height: 20,
            borderRadius: '50%',
            background: 'linear-gradient(140deg, #4B8CFF, #1A4FD1)',
            boxShadow: `0 4px 12px ${alpha('#1A4FD1', 0.45)}`,
          }}
        />
        <Box
          sx={{
            position: 'absolute',
            right: 0,
            top: 4,
            width: 20,
            height: 20,
            borderRadius: '50%',
            background: 'linear-gradient(140deg, #6B7CFF, #3B1F9E)',
            boxShadow: `0 4px 12px ${alpha('#3B1F9E', 0.45)}`,
            mixBlendMode: 'screen',
          }}
        />
      </Box>
      {!compact && (
        <Typography
          component="span"
          sx={{
            fontWeight: 700,
            fontSize: '1.15rem',
            letterSpacing: '-0.015em',
            color: theme.custom.textPrimary,
          }}
        >
          Midswap
        </Typography>
      )}
    </Box>
  );
};
