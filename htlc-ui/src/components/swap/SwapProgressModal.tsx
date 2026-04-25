/**
 * Progress modal — drives the multi-step swap flow for all four (role, flow)
 * combinations. Each combination produces its own phase list (labels adapted
 * to which chain each step lives on). The modal picks the correct state and
 * actions based on role + flowDirection.
 */

import React from 'react';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogContent,
  DialogTitle,
  IconButton,
  Link,
  Stack,
  Typography,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline';
import RadioButtonUncheckedIcon from '@mui/icons-material/RadioButtonUnchecked';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import { alpha, useTheme } from '@mui/material/styles';
import type { CardanoHTLCInfo } from '../../api/cardano-watcher';
import type { FlowDirection, Role, TokenMeta } from './tokens';
import type { UseMakerFlow, MakerStep } from './useMakerFlow';
import type { UseTakerFlow, TakerStep } from './useTakerFlow';
import type { UseReverseMakerFlow, ReverseMakerStep } from './useReverseMakerFlow';
import type { UseReverseTakerFlow, ReverseTakerStep } from './useReverseTakerFlow';
import { AsyncButton } from '../AsyncButton';
import { ShareUrlCard } from '../ShareUrlCard';
import { describeBobWindow, limits } from '../../config/limits';
import { TokenBadge } from './TokenBadge';

type StepStatus = 'pending' | 'active' | 'done' | 'error';

interface PhaseRow {
  id: string;
  title: string;
  subtitle?: React.ReactNode;
  status: StepStatus;
  action?: React.ReactNode;
}

interface Props {
  readonly role: Role;
  readonly flowDirection: FlowDirection;
  readonly open: boolean;
  readonly onClose: () => void;
  readonly onReset: () => void;
  readonly pay: TokenMeta;
  readonly receive: TokenMeta;
  readonly usdcColor: string;
  readonly fwdMaker: UseMakerFlow;
  readonly fwdTaker: UseTakerFlow;
  readonly revMaker: UseReverseMakerFlow;
  readonly revTaker: UseReverseTakerFlow;
}

// 1AM explorer for Midnight (https://explorer.1am.xyz/tx/<hash>?network=preprod);
// CardanoScan for the Cardano leg.
const TX_SCAN_URL: Record<'midnight' | 'cardano', (hash: string) => string> = {
  midnight: (h) => `https://explorer.1am.xyz/tx/${h}?network=preprod`,
  cardano: (h) => `https://preprod.cardanoscan.io/transaction/${h}`,
};

const txLink = (chain: 'midnight' | 'cardano', hash: string): React.ReactNode => (
  <Link href={TX_SCAN_URL[chain](hash)} target="_blank" rel="noopener" sx={{ fontSize: 12 }}>
    <code style={{ fontSize: 12 }}>
      {hash.slice(0, 8)}…{hash.slice(-6)}
    </code>{' '}
    <OpenInNewIcon fontSize="inherit" sx={{ verticalAlign: 'text-bottom' }} />
  </Link>
);

// ---------------------------------------------------------------------------
// Forward maker (ada-usdc maker)
// ---------------------------------------------------------------------------

