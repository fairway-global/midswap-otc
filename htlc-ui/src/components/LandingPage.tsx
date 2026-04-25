/**
 * KAAMOS OTC — full-screen hero landing page.
 *
 * Night-sky aesthetic:
 *   - Pure black background
 *   - Scattered white starry dots (CSS-generated)
 *   - Subtle teal + violet aurora glows behind key elements
 *   - KAAMOS logo large and centered
 *   - Teal CTA button, white text throughout
 */

import React from 'react';
import { Box, Button, Stack, Typography } from '@mui/material';
import { alpha, useTheme, keyframes } from '@mui/material/styles';
import { useNavigate } from 'react-router-dom';
import ArrowForwardIcon from '@mui/icons-material/ArrowForward';

/* ── Animations ─────────────────────────────────────────────────── */
const twinkle = keyframes`
  0%, 100% { opacity: 0.3; }
  50% { opacity: 1; }
`;

const drift = keyframes`
  0%, 100% { transform: translateY(0px); }
  50% { transform: translateY(-6px); }
`;

const glowPulse = keyframes`
  0%, 100% { opacity: 0.5; }
  50% { opacity: 0.8; }
`;

/* ── Starfield: generates randomised CSS stars ──────────────────── */
function generateStars(count: number, maxSize: number = 2): string {
  const stars: string[] = [];
  for (let i = 0; i < count; i++) {
    const x = Math.random() * 100;
    const y = Math.random() * 100;
    const size = Math.random() * maxSize + 0.5;
    stars.push(`${x}vw ${y}vh 0 ${size - 0.5}px rgba(255,255,255,${0.15 + Math.random() * 0.5})`);
  }
  return stars.join(', ');
}

const STARS_SMALL = generateStars(80, 1.2);
const STARS_MEDIUM = generateStars(30, 2);
const STARS_BRIGHT = generateStars(8, 2.5);

