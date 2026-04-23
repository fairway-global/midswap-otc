/**
 * Midswap OTC wordmark — ContraClear style.
 *
 * Two interlocking circles (Cardano-blue + Midnight-violet) echoing
 * the two chains, with "MIDSWAP OTC" in uppercase monospace.
 */

import React from 'react';
import { Box, Typography } from '@mui/material';
import { alpha, useTheme } from '@mui/material/styles';

export const Logo: React.FC<{ compact?: boolean }> = ({ compact }) => {
  const theme = useTheme();
  return (
    <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 1, userSelect: 'none' }}>
      <Box
        aria-hidden="true"
        sx={{
          position: 'relative',
          width: 26,
          height: 22,
          display: 'inline-block',
          flexShrink: 0,
        }}
      >
        <Box
          sx={{
            position: 'absolute',
            left: 0,
            top: 0,
            width: 17,
            height: 17,
            borderRadius: '50%',
            background: 'linear-gradient(140deg, #4B8CFF, #1A4FD1)',
            boxShadow: `0 3px 10px ${alpha('#1A4FD1', 0.45)}`,
          }}
        />
        <Box
          sx={{
            position: 'absolute',
            right: 0,
            top: 3,
            width: 17,
            height: 17,
            borderRadius: '50%',
            background: 'linear-gradient(140deg, #6B7CFF, #3B1F9E)',
            boxShadow: `0 3px 10px ${alpha('#3B1F9E', 0.45)}`,
            mixBlendMode: 'screen',
          }}
        />
      </Box>
      {!compact && (
        <Typography
          component="span"
          sx={{
            fontWeight: 700,
            fontSize: '0.78rem',
            letterSpacing: '0.08em',
            color: theme.custom.cardanoBlue,
            textTransform: 'uppercase',
          }}
        >
          Midswap OTC
        </Typography>
      )}
    </Box>
  );
};
