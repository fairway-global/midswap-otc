/**
 * KAAMOS OTC header — minimal dark header with teal accents.
 *
 *   [ Logo ]   · · ·   [ Tabs ]   · · ·   [ Status + Wallet ]
 *
 * Monospace nav tabs, connection status dot, compact wallet trigger.
 * On narrow screens the tabs collapse into a drawer.
 */

import React from 'react';
import { Box, Button, Drawer, IconButton, Stack, Toolbar, useMediaQuery, useTheme } from '@mui/material';
import MenuIcon from '@mui/icons-material/Menu';
import CloseIcon from '@mui/icons-material/Close';
import { Link as RouterLink, useLocation, useNavigate } from 'react-router-dom';
import { alpha } from '@mui/material/styles';
import { Logo } from './Logo';
import { WalletMenu } from '../WalletMenu';
import { useAuth, useSwapContext } from '../../hooks';
import { useToast } from '../../hooks/useToast';

const NAV: Array<{ to: string; label: string }> = [
  { to: '/orderbook', label: 'Order Book' },
  { to: '/activity', label: 'Activity' },
  { to: '/reclaim', label: 'Reclaim' },
];

export const Header: React.FC = () => {
  const theme = useTheme();
  const location = useLocation();
  const navigate = useNavigate();
  const compact = useMediaQuery(theme.breakpoints.down('md'));
  const [drawerOpen, setDrawerOpen] = React.useState(false);
  const { session, cardano } = useSwapContext();
  const { user, signOut, configured } = useAuth();
  const toast = useToast();

  const anyConnected = !!session || !!cardano;
  const teal = '#2DD4BF';

  const initials = (user?.fullName ?? user?.email ?? '')
    .split(/\s+/)
    .map((p) => p.charAt(0).toUpperCase())
    .slice(0, 2)
    .join('');

  const onSignOut = async (): Promise<void> => {
    try {
      await signOut();
      toast.info('Signed out');
      void navigate('/');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Sign-out failed');
    }
  };

  const isActive = (to: string): boolean =>
    location.pathname === to || (to !== '/' && location.pathname.startsWith(to));

  return (
    <Box
      component="header"
      sx={{
        position: 'sticky',
        top: 0,
        zIndex: (t) => t.zIndex.appBar,
        borderBottom: `1px solid ${alpha('#FFFFFF', 0.06)}`,
        bgcolor: alpha('#000000', 0.8),
        backdropFilter: 'blur(18px)',
        WebkitBackdropFilter: 'blur(18px)',
      }}
    >
      <Toolbar
        sx={{
          gap: { xs: 2, md: 3 },
          px: { xs: 2, md: 4 },
          minHeight: { xs: 52, md: 60 },
        }}
      >
        <Box component={RouterLink} to="/" sx={{ textDecoration: 'none', display: 'flex', alignItems: 'center' }}>
          <Logo />
        </Box>

        {!compact && (
          <Stack direction="row" spacing={0.25} sx={{ ml: 2, flex: 1 }}>
            {NAV.map(({ to, label }) => (
              <Button
                key={to}
                component={RouterLink}
                to={to}
                size="small"
                sx={{
                  borderRadius: 1,
                  px: 1.5,
                  py: 0.75,
                  fontSize: '0.72rem',
                  letterSpacing: '0.02em',
                  color: isActive(to) ? teal : alpha('#FFFFFF', 0.35),
                  bgcolor: isActive(to) ? alpha(teal, 0.08) : 'transparent',
                  fontWeight: 500,
                  '&:hover': {
                    bgcolor: isActive(to)
                      ? alpha(teal, 0.12)
                      : alpha('#ffffff', 0.04),
                    color: isActive(to) ? teal : '#FFFFFF',
                  },
                }}
              >
                {label}
              </Button>
            ))}
          </Stack>
        )}

        {compact && <Box sx={{ flex: 1 }} />}

        <Stack direction="row" spacing={1.75} alignItems="center">
          {/* Auth pill — sign-in CTA or signed-in identity */}
          {configured && !compact && (
            user ? (
              <Stack direction="row" spacing={1} alignItems="center">
                <Box
                  sx={{
                    width: 26,
                    height: 26,
                    borderRadius: '50%',
                    bgcolor: alpha(teal, 0.16),
                    color: teal,
                    fontFamily: 'JetBrains Mono, monospace',
                    fontSize: '0.66rem',
                    display: 'grid',
                    placeItems: 'center',
                    border: `1px solid ${alpha(teal, 0.3)}`,
                  }}
                  title={user.fullName}
                >
                  {initials || '·'}
                </Box>
                <Button
                  size="small"
                  onClick={() => void onSignOut()}
                  sx={{
                    fontSize: '0.66rem',
                    color: alpha('#FFFFFF', 0.5),
                    '&:hover': { color: theme.custom.danger, bgcolor: 'transparent' },
                  }}
                >
                  Sign out
                </Button>
              </Stack>
            ) : (
              <Button
                size="small"
                variant="outlined"
                color="primary"
                onClick={() => void navigate('/login')}
                sx={{ height: 30, fontSize: '0.7rem' }}
              >
                Sign in
              </Button>
            )
          )}

          <WalletMenu />

          {/* Faucet — separate prominent CTA, not buried in nav. Amber bordered
              like ContraClear so testers spot it. */}
          {!compact && (
            <Button
              size="small"
              onClick={() => void navigate('/faucet')}
              sx={{
                height: 30,
                px: 1.5,
                ml: 0.5,
                borderRadius: 999,
                border: `1px solid ${alpha(theme.custom.warning, 0.5)}`,
                bgcolor: alpha(theme.custom.warning, 0.06),
                color: theme.custom.warning,
                fontFamily: 'JetBrains Mono, monospace',
                fontSize: '0.7rem',
                fontWeight: 600,
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
                '&:hover': {
                  borderColor: theme.custom.warning,
                  bgcolor: alpha(theme.custom.warning, 0.12),
                },
              }}
            >
              Faucet
            </Button>
          )}

          {compact && (
            <IconButton onClick={() => setDrawerOpen(true)} aria-label="Menu" size="small">
              <MenuIcon fontSize="small" />
            </IconButton>
          )}
        </Stack>
      </Toolbar>

      <Drawer
        anchor="right"
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        PaperProps={{
          sx: {
            width: 260,
            bgcolor: '#000000',
            borderLeft: `1px solid ${alpha('#FFFFFF', 0.06)}`,
          },
        }}
      >
        <Stack sx={{ p: 2 }}>
          <Stack direction="row" alignItems="center">
            <Logo />
            <Box sx={{ flex: 1 }} />
            <IconButton onClick={() => setDrawerOpen(false)} aria-label="Close menu" size="small">
              <CloseIcon fontSize="small" />
            </IconButton>
          </Stack>
          <Stack spacing={0.25} sx={{ mt: 2 }}>
            {[
              ...NAV,
              { to: '/faucet', label: 'Faucet' },
              { to: '/how', label: 'How It Works' },
              ...(configured ? [user
                ? { to: '#signout', label: 'Sign out' }
                : { to: '/login', label: 'Sign in' }] : []),
            ].map(
              ({ to, label }) => (
                <Button
                  key={to}
                  onClick={() => {
                    if (to === '#signout') void onSignOut();
                    else void navigate(to);
                    setDrawerOpen(false);
                  }}
                  sx={{
                    justifyContent: 'flex-start',
                    borderRadius: 1,
                    px: 1.5,
                    py: 0.75,
                    fontSize: '0.72rem',
                    color: isActive(to) ? teal : alpha('#FFFFFF', 0.35),
                    bgcolor: isActive(to) ? alpha(teal, 0.08) : 'transparent',
                  }}
                >
                  {label}
                </Button>
              ),
            )}
          </Stack>
        </Stack>
      </Drawer>
    </Box>
  );
};