export const LandingPage: React.FC = () => {
  const theme = useTheme();
  const navigate = useNavigate();
  const teal = '#25b9a6ff';
  const violet = '#7C3AED';

  return (
    <Box
      sx={{
        position: 'relative',
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        bgcolor: '#000000',
        fontFamily: "'JetBrains Mono', 'SF Mono', ui-monospace, Menlo, Consolas, 'Liberation Mono', monospace",
        '& .MuiTypography-root, & .MuiButton-root': {
          fontFamily: "'JetBrains Mono', 'SF Mono', ui-monospace, Menlo, Consolas, 'Liberation Mono', monospace",
        },
      }}
    >
      {/* ═══ STARFIELD ═══ */}
      <Box
        aria-hidden="true"
        sx={{
          position: 'fixed',
          inset: 0,
          pointerEvents: 'none',
          '&::before': {
            content: '""',
            position: 'absolute',
            inset: 0,
            boxShadow: STARS_SMALL,
          },
          '&::after': {
            content: '""',
            position: 'absolute',
            inset: 0,
            boxShadow: STARS_MEDIUM,
            animation: `${twinkle} 4s ease-in-out infinite`,
          },
        }}
      />
      {/* Bright stars — slower twinkle */}
      <Box
        aria-hidden="true"
        sx={{
          position: 'fixed',
          inset: 0,
          pointerEvents: 'none',
          boxShadow: STARS_BRIGHT,
          animation: `${twinkle} 6s ease-in-out infinite 1s`,
        }}
      />

      {/* ═══ AURORA GLOW — behind hero content ═══ */}
      {/* Teal aurora — top center, very subtle */}
      <Box
        aria-hidden="true"
        sx={{
          position: 'absolute',
          top: '10%',
          left: '50%',
          transform: 'translateX(-50%)',
          width: '80vw',
          height: '50vh',
          background: `radial-gradient(ellipse at center, ${alpha(teal, 0.06)} 0%, transparent 70%)`,
          pointerEvents: 'none',
          animation: `${glowPulse} 8s ease-in-out infinite`,
        }}
      />
      {/* Violet aurora — bottom left, barely visible */}
      <Box
        aria-hidden="true"
        sx={{
          position: 'absolute',
          bottom: '5%',
          left: '10%',
          width: '50vw',
          height: '40vh',
          background: `radial-gradient(ellipse at center, ${alpha(violet, 0.04)} 0%, transparent 65%)`,
          pointerEvents: 'none',
          animation: `${glowPulse} 10s ease-in-out infinite 2s`,
        }}
      />

      {/* ═══ TOP BAR ═══ */}
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
        {/* Small logo in header */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <Box
            component="img"
            src="/kaamos-logo.png"
            alt="KAAMOS"
            sx={{ height: 30, width: 'auto' }}
          />
          <Typography
            component="span"
            sx={{
              fontWeight: 700,
              fontSize: '0.78rem',
              letterSpacing: '0.16em',
              color: '#FFFFFF',
              textTransform: 'uppercase',
              fontFamily: "'Inter', sans-serif",
            }}
          >
            KAAMOS
          </Typography>
        </Box>

        <Button
          variant="outlined"
          size="small"
          onClick={() => navigate('/app')}
          sx={{
            borderColor: alpha('#FFFFFF', 0.2),
            color: alpha('#FFFFFF', 0.7),
            fontSize: '0.7rem',
            '&:hover': {
              borderColor: teal,
              color: teal,
              backgroundColor: alpha(teal, 0.06),
            },
          }}
        >
          Launch App
        </Button>
      </Box>

      {/* ═══ HERO CONTENT ═══ */}
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
              border: `1px solid ${alpha(teal, 0.25)}`,
              bgcolor: alpha(teal, 0.04),
              px: 1.5,
              py: 0.75,
            }}
          >
            <Box
              sx={{
                width: 6,
                height: 6,
                borderRadius: '50%',
                bgcolor: teal,
                animation: `${glowPulse} 2s infinite`,
                boxShadow: `0 0 6px ${alpha(teal, 0.5)}`,
              }}
            />
            <Typography
              sx={{
                fontSize: '0.6rem',
                letterSpacing: '0.3em',
                textTransform: 'uppercase',
                color: teal,
                fontWeight: 500,
              }}
            >
              Preprod · Midnight × Cardano
            </Typography>
          </Box>

          {/* Headline — white with teal accent word */}
          <Typography
            variant="h1"
            sx={{
              fontWeight: 700,
              fontSize: { xs: '2.4rem', md: '3.6rem' },
              lineHeight: 1.1,
              letterSpacing: '-0.03em',
              color: '#FFFFFF',
            }}
          >
            Private cross-chain{' '}
            <Box
              component="span"
              sx={{
                color: teal,
                textShadow: `0 0 40px ${alpha(teal, 0.3)}`,
              }}
            >
              OTC settlement
            </Box>
          </Typography>

          {/* Subtitle */}
          <Typography
            sx={{
              color: alpha('#FFFFFF', 0.5),
              fontSize: { xs: '0.84rem', md: '0.95rem' },
              maxWidth: 540,
              lineHeight: 1.7,
            }}
          >
            Atomic swaps between Cardano USDM and Midnight USDC using hash-time-locked escrow.
            No custodian. No bridge. No trust required.
          </Typography>

          {/* CTA — teal button, black text */}
          <Button
            variant="contained"
            size="large"
            endIcon={<ArrowForwardIcon sx={{ fontSize: 18 }} />}
            onClick={() => navigate('/app')}
            sx={{
              px: 4,
              py: 1.75,
              fontSize: '0.88rem',
              fontWeight: 700,
              borderRadius: 1.5,
              bgcolor: teal,
              color: '#000000',
              boxShadow: `0 0 30px ${alpha(teal, 0.25)}, 0 6px 20px ${alpha(teal, 0.15)}`,
              '&:hover': {
                bgcolor: '#5EEAD4',
                boxShadow: `0 0 40px ${alpha(teal, 0.35)}, 0 8px 28px ${alpha(teal, 0.25)}`,
              },
            }}
          >
            Launch App
          </Button>
        </Stack>

        {/* ═══ FEATURE CARDS ═══ */}
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
                position: 'relative',
                p: 2.5,
                borderRadius: 2,
                border: `1px solid ${alpha('#FFFFFF', 0.08)}`,
                bgcolor: alpha('#FFFFFF', 0.02),
                backdropFilter: 'blur(8px)',
                overflow: 'hidden',
                transition: 'border-color 200ms ease, box-shadow 200ms ease',
                '&:hover': {
                  borderColor: alpha(teal, 0.25),
                  boxShadow: `0 0 20px ${alpha(teal, 0.06)}, inset 0 0 20px ${alpha(teal, 0.02)}`,
                },
                // Subtle aurora glow behind each card
                '&::before': {
                  content: '""',
                  position: 'absolute',
                  top: '-50%',
                  left: '50%',
                  transform: 'translateX(-50%)',
                  width: '120%',
                  height: '100%',
                  background: `radial-gradient(ellipse at center, ${alpha(
                    i % 2 === 0 ? teal : violet,
                    0.03,
                  )} 0%, transparent 70%)`,
                  pointerEvents: 'none',
                },
              }}
            >
              <Typography
                sx={{
                  fontSize: '0.58rem',
                  letterSpacing: '0.2em',
                  textTransform: 'uppercase',
                  color: teal,
                  fontWeight: 500,
                  mb: 0.75,
                  position: 'relative',
                  zIndex: 1,
                }}
              >
                {f.eyebrow}
              </Typography>
              <Typography
                sx={{
                  fontWeight: 600,
                  fontSize: '0.84rem',
                  color: '#FFFFFF',
                  mb: 0.5,
                  position: 'relative',
                  zIndex: 1,
                }}
              >
                {f.title}
              </Typography>
              <Typography
                sx={{
                  color: alpha('#FFFFFF', 0.4),
                  fontSize: '0.68rem',
                  lineHeight: 1.6,
                  position: 'relative',
                  zIndex: 1,
                }}
              >
                {f.text}
              </Typography>
            </Box>
          ))}
        </Box>
      </Box>

      {/* ═══ FOOTER ═══ */}
      <Box
        component="footer"
        sx={{
          position: 'relative',
          zIndex: 2,
          borderTop: `1px solid ${alpha('#FFFFFF', 0.06)}`,
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
              color: alpha('#FFFFFF', 0.25),
              letterSpacing: '0.02em',
            }}
          >
            KAAMOS · Cross-chain atomic settlement
          </Typography>
          <Typography
            sx={{
              fontSize: '0.62rem',
              color: alpha('#FFFFFF', 0.25),
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
