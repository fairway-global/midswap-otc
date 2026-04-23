import React from 'react';
import { Box, Container } from '@mui/material';
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
          backgroundImage: `radial-gradient(ellipse 60% 50% at 50% 0%, ${alpha(
            theme.custom.cardanoBlue,
            0.2,
          )} 0%, transparent 60%), radial-gradient(ellipse 50% 40% at 85% 10%, ${alpha(
            '#7C5BFF',
            0.12,
          )} 0%, transparent 55%)`,
          zIndex: 0,
        }}
      />

      <Box sx={{ position: 'relative', zIndex: 1, display: 'flex', flexDirection: 'column', flex: 1 }}>
        <Header />
        <Container maxWidth="lg" sx={{ py: { xs: 3, md: 5 }, flexGrow: 1 }}>
          <RecoveryBanner />
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>{children}</Box>
        </Container>
      </Box>
    </Box>
  );
};
