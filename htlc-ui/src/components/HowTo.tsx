/**
 * /how — onboarding walkthrough. Generic maker/taker language (no Alice/Bob).
 * Renders without the swap context so it loads even if the stack is down.
 */

import React from 'react';
import { Alert, Box, Chip, Divider, Link, List, ListItem, Stack, Typography } from '@mui/material';
import { alpha, useTheme } from '@mui/material/styles';
import { Link as RouterLink } from 'react-router-dom';
import { TokenBadge } from './swap/TokenBadge';
import { USDM, USDC } from './swap/tokens';

const Step: React.FC<{ n: number; title: string; children: React.ReactNode }> = ({ n, title, children }) => {
  const theme = useTheme();
  return (
    <Stack direction="row" spacing={2} alignItems="flex-start">
      <Box
        sx={{
          minWidth: 32,
          height: 32,
          borderRadius: '50%',
          bgcolor: alpha(theme.custom.cardanoBlue, 0.15),
          color: theme.custom.cardanoBlue,
          fontWeight: 600,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: '0.9rem',
        }}
      >
        {n}
      </Box>
      <Box sx={{ flex: 1 }}>
        <Typography sx={{ fontWeight: 600, mb: 0.5 }}>{title}</Typography>
        <Typography variant="body2" sx={{ color: theme.custom.textSecondary }}>
          {children}
        </Typography>
      </Box>
    </Stack>
  );
};

const SectionCard: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => {
  const theme = useTheme();
  return (
    <Box
      sx={{
        p: 3,
        borderRadius: 4,
        border: `1px solid ${theme.custom.borderSubtle}`,
        bgcolor: theme.custom.surface1,
      }}
    >
      <Typography variant="h5" sx={{ mb: 2 }}>
        {title}
      </Typography>
      {children}
    </Box>
  );
};

