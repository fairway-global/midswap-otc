/**
 * /how — onboarding walkthrough. Generic maker/taker language (no Alice/Bob).
 * Renders without the swap context so it loads even if the stack is down.
 */

import React from 'react';
import { Alert, Box, Chip, Divider, Link, List, ListItem, Stack, Typography } from '@mui/material';
import { alpha, useTheme } from '@mui/material/styles';
import { Link as RouterLink, useNavigate } from 'react-router-dom';
import { TokenBadge } from './swap/TokenBadge';
import { USDM, USDC } from './swap/tokens';

const auroraViolet = '#7C3AED';
const bridgeCyan = '#06B6D4';

const AuroraBar: React.FC<{ width?: string | number }> = ({ width = '100%' }) => (
  <Box
    aria-hidden
    sx={{
      width,
      height: '1px',
      background: `linear-gradient(90deg, transparent 0%, ${alpha(auroraViolet, 0.45)} 22%, #2DD4BF 50%, ${alpha(bridgeCyan, 0.55)} 72%, transparent 100%)`,
      boxShadow: `0 0 10px ${alpha('#2DD4BF', 0.35)}`,
      filter: 'blur(0.2px)',
    }}
  />
);

const Eyebrow: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const theme = useTheme();
  return (
    <Typography
      component="span"
      sx={{
        fontFamily: '"JetBrains Mono","SF Mono",ui-monospace,monospace',
        fontSize: '10px',
        fontWeight: 500,
        letterSpacing: '0.22em',
        textTransform: 'uppercase',
        color: theme.custom.teal,
      }}
    >
      {children}
    </Typography>
  );
};

const Step: React.FC<{ n: number; title: string; children: React.ReactNode }> = ({ n, title, children }) => {
  const theme = useTheme();
  const num = String(n).padStart(2, '0');
  return (
    <Stack direction="row" spacing={2.25} alignItems="flex-start">
      <Box
        sx={{
          minWidth: 38,
          height: 38,
          borderRadius: '4px',
          border: `1px solid ${alpha(theme.custom.teal, 0.35)}`,
          background: `linear-gradient(135deg, ${alpha(theme.custom.teal, 0.08)} 0%, transparent 100%)`,
          color: theme.custom.teal,
          fontFamily: '"JetBrains Mono","SF Mono",ui-monospace,monospace',
          fontWeight: 500,
          letterSpacing: '0.05em',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: '0.85rem',
          flexShrink: 0,
        }}
      >
        {num}
      </Box>
      <Box sx={{ flex: 1, pt: 0.5 }}>
        <Typography sx={{ fontWeight: 600, mb: 0.5, color: '#fff', letterSpacing: '-0.005em' }}>{title}</Typography>
        <Typography variant="body2" sx={{ color: theme.custom.textSecondary, lineHeight: 1.7 }}>
          {children}
        </Typography>
      </Box>
    </Stack>
  );
};

const SectionCard: React.FC<{ tag: string; title: string; children: React.ReactNode }> = ({ tag, title, children }) => {
  const theme = useTheme();
  return (
    <Box
      sx={{
        position: 'relative',
        p: { xs: 2.5, sm: 3.5 },
        borderRadius: '4px',
        border: `1px solid ${theme.custom.borderSubtle}`,
        background: `linear-gradient(165deg, ${alpha(auroraViolet, 0.04)} 0%, ${alpha('#2DD4BF', 0.02)} 45%, transparent 100%)`,
        overflow: 'hidden',
        '&::before': {
          content: '""',
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          height: '1px',
          background: `linear-gradient(90deg, transparent, ${alpha('#2DD4BF', 0.5)}, transparent)`,
          opacity: 0.7,
        },
      }}
    >
      {/* corner brackets */}
      {([
        { top: 8, left: 8, borderTop: '1px', borderLeft: '1px' },
        { top: 8, right: 8, borderTop: '1px', borderRight: '1px' },
        { bottom: 8, left: 8, borderBottom: '1px', borderLeft: '1px' },
        { bottom: 8, right: 8, borderBottom: '1px', borderRight: '1px' },
      ] as const).map((pos, i) => (
        <Box
          key={i}
          aria-hidden
          sx={{
            position: 'absolute',
            width: 10,
            height: 10,
            borderColor: alpha(theme.custom.teal, 0.55),
            borderStyle: 'solid',
            borderWidth: 0,
            opacity: 0.7,
            pointerEvents: 'none',
            ...pos,
          }}
        />
      ))}

      <Stack spacing={2.25} sx={{ position: 'relative' }}>
        <Stack spacing={0.75}>
          <Eyebrow>{tag}</Eyebrow>
          <Typography
            variant="h5"
            sx={{
              fontFamily: 'Inter, "InterVariable", -apple-system, sans-serif',
              fontWeight: 300,
              letterSpacing: '-0.015em',
              color: '#fff',
            }}
          >
            {title}
          </Typography>
        </Stack>
        <Box sx={{ height: '1px', background: alpha('#FFFFFF', 0.06) }} />
        {children}
      </Stack>
    </Box>
  );
};