const buildForwardMakerPhases = (
  state: MakerStep,
  shareUrl: string | undefined,
  onClaim: () => void | Promise<void>,
): PhaseRow[] => {
  const hasLockInfo =
    state.kind === 'locked' ||
    state.kind === 'waiting-deposit' ||
    state.kind === 'claim-ready' ||
    state.kind === 'claiming';
  const afterLock = hasLockInfo || state.kind === 'done';
  const afterDeposit = state.kind === 'claim-ready' || state.kind === 'claiming' || state.kind === 'done';
  const afterClaim = state.kind === 'done';

  let lockSubtitle: React.ReactNode;
  if (state.kind === 'locking') {
    lockSubtitle = 'Please sign in your Cardano wallet.';
  } else if (hasLockInfo) {
    lockSubtitle = (
      <Stack spacing={0.25}>
        <Typography variant="caption">Locked until {new Date(Number(state.deadlineMs)).toLocaleString()}</Typography>
        <Typography variant="caption">Lock tx: {txLink('cardano', state.lockTxHash)}</Typography>
      </Stack>
    );
  } else if (state.kind === 'done') {
    lockSubtitle = <Typography variant="caption">Lock tx: {txLink('cardano', state.lockTxHash)}</Typography>;
  }

  return [
    {
      id: 'lock',
      title: 'Lock USDM on Cardano',
      subtitle: lockSubtitle,
      status: state.kind === 'locking' ? 'active' : afterLock ? 'done' : state.kind === 'error' ? 'error' : 'pending',
    },
    {
      id: 'share',
      title: 'Share the offer',
      subtitle:
        afterLock && shareUrl
          ? 'The counterparty opens this URL to accept. Once they deposit USDC, this step is done.'
          : 'Waiting for lock confirmation…',
      status: afterDeposit ? 'done' : afterLock && shareUrl ? 'active' : 'pending',
      action:
        afterLock && shareUrl && !afterDeposit ? (
          <ShareUrlCard shareUrl={shareUrl} title="Share the offer URL" />
        ) : undefined,
    },
    {
      id: 'claim',
      title: 'Claim USDC on Midnight',
      subtitle: afterClaim
        ? `Received ${state.kind === 'done' ? state.depositAmount.toString() : ''} USDC.`
        : afterDeposit
          ? 'Counterparty deposited — you can claim now. Claiming reveals the preimage on Midnight.'
          : 'Waits for the counterparty deposit to appear on Midnight.',
      status: state.kind === 'claiming' ? 'active' : afterClaim ? 'done' : afterDeposit ? 'active' : 'pending',
      action:
        state.kind === 'claim-ready' ? (
          <AsyncButton variant="contained" color="primary" size="large" onClick={onClaim} pendingLabel="Signing…">
            Claim USDC
          </AsyncButton>
        ) : undefined,
    },
  ];
};

// ---------------------------------------------------------------------------
// Forward taker (ada-usdc taker)
// ---------------------------------------------------------------------------

