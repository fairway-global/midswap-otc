/**
 * /mint — self-serve USDC mint so first-time takers can hold some USDC before
 * attempting a swap. The Midnight USDC contract has no auth on `mint()` — this
 * is a demo affordance, clearly labelled as such.
 */

import React, { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  IconButton,
  InputAdornment,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import AutorenewIcon from '@mui/icons-material/Autorenew';
import { alpha, useTheme } from '@mui/material/styles';
import { useSwapContext } from '../hooks';
import { useToast } from '../hooks/useToast';
import { AsyncButton } from './AsyncButton';
import { WalletGate } from './WalletGate';
import { hexToBytes, userEither } from '../api/key-encoding';
import { TokenBadge } from './swap/TokenBadge';
import { USDC } from './swap/tokens';

const MintInner: React.FC = () => {
  const theme = useTheme();
  const { session, swapState } = useSwapContext();
  const toast = useToast();
  const [recipient, setRecipient] = useState<string>('');
  const [amount, setAmount] = useState<string>('10');
  const [lastMint, setLastMint] = useState<{ amount: string; recipient: string } | undefined>(undefined);

  useEffect(() => {
    if (session && !recipient) {
      setRecipient(session.bootstrap.unshieldedAddressHex);
    }
  }, [session, recipient]);

  const onMint = useCallback(async () => {
    if (!session) throw new Error('Midnight wallet not connected');
    const clean = recipient.trim().toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(clean)) {
      throw new Error('Recipient must be a 64-hex unshielded address.');
    }
    const amt = BigInt(amount);
    if (amt <= 0n) throw new Error('Amount must be a positive integer.');
    const recipientBytes = hexToBytes(clean);
    await session.usdcApi.mint(userEither(recipientBytes), amt);
    setLastMint({ amount, recipient: clean });
    toast.success(`Minted ${amount} USDC to ${clean.slice(0, 12)}…`);
  }, [session, recipient, amount, toast]);

  const onUseSelf = useCallback(() => {
    if (!session) return;
    setRecipient(session.bootstrap.unshieldedAddressHex);
  }, [session]);

  return (
    <Stack spacing={3} alignItems="center" sx={{ width: '100%' }}>
      <Stack spacing={1} sx={{ textAlign: 'center', maxWidth: 560 }}>
        <Stack direction="row" spacing={1} alignItems="center" justifyContent="center">
          <TokenBadge token={USDC} size={36} />
          <Typography variant="h4">Mint USDC</Typography>
        </Stack>
        <Typography sx={{ color: theme.custom.textSecondary }}>
          First time taking an offer? Mint some native USDC on Midnight so you have the asset in your 1AM wallet.
        </Typography>
      </Stack>

      <Box
        sx={{
          width: '100%',
          maxWidth: 480,
          p: 2.5,
          borderRadius: 4,
          border: `1px solid ${theme.custom.borderSubtle}`,
          bgcolor: theme.custom.surface1,
        }}
      >
        <Alert severity="info" sx={{ mb: 2 }}>
          This mint has <strong>no access control</strong> — it&apos;s a demo affordance for preprod. Any connected
          wallet can mint any amount.
        </Alert>

        <Stack spacing={2}>
          <TextField
            label="Recipient (Midnight unshielded, 64 hex)"
            value={recipient}
            onChange={(e) => setRecipient(e.target.value.trim().toLowerCase())}
            size="small"
            fullWidth
            InputProps={{
              endAdornment: (
                <InputAdornment position="end">
                  <IconButton onClick={onUseSelf} size="small" title="Use my connected wallet">
                    <AutorenewIcon fontSize="small" />
                  </IconButton>
                </InputAdornment>
              ),
            }}
            helperText="Tap the refresh icon to use your own connected wallet."
          />

          <TextField
            label="Amount"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            type="number"
            size="small"
            fullWidth
            InputProps={{ endAdornment: <InputAdornment position="end">USDC</InputAdornment> }}
            helperText="Native unshielded tokens — no decimals. 1 USDC = 1 native coin."
          />

          <Box
            sx={{
              p: 1.5,
              borderRadius: 2,
              bgcolor: alpha(theme.custom.cardanoBlue, 0.06),
              border: `1px solid ${alpha(theme.custom.cardanoBlue, 0.2)}`,
            }}
          >
            <Typography variant="caption" sx={{ color: theme.custom.textSecondary, display: 'block' }}>
              Token color{' '}
              <Typography
                component="span"
                sx={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '0.7rem', color: theme.custom.textMuted }}
              >
                {swapState.usdcColor.slice(0, 32)}…
              </Typography>
            </Typography>
          </Box>

          <AsyncButton variant="contained" color="primary" size="large" fullWidth onClick={onMint} pendingLabel="Signing in Midnight wallet…">
            Mint USDC
          </AsyncButton>

          {lastMint && (
            <Alert severity="success">
              Minted {lastMint.amount} USDC → {lastMint.recipient.slice(0, 16)}…
            </Alert>
          )}
        </Stack>
      </Box>

      <Stack direction="row" spacing={1}>
        <Button variant="text" href="https://faucet.preprod.midnight.network/" target="_blank" rel="noopener">
          Midnight preprod faucet →
        </Button>
      </Stack>
    </Stack>
  );
};

export const MintUsdc: React.FC = () => (
  <WalletGate require={{ midnight: true }} title="Mint USDC">
    <MintInner />
  </WalletGate>
);
