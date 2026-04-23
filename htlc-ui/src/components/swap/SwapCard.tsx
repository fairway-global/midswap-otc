/**
 * Midswap swap card — a Uniswap-style dual-input card that supports the full
 * bidirectional atomic-swap protocol.
 *
 *   ada-usdc flow (default)
 *     Maker locks ADA on Cardano; taker deposits USDC on Midnight; maker
 *     claims USDC (reveals preimage on Midnight); taker claims ADA on
 *     Cardano using the revealed preimage.
 *
 *   usdc-ada flow (click flip)
 *     Maker deposits USDC on Midnight; taker locks ADA on Cardano; maker
 *     claims ADA (reveals preimage via Cardano tx redeemer); taker claims
 *     USDC on Midnight using the preimage read back from Blockfrost.
 *
 * Role is derived from URL: `?hash=` present → taker, otherwise maker.
 * Flow direction is maker-controlled (flip button) in maker mode; in taker
 * mode it's read from the URL's `direction` param.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
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
import ContentPasteIcon from '@mui/icons-material/ContentPaste';
import { alpha, useTheme } from '@mui/material/styles';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { getAddressDetails } from '@lucid-evolution/lucid';
import { FLOW_PAIR, type FlowDirection, type Role } from './tokens';
import { TokenRow } from './TokenRow';
import { SettingsDialog } from './SettingsDialog';
import { SwapProgressModal } from './SwapProgressModal';
import { useMakerFlow } from './useMakerFlow';
import { useTakerFlow, parseUrlInputs } from './useTakerFlow';
import { useReverseMakerFlow } from './useReverseMakerFlow';
import { useReverseTakerFlow, parseReverseUrl } from './useReverseTakerFlow';
import { useSwapContext } from '../../hooks';
import { useToast } from '../../hooks/useToast';
import { limits } from '../../config/limits';
import { AsyncButton } from '../AsyncButton';
import { decodeShieldedCoinPublicKey, decodeUnshieldedAddress } from '../../api/key-encoding';
import { parseKeyBundle } from './keyBundle';

const HEX64 = /^[0-9a-fA-F]{64}$/;

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

/** Accept either a bech32m shielded key (as Lace exposes it) or 64-hex. */
const resolveMidnightCpk = (input: string, networkId: string | undefined): Uint8Array | undefined => {
  const trimmed = input.trim();
  if (!trimmed || !networkId) return undefined;
  if (HEX64.test(trimmed)) {
    const bytes = new Uint8Array(32);
    for (let i = 0; i < 32; i++) bytes[i] = parseInt(trimmed.slice(i * 2, i * 2 + 2), 16);
    return bytes;
  }
  try {
    return decodeShieldedCoinPublicKey(trimmed, networkId);
  } catch {
    return undefined;
  }
};

/** Accept either a bech32m unshielded address or 64-hex. */
const resolveMidnightUnshielded = (input: string, networkId: string | undefined): Uint8Array | undefined => {
  const trimmed = input.trim();
  if (!trimmed || !networkId) return undefined;
  if (HEX64.test(trimmed)) {
    const bytes = new Uint8Array(32);
    for (let i = 0; i < 32; i++) bytes[i] = parseInt(trimmed.slice(i * 2, i * 2 + 2), 16);
    return bytes;
  }
  try {
    return decodeUnshieldedAddress(trimmed, networkId);
  } catch {
    return undefined;
  }
};