export const HowTo: React.FC = () => {
  const theme = useTheme();
  const navigate = useNavigate();
  return (
    <Box sx={{ width: '100%', display: 'flex', justifyContent: 'center' }}>
    <Stack spacing={4} sx={{ width: '100%', maxWidth: 920, pb: 6 }}>
      {/* Hero */}
      <Stack spacing={2.5} alignItems="center" sx={{ textAlign: 'center', pt: 3 }}>
        <Stack direction="row" spacing={1.5} alignItems="center">
          <Box sx={{ width: 24, height: '1px', background: alpha(theme.custom.teal, 0.6) }} />
          <Eyebrow>Protocol · Kaamos</Eyebrow>
          <Box sx={{ width: 24, height: '1px', background: alpha(theme.custom.teal, 0.6) }} />
        </Stack>
        <Typography
          variant="h3"
          sx={{
            fontFamily: 'Inter, "InterVariable", -apple-system, sans-serif',
            fontWeight: 300,
            letterSpacing: '-0.02em',
            color: '#fff',
            fontSize: { xs: '2rem', sm: '2.6rem', md: '3rem' },
          }}
        >
          How Kaamos Works
        </Typography>
        <Box sx={{ width: 200, mt: 0.5 }}><AuroraBar /></Box>
        <Typography
          sx={{
            color: theme.custom.textSecondary,
            maxWidth: 680,
            fontSize: '0.95rem',
            lineHeight: 1.75,
            fontFamily: '"JetBrains Mono","SF Mono",ui-monospace,monospace',
          }}
        >
          Trade <Box component="span" sx={{ color: '#fff', fontWeight: 500 }}>USDM on Cardano</Box> ⇄{' '}
          <Box component="span" sx={{ color: '#fff', fontWeight: 500 }}>USDC on Midnight</Box> without trusting a counterparty
          or a custodian. Hash-time-lock escrow on both chains guarantees either both sides settle, or both sides reclaim —
          never anything in between.
        </Typography>
        <Stack direction="row" spacing={1.5} flexWrap="wrap" justifyContent="center" sx={{ mt: 1 }} useFlexGap>
          {['Atomic Bilateral Settlement', 'Self-Custody', 'No Bridge', 'No Custodian'].map((label) => (
            <Chip
              key={label}
              label={label}
              size="small"
              sx={{
                bgcolor: alpha(theme.custom.teal, 0.08),
                color: theme.custom.teal,
                fontFamily: '"JetBrains Mono","SF Mono",ui-monospace,monospace',
                fontSize: '11px',
                letterSpacing: '0.04em',
                fontWeight: 500,
                height: 26,
              }}
            />
          ))}
        </Stack>
      </Stack>

      <SectionCard tag="00 · Prerequisites" title="What you'll need">
        <List dense disablePadding sx={{ '& li': { display: 'list-item', py: 0.4 } }}>
          <ListItem sx={{ px: 0 }}>
            <Typography variant="body2" sx={{ color: theme.custom.textSecondary, lineHeight: 1.75 }}>
              <Box component="strong" sx={{ color: '#fff' }}>Midnight wallet.</Box>{' '}
              <Link href="https://1am.xyz" target="_blank" rel="noopener" sx={{ color: theme.custom.teal }}>
                Install 1AM for Midnight
              </Link>
              {' '}+ some tNight for fees. Grab from the{' '}
              <Link href="https://faucet.preprod.midnight.network/" target="_blank" rel="noopener" sx={{ color: theme.custom.teal }}>
               Midnight preprod faucet
              </Link>
              . For test USDC on Midnight use the{' '}
              <RouterLink to="/faucet?token=USDC" style={{ color: theme.custom.teal }}>Faucet</RouterLink>. Dust sync can take ~15 minutes the first time.
            </Typography>
          </ListItem>
          <ListItem sx={{ px: 0 }}>
            <Typography variant="body2" sx={{ color: theme.custom.textSecondary, lineHeight: 1.75 }}>
              <Box component="strong" sx={{ color: '#fff' }}>Cardano wallet.</Box>{' '}
              <Link href="https://www.lace.io" target="_blank" rel="noopener" sx={{ color: theme.custom.teal }}>
                Install Lace
              </Link>
              {' '}configured for the <em>Preprod</em> network, plus some ADA (for tx fees & min-UTxO) from the{' '}
              <Link href="https://docs.cardano.org/cardano-testnets/tools/faucet" target="_blank" rel="noopener" sx={{ color: theme.custom.teal }}>
                Cardano preprod faucet
              </Link>
              . For test USDM on Cardano use the{' '}
              <RouterLink to="/faucet?token=USDM" style={{ color: theme.custom.teal }}>Faucet</RouterLink>.
            </Typography>
          </ListItem>
          <ListItem sx={{ px: 0 }}>
            <Typography variant="body2" sx={{ color: theme.custom.textSecondary, lineHeight: 1.75 }}>
              <Box component="strong" sx={{ color: '#fff' }}>For takers:</Box> native USDC in your Midnight wallet before
              starting. Use the{' '}
              <RouterLink to="/faucet?token=USDC" style={{ color: theme.custom.teal }}>Faucet</RouterLink> — one signature
              is enough.
            </Typography>
          </ListItem>
        </List>
      </SectionCard>

      <SectionCard tag="01 · Maker Flow" title="Making an offer (you have USDM, want USDC)">
        <Stack spacing={2.5}>
          <Step n={1} title="Set the amounts and the counterparty">
            Enter how much USDM you&apos;re willing to lock and how much USDC you want in return. Paste your
            counterparty&apos;s Cardano address or 56-hex payment key hash — this binds the lock to their wallet on-chain.
          </Step>
          <Step n={2} title="Lock USDM on Cardano">
            One Lace signature posts an HTLC UTxO. Only the counterparty can claim, and only with the secret preimage
            you hold.
          </Step>
          <Step n={3} title="Share the offer">
            Kaamos shows a share URL + QR. Send it over any channel — it embeds every value the counterparty needs.
          </Step>
          <Step n={4} title="Watch for the deposit">
            We scan Midnight for the counterparty&apos;s USDC deposit. When it lands, your claim button unlocks.
          </Step>
          <Step n={5} title="Claim USDC on Midnight (reveals the preimage)">
            One signature calls{' '}
            <Box component="code" sx={{
              fontFamily: '"JetBrains Mono","SF Mono",ui-monospace,monospace',
              fontSize: '0.85em',
              color: theme.custom.teal,
              bgcolor: alpha(theme.custom.teal, 0.08),
              px: 0.6,
              py: 0.1,
              borderRadius: '3px',
            }}>withdrawWithPreimage</Box>. The circuit records the preimage publicly so the counterparty can complete
            their side on Cardano.
          </Step>
        </Stack>
      </SectionCard>

      <SectionCard tag="02 · Taker Flow" title="Taking an offer (you have USDC, want USDM)">
        <Stack spacing={2.5}>
          <Step n={1} title="Open the offer URL (or use Browse)">
            Paste the maker&apos;s share URL or pick an offer from{' '}
            <RouterLink to="/browse" style={{ color: theme.custom.teal }}>Browse</RouterLink>. Kaamos fills in the hash,
            amounts, and deadline for you.
          </Step>
          <Step n={2} title="Verify the lock and deadline">
            We confirm the lock exists on Cardano and is bound to your wallet. If the deadline is too tight, we abort and
            tell you why.
          </Step>
          <Step n={3} title="Deposit USDC on Midnight">
            One signature calls{' '}
            <Box component="code" sx={{
              fontFamily: '"JetBrains Mono","SF Mono",ui-monospace,monospace',
              fontSize: '0.85em',
              color: theme.custom.teal,
              bgcolor: alpha(theme.custom.teal, 0.08),
              px: 0.6,
              py: 0.1,
              borderRadius: '3px',
            }}>htlc.deposit</Box> with a deadline strictly inside the maker&apos;s. Your USDC is escrowed.
          </Step>
          <Step n={4} title="Wait for the preimage">
            Once the maker claims their USDC, the preimage is published on Midnight. Kaamos races the indexer and the
            orchestrator to surface it as soon as possible.
          </Step>
          <Step n={5} title="Claim USDM on Cardano">
            One signature spends the maker&apos;s HTLC UTxO with the preimage. Swap complete.
          </Step>
        </Stack>
      </SectionCard>

      <SectionCard tag="03 · Failure Modes" title="If something goes wrong">
        <Typography variant="body2" sx={{ color: theme.custom.textSecondary, lineHeight: 1.75 }}>
          No one can steal your funds — the worst case is a timeout, and funds reclaim to the original sender.
        </Typography>
        <Alert
          severity="info"
          icon={false}
          sx={{
            mt: 1,
            bgcolor: alpha(theme.custom.teal, 0.06),
            border: `1px solid ${alpha(theme.custom.teal, 0.25)}`,
            color: theme.custom.textSecondary,
            borderRadius: '4px',
            '& .MuiAlert-message': { width: '100%' },
          }}
        >
          <Typography variant="body2" sx={{ color: theme.custom.textSecondary }}>
            Visit{' '}
            <RouterLink to="/reclaim" style={{ color: theme.custom.teal, fontWeight: 500 }}>Reclaim</RouterLink> — the
            page lists refundable swaps for your connected wallet and submits the recovery in one click.
          </Typography>
        </Alert>
      </SectionCard>

      <SectionCard tag="04 · Trust Model" title="Where does the trust come from?">
        <Typography variant="body2" sx={{ color: theme.custom.textSecondary, lineHeight: 1.75 }}>
          Nowhere. SHA-256 is the atomic link: revealing the preimage to claim USDC on Midnight publishes it on-chain;
          claiming USDM on Cardano requires the same preimage. Deadlines are staggered — the taker side always expires
          first — so whoever doesn&apos;t act in time can reclaim without anyone losing funds.
        </Typography>
        <Divider sx={{ my: 0.5, borderColor: alpha('#FFFFFF', 0.06) }} />
        <Stack direction="row" spacing={2} alignItems="center" flexWrap="wrap" useFlexGap>
          <Stack direction="row" spacing={1} alignItems="center">
            <TokenBadge token={USDM} size={26} />
            <Typography variant="body2" sx={{ color: theme.custom.textSecondary }}>
              Aiken validator on Cardano
            </Typography>
          </Stack>
          <Box sx={{ color: alpha('#FFFFFF', 0.2), mx: 0.5 }}>·</Box>
          <Stack direction="row" spacing={1} alignItems="center">
            <TokenBadge token={USDC} size={26} />
            <Typography variant="body2" sx={{ color: theme.custom.textSecondary }}>
              Compact circuit on Midnight
            </Typography>
          </Stack>
        </Stack>
      </SectionCard>

      {/* Closing CTA */}
      <Box
        sx={{
          position: 'relative',
          p: { xs: 3, sm: 4 },
          borderRadius: '4px',
          border: `1px solid ${theme.custom.borderSubtle}`,
          background: `radial-gradient(120% 100% at 0% 0%, ${alpha(auroraViolet, 0.08)}, transparent 60%), radial-gradient(80% 100% at 100% 100%, ${alpha('#2DD4BF', 0.06)}, transparent 60%)`,
          overflow: 'hidden',
          textAlign: 'center',
          '&::before': {
            content: '""',
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            height: '1px',
            background: `linear-gradient(90deg, transparent, ${alpha(auroraViolet, 0.5)} 30%, ${alpha('#2DD4BF', 0.85)} 50%, ${alpha(bridgeCyan, 0.5)} 70%, transparent)`,
          },
        }}
      >
        <Stack spacing={2} alignItems="center">
          <Eyebrow>Ready</Eyebrow>
          <Typography
            variant="h5"
            sx={{
              fontFamily: 'Inter, "InterVariable", -apple-system, sans-serif',
              fontWeight: 300,
              color: '#fff',
              letterSpacing: '-0.01em',
            }}
          >
            Execute your first cross-chain trade.
          </Typography>
          <Stack direction="row" spacing={1.5} flexWrap="wrap" justifyContent="center" useFlexGap>
            <Box
              component="button"
              onClick={() => navigate('/app')}
              sx={{
                cursor: 'pointer',
                bgcolor: '#fff',
                color: '#000',
                border: 'none',
                px: 3,
                py: 1.25,
                borderRadius: '8px',
                fontFamily: '"JetBrains Mono","SF Mono",ui-monospace,monospace',
                fontSize: '13px',
                fontWeight: 500,
                transition: 'transform .2s ease, box-shadow .2s ease',
                '&:hover': { transform: 'translateY(-1px)', boxShadow: `0 8px 24px ${alpha('#2DD4BF', 0.25)}` },
              }}
            >
              Launch App
            </Box>
            <Box
              component="button"
              onClick={() => navigate('/orderbook')}
              sx={{
                cursor: 'pointer',
                bgcolor: 'transparent',
                color: '#fff',
                border: `1px solid ${alpha('#FFFFFF', 0.2)}`,
                px: 3,
                py: 1.25,
                borderRadius: '8px',
                fontFamily: '"JetBrains Mono","SF Mono",ui-monospace,monospace',
                fontSize: '13px',
                fontWeight: 500,
                transition: 'all .2s ease',
                '&:hover': { borderColor: theme.custom.teal, color: theme.custom.teal },
              }}
            >
              Open the Order Book →
            </Box>
          </Stack>
        </Stack>
      </Box>
    </Stack>
    </Box>
  );
};
