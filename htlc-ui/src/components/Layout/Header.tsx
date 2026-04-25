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
import { useSwapContext } from '../../hooks';

const NAV: Array<{ to: string; label: string }> = [
  { to: '/app', label: 'OTC' },
  { to: '/browse', label: 'Order Book' },
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

  const anyConnected = !!session || !!cardano;
  const teal = '#2DD4BF';

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
          gap: 2,
          px: { xs: 2, md: 3 },
          minHeight: { xs: 52, md: 56 },
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

        <Stack direction="row" spacing={1} alignItems="center">
          {/* Connection status dot */}
          <Stack direction="row" spacing={0.75} alignItems="center" sx={{ mr: 0.5 }}>
            <Box
              sx={{
                width: 6,
                height: 6,
                borderRadius: '50%',
                bgcolor: anyConnected ? teal : theme.custom.terminalRed,
                boxShadow: anyConnected
                  ? `0 0 6px ${alpha(teal, 0.6)}`
                  : `0 0 6px ${alpha(theme.custom.terminalRed, 0.6)}`,
              }}
            />
          </Stack>

          <WalletMenu />

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
              { to: '/mint', label: 'Mint USDC' },
              { to: '/mint-usdm', label: 'Mint USDM' },
              { to: '/how', label: 'How It Works' },
            ].map(
              ({ to, label }) => (
                <Button
                  key={to}
                  onClick={() => {
                    void navigate(to);
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
