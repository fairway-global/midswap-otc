/**
 * Gate component — wraps a page and shows a wallet-connect card if either
 * wallet is missing. If the user has no extension installed, surface public
 * install links instead of a dead end.
 */

import React from 'react';
import { Alert, Box, Button, Link, Stack, Typography } from '@mui/material';
import { alpha, useTheme } from '@mui/material/styles';
import { useSwapContext } from '../hooks';

interface Props {
  readonly require: { midnight?: boolean; cardano?: boolean };
  readonly title?: string;
  readonly intro?: React.ReactNode;
  readonly children: React.ReactNode;
}

const hasMidnightExtension = (): boolean => {
  if (typeof window === 'undefined') return true;
  return typeof (window as { midnight?: unknown }).midnight !== 'undefined';
};

const hasCardanoExtension = (): boolean => {
  if (typeof window === 'undefined') return true;
  const cardano = (window as { cardano?: Record<string, unknown> }).cardano;
  return !!cardano && Object.keys(cardano).length > 0;
};

export const WalletGate: React.FC<Props> = ({ require, title, intro, children }) => {
  const theme = useTheme();
  const { session, cardano, connect, connectCardano, connecting, cardanoConnecting } = useSwapContext();
  const needsMidnight = !!require.midnight && !session;
  const needsCardano = !!require.cardano && !cardano;
  const ready = !needsMidnight && !needsCardano;

  if (ready) return <>{children}</>;

  const missingExt = {
    midnight: needsMidnight && !hasMidnightExtension(),
    cardano: needsCardano && !hasCardanoExtension(),
  };

  return (
    <Stack spacing={3} sx={{ width: '100%', maxWidth: 560, mx: 'auto', alignItems: 'center' }}>
      {title && <Typography variant="h4">{title}</Typography>}
      {intro}

      <Box
        sx={{
          width: '100%',
          p: 3,
          borderRadius: 4,
          border: `1px solid ${theme.custom.borderSubtle}`,
          bgcolor: theme.custom.surface1,
        }}
      >
        <Typography sx={{ fontWeight: 600, mb: 0.5 }}>Connect your wallets</Typography>
        <Typography variant="body2" sx={{ color: theme.custom.textSecondary, mb: 2 }}>
          This page needs{' '}
          {needsMidnight && 'a Midnight wallet (Lace)'}
          {needsMidnight && needsCardano && ' and '}
          {needsCardano && 'a Cardano CIP-30 wallet (Eternl recommended)'} to continue.
        </Typography>

        <Stack spacing={1.5}>
          {needsMidnight && (
            <Button
              variant="contained"
              color="primary"
              onClick={() => void connect()}
              disabled={connecting}
              fullWidth
            >
              {connecting ? 'Connecting to Midnight…' : 'Connect Midnight wallet'}
            </Button>
          )}
          {needsCardano && (
            <Button
              variant="contained"
              color="primary"
              onClick={() => void connectCardano()}
              disabled={cardanoConnecting}
              fullWidth
            >
              {cardanoConnecting ? 'Connecting to Cardano…' : 'Connect Cardano wallet'}
            </Button>
          )}
        </Stack>

        {(missingExt.midnight || missingExt.cardano) && (
          <Alert severity="warning" sx={{ mt: 2, bgcolor: alpha(theme.custom.warning, 0.08) }}>
            <Typography variant="body2" sx={{ mb: 1, fontWeight: 500 }}>
              Extension not detected:
            </Typography>
            <Stack spacing={0.5}>
              {missingExt.midnight && (
                <Link
                  href="https://docs.midnight.network/develop/tutorial/building/prereqs"
                  target="_blank"
                  rel="noopener"
                >
                  Install Lace for Midnight →
                </Link>
              )}
              {missingExt.cardano && (
                <Link href="https://eternl.io" target="_blank" rel="noopener">
                  Install Eternl for Cardano →
                </Link>
              )}
            </Stack>
          </Alert>
        )}
      </Box>
    </Stack>
  );
};
