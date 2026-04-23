/**
 * Midswap OTC workspace — the SwapCard is the focus.
 *
 * This is the /app route: clean, focused, no marketing copy.
 * The hero + feature panels now live on the LandingPage ("/").
 */

import React from 'react';
import { Stack } from '@mui/material';
import { SwapCard } from './swap/SwapCard';

export const Home: React.FC = () => {
  return (
    <Stack spacing={3} alignItems="center" sx={{ pt: { xs: 1, md: 2 } }}>
      <SwapCard />
    </Stack>
  );
};