const buildForwardTakerPhases = (
  state: TakerStep,
  onAccept: () => void,
  onClaim: () => void | Promise<void>,
  usdcColor: string,
): PhaseRow[] => {
  const afterWatch =
    state.kind === 'confirm' ||
    state.kind === 'depositing' ||
    state.kind === 'waiting-preimage' ||
    state.kind === 'claim-ready' ||
    state.kind === 'claiming' ||
    state.kind === 'done';
  const afterDeposit =
    state.kind === 'waiting-preimage' ||
    state.kind === 'claim-ready' ||
    state.kind === 'claiming' ||
    state.kind === 'done';
  const afterPreimage = state.kind === 'claim-ready' || state.kind === 'claiming' || state.kind === 'done';
  const afterClaim = state.kind === 'done';
  const lockInfo = afterWatch ? (state as Extract<TakerStep, { htlcInfo: CardanoHTLCInfo }>).htlcInfo : undefined;

  return [
    {
      id: 'watch',
      title: "Verify the maker's USDM lock",
      subtitle:
        state.kind === 'watching-cardano'
          ? 'Scanning Cardano for the lock bound to your wallet…'
          : afterWatch
            ? lockInfo && (
                <Stack spacing={0.25}>
                  <Typography variant="caption">Found: {lockInfo.amountUsdm.toString()} USDM locked.</Typography>
                  <Typography variant="caption">
                    Lock tx: {txLink('cardano', lockInfo.lockTxHash)}
                  </Typography>
                </Stack>
              )
            : state.kind === 'unsafe-deadline'
              ? state.reason
              : 'Waiting for wallet connection.',
      status:
        state.kind === 'watching-cardano'
          ? 'active'
          : afterWatch
            ? 'done'
            : state.kind === 'unsafe-deadline' || state.kind === 'error'
              ? 'error'
              : 'pending',
    },
    {
      id: 'deposit',
      title: 'Deposit USDC on Midnight',
      subtitle: afterDeposit
        ? 'Deposited. Your USDC is escrowed until the maker claims or your deadline passes.'
        : state.kind === 'depositing'
          ? 'Sign in your Midnight wallet.'
          : state.kind === 'confirm'
            ? describeBobWindow(Number(state.htlcInfo.deadlineMs), Number(state.bobDeadlineSecs))
            : 'Waiting for verification.',
      status:
        state.kind === 'depositing'
          ? 'active'
          : afterDeposit
            ? 'done'
            : state.kind === 'confirm'
              ? 'active'
              : 'pending',
      action:
        state.kind === 'confirm' ? (
          <Stack spacing={1}>
            {state.truncated && (
              <Alert severity="info" sx={{ py: 0.5 }}>
                Midnight deadline truncated to stay {Math.round(limits.bobSafetyBufferSecs / 60)}min inside the Cardano
                window.
              </Alert>
            )}
            <AsyncButton variant="contained" color="primary" size="large" onClick={onAccept} pendingLabel="Preparing…">
              Accept & deposit {state.url.usdcAmount.toString()} USDC
            </AsyncButton>
            <Typography variant="caption" sx={{ color: (t) => t.custom.textMuted }}>
              USDC color {usdcColor.slice(0, 16)}…
            </Typography>
          </Stack>
        ) : undefined,
    },
    {
      id: 'preimage',
      title: 'Wait for the maker to reveal',
      subtitle: afterPreimage
        ? 'Preimage on-chain. Use it to spend the Cardano lock.'
        : afterDeposit
          ? 'Usually resolves within seconds once the maker claims their USDC.'
          : 'Pending.',
      status: state.kind === 'waiting-preimage' ? 'active' : afterPreimage ? 'done' : 'pending',
    },
    {
      id: 'claim',
      title: 'Claim USDM on Cardano',
      subtitle:
        state.kind === 'done' ? (
          <>
            Received {state.htlcInfo.amountUsdm.toString()} USDM. Claim tx{' '}
            {txLink('cardano', state.claimTxHash)}.
          </>
        ) : afterPreimage ? (
          'Ready to claim with the revealed preimage.'
        ) : (
          'Pending.'
        ),
      status: state.kind === 'claiming' ? 'active' : afterClaim ? 'done' : afterPreimage ? 'active' : 'pending',
      action:
        state.kind === 'claim-ready' ? (
          <AsyncButton variant="contained" color="primary" size="large" onClick={onClaim} pendingLabel="Signing…">
            Claim USDM
          </AsyncButton>
        ) : undefined,
    },
  ];
};

// ---------------------------------------------------------------------------
// Reverse maker (usdc-ada maker)
// ---------------------------------------------------------------------------

