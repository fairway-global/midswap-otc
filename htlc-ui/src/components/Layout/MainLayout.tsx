/**
 * KAAMOS OTC — layout shell with starry night atmosphere.
 *
 * Pure black background with subtle starfield and aurora glows.
 * The stars carry through from the landing page for visual continuity.
 */

import React from 'react';
import { Box, Stack, Typography } from '@mui/material';
import { alpha, useTheme, keyframes } from '@mui/material/styles';
import { Header } from './Header';
import { RecoveryBanner } from '../RecoveryBanner';

const twinkle = keyframes`
  0%, 100% { opacity: 0.3; }
  50% { opacity: 1; }
`;

const glowPulse = keyframes`
  0%, 100% { opacity: 0.4; }
  50% { opacity: 0.7; }
`;

/* Deterministic-ish stars — same approach as LandingPage but fewer */
function generateStars(count: number, maxSize: number = 1.5): string {
  const stars: string[] = [];
  for (let i = 0; i < count; i++) {
    const x = Math.random() * 100;
    const y = Math.random() * 100;
    const size = Math.random() * maxSize + 0.5;
    stars.push(`${x}vw ${y}vh 0 ${size - 0.5}px rgba(255,255,255,${0.1 + Math.random() * 0.35})`);
  }
  return stars.join(', ');
}

const STARS_BG = generateStars(50, 1);
const STARS_TWINKLE = generateStars(15, 1.5);

export const MainLayout: React.FC<React.PropsWithChildren> = ({ children }) => {
  const theme = useTheme();
  const teal = '#2DD4BF';
  const violet = '#7C3AED';

  return (
    <Box
      sx={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        position: 'relative',
        bgcolor: '#000000',
      }}
    >
      {/* Starfield — subtle background stars */}
      <Box
        aria-hidden="true"
        sx={{
          pointerEvents: 'none',
          position: 'fixed',
          inset: 0,
          zIndex: 0,
          '&::before': {
            content: '""',
            position: 'absolute',
            inset: 0,
            boxShadow: STARS_BG,
          },
          '&::after': {
            content: '""',
            position: 'absolute',
            inset: 0,
            boxShadow: STARS_TWINKLE,
            animation: `${twinkle} 5s ease-in-out infinite`,
          },
        }}
      />

      {/* Very subtle aurora glow — top */}
      <Box
        aria-hidden="true"
        sx={{
          pointerEvents: 'none',
          position: 'fixed',
          top: 0,
          left: '50%',
          transform: 'translateX(-50%)',
          width: '100vw',
          height: '40vh',
          backgroundImage: `radial-gradient(ellipse at center top, ${alpha(
            teal,
            0.04,
          )} 0%, transparent 60%)`,
          zIndex: 0,
          animation: `${glowPulse} 10s ease-in-out infinite`,
        }}
      />

      {/* Very subtle violet glow — bottom corner */}
      <Box
        aria-hidden="true"
        sx={{
          pointerEvents: 'none',
          position: 'fixed',
          bottom: 0,
          right: 0,
          width: '40vw',
          height: '30vh',
          backgroundImage: `radial-gradient(ellipse at bottom right, ${alpha(
            violet,
            0.03,
          )} 0%, transparent 60%)`,
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

        {/* Footer */}
        <Box
          component="footer"
          sx={{
            borderTop: `1px solid ${alpha('#FFFFFF', 0.06)}`,
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
                color: alpha('#FFFFFF', 0.25),
                letterSpacing: '0.02em',
              }}
            >
              KAAMOS · Cross-chain atomic settlement on Midnight × Cardano.
            </Typography>
            <Typography
              sx={{
                fontSize: '0.68rem',
                color: alpha('#FFFFFF', 0.25),
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
