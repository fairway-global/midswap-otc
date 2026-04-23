/**
 * The heart of Midswap — a Uniswap-style dual-input card with a direction
 * switcher, settings gear, and one adaptive primary CTA.
 *
 *   Maker mode (default, no URL params)
 *     You pay: ADA · You receive: USDC · Counterparty Cardano address input
 *     CTA adapts: Connect wallets → Enter amount → Lock ADA
 *     Success → progress modal drives share + wait + claim phases
 *
 *   Taker mode (URL has ?hash= from a share link)
 *     Reads the offer from query params. Amounts are read-only.
 *     CTA: Accept offer → deposit → wait → claim (all modal-driven)
 *
 *   Reverse flow (user flips the arrow without a URL)
 *     We don't start USDC→ADA swaps natively; we guide them to /browse
 *     where a counterparty's open offer is waiting for a taker.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Divider,
  IconButton,
  InputAdornment,
  Link,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import SettingsIcon from '@mui/icons-material/Settings';
import SwapVertIcon from '@mui/icons-material/SwapVert';
import CallMadeIcon from '@mui/icons-material/CallMade';
import { alpha, useTheme } from '@mui/material/styles';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { getAddressDetails } from '@lucid-evolution/lucid';
import { DIRECTION, type Direction } from './tokens';
import { TokenRow } from './TokenRow';
import { SettingsDialog } from './SettingsDialog';
import { SwapProgressModal } from './SwapProgressModal';
import { useMakerFlow } from './useMakerFlow';
import { useTakerFlow, parseUrlInputs } from './useTakerFlow';
import { useSwapContext } from '../../hooks';
import { useToast } from '../../hooks/useToast';
import { limits } from '../../config/limits';
import { AsyncButton } from '../AsyncButton';

const resolvePkh = (input: string): string | undefined => {
  const trimmed = input.trim();
  if (!trimmed) return undefined;
  if (/^[0-9a-fA-F]{56}$/.test(trimmed)) return trimmed.toLowerCase();
  if (trimmed.startsWith('addr') || trimmed.startsWith('addr_test')) {
    try {
      return getAddressDetails(trimmed).paymentCredential?.hash?.toLowerCase();
    } catch {
      return undefined;
    }
  }
  return undefined;
};

export const SwapCard: React.FC = () => {
  const theme = useTheme();
  const navigate = useNavigate();
  const toast = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const { session, cardano, swapState, connect, connectCardano, connecting, cardanoConnecting } = useSwapContext();

  const hasOfferInUrl = !!searchParams.get('hash');
  const [direction, setDirection] = useState<Direction>(hasOfferInUrl ? 'taker' : 'maker');

  // Keep direction synced with URL: if params arrive, flip into taker mode.
  useEffect(() => {
    if (hasOfferInUrl && direction !== 'taker') setDirection('taker');
  }, [hasOfferInUrl, direction]);

  const pair = DIRECTION[direction];

  // Shared UI state.
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);

  // Maker-only local form.
  const [adaAmount, setAdaAmount] = useState('1');
  const [usdcAmount, setUsdcAmount] = useState('1');
  const [deadlineMin, setDeadlineMin] = useState(limits.aliceDefaultDeadlineMin.toString());
  const [counterpartyInput, setCounterpartyInput] = useState('');
  const resolvedCounterpartyPkh = useMemo(() => resolvePkh(counterpartyInput), [counterpartyInput]);

  // Maker flow hook.
  const maker = useMakerFlow();
  useEffect(() => {
    if (maker.state.kind !== 'idle' && maker.state.kind !== 'error' && !modalOpen) {
      setModalOpen(true);
    }
  }, [maker.state.kind, modalOpen]);

  // Taker flow hook — hydrate from URL.
  const taker = useTakerFlow();
  const urlParsed = useMemo(() => parseUrlInputs(searchParams), [searchParams]);
  const urlOk = !('error' in urlParsed);
  const urlError = 'error' in urlParsed ? urlParsed.error : undefined;

  // When in taker mode with a valid URL + session + cardano, auto-start the
  // watcher the way BobSwap did previously.
  useEffect(() => {
    if (direction !== 'taker') return;
    if (!urlOk) return;
    if (taker.state.kind !== 'idle') return;
    if (!session || !cardano) return;
    taker.start(urlParsed as Exclude<typeof urlParsed, { error: string }>);
    setModalOpen(true);
  }, [direction, urlOk, urlParsed, session, cardano, taker]);

  // Amounts shown in taker mode come from the URL.
  const takerPayValue = urlOk && direction === 'taker' ? (urlParsed as { usdcAmount: bigint }).usdcAmount.toString() : '';
  const takerReceiveValue =
    urlOk && direction === 'taker' ? (urlParsed as { adaAmount: bigint }).adaAmount.toString() : '';

  // ----------------------------------------------------------------------------
  // Primary CTA computation.
  // ----------------------------------------------------------------------------

  const onConnectBoth = useCallback(async () => {
    try {
      await Promise.all([session ? undefined : connect(), cardano ? undefined : connectCardano()]);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  }, [session, cardano, connect, connectCardano, toast]);

  const onLockClick = useCallback(async () => {
    try {
      const ada = BigInt(adaAmount || '0');
      const usdc = BigInt(usdcAmount || '0');
      const min = parseInt(deadlineMin, 10);
      if (ada <= 0n || usdc <= 0n) throw new Error('Enter positive amounts for both sides.');
      if (!Number.isFinite(min) || min < limits.aliceMinDeadlineMin) {
        throw new Error(`Deadline must be ≥ ${limits.aliceMinDeadlineMin} minutes.`);
      }
      if (!resolvedCounterpartyPkh) {
        throw new Error("Paste the counterparty's Cardano address or 56-hex PKH.");
      }
      setModalOpen(true);
      await maker.lock({
        adaAmount: ada,
        usdcAmount: usdc,
        deadlineMin: min,
        counterpartyPkh: resolvedCounterpartyPkh,
      });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  }, [adaAmount, usdcAmount, deadlineMin, resolvedCounterpartyPkh, maker, toast]);

  const onFlip = useCallback(() => {
    // Flipping away from maker means "I have USDC and want ADA" — which in our
    // protocol means taking an existing offer. Send the user to /browse.
    if (direction === 'maker') {
      navigate('/browse');
      return;
    }
    // If in taker mode, flipping back clears the URL and returns to maker.
    setSearchParams(new URLSearchParams());
    setDirection('maker');
  }, [direction, navigate, setSearchParams]);

  const onStartOver = useCallback(() => {
    setModalOpen(false);
    setSearchParams(new URLSearchParams());
    maker.reset();
    taker.reset();
    setDirection('maker');
  }, [maker, taker, setSearchParams]);

  const walletsReady = !!session && !!cardano;

  // ----------------------------------------------------------------------------
  // CTA decision tree.
  // ----------------------------------------------------------------------------

  let cta: React.ReactNode;
  if (direction === 'taker' && !urlOk) {
    cta = (
      <Stack spacing={1}>
        <Alert severity="warning">{urlError}</Alert>
        <Button variant="contained" color="primary" size="large" fullWidth onClick={onStartOver}>
          Start a new offer
        </Button>
        <Button variant="outlined" color="primary" size="large" fullWidth onClick={() => navigate('/browse')}>
          Browse open offers
        </Button>
      </Stack>
    );
  } else if (!walletsReady) {
    cta = (
      <AsyncButton
        variant="contained"
        color="primary"
        size="large"
        fullWidth
        onClick={onConnectBoth}
        pendingLabel={connecting || cardanoConnecting ? 'Opening wallets…' : 'Working…'}
      >
        {!session && !cardano ? 'Connect Midnight + Cardano' : !session ? 'Connect Midnight wallet' : 'Connect Cardano wallet'}
      </AsyncButton>
    );
  } else if (direction === 'maker') {
    const ada = Number(adaAmount || '0');
    const usdc = Number(usdcAmount || '0');
    const hasAmounts = ada > 0 && usdc > 0;
    const hasPkh = !!resolvedCounterpartyPkh;
    if (!hasAmounts) {
      cta = (
        <Button variant="contained" color="primary" size="large" fullWidth disabled>
          Enter amount
        </Button>
      );
    } else if (!hasPkh) {
      cta = (
        <Button variant="contained" color="primary" size="large" fullWidth disabled>
          Enter counterparty address
        </Button>
      );
    } else {
      cta = (
        <AsyncButton variant="contained" color="primary" size="large" fullWidth onClick={onLockClick} pendingLabel="Signing in wallet…">
          Review & lock {ada} ADA
        </AsyncButton>
      );
    }
  } else {
    // taker w/ wallets ready — modal is already running the flow.
    cta = (
      <Button variant="contained" color="primary" size="large" fullWidth onClick={() => setModalOpen(true)}>
        View progress
      </Button>
    );
  }

  return (
    <>
      <Box
        sx={{
          width: '100%',
          maxWidth: 480,
          mx: 'auto',
          p: 2.5,
          borderRadius: 4,
          bgcolor: theme.custom.surface1,
          border: `1px solid ${theme.custom.borderSubtle}`,
          boxShadow: `0 30px 80px -30px ${alpha('#000', 0.7)}, 0 0 0 1px ${theme.custom.borderSubtle}`,
          backdropFilter: 'blur(18px)',
        }}
      >
        {/* Header */}
        <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1.5 }}>
          <Typography sx={{ fontWeight: 600, fontSize: '1.05rem' }}>Swap</Typography>
          <Typography variant="caption" sx={{ color: theme.custom.textMuted }}>
            {direction === 'maker' ? 'Make a cross-chain offer' : 'Take this offer'}
          </Typography>
          <Box sx={{ flex: 1 }} />
          <Tooltip title="Settings">
            <IconButton size="small" onClick={() => setSettingsOpen(true)} aria-label="Settings">
              <SettingsIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        </Stack>

        {/* Pay row */}
        <Box sx={{ position: 'relative' }}>
          <TokenRow
            label="You pay"
            value={direction === 'maker' ? adaAmount : takerPayValue}
            onChange={direction === 'maker' ? setAdaAmount : undefined}
            token={pair.pay}
            readOnly={direction === 'taker'}
            helper={
              direction === 'maker' && session
                ? `Paid from your Cardano wallet.`
                : direction === 'taker'
                  ? `Escrowed on Midnight until the maker claims.`
                  : undefined
            }
            autoFocus={direction === 'maker'}
          />

          {/* Flip circle, overlapping both rows */}
          <Box sx={{ display: 'flex', justifyContent: 'center', height: 0, position: 'relative', zIndex: 2 }}>
            <Tooltip title={direction === 'maker' ? 'Switch to taking an offer' : 'Go back to making an offer'}>
              <IconButton
                onClick={onFlip}
                sx={{
                  mt: '-20px',
                  width: 40,
                  height: 40,
                  bgcolor: theme.custom.surface2,
                  border: `4px solid ${theme.custom.surface1}`,
                  '&:hover': {
                    bgcolor: theme.custom.surface3,
                  },
                }}
              >
                <SwapVertIcon fontSize="small" sx={{ color: theme.custom.textPrimary }} />
              </IconButton>
            </Tooltip>
          </Box>
        </Box>

        {/* Receive row */}
        <Box sx={{ mt: -2.25 }}>
          <TokenRow
            label="You receive"
            value={direction === 'maker' ? usdcAmount : takerReceiveValue}
            onChange={direction === 'maker' ? setUsdcAmount : undefined}
            token={pair.receive}
            readOnly={direction === 'taker'}
            helper={
              direction === 'maker'
                ? `Delivered as native ${pair.receive.symbol} on Midnight when you claim.`
                : `Delivered from the maker's Cardano HTLC when you claim.`
            }
          />
        </Box>

        {/* Maker-only counterparty input */}
        {direction === 'maker' && (
          <Box sx={{ mt: 2 }}>
            <TextField
              size="small"
              fullWidth
              label="Counterparty Cardano address or PKH"
              value={counterpartyInput}
              onChange={(e) => setCounterpartyInput(e.target.value)}
              placeholder="addr_test1… or 56-hex PKH"
              error={counterpartyInput.trim().length > 0 && !resolvedCounterpartyPkh}
              helperText={
                counterpartyInput.trim().length === 0
                  ? 'Bind the lock to their Cardano wallet — the ADA can only be claimed with matching credentials.'
                  : resolvedCounterpartyPkh
                    ? `PKH ${resolvedCounterpartyPkh.slice(0, 16)}…`
                    : 'Not a valid Cardano address or 56-hex PKH.'
              }
              InputProps={{
                startAdornment: (
                  <InputAdornment position="start">
                    <CallMadeIcon fontSize="small" sx={{ color: theme.custom.textMuted }} />
                  </InputAdornment>
                ),
              }}
            />
          </Box>
        )}

        {/* Taker summary */}
        {direction === 'taker' && urlOk && (
          <Box
            sx={{
              mt: 2,
              p: 2,
              borderRadius: 3,
              border: `1px solid ${alpha(theme.custom.cardanoBlue, 0.35)}`,
              bgcolor: alpha(theme.custom.cardanoBlue, 0.05),
            }}
          >
            <Stack spacing={0.5}>
              <Typography sx={{ fontWeight: 600, color: theme.custom.textPrimary }}>Offer details</Typography>
              <Row
                k="Hash"
                v={(urlParsed as { hashHex: string }).hashHex.slice(0, 32) + '…'}
              />
              <Row
                k="Cardano deadline"
                v={new Date(Number((urlParsed as { cardanoDeadlineMs: bigint }).cardanoDeadlineMs)).toLocaleString()}
              />
            </Stack>
          </Box>
        )}

        {/* Maker pending notice */}
        {maker.restoreNotice && (
          <Alert
            severity="info"
            sx={{ mt: 2 }}
            action={
              <Button
                size="small"
                color="inherit"
                onClick={() => {
                  maker.forgetPending();
                  onStartOver();
                }}
              >
                Discard
              </Button>
            }
          >
            {maker.restoreNotice}
          </Alert>
        )}

        {/* CTA */}
        <Box sx={{ mt: 2.5 }}>{cta}</Box>

        {/* Footer hint */}
        <Divider sx={{ mt: 2.5, mb: 1.5 }} />
        <Stack
          direction="row"
          spacing={1}
          alignItems="center"
          justifyContent="center"
          sx={{ color: theme.custom.textMuted, fontSize: '0.76rem' }}
        >
          <Typography variant="caption" sx={{ color: 'inherit' }}>
            Need USDC?
          </Typography>
          <Link component="button" underline="hover" onClick={() => navigate('/mint')}
            sx={{ fontWeight: 500, fontSize: 'inherit' }}>
            Mint on Midnight
          </Link>
          <Typography variant="caption" sx={{ color: 'inherit' }}>·</Typography>
          <Link
            component="button"
            underline="hover"
            onClick={() => navigate('/how')}
            sx={{ fontWeight: 500, fontSize: 'inherit' }}
          >
            How it works
          </Link>
        </Stack>
      </Box>

      <SettingsDialog
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        deadlineMin={deadlineMin}
        onDeadlineMinChange={setDeadlineMin}
      />

      {modalOpen && direction === 'maker' && (
        <SwapProgressModal
          variant="maker"
          open={modalOpen}
          onClose={() => setModalOpen(false)}
          state={maker.state}
          shareUrl={maker.shareUrl}
          onClaim={() => void maker.claim()}
          onReset={onStartOver}
          pay={pair.pay}
          receive={pair.receive}
        />
      )}
      {modalOpen && direction === 'taker' && (
        <SwapProgressModal
          variant="taker"
          open={modalOpen}
          onClose={() => setModalOpen(false)}
          state={taker.state}
          onAccept={taker.accept}
          onClaim={() => void taker.claim()}
          onReset={onStartOver}
          pay={pair.pay}
          receive={pair.receive}
          usdcColor={swapState.usdcColor}
        />
      )}
    </>
  );
};

const Row: React.FC<{ k: string; v: string }> = ({ k, v }) => {
  const theme = useTheme();
  return (
    <Stack direction="row" spacing={1.5}>
      <Typography variant="caption" sx={{ color: theme.custom.textMuted, minWidth: 120 }}>
        {k}
      </Typography>
      <Typography variant="caption" sx={{ color: theme.custom.textPrimary, fontFamily: 'JetBrains Mono, monospace' }}>
        {v}
      </Typography>
    </Stack>
  );
};