export const HowTo: React.FC = () => {
  const theme = useTheme();
  return (
    <Stack spacing={3} sx={{ width: '100%', maxWidth: 880, mx: 'auto' }}>
      <Stack spacing={1} alignItems="center" sx={{ textAlign: 'center' }}>
        <Chip
          label="Protocol"
          size="small"
          sx={{
            bgcolor: alpha(theme.custom.cardanoBlue, 0.15),
            color: theme.custom.cardanoBlue,
            fontWeight: 500,
          }}
        />
        <Typography variant="h3">How Midswap works</Typography>
        <Typography sx={{ color: theme.custom.textSecondary, maxWidth: 640 }}>
          Trade USDM on Cardano ↔ native USDC on Midnight without trusting a counterparty or a custodian. Hash-time-lock
          escrow on both chains guarantees either both sides settle or both sides reclaim.
        </Typography>
      </Stack>

      <SectionCard title="What you'll need">
        <List dense disablePadding>
          <ListItem sx={{ px: 0 }}>
            <Typography variant="body2">
              <strong>Midnight wallet.</strong>{' '}
              <Link
                href="https://docs.midnight.network/develop/tutorial/building/prereqs"
                target="_blank"
                rel="noopener"
              >
                Install Lace for Midnight
              </Link>{' '}
              + some tNight for fees. Grab from the{' '}
              <Link href="https://faucet.preprod.midnight.network/" target="_blank" rel="noopener">
                preprod faucet
              </Link>
              . Dust sync can take ~15 minutes the first time.
            </Typography>
          </ListItem>
          <ListItem sx={{ px: 0 }}>
            <Typography variant="body2">
              <strong>Cardano wallet.</strong>{' '}
              <Link href="https://eternl.io" target="_blank" rel="noopener">
                Install Eternl
              </Link>{' '}
              configured for the <em>Preprod</em> network, plus some ADA (for tx fees & min-UTxO) from the{' '}
              <Link href="https://docs.cardano.org/cardano-testnets/tools/faucet" target="_blank" rel="noopener">
                Cardano preprod faucet
              </Link>
              . For test USDM on Cardano use the{' '}
              <RouterLink to="/faucet?token=USDM" style={{ color: theme.custom.teal }}>
                Faucet
              </RouterLink>{' '}
              .
            </Typography>
          </ListItem>
          <ListItem sx={{ px: 0 }}>
            <Typography variant="body2">
              <strong>For takers:</strong> native USDC in your Midnight wallet before starting. Use the{' '}
              <RouterLink to="/faucet?token=USDC" style={{ color: theme.custom.teal }}>
                Faucet
              </RouterLink>{' '}
              — one signature is enough.
            </Typography>
          </ListItem>
        </List>
      </SectionCard>

      <SectionCard title="Making an offer (you have USDM, want USDC)">
        <Stack spacing={2.5}>
          <Step n={1} title="Set the amounts and the counterparty">
            Enter how much USDM you&apos;re willing to lock and how much USDC you want in return. Paste your
            counterparty&apos;s Cardano address or 56-hex payment key hash — this binds the lock to their wallet
            on-chain.
          </Step>
          <Step n={2} title="Lock USDM on Cardano">
            One Eternl signature posts an HTLC UTxO. Only the counterparty can claim, and only with the secret preimage
            you hold.
          </Step>
          <Step n={3} title="Share the offer">
            Midswap shows a share URL + QR. Send it over any channel — it embeds every value the counterparty needs.
          </Step>
          <Step n={4} title="Watch for the deposit">
            We scan Midnight for the counterparty&apos;s USDC deposit. When it lands, your claim button unlocks.
          </Step>
          <Step n={5} title="Claim USDC on Midnight (reveals the preimage)">
            One signature calls <code>withdrawWithPreimage</code>. The circuit records the preimage publicly so the
            counterparty can complete their side on Cardano.
          </Step>
        </Stack>
      </SectionCard>

      <SectionCard title="Taking an offer (you have USDC, want USDM)">
        <Stack spacing={2.5}>
          <Step n={1} title="Open the offer URL (or use Browse)">
            Paste the maker&apos;s share URL or pick an offer from{' '}
            <RouterLink to="/browse" style={{ color: theme.custom.cardanoBlue }}>
              Browse
            </RouterLink>
            . Midswap fills in the hash, amounts, and deadline for you.
          </Step>
          <Step n={2} title="Verify the lock and deadline">
            We confirm the lock exists on Cardano and is bound to your wallet. If the deadline is too tight, we abort
            and tell you why.
          </Step>
          <Step n={3} title="Deposit USDC on Midnight">
            One signature calls <code>htlc.deposit</code> with a deadline strictly inside the maker&apos;s. Your USDC is
            escrowed.
          </Step>
          <Step n={4} title="Wait for the preimage">
            Once the maker claims their USDC, the preimage is published on Midnight. Midswap races the indexer and the
            orchestrator to surface it as soon as possible.
          </Step>
          <Step n={5} title="Claim USDM on Cardano">
            One signature spends the maker&apos;s HTLC UTxO with the preimage. Swap complete.
          </Step>
        </Stack>
      </SectionCard>

      <SectionCard title="If something goes wrong">
        <Typography variant="body2" sx={{ color: theme.custom.textSecondary, mb: 1.5 }}>
          No one can steal your funds — the worst case is a timeout, and funds reclaim to the original sender.
        </Typography>
        <Alert severity="info">
          Visit{' '}
          <RouterLink to="/reclaim" style={{ color: theme.custom.cardanoBlue }}>
            Reclaim
          </RouterLink>{' '}
          — the page lists refundable swaps for your connected wallet and submits the recovery in one click.
        </Alert>
      </SectionCard>

      <SectionCard title="Where does the trust come from?">
        <Typography variant="body2" sx={{ color: theme.custom.textSecondary }}>
          Nowhere. SHA-256 is the atomic link: revealing the preimage to claim USDC on Midnight publishes it on-chain;
          claiming USDM on Cardano requires the same preimage. Deadlines are staggered — the taker side always expires
          first — so whoever doesn&apos;t act in time can reclaim without anyone losing funds.
        </Typography>
        <Divider sx={{ my: 2 }} />
        <Stack direction="row" spacing={2} alignItems="center" flexWrap="wrap" useFlexGap>
          <TokenBadge token={USDM} size={28} />
          <Typography variant="body2">Aiken validator on Cardano</Typography>
          <Box sx={{ mx: 1 }}>·</Box>
          <TokenBadge token={USDC} size={28} />
          <Typography variant="body2">Compact circuit on Midnight</Typography>
        </Stack>
      </SectionCard>
    </Stack>
  );
};