const buildReverseMakerPhases = (
  state: ReverseMakerStep,
  shareUrl: string | undefined,
  onClaim: () => void | Promise<void>,
): PhaseRow[] => {
  const hasDepositInfo =
    state.kind === 'deposited' ||
    state.kind === 'waiting-cardano' ||
    state.kind === 'claim-ready' ||
    state.kind === 'claiming';
  const afterDeposit = hasDepositInfo || state.kind === 'done';
  const afterCardanoLock = state.kind === 'claim-ready' || state.kind === 'claiming' || state.kind === 'done';
  const afterClaim = state.kind === 'done';
  const lockInfo = state.kind === 'claim-ready' || state.kind === 'claiming' ? state.cardanoHtlc : undefined;

  let depositSubtitle: React.ReactNode;
  if (state.kind === 'depositing') {
    depositSubtitle = 'Please sign in your Midnight wallet.';
  } else if (hasDepositInfo) {
    depositSubtitle = `Deposit expires ${new Date(Number(state.midnightDeadlineMs)).toLocaleString()}.`;
  } else if (state.kind === 'done') {
    depositSubtitle = 'USDC deposit done.';
  }

  return [
    {
      id: 'deposit',
      title: 'Deposit USDC on Midnight',
      subtitle: depositSubtitle,
      status:
        state.kind === 'depositing' ? 'active' : afterDeposit ? 'done' : state.kind === 'error' ? 'error' : 'pending',
    },
    {
      id: 'share',
      title: 'Share the offer',
      subtitle:
        afterDeposit && shareUrl
          ? 'The counterparty opens this URL and locks USDM on Cardano bound to your PKH.'
          : 'Waiting for deposit confirmation…',
      status: afterCardanoLock ? 'done' : afterDeposit && shareUrl ? 'active' : 'pending',
      action:
        afterDeposit && shareUrl && !afterCardanoLock ? (
          <ShareUrlCard shareUrl={shareUrl} title="Share the offer URL" />
        ) : undefined,
    },
    {
      id: 'claim',
      title: 'Claim USDM on Cardano',
      subtitle:
        state.kind === 'done' ? (
          <>Claim tx {txLink('cardano', state.claimTxHash)}. Preimage revealed via tx redeemer.</>
        ) : lockInfo ? (
          <Stack spacing={0.25}>
            <Typography variant="caption">Counterparty locked {lockInfo.amountUsdm.toString()} USDM.</Typography>
            <Typography variant="caption">Lock tx: {txLink('cardano', lockInfo.lockTxHash)}</Typography>
          </Stack>
        ) : afterCardanoLock ? (
          'Counterparty locked USDM — claim it now. The preimage is revealed via the Cardano tx redeemer.'
        ) : (
          'Waits for the counterparty to lock USDM bound to your PKH.'
        ),
      status: state.kind === 'claiming' ? 'active' : afterClaim ? 'done' : afterCardanoLock ? 'active' : 'pending',
      action:
        state.kind === 'claim-ready' ? (
          <AsyncButton variant="contained" color="primary" size="large" onClick={onClaim} pendingLabel="Signing…">
            Claim {state.cardanoHtlc.amountUsdm.toString()} USDM
          </AsyncButton>
        ) : undefined,
    },
  ];
};

// ---------------------------------------------------------------------------
// Reverse taker (usdc-ada taker)
// ---------------------------------------------------------------------------

const buildReverseTakerPhases = (
  state: ReverseTakerStep,
  onAccept: () => void,
  onClaim: () => void | Promise<void>,
): PhaseRow[] => {
  const hasMidnightInfo = 'midnightInfo' in state;
  const afterVerify = hasMidnightInfo;
  const afterLock =
    state.kind === 'waiting-preimage' ||
    state.kind === 'claim-ready' ||
    state.kind === 'claiming' ||
    state.kind === 'done';
  const afterPreimage = state.kind === 'claim-ready' || state.kind === 'claiming' || state.kind === 'done';
  const afterClaim = state.kind === 'done';

  return [
    {
      id: 'verify',
      title: "Verify the maker's USDC deposit",
      subtitle:
        state.kind === 'verifying-midnight'
          ? 'Scanning Midnight for the deposit bound to your wallet…'
          : state.kind === 'mismatch' || state.kind === 'unsafe-deadline'
            ? state.reason
            : hasMidnightInfo
              ? `Found: ${state.midnightInfo.amount.toString()} USDC escrowed.`
              : 'Waiting for wallet connection.',
      status:
        state.kind === 'verifying-midnight'
          ? 'active'
          : afterVerify
            ? 'done'
            : state.kind === 'mismatch' || state.kind === 'unsafe-deadline' || state.kind === 'error'
              ? 'error'
              : 'pending',
    },
    {
      id: 'lock',
      title: 'Lock USDM on Cardano',
      subtitle: afterLock
        ? 'Locked. USDM is escrowed until the maker claims it or your deadline passes.'
        : state.kind === 'locking'
          ? 'Please sign in your Cardano wallet.'
          : state.kind === 'confirm'
            ? describeBobWindow(Number(state.url.midnightDeadlineMs), Number(state.takerDeadlineMs) / 1000)
            : 'Waiting for verification.',
      status:
        state.kind === 'locking' ? 'active' : afterLock ? 'done' : state.kind === 'confirm' ? 'active' : 'pending',
      action:
        state.kind === 'confirm' ? (
          <Stack spacing={1}>
            {state.truncated && (
              <Alert severity="info" sx={{ py: 0.5 }}>
                Cardano deadline truncated to stay {Math.round(limits.bobSafetyBufferSecs / 60)}min inside the
                maker&apos;s Midnight window.
              </Alert>
            )}
            <AsyncButton variant="contained" color="primary" size="large" onClick={onAccept} pendingLabel="Preparing…">
              Accept & lock {state.url.usdmAmount.toString()} USDM
            </AsyncButton>
          </Stack>
        ) : undefined,
    },
    {
      id: 'preimage',
      title: 'Wait for the maker to claim',
      subtitle: afterPreimage
        ? 'Preimage read from the Cardano claim tx.'
        : afterLock
          ? 'Polling Cardano for the maker’s claim tx (Blockfrost).'
          : 'Pending.',
      status: state.kind === 'waiting-preimage' ? 'active' : afterPreimage ? 'done' : 'pending',
    },
    {
      id: 'claim',
      title: 'Claim USDC on Midnight',
      subtitle: afterClaim
        ? `Received ${(state as Extract<ReverseTakerStep, { midnightInfo: { amount: bigint } }>).midnightInfo.amount.toString()} USDC.`
        : afterPreimage
          ? 'Ready to claim with the revealed preimage.'
          : 'Pending.',
      status: state.kind === 'claiming' ? 'active' : afterClaim ? 'done' : afterPreimage ? 'active' : 'pending',
      action:
        state.kind === 'claim-ready' ? (
          <AsyncButton variant="contained" color="primary" size="large" onClick={onClaim} pendingLabel="Signing…">
            Claim USDC
          </AsyncButton>
        ) : undefined,
    },
  ];
};

