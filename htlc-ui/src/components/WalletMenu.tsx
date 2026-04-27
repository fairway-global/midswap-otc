/**
 * WalletMenu — two separate, breathing pills (one per chain) — ContraClear-
 * style. Each pill is its own clickable target with its own dropdown,
 * independent connect/disconnect, and per-chain balances.
 *
 *   [● 1AM · mn_addr…h70n ▾]   [● Lace · addr_test…yazs ▾]
 *
 * Disconnected: each pill renders as a small outlined "Connect" affordance
 * for that single chain. The Midnight dropdown also exposes "Copy both"
 * — bundles the coin key + unshielded address so a counterparty can paste
 * them into their app to bind a USDC→USDM offer to you.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Box, Button, Divider, IconButton, Menu, MenuItem, Stack, Tooltip, Typography } from '@mui/material';
import AccountBalanceWalletIcon from '@mui/icons-material/AccountBalanceWallet';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import LogoutIcon from '@mui/icons-material/Logout';
import LinkIcon from '@mui/icons-material/Link';
import ShareIcon from '@mui/icons-material/IosShare';
import { alpha, useTheme, type Theme } from '@mui/material/styles';
import { useSwapContext } from '../hooks';
import { useToast } from '../hooks/useToast';
import { formatKeyBundle } from './swap/keyBundle';
import { getUsdmBalance } from '../api/cardano-usdm';

const formatAda = (lovelace: bigint): string => {
  const whole = lovelace / 1_000_000n;
  const frac = (lovelace % 1_000_000n).toString().padStart(6, '0').slice(0, 2);
  return `${whole.toString()}.${frac}`;
};

const short = (s: string | undefined, head = 8, tail = 4): string => {
  if (!s) return '';
  if (s.length <= head + tail + 1) return s;
  return `${s.slice(0, head)}…${s.slice(-tail)}`;
};

export const WalletMenu: React.FC = () => {
  const theme = useTheme();
  const toast = useToast();
  const { session, cardano, connecting, cardanoConnecting, connect, connectCardano, disconnect } =
    useSwapContext();

  const [mnAnchor, setMnAnchor] = useState<HTMLElement | null>(null);
  const [adaAnchor, setAdaAnchor] = useState<HTMLElement | null>(null);
  const [adaBalance, setAdaBalance] = useState<bigint | undefined>(undefined);
  const [usdmBalance, setUsdmBalance] = useState<bigint | undefined>(undefined);

  useEffect(() => {
    if (!cardano) {
      setAdaBalance(undefined);
      setUsdmBalance(undefined);
      return;
    }
    let cancelled = false;
    const update = async (): Promise<void> => {
      try {
        const [ada, usdm] = await Promise.all([
          cardano.cardanoHtlc.getBalance(),
          getUsdmBalance(cardano.cardanoHtlc.lucid, cardano.usdmPolicy.unit),
        ]);
        if (!cancelled) {
          setAdaBalance(ada);
          setUsdmBalance(usdm);
        }
      } catch {
        /* ignore transient */
      }
    };
    void update();
    const id = setInterval(() => void update(), 30_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [cardano]);

  const copy = useCallback(
    async (value: string, what: string) => {
      try {
        await navigator.clipboard.writeText(value);
        toast.success(`${what} copied`);
      } catch {
        toast.error('Copy failed');
      }
    },
    [toast],
  );

  const onConnectMidnight = useCallback(async () => {
    try {
      await connect();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  }, [connect, toast]);

  const onConnectCardano = useCallback(async () => {
    try {
      await connectCardano();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  }, [connectCardano, toast]);

  const onDisconnect = useCallback(() => {
    disconnect();
    setMnAnchor(null);
    setAdaAnchor(null);
    toast.info('Wallet session forgotten on this device.');
  }, [disconnect, toast]);

  const mnAddr = session?.bootstrap.unshieldedAddressBech32m;
  const mnCpk = session?.bootstrap.coinPublicKeyBech32m;
  const adaAddr = cardano?.address;

  return (
    <Stack direction="row" spacing={1.25} alignItems="center">
      {/* ─────────── 1AM (Midnight) pill ─────────── */}
      {session ? (
        <Pill
          theme={theme}
          color={theme.custom.teal}
          label="1AM"
          short={short(mnAddr, 8, 4)}
          onClick={(e) => setMnAnchor(e.currentTarget)}
          open={!!mnAnchor}
        />
      ) : (
        <ConnectMini
          theme={theme}
          color={theme.custom.teal}
          label="Connect 1AM"
          loading={connecting}
          onClick={() => void onConnectMidnight()}
        />
      )}

      <Menu
        anchorEl={mnAnchor}
        open={!!mnAnchor}
        onClose={() => setMnAnchor(null)}
        slotProps={{
          paper: {
            sx: {
              bgcolor: '#000',
              border: `1px solid ${theme.custom.borderSubtle}`,
              mt: 1,
              minWidth: 320,
            },
          },
        }}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
      >
        <Box sx={{ px: 2, py: 1.25 }}>
          <ChainHeader theme={theme} color={theme.custom.teal} label="1AM · Midnight" />
          {session ? (
            <Stack spacing={0.75} sx={{ mt: 1 }}>
              <CopyRow theme={theme} label="Address" display={short(mnAddr, 12, 6)} onCopy={() => copy(mnAddr!, 'Midnight address')} />
              <CopyRow theme={theme} label="Coin key" display={short(mnCpk, 12, 6)} onCopy={() => copy(mnCpk!, 'Coin key')} />
              <Button
                size="small"
                variant="outlined"
                onClick={() => void copy(formatKeyBundle(mnCpk!, mnAddr!), 'Midnight key bundle')}
                sx={{
                  alignSelf: 'flex-start',
                  mt: 0.5,
                  height: 26,
                  px: 1.25,
                  fontSize: '0.66rem',
                  letterSpacing: '0.04em',
                  borderColor: theme.custom.borderSubtle,
                  color: theme.custom.textSecondary,
                  '&:hover': {
                    borderColor: theme.custom.teal,
                    color: theme.custom.teal,
                    bgcolor: alpha(theme.custom.teal, 0.06),
                  },
                }}
              >
                Copy both — for swap binding
              </Button>
            </Stack>
          ) : (
            <Typography sx={{ mt: 1, fontSize: '0.74rem', color: theme.custom.textMuted }}>
              1AM (Lace Midnight) is not connected.
            </Typography>
          )}
        </Box>
        {session && (
          <>
            <Divider sx={{ borderColor: theme.custom.borderSubtle }} />
            <MenuItem onClick={onDisconnect} sx={disconnectItemSx(theme)}>
              <LogoutIcon sx={{ fontSize: 14, mr: 1 }} />
              Disconnect both
            </MenuItem>
          </>
        )}
        {!session && (
          <>
            <Divider sx={{ borderColor: theme.custom.borderSubtle }} />
            <MenuItem
              component="a"
              href="https://docs.midnight.network/develop/tutorial/building/prereqs"
              target="_blank"
              rel="noopener"
              sx={{ fontSize: '0.74rem' }}
            >
              <LinkIcon sx={{ fontSize: 14, mr: 1 }} />
              Install Lace for Midnight
            </MenuItem>
          </>
        )}
      </Menu>

      {/* ─────────── Lace (Cardano) pill ─────────── */}
      {cardano ? (
        <Pill
          theme={theme}
          color={theme.custom.bridgeCyan}
          label="Lace"
          short={short(adaAddr, 8, 4)}
          onClick={(e) => setAdaAnchor(e.currentTarget)}
          open={!!adaAnchor}
        />
      ) : (
        <ConnectMini
          theme={theme}
          color={theme.custom.bridgeCyan}
          label="Connect Lace"
          loading={cardanoConnecting}
          onClick={() => void onConnectCardano()}
        />
      )}

      <Menu
        anchorEl={adaAnchor}
        open={!!adaAnchor}
        onClose={() => setAdaAnchor(null)}
        slotProps={{
          paper: {
            sx: {
              bgcolor: '#000',
              border: `1px solid ${theme.custom.borderSubtle}`,
              mt: 1,
              minWidth: 320,
            },
          },
        }}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
      >
        <Box sx={{ px: 2, py: 1.25 }}>
          <ChainHeader theme={theme} color={theme.custom.bridgeCyan} label="Lace · Cardano" />
          {cardano ? (
            <Stack spacing={0.75} sx={{ mt: 1 }}>
              <CopyRow theme={theme} label="Address" display={short(adaAddr, 12, 6)} onCopy={() => copy(adaAddr!, 'Cardano address')} />
              <Stack direction="row" spacing={2} sx={{ mt: 0.25 }}>
                {adaBalance !== undefined && (
                  <Typography sx={balanceLineSx(theme)}>
                    {formatAda(adaBalance)} ADA
                  </Typography>
                )}
                {usdmBalance !== undefined && (
                  <Typography sx={{ ...balanceLineSx(theme), color: theme.custom.teal }}>
                    {usdmBalance.toString()} USDM
                  </Typography>
                )}
              </Stack>
            </Stack>
          ) : (
            <Typography sx={{ mt: 1, fontSize: '0.74rem', color: theme.custom.textMuted }}>
              Lace (or any CIP-30 wallet) is not connected.
            </Typography>
          )}
        </Box>
        {cardano && (
          <>
            <Divider sx={{ borderColor: theme.custom.borderSubtle }} />
            <MenuItem onClick={onDisconnect} sx={disconnectItemSx(theme)}>
              <LogoutIcon sx={{ fontSize: 14, mr: 1 }} />
              Disconnect both
            </MenuItem>
          </>
        )}
        {!cardano && (
          <>
            <Divider sx={{ borderColor: theme.custom.borderSubtle }} />
            <MenuItem component="a" href="https://eternl.io" target="_blank" rel="noopener" sx={{ fontSize: '0.74rem' }}>
              <LinkIcon sx={{ fontSize: 14, mr: 1 }} />
              Install Eternl
            </MenuItem>
          </>
        )}
      </Menu>

      {/* When BOTH are disconnected, show the legacy "Connect wallets" CTA so
          the empty state still gives you one obvious affordance.  */}
      {!session && !cardano && (
        <ConnectBoth
          theme={theme}
          loading={connecting || cardanoConnecting}
          onClick={async () => {
            try {
              await Promise.all([connect(), connectCardano()]);
            } catch (e) {
              toast.error(e instanceof Error ? e.message : String(e));
            }
          }}
        />
      )}
    </Stack>
  );
};

// ────────────────────────────────────────────────────────────────────
// Subcomponents
// ────────────────────────────────────────────────────────────────────

const Pill: React.FC<{
  theme: Theme;
  color: string;
  label: string;
  short: string;
  open: boolean;
  onClick: (e: React.MouseEvent<HTMLElement>) => void;
}> = ({ theme, color, label, short, open, onClick }) => (
  <Button
    onClick={onClick}
    size="small"
    sx={{
      border: `1px solid ${open ? color : theme.custom.borderSubtle}`,
      bgcolor: open ? alpha(color, 0.06) : 'transparent',
      color: theme.custom.textPrimary,
      borderRadius: 999,
      px: 1.25,
      py: 0,
      height: 30,
      fontFamily: 'JetBrains Mono, monospace',
      fontSize: '0.72rem',
      letterSpacing: '0.02em',
      textTransform: 'none',
      whiteSpace: 'nowrap',
      minWidth: 0,
      '&:hover': {
        borderColor: color,
        color: theme.custom.textPrimary,
        bgcolor: alpha(color, 0.06),
      },
    }}
  >
    <Stack direction="row" spacing={0.875} alignItems="center" sx={{ minWidth: 0 }}>
      <Box sx={{ width: 7, height: 7, borderRadius: '50%', bgcolor: color, boxShadow: `0 0 8px ${alpha(color, 0.6)}`, flexShrink: 0 }} />
      <Box component="span" sx={{ fontSize: '0.6rem', letterSpacing: '0.12em', textTransform: 'uppercase', color: alpha('#FFFFFF', 0.55), flexShrink: 0 }}>
        {label}
      </Box>
      <Box component="span" sx={{ flexShrink: 0 }}>{short}</Box>
      <ExpandMoreIcon sx={{ fontSize: 14, color: alpha('#FFFFFF', 0.45), flexShrink: 0 }} />
    </Stack>
  </Button>
);

const ConnectMini: React.FC<{
  theme: Theme;
  color: string;
  label: string;
  loading: boolean;
  onClick: () => void;
}> = ({ theme, color, label, loading, onClick }) => (
  <Button
    onClick={onClick}
    disabled={loading}
    size="small"
    sx={{
      border: `1px dashed ${alpha(color, 0.5)}`,
      bgcolor: 'transparent',
      color,
      borderRadius: 999,
      px: 1.25,
      py: 0,
      height: 30,
      fontFamily: 'JetBrains Mono, monospace',
      fontSize: '0.66rem',
      letterSpacing: '0.06em',
      textTransform: 'uppercase',
      whiteSpace: 'nowrap',
      '&:hover': {
        borderStyle: 'solid',
        borderColor: color,
        bgcolor: alpha(color, 0.06),
      },
    }}
  >
    <Box sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: color, mr: 0.875, opacity: 0.45 }} />
    {loading ? 'Connecting…' : label}
  </Button>
);

