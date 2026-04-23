/**
 * Midswap home = the swap page. A tall hero with a headline, the SwapCard,
 * and a thin strip of "what this is" reassurance.
 */

import React from 'react';
import { Box, Chip, Stack, Typography, useTheme } from '@mui/material';
import ShieldIcon from '@mui/icons-material/Shield';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import HubIcon from '@mui/icons-material/Hub';
import { alpha } from '@mui/material/styles';
import { SwapCard } from './swap/SwapCard';

export const Home: React.FC = () => {
  const theme = useTheme();
  return (
    <Stack spacing={4} alignItems="center" sx={{ pt: { xs: 1, md: 3 } }}>
      <Stack spacing={1.5} alignItems="center" sx={{ textAlign: 'center', maxWidth: 680 }}>
        <Chip
          label="Preprod · Cardano × Midnight"
          color="primary"
          size="small"
          sx={{
            bgcolor: alpha(theme.custom.cardanoBlue, 0.15),
            color: theme.custom.cardanoBlue,
            fontWeight: 500,
          }}
        />
        <Typography variant="h3" sx={{ fontWeight: 700, lineHeight: 1.1, letterSpacing: '-0.02em' }}>
          Atomic swaps between{' '}
          <Box
            component="span"
            sx={{
              backgroundImage: theme.custom.accentGradient,
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              backgroundClip: 'text',
            }}
          >
            Cardano ADA
          </Box>{' '}
          and{' '}
          <Box
            component="span"
            sx={{
              backgroundImage: 'linear-gradient(135deg, #9C8BFF, #4725C9)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              backgroundClip: 'text',
            }}
          >
            Midnight USDC
          </Box>
        </Typography>
        <Typography sx={{ color: theme.custom.textSecondary, fontSize: '1.05rem' }}>
          Hash-time-locked escrow on both chains, no custodian, no bridge, no trust. Either both sides settle, or both
          sides reclaim.
        </Typography>
      </Stack>

      <SwapCard />

      <Stack
        direction={{ xs: 'column', md: 'row' }}
        spacing={{ xs: 2, md: 3 }}
        sx={{ width: '100%', maxWidth: 1100, mt: 2, color: theme.custom.textSecondary }}
      >
        <FeatureBullet icon={<ShieldIcon />} title="Trustless">
          Preimage locks mean either both sides settle or both sides reclaim — the worst case is a timeout, never theft.
        </FeatureBullet>
        <FeatureBullet icon={<HubIcon />} title="Cross-chain">
          A Cardano Aiken validator on one side, a Midnight Compact circuit on the other. No bridges, no wrapped assets.
        </FeatureBullet>
        <FeatureBullet icon={<AutoAwesomeIcon />} title="Self-custody">
          Your keys sign every move. Midswap is stateless relative to your funds — nothing custodial, nothing proxied.
        </FeatureBullet>
      </Stack>
    </Stack>
  );
};

const FeatureBullet: React.FC<{ icon: React.ReactNode; title: string; children: React.ReactNode }> = ({
  icon,
  title,
  children,
}) => {
  const theme = useTheme();
  return (
    <Box
      sx={{
        flex: 1,
        minWidth: 0,
        p: { xs: 2.5, md: 3.25 },
        borderRadius: 4,
        border: `1px solid ${theme.custom.borderSubtle}`,
        bgcolor: alpha(theme.custom.surface1, 0.6),
      }}
    >
      <Stack direction="row" spacing={1.5} alignItems="center" sx={{ mb: 1.25 }}>
        <Box
          sx={{
            width: 36,
            height: 36,
            borderRadius: 2.5,
            bgcolor: alpha(theme.custom.cardanoBlue, 0.16),
            color: theme.custom.cardanoBlue,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {icon}
        </Box>
        <Typography sx={{ fontWeight: 600, fontSize: '1.05rem', color: theme.custom.textPrimary }}>{title}</Typography>
      </Stack>
      <Typography sx={{ color: theme.custom.textSecondary, fontSize: '0.95rem', lineHeight: 1.55 }}>
        {children}
      </Typography>
    </Box>
  );
};