// ---------------------------------------------------------------------------
// Dispatcher
// ---------------------------------------------------------------------------

const PhaseIcon: React.FC<{ status: StepStatus }> = ({ status }) => {
  const theme = useTheme();
  if (status === 'done') return <CheckCircleIcon fontSize="small" sx={{ color: theme.custom.success }} />;
  if (status === 'error') return <ErrorOutlineIcon fontSize="small" sx={{ color: theme.custom.danger }} />;
  if (status === 'active') return <CircularProgress size={16} thickness={5} sx={{ color: theme.custom.cardanoBlue }} />;
  return <RadioButtonUncheckedIcon fontSize="small" sx={{ color: theme.custom.textMuted }} />;
};

export const SwapProgressModal: React.FC<Props> = (props) => {
  const {
    open,
    onClose,
    onReset,
    pay,
    receive,
    role,
    flowDirection,
    fwdMaker,
    fwdTaker,
    revMaker,
    revTaker,
    usdcColor,
  } = props;
  const theme = useTheme();

  let phases: PhaseRow[];
  let activeKind: string;
  let errorMessage: string | undefined;
  if (role === 'maker' && flowDirection === 'usdm-usdc') {
    phases = buildForwardMakerPhases(fwdMaker.state, fwdMaker.shareUrl, fwdMaker.claim);
    activeKind = fwdMaker.state.kind;
    errorMessage = fwdMaker.state.kind === 'error' ? fwdMaker.state.message : undefined;
  } else if (role === 'taker' && flowDirection === 'usdm-usdc') {
    phases = buildForwardTakerPhases(fwdTaker.state, fwdTaker.accept, fwdTaker.claim, usdcColor);
    activeKind = fwdTaker.state.kind;
    errorMessage =
      fwdTaker.state.kind === 'error'
        ? fwdTaker.state.message
        : fwdTaker.state.kind === 'unsafe-deadline'
          ? fwdTaker.state.reason
          : undefined;
  } else if (role === 'maker' && flowDirection === 'usdc-usdm') {
    phases = buildReverseMakerPhases(revMaker.state, revMaker.shareUrl, revMaker.claim);
    activeKind = revMaker.state.kind;
    errorMessage = revMaker.state.kind === 'error' ? revMaker.state.message : undefined;
  } else {
    phases = buildReverseTakerPhases(revTaker.state, revTaker.accept, revTaker.claim);
    activeKind = revTaker.state.kind;
    errorMessage =
      revTaker.state.kind === 'error'
        ? revTaker.state.message
        : revTaker.state.kind === 'unsafe-deadline'
          ? revTaker.state.reason
          : revTaker.state.kind === 'mismatch'
            ? revTaker.state.reason
            : undefined;
  }
  const isDone = activeKind === 'done';

  const title = isDone
    ? 'Swap complete'
    : role === 'maker'
      ? flowDirection === 'usdm-usdc'
        ? 'Making a USDM → USDC offer'
        : 'Making a USDC → USDM offer'
      : flowDirection === 'usdm-usdc'
        ? 'Taking a USDM → USDC offer'
        : 'Taking a USDC → USDM offer';

  const subtitle = `${pay.symbol} on ${pay.chain} → ${receive.symbol} on ${receive.chain}`;

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
        <Stack direction="row" spacing={-1}>
          <TokenBadge token={pay} size={28} />
          <Box sx={{ transform: 'translateX(-6px)' }}>
            <TokenBadge token={receive} size={28} />
          </Box>
        </Stack>
        <Box sx={{ flex: 1 }}>
          <Typography sx={{ fontWeight: 600, fontSize: '1.05rem' }}>{title}</Typography>
          <Typography variant="caption" sx={{ color: theme.custom.textMuted }}>
            {subtitle}
          </Typography>
        </Box>
        <IconButton onClick={onClose} size="small">
          <CloseIcon fontSize="small" />
        </IconButton>
      </DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 0.5 }}>
          {errorMessage && (
            <Alert severity="error" variant="standard">
              {errorMessage}
            </Alert>
          )}

          {phases.map((phase, i) => (
            <Stack key={phase.id} direction="row" spacing={2} alignItems="flex-start">
              <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', pt: 0.5 }}>
                <PhaseIcon status={phase.status} />
                {i < phases.length - 1 && (
                  <Box
                    sx={{
                      width: 2,
                      flex: 1,
                      minHeight: 24,
                      mt: 0.5,
                      background: phase.status === 'done' ? alpha(theme.custom.success, 0.35) : alpha('#ffffff', 0.08),
                    }}
                  />
                )}
              </Box>
              <Box sx={{ flex: 1, pb: 2 }}>
                <Typography
                  sx={{
                    fontWeight: 600,
                    color: phase.status === 'pending' ? theme.custom.textMuted : theme.custom.textPrimary,
                  }}
                >
                  {phase.title}
                </Typography>
                {phase.subtitle && (
                  <Typography
                    variant="caption"
                    component="div"
                    sx={{ color: theme.custom.textSecondary, mt: 0.25, lineHeight: 1.45 }}
                  >
                    {phase.subtitle}
                  </Typography>
                )}
                {phase.action && <Box sx={{ mt: 1.25 }}>{phase.action}</Box>}
              </Box>
            </Stack>
          ))}

          {isDone && (
            <Box
              sx={{
                p: 2,
                borderRadius: 3,
                border: `1px solid ${alpha(theme.custom.success, 0.25)}`,
                bgcolor: alpha(theme.custom.success, 0.06),
              }}
            >
              <Typography sx={{ fontWeight: 600, color: theme.custom.success, mb: 0.5 }}>Funds received</Typography>
            </Box>
          )}

          <Stack direction="row" spacing={1} sx={{ pt: 1 }}>
            <Box sx={{ flex: 1 }} />
            {(isDone || errorMessage) && (
              <Button variant="outlined" color="primary" onClick={onReset}>
                Start new swap
              </Button>
            )}
            <Button variant="text" onClick={onClose}>
              {isDone ? 'Close' : 'Hide'}
            </Button>
          </Stack>
        </Stack>
      </DialogContent>
    </Dialog>
  );
};