const ConnectBoth: React.FC<{ theme: Theme; loading: boolean; onClick: () => void }> = ({
  theme,
  loading,
  onClick,
}) => (
  <Button
    variant="contained"
    color="primary"
    size="small"
    startIcon={<AccountBalanceWalletIcon sx={{ fontSize: 14 }} />}
    onClick={onClick}
    disabled={loading}
    sx={{ height: 30, fontSize: '0.7rem', ml: 0.5 }}
  >
    {loading ? 'Connecting…' : 'Connect both'}
  </Button>
);

const ChainHeader: React.FC<{ theme: Theme; color: string; label: string }> = ({
  theme,
  color,
  label,
}) => (
  <Stack direction="row" spacing={1} alignItems="center">
    <Box
      sx={{
        width: 8,
        height: 8,
        borderRadius: '50%',
        bgcolor: color,
        boxShadow: `0 0 8px ${alpha(color, 0.6)}`,
      }}
    />
    <Typography
      sx={{
        fontFamily: 'JetBrains Mono, monospace',
        fontSize: '0.62rem',
        letterSpacing: '0.16em',
        textTransform: 'uppercase',
        color: theme.custom.textMuted,
      }}
    >
      {label}
    </Typography>
  </Stack>
);

const CopyRow: React.FC<{
  theme: Theme;
  label: string;
  display: string;
  onCopy: () => void;
}> = ({ theme, label, display, onCopy }) => (
  <Stack direction="row" alignItems="center" spacing={1.5}>
    <Typography
      sx={{
        fontFamily: 'JetBrains Mono, monospace',
        fontSize: '0.6rem',
        letterSpacing: '0.1em',
        textTransform: 'uppercase',
        color: theme.custom.textMuted,
        minWidth: 56,
      }}
    >
      {label}
    </Typography>
    <Typography
      sx={{
        flex: 1,
        fontFamily: 'JetBrains Mono, monospace',
        fontSize: '0.74rem',
        color: theme.custom.textPrimary,
        whiteSpace: 'nowrap',
      }}
    >
      {display}
    </Typography>
    <Tooltip title="Copy">
      <IconButton
        size="small"
        onClick={onCopy}
        sx={{ color: theme.custom.textMuted, '&:hover': { color: theme.custom.teal } }}
      >
        <ContentCopyIcon sx={{ fontSize: 13 }} />
      </IconButton>
    </Tooltip>
  </Stack>
);

const balanceLineSx = (theme: Theme) => ({
  fontFamily: 'JetBrains Mono, monospace',
  fontSize: '0.7rem',
  color: theme.custom.textMuted,
});

const disconnectItemSx = (theme: Theme) => ({
  py: 1,
  px: 2,
  fontSize: '0.74rem',
  color: theme.custom.textMuted,
  '&:hover': { color: theme.custom.danger, bgcolor: alpha(theme.custom.danger, 0.06) },
});
