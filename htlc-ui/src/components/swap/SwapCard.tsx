/**
 * Midswap swap card — a Uniswap-style dual-input card that supports the full
 * bidirectional atomic-swap protocol.
 *
 *   usdm-usdc flow (default)
 *     Maker locks USDM on Cardano; taker deposits USDC on Midnight; maker
 *     claims USDC (reveals preimage on Midnight); taker claims USDM on
 *     Cardano using the revealed preimage.
 *
 *   usdc-usdm flow (click flip)
 *     Maker deposits USDC on Midnight; taker locks USDM on Cardano; maker
 *     claims USDM (reveals preimage via Cardano tx redeemer); taker claims
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
  Chip,
  FormControl,
  FormHelperText,
  IconButton,
  InputAdornment,
  Link,
  ListSubheader,
  MenuItem,
  Select,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import SettingsIcon from '@mui/icons-material/Settings';
import SwapVertIcon from '@mui/icons-material/SwapVert';
import CallMadeIcon from '@mui/icons-material/CallMade';
import VerifiedUserIcon from '@mui/icons-material/VerifiedUser';
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
import { useAuth, useSwapContext } from '../../hooks';
import { useToast } from '../../hooks/useToast';
import { limits } from '../../config/limits';
import { AsyncButton } from '../AsyncButton';
import { decodeShieldedCoinPublicKey, decodeUnshieldedAddress } from '../../api/key-encoding';
import { otcApi, type Rfq, type RfqSide, type WalletSnapshot } from '../../api/orchestrator-client';
import { rfqAmounts } from '../../api/swap-bridge';

const HEX64 = /^[0-9a-fA-F]{64}$/;

/**
 * Eligible counterparties — visual showcase of the regulatory framework
 * Kaamos enforces at the protocol level. Only "open" is selectable on
 * preprod; jurisdiction + license filters land with mainnet.
 */
