/**
 * /mint-usdm — self-serve USDM mint so first-time makers/takers can hold some
 * USDM on Cardano before attempting a swap. Mirror of `MintUsdc.tsx` — the
 * USDM Aiken policy has no access control (always-true validator), so this is
 * a demo affordance clearly labelled as such.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Alert, Box, Button, IconButton, InputAdornment, Stack, TextField, Typography } from '@mui/material';
import AutorenewIcon from '@mui/icons-material/Autorenew';
import { alpha, useTheme } from '@mui/material/styles';
import { useSwapContext } from '../hooks';
import { useToast } from '../hooks/useToast';
import { AsyncButton } from './AsyncButton';
import { WalletGate } from './WalletGate';
import { TokenBadge } from './swap/TokenBadge';
import { USDM } from './swap/tokens';
import { mintUsdm } from '../api/cardano-usdm';

const MintInner: React.FC = () => {
  const theme = useTheme();
  const { cardano } = useSwapContext();
  const toast = useToast();
  const [recipient, setRecipient] = useState<string>('');
  const [amount, setAmount] = useState<string>('100');
  const [lastMint, setLastMint] = useState<{ amount: string; recipient: string } | undefined>(undefined);

  useEffect(() => {
    if (cardano && !recipient) {
      setRecipient(cardano.address);
    }
  }, [cardano, recipient]);

  const onMint = useCallback(async () => {
    if (!cardano) throw new Error('Cardano wallet not connected');
    const addr = recipient.trim();
    if (!addr.startsWith('addr')) {
      throw new Error('Recipient must be a Cardano bech32 address (addr… or addr_test…).');
    }
    const amt = BigInt(amount);
    if (amt <= 0n) throw new Error('Amount must be a positive integer.');
    const txHash = await mintUsdm(cardano.cardanoHtlc.lucid, cardano.usdmPolicy, addr, amt);
    setLastMint({ amount, recipient: addr });
    toast.success(`Minted ${amount} USDM · tx ${txHash.slice(0, 16)}…`);
  }, [cardano, recipient, amount, toast]);

  const onUseSelf = useCallback(() => {
    if (!cardano) return;
    setRecipient(cardano.address);
  }, [cardano]);

  return (
    <Stack spacing={3} alignItems="center" sx={{ width: '100%' }}>
      <Stack spacing={1} sx={{ textAlign: 'center', maxWidth: 560 }}>
        <Stack direction="row" spacing={1} alignItems="center" justifyContent="center">
          <TokenBadge token={USDM} size={36} />
          <Typography variant="h4">Mint USDM</Typography>
        </Stack>
        <Typography sx={{ color: theme.custom.textSecondary }}>
          First time swapping? Mint some USDM on Cardano preprod so you have the asset in your wallet.
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
          wallet can mint any amount. You&apos;ll need a small amount of ADA in the target wallet for tx fees and
          min-UTxO (~2 ADA).
        </Alert>

        <Stack spacing={2}>
          <TextField
            label="Recipient (Cardano bech32 address)"
            value={recipient}
            onChange={(e) => setRecipient(e.target.value.trim())}
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
            InputProps={{ endAdornment: <InputAdornment position="end">USDM</InputAdornment> }}
            helperText="Native Cardano token — no decimals. 1 USDM = 1 native unit."
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
              Policy ID{' '}
              <Typography
                component="span"
                sx={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '0.7rem', color: theme.custom.textMuted }}
              >
                {cardano?.usdmPolicy.policyId.slice(0, 32)}…
              </Typography>
            </Typography>
          </Box>

          <AsyncButton
            variant="contained"
            color="primary"
            size="large"
            fullWidth
            onClick={onMint}
            pendingLabel="Signing in Cardano wallet…"
          >
            Mint USDM
          </AsyncButton>

          {lastMint && (
            <Alert severity="success">
              Minted {lastMint.amount} USDM → {lastMint.recipient.slice(0, 20)}…
            </Alert>
          )}
        </Stack>
      </Box>

      <Stack direction="row" spacing={1}>
        <Button variant="text" href="https://docs.cardano.org/cardano-testnets/tools/faucet" target="_blank" rel="noopener">
          Cardano preprod faucet →
        </Button>
      </Stack>
    </Stack>
  );
};

export const MintUsdm: React.FC = () => (
  <WalletGate require={{ cardano: true }} title="Mint USDM">
    <MintInner />
  </WalletGate>
);