export const SwapCard: React.FC = () => {
  const theme = useTheme();
  const navigate = useNavigate();
  const toast = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const { session, cardano, swapState, connect, connectCardano, connecting, cardanoConnecting } = useSwapContext();

  const networkId = session?.bootstrap.networkId;

  // Role comes from URL (hash present → taker). Flow direction comes from
  // either the URL `direction` param (taker) or local state (maker flip).
  const hashInUrl = !!searchParams.get('hash');
  const urlDirection = (searchParams.get('direction') as FlowDirection | null) ?? 'ada-usdc';
  const role: Role = hashInUrl ? 'taker' : 'maker';

  const [flowDirection, setFlowDirection] = useState<FlowDirection>(hashInUrl ? urlDirection : 'ada-usdc');

  // Keep flowDirection synced with URL for taker mode.
  useEffect(() => {
    if (hashInUrl) setFlowDirection(urlDirection);
  }, [hashInUrl, urlDirection]);

  const pair = FLOW_PAIR[flowDirection][role];

  // Shared UI state.
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);

  // Maker-only local form.
  const [adaAmount, setAdaAmount] = useState('1');
  const [usdcAmount, setUsdcAmount] = useState('1');
  const [deadlineMin, setDeadlineMin] = useState(limits.aliceDefaultDeadlineMin.toString());

  // Forward-maker counterparty: Cardano address/PKH
  const [counterpartyCardano, setCounterpartyCardano] = useState('');
  const resolvedCounterpartyPkh = useMemo(() => resolvePkh(counterpartyCardano), [counterpartyCardano]);

  // Reverse-maker counterparty: Midnight cpk + unshielded address
  const [counterpartyMidnightCpk, setCounterpartyMidnightCpk] = useState('');
  const [counterpartyMidnightUnshielded, setCounterpartyMidnightUnshielded] = useState('');
  const resolvedCounterpartyMidnightCpkBytes = useMemo(
    () => resolveMidnightCpk(counterpartyMidnightCpk, networkId),
    [counterpartyMidnightCpk, networkId],
  );
  const resolvedCounterpartyMidnightUnshieldedBytes = useMemo(
    () => resolveMidnightUnshielded(counterpartyMidnightUnshielded, networkId),
    [counterpartyMidnightUnshielded, networkId],
  );

  // All four flow hooks are instantiated so their reducers/effects stay
  // consistent; only one is actively driven at a time.
  const fwdMaker = useMakerFlow();
  const fwdTaker = useTakerFlow();
  const revMaker = useReverseMakerFlow();
  const revTaker = useReverseTakerFlow();

  // Open the progress modal whenever the active flow transitions out of idle.
  const activeState =
    role === 'maker'
      ? flowDirection === 'ada-usdc'
        ? fwdMaker.state
        : revMaker.state
      : flowDirection === 'ada-usdc'
        ? fwdTaker.state
        : revTaker.state;

  useEffect(() => {
    if (activeState.kind !== 'idle' && activeState.kind !== 'error') {
      setModalOpen(true);
    }
  }, [activeState.kind]);

  // Taker URL parsing — forward or reverse depending on the `direction` param.
  const fwdUrl = useMemo(() => {
    if (role !== 'taker' || flowDirection !== 'ada-usdc') return undefined;
    const parsed = parseUrlInputs(searchParams);
    return 'error' in parsed ? undefined : parsed;
  }, [searchParams, role, flowDirection]);

  const revUrl = useMemo(() => {
    if (role !== 'taker' || flowDirection !== 'usdc-ada') return undefined;
    const parsed = parseReverseUrl(searchParams);
    return 'error' in parsed ? undefined : parsed;
  }, [searchParams, role, flowDirection]);

  const urlError = useMemo(() => {
    if (role !== 'taker') return undefined;
    if (flowDirection === 'ada-usdc') {
      const parsed = parseUrlInputs(searchParams);
      return 'error' in parsed ? parsed.error : undefined;
    }
    const parsed = parseReverseUrl(searchParams);
    return 'error' in parsed ? parsed.error : undefined;
  }, [searchParams, role, flowDirection]);

  // Auto-start the correct taker flow when wallets + URL are ready.
  useEffect(() => {
    if (role !== 'taker' || !session || !cardano) return;
    if (flowDirection === 'ada-usdc' && fwdUrl && fwdTaker.state.kind === 'idle') {
      fwdTaker.start(fwdUrl);
      setModalOpen(true);
    } else if (flowDirection === 'usdc-ada' && revUrl && revTaker.state.kind === 'idle') {
      revTaker.start(revUrl);
      setModalOpen(true);
    }
  }, [role, flowDirection, fwdUrl, revUrl, session, cardano, fwdTaker, revTaker]);

  // Amounts shown in taker mode come from the URL.
  const takerPayValue = (() => {
    if (role !== 'taker') return '';
    if (flowDirection === 'ada-usdc') return fwdUrl ? fwdUrl.usdcAmount.toString() : '';
    return revUrl ? revUrl.adaAmount.toString() : '';
  })();
  const takerReceiveValue = (() => {
    if (role !== 'taker') return '';
    if (flowDirection === 'ada-usdc') return fwdUrl ? fwdUrl.adaAmount.toString() : '';
    return revUrl ? revUrl.usdcAmount.toString() : '';
  })();

  // --------------------------------------------------------------------------
  // Handlers
  // --------------------------------------------------------------------------

  const onConnectBoth = useCallback(async () => {
    try {
      const pending: Promise<unknown>[] = [];
      if (!session) pending.push(connect());
      if (!cardano) pending.push(connectCardano());
      await Promise.all(pending);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  }, [session, cardano, connect, connectCardano, toast]);

  const onSubmitMaker = useCallback(async () => {
    try {
      const ada = BigInt(adaAmount || '0');
      const usdc = BigInt(usdcAmount || '0');
      const min = parseInt(deadlineMin, 10);
      if (ada <= 0n || usdc <= 0n) throw new Error('Enter positive amounts for both sides.');
      if (!Number.isFinite(min) || min < limits.aliceMinDeadlineMin) {
        throw new Error(`Deadline must be ≥ ${limits.aliceMinDeadlineMin} minutes.`);
      }

      if (flowDirection === 'ada-usdc') {
        if (!resolvedCounterpartyPkh) {
          throw new Error("Paste the counterparty's Cardano address or 56-hex PKH.");
        }
        setModalOpen(true);
        await fwdMaker.lock({
          adaAmount: ada,
          usdcAmount: usdc,
          deadlineMin: min,
          counterpartyPkh: resolvedCounterpartyPkh,
        });
      } else {
        if (!resolvedCounterpartyMidnightCpkBytes) {
          throw new Error("Paste the counterparty's Midnight shielded coin key (bech32m or 64 hex).");
        }
        if (!resolvedCounterpartyMidnightUnshieldedBytes) {
          throw new Error("Paste the counterparty's Midnight unshielded address (bech32m or 64 hex).");
        }
        setModalOpen(true);
        await revMaker.deposit({
          adaAmount: ada,
          usdcAmount: usdc,
          deadlineMin: min,
          counterpartyCpkBytes: resolvedCounterpartyMidnightCpkBytes,
          counterpartyUnshieldedBytes: resolvedCounterpartyMidnightUnshieldedBytes,
        });
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  }, [
    adaAmount,
    usdcAmount,
    deadlineMin,
    flowDirection,
    resolvedCounterpartyPkh,
    resolvedCounterpartyMidnightCpkBytes,
    resolvedCounterpartyMidnightUnshieldedBytes,
    fwdMaker,
    revMaker,
    toast,
  ]);

  const onFlip = useCallback(() => {
    // Only the maker controls flow direction. Takers inherit from URL.
    if (role === 'taker') {
      // Flipping in taker mode clears the URL and returns to maker mode.
      setSearchParams(new URLSearchParams());
      setFlowDirection('ada-usdc');
      return;
    }
    // Disallow flipping while an active maker flow is in flight — it would
    // orphan the preimage / pending swap.
    if (
      (flowDirection === 'ada-usdc' && fwdMaker.state.kind !== 'idle' && fwdMaker.state.kind !== 'error') ||
      (flowDirection === 'usdc-ada' && revMaker.state.kind !== 'idle' && revMaker.state.kind !== 'error')
    ) {
      toast.warning('Finish or discard the in-flight swap before flipping direction.');
      return;
    }
    setFlowDirection((d) => (d === 'ada-usdc' ? 'usdc-ada' : 'ada-usdc'));
  }, [role, flowDirection, fwdMaker.state.kind, revMaker.state.kind, setSearchParams, toast]);

  const onStartOver = useCallback(() => {
    setModalOpen(false);
    setSearchParams(new URLSearchParams());
    fwdMaker.reset();
    fwdTaker.reset();
    revMaker.reset();
    revTaker.reset();
    setFlowDirection('ada-usdc');
  }, [fwdMaker, fwdTaker, revMaker, revTaker, setSearchParams]);

  const walletsReady = !!session && !!cardano;

  // --------------------------------------------------------------------------
  // CTA
  // --------------------------------------------------------------------------

  let cta: React.ReactNode;
  if (role === 'taker' && urlError) {
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
        {!session && !cardano
          ? 'Connect Midnight + Cardano'
          : !session
            ? 'Connect Midnight wallet'
            : 'Connect Cardano wallet'}
      </AsyncButton>
    );
  } else if (role === 'maker') {
    const ada = Number(adaAmount || '0');
    const usdc = Number(usdcAmount || '0');
    const hasAmounts = ada > 0 && usdc > 0;
    const hasCounterparty =
      flowDirection === 'ada-usdc'
        ? !!resolvedCounterpartyPkh
        : !!resolvedCounterpartyMidnightCpkBytes && !!resolvedCounterpartyMidnightUnshieldedBytes;
    if (!hasAmounts) {
      cta = (
        <Button variant="contained" color="primary" size="large" fullWidth disabled>
          Enter amount
        </Button>
      );
    } else if (!hasCounterparty) {
      cta = (
        <Button variant="contained" color="primary" size="large" fullWidth disabled>
          {flowDirection === 'ada-usdc' ? 'Enter counterparty Cardano address' : 'Enter counterparty Midnight keys'}
        </Button>
      );
    } else {
      const label = flowDirection === 'ada-usdc' ? `Review & lock ${ada} ADA` : `Review & deposit ${usdc} USDC`;
      cta = (
        <AsyncButton
          variant="contained"
          color="primary"
          size="large"
          fullWidth
          onClick={onSubmitMaker}
          pendingLabel="Signing in wallet…"
        >
          {label}
        </AsyncButton>
      );
    }
  } else {
    // taker with wallets ready — modal is driving the flow.
    cta = (
      <Button variant="contained" color="primary" size="large" fullWidth onClick={() => setModalOpen(true)}>
        View progress
      </Button>
    );
  }

  // Restore notice (either maker hook may have pending state).
  const restoreNotice =
    role === 'maker' ? (flowDirection === 'ada-usdc' ? fwdMaker.restoreNotice : revMaker.restoreNotice) : undefined;
  const onForgetPending = useCallback(() => {
    if (flowDirection === 'ada-usdc') fwdMaker.forgetPending();
    else revMaker.forgetPending();
    onStartOver();
  }, [flowDirection, fwdMaker, revMaker, onStartOver]);

  // Smart-paste: accept a `cpk:unshielded` bundle typed/pasted into either
  // counterparty field, and split it into both fields transparently.
  const applyMidnightKeys = useCallback((cpk: string, unshielded: string): void => {
    setCounterpartyMidnightCpk(cpk);
    setCounterpartyMidnightUnshielded(unshielded);
  }, []);

  const onCpkInputChange = useCallback(
    (value: string): void => {
      const bundle = parseKeyBundle(value);
      if (bundle) {
        applyMidnightKeys(bundle.cpk, bundle.unshielded);
        return;
      }
      setCounterpartyMidnightCpk(value);
    },
    [applyMidnightKeys],
  );

  const onUnshieldedInputChange = useCallback(
    (value: string): void => {
      const bundle = parseKeyBundle(value);
      if (bundle) {
        applyMidnightKeys(bundle.cpk, bundle.unshielded);
        return;
      }
      setCounterpartyMidnightUnshielded(value);
    },
    [applyMidnightKeys],
  );

  const onPasteBundle = useCallback(async (): Promise<void> => {
    try {
      const text = await navigator.clipboard.readText();
      const bundle = parseKeyBundle(text);
      if (!bundle) {
        toast.error("Clipboard doesn't contain a key bundle. Expected `cpk:unshielded`.");
        return;
      }
      applyMidnightKeys(bundle.cpk, bundle.unshielded);
      toast.success('Key bundle pasted into both fields.');
    } catch (e) {
      toast.error(`Clipboard read failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, [applyMidnightKeys, toast]);

  const directionBadge =
    role === 'maker'
      ? flowDirection === 'ada-usdc'
        ? 'ADA → USDC'
        : 'USDC → ADA'
      : flowDirection === 'ada-usdc'
        ? 'Take ADA → USDC'
        : 'Take USDC → ADA';

  return (
    <>
      <Box
        sx={{
          width: '100%',
          maxWidth: 640,
          mx: 'auto',
          borderRadius: 2,
          bgcolor: theme.custom.surface1,
          border: `1px solid ${theme.custom.borderSubtle}`,
          overflow: 'hidden',
        }}
      >
        {/* Panel header — ContraClear style */}
        <Stack
          direction="row"
          alignItems="center"
          spacing={1}
          sx={{
            px: 2,
            py: 1.5,
            borderBottom: `1px solid ${theme.custom.borderSubtle}`,
          }}
        >
          <Typography
            sx={{
              fontSize: '0.68rem',
              fontWeight: 600,
              textTransform: 'uppercase',
              letterSpacing: '0.06em',
              color: theme.custom.textMuted,
            }}
          >
            {role === 'maker' ? 'Create OTC Offer' : 'Accept OTC Offer'}
          </Typography>
          <Box
            sx={{
              borderRadius: 1,
              border: `1px solid ${alpha(theme.custom.cardanoBlue, 0.3)}`,
              bgcolor: alpha(theme.custom.cardanoBlue, 0.1),
              px: 1,
              py: 0.25,
            }}
          >
            <Typography
              sx={{
                fontSize: '0.6rem',
                fontWeight: 500,
                letterSpacing: '0.06em',
                textTransform: 'uppercase',
                color: theme.custom.cardanoBlue,
              }}
            >
              {directionBadge}
            </Typography>
          </Box>
          <Box sx={{ flex: 1 }} />
          <Tooltip title="Settings">
            <IconButton size="small" onClick={() => setSettingsOpen(true)} aria-label="Settings">
              <SettingsIcon sx={{ fontSize: 16 }} />
            </IconButton>
          </Tooltip>
        </Stack>

        {/* Card body */}
        <Box sx={{ p: 2.5 }}>
          {/* Pay / Receive rows */}
          <Box sx={{ position: 'relative' }}>
            <Stack spacing={0.5}>
              <TokenRow
                label="You pay"
                value={role === 'maker' ? (flowDirection === 'ada-usdc' ? adaAmount : usdcAmount) : takerPayValue}
                onChange={role === 'maker' ? (flowDirection === 'ada-usdc' ? setAdaAmount : setUsdcAmount) : undefined}
                token={pair.pay}
                readOnly={role === 'taker'}
                helper={payRowHelper(role, flowDirection)}
                autoFocus={role === 'maker'}
              />
              <TokenRow
                label="You receive"
                value={role === 'maker' ? (flowDirection === 'ada-usdc' ? usdcAmount : adaAmount) : takerReceiveValue}
                onChange={role === 'maker' ? (flowDirection === 'ada-usdc' ? setUsdcAmount : setAdaAmount) : undefined}
                token={pair.receive}
                readOnly={role === 'taker'}
                helper={receiveRowHelper(role, flowDirection)}
              />
            </Stack>

            <Tooltip
              title={
                role === 'taker'
                  ? 'Flipping will discard the offer URL'
                  : flowDirection === 'ada-usdc'
                    ? 'Flip to USDC → ADA (offer USDC for ADA)'
                    : 'Flip to ADA → USDC (offer ADA for USDC)'
              }
            >
              <IconButton
                onClick={onFlip}
                aria-label="Flip direction"
                sx={{
                  position: 'absolute',
                  top: '50%',
                  left: '50%',
                  transform: 'translate(-50%, -50%)',
                  zIndex: 2,
                  width: 36,
                  height: 36,
                  borderRadius: 1,
                  bgcolor: theme.custom.surface2,
                  border: `3px solid ${theme.custom.surface1}`,
                  '&:hover': { bgcolor: theme.custom.surface3 },
                }}
              >
                <SwapVertIcon sx={{ fontSize: 16, color: theme.custom.textPrimary }} />
              </IconButton>
            </Tooltip>
          </Box>

          {/* Counterparty input — differs by direction */}
          {role === 'maker' && flowDirection === 'ada-usdc' && (
            <Box sx={{ mt: 2 }}>
              <Typography
                sx={{
                  fontSize: '0.64rem',
                  fontWeight: 600,
                  textTransform: 'uppercase',
                  letterSpacing: '0.06em',
                  color: theme.custom.textMuted,
                  mb: 1,
                }}
              >
                Counterparty Wallet
              </Typography>
              <TextField
                size="small"
                fullWidth
                label="Cardano address or PKH"
                value={counterpartyCardano}
                onChange={(e) => setCounterpartyCardano(e.target.value)}
                placeholder="addr_test1… or 56-hex PKH"
                error={counterpartyCardano.trim().length > 0 && !resolvedCounterpartyPkh}
                helperText={
                  counterpartyCardano.trim().length === 0
                    ? 'Bind the ADA lock to their Cardano wallet.'
                    : resolvedCounterpartyPkh
                      ? `PKH ${resolvedCounterpartyPkh.slice(0, 16)}…`
                      : 'Not a valid Cardano address or 56-hex PKH.'
                }
                InputProps={{
                  startAdornment: (
                    <InputAdornment position="start">
                      <CallMadeIcon sx={{ fontSize: 14, color: theme.custom.textMuted }} />
                    </InputAdornment>
                  ),
                }}
              />
            </Box>
          )}

          {role === 'maker' && flowDirection === 'usdc-ada' && (
            <Stack spacing={1.25} sx={{ mt: 2 }}>
              <Typography
                sx={{
                  fontSize: '0.64rem',
                  fontWeight: 600,
                  textTransform: 'uppercase',
                  letterSpacing: '0.06em',
                  color: theme.custom.textMuted,
                }}
              >
                Counterparty Midnight Keys
              </Typography>
              <Stack
                direction="row"
                alignItems="center"
                spacing={1}
                sx={{
                  p: 1,
                  borderRadius: 1,
                  border: `1px dashed ${theme.custom.borderSubtle}`,
                  bgcolor: alpha(theme.custom.cardanoBlue, 0.04),
                }}
              >
                <Typography variant="caption" sx={{ color: theme.custom.textSecondary, flex: 1 }}>
                  Got a key bundle from the counterparty? Paste once to fill both fields.
                </Typography>
                <Button
                  size="small"
                  variant="outlined"
                  startIcon={<ContentPasteIcon sx={{ fontSize: 13 }} />}
                  onClick={() => void onPasteBundle()}
                >
                  Paste bundle
                </Button>
              </Stack>
              <TextField
                size="small"
                fullWidth
                label="Shielded coin key"
                value={counterpartyMidnightCpk}
                onChange={(e) => onCpkInputChange(e.target.value)}
                placeholder="mn_shield-cpk_… or bundle cpk:unshielded"
                error={counterpartyMidnightCpk.trim().length > 0 && !resolvedCounterpartyMidnightCpkBytes}
                helperText={
                  counterpartyMidnightCpk.trim().length === 0
                    ? 'Paste either the coin key alone, or the full cpk:unshielded bundle here.'
                    : resolvedCounterpartyMidnightCpkBytes
                      ? 'Valid shielded coin key.'
                      : 'Not a valid bech32m coin key or 64-hex.'
                }
              />
              <TextField
                size="small"
                fullWidth
                label="Unshielded address"
                value={counterpartyMidnightUnshielded}
                onChange={(e) => onUnshieldedInputChange(e.target.value)}
                placeholder="mn_addr_… or 64-hex"
                error={counterpartyMidnightUnshielded.trim().length > 0 && !resolvedCounterpartyMidnightUnshieldedBytes}
                helperText={
                  counterpartyMidnightUnshielded.trim().length === 0
                    ? 'Payout destination for the USDC when they claim.'
                    : resolvedCounterpartyMidnightUnshieldedBytes
                      ? 'Valid unshielded address.'
                      : 'Not a valid bech32m address or 64-hex.'
                }
              />
            </Stack>
          )}

          {/* Taker summary */}
          {role === 'taker' && fwdUrl && (
            <OfferSummary
              hash={fwdUrl.hashHex}
              deadlineLabel="Cardano deadline"
              deadlineMs={Number(fwdUrl.cardanoDeadlineMs)}
            />
          )}
          {role === 'taker' && revUrl && (
            <OfferSummary
              hash={revUrl.hashHex}
              deadlineLabel="Midnight deadline"
              deadlineMs={Number(revUrl.midnightDeadlineMs)}
            />
          )}

          {restoreNotice && (
            <Alert
              severity="info"
              sx={{ mt: 2 }}
              action={
                <Button size="small" color="inherit" onClick={onForgetPending}>
                  Discard
                </Button>
              }
            >
              {restoreNotice}
            </Alert>
          )}

          <Box sx={{ mt: 2.5 }}>{cta}</Box>
        </Box>

        {/* Footer */}
        <Stack
          direction="row"
          spacing={1}
          alignItems="center"
          justifyContent="center"
          sx={{
            borderTop: `1px solid ${theme.custom.borderSubtle}`,
            px: 2,
            py: 1.25,
            color: theme.custom.textMuted,
            fontSize: '0.66rem',
          }}
        >
          <Typography variant="caption" sx={{ color: 'inherit', fontSize: 'inherit' }}>
            Need USDC?
          </Typography>
          <Link
            component="button"
            underline="hover"
            onClick={() => navigate('/mint')}
            sx={{ fontWeight: 500, fontSize: 'inherit' }}
          >
            Mint on Midnight
          </Link>
          <Typography variant="caption" sx={{ color: 'inherit', fontSize: 'inherit' }}>
            ·
          </Typography>
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

      {modalOpen && (
        <SwapProgressModal
          role={role}
          flowDirection={flowDirection}
          open={modalOpen}
          onClose={() => setModalOpen(false)}
          onReset={onStartOver}
          pay={pair.pay}
          receive={pair.receive}
          usdcColor={swapState.usdcColor}
          fwdMaker={fwdMaker}
          fwdTaker={fwdTaker}
          revMaker={revMaker}
          revTaker={revTaker}
        />
      )}
    </>
  );
};

const payRowHelper = (role: Role, dir: FlowDirection): React.ReactNode => {
  if (role === 'maker') {
    return dir === 'ada-usdc'
      ? 'Paid from your Cardano wallet.'
      : 'Escrowed on Midnight until the counterparty claims.';
  }
  return dir === 'ada-usdc'
    ? 'Escrowed on Midnight until the maker claims.'
    : 'Escrowed on Cardano until the maker claims.';
};

const receiveRowHelper = (role: Role, dir: FlowDirection): React.ReactNode => {
  if (role === 'maker') {
    return dir === 'ada-usdc'
      ? 'Delivered as native USDC on Midnight when you claim.'
      : 'Delivered from the counterparty’s Cardano HTLC when you claim.';
  }
  return dir === 'ada-usdc'
    ? 'Delivered from the maker’s Cardano HTLC when you claim.'
    : 'Delivered as native USDC on Midnight when you claim.';
};

const OfferSummary: React.FC<{ hash: string; deadlineLabel: string; deadlineMs: number }> = ({
  hash,
  deadlineLabel,
  deadlineMs,
}) => {
  const theme = useTheme();
  return (
    <Box
      sx={{
        mt: 2,
        p: 2,
        borderRadius: 1,
        border: `1px solid ${alpha(theme.custom.cardanoBlue, 0.25)}`,
        bgcolor: alpha(theme.custom.cardanoBlue, 0.04),
      }}
    >
      <Typography
        sx={{
          fontSize: '0.64rem',
          fontWeight: 600,
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
          color: theme.custom.textMuted,
          mb: 1,
        }}
      >
        Offer Details
      </Typography>
      <Stack spacing={0.5}>
        <Row k="Hash" v={hash.slice(0, 32) + '…'} />
        <Row k={deadlineLabel} v={new Date(deadlineMs).toLocaleString()} />
      </Stack>
    </Box>
  );
};

const Row: React.FC<{ k: string; v: string }> = ({ k, v }) => {
  const theme = useTheme();
  return (
    <Stack direction="row" spacing={1.5}>
      <Typography
        sx={{
          fontSize: '0.68rem',
          color: theme.custom.textMuted,
          minWidth: 120,
          textTransform: 'uppercase',
          letterSpacing: '0.04em',
        }}
      >
        {k}
      </Typography>
      <Typography sx={{ fontSize: '0.68rem', color: theme.custom.textPrimary }}>
        {v}
      </Typography>
    </Stack>
  );
};
