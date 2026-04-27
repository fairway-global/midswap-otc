/**
 * /faucet — ContraClear-styled token faucet. Two-token selector
 * (USDC on Midnight, USDM on Cardano), recipient auto-filled from the
 * relevant connected wallet, single mint button.
 *
 *   - On submit, USDC routes through the existing usdcApi.mint(...) call
 *     and USDM through cardano-usdm.mintUsdm(...). No new minting code.
 *   - WalletGate ensures the relevant chain is connected.
 *   - Reads ?token= for legacy /mint and /mint-usdm redirects.
 *
 * Both mints are demo affordances — the underlying contracts have no
 * access control on preprod. Production would gate them.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Box, Stack, Typography } from '@mui/material';
import { alpha, useTheme } from '@mui/material/styles';
import { useSearchParams } from 'react-router-dom';
import { useSwapContext } from '../../hooks';
import { useToast } from '../../hooks/useToast';
import { AsyncButton } from '../AsyncButton';
import { WalletGate } from '../WalletGate';
import { hexToBytes, userEither } from '../../api/key-encoding';
import { mintUsdm } from '../../api/cardano-usdm';
import { TokenBadge } from '../swap/TokenBadge';
import { USDC, USDM, type TokenMeta } from '../swap/tokens';

type TokenChoice = 'USDC' | 'USDM';

const TOKENS: Array<{ key: TokenChoice; token: TokenMeta; chain: string; chainColor: string }> = [
  { key: 'USDC', token: USDC, chain: 'Midnight', chainColor: '#2DD4BF' },
  { key: 'USDM', token: USDM, chain: 'Cardano',  chainColor: '#06B6D4' },
];

const FaucetInner: React.FC<{ initial: TokenChoice }> = ({ initial }) => {
  const theme = useTheme();
  const toast = useToast();
  const { session, cardano } = useSwapContext();
  const [, setSearchParams] = useSearchParams();
  const [selected, setSelected] = useState<TokenChoice>(initial);
  const [amount, setAmount] = useState<string>('100');

  const recipient = useMemo<string>(() => {
    if (selected === 'USDC') return session?.bootstrap.unshieldedAddressBech32m ?? '';
    return cardano?.address ?? '';
  }, [selected, session, cardano]);

  useEffect(() => {
    setSearchParams({ token: selected }, { replace: true });
  }, [selected, setSearchParams]);

  const onMint = useCallback(async () => {
    const amt = BigInt(amount || '0');
    if (amt <= 0n) throw new Error('Amount must be positive');

    if (selected === 'USDC') {
      if (!session) throw new Error('Connect Midnight (Lace) first.');
      const hex = session.bootstrap.unshieldedAddressHex;
      const bytes = hexToBytes(hex);
      await session.usdcApi.mint(userEither(bytes), amt);
      toast.success(`Minted ${amount} USDC to your Midnight wallet`);
    } else {
      if (!cardano) throw new Error('Connect Cardano (Eternl/Lace) first.');
      const tx = await mintUsdm(cardano.cardanoHtlc.lucid, cardano.usdmPolicy, cardano.address, amt);
      toast.success(`Minted ${amount} USDM · tx ${tx.slice(0, 12)}…`);
    }
  }, [selected, amount, session, cardano, toast]);

  const selectedRow = TOKENS.find((t) => t.key === selected)!;

  return (
    <Box sx={{ mx: 'auto', maxWidth: 680, px: { xs: 2, md: 3 }, py: { xs: 4, md: 6 } }}>
      <Stack
        sx={{
          border: `1px solid ${theme.custom.borderSubtle}`,
          borderRadius: 2,
          overflow: 'hidden',
        }}
      >
        {/* Panel header */}
        <Stack
          direction="row"
          alignItems="center"
          sx={{
            px: 3,
            py: 2,
            borderBottom: `1px solid ${theme.custom.borderSubtle}`,
          }}
        >
          <Typography
            sx={{
              fontFamily: 'JetBrains Mono, monospace',
              fontSize: '0.7rem',
              letterSpacing: '0.24em',
              textTransform: 'uppercase',
              color: theme.custom.textMuted,
            }}
          >
            Token Faucet
          </Typography>
        </Stack>

        <Stack spacing={3} sx={{ p: 3 }}>
          <Typography sx={{ color: theme.custom.textMuted, fontSize: '0.78rem', lineHeight: 1.6 }}>
            Mint preprod test tokens to your connected wallet. Demo affordance — both mints are
            permissionless on preprod.
          </Typography>

          {/* Token selector */}
          <Box>
            <Typography
              sx={{
                mb: 1.25,
                fontFamily: 'JetBrains Mono, monospace',
                fontSize: '0.62rem',
                letterSpacing: '0.16em',
                textTransform: 'uppercase',
                color: theme.custom.textMuted,
              }}
            >
              Select Token
            </Typography>
            <Stack direction="row" spacing={1.5}>
              {TOKENS.map(({ key, token, chain, chainColor }) => {
                const isSelected = key === selected;
                return (
                  <Box
                    key={key}
                    role="button"
                    tabIndex={0}
                    onClick={() => setSelected(key)}
                    onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && setSelected(key)}
                    sx={{
                      flex: 1,
                      borderRadius: 1.5,
                      border: `1px solid ${isSelected ? theme.custom.teal : theme.custom.borderSubtle}`,
                      bgcolor: isSelected ? alpha(theme.custom.teal, 0.08) : 'transparent',
                      px: 2,
                      py: 1.5,
                      cursor: 'pointer',
                      transition: 'all 140ms ease',
                      '&:hover': {
                        borderColor: isSelected ? theme.custom.teal : alpha(theme.custom.teal, 0.4),
                        bgcolor: isSelected
                          ? alpha(theme.custom.teal, 0.12)
                          : alpha('#FFFFFF', 0.03),
                      },
                    }}
                  >
                    <Stack direction="row" spacing={1.25} alignItems="center">
                      <TokenBadge token={token} size={28} />
                      <Stack sx={{ minWidth: 0, flex: 1 }}>
                        <Typography sx={{ fontFamily: 'JetBrains Mono, monospace', fontWeight: 600, fontSize: '0.86rem' }}>
                          {key}
                        </Typography>
                        <Typography sx={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '0.6rem', color: chainColor, letterSpacing: '0.12em', textTransform: 'uppercase' }}>
                          {chain}
                        </Typography>
                      </Stack>
                    </Stack>
                  </Box>
                );
              })}
            </Stack>
          </Box>

          {/* Selected detail panel — token + amount input */}
          <Box
            sx={{
              borderRadius: 1.5,
              border: `1px solid ${alpha(theme.custom.teal, 0.18)}`,
              bgcolor: alpha(theme.custom.teal, 0.04),
              p: 2,
            }}
          >
            <Stack direction="row" spacing={2} alignItems="center">
              <TokenBadge token={selectedRow.token} size={44} />
              <Stack sx={{ flex: 1 }}>
                <Typography sx={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '1rem', fontWeight: 600 }}>
                  {selectedRow.key}
                </Typography>
                <Typography sx={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '0.66rem', color: theme.custom.textMuted, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
                  on {selectedRow.chain}
                </Typography>
              </Stack>
              <Box
                component="input"
                type="number"
                value={amount}
                onChange={(e) => setAmount((e.target as HTMLInputElement).value)}
                min="1"
                max="100000"
                placeholder="100"
                sx={{
                  width: 120,
                  textAlign: 'right',
                  bgcolor: '#000',
                  border: `1px solid ${theme.custom.borderSubtle}`,
                  borderRadius: 1,
                  color: theme.custom.textPrimary,
                  fontFamily: 'JetBrains Mono, monospace',
                  fontSize: '1rem',
                  fontWeight: 600,
                  px: 1.25,
                  py: 1,
                  outline: 'none',
                  '&:focus': { borderColor: theme.custom.teal },
                }}
              />
            </Stack>
          </Box>

          {/* Recipient */}
          <Box>
            <Typography
              sx={{
                mb: 0.75,
                fontFamily: 'JetBrains Mono, monospace',
                fontSize: '0.62rem',
                letterSpacing: '0.16em',
                textTransform: 'uppercase',
                color: theme.custom.textMuted,
              }}
            >
              Recipient
            </Typography>
            <Box
              sx={{
                bgcolor: '#000',
                border: `1px solid ${theme.custom.borderSubtle}`,
                borderRadius: 1,
                px: 1.5,
                py: 1.25,
                color: theme.custom.textMuted,
                fontFamily: 'JetBrains Mono, monospace',
                fontSize: '0.74rem',
                wordBreak: 'break-all',
                minHeight: 22,
              }}
            >
              {recipient || `Connect ${selectedRow.chain} wallet`}
            </Box>
          </Box>

          {/* Mint button */}
          <AsyncButton
            onClick={onMint}
            disabled={!recipient || !amount || Number(amount) <= 0}
            variant="contained"
            color="primary"
            fullWidth
            pendingLabel="Minting…"
            sx={{ height: 44, fontSize: '0.86rem' }}
          >
            Mint {amount || '0'} {selectedRow.key}
          </AsyncButton>

          <Typography
            sx={{
              fontFamily: 'JetBrains Mono, monospace',
              fontSize: '0.66rem',
              color: theme.custom.textMuted,
              textAlign: 'center',
              borderTop: `1px solid ${theme.custom.borderSubtle}`,
              pt: 2,
            }}
          >
            Preprod stablecoins. After minting you can post or quote on the order book.
          </Typography>
        </Stack>
      </Stack>
    </Box>
  );
};

export const Faucet: React.FC = () => {
  const [params] = useSearchParams();
  const initial: TokenChoice = (params.get('token') ?? '').toUpperCase() === 'USDM' ? 'USDM' : 'USDC';

  return (
    <WalletGate
      require={initial === 'USDC' ? { midnight: true } : { cardano: true }}
      title="Connect to mint test tokens"
      intro="The faucet mints test USDC on Midnight and test USDM on Cardano. Pick a token, enter an amount, sign in your wallet."
    >
      <FaucetInner initial={initial} />
    </WalletGate>
  );
};