type EligibilityOption = { value: string; label: string; sublabel?: string };
const ELIGIBILITY_OPEN = 'open';
const ELIGIBILITY_JURISDICTIONS: ReadonlyArray<EligibilityOption> = [
  { value: 'eu', label: 'EU Regulated Institution' },
  { value: 'ch', label: 'Swiss Regulated Institution' },
  { value: 'uk', label: 'UK Regulated Institution' },
  { value: 'whitelist', label: 'Approved Whitelist Only', sublabel: 'Manual KYB' },
];
const ELIGIBILITY_LICENSES: ReadonlyArray<EligibilityOption> = [
  { value: 'finma', label: 'FINMA Bank / Securities Firm' },
  { value: 'mica', label: 'EU MiCA CASP' },
  { value: 'fca', label: 'UK FCA Cryptoasset Firm' },
  { value: 'hk', label: 'HK SFC Type 1 / 7' },
  { value: 'adgm', label: 'ADGM FSRA Licensed' },
];

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
  const { user } = useAuth();

  const networkId = session?.bootstrap.networkId;

  // Role comes from URL (hash present → taker). Flow direction comes from
  // either the URL `direction` param (taker) or local state (maker flip).
  const hashInUrl = !!searchParams.get('hash');
  // Read-side alias: older shared URLs carry direction=ada-usdc / usdc-ada.
  // Map them to the current tokens so in-flight preprod links keep resolving.
  const rawDirection = searchParams.get('direction');
  const urlDirection: FlowDirection =
    rawDirection === 'ada-usdc'
      ? 'usdm-usdc'
      : rawDirection === 'usdc-ada'
        ? 'usdc-usdm'
        : (rawDirection as FlowDirection | null) ?? 'usdm-usdc';
  const role: Role = hashInUrl ? 'taker' : 'maker';

  const [flowDirection, setFlowDirection] = useState<FlowDirection>(hashInUrl ? urlDirection : 'usdm-usdc');

  // Keep flowDirection synced with URL for taker mode.
  useEffect(() => {
    if (hashInUrl) setFlowDirection(urlDirection);
  }, [hashInUrl, urlDirection]);

  const pair = FLOW_PAIR[flowDirection][role];

  // Shared UI state.
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [swapUiHidden, setSwapUiHidden] = useState(false);

  // Maker-only local form.
  const [usdmAmount, setUsdmAmount] = useState('1');
  const [usdcAmount, setUsdcAmount] = useState('1');
  const [eligibility, setEligibility] = useState<string>(ELIGIBILITY_OPEN);
  const [deadlineMin, setDeadlineMin] = useState(limits.aliceDefaultDeadlineMin.toString());

  // Forward-maker counterparty: Cardano address/PKH
  const [counterpartyCardano, setCounterpartyCardano] = useState('');
  const resolvedCounterpartyPkh = useMemo(() => resolvePkh(counterpartyCardano), [counterpartyCardano]);

  // Reverse-maker counterparty: Midnight cpk + unshielded address
  const [counterpartyMidnightCpk, setCounterpartyMidnightCpk] = useState('');
  const [counterpartyMidnightUnshielded, setCounterpartyMidnightUnshielded] = useState('');

  // OTC bridge: when ?rfqId is set on the URL and there's no ?hash, the
  // originator is being routed in from RfqDetail to drive the maker side
  // of an accepted order. Fetch the RFQ and hydrate amounts + counterparty
  // from the wallet snapshot taken at quote-accept time. The counterparty
  // inputs render pre-filled and read-only with a "bound from order"
  // badge, and `rfqId` is propagated through createSwap.
  const rfqIdFromUrl = searchParams.get('rfqId');
  const [rfqContext, setRfqContext] = useState<{
    rfq: Rfq;
    provider: WalletSnapshot;
    acceptedBuyAmount?: string;
  } | null>(null);
  const rfqHydratedRef = React.useRef(false);
  useEffect(() => {
    if (!rfqIdFromUrl || hashInUrl) return;
    let cancelled = false;
    void (async () => {
      try {
        const r = await otcApi.getRfq(rfqIdFromUrl);
        if (cancelled) return;
        let provider = r.providerWalletSnapshot ?? undefined;
        let acceptedBuyAmount: string | undefined;
        if (r.selectedQuoteId) {
          try {
            const qs = await otcApi.listQuotes(rfqIdFromUrl);
            const accepted = qs.quotes.find((q) => q.id === r.selectedQuoteId);
            if (accepted) {
              acceptedBuyAmount = accepted.buyAmount;
              provider = provider ?? accepted.walletSnapshot ?? undefined;
            }
          } catch {
            // Ignore; we'll fall back to acceptedPrice math.
          }
        }

        if (!provider) {
          toast.warning('Order is not ready for settlement yet — counterparty wallet missing.');
          return;
        }
        setRfqContext({ rfq: r, provider, acceptedBuyAmount });
      } catch (e) {
        if (!cancelled) toast.error(e instanceof Error ? e.message : 'Could not load order');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [rfqIdFromUrl, hashInUrl, toast]);

  // One-shot hydration: when rfqContext arrives, set direction + amounts +
  // counterparty fields. Guarded by useRef so the user can still hand-edit.
  useEffect(() => {
    if (!rfqContext || rfqHydratedRef.current) return;
    rfqHydratedRef.current = true;
    const { direction, usdmAmount: u, usdcAmount: c } = rfqAmounts(rfqContext.rfq);
    const acceptedBuyAmount = rfqContext.acceptedBuyAmount;
    setFlowDirection(direction);
    if (acceptedBuyAmount) {
      if (direction === 'usdm-usdc') {
        setUsdmAmount(rfqContext.rfq.sellAmount);
        setUsdcAmount(acceptedBuyAmount);
      } else {
        setUsdcAmount(rfqContext.rfq.sellAmount);
        setUsdmAmount(acceptedBuyAmount);
      }
    } else {
      setUsdmAmount(u);
      setUsdcAmount(c);
    }
    if (direction === 'usdm-usdc') {
      // Forward — maker locks USDM on Cardano against taker's PKH. The
      // counterparty's snapshot must have cardano fields (validated server-
      // side at quote time), but the type is partial so we coerce.
      setCounterpartyCardano(rfqContext.provider.cardanoAddress ?? '');
    } else {
      // Reverse — maker deposits USDC on Midnight bound to taker's keys.
      setCounterpartyMidnightCpk(rfqContext.provider.midnightCpkBech32 ?? '');
      setCounterpartyMidnightUnshielded(rfqContext.provider.midnightUnshieldedBech32 ?? '');
    }
  }, [rfqContext]);
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
      ? flowDirection === 'usdm-usdc'
        ? fwdMaker.state
        : revMaker.state
      : flowDirection === 'usdm-usdc'
        ? fwdTaker.state
        : revTaker.state;

  useEffect(() => {
    if (!swapUiHidden && activeState.kind !== 'idle' && activeState.kind !== 'error') {
      setModalOpen(true);
    }
  }, [activeState.kind, swapUiHidden]);

  // Taker URL parsing — forward or reverse depending on the `direction` param.
  const fwdUrl = useMemo(() => {
    if (role !== 'taker' || flowDirection !== 'usdm-usdc') return undefined;
    const parsed = parseUrlInputs(searchParams);
    return 'error' in parsed ? undefined : parsed;
  }, [searchParams, role, flowDirection]);

  const revUrl = useMemo(() => {
    if (role !== 'taker' || flowDirection !== 'usdc-usdm') return undefined;
    const parsed = parseReverseUrl(searchParams);
    return 'error' in parsed ? undefined : parsed;
  }, [searchParams, role, flowDirection]);

  const urlError = useMemo(() => {
    if (role !== 'taker') return undefined;
    if (flowDirection === 'usdm-usdc') {
      const parsed = parseUrlInputs(searchParams);
      return 'error' in parsed ? parsed.error : undefined;
    }
    const parsed = parseReverseUrl(searchParams);
    return 'error' in parsed ? parsed.error : undefined;
  }, [searchParams, role, flowDirection]);

  // Auto-start the correct taker flow when wallets + URL are ready.
  useEffect(() => {
    if (role !== 'taker' || !session || !cardano) return;
    if (flowDirection === 'usdm-usdc' && fwdUrl && fwdTaker.state.kind === 'idle') {
      fwdTaker.start(fwdUrl);
      setModalOpen(true);
    } else if (flowDirection === 'usdc-usdm' && revUrl && revTaker.state.kind === 'idle') {
      revTaker.start(revUrl);
      setModalOpen(true);
    }
  }, [role, flowDirection, fwdUrl, revUrl, session, cardano, fwdTaker, revTaker]);

  // Amounts shown in taker mode come from the URL.
  const takerPayValue = (() => {
    if (role !== 'taker') return '';
    if (flowDirection === 'usdm-usdc') return fwdUrl ? fwdUrl.usdcAmount.toString() : '';
    return revUrl ? revUrl.usdmAmount.toString() : '';
  })();
  const takerReceiveValue = (() => {
    if (role !== 'taker') return '';
    if (flowDirection === 'usdm-usdc') return fwdUrl ? fwdUrl.usdmAmount.toString() : '';
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

  const onCreateOrder = useCallback(async () => {
    try {
      if (!user) {
        toast.info('Sign in to create an order.');
        navigate('/login');
        return;
      }
      const sell = BigInt(flowDirection === 'usdm-usdc' ? usdmAmount : usdcAmount || '0');
      const buy = BigInt(flowDirection === 'usdm-usdc' ? usdcAmount : usdmAmount || '0');
      if (sell <= 0n || buy <= 0n) {
        throw new Error('Enter positive amounts for both sides.');
      }
      const min = parseInt(deadlineMin, 10);
      if (!Number.isFinite(min) || min < limits.aliceMinDeadlineMin) {
        throw new Error(`Order expiry must be ≥ ${limits.aliceMinDeadlineMin} minutes.`);
      }
      const side: RfqSide = flowDirection === 'usdm-usdc' ? 'sell-usdm' : 'sell-usdc';
      const rfq = await otcApi.createRfq({
        side,
        sellAmount: sell.toString(),
        indicativeBuyAmount: buy.toString(),
        expiresInSeconds: min * 60,
      });
      toast.success(`Posted ${rfq.reference}`);
      navigate(`/rfq/${rfq.id}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  }, [user, flowDirection, usdmAmount, usdcAmount, deadlineMin, toast, navigate]);

  const onSubmitMaker = useCallback(async () => {
    try {
      const ada = BigInt(usdmAmount || '0');
      const usdc = BigInt(usdcAmount || '0');
      const min = parseInt(deadlineMin, 10);
      if (ada <= 0n || usdc <= 0n) throw new Error('Enter positive amounts for both sides.');
      if (!Number.isFinite(min) || min < limits.aliceMinDeadlineMin) {
        throw new Error(`Deadline must be ≥ ${limits.aliceMinDeadlineMin} minutes.`);
      }

      if (flowDirection === 'usdm-usdc') {
        if (!resolvedCounterpartyPkh) {
          throw new Error("Paste the counterparty's Cardano address or 56-hex PKH.");
        }
        setModalOpen(true);
        await fwdMaker.lock({
          usdmAmount: ada,
          usdcAmount: usdc,
          deadlineMin: min,
          counterpartyPkh: resolvedCounterpartyPkh,
          rfqId: rfqContext?.rfq.id,
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
          usdmAmount: ada,
          usdcAmount: usdc,
          deadlineMin: min,
          counterpartyCpkBytes: resolvedCounterpartyMidnightCpkBytes,
          counterpartyUnshieldedBytes: resolvedCounterpartyMidnightUnshieldedBytes,
          rfqId: rfqContext?.rfq.id,
        });
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  }, [
    usdmAmount,
    usdcAmount,
    deadlineMin,
    flowDirection,
    resolvedCounterpartyPkh,
    resolvedCounterpartyMidnightCpkBytes,
    resolvedCounterpartyMidnightUnshieldedBytes,
    rfqContext,
    fwdMaker,
    revMaker,
    toast,
  ]);

  const onFlip = useCallback(() => {
    // Only the maker controls flow direction. Takers inherit from URL.
    if (role === 'taker') {
      // Flipping in taker mode clears the URL and returns to maker mode.
      setSearchParams(new URLSearchParams());
      setFlowDirection('usdm-usdc');
      return;
    }
    // Disallow flipping while an active maker flow is in flight — it would
    // orphan the preimage / pending swap.
    if (
      (flowDirection === 'usdm-usdc' && fwdMaker.state.kind !== 'idle' && fwdMaker.state.kind !== 'error') ||
      (flowDirection === 'usdc-usdm' && revMaker.state.kind !== 'idle' && revMaker.state.kind !== 'error')
    ) {
      toast.warning('Finish or discard the in-flight swap before flipping direction.');
      return;
    }
    setFlowDirection((d) => (d === 'usdm-usdc' ? 'usdc-usdm' : 'usdm-usdc'));
  }, [role, flowDirection, fwdMaker.state.kind, revMaker.state.kind, setSearchParams, toast]);

  const onStartOver = useCallback(() => {
    setModalOpen(false);
    setSwapUiHidden(false);
    setSearchParams(new URLSearchParams());
    fwdMaker.reset();
    fwdTaker.reset();
    revMaker.reset();
    revTaker.reset();
    setFlowDirection('usdm-usdc');
  }, [fwdMaker, fwdTaker, revMaker, revTaker, setSearchParams]);

  const walletsReady = !!session && !!cardano;

  // --------------------------------------------------------------------------
  // CTA
  // --------------------------------------------------------------------------

  const usdm = Number(usdmAmount || '0');
  const usdc = Number(usdcAmount || '0');
  const hasAmounts = usdm > 0 && usdc > 0;

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
  } else if (role === 'maker' && !rfqContext) {
    // Create-order mode — posting an RFQ is just intent, wallets bind at
    // quote-accept / lock time. Gate only on amounts; auth gate handled
    // inside onCreateOrder.
    if (!hasAmounts) {
      cta = (
        <Button variant="contained" color="primary" size="large" fullWidth disabled>
          Enter amount
        </Button>
      );
    } else {
      cta = (
        <AsyncButton
          variant="contained"
          color="primary"
          size="large"
          fullWidth
          onClick={onCreateOrder}
          pendingLabel="Posting order…"
        >
          {user ? 'Create Order' : 'Sign in to create order'}
        </AsyncButton>
      );
    }
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
    // Lock-after-accept mode: counterparty wallet auto-bound from snapshot.
    const hasCounterparty =
      flowDirection === 'usdm-usdc'
        ? !!resolvedCounterpartyPkh
        : !!resolvedCounterpartyMidnightCpkBytes && !!resolvedCounterpartyMidnightUnshieldedBytes;
    if (!hasAmounts || !hasCounterparty) {
      cta = (
        <Button variant="contained" color="primary" size="large" fullWidth disabled>
          Loading order…
        </Button>
      );
    } else {
      const label = flowDirection === 'usdm-usdc' ? `Review & lock ${usdm} USDM` : `Review & deposit ${usdc} USDC`;
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
    role === 'maker' ? (flowDirection === 'usdm-usdc' ? fwdMaker.restoreNotice : revMaker.restoreNotice) : undefined;
  const onHideSwapUi = useCallback(() => {
    setModalOpen(false);
    setSwapUiHidden(true);
    toast.info('Settlement hidden on this page. Reopen it here or recover from Order Book detail.');
  }, [toast]);

  const directionBadge =
    role === 'maker'
      ? flowDirection === 'usdm-usdc'
        ? 'USDM → USDC'
        : 'USDC → USDM'
      : flowDirection === 'usdm-usdc'
        ? 'Take USDM → USDC'
        : 'Take USDC → USDM';

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
                value={role === 'maker' ? (flowDirection === 'usdm-usdc' ? usdmAmount : usdcAmount) : takerPayValue}
                onChange={role === 'maker' ? (flowDirection === 'usdm-usdc' ? setUsdmAmount : setUsdcAmount) : undefined}
                token={pair.pay}
                readOnly={role === 'taker'}
                helper={payRowHelper(role, flowDirection)}
                autoFocus={role === 'maker'}
              />
              <TokenRow
                label="You receive"
                value={role === 'maker' ? (flowDirection === 'usdm-usdc' ? usdcAmount : usdmAmount) : takerReceiveValue}
                onChange={role === 'maker' ? (flowDirection === 'usdm-usdc' ? setUsdcAmount : setUsdmAmount) : undefined}
                token={pair.receive}
                readOnly={role === 'taker'}
                helper={receiveRowHelper(role, flowDirection)}
              />
            </Stack>

            <Tooltip
              title={
                role === 'taker'
                  ? 'Flipping will discard the offer URL'
                  : flowDirection === 'usdm-usdc'
                    ? 'Flip to USDC → USDM (offer USDC for USDM)'
                    : 'Flip to USDM → USDC (offer USDM for USDC)'
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

          {/* Counterparty input — differs by direction. When the maker arrived
              via /swap?rfqId=… the keys are pre-filled from the RFQ snapshot
              and the inputs become read-only with a "bound from order" badge.
              Edits are blocked because a typo would silently desync from the
              snapshot the LP committed to (their watcher would never see the
              maker's deposit). */}
          {role === 'maker' && flowDirection === 'usdm-usdc' && rfqContext && (
            <Box sx={{ mt: 2 }}>
              <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1 }}>
                <Typography
                  sx={{
                    fontSize: '0.64rem',
                    fontWeight: 600,
                    textTransform: 'uppercase',
                    letterSpacing: '0.06em',
                    color: theme.custom.textMuted,
                  }}
                >
                  Counterparty Wallet
                </Typography>
                <BoundBadge reference={rfqContext.rfq.reference} />
              </Stack>
              <TextField
                size="small"
                fullWidth
                label="Cardano address or PKH"
                value={counterpartyCardano}
                placeholder="addr_test1… or 56-hex PKH"
                disabled
                helperText={`Auto-bound from ${rfqContext.rfq.reference}. ${rfqContext.rfq.selectedProviderName ?? 'Counterparty'} will receive the USDM here.`}
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

          {role === 'maker' && flowDirection === 'usdc-usdm' && rfqContext && (
            <Stack spacing={1.25} sx={{ mt: 2 }}>
              <Stack direction="row" alignItems="center" spacing={1}>
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
                <BoundBadge reference={rfqContext.rfq.reference} />
              </Stack>
              <TextField
                size="small"
                fullWidth
                label="Shielded coin key"
                value={counterpartyMidnightCpk}
                placeholder="mn_shield-cpk_…"
                disabled
                helperText={`Auto-bound from ${rfqContext.rfq.reference}.`}
              />
              <TextField
                size="small"
                fullWidth
                label="Unshielded address"
                value={counterpartyMidnightUnshielded}
                placeholder="mn_addr_…"
                disabled
                helperText={`${rfqContext.rfq.selectedProviderName ?? 'Counterparty'} will receive the USDC here.`}
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
                <Button size="small" color="inherit" onClick={onHideSwapUi}>
                  Hide
                </Button>
              }
            >
              {restoreNotice}
            </Alert>
          )}

          {swapUiHidden && (
            <Alert
              severity="info"
              sx={{ mt: 2 }}
              action={
                <Stack direction="row" spacing={1}>
                  <Button
                    size="small"
                    color="inherit"
                    onClick={() => {
                      setSwapUiHidden(false);
                      setModalOpen(true);
                    }}
                  >
                    Resume here
                  </Button>
                  {rfqIdFromUrl && (
                    <Button
                      size="small"
                      color="inherit"
                      onClick={() => void navigate(`/rfq/${rfqIdFromUrl}`)}
                    >
                      Order detail
                    </Button>
                  )}
                </Stack>
              }
            >
              Settlement is hidden on this screen. You can recover it from the order detail page at any time.
            </Alert>
          )}

          {role === 'maker' && (
            <EligibleCounterparties value={eligibility} onChange={setEligibility} />
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
            Need test tokens?
          </Typography>
          <Link
            component="button"
            underline="hover"
            onClick={() => navigate('/faucet')}
            sx={{ fontWeight: 500, fontSize: 'inherit' }}
          >
            Open faucet
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
    return dir === 'usdm-usdc'
      ? 'Paid from your Cardano wallet.'
      : 'Escrowed on Midnight until the counterparty claims.';
  }
  return dir === 'usdm-usdc'
    ? 'Escrowed on Midnight until the maker claims.'
    : 'Escrowed on Cardano until the maker claims.';
};

const receiveRowHelper = (role: Role, dir: FlowDirection): React.ReactNode => {
  if (role === 'maker') {
    return dir === 'usdm-usdc'
      ? 'Delivered as native USDC on Midnight when you claim.'
      : 'Delivered from the counterparty’s Cardano HTLC when you claim.';
  }
  return dir === 'usdm-usdc'
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

const BoundBadge: React.FC<{ reference: string }> = ({ reference }) => {
  const theme = useTheme();
  return (
    <Box
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 0.5,
        px: 0.75,
        py: 0.15,
        borderRadius: 0.75,
        border: `1px solid ${alpha(theme.custom.teal, 0.4)}`,
        bgcolor: alpha(theme.custom.teal, 0.08),
        fontFamily: 'JetBrains Mono, monospace',
        fontSize: '0.56rem',
        letterSpacing: '0.12em',
        textTransform: 'uppercase',
        color: theme.custom.teal,
      }}
    >
      <Box
        sx={{
          width: 6,
          height: 6,
          borderRadius: '50%',
          bgcolor: theme.custom.teal,
          boxShadow: `0 0 6px ${alpha(theme.custom.teal, 0.6)}`,
        }}
      />
      bound · {reference}
    </Box>
  );
};

const EligibleCounterparties: React.FC<{ value: string; onChange: (v: string) => void }> = ({ value, onChange }) => {
  const theme = useTheme();
  const isOpen = value === ELIGIBILITY_OPEN;

  const subheaderSx = {
    bgcolor: 'transparent',
    color: theme.custom.textMuted,
    fontFamily: 'JetBrains Mono, monospace',
    fontSize: '0.6rem',
    fontWeight: 600,
    letterSpacing: '0.14em',
    textTransform: 'uppercase' as const,
    lineHeight: 1.6,
    pt: 1.5,
    pb: 0.5,
  };

  const soonChipSx = {
    height: 16,
    fontSize: '0.55rem',
    fontWeight: 600,
    letterSpacing: '0.08em',
    textTransform: 'uppercase' as const,
    bgcolor: alpha(theme.custom.teal, 0.08),
    color: theme.custom.teal,
    border: `1px solid ${alpha(theme.custom.teal, 0.25)}`,
    borderRadius: '999px',
    '& .MuiChip-label': { px: 0.7 },
  };

  const renderRow = (opt: EligibilityOption) => (
    <MenuItem key={opt.value} value={opt.value} disabled sx={{ opacity: 0.55, py: 0.6 }}>
      <Stack direction="row" alignItems="center" spacing={1} sx={{ width: '100%' }}>
        <Typography variant="body2" sx={{ flex: 1, color: theme.custom.textSecondary }}>
          {opt.label}
        </Typography>
        {opt.sublabel && (
          <Typography
            variant="caption"
            sx={{ color: theme.custom.textMuted, fontFamily: 'JetBrains Mono, monospace', fontSize: '0.62rem' }}
          >
            {opt.sublabel}
          </Typography>
        )}
        <Chip label="Coming Soon" size="small" sx={soonChipSx} />
      </Stack>
    </MenuItem>
  );

  return (
    <Box sx={{ mt: 2 }}>
      <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1 }}>
        <VerifiedUserIcon sx={{ fontSize: 12, color: theme.custom.textMuted }} />
        <Typography
          sx={{
            fontSize: '0.64rem',
            fontWeight: 600,
            textTransform: 'uppercase',
            letterSpacing: '0.06em',
            color: theme.custom.textMuted,
          }}
        >
          Eligible Counterparties
        </Typography>
      </Stack>
      <FormControl fullWidth size="small">
        <Select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          renderValue={(selected) => (
            <Stack direction="row" alignItems="center" spacing={1}>
              <Box
                sx={{
                  width: 6,
                  height: 6,
                  borderRadius: '50%',
                  bgcolor: isOpen ? '#22c55e' : theme.custom.teal,
                  boxShadow: `0 0 6px ${alpha(isOpen ? '#22c55e' : theme.custom.teal, 0.6)}`,
                }}
              />
              <Typography variant="body2" sx={{ color: theme.custom.textPrimary }}>
                {selected === ELIGIBILITY_OPEN
                  ? 'Open · All Counterparties'
                  : ([...ELIGIBILITY_JURISDICTIONS, ...ELIGIBILITY_LICENSES].find((o) => o.value === selected)?.label
                      ?? 'Open · All Counterparties')}
              </Typography>
            </Stack>
          )}
          MenuProps={{
            PaperProps: {
              sx: {
                mt: 0.5,
                bgcolor: theme.custom.surface1,
                border: `1px solid ${theme.custom.borderSubtle}`,
                backgroundImage: 'none',
              },
            },
          }}
          sx={{
            '& .MuiOutlinedInput-notchedOutline': {
              borderColor: theme.custom.borderSubtle,
            },
            '&:hover .MuiOutlinedInput-notchedOutline': {
              borderColor: alpha(theme.custom.teal, 0.4),
            },
          }}
        >
          <MenuItem value={ELIGIBILITY_OPEN} sx={{ py: 0.75 }}>
            <Stack direction="row" alignItems="center" spacing={1} sx={{ width: '100%' }}>
              <Box
                sx={{
                  width: 6,
                  height: 6,
                  borderRadius: '50%',
                  bgcolor: '#22c55e',
                  boxShadow: `0 0 6px ${alpha('#22c55e', 0.6)}`,
                }}
              />
              <Typography variant="body2" sx={{ flex: 1, color: theme.custom.textPrimary }}>
                Open · All Counterparties
              </Typography>
              <Typography
                variant="caption"
                sx={{
                  color: '#22c55e',
                  fontFamily: 'JetBrains Mono, monospace',
                  fontSize: '0.6rem',
                  letterSpacing: '0.08em',
                  textTransform: 'uppercase',
                }}
              >
                Active
              </Typography>
            </Stack>
          </MenuItem>
          <ListSubheader sx={subheaderSx}>Jurisdiction</ListSubheader>
          {ELIGIBILITY_JURISDICTIONS.map(renderRow)}
          <ListSubheader sx={subheaderSx}>License Type</ListSubheader>
          {ELIGIBILITY_LICENSES.map(renderRow)}
        </Select>
        <FormHelperText sx={{ mx: 0, color: theme.custom.textMuted }}>
          Counterparty filtering enforced at the protocol level
        </FormHelperText>
      </FormControl>
    </Box>
  );
};
