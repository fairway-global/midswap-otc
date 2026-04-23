/**
 * Midswap OTC — ContraClear-style layout shell.
 *
 * Full-width panel structure with:
 *   - Sticky header with border-bottom
 *   - Full-width content area with horizontal padding
 *   - Footer bar with network info
 *   - Subtle backdrop glow (Cardano-blue radial)
 */

import React from 'react';
import { Box, Stack, Typography } from '@mui/material';
import { alpha, useTheme } from '@mui/material/styles';
import { Header } from './Header';
import { RecoveryBanner } from '../RecoveryBanner';

export const MainLayout: React.FC<React.PropsWithChildren> = ({ children }) => {
  const theme = useTheme();
  return (
    <Box
      sx={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        position: 'relative',
        bgcolor: theme.custom.surface0,
      }}
    >
      {/* Backdrop radial glow */}
      <Box
        aria-hidden="true"
        sx={{
          pointerEvents: 'none',
          position: 'fixed',
          inset: 0,
          backgroundImage: `radial-gradient(circle at top, ${alpha(
            theme.custom.cardanoBlue,
            0.08,
          )} 0%, transparent 45%)`,
          zIndex: 0,
        }}
      />

      {/* Grid overlay — terminal aesthetic */}
      <Box
        aria-hidden="true"
        sx={{
          pointerEvents: 'none',
          position: 'fixed',
          inset: 0,
          opacity: 0.4,
          backgroundImage:
            'linear-gradient(rgba(255,255,255,0.02) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.02) 1px, transparent 1px)',
          backgroundSize: '32px 32px',
          zIndex: 0,
        }}
      />

      <Box sx={{ position: 'relative', zIndex: 1, display: 'flex', flexDirection: 'column', flex: 1 }}>
        <Header />
        <Box
          component="main"
          sx={{
            flexGrow: 1,
            px: { xs: 2, md: 3 },
            py: { xs: 2, md: 3 },
          }}
        >
          <RecoveryBanner />
          <Stack spacing={2.5}>{children}</Stack>
        </Box>

        {/* Footer — ContraClear style */}
        <Box
          component="footer"
          sx={{
            borderTop: `1px solid ${theme.custom.borderSubtle}`,
            px: { xs: 2, md: 3 },
            py: 1.5,
          }}
        >
          <Stack
            direction={{ xs: 'column', md: 'row' }}
            spacing={1}
            alignItems={{ md: 'center' }}
            justifyContent="space-between"
          >
            <Typography
              sx={{
                fontSize: '0.68rem',
                color: theme.custom.textMuted,
                letterSpacing: '0.02em',
              }}
            >
              Midswap OTC. Cross-chain atomic settlement on Midnight × Cardano.
            </Typography>
            <Typography
              sx={{
                fontSize: '0.68rem',
                color: theme.custom.textMuted,
                letterSpacing: '0.02em',
              }}
            >
              Network: Preprod
            </Typography>
          </Stack>
        </Box>
      </Box>
    </Box>
  );
};
