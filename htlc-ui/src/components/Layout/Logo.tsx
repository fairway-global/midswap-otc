/**
 * KAAMOS logo — flame icon + wordmark image.
 *
 * Mirrors the landing-page sticky-nav logo so the app header reads as the
 * same brand mark (same flame asset, same wordmark, same proportions).
 *
 * The negative margins on the flame are intentional: the source PNG has
 * generous transparent padding around the aurora glow, and the negative
 * margins crop that padding visually so the mark sits tight against the
 * wordmark — matching `.klp .logo-img--small` in `landing/LandingCSS.ts`.
 */

import React from 'react';
import { Box } from '@mui/material';

export const Logo: React.FC<{ compact?: boolean }> = ({ compact }) => (
  <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5, userSelect: 'none' }}>
    <Box
      component="img"
      src="/kaamos-full.png"
      alt="KAAMOS"
      sx={{
        height: 60,
        width: 'auto',
        margin: '-12px -8px -12px -4px',
        objectFit: 'contain',
        flexShrink: 0,
      }}
    />
    {!compact && (
      <Box
        component="img"
        src="/kaamos-wordmark.png"
        alt="KAAMOS"
        sx={{
          height: 26,
          width: 'auto',
          objectFit: 'contain',
          flexShrink: 0,
        }}
      />
    )}
  </Box>
);
