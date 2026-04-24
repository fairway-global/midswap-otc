/**
 * Midswap OTC — full-screen hero landing page.
 *
 * ContraClear-inspired cinematic intro with a "Launch App" CTA
 * that routes to the OTC workspace. This is the first thing a visitor
 * sees — clean, dramatic, minimal text.
 */

import React from 'react';
import { Box, Button, Stack, Typography } from '@mui/material';
import { alpha, useTheme } from '@mui/material/styles';
import { useNavigate } from 'react-router-dom';
import ArrowForwardIcon from '@mui/icons-material/ArrowForward';
import { Logo } from './Layout/Logo';

export const LandingPage: React.FC = () => {
  const theme = useTheme();
  const navigate = useNavigate();

  return (
    <Box
      sx={{
        position: 'relative',
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        bgcolor: theme.custom.surface0,
        // Homepage uses JetBrains Mono throughout — matches the terminal
        // aesthetic of the product surface. The app theme otherwise puts
        // headings (h1-h6) in Inter; force mono for every Typography and
        // Button on this page so the headline and box titles match the
        // eyebrows, body, button, and footer.
        fontFamily: "'JetBrains Mono', 'SF Mono', ui-monospace, Menlo, Consolas, 'Liberation Mono', monospace",
        '& .MuiTypography-root, & .MuiButton-root': {
          fontFamily: "'JetBrains Mono', 'SF Mono', ui-monospace, Menlo, Consolas, 'Liberation Mono', monospace",
        },
      }}
    >
      {/* === Background layers === */}

      {/* Radial glow — top center */}
      <Box
        aria-hidden="true"
        sx={{
          position: 'absolute',
          top: '-20%',
          left: '50%',
          transform: 'translateX(-50%)',
          width: '130vw',
          height: '80vh',
          background: `radial-gradient(ellipse at center, ${alpha(
            theme.custom.cardanoBlue,
            0.14,
          )} 0%, transparent 60%)`,
          pointerEvents: 'none',
        }}
      />

      {/* Secondary glow — violet accent bottom-right */}
      <Box
        aria-hidden="true"
        sx={{
          position: 'absolute',
          bottom: '-10%',
          right: '-5%',
          width: '60vw',
          height: '60vh',
          background: `radial-gradient(ellipse at center, ${alpha(
            '#6B7CFF',
            0.08,
          )} 0%, transparent 60%)`,
          pointerEvents: 'none',
        }}
      />

      {/* Grid overlay */}
      <Box
        aria-hidden="true"
        sx={{
          position: 'absolute',
          inset: 0,
          opacity: 0.35,
          backgroundImage:
            'linear-gradient(rgba(255,255,255,0.02) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.02) 1px, transparent 1px)',
          backgroundSize: '40px 40px',
          pointerEvents: 'none',
        }}
      />

      {/* Floating particles — subtle decorative elements */}
      {[
        { top: '15%', left: '10%', size: 3, delay: '0s' },
        { top: '25%', right: '15%', size: 2, delay: '1.5s' },
        { top: '60%', left: '20%', size: 2, delay: '0.8s' },
        { top: '70%', right: '25%', size: 3, delay: '2s' },
        { top: '40%', left: '80%', size: 2, delay: '0.4s' },
      ].map((p, i) => (
        <Box
          key={i}
          aria-hidden="true"
          sx={{
            position: 'absolute',
            top: p.top,
            left: p.left,
            right: p.right,
            width: p.size,
            height: p.size,
            borderRadius: '50%',
            bgcolor: alpha(theme.custom.cardanoBlue, 0.5),
            animation: `float 4s ease-in-out infinite`,
            animationDelay: p.delay,
            pointerEvents: 'none',
            '@keyframes float': {
              '0%, 100%': { transform: 'translateY(0px)', opacity: 0.5 },
              '50%': { transform: 'translateY(-12px)', opacity: 1 },
            },
          }}
        />
      ))}

      {/* === Top bar === */}
      <Box
        sx={{
          position: 'relative',
          zIndex: 2,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          px: { xs: 3, md: 5 },
          py: 2.5,
        }}
      >
        <Logo />
        <Button
          variant="outlined"
          size="small"
          onClick={() => navigate('/app')}
          sx={{
            borderColor: theme.custom.borderStrong,
            color: theme.custom.textSecondary,
            fontSize: '0.7rem',
            '&:hover': {
              borderColor: theme.custom.cardanoBlue,
              color: theme.custom.cardanoBlue,
            },
          }}
        >
          Launch App
        </Button>
      </Box>

      {/* === Main hero content === */}
      <Box
        sx={{
          position: 'relative',
          zIndex: 2,
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          px: { xs: 3, md: 5 },
          pb: 8,
        }}
      >
        <Stack spacing={4} alignItems="center" sx={{ maxWidth: 800, textAlign: 'center' }}>
          {/* Network badge */}
          <Box
            sx={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 1,
              borderRadius: 1,
              border: `1px solid ${alpha(theme.custom.cardanoBlue, 0.3)}`,
              bgcolor: alpha(theme.custom.cardanoBlue, 0.05),
              px: 1.5,
              py: 0.75,
            }}
          >
            <Box
              sx={{
                width: 6,
                height: 6,
                borderRadius: '50%',
                bgcolor: theme.custom.cardanoBlue,
                animation: 'pulse 2s infinite',
                '@keyframes pulse': {
                  '0%, 100%': { opacity: 1 },
                  '50%': { opacity: 0.4 },
                },
              }}
            />
            <Typography
              sx={{
                fontSize: '0.6rem',
                letterSpacing: '0.3em',
                textTransform: 'uppercase',
                color: theme.custom.cardanoBlue,
                fontWeight: 500,
              }}
            >
              Preprod · Midnight × Cardano
            </Typography>
          </Box>

          {/* Headline */}
          <Typography
            variant="h1"
            sx={{
              fontWeight: 700,
              fontSize: { xs: '2.4rem', md: '3.6rem' },
              lineHeight: 1.1,
              letterSpacing: '-0.03em',
            }}
          >
            Private cross-chain{' '}
            <Box
              component="span"
              sx={{
                backgroundImage: theme.custom.accentGradient,
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
                backgroundClip: 'text',
              }}
            >
              OTC settlement
            </Box>
          </Typography>

          {/* Subtitle */}
          <Typography
            sx={{
              color: theme.custom.textSecondary,
              fontSize: { xs: '0.84rem', md: '0.95rem' },
              maxWidth: 540,
              lineHeight: 1.7,
            }}
          >
            Atomic swaps between Cardano USDM and Midnight USDC using hash-time-locked escrow.
            No custodian. No bridge. No trust required.
          </Typography>

          {/* CTA */}
          <Button
            variant="contained"
            size="large"
            endIcon={<ArrowForwardIcon sx={{ fontSize: 18 }} />}
            onClick={() => navigate('/app')}
            sx={{
              px: 4,
              py: 1.75,
              fontSize: '0.88rem',
              fontWeight: 600,
              borderRadius: 1.5,
            }}
          >
            Launch App
          </Button>
        </Stack>

        {/* Feature pills — minimal, ContraClear style */}
        <Box
          sx={{
            mt: 8,
            display: 'grid',
            gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr', md: 'repeat(4, 1fr)' },
            gap: 2,
            maxWidth: 1160,
            width: '100%',
          }}
        >
          {[
            {
              eyebrow: 'Settlement',
              title: 'Trustless escrow',
              text: 'Hash-time-locked contracts ensure both parties settle or both reclaim.',
            },
            {
              eyebrow: 'Cross-chain',
              title: 'Native execution',
              text: 'Aiken on Cardano, Compact on Midnight. No bridges or wrapped tokens.',
            },
            {
              eyebrow: 'Custody',
              title: 'Self-sovereign',
              text: 'Your keys sign every transaction. Nothing custodial, ever.',
            },
            {
              eyebrow: 'Compliance',
              title: 'Verified counterparties',
              text: 'Permissioned environment for institutional OTC trades, with ZK-based on-chain KYB.',
            },
          ].map((f, i) => (
            <Box
              key={i}
              sx={{
                p: 2.5,
                borderRadius: 2,
                border: `1px solid ${theme.custom.borderSubtle}`,
                bgcolor: alpha(theme.custom.surface1, 0.6),
                backdropFilter: 'blur(8px)',
              }}
            >
              <Typography
                sx={{
                  fontSize: '0.58rem',
                  letterSpacing: '0.2em',
                  textTransform: 'uppercase',
                  color: theme.custom.cardanoBlue,
                  fontWeight: 500,
                  mb: 0.75,
                }}
              >
                {f.eyebrow}
              </Typography>
              <Typography
                sx={{
                  fontWeight: 600,
                  fontSize: '0.84rem',
                  color: theme.custom.textPrimary,
                  mb: 0.5,
                }}
              >
                {f.title}
              </Typography>
              <Typography
                sx={{
                  color: theme.custom.textMuted,
                  fontSize: '0.68rem',
                  lineHeight: 1.6,
                }}
              >
                {f.text}
              </Typography>
            </Box>
          ))}
        </Box>
      </Box>

      {/* === Footer === */}
      <Box
        component="footer"
        sx={{
          position: 'relative',
          zIndex: 2,
          borderTop: `1px solid ${theme.custom.borderSubtle}`,
          px: { xs: 3, md: 5 },
          py: 1.5,
        }}
      >
        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          spacing={1}
          alignItems={{ sm: 'center' }}
          justifyContent="space-between"
        >
          <Typography
            sx={{
              fontSize: '0.62rem',
              color: theme.custom.textMuted,
              letterSpacing: '0.02em',
            }}
          >
            Midswap OTC · Cross-chain atomic settlement
          </Typography>
          <Typography
            sx={{
              fontSize: '0.62rem',
              color: theme.custom.textMuted,
              letterSpacing: '0.02em',
            }}
          >
            Network: Preprod
          </Typography>
        </Stack>
      </Box>
    </Box>
  );
};
