/**
 * Midswap top bar — thin, blurred, sticky. Three zones:
 *
 *   [ Logo ]   · · ·   [ Tabs ]   · · ·   [ Wallet pill ]
 *
 * On narrow screens the tabs collapse into a horizontal scroll row.
 */

import React from 'react';
import {
  AppBar,
  Box,
  Button,
  Drawer,
  IconButton,
  Stack,
  Toolbar,
  useMediaQuery,
  useTheme,
} from '@mui/material';
import MenuIcon from '@mui/icons-material/Menu';
import CloseIcon from '@mui/icons-material/Close';
import { Link as RouterLink, useLocation, useNavigate } from 'react-router-dom';
import { alpha } from '@mui/material/styles';
import { Logo } from './Logo';
import { WalletMenu } from '../WalletMenu';

const NAV: Array<{ to: string; label: string }> = [
  { to: '/', label: 'Swap' },
  { to: '/browse', label: 'Browse' },
  { to: '/activity', label: 'Activity' },
  { to: '/reclaim', label: 'Reclaim' },
];

export const Header: React.FC = () => {
  const theme = useTheme();
  const location = useLocation();
  const navigate = useNavigate();
  const compact = useMediaQuery(theme.breakpoints.down('md'));
  const [drawerOpen, setDrawerOpen] = React.useState(false);

  const isActive = (to: string): boolean =>
    location.pathname === to || (to !== '/' && location.pathname.startsWith(to));

  return (
    <AppBar position="sticky" color="default">
      <Toolbar sx={{ gap: 2, px: { xs: 2, md: 4 } }}>
        <Box component={RouterLink} to="/" sx={{ textDecoration: 'none' }}>
          <Logo />
        </Box>

        {!compact && (
          <Stack direction="row" spacing={0.5} sx={{ ml: 3, flex: 1 }}>
            {NAV.map(({ to, label }) => (
              <Button
                key={to}
                component={RouterLink}
                to={to}
                size="small"
                sx={{
                  borderRadius: 999,
                  px: 2,
                  py: 0.75,
                  color: isActive(to) ? theme.custom.textPrimary : theme.custom.textSecondary,
                  bgcolor: isActive(to) ? alpha(theme.custom.cardanoBlue, 0.12) : 'transparent',
                  fontWeight: 500,
                  '&:hover': {
                    bgcolor: isActive(to)
                      ? alpha(theme.custom.cardanoBlue, 0.2)
                      : alpha('#ffffff', 0.04),
                    color: theme.custom.textPrimary,
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
          <WalletMenu />
          {compact && (
            <IconButton onClick={() => setDrawerOpen(true)} aria-label="Menu">
              <MenuIcon />
            </IconButton>
          )}
        </Stack>
      </Toolbar>

      <Drawer
        anchor="right"
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        PaperProps={{ sx: { width: 280, bgcolor: theme.custom.surface1 } }}
      >
        <Stack sx={{ p: 2 }}>
          <Stack direction="row" alignItems="center">
            <Logo />
            <Box sx={{ flex: 1 }} />
            <IconButton onClick={() => setDrawerOpen(false)} aria-label="Close menu">
              <CloseIcon />
            </IconButton>
          </Stack>
          <Stack spacing={0.5} sx={{ mt: 2 }}>
            {[...NAV, { to: '/mint', label: 'Mint USDC' }, { to: '/how', label: 'How it works' }].map(({ to, label }) => (
              <Button
                key={to}
                onClick={() => {
                  navigate(to);
                  setDrawerOpen(false);
                }}
                sx={{
                  justifyContent: 'flex-start',
                  borderRadius: 2,
                  px: 2,
                  py: 1,
                  color: isActive(to) ? theme.custom.textPrimary : theme.custom.textSecondary,
                  bgcolor: isActive(to) ? alpha(theme.custom.cardanoBlue, 0.12) : 'transparent',
                }}
              >
                {label}
              </Button>
            ))}
          </Stack>
        </Stack>
      </Drawer>
    </AppBar>
  );
};
