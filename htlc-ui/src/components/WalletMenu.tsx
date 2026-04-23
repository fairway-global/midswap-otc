/**
 * WalletMenu — pill-shaped trigger in the header. Collapsed, it shows the
 * connection state of both wallets with short address chips. Expanded (menu),
 * it surfaces connect buttons, full addresses, and balance hints.
 */

import React, { useCallback, useEffect, useState } from 'react';
import {
  Box,
  Button,
  Chip,
  Divider,
  IconButton,
  Menu,
  MenuItem,
  Stack,
  Tooltip,
  Typography,
} from '@mui/material';
import AccountBalanceWalletIcon from '@mui/icons-material/AccountBalanceWallet';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import LinkIcon from '@mui/icons-material/Link';
import { alpha, useTheme } from '@mui/material/styles';
import { useSwapContext } from '../hooks';
import { useToast } from '../hooks/useToast';

const formatAda = (lovelace: bigint): string => {
  const whole = lovelace / 1_000_000n;
  const frac = (lovelace % 1_000_000n).toString().padStart(6, '0').slice(0, 2);
  return `${whole.toString()}.${frac}`;
};

const shortHex = (hex?: string): string =>
  hex ? `${hex.slice(0, 5)}…${hex.slice(-4)}` : '';

export const WalletMenu: React.FC = () => {
  const theme = useTheme();
  const toast = useToast();
  const { session, cardano, connecting, cardanoConnecting, connect, connectCardano } = useSwapContext();
  const [anchor, setAnchor] = useState<null | HTMLElement>(null);
  const [adaBalance, setAdaBalance] = useState<bigint | undefined>(undefined);

  const anyConnected = !!session || !!cardano;

  useEffect(() => {
    if (!cardano) {
      setAdaBalance(undefined);
      return;
    }
    let cancelled = false;
    const update = async (): Promise<void> => {
      try {
        const b = await cardano.cardanoHtlc.getBalance();
        if (!cancelled) setAdaBalance(b);
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

  const onMidnight = useCallback(async () => {
    try {
      await connect();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  }, [connect, toast]);

  const onCardano = useCallback(async () => {
    try {
      await connectCardano();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  }, [connectCardano, toast]);

  return (
    <>
      {anyConnected ? (
        <Button
          onClick={(e) => setAnchor(e.currentTarget)}
          variant="outlined"
          sx={{
            border: `1px solid ${theme.custom.borderSubtle}`,
            bgcolor: theme.custom.surface2,
            color: theme.custom.textPrimary,
            borderRadius: 999,
            pl: 1,
            pr: 1.25,
            height: 40,
            '&:hover': { bgcolor: theme.custom.surface3, borderColor: theme.custom.borderStrong },
          }}
        >
          <Stack direction="row" spacing={0.75} alignItems="center">
            <Chip
              size="small"
              label={session ? shortHex(session.bootstrap.coinPublicKeyHex) : 'Midnight'}
              variant={session ? 'filled' : 'outlined'}
              color={session ? 'primary' : 'default'}
              sx={{ fontSize: '0.72rem', height: 22 }}
            />
            <Chip
              size="small"
              label={
                cardano
                  ? adaBalance !== undefined
                    ? `${formatAda(adaBalance)} ADA`
                    : shortHex(cardano.paymentKeyHash)
                  : 'Cardano'
              }
              variant={cardano ? 'filled' : 'outlined'}
              color={cardano ? 'success' : 'default'}
              sx={{ fontSize: '0.72rem', height: 22 }}
            />
          </Stack>
        </Button>
      ) : (
        <Button
          variant="contained"
          color="primary"
          startIcon={<AccountBalanceWalletIcon fontSize="small" />}
          onClick={(e) => setAnchor(e.currentTarget)}
        >
          Connect wallets
        </Button>
      )}

      <Menu
        anchorEl={anchor}
        open={!!anchor}
        onClose={() => setAnchor(null)}
        MenuListProps={{ sx: { minWidth: 320, py: 1 } }}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
      >
        {/* Midnight */}
        <Box sx={{ px: 2, py: 1 }}>
          <Stack direction="row" spacing={1} alignItems="center">
            <Box
              sx={{
                width: 22,
                height: 22,
                borderRadius: '50%',
                background: 'linear-gradient(140deg, #6B7CFF, #3B1F9E)',
                boxShadow: `0 3px 10px ${alpha('#3B1F9E', 0.5)}`,
              }}
            />
            <Typography sx={{ fontWeight: 600, flex: 1 }}>Midnight</Typography>
            {session ? (
              <CheckCircleIcon fontSize="small" sx={{ color: theme.custom.success }} />
            ) : (
              <Button size="small" onClick={onMidnight} disabled={connecting} variant="contained" color="primary">
                {connecting ? 'Connecting…' : 'Connect'}
              </Button>
            )}
          </Stack>
          {session && (
            <Stack spacing={0.5} sx={{ mt: 1 }}>
              <AddressRow
                label="Coin key"
                value={session.bootstrap.coinPublicKeyHex}
                onCopy={() => copy(session.bootstrap.coinPublicKeyHex, 'Coin key')}
              />
              <AddressRow
                label="Unshielded"
                value={session.bootstrap.unshieldedAddressHex}
                onCopy={() => copy(session.bootstrap.unshieldedAddressHex, 'Unshielded address')}
              />
            </Stack>
          )}
        </Box>

        <Divider sx={{ my: 0.5 }} />

        {/* Cardano */}
        <Box sx={{ px: 2, py: 1 }}>
          <Stack direction="row" spacing={1} alignItems="center">
            <Box
              sx={{
                width: 22,
                height: 22,
                borderRadius: '50%',
                background: 'linear-gradient(140deg, #4B8CFF, #1A4FD1)',
                boxShadow: `0 3px 10px ${alpha('#1A4FD1', 0.5)}`,
              }}
            />
            <Typography sx={{ fontWeight: 600, flex: 1 }}>Cardano</Typography>
            {cardano ? (
              <CheckCircleIcon fontSize="small" sx={{ color: theme.custom.success }} />
            ) : (
              <Button size="small" onClick={onCardano} disabled={cardanoConnecting} variant="contained" color="primary">
                {cardanoConnecting ? 'Connecting…' : 'Connect'}
              </Button>
            )}
          </Stack>
          {cardano && (
            <Stack spacing={0.5} sx={{ mt: 1 }}>
              <AddressRow
                label="PKH"
                value={cardano.paymentKeyHash}
                onCopy={() => copy(cardano.paymentKeyHash, 'Payment key hash')}
              />
              <AddressRow
                label="Address"
                value={cardano.address}
                onCopy={() => copy(cardano.address, 'Address')}
              />
              {adaBalance !== undefined && (
                <Typography variant="caption" sx={{ color: theme.custom.textMuted }}>
                  Balance: {formatAda(adaBalance)} ADA
                </Typography>
              )}
            </Stack>
          )}
        </Box>

        {!anyConnected && (
          <>
            <Divider sx={{ my: 0.5 }} />
            <MenuItem
              component="a"
              href="https://docs.midnight.network/develop/tutorial/building/prereqs"
              target="_blank"
              rel="noopener"
              sx={{ fontSize: '0.85rem' }}
            >
              <LinkIcon fontSize="small" style={{ marginRight: 8 }} />
              Install Lace for Midnight
            </MenuItem>
            <MenuItem
              component="a"
              href="https://eternl.io"
              target="_blank"
              rel="noopener"
              sx={{ fontSize: '0.85rem' }}
            >
              <LinkIcon fontSize="small" style={{ marginRight: 8 }} />
              Install Eternl for Cardano
            </MenuItem>
          </>
        )}
      </Menu>
    </>
  );
};

const AddressRow: React.FC<{ label: string; value: string; onCopy: () => void }> = ({ label, value, onCopy }) => {
  const theme = useTheme();
  return (
    <Stack direction="row" alignItems="center" spacing={1} sx={{ fontSize: 12 }}>
      <Typography variant="caption" sx={{ color: theme.custom.textMuted, minWidth: 72 }}>
        {label}
      </Typography>
      <Typography
        variant="caption"
        sx={{
          flex: 1,
          fontFamily: 'JetBrains Mono, monospace',
          fontSize: 11.5,
          color: theme.custom.textSecondary,
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
      >
        {value}
      </Typography>
      <Tooltip title="Copy">
        <IconButton size="small" onClick={onCopy}>
          <ContentCopyIcon sx={{ fontSize: 14 }} />
        </IconButton>
      </Tooltip>
    </Stack>
  );
};
